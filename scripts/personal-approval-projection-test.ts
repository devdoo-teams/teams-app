import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentJobStore, type AgentJobScope } from '../src/server/agent-job-store.js';
import { CoreOrchestrationService, createServerDerivedCoreScope } from '../src/server/core-orchestration-service.js';
import { GenUiActionStore } from '../src/server/genui-action-store.js';
import { createCoreOrchestrationJobActivity, createCoreOrchestrationConfirmationActivity, type CoreOrchestrationTeamsActivity } from '../src/server/genui-response.js';
import { loadJobConversation, refreshVisibleJobConversation } from '../src/client/job-conversation.js';
import { CoreJobCardPages } from '../src/server/core-job-card-pages.js';
import { projectPendingOperation } from '../src/server/personal-approval-projection.js';
import type { CoreOrchestrationJob } from '../src/shared/core-orchestration.js';
const job: CoreOrchestrationJob = { id: 'task-synthetic', prompt: 'synthetic write request', mode: 'workspace-write', status: 'awaiting_approval', progress: [], createdAt: new Date().toISOString() };
const first = projectPendingOperation(job); assert.ok(first);
assert.deepEqual(projectPendingOperation({ ...job, progress: ['observed'], updatedAt: new Date().toISOString() }), first);
assert.deepEqual(projectPendingOperation({ ...job, threadId: 'later-runtime-thread' }), first, 'runtime thread observation cannot change approved arguments');
assert.notEqual(projectPendingOperation({ ...job, prompt: 'changed request' })?.revision, first.revision);
assert.equal(projectPendingOperation({ ...job, prompt: '' }), undefined);
assert.equal(projectPendingOperation({ ...job, status: 'cancelled' }), undefined);
assert.equal(projectPendingOperation({ ...job, status: 'running' }), undefined);
assert.equal(projectPendingOperation({ ...job, mode: 'read-only' }), undefined);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'approval-projection-'));
try {
  const scope = createServerDerivedCoreScope({ tenantId: 'synthetic-tenant', requesterId: 'synthetic-owner', conversationId: 'synthetic-personal' });
  const store = new AgentJobStore(path.join(root, 'jobs.json')); await store.initialize();
  const stored = await store.create({ prompt: job.prompt, mode: job.mode, scope });
  const service = new CoreOrchestrationService({ jobStore: store, agentService: {
    get: store.get.bind(store), list: store.list.bind(store),
    listForPrincipal: store.listForPrincipal.bind(store), getForPrincipal: store.getForPrincipal.bind(store),
    submit: async () => { throw new Error('no launch'); }, continue: async () => undefined,
    approve: async () => { throw new Error('no launch'); }, retry: async () => undefined,
    cancelStrict: async (id, owner) => store.update(id, owner, { status: 'cancelled', finishedAt: new Date().toISOString() }),
  } });
  const detail = service.get(scope, { jobId: stored.id })!;
  assert.ok(detail.pendingOperation);
  assert.ok(detail.pendingOperation.approvalId);
  assert.equal(detail.pendingOperation.approverId, scope.requesterId);
  assert.equal(detail.pendingOperation.tenantId, scope.tenantId);
  assert.equal(projectPendingOperation(detail)?.approvalId, detail.pendingOperation.approvalId, 'wire read-back retains durable callback identity');
  assert.deepEqual(service.list(scope)[0].pendingOperation, detail.pendingOperation);
  const loaded = await loadJobConversation(stored.id, async id => service.get(scope, { jobId: id })!);
  assert.deepEqual(loaded.conversation.turns[0].pendingOperation, detail.pendingOperation);
  const card = createCoreOrchestrationJobActivity(detail);
  assert.ok(JSON.stringify(card).includes(detail.pendingOperation.revision));
  assert.ok(JSON.stringify(createCoreOrchestrationConfirmationActivity(detail, 'approve')).includes(detail.pendingOperation.revision));
  const updates: { id: string; activity: CoreOrchestrationTeamsActivity; scope: AgentJobScope }[] = [];
  const pages = new CoreJobCardPages(path.join(root, 'pages.json'), {
    getJob: id => service.get(scope, { jobId: id }),
    update: async (id, activity, authenticatedScope) => { updates.push({ id, activity, scope: authenticatedScope }); },
  });
  await pages.initialize(); const prepared = await pages.create(stored.id, scope, true); assert.ok(prepared);
  assert.ok(JSON.stringify(prepared.activity).includes(detail.pendingOperation.revision), 'actual personal page summary retains canonical FactSet revision');
  await pages.bind(prepared.key, scope, 'synthetic-activity');
  for (let index = 0; index < 21; index++) await store.create({ prompt: `new read ${index}`, mode: 'read-only', scope });
  assert.ok(!service.list(scope).some(item => item.id === stored.id), 'pending job is outside recent20 fixture');
  assert.deepEqual(service.listPending(scope)?.jobs[0].pendingOperation, detail.pendingOperation, 'filter pending before limiting recent jobs');
  for (const foreign of [{ ...scope, tenantId: 'other' }, { ...scope, requesterId: 'other' }]) {
    const unauthorized = createServerDerivedCoreScope(foreign);
    assert.equal(service.get(unauthorized, { jobId: stored.id }), undefined);
    assert.deepEqual(service.list(unauthorized), []);
    assert.deepEqual(service.listPending(unauthorized)?.jobs, []);
  }
  const grants = new GenUiActionStore(path.join(root, 'grants.json'), 1000); await grants.initialize();
  const grant = { action: 'approve' as const, entityId: stored.id, correlationId: 'synthetic-confirmation', ...scope };
  const token = await grants.issue(grant);
  assert.ok((await grants.consume({ ...grant, token })).ok);
  assert.deepEqual(await grants.consume({ ...grant, token }), { ok: false, reason: 'consumed' });
  assert.deepEqual(service.get(scope, { jobId: stored.id })!.pendingOperation, detail.pendingOperation, 'grant consumption alone is not execution');
  const expiringToken = await grants.issue({ ...grant, correlationId: 'synthetic-expiry' });
  const now = Date.now;
  try {
    const future = now() + 2000; Date.now = () => future;
    assert.deepEqual(await grants.consume({ ...grant, correlationId: 'synthetic-expiry', token: expiringToken }), { ok: false, reason: 'expired' });
  } finally { Date.now = now; }
  assert.deepEqual(service.get(scope, { jobId: stored.id })!.pendingOperation, detail.pendingOperation, 'grant expiry never expires or approves the durable job');
  await service.cancel(scope, { jobId: stored.id });
  const cancelled = service.get(scope, { jobId: stored.id })!;
  assert.equal(cancelled.pendingOperation, undefined);
  assert.deepEqual(service.listPending(scope)?.jobs, []);
  assert.equal(refreshVisibleJobConversation(loaded.conversation, cancelled).turns[0].pendingOperation, undefined);
  assert.ok(!JSON.stringify(createCoreOrchestrationJobActivity(cancelled)).includes(detail.pendingOperation.revision));
  const cancelledRecord = structuredClone(store.get(stored.id, scope));
  const refreshed = await pages.act({ schemaVersion: '1', action: 'orchestration.page', jobId: stored.id, key: prepared.key, page: 'refresh' }, scope, true, 'synthetic-activity', 'submit');
  assert.equal(refreshed.statusCode, 200);
  assert.equal(updates.length, 1, 'refresh updates the bound activity once');
  assert.equal(updates[0].id, 'synthetic-activity');
  assert.deepEqual(updates[0].scope, scope);
  assert.equal(updates[0].activity.attachmentLayout, 'carousel');
  assert.equal(updates[0].activity.attachments.length, 4, 'refresh preserves the entire card collection');
  const refreshedCards = JSON.stringify(updates[0].activity);
  assert.ok(!refreshedCards.includes(detail.pendingOperation.revision));
  assert.ok(!refreshedCards.includes('orchestration.approve'), 'cancelled job offers no approval control');
  assert.deepEqual(store.get(stored.id, scope), cancelledRecord, 'card refresh never mutates the cancelled job');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('PASS: pending projection uses immutable arguments, never progress, and disappears after another surface handles it');
