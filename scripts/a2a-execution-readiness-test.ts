import assert from 'node:assert/strict';

import {
  evaluateA2AExecutionReadiness,
  type A2AExecutionReadiness,
  type A2AProductionProviderContract,
} from '../src/server/a2a-execution-readiness.js';

const rosterEntry = {
  provider: 'codex',
  agentId: 'teams-core-codex',
  providerId: 'codex-cli',
  configured: true,
  execution: 'configured',
} as const;

assert.deepEqual(
  evaluateA2AExecutionReadiness(rosterEntry, undefined),
  {
    configured: true,
    runnable: false,
    reason: 'provider-not-registered',
  },
  'a configured roster entry must not be reported as runnable without a registered provider',
);

const productionProvider: A2AProductionProviderContract = {
  agentId: rosterEntry.agentId,
  providerId: rosterEntry.providerId,
  environment: 'production',
  isolation: 'trusted',
  executionIdentity: 'teams-core-codex',
  executionBoundaryId: 'teams-core-codex-runner',
  authorize: (..._args: never[]) => true,
  authorizationPolicy: {
    evaluate: (..._args: never[]) => ({ allowed: true }),
  },
  executeChild: (..._args: never[]) => Promise.resolve(undefined),
  cancelChild: (..._args: never[]) => Promise.resolve(undefined),
};

function assertReadiness(
  provider: A2AProductionProviderContract | undefined,
  expected: A2AExecutionReadiness,
  message: string,
): void {
  assert.deepEqual(evaluateA2AExecutionReadiness(rosterEntry, provider), expected, message);
}

function alteredProvider(overrides: Record<string, unknown>): A2AProductionProviderContract {
  return { ...productionProvider, ...overrides } as unknown as A2AProductionProviderContract;
}

assertReadiness(
  productionProvider,
  { configured: true, runnable: true, reason: 'ready' },
  'only a matching production provider with trusted isolation and handlers is runnable',
);
assert.ok(Object.isFrozen(evaluateA2AExecutionReadiness(rosterEntry, productionProvider)));

assertReadiness(
  alteredProvider({ environment: 'local' }),
  { configured: true, runnable: false, reason: 'production-provider-required' },
  'local or test execution providers must remain unavailable to the production contract',
);
assertReadiness(
  alteredProvider({ isolation: 'unknown' }),
  { configured: true, runnable: false, reason: 'trusted-isolation-required' },
  'unknown isolation must fail closed',
);
assertReadiness(
  alteredProvider({ agentId: 'other-agent' }),
  { configured: true, runnable: false, reason: 'provider-identity-mismatch' },
  'a provider for another registered identity must not satisfy this roster entry',
);
assertReadiness(
  alteredProvider({ executionBoundaryId: '' }),
  { configured: true, runnable: false, reason: 'execution-boundary-required' },
  'a provider without a stable execution boundary is not runnable',
);
assertReadiness(
  alteredProvider({ authorizationPolicy: undefined }),
  { configured: true, runnable: false, reason: 'scoped-authorization-required' },
  'a provider without a scoped authorization policy is not runnable',
);
assertReadiness(
  alteredProvider({ cancelChild: undefined }),
  { configured: true, runnable: false, reason: 'execution-handlers-required' },
  'a provider without a cancellation handler is not runnable',
);
assertReadiness(
  alteredProvider({ bearerToken: 'must-not-be-copied' }),
  { configured: true, runnable: true, reason: 'ready' },
  'readiness must ignore credentials rather than copy them into its result',
);

assert.deepEqual(
  evaluateA2AExecutionReadiness(undefined, productionProvider),
  { configured: false, runnable: false, reason: 'not-configured' },
  'a provider cannot make an absent roster entry runnable',
);

assert.deepEqual(
  evaluateA2AExecutionReadiness({ ...rosterEntry, configured: false }, productionProvider),
  { configured: false, runnable: false, reason: 'not-configured' },
  'an explicitly unconfigured roster entry must remain unavailable even with a provider object',
);

console.log('a2a-execution-readiness-test: PASS');
