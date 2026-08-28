import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

import type { AgentJobScope } from '../src/server/agent-job-store.js';
import { A2AContractError } from '../src/server/a2a-contract.js';
import {
  createA2AOrchestrator,
  createCoreA2AOrchestrator,
  type A2AOrchestratorChildExecutionResult,
} from '../src/server/a2a-orchestrator.js';

const scope: AgentJobScope = {
  tenantId: 'tenant-a',
  requesterId: 'requester-a',
  conversationId: 'conversation-a',
};

async function testBasicExecution(): Promise<void> {
  const orchestrator = createA2AOrchestrator({
    now: () => 1_000,
  });

  const result = await orchestrator.run({
    scope,
    parentTaskId: 'task-parent',
    requests: [
      {
        key: 'planner',
        role: 'planner',
        prompt: 'Summarize the current work items.',
      },
    ],
    deadlineMs: 500,
    parallelism: 1,
    executeChild: async ({ childKey, childIdempotencyKey, role, prompt, signal }) => {
      assert.equal(childKey, 'planner');
      assert.equal(role, 'planner');
      assert.equal(prompt, 'Summarize the current work items.');
      assert.equal(signal.aborted, false);
      assert.match(childIdempotencyKey, /^child-/);
      return {
        taskId: 'task-child-1',
        status: 'completed',
        result: 'done',
      };
    },
  });

  assert.equal(result.parentTaskId, 'task-parent');
  assert.equal(result.totalChildren, 1);
  assert.equal(result.completedChildren, 1);
  assert.equal(result.failedChildren, 0);
  assert.equal(result.canceledChildren, 0);
  assert.equal(result.childResults.length, 1);
  assert.equal(result.childResults[0]?.childKey, 'planner');
  assert.equal(result.childResults[0]?.status, 'completed');
  assert.equal(result.childResults[0]?.taskId, 'task-child-1');
  assert.equal(result.childResults[0]?.result, 'done');
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.childResults), true);
  assert.equal(Object.isFrozen(result.childResults[0] ?? null), true);
}

async function testCoreRoleCatalogBoundary(): Promise<void> {
  const orchestrator = createCoreA2AOrchestrator();
  let capturedCapabilities: readonly string[] | undefined;
  const result = await orchestrator.run({
    scope,
    parentTaskId: 'task-core-catalog',
    requests: [{
      key: 'review-child',
      role: 'reviewer',
      capabilities: ['source.read'],
      prompt: 'Review the bounded Core changes.',
    }],
    deadlineMs: 500,
    parallelism: 1,
    executeChild: async ({ capabilities }) => {
      capturedCapabilities = capabilities;
      return { taskId: 'task-review-child', status: 'completed', result: 'reviewed' };
    },
  });
  assert.equal(result.completedChildren, 1);
  assert.deepEqual(capturedCapabilities, ['source.read']);

  await assert.rejects(
    () => orchestrator.run({
      scope,
      parentTaskId: 'task-core-unknown-role',
      requests: [{ key: 'unknown', role: 'worker', prompt: 'not in catalog' }],
      deadlineMs: 500,
      parallelism: 1,
      executeChild: async () => ({ taskId: 'never', status: 'completed' }),
    }),
    (error: unknown) => error instanceof A2AContractError && error.code === 'InvalidRequestError',
  );

  await assert.rejects(
    () => orchestrator.run({
      scope,
      parentTaskId: 'task-core-capability-escalation',
      requests: [{
        key: 'escalated',
        role: 'reviewer',
        capabilities: ['provider.adapter.write'],
        prompt: 'request an escalation',
      }],
      deadlineMs: 500,
      parallelism: 1,
      executeChild: async () => ({ taskId: 'never', status: 'completed' }),
    }),
    (error: unknown) => error instanceof A2AContractError && error.code === 'UnsupportedOperationError',
  );
}

async function testSynchronousExecutorThrowBecomesFailedChild(): Promise<void> {
  const orchestrator = createA2AOrchestrator();

  const result = await orchestrator.run({
    scope,
    parentTaskId: 'task-parent-sync-throw',
    requests: [{ key: 'throwing-child', role: 'worker', prompt: 'throw synchronously' }],
    deadlineMs: 1_000,
    parallelism: 1,
    executeChild: () => {
      throw new Error('synchronous child failure');
    },
  });

  assert.equal(result.failedChildren, 1);
  assert.equal(result.canceledChildren, 0);
  assert.equal(result.childResults[0]?.status, 'failed');
  assert.equal(result.childResults[0]?.error, 'synchronous child failure');
}

async function testCompletedChildRequiresNonEmptyResult(): Promise<void> {
  const orchestrator = createA2AOrchestrator();

  const missingResult = await orchestrator.run({
    scope,
    parentTaskId: 'task-parent-missing-result',
    requests: [{ key: 'missing-result-child', role: 'worker', prompt: 'finish without output' }],
    deadlineMs: 1_000,
    parallelism: 1,
    executeChild: async () => ({
      taskId: 'task-missing-result-child',
      status: 'completed',
    }),
  });

  assert.equal(missingResult.completedChildren, 0);
  assert.equal(missingResult.failedChildren, 1);
  assert.equal(missingResult.childResults[0]?.status, 'failed');
  assert.match(missingResult.childResults[0]?.error ?? '', /completed child result must contain a non-empty result/i);

  const blankResult = await orchestrator.run({
    scope,
    parentTaskId: 'task-parent-blank-result',
    requests: [{ key: 'blank-result-child', role: 'worker', prompt: 'finish with blank output' }],
    deadlineMs: 1_000,
    parallelism: 1,
    executeChild: async () => ({
      taskId: 'task-blank-result-child',
      status: 'completed',
      result: '  \n\t  ',
    }),
  });

  assert.equal(blankResult.completedChildren, 0);
  assert.equal(blankResult.failedChildren, 1);
  assert.equal(blankResult.childResults[0]?.status, 'failed');
  assert.match(blankResult.childResults[0]?.error ?? '', /completed child result must contain a non-empty result/i);
}

async function testDuplicateOrderingAndDeterminism(): Promise<void> {
  const orchestrator = createA2AOrchestrator({
    now: () => Date.now(),
  });
  const executions: string[] = [];

  const result = await orchestrator.run({
    scope,
    parentTaskId: 'task-parent-dupe',
    requests: [
      { key: 'analyst', role: 'analyst', prompt: 'slow' },
      { key: 'planner', role: 'planner', prompt: 'fast' },
      { key: 'analyst', role: 'analyst', prompt: 'slow' },
    ],
    deadlineMs: 1_000,
    parallelism: 2,
    executeChild: async ({ childKey, childIdempotencyKey, prompt }) => {
      executions.push(childKey);
      if (prompt === 'slow') await delay(25);
      if (prompt === 'fast') await delay(5);
      return {
        taskId: `task-${childKey}`,
        status: 'completed',
        result: childIdempotencyKey,
      };
    },
  });

  assert.deepEqual(executions, ['analyst', 'planner']);
  assert.equal(result.uniqueChildren, 2);
  assert.equal(result.duplicateChildren, 1);
  assert.equal(result.childResults.length, 3);
  assert.deepEqual(result.childResults.map((entry) => entry.childKey), ['analyst', 'planner', 'analyst']);
  assert.equal(result.childResults[0]?.duplicated, false);
  assert.equal(result.childResults[1]?.duplicated, false);
  assert.equal(result.childResults[2]?.duplicated, true);
  assert.equal(result.childResults[0]?.taskId, 'task-analyst');
  assert.equal(result.childResults[1]?.taskId, 'task-planner');
  assert.equal(result.childResults[2]?.taskId, 'task-analyst');
  assert.equal(result.childResults[0]?.result, result.childResults[2]?.result);
}

async function testExecutionMemoryIsScopedAndReplaysWithinTrustedScope(): Promise<void> {
  const orchestrator = createA2AOrchestrator();
  const scopeA = scope;
  const scopeB: AgentJobScope = {
    tenantId: 'tenant-b',
    requesterId: 'requester-b',
    conversationId: 'conversation-b',
  };
  const executions: string[] = [];
  const runForScope = async (runScope: AgentJobScope) => orchestrator.run({
    scope: runScope,
    parentTaskId: 'task-parent-scoped-memory',
    requests: [{ key: 'shared-child', role: 'worker', prompt: 'same request' }],
    deadlineMs: 1_000,
    parallelism: 1,
    executeChild: async ({ scope: childScope, childIdempotencyKey }) => {
      executions.push(childScope.tenantId);
      return {
        taskId: `task-${childScope.tenantId}`,
        status: 'completed',
        result: `${childScope.tenantId}:${childIdempotencyKey}`,
      };
    },
  });

  const firstScopeA = await runForScope(scopeA);
  const firstScopeB = await runForScope(scopeB);
  const replayedScopeA = await runForScope(scopeA);

  assert.deepEqual(executions, ['tenant-a', 'tenant-b']);
  assert.equal(firstScopeA.childResults[0]?.taskId, 'task-tenant-a');
  assert.equal(firstScopeB.childResults[0]?.taskId, 'task-tenant-b');
  assert.equal(replayedScopeA.childResults[0]?.taskId, 'task-tenant-a');
  assert.equal(
    firstScopeA.childResults[0]?.childIdempotencyKey,
    firstScopeB.childResults[0]?.childIdempotencyKey,
  );
}

async function testSettledExecutionMemoryUsesBoundedRetention(): Promise<void> {
  const orchestrator = createA2AOrchestrator({
    maxRetainedExecutions: 2,
  });
  const executions: string[] = [];
  const runChild = async (key: string) => orchestrator.run({
    scope,
    parentTaskId: 'task-parent-bounded-memory',
    requests: [{ key, role: 'worker', prompt: `run ${key}` }],
    deadlineMs: 1_000,
    parallelism: 1,
    executeChild: async ({ childKey }) => {
      executions.push(childKey);
      return {
        taskId: `task-${childKey}-${executions.length}`,
        status: 'completed',
        result: `result-${childKey}-${executions.length}`,
      };
    },
  });

  await runChild('one');
  await runChild('two');
  await runChild('three');
  const replayed = await runChild('one');

  assert.deepEqual(executions, ['one', 'two', 'three', 'one']);
  assert.equal(replayed.childResults[0]?.taskId, 'task-one-4');
}

async function testLateSettlementAfterCancellationBecomesEligibleForCleanup(): Promise<void> {
  const orchestrator = createA2AOrchestrator({
    maxRetainedExecutions: 0,
  });
  const callerController = new AbortController();
  let executions = 0;
  let notifyStarted: (() => void) | undefined;
  let notifySecondStarted: (() => void) | undefined;
  let notifyThirdStarted: (() => void) | undefined;
  let releaseChild: (() => void) | undefined;
  const activeExecutions: Promise<A2AOrchestratorChildExecutionResult>[] = [];
  const childStarted = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  const secondChildStarted = new Promise<void>((resolve) => {
    notifySecondStarted = resolve;
  });
  const thirdChildStarted = new Promise<void>((resolve) => {
    notifyThirdStarted = resolve;
  });
  const childMayFinish = new Promise<void>((resolve) => {
    releaseChild = resolve;
  });
  const request = {
    scope,
    parentTaskId: 'task-parent-late-cleanup',
    requests: [{ key: 'late-child', role: 'worker', prompt: 'cancel then settle' }],
    deadlineMs: 1_000,
    parallelism: 1,
    executeChild: () => {
      executions += 1;
      notifyStarted?.();
      if (executions === 2) notifySecondStarted?.();
      if (executions === 3) notifyThirdStarted?.();
      const executionNumber = executions;
      const activeExecution = childMayFinish.then(() => ({
        taskId: `task-late-child-${executionNumber}`,
        status: 'completed' as const,
        result: `late-result-${executionNumber}`,
      }));
      activeExecutions.push(activeExecution);
      return activeExecution;
    },
  };

  const firstRun = orchestrator.run({
    ...request,
    signal: callerController.signal,
  });
  await childStarted;
  callerController.abort(new Error('caller canceled while child was active'));
  const canceled = await firstRun;
  assert.equal(canceled.childResults[0]?.status, 'canceled');

  await Promise.resolve();
  const secondController = new AbortController();
  const afterCleanupRun = orchestrator.run({
    ...request,
    signal: secondController.signal,
  });
  await Promise.resolve();

  assert.equal(executions, 2);
  await secondChildStarted;
  secondController.abort(new Error('second invocation confirmed'));
  const afterCleanup = await afterCleanupRun;
  assert.equal(afterCleanup.childResults[0]?.status, 'canceled');

  releaseChild?.();
  await Promise.all(activeExecutions);
  await Promise.resolve();
  const thirdController = new AbortController();
  const afterLateSettlementRun = orchestrator.run({
    ...request,
    signal: thirdController.signal,
  });
  await Promise.resolve();

  assert.equal(executions, 3);
  await thirdChildStarted;
  thirdController.abort(new Error('third invocation confirmed'));
  const afterLateSettlement = await afterLateSettlementRun;
  assert.equal(afterLateSettlement.childResults[0]?.status, 'completed');
  assert.equal(afterLateSettlement.childResults[0]?.taskId, 'task-late-child-3');
}

async function testNeverSettlingExecutorIsBoundedByRacedCancellation(): Promise<void> {
  const orchestrator = createA2AOrchestrator({
    maxRetainedExecutions: 0,
  });
  const callerController = new AbortController();
  let executions = 0;
  let notifyStarted: (() => void) | undefined;
  let notifySecondStarted: (() => void) | undefined;
  const childStarted = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  const secondChildStarted = new Promise<void>((resolve) => {
    notifySecondStarted = resolve;
  });
  const request = {
    scope,
    parentTaskId: 'task-parent-never-settles',
    requests: [{ key: 'stuck-child', role: 'worker', prompt: 'ignore abort forever' }],
    deadlineMs: 1_000,
    parallelism: 1,
    executeChild: () => {
      executions += 1;
      notifyStarted?.();
      if (executions === 2) notifySecondStarted?.();
      return new Promise<A2AOrchestratorChildExecutionResult>(() => undefined);
    },
  };

  const firstRun = orchestrator.run({
    ...request,
    signal: callerController.signal,
  });
  await childStarted;
  const duplicateBeforeCancellation = orchestrator.run(request);
  await Promise.resolve();

  assert.equal(executions, 1);

  callerController.abort(new Error('caller canceled while child ignored abort'));
  const [firstResult, duplicateResult] = await Promise.all([firstRun, duplicateBeforeCancellation]);

  assert.equal(firstResult.childResults[0]?.status, 'canceled');
  assert.equal(duplicateResult.childResults[0]?.status, 'canceled');
  assert.equal(executions, 1);

  await Promise.resolve();
  const secondController = new AbortController();
  const afterCleanupRun = orchestrator.run({
    ...request,
    signal: secondController.signal,
  });
  await Promise.resolve();

  assert.equal(executions, 2);
  await secondChildStarted;
  secondController.abort(new Error('second invocation confirmed'));
  const afterCleanup = await afterCleanupRun;
  assert.equal(afterCleanup.childResults[0]?.status, 'canceled');
}

async function testConcurrencyCap(): Promise<void> {
  const orchestrator = createA2AOrchestrator();
  let active = 0;
  let maxActive = 0;

  await orchestrator.run({
    scope,
    parentTaskId: 'task-parent-cap',
    requests: [
      { key: 'one', role: 'worker', prompt: '1' },
      { key: 'two', role: 'worker', prompt: '2' },
      { key: 'three', role: 'worker', prompt: '3' },
      { key: 'four', role: 'worker', prompt: '4' },
    ],
    deadlineMs: 1_000,
    parallelism: 2,
    executeChild: async ({ childKey }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(20);
      active -= 1;
      return {
        taskId: `task-${childKey}`,
        status: 'completed',
        result: childKey,
      };
    },
  });

  assert.equal(maxActive, 2);
}

async function testDeadlineCancellation(): Promise<void> {
  const orchestrator = createA2AOrchestrator();
  let started = 0;

  const result = await orchestrator.run({
    scope,
    parentTaskId: 'task-parent-deadline',
    requests: [
      { key: 'first', role: 'worker', prompt: 'wait' },
      { key: 'second', role: 'worker', prompt: 'queue' },
    ],
    deadlineMs: 20,
    parallelism: 1,
    executeChild: async ({ childKey, signal }) => {
      started += 1;
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      return {
        taskId: `task-${childKey}`,
        status: 'canceled',
        error: 'should not win the race',
      };
    },
  });

  assert.equal(started, 1);
  assert.deepEqual(result.childResults.map((entry) => entry.status), ['canceled', 'canceled']);
  assert.match(result.childResults[0]?.error ?? '', /deadline exceeded/i);
  assert.match(result.childResults[1]?.error ?? '', /deadline exceeded/i);
}

async function testCallerAbortCancelsActiveAndQueuedChildren(): Promise<void> {
  const orchestrator = createA2AOrchestrator();
  const callerController = new AbortController();
  let started = 0;
  let activeSignal: AbortSignal | undefined;
  let notifyStarted: (() => void) | undefined;
  const childStarted = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });

  const runPromise = orchestrator.run({
    scope,
    parentTaskId: 'task-parent-caller-abort',
    requests: [
      { key: 'active', role: 'worker', prompt: 'wait for caller cancellation' },
      { key: 'queued', role: 'worker', prompt: 'must not start' },
    ],
    deadlineMs: 1_000,
    parallelism: 1,
    signal: callerController.signal,
    executeChild: async ({ childKey, signal }) => {
      started += 1;
      activeSignal = signal;
      notifyStarted?.();
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => resolve(), { once: true });
      });
      return {
        taskId: `task-${childKey}`,
        status: 'completed',
        result: 'late success must not win',
      };
    },
  });

  await childStarted;
  callerController.abort(new Error('caller requested cancellation'));
  const result = await runPromise;

  assert.equal(started, 1);
  assert.equal(activeSignal?.aborted, true);
  assert.deepEqual(result.childResults.map((entry) => entry.status), ['canceled', 'canceled']);
  assert.match(result.childResults[0]?.error ?? '', /caller requested cancellation/i);
  assert.match(result.childResults[1]?.error ?? '', /caller requested cancellation/i);
}

async function testLateExecutorRejectionAfterCancellationIsHandled(): Promise<void> {
  const orchestrator = createA2AOrchestrator();
  const callerController = new AbortController();
  const unhandledRejections: unknown[] = [];
  let notifyStarted: (() => void) | undefined;
  const childStarted = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  const onUnhandledRejection = (reason: unknown): void => {
    unhandledRejections.push(reason);
  };
  process.on('unhandledRejection', onUnhandledRejection);

  try {
    const runPromise = orchestrator.run({
      scope,
      parentTaskId: 'task-parent-late-rejection',
      requests: [{ key: 'late-reject', role: 'worker', prompt: 'reject after cancellation' }],
      deadlineMs: 1_000,
      parallelism: 1,
      signal: callerController.signal,
      executeChild: async () => {
        notifyStarted?.();
        await delay(20);
        throw new Error('late child rejection');
      },
    });

    await childStarted;
    callerController.abort(new Error('caller canceled before child rejected'));
    const result = await runPromise;
    assert.equal(result.childResults[0]?.status, 'canceled');

    await delay(40);
    assert.deepEqual(unhandledRejections, []);
  } finally {
    process.removeListener('unhandledRejection', onUnhandledRejection);
  }
}

async function testAbortListenerIsRemovedWhenChildSettles(): Promise<void> {
  const orchestrator = createA2AOrchestrator();
  let executionSignal: AbortSignal | undefined;

  await orchestrator.run({
    scope,
    parentTaskId: 'task-parent-listener-cleanup',
    requests: [{ key: 'settles', role: 'worker', prompt: 'complete normally' }],
    deadlineMs: 1_000,
    parallelism: 1,
    executeChild: async ({ signal }) => {
      executionSignal = signal;
      return { taskId: 'task-settles', status: 'completed', result: 'done' };
    },
  });

  assert.ok(executionSignal);
  assert.equal(getEventListeners(executionSignal, 'abort').length, 0);
}

async function testRedaction(): Promise<void> {
  const orchestrator = createA2AOrchestrator();

  const result = await orchestrator.run({
    scope,
    parentTaskId: 'task-parent-redaction',
    requests: [
      { key: 'result', role: 'worker', prompt: 'show' },
      { key: 'error', role: 'worker', prompt: 'fail' },
    ],
    deadlineMs: 1_000,
    parallelism: 2,
    executeChild: async ({ childKey }) => {
      if (childKey === 'result') {
        return {
          taskId: 'task-result',
          status: 'completed',
          result: 'prefix\u0001 Authorization: Bearer super-secret-token',
        };
      }
      return {
        taskId: 'task-error',
        status: 'failed',
        error: 'client_secret=hidden-value\u0007',
      };
    },
  });

  assert.equal(result.childResults[0]?.result?.includes('super-secret-token'), false);
  assert.match(result.childResults[0]?.result ?? '', /\[REDACTED\]/);
  assert.equal(result.childResults[0]?.result?.includes('\u0001'), false);
  assert.equal(result.childResults[0]?.result?.includes('�'), true);
  assert.equal(result.childResults[1]?.error?.includes('hidden-value'), false);
  assert.match(result.childResults[1]?.error ?? '', /client_secret=\[REDACTED\]/);
}

async function testConfiguredBounds(): Promise<void> {
  const orchestrator = createA2AOrchestrator({
    maxChildren: 1,
    maxPromptLength: 5,
    maxRoleLength: 4,
    maxDeadlineMs: 10,
    maxParallelism: 1,
  });

  await assert.rejects(
    () => orchestrator.run({
      scope,
      parentTaskId: 'task-parent-bounds-children',
      requests: [
        { key: 'one', role: 'ops', prompt: 'go' },
        { key: 'two', role: 'ops', prompt: 'go' },
      ],
      deadlineMs: 10,
      parallelism: 1,
      executeChild: async () => ({ taskId: 'task-one', status: 'completed', result: 'ok' }),
    }),
    (error: unknown) => error instanceof A2AContractError && error.code === 'GraphLimitExceededError',
  );

  await assert.rejects(
    () => orchestrator.run({
      scope,
      parentTaskId: 'task-parent-bounds-role',
      requests: [{ key: 'one', role: 'toolong', prompt: 'go' }],
      deadlineMs: 10,
      parallelism: 1,
      executeChild: async () => ({ taskId: 'task-one', status: 'completed', result: 'ok' }),
    }),
    (error: unknown) => error instanceof A2AContractError && error.code === 'InvalidRequestError',
  );

  await assert.rejects(
    () => orchestrator.run({
      scope,
      parentTaskId: 'task-parent-bounds-prompt',
      requests: [{ key: 'one', role: 'ops', prompt: 'prompt-too-long' }],
      deadlineMs: 10,
      parallelism: 1,
      executeChild: async () => ({ taskId: 'task-one', status: 'completed', result: 'ok' }),
    }),
    (error: unknown) => error instanceof A2AContractError && error.code === 'InvalidRequestError',
  );

  await assert.rejects(
    () => orchestrator.run({
      scope,
      parentTaskId: 'task-parent-bounds-deadline',
      requests: [{ key: 'one', role: 'ops', prompt: 'go' }],
      deadlineMs: 20,
      parallelism: 1,
      executeChild: async () => ({ taskId: 'task-one', status: 'completed', result: 'ok' }),
    }),
    (error: unknown) => error instanceof A2AContractError && error.code === 'DeadlineExceededError',
  );

  await assert.rejects(
    () => orchestrator.run({
      scope,
      parentTaskId: 'task-parent-bounds-parallelism',
      requests: [{ key: 'one', role: 'ops', prompt: 'go' }],
      deadlineMs: 10,
      parallelism: 2,
      executeChild: async () => ({ taskId: 'task-one', status: 'completed', result: 'ok' }),
    }),
    (error: unknown) => error instanceof A2AContractError && error.code === 'GraphLimitExceededError',
  );
}

async function testDirectGraphAdmissionUsesCorePolicy(): Promise<void> {
  const orchestrator = createCoreA2AOrchestrator();
  const input = {
    scope,
    parentTaskId: 'task-parent-graph-admission',
    requests: [{ key: 'review', role: 'reviewer', prompt: 'Review the bounded Core changes.' }],
    deadlineMs: 1_000,
    parallelism: 1,
    executeChild: async () => ({ taskId: 'task-review', status: 'completed' as const, result: 'reviewed' }),
  };

  await assert.rejects(
    () => orchestrator.run({ ...input, depth: 9, fanOutIndex: 0 }),
    (error: unknown) => error instanceof A2AContractError && error.code === 'GraphLimitExceededError',
  );
  await assert.rejects(
    () => orchestrator.run({ ...input, depth: 0, fanOutIndex: 16 }),
    (error: unknown) => error instanceof A2AContractError && error.code === 'GraphLimitExceededError',
  );
}

async function main(): Promise<void> {
  await testBasicExecution();
  await testCoreRoleCatalogBoundary();
  await testSynchronousExecutorThrowBecomesFailedChild();
  await testCompletedChildRequiresNonEmptyResult();
  await testDuplicateOrderingAndDeterminism();
  await testExecutionMemoryIsScopedAndReplaysWithinTrustedScope();
  await testSettledExecutionMemoryUsesBoundedRetention();
  await testLateSettlementAfterCancellationBecomesEligibleForCleanup();
  await testNeverSettlingExecutorIsBoundedByRacedCancellation();
  await testConcurrencyCap();
  await testDeadlineCancellation();
  await testCallerAbortCancelsActiveAndQueuedChildren();
  await testLateExecutorRejectionAfterCancellationIsHandled();
  await testAbortListenerIsRemovedWhenChildSettles();
  await testRedaction();
  await testConfiguredBounds();
  await testDirectGraphAdmissionUsesCorePolicy();

  console.log('PASS: A2A orchestrator covers immutable results, scope-safe idempotency, bounded retention, ordering, concurrency caps, cancellation, late rejection handling, listener cleanup, redaction, and bounds');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
