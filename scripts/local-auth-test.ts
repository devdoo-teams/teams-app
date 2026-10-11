import assert from 'node:assert/strict';

const token = 'local-test-token-' + 'x'.repeat(40);
const values = new Map<string, string>();
const requests: Array<{ input: RequestInfo | URL; headers: Headers }> = [];
let replaceStateCalls = 0;

const location = {
  origin: 'http://127.0.0.1:3979',
  href: 'http://127.0.0.1:3979/tabs/home/?preview=1',
  hash: '',
  pathname: '/tabs/home/',
  search: '?preview=1',
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

const enableLocalBrowserPreviewAuth = (auth as typeof auth & {
  enableLocalBrowserPreviewAuth?: () => boolean;
}).enableLocalBrowserPreviewAuth;
assert.equal(typeof enableLocalBrowserPreviewAuth, 'function', 'explicit local preview exposes a guarded auth opt-out');
const requestsBeforePreviewChecks = requests.length;

// Preview mode without a fragment token stays authenticated and fails closed.
auth.resetAuthStateForTest();
assert.equal(enableLocalBrowserPreviewAuth?.(), false, 'localhost preview without its dedicated token cannot disable Teams auth');
await assert.rejects(
  auth.apiFetch('/api/health'),
  (error: unknown) => error instanceof auth.ApiAuthError && error.kind === 'auth-expired',
  'the first API call cannot run before a local preview token is present',
);
assert.equal(requests.length, requestsBeforePreviewChecks, 'unauthenticated local preview does not reach fetch');

location.hash = `#${auth.LOCAL_ACCESS_TOKEN_FRAGMENT_KEY}=${encodeURIComponent(token)}`;
auth.captureLocalAccessTokenFromFragment();
assert.equal(values.get(auth.LOCAL_ACCESS_TOKEN_STORAGE_KEY), token, 'fragment token is stored in sessionStorage');
assert.equal(location.hash, '', 'fragment is removed from the visible URL');
assert.equal(replaceStateCalls, 1, 'history is replaced immediately after capture');

auth.resetAuthStateForTest();
assert.equal(enableLocalBrowserPreviewAuth?.(), true, 'explicit loopback preview with a fragment token may use the protected local token path');
await auth.apiFetch('/api/items');
const localRequest = requests.at(-1)!;
assert.equal(localRequest.headers.get(auth.LOCAL_ACCESS_TOKEN_HEADER), token, 'same-origin API request carries the dedicated local token header');

await auth.apiFetch('https://external.example.test/api');
const crossOriginRequest = requests.at(-1)!;
assert.equal(crossOriginRequest.headers.has(auth.LOCAL_ACCESS_TOKEN_HEADER), false, 'cross-origin request never carries the local token header');

auth.resetAuthStateForTest();
location.href = 'http://127.0.0.1:3979/tabs/home/?token-ignored=1';
location.search = '?token-ignored=1';
assert.equal(enableLocalBrowserPreviewAuth?.(), false, 'a local token without the explicit preview switch cannot disable Teams authentication');
await assert.rejects(
  auth.apiFetch('/api/health'),
  (error: unknown) => error instanceof auth.ApiAuthError && error.kind === 'auth-expired',
  'local API requests remain Teams-authenticated unless preview is explicitly selected',
);

auth.resetAuthStateForTest();
location.origin = 'https://example.com';
location.href = 'https://example.com/tabs/home/?preview=1';
location.search = '?preview=1';
assert.equal(enableLocalBrowserPreviewAuth?.(), false, 'public ?preview=1 cannot disable Teams authentication even with a captured local token');
await assert.rejects(
  auth.apiFetch('/api/health'),
  (error: unknown) => error instanceof auth.ApiAuthError && error.kind === 'auth-expired',
  'a public origin still requires the Teams host before making an API call',
);
assert.equal(requests.length, requestsBeforePreviewChecks + 2, 'public preview cannot reach fetch without Teams SSO');

console.log('Local auth client verification passed');
