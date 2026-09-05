import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { AgentJobStore, type AgentJobScope } from '../src/server/agent-job-store.js';
import {
  AgentJobConflictError,
  type AgentNotification,
  AgentPromptValidationError,
  AgentService,
} from '../src/server/agent-service.js';
import {
  AgentExecutionPolicy,
  AgentIsolationProvider,
  type AgentIsolationAcquireInput,
} from '../src/server/agent-execution-policy.js';
import { CodexRunner } from '../src/server/codex-runner.js';
import { GitService } from '../src/server/git-service.js';

type RunResult = {
  threadId: string;
  finalMessage: string;
  eventCount: number;
  tokenUsage: {
    source: 'codex.exec.jsonl.turn.completed.usage';
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
  };
};
const execFileAsync = promisify(execFile);

class ControlledRunner {
  private readonly runs: Array<{
    onEvent?: (event: { type?: string; item?: { type?: string; text?: string }; thread_id?: string }) => Promise<void> | void;
  }> = [];
  private readonly completions: Array<{
    resolve: (result: RunResult) => void;
    reject: (error: Error) => void;
    onEvent?: (event: { type?: string; item?: { type?: string; text?: string }; thread_id?: string }) => Promise<void> | void;
  }> = [];
  private readonly startWaiters: Array<{ count: number; resolve: () => void }> = [];
  readonly cancelled: string[] = [];
  starts = 0;

  async run(options: {
    onEvent?: (event: { type?: string; item?: { type?: string; text?: string }; thread_id?: string }) => Promise<void> | void;
  }): Promise<RunResult> {
    this.starts += 1;
    for (const waiter of this.startWaiters.splice(0)) {
      if (this.starts >= waiter.count) waiter.resolve();
      else this.startWaiters.push(waiter);
    }
    const run = { onEvent: options.onEvent };
    this.runs.push(run);
    return new Promise<RunResult>((resolve, reject) => this.completions.push({ resolve, reject, onEvent: run.onEvent }));
  }

  cancel(id: string): boolean {
    this.cancelled.push(id);
    return true;
  }

  waitForStart(count: number): Promise<void> {
    if (this.starts >= count) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`controlled runner did not reach start ${count}; observed ${this.starts}`)), 5_000);
      this.startWaiters.push({
        count,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      });
    });
  }

  release(index = 0): void {
    const completion = this.completions[index];
    assert.ok(completion, `missing controlled run ${index}`);
    this.completions.splice(index, 1);
    completion.resolve({
      threadId: `thread-${index + 1}`,
      finalMessage: 'controlled result',
      eventCount: 1,
      tokenUsage: {
        source: 'codex.exec.jsonl.turn.completed.usage',
        inputTokens: 21_460,
        cachedInputTokens: 21_248,
        outputTokens: 5,
        reasoningOutputTokens: 0,
      },
    });
  }

  fail(error: Error, index = 0): void {
    const completion = this.completions[index];
    assert.ok(completion, `missing controlled run ${index}`);
    this.completions.splice(index, 1);
    completion.reject(error);
  }

  async emit(event: { type?: string; item?: { type?: string; text?: string }; thread_id?: string }, index = 0): Promise<void> {
    const completion = this.completions[index];
    assert.ok(completion, `missing controlled run ${index}`);
    await completion.onEvent?.(event);
  }

  async emitRun(runIndex: number, event: { type?: string; item?: { type?: string; text?: string }; thread_id?: string }): Promise<void> {
    const run = this.runs[runIndex];
    assert.ok(run, `missing historical controlled run ${runIndex}`);
    await run.onEvent?.(event);
  }
}

class TestIsolationProvider extends AgentIsolationProvider {
  constructor() { super('transition-test-provider'); }

  async acquire(input: AgentIsolationAcquireInput) {
    await this.validateRequest(input);
    return this.issueLease({
      subject: input.subject,
      workspace: input.workspace,
      protectedRoots: input.protectedRoots,
      environmentOverrides: input.environmentOverrides,
      spawn: () => { throw new Error('transition tests use a controlled runner'); },
    });
  }
}

async function waitForStatus(
  store: AgentJobStore,
  id: string,
  scope: AgentJobScope,
  expected: string,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (store.get(id, scope)?.status === expected) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`job ${id} did not reach ${expected}: ${JSON.stringify(store.get(id, scope))}`);
}

async function waitForNotification(
  notifications: AgentNotification[],
  predicate: (notification: AgentNotification) => boolean,
): Promise<AgentNotification> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const notification = notifications.find(predicate);
    if (notification) return notification;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`notification did not arrive: ${JSON.stringify(notifications)}`);
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-agent-transitions-'));
const storeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-agent-transitions-store-'));
await execFileAsync('git', ['init'], { cwd: root });
const store = new AgentJobStore(path.join(storeRoot, 'agent-jobs.json'));
const runner = new ControlledRunner();
const scope: AgentJobScope = {
  requesterId: 'transition-user',
  conversationId: 'transition-conversation',
  tenantId: 'transition-tenant',
};
const notifications: AgentNotification[] = [];
const isolationProvider = new TestIsolationProvider();
const executionPolicy = new AgentExecutionPolicy(root, {
  canMutateScope: () => true,
  canReadScope: () => true,
  isolationProvider,
});
const service = new AgentService(
  store,
  runner as unknown as CodexRunner,
  root,
  async (notification) => notifications.push(notification),
  new GitService(root),
  { canMutateScope: () => true, canReadScope: () => true, executionPolicy },
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
  assert.deepEqual(store.get(approvalJob.id, scope)?.tokenUsage, {
    source: 'codex.exec.jsonl.turn.completed.usage',
    inputTokens: 21_460,
    cachedInputTokens: 21_248,
    outputTokens: 5,
    reasoningOutputTokens: 0,
  }, 'terminal Codex token usage is persisted with the completed job');
  await assert.rejects(() => service.approve(approvalJob.id, scope), AgentJobConflictError);
  await assert.rejects(() => service.cancelStrict(approvalJob.id, scope), AgentJobConflictError);

  const delayedJob = await service.submit({ prompt: 'delayed natural-language request', mode: 'read-only', scope });
  assert.ok(['queued', 'running'].includes(delayedJob.status), 'delayed runner returns a queued/running job ACK immediately');
  await runner.waitForStart(2);
  await runner.emit({ type: 'thread.started', thread_id: 'retry-thread' });
  await runner.emit({ type: 'turn.started' });
  await runner.emit({ type: 'item.completed', item: { type: 'agent_message', text: 'first progress update' } });
  await runner.emit({ type: 'item.started', item: { type: 'command_execution' } });
  runner.release(0);
  await waitForStatus(store, delayedJob.id, scope, 'completed');
  await waitForNotification(notifications, (notification) => notification.job.id === delayedJob.id && notification.phase === 'completed');
  const delayedNotifications = notifications.filter((notification) => notification.job.id === delayedJob.id);
  assert.ok(delayedNotifications.some((notification) => notification.message.includes('실행을 시작했습니다')), 'running ACK is delivered as a same-conversation notification');
  assert.ok(delayedNotifications.some((notification) => notification.kind === 'progress' && notification.phase === 'analysis'), 'running/progress notification is emitted for a delayed runner');
  assert.ok(delayedNotifications.some((notification) => notification.kind === 'progress' && notification.phase === 'tools'), 'tool progress notification is emitted');
  assert.ok(delayedNotifications.some((notification) => notification.kind === 'progress' && notification.phase === 'agent-update'), 'agent update notification is emitted');
  assert.ok(delayedNotifications.some((notification) => notification.kind === 'result' && notification.phase === 'completed'), 'terminal completion notification is emitted');
  assert.ok(delayedNotifications.every((notification) => notification.conversationId === scope.conversationId), 'progress and completion notifications stay in the originating conversation');

  const retryJob = await service.continue(delayedJob.id, 'retry after the completed request', scope);
  assert.ok(retryJob, 'a completed Codex thread can be retried through continue');
  assert.equal(retryJob?.parentJobId, delayedJob.id, 'retry keeps the parent job link');
  await runner.waitForStart(3);
  runner.release(0);
  await waitForStatus(store, retryJob!.id, scope, 'completed');
  await waitForNotification(notifications, (notification) => notification.job.id === retryJob!.id && notification.phase === 'completed');
  assert.ok(
    notifications.some((notification) => notification.job.id === retryJob!.id && notification.kind === 'result' && notification.phase === 'completed'),
    'retry emits its own completion notification',
  );

  const cancellationJob = await service.submit({ prompt: 'cancellation race', mode: 'workspace-write', scope });
  await service.approve(cancellationJob.id, scope);
  await runner.waitForStart(4);
  const cancellationPromises = [
    service.cancelStrict(cancellationJob.id, scope, { notify: true }),
    service.cancelStrict(cancellationJob.id, scope),
  ];
  // Attach rejection handlers before yielding to the runner. The stale strict
  // cancellation is expected to reject; Node 24 treats a rejection that is
  // observed only after the runner is released as an unhandled rejection.
  const cancellations = Promise.allSettled(cancellationPromises);
  const cancellationDeadline = Date.now() + 5_000;
  while (runner.cancelled.length < 1 && Date.now() < cancellationDeadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  assert.deepEqual(runner.cancelled, [cancellationJob.id], 'running cancellation signals the runner before awaiting terminal cleanup');
  // AgentService waits for the runner promise before returning cancel(). Release
  // the controlled runner only after the cancellation signal has been observed.
  runner.release(0);
  const cancellationResults = await cancellations;
  assert.equal(cancellationResults.filter((result) => result.status === 'fulfilled').length, 1, 'cancellation transitions once');
  assert.equal(cancellationResults.filter((result) => result.status === 'rejected').length, 1, 'stale cancellation conflicts');
  assert.equal(store.get(cancellationJob.id, scope)?.status, 'cancelled');
  assert.deepEqual(runner.cancelled, [cancellationJob.id], 'running cancellation signals the runner once');
  const lateNotificationCount = notifications.filter((notification) => notification.job.id === cancellationJob.id).length;
  await runner.emitRun(3, { type: 'turn.started' });
  await runner.emitRun(3, { type: 'item.completed', item: { type: 'agent_message', text: 'late agent update' } });
  await runner.emitRun(3, { type: 'item.started', item: { type: 'command_execution' } });
  assert.equal(
    notifications.filter((notification) => notification.job.id === cancellationJob.id).length,
    lateNotificationCount,
    'late running/agent/tool progress is suppressed after cancellation',
  );
  const cancellationNotifications = notifications.filter((notification) => notification.job.id === cancellationJob.id);
  assert.equal(cancellationNotifications.filter((notification) => notification.kind === 'cancelled').length, 1, 'cancellation emits one same-conversation cancellation notification');
  assert.equal(cancellationNotifications.filter((notification) => notification.phase === 'completed' || notification.phase === 'failed').length, 0, 'a cancelled runner cannot emit a later terminal success/failure notification');

  const failedJob = await service.submit({ prompt: 'runner failure branch', mode: 'read-only', scope });
  await runner.waitForStart(5);
  const secretFailure = `Authorization: Bearer secret-token path=${root}/private one-time code ABCD-EFGH`;
  runner.fail(new Error(secretFailure));
  await waitForStatus(store, failedJob.id, scope, 'failed');
  const failedState = store.get(failedJob.id, scope);
  assert.ok(failedState, 'failed job is persisted');
  assert.notEqual(failedState?.error, secretFailure, 'raw runner diagnostics are not persisted');
  assert.doesNotMatch(failedState?.error ?? '', /secret-token|ABCD-EFGH|teams-agent-transitions-/u, 'persisted diagnostics redact credentials, codes, and paths');
  const failedNotification = await waitForNotification(notifications, (notification) => notification.job.id === failedJob.id && notification.phase === 'failed');
  assert.equal(failedNotification?.kind, 'error', 'runner failure emits an error notification');
  assert.equal(failedNotification?.conversationId, scope.conversationId, 'runner failure notification stays in the originating conversation');
  assert.doesNotMatch(failedNotification?.message ?? '', /secret-token|ABCD-EFGH|teams-agent-transitions-/u, 'notification diagnostics redact credentials, codes, and paths');

  const retriedFailedJob = await service.retry(failedJob.id, scope, { notify: true });
  assert.ok(retriedFailedJob, 'a failed read-only job can be retried as a new job');
  assert.equal(retriedFailedJob?.parentJobId, failedJob.id, 'retry keeps the failed job as its parent');
  await runner.waitForStart(6);
  runner.release(0);
  await waitForStatus(store, retriedFailedJob!.id, scope, 'completed');
  assert.equal(store.get(failedJob.id, scope)?.status, 'failed', 'retry does not mutate the original failed job');

  console.log('AgentService transition tests passed: prompt bound, delayed progress, retry, approval/cancel races, terminal success/failure, and runner cancellation');
} finally {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  await fs.rm(storeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}
