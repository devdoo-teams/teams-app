import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { observeTeamsCliTestCatalog } from './fixtures/teams-cli-agent-policy-fixture.js';
import { AgentAdmissionController } from '../src/server/agent-admission-controller.js';
import { AgentJobStore, type AgentJob, type AgentJobScope } from '../src/server/agent-job-store.js';
import {
  AgentService,
  type AgentExecutionDispatcher,
  type AgentExecutionObservation,
  type AgentNotification,
} from '../src/server/agent-service.js';
import { GitService } from '../src/server/git-service.js';
import { projectCoreOrchestrationJob } from '../src/server/core-orchestration-service.js';
import { GenUiResponseFactory } from '../src/server/genui-response.js';

const scope: AgentJobScope = {
  tenantId: 'tenant-durable',
  requesterId: 'requester-durable',
  conversationId: 'conversation-durable',
};

class ControlledDurableDispatcher implements AgentExecutionDispatcher {
  readonly kind = 'azure-queue' as const;
  readonly observations = new Map<string, AgentExecutionObservation>();
  completeDuringCancel = false;
  delayCancellation = false;
  cancellations = 0;

  async dispatch(job: AgentJob): Promise<void> {
    this.observations.set(job.id, { status: 'queued' });
  }

  async observe(job: AgentJob): Promise<AgentExecutionObservation | undefined> {
    return this.observations.get(job.id);
  }

  async cancel(job: AgentJob): Promise<void> {
    this.cancellations++;
    if (this.delayCancellation) return;
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
  admission?: AgentAdmissionController,
): AgentService {
  return new AgentService(
    store,
    undefined,
    root,
    async (notification) => { notifications.push(notification); },
    new GitService(root),
    {
      observeCodexModelCatalog: observeTeamsCliTestCatalog,
      canReadScope: () => true,
      canMutateScope: () => true,
      executionDispatcher: dispatcher,
      admissionController: admission ?? new AgentAdmissionController(
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

  for (const terminalStatus of ['cancelled', 'completed', 'failed'] as const) {
    const pendingFile = path.join(root, `pending-${terminalStatus}.json`);
    const pendingStore = new AgentJobStore(pendingFile);
    const pendingDispatcher = new ControlledDurableDispatcher(); pendingDispatcher.delayCancellation = true;
    const pendingNotifications: AgentNotification[] = [];
    const journal = `pending-${terminalStatus}-admission.json`;
    const admission = new AgentAdmissionController({ globalLimit: 4, perTenantLimit: 4, perRequesterLimit: 4 }, { journalPath: path.join(root, journal) });
    let pendingService = createService(root, pendingStore, pendingDispatcher, journal, pendingNotifications, admission);
    try {
      await pendingService.initialize();
      const active = await pendingService.submit({ prompt: 'synthetic delayed worker cancellation', provider: 'codex', mode: 'read-only', scope });
      pendingDispatcher.observations.set(active.id, { status: 'running' }); await pendingService.observe(active.id, scope);
      const pending = await pendingService.cancelStrict(active.id, scope, { notify: true });
      assert.equal(pending?.status, 'running', 'request acceptance is not terminal worker cancellation');
      assert.equal(pending?.finishedAt, undefined);
      assert.ok((pending as AgentJob & { cancellationRequestedAt?: string })?.cancellationRequestedAt);
      assert.equal(projectCoreOrchestrationJob(pending!).cancellationRequestedAt, pending!.cancellationRequestedAt);
      const card = new GenUiResponseFactory({} as never).cancelled(pending!);
      assert.match(card.fallbackText, /취소 요청이 접수되었습니다/);
      assert.equal(card.title, '작업 취소 확인 대기');
      await assert.rejects(pendingStore.update(active.id, scope, { cancellationRequestedAt: 'invalid' }), /timestamp|date|ISO|immutable/i);
      await assert.rejects(pendingStore.update(active.id, scope, { cancellationRequestedAt: '2026-10-15T00:00:00Z' }), /immutable/);
      assert.equal(admission.snapshot().global, 1, 'pending cancellation retains execution capacity');
      assert.equal(pendingNotifications.filter(note => note.kind === 'cancelled').length, 0);
      await pendingService.cancelStrict(active.id, scope, { notify: true });
      assert.equal(pendingDispatcher.cancellations, 1, 'a persisted cancellation request is not sent twice');
      await pendingService.close({ closeAdmission: false });
      const restartedPendingStore = new AgentJobStore(pendingFile);
      const restartedAdmission = new AgentAdmissionController({ globalLimit: 4, perTenantLimit: 4, perRequesterLimit: 4 }, { journalPath: path.join(root, journal) });
      pendingService = createService(root, restartedPendingStore, pendingDispatcher, journal, pendingNotifications, restartedAdmission);
      await pendingService.initialize();
      assert.equal(restartedPendingStore.get(active.id, scope)?.status, 'running');
      assert.equal(restartedAdmission.snapshot().global, 1);
      assert.ok((restartedPendingStore.get(active.id, scope) as AgentJob & { cancellationRequestedAt?: string })?.cancellationRequestedAt);
      pendingDispatcher.observations.set(active.id, { status: terminalStatus,
        ...(terminalStatus === 'completed' ? { result: 'synthetic worker completed before cancellation' } : {}),
        ...(terminalStatus === 'failed' ? { error: 'synthetic worker failure' } : {}) });
      const deadline = Date.now() + 2500;
      while ((restartedPendingStore.get(active.id, scope)?.status !== terminalStatus || restartedAdmission.snapshot().global !== 0)
        && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert.equal(restartedPendingStore.get(active.id, scope)?.status, terminalStatus, 'automatic polling settles the authoritative worker outcome');
      assert.equal(restartedAdmission.snapshot().global, 0);
      await pendingService.observe(active.id, scope);
      assert.equal(pendingNotifications.filter(note => note.kind === 'cancelled').length, terminalStatus === 'cancelled' ? 1 : 0,
        'only worker-confirmed cancellation emits one cancellation notification');
    } finally { await pendingService.close({ closeAdmission: false }); }
  }
  console.log('agent-durable-reconciliation-test: PASS');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
