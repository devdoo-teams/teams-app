import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import express from 'express';

import type { A2AScope } from '../src/server/a2a-contract.js';
import { createA2AAgentAuthorizationPolicy } from '../src/server/a2a-agent-authorization.js';
import { createA2AProductionRuntime } from '../src/server/a2a-production-runtime.js';
import { A2AStore } from '../src/server/a2a-store.js';

type ResponseSnapshot = { status: number; body: string };

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-orchestration-identity-'));
const scope: A2AScope = {
  tenantId: 'tenant-a',
  requesterId: 'requester-a',
  conversationId: 'conversation-a',
};
const store = new A2AStore(path.join(root, 'store.json'));
await store.initialize();
const parent = await store.createOrGetTask({
  scope,
  contextId: 'context-parent',
  idempotencyKey: 'parent-orchestration-identity',
  fingerprint: 'parent-orchestration-identity-fingerprint',
  message: {
    messageId: 'message-parent-orchestration-identity',
    role: 'user',
    parts: [{ text: 'Run an independently identified child.' }],
  },
});

const app = express();
const runtime = createA2AProductionRuntime({
  publicOrigin: 'https://runtime.example.test',
  appVersion: '1.0.0-test',
  store,
  authenticate: (_request, _response, next) => next(),
  resolveScope: () => scope,
  v026Execution: {
    submit: () => undefined,
    cancel: async ({ task }) => store.cancelTask(task.id, task.scope),
  },
  legacyOnTaskSubmitted: () => undefined,
  legacyOnTaskCancel: async ({ task }) => store.cancelTask(task.id, task.scope),
  coreA2A: {
    agents: [{
      agentId: 'codex-reviewer',
      providerId: 'codex-cli',
      authorizationPolicy: createA2AAgentAuthorizationPolicy({
        grants: [{
          ...scope,
          agentId: 'codex-reviewer',
          roles: ['reviewer'],
          capabilities: ['source.read'],
        }],
      }),
      authorize: () => true,
      executeChild: async () => ({
        taskId: 'codex-child-job',
        status: 'completed' as const,
        result: 'codex review result',
      }),
    }],
  },
});
runtime.mount(app);

const server = await new Promise<http.Server>((resolve) => {
  const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
});
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const response = await request(baseUrl, {
    parentTaskId: parent.id,
    requests: [{
      key: 'review',
      role: 'reviewer',
      capabilities: ['source.read'],
      prompt: 'Review the bounded change.',
      agentId: 'codex-reviewer',
    }],
    deadlineMs: 1_000,
    parallelism: 1,
  });
  assert.equal(response.status, 200, response.body);
  const body = JSON.parse(response.body) as {
    childResults: Array<{ agentId?: string; providerId?: string }>;
  };
  assert.equal(body.childResults[0]?.agentId, 'codex-reviewer');
  assert.equal(body.childResults[0]?.providerId, 'codex-cli');
  console.log('a2a-orchestration-identity-test: PASS');
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await fs.rm(root, { recursive: true, force: true });
}

async function request(baseUrl: string, body: unknown): Promise<ResponseSnapshot> {
  const payload = JSON.stringify(body);
  const url = new URL('/a2a/orchestrate', baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
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
