import * as teamsSdk from '@microsoft/teams-js';

type AuthTokenProvider = () => Promise<string>;

export const LOCAL_ACCESS_TOKEN_HEADER = 'X-Teams-Local-Access-Token';
export const LOCAL_ACCESS_TOKEN_STORAGE_KEY = 'teams.localAccessToken';
export const LOCAL_ACCESS_TOKEN_FRAGMENT_KEY = 'teams_local_access_token';

const teamsAuthentication = teamsSdk.authentication;

let teamsHostReady = false;
let lastAuthError = '';
let authRequired = true;
let cachedAuthToken = '';
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
    // A health response that disables SSO can also represent an account or
    // host transition. Do not let a token from the previous identity escape
    // through CopilotKit's headers callback after that transition.
    clearCachedAuthToken();
  }
}

export function getCachedAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const localToken = localAccessTokenForSameOrigin('/api/copilotkit');
  if (localToken) headers[LOCAL_ACCESS_TOKEN_HEADER] = localToken;
  if (cachedAuthToken) headers.Authorization = `Bearer ${cachedAuthToken}`;
  return headers;
}

export function clearCachedAuthToken(): void {
  cachedAuthToken = '';
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

export function resetAuthStateForTest(): void {
  teamsHostReady = false;
  authRequired = true;
  clearCachedAuthToken();
  authTokenProvider = defaultAuthTokenProvider;
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.delete(LOCAL_ACCESS_TOKEN_HEADER);

  const localToken = localAccessTokenForSameOrigin(input);
  if (localToken) headers.set(LOCAL_ACCESS_TOKEN_HEADER, localToken);

  if (!authRequired) headers.delete('Authorization');

  if (teamsHostReady && authRequired) {
    try {
      const token = (await authTokenProvider()).trim();
      if (!token) throw new Error('Teams SSO token response was empty');
      headers.set('Authorization', `Bearer ${token}`);
      cachedAuthToken = token;
      lastAuthError = '';
    } catch (error) {
      // Never fall back to the previous account's token. This also removes an
      // Authorization header supplied by CopilotKit from an earlier request.
      clearCachedAuthToken();
      headers.delete('Authorization');
      lastAuthError = error instanceof Error ? error.message : String(error);
      console.warn('Teams SSO token request failed', lastAuthError);
      // Local browser preview and unconfigured Teams tenants use the server's
      // error response, but they must still receive no stale credentials.
    }
  }

  return fetch(input, { ...init, headers });
}
