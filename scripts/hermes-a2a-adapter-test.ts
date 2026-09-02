import assert from 'node:assert/strict';

import { createHermesA2AAdapter } from '../src/server/hermes-a2a-adapter.js';
import type {
  ProviderAcceptedReceipt,
  ProviderRuntimeOperationInput,
} from '../src/server/provider-runtime-adapter.js';
import type {
  A2ARemoteAgentCard,
  A2ARemoteFetch,
} from '../src/server/a2a-remote-client.js';

const card: A2ARemoteAgentCard = {
  name: 'Hermes Research Agent',
  description: 'Hermes A2A v1 fixture.',
  version: '1.0.0',
  supportedInterfaces: [{
    url: 'https://hermes.example.test/',
    protocolBinding: 'JSONRPC',
    protocolVersion: '1.0',
  }],
  capabilities: {
    streaming: false,
    pushNotifications: false,
    extendedAgentCard: false,
  },
  securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
  securityRequirements: [{ bearer: [] }],
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [{
    id: 'source.read',
    name: 'Source research',
    description: 'Read bounded sources.',
    tags: ['research'],
  }],
};

const calls: Array<{ url: URL; init: RequestInit }> = [];
const fetcher: A2ARemoteFetch = async (input, init = {}) => {
  const url = new URL(String(input));
  calls.push({ url, init });
  if (init.method === 'GET') return json(card);
  const headers = new Headers(init.headers);
  assert.equal(headers.get('authorization'), 'Bearer fixture-hermes-token');
  assert.equal(headers.get('a2a-version'), '1.0');
  const request = JSON.parse(String(init.body)) as {
    id: string;
    method: string;
    params: Record<string, unknown>;
  };
  if (request.method === 'SendMessage') {
    assert.deepEqual(request.params, {
      message: {
        messageId: 'message-1',
        role: 'ROLE_USER',
        contextId: 'hermes-context-1',
        parts: [{ text: 'Research the bounded topic.', mediaType: 'text/plain' }],
      },
    });
    return rpc(request.id, {
      task: {
        id: 'hermes-task-1',
        contextId: 'hermes-context-1',
        status: { state: 'TASK_STATE_SUBMITTED' },
      },
    });
  }
  if (request.method === 'GetTask') {
    assert.deepEqual(request.params, { id: 'hermes-task-1', historyLength: 0 });
    return rpc(request.id, {
      id: 'hermes-task-1',
      contextId: 'hermes-context-1',
      status: { state: 'TASK_STATE_COMPLETED' },
      artifacts: [{
        artifactId: 'artifact-1',
        name: 'research.md',
        parts: [{ text: '# Verified result', mediaType: 'text/markdown' }],
        metadata: {
          uri: 'https://artifacts.example.test/research.md',
          sha256: 'a'.repeat(64),
          auditRefs: ['hermes-audit-1'],
        },
      }],
    });
  }
  assert.equal(request.method, 'CancelTask');
  assert.deepEqual(request.params, { id: 'hermes-task-1' });
  return rpc(request.id, {
    id: 'hermes-task-1',
    contextId: 'hermes-context-1',
    status: { state: 'TASK_STATE_CANCELED' },
  });
};

const adapter = await createHermesA2AAdapter({
  providerId: 'hermes-a2a',
  origin: 'https://hermes.example.test',
  expectedPeerIdentity: 'Hermes Research Agent',
  credentialPrincipal: 'teamsapp-peer',
  credentialRef: 'HERMES_A2A_TOKEN',
  environment: { HERMES_A2A_TOKEN: 'fixture-hermes-token' },
  fetch: fetcher,
  requestTimeoutMs: 100,
});

const operation: ProviderRuntimeOperationInput = {
  scope: {
    tenantId: 'tenant-a',
    requesterId: 'requester-a',
    conversationId: 'conversation-a',
  },
  idempotencyKey: 'child-idempotency-1',
  requestHash: 'b'.repeat(64),
  payload: {
    prompt: 'Research the bounded topic.',
    messageId: 'message-1',
    contextId: 'hermes-context-1',
  },
  requestedCapabilities: ['source.read'],
  identities: {
    provider: { id: 'hermes-a2a' },
    credential: { principalId: 'teamsapp-peer', reference: 'env://HERMES_A2A_TOKEN' },
    execution: { id: 'hermes-execution-profile' },
    context: { id: 'hermes-context-1' },
    runtime: { boundaryId: 'hermes.example.test' },
    audit: { id: 'teams-audit-1' },
  },
  deadlineAtMs: Date.now() + 1_000,
  signal: new AbortController().signal,
};

const preflight = await adapter.preflight(operation);
assert.deepEqual(preflight, { ready: true, capabilities: ['source.read'] });

const submitted = await adapter.submit(operation);
assert.deepEqual(submitted, {
  rawState: 'TASK_STATE_SUBMITTED',
  providerExecutionId: 'hermes-task-1',
  providerContextId: 'hermes-context-1',
  providerCursor: 'message-1',
});

const receipt: ProviderAcceptedReceipt = {
  providerExecutionId: 'hermes-task-1',
  providerContextId: 'hermes-context-1',
  acceptedAt: '2026-09-03T00:00:00.000Z',
  rawState: 'TASK_STATE_SUBMITTED',
  reconciliationRef: 'message-1',
};
const completed = await adapter.get({ ...operation, receipt });
assert.equal(completed.rawState, 'TASK_STATE_COMPLETED');
assert.equal(completed.providerExecutionId, 'hermes-task-1');
assert.equal(completed.providerContextId, 'hermes-context-1');
assert.equal(completed.result, '# Verified result');
assert.deepEqual(completed.auditRefs, ['hermes-audit-1']);
assert.deepEqual(completed.artifacts, [{
  artifactId: 'artifact-1',
  name: 'research.md',
  mediaType: 'text/markdown',
  text: '# Verified result',
  uri: 'https://artifacts.example.test/research.md',
  sha256: 'a'.repeat(64),
}]);

const canceled = await adapter.cancel({ ...operation, receipt });
assert.equal(canceled.rawState, 'TASK_STATE_CANCELED');
assert.equal(adapter.classifyState('TASK_STATE_INPUT_REQUIRED'), 'input-required');
assert.equal(adapter.classifyState('TASK_STATE_AUTH_REQUIRED'), 'auth-required');
assert.equal(adapter.classifyState('TASK_STATE_FUTURE'), 'unknown');
assert.deepEqual(calls.map((call) => [call.url.pathname, call.init.method]), [
  ['/.well-known/agent-card.json', 'GET'],
  ['/', 'POST'],
  ['/', 'POST'],
  ['/', 'POST'],
]);

await testHermesConfigurationFailsClosed();
await testHermesTaskAndContextContinuityFailClosed();
await testAgentCardCacheUsesBoundedRevalidation();

console.log('hermes-a2a-adapter-test: PASS');

async function testHermesConfigurationFailsClosed(): Promise<void> {
  const baseOptions = {
    providerId: 'hermes-a2a',
    origin: 'https://hermes.example.test',
    expectedPeerIdentity: 'Hermes Research Agent',
    credentialPrincipal: 'teamsapp-peer',
    credentialRef: 'HERMES_A2A_TOKEN',
    environment: { HERMES_A2A_TOKEN: 'fixture-value' },
    fetch: async () => json(card),
  } as const;

  await assert.rejects(
    () => createHermesA2AAdapter({ ...baseOptions, origin: 'http://hermes.example.test' }),
    /HTTPS origin/,
  );
  await assert.rejects(
    () => createHermesA2AAdapter({
      ...baseOptions,
      fetch: async () => json({ ...card, name: 'Unexpected Agent' }),
    }),
    /peer identity/,
  );
  await assert.rejects(
    () => createHermesA2AAdapter({
      ...baseOptions,
      fetch: async () => json({
        ...card,
        supportedInterfaces: [{
          ...card.supportedInterfaces[0],
          url: 'https://drifted.example.test/',
        }],
      }),
    }),
    /configured origin/,
  );
  await assert.rejects(
    () => createHermesA2AAdapter({
      ...baseOptions,
      environment: {},
    }),
    /credential reference is unavailable/,
  );

  const noCapability = await createHermesA2AAdapter(baseOptions);
  const preflight = await noCapability.preflight({
    ...operation,
    requestedCapabilities: ['review.report'],
  });
  assert.equal(preflight.ready, false);
  if (!preflight.ready) assert.match(preflight.reason, /capabilit/i);
}

async function testHermesTaskAndContextContinuityFailClosed(): Promise<void> {
  const mismatch = await createHermesA2AAdapter({
    providerId: 'hermes-a2a',
    origin: 'https://hermes.example.test',
    expectedPeerIdentity: 'Hermes Research Agent',
    credentialPrincipal: 'teamsapp-peer',
    credentialRef: 'HERMES_A2A_TOKEN',
    environment: { HERMES_A2A_TOKEN: 'fixture-value' },
    fetch: async (input, init = {}) => {
      if (init.method === 'GET') return json(card);
      const request = JSON.parse(String(init.body)) as { id: string; method: string };
      if (request.method === 'SendMessage') {
        return rpc(request.id, {
          task: {
            id: 'hermes-task-mismatch',
            contextId: 'different-context',
            status: { state: 'TASK_STATE_SUBMITTED' },
          },
        });
      }
      return rpc(request.id, {
        id: 'different-task',
        contextId: 'hermes-context-1',
        status: { state: 'TASK_STATE_WORKING' },
      });
    },
  });
  await assert.rejects(() => mismatch.submit(operation), /context identity changed/);
  await assert.rejects(() => mismatch.get({ ...operation, receipt }), /task identity changed/);

  const direct = await createHermesA2AAdapter({
    providerId: 'hermes-a2a',
    origin: 'https://hermes.example.test',
    expectedPeerIdentity: 'Hermes Research Agent',
    credentialPrincipal: 'teamsapp-peer',
    credentialRef: 'HERMES_A2A_TOKEN',
    environment: { HERMES_A2A_TOKEN: 'fixture-value' },
    fetch: async (_input, init = {}) => {
      if (init.method === 'GET') return json(card);
      const request = JSON.parse(String(init.body)) as { id: string };
      return rpc(request.id, {
        message: {
          messageId: 'direct-1',
          role: 'ROLE_AGENT',
          contextId: 'hermes-context-1',
          parts: [{ text: 'not a durable task receipt', mediaType: 'text/plain' }],
        },
      });
    },
  });
  await assert.rejects(() => direct.submit(operation), /durable task receipt/);
}

async function testAgentCardCacheUsesBoundedRevalidation(): Promise<void> {
  let now = 1_000;
  let cardReads = 0;
  const cached = await createHermesA2AAdapter({
    providerId: 'hermes-a2a',
    origin: 'https://hermes.example.test',
    expectedPeerIdentity: 'Hermes Research Agent',
    credentialPrincipal: 'teamsapp-peer',
    credentialRef: 'HERMES_A2A_TOKEN',
    environment: { HERMES_A2A_TOKEN: 'fixture-value' },
    agentCardTtlMs: 50,
    now: () => now,
    fetch: async (_input, init = {}) => {
      assert.equal(init.method, 'GET');
      cardReads += 1;
      return json(card);
    },
  });
  assert.equal(cardReads, 1);
  await cached.preflight(operation);
  assert.equal(cardReads, 1, 'fresh Agent Card should be reused');
  now += 51;
  await cached.preflight(operation);
  assert.equal(cardReads, 2, 'expired Agent Card must be revalidated');
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function rpc(id: string, result: unknown): Response {
  return json({ jsonrpc: '2.0', id, result });
}
