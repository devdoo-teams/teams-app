import crypto from 'node:crypto';

import {
  A2AContractError,
  redactAndBoundText,
  validateGraphLimits,
  type A2ATaskStatus,
} from './a2a-contract.js';
import {
  MAX_AGENT_PROMPT_LENGTH,
  type AgentJobScope,
} from './agent-job-store.js';
import {
  createA2ADispatchPlan,
  type A2ACapability,
} from './a2a-role-catalog.js';
import {
  createA2ADispatchAudit,
  type A2ADispatchAudit,
} from './a2a-observability.js';
import { redactSensitiveText } from './sensitive-text.js';

const TERMINAL_CHILD_STATUSES = new Set<A2AOrchestratorChildStatus>(['completed', 'failed', 'canceled']);
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

const DEFAULT_MAX_CHILDREN = 16;
const DEFAULT_MAX_ROLE_LENGTH = 120;
const DEFAULT_MAX_DEADLINE_MS = 60_000;
const DEFAULT_MAX_PARALLELISM = 8;
const DEFAULT_MAX_RETAINED_EXECUTIONS = DEFAULT_MAX_CHILDREN * 4;
const MAX_RESULT_TEXT_LENGTH = 20_000;
const MAX_ERROR_TEXT_LENGTH = 4_000;

export const LEGACY_A2A_AGENT_ID = 'teams-core' as const;
export const LEGACY_A2A_PROVIDER_ID = 'core-default' as const;

export type AgentScope = AgentJobScope;

export type A2AOrchestratorChildStatus = Extract<A2ATaskStatus, 'completed' | 'failed' | 'canceled'>;

export type A2AOrchestratorChildRequest = Readonly<{
  key: string;
  role: string;
  prompt: string;
  capabilities?: readonly string[];
  agentId?: string;
}>;

export type A2AOrchestratorAgentIdentity = Readonly<{
  agentId: string;
  providerId: string;
  /** Stable identity of the independently owned provider session. */
  executionIdentity?: string;
  /** Stable server-trusted boundary containing this execution. */
  executionBoundaryId?: string;
}>;

export type A2AOrchestratorAgentSelectionInput = Readonly<{
  scope: AgentScope;
  parentTaskId: string;
  childKey: string;
  role: string;
  prompt: string;
  capabilities?: readonly A2ACapability[];
  requestedAgentId?: string;
}>;

export type A2AOrchestratorChildExecutionInput = Readonly<{
  scope: AgentScope;
  parentTaskId: string;
  childKey: string;
  childIdempotencyKey: string;
  role: string;
  prompt: string;
  capabilities?: readonly A2ACapability[];
  agentId: string;
  providerId: string;
  executionIdentity?: string;
  executionBoundaryId?: string;
  deadlineAtMs: number;
  signal: AbortSignal;
}>;

export type A2AOrchestratorChildExecutionResult = Readonly<{
  taskId: string;
  status: A2AOrchestratorChildStatus;
  result?: string;
  error?: string;
}>;

export type A2AOrchestratorPreparedChild = Readonly<{
  childKey: string;
  childIdempotencyKey: string;
  role: string;
  agentId: string;
  providerId: string;
  executionIdentity?: string;
  executionBoundaryId?: string;
  requestSha256: string;
}>;

export type A2AOrchestratorPreparedDispatch = Readonly<{
  scope: AgentScope;
  parentTaskId: string;
  deadlineAtMs: number;
  children: readonly A2AOrchestratorPreparedChild[];
}>;

export type A2AOrchestratorChildResult = Readonly<{
  childKey: string;
  childIdempotencyKey: string;
  agentId: string;
  providerId: string;
  executionIdentity?: string;
  executionBoundaryId?: string;
  taskId?: string;
  status: A2AOrchestratorChildStatus;
  result?: string;
  error?: string;
  duplicated: boolean;
}>;

export type A2AOrchestratorChildOutcome = Readonly<Omit<A2AOrchestratorChildResult, 'duplicated'>>;

export type A2AOrchestrationResult = Readonly<{
  parentTaskId: string;
  /** Internal evidence; not part of the A2A task or agent-card wire contract. */
  audit: A2ADispatchAudit;
  totalChildren: number;
  uniqueChildren: number;
  duplicateChildren: number;
  completedChildren: number;
  failedChildren: number;
  canceledChildren: number;
  elapsedMs: number;
  childResults: readonly A2AOrchestratorChildResult[];
}>;

export type A2AOrchestratorRunInput = Readonly<{
  scope: AgentScope;
  parentTaskId: string;
  depth?: number;
  fanOutIndex?: number;
  requests: readonly A2AOrchestratorChildRequest[];
  deadlineMs: number;
  parallelism: number;
  signal?: AbortSignal;
  resolveAgentIdentity?: (
    input: A2AOrchestratorAgentSelectionInput,
  ) => A2AOrchestratorAgentIdentity;
  onDispatchPrepared?: (dispatch: A2AOrchestratorPreparedDispatch) => Promise<void> | void;
  onChildSettled?: (outcome: A2AOrchestratorChildOutcome) => Promise<void> | void;
  executeChild: (
    input: A2AOrchestratorChildExecutionInput,
  ) => Promise<A2AOrchestratorChildExecutionResult>;
}>;

export type A2AOrchestrator = Readonly<{
  run(input: A2AOrchestratorRunInput): Promise<A2AOrchestrationResult>;
}>;

export type A2AOrchestratorOptions = Readonly<{
  maxChildren?: number;
  maxPromptLength?: number;
  maxRoleLength?: number;
  maxDeadlineMs?: number;
  maxParallelism?: number;
  maxRetainedExecutions?: number;
  /** Enforce the finite Core role/capability catalog at this boundary. */
  enforceRoleCatalog?: boolean;
  now?: () => number;
}>;

type PreparedChild = {
  key: string;
  role: string;
  prompt: string;
  capabilities?: readonly A2ACapability[];
  agentId: string;
  providerId: string;
  executionIdentity?: string;
  executionBoundaryId?: string;
  idempotencyKey: string;
  fingerprint: string;
  duplicated: boolean;
};

type SettledChild = {
  childKey: string;
  childIdempotencyKey: string;
  agentId: string;
  providerId: string;
  executionIdentity?: string;
  executionBoundaryId?: string;
  taskId?: string;
  status: A2AOrchestratorChildStatus;
  result?: string;
  error?: string;
};

type ExecutionRecord = {
  fingerprint: string;
  promise: Promise<SettledChild>;
  active: boolean;
  retentionOrder: number;
};

type ExecutionLifecycle = {
  promise: Promise<SettledChild>;
  activeUntil: Promise<void>;
};

type ExecutionMemory = {
  records: Map<string, ExecutionRecord>;
  maxRetainedExecutions: number;
  nextRetentionOrder: number;
};

export function createA2AOrchestrator(options: A2AOrchestratorOptions = {}): A2AOrchestrator {
  const config = {
    maxChildren: options.maxChildren ?? DEFAULT_MAX_CHILDREN,
    maxPromptLength: options.maxPromptLength ?? MAX_AGENT_PROMPT_LENGTH,
    maxRoleLength: options.maxRoleLength ?? DEFAULT_MAX_ROLE_LENGTH,
    maxDeadlineMs: options.maxDeadlineMs ?? DEFAULT_MAX_DEADLINE_MS,
    maxParallelism: options.maxParallelism ?? DEFAULT_MAX_PARALLELISM,
    maxRetainedExecutions: options.maxRetainedExecutions ?? DEFAULT_MAX_RETAINED_EXECUTIONS,
    enforceRoleCatalog: options.enforceRoleCatalog ?? false,
    now: options.now ?? (() => Date.now()),
  };
  validateRetentionConfig(config.maxRetainedExecutions);

  const executionMemory: ExecutionMemory = {
    records: new Map<string, ExecutionRecord>(),
    maxRetainedExecutions: config.maxRetainedExecutions,
    nextRetentionOrder: 0,
  };

  return Object.freeze({
    async run(input: A2AOrchestratorRunInput): Promise<A2AOrchestrationResult> {
      const startedAt = config.now();
      validateRunInput(input, config);
      const deadlineAtMs = startedAt + input.deadlineMs;
      const preparedChildren = prepareChildren(input, config);
      const uniqueChildren = preparedChildren.filter((entry) => !entry.duplicated);
      const uniqueResults = new Map<string, Promise<SettledChild>>();
      const controller = new AbortController();
      const cancelReason = { current: '' };

      const signalCleanup = bindAbort(input.signal, controller, cancelReason);
      const timer = setTimeout(() => {
        cancelReason.current = 'A2A orchestration deadline exceeded.';
        controller.abort(new A2AContractError('DeadlineExceededError', cancelReason.current));
      }, input.deadlineMs);

      try {
        await input.onDispatchPrepared?.({
          scope: cloneScope(input.scope),
          parentTaskId: input.parentTaskId,
          deadlineAtMs,
          children: freezeArray(uniqueChildren.map((descriptor) => freezeObject({
            childKey: descriptor.key,
            childIdempotencyKey: descriptor.idempotencyKey,
            role: descriptor.role,
            agentId: descriptor.agentId,
            providerId: descriptor.providerId,
            ...(descriptor.executionIdentity ? { executionIdentity: descriptor.executionIdentity } : {}),
            ...(descriptor.executionBoundaryId ? { executionBoundaryId: descriptor.executionBoundaryId } : {}),
            requestSha256: descriptor.fingerprint,
          }))),
        });
        let nextIndex = 0;
        const workerCount = Math.min(input.parallelism, uniqueChildren.length || 1);
        const workers = Array.from({ length: workerCount }, async () => {
          while (true) {
            if (controller.signal.aborted) return;
            const descriptor = uniqueChildren[nextIndex];
            if (!descriptor) return;
            nextIndex += 1;
            const execution = getOrCreateExecution(
              executionMemory,
              descriptor,
              input,
              deadlineAtMs,
              controller.signal,
            );
            uniqueResults.set(descriptor.idempotencyKey, execution);
            await execution.catch(() => undefined);
          }
        });

        await Promise.all(workers);

        for (let index = nextIndex; index < uniqueChildren.length; index += 1) {
          const descriptor = uniqueChildren[index];
          uniqueResults.set(
            descriptor.idempotencyKey,
            Promise.resolve(canceledChild(descriptor, cancelReason.current || 'A2A orchestration canceled before child execution started.')),
          );
        }

        const childResults = await Promise.all(preparedChildren.map(async (descriptor) => {
          const outcome = await uniqueResults.get(descriptor.idempotencyKey);
          if (!outcome) {
            return freezeObject<A2AOrchestratorChildResult>({
              ...canceledChild(descriptor, cancelReason.current || 'A2A orchestration canceled before child execution started.'),
              duplicated: descriptor.duplicated,
            });
          }
          return freezeObject<A2AOrchestratorChildResult>({
            ...outcome,
            duplicated: descriptor.duplicated,
          });
        }));

        const audit = createA2ADispatchAudit({
          parentTaskId: input.parentTaskId,
          children: preparedChildren.map((descriptor, index) => {
            const childResult = childResults[index];
            if (!childResult) {
              throw new A2AContractError('InvalidTaskError', 'A2A child result was not produced for dispatch audit.');
            }
            return {
              childKey: descriptor.key,
              childIdempotencyKey: descriptor.idempotencyKey,
              agentId: descriptor.agentId,
              providerId: descriptor.providerId,
              role: descriptor.role,
              requestSha256: descriptor.fingerprint,
              status: childResult.status,
              duplicated: childResult.duplicated,
            };
          }),
        });

        const elapsedMs = Math.max(0, config.now() - startedAt);
        return freezeObject({
          parentTaskId: input.parentTaskId,
          audit,
          totalChildren: childResults.length,
          uniqueChildren: uniqueChildren.length,
          duplicateChildren: childResults.filter((entry) => entry.duplicated).length,
          completedChildren: childResults.filter((entry) => entry.status === 'completed').length,
          failedChildren: childResults.filter((entry) => entry.status === 'failed').length,
          canceledChildren: childResults.filter((entry) => entry.status === 'canceled').length,
          elapsedMs,
          childResults: freezeArray(childResults),
        });
      } finally {
        clearTimeout(timer);
        signalCleanup();
      }
    },
  });
}

/** Production-facing constructor for dispatches that must use the Core catalog. */
export function createCoreA2AOrchestrator(
  options: Omit<A2AOrchestratorOptions, 'enforceRoleCatalog'> = {},
): A2AOrchestrator {
  return createA2AOrchestrator({ ...options, enforceRoleCatalog: true });
}

export function deriveChildIdempotencyKey(parentTaskId: string, childKey: string): string {
  validateOpaqueId(parentTaskId, 'parentTaskId');
  validateOpaqueId(childKey, 'child.key');
  return `child-${sha256(JSON.stringify([parentTaskId, childKey]))}`;
}

function validateRunInput(
  input: A2AOrchestratorRunInput,
  config: Required<Omit<A2AOrchestratorOptions, 'now'>> & Pick<Required<A2AOrchestratorOptions>, 'now'>,
): void {
  validateScope(input.scope);
  validateOpaqueId(input.parentTaskId, 'parentTaskId');
  validateGraphLimits({ depth: input.depth ?? 0, fanOutIndex: input.fanOutIndex ?? 0 });
  if (!Array.isArray(input.requests) || input.requests.length < 1) {
    throw new A2AContractError('InvalidRequestError', 'requests must contain at least one child request.');
  }
  if (input.requests.length > config.maxChildren) {
    throw new A2AContractError('GraphLimitExceededError', 'A2A orchestration exceeds the maximum child count.');
  }
  if (!Number.isInteger(input.parallelism) || input.parallelism < 1 || input.parallelism > config.maxParallelism) {
    throw new A2AContractError('GraphLimitExceededError', 'parallelism is outside the allowed bounds.');
  }
  if (!Number.isInteger(input.deadlineMs) || input.deadlineMs < 1 || input.deadlineMs > config.maxDeadlineMs) {
    throw new A2AContractError('DeadlineExceededError', 'deadlineMs is outside the allowed bounds.');
  }
  if (typeof input.executeChild !== 'function') {
    throw new A2AContractError('InvalidRequestError', 'executeChild must be a function.');
  }
}

function validateRetentionConfig(maxRetainedExecutions: number): void {
  if (!Number.isSafeInteger(maxRetainedExecutions) || maxRetainedExecutions < 0) {
    throw new A2AContractError('GraphLimitExceededError', 'maxRetainedExecutions is outside the allowed bounds.');
  }
}

function prepareChildren(
  input: A2AOrchestratorRunInput,
  config: Required<Omit<A2AOrchestratorOptions, 'now'>> & Pick<Required<A2AOrchestratorOptions>, 'now'>,
): PreparedChild[] {
  const seen = new Map<string, { fingerprint: string }>();

  return input.requests.map((request) => {
    validateOpaqueId(request.key, 'child.key');
    validateBoundedText(request.role, 'child.role', config.maxRoleLength);
    validateBoundedText(request.prompt, 'child.prompt', config.maxPromptLength);

    const plan = config.enforceRoleCatalog
      ? createA2ADispatchPlan({
        roleId: request.role,
        requestedCapabilities: request.capabilities,
        parentTaskId: input.parentTaskId,
        childKey: request.key,
        prompt: request.prompt,
      })
      : undefined;
    if (!config.enforceRoleCatalog && request.capabilities !== undefined) {
      throw new A2AContractError(
        'UnsupportedOperationError',
        'child capabilities require the Core role catalog boundary.',
      );
    }

    const role = plan?.roleId ?? request.role;
    const prompt = request.prompt;
    const capabilities = plan?.capabilities;
    const requestedAgentId = request.agentId === undefined
      ? undefined
      : validateOpaqueId(request.agentId, 'child.agentId');
    const identity = input.resolveAgentIdentity?.({
      scope: cloneScope(input.scope),
      parentTaskId: input.parentTaskId,
      childKey: request.key,
      role,
      prompt,
      ...(capabilities ? { capabilities } : {}),
      ...(requestedAgentId ? { requestedAgentId } : {}),
    }) ?? {
      agentId: LEGACY_A2A_AGENT_ID,
      providerId: LEGACY_A2A_PROVIDER_ID,
    };
    const agentId = validateOpaqueId(identity.agentId, 'child.agentId');
    const providerId = validateOpaqueId(identity.providerId, 'child.providerId');
    const executionIdentity = identity.executionIdentity === undefined
      ? undefined
      : validateOpaqueId(identity.executionIdentity, 'child.executionIdentity');
    const executionBoundaryId = identity.executionBoundaryId === undefined
      ? undefined
      : validateOpaqueId(identity.executionBoundaryId, 'child.executionBoundaryId');
    if (Boolean(executionIdentity) !== Boolean(executionBoundaryId)) {
      throw new A2AContractError(
        'InvalidRequestError',
        'child.executionIdentity and child.executionBoundaryId must be provided together.',
      );
    }

    const idempotencyKey = deriveChildIdempotencyKey(input.parentTaskId, request.key);
    const fingerprint = sha256(JSON.stringify([
      role,
      prompt,
      capabilities ?? null,
      agentId,
      providerId,
      executionIdentity ?? null,
      executionBoundaryId ?? null,
    ]));
    const previous = seen.get(idempotencyKey);
    if (previous && previous.fingerprint !== fingerprint) {
      throw new A2AContractError('InvalidRequestError', 'duplicate child idempotency keys must reference the same role and prompt.');
    }
    seen.set(idempotencyKey, { fingerprint });
    return {
      key: request.key,
      role,
      prompt,
      ...(capabilities ? { capabilities } : {}),
      agentId,
      providerId,
      ...(executionIdentity ? { executionIdentity } : {}),
      ...(executionBoundaryId ? { executionBoundaryId } : {}),
      idempotencyKey,
      fingerprint,
      duplicated: Boolean(previous),
    };
  });
}

function getOrCreateExecution(
  executionMemory: ExecutionMemory,
  descriptor: PreparedChild,
  input: A2AOrchestratorRunInput,
  deadlineAtMs: number,
  signal: AbortSignal,
): Promise<SettledChild> {
  const executionMemoryKey = deriveExecutionMemoryKey(input.scope, descriptor.idempotencyKey);
  const existing = executionMemory.records.get(executionMemoryKey);
  if (existing) {
    if (existing.fingerprint !== descriptor.fingerprint) {
      return Promise.resolve(failedChild(descriptor, undefined, 'duplicate child idempotency key was reused with a different request.'));
    }
    touchExecutionRecord(executionMemory, existing);
    return existing.promise;
  }

  const execution = startExecution(descriptor, input, deadlineAtMs, signal);
  const record: ExecutionRecord = {
    fingerprint: descriptor.fingerprint,
    promise: execution.promise,
    active: true,
    retentionOrder: nextRetentionOrder(executionMemory),
  };
  executionMemory.records.set(executionMemoryKey, record);
  void execution.activeUntil.then(() => {
    record.active = false;
    touchExecutionRecord(executionMemory, record);
    pruneSettledExecutionRecords(executionMemory);
  });
  return execution.promise;
}

function deriveExecutionMemoryKey(scope: AgentScope, childIdempotencyKey: string): string {
  return sha256(JSON.stringify([
    scope.tenantId,
    scope.requesterId,
    scope.conversationId,
    childIdempotencyKey,
  ]));
}

function startExecution(
  descriptor: PreparedChild,
  input: A2AOrchestratorRunInput,
  deadlineAtMs: number,
  signal: AbortSignal,
): ExecutionLifecycle {
  if (signal.aborted) {
    const promise = Promise.resolve(canceledChild(descriptor, 'A2A orchestration canceled before child execution started.'));
    return {
      promise,
      activeUntil: promise.then(() => undefined),
    };
  }

  let execution: Promise<A2AOrchestratorChildExecutionResult>;
  try {
    execution = Promise.resolve(input.executeChild({
      scope: cloneScope(input.scope),
      parentTaskId: input.parentTaskId,
      childKey: descriptor.key,
      childIdempotencyKey: descriptor.idempotencyKey,
      role: descriptor.role,
      prompt: descriptor.prompt,
      ...(descriptor.capabilities ? { capabilities: descriptor.capabilities } : {}),
      agentId: descriptor.agentId,
      providerId: descriptor.providerId,
      ...(descriptor.executionIdentity ? { executionIdentity: descriptor.executionIdentity } : {}),
      ...(descriptor.executionBoundaryId ? { executionBoundaryId: descriptor.executionBoundaryId } : {}),
      deadlineAtMs,
      signal,
    }));
  } catch (error) {
    execution = Promise.reject(error);
  }
  void execution.catch(() => undefined);
  const settledExecution = settleDescriptor(descriptor, execution, signal, input.onChildSettled);

  return {
    promise: settledExecution,
    activeUntil: settledExecution.then(() => undefined, () => undefined),
  };
}

async function settleDescriptor(
  descriptor: PreparedChild,
  execution: Promise<A2AOrchestratorChildExecutionResult>,
  signal: AbortSignal,
  onChildSettled?: (outcome: A2AOrchestratorChildOutcome) => Promise<void> | void,
): Promise<SettledChild> {
  let outcome: SettledChild;
  try {
    const result = await raceAbort(execution, signal);
    outcome = normalizeExecutionResult(descriptor, result);
  } catch (error) {
    if (signal.aborted) {
      outcome = canceledChild(descriptor, abortMessage(signal));
    } else {
      outcome = failedChild(
        descriptor,
        undefined,
        error instanceof Error ? error.message : 'A2A child execution failed.',
      );
    }
  }
  await onChildSettled?.(freezeObject({ ...outcome }));
  return outcome;
}

function nextRetentionOrder(executionMemory: ExecutionMemory): number {
  executionMemory.nextRetentionOrder += 1;
  return executionMemory.nextRetentionOrder;
}

function touchExecutionRecord(executionMemory: ExecutionMemory, record: ExecutionRecord): void {
  record.retentionOrder = nextRetentionOrder(executionMemory);
}

function pruneSettledExecutionRecords(executionMemory: ExecutionMemory): void {
  const settledRecords = [...executionMemory.records]
    .filter(([, record]) => !record.active)
    .sort((left, right) => left[1].retentionOrder - right[1].retentionOrder);
  const deleteCount = settledRecords.length - executionMemory.maxRetainedExecutions;
  if (deleteCount <= 0) return;

  for (const [key] of settledRecords.slice(0, deleteCount)) {
    executionMemory.records.delete(key);
  }
}

async function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason ?? new Error('aborted');
  let onAbort: () => void = () => undefined;
  const abortPromise = new Promise<T>((_, reject) => {
    onAbort = (): void => reject(signal.reason ?? new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
  });

  try {
    return await Promise.race([promise, abortPromise]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function normalizeExecutionResult(
  descriptor: PreparedChild,
  result: A2AOrchestratorChildExecutionResult,
): SettledChild {
  validateOpaqueId(result.taskId, 'child.taskId');
  if (!TERMINAL_CHILD_STATUSES.has(result.status)) {
    throw new A2AContractError('InvalidTaskError', 'child execution must return a terminal status.');
  }

  if (result.status === 'completed') {
    const resultText = completedResultText(result.result);
    if (!resultText) {
      return failedChild(
        descriptor,
        result.taskId,
        'completed child result must contain a non-empty result.',
      );
    }
    return {
      childKey: descriptor.key,
      childIdempotencyKey: descriptor.idempotencyKey,
      agentId: descriptor.agentId,
      providerId: descriptor.providerId,
      ...(descriptor.executionIdentity ? { executionIdentity: descriptor.executionIdentity } : {}),
      ...(descriptor.executionBoundaryId ? { executionBoundaryId: descriptor.executionBoundaryId } : {}),
      taskId: result.taskId,
      status: 'completed',
      result: resultText,
    };
  }

  if (result.status === 'canceled') {
    return {
      childKey: descriptor.key,
      childIdempotencyKey: descriptor.idempotencyKey,
      agentId: descriptor.agentId,
      providerId: descriptor.providerId,
      taskId: result.taskId,
      status: 'canceled',
      ...(result.error === undefined ? {} : { error: sanitizeErrorText(result.error) }),
    };
  }

  return {
    childKey: descriptor.key,
    childIdempotencyKey: descriptor.idempotencyKey,
    agentId: descriptor.agentId,
    providerId: descriptor.providerId,
    taskId: result.taskId,
    status: 'failed',
    ...(result.error === undefined ? {} : { error: sanitizeErrorText(result.error) }),
  };
}

function canceledChild(
  descriptor: Pick<PreparedChild, 'key' | 'idempotencyKey' | 'agentId' | 'providerId' | 'executionIdentity' | 'executionBoundaryId'>,
  error: string,
): SettledChild {
  return {
    childKey: descriptor.key,
    childIdempotencyKey: descriptor.idempotencyKey,
    agentId: descriptor.agentId,
    providerId: descriptor.providerId,
    ...(descriptor.executionIdentity ? { executionIdentity: descriptor.executionIdentity } : {}),
    ...(descriptor.executionBoundaryId ? { executionBoundaryId: descriptor.executionBoundaryId } : {}),
    status: 'canceled',
    error: sanitizeErrorText(error),
  };
}

function failedChild(
  descriptor: Pick<PreparedChild, 'key' | 'idempotencyKey' | 'agentId' | 'providerId' | 'executionIdentity' | 'executionBoundaryId'>,
  taskId: string | undefined,
  error: string,
): SettledChild {
  return {
    childKey: descriptor.key,
    childIdempotencyKey: descriptor.idempotencyKey,
    agentId: descriptor.agentId,
    providerId: descriptor.providerId,
    ...(descriptor.executionIdentity ? { executionIdentity: descriptor.executionIdentity } : {}),
    ...(descriptor.executionBoundaryId ? { executionBoundaryId: descriptor.executionBoundaryId } : {}),
    ...(taskId ? { taskId } : {}),
    status: 'failed',
    error: sanitizeErrorText(error),
  };
}

function sanitizeResultText(value: string): string {
  return redactAndBoundText(redactSensitiveText(value), MAX_RESULT_TEXT_LENGTH);
}

function completedResultText(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const result = sanitizeResultText(value);
  return result.trim() ? result : undefined;
}

function sanitizeErrorText(value: string): string {
  return redactAndBoundText(redactSensitiveText(value), MAX_ERROR_TEXT_LENGTH);
}

function validateScope(scope: AgentScope): void {
  validateBoundedText(scope.tenantId, 'scope.tenantId', 256);
  validateBoundedText(scope.requesterId, 'scope.requesterId', 256);
  validateBoundedText(scope.conversationId, 'scope.conversationId', 256);
}

function validateOpaqueId(value: string, field: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new A2AContractError('InvalidRequestError', `${field} must be a bounded opaque identifier.`);
  }
  return value;
}

function validateBoundedText(value: string, field: string, maxLength: number): void {
  if (typeof value !== 'string' || !value.trim()) {
    throw new A2AContractError('InvalidRequestError', `${field} must be a non-empty string.`);
  }
  if (value.length > maxLength || CONTROL_CHARACTERS.test(value)) {
    CONTROL_CHARACTERS.lastIndex = 0;
    throw new A2AContractError('InvalidRequestError', `${field} is outside the allowed bounds.`);
  }
  CONTROL_CHARACTERS.lastIndex = 0;
}

function bindAbort(
  source: AbortSignal | undefined,
  controller: AbortController,
  cancelReason: { current: string },
): () => void {
  if (!source) return () => undefined;
  const onAbort = (): void => {
    cancelReason.current = abortMessage(source);
    controller.abort(source.reason ?? new Error(cancelReason.current));
  };
  source.addEventListener('abort', onAbort, { once: true });
  if (source.aborted) onAbort();
  return () => source.removeEventListener('abort', onAbort);
}

function abortMessage(signal: AbortSignal): string {
  const reason = signal.reason;
  if (reason instanceof Error && reason.message.trim()) return sanitizeErrorText(reason.message);
  if (typeof reason === 'string' && reason.trim()) return sanitizeErrorText(reason);
  return 'A2A orchestration canceled.';
}

function cloneScope(scope: AgentScope): AgentScope {
  return {
    tenantId: scope.tenantId,
    requesterId: scope.requesterId,
    conversationId: scope.conversationId,
  };
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function freezeArray<T>(value: readonly T[]): readonly T[] {
  return Object.freeze([...value]);
}

function freezeObject<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}
