import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  AgentJobStore,
  MAX_AGENT_ERROR_LENGTH,
  MAX_AGENT_JOB_ID_LENGTH,
  MAX_AGENT_PROGRESS_ENTRIES,
  MAX_AGENT_PROGRESS_MESSAGE_LENGTH,
  MAX_AGENT_PROMPT_LENGTH,
  type AgentJob,
  type AgentJobScope,
} from '../src/server/agent-job-store.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-agent-job-store-hardening-'));
const storeDirectory = path.join(root, 'stores');
await fs.mkdir(storeDirectory, { mode: 0o700 });

const scope: AgentJobScope = {
  requesterId: 'owner-user',
  conversationId: 'owner-conversation',
  tenantId: 'owner-tenant',
};

function currentJob(overrides: Partial<AgentJob> = {}): AgentJob {
  return {
    id: 'task-current-1',
    prompt: '현재 형식 작업',
    mode: 'read-only',
    status: 'completed',
    conversationId: scope.conversationId,
    requesterId: scope.requesterId,
    tenantId: scope.tenantId,
    progress: [],
    createdAt: '2026-08-07T00:00:00.000Z',
    ...overrides,
  };
}

async function assertRejectedUnchanged(label: string, records: unknown): Promise<void> {
  const filePath = path.join(storeDirectory, `${label}.json`);
  const raw = JSON.stringify(records);
  await fs.writeFile(filePath, raw, 'utf8');
  const before = await fs.readFile(filePath);
  const beforeStat = await fs.stat(filePath);

  await assert.rejects(
    () => new AgentJobStore(filePath).initialize(),
    /Invalid agent job store format/,
    `${label} is rejected as invalid persisted data`,
  );

  assert.deepEqual(await fs.readFile(filePath), before, `${label} bytes remain unchanged`);
  assert.equal((await fs.stat(filePath)).mtimeNs, beforeStat.mtimeNs, `${label} metadata remains unchanged`);
}

try {
  await assertRejectedUnchanged('non-array-root', { jobs: [currentJob()] });
  await assertRejectedUnchanged('non-object-record', [null]);
  await assertRejectedUnchanged('missing-id', [{ ...currentJob(), id: undefined }]);
  await assertRejectedUnchanged('blank-prompt', [currentJob({ prompt: '   ' })]);
  await assertRejectedUnchanged('oversized-current-prompt', [currentJob({ prompt: 'x'.repeat(MAX_AGENT_PROMPT_LENGTH + 1) })]);
  await assertRejectedUnchanged('control-character-id', [currentJob({ id: `task\u0000${'x'.repeat(4)}` })]);
  await assertRejectedUnchanged('oversized-current-id', [currentJob({ id: 'x'.repeat(MAX_AGENT_JOB_ID_LENGTH + 1) })]);
  await assertRejectedUnchanged('invalid-mode', [currentJob({ mode: 'admin' as AgentJob['mode'] })]);
  await assertRejectedUnchanged('invalid-status', [currentJob({ status: 'pending' as AgentJob['status'] })]);
  await assertRejectedUnchanged('blank-tenant', [currentJob({ tenantId: '   ' })]);
  await assertRejectedUnchanged('non-string-tenant', [currentJob({ tenantId: null as unknown as string })]);
  await assertRejectedUnchanged('invalid-created-at', [currentJob({ createdAt: 'not-a-timestamp' })]);
  await assertRejectedUnchanged('infinite-created-at', [currentJob({ createdAt: 'Infinity' })]);
  await assertRejectedUnchanged('non-array-progress', [currentJob({ progress: 'not-an-array' as unknown as string[] })]);
  await assertRejectedUnchanged('empty-progress-message', [currentJob({ progress: ['   '] })]);
  await assertRejectedUnchanged(
    'oversized-progress-array',
    [currentJob({ progress: Array.from({ length: MAX_AGENT_PROGRESS_ENTRIES + 1 }, () => 'event') })],
  );
  await assertRejectedUnchanged(
    'oversized-progress-message',
    [currentJob({ progress: ['x'.repeat(MAX_AGENT_PROGRESS_MESSAGE_LENGTH + 1)] })],
  );
  await assertRejectedUnchanged(
    'oversized-error',
    [currentJob({ error: 'x'.repeat(MAX_AGENT_ERROR_LENGTH + 1) })],
  );
  await assertRejectedUnchanged(
    'duplicate-ids',
    [currentJob(), currentJob({ id: 'task-current-1', prompt: 'duplicate' })],
  );
  await assertRejectedUnchanged(
    'self-parent',
    [currentJob({ parentJobId: 'task-current-1' })],
  );
  await assertRejectedUnchanged(
    'cross-scope-parent',
    [
      currentJob({ id: 'task-child', parentJobId: 'task-parent', tenantId: 'other-tenant' }),
      currentJob({ id: 'task-parent' }),
    ],
  );

  const currentPath = path.join(storeDirectory, 'current-valid.json');
  await fs.writeFile(currentPath, JSON.stringify([currentJob()]), 'utf8');
  const currentStore = new AgentJobStore(currentPath);
  await currentStore.initialize();
  assert.equal(currentStore.get('task-current-1', scope)?.tenantId, scope.tenantId, 'valid current job is readable in its scope');
  assert.equal(
    currentStore.get('task-current-1', { ...scope, tenantId: 'other-tenant' }),
    undefined,
    'tenant mismatch remains inaccessible',
  );
  assert.equal(
    currentStore.get('task-current-1', { ...scope, requesterId: 'other-user' }),
    undefined,
    'requester mismatch remains inaccessible',
  );

  const legacyPath = path.join(storeDirectory, 'legacy.json');
  const legacyRecord = {
    id: 'task-legacy-1',
    prompt: `  legacy\u0000 prompt ${'x'.repeat(MAX_AGENT_PROMPT_LENGTH + 50)}\u001f  `,
    mode: 'read-only',
    status: 'completed',
    conversationId: 'legacy-conversation',
    requesterId: 'legacy-user',
    progress: [
      '   ',
      ` legacy progress ${'x'.repeat(MAX_AGENT_PROGRESS_MESSAGE_LENGTH + 50)} `,
    ],
    result: 'legacy result',
    error: 'legacy error',
    createdAt: '2026-08-07T01:02:03Z',
    finishedAt: '2026-08-07T01:02:04Z',
  };
  const legacyRaw = JSON.stringify([legacyRecord]);
  await fs.writeFile(legacyPath, legacyRaw, 'utf8');

  const legacyStore = new AgentJobStore(legacyPath);
  await legacyStore.initialize();
  const migrated = legacyStore.getLocalOnly('task-legacy-1');
  assert.ok(migrated, 'valid legacy job remains available to the local recovery reader');
  assert.equal(migrated.tenantId, undefined, 'legacy migration never invents tenant ownership');
  assert.ok(migrated.prompt.length <= MAX_AGENT_PROMPT_LENGTH, 'legacy prompt is bounded');
  assert.ok(migrated.progress.length === 1, 'blank legacy progress entries are removed');
  assert.ok(migrated.progress[0].length <= MAX_AGENT_PROGRESS_MESSAGE_LENGTH, 'legacy progress is bounded');
  assert.equal(migrated.createdAt, '2026-08-07T01:02:03.000Z', 'legacy timestamp is normalized to ISO');
  assert.equal(migrated.finishedAt, '2026-08-07T01:02:04.000Z', 'legacy optional timestamp is normalized to ISO');
  assert.equal(
    legacyStore.list({ requesterId: 'legacy-user', conversationId: 'legacy-conversation', tenantId: 'any-tenant' }).length,
    0,
    'legacy job remains inaccessible through tenant-scoped ACL reads',
  );

  const migratedRaw = await fs.readFile(legacyPath, 'utf8');
  assert.notEqual(migratedRaw, legacyRaw, 'legacy normalization is persisted');
  const persistedLegacy = JSON.parse(migratedRaw) as Array<Record<string, unknown>>;
  assert.equal(Object.prototype.hasOwnProperty.call(persistedLegacy[0], 'tenantId'), false, 'persisted migration has no guessed tenantId');
  assert.equal(persistedLegacy[0].createdAt, '2026-08-07T01:02:03.000Z');
  assert.equal(persistedLegacy[0].finishedAt, '2026-08-07T01:02:04.000Z');

  console.log('PASS: AgentJobStore rejects malformed current records unchanged, preserves ACL scope, and atomically migrates legacy jobs without tenant invention');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
