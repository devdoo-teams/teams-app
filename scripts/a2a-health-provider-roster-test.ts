import assert from 'node:assert/strict';

import { createA2AProviderFacts } from '../src/server/a2a-provider-facts.js';

const localProviders = [
  {
    provider: 'codex',
    agentId: 'teams-core-codex',
    providerId: 'codex-cli',
    configured: true,
  },
  {
    provider: 'copilot',
    agentId: 'teams-core-copilot',
    providerId: 'official-copilot-cli',
    configured: false,
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
    { ...remote, configured: true },
  ],
  'health and status rosters must expose a configured remote A2A identity',
);

assert.deepEqual(createA2AProviderFacts(localProviders), localProviders);

console.log('a2a-health-provider-roster-test: PASS');
