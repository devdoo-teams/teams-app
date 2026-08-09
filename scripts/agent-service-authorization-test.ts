import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { AgentJobStore, type AgentJobScope } from '../src/server/agent-job-store.js';
import {
  AgentMutationAuthorizationError,
  AgentService,
} from '../src/server/agent-service.js';
import { CodexRunner } from '../src/server/codex-runner.js';
import { GitService } from '../src/server/git-service.js';

const execFileAsync = promisify(execFile);

class NoopRunner {
  async run(): Promise<{ threadId: string; finalMessage: string; eventCount: number }> {
    return { threadId: 'thread-noop', finalMessage: 'noop', eventCount: 1 };
  }

  cancel(): boolean {
    return true;
  }
}

class FileWritingRunner {
  constructor(private readonly workspace: string) {}

  async run(): Promise<{ threadId: string; finalMessage: string; eventCount: number }> {
    await fs.writeFile(path.join(this.workspace, 'agent-owned.txt'), 'agent-owned v1\n', 'utf8');
    return { threadId: 'thread-file-write', finalMessage: 'created agent-owned.txt', eventCount: 1 };
  }

  cancel(): boolean {
    return true;
  }
}

async function currentHead(workspace: string): Promise<string> {
  return (await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd: workspace })).stdout.trim();
}

async function waitForCompletedExecution(
  store: AgentJobStore,
  storePath: string,
  id: string,
  scope: AgentJobScope,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const job = store.get(id, scope);
    const persisted = JSON.parse(await fs.readFile(storePath, 'utf8')) as Array<{ id?: string; progress?: string[] }>;
    const persistedJob = persisted.find((entry) => entry.id === id);
    if (
      job?.status === 'completed'
      && persistedJob?.progress?.some((entry) => entry.includes('Codex 작업 완료'))
    ) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`job ${id} did not finish completion persistence: ${JSON.stringify(store.get(id, scope))}`);
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-agent-authz-'));
const workspace = path.join(root, 'workspace');
await fs.mkdir(workspace, { recursive: true });
await execFileAsync('git', ['init'], { cwd: workspace });
await execFileAsync('git', ['config', 'user.name', 'Agent Test'], { cwd: workspace });
await execFileAsync('git', ['config', 'user.email', 'agent@example.test'], { cwd: workspace });
await fs.writeFile(path.join(workspace, 'owned.txt'), 'owned v1\n', 'utf8');
await fs.writeFile(path.join(workspace, 'unrelated.txt'), 'unrelated v1\n', 'utf8');
await fs.writeFile(path.join(workspace, 'concurrent.txt'), 'concurrent v1\n', 'utf8');
await fs.writeFile(path.join(workspace, 'preexisting.txt'), 'preexisting v1\n', 'utf8');
await execFileAsync('git', ['add', 'owned.txt', 'unrelated.txt', 'concurrent.txt', 'preexisting.txt'], { cwd: workspace });
await execFileAsync('git', ['commit', '-m', 'test: seed workspace'], { cwd: workspace });

const allowedScope: AgentJobScope = {
  requesterId: 'allowed-user',
  conversationId: 'conversation-a',
  tenantId: 'tenant-a',
};
const blockedScope: AgentJobScope = {
  requesterId: 'blocked-user',
  conversationId: 'conversation-b',
  tenantId: 'tenant-a',
};

const store = new AgentJobStore(path.join(root, 'agent-jobs.json'));
const gitService = new GitService(workspace);
const service = new AgentService(
  store,
  new NoopRunner() as unknown as CodexRunner,
  workspace,
  async () => undefined,
  gitService,
  {
    canMutateScope: (scope) => scope.requesterId === allowedScope.requesterId,
  },
);

try {
  await service.initialize();

  await assert.rejects(
    () => service.submit({ prompt: 'write forbidden change', mode: 'workspace-write', scope: blockedScope }),
    AgentMutationAuthorizationError,
    'non-operators cannot submit workspace-write jobs',
  );

  const headBeforeReadOnlyCommit = await currentHead(workspace);
  const readOnlyJob = await store.create({ prompt: 'inspect only', mode: 'read-only', scope: allowedScope });
  await store.update(readOnlyJob.id, allowedScope, {
    status: 'completed',
    threadId: 'thread-read-only',
    result: 'done',
    finishedAt: new Date().toISOString(),
  });
  const readOnlyCommit = await service.commit(readOnlyJob.id, 'test: read-only commit', allowedScope);
  assert.match(readOnlyCommit?.commitMessage ?? '', /읽기 전용|workspace-write/, 'read-only jobs cannot be committed');
  assert.equal(await currentHead(workspace), headBeforeReadOnlyCommit, 'read-only commit never creates a Git commit');

  const headBeforeUnownedCommit = await currentHead(workspace);
  const writeJob = await store.create({ prompt: 'write without path ownership', mode: 'workspace-write', scope: allowedScope });
  await store.update(writeJob.id, allowedScope, {
    status: 'completed',
    threadId: 'thread-write',
    result: 'changed file but no recorded ownership',
    finishedAt: new Date().toISOString(),
  });
  await fs.writeFile(path.join(workspace, 'owned.txt'), 'owned v2\n', 'utf8');
  const blockedCommit = await service.commit(writeJob.id, 'test: blocked write commit', allowedScope);
  assert.match(blockedCommit?.commitMessage ?? '', /변경 경로|소유권|증명/, 'write commits fail closed when the job has no recorded changed paths');
  assert.equal(await currentHead(workspace), headBeforeUnownedCommit, 'unowned write commit never creates a Git commit');

  await execFileAsync('git', ['restore', '--', 'owned.txt'], { cwd: workspace });
  await fs.writeFile(path.join(workspace, 'preexisting.txt'), 'preexisting dirty before agent\n', 'utf8');
  const persistedJobPath = path.join(root, 'captured-agent-jobs.json');
  const capturingStore = new AgentJobStore(persistedJobPath);
  const capturingService = new AgentService(
    capturingStore,
    new FileWritingRunner(workspace) as unknown as CodexRunner,
    workspace,
    async () => undefined,
    gitService,
    { canMutateScope: () => true },
  );
  await capturingService.initialize();
  const capturedJob = await capturingService.submit({
    prompt: 'create an owned file',
    mode: 'workspace-write',
    scope: allowedScope,
  });
  await capturingService.approve(capturedJob.id, allowedScope);
  await waitForCompletedExecution(capturingStore, persistedJobPath, capturedJob.id, allowedScope);
  assert.deepEqual(
    capturingStore.get(capturedJob.id, allowedScope)?.changedPaths,
    ['agent-owned.txt'],
    'workspace-write completion records only paths that became dirty during that execution',
  );

  const reloadedStore = new AgentJobStore(persistedJobPath);
  const reloadedService = new AgentService(
    reloadedStore,
    new NoopRunner() as unknown as CodexRunner,
    workspace,
    async () => undefined,
    gitService,
    { canMutateScope: () => true },
  );
  await reloadedService.initialize();
  assert.deepEqual(
    reloadedStore.get(capturedJob.id, allowedScope)?.changedPaths,
    ['agent-owned.txt'],
    'captured path ownership survives an AgentJobStore restart',
  );
  const capturedCommit = await reloadedService.commit(capturedJob.id, 'test: captured agent path', allowedScope);
  assert.ok(capturedCommit?.commitHash, 'a completed workspace-write job can commit its persisted changed paths');
  const capturedCommitPaths = (await execFileAsync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: workspace })).stdout
    .trim()
    .split('\n');
  assert.deepEqual(capturedCommitPaths, ['agent-owned.txt'], 'positive agent commit contains only the captured job path');
  assert.match(
    (await execFileAsync('git', ['status', '--porcelain', '--', 'preexisting.txt'], { cwd: workspace })).stdout,
    /preexisting\.txt/,
    'a dirty path present before execution remains outside the agent commit',
  );

  await execFileAsync('git', ['restore', '--', 'owned.txt', 'unrelated.txt', 'concurrent.txt', 'preexisting.txt'], { cwd: workspace });
  await fs.writeFile(path.join(workspace, 'owned.txt'), 'owned v3\n', 'utf8');
  await fs.writeFile(path.join(workspace, 'unrelated.txt'), 'unrelated v2\n', 'utf8');
  await fs.writeFile(path.join(workspace, 'concurrent.txt'), 'concurrent v2\n', 'utf8');
  await execFileAsync('git', ['add', '--', 'unrelated.txt'], { cwd: workspace });
  const postIndexChangeHook = path.join(workspace, '.git', 'hooks', 'post-index-change');
  await fs.writeFile(
    postIndexChangeHook,
    '#!/bin/sh\nmarker=.git/hooks/.concurrent-staged\nif [ ! -f "$marker" ]; then\n  touch "$marker"\n  git add -- concurrent.txt\nfi\n',
    'utf8',
  );
  await fs.chmod(postIndexChangeHook, 0o755);
  const scopedCommit = await gitService.commit('test: owned paths only', { ownedPaths: ['owned.txt'] });
  assert.equal(scopedCommit.committed, true, 'GitService can commit only the job-owned paths');
  const committedPaths = (await execFileAsync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: workspace })).stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  assert.deepEqual(committedPaths, ['owned.txt'], 'unrelated pre-existing diffs are never staged into the job commit');
  const remainingStatus = (await execFileAsync('git', ['status', '--porcelain'], { cwd: workspace })).stdout;
  assert.match(remainingStatus, /unrelated\.txt/, 'unrelated pre-staged changes remain staged for their original owner');
  assert.match(remainingStatus, /concurrent\.txt/, 'entries staged concurrently during commit remain outside the job commit');
  const remainingStagedPaths = (await execFileAsync('git', ['diff', '--cached', '--name-only'], { cwd: workspace })).stdout
    .trim()
    .split('\n');
  assert.deepEqual(
    remainingStagedPaths,
    ['concurrent.txt', 'unrelated.txt'],
    'pre-staged and post-index-change entries both remain staged after the isolated commit',
  );

  console.log('PASS: AgentService enforces operator-only mutations, blocks read-only or unowned commits, and GitService commits only owned paths');
} finally {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}
