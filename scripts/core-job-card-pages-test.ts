import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CoreJobCardPages, wrapCoreJobCardSender, guardCoreCardPageUpdate } from '../src/server/core-job-card-pages.js';
import type { CoreOrchestrationJob } from '../src/shared/core-orchestration.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'core-card-pages-'));
const file = path.join(root, 'pages.json');
const scope = { tenantId: 'tenant-a', requesterId: 'owner-a', conversationId: 'personal-a' };
const job: CoreOrchestrationJob = { id: 'task-a', prompt: 'token=synthetic-secret request', mode: 'read-only',
  status: 'completed', result: 'safe result', progress: ['one', 'two', 'three', 'four', 'five', 'six'], createdAt: new Date().toISOString() };
let reads = 0; const initialJobSnapshot = JSON.stringify(job); const updates: { id: string; card: unknown }[] = [];
const options = { getJob: (id: string, authenticated: typeof scope) => {
  reads++; return authenticated.tenantId === scope.tenantId && authenticated.requesterId === scope.requesterId && id === job.id ? job : undefined;
}, update: async (id: string, card: unknown) => { updates.push({ id, card }); } };
try {
  const pages = new CoreJobCardPages(file, options);
  await pages.initialize();
  const original = await pages.create(job.id, scope, true, 'https://example.test/tabs/home/');
  assert.ok(original);
  await pages.bind(original.key, scope, 'activity-original');
  const action = { schemaVersion: '1', action: 'orchestration.page', key: original.key, jobId: job.id, page: 'progress' };
  const next = await pages.act(action, scope, true, 'activity-original', 'invoke');
  assert.equal(next.statusCode, 200); assert.equal(updates.length, 0, 'invoke must return card, never send');
  assert.ok(JSON.stringify(next.value).includes('six'));
  assert.ok(!JSON.stringify(next.value).includes('synthetic-secret'));
  const restarted = new CoreJobCardPages(file, options); await restarted.initialize();
  const refresh = await restarted.act({ ...action, page: 'refresh' }, scope, true, 'activity-original', 'invoke');
  assert.ok(JSON.stringify(refresh.value).includes('진행'));
  await restarted.act({ ...action, page: 'result' }, scope, true, 'activity-original', 'submit');
  assert.equal(updates.length, 1); assert.equal(updates[0].id, 'activity-original');
  for (const [payload, foreign, personal, id] of [
    [{ ...action, jobId: 'task-other' }, scope, true, 'activity-original'],
    [{ ...action, key: 'unknown' }, scope, true, 'activity-original'],
    [action, { ...scope, requesterId: 'other' }, true, 'activity-original'],
    [action, { ...scope, tenantId: 'other' }, true, 'activity-original'],
    [action, { ...scope, conversationId: 'other' }, true, 'activity-original'],
    [action, scope, false, 'activity-original'],
    [action, scope, true, 'wrong-activity'],
    [{ ...action, cursor: -1 }, scope, true, 'activity-original'],
  ] as const) assert.notEqual((await restarted.act(payload, foreign, personal, id, 'invoke')).statusCode, 200);
  assert.equal(updates.length, 1, 'rejected scope never updates');
  assert.equal(JSON.stringify(job), initialJobSnapshot, 'page reads do not mutate any job fields'); assert.ok(reads > 0);
  assert.equal(await restarted.create(job.id, scope, false), undefined, 'groups never receive private page navigation');
  const unbound = await restarted.create(job.id, scope, true); assert.ok(unbound);
  assert.equal((await restarted.act({ ...action, key: unbound.key }, scope, true, 'guessed-id', 'invoke')).statusCode, 400);
  const failed = await restarted.act({ ...action, page: 'summary' }, scope, true, 'activity-original', 'submit', async () => { throw new Error('synthetic update failed'); });
  assert.equal(failed.statusCode, 500);
  let sdkUpdates = 0;
  const skipped = await restarted.act({ ...action, page: 'summary' }, scope, true, 'activity-original', 'submit',
    async () => guardCoreCardPageUpdate(true, async () => { sdkUpdates++; }));
  assert.equal(skipped.statusCode, 500);
  assert.equal(sdkUpdates, 0, 'skipOutbound prevents even a valid personal SDK update');
  const retained = await restarted.act({ ...action, page: 'refresh' }, scope, true, 'activity-original', 'invoke');
  assert.ok(JSON.stringify(retained.value).includes('결과'), 'failed update must not publish a new page');
  const storeText = await fs.readFile(file, 'utf8');
  assert.ok(!storeText.includes('synthetic-secret') && !storeText.includes('safe result'), 'UI store persists no job content');
  const sent: unknown[] = [];
  const wrapped = wrapCoreJobCardSender(restarted, scope, true, async (_text, envelope, activity) => {
    assert.equal(envelope, undefined); sent.push(activity); return { state: 'connector-accepted', activityId: 'connector-id' };
  });
  const { createCoreOrchestrationJobActivity } = await import('../src/server/genui-response.js');
  await wrapped('', undefined, createCoreOrchestrationJobActivity(job));
  assert.equal(sent.length, 1);
  const sentCard = (sent[0] as any).attachments[0].content;
  assert.equal('text' in (sent[0] as object), false);
  const navigation = sentCard.actions.find((item: any) => item.data?.action === 'orchestration.page');
  assert.equal(navigation.type, 'Action.Submit', 'default Core retains Submit contract');
  assert.equal(navigation.associatedInputs, 'none', 'page read never collects unfolded inputs');
  const navigate = navigation.data;
  assert.equal((await restarted.act(navigate, scope, true, 'connector-id', 'invoke')).statusCode, 200);
  const invokeOutput: unknown[] = [];
  const reused = wrapCoreJobCardSender(restarted, scope, true, async (_text, _envelope, activity) => {
    invokeOutput.push(activity); return { state: 'connector-accepted' };
  }, undefined, 'connector-id');
  await reused('', undefined, createCoreOrchestrationJobActivity({ ...job, progress: [...job.progress, 'new progress'] }));
  assert.equal(invokeOutput.length, 1);
  assert.equal((invokeOutput[0] as any).attachments[0].content.actions[0].data.key, navigate.key, 'existing invoke never allocates another card key');
  assert.equal(sent.length, 1, 'navigation cannot cause additional BotSend');
  const originalBind = restarted.bind.bind(restarted);
  restarted.bind = async () => { throw new Error('synthetic disk failure'); };
  const accepted = await wrapped('', undefined, createCoreOrchestrationJobActivity(job));
  assert.equal(accepted.state, 'connector-accepted', 'binding failure must preserve SDK acceptance');
  assert.equal(accepted.activityId, 'connector-id');
  assert.equal(sent.length, 2, 'one requested card produces one send despite binding failure');
  restarted.bind = originalBind;
  const universal = new CoreJobCardPages(path.join(root, 'universal.json'), { ...options, universalActions: true });
  await universal.initialize();
  const universalCard = await universal.create(job.id, scope, true); assert.ok(universalCard);
  for (const button of universalCard.activity.attachments[0].content.actions ?? []) {
    if (button.type !== 'Action.Execute') continue;
    assert.equal(button.associatedInputs, 'none');
    assert.equal((button.fallback as any).type, 'Action.Submit');
    assert.equal((button.fallback as any).associatedInputs, 'none');
  }
  await universal.bind(universalCard.key, scope, 'universal-id');
  const inputRequiredJob = { ...job, status: 'input_required' as const };
  const inputPages = new CoreJobCardPages(path.join(root, 'inputs.json'), { ...options, getJob: () => inputRequiredJob });
  await inputPages.initialize(); const inputCard = await inputPages.create(job.id, scope, true); assert.ok(inputCard);
  assert.ok(JSON.stringify(inputCard.activity).includes('Input.Text'));
  for (const button of inputCard.activity.attachments[0].content.actions ?? []) {
    if ((button.data as any)?.action === 'orchestration.page') assert.equal(button.associatedInputs, 'none');
  }


  console.log('PASS: same-activity pages, no send/job mutation, owner isolation, restart/refresh and bounded masked views');
} finally { await fs.rm(root, { recursive: true, force: true }); }
