import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';

import express from 'express';

import type { A2AScope } from '../src/server/a2a-contract.js';
import { createA2AV1JsonRpcRouter } from '../src/server/a2a-jsonrpc-route.js';
import { A2AStore } from '../src/server/a2a-store.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-v1-list-tasks-'));
const store = new A2AStore(path.join(root, 'store.json'));
const scope: A2AScope = {
  tenantId: 'tenant-list',
  requesterId: 'requester-list',
  conversationId: 'conversation-list',
};
await store.initialize();

const task = await store.createOrGetTask({
  scope,
  contextId: 'context-list',
  idempotencyKey: 'message-list',
  fingerprint: 'fingerprint-list',
  message: {
    messageId: 'message-list',
    role: 'user',
    parts: [{ text: 'List the task.' }],
  },
});
await store.transitionTask(task.id, scope, 'working');
const artifactText = 'sensitive artifact body';
const artifactSha256 = crypto.createHash('sha256').update(artifactText, 'utf8').digest('hex');
await store.transitionTask(task.id, scope, {
  status: 'completed',
  artifacts: [{
    artifactId: 'artifact-list',
    taskId: task.id,
    sourceTaskId: task.id,
    sha256: artifactSha256,
    byteSize: Buffer.byteLength(artifactText, 'utf8'),
    mediaType: 'text/plain',
    name: 'result.txt',
    scope,
    content: { mediaType: 'text/plain', text: artifactText },
  }],
  error: undefined,
});

const app = express();
app.use('/a2a/v1', createA2AV1JsonRpcRouter({
  store,
  authenticate: (_request, _response, next) => next(),
  resolveScope: () => scope,
  execution: {
    submit: () => undefined,
    cancel: async ({ task: submittedTask }) => store.cancelTask(submittedTask.id, submittedTask.scope),
  },
}));
const server = await new Promise<http.Server>((resolve) => {
  const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
});
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const withoutArtifacts = await postJson(baseUrl, {
    jsonrpc: '2.0',
    id: 'list-default',
    method: 'ListTasks',
    params: {},
  });
  assert.equal(withoutArtifacts.status, 200, withoutArtifacts.body);
  const defaultTask = (JSON.parse(withoutArtifacts.body) as { result: { tasks: Array<Record<string, unknown>> } }).result.tasks
    .find((entry) => entry.id === task.id);
  assert.ok(defaultTask);
  assert.equal(defaultTask.artifacts, undefined, 'ListTasks must omit artifacts by default.');

  const withArtifacts = await postJson(baseUrl, {
    jsonrpc: '2.0',
    id: 'list-with-artifacts',
    method: 'ListTasks',
    params: { includeArtifacts: true },
  });
  assert.equal(withArtifacts.status, 200, withArtifacts.body);
  const artifactTask = (JSON.parse(withArtifacts.body) as { result: { tasks: Array<Record<string, unknown>> } }).result.tasks
    .find((entry) => entry.id === task.id);
  assert.deepEqual(artifactTask?.artifacts, [{
    artifactId: 'artifact-list',
    name: 'result.txt',
    parts: [{ text: artifactText, mediaType: 'text/plain' }],
  }]);

  console.log('a2a-v1-list-tasks-test: PASS');
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await fs.rm(root, { recursive: true, force: true });
}

async function postJson(baseUrl: string, body: unknown): Promise<{ status: number; body: string }> {
  const url = new URL('/a2a/v1', baseUrl);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
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
