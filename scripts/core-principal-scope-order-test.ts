import assert from 'node:assert/strict';
import test from 'node:test';
import * as auth from '../src/client/auth.js';
import { createCoreOrchestrationClient } from '../src/client/core-orchestration-client.js';
import { createCoreMutationAuthFixture } from './fixtures/core-mutation-auth-fixture.js';

const path = '/api/core-orchestration/jobs';
const input = { prompt: 'synthetic initial scope ordering', provider: 'codex' as const,
  mode: 'read-only' as const, notify: false, idempotencyKey: 'synthetic-initial-order' };
const capture = <T>(promise: Promise<T>) => promise.then(result => ({ result, error: undefined }), error => ({ result: undefined, error }));

// Conversation switches here are fixture-only. Production fixes conversation
// scope per principal; these tests do not reproduce cross-account data leakage.
for (const delay of ['hold', 'body'] as const) for (const method of ['GET', 'POST'] as const) {
  test(`initial unknown scope cannot roll back to an older ${method} ${delay} response`, async () => {
    const f = await createCoreMutationAuthFixture();
    try {
      const client = createCoreOrchestrationClient(); assert.equal(auth.getApiPrincipalScopeKey(), undefined);
      f.nextResponse(method, delay);
      const prior = capture(method === 'GET' ? client.listJobs() : client.submitJob(input)); await f.waitHeld();
      f.setConversation('synthetic-newer-conversation'); await client.listJobs();
      const newerScope = auth.getApiPrincipalScopeKey(); assert.ok(newerScope);
      f.held[0].release(); const old = await prior;
      assert.equal(old.result, undefined); assert.equal(old.error?.name, method === 'GET' ? 'ApiAuthError' : 'ApiMutationUncertainError');
      assert.equal(auth.getApiPrincipalScopeKey(), newerScope);
      assert.equal(f.creations, method === 'POST' ? 1 : 0, 'no automatic retransmission');
      console.log(JSON.stringify({ probe: 'initial_scope_order', delay, method, oldBodyReturned: false,
        scopeRolledBack: false, actualCoreService: true, conversationSwitch: 'fixture only; production scope fixed per principal', externalCalls: 0 }));
    } finally { await f.close(); }
  });
}

for (const delay of ['hold', 'body'] as const) test(`initial parallel reads of the same verified scope both succeed with ${delay}`, async () => {
  const f = await createCoreMutationAuthFixture(); let invalidations = 0;
  const unsubscribe = auth.subscribeApiAuthentication(() => { invalidations++; });
  try {
    const client = createCoreOrchestrationClient(); f.nextResponse('GET', delay);
    const prior = capture(client.listJobs()); await f.waitHeld();
    const current = await client.listJobs(); const owner = auth.getApiPrincipalScopeKey(); assert.ok(owner);
    f.held[0].release(); const old = await prior;
    assert.equal(old.error, undefined); assert.deepEqual(old.result, current);
    assert.equal(auth.getApiPrincipalScopeKey(), owner); assert.equal(invalidations, 0);
  } finally { unsubscribe(); await f.close(); }
});

for (const delay of ['hold', 'body'] as const) for (const method of ['GET', 'POST'] as const) {
  for (const token of ['synthetic-A2', 'synthetic-B', 'synthetic-other-tenant']) {
    test(`initial ${method} ${delay} response preserves credential isolation after ${token}`, async () => {
      const f = await createCoreMutationAuthFixture();
      try {
        const client = createCoreOrchestrationClient(); f.nextResponse(method, delay);
        const prior = capture(method === 'GET' ? client.listJobs() : client.submitJob(input)); await f.waitHeld();
        f.useToken(token); await client.listJobs(); const owner = auth.getApiPrincipalScopeKey(); assert.ok(owner);
        f.held[0].release(); const old = await prior;
        if (method === 'POST' && token === 'synthetic-A2') {
          assert.equal(old.error, undefined, 'two server proofs still confirm a same-owner accepted mutation');
          assert.equal(old.result?.job.idempotencyKey, input.idempotencyKey);
        } else {
          assert.equal(old.result, undefined); assert.equal(old.error?.name, method === 'GET' ? 'ApiAuthError' : 'ApiMutationUncertainError');
        }
        assert.equal(auth.getApiPrincipalScopeKey(), owner);
        assert.equal(f.creations, method === 'POST' ? 1 : 0);
      } finally { await f.close(); }
    });
  }
}

for (const delay of ['hold', 'body'] as const) test(`each fetch in one logical operation has independent scope order (${delay})`, async () => {
  const f = await createCoreMutationAuthFixture();
  try {
    await auth.runApiOperation(async request => {
      f.nextResponse('GET', delay);
      const prior = capture(request(path).then(response => auth.readApiResponseJson(response))); await f.waitHeld();
      f.setConversation('synthetic-newer-conversation'); await auth.readApiResponseJson(await request(path));
      const owner = auth.getApiPrincipalScopeKey(); assert.ok(owner);
      f.held[0].release(); const old = await prior;
      assert.equal(old.result, undefined); assert.equal(old.error?.name, 'ApiAuthError');
      assert.equal(auth.getApiPrincipalScopeKey(), owner);
    });
  } finally { await f.close(); }
});

for (const delay of ['hold', 'body'] as const) test(`a delayed headerless initial ${delay} cannot return an uncorrelated body after scope proof`, async () => {
  const f = await createCoreMutationAuthFixture();
  try {
    const client = createCoreOrchestrationClient(); f.stripScope(); f.nextResponse('GET', delay);
    const prior = capture(client.listJobs()); await f.waitHeld();
    f.stripScope(false); f.setConversation('synthetic-newer-conversation'); await client.listJobs();
    const owner = auth.getApiPrincipalScopeKey(); assert.ok(owner);
    f.held[0].release(); const old = await prior;
    assert.equal(old.result, undefined); assert.equal(old.error?.name, 'ApiAuthError');
    assert.equal(auth.getApiPrincipalScopeKey(), owner);
  } finally { await f.close(); }
});
