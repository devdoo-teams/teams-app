import { strict as assert } from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { observeTeamsCliTestCatalog, teamsCliTestCatalog, teamsCliTestSelection } from './fixtures/teams-cli-agent-policy-fixture.js';
import { AgentJobStore, type AgentJob, type AgentJobScope } from '../src/server/agent-job-store.js';
import { AgentService, type AgentExecutionDispatcher } from '../src/server/agent-service.js';
import { GitService } from '../src/server/git-service.js';
import type { CoreResultOrigin } from '../src/server/core-result-publication.js';
import {
  canonicalRequestHash,
  CoreOrchestrationService,
  createServerDerivedCoreScope,
} from '../src/server/core-orchestration-service.js';
import type { CoreCodexReasoningEffort } from '../src/shared/core-orchestration.js';
import {
  CoreOrchestrationIdempotencyConflictError,
  CoreOrchestrationValidationError,
} from '../src/shared/core-orchestration.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-core-orchestration-'));
const store = new AgentJobStore(path.join(root, 'agent-jobs.json'));
await store.initialize();

const measuredProviderFacts = () => [{
  provider: 'codex',
  availability: 'available' as const,
  capabilities: ['approve', 'cancel', 'retry', 'submit'],
  observedAt: '2026-09-04T00:00:00.000Z',
  source: 'runtime-observation' as const,
}];
const modelCatalog = teamsCliTestCatalog;

let submitCalls = 0;
let executionLaunches = 0;
let continueCalls = 0;
let observedNotify: boolean | undefined;
const agentService = {
  submit: async (input: {
    prompt: string;
    provider?: 'codex' | 'copilot';
    mode: 'read-only' | 'workspace-write';
    scope: AgentJobScope;
    idempotencyKey?: string;
    requestHash?: string;
    model?: string;
    reasoningEffort?: CoreCodexReasoningEffort;
    catalogRevision?: string;
    notify?: boolean;
    resultOrigin?: CoreResultOrigin;
  }): Promise<AgentJob> => {
    submitCalls += 1;
    observedNotify = input.notify;
    const job = await store.create({
      prompt: input.prompt,
      provider: input.provider ?? 'codex',
      mode: input.mode,
      scope: input.scope,
      resultOrigin: input.resultOrigin,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      ...(input.model ? {
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        catalogRevision: input.catalogRevision,
      } : {}),
    });
    executionLaunches += 1;
    return job;
  },
  get: (id: string, scope: AgentJobScope) => store.get(id, scope),
  continue: async (id: string, prompt: string, scoped: AgentJobScope): Promise<AgentJob | undefined> => {
    continueCalls += 1;
    const previous = store.get(id, scoped);
    if (!previous?.threadId) return undefined;
    return store.create({
      prompt,
      provider: previous.provider ?? 'codex',
      mode: previous.mode,
      scope: scoped,
      parentJobId: previous.id,
      threadId: previous.threadId,
      model: previous.model, reasoningEffort: previous.reasoningEffort, catalogRevision: previous.catalogRevision,
    });
  },
  list: (scope: AgentJobScope, limit?: number) => store.list(scope, limit),
  cancelStrict: async (id: string, scoped: AgentJobScope) => store.update(id, scoped, {
    status: 'cancelled',
    finishedAt: new Date().toISOString(),
  }),
  approve: async (id: string, scoped: AgentJobScope) => store.update(id, scoped, { status: 'queued' }),
  decideApproval: store.decideApproval.bind(store),
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
      ...(previous.model ? {
        model: previous.model,
        reasoningEffort: previous.reasoningEffort,
        catalogRevision: previous.catalogRevision,
      } : {}),
    });
  },
};

const service = new CoreOrchestrationService({
  observeCodexModelCatalog: observeTeamsCliTestCatalog,
  agentService,
  jobStore: store,
  defaultProvider: 'codex',
  observeProviderFacts: measuredProviderFacts,
});
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

const origin: CoreResultOrigin = { schemaVersion: '1', source: 'authenticated-teams-activity',
  tenantId: scope.tenantId, requesterId: scope.requesterId, conversationId: 'original-private-chat',
  conversationType: 'personal', serviceUrl: 'https://smba.trafficmanager.net/amer/', activityId: 'origin-message' };
const privateRequest = { ...request, idempotencyKey: 'server-origin-private-review' };
const privateReview = await service.submit(scope, privateRequest, { notify: false, resultOrigin: origin });
assert.deepEqual(store.get(privateReview.job.id, scope)?.resultOrigin, origin,
  'server-provided original conversation is persisted with the private job');
assert.equal(observedNotify, false, 'private review retains the no-automatic-publication intent');
const privateReplay = await service.submit(scope, privateRequest, { resultOrigin: { ...origin, activityId: 'other-message' } });
assert.equal(privateReplay.job.id, privateReview.job.id);
assert.deepEqual(store.get(privateReview.job.id, scope)?.resultOrigin, origin,
  'a replay cannot replace the persisted publication destination');
await assert.rejects(service.submit(scope, { ...privateRequest, idempotencyKey: 'client-origin-injection', resultOrigin: origin } as any),
  'client payloads cannot set result origin authority');

const threaded = await store.create({
  ...teamsCliTestSelection,
  prompt: 'durable conversation seed',
  provider: 'codex',
  mode: 'read-only',
  scope,
  threadId: 'codex-thread-1',
});
const continued = await service.continue(scope, {
  jobId: threaded.id,
  prompt: 'resume the selected conversation',
});
assert.equal(continued?.parentJobId, threaded.id, 'explicit continuation records the selected parent job');
assert.equal(continued?.threadId, threaded.threadId, 'explicit continuation reuses the selected durable thread');
assert.equal(continueCalls, 1, 'explicit continuation calls AgentService exactly once');
assert.equal(await service.continue(createServerDerivedCoreScope({
  ...scope,
  requesterId: 'requester-b',
}), { jobId: threaded.id, prompt: 'cross-principal' }), undefined);

await assert.rejects(
  service.submit(scope, { ...request, prompt: 'different payload' }),
  (error: unknown) => error instanceof CoreOrchestrationIdempotencyConflictError,
);

const canonicalA = canonicalRequestHash({ prompt: 'same', provider: 'codex', mode: 'read-only' });
const canonicalB = canonicalRequestHash({ mode: 'read-only', provider: 'codex', prompt: 'same' });
assert.equal(canonicalA, canonicalB, 'request hash is independent of object insertion order');
assert.match(first.requestHash, /^[a-f0-9]{64}$/u);

const selected = await service.submit(scope, {
  idempotencyKey: 'selected-model',
  prompt: 'inspect with selected model',
  provider: 'codex',
  mode: 'read-only',
  model: 'gpt-6-luna',
  reasoningEffort: 'xhigh',
  catalogRevision: modelCatalog.revision,
});
assert.equal(selected.job.model, 'gpt-6-luna');
assert.equal(selected.job.reasoningEffort, 'xhigh');
assert.equal(selected.job.catalogRevision, modelCatalog.revision);
assert.deepEqual(await service.listCodexModelCatalog(), modelCatalog);
const beforeConflictingModel = submitCalls;
await assert.rejects(service.submit(scope, {
  idempotencyKey: 'conflicting-supported-model', prompt: 'must not replace the fixed policy',
  provider: 'codex', mode: 'read-only', model: 'gpt-5.6-sol', reasoningEffort: 'high', catalogRevision: modelCatalog.revision,
}), /Teams CLI policy.*fixed to gpt-6-luna\/xhigh/u);
assert.equal(submitCalls, beforeConflictingModel, 'conflicting model does not reach execution or persistence');

await assert.rejects(service.submit(scope, {
  idempotencyKey: 'stale-model',
  prompt: 'reject stale catalog',
  provider: 'codex',
  mode: 'read-only',
  model: 'gpt-6-luna',
  reasoningEffort: 'xhigh',
  catalogRevision: '0'.repeat(64),
}), CoreOrchestrationValidationError);
await assert.rejects(service.submit(scope, {
  idempotencyKey: 'partial-model',
  prompt: 'reject partial selection',
  provider: 'codex',
  mode: 'read-only',
  model: 'gpt-6-luna',
}), CoreOrchestrationValidationError);

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
  if (isolatedScope === otherConversation) {
    assert.equal(service.get(isolatedScope, { jobId: first.job.id })?.id, first.job.id, 'same principal can resolve a task across surfaces');
    assert.equal(service.list(isolatedScope).some((job) => job.id === first.job.id), true);
  } else {
    assert.equal(service.get(isolatedScope, { jobId: first.job.id }), undefined);
    assert.equal(service.list(isolatedScope).some((job) => job.id === first.job.id), false);
  }
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
assert.equal((await service.approve(scope, { jobId: workspaceJob.job.id,
  approvalId: workspaceJob.job.pendingOperation!.approvalId!, revision: workspaceJob.job.pendingOperation!.revision }))?.status, 'queued');
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

const inputResumeCalls: Array<{ jobId: string; scope: AgentJobScope; input: unknown }> = [];
const resumableService = new CoreOrchestrationService({
  observeCodexModelCatalog: observeTeamsCliTestCatalog,
  agentService,
  jobStore: store,
  inputResume: {
    observe(job, observedScope) {
      assert.equal(job.id, first.job.id);
      assert.deepEqual(observedScope, scope);
      return {
        supported: true,
        awaitingInput: true,
        source: 'runtime-observation',
        observedAt: new Date().toISOString(),
      };
    },
    async resume(job, observedScope, input) {
      inputResumeCalls.push({ jobId: job.id, scope: observedScope, input });
      return job;
    },
  },
});
const acceptedInput = await resumableService.provideInput(scope, {
  jobId: first.job.id,
  input: { answer: 'operator supplied', choices: [1, true, null] },
});
assert.deepEqual(acceptedInput, { status: 'accepted', job: first.job });
assert.deepEqual(inputResumeCalls, [{
  jobId: first.job.id,
  scope,
  input: { answer: 'operator supplied', choices: [1, true, null] },
}], 'the measured resume port receives the same durable job identity and server-derived scope');

let unsupportedResumeCalls = 0;
const unsupportedInputService = new CoreOrchestrationService({
  observeCodexModelCatalog: observeTeamsCliTestCatalog,
  agentService,
  jobStore: store,
  inputResume: {
    observe: () => ({
      supported: false,
      awaitingInput: false,
      source: 'runtime-probe',
      observedAt: new Date().toISOString(),
      reason: 'provider-input-unsupported',
    }),
    async resume(job) {
      unsupportedResumeCalls += 1;
      return job;
    },
  },
});
assert.deepEqual(await unsupportedInputService.provideInput(scope, {
  jobId: first.job.id,
  input: 'ignored',
}), {
  status: 'unsupported',
  job: first.job,
  reason: 'provider-input-unsupported',
});
assert.equal(unsupportedResumeCalls, 0, 'an unsupported measured provider is never asked to resume');

const notAwaitingInputService = new CoreOrchestrationService({
  observeCodexModelCatalog: observeTeamsCliTestCatalog,
  agentService,
  jobStore: store,
  inputResume: {
    observe: () => ({
      supported: true,
      awaitingInput: false,
      source: 'runtime-observation',
      observedAt: new Date().toISOString(),
      reason: 'job-not-awaiting-input',
    }),
    async resume() {
      throw new Error('resume must not run while the provider task is not awaiting input');
    },
  },
});
assert.equal((await notAwaitingInputService.provideInput(scope, {
  jobId: first.job.id,
  input: 'ignored',
}))?.reason, 'job-not-awaiting-input');

const mismatchedIdentityService = new CoreOrchestrationService({
  observeCodexModelCatalog: observeTeamsCliTestCatalog,
  agentService,
  jobStore: store,
  inputResume: {
    observe: () => ({
      supported: true,
      awaitingInput: true,
      source: 'runtime-probe',
      observedAt: new Date().toISOString(),
    }),
    async resume(job) {
      return { ...job, id: 'different-durable-task' };
    },
  },
});
await assert.rejects(
  mismatchedIdentityService.provideInput(scope, { jobId: first.job.id, input: 'unsafe' }),
  (error: unknown) => error instanceof CoreOrchestrationValidationError,
  'a provider cannot replace the durable identity while resuming input',
);
await assert.rejects(
  resumableService.provideInput(scope, { jobId: first.job.id, input: 'x'.repeat(8_193) }),
  (error: unknown) => error instanceof CoreOrchestrationValidationError,
  'provider input is byte bounded before reaching the resume port',
);
await assert.rejects(
  resumableService.provideInput(scope, { jobId: first.job.id, input: { invalid: undefined } }),
  (error: unknown) => error instanceof CoreOrchestrationValidationError,
  'provider input must be JSON-safe rather than silently losing fields',
);

const observedAt = new Date().toISOString();
const factsService = new CoreOrchestrationService({
  observeCodexModelCatalog: observeTeamsCliTestCatalog,
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
  observeCodexModelCatalog: observeTeamsCliTestCatalog,
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
  observeCodexModelCatalog: observeTeamsCliTestCatalog,
  jobStore: restartedStore,
  defaultProvider: 'codex',
  observeProviderFacts: measuredProviderFacts,
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
        model: input.model, reasoningEffort: input.reasoningEffort, catalogRevision: input.catalogRevision,
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
    observeCodexModelCatalog: observeTeamsCliTestCatalog,
    canReadScope: () => true,
    canMutateScope: () => true,
    admissionJournalPath: path.join(root, 'integration-admission.json'),
    executionDispatcher: dispatcher,
  },
);
await integrationAgentService.initialize();
const integrationService = new CoreOrchestrationService({
  observeCodexModelCatalog: observeTeamsCliTestCatalog,
  agentService: integrationAgentService,
  jobStore: integrationStore,
  defaultProvider: 'codex',
  observeProviderFacts: measuredProviderFacts,
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

const silentRequest = { ...request, idempotencyKey: 'notify-opt-out', notify: false };
await service.submit(scope, silentRequest, { notify: true });
assert.equal(observedNotify, false, 'explicit opt-out cannot be overridden by default notification options');
await assert.rejects(service.submit(scope, { ...silentRequest, notify: true }), CoreOrchestrationIdempotencyConflictError, 'notification choice belongs to durable request identity');
await assert.rejects(service.submit(scope, { ...request, idempotencyKey: 'bad-notify', notify: 'yes' } as any), CoreOrchestrationValidationError);
console.log('PASS: core orchestration service enforces scoped DTOs, strict mutations, durable idempotency, input boundary, and measured provider facts');
