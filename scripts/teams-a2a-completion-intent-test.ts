import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureTeamsA2ACompletionIntent, isTeamsA2ACompletionFingerprint, teamsA2ACompletionFingerprint } from '../src/server/teams-a2a-completion-intent.js';
import { TeamsA2AOutboundConflictError, TeamsA2AOutboundStore } from '../src/server/teams-a2a-outbound-store.js';

const scope = { tenantId: 'fingerprint-tenant', requesterId: 'fingerprint-requester', conversationId: 'fingerprint-conversation' };
const parentTaskId = 'task-fingerprint-parent';
const canonical = teamsA2ACompletionFingerprint(parentTaskId, scope);
for (const keys of [
  ['tenantId', 'requesterId', 'conversationId'], ['tenantId', 'conversationId', 'requesterId'],
  ['requesterId', 'tenantId', 'conversationId'], ['requesterId', 'conversationId', 'tenantId'],
  ['conversationId', 'tenantId', 'requesterId'], ['conversationId', 'requesterId', 'tenantId'],
] as const) {
  const reordered = Object.fromEntries(keys.map(key => [key, scope[key]])) as typeof scope;
  assert.equal(teamsA2ACompletionFingerprint(parentTaskId, reordered), canonical, 'semantic identity must survive property reordering');
}
// Immutable historical v1 payload fixture: the old Bot constructed this order.
const legacySha = crypto.createHash('sha256').update(JSON.stringify({
  schemaVersion: 'teams-a2a-completion-intent.v1', parentTaskId,
  scope: { requesterId: scope.requesterId, conversationId: scope.conversationId, tenantId: scope.tenantId },
}), 'utf8').digest('hex');
assert.notEqual(legacySha, canonical);
assert.ok(isTeamsA2ACompletionFingerprint(legacySha, parentTaskId, scope));
assert.ok(isTeamsA2ACompletionFingerprint(canonical, parentTaskId, scope));
assert.equal(isTeamsA2ACompletionFingerprint('a'.repeat(64), parentTaskId, scope), false);
assert.equal(isTeamsA2ACompletionFingerprint(legacySha, 'task-another-parent', scope), false);
for (const key of ['tenantId', 'requesterId', 'conversationId'] as const) {
  const foreign = { ...scope, [key]: `another-${key}` };
  assert.notEqual(teamsA2ACompletionFingerprint(parentTaskId, foreign), canonical);
  assert.equal(isTeamsA2ACompletionFingerprint(legacySha, parentTaskId, foreign), false, 'legacy compatibility cannot cross scope');
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-completion-fingerprint-'));
const filePath = path.join(root, 'outbound.json');
try {
  const store = new TeamsA2AOutboundStore(filePath);
  await store.initialize();
  const original = await store.createOrGetCompletionIntent({ parentTaskId, scope, payloadSha256: legacySha });
  const lease = await store.claim(original.intent.id, scope, 'fixture-accepted', 30_000);
  assert.ok(lease);
  const accepted = await store.recordConnectorAccepted(lease.id, scope, lease.leaseToken!, 'already-delivered');
  const bytesBefore = await fs.readFile(filePath, 'utf8');
  const reopened = new TeamsA2AOutboundStore(filePath);
  await reopened.initialize();
  const replay = await ensureTeamsA2ACompletionIntent(reopened, parentTaskId, scope);
  assert.equal(replay.created, false);
  assert.deepEqual(replay.intent, accepted, 'existing accepted SHA/activity/attempts/scope are immutable');
  assert.equal(await reopened.claim(accepted.id, scope, 'must-not-resend', 30_000), undefined);
  assert.equal(await fs.readFile(filePath, 'utf8'), bytesBefore);
  assert.equal(reopened.getCompletionIntent(parentTaskId, { ...scope, requesterId: 'another-user' }), undefined);
  assert.throws(() => reopened.getCompletionIntent('../unsafe-parent', scope));

  const invalid = await reopened.createOrGetCompletionIntent({ parentTaskId: 'task-invalid-binding', scope, payloadSha256: 'a'.repeat(64) });
  const invalidBytes = await fs.readFile(filePath, 'utf8');
  await assert.rejects(ensureTeamsA2ACompletionIntent(reopened, 'task-invalid-binding', scope), TeamsA2AOutboundConflictError);
  assert.deepEqual(reopened.getIntent(invalid.intent.id, scope), invalid.intent);
  assert.equal(await fs.readFile(filePath, 'utf8'), invalidBytes);
  const fresh = await ensureTeamsA2ACompletionIntent(reopened, 'task-new-canonical', scope);
  assert.equal(fresh.created, true);
  assert.equal(fresh.intent.payloadSha256, teamsA2ACompletionFingerprint('task-new-canonical', scope));
  const duplicate = await ensureTeamsA2ACompletionIntent(reopened, 'task-new-canonical', {
    conversationId: scope.conversationId, requesterId: scope.requesterId, tenantId: scope.tenantId,
  });
  assert.equal(duplicate.created, false);
  assert.deepEqual(duplicate.intent, fresh.intent);

  // A corrupted historical row can retain a valid key/hash while naming another
  // parent. Reuse must preserve the same identity check as createOrGet.
  const corrupted = JSON.parse(await fs.readFile(filePath, 'utf8'));
  corrupted.intents[fresh.intent.id].parentTaskId = 'task-foreign-parent';
  await fs.writeFile(filePath, JSON.stringify(corrupted));
  const corruptStore = new TeamsA2AOutboundStore(filePath);
  await corruptStore.initialize();
  const corruptBytes = await fs.readFile(filePath, 'utf8');
  await assert.rejects(
    ensureTeamsA2ACompletionIntent(corruptStore, 'task-new-canonical', scope),
    TeamsA2AOutboundConflictError,
    'lookup must reject a key-bound receipt whose stored parent differs',
  );
  assert.equal(await fs.readFile(filePath, 'utf8'), corruptBytes, 'identity conflict cannot rewrite a receipt');
  console.log('teams-a2a-completion-intent-test: PASS');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
