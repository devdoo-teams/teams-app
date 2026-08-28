import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const modulePath = '../src/server/teams-a2a-outbound-store.js';
const loaded = await import(modulePath).catch(() => undefined);
assert.ok(loaded, 'Teams A2A durable outbound store is not implemented');

const { TeamsA2AOutboundStore } = loaded as any;
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-outbound-store-'));
const filePath = path.join(root, 'outbound.json');
const scope = {
  tenantId: 'outbound-tenant',
  requesterId: 'outbound-requester',
  conversationId: 'outbound-conversation',
};
const payloadSha256 = crypto.createHash('sha256').update('completion-card', 'utf8').digest('hex');

try {
  const store = new TeamsA2AOutboundStore(filePath);
  await store.initialize();

  const [first, duplicate] = await Promise.all([
    store.createOrGetCompletionIntent({ parentTaskId: 'task-parent-accepted', scope, payloadSha256 }),
    store.createOrGetCompletionIntent({ parentTaskId: 'task-parent-accepted', scope, payloadSha256 }),
  ]);
  assert.equal(first.intent.id, duplicate.intent.id);
  assert.equal(Number(first.created) + Number(duplicate.created), 1);

  const [firstClaim, duplicateClaim] = await Promise.all([
    store.claim(first.intent.id, scope, 'worker-a', 30_000),
    store.claim(first.intent.id, scope, 'worker-b', 30_000),
  ]);
  const claims = [firstClaim, duplicateClaim].filter(Boolean);
  assert.equal(claims.length, 1, 'one durable completion intent must have one active dispatcher');
  const leaseToken = claims[0].leaseToken;
  const accepted = await store.recordConnectorAccepted(first.intent.id, scope, leaseToken, 'activity-server-id');
  assert.equal(accepted.status, 'connector-accepted');
  assert.equal(accepted.attempts, 1);
  assert.equal(accepted.activityId, 'activity-server-id');
  assert.equal(await store.claim(first.intent.id, scope, 'worker-c', 30_000), undefined);

  const ambiguousIntent = await store.createOrGetCompletionIntent({
    parentTaskId: 'task-parent-ambiguous',
    scope,
    payloadSha256: crypto.createHash('sha256').update('ambiguous-card', 'utf8').digest('hex'),
  });
  const ambiguousClaim = await store.claim(ambiguousIntent.intent.id, scope, 'worker-d', 30_000);
  assert.ok(ambiguousClaim);
  const ambiguous = await store.recordAmbiguous(
    ambiguousIntent.intent.id,
    scope,
    ambiguousClaim.leaseToken,
    'transport outcome unknown',
  );
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.attempts, 1);
  assert.equal(ambiguous.activityId, undefined);

  const rejectedIntent = await store.createOrGetCompletionIntent({
    parentTaskId: 'task-parent-rejected',
    scope,
    payloadSha256: crypto.createHash('sha256').update('rejected-card', 'utf8').digest('hex'),
  });
  const rejectedClaim = await store.claim(rejectedIntent.intent.id, scope, 'worker-e', 30_000);
  assert.ok(rejectedClaim);
  const rejected = await store.recordConnectorRejected(
    rejectedIntent.intent.id,
    scope,
    rejectedClaim.leaseToken,
    'connector returned an explicit HTTP rejection',
  );
  assert.equal(rejected.status, 'connector-rejected');
  assert.equal(rejected.attempts, 1);

  const reopened = new TeamsA2AOutboundStore(filePath);
  await reopened.initialize();
  assert.equal(reopened.getIntent(first.intent.id, scope)?.status, 'connector-accepted');
  assert.equal(reopened.getIntent(ambiguous.id, scope)?.status, 'ambiguous');
  assert.equal(reopened.getIntent(rejected.id, scope)?.status, 'connector-rejected');

  let now = Date.parse('2026-08-28T00:00:00.000Z');
  const leasePath = path.join(root, 'expired-lease.json');
  const leaseStore = new TeamsA2AOutboundStore(leasePath, () => now);
  await leaseStore.initialize();
  const expiring = await leaseStore.createOrGetCompletionIntent({
    parentTaskId: 'task-parent-expired-lease',
    scope,
    payloadSha256: crypto.createHash('sha256').update('expired-lease-card', 'utf8').digest('hex'),
  });
  const initialLease = await leaseStore.claim(expiring.intent.id, scope, 'worker-before-crash', 1_000);
  assert.ok(initialLease);
  now += 1_001;
  assert.equal(
    await leaseStore.claim(expiring.intent.id, scope, 'worker-after-crash', 1_000),
    undefined,
    'an expired dispatching lease is delivery-ambiguous and must never be resent',
  );
  const expired = leaseStore.getIntent(expiring.intent.id, scope);
  assert.equal(expired?.status, 'ambiguous');
  assert.equal(expired?.attempts, 1);
  assert.equal(expired?.leaseToken, undefined);
  assert.equal(expired?.leaseExpiresAt, undefined);

  const queued = await leaseStore.createOrGetCompletionIntent({
    parentTaskId: 'task-parent-startup-recovery',
    scope,
    payloadSha256: crypto.createHash('sha256').update('startup-recovery-card', 'utf8').digest('hex'),
  });
  assert.deepEqual(
    leaseStore.listQueued(10).map((intent: { id: string }) => intent.id),
    [queued.intent.id],
    'startup recovery must be able to enumerate only durable queued completion intents',
  );

  console.log('teams-a2a-outbound-store-test: PASS');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
