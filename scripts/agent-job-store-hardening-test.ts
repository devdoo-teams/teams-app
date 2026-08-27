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

function deferredSignal(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}

async function waitForSignal(signal: Promise<void>, label: string): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      signal,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} was not observed`)), 500);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function currentJob(overrides: Partial<AgentJob> = {}): AgentJob {
  return {
    id: 'task-current-1',
    prompt: '현재 형식 작업',
    provider: 'codex',
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
  await assertRejectedUnchanged('invalid-provider', [currentJob({ provider: 'unknown' as AgentJob['provider'] })]);
  await assertRejectedUnchanged('invalid-status', [currentJob({ status: 'pending' as AgentJob['status'] })]);
  await assertRejectedUnchanged('completed-without-result', [currentJob()]);
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
    'non-array-changed-paths',
    [currentJob({ changedPaths: 'src/owned.ts' as unknown as string[] })],
  );
  await assertRejectedUnchanged(
    'empty-changed-path',
    [currentJob({ changedPaths: [''] })],
  );
  await assertRejectedUnchanged(
    'oversized-changed-paths',
    [currentJob({ changedPaths: Array.from({ length: 257 }, (_, index) => `src/file-${index}.ts`) })],
  );
  await assertRejectedUnchanged(
    'oversized-changed-path',
    [currentJob({ changedPaths: [`src/${'x'.repeat(509)}`] })],
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
  await fs.writeFile(currentPath, JSON.stringify([currentJob({
    changedPaths: ['src/owned.ts'],
    result: '첫 번째 결과 줄\n두 번째 결과 줄',
    progress: ['첫 번째 진행 줄\n두 번째 진행 줄'],
  })]), 'utf8');
  const currentStore = new AgentJobStore(currentPath);
  await currentStore.initialize();
  const scopedSnapshot = currentStore.get('task-current-1', scope);
  assert.ok(scopedSnapshot, 'valid current job is readable in its scope');
  assert.equal(scopedSnapshot.tenantId, scope.tenantId, 'valid current job is readable in its scope');
  assert.match(scopedSnapshot.result ?? '', /첫 번째 결과 줄\n두 번째 결과 줄/, 'multiline Codex results remain valid persisted text');
  assert.deepEqual(
    scopedSnapshot.changedPaths,
    ['src/owned.ts'],
    'valid changed path ownership is preserved by the declared job schema',
  );
  // Reads must be immutable snapshots. A Teams/MCP caller must not be able to
  // mutate the server-owned status or persisted arrays through a returned job.
  scopedSnapshot.status = 'failed';
  scopedSnapshot.progress.push('forged progress');
  scopedSnapshot.changedPaths?.push('forged.ts');
  const afterScopedMutation = currentStore.get('task-current-1', scope);
  assert.equal(afterScopedMutation?.status, 'completed', 'scoped reads do not expose mutable job state');
  assert.deepEqual(afterScopedMutation?.progress, ['첫 번째 진행 줄\n두 번째 진행 줄'], 'progress is cloned on scoped reads');
  assert.deepEqual(afterScopedMutation?.changedPaths, ['src/owned.ts'], 'changed paths are cloned on scoped reads');
  const listedSnapshot = currentStore.list(scope)[0];
  listedSnapshot.status = 'failed';
  assert.equal(currentStore.get('task-current-1', scope)?.status, 'completed', 'list returns immutable job snapshots');
  const localSnapshot = currentStore.getLocalOnly('task-current-1');
  assert.ok(localSnapshot, 'local debug reader can see the valid job');
  localSnapshot.progress.push('forged local progress');
  assert.deepEqual(currentStore.getLocalOnly('task-current-1')?.progress, ['첫 번째 진행 줄\n두 번째 진행 줄'], 'local reads are also cloned');
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
  await assert.rejects(
    () => currentStore.update('task-current-1', scope, { status: 'completed', result: undefined }),
    /completed jobs must contain a result/i,
    'an in-memory mutation cannot create a completed job without a result',
  );
  await assert.rejects(
    () => currentStore.update('task-current-1', scope, { provider: 'copilot' }),
    /provider identity is immutable/i,
    'provider identity cannot be changed after job creation',
  );

  const durableVisibilityPath = path.join(storeDirectory, 'durable-visibility.json');
  const createWriteStarted = deferredSignal();
  const releaseCreateWrite = deferredSignal();
  const secondCreateWriteStarted = deferredSignal();
  const releaseSecondCreateWrite = deferredSignal();
  const updateWriteStarted = deferredSignal();
  const releaseUpdateWrite = deferredSignal();
  const failedWriteStarted = deferredSignal();
  const releaseFailedWrite = deferredSignal();
  const writeGates = [
    { started: createWriteStarted, release: releaseCreateWrite, fail: false },
    { started: secondCreateWriteStarted, release: releaseSecondCreateWrite, fail: false },
    { started: updateWriteStarted, release: releaseUpdateWrite, fail: false },
    { started: failedWriteStarted, release: releaseFailedWrite, fail: true },
  ];
  let writeAttempt = 0;
  const durableVisibilityStore = new AgentJobStore(durableVisibilityPath, {
    writeAtomicJson: async (targetPath: string, value: unknown) => {
      const gate = writeGates[writeAttempt++];
      assert.ok(gate, 'unexpected durable visibility write attempt');
      gate.started.resolve();
      await gate.release.promise;
      if (gate.fail) throw new Error('synthetic deferred atomic write failure');
      await fs.writeFile(targetPath, `${JSON.stringify(value)}\n`, 'utf8');
    },
  });
  const createPending = durableVisibilityStore.create({
    prompt: 'durable visibility create',
    provider: 'codex',
    mode: 'read-only',
    scope,
  });
  const secondCreatePending = durableVisibilityStore.create({
    prompt: 'serialized durable visibility create',
    provider: 'codex',
    mode: 'read-only',
    scope,
  });
  await waitForSignal(createWriteStarted.promise, 'deferred create write');
  assert.equal(writeAttempt, 1, 'a second mutation must wait behind the first atomic write');
  assert.deepEqual(
    durableVisibilityStore.listLocalOnly(),
    [],
    'a created job must not be visible before its atomic write commits',
  );
  releaseCreateWrite.resolve();
  const durablyCreated = await createPending;
  assert.equal(durableVisibilityStore.get(durablyCreated.id, scope)?.status, 'queued');
  await waitForSignal(secondCreateWriteStarted.promise, 'serialized second create write');
  assert.deepEqual(
    durableVisibilityStore.listLocalOnly().map((job) => job.id),
    [durablyCreated.id],
    'a queued mutation must stage behind the last durably published snapshot',
  );
  releaseSecondCreateWrite.resolve();
  const secondDurablyCreated = await secondCreatePending;
  assert.deepEqual(
    new Set(durableVisibilityStore.listLocalOnly().map((job) => job.id)),
    new Set([durablyCreated.id, secondDurablyCreated.id]),
  );

  const updatePending = durableVisibilityStore.update(durablyCreated.id, scope, {
    status: 'completed',
    result: 'durably completed',
    finishedAt: new Date().toISOString(),
  });
  await waitForSignal(updateWriteStarted.promise, 'deferred terminal write');
  assert.equal(
    durableVisibilityStore.get(durablyCreated.id, scope)?.status,
    'queued',
    'terminal state must not be visible before its atomic write commits',
  );
  releaseUpdateWrite.resolve();
  assert.equal((await updatePending)?.status, 'completed');
  assert.equal(durableVisibilityStore.get(durablyCreated.id, scope)?.status, 'completed');

  const failedUpdatePending = durableVisibilityStore.update(durablyCreated.id, scope, {
    status: 'failed',
    error: 'must remain invisible',
    finishedAt: new Date().toISOString(),
  });
  await waitForSignal(failedWriteStarted.promise, 'deferred failed write');
  assert.equal(
    durableVisibilityStore.get(durablyCreated.id, scope)?.status,
    'completed',
    'a failed staged update must remain invisible while persistence is pending',
  );
  releaseFailedWrite.resolve();
  await assert.rejects(() => failedUpdatePending, /synthetic deferred atomic write failure/);
  assert.equal(
    durableVisibilityStore.get(durablyCreated.id, scope)?.status,
    'completed',
    'a failed atomic write must preserve the prior durable in-memory snapshot',
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

  const legacyStore = new AgentJobStore(legacyPath, { legacyProvider: 'copilot' });
  await legacyStore.initialize();
  const migrated = legacyStore.getLocalOnly('task-legacy-1');
  assert.ok(migrated, 'valid legacy job remains available to the local recovery reader');
  assert.equal(migrated.provider, 'copilot', 'legacy migration uses only the explicitly configured provider');
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

  const persistenceFailureParent = path.join(storeDirectory, 'not-a-directory');
  await fs.writeFile(persistenceFailureParent, 'blocker', 'utf8');
  const persistenceFailurePath = path.join(persistenceFailureParent, 'jobs.json');
  const persistenceFailureStore = new AgentJobStore(persistenceFailurePath);
  await assert.rejects(
    () => persistenceFailureStore.create({
      prompt: '저장 실패 작업',
      provider: 'codex',
      mode: 'read-only',
      scope,
    }),
    /ENOENT|no such file or directory|not a directory/i,
    'a failed agent-job persistence operation rejects',
  );
  assert.deepEqual(
    persistenceFailureStore.listLocalOnly(),
    [],
    'a failed agent-job persistence operation must not leave the job in memory',
  );

  const migratedRaw = await fs.readFile(legacyPath, 'utf8');
  assert.notEqual(migratedRaw, legacyRaw, 'legacy normalization is persisted');
  const persistedLegacy = JSON.parse(migratedRaw) as Array<Record<string, unknown>>;
  assert.equal(Object.prototype.hasOwnProperty.call(persistedLegacy[0], 'tenantId'), false, 'persisted migration has no guessed tenantId');
  assert.equal(persistedLegacy[0].provider, 'copilot', 'legacy provider migration is persisted atomically');
  assert.equal(persistedLegacy[0].createdAt, '2026-08-07T01:02:03.000Z');
  assert.equal(persistedLegacy[0].finishedAt, '2026-08-07T01:02:04.000Z');

  console.log('PASS: AgentJobStore rejects malformed records, preserves ACL scope, and publishes mutations only after atomic persistence');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
