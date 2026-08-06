import { authentication } from '@microsoft/teams-js';

let teamsHostReady = false;
let lastAuthError = '';
let authRequired = true;
let cachedAuthToken = '';

export function markTeamsHostReady(): void {
  teamsHostReady = true;
}

export function getLastAuthError(): string {
  return lastAuthError;
}

export function setAuthRequired(required: boolean): void {
  authRequired = required;
  if (!required) lastAuthError = '';
}

export function getCachedAuthHeaders(): Record<string, string> {
  return cachedAuthToken ? { Authorization: `Bearer ${cachedAuthToken}` } : {};
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);

  if (teamsHostReady && authRequired) {
    try {
      const token = await authentication.getAuthToken({ silent: false });
      headers.set('Authorization', `Bearer ${token}`);
      cachedAuthToken = token;
      lastAuthError = '';
    } catch (error) {
      lastAuthError = error instanceof Error ? error.message : String(error);
      console.warn('Teams SSO token request failed', lastAuthError);
      // Local browser preview and unconfigured Teams tenants use the server's error response.
    }
  }

  return fetch(input, { ...init, headers });
}
