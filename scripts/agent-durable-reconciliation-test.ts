import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AgentAdmissionController } from '../src/server/agent-admission-controller.js';
import { AgentJobStore, type AgentJob, type AgentJobScope } from '../src/server/agent-job-store.js';
import {
  AgentService,
  type AgentExecutionDispatcher,
  type AgentExecutionObservation,
  type AgentNotification,
} from '../src/server/agent-service.js';
import { GitService } from '../src/server/git-service.js';

const scope: AgentJobScope = {
  tenantId: 'tenant-durable',
  requesterId: 'requester-durable',
  conversationId: 'conversation-durable',
};

class ControlledDurableDispatcher implements AgentExecutionDispatcher {
  readonly kind = 'azure-queue' as const;
  readonly observations = new Map<string, AgentExecutionObservation>();
  completeDuringCancel = false;

  async dispatch(job: AgentJob): Promise<void> {
    this.observations.set(job.id, { status: 'queued' });
  }

  async observe(job: AgentJob): Promise<AgentExecutionObservation | undefined> {
    return this.observations.get(job.id);
  }

  async cancel(job: AgentJob): Promise<void> {
    this.observations.set(job.id, this.completeDuringCancel
      ? { status: 'completed', result: 'durable completion won the race' }
      : { status: 'cancelled' });
  }
}

function createService(
  root: string,
  store: AgentJobStore,
  dispatcher: ControlledDurableDispatcher,
  journalName: string,
  notifications: AgentNotification[] = [],
): AgentService {
  return new AgentService(
    store,
    undefined,
    root,
    async (notification) => { notifications.push(notification); },
    new GitService(root),
    {
      canReadScope: () => true,
      canMutateScope: () => true,
      executionDispatcher: dispatcher,
      admissionController: new AgentAdmissionController(
        { globalLimit: 4, perTenantLimit: 4, perRequesterLimit: 4 },
        { journalPath: path.join(root, journalName) },
      ),
    },
  );
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-agent-durable-reconcile-'));
try {
  const restartPath = path.join(root, 'restart-jobs.json');
  const seedStore = new AgentJobStore(restartPath);
  await seedStore.initialize();
  const seeded = await seedStore.create({
    prompt: 'survive an ACA recycle',
    provider: 'codex',
    mode: 'read-only',
    scope,
  });
  await seedStore.update(seeded.id, scope, { status: 'running', startedAt: '2026-09-03T00:00:00.000Z' });
  const previouslyMisrecovered = await seedStore.create({
    prompt: 'repair an earlier local restart failure',
    provider: 'codex',
    mode: 'read-only',
    scope,
  });
  await seedStore.update(previouslyMisrecovered.id, scope, {
    status: 'failed',
    error: '서버가 재시작되어 작업이 중단되었습니다.',
    finishedAt: '2026-09-03T00:00:30.000Z',
  });

  const restartDispatcher = new ControlledDurableDispatcher();
  restartDispatcher.observations.set(seeded.id, {
    status: 'completed',
    result: 'authoritative durable result',
    tools: [{ category: 'mcp', name: 'jira/search_issues', observedAt: '2026-09-03T00:00:20.000Z' }],
  });
  restartDispatcher.observations.set(previouslyMisrecovered.id, {
    status: 'completed',
    result: 'durable result recovered after an earlier bad restart',
  });
  const restartedStore = new AgentJobStore(restartPath);
  const restartedService = createService(root, restartedStore, restartDispatcher, 'restart-admission.json');
  await restartedService.initialize();

  const afterRestart = restartedStore.get(seeded.id, scope);
  assert.equal(afterRestart?.status, 'completed', 'durable terminal state must be reconciled before local restart recovery');
  assert.equal(afterRestart?.result, 'authoritative durable result');
  assert.equal(afterRestart?.error, undefined, 'local interrupted error must not overwrite durable completion');
  assert.deepEqual(afterRestart?.tools, [
    { category: 'mcp', name: 'jira/search_issues', observedAt: '2026-09-03T00:00:20.000Z' },
  ], 'durable provider tool observations reconcile into the user-visible AgentJob');
  const repairedTerminal = restartedStore.get(previouslyMisrecovered.id, scope);
  assert.equal(repairedTerminal?.status, 'completed');
  assert.equal(repairedTerminal?.result, 'durable result recovered after an earlier bad restart');
  assert.equal(repairedTerminal?.error, undefined, 'durable completion must clear a stale local restart error');

  const cancelStore = new AgentJobStore(path.join(root, 'cancel-jobs.json'));
  const cancelDispatcher = new ControlledDurableDispatcher();
  const cancelNotifications: AgentNotification[] = [];
  const cancelService = createService(
    root,
    cancelStore,
    cancelDispatcher,
    'cancel-admission.json',
    cancelNotifications,
  );
  await cancelService.initialize();
  const cancellable = await cancelService.submit({
    prompt: 'finish while cancellation races',
    provider: 'codex',
    mode: 'read-only',
    scope,
  });
  cancelDispatcher.completeDuringCancel = true;

  const cancellationResult = await cancelService.cancelStrict(cancellable.id, scope, { notify: true });
  assert.equal(cancellationResult?.status, 'completed', 'durable completion must win a cancellation race');
  assert.equal(cancellationResult?.result, 'durable completion won the race');
  assert.equal(cancelStore.get(cancellable.id, scope)?.status, 'completed');
  assert.equal(
    cancelNotifications.some((notification) => notification.kind === 'cancelled'),
    false,
    'a durable completion that wins the race must not emit a false cancellation notification',
  );

  console.log('agent-durable-reconciliation-test: PASS');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
