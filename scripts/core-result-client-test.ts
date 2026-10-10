import assert from 'node:assert/strict';

const module = await import('../src/client/core-result-client.js').catch(() => undefined);
assert.equal(typeof module?.createCoreResultClient, 'function', 'result review needs an authenticated client with separate read, preview, confirmation and download operations');
const { createCoreResultClient } = module!;
const jobId = 'job:result-fixture';
const publication = { operationId: 'publication-00000000-0000-4000-8000-000000000000', jobId,
  resultRevision: 'a'.repeat(64), state: 'preview' as const, origin: { conversationType: 'groupChat' as const } };
const requests: Array<{ path: string; init: RequestInit }> = [];
let response: unknown = { canPreview: true };
let status = 200;
const client = createCoreResultClient(async (input, init = {}) => {
  requests.push({ path: String(input), init });
  return String(input).endsWith('/result.txt') ? new Response('한글 결과', { headers: { 'content-type': 'text/plain' } })
    : new Response(JSON.stringify(response), { status, headers: { 'content-type': 'application/json' } });
});
assert.equal((await client.getStatus(jobId)).canPreview, true);
assert.deepEqual(requests[0].path, '/api/core-results/jobs/job%3Aresult-fixture/publication');
assert.equal(requests[0].init.method ?? 'GET', 'GET');
response = { publication, text: '원래 대화로 보낼 결과' };
assert.equal((await client.preview(jobId)).text, '원래 대화로 보낼 결과');
assert.equal(requests.at(-1)?.path, '/api/core-results/jobs/job%3Aresult-fixture/preview');
assert.deepEqual(JSON.parse(String(requests.at(-1)?.init.body)), {}, 'preview accepts no caller destination or owner scope');
response = { publication: { ...publication, state: 'connector-accepted' } };
assert.equal((await client.confirm(jobId, { operationId: publication.operationId, resultRevision: publication.resultRevision })).publication.state, 'connector-accepted');
assert.deepEqual(JSON.parse(String(requests.at(-1)?.init.body)), { operationId: publication.operationId, resultRevision: publication.resultRevision });
const count = requests.length;
await assert.rejects(client.confirm(jobId, { operationId: publication.operationId, resultRevision: publication.resultRevision, destination: 'foreign-chat' } as never));
assert.equal(requests.length, count, 'extra identity/destination keys must fail before any request');
response = { publication: { ...publication, operationId: 'publication-00000000-0000-4000-8000-000000000001', state: 'connector-accepted' } };
await assert.rejects(client.confirm(jobId, { operationId: publication.operationId, resultRevision: publication.resultRevision }), /확인/, 'confirmation must read back the exact preview operation');
response = { publication: { ...publication, jobId: 'foreign-owner-job' }, canPreview: true };
await assert.rejects(client.getStatus(jobId), /확인/);
response = { publication, canPreview: true, returnToConversation: 'javascript:alert(1)' };
assert.equal((await client.getStatus(jobId)).returnToConversation, undefined, 'unsafe return link is never rendered');
response = { publication, canPreview: true, returnToConversation: 'https://teams.microsoft.com/l/chat/19%3Afixture%40thread.v2/conversations' };
assert.ok((await client.getStatus(jobId)).returnToConversation);
response = { error: { message: 'private forbidden detail' } }; status = 403;
await assert.rejects(client.getStatus(jobId), error => error && typeof error === 'object' && 'status' in error && error.status === 403);
assert.equal(await (await client.download(jobId)).text(), '한글 결과');
assert.equal(requests.at(-1)?.path, '/api/core-results/jobs/job%3Aresult-fixture/result.txt');
console.log('PASS: authenticated result read/preview/strict confirm/Blob download, matching job and safe return link');
