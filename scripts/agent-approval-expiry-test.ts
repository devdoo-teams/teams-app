import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { AgentAdmissionController } from '../src/server/agent-admission-controller.js';
import { AgentJobStore, type AgentJob, type AgentJobScope } from '../src/server/agent-job-store.js';
import { AgentService, type AgentExecutionDispatcher, type AgentNotification } from '../src/server/agent-service.js';
import { atomicWriteJson, readAtomicJsonStore } from '../src/server/atomic-file.js';
import { createDurableApproval } from '../src/server/core-approval-recovery.js';
import { GitService } from '../src/server/git-service.js';
import { observeTeamsCliTestCatalog, teamsCliTestSelection } from './fixtures/teams-cli-agent-policy-fixture.js';

const scope: AgentJobScope = { tenantId: 'expiry-tenant', requesterId: 'expiry-owner', conversationId: 'expiry-conversation' };
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-approval-expiry-'));
const services = new Set<AgentService>();

function pendingJob(id: string, owner: AgentJobScope, deadline: number, notify = true): AgentJob {
  const created = Math.min(Date.now() - 1_000, deadline - 1_000);
  const job: AgentJob = {
    id, prompt: 'synthetic approval expiry', provider: 'codex', mode: 'workspace-write', status: 'awaiting_approval',
    ...owner, ...teamsCliTestSelection, createdAt: new Date(created).toISOString(), updatedAt: new Date(created).toISOString(),
    progress: [], tools: [], durableNotifications: { enabled: notify, delivered: [] }, executionEnvironment: 'external-worker',
  };
  return { ...job, durableApproval: createDurableApproval(job, deadline - created) };
}

function serviceFor(file: string, journal: string, options: { store?: AgentJobStore; canMutate?: boolean } = {}) {
  const store = options.store ?? new AgentJobStore(file);
  const admission = new AgentAdmissionController({ globalLimit: 4, perTenantLimit: 4, perRequesterLimit: 1 }, { journalPath: journal });
  const notifications: AgentNotification[] = [];
  const durableAtNotification: Array<{ id: string; status?: string; approval?: string }> = [];
  const calls = { dispatch: 0, cancel: 0 };
  const dispatcher: AgentExecutionDispatcher = {
    kind: 'azure-queue', dispatch: async () => { calls.dispatch++; }, observe: async () => undefined,
    cancel: async () => { calls.cancel++; }, close: async () => undefined,
  };
  const service = new AgentService(store, undefined, root, async notification => {
    notifications.push(notification);
    const durable = (JSON.parse(await readAtomicJsonStore(file)) as AgentJob[]).find(job => job.id === notification.job.id);
    durableAtNotification.push({ id: notification.job.id, status: durable?.status, approval: durable?.durableApproval?.state });
    return { accepted: true };
  }, new GitService(root), {
    admissionController: admission, executionDispatcher: dispatcher, durableObservationIntervalMs: 60_000,
    canMutateScope: () => options.canMutate !== false, canReadScope: () => true,
    observeCodexModelCatalog: observeTeamsCliTestCatalog,
  });
  services.add(service);
  return { service, store, admission, notifications, durableAtNotification, calls };
}

async function stop(service: AgentService): Promise<void> { await service.close(); services.delete(service); }
async function waitForExpiry(store: AgentJobStore, id: string, owner: AgentJobScope): Promise<AgentJob> {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const job = store.get(id, owner);
    if (job?.durableApproval?.state === 'expired') return job;
    await pause(10);
  }
  assert.fail(`pending approval did not expire: ${id}`);
}
async function assertCapacityReleased(admission: AgentAdmissionController, owner: AgentJobScope): Promise<void> {
  const next = await admission.tryAcquire(owner);
  assert.equal(next.ok, true, 'approval expiry releases the original admission reservation');
  if (next.ok) await next.lease.release();
}

try {
  const file = path.join(root, 'restart', 'jobs.json');
  const overdue = pendingJob('overdue', scope, Date.now() - 10);
  const silentScope = { ...scope, requesterId: 'silent-owner' };
  const silent = pendingJob('silent-overdue', silentScope, Date.now() - 10, false);
  const legacyScope = { ...scope, requesterId: 'legacy-owner' };
  const { durableApproval: _legacyAuthority, ...legacy } = pendingJob('legacy', legacyScope, Date.now() - 10);
  await atomicWriteJson(file, [overdue, silent, legacy]);
  const recovered = serviceFor(file, path.join(root, 'restart', 'admission.json'), { canMutate: false });
  await recovered.service.initialize();
  const expired = recovered.store.get(overdue.id, scope)!;
  assert.equal(expired.status, 'cancelled', 'initialize expires overdue durable pending approvals');
  assert.equal(expired.durableApproval?.state, 'expired');
  assert.equal(expired.durableApproval?.deadline, overdue.durableApproval?.deadline, 'restart never renews approval authority');
  assert.ok(Date.parse(expired.durableApproval!.decidedAt!) >= Date.parse(overdue.durableApproval!.deadline));
  assert.equal(expired.durableApproval?.settledStatus, 'cancelled');
  assert.ok(expired.durableApproval?.settledAt);
  assert.equal(recovered.store.get(silent.id, silentScope)?.durableApproval?.state, 'expired');
  assert.deepEqual(recovered.notifications.map(item => [item.job.id, item.kind, item.phase]), [[overdue.id, 'cancelled', 'cancelled']]);
  assert.deepEqual(recovered.durableAtNotification, [{ id: overdue.id, status: 'cancelled', approval: 'expired' }], 'expiry is durable before terminal notification');
  assert.equal(recovered.calls.dispatch, 0, 'expired unapproved work never reaches a provider');
  assert.equal(recovered.calls.cancel, 0, 'unstarted approval work requires no worker cancellation');
  assert.equal(recovered.store.get(legacy.id, legacyScope)?.status, 'awaiting_approval');
  assert.equal(recovered.store.get(legacy.id, legacyScope)?.durableApproval, undefined, 'legacy rows never acquire approval authority');
  await assertCapacityReleased(recovered.admission, scope);
  await assertCapacityReleased(recovered.admission, silentScope);
  await stop(recovered.service);
  const settledRestart = serviceFor(file, path.join(root, 'restart', 'admission.json'));
  await settledRestart.service.initialize();
  assert.equal(settledRestart.notifications.length, 0, 'settled expiry restart does not notify or execute again');
  assert.equal(settledRestart.store.get(overdue.id, scope)?.durableApproval?.deadline, overdue.durableApproval?.deadline);
  const repeated = await settledRestart.service.decideApproval(overdue.id, scope, overdue.durableApproval!, 'expire');
  assert.equal(repeated?.replayed, true, 'a stale expired callback returns its durable settlement');
  assert.equal(settledRestart.store.get(overdue.id, scope)?.error, undefined, 'released expiry replay cannot invent a cleanup failure');
  assert.equal(settledRestart.admission.requiresReconciliation(overdue.id), false);
  assert.equal(settledRestart.notifications.length, 0);
  await stop(settledRestart.service);

  const timerFile = path.join(root, 'timer', 'jobs.json');
  const timed = pendingJob('timed', scope, Date.now() + 500);
  await atomicWriteJson(timerFile, [timed]);
  const automatic = serviceFor(timerFile, path.join(root, 'timer', 'admission.json'));
  await automatic.service.initialize();
  assert.equal(automatic.store.get(timed.id, scope)?.status, 'awaiting_approval');
  await pause(50);
  assert.equal(automatic.notifications.length, 0, 'expiry timer never settles before the persisted deadline');
  await waitForExpiry(automatic.store, timed.id, scope);
  const notificationDeadline = Date.now() + 4_000;
  while (automatic.notifications.length === 0 && Date.now() < notificationDeadline) await pause(10);
  assert.equal(automatic.notifications.length, 1);
  assert.deepEqual(automatic.durableAtNotification, [{ id: timed.id, status: 'cancelled', approval: 'expired' }]);
  await assertCapacityReleased(automatic.admission, scope);
  assert.equal(automatic.calls.dispatch, 0);
  assert.equal(automatic.store.get(timed.id, scope)?.durableApproval?.deadline, timed.durableApproval?.deadline);
  await stop(automatic.service);

  const closeFile = path.join(root, 'closed', 'jobs.json');
  const closing = pendingJob('closing', scope, Date.now() + 300);
  await atomicWriteJson(closeFile, [closing]);
  const closed = serviceFor(closeFile, path.join(root, 'closed', 'admission.json'));
  await closed.service.initialize(); await stop(closed.service);
  await pause(350);
  assert.equal(closed.store.get(closing.id, scope)?.status, 'awaiting_approval', 'close cancels pending expiry callbacks');
  assert.equal(closed.notifications.length, 0);
  const afterClose = serviceFor(closeFile, path.join(root, 'closed', 'admission.json'));
  await afterClose.service.initialize();
  assert.equal(afterClose.store.get(closing.id, scope)?.durableApproval?.state, 'expired');
  assert.equal(afterClose.store.get(closing.id, scope)?.durableApproval?.deadline, closing.durableApproval?.deadline);
  await assertCapacityReleased(afterClose.admission, scope); await stop(afterClose.service);

  const farFile = path.join(root, 'far-deadline', 'jobs.json');
  await atomicWriteJson(farFile, [pendingJob('far-future', scope, Date.now() + 30 * 86_400_000)]);
  const far = serviceFor(farFile, path.join(root, 'far-deadline', 'admission.json'));
  const scheduled: Array<{ delay: number; timer: ReturnType<typeof setTimeout> }> = [];
  const originalTimeout = globalThis.setTimeout;
  try {
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
      const timer = originalTimeout(callback, delay, ...args); scheduled.push({ delay: Number(delay), timer }); return timer;
    }) as typeof setTimeout;
    await far.service.initialize();
  } finally { globalThis.setTimeout = originalTimeout; }
  assert.equal(scheduled.length, 2, 'pending approval has one expiry timer in addition to the existing worker observation timer');
  assert.ok(scheduled.every(item => item.delay >= 1 && item.delay <= 60_000), 'long deadlines never overflow the Node timer contract');
  assert.ok(scheduled.every(item => !item.timer.hasRef()), 'maintenance timers do not keep the process alive');
  await stop(far.service);

  const submissionFile = path.join(root, 'new-submission', 'jobs.json');
  const submitted = serviceFor(submissionFile, path.join(root, 'new-submission', 'admission.json'));
  await submitted.service.initialize();
  const submissionTimers: Array<ReturnType<typeof setTimeout>> = [];
  let newPending: AgentJob;
  try {
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
      const timer = originalTimeout(callback, delay, ...args); submissionTimers.push(timer); return timer;
    }) as typeof setTimeout;
    newPending = await submitted.service.submit({ prompt: 'new durable approval needs a deadline timer', mode: 'workspace-write', scope });
  } finally { globalThis.setTimeout = originalTimeout; }
  assert.equal(submissionTimers.length, 1, 'new pending submission arms its deadline timer');
  assert.ok(newPending.durableApproval);
  const originalClearTimeout = globalThis.clearTimeout;
  const cleared: unknown[] = [];
  try {
    globalThis.clearTimeout = timer => { cleared.push(timer); originalClearTimeout(timer); };
    const denied = await submitted.service.decideApproval(newPending.id, scope, newPending.durableApproval!, 'deny');
    assert.equal(denied?.job.durableApproval?.state, 'denied');
  } finally { globalThis.clearTimeout = originalClearTimeout; }
  assert.ok(cleared.includes(submissionTimers[0]), 'settling the last pending approval clears its timer');
  await assertCapacityReleased(submitted.admission, scope); await stop(submitted.service);

  const failureFile = path.join(root, 'write-failure', 'jobs.json');
  const unsaved = pendingJob('unsaved-expiry', scope, Date.now() - 10);
  await atomicWriteJson(failureFile, [unsaved]);
  const savedNodeEnv = process.env.NODE_ENV; process.env.NODE_ENV = 'test';
  let refuseExpiry = true;
  const brokenStore = AgentJobStore.createForTesting(failureFile, {}, async (target, rows) => {
    if (refuseExpiry && (rows as AgentJob[]).some(job => job.durableApproval?.state === 'expired')) throw new Error('synthetic expiry persistence failure');
    await atomicWriteJson(target, rows);
  });
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
  const failure = serviceFor(failureFile, path.join(root, 'write-failure', 'admission.json'), { store: brokenStore });
  await assert.rejects(failure.service.initialize(), /synthetic expiry persistence failure/);
  assert.equal(brokenStore.get(unsaved.id, scope)?.status, 'awaiting_approval');
  assert.equal(failure.notifications.length, 0);
  assert.equal(failure.calls.dispatch, 0);
  await stop(failure.service);
  refuseExpiry = false;
  const repair = serviceFor(failureFile, path.join(root, 'write-failure', 'admission.json'));
  await repair.service.initialize();
  assert.equal(repair.store.get(unsaved.id, scope)?.durableApproval?.state, 'expired');
  assert.equal(repair.store.get(unsaved.id, scope)?.durableApproval?.deadline, unsaved.durableApproval?.deadline);
  await assertCapacityReleased(repair.admission, scope); await stop(repair.service);
  console.log('agent-approval-expiry-test: PASS');
} finally {
  await Promise.allSettled([...services].map(service => service.close()));
  await fs.rm(root, { recursive: true, force: true });
}
