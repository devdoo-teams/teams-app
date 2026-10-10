import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  TeamsJobProgressTransport, createTeamsJobProgressLedger, renderTeamsJobProgressMessage,
  type TeamsJobProgressLedger, type TeamsJobProgressStatePort, type TeamsJobProgressRequest,
  type TeamsJobProgressReceipt, type TeamsJobProgressBinding, type TeamsJobProgressSnapshot,
} from '../src/server/teams-job-progress.js';

// Synthetic durable state, never the application's runtime data. Removing durable
// reservation or acknowledgement should fail the restart and concurrency cases.
class FixtureState implements TeamsJobProgressStatePort {
  private tail = Promise.resolve();
  constructor(readonly file: string) {}
  async transact<T>(apply: (ledger: TeamsJobProgressLedger) => T): Promise<T> {
    let result!: T;
    const operation = this.tail.then(() => {
      const ledger = fs.existsSync(this.file)
        ? JSON.parse(fs.readFileSync(this.file, 'utf8')) as TeamsJobProgressLedger
        : createTeamsJobProgressLedger();
      result = apply(ledger);
      fs.writeFileSync(`${this.file}.next`, JSON.stringify(ledger), { mode: 0o600 });
      fs.renameSync(`${this.file}.next`, this.file);
    });
    this.tail = operation.catch(() => {});
    await operation;
    return structuredClone(result);
  }
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-progress-synthetic-'));
const watchdog = setTimeout(() => { console.error('teams-job-progress: bounded test timeout (20s)'); process.exit(1); }, 20_000);
watchdog.unref();
let fixtureNumber = 0;
function fixture() {
  const state = new FixtureState(path.join(temp, `state-${fixtureNumber++}.json`));
  let now = 0;
  const calls: TeamsJobProgressRequest[] = [];
  let receipt: ((request: TeamsJobProgressRequest) => Promise<TeamsJobProgressReceipt>) | undefined;
  const adapter = { send: async (request: TeamsJobProgressRequest): Promise<TeamsJobProgressReceipt> => {
    calls.push(structuredClone(request));
    return receipt ? receipt(request) : { state: 'accepted', activityId: request.activityId ?? `activity-${calls.length}` };
  } };
  const make = (port = state) => new TeamsJobProgressTransport({ state: port, adapter, now: () => now });
  return { state, calls, make, transport: make(), advance: (ms: number) => { now += ms; },
    setReceipt: (next: typeof receipt) => { receipt = next; } };
}
const binding: TeamsJobProgressBinding = { jobId: 'job-1', tenantId: 'tenant-1', requesterId: 'requester-1',
  conversationId: 'conversation-1', conversationType: 'personal', originActivityId: 'request-1',
  originThreadId: 'thread-1', serviceUrl: 'https://smba.trafficmanager.net/amer/' };
function snapshot(revision: number, status: TeamsJobProgressSnapshot['status'] = 'running', text = `progress ${revision}`) {
  return { revision, status, text } satisfies TeamsJobProgressSnapshot;
}
const tests: Array<[string, () => Promise<void>]> = [
  ['personal stream starts meaningfully and coalesces to one request per second', async () => {
    const f = fixture();
    await f.transport.publish(binding, snapshot(1));
    assert.equal(f.calls.length, 1, 'initial personal progress must create exactly one native stream');
    assert.equal(f.calls[0].activity.type, 'typing');
    assert.deepEqual(f.calls[0].activity.entities, [{ type: 'streaminfo', streamType: 'informative', streamSequence: 1 }]);
    assert.ok(f.calls[0].activity.text?.trim());
    for (let i = 2; i <= 6; i++) await f.transport.publish(binding, snapshot(i));
    assert.equal(f.calls.length, 1);
    f.advance(999); await f.transport.flush(binding); assert.equal(f.calls.length, 1);
    f.advance(1); await f.transport.flush(binding);
    assert.equal(f.calls.length, 2);
    assert.equal(f.calls[1].activity.text, 'progress 6');
    assert.equal(f.calls[1].activity.entities?.[0].streamSequence, 2);
    assert.equal(f.calls[1].activity.entities?.[0].streamId, 'activity-1');
    assert.equal(f.calls[1].activity.attachments, undefined);
  }],
  ['terminal flush respects rate, carries canonical final status and ignores late progress', async () => {
    const f = fixture();
    await f.transport.publish(binding, snapshot(1));
    const queued = await f.transport.publish(binding, snapshot(2, 'completed', 'result ready'));
    assert.equal(queued.state, 'pending'); assert.equal(queued.nextDueAt, 1000);
    f.advance(1000); await f.transport.flush(binding);
    const final = f.calls[1];
    assert.equal(final.activity.type, 'message');
    assert.deepEqual(final.activity.entities, [{ type: 'streaminfo', streamId: 'activity-1', streamType: 'final' }]);
    assert.equal(final.method, 'create'); assert.equal(final.activityId, 'activity-1');
    assert.match(JSON.stringify(final.activity.attachments), /완료/);
    assert.doesNotMatch(JSON.stringify(final.activity.attachments), /Action.Submit/);
    await f.transport.publish(binding, snapshot(3));
    await f.transport.publish(binding, snapshot(2, 'completed', 'result ready'));
    assert.equal(f.calls.length, 2);
  }],
  ['group and channel keep one bot activity in the exact origin thread', async () => {
    for (const conversationType of ['groupChat', 'channel'] as const) {
      const f = fixture(); const scoped = { ...binding, conversationType };
      const message = renderTeamsJobProgressMessage(snapshot(1), { stopActionData: { action: 'orchestration.cancel', jobId: binding.jobId, actionToken: 'synthetic-grant' } });
      await f.transport.publish(scoped, { ...snapshot(1), message });
      assert.equal(f.calls[0].activity.replyToId, 'thread-1');
      assert.equal(f.calls[0].activity.entities, undefined);
      assert.deepEqual(f.calls[0].activity.attachments, message.attachments);
      const card = f.calls[0].activity.attachments?.[0].content as any;
      assert.equal(card.version, '1.6'); assert.equal(card.actions[0].title, '중지');
      assert.equal(card.actions[0].data.actionToken, 'synthetic-grant');
      assert.equal(card.actions[0].style, undefined);
      f.advance(1000); await f.transport.publish(scoped, snapshot(2, 'failed', 'failed safely'));
      assert.equal(f.calls.length, 2); assert.equal(f.calls[1].method, 'update');
      assert.equal(f.calls[1].activityId, 'activity-1');
      assert.equal(f.calls[1].activity.replyToId, 'thread-1');
      assert.match(JSON.stringify(f.calls[1].activity.attachments), /실패/);
    }
  }],
  ['one personal stream owner is atomic across transports sharing durable state', async () => {
    const f = fixture();
    await Promise.all([f.transport.publish(binding, snapshot(1)), f.make().publish(binding, snapshot(1)),
      f.make().publish({ ...binding, jobId: 'job-2', originActivityId: 'request-2' }, snapshot(1))]);
    assert.equal(f.calls.filter(call => call.activity.type === 'typing').length, 1);
    assert.equal(f.calls.filter(call => call.kind === 'start-stream').length, 1);
    assert.equal(f.calls.filter(call => call.kind === 'create-activity').length, 1);
  }],
  ['ambiguous initial acceptance survives restart and requires exact receipt reconciliation', async () => {
    const f = fixture(); f.setReceipt(async () => { throw new Error('synthetic connection lost after acceptance'); });
    const first = await f.transport.publish(binding, snapshot(1));
    assert.equal(first.state, 'ambiguous');
    const restarted = f.make(new FixtureState(f.state.file));
    await restarted.recover(); await restarted.publish(binding, snapshot(2));
    assert.equal(f.calls.length, 1, 'ambiguous initial create must never be resent');
    await assert.rejects(restarted.reconcile(binding, 'wrong-operation', { state: 'accepted', activityId: 'accepted-stream' }));
    await restarted.reconcile(binding, first.operationId!, { state: 'accepted', activityId: 'accepted-stream' });
    f.setReceipt(undefined); f.advance(1000); await restarted.flush(binding);
    assert.equal(f.calls.length, 2); assert.equal(f.calls[1].activityId, 'accepted-stream');
    assert.equal(f.calls[1].activity.entities?.[0].streamSequence, 2);
    assert.equal(f.calls[1].activity.text, 'progress 2');
  }],
  ['crash between reservation and read-back is ambiguous, never a retry or new card', async () => {
    const f = fixture(); let release!: (receipt: TeamsJobProgressReceipt) => void;
    f.setReceipt(() => new Promise(resolve => { release = resolve; }));
    const inFlight = f.transport.publish(binding, snapshot(1));
    while (!release) await new Promise(resolve => setImmediate(resolve));
    await f.make().recover();
    await f.make().flush(binding); assert.equal(f.calls.length, 1);
    release({ state: 'accepted', activityId: 'read-back-stream' });
    await inFlight;
    f.advance(1000); f.setReceipt(undefined); await f.transport.publish(binding, snapshot(2));
    assert.equal(f.calls[1].activityId, 'read-back-stream');
  }],
  ['ambiguous final never duplicates completion after restart', async () => {
    const f = fixture(); await f.transport.publish(binding, snapshot(1)); f.advance(1000);
    f.setReceipt(async () => ({ state: 'ambiguous' }));
    const final = await f.transport.publish(binding, snapshot(2, 'completed'));
    const restarted = f.make(new FixtureState(f.state.file)); await restarted.recover();
    f.advance(1000); await restarted.publish(binding, snapshot(3, 'completed')); await restarted.flush(binding);
    assert.equal(f.calls.length, 2);
    await restarted.reconcile(binding, final.operationId!, { state: 'accepted', activityId: 'activity-1' });
    assert.equal((await restarted.flush(binding)).state, 'terminal');
    assert.equal(f.calls.length, 2);
  }],
  ['each tenant requester chat origin and service URL field is exact authority', async () => {
    const f = fixture(); await f.transport.publish(binding, snapshot(1));
    for (const field of ['tenantId', 'requesterId', 'conversationId', 'originActivityId', 'originThreadId', 'serviceUrl'] as const) {
      await assert.rejects(f.transport.publish({ ...binding, [field]: `other-${field}` }, snapshot(2)), /AUTHORITY/);
    }
    await assert.rejects(f.transport.flush({ ...binding, conversationType: 'channel' }), /AUTHORITY/);
    assert.equal(f.calls.length, 1);
  }],
  ['restart closes known stream before two minutes and uses same activity for later progress', async () => {
    const f = fixture(); await f.transport.publish(binding, snapshot(1)); f.advance(119_000);
    const restarted = f.make(new FixtureState(f.state.file)); await restarted.recover();
    assert.equal(f.calls.length, 2); assert.equal(f.calls[1].kind, 'stream-final');
    assert.equal(f.calls[1].activityId, 'activity-1');
    f.advance(1000); await restarted.publish(binding, snapshot(2));
    assert.equal(f.calls[2].kind, 'update-activity'); assert.equal(f.calls[2].activityId, 'activity-1');
    assert.equal(f.calls.filter(call => call.kind === 'start-stream').length, 1);
  }],
  ['expired stream recovery performs plain update to same ID', async () => {
    const f = fixture(); await f.transport.publish(binding, snapshot(1)); f.advance(120_000);
    await f.make(new FixtureState(f.state.file)).recover();
    assert.equal(f.calls[1].method, 'update'); assert.equal(f.calls[1].activityId, 'activity-1');
    assert.equal(f.calls[1].activity.entities, undefined);
  }],
  ['response streaming is cumulative and cannot be replaced by informative status', async () => {
    const f = fixture(); await f.transport.publish(binding, snapshot(1)); f.advance(1000);
    await f.transport.publish(binding, { ...snapshot(2), responseText: 'A brown' }); f.advance(1000);
    await assert.rejects(f.transport.publish(binding, { ...snapshot(3), responseText: 'Hello' }), /CUMULATIVE/);
    await f.transport.publish(binding, { ...snapshot(3), responseText: 'A brown fox' });
    assert.equal(f.calls[2].activity.text, 'A brown fox');
    assert.equal(f.calls[2].activity.entities?.[0].streamType, 'streaming');
    f.advance(1000); await f.transport.publish(binding, snapshot(4, 'completed'));
    assert.ok(f.calls[3].activity.text?.startsWith('A brown fox'));
  }],
  ['host Stop receipt is terminal for transport and never modifies discarded content', async () => {
    const f = fixture(); await f.transport.publish(binding, snapshot(1)); f.advance(1000);
    f.setReceipt(async () => ({ state: 'rejected', reason: 'stopped' }));
    assert.equal((await f.transport.publish(binding, snapshot(2))).state, 'stopped');
    f.advance(1000); await f.transport.publish(binding, snapshot(3, 'cancelled')); await f.make().recover();
    assert.equal(f.calls.length, 2);
  }],
  ['missing create ID is ambiguous and invalid input sends nothing', async () => {
    const f = fixture();
    await assert.rejects(f.transport.publish(binding, snapshot(1, 'running', '  ')), /TEXT/);
    await assert.rejects(f.transport.publish(binding, snapshot(-1)), /REVISION/);
    assert.equal(f.calls.length, 0);
    f.setReceipt(async () => ({ state: 'accepted' }));
    assert.equal((await f.transport.publish(binding, snapshot(1))).state, 'ambiguous');
    await f.transport.flush(binding); assert.equal(f.calls.length, 1);
  }],
  ['informative text stays meaningful within both character and UTF-8 byte limits', async () => {
    const f = fixture();
    await f.transport.publish(binding, snapshot(1, 'running', `${' '.repeat(1001)}${'진행'.repeat(600)}`));
    const text = f.calls[0].activity.text!;
    assert.ok(text.trim(), 'truncation must not leave a blank initial streaming update');
    assert.ok(text.length <= 1000);
    assert.ok(Buffer.byteLength(text, 'utf8') <= 1000);
  }],
  ['approval state promptly exposes the caller card without marking the job terminal', async () => {
    const f = fixture(); await f.transport.publish(binding, snapshot(1)); f.advance(1000);
    const message = renderTeamsJobProgressMessage(snapshot(2, 'awaiting_approval'), {
      stopActionData: { action: 'orchestration.cancel', actionToken: 'synthetic-grant' },
    });
    await f.transport.publish(binding, { ...snapshot(2, 'awaiting_approval'), message });
    assert.equal(f.calls[1].kind, 'stream-final', 'approval must expose actionable card promptly');
    assert.deepEqual(f.calls[1].activity.attachments, message.attachments);
    assert.equal((await f.transport.flush(binding)).state, 'active');
    f.advance(1000); await f.transport.publish(binding, snapshot(3));
    assert.equal(f.calls[2].kind, 'update-activity'); assert.equal(f.calls[2].activityId, 'activity-1');
    const initial = fixture(); await initial.transport.publish(binding, snapshot(1, 'awaiting_approval'));
    assert.equal(initial.calls[0].kind, 'create-activity');
  }],
  ['input-required state closes native streaming and preserves the caller input card until resumed', async () => {
    const f = fixture(); await f.transport.publish(binding, snapshot(1)); f.advance(1000);
    const input = snapshot(2, 'input_required', '추가 범위를 입력해 주세요.');
    const message = renderTeamsJobProgressMessage(input, {
      stopActionData: { action: 'orchestration.cancel', actionToken: 'synthetic-stop-grant' },
    });
    const card = message.attachments![0].content as any;
    card.body.push({ type: 'Input.Text', id: 'clarification', label: '추가 범위' });
    card.actions.push({ type: 'Action.Submit', title: '입력 보내기',
      data: { action: 'orchestration.clarify', jobId: binding.jobId, actionToken: 'synthetic-clarify-grant' } });
    const paused = await f.transport.publish(binding, { ...input, message });
    assert.equal(paused.state, 'active', 'waiting for input must remain resumable');
    assert.equal(paused.nextDueAt, undefined, 'input wait must not keep a native stream deadline');
    assert.equal(f.calls[1].kind, 'stream-final'); assert.equal(f.calls[1].activityId, 'activity-1');
    assert.deepEqual(f.calls[1].activity.attachments, message.attachments);
    assert.match(JSON.stringify(f.calls[1].activity.attachments), /추가 입력 필요/);
    f.advance(120_000); const restarted = f.make(new FixtureState(f.state.file));
    await restarted.recover(); await restarted.flush(binding); assert.equal(f.calls.length, 2);
    await restarted.publish(binding, snapshot(3));
    assert.equal(f.calls[2].kind, 'update-activity'); assert.equal(f.calls[2].activityId, 'activity-1');
    assert.equal(f.calls.filter(call => call.kind === 'start-stream').length, 1);
    const initial = fixture(); await initial.transport.publish(binding, { ...snapshot(1, 'input_required'), message });
    assert.equal(initial.calls[0].kind, 'create-activity'); assert.equal(initial.calls[0].activity.entities, undefined);
    assert.deepEqual(initial.calls[0].activity.attachments, message.attachments);
  }],
];
try {
  const failures: string[] = [];
  for (const [name, test] of tests) {
    try { await test(); console.log(`PASS ${name}`); }
    catch (error) { failures.push(name); console.error(`FAIL ${name}`, error); }
  }
  assert.equal(failures.length, 0, `${failures.length} transport cases failed: ${failures.join(', ')}`);
  console.log(`teams-job-progress: ${tests.length} synthetic durable transport cases passed`);
} finally { clearTimeout(watchdog); fs.rmSync(temp, { recursive: true, force: true }); }
