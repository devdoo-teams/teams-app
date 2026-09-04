import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import express from 'express';

import type { A2AScope } from '../src/server/a2a-contract.js';
import { createA2AProductionRuntime } from '../src/server/a2a-production-runtime.js';
import { A2ARemoteClientError, createA2ARemoteClient } from '../src/server/a2a-remote-client.js';
import { A2AStore } from '../src/server/a2a-store.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-remote-http-'));
const scopeA: A2AScope = {
  tenantId: 'tenant-agent-a',
  requesterId: 'requester-agent-a',
  conversationId: 'conversation-agent-a',
};
const scopeB: A2AScope = {
  tenantId: 'tenant-agent-b',
  requesterId: 'requester-agent-b',
  conversationId: 'conversation-agent-b',
};
const tokenA = 'agent-a-test-token';
const tokenB = 'agent-b-test-token';
const storeA = new A2AStore(path.join(root, 'agent-a.json'));
const storeB = new A2AStore(path.join(root, 'agent-b.json'));
await Promise.all([storeA.initialize(), storeB.initialize()]);

const authenticated = (token: string) => (request: express.Request, response: express.Response, next: express.NextFunction) => {
  if (request.header('authorization') !== `Bearer ${token}`) {
    response.status(401).json({ error: 'authentication required' });
    return;
  }
  next();
};

const scopeFor = (token: string, scope: A2AScope) => (request: express.Request) => (
  request.header('authorization') === `Bearer ${token}` ? scope : undefined
);

const appB = express();
const bSubmitted: string[] = [];
const runtimeB = createA2AProductionRuntime({
  publicOrigin: 'https://agent-b.example.test',
  appVersion: '1.0.76-agent-b',
  store: storeB,
  authenticate: authenticated(tokenB),
  resolveScope: scopeFor(tokenB, scopeB),
  v026Execution: {
    submit: async ({ task }) => {
      bSubmitted.push(task.id);
      await storeB.transitionTask(task.id, task.scope, 'working');
    },
    cancel: ({ task }) => storeB.cancelTask(task.id, task.scope),
  },
  legacyOnTaskSubmitted: () => undefined,
  legacyOnTaskCancel: ({ task }) => storeB.cancelTask(task.id, task.scope),
  coreA2A: {
    executeChild: async () => ({ taskId: 'agent-b-child', status: 'completed', result: 'fixture child result' }),
  },
});
runtimeB.mount(appB);

let bServer: http.Server | undefined;
let aServer: http.Server | undefined;
try {
  bServer = await listen(appB);
  const bAddress = bServer.address();
  assert.ok(bAddress && typeof bAddress === 'object');
  const bPort = bAddress.port;

const mappedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const requested = new URL(String(input));
  assert.equal(requested.hostname, 'agent-b.example.test', 'fixture fetch must target the declared remote identity');
  const transportResponse = await fetch(`http://127.0.0.1:${bPort}${requested.pathname}${requested.search}`, init);
  const logicalResponse = new Response(transportResponse.body, {
    status: transportResponse.status,
    statusText: transportResponse.statusText,
    headers: transportResponse.headers,
  });
  Object.defineProperty(logicalResponse, 'url', { value: requested.toString() });
  return logicalResponse;
};

const remoteClient = await createA2ARemoteClient('https://agent-b.example.test', {
  fetch: mappedFetch,
  bearerTokenProvider: () => tokenB,
  requestTimeoutMs: 1_000,
});

const appA = express();
const runtimeA = createA2AProductionRuntime({
  publicOrigin: 'https://agent-a.example.test',
  appVersion: '1.0.76-agent-a',
  store: storeA,
  authenticate: authenticated(tokenA),
  resolveScope: scopeFor(tokenA, scopeA),
  v026Execution: {
    submit: () => undefined,
    cancel: ({ task }) => storeA.cancelTask(task.id, task.scope),
  },
  legacyOnTaskSubmitted: () => undefined,
  legacyOnTaskCancel: ({ task }) => storeA.cancelTask(task.id, task.scope),
  coreA2A: {
    executeChild: async () => ({ taskId: 'agent-a-child', status: 'completed', result: 'fixture child result' }),
  },
});
runtimeA.mount(appA);
appA.get('/probe', async (_request, response) => {
  try {
    const sent = await remoteClient.sendMessage({
      messageId: 'remote-http-message-1',
      parts: [{ text: 'Run the remote fixture task.' }],
    });
    const taskId = String(sent.id);
    const beforeCancel = await remoteClient.getTask(taskId);
    const listed = await remoteClient.listTasks({ pageSize: 10 });
    const canceled = await remoteClient.cancelTask(taskId);
    const afterCancel = await remoteClient.getTask(taskId);
    response.json({
      remoteCard: remoteClient.card,
      sent,
      beforeCancel,
      listed,
      canceled,
      afterCancel,
    });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

  aServer = await listen(appA);
  const aAddress = aServer.address();
assert.ok(aAddress && typeof aAddress === 'object');

  const probe = await getJson(`http://127.0.0.1:${aAddress.port}/probe`);
  assert.equal(probe.status, 200, probe.body);
  const body = JSON.parse(probe.body) as Record<string, any>;
  assert.equal(body.remoteCard.version, '1.0.76-agent-b');
  assert.equal(body.remoteCard.supportedInterfaces[0].url, 'https://agent-b.example.test/a2a/v1');
  // A2A message/send returns the current task state after processing the
  // message. This fixture's submit hook transitions synchronously, so the
  // response must expose WORKING rather than the earlier SUBMITTED snapshot.
  assert.equal(body.sent.status.state, 'TASK_STATE_WORKING');
  assert.equal(body.beforeCancel.status.state, 'TASK_STATE_WORKING');
  assert.equal(body.listed.totalSize, 1);
  assert.equal(body.listed.tasks[0].status.state, 'TASK_STATE_WORKING');
  assert.equal(body.canceled.status.state, 'TASK_STATE_CANCELED');
  assert.equal(body.afterCancel.status.state, 'TASK_STATE_CANCELED');
  assert.deepEqual(bSubmitted, [body.sent.id]);

  const unauthorizedClient = await createA2ARemoteClient('https://agent-b.example.test', {
    fetch: mappedFetch,
    bearerTokenProvider: () => 'wrong-token',
    requestTimeoutMs: 1_000,
  });
  await assert.rejects(
    () => unauthorizedClient.sendMessage({ messageId: 'remote-http-unauthorized', parts: [{ text: 'must reject' }] }),
    (error: unknown) => error instanceof A2ARemoteClientError && error.code === 'AUTHENTICATION_FAILED',
  );

  console.log('PASS: two independent HTTP A2A servers complete authenticated Agent Card, Send/Get/List/Cancel, and rejection round trips');
} finally {
  if (aServer) await close(aServer);
  if (bServer) await close(bServer);
  await fs.rm(root, { recursive: true, force: true });
}

async function listen(app: express.Express): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

async function close(server: http.Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function getJson(url: string): Promise<{ status: number; body: string }> {
  const response = await fetch(url);
  return { status: response.status, body: await response.text() };
}
