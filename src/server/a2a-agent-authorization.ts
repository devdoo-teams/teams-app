import type { A2AScope } from './a2a-contract.js';
import {
  A2A_CAPABILITIES,
  type A2ACapability,
} from './a2a-role-catalog.js';

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const MAX_GRANTS = 256;

export type A2AAgentAuthorizationInput = Readonly<{
  agentId: string;
  scope: A2AScope;
  role: string;
  capabilities?: readonly A2ACapability[];
}>;

export type A2AAgentAuthorizationGrant = Readonly<{
  tenantId: string;
  requesterId: string;
  conversationId: string;
  agentId: string;
  roles?: readonly string[];
  capabilities: readonly A2ACapability[];
}>;

export type A2AAgentAuthorizationDecision = Readonly<{
  allowed: boolean;
  reason: 'grant-matched' | 'policy-matched' | 'no-grant' | 'invalid-input' | 'policy-error';
}>;

export type A2AAgentAuthorizationPolicy = Readonly<{
  readonly evaluate: (input: A2AAgentAuthorizationInput) => A2AAgentAuthorizationDecision;
  readonly source: 'grants' | 'callback';
}>;

type PolicyOptions = Readonly<{
  grants?: readonly A2AAgentAuthorizationGrant[];
  authorize?: (input: A2AAgentAuthorizationInput) => boolean;
}>;

function invalid(message: string): never {
  throw new TypeError(`A2A authorization policy ${message}`);
}

function boundedId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !OPAQUE_ID.test(value) || value === '*') {
    invalid(`${field} must be a bounded non-wildcard identifier.`);
  }
  return value;
}

function boundedStringList(value: readonly string[] | undefined, field: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 32) invalid(`${field} must be a bounded array.`);
  const normalized = [...new Set(value.map((entry) => boundedId(entry, field)))].sort();
  return Object.freeze(normalized);
}

function capabilities(value: readonly A2ACapability[], field: string): readonly A2ACapability[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > A2A_CAPABILITIES.length) {
    invalid(`${field} must contain at least one bounded capability.`);
  }
  const normalized = [...new Set(value)];
  if (normalized.some((entry) => !A2A_CAPABILITIES.includes(entry))) {
    invalid(`${field} contains an unknown capability.`);
  }
  return Object.freeze([...normalized].sort()) as readonly A2ACapability[];
}

function normalizeGrant(grant: A2AAgentAuthorizationGrant): A2AAgentAuthorizationGrant {
  if (!grant || typeof grant !== 'object') invalid('grant must be an object.');
  return Object.freeze({
    tenantId: boundedId(grant.tenantId, 'tenantId'),
    requesterId: boundedId(grant.requesterId, 'requesterId'),
    conversationId: boundedId(grant.conversationId, 'conversationId'),
    agentId: boundedId(grant.agentId, 'agentId'),
    ...(grant.roles === undefined ? {} : { roles: boundedStringList(grant.roles, 'roles') }),
    capabilities: capabilities(grant.capabilities, 'capabilities'),
  });
}

function matchesGrant(grant: A2AAgentAuthorizationGrant, input: A2AAgentAuthorizationInput): boolean {
  if (grant.tenantId !== input.scope.tenantId
    || grant.requesterId !== input.scope.requesterId
    || grant.conversationId !== input.scope.conversationId
    || grant.agentId !== input.agentId) return false;
  if (grant.roles && !grant.roles.includes(input.role)) return false;
  const requested = input.capabilities ?? [];
  return requested.every((capability) => grant.capabilities.includes(capability));
}

function validateInput(input: A2AAgentAuthorizationInput): boolean {
  if (!input || typeof input !== 'object') return false;
  return [
    input.agentId,
    input.scope?.tenantId,
    input.scope?.requesterId,
    input.scope?.conversationId,
    input.role,
  ].every((value) => typeof value === 'string' && OPAQUE_ID.test(value) && value !== '*');
}

/**
 * Creates an explicit, fail-closed authorization policy for independent A2A
 * agents. Static grants bind all identity dimensions; callback policies are
 * reserved for a server-owned policy that performs the same checks from
 * validated claims and configuration. No wildcard or credential is accepted.
 */
export function createA2AAgentAuthorizationPolicy(options: PolicyOptions): A2AAgentAuthorizationPolicy {
  const hasGrants = options.grants !== undefined;
  const hasCallback = options.authorize !== undefined;
  if (hasGrants === hasCallback) invalid('must provide exactly one grants or authorize source.');

  if (hasCallback) {
    const authorize = options.authorize!;
    return Object.freeze({
      source: 'callback',
      evaluate(input) {
        if (!validateInput(input)) return { allowed: false, reason: 'invalid-input' };
        try {
          return authorize(input)
            ? { allowed: true, reason: 'policy-matched' }
            : { allowed: false, reason: 'no-grant' };
        } catch {
          return { allowed: false, reason: 'policy-error' };
        }
      },
    });
  }

  if (!Array.isArray(options.grants) || options.grants.length === 0 || options.grants.length > MAX_GRANTS) {
    invalid('grants must be a bounded non-empty array.');
  }
  const grants = Object.freeze(options.grants.map(normalizeGrant));
  return Object.freeze({
    source: 'grants',
    evaluate(input) {
      if (!validateInput(input)) return { allowed: false, reason: 'invalid-input' };
      return grants.some((grant) => matchesGrant(grant, input))
        ? { allowed: true, reason: 'grant-matched' }
        : { allowed: false, reason: 'no-grant' };
    },
  });
}

export function evaluateA2AAgentAuthorization(
  policy: A2AAgentAuthorizationPolicy,
  input: A2AAgentAuthorizationInput,
): A2AAgentAuthorizationDecision {
  return policy.evaluate(input);
}
