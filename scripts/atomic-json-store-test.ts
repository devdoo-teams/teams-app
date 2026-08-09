import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AgentJobStore } from '../src/server/agent-job-store.js';
import { GenUiActionStore } from '../src/server/genui-action-store.js';
import { ItemStore } from '../src/server/item-store.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-atomic-json-'));
const directory = path.join(root, 'private-store');
await fs.mkdir(directory, { recursive: true, mode: 0o755 });
await fs.chmod(directory, 0o755);

async function observeValidJson<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  let finished = false;
  const errors: unknown[] = [];
  const observer = (async () => {
    while (!finished) {
      try {
        JSON.parse(await fs.readFile(filePath, 'utf8'));
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) {
          errors.push(error);
        }
      }
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  })();

  try {
    return await operation();
  } finally {
    finished = true;
    await observer;
    assert.equal(errors.length, 0, `concurrent readers observed invalid JSON: ${String(errors[0])}`);
  }
}

async function assertPrivateStore(filePath: string): Promise<void> {
  const file = await fs.stat(filePath);
  const parent = await fs.stat(path.dirname(filePath));
  assert.equal(file.mode & 0o777, 0o600, `${filePath} is mode 0600`);
  assert.equal(parent.mode & 0o777, 0o700, `${path.dirname(filePath)} is mode 0700`);
  const remnants = (await fs.readdir(path.dirname(filePath))).filter((name) => name.endsWith('.tmp'));
  assert.deepEqual(remnants, [], `${filePath} has no temporary file remnants`);
}

async function assertBroadParentRejected(parent: string, index: number): Promise<void> {
  const before = await fs.lstat(parent);
  const filePath = path.join(parent, `.teams-unsafe-store-${process.pid}-${index}.json`);
  await assert.rejects(
    () => new ItemStore(filePath).initialize(),
    /Unsafe broad JSON store parent directory/,
  );
  const after = await fs.lstat(parent);
  assert.equal(after.mode, before.mode, `broad parent permissions are unchanged: ${parent}`);
  await assert.rejects(
    () => fs.lstat(filePath),
    (error: NodeJS.ErrnoException) => error.code === 'ENOENT',
  );
}

try {
  const broadParents = [...new Set([
    path.parse(process.cwd()).root,
    os.tmpdir(),
    process.cwd(),
    os.homedir(),
  ].map((parent) => path.resolve(parent)))];
  for (const [index, parent] of broadParents.entries()) {
    await assertBroadParentRejected(parent, index);
  }

  const linkedParentTarget = path.join(root, 'linked-parent-target');
  const linkedParent = path.join(root, 'linked-parent');
  const nestedLinkedTarget = path.join(linkedParentTarget, 'nested');
  await fs.mkdir(nestedLinkedTarget, { recursive: true, mode: 0o755 });
  await fs.chmod(nestedLinkedTarget, 0o755);
  await fs.symlink(linkedParentTarget, linkedParent, 'dir');
  const linkedParentMode = (await fs.stat(nestedLinkedTarget)).mode;
  await assert.rejects(
    () => new ItemStore(path.join(linkedParent, 'nested', 'items.json')).initialize(),
    /symbolic link/,
  );
  assert.equal((await fs.stat(nestedLinkedTarget)).mode, linkedParentMode, 'nested symlink parent target mode is unchanged');
  await assert.rejects(
    () => fs.lstat(path.join(nestedLinkedTarget, 'items.json')),
    (error: NodeJS.ErrnoException) => error.code === 'ENOENT',
  );

  const symlinkFileParent = path.join(root, 'symlink-file-parent');
  const symlinkFileTarget = path.join(root, 'symlink-file-target.json');
  const symlinkStoreFile = path.join(symlinkFileParent, 'items.json');
  await fs.mkdir(symlinkFileParent, { mode: 0o755 });
  await fs.chmod(symlinkFileParent, 0o755);
  await fs.writeFile(symlinkFileTarget, 'target must remain unchanged\n', { mode: 0o644 });
  await fs.chmod(symlinkFileTarget, 0o644);
  await fs.symlink(symlinkFileTarget, symlinkStoreFile, 'file');
  const symlinkParentMode = (await fs.stat(symlinkFileParent)).mode;
  const symlinkTargetMode = (await fs.stat(symlinkFileTarget)).mode;
  await assert.rejects(() => new ItemStore(symlinkStoreFile).initialize(), /symbolic link/);
  assert.equal((await fs.stat(symlinkFileParent)).mode, symlinkParentMode, 'symlink store parent mode is unchanged');
  assert.equal((await fs.stat(symlinkFileTarget)).mode, symlinkTargetMode, 'symlink store target mode is unchanged');
  assert.equal(await fs.readFile(symlinkFileTarget, 'utf8'), 'target must remain unchanged\n');

  const itemFile = path.join(directory, 'items.json');
  const items = new ItemStore(itemFile);
  await items.initialize();
  await observeValidJson(itemFile, () => Promise.all(
    Array.from({ length: 80 }, (_, index) => items.add(`atomic item ${index}`)),
  ));
  const restartedItems = new ItemStore(itemFile);
  await restartedItems.initialize();
  assert.equal(restartedItems.list().length, 82, 'ItemStore survives concurrent writes and restart');
  await assertPrivateStore(itemFile);

  const jobFile = path.join(directory, 'agent-jobs.json');
  const jobs = new AgentJobStore(jobFile);
  await jobs.initialize();
  const scope = { requesterId: 'storage-user', conversationId: 'storage-conversation', tenantId: 'storage-tenant' };
  await observeValidJson(jobFile, () => Promise.all(
    Array.from({ length: 80 }, (_, index) => jobs.create({
      prompt: `atomic job ${index}`,
      mode: 'read-only',
      scope,
    })),
  ));
  const restartedJobs = new AgentJobStore(jobFile);
  await restartedJobs.initialize();
  assert.equal(restartedJobs.list(scope, 100).length, 80, 'AgentJobStore survives concurrent writes and restart');
  await assertPrivateStore(jobFile);

  const queueDirectory = path.join(root, 'queue-recovery');
  const queueFile = path.join(queueDirectory, 'agent-jobs.json');
  const queueTarget = path.join(root, 'queue-target.json');
  const queueStore = new AgentJobStore(queueFile);
  await queueStore.initialize();
  await fs.rm(queueFile);
  await fs.writeFile(queueTarget, 'queue target must remain unchanged\n', { mode: 0o644 });
  await fs.chmod(queueTarget, 0o644);
  await fs.symlink(queueTarget, queueFile, 'file');
  const queueTargetMode = (await fs.stat(queueTarget)).mode;
  await assert.rejects(
    () => queueStore.create({ prompt: 'failing queued write', mode: 'read-only', scope }),
    /symbolic link/,
  );
  assert.equal(await fs.readFile(queueTarget, 'utf8'), 'queue target must remain unchanged\n');
  assert.equal((await fs.stat(queueTarget)).mode, queueTargetMode, 'failed queued write does not chmod its target');
  await fs.rm(queueFile);
  await queueStore.create({ prompt: 'recovered queued write', mode: 'read-only', scope });
  const restartedQueueStore = new AgentJobStore(queueFile);
  await restartedQueueStore.initialize();
  assert.equal(
    restartedQueueStore.list(scope, 10).length,
    1,
    'AgentJobStore queue recovers after rejecting one write without retaining the failed mutation',
  );
  await assertPrivateStore(queueFile);

  const grantFile = path.join(directory, 'genui-actions.json');
  const grants = new GenUiActionStore(grantFile, 60_000);
  await grants.initialize();
  const grantInput = (index: number) => ({
    action: 'approve' as const,
    entityId: `task-${index}`,
    correlationId: `correlation-${index}`,
    conversationId: 'storage-conversation',
    requesterId: 'storage-user',
    tenantId: 'storage-tenant',
  });
  const tokens = await observeValidJson(grantFile, () => Promise.all(
    Array.from({ length: 80 }, (_, index) => grants.issue(grantInput(index))),
  ));
  assert.equal(tokens.length, 80, 'GenUI grants issue concurrently');
  const restartedGrants = new GenUiActionStore(grantFile, 60_000);
  await restartedGrants.initialize();
  assert.equal(
    (JSON.parse(await fs.readFile(grantFile, 'utf8')) as unknown[]).length,
    80,
    'GenUiActionStore survives concurrent writes and restart',
  );
  await assertPrivateStore(grantFile);

  console.log('PASS: atomic JSON storage is path-safe, private, restart-safe, complete, and queue-recoverable');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
