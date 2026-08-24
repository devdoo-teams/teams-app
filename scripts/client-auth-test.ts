import { strict as assert } from 'node:assert';

import * as authModule from '../src/client/auth.js';

const {
  apiFetch,
  getCachedAuthHeaders,
  markTeamsHostReady,
  resetAuthStateForTest,
  setAuthRequired,
  setAuthTokenProviderForTest,
} = authModule;

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
const capturedHeaders: Headers[] = [];
const capturedWarnings: unknown[][] = [];

console.warn = (...values: unknown[]) => {
  capturedWarnings.push(values);
};

const captureSuccessfulFetch: typeof globalThis.fetch = async (_input, init) => {
  capturedHeaders.push(new Headers(init?.headers));
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
};
globalThis.fetch = captureSuccessfulFetch;

try {
  resetAuthStateForTest();
  setAuthTokenProviderForTest(async () => 'must-not-be-used-before-host-ready');
  await assert.rejects(
    apiFetch('/api/host-not-ready', {
      headers: { Authorization: 'Bearer caller-controlled-token' },
    }),
    (caught: unknown) => (
      caught instanceof Error
      && (caught as Error & { kind?: string }).kind === 'auth-expired'
      && !caught.message.includes('caller-controlled-token')
    ),
    'auth-required requests fail closed before the Teams host is ready',
  );
  assert.equal(capturedHeaders.length, 0, 'caller credentials never reach fetch before host readiness');

  resetAuthStateForTest();
  markTeamsHostReady();
  let resolveLateToken: ((token: string) => void) | undefined;
  setAuthTokenProviderForTest(async () => new Promise<string>((resolve) => {
    resolveLateToken = resolve;
  }));
  const abortController = new AbortController();
  const abortedRequest = apiFetch('/api/aborted-auth', { signal: abortController.signal });
  abortController.abort(new DOMException('request superseded', 'AbortError'));
  const abortOutcome = await Promise.race([
    abortedRequest.then(
      () => ({ kind: 'resolved' as const }),
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    ),
    new Promise<{ kind: 'pending' }>((resolve) => {
      setTimeout(() => resolve({ kind: 'pending' }), 50);
    }),
  ]);
  assert.equal(abortOutcome.kind, 'rejected', 'aborting the request also bounds Teams token acquisition');
  if (abortOutcome.kind === 'rejected') {
    assert.equal((abortOutcome.error as { name?: string }).name, 'AbortError');
  }
  resolveLateToken?.('late-aborted-token');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(capturedHeaders.length, 0, 'an aborted token acquisition never reaches fetch');
  assert.deepEqual(getCachedAuthHeaders(), {}, 'a late token is ignored after caller cancellation');

  const setAuthTokenTimeoutForTest = (authModule as typeof authModule & {
    setAuthTokenTimeoutForTest?: (timeoutMs: number | null) => void;
  }).setAuthTokenTimeoutForTest;
  assert.equal(typeof setAuthTokenTimeoutForTest, 'function', 'token acquisition exposes a bounded test seam');
  resetAuthStateForTest();
  markTeamsHostReady();
  setAuthTokenTimeoutForTest?.(10);
  let providerWasAborted = false;
  setAuthTokenProviderForTest((signal) => new Promise<string>((_resolve, reject) => {
    signal?.addEventListener('abort', () => {
      providerWasAborted = true;
      reject(signal.reason);
    }, { once: true });
  }));
  const timeoutStartedAt = Date.now();
  await assert.rejects(
    apiFetch('/api/auth-timeout'),
    (caught: unknown) => (
      caught instanceof Error
      && (caught as Error & { kind?: string }).kind === 'auth-expired'
    ),
  );
  assert.equal(providerWasAborted, true, 'the bounded auth lease signals timeout to the provider');
  assert.ok(Date.now() - timeoutStartedAt < 500, 'the token timeout settles without waiting for the SDK promise');
  assert.equal(capturedHeaders.length, 0, 'a timed-out token request never reaches fetch');
  capturedWarnings.length = 0;

  resetAuthStateForTest();
  markTeamsHostReady();
  setAuthTokenTimeoutForTest?.(15);
  setAuthTokenProviderForTest(async () => 'fetch-timeout-token');
  let pendingFetchSignal: AbortSignal | undefined;
  let resolveLateFetch: ((response: Response) => void) | undefined;
  globalThis.fetch = async (_input, init) => {
    pendingFetchSignal = init?.signal ?? undefined;
    return new Promise<Response>((resolve) => {
      resolveLateFetch = resolve;
    });
  };
  const pendingFetch = apiFetch('/api/pending-fetch');
  const pendingFetchOutcome = await Promise.race([
    pendingFetch.then(
      () => ({ kind: 'resolved' as const }),
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    ),
    new Promise<{ kind: 'pending' }>((resolve) => {
      setTimeout(() => resolve({ kind: 'pending' }), 100);
    }),
  ]);
  assert.equal(pendingFetchOutcome.kind, 'rejected', 'the operation-scoped deadline aborts a pending fetch');
  assert.equal(pendingFetchSignal?.aborted, true, 'the same operation signal reaches and aborts fetch');
  if (pendingFetchOutcome.kind === 'rejected') {
    assert.equal((pendingFetchOutcome.error as { name?: string }).name, 'TimeoutError');
  }
  resolveLateFetch?.(new Response('{"late":true}', { status: 200 }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(getCachedAuthHeaders(), {}, 'a late fetch cannot leave a Teams token cached');
  globalThis.fetch = captureSuccessfulFetch;

  resetAuthStateForTest();
  markTeamsHostReady();
  setAuthTokenProviderForTest(async () => 'caller-abort-token');
  let callerFetchSignal: AbortSignal | undefined;
  let resolveCallerAbortedFetch: ((response: Response) => void) | undefined;
  globalThis.fetch = async (_input, init) => {
    callerFetchSignal = init?.signal ?? undefined;
    return new Promise<Response>((resolve) => {
      resolveCallerAbortedFetch = resolve;
    });
  };
  const callerController = new AbortController();
  const callerAbortedFetch = apiFetch('/api/caller-aborted-fetch', {
    signal: callerController.signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  callerController.abort(new DOMException('superseded by user action', 'AbortError'));
  await assert.rejects(
    callerAbortedFetch,
    (caught: unknown) => (caught as { name?: string }).name === 'AbortError',
    'caller cancellation rejects the pending fetch with the caller abort reason',
  );
  assert.equal(callerFetchSignal?.aborted, true, 'caller and operation signals are composed for fetch');
  resolveCallerAbortedFetch?.(new Response('{"late":true}', { status: 200 }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(getCachedAuthHeaders(), {}, 'a late caller-aborted fetch cannot retain auth state');
  globalThis.fetch = captureSuccessfulFetch;

  resetAuthStateForTest();
  markTeamsHostReady();

  let token = 'previous-account-token';
  let tokenAttempts = 0;
  setAuthTokenProviderForTest(async () => {
    tokenAttempts += 1;
    return token;
  });

  await apiFetch('/api/first');
  assert.equal(capturedHeaders[0]?.get('Authorization'), 'Bearer previous-account-token');
  assert.deepEqual(getCachedAuthHeaders(), {}, 'a completed operation never exposes a cached Teams token');
  await apiFetch('/api/second-operation');
  assert.equal(tokenAttempts, 2, 'a later logical operation reacquires its own Teams token lease');
  assert.equal(capturedHeaders[1]?.get('Authorization'), 'Bearer previous-account-token');
  assert.deepEqual(getCachedAuthHeaders(), {}, 'the second operation also releases its token at completion');

  // A health transition away from SSO must invalidate the previous account.
  setAuthRequired(false);
  assert.deepEqual(getCachedAuthHeaders(), {});

  setAuthRequired(true);
  setAuthTokenProviderForTest(async () => {
    throw new Error('account refresh failed');
  });
  await assert.rejects(
    apiFetch('/api/failed-refresh', {
      headers: { Authorization: 'Bearer stale-copilot-token' },
    }),
    (caught: unknown) => (
      caught instanceof Error
      && (caught as Error & { kind?: string }).kind === 'auth-expired'
      && !caught.message.includes('account refresh failed')
    ),
  );
  assert.equal(capturedHeaders.length, 2, 'failed Teams auth never falls through to an unauthenticated request');
  assert.deepEqual(getCachedAuthHeaders(), {});
  assert.deepEqual(capturedWarnings, [['Teams SSO token request failed']]);

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
  console.warn = originalWarn;
  resetAuthStateForTest();
}
