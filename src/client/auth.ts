import * as teamsSdk from '@microsoft/teams-js';

type AuthTokenProvider = () => Promise<string>;

const teamsAuthentication = teamsSdk.authentication;

let teamsHostReady = false;
let lastAuthError = '';
let authRequired = true;
let cachedAuthToken = '';
const defaultAuthTokenProvider: AuthTokenProvider = () => {
  if (!teamsAuthentication) return Promise.reject(new Error('Teams authentication API unavailable'));
  return teamsAuthentication.getAuthToken({ silent: false });
};
let authTokenProvider: AuthTokenProvider = defaultAuthTokenProvider;

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
  return cachedAuthToken ? { Authorization: `Bearer ${cachedAuthToken}` } : {};
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
