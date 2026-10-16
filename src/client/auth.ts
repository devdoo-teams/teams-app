import * as teamsSdk from '@microsoft/teams-js';
import { API_PRINCIPAL_SCOPE_HEADER, isPrincipalScopeKey } from '../shared/api-principal-scope.js';

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

export class ApiMutationUncertainError extends Error {
  constructor(readonly reason: 'authentication-changed' | 'response-unavailable', readonly responseStatus?: number) {
    super('접수 결과 미확인: 요청이 이미 처리되었을 수 있습니다. 자동으로 다시 보내지 말고 원래 계정에서 결과를 확인하세요.');
    this.name = 'ApiMutationUncertainError';
  }
}
export const isApiMutationUncertainError = (value: unknown): value is ApiMutationUncertainError => value instanceof ApiMutationUncertainError;

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

// Only an in-memory digest is retained, never a reusable token or decoded
// identity. Any credential change conservatively invalidates private views,
// including token renewal. This is cache eviction, not authorization.
let credentialFingerprint: string | undefined;
let authenticationGeneration = 0;
let operationSequence = 0;
let latestAuthenticationOperation = 0;
let principalScopeKey: string | undefined;
let coreScopeRequestSequence = 0;
let latestPrincipalScopeRequest = 0;
export const getApiPrincipalScopeKey = (): string | undefined => principalScopeKey;
type ApiResponseFacts = { generation: number; mutation: boolean; owner?: string; scopeRequest?: number };
const responseFacts = new WeakMap<Response, ApiResponseFacts>();
function assertResponseScope(facts: ApiResponseFacts, status: number): void {
  const superseded = facts.scopeRequest !== undefined && principalScopeKey !== undefined
    && facts.scopeRequest < latestPrincipalScopeRequest && facts.owner !== principalScopeKey;
  if (facts.generation === authenticationGeneration && !superseded) return;
  // A changed opaque token never proves an owner. Only two server-validated
  // Core scope observations may confirm a same-owner mutation receipt.
  if (facts.mutation && facts.owner && facts.owner === principalScopeKey) return;
  if (facts.mutation) throw new ApiMutationUncertainError('authentication-changed', status);
  throw new ApiAuthError('auth-expired');
}
export async function readApiResponseJson(response: Response, mutation = false): Promise<unknown> {
  const facts = responseFacts.get(response);
  let value: unknown;
  try { value = await response.json(); }
  catch (error) {
    if (facts) assertResponseScope(facts, response.status);
    if ((facts?.mutation ?? mutation) && response.ok) throw new ApiMutationUncertainError('response-unavailable', response.status);
    throw error;
  }
  if (facts) assertResponseScope(facts, response.status);
  return value;
}
function isCoreSameOriginRequest(input: RequestInfo | URL): boolean {
  const value = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (value.startsWith('/api/core-orchestration/')) return true;
  if (typeof window === 'undefined') return false;
  try { const url = new URL(value, window.location.href); return url.origin === window.location.origin && url.pathname.startsWith('/api/core-orchestration/'); }
  catch { return false; }
}
const authenticationListeners = new Set<() => void>();
export function subscribeApiAuthentication(listener: () => void): () => void {
  authenticationListeners.add(listener);
  return () => { authenticationListeners.delete(listener); };
}
function invalidateApiAuthentication(operation: number, expectedGeneration = authenticationGeneration): boolean {
  if (operation < latestAuthenticationOperation || expectedGeneration !== authenticationGeneration) return false;
  latestAuthenticationOperation = operation;
  credentialFingerprint = undefined;
  principalScopeKey = undefined;
  authenticationGeneration += 1;
  for (const listener of authenticationListeners) listener();
  return true;
}
async function observeApiCredential(credential: string, operation: number, signal: AbortSignal): Promise<number> {
  const bytes = await waitForSignal(globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(credential)), signal);
  const fingerprint = Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
  if (operation < latestAuthenticationOperation && fingerprint !== credentialFingerprint) throw new ApiAuthError('auth-expired');
  latestAuthenticationOperation = Math.max(latestAuthenticationOperation, operation);
  const changed = credentialFingerprint !== undefined && credentialFingerprint !== fingerprint;
  credentialFingerprint = fingerprint;
  if (changed) {
    principalScopeKey = undefined;
    authenticationGeneration += 1;
    for (const listener of authenticationListeners) listener();
  }
  return authenticationGeneration;
}

function getSessionStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function isLocalBrowserPreviewOrigin(value: string | URL): boolean {
  try {
    const url = new URL(value.toString());
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

function removeLocalAccessTokenFragment(): void {
  if (typeof window === 'undefined') return;
  window.history.replaceState(
    window.history.state,
    document.title,
    `${window.location.pathname}${window.location.search}`,
  );
}

export function captureLocalAccessTokenFromFragment(): void {
  if (typeof window === 'undefined') return;

  const fragment = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : '';
  if (!fragment) return;

  const token = new URLSearchParams(fragment).get(LOCAL_ACCESS_TOKEN_FRAGMENT_KEY)?.trim();
  if (!token) return;
  if (!isLocalBrowserPreviewOrigin(window.location.href)) {
    removeLocalAccessTokenFragment();
    return;
  }
  localAccessTokenCache = token;

  try {
    getSessionStorage()?.setItem(LOCAL_ACCESS_TOKEN_STORAGE_KEY, token);
  } catch {
    // The server will reject the request if the browser cannot retain the
    // secret; never expose the token in an error or diagnostic message.
  }

  // A fragment is not sent in HTTP requests, but remove it immediately so
  // screenshots, copied URLs, and browser history do not retain the secret.
  removeLocalAccessTokenFragment();
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
  if (!isLocalBrowserPreviewOrigin(window.location.href) || target.origin !== window.location.origin) return undefined;

  const token = getSessionStorage()?.getItem(LOCAL_ACCESS_TOKEN_STORAGE_KEY)?.trim();
  return token || localAccessTokenCache || undefined;
}

export function markTeamsHostReady(): void {
  teamsHostReady = true;
}

/**
 * Allows the local API-token flow only for an explicitly requested preview on
 * a loopback origin. The server still validates the token on every protected
 * request; public origins continue to require the Teams host and SSO.
 */
export function enableLocalBrowserPreviewAuth(): boolean {
  if (typeof window === 'undefined') return false;

  let previewUrl: URL;
  try {
    previewUrl = new URL(window.location.href);
  } catch {
    return false;
  }

  const explicitlyRequested = ['1', 'true'].includes(previewUrl.searchParams.get('preview') ?? '');
  if (!explicitlyRequested || !isLocalBrowserPreviewOrigin(previewUrl)) return false;

  let localToken: string | undefined;
  try {
    localToken = localAccessTokenForSameOrigin('/api/health');
  } catch {
    return false;
  }
  if (!localToken) return false;

  setAuthRequired(false);
  return true;
}

export function getLastAuthError(): string {
  return lastAuthError;
}

export function setAuthRequired(required: boolean): void {
  if (authRequired !== required) invalidateApiAuthentication(++operationSequence);
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
  invalidateApiAuthentication(++operationSequence);
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
  const operation = ++operationSequence;
  let authGeneration = authenticationGeneration;
  let tokenLease: Promise<string> | undefined;
  let possiblyAcceptedMutations = 0;

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
      invalidateApiAuthentication(operation, authGeneration);
      lastAuthError = AUTH_EXPIRED_MESSAGE;
      throw new ApiAuthError('auth-expired');
    }

    if (teamsHostReady && authRequired) {
      try {
        tokenLease ??= waitForSignal(
          Promise.resolve().then(() => authTokenProvider(scope.signal)),
          scope.signal,
        ).then(async (token) => {
          scope.assertActive();
          const normalized = token.trim();
          if (!normalized) throw new Error('Teams SSO token response was empty');
          authGeneration = await observeApiCredential(`teams:${normalized}`, operation, scope.signal);
          scope.assertActive();
          return normalized;
        });
        const token = await tokenLease;
        scope.assertActive();
        if (authGeneration !== authenticationGeneration) throw new ApiAuthError('auth-expired');
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
        if (invalidateApiAuthentication(operation, authGeneration)) lastAuthError = AUTH_EXPIRED_MESSAGE;
        console.warn('Teams SSO token request failed');
        throw new ApiAuthError('auth-expired');
      }
    } else if (localToken) {
      authGeneration = await observeApiCredential(`local:${localToken}`, operation, scope.signal);
      scope.assertActive();
    }

    const method = (init.method ?? (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')).toUpperCase();
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    const coreSameOrigin = isCoreSameOriginRequest(input);
    // Order each dispatched fetch, including parallel fetches sharing a token
    // lease. First scope proof must already protect against older responses.
    const scopeRequest = coreSameOrigin ? ++coreScopeRequestSequence : undefined;
    const composed = composeRequestSignal(scope.signal, init.signal ?? undefined);
    let sent = false, rejected = false, responseStatus: number | undefined;
    try {
      sent = true;
      if (mutation) possiblyAcceptedMutations += 1;
      const response = await waitForSignal(
        fetch(input, { ...init, headers, signal: composed.signal, ...(coreSameOrigin ? { redirect: 'error' as const } : {}) }),
        composed.signal,
      );
      responseStatus = response.status;
      scope.assertActive();
      const ownerHeader = coreSameOrigin ? response.headers.get(API_PRINCIPAL_SCOPE_HEADER) : undefined;
      const owner = isPrincipalScopeKey(ownerHeader) ? ownerHeader : undefined;
      const facts = { generation: authGeneration, mutation, owner, scopeRequest };
      // Reject an older conflicting/unproven response before it can replace
      // scope; the same check also runs after a delayed JSON body completes.
      assertResponseScope(facts, response.status);
      if (authGeneration === authenticationGeneration && owner && scopeRequest !== undefined && response.status !== 401 && response.status !== 403) {
        // A headerless proxy/error response cannot revoke an earlier proof in
        // this credential generation. Credential invalidation still clears it.
        const changed = principalScopeKey !== undefined && principalScopeKey !== owner;
        principalScopeKey = owner;
        latestPrincipalScopeRequest = Math.max(latestPrincipalScopeRequest, scopeRequest);
        if (changed) {
          // A conversation can change while the opaque credential stays the
          // same. Invalidate old private views/bodies before exposing this one.
          authGeneration = ++authenticationGeneration;
          for (const listener of authenticationListeners) listener();
        }
      }
      facts.generation = authGeneration;
      responseFacts.set(response, facts);
      assertResponseScope(facts, response.status);
      if (mutation && response.status >= 400 && response.status < 500) { rejected = true; possiblyAcceptedMutations -= 1; }
      if (authRequired && response.status === 401) {
        if (invalidateApiAuthentication(operation, authGeneration)) lastAuthError = AUTH_EXPIRED_MESSAGE;
        throw new ApiAuthError('auth-expired');
      }
      if (authRequired && response.status === 403) {
        if (invalidateApiAuthentication(operation, authGeneration)) lastAuthError = AUTH_FORBIDDEN_MESSAGE;
        throw new ApiAuthError('forbidden');
      }
      return response;
    } catch (error) {
      if (mutation && sent && !rejected && !isApiMutationUncertainError(error)) {
        throw new ApiMutationUncertainError(isApiAuthError(error) ? 'authentication-changed' : 'response-unavailable', responseStatus);
      }
      throw error;
    } finally {
      composed.dispose();
    }
  };

  try {
    scope.assertActive();
    const result = await execute(request, scope.signal);
    scope.assertActive();
    return result;
  } catch (error) {
    if (possiblyAcceptedMutations > 0 && !isApiMutationUncertainError(error)) {
      throw new ApiMutationUncertainError(isApiAuthError(error) ? 'authentication-changed' : 'response-unavailable');
    }
    throw error;
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
