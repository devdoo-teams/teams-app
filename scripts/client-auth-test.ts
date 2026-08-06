import { strict as assert } from 'node:assert';

import {
  apiFetch,
  getCachedAuthHeaders,
  markTeamsHostReady,
  resetAuthStateForTest,
  setAuthRequired,
  setAuthTokenProviderForTest,
} from '../src/client/auth.js';

const originalFetch = globalThis.fetch;
const capturedHeaders: Headers[] = [];

globalThis.fetch = async (_input, init) => {
  capturedHeaders.push(new Headers(init?.headers));
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
};

try {
  resetAuthStateForTest();
  markTeamsHostReady();

  let token = 'previous-account-token';
  setAuthTokenProviderForTest(async () => token);

  await apiFetch('/api/first');
  assert.equal(capturedHeaders[0]?.get('Authorization'), 'Bearer previous-account-token');
  assert.deepEqual(getCachedAuthHeaders(), { Authorization: 'Bearer previous-account-token' });

  // A health transition away from SSO must invalidate the previous account.
  setAuthRequired(false);
  assert.deepEqual(getCachedAuthHeaders(), {});

  setAuthRequired(true);
  setAuthTokenProviderForTest(async () => {
    throw new Error('account refresh failed');
  });
  await apiFetch('/api/failed-refresh', {
    headers: { Authorization: 'Bearer stale-copilot-token' },
  });
  assert.equal(capturedHeaders[1]?.get('Authorization'), null);
  assert.deepEqual(getCachedAuthHeaders(), {});

  // A later account can obtain a new token, but an old one must never be
  // resurrected when that account's refresh fails again.
  token = 'new-account-token';
  setAuthTokenProviderForTest(async () => token);
  await apiFetch('/api/new-account');
  assert.equal(capturedHeaders[2]?.get('Authorization'), 'Bearer new-account-token');

  setAuthRequired(false);
  setAuthTokenProviderForTest(async () => {
    throw new Error('second account refresh failed');
  });
  await apiFetch('/api/account-transition', {
    headers: { authorization: 'Bearer stale-after-transition' },
  });
  assert.equal(capturedHeaders[3]?.get('Authorization'), null);
  assert.deepEqual(getCachedAuthHeaders(), {});

  console.log('Client auth tests passed');
} finally {
  globalThis.fetch = originalFetch;
  resetAuthStateForTest();
}
