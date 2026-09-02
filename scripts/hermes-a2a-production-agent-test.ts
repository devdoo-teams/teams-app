import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createA2AAgentAuthorizationPolicy } from '../src/server/a2a-agent-authorization.js';
import type { A2ARemoteAgentCard, A2ARemoteFetch } from '../src/server/a2a-remote-client.js';
import {
  createHermesA2AProductionAgent,
} from '../src/server/hermes-a2a-adapter.js';
import { FileProviderLifecycleStore } from '../src/server/provider-lifecycle-runner.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-production-agent-'));
const storePath = path.join(root, 'private', 'provider-lifecycle.json');
const scope = {
  tenantId: 'tenant-a',
  requesterId: 'requester-a',
  conversationId: 'teams-conversation-a',
};
const card: A2ARemoteAgentCard = {
  name: 'Hermes Reviewer',
  description: 'Hermes reviewer fixture.',
  version: '1.0.0',
  supportedInterfaces: [{
    url: 'https://hermes.example.test/',
    protocolBinding: 'JSONRPC',
    protocolVersion: '1.0',
  }],
  capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
  securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
  securityRequirements: [{ bearer: [] }],
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [{ id: 'source.read', name: 'Read', description: 'Read sources.', tags: ['review.report'] }],
};

let sends = 0;
let gets = 0;
let cancels = 0;
const fetcher: A2ARemoteFetch = async (_input, init = {}) => {
  if (init.method === 'GET') return response(card);
  const request = JSON.parse(String(init.body)) as { id: string; method: string; params: Record<string, unknown> };
  if (request.method === 'SendMessage') {
    sends += 1;
    const message = request.params.message as Record<string, unknown>;
    assert.equal(message.role, 'ROLE_USER');
    assert.equal(message.messageId, 'child-hermes-1');
    assert.notEqual(message.contextId, 'teams-conversation-a', 'provider context must not collapse into Teams conversation identity');
    return rpc(request.id, {
      task: {
        id: 'hermes-task-production-1',
        contextId: message.contextId,
        status: { state: 'TASK_STATE_SUBMITTED' },
      },
    });
  }
  if (request.method === 'GetTask') {
    gets += 1;
    return rpc(request.id, {
      id: 'hermes-task-production-1',
      contextId: providerContextId,
      status: { state: 'TASK_STATE_COMPLETED' },
      artifacts: [{
        artifactId: 'artifact-production-1',
        name: 'review.md',
        parts: [{ text: 'Production-shaped fixture result.', mediaType: 'text/markdown' }],
        metadata: { auditRefs: ['hermes-audit-production-1'] },
      }],
    });
  }
  cancels += 1;
  return rpc(request.id, {
    id: 'hermes-task-production-1',
    contextId: providerContextId,
    status: { state: 'TASK_STATE_CANCELED' },
  });
};

let providerContextId = '';
try {
  const store = new FileProviderLifecycleStore(storePath);
  await store.initialize();
  const authorizationPolicy = createA2AAgentAuthorizationPolicy({
    grants: [{
      ...scope,
      agentId: 'hermes-reviewer',
      roles: ['reviewer'],
      capabilities: ['source.read', 'review.report'],
    }],
  });
  const agent = await createHermesA2AProductionAgent({
    store,
    agentId: 'hermes-reviewer',
    providerId: 'hermes-a2a',
    origin: 'https://hermes.example.test',
    expectedPeerIdentity: 'Hermes Reviewer',
    credentialPrincipal: 'teamsapp-hermes-caller',
    credentialRef: 'HERMES_REVIEW_TOKEN',
    executionIdentity: 'hermes-review-execution',
    executionBoundaryId: 'hermes-review-boundary',
    roles: ['reviewer'],
    capabilities: ['source.read', 'review.report'],
    authorizationPolicy,
    environment: { HERMES_REVIEW_TOKEN: 'fixture-token-value' },
    fetch: fetcher,
    pollIntervalMs: 0,
    requestTimeoutMs: 100,
  });

  let bound = '';
  const execution = {
    scope,
    parentTaskId: 'parent-hermes-1',
    childKey: 'review',
    childIdempotencyKey: 'child-hermes-1',
    role: 'reviewer',
    prompt: 'Review the bounded implementation.',
    capabilities: ['source.read', 'review.report'] as const,
    agentId: 'hermes-reviewer',
    providerId: 'hermes-a2a',
    executionIdentity: 'hermes-review-execution',
    executionBoundaryId: 'hermes-review-boundary',
    deadlineAtMs: Date.now() + 1_000,
    signal: new AbortController().signal,
    bindChild: async (providerExecutionId: string) => {
      bound = providerExecutionId;
      const restarted = new FileProviderLifecycleStore(storePath);
      await restarted.initialize();
      const record = await restarted.get(scope, 'child-hermes-1');
      assert.equal(record?.state, 'accepted', 'provider receipt must be durable before bindChild');
      assert.equal(record?.receipt?.providerExecutionId, providerExecutionId);
      providerContextId = record?.receipt?.providerContextId ?? '';
    },
  };

  const completed = await agent.executeChild(execution);
  assert.deepEqual(completed, {
    taskId: 'hermes-task-production-1',
    status: 'completed',
    result: 'Production-shaped fixture result.',
  });
  assert.equal(bound, 'hermes-task-production-1');
  assert.equal(sends, 1);
  assert.equal(gets, 1);

  const persisted = await store.get(scope, 'child-hermes-1');
  assert.equal(persisted?.scope.conversationId, 'teams-conversation-a');
  assert.equal(persisted?.identities.provider.id, 'hermes-a2a');
  assert.equal(persisted?.identities.credential.principalId, 'teamsapp-hermes-caller');
  assert.equal(persisted?.identities.execution.id, 'hermes-review-execution');
  assert.equal(persisted?.identities.context.id, providerContextId);
  assert.equal(persisted?.identities.runtime.boundaryId, 'hermes-review-boundary');
  assert.equal(persisted?.artifacts?.[0]?.artifactId, 'artifact-production-1');
  assert.deepEqual(persisted?.auditRefs, ['hermes-audit-production-1']);
  assert.equal(JSON.stringify(persisted).includes('fixture-token-value'), false);

  const replay = await agent.executeChild({ ...execution, bindChild: async () => undefined });
  assert.deepEqual(replay, completed);
  assert.equal(sends, 1, 'same key and hash must reconcile without a second SendMessage');

  await agent.cancelChild?.({
    scope,
    parentTaskId: 'parent-hermes-1',
    childKey: 'review',
    childIdempotencyKey: 'child-hermes-1',
    agentId: 'hermes-reviewer',
    providerId: 'hermes-a2a',
    executionIdentity: 'hermes-review-execution',
    executionBoundaryId: 'hermes-review-boundary',
    agentJobId: 'hermes-task-production-1',
    cancelRequestedAt: new Date().toISOString(),
  });
  assert.equal(cancels, 0, 'terminal replay must not issue a provider cancellation');

  let inputContext = '';
  let inputCancels = 0;
  const inputAgent = await createHermesA2AProductionAgent({
    store,
    agentId: 'hermes-input-agent',
    providerId: 'hermes-input-provider',
    origin: 'https://hermes-input.example.test',
    expectedPeerIdentity: 'Hermes Input Agent',
    credentialPrincipal: 'teamsapp-hermes-input-caller',
    credentialRef: 'HERMES_INPUT_TOKEN',
    executionIdentity: 'hermes-input-execution',
    executionBoundaryId: 'hermes-input-boundary',
    roles: ['reviewer'],
    capabilities: ['source.read', 'review.report'],
    authorizationPolicy: createA2AAgentAuthorizationPolicy({ authorize: () => true }),
    environment: { HERMES_INPUT_TOKEN: 'fixture-input-token' },
    pollIntervalMs: 100,
    requestTimeoutMs: 100,
    fetch: async (_input, init = {}) => {
      if (init.method === 'GET') return response({
        ...card,
        name: 'Hermes Input Agent',
        supportedInterfaces: [{
          url: 'https://hermes-input.example.test/',
          protocolBinding: 'JSONRPC',
          protocolVersion: '1.0',
        }],
      });
      const request = JSON.parse(String(init.body)) as { id: string; method: string; params: Record<string, unknown> };
      if (request.method === 'SendMessage') {
        inputContext = (request.params.message as { contextId: string }).contextId;
        return rpc(request.id, { task: {
          id: 'hermes-task-input-1',
          contextId: inputContext,
          status: { state: 'TASK_STATE_INPUT_REQUIRED' },
        } });
      }
      if (request.method === 'CancelTask') {
        inputCancels += 1;
        return rpc(request.id, {
          id: 'hermes-task-input-1',
          contextId: inputContext,
          status: { state: 'TASK_STATE_CANCELED' },
        });
      }
      throw new Error('input-required fixture must not poll before cancellation');
    },
  });
  const inputController = new AbortController();
  let markInputAccepted!: () => void;
  const inputAccepted = new Promise<void>((resolve) => {
    markInputAccepted = resolve;
  });
  const inputRun = inputAgent.executeChild({
    ...execution,
    childKey: 'input',
    childIdempotencyKey: 'child-hermes-input-1',
    agentId: 'hermes-input-agent',
    providerId: 'hermes-input-provider',
    executionIdentity: 'hermes-input-execution',
    executionBoundaryId: 'hermes-input-boundary',
    deadlineAtMs: Date.now() + 1_000,
    signal: inputController.signal,
    bindChild: async () => markInputAccepted(),
  });
  await inputAccepted;
  inputController.abort(new Error('fixture user cancellation'));
  assert.equal((await inputRun).status, 'canceled');
  assert.equal(inputCancels, 1, 'input-required remains nonterminal until explicit cancellation');

  console.log('hermes-a2a-production-agent-test: PASS');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}

function rpc(id: string, result: unknown): Response {
  return response({ jsonrpc: '2.0', id, result });
}
