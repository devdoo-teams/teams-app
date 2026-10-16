import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import React, { act } from 'react';
import { registerHooks } from 'node:module';
import * as auth from '../src/client/auth.js';
import { createCoreOrchestrationClient } from '../src/client/core-orchestration-client.js';
import { createCoreMutationAuthFixture } from './fixtures/core-mutation-auth-fixture.js';
import { withTestDom, findTestElement, flushReact } from './fixtures/react-test-dom.js';

const hostHooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@microsoft/teams-js') return { format: 'module', shortCircuit: true,
    url: 'data:text/javascript,export const app={isInitialized:()=>false}; export const authentication={};' };
  return nextResolve(specifier, context);
} });
const { createSubmissionIdempotencyController, OrchestrationPanel } = await import('../src/client/OrchestrationPanel.js');
hostHooks.deregister();

const identity = { prompt: 'synthetic scope recovery', provider: 'codex' as const, mode: 'read-only' as const, notify: false };
const corePath = '/api/core-orchestration/jobs';
const capture = <T,>(promise: Promise<T>) => promise.then(result => ({ result, error: undefined }), error => ({ result: undefined, error }));

test('unknown or malformed scope cannot allocate a key or settle a known uncertain request', () => {
  let issued = 0;
  const keys = createSubmissionIdempotencyController(() => `synthetic-${++issued}`);
  for (const owner of [undefined, '', 'invalid', 'A'.repeat(64)]) {
    assert.throws(() => keys.keyFor(identity, owner), /범위.*확인/);
  }
  assert.equal(issued, 0, 'no unverified-session key may ever exist');
  const owner = 'a'.repeat(64), original = keys.keyFor(identity, owner);
  keys.settle(identity, original, 'ambiguous-failure', owner);
  keys.settle(identity, original, 'success', undefined);
  keys.complete(identity, original, undefined);
  assert.throws(() => keys.keyFor(identity, undefined), /범위.*확인/);
  assert.equal(keys.keyFor(identity, owner), original);
  assert.equal(issued, 1);
});

for (const header of [undefined, 'invalid']) test(`a ${header ? 'malformed' : 'missing'} scope on 503 cannot erase the current verified scope`, async () => {
  const f = await createCoreMutationAuthFixture();
  try {
    await auth.apiFetch(corePath); const owner = auth.getApiPrincipalScopeKey(); assert.ok(owner);
    const fixtureFetch = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ error: 'synthetic proxy unavailable' },
      { status: 503, ...(header ? { headers: { 'X-Teams-Principal-Scope': header } } : {}) });
    try { assert.equal((await auth.apiFetch(corePath)).status, 503); }
    finally { globalThis.fetch = fixtureFetch; }
    assert.equal(auth.getApiPrincipalScopeKey(), owner);
  } finally { await f.close(); }
});

for (const method of ['GET', 'POST'] as const) for (const fail of [false, true]) {
  test(`same-token conversation change blocks the late ${method} body ${fail ? 'failure' : 'success'}`, async () => {
    const f = await createCoreMutationAuthFixture();
    try {
      const client = createCoreOrchestrationClient(); await client.listJobs();
      const owner = auth.getApiPrincipalScopeKey(); f.nextResponse(method, 'body');
      const pending = capture(method === 'GET' ? client.listJobs() : client.submitJob({ ...identity, idempotencyKey: 'synthetic-conversation' }));
      await f.waitHeld(); let invalidations = 0;
      const unsubscribe = auth.subscribeApiAuthentication(() => { invalidations++; });
      try { f.setConversation('synthetic-other-conversation'); await client.listJobs(); }
      finally { unsubscribe(); }
      assert.notEqual(auth.getApiPrincipalScopeKey(), owner);
      f.held[0].release(fail); const result = await pending;
      assert.equal(invalidations, 1, 'a new verified conversation scope invalidates the old private view');
      assert.equal(result.result, undefined);
      assert.equal(result.error?.name, method === 'GET' ? 'ApiAuthError' : 'ApiMutationUncertainError');
    } finally { await f.close(); }
  });
}

test('conversation mismatch and malformed expected scope fail before service admission', async () => {
  const f = await createCoreMutationAuthFixture();
  try {
    const client = createCoreOrchestrationClient(); await client.listJobs();
    f.setConversation('synthetic-other-conversation');
    const result = await capture(client.submitJob({ ...identity, idempotencyKey: 'synthetic-stale-conversation' }));
    assert.equal(result.error?.code, 'CORE_PRINCIPAL_CHANGED'); assert.equal(result.error?.status, 409);
    const malformed = await auth.apiFetch(corePath, { method: 'POST', headers: {
      'content-type': 'application/json', 'X-Teams-Expected-Principal-Scope': 'invalid',
    }, body: '{}' });
    assert.equal(malformed.status, 400); assert.equal(f.creations, 0);
  } finally { await f.close(); }
});

for (const scenario of ['unknown-to-known', 'headerless-503', 'renewal-without-proof'] as const) {
  test(`actual React/Core/store ${scenario} recovery creates exactly one durable job`, async () => {
    await withTestDom(async document => {
      const { createRoot } = await import('react-dom/client'); const f = await createCoreMutationAuthFixture();
      if (scenario === 'unknown-to-known') f.stripScope();
      const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
      const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); }); await flushReact(); };
      const clickRefresh = async () => {
        const button = findTestElement(container, e => e.tagName === 'BUTTON' && e.textContent === '새로고침');
        assert.equal(button.disabled, false);
        await act(async () => { button.dispatchEvent(new Event('click', { bubbles: true })); }); await settle();
      };
      const submit = async () => {
        const input = findTestElement(container, e => e.tagName === 'TEXTAREA' && e.getAttribute('aria-label') === '작업 내용');
        const prop = Object.keys(input).find(k => k.startsWith('__reactProps$'))!;
        await act(async () => { (input as unknown as Record<string, { onChange(event: unknown): void }>)[prop].onChange({ currentTarget: { value: identity.prompt } }); });
        await flushReact();
        const form = findTestElement(container, e => e.tagName === 'FORM' && e.getAttribute('class') === 'work-item-detail');
        await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await settle();
      };
      try {
        await act(async () => { root.render(<OrchestrationPanel mobile={false} />); }); await settle();
        if (scenario === 'unknown-to-known') {
          assert.equal(auth.getApiPrincipalScopeKey(), undefined); f.stripScope(false);
          await submit(); await submit();
          assert.equal(f.creations, 0, 'no first request is dispatched while owner proof is unknown');
          assert.equal(f.requests.filter(r => r.method === 'POST').length, 0);
          assert.match(container.textContent, /범위.*확인/);
          await clickRefresh();
        }
        const owner = auth.getApiPrincipalScopeKey(); assert.match(owner ?? '', /^[a-f0-9]{64}$/u);
        f.nextResponse('POST', scenario === 'unknown-to-known' ? 'invalid' : 'loss'); await submit();
        assert.equal(f.creations, 1); assert.match(container.textContent, /접수.*미확인/);
        if (scenario === 'headerless-503') {
          const fixtureFetch = globalThis.fetch; let failRead = true;
          globalThis.fetch = async (input, init = {}) => {
            if (failRead && (!init.method || init.method === 'GET')) {
              failRead = false; return Response.json({ error: 'synthetic proxy unavailable' }, { status: 503 });
            }
            return fixtureFetch(input, init);
          };
          try { await clickRefresh(); } finally { globalThis.fetch = fixtureFetch; }
          assert.equal(auth.getApiPrincipalScopeKey(), owner);
        } else if (scenario === 'renewal-without-proof') {
          f.stripScope(); f.useToken('synthetic-A2'); await clickRefresh();
          assert.equal(auth.getApiPrincipalScopeKey(), undefined);
          await clickRefresh(); await submit();
          assert.equal(f.creations, 1, 'unknown renewed session must not allocate a second request');
          assert.equal(f.requests.filter(r => r.method === 'POST').length, 1);
          f.stripScope(false); await clickRefresh(); assert.equal(auth.getApiPrincipalScopeKey(), owner);
        }
        await submit();
        const posts = f.requests.filter(r => r.method === 'POST');
        assert.equal(f.creations, 1); assert.equal(posts.length, 2); assert.equal(posts[0].key, posts[1].key);
        assert.equal((await createCoreOrchestrationClient().listJobs()).jobs.length, 1);
        console.log(JSON.stringify({ probe: scenario, actualReact: true, actualCoreService: true,
          actualDurableStore: true, externalProviderCalls: 0, creations: f.creations, postKeys: posts.map(p => p.key) }));
      } finally { try { await act(async () => root.unmount()); } finally { await f.close(); } }
    });
  });
}

for (const method of ['GET', 'POST'] as const) test(`native Fetch refuses an actual Core HTTP307 ${method} redirect`, async () => {
  const nativeFetch = globalThis.fetch; let destinations = 0;
  const target = http.createServer((_request, response) => { destinations++; response.end('{}'); });
  const source = http.createServer((_request, response) => {
    response.writeHead(307, { Location: `http://127.0.0.1:${(target.address() as { port: number }).port}/target` }); response.end();
  });
  try {
    for (const server of [target, source]) await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    auth.resetAuthStateForTest(); auth.markTeamsHostReady(); auth.setAuthRequired(true);
    auth.setAuthTokenProviderForTest(async () => 'synthetic-redirect-token');
    globalThis.fetch = (input, init) => nativeFetch(`http://127.0.0.1:${(source.address() as { port: number }).port}${String(input)}`, init);
    const result = await capture(auth.apiFetch(corePath, { method, ...(method === 'POST' ? { body: '{}' } : {}) }));
    assert.equal(result.result, undefined);
    assert.equal(result.error?.name, method === 'GET' ? 'TypeError' : 'ApiMutationUncertainError');
    assert.equal(destinations, 0);
  } finally {
    globalThis.fetch = nativeFetch; auth.resetAuthStateForTest();
    for (const server of [source, target]) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }
});
