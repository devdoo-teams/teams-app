import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import express from 'express';

import type { A2AScope, A2ASendRequest, A2ATask } from '../src/server/a2a-contract.js';
import {
  adaptA2AV026Execution,
  createA2AV026AgentCard,
  createA2AV026JsonRpcRouter,
} from '../src/server/a2a-jsonrpc-route.js';
import { A2AStore } from '../src/server/a2a-store.js';

const card = createA2AV026AgentCard({
  name: 'Teams Core Agent',
  description: 'Bounded A2A JSON-RPC compatibility adapter.',
  url: 'https://core.example.test/a2a',
  version: '1.0.45',
  securitySchemes: {
    teamsBearer: { type: 'http', scheme: 'bearer' },
  },
  security: [{ teamsBearer: [] }],
  defaultInputModes: ['text/plain', 'application/json'],
  defaultOutputModes: ['text/plain'],
  skills: [{
    id: 'teams-core-tasks',
    name: 'Teams Core tasks',
    description: 'Bounded authenticated task execution with polling.',
    tags: ['teams', 'tasks'],
  }],
});

assert.deepEqual(card, {
  protocolVersion: '0.2.6',
  name: 'Teams Core Agent',
  description: 'Bounded A2A JSON-RPC compatibility adapter.',
  url: 'https://core.example.test/a2a',
  preferredTransport: 'JSONRPC',
  version: '1.0.45',
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: false,
  },
  securitySchemes: {
    teamsBearer: { type: 'http', scheme: 'bearer' },
  },
  security: [{ teamsBearer: [] }],
  defaultInputModes: ['text/plain', 'application/json'],
  defaultOutputModes: ['text/plain'],
  skills: [{
    id: 'teams-core-tasks',
    name: 'Teams Core tasks',
    description: 'Bounded authenticated task execution with polling.',
    tags: ['teams', 'tasks'],
  }],
});
assert.throws(() => createA2AV026AgentCard({
  name: 'Teams Core Agent',
  description: 'Invalid insecure endpoint.',
  url: 'http://core.example.test/a2a',
  version: '1.0.45',
  securitySchemes: { teamsBearer: { type: 'http', scheme: 'bearer' } },
  security: [{ teamsBearer: [] }],
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [{ id: 'tasks', name: 'Tasks', description: 'Tasks', tags: ['tasks'] }],
}), /HTTPS/);
assert.throws(() => createA2AV026AgentCard({
  name: 'Teams Core Agent',
  description: 'Missing caller-provided authentication.',
  url: 'https://core.example.test/a2a',
  version: '1.0.45',
  securitySchemes: {},
  security: [],
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [{ id: 'tasks', name: 'Tasks', description: 'Tasks', tags: ['tasks'] }],
}), /security/i);
assert.throws(() => createA2AV026AgentCard({
  name: 'Teams Core Agent',
  description: 'Unknown security requirement.',
  url: 'https://core.example.test/a2a',
  version: '1.0.45',
  securitySchemes: { teamsBearer: { type: 'http', scheme: 'bearer' } },
  security: [{ unknownScheme: [] }],
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [{ id: 'tasks', name: 'Tasks', description: 'Tasks', tags: ['tasks'] }],
}), /security/i);

type ResponseSnapshot = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
};

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-jsonrpc-route-test-'));
const artifactText = 'mapped artifact content';
const artifactSha256 = crypto.createHash('sha256').update(artifactText, 'utf8').digest('hex');
const scope: A2AScope = {
  tenantId: 'tenant-a',
  requesterId: 'requester-a',
  conversationId: 'conversation-a',
};
const otherScope: A2AScope = { ...scope, requesterId: 'requester-b' };
const store = new A2AStore(path.join(root, 'store.json'));
await store.initialize();
let submitted = 0;
let canceled = 0;
const submittedInputs: Array<{ task: A2ATask; request: A2ASendRequest; scope: A2AScope }> = [];
const existingExecution = Object.assign(
  async (input: { task: A2ATask; request: A2ASendRequest; scope: A2AScope }) => {
    submitted += 1;
    submittedInputs.push(input);
  },
  {
    cancel: async ({ taskId, scope: taskScope }: { taskId: string; scope: A2AScope }) => {
      canceled += 1;
      return store.cancelTask(taskId, taskScope);
    },
    initialize: async () => {},
  },
) as Parameters<typeof adaptA2AV026Execution>[0];
assert.throws(() => createA2AV026JsonRpcRouter({
  store,
  resolveScope: () => scope,
  execution: adaptA2AV026Execution(existingExecution),
} as Parameters<typeof createA2AV026JsonRpcRouter>[0]), /authenticate/i);
const app = express();
app.use('/a2a', createA2AV026JsonRpcRouter({
  store,
  authenticate: (request, response, next) => {
    if (request.header('x-test-auth') !== 'yes') {
      response.status(401).json({ error: 'auth required' });
      return;
    }
    next();
  },
  resolveScope: (request) => request.header('x-test-scope') === 'other' ? otherScope : scope,
  execution: adaptA2AV026Execution(existingExecution),
}));
app.use('/a2a-mapped', createA2AV026JsonRpcRouter({
  store,
  authenticate: (request, response, next) => {
    if (request.header('x-test-auth') !== 'yes') {
      response.status(401).json({ error: 'auth required' });
      return;
    }
    next();
  },
  resolveScope: (request) => request.header('x-test-scope') === 'other' ? otherScope : scope,
  execution: {
    submit: () => { submitted += 1; },
    cancel: async ({ task }) => store.cancelTask(task.id, task.scope),
  },
  mapArtifact: (artifact) => ({
    artifactId: artifact.artifactId,
    name: artifact.name,
    parts: [{ kind: 'text', text: 'mapped artifact content' }],
    metadata: { sha256: artifact.sha256 },
  }),
}));
app.use('/a2a-invalid-artifact', createA2AV026JsonRpcRouter({
  store,
  authenticate: (request, response, next) => {
    if (request.header('x-test-auth') !== 'yes') {
      response.status(401).json({ error: 'auth required' });
      return;
    }
    next();
  },
  resolveScope: () => scope,
  execution: {
    submit: () => { submitted += 1; },
    cancel: async ({ task }) => store.cancelTask(task.id, task.scope),
  },
  mapArtifact: (artifact) => ({ artifactId: artifact.artifactId, parts: [] }),
}));
const server = await new Promise<http.Server>((resolve) => {
  const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
});
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const unauthorized = await postJson(baseUrl, '/a2a', {
    jsonrpc: '2.0',
    id: 'request-unauthorized',
    method: 'message/send',
    params: messageSendParams('message-unauthorized'),
  });
  assert.equal(unauthorized.status, 401);

  const sent = await postJson(baseUrl, '/a2a', {
    jsonrpc: '2.0',
    id: 'request-send',
    method: 'message/send',
    params: messageSendParams('message-send'),
  }, { 'x-test-auth': 'yes' });
  assert.equal(sent.status, 200);
  const sentBody = JSON.parse(sent.body) as Record<string, unknown>;
  assert.equal(sentBody.jsonrpc, '2.0');
  assert.equal(sentBody.id, 'request-send');
  assert.deepEqual(sentBody.result, {
    id: (sentBody.result as { id: string }).id,
    contextId: (sentBody.result as { contextId: string }).contextId,
    status: { state: 'submitted' },
    kind: 'task',
  });
  assert.equal(submitted, 1);

  const taskId = (sentBody.result as { id: string }).id;
  const duplicate = await postJson(baseUrl, '/a2a', {
    jsonrpc: '2.0',
    id: 7,
    method: 'message/send',
    params: messageSendParams('message-send'),
  }, { 'x-test-auth': 'yes' });
  assert.equal((JSON.parse(duplicate.body) as { result: { id: string } }).result.id, taskId);
  assert.equal(submitted, 1);

  const fetched = await postJson(baseUrl, '/a2a', {
    jsonrpc: '2.0',
    id: 'request-get',
    method: 'tasks/get',
    params: { id: taskId },
  }, { 'x-test-auth': 'yes' });
  assert.deepEqual(JSON.parse(fetched.body), {
    jsonrpc: '2.0',
    id: 'request-get',
    result: {
      id: taskId,
      contextId: (sentBody.result as { contextId: string }).contextId,
      status: { state: 'submitted' },
      kind: 'task',
    },
  });

  const crossScope = await postJson(baseUrl, '/a2a', {
    jsonrpc: '2.0',
    id: 'request-cross-scope',
    method: 'tasks/get',
    params: { id: taskId },
  }, { 'x-test-auth': 'yes', 'x-test-scope': 'other' });
  assert.deepEqual(JSON.parse(crossScope.body), {
    jsonrpc: '2.0',
    id: 'request-cross-scope',
    error: { code: -32001, message: 'Task not found' },
  });

  const continuation = await postJson(baseUrl, '/a2a', {
    jsonrpc: '2.0',
    id: 'request-continuation',
    method: 'message/send',
    params: {
      message: {
        kind: 'message',
        messageId: 'message-continuation',
        role: 'user',
        taskId,
        parts: [{ kind: 'text', text: 'Continue the existing task.' }],
      },
    },
  }, { 'x-test-auth': 'yes' });
  assert.equal(continuation.status, 200);
  assert.deepEqual((JSON.parse(continuation.body) as { result: Record<string, unknown> }).result, {
    id: taskId,
    contextId: (sentBody.result as { contextId: string }).contextId,
    status: { state: 'submitted' },
    kind: 'task',
  });
  assert.equal(submitted, 2);
  assert.equal(submittedInputs.at(-1)?.task.id, taskId);
  assert.equal(submittedInputs.at(-1)?.request.message.taskId, taskId);
  assert.deepEqual(submittedInputs.at(-1)?.scope, store.getTaskForOwner(taskId, scope)?.scope);

  const crossScopeContinuation = await postJson(baseUrl, '/a2a', {
    jsonrpc: '2.0',
    id: 'request-cross-scope-continuation',
    method: 'message/send',
    params: {
      message: {
        kind: 'message',
        messageId: 'message-cross-scope-continuation',
        role: 'user',
        taskId,
        parts: [{ kind: 'text', text: 'Do not run this for another owner.' }],
      },
    },
  }, { 'x-test-auth': 'yes', 'x-test-scope': 'other' });
  assert.deepEqual(JSON.parse(crossScopeContinuation.body), {
    jsonrpc: '2.0',
    id: 'request-cross-scope-continuation',
    error: { code: -32001, message: 'Task not found' },
  });
  assert.equal(submitted, 2);

  const unknownContinuation = await postJson(baseUrl, '/a2a', {
    jsonrpc: '2.0',
    id: 'request-unknown-continuation',
    method: 'message/send',
    params: {
      message: {
        kind: 'message',
        messageId: 'message-unknown-continuation',
        role: 'user',
        taskId: 'task-does-not-exist',
        parts: [{ kind: 'text', text: 'This task must not be created.' }],
      },
    },
  }, { 'x-test-auth': 'yes' });
  assert.deepEqual(JSON.parse(unknownContinuation.body), {
    jsonrpc: '2.0',
    id: 'request-unknown-continuation',
    error: { code: -32001, message: 'Task not found' },
  });
  assert.equal(submitted, 2);

  const invalidHistoryType = await postJson(baseUrl, '/a2a', {
    jsonrpc: '2.0',
    id: 'request-invalid-history-type',
    method: 'tasks/get',
    params: { id: taskId, historyLength: '1' },
  }, { 'x-test-auth': 'yes' });
  assert.deepEqual(JSON.parse(invalidHistoryType.body), {
    jsonrpc: '2.0',
    id: 'request-invalid-history-type',
    error: { code: -32602, message: 'Invalid method parameters' },
  });

  const unsupportedCancelMetadata = await postJson(baseUrl, '/a2a', {
    jsonrpc: '2.0',
    id: 'request-cancel-metadata',
    method: 'tasks/cancel',
    params: { id: taskId, metadata: { trace: 'not-representable' } },
  }, { 'x-test-auth': 'yes' });
  assert.deepEqual(JSON.parse(unsupportedCancelMetadata.body), {
    jsonrpc: '2.0',
    id: 'request-cancel-metadata',
    error: { code: -32004, message: 'This operation is not supported' },
  });
  assert.equal(canceled, 0);

  const graphLimit = await postJson(baseUrl, '/a2a', {
    jsonrpc: '2.0',
    id: 'request-graph-limit',
    method: 'message/send',
    params: {
      ...messageSendParams('message-graph-limit'),
      metadata: { depth: 9, fanOutIndex: 0 },
    },
  }, { 'x-test-auth': 'yes' });
  assert.deepEqual(JSON.parse(graphLimit.body), {
    jsonrpc: '2.0',
    id: 'request-graph-limit',
    error: { code: -32602, message: 'Invalid method parameters' },
  });

  const protocolMetadata = await postJson(baseUrl, '/a2a', {
    jsonrpc: '2.0',
    id: 'request-protocol-metadata',
    method: 'message/send',
    params: {
      ...messageSendParams('message-protocol-metadata'),
      metadata: {
        traceId: 'protocol-trace-1',
        depth: 1,
        fanOutIndex: 2,
        nested: { client: 'a2a' },
      },
    },
  }, { 'x-test-auth': 'yes' });
  assert.equal(protocolMetadata.status, 200);
  assert.equal((JSON.parse(protocolMetadata.body) as { result: { status: { state: string } } }).result.status.state, 'submitted');
  assert.equal(submitted, 3);
  assert.equal(submittedInputs.at(-1)?.request.depth, 0);
  assert.equal(submittedInputs.at(-1)?.request.fanOutIndex, 0);

  const cancelResponse = await postJson(baseUrl, '/a2a', {
    jsonrpc: '2.0',
    id: 'request-cancel',
    method: 'tasks/cancel',
    params: { id: taskId, metadata: {} },
  }, { 'x-test-auth': 'yes' });
  assert.equal((JSON.parse(cancelResponse.body) as { result: { status: { state: string } } }).result.status.state, 'canceled');
  assert.equal(canceled, 1);

  const unauthorizedMalformed = await requestRaw(baseUrl, '/a2a', '{not-json', {
    'content-type': 'application/json',
  });
  assert.equal(unauthorizedMalformed.status, 401);

  const malformed = await requestRaw(baseUrl, '/a2a', '{not-json', {
    'content-type': 'application/json',
    'x-test-auth': 'yes',
  });
  assert.equal(malformed.status, 400);
  assert.match(String(malformed.headers['content-type']), /^application\/json/);
  assert.deepEqual(JSON.parse(malformed.body), {
    jsonrpc: '2.0',
    id: null,
    error: { code: -32700, message: 'Invalid JSON payload' },
  });

  const invalidEnvelope = await postJson(baseUrl, '/a2a', [], { 'x-test-auth': 'yes' });
  assert.deepEqual(JSON.parse(invalidEnvelope.body), {
    jsonrpc: '2.0',
    id: null,
    error: { code: -32600, message: 'Invalid JSON-RPC Request' },
  });

  const unknownMethod = await postJson(baseUrl, '/a2a', {
    jsonrpc: '2.0',
    id: 11,
    method: 'tasks/list',
    params: {},
  }, { 'x-test-auth': 'yes' });
  assert.deepEqual(JSON.parse(unknownMethod.body), {
    jsonrpc: '2.0',
    id: 11,
    error: { code: -32601, message: 'Method not found' },
  });

  const invalidParams = await postJson(baseUrl, '/a2a', {
    jsonrpc: '2.0',
    id: 'request-invalid-params',
    method: 'tasks/get',
    params: { id: `${taskId}!` },
  }, { 'x-test-auth': 'yes' });
  assert.deepEqual(JSON.parse(invalidParams.body), {
    jsonrpc: '2.0',
    id: 'request-invalid-params',
    error: { code: -32602, message: 'Invalid method parameters' },
  });

  const unsupportedFile = await postJson(baseUrl, '/a2a', {
    jsonrpc: '2.0',
    id: 'request-file',
    method: 'message/send',
    params: {
      message: {
        kind: 'message',
        messageId: 'message-file',
        role: 'user',
        parts: [{ kind: 'file', file: { uri: 'https://example.test/file.txt' } }],
      },
    },
  }, { 'x-test-auth': 'yes' });
  assert.deepEqual(JSON.parse(unsupportedFile.body), {
    jsonrpc: '2.0',
    id: 'request-file',
    error: { code: -32005, message: 'Incompatible content types' },
  });

  const unsupportedBlocking = await postJson(baseUrl, '/a2a', {
    jsonrpc: '2.0',
    id: 'request-blocking',
    method: 'message/send',
    params: {
      ...messageSendParams('message-blocking'),
      configuration: { blocking: true },
    },
  }, { 'x-test-auth': 'yes' });
  assert.deepEqual(JSON.parse(unsupportedBlocking.body), {
    jsonrpc: '2.0',
    id: 'request-blocking',
    error: { code: -32004, message: 'This operation is not supported' },
  });

  const unsupportedJsonOutput = await postJson(baseUrl, '/a2a', {
    jsonrpc: '2.0',
    id: 'request-json-output',
    method: 'message/send',
    params: {
      ...messageSendParams('message-json-output'),
      configuration: { acceptedOutputModes: ['application/json'] },
    },
  }, { 'x-test-auth': 'yes' });
  assert.deepEqual(JSON.parse(unsupportedJsonOutput.body), {
    jsonrpc: '2.0',
    id: 'request-json-output',
    error: { code: -32005, message: 'Incompatible content types' },
  });

  const unsupportedPush = await postJson(baseUrl, '/a2a', {
    jsonrpc: '2.0',
    id: 'request-push',
    method: 'message/send',
    params: {
      ...messageSendParams('message-push'),
      configuration: {
        pushNotificationConfig: { url: 'https://client.example.test/a2a-events' },
      },
    },
  }, { 'x-test-auth': 'yes' });
  assert.deepEqual(JSON.parse(unsupportedPush.body), {
    jsonrpc: '2.0',
    id: 'request-push',
    error: { code: -32003, message: 'Push Notification is not supported' },
  });

  const conflictingMessage = await postJson(baseUrl, '/a2a', {
    jsonrpc: '2.0',
    id: 'request-conflict',
    method: 'message/send',
    params: {
      message: {
        kind: 'message',
        messageId: 'message-send',
        role: 'user',
        parts: [{ kind: 'text', text: 'A different payload reusing the same message ID.' }],
      },
    },
  }, { 'x-test-auth': 'yes' });
  assert.deepEqual(JSON.parse(conflictingMessage.body), {
    jsonrpc: '2.0',
    id: 'request-conflict',
    error: { code: -32602, message: 'Invalid method parameters' },
  });

  const unsupportedHistory = await postJson(baseUrl, '/a2a', {
    jsonrpc: '2.0',
    id: 'request-history',
    method: 'tasks/get',
    params: { id: taskId, historyLength: 1 },
  }, { 'x-test-auth': 'yes' });
  assert.deepEqual(JSON.parse(unsupportedHistory.body), {
    jsonrpc: '2.0',
    id: 'request-history',
    error: { code: -32004, message: 'This operation is not supported' },
  });

  const oversizedId = await postJson(baseUrl, '/a2a', {
    jsonrpc: '2.0',
    id: 'x'.repeat(201),
    method: 'tasks/get',
    params: { id: taskId },
  }, { 'x-test-auth': 'yes' });
  assert.equal(oversizedId.status, 400);
  assert.deepEqual(JSON.parse(oversizedId.body), {
    jsonrpc: '2.0',
    id: null,
    error: { code: -32600, message: 'Invalid JSON-RPC Request' },
  });

  const oversizedBody = await postJson(baseUrl, '/a2a', {
    jsonrpc: '2.0',
    id: 'request-oversized-body',
    method: 'message/send',
    params: messageSendParams('message-oversized-body'),
    padding: 'x'.repeat(70_000),
  }, { 'x-test-auth': 'yes' });
  assert.equal(oversizedBody.status, 413);
  assert.deepEqual(JSON.parse(oversizedBody.body), {
    jsonrpc: '2.0',
    id: null,
    error: { code: -32600, message: 'Invalid JSON-RPC Request' },
  });

  const wrongMediaType = await requestRaw(baseUrl, '/a2a', JSON.stringify({
    jsonrpc: '2.0',
    id: 'request-wrong-media',
    method: 'tasks/get',
    params: { id: taskId },
  }), {
    'content-type': 'text/plain',
    'x-test-auth': 'yes',
  });
  assert.equal(wrongMediaType.status, 415);
  assert.deepEqual(JSON.parse(wrongMediaType.body), {
    jsonrpc: '2.0',
    id: null,
    error: { code: -32600, message: 'Invalid JSON-RPC Request' },
  });

  const notification = await postJson(baseUrl, '/a2a', {
    jsonrpc: '2.0',
    method: 'message/send',
    params: messageSendParams('message-notification'),
  }, { 'x-test-auth': 'yes' });
  assert.equal(notification.status, 204);
  assert.equal(notification.body, '');
  assert.equal(submitted, 4);

  const artifactTaskResponse = await postJson(baseUrl, '/a2a', {
    jsonrpc: '2.0',
    id: 'request-artifact-task',
    method: 'message/send',
    params: messageSendParams('message-artifact-task'),
  }, { 'x-test-auth': 'yes' });
  const artifactTaskId = (JSON.parse(artifactTaskResponse.body) as { result: { id: string } }).result.id;
  const artifactTask = store.getTaskForOwner(artifactTaskId, scope);
  assert.ok(artifactTask);
  await store.transitionTask(artifactTask.id, artifactTask.scope, 'working');
  await store.transitionTask(artifactTask.id, artifactTask.scope, {
    status: 'completed',
    error: undefined,
    artifacts: [{
      artifactId: 'artifact-result',
      taskId: artifactTask.id,
      sourceTaskId: artifactTask.id,
      sha256: artifactSha256,
      byteSize: Buffer.byteLength(artifactText, 'utf8'),
      mediaType: 'text/plain',
      name: 'result.txt',
      scope: artifactTask.scope,
      content: { mediaType: 'text/plain', text: artifactText },
    }],
  });

  const unmappedArtifact = await postJson(baseUrl, '/a2a', {
    jsonrpc: '2.0',
    id: 'request-unmapped-artifact',
    method: 'tasks/get',
    params: { id: artifactTaskId },
  }, { 'x-test-auth': 'yes' });
  assert.deepEqual(JSON.parse(unmappedArtifact.body), {
    jsonrpc: '2.0',
    id: 'request-unmapped-artifact',
    error: { code: -32006, message: 'Invalid agent response type' },
  });

  const mappedArtifact = await postJson(baseUrl, '/a2a-mapped', {
    jsonrpc: '2.0',
    id: 'request-mapped-artifact',
    method: 'tasks/get',
    params: { id: artifactTaskId },
  }, { 'x-test-auth': 'yes' });
  const mappedResult = (JSON.parse(mappedArtifact.body) as { result: Record<string, unknown> }).result;
  assert.deepEqual(mappedResult, {
    id: artifactTaskId,
    contextId: artifactTask.contextId,
    status: { state: 'completed' },
    artifacts: [{
      artifactId: 'artifact-result',
      name: 'result.txt',
      parts: [{ kind: 'text', text: 'mapped artifact content' }],
      metadata: { sha256: artifactSha256 },
    }],
    kind: 'task',
  });

  const invalidMappedArtifact = await postJson(baseUrl, '/a2a-invalid-artifact', {
    jsonrpc: '2.0',
    id: 'request-invalid-artifact',
    method: 'tasks/get',
    params: { id: artifactTaskId },
  }, { 'x-test-auth': 'yes' });
  assert.deepEqual(JSON.parse(invalidMappedArtifact.body), {
    jsonrpc: '2.0',
    id: 'request-invalid-artifact',
    error: { code: -32006, message: 'Invalid agent response type' },
  });

  const terminalCancel = await postJson(baseUrl, '/a2a', {
    jsonrpc: '2.0',
    id: 'request-terminal-cancel',
    method: 'tasks/cancel',
    params: { id: artifactTaskId },
  }, { 'x-test-auth': 'yes' });
  assert.deepEqual(JSON.parse(terminalCancel.body), {
    jsonrpc: '2.0',
    id: 'request-terminal-cancel',
    error: { code: -32002, message: 'Task cannot be canceled' },
  });

  console.log('a2a-jsonrpc-route-test: PASS');
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await fs.rm(root, { recursive: true, force: true });
}

function messageSendParams(messageId: string): Record<string, unknown> {
  return {
    message: {
      kind: 'message',
      messageId,
      role: 'user',
      parts: [{ kind: 'text', text: 'Run a bounded Core task.' }],
    },
  };
}

async function postJson(
  baseUrl: string,
  route: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<ResponseSnapshot> {
  return requestRaw(baseUrl, route, JSON.stringify(body), {
    'content-type': 'application/json',
    ...headers,
  });
}

async function requestRaw(
  baseUrl: string,
  route: string,
  body: string,
  headers: Record<string, string> = {},
): Promise<ResponseSnapshot> {
  const url = new URL(route, baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method: 'POST',
      headers: {
        'content-length': Buffer.byteLength(body),
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
    request.on('error', reject);
    request.end(body);
  });
}
