import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { A2AScope } from '../src/server/a2a-contract.js';
import { createA2AProductionRuntime } from '../src/server/a2a-production-runtime.js';
import { A2A_CAPABILITIES } from '../src/server/a2a-role-catalog.js';
import { A2AStore } from '../src/server/a2a-store.js';
import { createA2AAgentAuthorizationPolicy } from '../src/server/a2a-agent-authorization.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-execution-gate-'));
const scope: A2AScope = {
  tenantId: 'tenant-a',
  requesterId: 'requester-a',
  conversationId: 'conversation-a',
};

try {
  const store = new A2AStore(path.join(root, 'a2a.json'));
  await store.initialize();
  const runtime = createA2AProductionRuntime({
    publicOrigin: 'https://runtime.example.test',
    appVersion: '1.0.79',
    store,
    authenticate: (_request, _response, next) => next(),
    resolveScope: () => scope,
    v026Execution: {
      submit: () => undefined,
      cancel: async ({ task }) => store.cancelTask(task.id, task.scope),
    },
    legacyOnTaskSubmitted: () => undefined,
    legacyOnTaskCancel: async ({ task }) => store.cancelTask(task.id, task.scope),
    coreA2A: {
      agents: [{
        agentId: 'teams-core-codex',
        providerId: 'codex-cli',
        executionIdentity: 'teams-core-codex',
        executionBoundaryId: 'teams-core-codex-runner',
        executionReady: false,
        executionUnavailableReason: 'native-isolation-not-configured',
        roles: ['reviewer'],
        capabilities: ['review.report', 'source.read'],
        authorize: () => true,
        authorizationPolicy: createA2AAgentAuthorizationPolicy({ authorize: () => true }),
        executeChild: async () => ({ taskId: 'unexpected', status: 'completed', result: 'unexpected' }),
      }],
      defaultAgentId: 'teams-core-codex',
    },
    requireScopedAgentAuthorization: true,
  });

  const started = await runtime.startCollaboration({
    scope,
    prompt: 'Run a read-only review.',
    requestedRoles: ['reviewer'],
    idempotencyKey: 'execution-unavailable',
    deadlineMs: 1_000,
    parallelism: 1,
  });
  assert.equal(started.status, 'blocked');
  assert.equal(started.parentTask, undefined, 'unavailable execution must not create a durable parent task');
  assert.match(started.plan.blockedReason ?? '', /native-isolation-not-configured/i);
  assert.equal((await started.completion).status, 'blocked');

  console.log('a2a-execution-gate-test: PASS');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
