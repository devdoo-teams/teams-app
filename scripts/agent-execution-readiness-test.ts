import assert from 'node:assert/strict';

import { createProductionAgentExecutionPolicy } from '../src/server/production-agent-isolation.js';

const unavailable = createProductionAgentExecutionPolicy({
  sourceWorkspace: '/private/tmp/teams-source',
  isProduction: true,
  canReadScope: () => true,
});

assert.deepEqual(
  unavailable.readOnlyExecutionReadiness(),
  {
    state: 'unavailable',
    reason: 'isolation-unavailable',
  },
  'production health must expose that A2A execution is unavailable when native isolation is not configured',
);

const configured = createProductionAgentExecutionPolicy({
  sourceWorkspace: '/private/tmp/teams-source',
  isProduction: true,
  platform: 'darwin',
  codexHome: '/private/tmp/teams-codex-home',
  codexExecutable: '/private/tmp/codex',
  codexExecutableSha256: 'a'.repeat(64),
  nativePreflight: async () => undefined,
  canReadScope: () => true,
});

assert.deepEqual(
  configured.readOnlyExecutionReadiness(),
  {
    state: 'configured',
    providerId: 'codex-permission-profile',
  },
  'configured native isolation must be visible without claiming that a per-job preflight already passed',
);

console.log('agent-execution-readiness-test: PASS');
