import { authentication } from '@microsoft/teams-js';

let teamsHostReady = false;

export function markTeamsHostReady(): void {
  teamsHostReady = true;
}

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);

  if (teamsHostReady) {
    try {
      const token = await authentication.getAuthToken();
      headers.set('Authorization', `Bearer ${token}`);
    } catch {
      // Local browser preview and unconfigured Teams tenants use the server's error response.
    }
  }

  return fetch(input, { ...init, headers });
}
