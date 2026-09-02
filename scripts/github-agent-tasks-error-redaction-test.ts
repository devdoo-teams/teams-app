import assert from 'node:assert/strict';

import {
  GitHubAgentTasksRequestError,
  createGitHubAgentTasksAdapter,
} from '../src/server/providers/github-agent-tasks-adapter.js';
import type { ProviderRuntimeOperationInput } from '../src/server/provider-runtime-adapter.js';

const secrets = Object.freeze({
  bearer: 'ghp_fixtureAuthorizationToken123456789',
  vault: 'fixture-vault-secret-123456789',
  env: 'fixture-env-secret-987654321',
  path: '/private/tmp/github/token-fixture-path-secret-456789',
});

const opaqueReference = 'key-vault://github/user-token';
const leakingDiagnostic = [
  `Authorization: Bearer ${secrets.bearer}`,
  `vaultSecret=${secrets.vault}`,
  `process.env.GITHUB_TOKEN=${secrets.env}`,
  `tokenPath=${secrets.path}`,
  `reference=${opaqueReference}`,
].join(' ');

const input = {
  scope: { tenantId: 'tenant', requesterId: 'requester', conversationId: 'conversation' },
  idempotencyKey: 'idem-redaction',
  requestHash: 'd'.repeat(64),
  payload: { repository: 'octo/repo', prompt: 'Fix the bug', createPullRequest: true },
  requestedCapabilities: ['agent-tasks'],
  identities: {
    provider: { id: 'github-agent-tasks' },
    credential: { principalId: 'github-user', reference: opaqueReference },
    execution: { id: 'execution-redaction' },
    context: { id: 'context-redaction' },
    runtime: { boundaryId: 'runtime-redaction' },
    audit: { id: 'audit-redaction' },
  },
  deadlineAtMs: Date.now() + 10_000,
  signal: new AbortController().signal,
} satisfies ProviderRuntimeOperationInput;

class CredentialResolverFailure extends Error {
  readonly status = 503;
  readonly retryGuidance = Object.freeze({ retryAfterMs: 2_000 });

  constructor() {
    super(leakingDiagnostic);
    this.name = 'CredentialResolverFailure';
  }
}

function assertProjectedDiagnostic(value: unknown, label: string): void {
  const serialized = value instanceof Error
    ? `${value.name} ${value.message} ${value.stack ?? ''} ${JSON.stringify(value)}`
    : JSON.stringify(value);
  for (const secret of Object.values(secrets)) {
    assert.equal(serialized.includes(secret), false, `${label} leaked ${secret}`);
  }
  assert.equal(serialized.includes(opaqueReference), true, `${label} must preserve the opaque credential reference`);
  assert.equal(serialized.length <= 4_500, true, `${label} must remain bounded`);
}

const resolverAdapter = createGitHubAgentTasksAdapter({
  fetch: async () => Response.json({ full_name: 'octo/repo' }),
  resolveUserToken: async () => { throw new CredentialResolverFailure(); },
});

const resolverFailure = await resolverAdapter.preflight(input).then(
  () => undefined,
  (error: unknown) => error,
);
assert.ok(resolverFailure instanceof Error);
assert.equal(resolverFailure.name, 'CredentialResolverFailure');
assert.equal((resolverFailure as Error & { status?: number }).status, 503);
assert.deepEqual(
  (resolverFailure as Error & { retryGuidance?: unknown }).retryGuidance,
  { retryAfterMs: 2_000 },
);
assertProjectedDiagnostic(resolverFailure, 'credential resolver exception');

const readinessAdapter = createGitHubAgentTasksAdapter({
  fetch: async () => Response.json({ full_name: 'octo/repo' }),
  resolveUserToken: async () => 'transient-fixture-token',
  verifyExecutionReadiness: async () => ({ ready: false, reason: leakingDiagnostic.repeat(200) }),
});
const readiness = await readinessAdapter.preflight(input);
assert.equal(readiness.ready, false);
if (readiness.ready) throw new Error('fixture expected readiness failure');
assert.match(readiness.reason, /^configured-unverified: /u);
assertProjectedDiagnostic(readiness.reason, 'readiness reason');

const fetchAdapter = createGitHubAgentTasksAdapter({
  fetch: async () => { throw new Error(leakingDiagnostic); },
  resolveUserToken: async () => 'transient-fixture-token',
});
const fetchFailure = await fetchAdapter.preflight(input).then(
  () => undefined,
  (error: unknown) => error,
);
assert.ok(fetchFailure instanceof Error);
assert.equal(fetchFailure.name, 'Error');
assertProjectedDiagnostic(fetchFailure, 'HTTP transport exception');

const rateLimitAdapter = createGitHubAgentTasksAdapter({
  fetch: async () => new Response(leakingDiagnostic, {
    status: 429,
    headers: { 'retry-after': '3', 'x-poll-interval': '7' },
  }),
  resolveUserToken: async () => 'transient-fixture-token',
});
const rateLimitFailure = await rateLimitAdapter.preflight(input).then(
  () => undefined,
  (error: unknown) => error,
);
assert.ok(rateLimitFailure instanceof GitHubAgentTasksRequestError);
assert.equal(rateLimitFailure.status, 429);
assert.deepEqual(rateLimitFailure.retryGuidance, { pollIntervalMs: 7_000, retryAfterMs: 3_000 });
assert.equal(rateLimitFailure.message, 'GitHub API request failed with HTTP 429.');

console.log('PASS: GitHub Agent Tasks diagnostics redact credentials while preserving stable failure metadata');
