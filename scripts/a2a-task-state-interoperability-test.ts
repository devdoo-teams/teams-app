import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import express from 'express';

import type { A2AScope, A2ATaskStatus } from '../src/server/a2a-contract.js';
import { createA2AV1JsonRpcRouter } from '../src/server/a2a-jsonrpc-route.js';
import { A2AStore } from '../src/server/a2a-store.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-task-states-'));
const scope: A2AScope = {
  tenantId: 'tenant-task-states',
  requesterId: 'requester-task-states',
  conversationId: 'conversation-task-states',
};
const store = new A2AStore(path.join(root, 'store.json'));
await store.initialize();

const authTask = await store.createOrGetTask({
  scope,
  contextId: 'context-auth-required',
  idempotencyKey: 'message-auth-required',
  fingerprint: 'fingerprint-auth-required',
  message: {
    messageId: 'message-auth-required',
    role: 'user',
    parts: [{ text: 'Continue after authentication.' }],
  },
});
await store.transitionTask(authTask.id, scope, {
  status: 'auth-required' as A2ATaskStatus,
  artifacts: undefined,
  error: 'Authentication is required before this task can continue.',
});

const rejectedTask = await store.createOrGetTask({
  scope,
  contextId: 'context-rejected',
  idempotencyKey: 'message-rejected',
  fingerprint: 'fingerprint-rejected',
  message: {
    messageId: 'message-rejected',
    role: 'user',
    parts: [{ text: 'This request may be rejected.' }],
  },
});
await store.transitionTask(rejectedTask.id, scope, {
  status: 'rejected' as A2ATaskStatus,
  artifacts: undefined,
  error: 'The agent rejected this task.',
});

const app = express();
app.use('/a2a/v1', createA2AV1JsonRpcRouter({
  store,
  authenticate: (_request, _response, next) => next(),
  resolveScope: () => scope,
  execution: {
    submit: () => undefined,
    cancel: async ({ task }) => store.cancelTask(task.id, task.scope),
  },
}));
const server = await new Promise<http.Server>((resolve) => {
  const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
});
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  for (const [id, expectedState] of [
    [authTask.id, 'TASK_STATE_AUTH_REQUIRED'],
    [rejectedTask.id, 'TASK_STATE_REJECTED'],
  ] as const) {
    const response = await postJson(baseUrl, {
      jsonrpc: '2.0',
      id: `get-${expectedState}`,
      method: 'GetTask',
      params: { id },
    });
    const body = JSON.parse(response.body) as {
      result?: {
        status?: {
          state?: string;
          message?: { role?: string; parts?: Array<{ text?: string }> };
        };
      };
      error?: unknown;
    };
    assert.equal(response.status, 200, response.body);
    assert.equal(body.error, undefined, response.body);
    assert.equal(body.result?.status?.state, expectedState, response.body);
    assert.equal(body.result?.status?.message?.role, 'ROLE_AGENT', response.body);
    assert.ok(body.result?.status?.message?.parts?.[0]?.text, response.body);
  }
  console.log('a2a-task-state-interoperability-test: PASS');
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
