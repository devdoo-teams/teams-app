import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  AgentJobStore,
  type AgentJob,
  type AgentJobScope,
} from '../src/server/agent-job-store.js';
import {
  type AgentNotification,
  AgentService,
} from '../src/server/agent-service.js';
import {
  AgentExecutionPolicy,
  AgentIsolationProvider,
  type AgentIsolationAcquireInput,
} from '../src/server/agent-execution-policy.js';
import { CodexRunner } from '../src/server/codex-runner.js';
import { GitService } from '../src/server/git-service.js';

type RunResult = { threadId: string; finalMessage: string; eventCount: number };
type PendingRun = {
  resolve: (result: RunResult) => void;
  reject: (error: Error) => void;
};

const execFileAsync = promisify(execFile);

class ControlledRunner {
  private readonly pending: PendingRun[] = [];
  private readonly startWaiters: Array<{ count: number; resolve: () => void }> = [];
  starts = 0;

  async run(): Promise<RunResult> {
    this.starts += 1;
    for (const waiter of this.startWaiters.splice(0)) {
      if (this.starts >= waiter.count) waiter.resolve();
      else this.startWaiters.push(waiter);
    }
    return new Promise<RunResult>((resolve, reject) => this.pending.push({ resolve, reject }));
  }

  cancel(): boolean {
    return true;
  }

  waitForStart(count: number): Promise<void> {
    if (this.starts >= count) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`controlled runner did not reach start ${count}; observed ${this.starts}`)),
        5_000,
      );
      this.startWaiters.push({
        count,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      });
    });
  }

  complete(finalMessage = 'controlled completion'): void {
    const run = this.pending.shift();
    assert.ok(run, 'missing controlled run to complete');
    run.resolve({ threadId: `thread-${this.starts}`, finalMessage, eventCount: 1 });
  }

  fail(error: Error): void {
    const run = this.pending.shift();
    assert.ok(run, 'missing controlled run to fail');
    run.reject(error);
  }
}

class TestIsolationProvider extends AgentIsolationProvider {
  constructor() {
    super('notify-false-regression-provider');
  }

  async acquire(input: AgentIsolationAcquireInput) {
    await this.validateRequest(input);
    return this.issueLease({
      subject: input.subject,
      workspace: input.workspace,
      protectedRoots: input.protectedRoots,
      environmentOverrides: input.environmentOverrides,
      spawn: () => {
        throw new Error('notify:false regression uses a controlled runner');
      },
    });
  }
}

async function waitForStatus(
  store: AgentJobStore,
  id: string,
  scope: AgentJobScope,
  expected: string,
): Promise<AgentJob> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const job = store.get(id, scope);
    if (job?.status === expected) return job;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`job ${id} did not reach ${expected}: ${JSON.stringify(store.get(id, scope))}`);
}

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-agent-notify-false-'));
const storeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-agent-notify-false-store-'));
await execFileAsync('git', ['init'], { cwd: workspace });

const store = new AgentJobStore(path.join(storeRoot, 'agent-jobs.json'));
const runner = new ControlledRunner();
const notifications: AgentNotification[] = [];
const scopes: Record<'completed' | 'failed' | 'blocked', AgentJobScope> = {
  completed: {
    requesterId: 'notify-false-completed-user',
    conversationId: 'notify-false-completed-conversation',
    tenantId: 'notify-false-completed-tenant',
  },
  failed: {
    requesterId: 'notify-false-failed-user',
    conversationId: 'notify-false-failed-conversation',
    tenantId: 'notify-false-failed-tenant',
  },
  blocked: {
    requesterId: 'notify-false-blocked-user',
    conversationId: 'notify-false-blocked-conversation',
    tenantId: 'notify-false-blocked-tenant',
  },
};
const executionPolicy = new AgentExecutionPolicy(workspace, {
  canMutateScope: () => true,
  canReadScope: () => true,
  isolationProvider: new TestIsolationProvider(),
});
const service = new AgentService(
  store,
  runner as unknown as CodexRunner,
  workspace,
  async (notification) => notifications.push(notification),
  new GitService(workspace),
  { canMutateScope: () => true, canReadScope: () => true, executionPolicy },
);

try {
  await service.initialize();

  const completedJob = await service.submit({
    prompt: 'complete silently',
    mode: 'read-only',
    scope: scopes.completed,
    notify: false,
  });
  await runner.waitForStart(1);
  runner.complete();
  await waitForStatus(store, completedJob.id, scopes.completed, 'completed');

  let failedJobId = '';
  const failedTerminalPromise = service.runForCopilot({
    prompt: 'fail silently',
    scope: scopes.failed,
    notify: false,
    timeoutMs: 5_000,
    onSubmitted: (job) => {
      failedJobId = job.id;
    },
  });
  await runner.waitForStart(2);
  runner.fail(new Error('controlled runner failure'));
  const failedTerminal = await failedTerminalPromise;
  assert.equal(failedTerminal.status, 'failed', 'failed fixture reaches the failed terminal path');
  assert.equal(failedTerminal.id, failedJobId, 'runForCopilot returns the submitted failed job');

  let blockedJobId = '';
  const blockedTerminalPromise = service.runForCopilot({
    prompt: 'block silently',
    scope: scopes.blocked,
    notify: false,
    timeoutMs: 5_000,
    onSubmitted: (job) => {
      blockedJobId = job.id;
    },
  });
  await runner.waitForStart(3);
  runner.complete('STATUS: BLOCKED\nBLOCKER: Browser is not available: iab unavailable');
  const blockedTerminal = await blockedTerminalPromise;
  assert.equal(blockedTerminal.status, 'failed', 'blocked diagnostic is persisted as a failed terminal job');
  assert.match(blockedTerminal.error ?? '', /browser-unavailable/u, 'blocked fixture reaches the diagnosed blocked path');
  assert.equal(blockedTerminal.id, blockedJobId, 'runForCopilot returns the submitted blocked job');

  const observed = [
    { branch: 'completed', notifications: notifications.filter(({ job }) => job.id === completedJob.id).map(({ kind, phase }) => `${kind}/${phase}`) },
    { branch: 'failed', notifications: notifications.filter(({ job }) => job.id === failedJobId).map(({ kind, phase }) => `${kind}/${phase}`) },
    { branch: 'blocked', notifications: notifications.filter(({ job }) => job.id === blockedJobId).map(({ kind, phase }) => `${kind}/${phase}`) },
  ];

  assert.deepEqual(
    observed,
    [
      { branch: 'completed', notifications: [] },
      { branch: 'failed', notifications: [] },
      { branch: 'blocked', notifications: [] },
    ],
    'notify:false suppresses every notification for completed, failed, and blocked terminal paths',
  );
} finally {
  await service.close();
  await fs.rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  await fs.rm(storeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}
