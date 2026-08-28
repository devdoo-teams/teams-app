import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { A2AScope } from '../src/server/a2a-contract.js';
import {
  createA2AAgentAuthorizationPolicy,
  evaluateA2AAgentAuthorization,
  type A2AAgentAuthorizationInput,
} from '../src/server/a2a-agent-authorization.js';
import {
  createA2AProductionRuntime,
  type A2AProductionAgent,
} from '../src/server/a2a-production-runtime.js';
import { A2AStore } from '../src/server/a2a-store.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-agent-authorization-'));
const scope: A2AScope = {
  tenantId: 'tenant-a',
  requesterId: 'requester-a',
  conversationId: 'conversation-a',
};

try {
  testPolicyRequiresAllIdentityDimensionsAndCapabilitySubset();
  testPolicyRejectsWildcardsAndMalformedGrants();
  await testScopedPolicyOverridesLegacyAuthorizeCallback();
  testProductionRegistrationFailsClosedWithoutScopedPolicy();
  console.log('a2a-agent-authorization-policy-test: PASS');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

function testPolicyRequiresAllIdentityDimensionsAndCapabilitySubset(): void {
  const policy = createA2AAgentAuthorizationPolicy({
    grants: [{
      tenantId: scope.tenantId,
      requesterId: scope.requesterId,
      conversationId: scope.conversationId,
      agentId: 'review-agent',
      roles: ['reviewer'],
      capabilities: ['review.report', 'source.read'],
    }],
  });
  const input: A2AAgentAuthorizationInput = {
    agentId: 'review-agent',
    scope,
    role: 'reviewer',
    capabilities: ['source.read'],
  };

  assert.equal(evaluateA2AAgentAuthorization(policy, input).allowed, true);
  assert.equal(evaluateA2AAgentAuthorization(policy, {
    ...input,
    scope: { ...scope, tenantId: 'tenant-b' },
  }).allowed, false);
  assert.equal(evaluateA2AAgentAuthorization(policy, {
    ...input,
    scope: { ...scope, requesterId: 'requester-b' },
  }).allowed, false);
  assert.equal(evaluateA2AAgentAuthorization(policy, {
    ...input,
    scope: { ...scope, conversationId: 'conversation-b' },
  }).allowed, false);
  assert.equal(evaluateA2AAgentAuthorization(policy, {
    ...input,
    agentId: 'test-agent',
  }).allowed, false);
  assert.equal(evaluateA2AAgentAuthorization(policy, {
    ...input,
    capabilities: ['source.read', 'tests.run'],
  }).allowed, false);
  assert.equal(evaluateA2AAgentAuthorization(policy, {
    ...input,
    role: 'test-runner',
  }).allowed, false);
}

function testPolicyRejectsWildcardsAndMalformedGrants(): void {
  assert.throws(
    () => createA2AAgentAuthorizationPolicy({
      grants: [{
        tenantId: '*',
        requesterId: scope.requesterId,
        conversationId: scope.conversationId,
        agentId: 'review-agent',
        capabilities: ['source.read'],
      }],
    }),
    /wildcard|bounded|identity/i,
  );
  assert.throws(
    () => createA2AAgentAuthorizationPolicy({
      grants: [{
        tenantId: scope.tenantId,
        requesterId: scope.requesterId,
        conversationId: scope.conversationId,
        agentId: 'review-agent',
        capabilities: ['not-a-core-capability'],
      }],
    }),
    /capabilit/i,
  );
}

async function testScopedPolicyOverridesLegacyAuthorizeCallback(): Promise<void> {
  const store = new A2AStore(path.join(root, 'policy-precedence.json'));
  await store.initialize();
  const parent = await store.createOrGetTask({
    scope,
    contextId: 'context-policy-precedence',
    idempotencyKey: 'parent-policy-precedence',
    fingerprint: 'parent-policy-precedence-fingerprint',
    message: {
      messageId: 'message-policy-precedence',
      role: 'user',
      parts: [{ text: 'Run the bounded child.' }],
    },
  });
  let executions = 0;
  const agent: A2AProductionAgent = {
    agentId: 'review-agent',
    providerId: 'review-provider',
    // This legacy callback would allow the request, but the explicit policy must win.
    authorize: () => true,
    authorizationPolicy: createA2AAgentAuthorizationPolicy({
      grants: [{
        tenantId: scope.tenantId,
        requesterId: 'different-requester',
        conversationId: scope.conversationId,
        agentId: 'review-agent',
        roles: ['reviewer'],
        capabilities: ['review.report', 'source.read'],
      }],
    }),
    executeChild: async () => {
      executions += 1;
      return { taskId: 'must-not-run', status: 'completed', result: 'must not run' };
    },
  };
  const runtime = createA2AProductionRuntime({
    publicOrigin: 'https://runtime.example.test',
    appVersion: '1.0.67',
    store,
    authenticate: (_request, _response, next) => next(),
    resolveScope: () => scope,
    v026Execution: {
      submit: () => undefined,
      cancel: async ({ task }) => store.cancelTask(task.id, task.scope),
    },
    legacyOnTaskSubmitted: () => undefined,
    legacyOnTaskCancel: async ({ task }) => store.cancelTask(task.id, task.scope),
    coreA2A: { agents: [agent] },
  });

  await assert.rejects(
    runtime.dispatchChildren({
      parentTask: parent,
      scope,
      requests: [{
        key: 'review',
        role: 'reviewer',
        capabilities: ['source.read'],
        prompt: 'Review the bounded change.',
        agentId: 'review-agent',
      }],
      deadlineMs: 1_000,
      parallelism: 1,
    }),
    /not authorized|authorization/i,
  );
  assert.equal(executions, 0);
  assert.equal(store.getTask(parent.id, scope)?.status, 'submitted');
}

function testProductionRegistrationFailsClosedWithoutScopedPolicy(): void {
  const store = new A2AStore(path.join(root, 'production-registration.json'));
  const legacyOnlyAgent = {
    agentId: 'legacy-only-agent',
    providerId: 'legacy-provider',
    authorize: () => true,
    executeChild: async () => ({ taskId: 'must-not-run', status: 'completed' as const, result: 'must not run' }),
  } satisfies A2AProductionAgent;

  assert.throws(
    () => createA2AProductionRuntime({
      publicOrigin: 'https://runtime.example.test',
      appVersion: '1.0.67',
      store,
      authenticate: (_request, _response, next) => next(),
      resolveScope: () => scope,
      v026Execution: {
        submit: () => undefined,
        cancel: async ({ task }) => store.cancelTask(task.id, task.scope),
      },
      legacyOnTaskSubmitted: () => undefined,
      legacyOnTaskCancel: async ({ task }) => store.cancelTask(task.id, task.scope),
      coreA2A: { agents: [legacyOnlyAgent] },
      requireScopedAgentAuthorization: true,
    }),
    /scoped.*authorization|authorization.*policy/i,
  );
}
