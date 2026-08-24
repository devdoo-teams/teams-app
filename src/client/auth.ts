import * as teamsSdk from '@microsoft/teams-js';

type AuthTokenProvider = (signal?: AbortSignal) => Promise<string>;

export type ApiAuthFailureKind = 'auth-expired' | 'forbidden';

const AUTH_EXPIRED_MESSAGE = 'Teams 인증이 만료되었습니다. 다시 인증해 계속하세요.';
const AUTH_FORBIDDEN_MESSAGE = '현재 계정에는 이 작업을 수행할 권한이 없습니다.';
const DEFAULT_AUTH_TOKEN_TIMEOUT_MS = 10_000;

// A deadline belongs to one caller-visible operation, never to a reusable
// account token cache or one individual network request.

export class ApiAuthError extends Error {
  readonly kind: ApiAuthFailureKind;

  constructor(kind: ApiAuthFailureKind) {
    super(kind === 'auth-expired' ? AUTH_EXPIRED_MESSAGE : AUTH_FORBIDDEN_MESSAGE);
    this.name = 'ApiAuthError';
    this.kind = kind;
  }
}

export function isApiAuthError(value: unknown): value is ApiAuthError {
  return value instanceof ApiAuthError;
}

export const LOCAL_ACCESS_TOKEN_HEADER = 'X-Teams-Local-Access-Token';
export const LOCAL_ACCESS_TOKEN_STORAGE_KEY = 'teams.localAccessToken';
export const LOCAL_ACCESS_TOKEN_FRAGMENT_KEY = 'teams_local_access_token';

const teamsAuthentication = teamsSdk.authentication;

let teamsHostReady = false;
let lastAuthError = '';
let authRequired = true;
let apiOperationTimeoutMs = DEFAULT_AUTH_TOKEN_TIMEOUT_MS;
// Some embedded Teams previews disable Web Storage. Keep a short-lived
// in-memory copy so the explicitly supplied local-preview token can still be
// sent to the loopback API before the URL fragment is removed.
let localAccessTokenCache = '';
const defaultAuthTokenProvider: AuthTokenProvider = () => {
  if (!teamsAuthentication) return Promise.reject(new Error('Teams authentication API unavailable'));
  return teamsAuthentication.getAuthToken({ silent: false });
};
let authTokenProvider: AuthTokenProvider = defaultAuthTokenProvider;

function getSessionStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function captureLocalAccessTokenFromFragment(): void {
  if (typeof window === 'undefined') return;

  const fragment = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : '';
  if (!fragment) return;

  const token = new URLSearchParams(fragment).get(LOCAL_ACCESS_TOKEN_FRAGMENT_KEY)?.trim();
  if (!token) return;
  localAccessTokenCache = token;

  try {
    getSessionStorage()?.setItem(LOCAL_ACCESS_TOKEN_STORAGE_KEY, token);
  } catch {
    // The server will reject the request if the browser cannot retain the
    // secret; never expose the token in an error or diagnostic message.
  }

  // A fragment is not sent in HTTP requests, but remove it immediately so
  // screenshots, copied URLs, and browser history do not retain the secret.
  window.history.replaceState(
    window.history.state,
    document.title,
    `${window.location.pathname}${window.location.search}`,
  );
}

captureLocalAccessTokenFromFragment();

function localAccessTokenForSameOrigin(input: RequestInfo | URL = '/api/health'): string | undefined {
  if (typeof window === 'undefined') return undefined;

  let target: URL;
  try {
    target = new URL(
      input instanceof Request ? input.url : input instanceof URL ? input.href : String(input),
      window.location.href,
    );
  } catch {
    return undefined;
  }
  if (target.origin !== window.location.origin) return undefined;

  const token = getSessionStorage()?.getItem(LOCAL_ACCESS_TOKEN_STORAGE_KEY)?.trim();
  return token || localAccessTokenCache || undefined;
}

export function markTeamsHostReady(): void {
  teamsHostReady = true;
}

export function getLastAuthError(): string {
  return lastAuthError;
}

export function setAuthRequired(required: boolean): void {
  authRequired = required;
  if (!required) {
    // Teams owns its SSO token cache. The app only resets its safe error state
    // when a health transition disables authenticated requests.
    clearCachedAuthToken();
  }
}

export function getCachedAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const localToken = localAccessTokenForSameOrigin('/api/copilotkit');
  if (localToken) headers[LOCAL_ACCESS_TOKEN_HEADER] = localToken;
  return headers;
}

export function clearCachedAuthToken(): void {
  // Compatibility API: Teams tokens are operation-local and never stored by
  // this module, so only the sanitized UI error state needs clearing.
  lastAuthError = '';
}

/**
 * Injects a deterministic token provider for client tests. Production code
 * always uses the Teams SDK provider; the hook is intentionally narrow so
 * auth failure and account-transition behavior can be tested without Teams.
 */
export function setAuthTokenProviderForTest(provider: AuthTokenProvider | null): void {
  authTokenProvider = provider ?? defaultAuthTokenProvider;
}

export function setAuthTokenTimeoutForTest(timeoutMs: number | null): void {
  if (timeoutMs === null) {
    apiOperationTimeoutMs = DEFAULT_AUTH_TOKEN_TIMEOUT_MS;
    return;
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('API operation timeout must be a positive finite number');
  }
  apiOperationTimeoutMs = timeoutMs;
}

export function resetAuthStateForTest(): void {
  teamsHostReady = false;
  authRequired = true;
  clearCachedAuthToken();
  authTokenProvider = defaultAuthTokenProvider;
  apiOperationTimeoutMs = DEFAULT_AUTH_TOKEN_TIMEOUT_MS;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function operationTimeoutError(): DOMException {
  return new DOMException('The Teams API operation timed out.', 'TimeoutError');
}

function waitForSignal<T>(promise: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = (): void => finish(() => reject(abortReason(signal)));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

type AbortScope = {
  signal: AbortSignal;
  assertActive: () => void;
  dispose: () => void;
};

function createAbortScope(parentSignal?: AbortSignal): AbortScope {
  const controller = new AbortController();
  const deadline = performance.now() + apiOperationTimeoutMs;
  const abortFromParent = (): void => controller.abort(abortReason(parentSignal!));
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true });

  const timeoutId = setTimeout(() => {
    controller.abort(operationTimeoutError());
  }, apiOperationTimeoutMs);

  const assertActive = (): void => {
    if (!controller.signal.aborted && performance.now() >= deadline) {
      controller.abort(operationTimeoutError());
    }
    if (controller.signal.aborted) throw abortReason(controller.signal);
  };

  return {
    signal: controller.signal,
    assertActive,
    dispose() {
      clearTimeout(timeoutId);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
}

function composeRequestSignal(operationSignal: AbortSignal, requestSignal?: AbortSignal): {
  signal: AbortSignal;
  dispose: () => void;
} {
  if (!requestSignal || requestSignal === operationSignal) {
    return { signal: operationSignal, dispose: () => undefined };
  }
  const controller = new AbortController();
  const abortFromOperation = (): void => controller.abort(abortReason(operationSignal));
  const abortFromRequest = (): void => controller.abort(abortReason(requestSignal));
  if (operationSignal.aborted) abortFromOperation();
  else if (requestSignal.aborted) abortFromRequest();
  else {
    operationSignal.addEventListener('abort', abortFromOperation, { once: true });
    requestSignal.addEventListener('abort', abortFromRequest, { once: true });
  }
  return {
    signal: controller.signal,
    dispose() {
      operationSignal.removeEventListener('abort', abortFromOperation);
      requestSignal.removeEventListener('abort', abortFromRequest);
    },
  };
}

export type ApiOperationRequest = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Runs one logical API operation with one monotonic deadline, one composed
 * abort scope, and at most one Teams token lease shared by all of its fetches.
 */
export async function runApiOperation<T>(
  execute: (request: ApiOperationRequest, signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
): Promise<T> {
  const scope = createAbortScope(parentSignal);
  let tokenLease: Promise<string> | undefined;

  const request: ApiOperationRequest = async (input, init = {}) => {
    scope.assertActive();
    const headers = new Headers(init.headers);
    headers.delete(LOCAL_ACCESS_TOKEN_HEADER);
    // A protected request may only use a token acquired for this operation and
    // current Teams host identity. Never trust a caller-supplied bearer token.
    headers.delete('Authorization');

    const localToken = localAccessTokenForSameOrigin(input);
    if (localToken) headers.set(LOCAL_ACCESS_TOKEN_HEADER, localToken);

    if (authRequired && !teamsHostReady) {
      clearCachedAuthToken();
      lastAuthError = AUTH_EXPIRED_MESSAGE;
      throw new ApiAuthError('auth-expired');
    }

    if (teamsHostReady && authRequired) {
      try {
        tokenLease ??= waitForSignal(
          Promise.resolve().then(() => authTokenProvider(scope.signal)),
          scope.signal,
        ).then((token) => {
          scope.assertActive();
          const normalized = token.trim();
          if (!normalized) throw new Error('Teams SSO token response was empty');
          return normalized;
        });
        const token = await tokenLease;
        scope.assertActive();
        headers.set('Authorization', `Bearer ${token}`);
        lastAuthError = '';
      } catch (error) {
        // Never fall back to another operation or account token. A caller
        // cancellation keeps its abort reason; a token failure is sanitized.
        headers.delete('Authorization');
        if (scope.signal.aborted) {
          const reason = abortReason(scope.signal);
          if ((reason as { name?: string }).name !== 'TimeoutError') throw reason;
        }
        lastAuthError = AUTH_EXPIRED_MESSAGE;
        console.warn('Teams SSO token request failed');
        throw new ApiAuthError('auth-expired');
      }
    }

    const composed = composeRequestSignal(scope.signal, init.signal ?? undefined);
    try {
      const response = await waitForSignal(
        fetch(input, { ...init, headers, signal: composed.signal }),
        composed.signal,
      );
      scope.assertActive();
      if (authRequired && response.status === 401) {
        lastAuthError = AUTH_EXPIRED_MESSAGE;
        throw new ApiAuthError('auth-expired');
      }
      if (authRequired && response.status === 403) {
        lastAuthError = AUTH_FORBIDDEN_MESSAGE;
        throw new ApiAuthError('forbidden');
      }
      return response;
    } finally {
      composed.dispose();
    }
  };

  try {
    scope.assertActive();
    const result = await execute(request, scope.signal);
    scope.assertActive();
    return result;
  } finally {
    scope.dispose();
  }
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const { signal, ...requestInit } = init;
  return runApiOperation(
    (request) => request(input, requestInit),
    signal ?? undefined,
  );
}
