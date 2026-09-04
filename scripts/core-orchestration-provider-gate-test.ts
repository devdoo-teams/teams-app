import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AgentJobStore, type AgentJob, type AgentJobScope } from '../src/server/agent-job-store.js';
import { CoreOrchestrationService, createServerDerivedCoreScope } from '../src/server/core-orchestration-service.js';
import type { CoreProviderFact } from '../src/shared/core-orchestration.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-core-provider-gate-'));
const store = new AgentJobStore(path.join(root, 'agent-jobs.json'));
await store.initialize();
let facts: CoreProviderFact[] = [{
  provider: 'codex',
  availability: 'unknown',
  capabilities: [],
  observedAt: '2026-09-04T00:00:00.000Z',
  source: 'runtime-probe',
}];
let submitCalls = 0;
let approveCalls = 0;
let retryCalls = 0;
const scope = createServerDerivedCoreScope({
  tenantId: 'provider-tenant',
  requesterId: 'provider-user',
  conversationId: 'provider-chat',
});
const fakeAgentService = {
  async submit(input: {
    prompt: string;
    provider?: 'codex' | 'copilot';
    mode: 'read-only' | 'workspace-write';
    scope: AgentJobScope;
    idempotencyKey?: string;
    requestHash?: string;
  }): Promise<AgentJob> {
    submitCalls += 1;
    return store.create({
      prompt: input.prompt,
      provider: input.provider ?? 'codex',
      mode: input.mode,
      scope: input.scope,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
    });
  },
  get(id: string, scoped: AgentJobScope) { return store.get(id, scoped); },
  list(scoped: AgentJobScope, limit?: number) { return store.list(scoped, limit); },
  async cancelStrict(id: string, scoped: AgentJobScope) { return store.update(id, scoped, { status: 'cancelled' }); },
  async approve(id: string, scoped: AgentJobScope) {
    approveCalls += 1;
    return store.update(id, scoped, { status: 'queued' });
  },
  async retry(id: string, scoped: AgentJobScope) {
    retryCalls += 1;
    const previous = store.get(id, scoped);
    if (!previous) return undefined;
    return store.create({
      prompt: previous.prompt,
      provider: previous.provider ?? 'codex',
      mode: previous.mode,
      scope: scoped,
      parentJobId: previous.id,
    });
  },
};
const service = new CoreOrchestrationService({
  agentService: fakeAgentService,
  jobStore: store,
  defaultProvider: 'codex',
  observeProviderFacts: () => facts,
});

function providerError(code: string, capability?: string) {
  return (error: unknown) => Boolean(
    error && typeof error === 'object'
      && (error as { code?: unknown }).code === code
      && (capability === undefined || (error as { capability?: unknown }).capability === capability),
  );
}

try {
  await assert.rejects(
    service.submit(scope, {
      idempotencyKey: 'unknown-provider',
      prompt: 'must not run',
      mode: 'read-only',
    }),
    providerError('CORE_ORCHESTRATION_PROVIDER_UNAVAILABLE'),
    'the default provider is rejected when measured readiness is unknown',
  );
  assert.equal(submitCalls, 0);
  assert.equal(store.list(scope, 100).length, 0, 'unknown provider rejection has no durable job side effect');

  facts = [{ ...facts[0]!, availability: 'available', capabilities: ['approve', 'retry'] }];
  await assert.rejects(
    service.submit(scope, {
      idempotencyKey: 'missing-submit-capability',
      prompt: 'must not run',
      provider: 'codex',
      mode: 'read-only',
    }),
    providerError('CORE_ORCHESTRATION_PROVIDER_CAPABILITY_UNAVAILABLE', 'submit'),
  );
  assert.equal(submitCalls, 0);
  assert.equal(store.list(scope, 100).length, 0, 'missing submit capability has no durable job side effect');

  facts = [{ ...facts[0]!, capabilities: ['submit', 'retry'] }];
  const awaitingApproval = await service.submit(scope, {
    idempotencyKey: 'approval-capability',
    prompt: 'requires approval',
    provider: 'codex',
    mode: 'workspace-write',
  });
  facts = [{ ...facts[0]!, capabilities: ['submit', 'retry'] }];
  await assert.rejects(
    service.approve(scope, { jobId: awaitingApproval.job.id }),
    providerError('CORE_ORCHESTRATION_PROVIDER_CAPABILITY_UNAVAILABLE', 'approve'),
  );
  assert.equal(approveCalls, 0, 'approve is not called when its measured capability is absent');
  assert.equal(store.get(awaitingApproval.job.id, scope)?.status, 'awaiting_approval');

  await store.update(awaitingApproval.job.id, scope, {
    status: 'failed',
    error: 'measured failure',
    finishedAt: '2026-09-04T00:01:00.000Z',
  });
  facts = [{ ...facts[0]!, capabilities: ['submit', 'approve'] }];
  await assert.rejects(
    service.retry(scope, { jobId: awaitingApproval.job.id }),
    providerError('CORE_ORCHESTRATION_PROVIDER_CAPABILITY_UNAVAILABLE', 'retry'),
  );
  assert.equal(retryCalls, 0, 'retry is not called when its measured capability is absent');

  facts = [{ ...facts[0]!, capabilities: ['submit', 'approve', 'retry'] }];
  await assert.rejects(
    service.submit(scope, {
      idempotencyKey: 'unregistered-provider',
      prompt: 'unsupported provider',
      provider: 'copilot',
      mode: 'read-only',
    }),
    providerError('CORE_ORCHESTRATION_PROVIDER_UNAVAILABLE'),
  );
  assert.equal(submitCalls, 1, 'only the measured provider submission reached the agent service');

  console.log('core-orchestration-provider-gate-test: PASS');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
