import { strict as assert } from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AgentJobStore, type AgentJob, type AgentJobScope } from '../src/server/agent-job-store.js';
import { AgentService, type AgentExecutionDispatcher } from '../src/server/agent-service.js';
import { GitService } from '../src/server/git-service.js';
import {
  canonicalRequestHash,
  CoreOrchestrationService,
  createServerDerivedCoreScope,
} from '../src/server/core-orchestration-service.js';
import {
  CoreOrchestrationIdempotencyConflictError,
  CoreOrchestrationValidationError,
} from '../src/shared/core-orchestration.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-core-orchestration-'));
const store = new AgentJobStore(path.join(root, 'agent-jobs.json'));
await store.initialize();

let submitCalls = 0;
let executionLaunches = 0;
const agentService = {
  submit: async (input: {
    prompt: string;
    provider?: 'codex' | 'copilot';
    mode: 'read-only' | 'workspace-write';
    scope: AgentJobScope;
    idempotencyKey?: string;
    requestHash?: string;
  }): Promise<AgentJob> => {
    submitCalls += 1;
    const job = await store.create({
      prompt: input.prompt,
      provider: input.provider ?? 'codex',
      mode: input.mode,
      scope: input.scope,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
    });
    executionLaunches += 1;
    return job;
  },
  get: (id: string, scope: AgentJobScope) => store.get(id, scope),
  list: (scope: AgentJobScope, limit?: number) => store.list(scope, limit),
  cancelStrict: async (id: string, scoped: AgentJobScope) => store.update(id, scoped, {
    status: 'cancelled',
    finishedAt: new Date().toISOString(),
  }),
  approve: async (id: string, scoped: AgentJobScope) => store.update(id, scoped, { status: 'queued' }),
  retry: async (id: string, scoped: AgentJobScope) => {
    const previous = store.get(id, scoped);
    if (!previous) return undefined;
    return store.create({
      prompt: previous.prompt,
      provider: previous.provider ?? 'codex',
      mode: previous.mode,
      scope: scoped,
      parentJobId: previous.id,
      threadId: previous.threadId,
    });
  },
};

const service = new CoreOrchestrationService({ agentService, jobStore: store });
const scope = createServerDerivedCoreScope({
  tenantId: 'tenant-a',
  requesterId: 'requester-a',
  conversationId: 'conversation-a',
});
assert.throws(
  () => createServerDerivedCoreScope({ tenantId: 'tenant-a' } as AgentJobScope),
  (error: unknown) => error instanceof CoreOrchestrationValidationError,
  'all three server-derived scope dimensions are mandatory at runtime',
);
const request = {
  idempotencyKey: 'submission-1',
  prompt: 'inspect the current repository',
  provider: 'codex' as const,
  mode: 'read-only' as const,
};

const first = await service.submit(scope, request);
assert.equal(first.job.idempotencyKey, request.idempotencyKey, 'scoped job DTO retains its durable replay identity');
const replay = await service.submit(scope, { ...request });
assert.equal(replay.replayed, true);
assert.equal(replay.job.id, first.job.id);
assert.equal(submitCalls, 1, 'an active replay is resolved before AgentService admission or dispatch');
assert.equal(executionLaunches, 1, 'an idempotent replay does not launch duplicate execution');

await assert.rejects(
  service.submit(scope, { ...request, prompt: 'different payload' }),
  (error: unknown) => error instanceof CoreOrchestrationIdempotencyConflictError,
);

const canonicalA = canonicalRequestHash({ prompt: 'same', provider: 'codex', mode: 'read-only' });
const canonicalB = canonicalRequestHash({ mode: 'read-only', provider: 'codex', prompt: 'same' });
assert.equal(canonicalA, canonicalB, 'request hash is independent of object insertion order');
assert.match(first.requestHash, /^[a-f0-9]{64}$/u);

const otherConversation = createServerDerivedCoreScope({
  ...scope,
  conversationId: 'conversation-b',
});
const otherRequester = createServerDerivedCoreScope({
  ...scope,
  requesterId: 'requester-b',
});
const otherTenant = createServerDerivedCoreScope({
  ...scope,
  tenantId: 'tenant-b',
});
for (const isolatedScope of [otherConversation, otherRequester, otherTenant]) {
  const isolated = await service.submit(isolatedScope, request);
  assert.notEqual(isolated.job.id, first.job.id, 'each server-derived scope dimension isolates idempotency');
  assert.equal(service.get(isolatedScope, { jobId: first.job.id }), undefined);
  assert.equal(service.list(isolatedScope).some((job) => job.id === first.job.id), false);
}

await assert.rejects(
  service.submit(scope, { ...request, tenantId: 'attacker-selected' } as typeof request),
  (error: unknown) => error instanceof CoreOrchestrationValidationError,
);
await assert.rejects(
  service.submit(scope, { ...request, idempotencyKey: 'invalid\u0000key' }),
  (error: unknown) => error instanceof CoreOrchestrationValidationError,
);
await assert.rejects(
  service.submit(scope, { ...request, prompt: 'p'.repeat(2_001) }),
  (error: unknown) => error instanceof CoreOrchestrationValidationError,
);
assert.throws(
  () => createServerDerivedCoreScope({ ...scope, tenantId: 't'.repeat(257) }),
  (error: unknown) => error instanceof CoreOrchestrationValidationError,
);
assert.throws(
  () => service.get(scope as never, { jobId: first.job.id, conversationId: 'attacker-selected' } as never),
  (error: unknown) => error instanceof CoreOrchestrationValidationError,
);

const workspaceJob = await service.submit(scope, {
  idempotencyKey: 'workspace-job',
  prompt: 'make an approved change',
  provider: 'codex',
  mode: 'workspace-write',
});
assert.equal(workspaceJob.job.status, 'awaiting_approval');
assert.equal((await service.approve(scope, { jobId: workspaceJob.job.id }))?.status, 'queued');
assert.equal((await service.cancel(scope, { jobId: workspaceJob.job.id }))?.status, 'cancelled');

const failed = await service.submit(scope, {
  idempotencyKey: 'failed-job',
  prompt: 'retry this operation',
  mode: 'read-only',
});
await store.update(failed.job.id, scope, {
  status: 'failed',
  error: 'measured failure',
  finishedAt: new Date().toISOString(),
});
const retried = await service.retry(scope, { jobId: failed.job.id });
assert.equal(retried?.parentJobId, failed.job.id);

const inputBoundary = await service.provideInput(scope, {
  jobId: first.job.id,
  input: { answer: 'operator supplied' },
});
assert.deepEqual(inputBoundary, {
  status: 'unsupported',
  job: first.job,
  reason: 'agent-service-does-not-support-input',
});
assert.equal(await service.provideInput(otherTenant, { jobId: first.job.id, input: 'hidden' }), undefined);

const observedAt = new Date().toISOString();
const factsService = new CoreOrchestrationService({
  agentService,
  jobStore: store,
  observeProviderFacts: () => [{
    provider: 'codex',
    availability: 'unknown',
    capabilities: ['submit'],
    observedAt,
    source: 'runtime-probe',
    configured: true,
    fixture: true,
  } as never],
});
const facts = factsService.listProviderFacts();
assert.deepEqual(facts, [{
  provider: 'codex',
  availability: 'unknown',
  capabilities: ['submit'],
  observedAt,
  source: 'runtime-probe',
}]);
assert.equal('configured' in facts[0]!, false, 'configuration is never projected as live availability');
assert.throws(
  () => new CoreOrchestrationService({
    agentService,
    jobStore: store,
    observeProviderFacts: () => [{
      provider: 'fixture',
      availability: 'available',
      capabilities: [],
      observedAt,
      source: 'fixture',
    } as never],
  }).listProviderFacts(),
  (error: unknown) => error instanceof CoreOrchestrationValidationError,
);

const restartedStore = new AgentJobStore(path.join(root, 'agent-jobs.json'));
await restartedStore.initialize();
let restartedSubmits = 0;
const restartedService = new CoreOrchestrationService({
  jobStore: restartedStore,
  agentService: {
    ...agentService,
    submit: async (input) => {
      restartedSubmits += 1;
      return restartedStore.create({
        prompt: input.prompt,
        provider: input.provider ?? 'codex',
        mode: input.mode,
        scope: input.scope,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
      });
    },
    get: (id, scoped) => restartedStore.get(id, scoped),
    list: (scoped, limit) => restartedStore.list(scoped, limit),
  },
});
const restartedReplay = await restartedService.submit(scope, request);
assert.equal(restartedReplay.replayed, true);
assert.equal(restartedReplay.job.id, first.job.id);
assert.equal(restartedSubmits, 0, 'restart replay is resolved from durable store state before admission');

const concurrentRequest = { ...request, idempotencyKey: 'concurrent-submission' };
const concurrent = await Promise.all([
  restartedService.submit(scope, concurrentRequest),
  restartedService.submit(scope, concurrentRequest),
]);
assert.equal(new Set(concurrent.map((result) => result.job.id)).size, 1);
assert.deepEqual(concurrent.map((result) => result.replayed).sort(), [false, true]);
assert.equal(restartedStore.list(scope, 100).filter((job) => job.idempotencyKey === concurrentRequest.idempotencyKey).length, 1);

const integrationStore = new AgentJobStore(path.join(root, 'integration-agent-jobs.json'));
let integrationDispatches = 0;
const dispatcher: AgentExecutionDispatcher = {
  kind: 'azure-queue',
  async dispatch() { integrationDispatches += 1; },
  async observe() { return undefined; },
  async cancel() {},
};
const integrationAgentService = new AgentService(
  integrationStore,
  undefined,
  root,
  async () => undefined,
  new GitService(root),
  {
    canReadScope: () => true,
    canMutateScope: () => true,
    admissionJournalPath: path.join(root, 'integration-admission.json'),
    executionDispatcher: dispatcher,
  },
);
await integrationAgentService.initialize();
const integrationService = new CoreOrchestrationService({
  agentService: integrationAgentService,
  jobStore: integrationStore,
});
const integrationScope = createServerDerivedCoreScope({
  tenantId: 'integration-tenant',
  requesterId: 'integration-requester',
  conversationId: 'integration-conversation',
});
const integrationRequest = {
  idempotencyKey: 'integration-replay',
  prompt: 'dispatch exactly once',
  mode: 'read-only' as const,
};
const integrationFirst = await integrationService.submit(integrationScope, integrationRequest);
const integrationReplay = await integrationService.submit(integrationScope, integrationRequest);
assert.equal(integrationReplay.job.id, integrationFirst.job.id);
assert.equal(integrationReplay.replayed, true);
assert.equal(integrationDispatches, 1, 'active exact replay bypasses admission and external dispatch');
await integrationService.cancel(integrationScope, { jobId: integrationFirst.job.id });
await integrationAgentService.close();

const malformedStorePath = path.join(root, 'malformed-agent-jobs.json');
await fs.writeFile(malformedStorePath, JSON.stringify([{
  id: 'task-malformed-idempotency',
  prompt: 'invalid persisted idempotency',
  provider: 'codex',
  mode: 'read-only',
  status: 'queued',
  conversationId: scope.conversationId,
  requesterId: scope.requesterId,
  tenantId: scope.tenantId,
  idempotencyKey: ' non-canonical-key',
  requestHash: 'a'.repeat(64),
  progress: [],
  createdAt: new Date().toISOString(),
}]));
await assert.rejects(
  new AgentJobStore(malformedStorePath).initialize(),
  /idempotencyKey/u,
  'persisted idempotency keys must retain the same canonical validation as new writes',
);

console.log('PASS: core orchestration service enforces scoped DTOs, strict mutations, durable idempotency, input boundary, and measured provider facts');
