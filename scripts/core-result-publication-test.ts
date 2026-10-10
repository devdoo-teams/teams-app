import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServerDerivedCoreScope } from '../src/server/core-orchestration-service.js';
import { AgentJobStore, type AgentJob } from '../src/server/agent-job-store.js';
import { atomicWriteJson, readAtomicJsonStore } from '../src/server/atomic-file.js';
import {
  captureCoreResultOrigin, CoreResultConnectorRejectedError, CoreResultPublicationError, CoreResultPublicationService,
  CORE_RESULT_PUBLICATION_MAX_BYTES, projectCoreResultResources, readCoreFileEvidence,
  renderCoreResultPublicationText, safeCoreResultUrl,
  type CoreResultPublication, type CoreResultPublicationSender, type CoreResultPublicationStatePort,
} from '../src/server/core-result-publication.js';

const job: AgentJob = {
  id: 'synthetic-result', prompt: 'synthetic request', provider: 'codex', mode: 'read-only',
  status: 'completed', result: 'Result evidence https://example.com/source', progress: [],
  requesterId: 'synthetic-owner', tenantId: 'synthetic-tenant', conversationId: 'synthetic-origin',
  createdAt: '2026-10-11T00:00:00.000Z', finishedAt: '2026-10-11T00:01:00.000Z',
};
const resources = projectCoreResultResources(job)!;
assert.equal(resources.file.state, 'unsupported', 'result resources must distinguish unsupported Teams file delivery from completed result text');
assert.equal(resources.sources.length, 1);
assert.deepEqual(resources.sources[0], { url: 'https://example.com/source', host: 'example.com', evidence: 'result-text', retrieval: 'unverified', action: 'explicit-open' });
assert.equal(projectCoreResultResources({ status: 'running', result: 'partial' }), undefined);
assert.deepEqual(projectCoreResultResources({ status: 'completed', result: 'No source links' })?.sources, []);
for (const unsafe of ['http://example.com', 'javascript:alert(1)', 'https://user:password@example.com',
  'https://localhost/path', 'https://127.0.0.1/path', 'https://[::1]/path', 'https://example.internal/path',
  'https://example.com/?access_token=secret', 'https://example.com:8443/path', 'https://example.com/\\@evil.com']) {
  assert.equal(safeCoreResultUrl(unsafe), undefined, `unsafe explicit source link rejected: ${unsafe}`);
}
assert.equal(safeCoreResultUrl('https://example.com/reference#section'), 'https://example.com/reference#section');
for (const result of ['가'.repeat(20_000), '😀'.repeat(10_000), 'x'.repeat(24_001)]) {
  const previewText = renderCoreResultPublicationText(result);
  assert.ok(Buffer.byteLength(previewText, 'utf8') <= CORE_RESULT_PUBLICATION_MAX_BYTES);
  assert.ok(previewText.endsWith('긴 결과 일부 생략…전체 결과는 개인 작업에서 확인'));
  assert.ok(!previewText.includes('\ufffd'), 'UTF-8 budget never splits a Unicode character');
}
const prepared = { name: 'result.txt', state: 'prepared' as const, preparedAt: '2026-10-11T00:01:00.000Z', contentDigest: 'a'.repeat(64), sizeBytes: 42 };
const consent = { ...prepared, state: 'consent-requested' as const, consentActivityId: 'consent-activity', consentRequestedAt: '2026-10-11T00:02:00.000Z' };
const uploaded = { ...consent, state: 'uploaded' as const, consentAcceptedAt: '2026-10-11T00:03:00.000Z', remoteFileId: 'remote-file', uploadedAt: '2026-10-11T00:04:00.000Z' };
const delivered = { ...uploaded, state: 'delivered' as const, deliveryActivityId: 'file-card', userReceiptAt: '2026-10-11T00:05:00.000Z' };
for (const evidence of [prepared, consent, uploaded, delivered,
  { name: 'result.txt', state: 'failed', reason: 'upload-failed', failedAt: '2026-10-11T00:06:00.000Z' },
  { name: 'result.txt', state: 'unsupported', reason: 'manifest-supports-files-false' }]) assert.deepEqual(readCoreFileEvidence(evidence), evidence);
assert.equal(readCoreFileEvidence(consent).state, 'consent-requested');
assert.throws(() => readCoreFileEvidence({ ...consent, state: 'delivered' }), CoreResultPublicationError);
assert.throws(() => readCoreFileEvidence({ ...uploaded, state: 'delivered', deliveryActivityId: 'connector-accepted-only' }), CoreResultPublicationError);
assert.throws(() => readCoreFileEvidence({ ...uploaded, consentAcceptedAt: undefined }), CoreResultPublicationError);
assert.throws(() => readCoreFileEvidence({ ...delivered, userReceiptAt: prepared.preparedAt }), CoreResultPublicationError);
for (const unsupportedEvidence of [
  { name: 'result.txt', state: 'unsupported', reason: 'manifest-supports-files-false', deliveryActivityId: 'false-delivery' },
  { ...prepared, userReceiptAt: delivered.userReceiptAt },
  { ...consent, uploadedAt: uploaded.uploadedAt, remoteFileId: uploaded.remoteFileId },
  { ...uploaded, deliveryActivityId: delivered.deliveryActivityId, userReceiptAt: delivered.userReceiptAt },
  { ...delivered, state: 'failed', reason: 'upload-failed', failedAt: '2026-10-11T00:06:00.000Z' },
]) assert.throws(() => readCoreFileEvidence(unsupportedEvidence), CoreResultPublicationError, 'file state rejects contradictory delivery evidence');

const scope = createServerDerivedCoreScope({ tenantId: job.tenantId!, requesterId: job.requesterId, conversationId: job.conversationId });
const origin = captureCoreResultOrigin(scope, { channelId: 'msteams', id: 'original-activity', serviceUrl: 'https://smba.trafficmanager.net/teams/',
  from: { aadObjectId: scope.requesterId }, conversation: { id: scope.conversationId, tenantId: scope.tenantId, conversationType: 'channel' } });
const threadOrigin = captureCoreResultOrigin(scope, { channelId: 'msteams', id: 'reply-activity', replyToId: 'original-thread', serviceUrl: origin.serviceUrl,
  from: { aadObjectId: scope.requesterId }, conversation: { id: scope.conversationId, tenantId: scope.tenantId, conversationType: 'channel' } });
assert.equal(threadOrigin.originThreadId, 'original-thread', 'authenticated channel reply preserves the original thread');
assert.equal(origin.originThreadId, undefined, 'original activity remains the reply target when replyToId is absent');
assert.throws(() => captureCoreResultOrigin(scope, { channelId: 'msteams', id: 'reply-activity', replyToId: '', serviceUrl: origin.serviceUrl,
  from: { aadObjectId: scope.requesterId }, conversation: { id: scope.conversationId, tenantId: scope.tenantId, conversationType: 'channel' } }), CoreResultPublicationError);
assert.throws(() => captureCoreResultOrigin(scope, { channelId: 'msteams', id: 'forged', serviceUrl: origin.serviceUrl,
  from: { aadObjectId: 'other-owner' }, conversation: { id: scope.conversationId, tenantId: scope.tenantId, conversationType: 'channel' } }), CoreResultPublicationError);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'core-result-publication-'));
try {
  const file = path.join(root, 'publication', 'job.json');
  await atomicWriteJson(file, [{ ...job, resultOrigin: threadOrigin }]);
  let sends = 0;
  const store = new AgentJobStore(file); await store.initialize();
  const state = statePort(store);
  const sender: CoreResultPublicationSender = async (target, payload) => {
    sends++;
    const durable = (JSON.parse(await readAtomicJsonStore(file)) as AgentJob[])[0];
    assert.equal(durable.resultPublication?.state, 'sending', 'sending is visible on disk before the connector runs');
    assert.deepEqual(target, threadOrigin, 'publication uses only immutable original destination and thread');
    assert.equal(payload.text, job.result);
    return { state: 'connector-accepted', activityId: 'published-activity' };
  };
  const service = new CoreResultPublicationService({ state, sender });
  const preview = await service.preview(scope, { jobId: job.id }); assert.ok(preview);
  assert.equal(preview.publication.state, 'preview');
  assert.equal(preview.text, job.result);
  assert.equal(sends, 0, 'private review never sends to Teams');
  assert.equal((await service.preview(scope, { jobId: job.id }))?.publication.operationId, preview.publication.operationId);
  const confirmation = { jobId: job.id, operationId: preview.publication.operationId, resultRevision: preview.publication.resultRevision };
  for (const forged of ['destination', 'conversationId', 'tenantId', 'scope', 'origin', 'originThreadId']) {
    await assert.rejects(service.confirm(scope, { ...confirmation, [forged]: 'client-forged' }), CoreResultPublicationError);
  }
  await assert.rejects(service.confirm(scope, { ...confirmation, resultRevision: '0'.repeat(64) }), CoreResultPublicationError);
  for (const foreign of [{ ...scope, requesterId: 'foreign' }, { ...scope, tenantId: 'foreign' }]) {
    assert.equal(await service.preview(foreign, { jobId: job.id }), undefined);
    assert.equal(await service.confirm(foreign, confirmation), undefined);
  }
  const rapid = await Promise.all(Array.from({ length: 12 }, () => service.confirm(scope, confirmation)));
  assert.equal(sends, 1, '12 rapid confirm callbacks make one connector call');
  assert.ok(rapid.some(item => item?.state === 'connector-accepted'));
  const accepted = await service.status(scope, { jobId: job.id });
  assert.equal(accepted?.state, 'connector-accepted');
  assert.equal(accepted?.activityId, 'published-activity');
  assert.equal('delivered' in accepted!, false, 'connector acceptance is never user receipt');
  const restartedStore = new AgentJobStore(file); await restartedStore.initialize();
  assert.equal(restartedStore.getForPrincipal(job.id, scope)?.resultOrigin?.originThreadId, 'original-thread');
  assert.equal(restartedStore.getForPrincipal(job.id, scope)?.resultPublication?.origin.originThreadId, 'original-thread');
  const restarted = new CoreResultPublicationService({ state: statePort(restartedStore), sender });
  assert.equal((await restarted.confirm(scope, confirmation))?.state, 'connector-accepted');
  assert.equal(sends, 1, 'restart read-back never re-sends an accepted operation');

  const clone = store.getForPrincipal(job.id, scope)!;
  Object.assign(clone.resultOrigin!, { conversationId: 'mutated-copy', originThreadId: 'mutated-thread' });
  Object.assign(clone.resultPublication!.origin, { conversationId: 'mutated-copy', originThreadId: 'mutated-thread' });
  assert.equal(store.getForPrincipal(job.id, scope)?.resultOrigin?.conversationId, origin.conversationId);
  assert.equal(store.getForPrincipal(job.id, scope)?.resultPublication?.origin.conversationId, origin.conversationId);
  assert.equal(store.getForPrincipal(job.id, scope)?.resultOrigin?.originThreadId, 'original-thread');
  assert.equal(store.getForPrincipal(job.id, scope)?.resultPublication?.origin.originThreadId, 'original-thread');
  await assert.rejects(store.update(job.id, scope, { resultOrigin: { ...origin, conversationId: 'forged' } }), /result authority/);
  await assert.rejects(store.update(job.id, scope, { resultPublication: undefined }), /result authority/);

  for (const scenario of ['unknown', 'missing-id', 'rejected', 'settlement-failure', 'claim-failure'] as const) {
    const scenarioFile = path.join(root, scenario, 'job.json');
    await atomicWriteJson(scenarioFile, [{ ...job, resultOrigin: origin }]);
    let rejectState: CoreResultPublication['state'] | undefined;
    const savedNodeEnv = process.env.NODE_ENV; process.env.NODE_ENV = 'test';
    const scenarioStore = AgentJobStore.createForTesting(scenarioFile, {}, async (target, rows) => {
      if ((rows as AgentJob[]).some(row => row.resultPublication?.state === rejectState && rejectState !== undefined)) {
        throw new Error('synthetic durable publication write failure');
      }
      await atomicWriteJson(target, rows);
    });
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedNodeEnv;
    await scenarioStore.initialize();
    let scenarioSends = 0;
    const scenarioService = new CoreResultPublicationService({ state: statePort(scenarioStore), sender: async () => {
      scenarioSends++;
      if (scenario === 'unknown') throw new Error('synthetic network loss; no receipt');
      if (scenario === 'rejected') throw new CoreResultConnectorRejectedError(403);
      if (scenario === 'missing-id') return { state: 'connector-accepted', activityId: '' };
      return { state: 'connector-accepted', activityId: 'accepted-before-store-failure' };
    } });
    const preparedPublication = (await scenarioService.preview(scope, { jobId: job.id }))!.publication;
    const input = { jobId: job.id, operationId: preparedPublication.operationId, resultRevision: preparedPublication.resultRevision };
    rejectState = scenario === 'claim-failure' ? 'sending' : scenario === 'settlement-failure' ? 'connector-accepted' : undefined;
    if (rejectState) await assert.rejects(scenarioService.confirm(scope, input), /synthetic durable publication write failure/);
    else {
      const outcome = await scenarioService.confirm(scope, input);
      assert.equal(outcome?.state, scenario === 'rejected' ? 'failed' : 'ambiguous');
    }
    const recoveredStore = new AgentJobStore(scenarioFile); await recoveredStore.initialize();
    const recovered = new CoreResultPublicationService({ state: statePort(recoveredStore), sender: async () => {
      scenarioSends++; return { state: 'connector-accepted', activityId: 'unexpected-resend' };
    } });
    if (scenario !== 'claim-failure') {
      const status = await recovered.status(scope, { jobId: job.id });
      assert.equal(status?.state, scenario === 'rejected' ? 'failed' : 'ambiguous');
      await recovered.confirm(scope, input);
      assert.equal(scenarioSends, 1, `${scenario} must never automatically re-send`);
    } else {
      assert.equal(scenarioSends, 0, 'failed sending persistence never calls connector');
      assert.equal((await recovered.status(scope, { jobId: job.id }))?.state, 'preview');
    }
  }

  const staleFile = path.join(root, 'stale', 'job.json');
  await atomicWriteJson(staleFile, [{ ...job, resultOrigin: origin }]);
  const staleStore = new AgentJobStore(staleFile); await staleStore.initialize();
  const staleService = new CoreResultPublicationService({ state: statePort(staleStore), sender });
  const stalePreview = (await staleService.preview(scope, { jobId: job.id }))!.publication;
  await staleStore.update(job.id, scope, { result: 'changed result' });
  await assert.rejects(staleService.confirm(scope, { jobId: job.id, operationId: stalePreview.operationId, resultRevision: stalePreview.resultRevision }),
    (error: unknown) => error instanceof CoreResultPublicationError && error.reason === 'stale-result');
  assert.equal(sends, 1);
  const renewed = await staleService.preview(scope, { jobId: job.id });
  assert.notEqual(renewed?.publication.operationId, stalePreview.operationId, 'only an explicit new preview binds changed content');

  const restFile = path.join(root, 'rest-only', 'job.json'); await atomicWriteJson(restFile, [job]);
  const restStore = new AgentJobStore(restFile); await restStore.initialize();
  const restService = new CoreResultPublicationService({ state: statePort(restStore), sender });
  await assert.rejects(restService.preview(scope, { jobId: job.id }), (error: unknown) => error instanceof CoreResultPublicationError && error.reason === 'unsupported-origin');
  const corruptedFile = path.join(root, 'corrupt', 'job.json');
  const originalRecord = (JSON.parse(await readAtomicJsonStore(file)) as AgentJob[])[0];
  const corrupted = { ...originalRecord, resultPublication: { ...accepted, origin: { ...threadOrigin, originThreadId: 'forged-thread' } } };
  await atomicWriteJson(corruptedFile, [corrupted]);
  const corruptBytes = await readAtomicJsonStore(corruptedFile);
  await assert.rejects(new AgentJobStore(corruptedFile).initialize(), CoreResultPublicationError);
  assert.equal(await readAtomicJsonStore(corruptedFile), corruptBytes);

  const privateFile = path.join(root, 'private-review', 'job.json');
  const privateScope = { ...scope, conversationId: 'server-owned-private-review' };
  const privateStore = new AgentJobStore(privateFile); await privateStore.initialize();
  const privateJob = await privateStore.create({ prompt: 'private review from authenticated channel', provider: 'codex', mode: 'read-only',
    scope: privateScope, resultOrigin: threadOrigin });
  await privateStore.update(privateJob.id, privateScope, { status: 'completed', result: job.result, finishedAt: new Date().toISOString() });
  let publishedPrivateOrigin: unknown;
  const privateService = new CoreResultPublicationService({ state: statePort(privateStore), sender: async target => {
    publishedPrivateOrigin = target; return { state: 'connector-accepted', activityId: 'private-review-published' };
  } });
  const privatePreview = (await privateService.preview(privateScope, { jobId: privateJob.id }))!;
  await privateService.confirm(privateScope, { jobId: privateJob.id, operationId: privatePreview.publication.operationId,
    resultRevision: privatePreview.publication.resultRevision });
  assert.deepEqual(publishedPrivateOrigin, threadOrigin, 'private review publishes only to the captured authenticated channel and thread');
  for (const wrongIdentity of [{ ...threadOrigin, tenantId: 'other-tenant' }, { ...threadOrigin, requesterId: 'other-owner' }]) {
    await assert.rejects(privateStore.create({ prompt: 'invalid original identity', provider: 'codex', mode: 'read-only',
      scope: privateScope, resultOrigin: wrongIdentity }), CoreResultPublicationError);
  }
  assert.throws(() => captureCoreResultOrigin(createServerDerivedCoreScope(privateScope), {
    channelId: 'msteams', id: 'forged-private-capture', serviceUrl: threadOrigin.serviceUrl,
    from: { aadObjectId: scope.requesterId }, conversation: { id: scope.conversationId, tenantId: scope.tenantId, conversationType: 'channel' },
  }), CoreResultPublicationError, 'capturing still requires the exact authenticated activity scope');
  await assert.rejects(privateService.preview(privateScope, { jobId: privateJob.id, origin: threadOrigin } as { jobId: string }), CoreResultPublicationError);

  const boundedFile = path.join(root, 'bounded', 'job.json');
  await atomicWriteJson(boundedFile, [{ ...job, result: '가'.repeat(20_000), resultOrigin: origin }]);
  const boundedStore = new AgentJobStore(boundedFile); await boundedStore.initialize();
  let sentText: string | undefined;
  const boundedService = new CoreResultPublicationService({ state: statePort(boundedStore), sender: async (_origin, payload) => {
    sentText = payload.text; return { state: 'connector-accepted', activityId: 'bounded-activity' };
  } });
  const bounded = (await boundedService.preview(scope, { jobId: job.id }))!;
  assert.ok(Buffer.byteLength(bounded.text, 'utf8') <= CORE_RESULT_PUBLICATION_MAX_BYTES);
  await boundedService.confirm(scope, { jobId: job.id, operationId: bounded.publication.operationId, resultRevision: bounded.publication.resultRevision });
  assert.equal(sentText, bounded.text, 'user approves the exact byte-bounded text that the connector receives');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('core-result-publication-test: PASS');

/** Production atomic boundary, with no independent fixture ledger. */
function statePort(store: AgentJobStore): CoreResultPublicationStatePort {
  return { read: async (id, principal) => store.getForPrincipal(id, principal),
    mutate: store.mutateResultPublication.bind(store) };
}
