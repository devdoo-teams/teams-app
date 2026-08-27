import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { A2AScope } from '../src/server/a2a-contract.js';
import {
  createA2AProductionRuntime,
  type A2AProductionAgent,
} from '../src/server/a2a-production-runtime.js';
import { deriveChildIdempotencyKey } from '../src/server/a2a-orchestrator.js';
import { A2AStore } from '../src/server/a2a-store.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-multi-agent-dispatch-'));
const scope: A2AScope = {
  tenantId: 'tenant-a',
  requesterId: 'requester-a',
  conversationId: 'conversation-a',
};

try {
  await testParallelIndependentAgentsPersistIdentity();
  await testCrossRequesterCancellationIsRejected();
  console.log('a2a-multi-agent-dispatch-test: PASS');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

async function testParallelIndependentAgentsPersistIdentity(): Promise<void> {
  const storePath = path.join(root, 'parallel-identity.json');
  const store = new A2AStore(storePath);
  await store.initialize();
  const parent = await createParent(store, 'parallel-identity');
  const startedAgents: string[] = [];
  let peakConcurrency = 0;
  let activeExecutions = 0;
  let releaseBoth!: () => void;
  const bothStarted = new Promise<void>((resolve) => { releaseBoth = resolve; });

  const createAgent = (agentId: string, providerId: string, jobId: string): A2AProductionAgent => ({
    agentId,
    providerId,
    executionIdentity: `${agentId}-profile`,
    executionBoundaryId: `${agentId}-boundary`,
    authorize: () => true,
    executeChild: async (input) => {
      activeExecutions += 1;
      peakConcurrency = Math.max(peakConcurrency, activeExecutions);
      startedAgents.push(input.agentId);
      if (startedAgents.length === 2) releaseBoth();
      await bothStarted;
      await input.bindChild(jobId);
      activeExecutions -= 1;
      return { taskId: jobId, status: 'completed', result: `${agentId} result` };
    },
  });

  const runtime = createRuntime(store, [
    createAgent('codex-reviewer', 'codex-cli', 'job-review'),
    createAgent('copilot-tester', 'official-copilot-cli', 'job-tests'),
  ]);
  const result = await runtime.dispatchChildren({
    parentTask: parent,
    scope,
    requests: [
      { key: 'review', role: 'reviewer', prompt: 'Review the change.', agentId: 'codex-reviewer' },
      { key: 'tests', role: 'test-runner', prompt: 'Run the tests.', agentId: 'copilot-tester' },
    ],
    deadlineMs: 1_000,
    parallelism: 2,
  });

  assert.equal(result.completedChildren, 2);
  assert.equal(peakConcurrency, 2, 'independent child agents must overlap when parallelism permits');
  assert.deepEqual([...startedAgents].sort(), ['codex-reviewer', 'copilot-tester']);

  const reopened = new A2AStore(storePath);
  await reopened.initialize();
  const dispatch = reopened.getDispatchIntent(parent.id, scope);
  assert.equal(dispatch?.status, 'completed');
  assert.deepEqual(dispatch?.children.map((child) => ({
    childKey: child.childKey,
    agentId: child.agentId,
    providerId: child.providerId,
    executionIdentity: child.executionIdentity,
    executionBoundaryId: child.executionBoundaryId,
    agentJobId: child.agentJobId,
    status: child.status,
  })).sort((left, right) => left.childKey.localeCompare(right.childKey)), [
    {
      childKey: 'review',
      agentId: 'codex-reviewer',
      providerId: 'codex-cli',
      executionIdentity: 'codex-reviewer-profile',
      executionBoundaryId: 'codex-reviewer-boundary',
      agentJobId: 'job-review',
      status: 'completed',
    },
    {
      childKey: 'tests',
      agentId: 'copilot-tester',
      providerId: 'official-copilot-cli',
      executionIdentity: 'copilot-tester-profile',
      executionBoundaryId: 'copilot-tester-boundary',
      agentJobId: 'job-tests',
      status: 'completed',
    },
  ]);
}

async function testCrossRequesterCancellationIsRejected(): Promise<void> {
  const store = new A2AStore(path.join(root, 'conversation-authorization.json'));
  await store.initialize();
  const parent = await createParent(store, 'conversation-authorization');
  await store.createOrGetDispatchIntent({
    parentTaskId: parent.id,
    scope,
    requestFingerprint: 'cross-requester-cancellation',
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    children: [{
      childKey: 'review',
      childIdempotencyKey: deriveChildIdempotencyKey(parent.id, 'review'),
      role: 'reviewer',
      agentId: 'codex-reviewer',
      providerId: 'codex-cli',
      requestSha256: 'a'.repeat(64),
    }],
  });
  const runtime = createRuntime(store, []);
  const otherRequester = { ...scope, requesterId: 'requester-b' };

  await assert.rejects(
    runtime.cancelDispatch({ task: parent, authenticatedScope: otherRequester }),
    /scope|requester|owner/i,
    'a different authenticated requester must not mutate this durable dispatch',
  );
  assert.equal(
    store.getDispatchIntent(parent.id, scope)?.cancelRequestedAt,
    undefined,
    'rejected cross-conversation cancellation must leave the durable intent unchanged',
  );
}

function createRuntime(store: A2AStore, agents: readonly A2AProductionAgent[]) {
  return createA2AProductionRuntime({
    publicOrigin: 'https://runtime.example.test',
    appVersion: '1.0.77',
    store,
    authenticate: (_request, _response, next) => next(),
    resolveScope: () => scope,
    v026Execution: {
      submit: () => undefined,
      cancel: async ({ task }) => store.cancelTask(task.id, task.scope),
    },
    legacyOnTaskSubmitted: () => undefined,
    legacyOnTaskCancel: async ({ task }) => store.cancelTask(task.id, task.scope),
    coreA2A: { agents },
  });
}

async function createParent(store: A2AStore, suffix: string) {
  return store.createOrGetTask({
    scope,
    contextId: `context-${suffix}`,
    idempotencyKey: `parent-${suffix}`,
    fingerprint: `parent-${suffix}-fingerprint`,
    message: {
      messageId: `message-${suffix}`,
      role: 'user',
      parts: [{ text: 'Run independent durable children.' }],
    },
  });
}
