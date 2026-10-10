import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicWriteJson } from '../src/server/atomic-file.js';
import { TeamsJobProgressCoordinator } from '../src/server/teams-job-progress-coordinator.js';
import { TeamsJobProgressJsonStore } from '../src/server/teams-job-progress-store.js';
import {
  TeamsJobProgressTransport, type TeamsJobProgressBinding, type TeamsJobProgressLedger,
  type TeamsJobProgressRequest, type TeamsJobProgressReceipt, type TeamsJobProgressSnapshot,
} from '../src/server/teams-job-progress.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-stop-dispatch-synthetic-'));
const realSetTimeout = globalThis.setTimeout, realClearTimeout = globalThis.clearTimeout, realNow = Date.now;
const watchdog = realSetTimeout(() => { console.error('progress-stop-dispatch test timeout (20s)'); process.exit(1); }, 20_000);
type Timer = { due: number; fire(): void; unref(): Timer };
class Clock {
  now = 1_720_000_000_000; readonly timers = new Set<Timer>();
  install() {
    Date.now = () => this.now;
    globalThis.setTimeout = ((callback: (...args: unknown[]) => void, delay = 0, ...args: unknown[]) => {
      const timer: Timer = { due: this.now + Number(delay), fire: () => callback(...args), unref() { return this; } };
      this.timers.add(timer); return timer;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((timer: unknown) => { this.timers.delete(timer as Timer); }) as typeof clearTimeout;
  }
  advance(ms: number) {
    this.now += ms;
    for (const timer of [...this.timers].sort((left, right) => left.due - right.due)) {
      if (timer.due <= this.now && this.timers.delete(timer)) timer.fire();
    }
  }
  restore() { Date.now = realNow; globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout; }
}
const binding: TeamsJobProgressBinding = { jobId: 'synthetic-owner', tenantId: 'synthetic-tenant', requesterId: 'synthetic-requester',
  conversationId: 'synthetic-chat', conversationType: 'personal', originActivityId: 'synthetic-origin',
  originThreadId: 'synthetic-thread', serviceUrl: 'https://smba.trafficmanager.net/amer/' };
type Value = Omit<TeamsJobProgressSnapshot, 'revision'>;
type Options = { onStopped?(binding: TeamsJobProgressBinding): Promise<void>; latestSnapshot?(binding: TeamsJobProgressBinding): Promise<Value | undefined> };
type Marker = { operationId: string; binding: TeamsJobProgressBinding; state: 'claimed' | 'settled' | 'ambiguous'; claimedAt: number; settledAt?: number };
const value = (text: string, status: Value['status'] = 'running'): Value => ({ status, text });
const markerOf = (ledger: TeamsJobProgressLedger): Marker | undefined => (ledger.records[0] as unknown as { stopDispatch?: Marker } | undefined)?.stopDispatch;
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer!: ReturnType<typeof realSetTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timer = realSetTimeout(() => reject(new Error(`SYNTHETIC_BOUND:${label}`)), 1000); })]); }
  finally { realClearTimeout(timer); }
}
let index = 0; let coordinators: TeamsJobProgressCoordinator[] = [];
function fixture(clock: Clock, options?: Options, writer?: typeof atomicWriteJson) {
  const file = path.join(root, `private-${index++}`, 'progress.json'); const state = new TeamsJobProgressJsonStore(file, writer);
  const calls: TeamsJobProgressRequest[] = []; let receipt: TeamsJobProgressReceipt = { state: 'accepted', activityId: 'synthetic-stream' };
  const adapter = { send: async (request: TeamsJobProgressRequest) => { calls.push(structuredClone(request)); return structuredClone(receipt); } };
  const make = (settings = options, port = state, transport = new TeamsJobProgressTransport({ state: port, adapter, now: () => clock.now })) => {
    const coordinator = new TeamsJobProgressCoordinator(port, transport, settings); coordinators.push(coordinator); return coordinator;
  };
  const coordinator = make();
  return { file, state, calls, make, coordinator, read: async () => JSON.parse(await fs.readFile(file, 'utf8')) as TeamsJobProgressLedger,
    receipt: (next: TeamsJobProgressReceipt) => { receipt = next; },
    stop: async () => {
      await coordinator.publish(binding, value('initial')); clock.advance(1000);
      receipt = { state: 'rejected', reason: 'stopped' };
      return coordinator.publish(binding, value('native stop receipt'));
    } };
}
const tests: Array<[string, (clock: Clock) => Promise<void>]> = [
  ['definite native Stop reserves durable owner claim before invoking cancellation exactly once', async clock => {
    let invoked = 0; const scopes: TeamsJobProgressBinding[] = [];
    const f = fixture(clock, { onStopped: async scope => {
      invoked++; scopes.push(structuredClone(scope)); const marker = markerOf(await f.read());
      assert.equal(marker?.state, 'claimed', 'callback requires a persisted dispatch claim');
      assert.deepEqual(marker.binding, binding); scope.tenantId = 'caller-mutation';
    } });
    assert.equal((await f.stop()).state, 'stopped'); await f.coordinator.close();
    assert.equal(invoked, 1, 'verified native Stop must cancel its job exactly once'); assert.deepEqual(scopes, [binding]);
    assert.equal(markerOf(await f.read())?.state, 'settled'); assert.deepEqual((await f.read()).records[0].binding, binding);
    const restarted = f.make({ onStopped: async () => { invoked++; } }, new TeamsJobProgressJsonStore(f.file));
    await restarted.recover(); await restarted.publish(binding, value('late cancelled notification', 'cancelled')); await restarted.close();
    assert.equal(invoked, 1, 'settled cancellation must survive restart without a second callback'); assert.equal(f.calls.length, 2);
  }],
  ['ambiguous rejected and terminal progress cannot mint native Stop cancellation', async clock => {
    for (const receipt of [{ state: 'ambiguous' }, { state: 'rejected', reason: 'rejected' }, { state: 'accepted', activityId: 'synthetic-stream' }] as const) {
      let cancelled = 0; const f = fixture(clock, { onStopped: async () => { cancelled++; } });
      await f.coordinator.publish(binding, value('initial')); clock.advance(1000); f.receipt(receipt);
      await f.coordinator.publish(binding, value('cancelled business notification', 'cancelled')); await f.coordinator.close();
      assert.equal(cancelled, 0); assert.equal(markerOf(await f.read()), undefined);
    }
    let cancelled = 0; const f = fixture(clock);
    const transport = new TeamsJobProgressTransport({ state: f.state, adapter: { send: async () => ({ state: 'accepted', activityId: 'synthetic-stream' }) }, now: () => clock.now });
    const publish = transport.publish.bind(transport);
    transport.publish = async (...args) => ({ ...await publish(...args), state: 'stopped' });
    const fakeResult = f.make({ onStopped: async () => { cancelled++; } }, f.state, transport);
    await fakeResult.publish(binding, value('result alone is not authority')); await fakeResult.close();
    assert.equal(cancelled, 0, 'only the durable stopped record can authorize cancellation');
  }],
  ['timer flush Stop dispatches its recorded owner without blocking shutdown', async clock => {
    let cancelled = 0; const f = fixture(clock, { onStopped: async scope => { assert.deepEqual(scope, binding); cancelled++; } });
    await f.coordinator.publish(binding, value('initial')); f.receipt({ state: 'rejected', reason: 'stopped' });
    await f.coordinator.publish(binding, value('coalesced')); clock.advance(1000); await f.coordinator.close();
    assert.equal(cancelled, 1); assert.equal(markerOf(await f.read())?.state, 'settled'); assert.equal(f.calls.length, 2);
  }],
  ['unknown cancellation callback outcome is durable ambiguous and never retried', async clock => {
    let cancelled = 0; const f = fixture(clock, { onStopped: async () => { cancelled++; throw Object.assign(new Error('synthetic lost cancellation outcome'), { code: 'ETIMEDOUT' }); } });
    await f.stop(); await f.coordinator.close(); assert.equal(cancelled, 1); assert.equal(markerOf(await f.read())?.state, 'ambiguous');
    const restarted = f.make({ onStopped: async () => { cancelled++; } }, new TeamsJobProgressJsonStore(f.file));
    await restarted.recover(); await restarted.publish(binding, value('same stopped owner')); await restarted.close();
    assert.equal(cancelled, 1); assert.equal(markerOf(await f.read())?.state, 'ambiguous'); assert.equal(f.calls.length, 2);
  }],
  ['restart with a persisted claimed callback intent never invokes it again', async clock => {
    const f = fixture(clock); await f.stop(); await f.coordinator.close();
    await f.state.transact(ledger => { (ledger.records[0] as any).stopDispatch = {
      operationId: 'synthetic-reserved-stop', binding: structuredClone(binding), state: 'claimed', claimedAt: clock.now,
    }; });
    let cancelled = 0; const restarted = f.make({ latestSnapshot: async () => undefined, onStopped: async () => { cancelled++; } }, new TeamsJobProgressJsonStore(f.file));
    await restarted.recover(); await restarted.publish(binding, value('later stopped progress')); await restarted.close();
    assert.equal(cancelled, 0); assert.equal(markerOf(await f.read())?.operationId, 'synthetic-reserved-stop');
    assert.equal(markerOf(await f.read())?.state, 'ambiguous'); assert.equal((await f.read()).records[0].state, 'stopped');
  }],
  ['failed atomic claim persistence cannot invoke the callback or reset state', async clock => {
    let fail = true; let cancelled = 0;
    const f = fixture(clock, { onStopped: async () => { cancelled++; } }, async (file, ledger) => {
      if (fail && markerOf(ledger as TeamsJobProgressLedger)?.state === 'claimed') throw new Error('synthetic claim write failure');
      await atomicWriteJson(file, ledger);
    });
    await assert.rejects(f.stop(), /synthetic claim write failure/); await f.coordinator.close(); assert.equal(cancelled, 0); assert.equal(markerOf(await f.read()), undefined);
    assert.equal((await f.read()).records[0].state, 'stopped'); fail = false;
  }],
  ['Stop publish waits for durable claim persistence before releasing or invoking callback', async clock => {
    const entered = deferred(), release = deferred(); let cancelled = 0;
    const f = fixture(clock, { onStopped: async () => { cancelled++; } }, async (file, ledger) => {
      if (markerOf(ledger as TeamsJobProgressLedger)?.state === 'claimed') { entered.resolve(); await release.promise; }
      await atomicWriteJson(file, ledger);
    });
    try {
      let resolved = false; const stopping = f.stop().then(result => { resolved = true; return result; });
      await bounded(entered.promise, 'durable claim writer');
      assert.equal(resolved, false); assert.equal(cancelled, 0); assert.equal(markerOf(await f.read()), undefined);
      release.resolve(); await bounded(stopping, 'durable claim release'); await f.coordinator.close();
      assert.equal(cancelled, 1); assert.equal(markerOf(await f.read())?.state, 'settled');
    } finally { release.resolve(); }
  }],
  ['settlement write failure retains the durable claim and restart never resends cancellation', async clock => {
    let fail = true; let cancelled = 0;
    const f = fixture(clock, { onStopped: async () => { cancelled++; } }, async (file, ledger) => {
      const marker = markerOf(ledger as TeamsJobProgressLedger);
      if (fail && marker && marker.state !== 'claimed') throw new Error('synthetic settlement write failure');
      await atomicWriteJson(file, ledger);
    });
    await f.stop(); await f.coordinator.close(); assert.equal(cancelled, 1); assert.equal(markerOf(await f.read())?.state, 'claimed');
    const operationId = markerOf(await f.read())!.operationId; fail = false;
    const restarted = f.make({ onStopped: async () => { cancelled++; } }, new TeamsJobProgressJsonStore(f.file));
    await restarted.recover(); await restarted.close();
    assert.equal(cancelled, 1); assert.equal(markerOf(await f.read())?.operationId, operationId); assert.equal(markerOf(await f.read())?.state, 'ambiguous');
  }],
  ['Stop callback can await cancelled-notification publish without per-job deadlock', async clock => {
    const finished = deferred(); let cancelled = 0;
    const f = fixture(clock, { onStopped: async scope => {
      cancelled++; await f.coordinator.publish(scope, value('cancelled notification', 'cancelled')); finished.resolve();
    } });
    await f.stop(); await bounded(finished.promise, 'cancelled notification reentry'); await f.coordinator.close();
    assert.equal(cancelled, 1); assert.equal((await f.read()).records[0].latest.status, 'cancelled');
    assert.equal(markerOf(await f.read())?.state, 'settled'); assert.equal(f.calls.length, 2);
  }],
  ['publish releases its job chain while close drains a still-running Stop callback', async clock => {
    const entered = deferred(), release = deferred(); let cancelled = 0;
    const f = fixture(clock, { onStopped: async () => { cancelled++; entered.resolve(); await release.promise; } });
    try {
      await bounded(f.stop(), 'Stop publish must not await cancellation'); await bounded(entered.promise, 'callback entry');
      await bounded(f.coordinator.publish(binding, value('notification while cancelling', 'cancelled')), 'job chain while callback pending');
      let closed = false; const closing = f.coordinator.close().then(() => { closed = true; });
      await f.read(); assert.equal(closed, false); assert.equal(markerOf(await f.read())?.state, 'claimed');
      release.resolve(); await bounded(closing, 'close callback drain'); assert.equal(closed, true); assert.equal(cancelled, 1);
      assert.equal(markerOf(await f.read())?.state, 'settled');
    } finally { release.resolve(); }
  }],
  ['durable ownership prevents duplicate dispatch across coordinators and forged marker bindings', async clock => {
    let first = 0, second = 0; const entered = deferred(), release = deferred();
    const f = fixture(clock, { onStopped: async () => { first++; entered.resolve(); await release.promise; } });
    try {
      await f.stop(); await bounded(entered.promise, 'first owner claim');
      const competitor = f.make({ onStopped: async () => { second++; } });
      await competitor.publish(binding, value('same durable owner'));
      await assert.rejects(competitor.publish({ ...binding, tenantId: 'forged-tenant' }, value('forged scope')), /AUTHORITY/);
      release.resolve(); await Promise.all([f.coordinator.close(), competitor.close()]);
      assert.equal(first, 1); assert.equal(second, 0); assert.deepEqual(markerOf(await f.read())?.binding, binding);
      const original = await f.read(); const forged = structuredClone(original);
      (forged.records[0] as any).stopDispatch.binding.requesterId = 'other-requester';
      await atomicWriteJson(f.file, forged); await assert.rejects(new TeamsJobProgressJsonStore(f.file).initialize(), /AUTHORITY|STOP_DISPATCH|STATE_INVALID/);
      const active = structuredClone(original); active.records[0].state = 'active';
      await atomicWriteJson(f.file, active); await assert.rejects(new TeamsJobProgressJsonStore(f.file).initialize(), /STOP_DISPATCH|STATE_INVALID/);
      const invalid = structuredClone(original); (invalid.records[0] as any).stopDispatch.state = 'reset';
      await atomicWriteJson(f.file, invalid); await assert.rejects(new TeamsJobProgressJsonStore(f.file).initialize(), /STOP_DISPATCH|STATE_INVALID/);
      await atomicWriteJson(f.file, original);
    } finally { release.resolve(); }
  }],
];
try {
  const failures: string[] = [];
  const selected = process.argv.includes('--first-case') ? tests.slice(0, 1) : tests;
  for (const [name, test] of selected) {
    const clock = new Clock(); coordinators = []; clock.install();
    try { await test(clock); console.log(`PASS ${name}`); }
    catch (error) { failures.push(name); console.error(`FAIL ${name}`, error); }
    finally { await bounded(Promise.allSettled(coordinators.map(coordinator => coordinator.close())), 'fixture shutdown'); clock.restore(); }
  }
  assert.equal(failures.length, 0, failures.join(', ')); console.log(`teams-job-progress-stop-dispatch: ${selected.length} synthetic cases passed`);
} finally { realClearTimeout(watchdog); Date.now = realNow; globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout; await fs.rm(root, { recursive: true, force: true }); }
