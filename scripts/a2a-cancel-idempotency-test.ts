import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import express from 'express';

import type { A2AScope } from '../src/server/a2a-contract.js';
import { createA2AV1JsonRpcRouter } from '../src/server/a2a-jsonrpc-route.js';
import { A2AStore } from '../src/server/a2a-store.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-cancel-idempotency-'));
const scope: A2AScope = {
  tenantId: 'tenant-cancel-idempotency',
  requesterId: 'requester-cancel-idempotency',
  conversationId: 'conversation-cancel-idempotency',
};
const store = new A2AStore(path.join(root, 'store.json'));
await store.initialize();
const task = await store.createOrGetTask({
  scope,
  contextId: 'context-cancel-idempotency',
  idempotencyKey: 'message-cancel-idempotency',
  fingerprint: 'fingerprint-cancel-idempotency',
  message: {
    messageId: 'message-cancel-idempotency',
    role: 'user',
    parts: [{ text: 'Cancel this task.' }],
  },
});
await store.transitionTask(task.id, scope, 'working');

let cancellationCalls = 0;
const app = express();
app.use('/a2a/v1', createA2AV1JsonRpcRouter({
  store,
  authenticate: (_request, _response, next) => next(),
  resolveScope: () => scope,
  execution: {
    submit: () => undefined,
    cancel: async ({ task: cancellable }) => {
      cancellationCalls += 1;
      return store.cancelTask(cancellable.id, cancellable.scope);
    },
  },
}));
const server = await new Promise<http.Server>((resolve) => {
  const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
});
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const request = {
    jsonrpc: '2.0',
    id: 'cancel-task',
    method: 'CancelTask',
    params: { id: task.id },
  };
  const first = await postJson(baseUrl, request);
  const firstBody = JSON.parse(first.body) as { result?: { status?: { state?: string } }; error?: unknown };
  assert.equal(first.status, 200, first.body);
  assert.equal(firstBody.error, undefined, first.body);
  assert.equal(firstBody.result?.status?.state, 'TASK_STATE_CANCELED', first.body);

  const duplicate = await postJson(baseUrl, request);
  const duplicateBody = JSON.parse(duplicate.body) as {
    result?: { id?: string; status?: { state?: string } };
    error?: unknown;
  };
  assert.equal(duplicate.status, 200, duplicate.body);
  assert.equal(duplicateBody.error, undefined, duplicate.body);
  assert.equal(duplicateBody.result?.id, task.id, duplicate.body);
  assert.equal(duplicateBody.result?.status?.state, 'TASK_STATE_CANCELED', duplicate.body);
  assert.equal(cancellationCalls, 1, 'duplicate cancellation must not invoke provider cancellation twice');

  console.log('a2a-cancel-idempotency-test: PASS');
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await fs.rm(root, { recursive: true, force: true });
}

async function postJson(baseUrl: string, body: unknown): Promise<{ status: number; body: string }> {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request(new URL('/a2a/v1', baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'a2a-version': '1.0',
        'content-length': Buffer.byteLength(payload),
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.on('error', reject);
    request.end(payload);
  });
}
