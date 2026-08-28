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
import { createA2ARouter } from '../src/server/a2a-route.js';
import { A2AStore } from '../src/server/a2a-store.js';
import { deriveA2AHttpScope } from '../src/server/a2a-http-scope.js';

type ResponseSnapshot = { status: number; body: string };

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-http-scope-test-'));
const authenticatedScope: A2AScope = {
  tenantId: 'tenant-a',
  requesterId: 'requester-a',
  conversationId: 'teams-chat-a',
};
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
app.use(createA2ARouter({
  store,
  agentCard: card,
  resolveScope: () => authenticatedScope,
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
  const accepted = await request(baseUrl, 'POST', '/message:send', {
    idempotencyKey: 'idem-a',
    message,
  });
  assert.equal(accepted.status, 202);
  const acceptedTask = JSON.parse(accepted.body) as { id: string; scope: A2AScope };
  const derivedScope = deriveA2AHttpScope(authenticatedScope, 'idem-a');
  assert.notEqual(derivedScope.conversationId, authenticatedScope.conversationId);
  assert.deepEqual(acceptedTask.scope, derivedScope);
  assert.deepEqual(store.getTask(acceptedTask.id, derivedScope)?.scope, derivedScope);

  const headerMismatch = await request(baseUrl, 'POST', '/message:send', {
    idempotencyKey: 'idem-b',
    message: { ...message, messageId: 'message-b' },
  }, {
    'x-conversation-id': 'caller-controlled-conversation',
  });
  assert.equal(headerMismatch.status, 400);
  assert.equal(headerMismatch.body.includes('caller-controlled-conversation'), false);

  const bodyMismatch = await request(baseUrl, 'POST', '/message:send', {
    idempotencyKey: 'idem-c',
    message: { ...message, messageId: 'message-c' },
    scope: {
      tenantId: authenticatedScope.tenantId,
      requesterId: authenticatedScope.requesterId,
      conversationId: 'client-conversation',
    },
  });
  assert.equal(bodyMismatch.status, 400);
  assert.equal(bodyMismatch.body.includes('client-conversation'), false);

  console.log('a2a-http-scope-test: PASS');
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
  const url = new URL(route, baseUrl);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method,
      headers: {
        ...(payload === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }),
        ...headers,
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.setTimeout(5_000, () => request.destroy(new Error('request timeout')));
    request.on('error', reject);
    if (payload !== undefined) request.write(payload);
    request.end();
  });
}
