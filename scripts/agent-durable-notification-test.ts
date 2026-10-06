import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentAdmissionController } from '../src/server/agent-admission-controller.js';
import { AgentJobStore, type AgentJob, type AgentJobScope } from '../src/server/agent-job-store.js';
import { AgentService, type AgentExecutionDispatcher, type AgentExecutionObservation, type AgentNotification } from '../src/server/agent-service.js';
import { GitService } from '../src/server/git-service.js';
import { RuntimeStoreAgentJobLedger } from '../src/server/storage/agent-job-durable-ledger.js';
import { RuntimeStoreConflictError, type RuntimeStore, type RuntimeScope, type RuntimeRecord, type RuntimeWrite } from '../src/server/storage/runtime-store.js';

const scope: AgentJobScope = { tenantId: 'fixture-tenant', requesterId: 'fixture-user', conversationId: 'fixture-chat' };
class Dispatcher implements AgentExecutionDispatcher {
  readonly kind = 'azure-queue' as const;
  readonly observations = new Map<string, AgentExecutionObservation>();
  async dispatch(job: AgentJob) { this.observations.set(job.id, { status: 'queued' }); }
  async observe(job: AgentJob) { return this.observations.get(job.id); }
  async cancel(job: AgentJob) { this.observations.set(job.id, { status: 'cancelled' }); }
}
class MemoryRuntimeStore implements RuntimeStore {
  private records = new Map<string, RuntimeRecord>();
  private revision = 0;
  private key(scope: RuntimeScope, id: string) { return JSON.stringify(scope) + '\0' + id; }
  async read<T>(scope: RuntimeScope, id: string): Promise<RuntimeRecord<T> | null> {
    const record = this.records.get(this.key(scope, id));
    return record ? structuredClone(record) as RuntimeRecord<T> : null;
  }
  async list<T>(scope: RuntimeScope): Promise<Array<RuntimeRecord<T>>> {
    return [...this.records].filter(([key]) => key.startsWith(JSON.stringify(scope) + '\0'))
      .map(([, record]) => structuredClone(record) as RuntimeRecord<T>);
  }
  async write<T>(scope: RuntimeScope, input: RuntimeWrite<T>): Promise<RuntimeRecord<T>> {
    const key = this.key(scope, input.id); const current = this.records.get(key);
    if ((current && input.expectedEtag !== current.etag) || (!current && input.expectedEtag)) {
      throw new RuntimeStoreConflictError('fixture stale ETag');
    }
    const now = new Date().toISOString();
    const record: RuntimeRecord<T> = {id:input.id, value:structuredClone(input.value), etag:`etag-${++this.revision}`,
      createdAt:current?.createdAt ?? now, updatedAt:now};
    this.records.set(key, structuredClone(record)); return structuredClone(record);
  }
}
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-durable-notification-'));
  const dispatcher = new Dispatcher();
  const notifications: AgentNotification[] = [];
  const services: AgentService[] = [];
  let failures = 0;
  function service(storeOverride?: AgentJobStore, interval = 10, afterDelivery?: () => Promise<void>, controller?: AgentAdmissionController) {
    const store = storeOverride ?? new AgentJobStore(path.join(root, 'jobs.json'));
    const agent = new AgentService(store, undefined, root, async (notification) => {
      if (failures > 0) { failures--; throw new Error('fixture delivery unavailable'); }
      notifications.push(notification);
      await afterDelivery?.();
    }, new GitService(root), {
      canReadScope: () => true, canMutateScope: () => true, executionDispatcher: dispatcher,
      durableObservationIntervalMs: interval,
      admissionController: controller ?? new AgentAdmissionController({ globalLimit: 4, perTenantLimit: 4, perRequesterLimit: 4 }, { journalPath: path.join(root, 'admission.json') }),
    });
    services.push(agent);
    return { agent, store };
  }
  return { root, dispatcher, notifications, service, failOnce: () => { failures = 1; },
    async cleanup() { for (const agent of services) await agent.close(); await fs.rm(root, { recursive: true, force: true }); } };
}
async function eventually(condition: () => boolean, message: string) {
  const deadline = Date.now() + 700;
  while (!condition() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(condition(), message);
}
async function boundedBarrier(barrier: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([barrier, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('fixture observer barrier timed out')), 1_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
const cases: Array<[string, () => Promise<void>]> = [
  ['progress and completion arrive without a status request', async () => {
    const f = await fixture(); try {
      const { agent } = f.service(); await agent.initialize();
      const job = await agent.submit({ prompt: 'fixture', provider: 'codex', mode: 'read-only', scope });
      f.dispatcher.observations.set(job.id, { status: 'running' });
      await eventually(() => f.notifications.some(n => n.phase === 'analysis'), 'durable start must notify without user polling');
      f.dispatcher.observations.set(job.id, { status: 'completed', result: 'fixture result', providerExecutionId: 'fixture-execution', executionReceipt: {source:'worker-observation', observedAt:'2026-10-06T00:00:00.000Z', platform:'linux'} });
      await eventually(() => f.notifications.some(n => n.kind === 'result'), 'durable completion must notify without user polling');
      assert.match(f.notifications.find(n => n.kind === 'result')!.message, /fixture result/);
      await Promise.all(Array.from({ length: 8 }, () => agent.observe(job.id, scope)));
      assert.equal(f.notifications.filter(n => n.kind === 'result').length, 1);
      await agent.close(); const restarted = f.service(); await restarted.agent.initialize();
      await restarted.agent.observe(job.id, scope);
      assert.equal(restarted.store.get(job.id, scope)?.executionReceipt?.platform, 'linux');
      assert.equal(restarted.store.get(job.id, scope)?.executionReceipt?.model, undefined, 'selected model is never actual model evidence');
      assert.equal(f.notifications.filter(n => n.kind === 'result').length, 1, 'persisted delivery suppresses restart duplicates');
    } finally { await f.cleanup(); }
  }],
  ['restart delivers a completed job that was never observed', async () => {
    const f = await fixture(); try {
      const { agent } = f.service(); await agent.initialize();
      const job = await agent.submit({ prompt: 'fixture', provider: 'codex', mode: 'read-only', scope }); await agent.close();
      f.dispatcher.observations.set(job.id, { status: 'completed', result: 'recovered result', providerExecutionId: 'fixture-recovery' });
      const restarted = f.service(); await restarted.agent.initialize();
      assert.equal(f.notifications.filter(n => n.kind === 'result').length, 1);
    } finally { await f.cleanup(); }
  }],
  ['failed and quarantined observations notify once', async () => {
    for (const status of ['failed', 'quarantined'] as const) {
      const f = await fixture(); try {
        const { agent } = f.service(); await agent.initialize();
        const job = await agent.submit({ prompt: 'fixture', provider: 'codex', mode: 'read-only', scope });
        f.dispatcher.observations.set(job.id, { status, error: 'fixture failure' });
        await agent.observe(job.id, scope); await agent.observe(job.id, scope);
        assert.equal(f.notifications.filter(n => n.kind === 'error').length, 1);
        assert.match(f.notifications.find(n => n.kind === 'error')!.message, /fixture failure/);
      } finally { await f.cleanup(); }
    }
  }],
  ['notify=false survives restart and every observation status', async () => {
    const f = await fixture(); try {
      const { agent } = f.service(); await agent.initialize();
      const job = await agent.submit({ prompt: 'fixture', provider: 'codex', mode: 'read-only', scope, notify: false });
      f.dispatcher.observations.set(job.id, { status: 'running' }); await agent.observe(job.id, scope); await agent.close();
      const restarted = f.service(); await restarted.agent.initialize();
      f.dispatcher.observations.set(job.id, { status: 'completed', result: 'silent result', providerExecutionId: 'fixture-silent' });
      await restarted.agent.observe(job.id, scope); assert.equal(f.notifications.length, 0);
    } finally { await f.cleanup(); }
  }],
  ['legacy active jobs with unknown notification intent stay silent', async () => {
    const f = await fixture(); try {
      const { agent, store } = f.service(); await store.initialize();
      const job = await store.create({ prompt: 'legacy silent fixture', provider: 'codex', mode: 'read-only', scope });
      f.dispatcher.observations.set(job.id, { status: 'running' });
      await agent.initialize();
      f.dispatcher.observations.set(job.id, { status: 'completed', result: 'legacy result' });
      await agent.observe(job.id, scope);
      assert.equal(f.notifications.length, 0, 'missing legacy intent cannot be inferred as notify=true');
    } finally { await f.cleanup(); }
  }],
  ['legacy terminal jobs are not replayed as new cards', async () => {
    const f = await fixture(); try {
      const { agent, store } = f.service(); await store.initialize();
      const job = await store.create({ prompt: 'legacy fixture', provider: 'codex', mode: 'read-only', scope });
      await store.update(job.id, scope, { status: 'completed', result: 'old result' });
      f.dispatcher.observations.set(job.id, { status: 'completed', result: 'old result' });
      await agent.initialize(); await agent.observe(job.id, scope);
      assert.equal(f.notifications.length, 0);
    } finally { await f.cleanup(); }
  }],
  ['notify=false suppresses durable failure after restart', async () => {
    const f = await fixture(); try {
      const { agent } = f.service(); await agent.initialize();
      const job = await agent.submit({ prompt: 'silent failure', provider: 'codex', mode: 'read-only', scope, notify: false });
      await agent.close(); f.dispatcher.observations.set(job.id, { status: 'failed', error: 'fixture failure' });
      const restarted = f.service(); await restarted.agent.initialize();
      await restarted.agent.observe(job.id, scope); assert.equal(f.notifications.length, 0);
    } finally { await f.cleanup(); }
  }],
  ['notification metadata validates and cannot alias stored state', async () => {
    const f = await fixture(); try {
      const { agent, store } = f.service(); await agent.initialize();
      const job = await agent.submit({ prompt: 'metadata fixture', provider: 'codex', mode: 'read-only', scope });
      job.durableNotifications!.delivered.push('completed');
      assert.deepEqual(store.get(job.id, scope)?.durableNotifications?.delivered, []);
      await assert.rejects(store.update(job.id, scope, { durableNotifications: { enabled: false, delivered: [] } }), /immutable/);
      await assert.rejects(store.update(job.id, scope, { durableNotifications: { enabled: true, delivered: ['bogus'] as any } }), /invalid/);
      assert.equal(store.get(job.id, scope)?.durableNotifications?.enabled, true);
      await agent.close();
      const raw = JSON.parse(await fs.readFile(path.join(f.root, 'jobs.json'), 'utf8'));
      raw[0].durableNotifications.enabled = 'false';
      await fs.writeFile(path.join(f.root, 'jobs.json'), JSON.stringify(raw));
      await assert.rejects(f.service().store.initialize(), /durableNotifications/);
    } finally { await f.cleanup(); }
  }],
  ['closing stops background observations', async () => {
    const f = await fixture(); try {
      const { agent } = f.service(); await agent.initialize();
      const job = await agent.submit({ prompt: 'closed fixture', provider: 'codex', mode: 'read-only', scope });
      await agent.close();
      f.dispatcher.observations.set(job.id, { status: 'completed', result: 'after close', providerExecutionId: 'fixture-after-close' });
      await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(f.notifications.length, 0);
    } finally { await f.cleanup(); }
  }],
  ['failed delivery is retried without corrupting the terminal job', async () => {
    const f = await fixture(); try {
      const { agent, store } = f.service(); await agent.initialize();
      const job = await agent.submit({ prompt: 'fixture', provider: 'codex', mode: 'read-only', scope });
      f.failOnce(); f.dispatcher.observations.set(job.id, { status: 'completed', result: 'retry result', providerExecutionId: 'fixture-retry' });
      await agent.observe(job.id, scope); assert.equal(store.get(job.id, scope)?.status, 'completed');
      f.dispatcher.observations.delete(job.id);
      await eventually(() => f.notifications.some(n => n.kind === 'result'), 'unsent terminal delivery must retry even after queue retention ends');
      await agent.observe(job.id, scope); assert.equal(f.notifications.filter(n => n.kind === 'result').length, 1);
    } finally { await f.cleanup(); }
  }],
  ['distinct observers can duplicate concurrent unacknowledged delivery, then stay quiet', async () => {
    const f = await fixture(); try {
      const shared = new AgentJobStore(path.join(f.root, 'jobs.json'));
      let arrived = 0;
      let release!: () => void;
      const bothSent = new Promise<void>(resolve => { release = resolve; });
      const afterDelivery = async () => { if (++arrived === 2) release(); await boundedBarrier(bothSent); };
      const first = f.service(shared, 100_000, afterDelivery);
      const second = f.service(shared, 100_000, afterDelivery);
      await first.agent.initialize(); await second.agent.initialize();
      // Focus on terminal notification delivery; admission lifecycle has already ended.
      const job = await shared.create({ prompt: 'concurrent observer fixture', provider: 'codex', mode: 'read-only', scope, durableNotifications:{enabled:true, delivered:[]} });
      await shared.update(job.id, scope, {status:'completed', result:'two observers fixture'});
      await Promise.all([first.agent.observe(job.id, scope), second.agent.observe(job.id, scope)]);
      assert.equal(f.notifications.filter(n => n.kind === 'result').length, 2,
        'per-instance locks cannot promise exactly-once across distinct observers');
      assert.deepEqual(shared.get(job.id, scope)?.durableNotifications?.delivered, ['completed']);
      await Promise.all(Array.from({length:8}, (_, i) => (i % 2 ? first : second).agent.observe(job.id, scope)));
      assert.equal(f.notifications.filter(n => n.kind === 'result').length, 2, 'acknowledged delivery must stay quiet');
      await first.agent.close(); await second.agent.close();
      const restarted = f.service(undefined, 100_000); await restarted.agent.initialize();
      assert.equal(f.notifications.filter(n => n.kind === 'result').length, 2, 'persisted ack suppresses replay');
    } finally { await f.cleanup(); }
  }],
  ['independent ledger observers preserve CAS and durable ack despite duplicate send', async () => {
    const f = await fixture(); try {
      const runtime = new MemoryRuntimeStore();
      const makeStore = (name: string) => new AgentJobStore(path.join(f.root, name), {durableLedger:new RuntimeStoreAgentJobLedger(runtime)});
      const seed = makeStore('seed.json'); await seed.initialize();
      const job = await seed.create({prompt:'ledger observer fixture', provider:'codex', mode:'read-only', scope,
        durableNotifications:{enabled:true, delivered:[]}});
      await seed.update(job.id, scope, {status:'completed', result:'ledger terminal fixture'});
      let arrived = 0; let release!: () => void;
      const barrier = new Promise<void>(resolve => { release = resolve; });
      const afterDelivery = async () => { if (++arrived === 2) release(); await boundedBarrier(barrier); };
      const first = f.service(makeStore('first.json'), 100_000, afterDelivery);
      const second = f.service(makeStore('second.json'), 100_000, afterDelivery);
      const outcomes = await Promise.allSettled([first.agent.initialize(), second.agent.initialize()]);
      assert.equal(f.notifications.filter(n => n.kind === 'result').length, 2, 'send precedes the cross-observer CAS ack');
      assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
      const rejected = outcomes.find(o => o.status === 'rejected');
      assert.ok(rejected?.status === 'rejected' && rejected.reason instanceof RuntimeStoreConflictError,
        'stale observer must fail CAS rather than overwrite the winning ack');
      await first.agent.close(); await second.agent.close();
      const restarted = f.service(makeStore('restart.json'), 100_000); await restarted.agent.initialize();
      assert.deepEqual(restarted.store.get(job.id, scope)?.durableNotifications?.delivered, ['completed']);
      await restarted.agent.observe(job.id, scope);
      assert.equal(f.notifications.filter(n => n.kind === 'result').length, 2, 'fresh observer sees durable ack and suppresses replay');
    } finally { await f.cleanup(); }
  }],
  ['send-before-ack crash gap resends once after restart and persists the ack', async () => {
    const f = await fixture(); try {
      class CrashBeforeAckStore extends AgentJobStore {
        override async update(...args: Parameters<AgentJobStore['update']>) {
          if (args[2].durableNotifications?.delivered.includes('completed')) {
            throw new Error('fixture crash after send before durable ack');
          }
          return super.update(...args);
        }
      }
      const store = new CrashBeforeAckStore(path.join(f.root, 'jobs.json'));
      const first = f.service(store, 100_000); await first.agent.initialize();
      const job = await first.agent.submit({prompt:'crash gap fixture', provider:'codex', mode:'read-only', scope});
      f.dispatcher.observations.set(job.id, {status:'completed', result:'durable result before crash'});
      await assert.rejects(first.agent.observe(job.id, scope), /fixture crash after send/);
      assert.equal(f.notifications.filter(n => n.kind === 'result').length, 1, 'sink received before failed ack');
      await first.agent.close();
      const raw = JSON.parse(await fs.readFile(path.join(f.root, 'jobs.json'), 'utf8'));
      assert.equal(raw[0].status, 'completed'); assert.deepEqual(raw[0].durableNotifications.delivered, []);
      const restarted = f.service(undefined, 100_000); await restarted.agent.initialize();
      assert.equal(f.notifications.filter(n => n.kind === 'result').length, 2, 'at-least-once replay is expected in the crash gap');
      assert.deepEqual(restarted.store.get(job.id, scope)?.durableNotifications?.delivered, ['completed']);
      await restarted.agent.close();
      const again = f.service(undefined, 100_000); await again.agent.initialize();
      await Promise.all(Array.from({length:8}, () => again.agent.observe(job.id, scope)));
      assert.equal(f.notifications.filter(n => n.kind === 'result').length, 2, 'later restart and polls do not resend acknowledged result');
    } finally { await f.cleanup(); }
  }],
  ['cleanup failure stays visible across polling/restart until authorized recovery succeeds', async () => {
    const f = await fixture(); try {
      class ReleaseFailureController extends AgentAdmissionController {
        failures = 2;
        override async releaseToken(token: string) {
          if (this.failures > 0) { this.failures--; throw new Error('fixture admission release failure'); }
          return super.releaseToken(token);
        }
      }
      const journal = path.join(f.root, 'cleanup-admission.json');
      const controller = new ReleaseFailureController({globalLimit:4, perTenantLimit:4, perRequesterLimit:4}, {journalPath:journal});
      const first = f.service(undefined, 100_000, undefined, controller); await first.agent.initialize();
      const job = await first.agent.submit({prompt:'cleanup failure fixture', provider:'codex', mode:'read-only', scope});
      f.dispatcher.observations.set(job.id, {status:'completed', result:'worker result remains authoritative'});
      await assert.rejects(first.agent.observe(job.id, scope), /fixture admission release failure/);
      assert.equal(controller.snapshot().global, 1);
      await first.agent.observe(job.id, scope);
      assert.match(first.store.get(job.id,scope)?.error ?? '', /AGENT_RECONCILIATION_REQUIRED/);
      await first.agent.reconcileTerminal(job.id, scope); // Explicit recovery still fails its release.
      assert.equal(controller.snapshot().global, 1);
      await first.agent.observe(job.id, scope);
      assert.match(first.store.get(job.id,scope)?.error ?? '', /AGENT_RECONCILIATION_REQUIRED/);
      await first.agent.close();
      const restartedController = new AgentAdmissionController({globalLimit:4, perTenantLimit:4, perRequesterLimit:4}, {journalPath:journal});
      const restarted = f.service(undefined, 100_000, undefined, restartedController); await restarted.agent.initialize();
      assert.equal(restartedController.snapshot().global, 1, 'restart cannot automatically release unresolved capacity');
      assert.match(restarted.store.get(job.id,scope)?.error ?? '', /AGENT_RECONCILIATION_REQUIRED/);
      const denied = new AgentService(restarted.store, undefined, f.root, async () => undefined, new GitService(f.root), {
        canReadScope: () => true, canMutateScope: () => false, admissionController: restartedController,
      });
      await assert.rejects(denied.reconcileTerminal(job.id,scope), /허용|권한|operator|authorized/i);
      assert.equal(restartedController.snapshot().global, 1, 'permission denial cannot release unresolved capacity');
      assert.equal(await restarted.agent.reconcileTerminal(job.id,{...scope,requesterId:'another-fixture'}), undefined);
      assert.equal(restartedController.snapshot().global, 1, 'scope mismatch cannot release another job');
      const recoveries = await Promise.all(Array.from({length:8}, () => restarted.agent.reconcileTerminal(job.id,scope)));
      const recovered = recoveries[0];
      assert.ok(recoveries.every(job => job?.error === undefined), 'concurrent explicit recovery must not resurrect missing-lease errors');
      assert.equal(restartedController.snapshot().global, 0, 'authorized recovery releases capacity after cleanup succeeds');
      assert.equal(recovered?.status, 'completed'); assert.equal(recovered?.result, 'worker result remains authoritative');
      assert.equal(recovered?.error, undefined, 'successful explicit cleanup clears only its reconciliation marker');
      await restarted.agent.observe(job.id,scope);
      assert.equal(restarted.store.get(job.id,scope)?.error, undefined);
      assert.equal(f.notifications.filter(n => n.kind === 'result').length, 1, 'cleanup retries do not duplicate an acknowledged result');
    } finally { await f.cleanup(); }
  }],
  ['supported single observer exposes terminal-persisted crash cleanup on restart', async () => {
    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      for (const phase of ['bound', 'terminal_pending'] as const) {
        for (const acknowledged of (status === 'cancelled' ? [false] : [false, true])) {
          const f = await fixture(); try {
            const journal = path.join(f.root, 'crash-admission.json');
            const controller = new AgentAdmissionController({globalLimit:4, perTenantLimit:4, perRequesterLimit:4}, {journalPath:journal});
            const seed = new AgentJobStore(path.join(f.root,'jobs.json')); await seed.initialize();
            const job = await seed.create({prompt:'terminal-persisted crash fixture', provider:'codex', mode:'read-only', scope,
              durableNotifications:{enabled:true, delivered:acknowledged && status !== 'cancelled' ? [status] : []}});
            const acquired = await controller.tryAcquire(scope); assert.ok(acquired.ok); await acquired.lease.bindJob(job.id);
            await seed.update(job.id,scope,{status, ...(status === 'completed' ? {result:'persisted worker result'} : status === 'failed' ? {error:'original worker failure'} : {})});
            if (phase === 'terminal_pending') await acquired.lease.markTerminalPending();
            // Exact crash cut: terminal job persisted; admission still bound/pending; no cleanup marker.
            // No first service/timer is started, and no graceful shutdown mutates this persisted cut.
            f.dispatcher.observations.set(job.id,{status, ...(status === 'completed' ? {result:'persisted worker result'} : status === 'failed' ? {error:'original worker failure'} : {})});
            const freshController = new AgentAdmissionController({globalLimit:4, perTenantLimit:4, perRequesterLimit:4}, {journalPath:journal});
            const restarted = f.service(undefined,100_000,undefined,freshController); await restarted.agent.initialize();
            const restored = restarted.store.get(job.id,scope)!;
            assert.equal(freshController.snapshot().global,1,'crash recovery cannot silently release unresolved capacity');
            assert.match([restored.error,...restored.progress].join('\n'),/AGENT_RECONCILIATION_REQUIRED/,'pending crash cleanup must be visible');
            if (status === 'failed') assert.match(restored.error ?? '', /original worker failure/, 'worker failure must not be hidden by cleanup diagnostics');
            assert.equal(f.notifications.length, status === 'cancelled' || acknowledged ? 0 : 1, 'unsent result/failure is delivered; durable ack is not replayed');
            const recovered = await restarted.agent.reconcileTerminal(job.id,scope);
            assert.equal(freshController.snapshot().global,0,'authorized recovery clears this owner reservation');
            assert.equal(recovered?.status,status);
            if (status === 'failed') assert.equal(recovered?.error,'original worker failure','cleanup recovery preserves authoritative worker error');
            else assert.equal(recovered?.error,undefined);
            await restarted.agent.observe(job.id,scope);
            assert.equal(f.notifications.length,status === 'cancelled' || acknowledged ? 0 : 1,'cleanup recovery must not hide/replay acknowledged notifications');
          } finally { await f.cleanup(); }
        }
      }
    }
  }],
  ['unsupported replicas retain independent admission ownership while shared ledger CAS protects state', async () => {
    const f = await fixture(); try {
      const runtime = new MemoryRuntimeStore();
      const makeStore = (name:string) => new AgentJobStore(path.join(f.root,name),{durableLedger:new RuntimeStoreAgentJobLedger(runtime)});
      const seed = makeStore('seed.json'); await seed.initialize();
      const job = await seed.create({prompt:'unsupported replicas boundary fixture',provider:'codex',mode:'read-only',scope,durableNotifications:{enabled:true,delivered:[]}});
      const makeController = (name:string) => new AgentAdmissionController({globalLimit:4,perTenantLimit:4,perRequesterLimit:4},{journalPath:path.join(f.root,name)});
      const controllers=[makeController('replica-a.json'),makeController('replica-b.json')];
      // Boundary probe, not a supported deployment: independent replicas can each own admission for the same job.
      for(const controller of controllers){const acquired=await controller.tryAcquire(scope);assert.ok(acquired.ok);await acquired.lease.bindJob(job.id);}
      const services=[f.service(makeStore('a.json'),100_000,undefined,controllers[0]),f.service(makeStore('b.json'),100_000,undefined,controllers[1])];
      f.dispatcher.observations.set(job.id,{status:'queued'});
      for(const service of services) await service.agent.initialize();
      f.dispatcher.observations.set(job.id,{status:'completed',result:'shared worker result'});
      const outcomes=await Promise.allSettled(services.map(service=>service.agent.observe(job.id,scope)));
      assert.equal(outcomes.filter(outcome=>outcome.status==='fulfilled').length,1);
      assert.ok(outcomes.some(outcome=>outcome.status==='rejected' && outcome.reason instanceof RuntimeStoreConflictError),'stale replica must not overwrite ledger');
      assert.equal(controllers.reduce((sum,controller)=>sum+controller.snapshot().global,0),1,'one replica release cannot release another independent journal');
      assert.equal(f.notifications.filter(n=>n.kind==='result').length,1,'losing terminal CAS happens before this fixture sends');
    } finally { await f.cleanup(); }
  }],
];
let failed = 0;
for (const [name, run] of cases) {
  try { await run(); console.log('PASS:', name); }
  catch (error) { failed++; console.error('FAIL:', name, error); }
}
assert.equal(failed, 0, `${failed} durable notification contracts failed`);
