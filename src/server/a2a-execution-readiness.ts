import type { A2AProviderFact } from './a2a-provider-facts.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;

export type A2AExecutionReadinessReason =
  | 'ready'
  | 'not-configured'
  | 'provider-not-registered'
  | 'provider-contract-invalid'
  | 'provider-identity-mismatch'
  | 'production-provider-required'
  | 'trusted-isolation-required'
  | 'scoped-authorization-required'
  | 'execution-boundary-required'
  | 'execution-handlers-required';

export type A2AExecutionReadiness = Readonly<{
  configured: boolean;
  runnable: boolean;
  reason: A2AExecutionReadinessReason;
}>;

/**
 * Evidence supplied by the trusted runtime composition for one provider.
 *
 * The contract intentionally carries no token, credential, or request scope.
 * `environment: 'production'` and `isolation: 'trusted'` are explicit
 * fail-closed attestations; local/test providers cannot become runnable by
 * merely appearing in the configured roster.
 */
export type A2AProductionProviderContract = Readonly<{
  agentId: string;
  providerId: string;
  environment: 'production' | 'local';
  isolation: 'trusted' | 'untrusted' | 'unknown';
  executionIdentity: string;
  executionBoundaryId: string;
  authorize: (...args: never[]) => unknown;
  authorizationPolicy: Readonly<{
    evaluate: (...args: never[]) => unknown;
  }>;
  executeChild: (...args: never[]) => unknown;
  cancelChild: (...args: never[]) => unknown;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function isRosterEntry(value: unknown): value is A2AProviderFact {
  return isRecord(value)
    && isSafeId(value.provider)
    && isSafeId(value.agentId)
    && isSafeId(value.providerId)
    && typeof value.configured === 'boolean';
}

function decision(
  configured: boolean,
  reason: A2AExecutionReadinessReason,
): A2AExecutionReadiness {
  return Object.freeze({
    configured,
    runnable: reason === 'ready',
    reason,
  });
}

/**
 * Evaluates readiness without turning roster configuration into execution
 * authority. A configured entry remains non-runnable until a matching,
 * production-only provider proves every execution boundary required by A2A.
 */
export function evaluateA2AExecutionReadiness(
  rosterEntry: A2AProviderFact | undefined,
  provider: A2AProductionProviderContract | undefined,
): A2AExecutionReadiness {
  if (!isRosterEntry(rosterEntry) || !rosterEntry.configured) return decision(false, 'not-configured');
  if (provider === undefined || provider === null) return decision(true, 'provider-not-registered');
  if (!isRecord(provider)) return decision(true, 'provider-contract-invalid');
  if (!isSafeId(provider.agentId) || !isSafeId(provider.providerId)) {
    return decision(true, 'provider-contract-invalid');
  }
  if (provider.agentId !== rosterEntry.agentId || provider.providerId !== rosterEntry.providerId) {
    return decision(true, 'provider-identity-mismatch');
  }
  if (provider.environment !== 'production') return decision(true, 'production-provider-required');
  if (provider.isolation !== 'trusted') return decision(true, 'trusted-isolation-required');
  if (
    !isSafeId(provider.executionIdentity)
    || !isSafeId(provider.executionBoundaryId)
  ) {
    return decision(true, 'execution-boundary-required');
  }
  if (
    typeof provider.authorize !== 'function'
    || !isRecord(provider.authorizationPolicy)
    || typeof provider.authorizationPolicy.evaluate !== 'function'
  ) {
    return decision(true, 'scoped-authorization-required');
  }
  if (typeof provider.executeChild !== 'function' || typeof provider.cancelChild !== 'function') {
    return decision(true, 'execution-handlers-required');
  }
  return decision(true, 'ready');
}
