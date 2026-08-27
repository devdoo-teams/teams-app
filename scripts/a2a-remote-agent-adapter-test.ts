import assert from 'node:assert/strict';

import { createA2AAgentAuthorizationPolicy } from '../src/server/a2a-agent-authorization.js';
import { A2ATelemetryCollector } from '../src/server/a2a-telemetry.js';
import {
  createA2ARemoteAgent,
  createConfiguredA2ARemoteAgent,
} from '../src/server/a2a-remote-agent-adapter.js';
import type {
  A2ARemoteAgentCard,
  A2ARemoteClient,
  A2ARemoteFetch,
  A2ARemoteMessage,
  A2ARemoteTask,
} from '../src/server/a2a-remote-client.js';

const scope = { tenantId: 'tenant-a', requesterId: 'requester-a', conversationId: 'conversation-a' };
const authorizationPolicy = createA2AAgentAuthorizationPolicy({
  grants: [{
    ...scope,
    agentId: 'remote-agent',
    roles: ['reviewer'],
    capabilities: ['review.report', 'source.read'],
  }],
});

const calls: string[] = [];
let current: A2ARemoteTask = {
  id: 'remote-task-1',
  status: { state: 'TASK_STATE_WORKING' },
};
const client: A2ARemoteClient = {
  card: {} as A2ARemoteClient['card'],
  async sendMessage() {
    calls.push('send');
    return current;
  },
  async getTask() {
    calls.push('get');
    return current;
  },
  async listTasks() { return { tasks: [] }; },
  async cancelTask() {
    calls.push('cancel');
    current = { ...current, status: { state: 'TASK_STATE_CANCELED' } };
    return current;
  },
};

const agent = createA2ARemoteAgent({
  agentId: 'remote-agent',
  providerId: 'remote-provider',
  client,
  authorizationPolicy,
  pollIntervalMs: 1,
  maxPolls: 5,
});

let boundId = '';
const successPromise = agent.executeChild({
  scope,
  parentTaskId: 'parent-1',
  childKey: 'review',
  childIdempotencyKey: 'child-1',
  role: 'reviewer',
  prompt: 'Run the remote task.',
  capabilities: ['source.read'],
  agentId: 'remote-agent',
  providerId: 'remote-provider',
  deadlineAtMs: Date.now() + 1_000,
  signal: new AbortController().signal,
  bindChild: async (id) => { boundId = id; },
});
setTimeout(() => {
  current = {
    ...current,
    status: { state: 'TASK_STATE_COMPLETED' },
    artifacts: [{ parts: [{ text: 'remote result' }] }],
  };
}, 3);
const completed = await successPromise;
assert.deepEqual(completed, { taskId: 'remote-task-1', status: 'completed', result: 'remote result' });
assert.equal(boundId, 'remote-task-1');
assert.deepEqual(calls.slice(0, 2), ['send', 'get']);

async function runInterruptedRemoteState(
  taskId: string,
  state: 'TASK_STATE_INPUT_REQUIRED' | 'TASK_STATE_AUTH_REQUIRED',
) {
  calls.length = 0;
  current = { id: taskId, status: { state } };
  return agent.executeChild({
    scope,
    parentTaskId: `parent-${taskId}`,
    childKey: 'review',
    childIdempotencyKey: `child-${taskId}`,
    role: 'reviewer',
    prompt: 'Run the remote task.',
    capabilities: ['source.read'],
    agentId: 'remote-agent',
    providerId: 'remote-provider',
    deadlineAtMs: Date.now() + 1_000,
    signal: new AbortController().signal,
    bindChild: async () => undefined,
  });
}

const inputRequired = await runInterruptedRemoteState('remote-task-input-required', 'TASK_STATE_INPUT_REQUIRED');
assert.deepEqual(inputRequired, {
  taskId: 'remote-task-input-required',
  status: 'failed',
  error: 'Remote A2A task requires additional input (TASK_STATE_INPUT_REQUIRED).',
});
assert.deepEqual(calls, ['send'], 'input-required must stop polling without canceling the remote task');

const authRequired = await runInterruptedRemoteState('remote-task-auth-required', 'TASK_STATE_AUTH_REQUIRED');
assert.deepEqual(authRequired, {
  taskId: 'remote-task-auth-required',
  status: 'failed',
  error: 'Remote A2A task requires authentication (TASK_STATE_AUTH_REQUIRED).',
});
assert.deepEqual(calls, ['send'], 'auth-required must stop polling without canceling the remote task');

calls.length = 0;
current = { id: 'remote-task-2', status: { state: 'TASK_STATE_WORKING' } };
const controller = new AbortController();
const canceledPromise = agent.executeChild({
  scope,
  parentTaskId: 'parent-2',
  childKey: 'review',
  childIdempotencyKey: 'child-2',
  role: 'reviewer',
  prompt: 'Run the remote task.',
  capabilities: ['source.read'],
  agentId: 'remote-agent',
  providerId: 'remote-provider',
  deadlineAtMs: Date.now() + 1_000,
  signal: controller.signal,
  bindChild: async () => undefined,
});
setTimeout(() => controller.abort(), 2);
const canceled = await canceledPromise;
assert.equal(canceled.status, 'canceled');
assert.ok(calls.includes('cancel'), 'aborting a remote child must cancel the remote task');

current = {
  id: 'remote-task-recovery',
  status: { state: 'TASK_STATE_COMPLETED' },
  artifacts: [{ parts: [{ text: 'recovered remote result' }] }],
};
const recovered = await agent.recoverChild({
  scope,
  parentTaskId: 'parent-recovery',
  childKey: 'review',
  agentId: 'remote-agent',
  providerId: 'remote-provider',
  agentJobId: 'remote-task-recovery',
  deadlineAtMs: Date.now() + 1_000,
  signal: new AbortController().signal,
});
assert.deepEqual(recovered, {
  taskId: 'remote-task-recovery',
  status: 'completed',
  result: 'recovered remote result',
});

const directMessageClient: A2ARemoteClient = {
  card: {} as A2ARemoteClient['card'],
  async sendMessage() {
    const directMessage: A2ARemoteMessage = {
      messageId: 'direct-message-1',
      role: 'ROLE_AGENT',
      parts: [{ text: 'direct remote result', mediaType: 'text/plain' }],
    };
    return directMessage;
  },
  async getTask() {
    throw new Error('direct A2A responses must not be polled as tasks');
  },
  async listTasks() { return { tasks: [] }; },
  async cancelTask() {
    throw new Error('direct A2A responses must not be canceled as tasks');
  },
};
const directMessageAgent = createA2ARemoteAgent({
  agentId: 'remote-agent',
  providerId: 'remote-provider',
  client: directMessageClient,
  authorizationPolicy,
});
let directMessageBoundId = '';
const directMessageResult = await directMessageAgent.executeChild({
  scope,
  parentTaskId: 'parent-direct-message',
  childKey: 'review',
  childIdempotencyKey: 'child-direct-message',
  role: 'reviewer',
  prompt: 'Return a direct response.',
  capabilities: ['source.read'],
  agentId: 'remote-agent',
  providerId: 'remote-provider',
  deadlineAtMs: Date.now() + 1_000,
  signal: new AbortController().signal,
  bindChild: async (id) => { directMessageBoundId = id; },
});
assert.deepEqual(directMessageResult, {
  taskId: 'child-direct-message',
  status: 'completed',
  result: 'direct remote result',
}, 'a valid A2A direct Message response must complete without task polling');
assert.equal(directMessageBoundId, 'child-direct-message');

const configuredCard: A2ARemoteAgentCard = {
  name: 'Configured Remote Agent',
  description: 'Remote A2A test agent.',
  version: '1.0.0',
  supportedInterfaces: [{
    url: 'https://remote.example.test/a2a/v1',
    protocolBinding: 'JSONRPC',
    protocolVersion: '1.0',
  }],
  capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
  securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
  securityRequirements: [{ bearer: [] }],
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [{ id: 'tasks', name: 'Tasks', description: 'Tasks', tags: ['a2a'] }],
};
const configuredTelemetry = new A2ATelemetryCollector({ now: () => 1_700_000_000_000 });
const configuredFetch: A2ARemoteFetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.pathname === '/.well-known/agent-card.json') {
    return new Response(JSON.stringify(configuredCard), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  const headers = new Headers(init.headers);
  assert.equal(headers.get('authorization'), 'Bearer configured-remote-token');
  const body = JSON.parse(String(init.body)) as { method: string; params: Record<string, unknown> };
  assert.equal(body.method, 'SendMessage');
  assert.deepEqual(Object.keys(body.params).sort(), ['message'],
    'configured remote composition must emit only the official SendMessage request fields');
  return new Response(JSON.stringify({
    jsonrpc: '2.0',
    id: 'rpc-1',
    result: {
      task: {
        id: 'configured-remote-task',
        status: { state: 'TASK_STATE_COMPLETED' },
        artifacts: [{ parts: [{ text: 'configured result' }] }],
      },
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const configuredAgent = await createConfiguredA2ARemoteAgent({
  endpoint: 'https://remote.example.test',
  bearerToken: 'configured-remote-token',
  agentId: 'remote-agent',
  providerId: 'remote-provider',
  authorizationPolicy,
  fetch: configuredFetch,
  telemetry: configuredTelemetry,
});
let configuredBoundId = '';
const configuredResult = await configuredAgent.executeChild({
  scope,
  parentTaskId: 'parent-configured',
  childKey: 'review',
  childIdempotencyKey: 'child-configured',
  role: 'reviewer',
  prompt: 'Run the configured remote task.',
  capabilities: ['source.read'],
  agentId: 'remote-agent',
  providerId: 'remote-provider',
  deadlineAtMs: Date.now() + 1_000,
  signal: new AbortController().signal,
  bindChild: async (id) => { configuredBoundId = id; },
});
assert.deepEqual(configuredResult, {
  taskId: 'configured-remote-task',
  status: 'completed',
  result: 'configured result',
});
assert.equal(configuredBoundId, 'configured-remote-task');
assert.deepEqual(configuredTelemetry.snapshot().metrics.providers, [
  { providerId: 'remote-provider', count: 2, latencySamples: 2, totalLatencyMs: 0, maxLatencyMs: 0 },
]);

assert.equal(agent.authorize({ scope, role: 'reviewer', capabilities: ['source.read'] }), false,
  'legacy callback remains fail-closed unless a server-owned callback is supplied');
assert.equal(agent.authorizationPolicy.evaluate({ agentId: 'remote-agent', scope, role: 'reviewer', capabilities: ['source.read'] }).allowed, true);

console.log('a2a-remote-agent-adapter-test: PASS');
