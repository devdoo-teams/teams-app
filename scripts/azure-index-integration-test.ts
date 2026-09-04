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
import { AgentJobStore } from '../src/server/agent-job-store.js';
import { GitService } from '../src/server/git-service.js';
import {
  createAgentDispatchTaskFromJob,
  type AgentDispatchTask,
} from '../src/server/queue/agent-dispatch-queue.js';

const root = path.resolve(import.meta.dirname, '..');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'teamsapp-azure-index-'));

try {
  await verifyQueueOnlyAgentService();
  verifyCompiledAzureComposition();
  verifyIndexCompositionContract();
  console.log('PASS: Azure server composition is queue-only, reports truthful migration health, and binds provisioned Cosmos resources.');
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
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
