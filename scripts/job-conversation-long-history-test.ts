import assert from 'node:assert/strict';
import * as history from '../src/client/job-conversation.js';
import { createCoreOrchestrationClient } from '../src/client/core-orchestration-client.js';
import type { CoreOrchestrationJob } from '../src/shared/core-orchestration.js';

assert.equal(typeof history.loadEarlierJobConversation, 'function', '100+ turns need deliberate paging beyond the first 20');
const rows = Array.from({ length: 125 }, (_, index) => ({
  id: `history-${index}`, prompt: `${index}번째 한글 요청`, result: `${index}번째 응답 password=fixture-secret`,
  status: 'completed', mode: 'workspace-write', progress: [], createdAt: '2026-10-11T00:00:00Z',
  threadId: 'owner-only-thread', ...(index ? { parentJobId: `history-${index - 1}` } : {}),
}) as CoreOrchestrationJob);
const stored = new Map(rows.map(job => [job.id, job]));
const requests: string[] = [];
const client = createCoreOrchestrationClient(async (path) => {
  assert.match(path, /^\/api\/core-orchestration\/jobs\/history-\d+$/);
  requests.push(path);
  const job = stored.get(path.split('/').at(-1)!);
  return new Response(JSON.stringify(job ? { job } : { error: { code: 'CORE_ORCHESTRATION_NOT_FOUND' } }), {
    status: job ? 200 : 404, headers: { 'content-type': 'application/json' },
  });
});
let { conversation } = await client.getJobConversation!(rows.at(-1)!.id);
assert.equal(conversation.turns.length, 20, 'initial retrieval remains bounded');
assert.equal(conversation.complete, false);
assert.equal(conversation.earlierBeforeJobId, rows[105].id, 'cursor identifies the visible boundary, not a raw thread');
assert.equal(requests.length, 20, 'there is no speculative 21st fetch');
let pages = 0;
while (!conversation.complete && pages < 10) {
  const before = conversation;
  const requestCount = requests.length;
  conversation = await history.loadEarlierJobConversation(conversation, client.getJob);
  assert.ok(conversation.turns.length - before.turns.length <= 20);
  assert.ok(requests.length - requestCount <= 22, 'one page plus selected/boundary revalidation is bounded');
  assert.equal(conversation.selectedJobId, rows.at(-1)!.id);
  assert.deepEqual(conversation.turns.slice(-before.turns.length), before.turns, 'paging preserves every loaded newer turn');
  pages++;
}
assert.equal(conversation.complete, true);
assert.equal(conversation.turns.length, 125, '100+ history must not silently truncate');
assert.deepEqual(conversation.turns.map(turn => turn.jobId), rows.map(job => job.id));
assert.equal(new Set(conversation.turns.map(turn => turn.jobId)).size, 125, 'repeated pages do not duplicate resumed turns');
assert.doesNotMatch(JSON.stringify(conversation), /owner-only-thread|fixture-secret/);
assert.equal(await history.loadEarlierJobConversation(conversation, client.getJob), conversation, 'complete history is a read-only no-op');

const first = (await client.getJobConversation!(rows.at(-1)!.id)).conversation;
const firstUpdated = { ...first, turns: first.turns.map(turn => turn.jobId === first.selectedJobId ? { ...turn, response: '최신 관찰 응답' } : turn) };
const merged = history.mergeVisibleJobConversation(conversation, firstUpdated);
assert.equal(merged.turns.length, 125, 'a first-page refresh does not discard explicitly loaded older pages');
assert.equal(merged.turns.at(-1)?.response, '최신 관찰 응답');
assert.equal(merged.complete, true);
assert.equal(history.mergeVisibleJobConversation(conversation, { ...first, selectedJobId: 'other-selected-job' }).selectedJobId, 'other-selected-job', 'owner/view identity changes do not carry retained turns into a different job');
let forgedReads = 0;
const forgedCursor = await history.loadEarlierJobConversation({ ...first, earlierBeforeJobId: 'not-the-visible-boundary' }, async (id) => { forgedReads++; return stored.get(id)!; });
assert.equal(forgedCursor.unavailableReason, 'invalid-chain');
assert.equal(forgedReads, 0, 'caller cursor cannot choose a different server parent');
stored.delete(rows[104].id);
const missing = await history.loadEarlierJobConversation(first, client.getJob);
assert.equal(missing.unavailableReason, 'previous-turn-unavailable');
assert.deepEqual(missing.turns, first.turns, 'missing older history leaves the current page intact');
stored.set(rows[104].id, rows[104]);
const recovered = await history.loadEarlierJobConversation(missing, client.getJob);
assert.equal(recovered.turns.length, 40, 'retry recovers the same conversation without duplicating turns');

const forbidden = Object.assign(new Error('expired or forbidden'), { status: 403 });
await assert.rejects(history.loadEarlierJobConversation(first, async (id) => {
  if (id === rows[104].id) throw forbidden;
  return stored.get(id)!;
}), error => error === forbidden, 'authorization errors are not reported as missing history');
const hiddenSelected = Object.assign(new Error('owner-hidden selected job'), { status: 404 });
await assert.rejects(history.loadEarlierJobConversation(first, async (id) => {
  if (id === first.selectedJobId) throw hiddenSelected;
  return stored.get(id)!;
}), error => error === hiddenSelected, 'owner-hidden selected job cannot retain a falsely authorized page');
assert.equal(typeof history.isConversationHistoryAccessFailure, 'function', 'history UI must clear cached turns when selected/boundary ownership cannot be revalidated');
for (const status of [401, 403, 404]) assert.equal(history.isConversationHistoryAccessFailure({ status }), true);
assert.equal(history.isConversationHistoryAccessFailure({ status: 500 }), false, 'temporary service failure preserves an already authorized reading position');
assert.equal(history.isConversationHistoryAccessFailure(new Error('transient network error')), false);
const aborted = new AbortController();
aborted.abort();
let abortedReads = 0;
await assert.rejects(history.loadEarlierJobConversation(first, async (id) => { abortedReads++; return stored.get(id)!; }, aborted.signal), /abort/i);
assert.equal(abortedReads, 0, 'cancelled paging makes no authenticated request');
stored.set(rows[104].id, { ...rows[104], threadId: 'other-private-thread' });
const foreignChain = await history.loadEarlierJobConversation(first, client.getJob);
assert.equal(foreignChain.unavailableReason, 'invalid-chain');
assert.deepEqual(foreignChain.turns, first.turns);
assert.doesNotMatch(JSON.stringify(foreignChain), /other-private-thread/);
stored.set(rows[104].id, { ...rows[104], parentJobId: rows[110].id });
const cyclic = await history.loadEarlierJobConversation(first, client.getJob);
assert.equal(cyclic.unavailableReason, 'invalid-chain');
assert.equal(new Set(cyclic.turns.map(turn => turn.jobId)).size, cyclic.turns.length);

const reading = await import('../src/client/conversation-reading-position.js');
const inspected = reading.snapshotConversationReadingPosition({ scrollTop: 250, scrollHeight: 3000, clientHeight: 600 }, { jobId: 'history-30', offset: -12 });
assert.equal(reading.restoreConversationReadingPosition(inspected, { scrollTop: 250, scrollHeight: 4000, clientHeight: 600 }, 988), 1250, 'prepending 1000px keeps the inspected turn at exactly the same viewport offset');
assert.equal(reading.restoreConversationReadingPosition(inspected, { scrollTop: 250, scrollHeight: 4000, clientHeight: 600 }), 250, 'append/resume does not jump a reader to the end');
const atEnd = reading.snapshotConversationReadingPosition({ scrollTop: 2400, scrollHeight: 3000, clientHeight: 600 });
assert.equal(reading.restoreConversationReadingPosition(atEnd, { scrollTop: 2400, scrollHeight: 3200, clientHeight: 600 }), 2600, 'only readers already at the end follow new content');
const hidden = reading.snapshotConversationReadingPosition({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
assert.equal(hidden, undefined, 'a collapsed details element cannot overwrite an actual reading position');
assert.equal(reading.restoreConversationReadingPosition(inspected, { scrollTop: -50, scrollHeight: 200, clientHeight: 600 }, -500), 0, 'negative overscroll and changed viewport geometry are clamped');
assert.equal(typeof history.createConversationHistoryViewCache, 'function', 'mode-switch cache must remember that an authenticated history read was denied');
const cache = history.createConversationHistoryViewCache();
cache.remember(first, { conversation, position: inspected });
assert.equal(cache.read(first)?.conversation?.turns.length, 125);
cache.block(first);
cache.remember(first, { conversation, position: inspected });
assert.equal(cache.read(first)?.accessBlocked, true, 'layout/scroll callbacks cannot restore history after authorization denial');
assert.equal(cache.read(first)?.conversation, undefined, 'a denied scope holds no retained transcript');
assert.equal(cache.read({ ...first }), undefined, 'fresh owner-authenticated response identity has an independent cache scope');
cache.authorize(first, { conversation: recovered });
assert.equal(cache.read(first)?.conversation?.turns.length, 40, 'explicit successful owner revalidation can recover the same scope');
assert.notEqual(cache.read(first)?.accessBlocked, true);
console.log('PASS: synthetic125 owner-scoped paged history, recovery, privacy/abort/cycle bounds, and reading-position geometry');
