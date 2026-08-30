import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import express from 'express';

import { mountA2AProductionRuntime } from '../src/server/a2a-production-runtime.js';
import { A2AStore } from '../src/server/a2a-store.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-production-runtime-'));
const store = new A2AStore(path.join(root, 'a2a.json'));
await store.initialize();
const scope = { tenantId: 'tenant-a', requesterId: 'requester-a', conversationId: 'conversation-a' };
const authenticatedScope = { tenantId: 'tenant-a', requesterId: 'requester-a', conversationId: 'a2a-http' };
let submitted = 0;
const observedChildren = [];
const observedAudits = [];
let markCancelledChildStarted;
const cancelledChildStarted = new Promise((resolve) => { markCancelledChildStarted = resolve; });
const authenticate = (request, response, next) => {
  if (request.header('x-test-auth') !== 'yes') {
    response.status(401).json({ error: 'auth required' });
    return;
  }
  next();
};
const options = {
  publicOrigin: 'https://runtime.example.test',
  appVersion: '1.0.46',
  configuredApplicationIdUri: 'api://runtime.example.test/botid-32127cdd-f19d-4fce-95c9-431e27cca739',
  configuredTenantId: 'tenant-a',
  store,
  authenticate,
  resolveScope: (request) => request.header('x-test-scope') === 'other'
    ? { ...authenticatedScope, requesterId: 'requester-b' }
    : authenticatedScope,
  v026Execution: {
    submit: () => { submitted += 1; },
    cancel: async ({ task }) => store.cancelTask(task.id, task.scope),
  },
  legacyOnTaskSubmitted: () => {},
  legacyOnTaskCancel: async ({ task, authenticatedScope }) => {
    const cancelled = await runtime?.cancelDispatch({ task, authenticatedScope });
    return cancelled ?? store.cancelTask(task.id, task.scope);
  },
  coreA2A: {
    onDispatchAudit: (audit) => { observedAudits.push(audit); },
    executeChild: async (input) => {
      observedChildren.push(input);
      if (input.childKey === 'cancelled') {
        markCancelledChildStarted();
        await new Promise((resolve) => input.signal.addEventListener('abort', resolve, { once: true }));
        return { taskId: 'child-cancelled', status: 'canceled', error: 'parent cancelled' };
      }
      return {
        taskId: input.childKey === 'review' ? 'child-review' : 'child-tests',
        status: 'completed',
        result: `${input.childKey} result`,
      };
    },
  },
};
const app = express();
let runtime;
runtime = mountA2AProductionRuntime(app, options);
const server = await new Promise((resolve) => {
  const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
});
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const cardResponse = await request(baseUrl, '/.well-known/agent.json', 'GET');
  assert.equal(cardResponse.status, 200);
  const card = JSON.parse(cardResponse.body);
  assert.equal(card.protocolVersion, '0.2.6');
  assert.deepEqual(card.defaultOutputModes, ['text/plain']);
  assert.deepEqual(card.security, [{ teamsOAuth: ['api://runtime.example.test/botid-32127cdd-f19d-4fce-95c9-431e27cca739/access_as_user'] }]);
  assert.deepEqual(runtime.v026AgentCard, card, 'mounted Agent Card must be the card returned by the runtime composition');

  const officialCardResponse = await request(baseUrl, '/.well-known/agent-card.json', 'GET');
  assert.equal(officialCardResponse.status, 200);
  const officialCard = JSON.parse(officialCardResponse.body);
  assert.equal(officialCard.agentId, undefined, 'latest Agent Card must not expose the internal agentId extension');
  assert.equal(officialCard.version, '1.0.46');
  assert.equal(officialCard.supportedInterfaces[0].protocolBinding, 'JSONRPC');
  assert.equal(officialCard.supportedInterfaces[0].protocolVersion, '1.0');
  assert.equal(officialCard.supportedInterfaces[0].url, 'https://runtime.example.test/a2a/v1');
  assert.deepEqual(runtime.officialAgentCard, officialCard, 'mounted latest Agent Card must be the card returned by runtime composition');

  const unauthorized = await request(baseUrl, '/a2a/v026', 'POST', {
    jsonrpc: '2.0',
    id: 'unauthorized',
    method: 'message/send',
    params: { message: { kind: 'message', messageId: 'message-unauthorized', role: 'user', parts: [{ kind: 'text', text: 'Run a bounded task.' }] } },
  });
  assert.equal(unauthorized.status, 401);

  const unauthorizedOrchestration = await request(baseUrl, '/a2a/orchestrate', 'POST', {
    parentTaskId: 'missing-parent',
    requests: [{ key: 'review', role: 'reviewer', capabilities: ['source.read'], prompt: 'Review the bounded Core changes.' }],
    deadlineMs: 1_000,
    parallelism: 1,
  });
  assert.equal(unauthorizedOrchestration.status, 401);

  const authorized = await request(baseUrl, '/a2a/v026', 'POST', {
    jsonrpc: '2.0',
    id: 'authorized',
    method: 'message/send',
    params: { message: { kind: 'message', messageId: 'message-authorized', role: 'user', parts: [{ kind: 'text', text: 'Run a bounded task.' }] } },
  }, { 'x-test-auth': 'yes' });
  assert.equal(authorized.status, 200);
  assert.equal(JSON.parse(authorized.body).result.status.state, 'submitted');
  assert.equal(submitted, 1);

  const missingVersion = await request(baseUrl, '/a2a/v1', 'POST', {
    jsonrpc: '2.0',
    id: 'missing-version',
    method: 'SendMessage',
    params: { message: { messageId: 'message-missing-version', role: 'ROLE_USER', parts: [{ text: 'Run a bounded task.' }] } },
  }, { 'x-test-auth': 'yes' });
  assert.equal(missingVersion.status, 200);
  assert.equal(JSON.parse(missingVersion.body).error.code, -32007);

  const v1Send = await request(baseUrl, '/a2a/v1', 'POST', {
    jsonrpc: '2.0',
    id: 'v1-send',
    method: 'SendMessage',
    params: { message: { messageId: 'message-v1', role: 'ROLE_USER', parts: [{ text: 'Run a bounded v1 task.' }] } },
  }, { 'x-test-auth': 'yes', 'a2a-version': '1.0' });
  assert.equal(v1Send.status, 200);
  const v1SendBody = JSON.parse(v1Send.body);
  assert.equal(v1SendBody.result.task.status.state, 'TASK_STATE_SUBMITTED');
  assert.equal(v1SendBody.result.task.kind, undefined);
  assert.equal(submitted, 2);

  const v1TaskId = v1SendBody.result.task.id;
  const v1Get = await request(baseUrl, '/a2a/v1', 'POST', {
    jsonrpc: '2.0',
    id: 'v1-get',
    method: 'GetTask',
    params: { id: v1TaskId, historyLength: 0 },
  }, { 'x-test-auth': 'yes', 'a2a-version': '1.0' });
  assert.equal(v1Get.status, 200);
  assert.equal(JSON.parse(v1Get.body).result.status.state, 'TASK_STATE_SUBMITTED');

  const v1List = await request(baseUrl, '/a2a/v1', 'POST', {
    jsonrpc: '2.0',
    id: 'v1-list',
    method: 'ListTasks',
    params: { pageSize: 1 },
  }, { 'x-test-auth': 'yes', 'a2a-version': '1.0' });
  assert.equal(v1List.status, 200, v1List.body);
  const v1ListResult = JSON.parse(v1List.body).result;
  assert.equal(v1ListResult.tasks.length, 1);
  assert.equal(v1ListResult.totalSize, 2);
  assert.equal(typeof v1ListResult.nextPageToken, 'string');
  assert.notEqual(v1ListResult.nextPageToken, '');

  const v1ListNext = await request(baseUrl, '/a2a/v1', 'POST', {
    jsonrpc: '2.0',
    id: 'v1-list-next',
    method: 'ListTasks',
    params: { pageSize: 1, pageToken: v1ListResult.nextPageToken },
  }, { 'x-test-auth': 'yes', 'a2a-version': '1.0' });
  assert.equal(v1ListNext.status, 200, v1ListNext.body);
  const v1ListNextResult = JSON.parse(v1ListNext.body).result;
  assert.equal(v1ListNextResult.tasks.length, 1);
  assert.equal(v1ListNextResult.totalSize, 2);
  assert.equal(v1ListNextResult.nextPageToken, '');
  assert.equal(
    new Set([...v1ListResult.tasks, ...v1ListNextResult.tasks].map((task) => task.id)).size,
    2,
  );
  assert.equal(
    [...v1ListResult.tasks, ...v1ListNextResult.tasks].some((task) => task.id === v1TaskId),
    true,
  );

  const v1Cancel = await request(baseUrl, '/a2a/v1', 'POST', {
    jsonrpc: '2.0',
    id: 'v1-cancel',
    method: 'CancelTask',
    params: { id: v1TaskId },
  }, { 'x-test-auth': 'yes', 'a2a-version': '1.0' });
  assert.equal(v1Cancel.status, 200);
  assert.equal(JSON.parse(v1Cancel.body).result.status.state, 'TASK_STATE_CANCELED');

  const canceledList = await request(baseUrl, '/a2a/v1', 'POST', {
    jsonrpc: '2.0',
    id: 'v1-list-canceled',
    method: 'ListTasks',
    params: { status: 'TASK_STATE_CANCELED' },
  }, { 'x-test-auth': 'yes', 'a2a-version': '1.0' });
  assert.equal(canceledList.status, 200, canceledList.body);
  const canceledListResult = JSON.parse(canceledList.body).result;
  assert.equal(canceledListResult.totalSize, 1);
  assert.deepEqual(canceledListResult.tasks.map((task) => task.id), [v1TaskId]);

  const emptyList = await request(baseUrl, '/a2a/v1', 'POST', {
    jsonrpc: '2.0',
    id: 'v1-list-empty',
    method: 'ListTasks',
    params: { contextId: 'missing-context' },
  }, { 'x-test-auth': 'yes', 'a2a-version': '1.0' });
  assert.equal(emptyList.status, 200, emptyList.body);
  const emptyListResult = JSON.parse(emptyList.body).result;
  assert.equal(emptyListResult.totalSize, 0);
  assert.deepEqual(emptyListResult.tasks, []);

  const scalarDataSend = await request(baseUrl, '/a2a/v1', 'POST', {
    jsonrpc: '2.0',
    id: 'v1-send-scalar-data',
    method: 'SendMessage',
    params: {
      message: {
        messageId: 'message-v1-scalar-data',
        role: 'ROLE_USER',
        parts: [{ data: 'hello', mediaType: 'application/json' }],
      },
    },
  }, { 'x-test-auth': 'yes', 'a2a-version': '1.0' });
  assert.equal(scalarDataSend.status, 200, scalarDataSend.body);
  const scalarDataBody = JSON.parse(scalarDataSend.body);
  assert.equal(scalarDataBody.error, undefined, scalarDataSend.body);
  assert.equal(scalarDataBody.result.task.status.state, 'TASK_STATE_SUBMITTED');

  const nullDataSend = await request(baseUrl, '/a2a/v1', 'POST', {
    jsonrpc: '2.0',
    id: 'v1-send-null-data',
    method: 'SendMessage',
    params: {
      message: {
        messageId: 'message-v1-null-data',
        role: 'ROLE_USER',
        parts: [{ data: null, mediaType: 'application/json' }],
      },
    },
  }, { 'x-test-auth': 'yes', 'a2a-version': '1.0' });
  assert.equal(nullDataSend.status, 200, nullDataSend.body);
  const nullDataBody = JSON.parse(nullDataSend.body);
  assert.equal(nullDataBody.error, undefined, nullDataSend.body);
  assert.equal(nullDataBody.result.task.status.state, 'TASK_STATE_SUBMITTED');
  assert.equal(submitted, 4);

  const parent = await store.createOrGetTask({
    scope,
    contextId: 'parent-context',
    idempotencyKey: 'parent-dispatch',
    fingerprint: 'parent-dispatch-fingerprint',
    message: { messageId: 'parent-message', role: 'user', parts: [{ text: 'Run children.' }] },
  });
  const dispatchResponse = await request(baseUrl, '/a2a/orchestrate', 'POST', {
    parentTaskId: parent.id,
    requests: [
      { key: 'review', role: 'reviewer', capabilities: ['source.read'], prompt: 'Review the bounded Core changes.' },
      { key: 'tests', role: 'test-runner', capabilities: ['tests.run'], prompt: 'Run bounded Core tests.' },
    ],
    deadlineMs: 1_000,
    parallelism: 2,
    depth: 0,
    fanOutIndex: 0,
  }, { 'x-test-auth': 'yes' });
  assert.equal(dispatchResponse.status, 200);
  const dispatch = JSON.parse(dispatchResponse.body);
  assert.equal(dispatch.completedChildren, 2);
  assert.deepEqual(observedChildren.map((child) => child.scope), [scope, scope]);
  assert.deepEqual(dispatch.childResults.map((child) => child.taskId).sort(), ['child-review', 'child-tests']);
  assert.deepEqual(observedChildren.map((child) => child.childIdempotencyKey).sort(), [
    dispatch.childResults[0].childIdempotencyKey,
    dispatch.childResults[1].childIdempotencyKey,
  ].sort());
  assert.deepEqual(observedAudits[0].statusCounts, [
    { status: 'completed', count: 2 },
    { status: 'failed', count: 0 },
    { status: 'canceled', count: 0 },
  ]);
  const reconciled = store.getTask(parent.id, scope);
  assert.equal(reconciled?.status, 'completed');
  assert.equal(reconciled?.artifacts.length, 2);
  assert.deepEqual(reconciled?.artifacts.map((artifact) => artifact.taskId), [parent.id, parent.id]);
  assert.deepEqual(reconciled?.artifacts.map((artifact) => artifact.sourceTaskId).sort(), ['child-review', 'child-tests']);

  const crossScope = await request(baseUrl, '/a2a/orchestrate', 'POST', {
    parentTaskId: parent.id,
    requests: [{ key: 'review', role: 'reviewer', capabilities: ['source.read'], prompt: 'Review the bounded Core changes.' }],
    deadlineMs: 1_000,
    parallelism: 1,
  }, { 'x-test-auth': 'yes', 'x-test-scope': 'other' });
  assert.equal(crossScope.status, 404, 'authenticated callers cannot dispatch another requester\'s parent task');

  const oversizedParallelism = await request(baseUrl, '/a2a/orchestrate', 'POST', {
    parentTaskId: parent.id,
    requests: [{ key: 'review', role: 'reviewer', capabilities: ['source.read'], prompt: 'Review the bounded Core changes.' }],
    deadlineMs: 1_000,
    parallelism: 9,
  }, { 'x-test-auth': 'yes' });
  assert.equal(oversizedParallelism.status, 400, 'orchestration route preserves Core bounds');

  const cancelledParent = await store.createOrGetTask({
    scope,
    contextId: 'cancel-context',
    idempotencyKey: 'cancel-dispatch',
    fingerprint: 'cancel-dispatch-fingerprint',
    message: { messageId: 'cancel-message', role: 'user', parts: [{ text: 'Cancel a child.' }] },
  });
  const cancelledDispatch = request(baseUrl, '/a2a/orchestrate', 'POST', {
    parentTaskId: cancelledParent.id,
    requests: [{ key: 'cancelled', role: 'reviewer', capabilities: ['source.read'], prompt: 'Wait for cancellation.' }],
    deadlineMs: 1_000,
    parallelism: 1,
  }, { 'x-test-auth': 'yes' });
  await cancelledChildStarted;
  const crossScopeCancel = await request(baseUrl, `/a2a/tasks/${cancelledParent.id}:cancel`, 'POST', {}, {
    'x-test-auth': 'yes',
    'x-test-scope': 'other',
  });
  assert.equal(crossScopeCancel.status, 404, 'a different authenticated requester cannot cancel an active parent task');
  assert.equal(store.getTask(cancelledParent.id, scope)?.status, 'working');
  const cancelled = await request(baseUrl, `/a2a/tasks/${cancelledParent.id}:cancel`, 'POST', {}, { 'x-test-auth': 'yes' });
  assert.equal(cancelled.status, 200);
  assert.equal(JSON.parse(cancelled.body).status, 'working', 'parent remains non-terminal until child cancellation is acknowledged');
  const cancelledResponse = await cancelledDispatch;
  assert.equal(cancelledResponse.status, 200);
  const cancelledResult = JSON.parse(cancelledResponse.body);
  assert.equal(cancelledResult.canceledChildren, 1);
  assert.equal(store.getTask(cancelledParent.id, scope)?.status, 'canceled', 'parent becomes terminal after child cancellation is acknowledged');

  const terminalDispatch = await request(baseUrl, '/a2a/orchestrate', 'POST', {
    parentTaskId: cancelledParent.id,
    requests: [{ key: 'cancelled', role: 'reviewer', capabilities: ['source.read'], prompt: 'Wait for cancellation.' }],
    deadlineMs: 1_000,
    parallelism: 1,
  }, { 'x-test-auth': 'yes' });
  assert.equal(terminalDispatch.status, 409, 'terminal parent tasks cannot start another child dispatch');
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
}

await assertIndexDoesNotAdvertiseUnverifiedWorkers();

console.log('a2a-index-integration-test: PASS (mounted authenticated Core orchestration route; no live Teams/Codex provider round trip)');

async function assertIndexDoesNotAdvertiseUnverifiedWorkers() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-index-readiness-'));
  const codexHome = path.join(root, 'codex-home-1');
  const executable = path.join(root, 'codex');
  const executableDigest = crypto.createHash('sha256').update('#!/bin/sh\nexit 0\n').digest('hex');

  try {
    await fs.mkdir(codexHome, { recursive: true, mode: 0o700 });
    await fs.chmod(codexHome, 0o700);
    await fs.writeFile(path.join(codexHome, 'auth.json'), '{"fixture":"readiness"}\n', { mode: 0o600 });
    await fs.chmod(path.join(codexHome, 'auth.json'), 0o600);
    await fs.writeFile(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    await fs.chmod(executable, 0o700);

    const scenarios = [
      { name: 'unconfigured-executable', CODEX_BIN: '', CODEX_BIN_SHA256: executableDigest },
      { name: 'missing-executable', CODEX_BIN: path.join(root, 'missing-codex'), CODEX_BIN_SHA256: executableDigest },
      { name: 'missing-digest', CODEX_BIN: executable, CODEX_BIN_SHA256: '' },
      { name: 'mismatched-digest', CODEX_BIN: executable, CODEX_BIN_SHA256: '0'.repeat(64) },
      { name: 'unsigned-executable', CODEX_BIN: executable, CODEX_BIN_SHA256: executableDigest },
    ];

    for (const scenario of scenarios) {
      const port = await freePort();
      const dataDir = path.join(root, scenario.name);
      await fs.mkdir(dataDir, { mode: 0o700 });
      const env = {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(port),
        TEAMS_CORE_BUILD: 'true',
        TEAMS_USE_SDK: 'true',
        TEAMS_SKIP_AUTH: 'false',
        TEAMS_LOCAL_DEV: 'false',
        TEAMS_SKIP_OUTBOUND: 'true',
        TEAMS_AGENT_CLI_PROVIDER: 'copilot',
        TEAMS_A2A_AGENT_PROVIDERS: 'codex',
        AGENT_WORKSPACE: process.cwd(),
        AGENT_CODEX_HOME: '',
        AGENT_CODEX_HOME_1: codexHome,
        CODEX_BIN: scenario.CODEX_BIN,
        CODEX_BIN_SHA256: scenario.CODEX_BIN_SHA256,
        CLIENT_ID: '22222222-3333-4444-8555-666666666666',
        BOT_CLIENT_ID: '11111111-2222-4333-8444-555555555555',
        CLIENT_SECRET: 'readiness-test-secret',
        TENANT_ID: '33333333-4444-4555-8666-777777777777',
        TEAMS_APP_ID: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        TEAMS_CATALOG_APP_ID: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
        TAB_DOMAIN: 'a2a-readiness.example.com',
        APPLICATION_ID_URI: 'api://a2a-readiness.example.com/botid-11111111-2222-4333-8444-555555555555',
        TEAMS_USER_AUTH_ACCEPTED_AUDIENCES: 'api://a2a-readiness.example.com/botid-11111111-2222-4333-8444-555555555555',
        APP_VERSION: '1.0.85-readiness-test',
        ITEM_STORE_PATH: path.join(dataDir, 'items.json'),
        WORK_ITEM_STORE_PATH: path.join(dataDir, 'work-items.json'),
        COLLABORATION_STORE_PATH: path.join(dataDir, 'collaboration.json'),
        AGENT_JOB_STORE_PATH: path.join(dataDir, 'agent-jobs.json'),
        AGENT_EVENT_STORE_PATH: path.join(dataDir, 'agent-events.json'),
        AGENT_ADMISSION_JOURNAL_PATH: path.join(dataDir, 'agent-admission.json'),
        A2A_STORE_PATH: path.join(dataDir, 'a2a.json'),
        A2A_OUTBOUND_STORE_PATH: path.join(dataDir, 'a2a-outbound.json'),
        GENUI_ACTION_STORE_PATH: path.join(dataDir, 'genui-actions.json'),
        RESPONSE_MODE_STORE_PATH: path.join(dataDir, 'response-modes.json'),
        PROVIDER_MUTATION_REPLAY_STORE_PATH: path.join(dataDir, 'provider-mutation-replay.json'),
      };
      const output = [];
      const child = spawn(process.execPath, ['dist/server/index.js'], {
        cwd: process.cwd(),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const closePromise = new Promise((resolve) => child.once('close', resolve));
      child.stdout.on('data', (chunk) => output.push(String(chunk)));
      child.stderr.on('data', (chunk) => output.push(String(chunk)));

      try {
        await waitForIndexReady(child, output);
        const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
        const health = await healthResponse.json();
        assert.equal(healthResponse.status, 200, `${scenario.name}: ${JSON.stringify(health)}`);
        const provider = health.a2aProviders?.find(({ agentId }) => agentId === 'teams-core-codex');
        assert.ok(provider, `${scenario.name}: indexed Codex worker is missing from health`);
        assert.equal(provider.configured, true, `${scenario.name}: provider declaration must remain separate from execution readiness`);
        assert.equal(provider.execution, 'unavailable', `${scenario.name}: an unverified native worker must not be advertised as ready`);
      } finally {
        if (child.exitCode === null) child.kill('SIGTERM');
        await closePromise;
      }
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForIndexReady(child, output, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`A2A index readiness fixture exited before listen(): ${output.join('')}`);
    }
    if (/Teams messages:/.test(output.join(''))) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill('SIGKILL');
  throw new Error(`A2A index readiness fixture did not listen within ${timeoutMs}ms: ${output.join('')}`);
}

async function request(baseUrl, route, method, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request(new URL(route, baseUrl), {
      method,
      headers: {
        ...(body === undefined ? {} : {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        }),
        ...headers,
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}
