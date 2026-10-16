import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { registerHooks } from 'node:module';
import * as auth from '../src/client/auth.js';
import { createCoreOrchestrationClient } from '../src/client/core-orchestration-client.js';
import { createCoreMutationAuthFixture } from './fixtures/core-mutation-auth-fixture.js';
import { withTestDom, findTestElement, findTestElements, flushReact } from './fixtures/react-test-dom.js';

const hostHooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@microsoft/teams-js') return { format: 'module', shortCircuit: true,
    url: 'data:text/javascript,export const app={isInitialized:()=>false}; export const authentication={};' };
  return nextResolve(specifier, context);
} });
const { createSubmissionIdempotencyController, OrchestrationPanel } = await import('../src/client/OrchestrationPanel.js');
hostHooks.deregister();

const identity = { prompt: 'synthetic mutation recovery', provider: 'codex' as const, mode: 'read-only' as const, notify: false };
const corePath = '/api/core-orchestration/jobs';
const scopeHeader = 'X-Teams-Principal-Scope';
const expectedHeader = 'X-Teams-Expected-Principal-Scope';
const capture = <T,>(promise: Promise<T>) => promise.then(result => ({ result, error: undefined }), error => ({ result: undefined, error }));
const key = (value: string) => ({ ...identity, idempotencyKey: value });

for (const nextToken of ['synthetic-A2', 'synthetic-B', 'synthetic-other-tenant']) {
  test(`sent 201 after credential change is never a definitive authentication failure (${nextToken})`, async () => {
    const f = await createCoreMutationAuthFixture();
    try {
      const client = createCoreOrchestrationClient(); await client.listJobs();
      f.nextResponse('POST', 'hold'); const pending = capture(client.submitJob(key('accepted-before-auth-change')));
      await f.waitHeld(); assert.equal(f.creations, 1); assert.equal(f.held[0].status, 201);
      f.useToken(nextToken); await client.listJobs(); f.held[0].release(); const first = await pending;
      if (nextToken === 'synthetic-A2') {
        assert.equal(first.error, undefined, 'a server-verified same-owner renewal may confirm the accepted receipt');
        assert.equal(first.result?.job.idempotencyKey, 'accepted-before-auth-change');
      } else {
        assert.equal(first.result, undefined); assert.equal(first.error?.name, 'ApiMutationUncertainError');
        assert.equal(auth.isApiAuthError(first.error), false, 'a possibly accepted mutation is not a pre-send auth rejection');
        assert.doesNotMatch(String(first.error?.message), /synthetic mutation recovery|agent-/);
        assert.equal((await client.listJobs()).jobs.length, 0, 'current foreign owner sees no original private job');
      }
      assert.equal(f.creations, 1);
    } finally { await f.close(); }
  });
}

for (const mode of ['loss', 'invalid'] as const) {
  test(`post-acceptance ${mode} is explicit uncertainty and same-key recovery creates exactly one job`, async () => {
    const f = await createCoreMutationAuthFixture();
    try {
      const client = createCoreOrchestrationClient(); await client.listJobs();
      f.nextResponse('POST', mode); const first = await capture(client.submitJob(key(`recovery-${mode}`)));
      assert.equal(first.error?.name, 'ApiMutationUncertainError'); assert.equal(f.creations, 1);
      const replay = await client.submitJob(key(`recovery-${mode}`)); assert.equal(replay.replayed, true); assert.equal(f.creations, 1);
      assert.equal((await client.listJobs()).jobs.length, 1, 'read-only recovery observes the one durable server job');
    } finally { await f.close(); }
  });
}

test('late private GET is blocked without being classified as a potentially accepted mutation', async () => {
  const f = await createCoreMutationAuthFixture();
  try {
    const client = createCoreOrchestrationClient(); await client.submitJob(key('before-private-get'));
    f.nextResponse('GET', 'hold'); const pending = capture(client.listJobs()); await f.waitHeld();
    f.useToken('synthetic-B'); await client.listJobs(); f.held[0].release(); const first = await pending;
    assert.equal(first.result, undefined); assert.equal(auth.isApiAuthError(first.error), true); assert.equal(f.creations, 1);
  } finally { await f.close(); }
});

test('failed authentication before dispatch is definitive and sends no POST', async () => {
  const f = await createCoreMutationAuthFixture(); const warn = console.warn; console.warn = () => {};
  try {
    f.signOut(); const first = await capture(createCoreOrchestrationClient().submitJob(key('never-sent')));
    assert.equal(auth.isApiAuthError(first.error), true); assert.equal(f.creations, 0); assert.equal(f.requests.length, 0);
  } finally { console.warn = warn; await f.close(); }
});

test('Core scope proof is server derived, renewal stable, and a stale expected scope cannot mutate', async () => {
  const f = await createCoreMutationAuthFixture();
  try {
    const read = () => auth.apiFetch(corePath); const a = (await read()).headers.get(scopeHeader); assert.match(a ?? '', /^[a-f0-9]{64}$/u);
    f.useToken('synthetic-A2'); assert.equal((await read()).headers.get(scopeHeader), a);
    f.useToken('synthetic-B'); const b = (await read()).headers.get(scopeHeader); assert.notEqual(a, b);
    const response = await auth.apiFetch(corePath, { method: 'POST', headers: { 'content-type': 'application/json', [expectedHeader]: a! }, body: JSON.stringify(key('wrong-owner-precondition')) });
    assert.equal(response.status, 409); assert.equal(f.creations, 0, 'scope mismatch is rejected before AgentService/store admission');
  } finally { await f.close(); }
});

test('submission keys remain distinct per owner and preserve an unresolved input across edits', () => {
  let sequence = 0; const keys = createSubmissionIdempotencyController(() => `synthetic-key-${++sequence}`);
  const a = keys.keyFor(identity, 'a'.repeat(64)); const b = keys.keyFor(identity, 'b'.repeat(64));
  assert.notEqual(a, b, 'a different authenticated principal must not reuse the previous owner key');
  const edited = keys.keyFor({ ...identity, prompt: 'another synthetic input' }, 'a'.repeat(64)); assert.notEqual(edited, a);
  assert.equal(keys.keyFor(identity, 'a'.repeat(64)), a, 'editing must not discard an earlier unresolved request identity');
});

test('an uncertain key survives a later definitive retry failure until a confirmed same-owner receipt', () => {
  let seq = 0; const keys = createSubmissionIdempotencyController(() => `sticky-${++seq}`), owner = 'a'.repeat(64);
  const original = keys.keyFor(identity, owner); keys.settle(identity, original, 'ambiguous-failure', owner);
  keys.settle(identity, original, 'definitive-failure', owner);
  assert.equal(keys.keyFor(identity, owner), original, 'a later pre-send auth rejection cannot erase an earlier possible acceptance');
  keys.settle(identity, original, 'success', owner); assert.notEqual(keys.keyFor(identity, owner), original);
});

test('bounded pending-key storage never evicts an unresolved request', () => {
  let seq = 0; const keys = createSubmissionIdempotencyController(() => `bounded-${++seq}`);
  const owner = 'a'.repeat(64), first = keys.keyFor(identity, owner);
  for (let i = 1; i < 64; i++) keys.keyFor({ ...identity, prompt: `synthetic-${i}` }, owner);
  assert.throws(() => keys.keyFor({ ...identity, prompt: 'overflow' }, owner), /미확인/);
  assert.equal(keys.keyFor(identity, owner), first);
});

test('catalog refresh cannot silently rotate an uncertain submission with the same visible input', () => {
  const keys = createSubmissionIdempotencyController(), owner = 'a'.repeat(64);
  const original = { ...identity, model: 'gpt-6-luna', reasoningEffort: 'xhigh' as const, catalogRevision: 'b'.repeat(64) };
  const first = keys.keyFor(original, owner); keys.settle(original, first, 'ambiguous-failure', owner);
  assert.throws(() => keys.keyFor({ ...original, catalogRevision: 'c'.repeat(64) }, owner), /접수.*미확인/);
  assert.equal(keys.keyFor(original, owner), first);
});

test('opaque renewal without server scope proof stays uncertain and replays with the same key', async () => {
  const f = await createCoreMutationAuthFixture();
  try {
    f.stripScope(); const client = createCoreOrchestrationClient(); await client.listJobs();
    f.nextResponse('POST', 'hold'); const pending = capture(client.submitJob(key('unknown-owner-renewal'))); await f.waitHeld();
    f.useToken('synthetic-A2'); await client.listJobs(); f.held[0].release(); const first = await pending;
    assert.equal(first.error?.name, 'ApiMutationUncertainError'); assert.equal(first.result, undefined);
    assert.equal(auth.getApiPrincipalScopeKey(), undefined);
    assert.equal((await client.submitJob(key('unknown-owner-renewal'))).replayed, true); assert.equal(f.creations, 1);
  } finally { await f.close(); }
});

for (const method of ['GET', 'POST'] as const) for (const fail of [false, true]) {
  test(`${method} delayed body ${fail ? 'failure' : 'success'} with a new owner cannot reveal the prior payload`, async () => {
    const f = await createCoreMutationAuthFixture();
    try {
      const client = createCoreOrchestrationClient(); await client.listJobs(); f.nextResponse(method, 'body');
      const pending = capture(method === 'POST' ? client.submitJob(key(`body-${fail}`)) : client.listJobs()); await f.waitHeld();
      f.useToken('synthetic-B'); await client.listJobs(); f.held[0].release(fail); const first = await pending;
      assert.equal(first.result, undefined);
      assert.equal(first.error?.name, method === 'POST' ? 'ApiMutationUncertainError' : 'ApiAuthError');
      assert.equal((await client.listJobs()).jobs.length, 0);
    } finally { await f.close(); }
  });
}

test('GET response loss stays a read failure, while a Core fetch refuses redirects', async () => {
  const f = await createCoreMutationAuthFixture();
  try {
    f.nextResponse('GET', 'loss'); const first = await capture(createCoreOrchestrationClient().listJobs());
    assert.equal(first.error?.name, 'TypeError'); assert.equal(f.creations, 0);
    assert.equal(f.requests[0].redirect, 'error', 'a Core scope proof must not come from a followed foreign redirect');
  } finally { await f.close(); }
});

for (const scenario of ['renewal', 'invalid'] as const) test(`actual React submit recovery keeps the original key after ${scenario}`, async () => {
  await withTestDom(async document => {
    const { createRoot } = await import('react-dom/client'); const f = await createCoreMutationAuthFixture();
    const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
    const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); }); await flushReact(); };
    const click = async (text: string) => {
      const button = findTestElement(container, e => e.tagName === 'BUTTON' && e.textContent === text); assert.equal(button.disabled, false);
      await act(async () => { button.dispatchEvent(new Event('click', { bubbles: true })); }); await flushReact();
    };
    const prompt = async () => {
      const input = findTestElement(container, e => e.tagName === 'TEXTAREA' && e.getAttribute('aria-label') === '작업 내용');
      const prop = Object.keys(input).find(k => k.startsWith('__reactProps$'))!;
      await act(async () => { (input as unknown as Record<string, { onChange(event: unknown): void }>)[prop].onChange({ currentTarget: { value: identity.prompt } }); }); await flushReact();
    };
    const submit = async () => {
      const form = findTestElement(container, e => e.tagName === 'FORM' && e.getAttribute('class') === 'work-item-detail');
      await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
      await settle();
    };
    try {
      await act(async () => { root.render(<OrchestrationPanel mobile={false} />); });
      await settle();
      await prompt(); f.nextResponse('POST', scenario === 'renewal' ? 'hold' : 'invalid'); await submit();
      if (scenario === 'renewal') {
        await f.waitHeld(); f.useToken('synthetic-A2'); await act(async () => { await auth.apiFetch(corePath); f.held[0].release(); });
        await settle();
      }
      assert.equal(f.creations, 1); assert.match(container.textContent, /접수.*미확인|전송 결과.*확인/);
      if (scenario === 'renewal') { await click('새로고침'); await settle(); }
      await prompt(); await submit();
      assert.equal(f.creations, 1, 'the same rendered submission must replay the durable request, not create a second job');
      assert.equal(f.requests.filter(r => r.method === 'POST')[0].key, f.requests.filter(r => r.method === 'POST')[1].key);
      assert.ok(findTestElements(container, e => e.tagName === 'BUTTON').length);
    } finally { try { await act(async () => root.unmount()); } finally { await f.close(); } }
  });
});
