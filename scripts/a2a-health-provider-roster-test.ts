import assert from 'node:assert/strict';

import { createA2AProviderFacts } from '../src/server/a2a-provider-facts.js';
import { deriveA2AExecutionReadiness } from '../src/server/a2a-execution-readiness.js';

assert.deepEqual(
  deriveA2AExecutionReadiness(
    [{ state: 'configured' }, { state: 'unavailable', reason: 'indexed worker failed preflight' }],
    ['codex-permission-profile'],
  ),
  { state: 'unavailable', reason: 'isolation-unavailable' },
  'one unavailable indexed worker must keep aggregate A2A health unavailable',
);

assert.deepEqual(
  deriveA2AExecutionReadiness(
    [{ state: 'configured' }, { state: 'configured' }],
    ['codex-permission-profile', 'codex-permission-profile'],
  ),
  { state: 'configured', providerId: 'codex-permission-profile' },
  'aggregate A2A health must preserve a single native provider identity when all workers pass',
);

const localProviders = [
  {
    provider: 'codex',
    agentId: 'teams-core-codex',
    providerId: 'codex-cli',
    configured: true,
    execution: 'configured',
  },
  {
    provider: 'copilot',
    agentId: 'teams-core-copilot',
    providerId: 'official-copilot-cli',
    configured: false,
    execution: 'unavailable',
    executionReason: 'isolation-unavailable',
  },
] as const;

const remote = {
  provider: 'remote',
  agentId: 'remote-reviewer',
  providerId: 'remote-a2a',
} as const;

assert.deepEqual(
  createA2AProviderFacts(localProviders, remote),
  [
    ...localProviders,
    {
      ...remote,
      configured: true,
      execution: 'unknown',
      executionReason: 'live-round-trip-unverified.',
    },
  ],
  'health and status rosters must expose a configured remote A2A identity without claiming live execution readiness',
);

assert.deepEqual(createA2AProviderFacts(localProviders), localProviders);

console.log('a2a-health-provider-roster-test: PASS');
