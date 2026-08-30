import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { AgentEventStore } from '../src/server/agent-event-store.js';
import { AgentJobStore, type AgentJobScope } from '../src/server/agent-job-store.js';
import { AgentService } from '../src/server/agent-service.js';
import {
  AgentExecutionPolicy,
  AgentIsolationProvider,
  type AgentIsolationAcquireInput,
} from '../src/server/agent-execution-policy.js';
import { CodexRunner } from '../src/server/codex-runner.js';
import { GitService } from '../src/server/git-service.js';

const execFileAsync = promisify(execFile);
type RunResult = { threadId: string; finalMessage: string; eventCount: number };
type RunEvent = { type?: string; item?: { type?: string; text?: string }; thread_id?: string };

class ControlledRunner {
  private resolveRun!: (result: RunResult) => void;
  private onEvent?: (event: RunEvent) => Promise<void> | void;
  started = false;

  async run(options: { onEvent?: (event: RunEvent) => Promise<void> | void }): Promise<RunResult> {
    this.started = true;
    this.onEvent = options.onEvent;
    return new Promise<RunResult>((resolve) => { this.resolveRun = resolve; });
  }

  cancel(): boolean { return true; }

  async emit(event: RunEvent): Promise<void> {
    await this.onEvent?.(event);
  }

  complete(): void {
    this.resolveRun({ threadId: 'thread-audit', finalMessage: '감사 가능한 완료 결과', eventCount: 3 });
  }
}

class TestIsolationProvider extends AgentIsolationProvider {
  constructor() { super('agent-event-audit-test-provider'); }

  async acquire(input: AgentIsolationAcquireInput) {
    await this.validateRequest(input);
    return this.issueLease({
      subject: input.subject,
      workspace: input.workspace,
      protectedRoots: input.protectedRoots,
      environmentOverrides: input.environmentOverrides,
      spawn: () => { throw new Error('agent event audit uses a controlled runner'); },
    });
  }
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`${label} was not observed`);
}

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-agent-event-audit-workspace-'));
const storeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-agent-event-audit-store-'));
const scope: AgentJobScope = {
  requesterId: 'audit-user',
  conversationId: 'audit-conversation',
  tenantId: 'audit-tenant',
};
const jobStore = new AgentJobStore(path.join(storeRoot, 'agent-jobs.json'));
const eventStore = new AgentEventStore(path.join(storeRoot, 'agent-events.json'));
const runner = new ControlledRunner();
const service = new AgentService(
  jobStore,
  runner as unknown as CodexRunner,
  workspace,
  async () => undefined,
  new GitService(workspace),
  {
    canMutateScope: () => true,
    canReadScope: () => true,
    executionPolicy: new AgentExecutionPolicy(workspace, {
      canMutateScope: () => true,
      canReadScope: () => true,
      isolationProvider: new TestIsolationProvider(),
    }),
    eventStore,
  },
);

try {
  await execFileAsync('git', ['init'], { cwd: workspace });
  await service.initialize();
  const job = await service.submit({
    prompt: '이벤트 이력을 보존해줘',
    mode: 'read-only',
    scope,
    notify: false,
  });
  await waitFor(() => runner.started, 'runner start');
  await runner.emit({ type: 'turn.started' });
  await runner.emit({ type: 'item.completed', item: { type: 'agent_message', text: '중간 결과' } });
  await runner.emit({ type: 'item.started', item: { type: 'command_execution' } });
  runner.complete();
  await waitFor(() => jobStore.get(job.id, scope)?.status === 'completed', 'completed job');
  await waitFor(
    () => eventStore.list(scope, job.id, 50).some((event) => event.kind === 'result'),
    'durable completion event',
  );

  const events = eventStore.list(scope, job.id, 50);
  assert.deepEqual(
    events.map((event) => event.kind),
    ['submitted', 'started', 'progress', 'progress', 'progress', 'result'],
    'lifecycle events are durable even when Teams notification is disabled',
  );
  assert.equal(events.at(-1)?.status, 'completed');
  assert.equal(events.at(-1)?.correlationId, 'completed');
  assert.ok(events.every((event) => event.scope.tenantId === scope.tenantId));

  const restartedEventStore = new AgentEventStore(path.join(storeRoot, 'agent-events.json'));
  await restartedEventStore.initialize();
  assert.deepEqual(
    restartedEventStore.list(scope, job.id, 50).map((event) => event.id),
    events.map((event) => event.id),
    'event IDs survive a server restart unchanged',
  );
  console.log(JSON.stringify({ status: 'PASS', jobId: job.id, eventCount: events.length }));
} finally {
  await service.close();
  await fs.rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  await fs.rm(storeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}
