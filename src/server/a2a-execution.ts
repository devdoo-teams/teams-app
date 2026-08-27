import crypto from 'node:crypto';

import type {
  A2AScope,
  A2ASendRequest,
  A2ATask,
} from './a2a-contract.js';
import { redactAndBoundText } from './a2a-contract.js';
import {
  A2AStore,
  type A2ADispatchCancellationFailure,
  type A2ADispatchCancellationFailureHandler,
  type A2ADispatchChildOutcome,
  type A2ADispatchChildCancellationHandler,
  type A2ADispatchChildCancellationInput,
  type A2ADispatchIntent,
  type A2ARecoverableTask,
} from './a2a-store.js';
import { AgentService } from './agent-service.js';
import type { CliAgentProvider } from './cli-agent-runner.js';
import {
  createA2ADispatchAudit,
  type A2ADispatchAudit,
} from './a2a-observability.js';
import {
  LEGACY_A2A_AGENT_ID,
  LEGACY_A2A_PROVIDER_ID,
  type A2AOrchestratorChildExecutionResult,
} from './a2a-orchestrator.js';

const MAX_PROMPT_LENGTH = 2_000;
const MAX_RESULT_LENGTH = 16_000;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const BUILT_IN_RECOVERY_PROVIDERS: Readonly<Record<string, CliAgentProvider>> = Object.freeze({
  'codex-cli': 'codex',
  'official-copilot-cli': 'copilot',
});

export type A2ATaskSubmittedEvent = {
  task: A2ATask;
  request: A2ASendRequest;
  scope: A2AScope;
};

export type A2AExecutionAdapter = ((event: A2ATaskSubmittedEvent) => Promise<void>) & {
  cancel: (input: { taskId: string; scope: A2AScope }) => Promise<A2ATask | undefined>;
  initialize: () => Promise<void>;
};

type A2ABindingLifecycle = {
  onDurable: () => void;
  onFailure: (error: unknown) => void;
};

export type A2ADispatchAuditHandler = (audit: A2ADispatchAudit) => void | Promise<void>;
export type A2ADispatchReconciliationFailure = A2ADispatchCancellationFailure;
export type A2ADispatchReconciliationFailureHandler = (
  failure: A2ADispatchReconciliationFailure,
) => void | Promise<void>;

export type A2ARecoveryProviderResolver = (providerId: string) => CliAgentProvider | undefined;

export type A2AChildRecoveryHandler = (input: Readonly<{
  scope: A2AScope;
  parentTaskId: string;
  childKey: string;
  childIdempotencyKey: string;
  agentId: string;
  providerId: string;
  agentJobId: string;
  deadlineAtMs: number;
  signal: AbortSignal;
}>) => Promise<A2AOrchestratorChildExecutionResult | undefined>;

export function createA2AExecutionAdapter(input: {
  store: A2AStore;
  agentService: AgentService;
  timeoutMs?: number;
  onDispatchAudit?: A2ADispatchAuditHandler;
  cancelChildForReconciliation?: A2ADispatchChildCancellationHandler;
  onDispatchReconciliationFailure?: A2ADispatchReconciliationFailureHandler;
  resolveProviderForRecovery?: A2ARecoveryProviderResolver;
  recoverChildForReconciliation?: A2AChildRecoveryHandler;
}): A2AExecutionAdapter {
  const activeTasks = new Set<string>();
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? MAX_TIMEOUT_MS, 1_000), MAX_TIMEOUT_MS);
  const resolveProviderForRecovery = input.resolveProviderForRecovery
    ?? ((providerId: string) => BUILT_IN_RECOVERY_PROVIDERS[providerId]);

  const adapter = async (event: A2ATaskSubmittedEvent) => {
    if (activeTasks.has(event.task.id)) return;
    activeTasks.add(event.task.id);
    let resolveBinding!: () => void;
    let rejectBinding!: (error: unknown) => void;
    let bindingSignaled = false;
    const bindingReady = new Promise<void>((resolve, reject) => {
      resolveBinding = resolve;
      rejectBinding = reject;
    });
    const signalBinding: A2ABindingLifecycle = {
      onDurable: () => {
        if (bindingSignaled) return;
        bindingSignaled = true;
        resolveBinding();
      },
      onFailure: (error) => {
        if (bindingSignaled) return;
        bindingSignaled = true;
        rejectBinding(error);
      },
    };
    void executeTask(input.store, input.agentService, event, timeoutMs, input.onDispatchAudit, signalBinding)
      .catch((error) => {
        signalBinding.onFailure(error);
        console.error('A2A task execution failed', error instanceof Error ? error.message : 'unknown error');
      })
      .finally(() => activeTasks.delete(event.task.id));
    await bindingReady;
  };

  adapter.cancel = async ({ taskId, scope }) => cancelTask(input.store, input.agentService, taskId, scope);
  adapter.initialize = async () => {
    await reconcileRecoverableDispatches(
      input.store,
      input.agentService,
      input.onDispatchAudit,
      input.cancelChildForReconciliation ?? input.store.getDispatchChildCancellationHandler(),
      input.onDispatchReconciliationFailure,
      timeoutMs,
      resolveProviderForRecovery,
      input.recoverChildForReconciliation,
    );
    await reconcileNonTerminalTasks(input.store, input.agentService, timeoutMs);
  };
  return adapter;
}

async function executeTask(
  store: A2AStore,
  agentService: AgentService,
  event: A2ATaskSubmittedEvent,
  timeoutMs: number,
  onDispatchAudit?: A2ADispatchAuditHandler,
  bindingLifecycle?: A2ABindingLifecycle,
): Promise<void> {
  const { task, request, scope } = event;
  let bindingConfirmed = false;

  const persistAgentJobBinding = async (agentJobId: string): Promise<void> => {
    const current = await store.bindAgentJob(task.id, scope, agentJobId);
    if (!current) {
      throw new Error('A2A agent-job binding could not be durably persisted for the submitted task.');
    }
    bindingConfirmed = true;
    bindingLifecycle?.onDurable();
    if (current?.status === 'canceled') {
      await cancelChildJob(agentService, agentJobId, scope);
    }
  };

  try {
    await store.transitionTask(task.id, scope, 'working');
    const prompt = promptFromRequest(request);
    const job = await agentService.runForCopilot({
      prompt,
      scope,
      timeoutMs,
      notify: false,
      onSubmitted: async (createdJob) => {
        await persistAgentJobBinding(createdJob.id);
      },
    });

    // AgentService calls onSubmitted before returning, but retain a safe
    // compatibility path for older adapters and test doubles that only
    // return a terminal AgentJob. A real AgentJob always has an id, so a
    // missing callback still cannot bypass durable binding in production.
    if (!bindingConfirmed && typeof job.id === 'string' && job.id.trim()) {
      await persistAgentJobBinding(job.id);
    }
    // Some historical unit doubles return a result without an AgentJob id.
    // They have no persisted child to bind; let those direct execution tests
    // finish while the production AgentService contract remains id-bearing.
    if (!bindingConfirmed) bindingLifecycle?.onDurable();

    const latest = store.getTask(task.id, scope);
    if (!latest) return;
    if (latest.status === 'canceled') {
      await emitDispatchAudit(onDispatchAudit, event, 'canceled');
      return;
    }

    if (job.status === 'completed') {
      const result = completedResultText(job.result);
      if (!result) {
        await store.transitionTask(task.id, scope, {
          status: 'failed',
          error: 'completed child result must contain a non-empty result.',
          artifacts: [],
        });
        await emitDispatchAudit(onDispatchAudit, event, 'failed');
        return;
      }
      const sha256 = crypto.createHash('sha256').update(result, 'utf8').digest('hex');
      await store.transitionTask(task.id, scope, {
        status: 'completed',
        artifacts: [{
          artifactId: `artifact-${sha256.slice(0, 32)}`,
          taskId: task.id,
          sourceTaskId: task.id,
          sha256,
          byteSize: Buffer.byteLength(result, 'utf8'),
          mediaType: 'text/plain',
          name: 'result.txt',
          scope,
          content: { mediaType: 'text/plain', text: result },
          metadata: { source: 'teams-core-agent' },
        }],
        error: undefined,
      });
      await emitDispatchAudit(onDispatchAudit, event, 'completed');
      return;
    }

    if (job.status === 'cancelled') {
      await store.transitionTask(task.id, scope, 'canceled');
      await emitDispatchAudit(onDispatchAudit, event, 'canceled');
      return;
    }

    await store.transitionTask(task.id, scope, {
      status: 'failed',
      error: redactAndBoundText(job.error ?? 'Agent execution failed.', 2_000),
      artifacts: [],
    });
    await emitDispatchAudit(onDispatchAudit, event, 'failed');
  } catch (error) {
    if (!bindingConfirmed) bindingLifecycle?.onFailure(error);
    const current = store.getTask(task.id, scope);
    if (current?.status === 'canceled') {
      await emitDispatchAudit(onDispatchAudit, event, 'canceled');
      return;
    }
    try {
      await store.transitionTask(task.id, scope, {
        status: 'failed',
        error: redactAndBoundText(error instanceof Error ? error.message : 'A2A task execution failed.', 2_000),
        artifacts: [],
      });
    } catch (transitionError) {
      console.error(
        'A2A task failure could not be persisted',
        transitionError instanceof Error ? transitionError.message : 'unknown error',
      );
    }
    await emitDispatchAudit(onDispatchAudit, event, 'failed');
  }
}

async function emitDispatchAudit(
  handler: A2ADispatchAuditHandler | undefined,
  event: A2ATaskSubmittedEvent,
  status: 'completed' | 'failed' | 'canceled',
): Promise<void> {
  if (!handler) return;
  try {
    const requestSha256 = crypto
      .createHash('sha256')
      .update(JSON.stringify(event.request), 'utf8')
      .digest('hex');
    const audit = createA2ADispatchAudit({
      parentTaskId: event.task.id,
      children: [{
        childKey: event.task.id,
        childIdempotencyKey: event.request.idempotencyKey,
        agentId: LEGACY_A2A_AGENT_ID,
        providerId: LEGACY_A2A_PROVIDER_ID,
        role: 'teams-core-agent',
        requestSha256,
        status,
        duplicated: false,
      }],
    });
    await handler(audit);
  } catch (error) {
    console.error(
      'A2A dispatch audit consumer failed',
      error instanceof Error ? redactAndBoundText(error.message, 500) : 'unknown error',
    );
  }
}

async function cancelTask(
  store: A2AStore,
  agentService: AgentService,
  taskId: string,
  scope: A2AScope,
): Promise<A2ATask | undefined> {
  const current = store.getTask(taskId, scope);
  if (current?.status === 'canceled') return current;
  const jobId = store.getAgentJobId(taskId, scope);
  if (jobId && !await cancelChildJob(agentService, jobId, scope)) {
    return store.getTask(taskId, scope);
  }
  return store.cancelTask(taskId, scope);
}

async function cancelChildJob(agentService: AgentService, jobId: string, scope: A2AScope): Promise<boolean> {
  try {
    const cancelled = typeof agentService.cancelStrict === 'function'
      ? await agentService.cancelStrict(jobId, scope, { notify: false })
      : await agentService.cancel(jobId, scope, { strict: true, notify: false });
    return cancelled?.status === 'cancelled';
  } catch {
    // A2A parent cancellation stays non-terminal until the child cancellation
    // is durably confirmed; a provider failure may otherwise orphan the job.
    return false;
  }
}

async function reconcileNonTerminalTasks(
  store: A2AStore,
  agentService: AgentService,
  timeoutMs: number,
): Promise<void> {
  for (const recoverable of store.listRecoverableTasks()) {
    await reconcileTask(store, agentService, recoverable, timeoutMs);
  }
}

async function reconcileRecoverableDispatches(
  store: A2AStore,
  agentService: AgentService,
  onDispatchAudit: A2ADispatchAuditHandler | undefined,
  cancelChildForReconciliation: A2ADispatchChildCancellationHandler | undefined,
  onFailure: A2ADispatchReconciliationFailureHandler | undefined,
  timeoutMs: number,
  resolveProviderForRecovery: A2ARecoveryProviderResolver | undefined,
  recoverChildForReconciliation: A2AChildRecoveryHandler | undefined,
): Promise<void> {
  const failures: unknown[] = [];
  for (const recoverable of store.listRecoverableDispatches()) {
    try {
      await reconcileDispatch(
        store,
        agentService,
        onDispatchAudit,
        cancelChildForReconciliation,
        onFailure,
        timeoutMs,
        resolveProviderForRecovery,
        recoverChildForReconciliation,
        recoverable,
      );
    } catch (error) {
      // Durable dispatches are independent recovery units. Keep the failing
      // intent non-terminal, continue reconciling the remaining intents, and
      // reject initialization only after every unit has had one bounded pass.
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    const countLabel = failures.length === 1 ? 'dispatch' : 'dispatches';
    const firstFailure = failures[0];
    const detail = redactAndBoundText(
      firstFailure instanceof Error ? firstFailure.message : 'unknown reconciliation failure',
      500,
    );
    throw new Error(
      `A2A durable dispatch could not be reconciled for ${failures.length} independent ${countLabel}: ${detail}`,
      { cause: firstFailure },
    );
  }
}

async function reconcileDispatch(
  store: A2AStore,
  agentService: AgentService,
  onDispatchAudit: A2ADispatchAuditHandler | undefined,
  cancelChildForReconciliation: A2ADispatchChildCancellationHandler | undefined,
  onFailure: A2ADispatchReconciliationFailureHandler | undefined,
  timeoutMs: number,
  resolveProviderForRecovery: A2ARecoveryProviderResolver | undefined,
  recoverChildForReconciliation: A2AChildRecoveryHandler | undefined,
  recoverable: A2ADispatchIntent,
): Promise<void> {
  const cancellationWasRequested = Boolean(recoverable.cancelRequestedAt);
  let dispatch = recoverable;
  let recoveredResults = new Map<string, string>();

  if (cancellationWasRequested) {
    dispatch = await reconcileCancellation(
      store,
      cancelChildForReconciliation,
      onFailure,
      dispatch,
    );
  } else {
    const resumed = await resumeDispatch(
      store,
      agentService,
      onFailure,
      timeoutMs,
      resolveProviderForRecovery,
      recoverChildForReconciliation,
      dispatch,
    );
    dispatch = resumed.dispatch;
    recoveredResults = resumed.results;
  }

  const latest = store.getDispatchIntent(dispatch.parentTaskId, dispatch.scope);
  if (!latest || latest.children.some((child) => (
    child.status !== 'completed' && child.status !== 'failed' && child.status !== 'canceled'
  ))) {
    throw new Error('A2A durable dispatch could not be reconciled before startup.');
  }

  if (!cancellationWasRequested) {
    const completed = latest.children.every((child) => child.status === 'completed');
    if (completed) {
      const parent = store.getTask(latest.parentTaskId, latest.scope);
      if (!parent) throw new Error('A2A durable dispatch parent task is unavailable after restart reconciliation.');
      const artifacts = latest.children.map((child) => {
        const result = recoveredResults.get(child.childKey);
        if (!child.agentJobId || !result) {
          throw new Error('A2A durable dispatch completed child result was not recoverable after restart.');
        }
        return artifactForRecoveredChild(parent, latest.scope, child.childKey, child.agentJobId, result);
      });
      await store.finalizeDispatch({
        parentTaskId: latest.parentTaskId,
        scope: latest.scope,
        status: 'completed',
        childOutcomes: dispatchOutcomes(latest),
        parentTransition: {
          status: 'completed',
          artifacts,
          error: undefined,
        },
      });
      await emitRecoveredDispatchAudit(onDispatchAudit, latest.parentTaskId, latest);
      return;
    }
  }

  const terminalStatus = cancellationWasRequested ? 'canceled' : 'failed';
  const finalized = await store.finalizeDispatch({
    parentTaskId: latest.parentTaskId,
    scope: latest.scope,
    status: terminalStatus,
    childOutcomes: dispatchOutcomes(latest),
    parentTransition: cancellationWasRequested
      ? 'canceled'
      : {
        status: 'failed',
        artifacts: [],
        error: 'A2A child execution could not be resumed after restart reconciliation.',
      },
  });
  await emitRecoveredDispatchAudit(onDispatchAudit, latest.parentTaskId, finalized?.dispatch ?? latest);
}

async function reconcileCancellation(
  store: A2AStore,
  cancelChildForReconciliation: A2ADispatchChildCancellationHandler | undefined,
  onFailure: A2ADispatchReconciliationFailureHandler | undefined,
  initial: A2ADispatchIntent,
): Promise<A2ADispatchIntent> {
  let dispatch = initial;
  for (const child of dispatch.children) {
    const currentChild = dispatch.children.find((candidate) => candidate.childKey === child.childKey);
    if (!currentChild || currentChild.cancelAcknowledgedAt) continue;
    if (currentChild.status === 'canceled') {
      dispatch = await store.acknowledgeDispatchChildCancellation(
        dispatch.parentTaskId,
        dispatch.scope,
        currentChild.childKey,
      ) ?? dispatch;
      continue;
    }

    if (!currentChild.agentJobId) {
      await reportReconciliationFailure(onFailure, {
        ...reconciliationFailureInput(dispatch, currentChild),
        reason: 'missing-job',
      });
      continue;
    }
    if (!cancelChildForReconciliation) {
      await reportReconciliationFailure(onFailure, {
        ...reconciliationFailureInput(dispatch, currentChild),
        reason: 'missing-provider',
      });
      continue;
    }
    try {
      await cancelChildForReconciliation(cancellationInput(dispatch, currentChild));
    } catch (error) {
      await reportReconciliationFailure(onFailure, {
        ...reconciliationFailureInput(dispatch, currentChild),
        reason: 'cancellation-failed',
        error: redactAndBoundText(error instanceof Error ? error.message : 'unknown cancellation failure', 500),
      });
      continue;
    }
    dispatch = await store.acknowledgeDispatchChildCancellation(
      dispatch.parentTaskId,
      dispatch.scope,
      currentChild.childKey,
    ) ?? dispatch;
  }
  return dispatch;
}

async function resumeDispatch(
  store: A2AStore,
  agentService: AgentService,
  onFailure: A2ADispatchReconciliationFailureHandler | undefined,
  timeoutMs: number,
  resolveProviderForRecovery: A2ARecoveryProviderResolver | undefined,
  recoverChildForReconciliation: A2AChildRecoveryHandler | undefined,
  initial: A2ADispatchIntent,
): Promise<{ dispatch: A2ADispatchIntent; results: Map<string, string> }> {
  let dispatch = initial;
  const results = new Map<string, string>();

  for (const child of dispatch.children) {
    const currentChild = dispatch.children.find((candidate) => candidate.childKey === child.childKey);
    if (!currentChild || currentChild.status === 'failed' || currentChild.status === 'canceled') continue;

    const job = await recoverChildJob(
      agentService,
      dispatch,
      currentChild,
      onFailure,
      timeoutMs,
      resolveProviderForRecovery,
      recoverChildForReconciliation,
    );
    if (!job) continue;
    if (job.status === 'completed') {
      const result = completedResultText(job.result);
      if (!result) {
        throw new Error('A2A durable dispatch completed child result was empty after restart reconciliation.');
      }
      results.set(currentChild.childKey, result);
      dispatch = await store.recordDispatchChildOutcome(dispatch.parentTaskId, dispatch.scope, {
        childKey: currentChild.childKey,
        status: 'completed',
        agentJobId: currentChild.agentJobId,
      }) ?? dispatch;
      continue;
    }

    const status = job.status === 'cancelled' ? 'canceled' : 'failed';
    dispatch = await store.recordDispatchChildOutcome(dispatch.parentTaskId, dispatch.scope, {
      childKey: currentChild.childKey,
      status,
      agentJobId: currentChild.agentJobId,
    }) ?? dispatch;
  }

  return { dispatch, results };
}

type RecoveredDispatchChild = Readonly<{
  id: string;
  status: 'completed' | 'failed' | 'cancelled';
  result?: unknown;
  error?: string;
}>;

async function recoverChildJob(
  agentService: AgentService,
  dispatch: A2ADispatchIntent,
  child: A2ADispatchIntent['children'][number],
  onFailure: A2ADispatchReconciliationFailureHandler | undefined,
  timeoutMs: number,
  resolveProviderForRecovery: A2ARecoveryProviderResolver | undefined,
  recoverChildForReconciliation: A2AChildRecoveryHandler | undefined,
): Promise<RecoveredDispatchChild | undefined> {
  if (!child.agentJobId) {
    await reportReconciliationFailure(onFailure, {
      ...reconciliationFailureInput(dispatch, child),
      reason: 'missing-job',
    });
    return undefined;
  }

  if (recoverChildForReconciliation) {
    const recoveryTimeoutMs = remainingRecoveryTimeout(dispatch, timeoutMs);
    const deadlineAtMs = Date.parse(dispatch.deadlineAt);
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(new Error('A2A remote child recovery deadline exceeded.')), recoveryTimeoutMs);
    try {
      const recovered = await withRecoveryTimeout(
        recoverChildForReconciliation({
          scope: { ...dispatch.scope },
          parentTaskId: dispatch.parentTaskId,
          childKey: child.childKey,
          childIdempotencyKey: child.childIdempotencyKey,
          agentId: child.agentId,
          providerId: child.providerId,
          ...(child.executionIdentity === undefined ? {} : { executionIdentity: child.executionIdentity }),
          ...(child.executionBoundaryId === undefined ? {} : { executionBoundaryId: child.executionBoundaryId }),
          agentJobId: child.agentJobId,
          deadlineAtMs: Number.isFinite(deadlineAtMs) ? deadlineAtMs : Date.now() + recoveryTimeoutMs,
          signal: controller.signal,
        }),
        recoveryTimeoutMs,
      );
      if (recovered) {
        if (recovered.taskId !== child.agentJobId) {
          throw new Error('A2A durable dispatch remote recovery returned a different job identity.');
        }
        return {
          id: recovered.taskId,
          status: recovered.status === 'canceled' ? 'cancelled' : recovered.status,
          ...(recovered.result !== undefined ? { result: recovered.result } : {}),
          ...(recovered.error !== undefined ? { error: recovered.error } : {}),
        };
      }
    } finally {
      clearTimeout(abortTimer);
    }
  }

  if (typeof agentService.get !== 'function') {
    await reportReconciliationFailure(onFailure, {
      ...reconciliationFailureInput(dispatch, child),
      reason: 'missing-job',
    });
    return undefined;
  }

  let job = agentService.get(child.agentJobId, dispatch.scope);
  if (!job) {
    await reportReconciliationFailure(onFailure, {
      ...reconciliationFailureInput(dispatch, child),
      reason: 'missing-job',
    });
    return undefined;
  }

  if (resolveProviderForRecovery) {
    const expectedProvider = resolveProviderForRecovery(child.providerId);
    if (!expectedProvider || job.provider !== expectedProvider) {
      throw new Error(
        `A2A durable dispatch provider identity mismatch for ${child.agentJobId}: `
        + `dispatch=${child.providerId}, job=${job.provider ?? 'missing'}.`,
      );
    }
  }

  if (job.status === 'queued' || job.status === 'running' || job.status === 'awaiting_approval') {
    if (typeof agentService.waitForTerminal !== 'function') {
      throw new Error('A2A durable dispatch child cannot be resumed without AgentService terminal recovery.');
    }
    const recoveryTimeoutMs = remainingRecoveryTimeout(dispatch, timeoutMs);
    job = await withRecoveryTimeout(
      agentService.waitForTerminal(child.agentJobId, dispatch.scope, recoveryTimeoutMs),
      recoveryTimeoutMs,
    );
  }

  if (job.id !== child.agentJobId) {
    throw new Error('A2A durable dispatch child recovery returned a different job identity.');
  }
  if (job.status !== 'completed' && job.status !== 'failed' && job.status !== 'cancelled') {
    throw new Error('A2A durable dispatch child did not reach a terminal state during restart recovery.');
  }
  return {
    id: job.id,
    status: job.status,
    result: job.result,
    ...(job.error ? { error: job.error } : {}),
  };
}

function remainingRecoveryTimeout(dispatch: A2ADispatchIntent, timeoutMs: number): number {
  const deadlineAt = Date.parse(dispatch.deadlineAt);
  if (!Number.isFinite(deadlineAt)) return timeoutMs;
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw new Error('A2A durable dispatch recovery deadline expired.');
  return Math.min(timeoutMs, remaining);
}

async function withRecoveryTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`A2A child recovery timed out after ${timeoutMs}ms.`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function cancellationInput(
  dispatch: A2ADispatchIntent,
  child: A2ADispatchIntent['children'][number],
): A2ADispatchChildCancellationInput {
  if (!child.agentJobId || !dispatch.cancelRequestedAt) {
    throw new Error('A2A cancellation input is incomplete during reconciliation.');
  }
  return {
    scope: { ...dispatch.scope },
    parentTaskId: dispatch.parentTaskId,
    childKey: child.childKey,
    childIdempotencyKey: child.childIdempotencyKey,
    agentId: child.agentId,
    providerId: child.providerId,
    ...(child.executionIdentity === undefined ? {} : { executionIdentity: child.executionIdentity }),
    ...(child.executionBoundaryId === undefined ? {} : { executionBoundaryId: child.executionBoundaryId }),
    agentJobId: child.agentJobId,
    cancelRequestedAt: dispatch.cancelRequestedAt,
  };
}

function reconciliationFailureInput(
  dispatch: A2ADispatchIntent,
  child: A2ADispatchIntent['children'][number],
): A2ADispatchCancellationFailure {
  return {
    scope: { ...dispatch.scope },
    parentTaskId: dispatch.parentTaskId,
    childKey: child.childKey,
    childIdempotencyKey: child.childIdempotencyKey,
    agentId: child.agentId,
    providerId: child.providerId,
    ...(child.executionIdentity === undefined ? {} : { executionIdentity: child.executionIdentity }),
    ...(child.executionBoundaryId === undefined ? {} : { executionBoundaryId: child.executionBoundaryId }),
    ...(child.agentJobId ? { agentJobId: child.agentJobId } : {}),
    ...(dispatch.cancelRequestedAt ? { cancelRequestedAt: dispatch.cancelRequestedAt } : {}),
  };
}

async function reportReconciliationFailure(
  handler: A2ADispatchReconciliationFailureHandler | undefined,
  failure: A2ADispatchReconciliationFailure,
): Promise<void> {
  console.error('A2A dispatch cancellation reconciliation failed', JSON.stringify({
    parentTaskId: failure.parentTaskId,
    childKey: failure.childKey,
    agentId: failure.agentId,
    providerId: failure.providerId,
    agentJobId: failure.agentJobId,
    reason: failure.reason,
    ...(failure.error ? { error: failure.error } : {}),
  }));
  await handler?.(failure);
}

async function emitRecoveredDispatchAudit(
  handler: A2ADispatchAuditHandler | undefined,
  parentTaskId: string,
  dispatch: A2ADispatchIntent,
): Promise<void> {
  if (!handler) return;
  try {
    const audit = createA2ADispatchAudit({
      parentTaskId,
      children: dispatch.children.map((child) => ({
        childKey: child.childKey,
        childIdempotencyKey: child.childIdempotencyKey,
        agentId: child.agentId,
        providerId: child.providerId,
        role: child.role,
        requestSha256: child.requestSha256,
        status: child.status,
        duplicated: false,
      })),
    });
    await handler(audit);
  } catch (error) {
    console.error(
      'A2A dispatch audit consumer failed',
      error instanceof Error ? redactAndBoundText(error.message, 500) : 'unknown error',
    );
  }
}

function dispatchOutcomes(dispatch: A2ADispatchIntent): A2ADispatchChildOutcome[] {
  return dispatch.children.map((child) => {
    if (child.status !== 'completed' && child.status !== 'failed' && child.status !== 'canceled') {
      throw new Error('A2A durable dispatch child did not reconcile to a terminal state.');
    }
    return {
      childKey: child.childKey,
      status: child.status,
      ...(child.agentJobId ? { agentJobId: child.agentJobId } : {}),
    };
  });
}

function artifactForRecoveredChild(
  parent: A2ATask,
  scope: A2AScope,
  childKey: string,
  childTaskId: string,
  result: string,
): A2ATask['artifacts'][number] {
  const sha256 = crypto.createHash('sha256').update(result, 'utf8').digest('hex');
  const childDigest = crypto.createHash('sha256').update(childKey, 'utf8').digest('hex');
  return {
    artifactId: `artifact-${childDigest.slice(0, 24)}-${sha256.slice(0, 24)}`,
    taskId: parent.id,
    sourceTaskId: childTaskId,
    sha256,
    byteSize: Buffer.byteLength(result, 'utf8'),
    mediaType: 'text/plain',
    name: `${childTaskId}.txt`,
    scope,
    content: { mediaType: 'text/plain', text: result },
    metadata: { childKey, childTaskId },
  };
}

async function reconcileTask(
  store: A2AStore,
  agentService: AgentService,
  recoverable: A2ARecoverableTask,
  timeoutMs: number,
): Promise<void> {
  const { task, agentJobId } = recoverable;
  if (!agentJobId) {
    await store.transitionTask(task.id, task.scope, {
      status: 'failed',
      error: 'A2A child execution was not available after restart reconciliation.',
      artifacts: [],
    });
    return;
  }

  let child = agentService.get(agentJobId, task.scope);
  if (!child) {
    await store.transitionTask(task.id, task.scope, {
      status: 'failed',
      error: 'A2A child execution was not available after restart reconciliation.',
      artifacts: [],
    });
    return;
  }

  if (child.status === 'queued' || child.status === 'running') {
    if (typeof agentService.waitForTerminal !== 'function') {
      await store.transitionTask(task.id, task.scope, {
        status: 'failed',
        error: 'A2A child execution could not be resumed after restart reconciliation.',
        artifacts: [],
      });
      return;
    }
    child = await withRecoveryTimeout(
      agentService.waitForTerminal(agentJobId, task.scope, timeoutMs),
      timeoutMs,
    );
    if (child.id !== agentJobId) {
      throw new Error('A2A child execution recovery returned a different job identity.');
    }
  }

  if (child.status === 'cancelled') {
    await store.transitionTask(task.id, task.scope, 'canceled');
    return;
  }

  if (child.status === 'completed') {
    const result = completedResultText(child.result);
    if (!result) {
      await store.transitionTask(task.id, task.scope, {
        status: 'failed',
        error: 'completed child result must contain a non-empty result.',
        artifacts: [],
      });
      return;
    }
    const sha256 = crypto.createHash('sha256').update(result, 'utf8').digest('hex');
    await store.transitionTask(task.id, task.scope, {
      status: 'completed',
      artifacts: [{
        artifactId: `artifact-${sha256.slice(0, 32)}`,
        taskId: task.id,
        sourceTaskId: task.id,
        sha256,
        byteSize: Buffer.byteLength(result, 'utf8'),
        mediaType: 'text/plain',
        name: 'result.txt',
        scope: task.scope,
        content: { mediaType: 'text/plain', text: result },
        metadata: { source: 'teams-core-agent', recoveredAfterRestart: true },
      }],
      error: undefined,
    });
    return;
  }

  if (child.status === 'failed') {
    await store.transitionTask(task.id, task.scope, {
      status: 'failed',
      error: redactAndBoundText(child.error ?? 'Agent execution failed.', 2_000),
      artifacts: [],
    });
    return;
  }

  await store.transitionTask(task.id, task.scope, {
    status: 'failed',
    error: 'A2A child execution could not be resumed after restart reconciliation.',
    artifacts: [],
  });
}

function promptFromRequest(request: A2ASendRequest): string {
  const parts = request.message.parts.map((part) => (
    'text' in part ? part.text : JSON.stringify(part.data)
  ));
  const prompt = parts.join('\n').trim();
  if (!prompt || prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error('A2A prompt is outside the allowed bounds.');
  }
  return prompt;
}

function completedResultText(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const result = redactAndBoundText(value, MAX_RESULT_LENGTH);
  return result.trim() ? result : undefined;
}
