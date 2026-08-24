import assert from 'node:assert/strict';

import { createCoreAgentCard, createCoreOfficialAgentCard } from '../src/server/a2a-contract.js';
import {
  A2A_LATEST_REQUIRED_CONTRACT,
  A2A_V026_REQUIRED_CONTRACT,
  auditA2ALatestCompatibility,
  auditA2AV026Compatibility,
} from '../src/server/a2a-official-contract-audit.js';

const currentCoreCard = createCoreAgentCard({
  agentId: 'teams-core',
  name: 'Teams Core Agent',
  description: 'Current custom Teams Core A2A surface.',
  version: '1.0.45',
  endpoint: 'https://core.example.test/a2a',
});

const currentAudit = auditA2AV026Compatibility({
  agentCard: currentCoreCard,
  discoveryPath: '/.well-known/agent-card.json',
  jsonRpcEndpointPath: '/message:send',
  supportedRpcMethods: [],
  requiresHttpAuth: true,
  taskModel: {
    statusShape: 'flat-status',
    artifactShape: 'artifact-ref',
  },
});

assert.equal(currentAudit.compatible, false);
assert.deepEqual(
  currentAudit.issues.map((issue) => issue.code),
  [
    'agent-card.discovery-path',
    'agent-card.protocol-version',
    'agent-card.shape',
    'transport.json-rpc',
    'transport.auth-declaration',
    'tasks.status-shape',
    'tasks.artifact-shape',
  ],
);
assert.equal(currentAudit.externalInteropClaimAllowed, false);
assert.equal(currentAudit.requiredContract.protocolVersion, '0.2.6');
assert.equal(A2A_V026_REQUIRED_CONTRACT.transport, 'JSON-RPC 2.0 over HTTP(S)');

const officialJsonRpcCard = {
  protocolVersion: '0.2.6',
  name: 'Teams Core Agent',
  description: 'A JSON-RPC A2A fixture for contract auditing.',
  url: 'https://core.example.test/a2a',
  preferredTransport: 'JSONRPC',
  version: '1.0.45',
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: false,
  },
  securitySchemes: {
    bearer: {
      type: 'http',
      scheme: 'bearer',
    },
  },
  security: [{ bearer: [] }],
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [{
    id: 'teams-core-tasks',
    name: 'Teams Core tasks',
    description: 'Bounded authenticated task execution with polling.',
    tags: ['teams', 'tasks'],
  }],
};

const officialAudit = auditA2AV026Compatibility({
  agentCard: officialJsonRpcCard,
  discoveryPath: '/.well-known/agent.json',
  jsonRpcEndpointPath: '/a2a',
  supportedRpcMethods: ['message/send', 'tasks/get', 'tasks/cancel'],
  requiresHttpAuth: true,
  taskModel: {
    statusShape: 'status-object-state',
    artifactShape: 'artifact-parts',
  },
});

assert.equal(officialAudit.compatible, true);
assert.deepEqual(officialAudit.issues, []);
assert.equal(officialAudit.externalInteropClaimAllowed, true);

const latestCard = createCoreOfficialAgentCard({
  name: 'Teams Core Agent',
  description: 'Current A2A 1.0 JSON-RPC fixture.',
  version: '1.0.46',
  endpoint: 'https://core.example.test/a2a/v1',
  securitySchemes: {
    teamsOAuth: {
      oauth2SecurityScheme: {
        flows: {
          authorizationCode: {
            authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
            tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
            scopes: { access_as_user: 'Delegated Teams user access.' },
          },
        },
      },
    },
  },
  securityRequirements: [{ teamsOAuth: ['access_as_user'] }],
});
const latestAudit = auditA2ALatestCompatibility({
  agentCard: latestCard,
  discoveryPath: '/.well-known/agent-card.json',
  jsonRpcEndpointPath: '/a2a/v1',
  supportedRpcMethods: ['SendMessage', 'GetTask', 'ListTasks', 'CancelTask'],
  requiresHttpAuth: true,
  supportsVersionHeader: true,
  taskModel: {
    statusShape: 'task-state',
    artifactShape: 'official-parts',
    sendResponseShape: 'task-wrapper',
  },
});
assert.equal(latestAudit.compatible, true);
assert.equal(latestAudit.externalInteropClaimAllowed, true);
assert.deepEqual(latestAudit.issues, []);
assert.equal(latestAudit.requiredContract.protocolVersion, '1.0');
assert.deepEqual(latestAudit.requiredContract.requiredRpcMethods, ['SendMessage', 'GetTask', 'ListTasks', 'CancelTask']);

const incompleteLatestAudit = auditA2ALatestCompatibility({
  agentCard: latestCard,
  discoveryPath: '/.well-known/agent-card.json',
  jsonRpcEndpointPath: '/a2a/v1',
  supportedRpcMethods: ['SendMessage', 'GetTask', 'CancelTask'],
  requiresHttpAuth: true,
  supportsVersionHeader: false,
  taskModel: {
    statusShape: 'task-state',
    artifactShape: 'official-parts',
    sendResponseShape: 'task-wrapper',
  },
});
assert.equal(incompleteLatestAudit.compatible, false);
assert.equal(incompleteLatestAudit.externalInteropClaimAllowed, false);
assert.deepEqual(incompleteLatestAudit.issues.map((issue) => issue.code), [
  'transport.json-rpc',
  'transport.version-header',
]);
assert.equal(A2A_LATEST_REQUIRED_CONTRACT.discoveryPath, '/.well-known/agent-card.json');

console.log('a2a-official-contract-audit-test: PASS');
