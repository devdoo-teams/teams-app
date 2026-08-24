import assert from 'node:assert/strict';

const token = 'local-test-token-' + 'x'.repeat(40);
const values = new Map<string, string>();
const requests: Array<{ input: RequestInfo | URL; headers: Headers }> = [];
let replaceStateCalls = 0;

const location = {
  origin: 'http://127.0.0.1:3979',
  href: 'http://127.0.0.1:3979/tabs/home/?token-ignored=1',
  hash: '',
  pathname: '/tabs/home/',
  search: '?token-ignored=1',
};

const sessionStorage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
  clear: () => { values.clear(); },
  key: (index: number) => [...values.keys()][index] ?? null,
  get length() { return values.size; },
};

globalThis.window = {
  location,
  history: {
    state: null,
    replaceState: () => { replaceStateCalls += 1; location.hash = ''; },
  },
  sessionStorage,
} as unknown as Window & typeof globalThis;
globalThis.document = {
  title: 'Teams local auth test',
  getElementsByTagName: () => [],
} as unknown as Document;
const testFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  requests.push({ input, headers: new Headers(init?.headers) });
  return new Response('{}', { status: 200 });
};
globalThis.fetch = testFetch;

const auth = await import('../src/client/auth.ts');
assert.equal(globalThis.fetch, testFetch, 'auth module does not monkey-patch global fetch');

// This fixture models the explicitly selected local preview path. Teams SSO
// remains the default for production; local mode must opt out before its
// first API call so the dedicated fragment token can be exercised.
auth.setAuthRequired(false);
await auth.apiFetch('/api/health');
assert.equal(values.get(auth.LOCAL_ACCESS_TOKEN_STORAGE_KEY), undefined, 'query parameters are not accepted as local access tokens');
assert.equal(requests[0]?.headers.has(auth.LOCAL_ACCESS_TOKEN_HEADER), false, 'query token is not attached to same-origin requests');

location.hash = `#${auth.LOCAL_ACCESS_TOKEN_FRAGMENT_KEY}=${encodeURIComponent(token)}`;
auth.captureLocalAccessTokenFromFragment();
assert.equal(values.get(auth.LOCAL_ACCESS_TOKEN_STORAGE_KEY), token, 'fragment token is stored in sessionStorage');
assert.equal(location.hash, '', 'fragment is removed from the visible URL');
assert.equal(replaceStateCalls, 1, 'history is replaced immediately after capture');

await auth.apiFetch('/api/items');
const localRequest = requests.at(-1)!;
assert.equal(localRequest.headers.get(auth.LOCAL_ACCESS_TOKEN_HEADER), token, 'same-origin API request carries the dedicated local token header');

await auth.apiFetch('https://external.example.test/api');
const crossOriginRequest = requests.at(-1)!;
assert.equal(crossOriginRequest.headers.has(auth.LOCAL_ACCESS_TOKEN_HEADER), false, 'cross-origin request never carries the local token header');

console.log('Local auth client verification passed');
