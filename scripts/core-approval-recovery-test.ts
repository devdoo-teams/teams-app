import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentJobStore, type AgentJobScope } from '../src/server/agent-job-store.js';
import { CoreOrchestrationService, createServerDerivedCoreScope } from '../src/server/core-orchestration-service.js';
import { projectPendingOperation } from '../src/server/personal-approval-projection.js';
import { teamsCliTestSelection } from './fixtures/teams-cli-agent-policy-fixture.js';
import { atomicWriteJson } from '../src/server/atomic-file.js';
import { CoreApprovalRecoveryError, type CoreApprovalDecision, type CoreApprovalIdentity } from '../src/server/core-approval-recovery.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'core-approval-recovery-'));
try {
  const scope = createServerDerivedCoreScope({ tenantId: 'synthetic-tenant', requesterId: 'synthetic-owner', conversationId: 'synthetic-personal' });
  const storePath = path.join(root, 'jobs.json');
  const store = new AgentJobStore(storePath);
  await store.initialize();
  const job = await store.create({ prompt: 'synthetic approved write', provider: 'codex', mode: 'workspace-write', scope, ...teamsCliTestSelection });
  let launches = 0;
  const makeService = (ownerStore: AgentJobStore, onDispatch = () => { launches++; }) => new CoreOrchestrationService({
    jobStore: ownerStore,
    observeProviderFacts: () => [{ provider: 'codex', availability: 'available', capabilities: ['approve'], observedAt: new Date().toISOString(), source: 'runtime-observation' }],
    agentService: {
      get: ownerStore.get.bind(ownerStore), list: ownerStore.list.bind(ownerStore),
      getForPrincipal: ownerStore.getForPrincipal.bind(ownerStore),
      submit: async () => { throw new Error('unexpected submit'); }, continue: async () => undefined,
      cancelStrict: async () => undefined, retry: async () => undefined,
      approve: async () => { throw new Error('legacy approval launch must not run'); },
      decideApproval: async (id: string, owner: AgentJobScope, request: CoreApprovalIdentity, decision: CoreApprovalDecision) => {
        const result = await ownerStore.decideApproval(id, owner, request, decision);
        if (result?.dispatch) onDispatch();
        return result;
      },
    },
  });
  const service = makeService(store);
  const pending = projectPendingOperation(job)!;
  await assert.rejects(service.approve(scope, {
    jobId: job.id, approvalId: 'approval-00000000-0000-0000-0000-000000000000', revision: '0'.repeat(64),
  } as Parameters<typeof service.approve>[1]), 'a stale card revision cannot authorize execution');
  assert.equal(launches, 0);
  assert.equal(store.get(job.id, scope)?.status, 'awaiting_approval');
  assert.ok(pending.revision);
  assert.ok(pending.approvalId, 'new write jobs persist server-generated approval identity');
  assert.equal(pending.approverId, scope.requesterId);
  assert.equal(pending.tenantId, scope.tenantId);
  assert.ok(pending.deadline);
  const request = { jobId: job.id, approvalId: pending.approvalId!, revision: pending.revision };
  for (const invalid of [
    { ...request, approvalId: 'approval-00000000-0000-0000-0000-000000000000' },
    { ...request, revision: '0'.repeat(64) },
    { ...request, approverId: 'forged-owner' },
    { ...request, deadline: new Date(Date.now() + 60_000).toISOString() },
    { jobId: job.id },
  ]) {
    await assert.rejects(service.approve(scope, invalid), CoreApprovalRecoveryError);
  }
  assert.equal(launches, 0, 'wrong IDs, revision and client authority never reach dispatch');
  for (const foreign of [{ ...scope, tenantId: 'foreign' }, { ...scope, requesterId: 'foreign' }]) {
    assert.equal(await service.approve(createServerDerivedCoreScope(foreign), request), undefined);
  }
  assert.equal(launches, 0);
  const approved = await Promise.all(Array.from({ length: 12 }, () => service.decideApproval(scope, request, 'accept')));
  assert.equal(launches, 1, 'rapid identical callbacks execute only the committed transition');
  assert.equal(approved.filter(result => !result!.replayed).length, 1);
  assert.ok(approved.every(result => result!.job.approval?.state === 'accepted'));
  await assert.rejects(service.deny(scope, request), CoreApprovalRecoveryError);

  const restartedStore = new AgentJobStore(storePath); await restartedStore.initialize();
  const restarted = makeService(restartedStore);
  assert.equal((await restarted.decideApproval(scope, request, 'accept'))?.replayed, true);
  assert.equal(launches, 1, 'a stale accepted card after restart returns durable status without dispatch');
  await restartedStore.update(job.id, scope, { status: 'running', threadId: 'runtime-thread' });
  await restartedStore.update(job.id, scope, { status: 'completed', result: 'synthetic terminal result', finishedAt: new Date().toISOString() });
  const finalReload = new AgentJobStore(storePath); await finalReload.initialize();
  const settled = await makeService(finalReload).decideApproval(scope, request, 'accept');
  assert.equal(settled?.job.result, 'synthetic terminal result');
  assert.equal(settled?.job.approval?.settledStatus, 'completed');
  assert.ok(settled?.job.approval?.settledAt);
  assert.equal(settled?.job.pendingOperation, undefined);
  assert.equal(launches, 1, 'final settlement replay retains result without a second execution');

  const rejected = await finalReload.create({ prompt: 'synthetic denied write', provider: 'codex', mode: 'workspace-write', scope, ...teamsCliTestSelection });
  const deniedIdentity = projectPendingOperation(rejected)!;
  const deniedRequest = { jobId: rejected.id, approvalId: deniedIdentity.approvalId!, revision: deniedIdentity.revision };
  const finalService = makeService(finalReload);
  const denied = await finalService.decideApproval(scope, deniedRequest, 'deny');
  assert.equal(denied?.job.status, 'cancelled');
  assert.equal(denied?.job.approval?.state, 'denied');
  assert.equal((await finalService.decideApproval(scope, deniedRequest, 'deny'))?.replayed, true);
  await assert.rejects(finalService.approve(scope, deniedRequest), CoreApprovalRecoveryError);
  assert.equal(launches, 1, 'denial never calls execution');

  const expiring = await finalReload.create({ prompt: 'synthetic expired write', provider: 'codex', mode: 'workspace-write', scope, ...teamsCliTestSelection });
  const expiryIdentity = projectPendingOperation(expiring)!;
  const expiryRequest = { jobId: expiring.id, approvalId: expiryIdentity.approvalId!, revision: expiryIdentity.revision };
  const realNow = Date.now;
  try {
    Date.now = () => Date.parse(expiryIdentity.deadline!);
    const expired = await finalService.decideApproval(scope, expiryRequest, 'accept');
    assert.equal(expired?.job.status, 'cancelled');
    assert.equal(expired?.job.approval?.state, 'expired', 'exact deadline is closed');
  } finally { Date.now = realNow; }
  assert.equal(launches, 1, 'expiry never dispatches');
  const expiryReload = new AgentJobStore(storePath); await expiryReload.initialize();
  const expiredReplay = await makeService(expiryReload).decideApproval(scope, expiryRequest, 'accept');
  assert.equal(expiredReplay?.replayed, true);
  assert.equal(expiredReplay?.job.approval?.state, 'expired');

  const pendingRestart = await expiryReload.create({ prompt: 'synthetic pending restart', provider: 'codex', mode: 'workspace-write', scope, ...teamsCliTestSelection });
  const beforeRestart = projectPendingOperation(pendingRestart)!;
  const pendingReload = new AgentJobStore(storePath); await pendingReload.initialize();
  assert.deepEqual(makeService(pendingReload).get(scope, { jobId: pendingRestart.id })?.pendingOperation, beforeRestart);
  await makeService(pendingReload).approve(scope, { jobId: pendingRestart.id, approvalId: beforeRestart.approvalId!, revision: beforeRestart.revision });
  assert.equal(launches, 2, 'a pending old card survives restart and executes its original decision once');
  await pendingReload.recoverInterruptedJobs();
  const interruptedReload = new AgentJobStore(storePath); await interruptedReload.initialize();
  const interrupted = makeService(interruptedReload).get(scope, { jobId: pendingRestart.id })!;
  assert.equal(interrupted.status, 'failed');
  assert.equal(interrupted.approval?.state, 'accepted');
  assert.equal(interrupted.approval?.settledStatus, 'failed', 'local restart settles interrupted accepted work rather than resubmitting');
  assert.equal((await makeService(interruptedReload).decideApproval(scope, {
    jobId: pendingRestart.id, approvalId: beforeRestart.approvalId!, revision: beforeRestart.revision,
  }, 'accept'))?.replayed, true);
  assert.equal(launches, 2);

  const cancelledPending = await interruptedReload.create({ prompt: 'synthetic pending cancellation', provider: 'codex', mode: 'workspace-write', scope, ...teamsCliTestSelection });
  await interruptedReload.update(cancelledPending.id, scope, { status: 'cancelled', finishedAt: new Date().toISOString() });
  const cancellationReadback = makeService(interruptedReload).get(scope, { jobId: cancelledPending.id })!;
  assert.equal(cancellationReadback.approval?.state, 'denied', 'another user-facing cancellation surface closes the same approval');
  assert.equal(cancellationReadback.pendingOperation, undefined);
  await assert.rejects(makeService(interruptedReload).approve(scope, {
    jobId: cancelledPending.id, approvalId: cancelledPending.durableApproval!.approvalId, revision: cancelledPending.durableApproval!.revision,
  }), CoreApprovalRecoveryError);

  const legacyPath = path.join(root, 'legacy', 'jobs.json');
  const { durableApproval: _authority, ...legacyJob } = cancelledPending;
  await atomicWriteJson(legacyPath, [legacyJob]);
  const legacyStore = new AgentJobStore(legacyPath); await legacyStore.initialize();
  const legacyService = makeService(legacyStore);
  assert.equal(legacyService.get(scope, { jobId: legacyJob.id })?.pendingOperation?.approvalId, undefined);
  await assert.rejects(legacyService.approve(scope, {
    jobId: legacyJob.id, approvalId: cancelledPending.durableApproval!.approvalId, revision: cancelledPending.durableApproval!.revision,
  }), (error: unknown) => error instanceof CoreApprovalRecoveryError && error.reason === 'unsupported');
  assert.equal(legacyStore.get(legacyJob.id, scope)?.status, 'awaiting_approval', 'old display-only rows never gain callback authority during read-back');
  assert.equal(launches, 2);

  const savedEnvironment = process.env.NODE_ENV; process.env.NODE_ENV = 'test';
  try {
    let failWrite = false;
    const brokenPath = path.join(root, 'failure', 'jobs.json');
    const broken = AgentJobStore.createForTesting(brokenPath, {}, async (file, value) => {
      if (failWrite) throw new Error('synthetic approval persistence failure');
      await atomicWriteJson(file, value);
    });
    await broken.initialize();
    const uncommitted = await broken.create({ prompt: 'synthetic failed approval persistence', provider: 'codex', mode: 'workspace-write', scope, ...teamsCliTestSelection });
    const failureIdentity = projectPendingOperation(uncommitted)!;
    const failureRequest = { jobId: uncommitted.id, approvalId: failureIdentity.approvalId!, revision: failureIdentity.revision };
    failWrite = true;
    await assert.rejects(makeService(broken).approve(scope, failureRequest), /synthetic approval persistence failure/);
    assert.equal(broken.get(uncommitted.id, scope)?.status, 'awaiting_approval');
    assert.equal(launches, 2, 'failed durable write never authorizes execution');
    const failureReload = new AgentJobStore(brokenPath); await failureReload.initialize();
    assert.deepEqual(projectPendingOperation(failureReload.get(uncommitted.id, scope)!), failureIdentity);
  } finally { if (savedEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedEnvironment; }

  const corruptPath = path.join(root, 'corrupt', 'jobs.json');
  const corrupted = { ...pendingRestart, durableApproval: { ...pendingRestart.durableApproval!, approverId: 'forged' } };
  await atomicWriteJson(corruptPath, [corrupted]);
  const originalBytes = await fs.readFile(corruptPath, 'utf8');
  await assert.rejects(new AgentJobStore(corruptPath).initialize(), /approval|Approval/u);
  assert.equal(await fs.readFile(corruptPath, 'utf8'), originalBytes, 'malformed durable authority is never repaired or deleted');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('core-approval-recovery-test: PASS');
