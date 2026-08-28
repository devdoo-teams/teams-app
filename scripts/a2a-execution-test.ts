import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { AgentService } from '../src/server/agent-service.js';
import type { A2AScope, A2ASendRequest } from '../src/server/a2a-contract.js';
import { A2AStore } from '../src/server/a2a-store.js';
import { createA2AExecutionAdapter } from '../src/server/a2a-execution.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-execution-test-'));
const scope: A2AScope = {
  tenantId: 'tenant-a',
  requesterId: 'requester-a',
  conversationId: 'conversation-a',
};
const request: A2ASendRequest = {
  message: {
    messageId: 'message-a',
    role: 'user',
    contextId: 'context-a',
    parts: [{ text: 'Complete the bounded Core task.', mediaType: 'text/plain' }],
  },
  idempotencyKey: 'idem-a',
  inputMode: 'text/plain',
  outputMode: 'text/plain',
  depth: 0,
  fanOutIndex: 0,
};

try {
  const store = new A2AStore(path.join(root, 'store-success.json'));
  await store.initialize();
  const task = await store.createOrGetTask({
    scope,
    contextId: 'context-a',
    message: request.message,
    idempotencyKey: request.idempotencyKey,
    fingerprint: 'fingerprint-a',
  });
  let calls = 0;
  const agentService = {
    runForCopilot: async () => {
      calls += 1;
      return { status: 'completed', result: 'bounded result' };
    },
  } as unknown as AgentService;
  const audits: unknown[] = [];
  const submit = createA2AExecutionAdapter({
    store,
    agentService,
    timeoutMs: 5_000,
    onDispatchAudit: (audit) => audits.push(audit),
  });
  await submit({ task, request, scope });
  await submit({ task, request, scope });

  const deadline = Date.now() + 1_000;
  let completed = store.getTask(task.id, scope);
  while (completed?.status !== 'completed' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    completed = store.getTask(task.id, scope);
  }
  assert.equal(calls, 1);
  assert.equal(completed?.status, 'completed');
  assert.equal(completed?.artifacts.length, 1);
  assert.equal(completed?.artifacts[0]?.name, 'result.txt');
  assert.equal(completed?.artifacts[0]?.content?.text, 'bounded result');
  while (audits.length < 1 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(audits.length, 1);
  assert.equal(
    (audits[0] as { statusCounts: Array<{ status: string; count: number }> }).statusCounts
      .find((entry) => entry.status === 'completed')?.count,
    1,
  );
  assert.equal('prompt' in (audits[0] as object), false);
  assert.equal('result' in (audits[0] as object), false);
  assert.equal('error' in (audits[0] as object), false);

  const failedCancelStore = new A2AStore(path.join(root, 'store-cancel-failure.json'));
  await failedCancelStore.initialize();
  const failedCancelTask = await failedCancelStore.createOrGetTask({
    scope,
    contextId: 'context-cancel-failure',
    message: {
      ...request.message,
      messageId: 'message-cancel-failure',
      contextId: 'context-cancel-failure',
    },
    idempotencyKey: 'idem-cancel-failure',
    fingerprint: 'fingerprint-cancel-failure',
  });
  await failedCancelStore.transitionTask(failedCancelTask.id, scope, 'working');
  await failedCancelStore.bindAgentJob(failedCancelTask.id, scope, 'job-cancel-failure');
  const failedCancelAdapter = createA2AExecutionAdapter({
    store: failedCancelStore,
    agentService: {
      get: () => ({ id: 'job-cancel-failure', status: 'running' }),
      cancelStrict: async () => {
        throw new Error('provider cancellation unavailable');
      },
    } as unknown as AgentService,
  });
  const failedCancel = await failedCancelAdapter.cancel({ taskId: failedCancelTask.id, scope });
  assert.equal(failedCancel?.status, 'working', 'A2A task cancellation must stay non-terminal until the child confirms');
  assert.equal(failedCancelStore.getTask(failedCancelTask.id, scope)?.status, 'working');

  const emptyResultStore = new A2AStore(path.join(root, 'store-empty-result.json'));
  await emptyResultStore.initialize();
  const emptyResultTask = await emptyResultStore.createOrGetTask({
    scope,
    contextId: 'context-empty-result',
    message: {
      ...request.message,
      messageId: 'message-empty-result',
      contextId: 'context-empty-result',
    },
    idempotencyKey: 'idem-empty-result',
    fingerprint: 'fingerprint-empty-result',
  });
  const emptyResultAgentService = {
    runForCopilot: async () => ({ status: 'completed', result: '  \n\t  ' }),
  } as unknown as AgentService;
  const emptyResultAudits: unknown[] = [];
  const submitEmptyResult = createA2AExecutionAdapter({
    store: emptyResultStore,
    agentService: emptyResultAgentService,
    timeoutMs: 5_000,
    onDispatchAudit: (audit) => {
      emptyResultAudits.push(audit);
      throw new Error('audit sink unavailable');
    },
  });
  await submitEmptyResult({
    task: emptyResultTask,
    request: {
      ...request,
      message: {
        ...request.message,
        messageId: 'message-empty-result',
        contextId: 'context-empty-result',
      },
      idempotencyKey: 'idem-empty-result',
    },
    scope,
  });

  const emptyResultDeadline = Date.now() + 1_000;
  let failed = emptyResultStore.getTask(emptyResultTask.id, scope);
  while (failed?.status !== 'failed' && Date.now() < emptyResultDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    failed = emptyResultStore.getTask(emptyResultTask.id, scope);
  }
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.artifacts.length, 0);
  assert.match(failed?.error ?? '', /completed child result must contain a non-empty result/i);
  while (emptyResultAudits.length < 1 && Date.now() < emptyResultDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(emptyResultAudits.length, 1);

  const canceledStore = new A2AStore(path.join(root, 'store-canceled.json'));
  await canceledStore.initialize();
  const canceledTask = await canceledStore.createOrGetTask({
    scope,
    contextId: 'context-canceled',
    message: {
      ...request.message,
      messageId: 'message-canceled',
      contextId: 'context-canceled',
    },
    idempotencyKey: 'idem-canceled',
    fingerprint: 'fingerprint-canceled',
  });
  const canceledAudits: unknown[] = [];
  const submitCanceled = createA2AExecutionAdapter({
    store: canceledStore,
    agentService: {
      runForCopilot: async () => ({ status: 'cancelled' }),
    } as unknown as AgentService,
    timeoutMs: 5_000,
    onDispatchAudit: (audit) => canceledAudits.push(audit),
  });
  await submitCanceled({
    task: canceledTask,
    request: {
      ...request,
      message: {
        ...request.message,
        messageId: 'message-canceled',
        contextId: 'context-canceled',
      },
      idempotencyKey: 'idem-canceled',
    },
    scope,
  });
  const canceledDeadline = Date.now() + 1_000;
  let canceled = canceledStore.getTask(canceledTask.id, scope);
  while (canceled?.status !== 'canceled' && Date.now() < canceledDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    canceled = canceledStore.getTask(canceledTask.id, scope);
  }
  assert.equal(canceled?.status, 'canceled');
  while (canceledAudits.length < 1 && Date.now() < canceledDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(canceledAudits.length, 1);

  const restartStore = new A2AStore(path.join(root, 'store-restart-dispatch-audit.json'));
  await restartStore.initialize();
  const restartTask = await restartStore.createOrGetTask({
    scope,
    contextId: 'context-restart-dispatch-audit',
    message: {
      ...request.message,
      messageId: 'message-restart-dispatch-audit',
      contextId: 'context-restart-dispatch-audit',
    },
    idempotencyKey: 'idem-restart-dispatch-audit',
    fingerprint: 'fingerprint-restart-dispatch-audit',
  });
  await restartStore.createOrGetDispatchIntent({
    parentTaskId: restartTask.id,
    scope,
    requestFingerprint: 'dispatch-restart-dispatch-audit',
    deadlineAt: new Date(Date.now() + 60_000).toISOString(),
    children: [{
      childKey: 'review',
      childIdempotencyKey: 'child-restart-dispatch-audit',
      role: 'reviewer',
      agentId: 'codex-reviewer',
      providerId: 'codex-cli',
      requestSha256: 'a'.repeat(64),
    }],
  });
  await restartStore.bindDispatchChild(restartTask.id, scope, 'review', 'job-restart-dispatch-audit');
  const restartAudits: unknown[] = [];
  const restartAdapter = createA2AExecutionAdapter({
    store: restartStore,
    agentService: {
      get: (id: string) => id === 'job-restart-dispatch-audit'
        ? { id, provider: 'codex', status: 'running' }
        : undefined,
      waitForTerminal: async (id: string) => ({
        id,
        status: 'completed' as const,
        result: 'recovered audit result',
      }),
      runForCopilot: async () => {
        throw new Error('restart reconciliation must not submit a duplicate child job');
      },
    } as unknown as AgentService,
    timeoutMs: 5_000,
    onDispatchAudit: (audit) => restartAudits.push(audit),
  });

  await restartAdapter.initialize();

  assert.equal(restartStore.getTask(restartTask.id, scope)?.status, 'completed');
  assert.equal(restartStore.getDispatchIntent(restartTask.id, scope)?.status, 'completed');
  assert.equal(restartAudits.length, 1);
  assert.equal(
    (restartAudits[0] as { statusCounts: Array<{ status: string; count: number }> }).statusCounts
      .find((entry) => entry.status === 'completed')?.count,
    1,
  );
  assert.equal(
    (restartAudits[0] as { entries: Array<{ childKey: string; agentId: string; providerId: string; status: string }> })
      .entries[0]?.status,
    'completed',
  );

  const singleRestartStore = new A2AStore(path.join(root, 'store-restart-single-task.json'));
  await singleRestartStore.initialize();
  const singleRestartTask = await singleRestartStore.createOrGetTask({
    scope,
    contextId: 'context-restart-single-task',
    message: {
      ...request.message,
      messageId: 'message-restart-single-task',
      contextId: 'context-restart-single-task',
    },
    idempotencyKey: 'idem-restart-single-task',
    fingerprint: 'fingerprint-restart-single-task',
  });
  await singleRestartStore.transitionTask(singleRestartTask.id, scope, 'working');
  await singleRestartStore.bindAgentJob(singleRestartTask.id, scope, 'job-restart-single-task');
  let singleRestartWaitCalls = 0;
  const singleRestartAdapter = createA2AExecutionAdapter({
    store: singleRestartStore,
    agentService: {
      get: (id: string) => id === 'job-restart-single-task'
        ? { id, status: 'running', provider: 'codex' }
        : undefined,
      waitForTerminal: async (id: string) => {
        singleRestartWaitCalls += 1;
        return { id, status: 'completed' as const, result: 'recovered single-task result' };
      },
      runForCopilot: async () => {
        throw new Error('single-task restart reconciliation must not submit a duplicate child job');
      },
    } as unknown as AgentService,
    timeoutMs: 5_000,
  });

  await singleRestartAdapter.initialize();

  const recoveredSingleTask = singleRestartStore.getTask(singleRestartTask.id, scope);
  assert.equal(singleRestartWaitCalls, 1, 'restart recovery must wait on the persisted child job');
  assert.equal(recoveredSingleTask?.status, 'completed');
  assert.equal(recoveredSingleTask?.artifacts[0]?.content?.text, 'recovered single-task result');

  console.log('a2a-execution-test: PASS');
} finally {
  await removeEventually(root);
}

async function removeEventually(target: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (true) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOTEMPTY' || Date.now() >= deadline) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}
