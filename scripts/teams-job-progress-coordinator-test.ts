import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TeamsJobProgressCoordinator } from '../src/server/teams-job-progress-coordinator.js';
import { TeamsJobProgressJsonStore } from '../src/server/teams-job-progress-store.js';
import {
  TeamsJobProgressTransport, type TeamsJobProgressBinding, type TeamsJobProgressLedger,
  type TeamsJobProgressRequest, type TeamsJobProgressReceipt, type TeamsJobProgressSnapshot,
  type TeamsJobProgressStatePort,
} from '../src/server/teams-job-progress.js';

// Only synthetic private temp files and in-process adapters. Timers use a fake
// clock so no wall-clock wait or Teams request is needed to prove scheduling.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-progress-coordinator-synthetic-'));
const actualSetTimeout = globalThis.setTimeout;
const actualClearTimeout = globalThis.clearTimeout;
const actualNow = Date.now;
const watchdog = actualSetTimeout(() => { console.error('progress-coordinator test timeout (20s)'); process.exit(1); }, 20_000);
watchdog.unref();
type Timer = { due: number; fire: () => void; unref(): Timer };
class Clock {
  now = 1_720_000_000_000;
  readonly timers = new Set<Timer>();
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
  restore() { globalThis.setTimeout = actualSetTimeout; globalThis.clearTimeout = actualClearTimeout; Date.now = actualNow; }
}
const binding: TeamsJobProgressBinding = { jobId: 'synthetic-job', tenantId: 'synthetic-tenant', requesterId: 'synthetic-requester',
  conversationId: 'synthetic-chat', conversationType: 'personal', originActivityId: 'synthetic-origin',
  originThreadId: 'synthetic-thread', serviceUrl: 'https://smba.trafficmanager.net/amer/' };
type Value = Omit<TeamsJobProgressSnapshot, 'revision'>;
type Authority = { latestSnapshot(binding: TeamsJobProgressBinding): Promise<Value | undefined> };
const progress = (text: string, status: Value['status'] = 'running'): Value => ({ status, text });
let fixtureIndex = 0;
let activeCoordinators: TeamsJobProgressCoordinator[] = [];
function fixture(clock: Clock) {
  const file = path.join(root, `private-${fixtureIndex++}`, 'progress.json');
  const state = new TeamsJobProgressJsonStore(file);
  const calls: TeamsJobProgressRequest[] = [];
  let receipt: ((request: TeamsJobProgressRequest) => Promise<TeamsJobProgressReceipt>) | undefined;
  const adapter = { send: async (request: TeamsJobProgressRequest): Promise<TeamsJobProgressReceipt> => {
    calls.push(structuredClone(request));
    return receipt ? receipt(request) : { state: 'accepted', activityId: request.activityId ?? `synthetic-activity-${calls.length}` };
  } };
  function make(port: TeamsJobProgressStatePort = state, authority?: Authority) {
    const transport = new TeamsJobProgressTransport({ state: port, adapter, now: () => clock.now });
    const coordinator = new TeamsJobProgressCoordinator(port, transport, authority);
    activeCoordinators.push(coordinator); return coordinator;
  }
  return { file, state, calls, make, coordinator: make(),
    read: async () => JSON.parse(await fs.readFile(file, 'utf8')) as TeamsJobProgressLedger,
    respond: (value: typeof receipt) => { receipt = value; } };
}

const tests: Array<[string, (clock: Clock) => Promise<void>]> = [
  ['durable revisions deduplicate identical content and continue after coordinator restart', async clock => {
    const f = fixture(clock); const scoped = { ...binding, conversationType: 'groupChat' as const };
    await f.coordinator.publish(scoped, progress('first'));
    await f.coordinator.publish(scoped, progress('first'));
    assert.equal((await f.read()).records[0].latest.revision, 0); assert.equal(f.calls.length, 1);
    await f.coordinator.publish(scoped, progress('second')); await f.coordinator.publish(scoped, progress('latest'));
    assert.equal((await f.read()).records[0].latest.revision, 2); assert.equal(f.calls.length, 1);
    await f.coordinator.close();
    const restarted = f.make(new TeamsJobProgressJsonStore(f.file));
    await restarted.publish(scoped, progress('latest'));
    assert.equal((await f.read()).records[0].latest.revision, 2, 'restart duplicate must retain durable revision');
    assert.equal(f.calls.length, 1);
    await restarted.publish(scoped, progress('new after restart'));
    assert.equal((await f.read()).records[0].latest.revision, 3);
  }],
  ['one coalesced timer flushes the latest state with the retained activity ID', async clock => {
    const f = fixture(clock);
    await f.coordinator.publish(binding, progress('initial'));
    await f.coordinator.publish(binding, progress('superseded')); await f.coordinator.publish(binding, progress('latest only'));
    assert.equal(f.calls.length, 1); assert.equal(clock.timers.size, 1);
    clock.advance(999); assert.equal(f.calls.length, 1);
    clock.advance(1); await f.coordinator.close();
    assert.equal(f.calls.length, 2); assert.equal(f.calls[1].activity.text, 'latest only');
    assert.equal(f.calls[1].activityId, 'synthetic-activity-1'); assert.equal(f.calls[1].kind, 'stream-informative');
    assert.equal(f.calls.filter(call => call.kind === 'start-stream').length, 1);
  }],
  ['unknown initial and final outcomes never create timer retries across restart', async clock => {
    for (const final of [false, true]) {
      const f = fixture(clock);
      if (final) { await f.coordinator.publish(binding, progress('started')); clock.advance(1000); }
      f.respond(async () => ({ state: 'ambiguous' }));
      const result = await f.coordinator.publish(binding, progress('unknown delivery', final ? 'completed' : 'running'));
      assert.equal(result.state, 'ambiguous'); await f.coordinator.close();
      const before = f.calls.length;
      const restarted = f.make(new TeamsJobProgressJsonStore(f.file));
      await restarted.recover(); await restarted.publish(binding, progress('later business state', 'completed'));
      assert.equal(clock.timers.size, 0); clock.advance(120_000); await restarted.close();
      assert.equal(f.calls.length, before, 'unknown connector acceptance must not be replayed');
    }
  }],
  ['recover refreshes authoritative completion before any stale stream flush', async clock => {
    const f = fixture(clock); await f.coordinator.publish(binding, progress('stale running')); await f.coordinator.close();
    clock.advance(1000); let loaded = 0;
    const restarted = f.make(new TeamsJobProgressJsonStore(f.file), { latestSnapshot: async received => {
      loaded++; assert.deepEqual(received, binding); return progress('authoritative result', 'completed');
    } });
    await restarted.recover();
    assert.equal(loaded, 1, 'restart must consult authoritative current job state');
    assert.equal(f.calls.length, 2, 'completion must flush on recovery rather than keep stale running');
    assert.equal(f.calls[1].kind, 'stream-final'); assert.equal(f.calls[1].activityId, 'synthetic-activity-1');
    assert.match(JSON.stringify(f.calls[1].activity.attachments), /authoritative result/);
    assert.match(JSON.stringify(f.calls[1].activity.attachments), /완료/);
    assert.equal((await f.read()).records[0].latest.status, 'completed'); assert.equal((await f.read()).records[0].latest.revision, 1);
    assert.equal(clock.timers.size, 0);
  }],
  ['recover with unavailable authoritative job blocks durably without network flush', async clock => {
    const f = fixture(clock); await f.coordinator.publish(binding, progress('stale running')); await f.coordinator.close();
    clock.advance(119_000);
    const restarted = f.make(new TeamsJobProgressJsonStore(f.file), { latestSnapshot: async () => undefined });
    await restarted.recover();
    assert.equal(f.calls.length, 1, 'missing job or authority must prevent stale final delivery');
    assert.equal((await f.read()).records[0].state, 'blocked'); assert.equal(clock.timers.size, 0);
  }],
  ['authoritative recovery preserves unknown intent while retaining the latest job snapshot', async clock => {
    const f = fixture(clock); f.respond(async () => ({ state: 'ambiguous' }));
    const initial = await f.coordinator.publish(binding, progress('reserved running')); await f.coordinator.close(); clock.advance(1000);
    const restarted = f.make(new TeamsJobProgressJsonStore(f.file), { latestSnapshot: async () => progress('finished while offline', 'completed') });
    await restarted.recover();
    const record = (await f.read()).records[0];
    assert.equal(record.state, 'ambiguous'); assert.equal(record.pending!.request.operationId, initial.operationId);
    assert.equal(record.latest.status, 'completed', 'current job snapshot must advance without replaying unknown intent');
    assert.equal(f.calls.length, 1); assert.equal(clock.timers.size, 0);
  }],
  ['close clears pending timers and rejects later publish without any send', async clock => {
    const f = fixture(clock); await f.coordinator.publish(binding, progress('initial'));
    await f.coordinator.publish(binding, progress('pending latest')); assert.equal(clock.timers.size, 1);
    await f.coordinator.close(); assert.equal(clock.timers.size, 0);
    clock.advance(120_000); assert.equal(f.calls.length, 1);
    await assert.rejects(f.coordinator.publish(binding, progress('after close')), /TEAMS_PROGRESS_CLOSED/);
    assert.equal(f.calls.length, 1);
  }],
  ['a queued publish recovers after its preceding per-job operation rejects', async clock => {
    const f = fixture(clock); let release!: () => void; let entered!: () => void; let fail = true;
    const entry = new Promise<void>(resolve => { entered = resolve; });
    const state: TeamsJobProgressStatePort = { transact<T>(apply: (ledger: TeamsJobProgressLedger) => T): Promise<T> {
      if (fail) { fail = false; return new Promise<T>((_resolve, reject) => { release = () => reject(new Error('synthetic first transaction failure')); entered(); }); }
      return f.state.transact(apply);
    } };
    const coordinator = f.make(state);
    const first = coordinator.publish(binding, progress('first fails'));
    const second = coordinator.publish(binding, progress('next succeeds'));
    const observed = Promise.allSettled([first, second]); await entry; release();
    const [failed, recovered] = await observed;
    assert.equal(failed.status, 'rejected');
    assert.equal(recovered.status, 'fulfilled', 'a queued next publish must execute despite predecessor rejection');
    assert.equal(f.calls.length, 1); assert.equal((await f.read()).records[0].latest.text, 'next succeeds');
    await coordinator.publish(binding, progress('next succeeds')); assert.equal(f.calls.length, 1);
  }],
];

try {
  const failures: string[] = [];
  const selected = process.argv.includes('--recovery-only') ? tests.filter(([name]) => name.startsWith('recover ') || name.startsWith('authoritative ') || name.startsWith('a queued ')) : tests;
  for (const [name, test] of selected) {
    const clock = new Clock(); activeCoordinators = []; clock.install();
    try { await test(clock); console.log(`PASS ${name}`); }
    catch (error) { failures.push(name); console.error(`FAIL ${name}`, error); }
    finally { await Promise.allSettled(activeCoordinators.map(coordinator => coordinator.close())); clock.restore(); }
  }
  assert.equal(failures.length, 0, failures.join(', '));
  console.log(`teams-job-progress-coordinator: ${selected.length} synthetic cases passed`);
} finally { actualClearTimeout(watchdog); globalThis.setTimeout = actualSetTimeout; globalThis.clearTimeout = actualClearTimeout; Date.now = actualNow; await fs.rm(root, { recursive: true, force: true }); }
