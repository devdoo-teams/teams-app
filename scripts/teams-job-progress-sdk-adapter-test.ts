import assert from 'node:assert/strict';
import { createTeamsJobProgressSdkAdapter } from '../src/server/teams-job-progress-sdk-adapter.js';
import type { TeamsJobProgressRequest } from '../src/server/teams-job-progress.js';

const watchdog = setTimeout(() => { console.error('progress-sdk test timeout (20s)'); process.exit(1); }, 20_000); watchdog.unref();
const binding = { jobId: 'synthetic-job', tenantId: 'tenant', requesterId: 'requester', conversationId: 'conversation',
  conversationType: 'personal' as const, originActivityId: 'origin', originThreadId: 'thread', serviceUrl: 'https://smba.trafficmanager.net/amer/' };
function request(kind: TeamsJobProgressRequest['kind'] = 'start-stream'): TeamsJobProgressRequest {
  const stream = kind.startsWith('stream-') || kind === 'start-stream';
  const id = kind === 'start-stream' || kind === 'create-activity' ? undefined : 'retained-id';
  return { operationId: 'synthetic-operation', binding, kind, method: kind === 'update-activity' ? 'update' : 'create', activityId: id,
    activity: { type: kind === 'start-stream' || kind === 'stream-informative' || kind === 'stream-response' ? 'typing' : 'message',
      id, text: 'synthetic safe text', channelId: 'msteams', replyToId: 'thread',
      conversation: { id: 'conversation', conversationType: 'personal', tenantId: 'tenant' },
      ...(stream ? { entities: [{ type: 'streaminfo', streamType: kind === 'stream-final' ? 'final' : kind === 'stream-response' ? 'streaming' : 'informative',
        ...(id ? { streamId: id } : {}), ...(kind === 'stream-final' ? {} : { streamSequence: id ? 2 : 1 }) }] } : {}) } };
}
function fixture() {
  const calls: Array<{ method: string; conversationId: string; activityId?: string; payload: unknown }> = [];
  let failure: unknown; let response: unknown = { id: 'created-id' }; let serviceUrl = binding.serviceUrl;
  const client = { get serviceUrl() { return serviceUrl; }, conversations: {
    createActivity: async (conversationId: string, payload: unknown) => { calls.push({ method: 'create', conversationId, payload }); if (failure) throw failure; return response; },
    updateActivity: async (conversationId: string, activityId: string, payload: unknown) => { calls.push({ method: 'update', conversationId, activityId, payload }); if (failure) throw failure; return response; },
  } };
  const adapter = createTeamsJobProgressSdkAdapter({ botId: 'configured-bot', clientFor: () => client });
  return { calls, adapter, fail: (value: unknown) => { failure = value; }, respond: (value: unknown) => { response = value; },
    url: (value: string) => { serviceUrl = value; } };
}
const tests: Array<[string, () => Promise<void>]> = [
  ['SDK initial stream create uses exact conversation and configured bot identity', async () => {
    const f = fixture(); const input = request();
    (input.activity as unknown as Record<string, unknown>).from = { id: 'untrusted-bot' };
    const receipt = await f.adapter.send(input);
    assert.equal(f.calls.length, 1, 'adapter must invoke installed SDK createActivity exactly once');
    assert.equal(f.calls[0].method, 'create'); assert.equal(f.calls[0].conversationId, 'conversation');
    const payload = f.calls[0].payload as any;
    assert.deepEqual(payload.from, { id: 'configured-bot', role: 'bot' });
    assert.equal(payload.replyToId, 'thread'); assert.equal(payload.conversation.tenantId, 'tenant');
    assert.deepEqual(receipt, { state: 'accepted', activityId: 'created-id' });
    assert.equal((input.activity as any).from.id, 'untrusted-bot', 'caller input must remain unchanged');
  }],
  ['stream continuations and final use create; ordinary retained activity uses update', async () => {
    for (const kind of ['stream-informative', 'stream-response', 'stream-final', 'update-activity'] as const) {
      const f = fixture(); f.respond(null); assert.deepEqual(await f.adapter.send(request(kind)), { state: 'accepted', activityId: 'retained-id' });
      assert.equal(f.calls[0].method, kind === 'update-activity' ? 'update' : 'create');
      if (kind === 'update-activity') assert.equal(f.calls[0].activityId, 'retained-id');
    }
  }],
  ['initial missing ID and contradictory update ID remain ambiguous', async () => {
    const first = fixture(); first.respond({}); assert.deepEqual(await first.adapter.send(request()), { state: 'ambiguous' });
    const update = fixture(); update.respond({ id: 'different-id' }); assert.deepEqual(await update.adapter.send(request('update-activity')), { state: 'ambiguous' });
  }],
  ['only exact documented 403 body code and message prove Stop or timeout', async () => {
    for (const [message, reason] of [['Content stream was canceled by user.', 'stopped'],
      ['Content stream finished due to exceeded streaming time.', 'timeout'], ['Content stream is not allowed', 'unsupported']] as const) {
      const f = fixture(); f.fail({ response: { status: 403, data: { error: { code: 'ContentStreamNotAllowed', message } } } });
      assert.deepEqual(await f.adapter.send(request('stream-informative')), { state: 'rejected', reason }); assert.equal(f.calls.length, 1);
    }
    const unproved = fixture(); unproved.fail({ response: { status: 403, data: { error: { message: 'Content stream was canceled by user.' } } } });
    const receipt = await unproved.adapter.send(request('stream-informative'));
    assert.ok(receipt.state === 'ambiguous' || receipt.state === 'rejected' && receipt.reason === 'rejected');
  }],
  ['network, server and plain exception wording never trigger retries or Stop classification', async () => {
    for (const failure of [new Error('Content stream was canceled by user.'), { response: { status: 503, data: { error: { code: 'ContentStreamNotAllowed', message: 'Content stream was canceled by user.' } } } }]) {
      const f = fixture(); f.fail(failure); assert.deepEqual(await f.adapter.send(request()), { state: 'ambiguous' }); assert.equal(f.calls.length, 1);
    }
  }],
  ['successful error envelopes never become acceptance', async () => {
    const f = fixture(); f.respond({ error: { code: 'ContentStreamSequenceOrderPreConditionFailed', message: 'PreCondition failed exception when processing streaming activity.' } });
    const receipt = await f.adapter.send(request('stream-informative')); assert.notEqual(receipt.state, 'accepted'); assert.equal(f.calls.length, 1);
  }],
  ['cross URL chat tenant origin ID and nonpersonal native stream are rejected before SDK call', async () => {
    for (const mutate of [
      (r: TeamsJobProgressRequest) => { r.activity.conversation.id = 'other'; },
      (r: TeamsJobProgressRequest) => { r.activity.conversation.tenantId = 'other'; },
      (r: TeamsJobProgressRequest) => { r.activity.replyToId = 'other'; },
      (r: TeamsJobProgressRequest) => { r.binding = { ...r.binding, conversationType: 'channel' }; r.activity.conversation.conversationType = 'channel'; },
      (r: TeamsJobProgressRequest) => { r.activityId = 'forged-start-id'; },
    ]) {
      const f = fixture(); const input = structuredClone(request()); mutate(input);
      assert.deepEqual(await f.adapter.send(input), { state: 'rejected', reason: 'rejected' }); assert.equal(f.calls.length, 0);
    }
    const f = fixture(); f.url('https://other.example.invalid/'); assert.deepEqual(await f.adapter.send(request()), { state: 'rejected', reason: 'rejected' }); assert.equal(f.calls.length, 0);
  }],
];
try {
  const failures: string[] = [];
  const selected = process.argv.includes('--first-case') ? tests.slice(0, 1) : tests;
  for (const [name, test] of selected) { try { await test(); console.log(`PASS ${name}`); } catch (error) { failures.push(name); console.error(`FAIL ${name}`, error); } }
  assert.equal(failures.length, 0, failures.join(', ')); console.log(`teams-job-progress-sdk-adapter: ${selected.length} synthetic cases passed`);
} finally { clearTimeout(watchdog); }
