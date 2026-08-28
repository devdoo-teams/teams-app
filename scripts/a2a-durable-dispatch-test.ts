import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { AgentService } from '../src/server/agent-service.js';
import type { A2AScope } from '../src/server/a2a-contract.js';
import { createA2AExecutionAdapter } from '../src/server/a2a-execution.js';
import {
  createA2AProductionRuntime,
  type A2AProductionAgent,
} from '../src/server/a2a-production-runtime.js';
import { deriveChildIdempotencyKey } from '../src/server/a2a-orchestrator.js';
import { A2AStore } from '../src/server/a2a-store.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-durable-dispatch-'));
const scope: A2AScope = {
  tenantId: 'tenant-a',
  requesterId: 'requester-a',
  conversationId: 'conversation-a',
};
const otherScope: A2AScope = { ...scope, requesterId: 'requester-b' };

try {
  await testSchemaTwoMigratesWithoutInventingDispatches();
  await testIndependentAgentRoutingPersistsIdentityAndBindings();
  await testConcurrentRuntimeRetryDoesNotDuplicateDurableDispatch();
  await testCancellationDoesNotRecancelTerminalChild();
  await testRestartCancellationUsesDurableIntentAndIsIdempotent();
  await testStartupReconciliationUsesDurableGraph();
  await testStartupReconciliationRecoversRemoteAgentTask();
  await testIndependentStartupReconciliationContinuesAfterBlockedDispatch();
  await testStartupReconciliationReportsMissingJob();
  await testStartupReconciliationFailsClosedForProviderMismatch();
  await testStartupReconciliationUsesExactBuiltInProviderIdentity();
  await testStartupReconciliationFailsClosedForMissingProvider();
  await testLiveCancellationReportsMissingProviderAndKeepsStatePending();
  await testHungProviderCancellationDoesNotAcknowledge();
  await testCancellationIntentRollsBackWithAtomicWriteFailure();
  console.log('a2a-durable-dispatch-test: PASS');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

async function testSchemaTwoMigratesWithoutInventingDispatches(): Promise<void> {
  const storePath = path.join(root, 'schema-two.json');
  await fs.writeFile(storePath, JSON.stringify({
    schemaVersion: 2,
    tasks: {},
    records: {},
    jobBindings: {},
  }), 'utf8');

  const store = new A2AStore(storePath);
  await store.initialize();

  assert.deepEqual(store.listRecoverableDispatches(), []);
  const persisted = JSON.parse(await fs.readFile(storePath, 'utf8')) as Record<string, unknown>;
  assert.equal(persisted.schemaVersion, 3);
  assert.deepEqual(persisted.dispatchIntents, {});
}

async function testIndependentAgentRoutingPersistsIdentityAndBindings(): Promise<void> {
  const storePath = path.join(root, 'identity-routing.json');
  const store = new A2AStore(storePath);
  await store.initialize();
  const parent = await createParent(store, 'identity');
  const calls: Array<{ agentId: string; providerId: string; childKey: string }> = [];

  const agents: readonly A2AProductionAgent[] = [
    {
      agentId: 'codex-reviewer',
      providerId: 'codex-cli',
      authorize: () => true,
      executeChild: async (input) => {
        const beforeSubmission = new A2AStore(storePath);
        await beforeSubmission.initialize();
        assert.equal(beforeSubmission.getTask(parent.id, scope)?.status, 'working');
        assert.deepEqual(beforeSubmission.getDispatchIntent(parent.id, scope)?.children.map((child) => ({
          childKey: child.childKey,
          agentId: child.agentId,
          providerId: child.providerId,
        })).sort((left, right) => left.childKey.localeCompare(right.childKey)), [
          { childKey: 'review', agentId: 'codex-reviewer', providerId: 'codex-cli' },
          { childKey: 'tests', agentId: 'copilot-tester', providerId: 'official-copilot-cli' },
        ], 'the complete validated dispatch plan must be durable before the first child submission');
        calls.push({ agentId: input.agentId, providerId: input.providerId, childKey: input.childKey });
        await input.bindChild('job-codex-review');
        return { taskId: 'job-codex-review', status: 'completed', result: 'codex result' };
      },
    },
    {
      agentId: 'copilot-tester',
      providerId: 'official-copilot-cli',
      authorize: () => true,
      executeChild: async (input) => {
        calls.push({ agentId: input.agentId, providerId: input.providerId, childKey: input.childKey });
        await input.bindChild('job-copilot-tests');
        return { taskId: 'job-copilot-tests', status: 'completed', result: 'copilot result' };
      },
    },
  ];
  const runtime = createRuntime(store, agents);

  const result = await runtime.dispatchChildren({
    parentTask: parent,
    scope,
    requests: [
      { key: 'review', role: 'reviewer', prompt: 'Review.', agentId: 'codex-reviewer' },
      { key: 'tests', role: 'test-runner', prompt: 'Test.', agentId: 'copilot-tester' },
    ],
    deadlineMs: 1_000,
    parallelism: 2,
  });

  assert.equal(result.completedChildren, 2);
  assert.deepEqual(calls.sort((left, right) => left.childKey.localeCompare(right.childKey)), [
    { agentId: 'codex-reviewer', providerId: 'codex-cli', childKey: 'review' },
    { agentId: 'copilot-tester', providerId: 'official-copilot-cli', childKey: 'tests' },
  ]);

  const reopened = new A2AStore(storePath);
  await reopened.initialize();
  const dispatch = reopened.getDispatchIntent(parent.id, scope);
  assert.equal(dispatch?.status, 'completed');
  assert.deepEqual(dispatch?.children.map((child) => ({
    childKey: child.childKey,
    agentId: child.agentId,
    providerId: child.providerId,
    agentJobId: child.agentJobId,
    status: child.status,
  })).sort((left, right) => left.childKey.localeCompare(right.childKey)), [
    {
      childKey: 'review',
      agentId: 'codex-reviewer',
      providerId: 'codex-cli',
      agentJobId: 'job-codex-review',
      status: 'completed',
    },
    {
      childKey: 'tests',
      agentId: 'copilot-tester',
      providerId: 'official-copilot-cli',
      agentJobId: 'job-copilot-tests',
      status: 'completed',
    },
  ]);
  assert.equal(reopened.getDispatchIntent(parent.id, otherScope), undefined);
}

async function testConcurrentRuntimeRetryDoesNotDuplicateDurableDispatch(): Promise<void> {
  const storePath = path.join(root, 'retry-guard.json');
  const store = new A2AStore(storePath);
  await store.initialize();
  const parent = await createParent(store, 'retry-guard');
  let executionCalls = 0;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  let releaseExecution!: () => void;
  const release = new Promise<void>((resolve) => { releaseExecution = resolve; });
  const requests = [{ key: 'review', role: 'reviewer', prompt: 'Review.', agentId: 'codex-reviewer' }];
  const firstRuntime = createRuntime(store, [{
    agentId: 'codex-reviewer',
    providerId: 'codex-cli',
    authorize: () => true,
    executeChild: async (input) => {
      executionCalls += 1;
      await input.bindChild('job-retry-guard');
      markStarted();
      await release;
      return { taskId: 'job-retry-guard', status: 'completed', result: 'retry guard result' };
    },
  }]);
  const firstDispatch = firstRuntime.dispatchChildren({
    parentTask: parent,
    scope,
    requests,
    deadlineMs: 1_000,
    parallelism: 1,
  });
  await started;

  const retryRuntime = createRuntime(store, [{
    agentId: 'codex-reviewer',
    providerId: 'codex-cli',
    authorize: () => true,
    executeChild: async () => {
      executionCalls += 1;
      return { taskId: 'job-retry-guard', status: 'completed', result: 'retry guard result' };
    },
  }]);
  try {
    await assert.rejects(
      retryRuntime.dispatchChildren({
        parentTask: parent,
        scope,
        requests,
        deadlineMs: 1_000,
        parallelism: 1,
      }),
      /active|already|durable/i,
      'a retry against an existing durable dispatch must not submit another child',
    );
    assert.equal(executionCalls, 1);
  } finally {
    releaseExecution();
    await firstDispatch;
  }
}

async function testCancellationDoesNotRecancelTerminalChild(): Promise<void> {
  const store = new A2AStore(path.join(root, 'terminal-child-cancel.json'));
  await store.initialize();
  const parent = await createParent(store, 'terminal-child-cancel');
  await createBoundDispatch(store, parent.id, 'terminal-child-cancel', 'job-terminal-child');
  await store.recordDispatchChildOutcome(parent.id, scope, {
    childKey: 'review',
    status: 'completed',
    agentJobId: 'job-terminal-child',
  });
  let cancelCalls = 0;
  const runtime = createRuntime(store, [{
    agentId: 'codex-reviewer',
    providerId: 'codex-cli',
    authorize: () => true,
    executeChild: async () => ({ taskId: 'unused', status: 'completed', result: 'unused' }),
    cancelChild: async () => {
      cancelCalls += 1;
    },
  }]);

  const canceled = await runtime.cancelDispatch({ task: parent, authenticatedScope: scope });
  assert.equal(canceled?.status, 'canceled');
  assert.equal(cancelCalls, 0, 'a terminal child must not receive a second provider cancellation');
  assert.ok(store.getDispatchIntent(parent.id, scope)?.children[0]?.cancelAcknowledgedAt);
}

async function testRestartCancellationUsesDurableIntentAndIsIdempotent(): Promise<void> {
  const storePath = path.join(root, 'restart-cancel.json');
  const beforeCrash = new A2AStore(storePath);
  await beforeCrash.initialize();
  const parent = await createParent(beforeCrash, 'restart-cancel');
  await beforeCrash.transitionTask(parent.id, scope, 'working');
  await beforeCrash.createOrGetDispatchIntent({
    parentTaskId: parent.id,
    scope,
    requestFingerprint: 'dispatch-restart-cancel',
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
  await beforeCrash.bindDispatchChild(parent.id, scope, 'review', 'job-before-crash');

  const afterRestart = new A2AStore(storePath);
  await afterRestart.initialize();
  let cancelCalls = 0;
  const runtime = createRuntime(afterRestart, [{
    agentId: 'codex-reviewer',
    providerId: 'codex-cli',
    authorize: () => true,
    executeChild: async () => {
      throw new Error('restart cancellation must not execute a new child');
    },
    cancelChild: async (input) => {
      cancelCalls += 1;
      assert.equal(input.agentJobId, 'job-before-crash');
      assert.ok(afterRestart.getDispatchIntent(parent.id, scope)?.cancelRequestedAt,
        'durable cancellation intent must be visible before child cancellation');
    },
  }]);

  await assert.rejects(
    runtime.cancelDispatch({ task: parent, authenticatedScope: otherScope }),
    /scope|requester|belong/i,
  );
  assert.equal(afterRestart.getDispatchIntent(parent.id, scope)?.cancelRequestedAt, undefined);

  const cancelled = await runtime.cancelDispatch({ task: parent, authenticatedScope: scope });
  assert.equal(cancelled?.status, 'canceled');
  assert.equal(cancelCalls, 1);
  assert.ok(afterRestart.getDispatchIntent(parent.id, scope)?.children[0]?.cancelAcknowledgedAt);

  const cancelledAgain = await runtime.cancelDispatch({ task: parent, authenticatedScope: scope });
  assert.equal(cancelledAgain?.status, 'canceled');
  assert.equal(cancelCalls, 1, 'repeated cancellation must not recancel an acknowledged child');
}

async function testCancellationIntentRollsBackWithAtomicWriteFailure(): Promise<void> {
  const storePath = path.join(root, 'rollback-cancel.json');
  const store = new A2AStore(storePath);
  await store.initialize();
  const parent = await createParent(store, 'rollback-cancel');
  await store.createOrGetDispatchIntent({
    parentTaskId: parent.id,
    scope,
    requestFingerprint: 'dispatch-rollback-cancel',
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    children: [{
      childKey: 'review',
      childIdempotencyKey: deriveChildIdempotencyKey(parent.id, 'review'),
      role: 'reviewer',
      agentId: 'codex-reviewer',
      providerId: 'codex-cli',
      requestSha256: 'b'.repeat(64),
    }],
  });

  const backupPath = `${storePath}.backup`;
  await fs.rename(storePath, backupPath);
  await fs.mkdir(storePath);
  await assert.rejects(store.requestDispatchCancellation(parent.id, scope));
  assert.equal(store.getDispatchIntent(parent.id, scope)?.cancelRequestedAt, undefined);
  await fs.rm(storePath, { recursive: true, force: true });
  await fs.rename(backupPath, storePath);
}

async function testStartupReconciliationUsesDurableGraph(): Promise<void> {
  const storePath = path.join(root, 'startup-reconcile.json');
  const beforeRestart = new A2AStore(storePath);
  await beforeRestart.initialize();
  const canceledParent = await createParent(beforeRestart, 'startup-canceled');
  await createBoundDispatch(beforeRestart, canceledParent.id, 'startup-canceled', 'job-startup-canceled');
  await beforeRestart.requestDispatchCancellation(canceledParent.id, scope);

  const recoverableParent = await createParent(beforeRestart, 'startup-recoverable');
  await createBoundDispatch(beforeRestart, recoverableParent.id, 'startup-recoverable', 'job-startup-recoverable');

  const afterRestart = new A2AStore(storePath);
  await afterRestart.initialize();
  const cancelCalls: string[] = [];
  const resumedJobIds: string[] = [];
  let duplicateSubmissionCalls = 0;
  const adapter = createA2AExecutionAdapter({
    store: afterRestart,
    agentService: {
      get: (id: string) => id === 'job-startup-recoverable'
        ? { id, status: 'running', provider: 'codex' }
        : { id, status: 'running', provider: 'codex' },
      waitForTerminal: async (id: string) => {
        resumedJobIds.push(id);
        return { id, status: 'completed', result: 'recovered child result' };
      },
      runForCopilot: async () => {
        duplicateSubmissionCalls += 1;
        throw new Error('restart recovery must not submit a duplicate child job');
      },
    } as unknown as AgentService,
    cancelChildForReconciliation: async (input) => {
      cancelCalls.push(`${input.agentId}:${input.providerId}:${input.agentJobId}`);
    },
    onDispatchReconciliationFailure: (failure) => {
      throw new Error(`unexpected reconciliation failure: ${failure.reason}`);
    },
  } as never);

  await adapter.initialize();

  assert.deepEqual(cancelCalls, ['codex-reviewer:codex-cli:job-startup-canceled']);
  assert.deepEqual(resumedJobIds, ['job-startup-recoverable']);
  assert.equal(duplicateSubmissionCalls, 0);
  assert.equal(afterRestart.getTask(canceledParent.id, scope)?.status, 'canceled');
  assert.equal(afterRestart.getDispatchIntent(canceledParent.id, scope)?.status, 'canceled');
  assert.ok(afterRestart.getDispatchIntent(canceledParent.id, scope)?.children[0]?.cancelAcknowledgedAt);
  const recoveredTask = afterRestart.getTask(recoverableParent.id, scope);
  const recoveredDispatch = afterRestart.getDispatchIntent(recoverableParent.id, scope);
  assert.equal(recoveredTask?.status, 'completed');
  assert.equal(recoveredTask?.artifacts[0]?.content?.text, 'recovered child result');
  assert.equal(recoveredDispatch?.status, 'completed');
  assert.equal(recoveredDispatch?.cancelRequestedAt, undefined);
  assert.deepEqual(recoveredDispatch?.children.map((child) => ({
    childKey: child.childKey,
    agentId: child.agentId,
    providerId: child.providerId,
    agentJobId: child.agentJobId,
    status: child.status,
  })), [{
    childKey: 'review',
    agentId: 'codex-reviewer',
    providerId: 'codex-cli',
    agentJobId: 'job-startup-recoverable',
    status: 'completed',
  }]);

  await adapter.initialize();
  assert.equal(cancelCalls.length, 1, 'terminal reconciled dispatches must not be canceled twice');
  assert.equal(resumedJobIds.length, 1, 'terminal reconciled dispatches must not resume twice');
}

async function testStartupReconciliationRecoversRemoteAgentTask(): Promise<void> {
  const storePath = path.join(root, 'startup-remote-recovery.json');
  const beforeRestart = new A2AStore(storePath);
  await beforeRestart.initialize();
  const parent = await createParent(beforeRestart, 'startup-remote-recovery');
  await beforeRestart.createOrGetDispatchIntent({
    parentTaskId: parent.id,
    scope,
    requestFingerprint: 'dispatch-startup-remote-recovery',
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    children: [{
      childKey: 'review',
      childIdempotencyKey: deriveChildIdempotencyKey(parent.id, 'review'),
      role: 'reviewer',
      agentId: 'remote-agent',
      providerId: 'remote-provider',
      requestSha256: 'e'.repeat(64),
    }],
  });
  await beforeRestart.bindDispatchChild(parent.id, scope, 'review', 'remote-task-after-restart');

  const afterRestart = new A2AStore(storePath);
  await afterRestart.initialize();
  const runtime = createRuntime(afterRestart, [{
    agentId: 'remote-agent',
    providerId: 'remote-provider',
    authorize: () => true,
    executeChild: async () => ({ taskId: 'unused', status: 'failed', error: 'must not resubmit' }),
    recoverChild: async (input) => {
      assert.equal(input.agentJobId, 'remote-task-after-restart');
      assert.equal(input.agentId, 'remote-agent');
      assert.equal(input.providerId, 'remote-provider');
      return {
        taskId: input.agentJobId,
        status: 'completed',
        result: 'remote result recovered after restart',
      };
    },
  }]);
  const adapter = createA2AExecutionAdapter({
    store: afterRestart,
    agentService: {} as AgentService,
    recoverChildForReconciliation: (input) => runtime.recoverChild(input),
  } as never);

  await adapter.initialize();

  assert.equal(afterRestart.getTask(parent.id, scope)?.status, 'completed');
  assert.equal(afterRestart.getTask(parent.id, scope)?.artifacts[0]?.content?.text, 'remote result recovered after restart');
  assert.equal(afterRestart.getDispatchIntent(parent.id, scope)?.status, 'completed');
  assert.equal(afterRestart.getDispatchIntent(parent.id, scope)?.children[0]?.status, 'completed');
}

async function testIndependentStartupReconciliationContinuesAfterBlockedDispatch(): Promise<void> {
  const storePath = path.join(root, 'startup-independent-reconciliation.json');
  const store = new A2AStore(storePath);
  await store.initialize();

  const blockedParent = await createParent(store, 'startup-blocked-independent');
  await createBoundDispatch(store, blockedParent.id, 'startup-blocked-independent', 'job-blocked-independent');
  await store.requestDispatchCancellation(blockedParent.id, scope);

  const recoverableParent = await createParent(store, 'startup-recoverable-independent');
  await createBoundDispatch(store, recoverableParent.id, 'startup-recoverable-independent', 'job-recoverable-independent');

  const resumedJobIds: string[] = [];
  const failures: string[] = [];
  const adapter = createA2AExecutionAdapter({
    store,
    agentService: {
      get: (id: string) => id === 'job-recoverable-independent'
        ? { id, status: 'running', provider: 'codex' }
        : undefined,
      waitForTerminal: async (id: string) => {
        resumedJobIds.push(id);
        return { id, status: 'completed', result: 'independent recovery result' };
      },
      runForCopilot: async () => {
        throw new Error('restart recovery must not submit a duplicate child job');
      },
    } as unknown as AgentService,
    cancelChildForReconciliation: async (input) => {
      if (input.agentJobId === 'job-blocked-independent') {
        throw new Error('blocked provider is unavailable');
      }
    },
    onDispatchReconciliationFailure: (failure) => {
      failures.push(`${failure.parentTaskId}:${failure.reason}`);
    },
  } as never);

  await assert.rejects(
    adapter.initialize(),
    /could not be reconciled for 1 independent dispatch/i,
    'an unresolved dispatch must keep startup fail-closed after independent recovery continues',
  );

  assert.deepEqual(resumedJobIds, ['job-recoverable-independent']);
  assert.deepEqual(failures, [`${blockedParent.id}:cancellation-failed`]);
  assert.equal(store.getTask(recoverableParent.id, scope)?.status, 'completed');
  assert.equal(store.getDispatchIntent(recoverableParent.id, scope)?.status, 'completed');
  assert.equal(store.getTask(blockedParent.id, scope)?.status, 'working');
  assert.equal(store.getDispatchIntent(blockedParent.id, scope)?.status, 'canceling');
}

async function testStartupReconciliationFailsClosedForMissingProvider(): Promise<void> {
  const storePath = path.join(root, 'startup-missing-provider.json');
  const store = new A2AStore(storePath);
  await store.initialize();
  const parent = await createParent(store, 'startup-missing-provider');
  await createBoundDispatch(store, parent.id, 'startup-missing-provider', 'job-missing-provider');
  await store.requestDispatchCancellation(parent.id, scope);
  const failures: Array<{ reason: string; agentId: string; providerId: string; agentJobId: string }> = [];
  const adapter = createA2AExecutionAdapter({
    store,
    agentService: {
      get: () => ({ id: 'job-missing-provider', status: 'running' }),
      cancelStrict: async () => {
        throw new Error('generic route must not be used');
      },
    } as unknown as AgentService,
    cancelChildForReconciliation: async () => {
      throw new Error('trusted provider is unavailable');
    },
    onDispatchReconciliationFailure: (failure) => {
      failures.push({
        reason: failure.reason,
        agentId: failure.agentId,
        providerId: failure.providerId,
        agentJobId: failure.agentJobId,
      });
    },
  } as never);

  await assert.rejects(adapter.initialize(), /could not be reconciled/i);
  const child = store.getDispatchIntent(parent.id, scope)?.children[0];
  assert.equal(child?.cancelAcknowledgedAt, undefined, 'missing provider must not be acknowledged');
  assert.equal(store.getTask(parent.id, scope)?.status, 'working');
  assert.equal(store.getDispatchIntent(parent.id, scope)?.status, 'canceling');
  assert.deepEqual(failures, [{
    reason: 'cancellation-failed',
    agentId: 'codex-reviewer',
    providerId: 'codex-cli',
    agentJobId: 'job-missing-provider',
  }]);
}

async function testStartupReconciliationReportsMissingJob(): Promise<void> {
  const storePath = path.join(root, 'startup-missing-job.json');
  const store = new A2AStore(storePath);
  await store.initialize();
  const parent = await createParent(store, 'startup-missing-job');
  await store.createOrGetDispatchIntent({
    parentTaskId: parent.id,
    scope,
    requestFingerprint: 'dispatch-startup-missing-job',
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    children: [{
      childKey: 'review',
      childIdempotencyKey: deriveChildIdempotencyKey(parent.id, 'review'),
      role: 'reviewer',
      agentId: 'codex-reviewer',
      providerId: 'codex-cli',
      requestSha256: 'd'.repeat(64),
    }],
  });
  const failures: Array<{
    reason: string;
    parentTaskId: string;
    childKey: string;
    childIdempotencyKey: string;
    agentId: string;
    providerId: string;
    agentJobId?: string;
  }> = [];
  let cancellationCalls = 0;
  const adapter = createA2AExecutionAdapter({
    store,
    agentService: {} as AgentService,
    cancelChildForReconciliation: async () => {
      cancellationCalls += 1;
    },
    onDispatchReconciliationFailure: (failure) => {
      failures.push({
        reason: failure.reason,
        parentTaskId: failure.parentTaskId,
        childKey: failure.childKey,
        childIdempotencyKey: failure.childIdempotencyKey,
        agentId: failure.agentId,
        providerId: failure.providerId,
        ...(failure.agentJobId ? { agentJobId: failure.agentJobId } : {}),
      });
    },
  } as never);

  await assert.rejects(adapter.initialize(), /could not be reconciled/i);
  assert.equal(cancellationCalls, 0, 'missing-job reconciliation must not call a provider');
  assert.equal(failures.length, 1, 'missing-job failure must be observable before reconciliation stops');
  assert.deepEqual(failures[0], {
    reason: 'missing-job',
    parentTaskId: parent.id,
    childKey: 'review',
    childIdempotencyKey: deriveChildIdempotencyKey(parent.id, 'review'),
    agentId: 'codex-reviewer',
    providerId: 'codex-cli',
  });
  assert.equal(store.getDispatchIntent(parent.id, scope)?.children[0]?.cancelAcknowledgedAt, undefined);
}

async function testStartupReconciliationFailsClosedForProviderMismatch(): Promise<void> {
  const storePath = path.join(root, 'startup-provider-mismatch.json');
  const store = new A2AStore(storePath);
  await store.initialize();
  const parent = await createParent(store, 'startup-provider-mismatch');
  await createBoundDispatch(store, parent.id, 'startup-provider-mismatch', 'job-provider-mismatch');

  const adapter = createA2AExecutionAdapter({
    store,
    agentService: {
      get: () => ({
        id: 'job-provider-mismatch',
        status: 'completed',
        provider: 'codex',
        result: 'must not be accepted',
      }),
    } as unknown as AgentService,
    resolveProviderForRecovery: () => 'copilot',
  });

  await assert.rejects(adapter.initialize(), /provider identity mismatch/i);
  assert.equal(store.getDispatchIntent(parent.id, scope)?.children[0]?.status, 'working');
  assert.equal(store.getTask(parent.id, scope)?.status, 'working');
}

async function testStartupReconciliationUsesExactBuiltInProviderIdentity(): Promise<void> {
  const store = new A2AStore(path.join(root, 'startup-built-in-provider-mismatch.json'));
  await store.initialize();
  const parent = await createParent(store, 'startup-built-in-provider-mismatch');
  await createBoundDispatch(store, parent.id, 'startup-built-in-provider-mismatch', 'job-built-in-provider-mismatch');

  const adapter = createA2AExecutionAdapter({
    store,
    agentService: {
      get: () => ({
        id: 'job-built-in-provider-mismatch',
        status: 'completed',
        provider: 'copilot',
        result: 'must not be accepted',
      }),
    } as unknown as AgentService,
  });

  await assert.rejects(adapter.initialize(), /provider identity mismatch/i);
  assert.equal(store.getDispatchIntent(parent.id, scope)?.children[0]?.status, 'working');
  assert.equal(store.getTask(parent.id, scope)?.status, 'working');
}

async function testLiveCancellationReportsMissingProviderAndKeepsStatePending(): Promise<void> {
  const store = new A2AStore(path.join(root, 'live-missing-provider.json'));
  await store.initialize();
  const parent = await createParent(store, 'live-missing-provider');
  await createBoundDispatch(store, parent.id, 'live-missing-provider', 'job-live-missing-provider');
  const failures: Array<{ reason: string; agentId: string; providerId: string; agentJobId?: string }> = [];
  const runtime = createRuntime(store, [], undefined, (failure) => {
    failures.push({
      reason: failure.reason,
      agentId: failure.agentId,
      providerId: failure.providerId,
      ...(failure.agentJobId ? { agentJobId: failure.agentJobId } : {}),
    });
  });

  const cancelled = await runtime.cancelDispatch({ task: parent, authenticatedScope: scope });
  assert.equal(cancelled?.status, 'working', 'parent must remain non-terminal until child cancellation confirms');
  assert.equal(store.getTask(parent.id, scope)?.status, 'working');
  const dispatch = store.getDispatchIntent(parent.id, scope);
  assert.equal(dispatch?.status, 'canceling');
  assert.equal(dispatch?.children[0]?.cancelAcknowledgedAt, undefined);
  assert.equal(dispatch?.children[0]?.status, 'working');
  assert.deepEqual(failures, [{
    reason: 'missing-provider',
    agentId: 'codex-reviewer',
    providerId: 'codex-cli',
    agentJobId: 'job-live-missing-provider',
  }]);
}

async function testHungProviderCancellationDoesNotAcknowledge(): Promise<void> {
  const store = new A2AStore(path.join(root, 'hung-provider.json'));
  await store.initialize();
  const parent = await createParent(store, 'hung-provider');
  await createBoundDispatch(store, parent.id, 'hung-provider', 'job-hung-provider');
  const failures: Array<{ reason: string; agentId: string; providerId: string; agentJobId?: string; error?: string }> = [];
  const runtime = createRuntime(store, [{
    agentId: 'codex-reviewer',
    providerId: 'codex-cli',
    authorize: () => true,
    executeChild: async () => ({ taskId: 'job-hung-provider', status: 'canceled', error: 'canceled' }),
    cancelChild: async () => new Promise<void>(() => undefined),
  }], 25, (failure) => {
    failures.push({
      reason: failure.reason,
      agentId: failure.agentId,
      providerId: failure.providerId,
      ...(failure.agentJobId ? { agentJobId: failure.agentJobId } : {}),
      ...(failure.error ? { error: failure.error } : {}),
    });
  });

  const startedAt = Date.now();
  const cancelled = await runtime.cancelDispatch({ task: parent, authenticatedScope: scope });
  assert.ok(Date.now() - startedAt < 500, 'hung provider cancellation must be bounded');
  assert.equal(cancelled?.status, 'working', 'parent must remain non-terminal until timeout cancellation confirms');
  assert.equal(store.getTask(parent.id, scope)?.status, 'working');
  assert.equal(store.getDispatchIntent(parent.id, scope)?.status, 'canceling');
  assert.equal(store.getDispatchIntent(parent.id, scope)?.children[0]?.cancelAcknowledgedAt, undefined,
    'timed-out provider cancellation must not be acknowledged');
  assert.deepEqual(failures, [{
    reason: 'cancellation-failed',
    agentId: 'codex-reviewer',
    providerId: 'codex-cli',
    agentJobId: 'job-hung-provider',
    error: 'A2A child cancellation timed out after 25ms.',
  }]);
}

async function createBoundDispatch(
  store: A2AStore,
  parentTaskId: string,
  suffix: string,
  agentJobId: string,
): Promise<void> {
  await store.createOrGetDispatchIntent({
    parentTaskId,
    scope,
    requestFingerprint: `dispatch-${suffix}`,
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    children: [{
      childKey: 'review',
      childIdempotencyKey: deriveChildIdempotencyKey(parentTaskId, 'review'),
      role: 'reviewer',
      agentId: 'codex-reviewer',
      providerId: 'codex-cli',
      requestSha256: 'c'.repeat(64),
    }],
  });
  await store.bindDispatchChild(parentTaskId, scope, 'review', agentJobId);
}

function createRuntime(
  store: A2AStore,
  agents: readonly A2AProductionAgent[],
  cancellationTimeoutMs?: number,
  onDispatchCancellationFailure?: (failure: {
    reason: string;
    agentId: string;
    providerId: string;
    agentJobId?: string;
    error?: string;
  }) => void,
) {
  return createA2AProductionRuntime({
    publicOrigin: 'https://runtime.example.test',
    appVersion: '1.0.51',
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
    ...(cancellationTimeoutMs === undefined ? {} : { cancellationTimeoutMs }),
    ...(onDispatchCancellationFailure ? { onDispatchCancellationFailure } : {}),
  } as never);
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
      parts: [{ text: 'Run durable children.' }],
    },
  });
}
