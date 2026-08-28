import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import express from 'express';

import {
  createCoreAgentCard,
  type A2AScope,
} from '../src/server/a2a-contract.js';
import { deriveA2AHttpScope } from '../src/server/a2a-http-scope.js';
import { A2AStore } from '../src/server/a2a-store.js';
import { createA2ARouter } from '../src/server/a2a-route.js';

type ResponseSnapshot = { status: number; headers: http.IncomingHttpHeaders; body: string };

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-route-test-'));
const scope: A2AScope = {
  tenantId: 'tenant-a',
  requesterId: 'requester-a',
  conversationId: 'conversation-a',
};
const otherScope: A2AScope = { ...scope, requesterId: 'requester-b' };
const card = createCoreAgentCard({
  agentId: 'teams-core',
  name: 'Teams Core Agent',
  description: 'Deterministic HTTP+JSON task contract.',
  version: '1.0.44',
  endpoint: 'https://core.example.test',
});

const app = express();
const store = new A2AStore(path.join(root, 'store.json'));
await store.initialize();
let submitted = 0;
app.use(createA2ARouter({
  store,
  agentCard: card,
  authenticate: (request, response, next) => {
    if (request.header('x-test-auth') !== 'yes') {
      response.status(401).json({ error: 'auth required' });
      return;
    }
    next();
  },
  resolveScope: (request) => {
    return request.header('x-test-scope') === 'other' ? otherScope : scope;
  },
  onTaskSubmitted: () => { submitted += 1; },
}));
const server = await new Promise<http.Server>((resolve) => {
  const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
});
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

const message = {
  messageId: 'message-a',
  role: 'user' as const,
  contextId: 'context-a',
  parts: [{ text: 'Run a bounded Core task.', mediaType: 'text/plain' as const }],
};

try {
  const cardResponse = await request(baseUrl, 'GET', '/.well-known/agent-card.json');
  assert.equal(cardResponse.status, 200);
  assert.equal(JSON.parse(cardResponse.body).agentId, 'teams-core');

  const unauthorized = await request(baseUrl, 'POST', '/message:send', {
    idempotencyKey: 'idem-a',
    message,
  });
  assert.equal(unauthorized.status, 401);
  const unauthorizedMalformed = await requestRaw(
    baseUrl,
    'POST',
    '/message:send',
    '{not-json',
    { 'content-type': 'application/json' },
  );
  assert.equal(unauthorizedMalformed.status, 401);

  const accepted = await request(baseUrl, 'POST', '/message:send', {
    idempotencyKey: 'idem-a',
    message,
    scope: deriveA2AHttpScope(scope, 'idem-a'),
  }, { 'x-test-auth': 'yes' });
  assert.equal(accepted.status, 202);
  const firstTask = JSON.parse(accepted.body) as { id: string; status: string };
  assert.equal(firstTask.status, 'submitted');
  assert.equal(submitted, 1);

  const duplicate = await request(baseUrl, 'POST', '/message:send', {
    idempotencyKey: 'idem-a',
    message,
  }, { 'x-test-auth': 'yes' });
  assert.equal(duplicate.status, 202);
  assert.equal(JSON.parse(duplicate.body).id, firstTask.id);
  assert.equal(submitted, 1);

  const conflict = await request(baseUrl, 'POST', '/message:send', {
    idempotencyKey: 'idem-a',
    message: { ...message, parts: [{ text: 'different', mediaType: 'text/plain' }] },
  }, { 'x-test-auth': 'yes' });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.includes('"text":"different"'), false);

  const listed = await request(baseUrl, 'GET', '/tasks?limit=10', undefined, { 'x-test-auth': 'yes' });
  assert.equal(listed.status, 200);
  assert.equal(JSON.parse(listed.body).tasks[0].id, firstTask.id);

  const fetched = await request(baseUrl, 'GET', `/tasks/${firstTask.id}`, undefined, { 'x-test-auth': 'yes' });
  assert.equal(fetched.status, 200);
  assert.equal(JSON.parse(fetched.body).scope.requesterId, scope.requesterId);

  const crossScope = await request(baseUrl, 'GET', `/tasks/${firstTask.id}`, undefined, { 'x-test-auth': 'yes', 'x-test-scope': 'other' });
  assert.equal(crossScope.status, 404);

  const canceled = await request(baseUrl, 'POST', `/tasks/${firstTask.id}:cancel`, {}, { 'x-test-auth': 'yes' });
  assert.equal(canceled.status, 200);
  assert.equal(JSON.parse(canceled.body).status, 'canceled');

  const unsupported = await request(baseUrl, 'POST', '/message:send', {
    idempotencyKey: 'idem-stream',
    message: { ...message, messageId: 'message-stream' },
    stream: true,
  }, { 'x-test-auth': 'yes' });
  assert.equal(unsupported.status, 501);

  const graphLimit = await request(baseUrl, 'POST', '/message:send', {
    idempotencyKey: 'idem-graph-limit',
    message: { ...message, messageId: 'message-graph-limit' },
    depth: 9,
    fanOutIndex: 0,
  }, { 'x-test-auth': 'yes' });
  assert.equal(graphLimit.status, 400);
  assert.equal(JSON.parse(graphLimit.body).error.code, 'GraphLimitExceededError');

  const invalidJson = await requestRaw(baseUrl, 'POST', '/message:send', '{not-json', { 'x-test-auth': 'yes', 'content-type': 'application/json' });
  assert.equal(invalidJson.status, 400);
  assert.equal(invalidJson.body.includes('not-json'), false);

  const secretError = await request(baseUrl, 'POST', '/message:send', {
    idempotencyKey: 'idem-secret',
    message: { ...message, messageId: 'message-secret', metadata: { token: 'do-not-leak' } },
  }, { 'x-test-auth': 'yes' });
  assert.equal(secretError.status, 400);
  assert.equal(secretError.body.includes('do-not-leak'), false);

  console.log('a2a-route-test: PASS');
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await fs.rm(root, { recursive: true, force: true });
}

async function request(
  baseUrl: string,
  method: string,
  route: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ResponseSnapshot> {
  return requestRaw(baseUrl, method, route, body === undefined ? undefined : JSON.stringify(body), {
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    ...headers,
  });
}

async function requestRaw(
  baseUrl: string,
  method: string,
  route: string,
  body?: string,
  headers: Record<string, string> = {},
): Promise<ResponseSnapshot> {
  const url = new URL(route, baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-length': Buffer.byteLength(body) }),
        ...headers,
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.setTimeout(5_000, () => request.destroy(new Error('request timeout')));
    request.on('error', reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}
