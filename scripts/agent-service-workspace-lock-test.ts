import { strict as assert } from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AgentJobStore, type AgentJobScope } from '../src/server/agent-job-store.js';
import { AgentAdmissionController } from '../src/server/agent-admission-controller.js';
import { AgentService } from '../src/server/agent-service.js';

type RunResult = { threadId: string; finalMessage: string; eventCount: number };

class ControlledRunner {
  starts = 0;
  private readonly pending: Array<{ resolve: (result: RunResult) => void }> = [];

  run(): Promise<RunResult> {
    this.starts += 1;
    return new Promise((resolve) => this.pending.push({ resolve }));
  }

  release(): void {
    const next = this.pending.shift();
    assert.ok(next, 'a controlled workspace-write run is pending');
    next.resolve({ threadId: `thread-${this.starts}`, finalMessage: 'workspace result', eventCount: 1 });
  }

  cancel(): boolean {
    return true;
  }
}

class RecordingGitService {
  captures = 0;
  changes = 0;
  activeCommits = 0;
  maxActiveCommits = 0;
  commitCalls = 0;

  async captureWorkspaceSnapshot(): Promise<{ dirtyPaths: readonly string[] }> {
    this.captures += 1;
    return { dirtyPaths: [] };
  }

  async changedPathsSince(): Promise<string[]> {
    this.changes += 1;
    return [`src/work-${this.changes}.ts`];
  }

  async commit(): Promise<{ committed: true; hash: string; message: string }> {
    this.activeCommits += 1;
    this.maxActiveCommits = Math.max(this.maxActiveCommits, this.activeCommits);
    this.commitCalls += 1;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    this.activeCommits -= 1;
    return { committed: true, hash: `test-hash-${this.commitCalls}`, message: 'test commit completed' };
  }
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-agent-workspace-lock-'));
const store = new AgentJobStore(path.join(root, 'agent-jobs.json'));
const runner = new ControlledRunner();
const git = new RecordingGitService();
const scope: AgentJobScope = {
  requesterId: 'workspace-lock-user',
  conversationId: 'workspace-lock-conversation',
  tenantId: 'workspace-lock-tenant',
};
const service = new AgentService(
  store,
  runner as never,
  root,
  async () => undefined,
  git as never,
  {
    canMutateScope: () => true,
    // This fixture intentionally queues two jobs from one requester so it can
    // prove workspace serialization. Keep production's requester admission
    // limit unchanged; widen only this isolated concurrency test seam.
    admissionController: new AgentAdmissionController({
      globalLimit: 2,
      perTenantLimit: 2,
      perRequesterLimit: 2,
    }),
  },
);

try {
  await service.initialize();
  const first = await service.submit({ prompt: 'first workspace change', mode: 'workspace-write', scope });
  const second = await service.submit({ prompt: 'second workspace change', mode: 'workspace-write', scope });

  await service.approve(first.id, scope);
  await waitFor(() => runner.starts === 1, 'the first workspace-write run did not start');
  await service.approve(second.id, scope);
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
  assert.equal(runner.starts, 1, 'workspace-write runs must not overlap in one workspace');
  assert.equal(git.captures, 1, 'the second workspace snapshot waits for the first run');

  runner.release();
  await waitFor(() => runner.starts === 2, 'the second workspace-write run did not start after the first finished');
  assert.equal(git.captures, 2, 'each serialized run receives its own workspace snapshot');
  runner.release();
  await waitFor(
    () => store.get(first.id, scope)?.status === 'completed' && store.get(second.id, scope)?.status === 'completed',
    'serialized workspace-write jobs did not both complete',
  );
  assert.deepEqual(store.get(first.id, scope)?.changedPaths, ['src/work-1.ts']);
  assert.deepEqual(store.get(second.id, scope)?.changedPaths, ['src/work-2.ts']);

  const commitResults = await Promise.all([
    service.commit(first.id, 'test commit one', scope),
    service.commit(first.id, 'test commit two', scope),
  ]);
  assert.equal(commitResults.length, 2, 'both commit callers receive a serialized result');
  assert.equal(git.maxActiveCommits, 1, 'concurrent commits cannot overlap in the shared workspace');

  console.log('PASS: workspace-write agent jobs serialize snapshot, runner, and changed-path capture in one workspace');
} finally {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}
