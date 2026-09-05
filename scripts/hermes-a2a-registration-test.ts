import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createA2AAgentAuthorizationPolicy } from '../src/server/a2a-agent-authorization.js';
import type { A2ARemoteAgentCard, A2ARemoteFetch } from '../src/server/a2a-remote-client.js';
import type { A2ARemotePeerConfig } from '../src/server/a2a-remote-roster.js';
import { createConfiguredHermesA2AAgents } from '../src/server/hermes-a2a-registration.js';
import { FileProviderLifecycleStore } from '../src/server/provider-lifecycle-runner.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hermes-registration-'));
try {
  const store = new FileProviderLifecycleStore(path.join(root, 'provider-lifecycle.json'));
  await store.initialize();
  const peers = [
    peer('hermes-ready', 'Hermes Ready', 'READY_TOKEN'),
    peer('hermes-broken', 'Hermes Broken', 'BROKEN_TOKEN'),
  ];
  const result = await createConfiguredHermesA2AAgents({
    peers,
    store,
    environment: {
      READY_TOKEN: 'fixture-ready-token',
      BROKEN_TOKEN: 'fixture-broken-token',
    },
    authorizationPolicyFor: (agentId) => createA2AAgentAuthorizationPolicy({
      authorize: (input) => input.agentId === agentId,
    }),
    fetchForPeer: (configured) => cardFetch(configured.agentId === 'hermes-ready'
      ? card(configured.endpoint, configured.expectedPeerIdentity!)
      : card(configured.endpoint, 'Unexpected Peer')),
  });

  assert.deepEqual(result.agents.map((agent) => agent.agentId), ['hermes-ready']);
  assert.deepEqual(result.failures, [{
    agentId: 'hermes-broken',
    providerId: 'hermes-broken-provider',
    kind: 'hermes',
    code: 'CONFIGURATION_ERROR',
  }]);
  assert.equal(JSON.stringify(result).includes('fixture-ready-token'), false);
  assert.equal(JSON.stringify(result).includes('fixture-broken-token'), false);
  console.log('hermes-a2a-registration-test: PASS');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

function peer(agentId: string, expectedPeerIdentity: string, tokenEnv: string): A2ARemotePeerConfig {
  return {
    agentId,
    providerId: `${agentId}-provider`,
    kind: 'hermes',
    endpoint: `https://${agentId}.example.test/`,
    tokenEnv,
    executionIdentity: `${agentId}-execution`,
    executionBoundaryId: `${agentId}-boundary`,
    roles: ['reviewer'],
    capabilities: ['source.read', 'review.report'],
    expectedPeerIdentity,
    credentialPrincipal: `${agentId}-caller`,
  };
}

function card(endpoint: string, name: string): A2ARemoteAgentCard {
  return {
    name,
    description: 'Fixture card.',
    version: '1.0.0',
    supportedInterfaces: [{ url: endpoint, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
    capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    securityRequirements: [{ bearer: [] }],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [{ id: 'source.read', name: 'Read', description: 'Read.', tags: ['review.report'] }],
  };
}

function cardFetch(value: A2ARemoteAgentCard): A2ARemoteFetch {
  return async (_input, init = {}) => {
    assert.equal(init.method, 'GET', 'registration performs Agent Card preflight only');
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}
