import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  AgentAdmissionController,
  AgentCapacityError,
  type AgentAdmissionScope,
} from '../src/server/agent-admission-controller.js';
import { AgentJobStore, type AgentJobScope } from '../src/server/agent-job-store.js';
import { AgentService } from '../src/server/agent-service.js';
import {
  AgentExecutionPolicy,
  AgentIsolationProvider,
  type AgentIsolationAcquireInput,
} from '../src/server/agent-execution-policy.js';
import { CodexRunner, type CodexRunResult } from '../src/server/codex-runner.js';
import { GitService } from '../src/server/git-service.js';

const scope = (tenantId: string, requesterId: string): AgentAdmissionScope => ({ tenantId, requesterId });
const jobScope = (tenantId: string, requesterId: string, conversationId: string): AgentJobScope => ({
  tenantId,
  requesterId,
  conversationId,
});

class TestIsolationProvider extends AgentIsolationProvider {
  constructor() {
    super('admission-test-provider');
  }

  async acquire(input: AgentIsolationAcquireInput) {
    await this.validateRequest(input);
    return this.issueLease({
      subject: input.subject,
      workspace: input.workspace,
      protectedRoots: input.protectedRoots,
      environmentOverrides: input.environmentOverrides,
      spawn: () => { throw new Error('admission tests use a fake runner'); },
    });
  }
}

class HoldingRunner {
  readonly calls: string[] = [];
  readonly cancellations: string[] = [];
  private readonly pending = new Map<string, { resolve: (result: CodexRunResult) => void; reject: (error: Error) => void }>();

  async run(options: { jobId: string }): Promise<CodexRunResult> {
    this.calls.push(options.jobId);
    return new Promise((resolve, reject) => this.pending.set(options.jobId, { resolve, reject }));
  }

  finish(jobId: string): void {
    this.pending.get(jobId)?.resolve({ threadId: '019fd700-51cd-7862-a4ef-74ccae0f2b4e', finalMessage: `done ${jobId}`, eventCount: 4 });
    this.pending.delete(jobId);
  }

  fail(jobId: string): void {
    this.pending.get(jobId)?.reject(new Error('synthetic runner failure'));
    this.pending.delete(jobId);
  }

  cancel(jobId: string): boolean {
    const pending = this.pending.get(jobId);
    if (!pending) return false;
    this.cancellations.push(jobId);
    pending.reject(new Error('synthetic cancellation'));
    this.pending.delete(jobId);
    return true;
  }

  close(): void {
    for (const jobId of [...this.pending.keys()]) this.cancel(jobId);
  }
}

class FailOnceJobStore extends AgentJobStore {
  private failed = false;

  override async create(input: Parameters<AgentJobStore['create']>[0]): ReturnType<AgentJobStore['create']> {
    if (!this.failed) {
      this.failed = true;
      throw new Error('synthetic create failure');
    }
    return super.create(input);
  }
}

class TerminalFailureOnceStore extends AgentJobStore {
  terminalAttempts = 0;

  override async update(
    id: Parameters<AgentJobStore['update']>[0],
    scopeValue: Parameters<AgentJobStore['update']>[1],
    patch: Parameters<AgentJobStore['update']>[2],
  ): ReturnType<AgentJobStore['update']> {
    if ((patch.status === 'completed' || patch.status === 'failed') && this.terminalAttempts === 0) {
      this.terminalAttempts += 1;
      throw new Error('synthetic terminal persistence failure');
    }
    return super.update(id, scopeValue, patch);
  }
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-agent-admission-'));
try {
  assert.throws(
    () => new AgentAdmissionController({ globalLimit: 2, perTenantLimit: 3, perRequesterLimit: 1 }),
    /requester.*tenant|tenant.*global/i,
  );
  assert.throws(
    () => new AgentAdmissionController({ globalLimit: Number.MAX_SAFE_INTEGER, perTenantLimit: 2, perRequesterLimit: 1 }),
    /finite|maximum|bounded/i,
  );
  const publicCapacity = new AgentCapacityError({
    ok: false,
    code: 'AGENT_CAPACITY_EXCEEDED',
    dimension: 'global',
    limit: 3,
    retryable: true,
  }).toPublic();
  assert.deepEqual(publicCapacity, {
    code: 'AGENT_CAPACITY_EXCEEDED',
    dimension: 'global',
    limit: 3,
    retryable: true,
  }, 'capacity mapper is top-level typed data without the internal ok/error wrapper');

  const journalPath = path.join(root, 'admission.json');
  const controller = new AgentAdmissionController(
    { globalLimit: 3, perTenantLimit: 2, perRequesterLimit: 1 },
    { journalPath, retryLeaseMs: 1000 },
  );
  await controller.initialize();
  const concurrent = await Promise.all([
    controller.tryAcquire(scope('tenant-a', 'user-a')),
    controller.tryAcquire(scope('tenant-a', 'user-a')),
    controller.tryAcquire(scope('tenant-a', 'user-b')),
    controller.tryAcquire(scope('tenant-b', 'user-c')),
    controller.tryAcquire(scope('tenant-c', 'user-d')),
  ]);
  assert.equal(concurrent.filter((result) => result.ok).length, 3, 'Promise.all never oversubscribes global capacity');
  assert.deepEqual(
    concurrent.filter((result) => !result.ok).map((result) => result.ok ? undefined : result.dimension).sort(),
    ['global', 'requester'],
  );
  const leases = concurrent.filter((result): result is Extract<typeof result, { ok: true }> => result.ok).map((result) => result.lease);
  await Promise.all(leases.map((lease) => lease.release()));
  assert.equal(controller.snapshot().global, 0, 'release is durable and idempotent');

  // This mirrors the production default: global=4, tenant=2, requester=2.
  const productionPolicy = new AgentAdmissionController(
    { globalLimit: 4, perTenantLimit: 2, perRequesterLimit: 2 },
    { journalPath: path.join(root, 'production-default-admission.json') },
  );
  const productionFirst = await productionPolicy.tryAcquire(scope('tenant-production', 'requester-production'));
  const productionSecond = await productionPolicy.tryAcquire(scope('tenant-production', 'requester-production'));
  assert.equal(productionFirst.ok, true, 'production policy admits the first same-scope child');
  assert.equal(productionSecond.ok, true, 'production policy admits a second same-scope child');
  const productionThird = await productionPolicy.tryAcquire(scope('tenant-production', 'requester-production'));
  assert.deepEqual(productionThird, {
    ok: false,
    code: 'AGENT_CAPACITY_EXCEEDED',
    dimension: 'requester',
    limit: 2,
    retryable: true,
  });
  if (productionFirst.ok) await productionFirst.lease.release();
  if (productionSecond.ok) await productionSecond.lease.release();

  const configuredLowerLimit = new AgentAdmissionController(
    { globalLimit: 4, perTenantLimit: 2, perRequesterLimit: 1 },
    { journalPath: path.join(root, 'configured-lower-admission.json') },
  );
  const lowerFirst = await configuredLowerLimit.tryAcquire(scope('tenant-lower', 'requester-lower'));
  assert.equal(lowerFirst.ok, true);
  const lowerSecond = await configuredLowerLimit.tryAcquire(scope('tenant-lower', 'requester-lower'));
  assert.deepEqual(lowerSecond, {
    ok: false,
    code: 'AGENT_CAPACITY_EXCEEDED',
    dimension: 'requester',
    limit: 1,
    retryable: true,
  }, 'an explicit lower requester limit rejects the second same-scope child');
  if (lowerFirst.ok) await lowerFirst.lease.release();

  const durable = await controller.tryAcquire(scope('tenant-durable', 'user-durable'));
  assert.equal(durable.ok, true);
  if (!durable.ok) throw new Error('durable test reservation was unexpectedly rejected');
  await durable.lease.bindJob('durable-job');
  await durable.lease.markTerminalPending();
  await durable.lease.markUnresolved('CLEANUP_PENDING');
  const restarted = new AgentAdmissionController(
    { globalLimit: 3, perTenantLimit: 2, perRequesterLimit: 1 },
    { journalPath },
  );
  await restarted.initialize();
  assert.equal(restarted.snapshot().global, 1, 'restart reconstructs the unresolved durable reservation');
  await restarted.recoverUnresolved('durable-job');
  assert.equal(restarted.snapshot().global, 0, 'operator recovery releases only the affected durable lease');

  await restarted.close();
  const closed = await restarted.tryAcquire(scope('tenant-z', 'user-z'));
  assert.deepEqual(closed, {
    ok: false,
    code: 'AGENT_ADMISSION_CLOSED',
    dimension: 'closing',
    limit: 0,
    retryable: false,
  });

  const workspace = path.join(root, 'workspace');
  await fs.mkdir(path.join(workspace, 'src'), { recursive: true });
  await fs.writeFile(path.join(workspace, 'src', 'visible.ts'), 'export const visible = true;\n', 'utf8');
  const provider = new TestIsolationProvider();
  const serviceScope = jobScope('tenant-service', 'operator', 'conversation-a');
  const serviceJournal = path.join(root, 'service-admission.json');
  const serviceController = new AgentAdmissionController(
    { globalLimit: 2, perTenantLimit: 2, perRequesterLimit: 1 },
    { journalPath: serviceJournal },
  );
  const store = new AgentJobStore(path.join(root, 'jobs.json'));
  const runner = new HoldingRunner();
  const service = new AgentService(
    store,
    runner as unknown as CodexRunner,
    workspace,
    async () => undefined,
    new GitService(workspace),
    {
      canMutateScope: () => true,
      canReadScope: () => true,
      admissionController: serviceController,
      executionPolicy: new AgentExecutionPolicy(workspace, {
        canMutateScope: () => true,
        canReadScope: () => true,
        isolationProvider: provider,
      }),
    },
  );
  await service.initialize();
  const secondScope = { ...serviceScope, requesterId: 'operator-2', conversationId: 'conversation-b' };
  const jobs = await Promise.all([
    service.submit({ prompt: 'first', mode: 'read-only', scope: serviceScope }),
    service.submit({ prompt: 'second', mode: 'read-only', scope: secondScope }),
  ]);
  await assert.rejects(
    () => service.submit({ prompt: 'third', mode: 'read-only', scope: { ...serviceScope, tenantId: 'tenant-other', requesterId: 'other' } }),
    (error: unknown) => error instanceof AgentCapacityError && error.dimension === 'global',
  );
  assert.equal(store.listLocalOnly(20).length, 2, 'capacity rejection happens before job persistence');
  await waitFor(() => runner.calls.length === 2, 'admitted jobs did not reach the runner');
  for (const job of jobs) runner.finish(job.id);
  await waitFor(() => serviceController.snapshot().global === 0, 'terminal cleanup did not durably release all capacity');

  const cancelled = await service.submit({ prompt: 'cancel cleanup', mode: 'read-only', scope: serviceScope });
  await waitFor(() => runner.calls.includes(cancelled.id), 'cancel job did not reach the runner');
  await service.cancel(cancelled.id, serviceScope);
  assert.equal(store.get(cancelled.id, serviceScope)?.status, 'cancelled');
  assert.equal(serviceController.snapshot().global, 0, 'cancel waits for process cleanup before durable release');

  const failingController = new AgentAdmissionController(
    { globalLimit: 1, perTenantLimit: 1, perRequesterLimit: 1 },
    { journalPath: path.join(root, 'create-failure-admission.json') },
  );
  const failingService = new AgentService(
    new FailOnceJobStore(path.join(root, 'create-failure-jobs.json')),
    new HoldingRunner() as unknown as CodexRunner,
    workspace,
    async () => undefined,
    new GitService(workspace),
    {
      canMutateScope: () => true,
      canReadScope: () => true,
      admissionController: failingController,
      executionPolicy: new AgentExecutionPolicy(workspace, { canReadScope: () => true, canMutateScope: () => true, isolationProvider: provider }),
    },
  );
  await failingService.initialize();
  await assert.rejects(() => failingService.submit({ prompt: 'create fails', mode: 'read-only', scope: serviceScope }), /synthetic create failure/);
  assert.equal(failingController.snapshot().global, 0, 'create failure releases after cleanup');

  const terminalStore = new TerminalFailureOnceStore(path.join(root, 'terminal-failure-jobs.json'));
  const terminalController = new AgentAdmissionController(
    { globalLimit: 1, perTenantLimit: 1, perRequesterLimit: 1 },
    { journalPath: path.join(root, 'terminal-failure-admission.json') },
  );
  const terminalRunner = new HoldingRunner();
  const terminalService = new AgentService(
    terminalStore,
    terminalRunner as unknown as CodexRunner,
    workspace,
    async () => undefined,
    new GitService(workspace),
    {
      canMutateScope: () => true,
      canReadScope: () => true,
      admissionController: terminalController,
      executionPolicy: new AgentExecutionPolicy(workspace, { canReadScope: () => true, canMutateScope: () => true, isolationProvider: provider }),
    },
  );
  await terminalService.initialize();
  const unresolved = await terminalService.submit({ prompt: 'terminal persistence', mode: 'read-only', scope: serviceScope });
  await waitFor(() => terminalRunner.calls.length === 1, 'terminal persistence runner did not start');
  terminalRunner.finish(unresolved.id);
  await waitFor(() => terminalStore.terminalAttempts === 1, 'terminal persistence failure was not exercised');
  assert.equal(terminalController.snapshot().global, 1, 'unresolved terminal retains only its own capacity');
  await waitFor(() => Boolean(terminalStore.get(unresolved.id, serviceScope)?.error), 'unresolved terminal marker was not persisted');
  assert.match(terminalStore.get(unresolved.id, serviceScope)?.error ?? '', /RECONCILIATION_REQUIRED/);
  const recovered = await terminalService.reconcileTerminal(unresolved.id, serviceScope);
  assert.equal(recovered?.status, 'failed', 'operator reconciliation closes the unresolved job');
  assert.equal(terminalController.snapshot().global, 0, 'operator recovery releases the affected capacity');

  const restartJobsPath = path.join(root, 'restart-jobs.json');
  const restartJournalPath = path.join(root, 'restart-admission.json');
  const restartControllerA = new AgentAdmissionController(
    { globalLimit: 1, perTenantLimit: 1, perRequesterLimit: 1 },
    { journalPath: restartJournalPath },
  );
  const restartServiceA = new AgentService(
    new AgentJobStore(restartJobsPath),
    new HoldingRunner() as unknown as CodexRunner,
    workspace,
    async () => undefined,
    new GitService(workspace),
    {
      canMutateScope: () => true,
      canReadScope: () => true,
      admissionController: restartControllerA,
      executionPolicy: new AgentExecutionPolicy(workspace, { canReadScope: () => true, canMutateScope: () => true, isolationProvider: provider }),
    },
  );
  await restartServiceA.initialize();
  const waiting = await restartServiceA.submit({ prompt: 'await approval', mode: 'workspace-write', scope: serviceScope });
  assert.equal(waiting.status, 'awaiting_approval');
  const restartControllerB = new AgentAdmissionController(
    { globalLimit: 1, perTenantLimit: 1, perRequesterLimit: 1 },
    { journalPath: restartJournalPath },
  );
  const restartServiceB = new AgentService(
    new AgentJobStore(restartJobsPath),
    new HoldingRunner() as unknown as CodexRunner,
    workspace,
    async () => undefined,
    new GitService(workspace),
    {
      canMutateScope: () => true,
      canReadScope: () => true,
      admissionController: restartControllerB,
      executionPolicy: new AgentExecutionPolicy(workspace, { canReadScope: () => true, canMutateScope: () => true, isolationProvider: provider }),
    },
  );
  await restartServiceB.initialize();
  assert.equal(restartControllerB.snapshot().global, 1, 'restart reconstructs an awaiting approval reservation');
  await restartServiceB.cancelStrict(waiting.id, serviceScope);
  assert.equal(restartControllerB.snapshot().global, 0, 'cancel releases a reconstructed reservation');
  await Promise.all([service.close(), failingService.close(), terminalService.close(), restartServiceA.close(), restartServiceB.close()]);
} finally {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}

console.log('PASS: admission caps, durable journal phases, restart reconstruction, cleanup tracking, and operator recovery are fail-closed');
