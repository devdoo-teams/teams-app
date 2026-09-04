import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AgentJobStore } from '../src/server/agent-job-store.js';
import { AgentService, type AgentExecutionDispatcher } from '../src/server/agent-service.js';
import { CoreOrchestrationService, createServerDerivedCoreScope } from '../src/server/core-orchestration-service.js';
import { GitService } from '../src/server/git-service.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-core-cross-surface-'));
const store = new AgentJobStore(path.join(root, 'agent-jobs.json'));
let dispatches = 0;
let cancellations = 0;
const dispatcher: AgentExecutionDispatcher = {
  kind: 'azure-queue',
  async dispatch() { dispatches += 1; },
  async observe() { return undefined; },
  async cancel() { cancellations += 1; },
};
const agentService = new AgentService(
  store,
  undefined,
  root,
  async () => undefined,
  new GitService(root),
  {
    canReadScope: () => true,
    canMutateScope: () => true,
    admissionJournalPath: path.join(root, 'admission.json'),
    executionDispatcher: dispatcher,
  },
);
await agentService.initialize();

const observedAt = '2026-09-04T00:00:00.000Z';
const service = new CoreOrchestrationService({
  agentService,
  jobStore: store,
  observeProviderFacts: () => [{
    provider: 'codex',
    availability: 'available',
    capabilities: ['approve', 'cancel', 'retry', 'submit'],
    observedAt,
    source: 'runtime-observation',
  }],
});
const chatScope = createServerDerivedCoreScope({
  tenantId: 'tenant-a',
  requesterId: 'requester-a',
  conversationId: 'teams-chat',
});
const tabScope = createServerDerivedCoreScope({
  tenantId: 'tenant-a',
  requesterId: 'requester-a',
  conversationId: 'personal-tab',
});
const foreignScope = createServerDerivedCoreScope({
  tenantId: 'tenant-b',
  requesterId: 'requester-a',
  conversationId: 'other-surface',
});

try {
  const chatCreated = await service.submit(chatScope, {
    idempotencyKey: 'cross-surface-chat',
    prompt: 'created in Teams chat',
    provider: 'codex',
    mode: 'read-only',
  });
  assert.equal(chatCreated.job.status, 'queued');
  assert.equal(service.get(tabScope, { jobId: chatCreated.job.id })?.id, chatCreated.job.id);
  assert.ok(service.list(tabScope).some((job) => job.id === chatCreated.job.id));
  assert.equal(service.get(foreignScope, { jobId: chatCreated.job.id }), undefined, 'tenant isolation hides chat jobs');
  assert.equal(service.list(foreignScope).some((job) => job.id === chatCreated.job.id), false);
  const cancelledFromTab = await service.cancel(tabScope, { jobId: chatCreated.job.id });
  assert.equal(cancelledFromTab?.id, chatCreated.job.id);
  assert.equal(cancelledFromTab?.status, 'cancelled');
  assert.equal(cancellations, 1, 'cross-surface cancellation targets the stored chat scope');

  const tabCreated = await service.submit(tabScope, {
    idempotencyKey: 'cross-surface-tab',
    prompt: 'created in personal tab',
    provider: 'codex',
    mode: 'workspace-write',
  });
  assert.equal(tabCreated.job.status, 'awaiting_approval');
  assert.equal(service.get(chatScope, { jobId: tabCreated.job.id })?.id, tabCreated.job.id);
  assert.ok(service.list(chatScope).some((job) => job.id === tabCreated.job.id));

  const approvedFromChat = await service.approve(chatScope, { jobId: tabCreated.job.id });
  assert.equal(approvedFromChat?.id, tabCreated.job.id);
  assert.equal(approvedFromChat?.status, 'queued');
  assert.equal(dispatches, 2, 'read-only submit and cross-surface approval dispatch once each');

  const cancelledFromTabAfterApproval = await service.cancel(tabScope, { jobId: tabCreated.job.id });
  assert.equal(cancelledFromTabAfterApproval?.id, tabCreated.job.id);
  assert.equal(cancelledFromTabAfterApproval?.status, 'cancelled');
  assert.equal(cancellations, 2, 'the second cross-surface mutation targets the stored tab scope');

  const storedTabJob = store.getLocalOnly(tabCreated.job.id);
  assert.equal(storedTabJob?.tenantId, tabScope.tenantId);
  assert.equal(storedTabJob?.requesterId, tabScope.requesterId);
  assert.equal(storedTabJob?.conversationId, tabScope.conversationId, 'mutations preserve the stored surface scope');
  assert.equal(service.get(foreignScope, { jobId: tabCreated.job.id }), undefined, 'a foreign tenant cannot use cross-surface lookup');

  console.log('core-orchestration-cross-surface-test: PASS');
} finally {
  await agentService.close();
  await fs.rm(root, { recursive: true, force: true });
}
