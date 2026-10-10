import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

import { AgentJobStore, type AgentJob } from '../src/server/agent-job-store.js';
import { atomicWriteJson, readAtomicJsonStore } from '../src/server/atomic-file.js';
import { CoreResultPublicationService, type CoreResultOrigin, type CoreResultPublicationPrincipal,
  type CoreResultPublicationSender } from '../src/server/core-result-publication.js';
import { coreResultConversationLink, mountCoreResultRoutes } from '../src/server/core-result-route.js';
import { createUserAuthMiddleware } from '../src/server/user-auth.js';

// FIXTURE: delegated claims, jobs, connector receipts and all result data are synthetic.
// The real Express routes, existing auth middleware, durable store and publication service run unchanged.
// Official navigation contract: existing chat IDs are 19:xxx; a: Bot IDs cannot be converted.
// https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/deep-link-teams#deep-link-to-navigate-to-a-chat
const owner = { tenantId: 'synthetic-tenant', requesterId: 'synthetic-owner' };
const origin: CoreResultOrigin = { schemaVersion: '1', source: 'authenticated-teams-activity', ...owner,
  conversationId: '19:synthetic-chat@thread.v2', conversationType: 'groupChat',
  serviceUrl: 'https://smba.trafficmanager.net/teams/', activityId: 'original-activity', originThreadId: 'original-thread' };
const result = '합성 결과 😀\n두 번째 줄: https://example.com/evidence\n';
const completed: AgentJob = { id: 'synthetic-result:chat', ...owner, conversationId: 'server-owned-private-review',
  prompt: 'synthetic request', provider: 'codex', mode: 'read-only', status: 'completed', progress: [], result,
  resultOrigin: origin, createdAt: '2026-10-11T00:00:00.000Z', finishedAt: '2026-10-11T00:01:00.000Z' };
const botJob: AgentJob = { ...completed, id: 'synthetic-bot-result', resultOrigin: { ...origin,
  conversationType: 'personal', conversationId: 'a:synthetic-bot-chat' } };
const channelJob: AgentJob = { ...completed, id: 'synthetic-channel-result', resultOrigin: { ...origin,
  conversationType: 'channel', conversationId: '19:synthetic-channel@thread.tacv2' } };
const incomplete: AgentJob = { ...completed, id: 'synthetic-running', status: 'running', result: undefined, finishedAt: undefined };
const noOrigin: AgentJob = { ...completed, id: 'synthetic-no-origin', resultOrigin: undefined };
const foreignJob: AgentJob = { ...completed, id: 'synthetic-foreign-job', requesterId: 'synthetic-foreign-owner',
  resultOrigin: { ...origin, requesterId: 'synthetic-foreign-owner' } };

for (const conversationType of ['personal', 'groupChat'] as const) {
  assert.equal(coreResultConversationLink({ ...origin, conversationType }),
    'https://teams.microsoft.com/l/chat/19%3Asynthetic-chat%40thread.v2/conversations');
}
for (const unsupported of [undefined, botJob.resultOrigin, channelJob.resultOrigin,
  ...['19:bad/chat', '19:bad?users=forged', '19:bad#fragment', '19:bad chat', 'synthetic-chat', '19%3Aencoded'].map(conversationId => ({ ...origin, conversationId }))]) {
  assert.equal(coreResultConversationLink(unsupported), undefined, 'unsupported or malformed origin never guesses a new chat/channel');
}

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-core-result-route-test-'));
const app = express();
const server = http.createServer(app);
const deadline = AbortSignal.timeout(15_000);
try {
  const storePath = path.join(temporaryRoot, 'jobs.json');
  await atomicWriteJson(storePath, [completed, botJob, channelJob, incomplete, noOrigin, foreignJob]);
  const store = new AgentJobStore(storePath);
  await store.initialize();
  const sdkCalls: Array<{ origin: CoreResultOrigin; payload: { text: string; operationId: string; resultRevision: string } }> = [];
  const sdkSenderMock: CoreResultPublicationSender = async (target, payload) => {
    const durable = (JSON.parse(await readAtomicJsonStore(storePath)) as AgentJob[]).find(job => job.id === completed.id);
    assert.equal(durable?.resultPublication?.state, 'sending', 'durable claim precedes the SDK sender mock call');
    sdkCalls.push({ origin: structuredClone(target), payload: structuredClone(payload) });
    return { state: 'connector-accepted', activityId: 'synthetic-sdk-activity' };
  };
  const service = new CoreResultPublicationService({ state: {
    read: async (id, principal) => store.getForPrincipal(id, principal),
    mutate: store.mutateResultPublication.bind(store),
  }, sender: sdkSenderMock });
  let canPublish = true;
  const tokens: Record<string, { tid: string; oid: string }> = {
    'owner-token': { tid: owner.tenantId, oid: owner.requesterId },
    'foreign-owner-token': { tid: owner.tenantId, oid: 'synthetic-foreign-owner' },
    'foreign-tenant-token': { tid: 'synthetic-foreign-tenant', oid: owner.requesterId },
  };
  mountCoreResultRoutes(app, {
    authenticate: createUserAuthMiddleware({ allowUnauthenticated: false, acceptedAudiences: ['synthetic-teams-tab'],
      validator: { validateAccessToken: async token => tokens[token]
        ? { ...tokens[token], aud: 'synthetic-teams-tab', scp: 'access_as_user' } : null }, logger: { warn: () => undefined } }),
    resolvePrincipal: (_request, response): CoreResultPublicationPrincipal | undefined => {
      const user = response.locals.user;
      return user ? { tenantId: user.tid, requesterId: user.requesterId } : undefined;
    },
    readJob: (id, principal) => store.getForPrincipal(id, principal), service, canPublish: () => canPublish,
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}/api/core-results/jobs`;
  const request = (jobId: string, suffix: string, options: { method?: string; token?: string; body?: unknown;
    query?: string; headers?: Record<string, string> } = {}) => fetch(`${base}/${encodeURIComponent(jobId)}/${suffix}${options.query ?? ''}`, {
    method: options.method ?? 'GET', signal: AbortSignal.any([deadline, AbortSignal.timeout(3_000)]),
    headers: { ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }), ...options.headers },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const ownerRequest = (jobId: string, suffix: string, options: Parameters<typeof request>[2] = {}) =>
    request(jobId, suffix, { token: 'owner-token', ...options });
  const fakeConfirmation = { operationId: 'publication-00000000-0000-0000-0000-000000000000', resultRevision: '0'.repeat(64) };
  const endpoints = [
    { suffix: 'publication' }, { suffix: 'preview', method: 'POST', body: {} },
    { suffix: 'publication', method: 'POST', body: fakeConfirmation }, { suffix: 'result.txt' },
  ];
  for (const endpoint of endpoints) {
    for (const token of [undefined, 'invalid-token']) {
      const denied = await request(completed.id, endpoint.suffix, { ...endpoint, token });
      assert.equal(denied.status, 401, 'every route requires validated delegated bearer claims');
      assert.doesNotMatch(await denied.text(), /합성 결과|synthetic-sdk-activity|original-thread/);
    }
    for (const token of ['foreign-owner-token', 'foreign-tenant-token']) {
      const denied = await request(completed.id, endpoint.suffix, { ...endpoint, token,
        headers: { 'x-requester-id': owner.requesterId, 'x-tenant-id': owner.tenantId } });
      assert.equal(denied.status, 404, 'foreign owner/tenant cannot select identity with client headers');
      assert.equal((await denied.json()).error.code, 'NOT_FOUND');
    }
    const missing = await ownerRequest('synthetic-missing', endpoint.suffix, endpoint);
    assert.equal(missing.status, 404, 'missing and foreign jobs are indistinguishable');
    const injected = await ownerRequest(completed.id, endpoint.suffix, { ...endpoint, query: '?conversationId=19%3Aforged' });
    assert.equal(injected.status, 400, 'all routes reject caller-selected query destinations');
    assert.equal((await injected.json()).error.code, 'CORE_RESULT_PUBLICATION_REFUSED');
  }
  assert.equal(sdkCalls.length, 0);
  assert.equal(store.getForPrincipal(completed.id, owner)?.resultPublication, undefined);
  assert.equal((await ownerRequest(foreignJob.id, 'publication')).status, 404);
  assert.equal((await ownerRequest('invalid job', 'publication')).status, 400);

  const initial = await ownerRequest(completed.id, 'publication');
  assert.equal(initial.status, 200);
  assert.equal(initial.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await initial.json(), { canPreview: true,
    returnToConversation: 'https://teams.microsoft.com/l/chat/19%3Asynthetic-chat%40thread.v2/conversations' });
  assert.equal(sdkCalls.length, 0, 'GET status never sends or creates a publication');
  assert.equal(store.getForPrincipal(completed.id, owner)?.resultPublication, undefined);
  for (const [job, canPreview, hasChatNavigation] of [[botJob, true, false], [channelJob, true, false],
    [incomplete, false, true], [noOrigin, false, false]] as const) {
    const status = await ownerRequest(job.id, 'publication');
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), { canPreview, ...(hasChatNavigation ? {
      returnToConversation: 'https://teams.microsoft.com/l/chat/19%3Asynthetic-chat%40thread.v2/conversations',
    } : {}) }, 'only original supported 19: chat provenance produces navigation');
  }
  for (const key of ['destination', 'conversationId', 'tenantId', 'requesterId', 'scope', 'origin', 'originThreadId', 'serviceUrl', 'jobId']) {
    const forged = await ownerRequest(completed.id, 'preview', { method: 'POST', body: { [key]: 'forged' } });
    assert.equal(forged.status, 400, `preview rejects ${key}`);
  }
  assert.equal((await ownerRequest(incomplete.id, 'preview', { method: 'POST', body: {} })).status, 409);
  assert.equal((await ownerRequest(noOrigin.id, 'preview', { method: 'POST', body: {} })).status, 409);
  assert.equal(sdkCalls.length, 0);

  const previewResponse = await ownerRequest(completed.id, 'preview', { method: 'POST', body: {} });
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(previewResponse.headers.get('cache-control'), 'no-store');
  assert.equal(preview.text, result);
  assert.equal(preview.publication.state, 'preview');
  assert.equal(preview.publication.jobId, completed.id);
  assert.deepEqual(preview.publication.origin, { conversationType: 'groupChat' });
  assert.deepEqual(Object.keys(preview.publication).sort(), ['jobId', 'operationId', 'origin', 'resultRevision', 'state']);
  assert.equal(sdkCalls.length, 0, 'private POST preview writes durable review but never sends');
  const confirmation = { operationId: preview.publication.operationId, resultRevision: preview.publication.resultRevision };
  for (const key of ['destination', 'conversationId', 'tenantId', 'scope', 'origin', 'originThreadId', 'serviceUrl', 'jobId']) {
    assert.equal((await ownerRequest(completed.id, 'publication', { method: 'POST', body: { ...confirmation, [key]: 'forged' } })).status, 400);
  }
  assert.equal((await ownerRequest(completed.id, 'publication', { method: 'POST', body: { ...confirmation, resultRevision: '0'.repeat(64) } })).status, 409);
  assert.equal((await ownerRequest(completed.id, 'publication', { method: 'POST', body: { ...confirmation, operationId: fakeConfirmation.operationId } })).status, 409);
  assert.equal(sdkCalls.length, 0, 'forged or mismatched confirmation never invokes SDK sender');

  const download = await ownerRequest(completed.id, 'result.txt');
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('cache-control'), 'no-store');
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(download.headers.get('content-disposition'), 'attachment; filename="synthetic-result_chat-result.txt"');
  assert.equal(download.headers.get('content-type'), 'text/plain; charset=utf-8');
  const downloaded = Buffer.from(await download.arrayBuffer());
  assert.deepEqual(downloaded, Buffer.from(result, 'utf8'), 'authenticated download preserves exact UTF-8 result bytes');
  assert.equal(Number(download.headers.get('content-length')), downloaded.length);
  assert.equal((await ownerRequest(incomplete.id, 'result.txt')).status, 409);
  assert.equal(sdkCalls.length, 0, 'result text download cannot send to Teams');

  const confirmed = await ownerRequest(completed.id, 'publication', { method: 'POST', body: confirmation });
  assert.equal(confirmed.status, 200);
  assert.equal((await confirmed.json()).publication.state, 'connector-accepted');
  assert.deepEqual(sdkCalls, [{ origin, payload: { text: result, ...confirmation } }],
    'exact confirmation sends exactly approved text/revision to immutable authenticated origin and thread');
  const replay = await Promise.all(Array.from({ length: 6 }, () => ownerRequest(completed.id, 'publication', { method: 'POST', body: confirmation })));
  for (const response of replay) {
    assert.equal(response.status, 200);
    assert.equal((await response.json()).publication.state, 'connector-accepted');
  }
  const finalStatus = await ownerRequest(completed.id, 'publication');
  const final = await finalStatus.json();
  assert.equal(final.publication.state, 'connector-accepted');
  assert.equal('activityId' in final.publication, false, 'connector receipt/provenance stays server-owned');
  assert.equal('delivered' in final.publication, false, 'connector acceptance never claims user receipt');
  assert.equal(sdkCalls.length, 1, 'GET status and repeated POST confirmation cannot re-send');
  const restarted = new AgentJobStore(storePath);
  await restarted.initialize();
  assert.equal(restarted.getForPrincipal(completed.id, owner)?.resultPublication?.state, 'connector-accepted');

  canPublish = false;
  assert.equal((await (await ownerRequest(completed.id, 'publication')).json()).canPreview, false);
  for (const endpoint of endpoints.filter(item => item.method === 'POST')) {
    const response = await ownerRequest(completed.id, endpoint.suffix, { ...endpoint,
      body: endpoint.suffix === 'publication' ? confirmation : {} });
    assert.equal(response.status, 501);
    assert.equal((await response.json()).error.code, 'PUBLICATION_UNAVAILABLE');
  }
  assert.equal((await ownerRequest(completed.id, 'result.txt')).status, 200, 'private result download remains available when publication is unavailable');
  assert.equal(sdkCalls.length, 1);
  console.log('core-result-route-test: PASS — authenticated Express routes, owner/tenant isolation, strict destination-free requests, private preview/status, one exact SDK sender mock call, replay safety, UTF-8 download, and conservative original-chat navigation.');
} finally {
  if (server.listening) await new Promise<void>(resolve => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
  else server.closeAllConnections();
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}
