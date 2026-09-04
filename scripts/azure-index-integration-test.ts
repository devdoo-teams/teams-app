import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  AgentService,
  type AgentExecutionDispatcher,
} from '../src/server/agent-service.js';
import { AgentAdmissionController } from '../src/server/agent-admission-controller.js';
import {
  AgentJobStore,
  type AgentJob,
  type AgentJobDurableLedger,
  type AgentJobScope,
} from '../src/server/agent-job-store.js';
import {
  AzureAgentDispatchQueue,
  type AgentDispatchRecord,
  type AgentDispatchStatePort,
  type AzureQueueClientPort,
} from '../src/server/azure-agent-dispatch-queue.js';
import {
  CoreOrchestrationService,
  createServerDerivedCoreScope,
  type CoreOrchestrationServiceOptions,
} from '../src/server/core-orchestration-service.js';
import { GitService } from '../src/server/git-service.js';
import {
  createAgentDispatchTaskFromJob,
  createAgentDispatchTaskReferenceFromJob,
  type AgentDispatchTask,
  type AgentDispatchTaskReference,
} from '../src/server/queue/agent-dispatch-queue.js';

const root = path.resolve(import.meta.dirname, '..');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'teamsapp-azure-index-'));

async function verifyMeasuredAzureCoreSubmitGate(): Promise<void> {
  const scope: AgentJobScope = {
    tenantId: 'tenant-readiness',
    requesterId: 'requester-readiness',
    conversationId: 'conversation-readiness',
  };
  const ledger = createMemoryAgentJobLedger();
  const store = new AgentJobStore(path.join(temporaryRoot, 'measured-agent-jobs.json'), {
    legacyProvider: 'codex',
    durableLedger: ledger,
  });
  const state = new MemoryDispatchState();
  const client = new MemoryQueueClient();
  let nowMs = Date.parse('2026-09-03T00:00:00.000Z');
  const queue = new AzureAgentDispatchQueue(client, state, {
    clock: { now: () => new Date(nowMs) },
  });
  const dispatcher = createMeasuredQueueDispatcher(queue);
  const runner = {
    run() { throw new Error('Azure first-submit integration must not invoke a local CLI'); },
    cancel() {},
    close() {},
  };
  const executionPolicy = {
    authorize: () => ({ allowed: true }),
    async prepareWorkspace() { throw new Error('Azure dispatch must not prepare a local workspace'); },
  };
  const agentService = new AgentService(
    store,
    runner as never,
    temporaryRoot,
    async () => undefined,
    new GitService(temporaryRoot),
    {
      executionPolicy: executionPolicy as never,
      executionDispatcher: dispatcher,
      canReadScope: () => true,
      canMutateScope: () => true,
      admissionController: new AgentAdmissionController({ globalLimit: 4, perTenantLimit: 4, perRequesterLimit: 4 }),
    },
  );
  await agentService.initialize();
  assert.equal(ledger.jobs.length, 0, 'first-submit test must start with an empty durable AgentJob ledger');
  assert.equal(state.records.size, 0, 'first-submit test must start with no durable dispatch records');
  const options: CoreOrchestrationServiceOptions = {
    agentService,
    jobStore: store,
    defaultProvider: 'codex',
    observeProviderFact: async ({ provider }) => {
      const health = await queue.readHealth();
      const available = health.submissionReadiness.state === 'ready';
      return {
        provider,
        availability: available ? 'available' : 'unavailable',
        capabilities: available ? ['approve', 'cancel', 'retry', 'submit'] : [],
        observedAt: health.submissionReadiness.observedAt,
        source: 'runtime-observation',
      };
    },
  };
  const service = new CoreOrchestrationService(options);
  const serverScope = createServerDerivedCoreScope(scope);

  client.reachable = false;
  await assert.rejects(
    service.submit(serverScope, {
      idempotencyKey: 'azure-readiness-queue-unreachable',
      prompt: 'must remain fail closed when Queue Storage is unreachable',
      mode: 'read-only',
    }),
    providerUnavailable,
    'unreachable Queue Storage must reject before creating durable work',
  );
  assert.equal(ledger.jobs.length, 0);
  assert.equal(state.records.size, 0);
  assert.equal(client.messages.length, 0);

  client.reachable = true;
  state.reachable = false;
  await assert.rejects(
    service.submit(serverScope, {
      idempotencyKey: 'azure-readiness-state-unreachable',
      prompt: 'must remain fail closed when durable state is unreachable',
      mode: 'read-only',
    }),
    providerUnavailable,
    'unreachable durable state must reject before creating durable work',
  );
  assert.equal(ledger.jobs.length, 0);
  assert.equal(state.records.size, 0);
  assert.equal(client.messages.length, 0);

  state.reachable = true;
  const first = await service.submit(serverScope, {
    idempotencyKey: 'azure-first-submit-empty-ledger',
    prompt: 'enqueue from an empty durable ledger when submission dependencies are reachable',
    mode: 'read-only',
  });
  assert.equal(first.replayed, false);
  assert.equal(ledger.jobs.some((job) => job.id === first.job.id), true, 'first Core submit persists through the durable ledger');
  assert.equal(state.records.has(first.job.id), true, 'first Core submit creates a canonical dispatch record');
  assert.equal(client.messages.length, 1, 'first Core submit sends one real queue message through AzureAgentDispatchQueue');

  const lease = await queue.lease({ visibilityTimeoutSeconds: 30 });
  assert.ok(lease, 'the first enqueued task must be leaseable by the real queue implementation');
  const heartbeatLease = await queue.heartbeat(lease, { sequence: 1, message: 'worker heartbeat' }, 30);
  await queue.complete(heartbeatLease, { result: 'first task completed', providerExecutionId: 'worker-execution-1' });
  const completed = await agentService.observe(first.job.id, scope);
  assert.equal(completed?.status, 'completed');

  nowMs += 30_001;
  const idleHealth = await queue.readHealth({
    taskReference: createAgentDispatchTaskReferenceFromJob(completed!),
    maximumHeartbeatAgeMs: 30_000,
  });
  assert.equal(idleHealth.workerHeartbeat.state, 'stale', 'execution-plane heartbeat is truthful after 30 seconds idle');
  assert.equal(idleHealth.readiness.state, 'unavailable', 'idle worker execution liveness is not fabricated');
  assert.equal(idleHealth.submissionReadiness.state, 'ready', 'idle execution does not invalidate reachable submission dependencies');

  const second = await service.submit(serverScope, {
    idempotencyKey: 'azure-submit-after-idle',
    prompt: 'enqueue after successful prior work has been idle for more than 30 seconds',
    mode: 'read-only',
  });
  assert.equal(second.replayed, false);
  assert.equal(client.messages.length, 1, 'idle resubmission enqueues a new task after the prior message was completed');
  assert.equal(ledger.jobs.some((job) => job.id === second.job.id), true);
  await agentService.close();
}

function createMemoryAgentJobLedger(): AgentJobDurableLedger & { jobs: AgentJob[] } {
  return {
    jobs: [],
    async load(): Promise<unknown> {
      return structuredClone(this.jobs);
    },
    async persist(_previousJobs: readonly AgentJob[], nextJobs: readonly AgentJob[]): Promise<void> {
      this.jobs = structuredClone([...nextJobs]);
    },
  };
}

class MemoryDispatchState implements AgentDispatchStatePort {
  readonly records = new Map<string, AgentDispatchRecord>();
  reachable = true;

  async create(record: AgentDispatchRecord): Promise<'created' | 'exists'> {
    if (this.records.has(record.taskId)) return 'exists';
    this.records.set(record.taskId, structuredClone(record));
    return 'created';
  }

  async get(reference: AgentDispatchTaskReference): Promise<AgentDispatchRecord | undefined> {
    const record = this.records.get(reference.taskId);
    return record ? structuredClone(record) : undefined;
  }

  async compareAndSwap(
    reference: AgentDispatchTaskReference,
    expected: { leaseOwner?: string; leaseGeneration: number },
    mutate: (current: AgentDispatchRecord) => AgentDispatchRecord,
  ): Promise<AgentDispatchRecord | undefined> {
    const current = this.records.get(reference.taskId);
    if (!current
      || current.leaseOwner !== expected.leaseOwner
      || current.leaseGeneration !== expected.leaseGeneration) return undefined;
    const next = mutate(structuredClone(current));
    this.records.set(reference.taskId, structuredClone(next));
    return structuredClone(next);
  }

  async probeDependency(): Promise<{ reachable: true }> {
    if (!this.reachable) throw new Error('durable state unavailable');
    return { reachable: true };
  }

  async readWorkerHeartbeat(reference: AgentDispatchTaskReference) {
    const checkpoint = this.records.get(reference.taskId)?.checkpoint;
    return checkpoint?.message === 'worker heartbeat'
      ? { observedAt: checkpoint.recordedAt, source: 'durable-dispatch-lease-renewal' }
      : undefined;
  }
}

class MemoryQueueClient implements AzureQueueClientPort {
  readonly messages: Array<{
    messageId: string;
    popReceipt: string;
    messageText: string;
    dequeueCount: number;
  }> = [];
  reachable = true;
  private sequence = 0;

  async probeDependency(): Promise<{ reachable: true }> {
    if (!this.reachable) throw new Error('Queue Storage unavailable');
    return { reachable: true };
  }

  async sendMessage(messageText: string) {
    if (!this.reachable) throw new Error('Queue Storage unavailable');
    this.sequence += 1;
    const messageId = `message-${this.sequence}`;
    this.messages.push({ messageId, popReceipt: `receipt-${this.sequence}-0`, messageText, dequeueCount: 0 });
    return { messageId };
  }

  async receiveMessage() {
    const message = this.messages[0];
    if (!message) return undefined;
    message.dequeueCount += 1;
    return structuredClone(message);
  }

  async updateMessage(messageId: string, popReceipt: string) {
    const message = this.messages.find((candidate) => candidate.messageId === messageId);
    assert.equal(message?.popReceipt, popReceipt);
    const nextPopReceipt = `${popReceipt}-next`;
    message!.popReceipt = nextPopReceipt;
    return { popReceipt: nextPopReceipt };
  }

  async deleteMessage(messageId: string, popReceipt: string) {
    const index = this.messages.findIndex((candidate) => candidate.messageId === messageId);
    assert.notEqual(index, -1);
    assert.equal(this.messages[index]?.popReceipt, popReceipt);
    this.messages.splice(index, 1);
  }

  async sendPoisonMessage() {}
}

function createMeasuredQueueDispatcher(queue: AzureAgentDispatchQueue): AgentExecutionDispatcher {
  return {
    kind: 'azure-queue',
    async dispatch(job) {
      await queue.enqueue(createAgentDispatchTaskFromJob(job));
    },
    async observe(job) {
      const record = await queue.observe(createAgentDispatchTaskReferenceFromJob(job));
      if (!record) return undefined;
      if (record.status === 'leased') return { status: 'running' };
      if (record.status === 'completed') {
        return {
          status: 'completed',
          result: record.receipt?.result,
          providerExecutionId: record.receipt?.providerExecutionId,
        };
      }
      if (record.status === 'failed') return { status: 'failed', error: record.error?.message };
      if (record.status === 'cancelled') return { status: 'cancelled' };
      if (record.status === 'quarantined') return { status: 'quarantined', error: record.quarantineReason };
      return { status: 'queued' };
    },
    async cancel(job, reason) {
      await queue.requestCancellation(createAgentDispatchTaskReferenceFromJob(job), reason);
    },
  };
}

function providerUnavailable(error: unknown): boolean {
  return Boolean(error && typeof error === 'object'
    && (error as { code?: unknown }).code === 'CORE_ORCHESTRATION_PROVIDER_UNAVAILABLE');
}

async function verifyQueueOnlyAgentService(): Promise<void> {
  let runnerRuns = 0;
  let runnerCancels = 0;
  let workspacePreflights = 0;
  const dispatched: string[] = [];
  const dispatchedTasks: AgentDispatchTask[] = [];
  const cancelled: string[] = [];
  const observations = new Map<string, Awaited<ReturnType<AgentExecutionDispatcher['observe']>>>();

  const dispatcher: AgentExecutionDispatcher = {
    kind: 'azure-queue',
    async dispatch(job) {
      dispatched.push(job.id);
      dispatchedTasks.push(createAgentDispatchTaskFromJob(job));
    },
    async observe(job) {
      return observations.get(job.id);
    },
    async cancel(job) {
      cancelled.push(job.id);
    },
  };
  const runner = {
    run() {
      runnerRuns += 1;
      throw new Error('queue-only mode must not run a local CLI');
    },
    cancel() {
      runnerCancels += 1;
    },
    close() {},
  };
  const executionPolicy = {
    authorize: () => ({ allowed: true }),
    async prepareWorkspace() {
      workspacePreflights += 1;
      throw new Error('queue-only mode must not prepare a local execution workspace');
    },
  };
  const store = new AgentJobStore(path.join(temporaryRoot, 'agent-jobs.json'), { legacyProvider: 'codex' });
  const service = new AgentService(
    store,
    runner as never,
    temporaryRoot,
    async () => undefined,
    new GitService(temporaryRoot),
    {
      executionPolicy: executionPolicy as never,
      executionDispatcher: dispatcher,
      canReadScope: () => true,
      canMutateScope: () => true,
      admissionController: new AgentAdmissionController({ globalLimit: 4, perTenantLimit: 4, perRequesterLimit: 4 }),
    },
  );
  await service.initialize();

  const scope = { tenantId: 'tenant-a', requesterId: 'requester-a', conversationId: 'conversation-a' };
  const job = await service.submit({ prompt: 'queue this task', mode: 'read-only', scope, notify: false });
  assert.deepEqual(dispatched, [job.id], 'queue mode submits through the durable dispatcher');
  assert.deepEqual(dispatchedTasks[0]?.execution, {
    mode: 'read-only',
    workspaceReference: 'teams-core-worker-workspace',
    isolationReference: 'linux-read-only-required',
  }, 'server dispatch preserves read-only mode and its required Linux isolation reference');
  assert.equal(runnerRuns, 0, 'queue mode never invokes the local CLI runner');
  assert.equal(workspacePreflights, 0, 'queue mode never performs local workspace/native preflight');

  observations.set(job.id, {
    status: 'completed',
    result: 'durable worker result',
    providerExecutionId: 'worker-execution-1',
  });
  const completed = await service.observe(job.id, scope);
  assert.equal(completed?.status, 'completed');
  assert.equal(completed?.result, 'durable worker result');
  assert.equal(completed?.threadId, undefined, 'provider execution identity must not be relabeled as a CLI conversation thread');

  const cancellable = await service.submit({ prompt: 'cancel this task', mode: 'read-only', scope, notify: false });
  const cancelledJob = await service.cancelStrict(cancellable.id, scope, { notify: false });
  assert.equal(cancelledJob?.status, 'cancelled');
  assert.deepEqual(cancelled, [cancellable.id], 'queue mode requests cancellation through the durable dispatcher');
  assert.equal(runnerCancels, 0, 'queue mode never signals a local CLI runner');

  const writable = await service.submit({ prompt: 'approved write task', mode: 'workspace-write', scope, notify: false });
  assert.equal(writable.status, 'awaiting_approval');
  await service.approve(writable.id, scope);
  assert.deepEqual(dispatchedTasks.at(-1)?.execution, {
    mode: 'workspace-write',
    workspaceReference: 'teams-core-worker-workspace',
  }, 'approved workspace-write mode remains explicit across server dispatch');
  await service.close();
}

function verifyCompiledAzureComposition(): void {
  const bicep = process.env.BICEP_BIN?.trim() || 'bicep';
  const output = path.join(temporaryRoot, 'main.json');
  execFileSync(bicep, ['build', path.join(root, 'infra/azure/main.bicep'), '--outfile', output], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const template = JSON.parse(fs.readFileSync(output, 'utf8')) as { resources?: unknown[]; outputs?: Record<string, unknown> };
  const resources = collectResources(template);
  const database = resources.find((resource) => resource.type === 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases');
  const container = resources.find((resource) => resource.type === 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers');
  assert.ok(database, 'Cosmos SQL database must be provisioned');
  assert.deepEqual(container?.properties?.resource?.partitionKey?.paths, ['/partitionKey']);

  const app = resources.find((resource) => resource.type === 'Microsoft.App/containerApps');
  const core = app?.properties?.template?.containers?.find((candidate: { name?: string }) => candidate.name === 'teams-core');
  const env = new Map((core?.env ?? []).map((entry: { name: string; value?: string; secretRef?: string }) => [entry.name, entry]));
  for (const name of [
    'TEAMS_STORAGE_BACKEND',
    'AZURE_COSMOS_ENDPOINT',
    'AZURE_COSMOS_DATABASE',
    'AZURE_COSMOS_CONTAINER',
    'TEAMS_AGENT_DISPATCH_MODE',
    'AZURE_STORAGE_QUEUE_ENDPOINT',
    'AZURE_STORAGE_POISON_QUEUE_ENDPOINT',
  ]) {
    assert.ok(env.has(name), `Container App must bind ${name}`);
  }
  assert.equal(env.get('TEAMS_STORAGE_BACKEND')?.value, 'cosmos');
  assert.equal(env.get('TEAMS_AGENT_DISPATCH_MODE')?.value, 'azure-queue');
  assert.ok(template.outputs?.cosmosEndpoint);
  assert.ok(template.outputs?.cosmosDatabase);
  assert.ok(template.outputs?.cosmosContainer);
}

function verifyIndexCompositionContract(): void {
  const source = fs.readFileSync(path.join(root, 'src/server/index.ts'), 'utf8');
  assert.match(source, /TEAMS_AGENT_DISPATCH_MODE/);
  assert.match(source, /createRuntimeStore/);
  assert.match(source, /createProductionAzureQueueClient/);
  assert.match(source, /createAgentDispatchSubmissionPort/);
  assert.match(source, /authoritativeStores/);
  assert.match(source, /migrated:\s*0/);
  assert.match(source, /total:\s*11/);
  assert.match(source, /horizontalSafe:\s*false/);
}

function collectResources(value: unknown, result: Array<Record<string, any>> = []): Array<Record<string, any>> {
  if (!value || typeof value !== 'object') return result;
  const record = value as Record<string, any>;
  for (const resource of record.resources ?? []) {
    result.push(resource);
    collectResources(resource?.properties?.template, result);
  }
  return result;
}

try {
  await verifyQueueOnlyAgentService();
  await verifyMeasuredAzureCoreSubmitGate();
  verifyCompiledAzureComposition();
  verifyIndexCompositionContract();
  console.log('PASS: Azure Core first-submit measures submission dependencies independently from worker execution liveness.');
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
