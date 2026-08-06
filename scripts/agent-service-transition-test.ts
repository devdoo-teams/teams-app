import { strict as assert } from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AgentJobStore, type AgentJobScope } from '../src/server/agent-job-store.js';
import {
  AgentJobConflictError,
  AgentPromptValidationError,
  AgentService,
} from '../src/server/agent-service.js';
import { CodexRunner } from '../src/server/codex-runner.js';
import { GitService } from '../src/server/git-service.js';

type RunResult = { threadId: string; finalMessage: string; eventCount: number };

class ControlledRunner {
  private readonly completions: Array<(result: RunResult) => void> = [];
  private readonly startWaiters: Array<{ count: number; resolve: () => void }> = [];
  readonly cancelled: string[] = [];
  starts = 0;

  async run(): Promise<RunResult> {
    this.starts += 1;
    for (const waiter of this.startWaiters.splice(0)) {
      if (this.starts >= waiter.count) waiter.resolve();
      else this.startWaiters.push(waiter);
    }
    return new Promise<RunResult>((resolve) => this.completions.push(resolve));
  }

  cancel(id: string): boolean {
    this.cancelled.push(id);
    return true;
  }

  waitForStart(count: number): Promise<void> {
    if (this.starts >= count) return Promise.resolve();
    return new Promise<void>((resolve) => this.startWaiters.push({ count, resolve }));
  }

  release(index = 0): void {
    const resolve = this.completions[index];
    assert.ok(resolve, `missing controlled run ${index}`);
    this.completions.splice(index, 1);
    resolve({ threadId: `thread-${index + 1}`, finalMessage: 'controlled result', eventCount: 1 });
  }
}

async function waitForStatus(
  store: AgentJobStore,
  id: string,
  scope: AgentJobScope,
  expected: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (store.get(id, scope)?.status === expected) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail(`job ${id} did not reach ${expected}`);
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-agent-transitions-'));
const store = new AgentJobStore(path.join(root, 'agent-jobs.json'));
const runner = new ControlledRunner();
const scope: AgentJobScope = {
  requesterId: 'transition-user',
  conversationId: 'transition-conversation',
  tenantId: 'transition-tenant',
};
const notifications: string[] = [];
const service = new AgentService(
  store,
  runner as unknown as CodexRunner,
  root,
  async (notification) => notifications.push(notification.message),
  new GitService(root),
);

try {
  await service.initialize();

  await assert.rejects(
    () => service.submit({ prompt: 'x'.repeat(2_001), mode: 'workspace-write', scope }),
    AgentPromptValidationError,
  );
  await assert.rejects(
    () => service.continue('task-missing', 'x'.repeat(2_001), scope),
    AgentPromptValidationError,
  );

  const approvalJob = await service.submit({ prompt: 'approval race', mode: 'workspace-write', scope });
  const approvals = await Promise.allSettled([
    service.approve(approvalJob.id, scope),
    service.approve(approvalJob.id, scope),
  ]);
  assert.equal(approvals.filter((result) => result.status === 'fulfilled').length, 1, 'approval transitions once');
  assert.equal(approvals.filter((result) => result.status === 'rejected').length, 1, 'stale approval conflicts');
  assert.ok(approvals.find((result) => result.status === 'rejected')?.reason instanceof AgentJobConflictError);
  await runner.waitForStart(1);
  assert.equal(store.get(approvalJob.id, scope)?.status, 'running', 'approved job enters running exactly once');

  runner.release(0);
  await waitForStatus(store, approvalJob.id, scope, 'completed');
  await assert.rejects(() => service.approve(approvalJob.id, scope), AgentJobConflictError);
  await assert.rejects(() => service.cancelStrict(approvalJob.id, scope), AgentJobConflictError);

  const cancellationJob = await service.submit({ prompt: 'cancellation race', mode: 'workspace-write', scope });
  await service.approve(cancellationJob.id, scope);
  await runner.waitForStart(2);
  const cancellations = await Promise.allSettled([
    service.cancelStrict(cancellationJob.id, scope),
    service.cancelStrict(cancellationJob.id, scope),
  ]);
  assert.equal(cancellations.filter((result) => result.status === 'fulfilled').length, 1, 'cancellation transitions once');
  assert.equal(cancellations.filter((result) => result.status === 'rejected').length, 1, 'stale cancellation conflicts');
  assert.equal(store.get(cancellationJob.id, scope)?.status, 'cancelled');
  assert.deepEqual(runner.cancelled, [cancellationJob.id], 'running cancellation signals the runner once');
  runner.release(0);

  assert.equal(notifications.filter((message) => message.includes('완료')).length, 1, 'only the completed run emits a completion notification');
  console.log('AgentService transition tests passed: prompt bound, approval/cancel races, terminal conflicts, and runner cancellation');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
