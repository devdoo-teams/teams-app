import assert from 'node:assert/strict';

import {
  createPrincipalScopedProviderHttpBroker,
  type ProviderHttpFetch,
} from '../src/server/mcp-provider-http-broker.js';

const principal = { tenantId: 'tenant-http', requesterId: 'requester-http' } as const;
const rawCredential = 'provider-secret-that-must-not-leak';
const resolverCalls: Array<{ provider: string; principal: typeof principal }> = [];
const fetchCalls: Array<{ url: string; authorization: string | null; signal: AbortSignal | undefined }> = [];

const fetchImpl: ProviderHttpFetch = async (input, init) => {
  fetchCalls.push({
    url: String(input),
    authorization: new Headers(init?.headers).get('authorization'),
    signal: init?.signal,
  });
  return new Response(JSON.stringify({
    account: 'visible-account',
    accessToken: rawCredential,
    nested: { api_key: rawCredential },
    message: `Bearer ${rawCredential}`,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const broker = createPrincipalScopedProviderHttpBroker({
  principal,
  resolveCredential: (provider, resolvedPrincipal) => {
    resolverCalls.push({ provider, principal: resolvedPrincipal });
    return rawCredential;
  },
  allowedOrigins: {
    atlassian: ['https://devdoo.atlassian.net'],
    bitbucket: ['https://api.bitbucket.org'],
  },
  fetchImpl,
});

const success = await broker.fetch('atlassian', {
  url: 'https://devdoo.atlassian.net/api/resource',
  headers: { Accept: 'application/json', 'X-Request-Id': 'request-1' },
});
assert.equal(success.ok, true, 'HTTPS provider request succeeds through the fetch broker');
assert.deepEqual(resolverCalls, [{ provider: 'atlassian', principal }], 'credential resolution is bound to provider and principal');
assert.equal(fetchCalls[0]?.url, 'https://devdoo.atlassian.net/api/resource', 'fetch receives the clean HTTPS provider URL');
assert.equal(fetchCalls[0]?.authorization, `Bearer ${rawCredential}`, 'broker injects resolver credentials internally');
assert.equal(JSON.stringify(success).includes(rawCredential), false, 'resolver credentials and credential-like response values stay out of the result');
if (!success.ok) throw new Error('expected successful provider response');
assert.deepEqual(success.data, {
  account: 'visible-account',
  accessToken: '[REDACTED]',
  nested: { api_key: '[REDACTED]' },
  message: 'Bearer [REDACTED]',
}, 'credential-like response fields are redacted before crossing the broker boundary');
assert.equal(success.contentType, 'application/json', 'JSON response content type is preserved without changing decoded data');

const rawBitbucketBroker = createPrincipalScopedProviderHttpBroker({
  principal,
  resolveCredential: () => rawCredential,
  allowedOrigins: {
    atlassian: ['https://devdoo.atlassian.net'],
    bitbucket: ['https://api.bitbucket.org'],
  },
  fetchImpl: async () => new Response('raw-file-content', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  }),
});
const rawBitbucketFile = await rawBitbucketBroker.fetch('bitbucket', {
  url: 'https://api.bitbucket.org/2.0/repositories/workspace/repository/src/main/file.txt',
});
assert.equal(rawBitbucketFile.ok, true, 'Bitbucket raw file responses succeed through the broker');
if (!rawBitbucketFile.ok) throw new Error('expected raw Bitbucket response');
assert.equal(rawBitbucketFile.data, 'raw-file-content', 'Bitbucket raw file content remains unchanged');
assert.equal(rawBitbucketFile.contentType, 'text/plain; charset=utf-8', 'Bitbucket raw file content type is preserved');

const crossOrigin = await broker.request('atlassian', {
  url: 'https://attacker.example.test/api/resource',
});
assert.equal(crossOrigin.ok, false, 'provider credentials never cross the configured origin boundary');
if (crossOrigin.ok) throw new Error('expected cross-origin provider request rejection');
assert.equal(crossOrigin.error.code, 'invalid-request');

for (const request of [
  { url: 'http://devdoo.atlassian.net/api/resource' },
  { url: 'https://devdoo.atlassian.net/api/resource?access_token=caller-secret' },
  { url: 'https://devdoo.atlassian.net/api/resource', headers: { 'X-Api-Key': 'caller-secret' } },
  { url: 'https://devdoo.atlassian.net/api/resource', headers: { 'X-Token': 'caller-secret' } },
]) {
  const rejected = await broker.request('bitbucket', request);
  assert.equal(rejected.ok, false, 'unsafe provider input fails closed');
  if (rejected.ok) throw new Error('expected unsafe request rejection');
  assert.equal(rejected.error.code, 'invalid-request', 'unsafe provider input has a safe validation error');
}
assert.equal(fetchCalls.length, 1, 'unsafe requests never reach the injected fetch');
assert.equal(resolverCalls.length, 1, 'unsafe requests never resolve credentials');

const missingCredentialFetch: ProviderHttpFetch = async () => {
  throw new Error('missing credentials must not call fetch');
};
const missingCredential = await createPrincipalScopedProviderHttpBroker({
  principal,
  resolveCredential: () => undefined,
  allowedOrigins: {
    atlassian: ['https://devdoo.atlassian.net'],
    bitbucket: ['https://api.bitbucket.org'],
  },
  fetchImpl: missingCredentialFetch,
}).request('atlassian', { url: 'https://devdoo.atlassian.net/api/resource' });
assert.equal(missingCredential.ok, false, 'missing provider credentials fail closed');
if (missingCredential.ok) throw new Error('expected missing credential failure');
assert.equal(missingCredential.error.code, 'credentials-unavailable', 'missing provider credentials use the safe unavailable error');

const statusFetch: ProviderHttpFetch = async (input) => new Response(null, {
  status: String(input).endsWith('/unauthorized') ? 401 : 403,
});
const statusBroker = createPrincipalScopedProviderHttpBroker({
  principal,
  resolveCredential: () => rawCredential,
  allowedOrigins: {
    atlassian: ['https://devdoo.atlassian.net'],
    bitbucket: ['https://api.bitbucket.org'],
  },
  fetchImpl: statusFetch,
});
for (const [path, status] of [['unauthorized', 401], ['forbidden', 403]] as const) {
  const result = await statusBroker.request('atlassian', { url: `https://devdoo.atlassian.net/${path}` });
  assert.equal(result.ok, false, `HTTP ${status} fails closed`);
  if (result.ok) throw new Error(`expected HTTP ${status} failure`);
  assert.deepEqual(result.error, { code: 'credentials-unavailable', status }, `HTTP ${status} maps to safe credentials-unavailable`);
}

const oversizedBroker = createPrincipalScopedProviderHttpBroker({
  principal,
  resolveCredential: () => rawCredential,
  allowedOrigins: {
    atlassian: ['https://devdoo.atlassian.net'],
    bitbucket: ['https://api.bitbucket.org'],
  },
  maxResponseBytes: 8,
  fetchImpl: async () => new Response('response-is-too-large', { status: 200 }),
});
const oversized = await oversizedBroker.request('atlassian', { url: 'https://devdoo.atlassian.net/large' });
assert.equal(oversized.ok, false, 'oversized provider responses fail closed');
if (oversized.ok) throw new Error('expected oversized response failure');
assert.equal(oversized.error.code, 'provider-error', 'oversized provider responses expose no body details');

let timeoutSignal: AbortSignal | undefined;
const timeoutBroker = createPrincipalScopedProviderHttpBroker({
  principal,
  resolveCredential: () => rawCredential,
  allowedOrigins: {
    atlassian: ['https://devdoo.atlassian.net'],
    bitbucket: ['https://api.bitbucket.org'],
  },
  timeoutMs: 15,
  fetchImpl: async (_input, init) => {
    timeoutSignal = init?.signal;
    return new Promise<Response>(() => undefined);
  },
});
const timedOut = await timeoutBroker.request('atlassian', { url: 'https://devdoo.atlassian.net/slow' });
assert.equal(timedOut.ok, false, 'slow provider requests fail closed at the timeout boundary');
if (timedOut.ok) throw new Error('expected timeout failure');
assert.equal(timedOut.error.code, 'provider-error', 'timeouts expose a safe provider error');
assert.equal(timeoutSignal?.aborted, true, 'timeouts abort the injected fetch signal');

let responseBodyCanceled = false;
const responseTimeoutBroker = createPrincipalScopedProviderHttpBroker({
  principal,
  resolveCredential: () => rawCredential,
  allowedOrigins: {
    atlassian: ['https://devdoo.atlassian.net'],
    bitbucket: ['https://api.bitbucket.org'],
  },
  timeoutMs: 15,
  fetchImpl: async () => new Response(new ReadableStream<Uint8Array>({
    cancel() {
      responseBodyCanceled = true;
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } }),
});
const responseTimedOut = await responseTimeoutBroker.request('atlassian', { url: 'https://devdoo.atlassian.net/slow-body' });
assert.equal(responseTimedOut.ok, false, 'slow provider response bodies fail closed at the timeout boundary');
if (responseTimedOut.ok) throw new Error('expected response-body timeout failure');
assert.equal(responseTimedOut.error.code, 'provider-error', 'response-body timeouts expose a safe provider error');
assert.equal(responseBodyCanceled, true, 'response-body timeouts cancel the provider reader');

const forwardedRequestBodies: string[] = [];
const requestBodyBroker = createPrincipalScopedProviderHttpBroker({
  principal,
  resolveCredential: () => rawCredential,
  allowedOrigins: {
    atlassian: ['https://devdoo.atlassian.net'],
    bitbucket: ['https://api.bitbucket.org'],
  },
  maxRequestBytes: 8,
  fetchImpl: async (_input, init) => {
    forwardedRequestBodies.push(await new Response(init?.body).text());
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  },
});
const acceptedBody = await requestBodyBroker.fetch('atlassian', {
  url: 'https://devdoo.atlassian.net/request-body',
  method: 'POST',
  body: 'accepted',
});
assert.equal(acceptedBody.ok, true, 'request bodies at the configured limit are forwarded');
assert.deepEqual(forwardedRequestBodies, ['accepted'], 'accepted request bodies retain their exact content');

const publicStream = new ReadableStream<Uint8Array>({
  start(controller) {
    controller.enqueue(new TextEncoder().encode('stream'));
    controller.enqueue(new TextEncoder().encode('ok'));
    controller.close();
  },
});
const publicStreamResult = await requestBodyBroker.request('atlassian', {
  url: 'https://devdoo.atlassian.net/request-body',
  method: 'POST',
  body: publicStream,
});
assert.equal(publicStreamResult.ok, true, 'public request accepts a bounded streamed body');
assert.deepEqual(forwardedRequestBodies, ['accepted', 'streamok'], 'public request forwards the reusable buffered stream bytes exactly');

const declaredOversized = await requestBodyBroker.fetch('atlassian', {
  url: 'https://devdoo.atlassian.net/request-body',
  method: 'POST',
  headers: { 'content-length': '9' },
  body: 'short',
});
assert.equal(declaredOversized.ok, false, 'declared oversized request bodies fail before provider forwarding');
if (!declaredOversized.ok) assert.equal(declaredOversized.error.code, 'invalid-request');
assert.equal(forwardedRequestBodies.length, 2, 'declared oversized request bodies never reach the provider');

let streamedBodyCanceled = false;
const streamedOversized = await requestBodyBroker.fetch('atlassian', {
  url: 'https://devdoo.atlassian.net/request-body',
  method: 'POST',
  body: new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('1234'));
      controller.enqueue(new TextEncoder().encode('56789'));
    },
    cancel() {
      streamedBodyCanceled = true;
    },
  }) as unknown as Uint8Array,
});
assert.equal(streamedOversized.ok, false, 'streamed oversized request bodies fail before provider forwarding');
if (!streamedOversized.ok) assert.equal(streamedOversized.error.code, 'invalid-request');
assert.equal(streamedBodyCanceled, true, 'oversized streamed bodies are canceled without forwarding');
assert.equal(forwardedRequestBodies.length, 2, 'streamed oversized request bodies never reach the provider');

let canceledBodyReader = false;
const cancellationController = new AbortController();
const canceledRequest = requestBodyBroker.fetch('atlassian', {
  url: 'https://devdoo.atlassian.net/request-body',
  method: 'POST',
  body: new ReadableStream<Uint8Array>({
    cancel() {
      canceledBodyReader = true;
    },
  }) as unknown as Uint8Array,
  signal: cancellationController.signal,
});
queueMicrotask(() => cancellationController.abort());
const canceledRequestResult = await canceledRequest;
assert.equal(canceledRequestResult.ok, false, 'abort signals cancel request body streaming before forwarding');
assert.equal(canceledBodyReader, true, 'aborted request body readers are canceled');
assert.equal(forwardedRequestBodies.length, 2, 'aborted request body streams never reach the provider');

assert.throws(() => createPrincipalScopedProviderHttpBroker({
  principal,
  resolveCredential: () => rawCredential,
  allowedOrigins: {
    atlassian: ['https://attacker.example.test'],
    bitbucket: ['https://api.bitbucket.org'],
  },
}), /origin/);

console.log('PASS: principal-scoped provider HTTP broker injects server credentials, enforces HTTPS and bounded transport, redacts responses, and fails closed');
