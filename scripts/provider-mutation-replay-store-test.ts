import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ProviderMutationReplayConflictError,
  ProviderMutationReplayInFlightError,
  ProviderMutationReplayStore,
} from '../src/server/provider-mutation-replay-store.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-provider-replay-'));
const storePath = path.join(root, 'data', 'replay.json');
const scope = { tenantId: 'tenant-1', requesterId: 'requester-1', provider: 'atlassian' } as const;
const fingerprint = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

const store = new ProviderMutationReplayStore(storePath);
await store.initialize();
let calls = 0;
const first = await store.execute({ scope, mutationKey: 'jira-create-1', fingerprint: fingerprint('payload-1') }, async () => {
  calls += 1;
  return { issue: 'MP-1' };
});
assert.equal(first.replayed, false);
assert.deepEqual(first.result, { issue: 'MP-1' });
assert.equal(calls, 1);

const replay = await store.execute({ scope, mutationKey: 'jira-create-1', fingerprint: fingerprint('payload-1') }, async () => {
  calls += 1;
  return { issue: 'MP-should-not-repeat' };
});
assert.equal(replay.replayed, true);
assert.deepEqual(replay.result, { issue: 'MP-1' });
assert.equal(calls, 1, 'same-key retry must not repeat the provider mutation');

await assert.rejects(
  () => store.execute({ scope, mutationKey: 'jira-create-1', fingerprint: fingerprint('different-payload') }, async () => ({ issue: 'nope' })),
  ProviderMutationReplayConflictError,
  'same key with a different fingerprint fails closed',
);

let concurrentCalls = 0;
const concurrentInput = { scope, mutationKey: 'jira-create-concurrent', fingerprint: fingerprint('payload-concurrent') } as const;
const [concurrentA, concurrentB] = await Promise.all([
  store.execute(concurrentInput, async () => {
    concurrentCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { issue: 'MP-2' };
  }),
  store.execute(concurrentInput, async () => {
    concurrentCalls += 1;
    return { issue: 'MP-should-not-repeat' };
  }),
]);
assert.equal(concurrentCalls, 1, 'same-process concurrent duplicate must execute once');
assert.deepEqual(concurrentA.result, concurrentB.result);

let failures = 0;
await assert.rejects(() => store.execute({ scope, mutationKey: 'jira-failure', fingerprint: fingerprint('failure') }, async () => {
  failures += 1;
  throw new Error('provider failed after no durable result');
}));
const retried = await store.execute({ scope, mutationKey: 'jira-failure', fingerprint: fingerprint('failure') }, async () => {
  failures += 1;
  return { issue: 'MP-3' };
});
assert.equal(retried.replayed, false, 'failed mutation reservation is retryable');
assert.equal(failures, 2);

const reloaded = new ProviderMutationReplayStore(storePath);
await reloaded.initialize();
const afterRestart = await reloaded.replay({ scope, mutationKey: 'jira-create-1', fingerprint: fingerprint('payload-1') });
assert.equal(afterRestart?.replayed, true, 'completed result survives a store reload');
assert.deepEqual(afterRestart?.result, { issue: 'MP-1' });

await assert.rejects(
  () => reloaded.replay({ ...concurrentInput, fingerprint: fingerprint('other') }),
  ProviderMutationReplayConflictError,
);

const isolated = await reloaded.replay({ scope: { ...scope, requesterId: 'requester-2' }, mutationKey: 'jira-create-1', fingerprint: fingerprint('payload-1') });
assert.equal(isolated, undefined, 'replay records are scoped to the requester');

const pendingStore = new ProviderMutationReplayStore(path.join(root, 'pending', 'replay.json'));
await pendingStore.initialize();
let release!: () => void;
const pending = new Promise<void>((resolve) => { release = resolve; });
const pendingPromise = pendingStore.execute({ scope, mutationKey: 'jira-pending', fingerprint: fingerprint('pending') }, async () => {
  await pending;
  return { issue: 'MP-4' };
});
await assert.rejects(
  () => pendingStore.replay({ scope, mutationKey: 'jira-pending', fingerprint: fingerprint('pending') }),
  ProviderMutationReplayInFlightError,
);
release();
await pendingPromise;

console.log('provider-mutation-replay-store-test: PASS');
