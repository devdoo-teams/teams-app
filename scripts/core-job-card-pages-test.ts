import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CoreJobCardPages, wrapCoreJobCardSender, guardCoreCardPageUpdate } from '../src/server/core-job-card-pages.js';
import { createCoreOrchestrationJobActivity, type CoreOrchestrationTeamsActivity } from '../src/server/genui-response.js';
import type { CoreOrchestrationJob } from '../src/shared/core-orchestration.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'core-card-pages-'));
const file = path.join(root, 'pages.json');
const scope = { tenantId: 'tenant-a', requesterId: 'owner-a', conversationId: 'personal-a' };
const parent: CoreOrchestrationJob = { id: 'task-parent', prompt: 'earlier synthetic request', mode: 'read-only',
  status: 'completed', result: 'earlier response', progress: [], threadId: 'thread-a', createdAt: new Date().toISOString() };
const job: CoreOrchestrationJob = { id: 'task-a', prompt: 'token=synthetic-secret request', mode: 'read-only',
  status: 'completed', result: 'safe result', progress: ['one', 'two', 'three', 'four', 'five', 'six'],
  parentJobId: parent.id, threadId: 'thread-a', createdAt: new Date().toISOString() };
const snapshots = JSON.stringify([job, parent]);
let reads = 0;
const updates: { id: string; activity: CoreOrchestrationTeamsActivity }[] = [];
const options = {
  getJob: (id: string, authenticated: typeof scope) => {
    reads++;
    return Object.keys(scope).every(key => authenticated[key as keyof typeof scope] === scope[key as keyof typeof scope])
      ? [job, parent].find(candidate => candidate.id === id) : undefined;
  },
  update: async (id: string, activity: CoreOrchestrationTeamsActivity) => { updates.push({ id, activity }); },
};
const titles = ['요약', '진행', '대화', '결과'].map(label => `Core 에이전트 작업 · ${label}`);
function collection(activity: CoreOrchestrationTeamsActivity) {
  assert.equal(activity.attachmentLayout, 'carousel', 'use the actual Teams activity carousel contract');
  assert.equal(activity.attachments.length, 4, 'four separate cards in one activity');
  assert.deepEqual(activity.attachments.map(attachment => attachment.content.body[0].text), titles);
  assert.equal('text' in activity, false, 'top-level text must not duplicate the cards');
  assert.ok(Buffer.byteLength(JSON.stringify(activity), 'utf8') < 80_000);
  for (const attachment of activity.attachments) {
    assert.equal(attachment.content.version, '1.6');
    assert.ok(!JSON.stringify(attachment).includes('synthetic-secret'), 'every card masks sensitive content');
    assert.ok(!JSON.stringify(attachment).includes('CarouselPage'), 'no unsupported inner-card carousel schema');
    assert.ok(!(attachment.content.actions ?? []).some(action => action.type === 'Action.Execute'));
  }
}
try {
  const pages = new CoreJobCardPages(file, options); await pages.initialize();
  const original = await pages.create(job.id, scope, true, 'https://example.test/tabs/home/'); assert.ok(original); collection(original.activity);
  const facts = original.activity.attachments[0].content.body.find(element => element.type === 'FactSet')?.facts as { title: string; value: string }[];
  assert.equal(facts.find(fact => fact.title === '작업 ID')?.value, job.id);
  assert.ok(facts.some(fact => fact.title === '제출 실행경계'), 'summary retains execution evidence');
  assert.ok(JSON.stringify(original.activity.attachments[1]).includes('six'));
  assert.ok(!JSON.stringify(original.activity.attachments[1]).includes('"one"'), 'progress is bounded to the last five entries');
  assert.ok(JSON.stringify(original.activity.attachments[3]).includes('safe result'));
  await pages.bind(original.key, scope, 'activity-original');
  const action = { schemaVersion: '1', action: 'orchestration.page', key: original.key, jobId: job.id, page: 'refresh' };
  assert.equal((await pages.act(action, scope, true, 'activity-original', 'invoke')).statusCode, 400, 'single-card invoke cannot collapse the collection');
  assert.equal(updates.length, 0);
  assert.equal((await pages.act(action, scope, true, 'activity-original', 'submit')).statusCode, 200);
  assert.equal(updates.length, 1); collection(updates[0].activity); assert.equal(updates[0].id, 'activity-original');
  assert.equal((await pages.act({ ...action, page: 'conversation', cursor: 0 }, scope, true, 'activity-original', 'submit')).statusCode, 200);
  collection(updates.at(-1)!.activity); assert.ok(JSON.stringify(updates.at(-1)!.activity.attachments[2]).includes('earlier response'));
  const restarted = new CoreJobCardPages(file, options); await restarted.initialize();
  assert.ok(JSON.stringify(restarted.existing(job.id, scope, 'activity-original')?.attachments[2]).includes('earlier response'), 'cursor/binding survive restart');
  const beforeRejected = updates.length;
  for (const [payload, foreign, personal, id] of [
    [{ ...action, jobId: 'task-other' }, scope, true, 'activity-original'], [{ ...action, key: 'unknown' }, scope, true, 'activity-original'],
    [action, { ...scope, requesterId: 'other' }, true, 'activity-original'], [action, { ...scope, tenantId: 'other' }, true, 'activity-original'],
    [action, { ...scope, conversationId: 'other' }, true, 'activity-original'], [action, scope, false, 'activity-original'],
    [action, scope, true, 'wrong-activity'], [{ ...action, page: 'conversation', cursor: -1 }, scope, true, 'activity-original'],
    [{ ...action, page: 'conversation', cursor: 19 }, scope, true, 'activity-original'], [{ ...action, cursor: 0 }, scope, true, 'activity-original'],
  ] as const) assert.notEqual((await restarted.act(payload, foreign, personal, id, 'submit')).statusCode, 200);
  assert.equal(updates.length, beforeRejected, 'rejected scope/activity/cursor never update');
  assert.equal(JSON.stringify([job, parent]), snapshots, 'page reads never mutate execution'); assert.ok(reads > 0);
  assert.equal(await restarted.create(job.id, scope, false), undefined);
  const unbound = await restarted.create(job.id, scope, true); assert.ok(unbound);
  assert.equal((await restarted.act({ ...action, key: unbound.key }, scope, true, 'guessed-id', 'submit')).statusCode, 400);
  assert.equal((await restarted.act({ ...action, page: 'conversation', cursor: 1 }, scope, true, 'activity-original', 'submit', async () => { throw new Error('synthetic update failed'); })).statusCode, 500);
  assert.ok(JSON.stringify(restarted.existing(job.id, scope, 'activity-original')?.attachments[2]).includes('earlier response'), 'failed update cannot publish cursor');
  let sdkUpdates = 0;
  assert.equal((await restarted.act(action, scope, true, 'activity-original', 'submit', async () => guardCoreCardPageUpdate(true, async () => { sdkUpdates++; }))).statusCode, 500);
  assert.equal(sdkUpdates, 0);
  const storeText = await fs.readFile(file, 'utf8'); assert.ok(!storeText.includes('synthetic-secret') && !storeText.includes('safe result'));
  const legacyFile = path.join(root, 'legacy.json'); const legacy = JSON.parse(storeText);
  for (const record of legacy.records) delete record.layout;
  await fs.writeFile(legacyFile, JSON.stringify(legacy));
  const legacyPages = new CoreJobCardPages(legacyFile, { ...options, universalActions: true }); await legacyPages.initialize();
  const legacyResponse = await legacyPages.act({ ...action, page: 'result' }, scope, true, 'activity-original', 'invoke');
  assert.equal(legacyResponse.statusCode, 200); assert.ok(JSON.stringify(legacyResponse.value).includes('safe result'));
  assert.equal(updates.length, beforeRejected, 'legacy invoke sends no update'); assert.equal(legacyPages.existing(job.id, scope, 'activity-original')?.attachmentLayout, 'list');
  const sent: CoreOrchestrationTeamsActivity[] = [];
  const wrapped = wrapCoreJobCardSender(restarted, scope, true, async (_text, envelope, activity) => {
    assert.equal(envelope, undefined); sent.push(activity as CoreOrchestrationTeamsActivity); return { state: 'connector-accepted', activityId: 'connector-id' };
  });
  await wrapped('', undefined, createCoreOrchestrationJobActivity(job)); assert.equal(sent.length, 1); collection(sent[0]);
  const navigation = sent[0].attachments[0].content.actions!.find(item => (item.data as any)?.action === 'orchestration.page')!;
  assert.equal(navigation.type, 'Action.Submit'); assert.equal(navigation.associatedInputs, 'none');
  assert.equal((await restarted.act(navigation.data, scope, true, 'connector-id', 'submit')).statusCode, 200);
  const captured: CoreOrchestrationTeamsActivity[] = [];
  const reused = wrapCoreJobCardSender(restarted, scope, true, async (_text, _envelope, activity) => {
    captured.push(activity as CoreOrchestrationTeamsActivity); return { state: 'connector-accepted' };
  }, undefined, 'connector-id');
  await reused('', undefined, createCoreOrchestrationJobActivity(job)); collection(captured[0]);
  assert.equal((captured[0].attachments[0].content.actions![0].data as any).key, (navigation.data as any).key); assert.equal(sent.length, 1);
  const bind = restarted.bind.bind(restarted); restarted.bind = async () => { throw new Error('synthetic disk failure'); };
  const accepted = await wrapped('', undefined, createCoreOrchestrationJobActivity(job));
  assert.equal(accepted.state, 'connector-accepted'); assert.equal(accepted.activityId, 'connector-id'); assert.equal(sent.length, 2); restarted.bind = bind;
  const inputs = new CoreJobCardPages(path.join(root, 'inputs.json'), { ...options, universalActions: true,
    getJob: () => ({ ...job, parentJobId: undefined, status: 'input_required', progress: [] }) });
  await inputs.initialize(); const input = await inputs.create(job.id, scope, true); assert.ok(input); collection(input.activity);
  assert.ok(JSON.stringify(input.activity.attachments[0]).includes('Input.Text')); assert.ok(JSON.stringify(input.activity.attachments[1]).includes('진행 기록이 없습니다.'));
  assert.ok(input.activity.attachments.slice(1).every(attachment => !JSON.stringify(attachment).includes('Input.Text')));
  const pending = new CoreJobCardPages(path.join(root, 'pending.json'), { ...options, getJob: () => ({ ...job, parentJobId: undefined, status: 'awaiting_approval' }) });
  await pending.initialize(); const pendingCard = await pending.create(job.id, scope, true); assert.ok(pendingCard);
  const summary = JSON.stringify(pendingCard.activity.attachments[0]);
  assert.ok(summary.includes('orchestration.confirm-approve') && summary.includes('orchestration.confirm-cancel'));
  assert.ok(!summary.includes('confirmationToken'), 'page reads never mint approval grants');
  console.log('PASS: four-card carousel, same-activity update, legacy invoke, owner isolation, restart/cursor, masked views and confirmation gates');
} finally { await fs.rm(root, { recursive: true, force: true }); }
