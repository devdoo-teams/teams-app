import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { GenUiActionStore } from '../src/server/genui-action-store.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-genui-action-hardening-'));
const timestamp = (offsetMs = 60_000) => new Date(Date.now() + offsetMs).toISOString();
const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

function currentGrant(overrides: Record<string, unknown> = {}) {
  return {
    action: 'approve',
    entityId: 'task-hardening-1',
    correlationId: 'correlation-hardening-1',
    conversationId: 'conversation-hardening-1',
    requesterId: 'requester-hardening-1',
    tenantId: 'tenant-hardening-1',
    expiresAt: timestamp(),
    tokenHash: digest('hardening-token-1'),
    ...overrides,
  };
}

async function writeJson(filePath: string, value: unknown): Promise<string> {
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  await fs.writeFile(filePath, contents, 'utf8');
  return contents;
}

async function rejectsWithoutMutation(fileName: string, value: unknown, reason: RegExp): Promise<void> {
  const filePath = path.join(directory, fileName);
  const before = await writeJson(filePath, value);
  await assert.rejects(() => new GenUiActionStore(filePath).initialize(), reason);
  assert.equal(await fs.readFile(filePath, 'utf8'), before, `${fileName} must not be rewritten`);
}

try {
  await rejectsWithoutMutation('bad-hash.json', [currentGrant({ tokenHash: 'a'.repeat(64).toUpperCase() })], /tokenHash/);
  await rejectsWithoutMutation('bad-action.json', [currentGrant({ action: 'delete' })], /action/);
  await rejectsWithoutMutation('bad-scope.json', [currentGrant({ tenantId: 'x'.repeat(201) })], /scope/);
  await rejectsWithoutMutation('bad-control.json', [currentGrant({ requesterId: 'requester\u0000' })], /scope/);
  await rejectsWithoutMutation('unknown-field.json', [currentGrant({ secret: 'must-not-be-accepted' })], /unknown fields/);
  await rejectsWithoutMutation('bad-timestamp.json', [currentGrant({ expiresAt: 'not-a-date' })], /expiresAt/);
  await rejectsWithoutMutation('bad-order.json', [currentGrant({
    expiresAt: '2026-08-07T00:00:00.000Z',
    consumedAt: '2026-08-07T00:00:01.000Z',
  })], /consumedAt/);

  const duplicate = currentGrant();
  await rejectsWithoutMutation('duplicate-hash.json', [duplicate, { ...duplicate, entityId: 'task-hardening-2' }], /unique/);

  const legacyFile = path.join(directory, 'legacy-migration.json');
  const retained = currentGrant({ tokenHash: digest('retained-token') });
  const legacy = {
    action: 'approve',
    entityId: 'legacy-task',
    correlationId: 'legacy-correlation',
    conversationId: 'legacy-conversation',
    requesterId: 'legacy-requester',
    expiresAt: timestamp(),
    tokenHash: 'legacy-token-hash',
  };
  await writeJson(legacyFile, [legacy, retained]);
  const migrated = new GenUiActionStore(legacyFile);
  await migrated.initialize();
  const migratedRecords = JSON.parse(await fs.readFile(legacyFile, 'utf8')) as Array<Record<string, unknown>>;
  assert.equal(migratedRecords.length, 1);
  assert.equal(migratedRecords[0]?.tenantId, 'tenant-hardening-1');
  assert.deepEqual(await migrated.consume({
    token: 'legacy-token-hash',
    action: 'approve',
    entityId: 'legacy-task',
    correlationId: 'legacy-correlation',
    conversationId: 'legacy-conversation',
    requesterId: 'legacy-requester',
    tenantId: 'tenant-hardening-1',
  }), { ok: false, reason: 'invalid' });

  const validFile = path.join(directory, 'valid.json');
  const validStore = new GenUiActionStore(validFile, 10_000);
  await validStore.initialize();
  const token = await validStore.issue({
    action: 'feedback',
    entityId: 'task-hardening-runtime',
    correlationId: 'correlation-hardening-runtime',
    conversationId: 'conversation-hardening-runtime',
    requesterId: 'requester-hardening-runtime',
    tenantId: 'tenant-hardening-runtime',
  });
  assert.equal((await validStore.consume({
    token,
    action: 'feedback',
    entityId: 'task-hardening-runtime',
    correlationId: 'correlation-hardening-runtime',
    conversationId: 'conversation-hardening-runtime',
    requesterId: 'requester-hardening-runtime',
    tenantId: 'tenant-hardening-runtime',
  })).ok, true);

  const concurrentGrant = {
    action: 'approve' as const,
    entityId: 'task-hardening-concurrent',
    correlationId: 'correlation-hardening-concurrent',
    conversationId: 'conversation-hardening-concurrent',
    requesterId: 'requester-hardening-concurrent',
    tenantId: 'tenant-hardening-concurrent',
  };
  const concurrentToken = await validStore.issue(concurrentGrant);
  const concurrentResults = await Promise.all([
    validStore.consume({ ...concurrentGrant, token: concurrentToken }),
    validStore.consume({ ...concurrentGrant, token: concurrentToken }),
  ]);
  assert.equal(concurrentResults.filter((result) => result.ok).length, 1, 'a grant can be consumed only once under concurrent requests');
  assert.deepEqual(
    concurrentResults.filter((result) => !result.ok).map((result) => result.reason),
    ['consumed'],
    'the losing concurrent consume observes the persisted single-use state',
  );

  const rollbackFile = path.join(directory, 'rollback.json');
  const rollbackStore = new GenUiActionStore(rollbackFile);
  await rollbackStore.initialize();
  const rollbackGrant = {
    action: 'approve' as const,
    entityId: 'task-hardening-rollback',
    correlationId: 'correlation-hardening-rollback',
    conversationId: 'conversation-hardening-rollback',
    requesterId: 'requester-hardening-rollback',
    tenantId: 'tenant-hardening-rollback',
  };
  const rollbackToken = await rollbackStore.issue(rollbackGrant);
  await fs.unlink(rollbackFile);
  await fs.symlink(path.join(directory, 'symlink-target.json'), rollbackFile);
  await assert.rejects(
    () => rollbackStore.consume({ ...rollbackGrant, token: rollbackToken }),
    /symbolic link/,
    'a failed atomic write must surface instead of acknowledging the mutation',
  );
  await fs.unlink(rollbackFile);
  assert.equal(
    (await rollbackStore.consume({ ...rollbackGrant, token: rollbackToken })).ok,
    true,
    'a failed atomic write rolls the in-memory grant back for a safe retry',
  );
  await assert.rejects(() => validStore.issue({
    action: 'approve',
    entityId: '',
    correlationId: 'correlation-hardening-runtime',
    conversationId: 'conversation-hardening-runtime',
    requesterId: 'requester-hardening-runtime',
    tenantId: 'tenant-hardening-runtime',
  }), /scope/);
  assert.deepEqual(await validStore.consume({
    token: 'x'.repeat(513),
    action: 'approve',
    entityId: 'task-hardening-runtime',
    correlationId: 'correlation-hardening-runtime',
    conversationId: 'conversation-hardening-runtime',
    requesterId: 'requester-hardening-runtime',
    tenantId: 'tenant-hardening-runtime',
  }), { ok: false, reason: 'invalid' });

  console.log('PASS: persisted GenUI action grants fail closed, migrate legacy records safely, and preserve single-use scope');
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
