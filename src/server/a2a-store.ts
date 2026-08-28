import crypto from 'node:crypto';

import { atomicWriteJson, readAtomicJsonStore } from './atomic-file.js';
import {
  A2AContractError,
  assertTaskTransition,
  validateCursor,
  validateArtifactRef,
  validateIdempotencyKey,
  validateMessage,
  validatePageLimit,
  validateScope,
  validateTask,
} from './a2a-contract.js';
import type {
  A2AMessage,
  A2AScope,
  A2ATask,
  A2ATaskStatus,
} from './a2a-contract.js';

const LEGACY_SCHEMA_VERSION = 1 as const;
const PREVIOUS_SCHEMA_VERSION = 2 as const;
const SCHEMA_VERSION = 3 as const;
const DEFAULT_PAGE_LIMIT = 20;
const MAX_FINGERPRINT_LENGTH = 200;
const MAX_RECORDS = 100_000;
const MAX_RECOVERY_TASKS = 1_000;
const MAX_DISPATCH_CHILDREN = 16;
const MAX_DISPATCH_ROLE_LENGTH = 120;
const CURSOR_VERSION = 1 as const;
const OPAQUE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SHA256_VALUE = /^[a-f0-9]{64}$/;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

type A2AStoreState = {
  schemaVersion: typeof SCHEMA_VERSION;
  tasks: Record<string, A2ATask>;
  records: Record<string, A2AStoreRecord>;
  jobBindings: Record<string, A2AAgentJobBinding>;
  dispatchIntents: Record<string, A2ADispatchIntent>;
};

export type A2AStoredMessageInfo = {
  messageId: string;
  role: A2AMessage['role'];
  partCount: number;
  contextId: string;
  taskId: string;
};

type A2AStoreRecord = {
  scope: A2AScope;
  idempotencyKey: string;
  fingerprint: string;
  taskId: string;
  message: A2AStoredMessageInfo;
  createdAt: string;
};

type A2AAgentJobBinding = {
  taskId: string;
  scope: A2AScope;
  agentJobId: string;
  createdAt: string;
};

export type A2ARecoverableTask = {
  task: A2ATask;
  agentJobId?: string;
};

export type A2AIdempotentTaskRecord = Readonly<{
  task: A2ATask;
  idempotencyKey: string;
  createdAt: string;
}>;

export type A2ADispatchChildStatus = 'pending' | 'working' | 'completed' | 'failed' | 'canceled';

export type A2ADispatchStatus = 'pending' | 'working' | 'canceling' | 'completed' | 'failed' | 'canceled';

export type A2ADispatchChildPlan = Readonly<{
  childKey: string;
  childIdempotencyKey: string;
  role: string;
  agentId: string;
  providerId: string;
  /** Stable identity of the independently owned provider session, when configured. */
  executionIdentity?: string;
  /** Stable server-trusted boundary containing the provider session, when configured. */
  executionBoundaryId?: string;
  requestSha256: string;
}>;

export type A2ADispatchChildIntent = A2ADispatchChildPlan & {
  status: A2ADispatchChildStatus;
  agentJobId?: string;
  boundAt?: string;
  settledAt?: string;
  cancelAcknowledgedAt?: string;
};

export type A2ADispatchIntent = {
  parentTaskId: string;
  scope: A2AScope;
  requestFingerprint: string;
  deadlineAt: string;
  status: A2ADispatchStatus;
  cancelRequestedAt?: string;
  createdAt: string;
  updatedAt: string;
  children: A2ADispatchChildIntent[];
};

export type A2ADispatchChildOutcome = Readonly<{
  childKey: string;
  status: Extract<A2ADispatchChildStatus, 'completed' | 'failed' | 'canceled'>;
  agentJobId?: string;
}>;

export type A2ADispatchChildCancellationInput = Readonly<{
  scope: A2AScope;
  parentTaskId: string;
  childKey: string;
  childIdempotencyKey: string;
  agentId: string;
  providerId: string;
  executionIdentity?: string;
  executionBoundaryId?: string;
  agentJobId: string;
  cancelRequestedAt: string;
}>;

export type A2ADispatchCancellationFailure = Omit<
  A2ADispatchChildCancellationInput,
  'agentJobId' | 'cancelRequestedAt'
> & Readonly<{
  agentJobId?: string;
  cancelRequestedAt?: string;
  reason: 'missing-job' | 'missing-provider' | 'cancellation-failed';
  error?: string;
}>;

export type A2ADispatchCancellationFailureHandler = (
  failure: A2ADispatchCancellationFailure,
) => void | Promise<void>;

export type A2ADispatchChildCancellationHandler = (
  input: A2ADispatchChildCancellationInput,
) => Promise<void>;

export type A2AFinalizeDispatchResult = Readonly<{
  task: A2ATask;
  dispatch: A2ADispatchIntent;
}>;

export type A2AListTasksResult = {
  tasks: A2ATask[];
  totalSize: number;
  nextCursor?: string;
};

export type A2ATaskListFilter = Readonly<{
  contextId?: string;
  status?: A2ATaskStatus;
}>;

export type A2ACreateTaskResult = {
  task: A2ATask;
  created: boolean;
};

export type A2ATaskTransition = A2ATaskStatus | {
  status: A2ATaskStatus;
  artifacts?: A2ATask['artifacts'];
  error?: string;
};

export class A2AStoreConflictError extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT' as const;
  readonly taskId?: string;

  constructor(message = 'The idempotency key is already bound to a different request.', taskId?: string) {
    super(message);
    this.name = 'A2AStoreConflictError';
    this.taskId = taskId;
  }
}

export class A2AStore {
  private state = createEmptyState();
  private writeChain: Promise<void> = Promise.resolve();
  private initialized = false;
  private initialization?: Promise<void>;
  private dispatchChildCancellationHandler?: A2ADispatchChildCancellationHandler;

  constructor(private readonly filePath: string) {}

  setDispatchChildCancellationHandler(handler: A2ADispatchChildCancellationHandler | undefined): void {
    this.dispatchChildCancellationHandler = handler;
  }

  getDispatchChildCancellationHandler(): A2ADispatchChildCancellationHandler | undefined {
    return this.dispatchChildCancellationHandler;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initialization) return this.initialization;

    this.initialization = (async () => {
      const previousState = this.state;
      try {
        let loaded: LoadedState;
        try {
          const raw = await readAtomicJsonStore(this.filePath);
          loaded = loadState(JSON.parse(raw) as unknown, this.filePath);
        } catch (error: unknown) {
          if (!isFileNotFound(error)) throw error;
          loaded = { state: createEmptyState(), migrated: false };
          await atomicWriteJson(this.filePath, loaded.state);
        }
        this.state = loaded.state;
        if (loaded.migrated) await atomicWriteJson(this.filePath, this.state);
        this.initialized = true;
      } catch (error) {
        this.state = previousState;
        this.initialized = false;
        throw error;
      }
    })();

    try {
      await this.initialization;
    } finally {
      this.initialization = undefined;
    }
  }

  async createOrGetTask(input: {
    scope: A2AScope;
    contextId: string;
    message: A2AMessage;
    idempotencyKey: string;
    fingerprint: string;
  }): Promise<A2ATask> {
    return (await this.createOrGetTaskResult(input)).task;
  }

  async createOrGetTaskResult(input: {
    scope: A2AScope;
    contextId: string;
    message: A2AMessage;
    idempotencyKey: string;
    fingerprint: string;
  }): Promise<A2ACreateTaskResult> {
    this.assertInitialized();
    const scope = validateScope(input.scope);
    const message = validateMessage(input.message);
    const contextId = validateContextId(input.contextId);
    if (message.contextId !== undefined && message.contextId !== contextId) {
      throw new A2AContractError('InvalidRequestError', 'message.contextId must match contextId.');
    }
    const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
    const fingerprint = validateFingerprint(input.fingerprint);
    const recordKey = makeRecordKey(scope, idempotencyKey);

    return this.enqueueMutation(() => {
      const existing = this.state.records[recordKey];
      if (existing) {
        if (!sameScope(existing.scope, scope)) {
          throw new Error('A2A store record scope does not match its key.');
        }
        if (existing.fingerprint !== fingerprint) {
          throw new A2AStoreConflictError(undefined, existing.taskId);
        }
        const existingTask = this.state.tasks[existing.taskId];
        if (!existingTask) throw new Error('A2A store record references a missing task.');
        return { task: cloneTask(existingTask), created: false };
      }

      const taskId = makeTaskId(scope, contextId, idempotencyKey);
      if (this.state.tasks[taskId]) {
        throw new Error('A2A task identifier collision detected.');
      }
      const task: A2ATask = {
        id: taskId,
        contextId,
        status: 'submitted',
        scope: cloneScope(scope),
        artifacts: [],
      };
      const record: A2AStoreRecord = {
        scope: cloneScope(scope),
        idempotencyKey,
        fingerprint,
        taskId,
        message: {
          messageId: message.messageId,
          role: message.role,
          partCount: message.parts.length,
          contextId,
          taskId,
        },
        createdAt: new Date().toISOString(),
      };

      this.state.tasks[taskId] = task;
      this.state.records[recordKey] = record;
      return { task: cloneTask(task), created: true };
    });
  }

  getTask(id: string, scope: A2AScope): A2ATask | undefined {
    this.assertInitialized();
    const taskId = validateTaskId(id, scope);
    const normalizedScope = validateScope(scope);
    const task = this.state.tasks[taskId];
    if (!task || !sameScope(task.scope, normalizedScope)) return undefined;
    return cloneTask(task);
  }

  getTaskForOwner(id: string, scope: A2AScope): A2ATask | undefined {
    this.assertInitialized();
    validateTaskIdForPersistence(id, 'task.id');
    const normalizedScope = validateScope(scope);
    const task = this.state.tasks[id];
    if (!task || !sameTaskOwner(task.scope, normalizedScope)) return undefined;
    return cloneTask(task);
  }

  listTasks(scope: A2AScope, limit = DEFAULT_PAGE_LIMIT, cursor?: string): A2AListTasksResult {
    this.assertInitialized();
    const normalizedScope = validateScope(scope);
    const pageLimit = validatePageLimit(limit);
    const offset = cursor === undefined ? 0 : decodeCursor(validateCursor(cursor));
    const visible = Object.values(this.state.tasks)
      .filter((task) => sameScope(task.scope, normalizedScope));
    if (offset > visible.length) throw new A2AContractError('InvalidRequestError', 'cursor is outside the task result set.');
    const tasks = visible.slice(offset, offset + pageLimit).map(cloneTask);
    const nextOffset = offset + tasks.length;
    return nextOffset < visible.length
      ? { tasks, totalSize: visible.length, nextCursor: encodeCursor(nextOffset) }
      : { tasks, totalSize: visible.length };
  }

  listTasksForOwner(
    scope: A2AScope,
    limit = DEFAULT_PAGE_LIMIT,
    cursor?: string,
    filter: A2ATaskListFilter = {},
  ): A2AListTasksResult {
    this.assertInitialized();
    const normalizedScope = validateScope(scope);
    const pageLimit = validatePageLimit(limit);
    const offset = cursor === undefined ? 0 : decodeCursor(validateCursor(cursor));
    const visible = Object.values(this.state.tasks)
      .filter((task) => sameTaskOwner(task.scope, normalizedScope))
      .filter((task) => filter.contextId === undefined || task.contextId === filter.contextId)
      .filter((task) => filter.status === undefined || task.status === filter.status);
    if (offset > visible.length) throw new A2AContractError('InvalidRequestError', 'cursor is outside the task result set.');
    const tasks = visible.slice(offset, offset + pageLimit).map(cloneTask);
    const nextOffset = offset + tasks.length;
    return nextOffset < visible.length
      ? { tasks, totalSize: visible.length, nextCursor: encodeCursor(nextOffset) }
      : { tasks, totalSize: visible.length };
  }

  async transitionTask(id: string, scope: A2AScope, next: A2ATaskTransition): Promise<A2ATask | undefined> {
    this.assertInitialized();
    const normalizedScope = validateScope(scope);
    const taskId = validateTaskId(id, normalizedScope);
    const transition = normalizeTransition(next, normalizedScope);

    return this.enqueueMutation(() => {
      const current = this.state.tasks[taskId];
      if (!current || !sameScope(current.scope, normalizedScope)) return undefined;
      const updated: A2ATask = {
        ...cloneTask(current),
        status: transition.status,
        ...(transition.artifacts === undefined ? {} : { artifacts: transition.artifacts.map(cloneArtifact) }),
        ...(transition.error === undefined ? {} : { error: transition.error }),
      };
      assertTaskTransition(current, updated);
      assertAllowedTransition(current.status, updated.status);
      this.state.tasks[taskId] = validateTask(updated);
      return cloneTask(this.state.tasks[taskId]);
    });
  }

  async cancelTask(id: string, scope: A2AScope): Promise<A2ATask | undefined> {
    return this.transitionTask(id, scope, 'canceled');
  }

  async bindAgentJob(id: string, scope: A2AScope, agentJobId: string): Promise<A2ATask | undefined> {
    this.assertInitialized();
    const normalizedScope = validateScope(scope);
    const taskId = validateTaskId(id, normalizedScope);
    const normalizedAgentJobId = validateTaskIdForPersistence(agentJobId, 'agentJobId');

    return this.enqueueMutation(() => {
      const task = this.state.tasks[taskId];
      if (!task || !sameScope(task.scope, normalizedScope)) return undefined;
      const existingBinding = this.state.jobBindings[taskId];
      if (existingBinding) {
        if (existingBinding.agentJobId !== normalizedAgentJobId) {
          throw new A2AStoreConflictError(
            'The A2A task is already bound to a different agent job.',
            taskId,
          );
        }
        return cloneTask(task);
      }
      this.state.jobBindings[taskId] = {
        taskId,
        scope: cloneScope(normalizedScope),
        agentJobId: normalizedAgentJobId,
        createdAt: new Date().toISOString(),
      };
      return cloneTask(task);
    });
  }

  getAgentJobId(id: string, scope: A2AScope): string | undefined {
    this.assertInitialized();
    const normalizedScope = validateScope(scope);
    const taskId = validateTaskId(id, normalizedScope);
    const binding = this.state.jobBindings[taskId];
    if (!binding || !sameScope(binding.scope, normalizedScope)) return undefined;
    return binding.agentJobId;
  }

  async createOrGetDispatchIntent(input: {
    parentTaskId: string;
    scope: A2AScope;
    requestFingerprint: string;
    deadlineAt: string;
    children: readonly A2ADispatchChildPlan[];
  }): Promise<A2ADispatchIntent> {
    this.assertInitialized();
    const scope = validateScope(input.scope);
    const parentTaskId = validateTaskId(input.parentTaskId, scope);
    const requestFingerprint = validateFingerprint(input.requestFingerprint);
    const deadlineAt = validateTimestamp(input.deadlineAt, 'dispatch.deadlineAt');
    const children = normalizeDispatchPlanChildren(input.children);

    return this.enqueueMutation(() => {
      const parent = this.state.tasks[parentTaskId];
      if (!parent || !sameScope(parent.scope, scope)) {
        throw new A2AContractError('InvalidTaskError', 'A2A dispatch parent task is not available in scope.');
      }

      const existing = this.state.dispatchIntents[parentTaskId];
      if (existing) {
        if (!sameScope(existing.scope, scope)) throw new Error('A2A dispatch intent scope does not match its key.');
        if (existing.requestFingerprint !== requestFingerprint || !sameDispatchPlan(existing.children, children)) {
          throw new A2AStoreConflictError('The A2A parent dispatch is already bound to a different request.', parentTaskId);
        }
        return cloneDispatchIntent(existing);
      }

      if (isTerminalTaskStatus(parent.status)) {
        throw new A2AContractError('TerminalStateImmutableError', 'A2A parent task is already terminal.');
      }

      const now = new Date().toISOString();
      const dispatch: A2ADispatchIntent = {
        parentTaskId,
        scope: cloneScope(scope),
        requestFingerprint,
        deadlineAt,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        children: children.map((child) => ({ ...child, status: 'pending' })),
      };
      this.state.dispatchIntents[parentTaskId] = dispatch;
      if (parent.status === 'submitted') {
        this.state.tasks[parentTaskId] = transitionStoredTask(parent, { status: 'working' });
      }
      return cloneDispatchIntent(dispatch);
    });
  }

  getDispatchIntent(parentTaskId: string, scope: A2AScope): A2ADispatchIntent | undefined {
    this.assertInitialized();
    const normalizedScope = validateScope(scope);
    const normalizedParentTaskId = validateTaskId(parentTaskId, normalizedScope);
    const dispatch = this.state.dispatchIntents[normalizedParentTaskId];
    if (!dispatch || !sameScope(dispatch.scope, normalizedScope)) return undefined;
    return cloneDispatchIntent(dispatch);
  }

  listRecoverableDispatches(limit = MAX_RECOVERY_TASKS): A2ADispatchIntent[] {
    this.assertInitialized();
    validateRecoveryLimit(limit, 'dispatch');
    return Object.values(this.state.dispatchIntents)
      .filter((dispatch) => !isTerminalDispatchStatus(dispatch.status))
      .slice(0, limit)
      .map(cloneDispatchIntent);
  }

  async markDispatchChildStarted(
    parentTaskId: string,
    scope: A2AScope,
    childKey: string,
  ): Promise<A2ADispatchIntent | undefined> {
    this.assertInitialized();
    const normalizedScope = validateScope(scope);
    const normalizedParentTaskId = validateTaskId(parentTaskId, normalizedScope);
    const normalizedChildKey = validateTaskIdForPersistence(childKey, 'dispatch.childKey');

    return this.enqueueMutation(() => {
      const dispatch = mutableDispatchForScope(this.state, normalizedParentTaskId, normalizedScope);
      if (!dispatch) return undefined;
      const child = findDispatchChild(dispatch, normalizedChildKey);
      if (isTerminalDispatchChildStatus(child.status)) return cloneDispatchIntent(dispatch);
      child.status = 'working';
      if (dispatch.status === 'pending') dispatch.status = 'working';
      dispatch.updatedAt = new Date().toISOString();
      return cloneDispatchIntent(dispatch);
    });
  }

  async bindDispatchChild(
    parentTaskId: string,
    scope: A2AScope,
    childKey: string,
    agentJobId: string,
  ): Promise<A2ADispatchIntent | undefined> {
    this.assertInitialized();
    const normalizedScope = validateScope(scope);
    const normalizedParentTaskId = validateTaskId(parentTaskId, normalizedScope);
    const normalizedChildKey = validateTaskIdForPersistence(childKey, 'dispatch.childKey');
    const normalizedAgentJobId = validateTaskIdForPersistence(agentJobId, 'dispatch.agentJobId');

    return this.enqueueMutation(() => {
      const dispatch = mutableDispatchForScope(this.state, normalizedParentTaskId, normalizedScope);
      if (!dispatch) return undefined;
      const child = findDispatchChild(dispatch, normalizedChildKey);
      bindDispatchChildValue(child, normalizedAgentJobId);
      if (!isTerminalDispatchChildStatus(child.status)) child.status = 'working';
      if (!dispatch.cancelRequestedAt && dispatch.status === 'pending') dispatch.status = 'working';
      dispatch.updatedAt = new Date().toISOString();
      return cloneDispatchIntent(dispatch);
    });
  }

  async recordDispatchChildOutcome(
    parentTaskId: string,
    scope: A2AScope,
    outcome: A2ADispatchChildOutcome,
  ): Promise<A2ADispatchIntent | undefined> {
    this.assertInitialized();
    const normalizedScope = validateScope(scope);
    const normalizedParentTaskId = validateTaskId(parentTaskId, normalizedScope);
    const normalizedOutcome = normalizeDispatchOutcome(outcome);

    return this.enqueueMutation(() => {
      const dispatch = mutableDispatchForScope(this.state, normalizedParentTaskId, normalizedScope);
      if (!dispatch) return undefined;
      applyDispatchChildOutcome(dispatch, normalizedOutcome);
      dispatch.updatedAt = new Date().toISOString();
      return cloneDispatchIntent(dispatch);
    });
  }

  async requestDispatchCancellation(parentTaskId: string, scope: A2AScope): Promise<A2ADispatchIntent | undefined> {
    this.assertInitialized();
    const normalizedScope = validateScope(scope);
    const normalizedParentTaskId = validateTaskId(parentTaskId, normalizedScope);

    return this.enqueueMutation(() => {
      const dispatch = mutableDispatchForScope(this.state, normalizedParentTaskId, normalizedScope);
      if (!dispatch) return undefined;
      if (dispatch.status === 'completed' || dispatch.status === 'failed') {
        throw new A2AContractError('TerminalStateImmutableError', 'A2A dispatch is already terminal.');
      }
      if (dispatch.status === 'canceled') return cloneDispatchIntent(dispatch);
      if (dispatch.cancelRequestedAt) return cloneDispatchIntent(dispatch);
      dispatch.cancelRequestedAt = new Date().toISOString();
      dispatch.status = 'canceling';
      dispatch.updatedAt = dispatch.cancelRequestedAt;
      return cloneDispatchIntent(dispatch);
    });
  }

  async acknowledgeDispatchChildCancellation(
    parentTaskId: string,
    scope: A2AScope,
    childKey: string,
  ): Promise<A2ADispatchIntent | undefined> {
    this.assertInitialized();
    const normalizedScope = validateScope(scope);
    const normalizedParentTaskId = validateTaskId(parentTaskId, normalizedScope);
    const normalizedChildKey = validateTaskIdForPersistence(childKey, 'dispatch.childKey');

    return this.enqueueMutation(() => {
      const dispatch = mutableDispatchForScope(this.state, normalizedParentTaskId, normalizedScope);
      if (!dispatch) return undefined;
      if (!dispatch.cancelRequestedAt) {
        throw new A2AContractError('InvalidTaskError', 'A2A dispatch cancellation was not requested.');
      }
      const child = findDispatchChild(dispatch, normalizedChildKey);
      if (child.cancelAcknowledgedAt) return cloneDispatchIntent(dispatch);
      const now = new Date().toISOString();
      child.cancelAcknowledgedAt = now;
      if (!isTerminalDispatchChildStatus(child.status)) {
        child.status = 'canceled';
        child.settledAt = now;
      }
      dispatch.updatedAt = now;
      return cloneDispatchIntent(dispatch);
    });
  }

  async finalizeDispatch(input: {
    parentTaskId: string;
    scope: A2AScope;
    status: Extract<A2ADispatchStatus, 'completed' | 'failed' | 'canceled'>;
    childOutcomes: readonly A2ADispatchChildOutcome[];
    parentTransition: A2ATaskTransition;
  }): Promise<A2AFinalizeDispatchResult | undefined> {
    this.assertInitialized();
    const scope = validateScope(input.scope);
    const parentTaskId = validateTaskId(input.parentTaskId, scope);
    const status = validateTerminalDispatchStatus(input.status);
    const childOutcomes = normalizeDispatchOutcomes(input.childOutcomes);
    const parentTransition = normalizeTransition(input.parentTransition, scope);
    if (parentTransition.status !== status) {
      throw new A2AContractError('InvalidTaskError', 'A2A parent and dispatch terminal statuses must match.');
    }

    return this.enqueueMutation(() => {
      const dispatch = mutableDispatchForScope(this.state, parentTaskId, scope);
      const parent = this.state.tasks[parentTaskId];
      if (!dispatch || !parent || !sameScope(parent.scope, scope)) return undefined;
      for (const outcome of childOutcomes) applyDispatchChildOutcome(dispatch, outcome);
      if (dispatch.children.some((child) => !isTerminalDispatchChildStatus(child.status))) {
        throw new A2AContractError('InvalidTaskError', 'A2A dispatch cannot become terminal before every child is terminal.');
      }
      if (status === 'completed' && dispatch.children.some((child) => child.status !== 'completed')) {
        throw new A2AContractError('InvalidTaskError', 'A2A completed dispatch contains a non-completed child.');
      }
      this.state.tasks[parentTaskId] = transitionStoredTask(parent, parentTransition);
      dispatch.status = status;
      dispatch.updatedAt = new Date().toISOString();
      return {
        task: cloneTask(this.state.tasks[parentTaskId]),
        dispatch: cloneDispatchIntent(dispatch),
      };
    });
  }

  listRecoverableTasks(limit = MAX_RECOVERY_TASKS): A2ARecoverableTask[] {
    this.assertInitialized();
    validateRecoveryLimit(limit, 'task');
    const recoverableStatuses = new Set<A2ATaskStatus>([
      'submitted',
      'working',
      'input-required',
      'auth-required',
    ]);
    return Object.values(this.state.tasks)
      .filter((task) => recoverableStatuses.has(task.status) && !this.state.dispatchIntents[task.id])
      .slice(0, limit)
      .map((task) => ({
        task: cloneTask(task),
        ...(this.state.jobBindings[task.id] ? { agentJobId: this.state.jobBindings[task.id].agentJobId } : {}),
      }));
  }

  listTasksByIdempotencyPrefix(
    prefixValue: string,
    limit = MAX_RECOVERY_TASKS,
  ): A2AIdempotentTaskRecord[] {
    this.assertInitialized();
    const prefix = validateIdempotencyKey(prefixValue);
    validateRecoveryLimit(limit, 'idempotent task');
    return Object.values(this.state.records)
      .filter((record) => record.idempotencyKey.startsWith(prefix))
      .sort((left, right) => (
        right.createdAt.localeCompare(left.createdAt)
        || right.taskId.localeCompare(left.taskId)
      ))
      .slice(0, limit)
      .map((record) => {
        const task = this.state.tasks[record.taskId];
        if (!task) throw new Error('A2A idempotency record references a missing task.');
        return {
          task: cloneTask(task),
          idempotencyKey: record.idempotencyKey,
          createdAt: record.createdAt,
        };
      });
  }

  getMessageByIdempotency(scope: A2AScope, key: string): A2AStoredMessageInfo | undefined {
    this.assertInitialized();
    const normalizedScope = validateScope(scope);
    const idempotencyKey = validateIdempotencyKey(key);
    const record = this.state.records[makeRecordKey(normalizedScope, idempotencyKey)];
    if (!record || !sameScope(record.scope, normalizedScope)) return undefined;
    return cloneMessageInfo(record.message);
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('A2AStore.initialize() must complete before use.');
  }

  private enqueueMutation<T>(mutate: () => T): Promise<T> {
    const operation = this.writeChain.then(async () => {
      const previousState = cloneState(this.state);
      try {
        const result = mutate();
        validateState(this.state, this.filePath);
        await atomicWriteJson(this.filePath, this.state);
        return result;
      } catch (error) {
        this.state = previousState;
        throw error;
      }
    });
    this.writeChain = operation.then(() => undefined, () => undefined);
    return operation;
  }
}

function createEmptyState(): A2AStoreState {
  return {
    schemaVersion: SCHEMA_VERSION,
    tasks: Object.create(null) as Record<string, A2ATask>,
    records: Object.create(null) as Record<string, A2AStoreRecord>,
    jobBindings: Object.create(null) as Record<string, A2AAgentJobBinding>,
    dispatchIntents: Object.create(null) as Record<string, A2ADispatchIntent>,
  };
}

type LoadedState = {
  state: A2AStoreState;
  migrated: boolean;
};

function loadState(value: unknown, filePath: string): LoadedState {
  if (!isRecord(value)) throw new Error(`Invalid A2A store format: ${filePath}`);
  if (value.schemaVersion === LEGACY_SCHEMA_VERSION) {
    return { state: loadLegacyState(value, filePath), migrated: true };
  }
  const migratesSchemaTwo = value.schemaVersion === PREVIOUS_SCHEMA_VERSION;
  assertExactKeys(
    value,
    migratesSchemaTwo
      ? ['schemaVersion', 'tasks', 'records', 'jobBindings']
      : ['schemaVersion', 'tasks', 'records', 'jobBindings', 'dispatchIntents'],
    `Invalid A2A store format: ${filePath}`,
  );
  if (!migratesSchemaTwo && value.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported A2A store schema: ${filePath}`);
  }
  if (!isRecord(value.tasks) || !isRecord(value.records) || !isRecord(value.jobBindings)) {
    throw new Error(`Invalid A2A store maps: ${filePath}`);
  }
  if (!migratesSchemaTwo && !isRecord(value.dispatchIntents)) {
    throw new Error(`Invalid A2A store maps: ${filePath}`);
  }

  const state = createEmptyState();
  for (const [taskId, rawTask] of Object.entries(value.tasks)) {
    if (!isSafeMapKey(taskId)) throw new Error(`Invalid A2A task key: ${filePath}`);
    const task = validateTask(rawTask);
    if (task.id !== taskId) throw new Error(`A2A task key does not match task.id: ${filePath}`);
    if (state.tasks[taskId]) throw new Error(`Duplicate A2A task: ${filePath}`);
    state.tasks[taskId] = task;
  }
  for (const [recordKey, rawRecord] of Object.entries(value.records)) {
    if (!isSafeMapKey(recordKey)) throw new Error(`Invalid A2A record key: ${filePath}`);
    const record = loadRecord(rawRecord, filePath);
    if (recordKey !== makeRecordKey(record.scope, record.idempotencyKey)) {
      throw new Error(`A2A record key does not match its scope and idempotency key: ${filePath}`);
    }
    const task = state.tasks[record.taskId];
    if (!task || !sameScope(task.scope, record.scope)) {
      throw new Error(`A2A record references an out-of-scope task: ${filePath}`);
    }
    state.records[recordKey] = record;
  }
  for (const [taskId, rawBinding] of Object.entries(value.jobBindings)) {
    if (!isSafeMapKey(taskId)) throw new Error(`Invalid A2A job binding key: ${filePath}`);
    const binding = loadJobBinding(rawBinding, filePath);
    if (binding.taskId !== taskId) throw new Error(`A2A job binding key does not match taskId: ${filePath}`);
    const task = state.tasks[taskId];
    if (!task || !sameScope(task.scope, binding.scope)) {
      throw new Error(`A2A job binding references an out-of-scope task: ${filePath}`);
    }
    state.jobBindings[taskId] = binding;
  }
  if (!migratesSchemaTwo) {
    for (const [parentTaskId, rawDispatch] of Object.entries(value.dispatchIntents as Record<string, unknown>)) {
      if (!isSafeMapKey(parentTaskId)) throw new Error(`Invalid A2A dispatch key: ${filePath}`);
      const dispatch = loadDispatchIntent(rawDispatch, filePath);
      if (dispatch.parentTaskId !== parentTaskId) {
        throw new Error(`A2A dispatch key does not match parentTaskId: ${filePath}`);
      }
      const parent = state.tasks[parentTaskId];
      if (!parent || !sameScope(parent.scope, dispatch.scope)) {
        throw new Error(`A2A dispatch references an out-of-scope parent task: ${filePath}`);
      }
      state.dispatchIntents[parentTaskId] = dispatch;
    }
  }
  validateState(state, filePath);
  return { state, migrated: migratesSchemaTwo };
}

function loadLegacyState(value: Record<string, unknown>, filePath: string): A2AStoreState {
  assertExactKeys(value, ['schemaVersion', 'tasks', 'records'], `Invalid legacy A2A store format: ${filePath}`);
  if (!isRecord(value.tasks) || !isRecord(value.records)) throw new Error(`Invalid legacy A2A store maps: ${filePath}`);
  const migrated = createEmptyState();
  for (const [taskId, rawTask] of Object.entries(value.tasks)) {
    if (!isSafeMapKey(taskId)) throw new Error(`Invalid A2A task key: ${filePath}`);
    const task = validateTask(rawTask);
    if (task.id !== taskId) throw new Error(`A2A task key does not match task.id: ${filePath}`);
    if (migrated.tasks[taskId]) throw new Error(`Duplicate A2A task: ${filePath}`);
    migrated.tasks[taskId] = task;
  }
  for (const [recordKey, rawRecord] of Object.entries(value.records)) {
    if (!isSafeMapKey(recordKey)) throw new Error(`Invalid A2A record key: ${filePath}`);
    const record = loadRecord(rawRecord, filePath);
    if (recordKey !== makeRecordKey(record.scope, record.idempotencyKey)) {
      throw new Error(`A2A record key does not match its scope and idempotency key: ${filePath}`);
    }
    const task = migrated.tasks[record.taskId];
    if (!task || !sameScope(task.scope, record.scope)) {
      throw new Error(`A2A record references an out-of-scope task: ${filePath}`);
    }
    migrated.records[recordKey] = record;
  }
  validateState(migrated, filePath);
  return migrated;
}

function loadRecord(value: unknown, filePath: string): A2AStoreRecord {
  if (!isRecord(value)) throw new Error(`Invalid A2A record: ${filePath}`);
  assertExactKeys(value, ['scope', 'idempotencyKey', 'fingerprint', 'taskId', 'message', 'createdAt'], `Invalid A2A record: ${filePath}`);
  const scope = validateScope(value.scope);
  const idempotencyKey = validateIdempotencyKey(value.idempotencyKey);
  const fingerprint = validateFingerprint(value.fingerprint);
  const taskId = validateTaskIdForPersistence(value.taskId, 'record.taskId');
  const message = loadMessageInfo(value.message);
  // The task's context ID is checked against the referenced task in
  // validateState() after all persisted tasks have been loaded. At this
  // layer, only the message/task identity is available.
  if (message.taskId !== taskId) {
    throw new Error(`A2A record message identity is invalid: ${filePath}`);
  }
  const createdAt = validateTimestamp(value.createdAt, 'record.createdAt');
  return { scope, idempotencyKey, fingerprint, taskId, message, createdAt };
}

function loadJobBinding(value: unknown, filePath: string): A2AAgentJobBinding {
  if (!isRecord(value)) throw new Error(`Invalid A2A job binding: ${filePath}`);
  assertExactKeys(value, ['taskId', 'scope', 'agentJobId', 'createdAt'], `Invalid A2A job binding: ${filePath}`);
  return {
    taskId: validateTaskIdForPersistence(value.taskId, 'jobBinding.taskId'),
    scope: validateScope(value.scope),
    agentJobId: validateTaskIdForPersistence(value.agentJobId, 'jobBinding.agentJobId'),
    createdAt: validateTimestamp(value.createdAt, 'jobBinding.createdAt'),
  };
}

function loadDispatchIntent(value: unknown, filePath: string): A2ADispatchIntent {
  if (!isRecord(value)) throw new Error(`Invalid A2A dispatch intent: ${filePath}`);
  assertObjectKeys(
    value,
    ['parentTaskId', 'scope', 'requestFingerprint', 'deadlineAt', 'status', 'createdAt', 'updatedAt', 'children'],
    ['cancelRequestedAt'],
    `Invalid A2A dispatch intent: ${filePath}`,
  );
  if (!Array.isArray(value.children)) throw new Error(`Invalid A2A dispatch children: ${filePath}`);
  const dispatch: A2ADispatchIntent = {
    parentTaskId: validateTaskIdForPersistence(value.parentTaskId, 'dispatch.parentTaskId'),
    scope: validateScope(value.scope),
    requestFingerprint: validateFingerprint(value.requestFingerprint),
    deadlineAt: validateTimestamp(value.deadlineAt, 'dispatch.deadlineAt'),
    status: validateDispatchStatus(value.status),
    ...(value.cancelRequestedAt === undefined
      ? {}
      : { cancelRequestedAt: validateTimestamp(value.cancelRequestedAt, 'dispatch.cancelRequestedAt') }),
    createdAt: validateTimestamp(value.createdAt, 'dispatch.createdAt'),
    updatedAt: validateTimestamp(value.updatedAt, 'dispatch.updatedAt'),
    children: value.children.map((child) => loadDispatchChild(child, filePath)),
  };
  validateDispatchIntent(dispatch, filePath);
  return dispatch;
}

function loadDispatchChild(value: unknown, filePath: string): A2ADispatchChildIntent {
  if (!isRecord(value)) throw new Error(`Invalid A2A dispatch child: ${filePath}`);
  assertObjectKeys(
    value,
    ['childKey', 'childIdempotencyKey', 'role', 'agentId', 'providerId', 'requestSha256', 'status'],
    ['executionIdentity', 'executionBoundaryId', 'agentJobId', 'boundAt', 'settledAt', 'cancelAcknowledgedAt'],
    `Invalid A2A dispatch child: ${filePath}`,
  );
  const child: A2ADispatchChildIntent = {
    childKey: validateTaskIdForPersistence(value.childKey, 'dispatch.childKey'),
    childIdempotencyKey: validateTaskIdForPersistence(value.childIdempotencyKey, 'dispatch.childIdempotencyKey'),
    role: validateDispatchText(value.role, 'dispatch.role', MAX_DISPATCH_ROLE_LENGTH),
    agentId: validateTaskIdForPersistence(value.agentId, 'dispatch.agentId'),
    providerId: validateTaskIdForPersistence(value.providerId, 'dispatch.providerId'),
    ...(value.executionIdentity === undefined
      ? {}
      : { executionIdentity: validateTaskIdForPersistence(value.executionIdentity, 'dispatch.executionIdentity') }),
    ...(value.executionBoundaryId === undefined
      ? {}
      : { executionBoundaryId: validateTaskIdForPersistence(value.executionBoundaryId, 'dispatch.executionBoundaryId') }),
    requestSha256: validateSha256(value.requestSha256, 'dispatch.requestSha256'),
    status: validateDispatchChildStatus(value.status),
    ...(value.agentJobId === undefined
      ? {}
      : { agentJobId: validateTaskIdForPersistence(value.agentJobId, 'dispatch.agentJobId') }),
    ...(value.boundAt === undefined ? {} : { boundAt: validateTimestamp(value.boundAt, 'dispatch.boundAt') }),
    ...(value.settledAt === undefined ? {} : { settledAt: validateTimestamp(value.settledAt, 'dispatch.settledAt') }),
    ...(value.cancelAcknowledgedAt === undefined
      ? {}
      : { cancelAcknowledgedAt: validateTimestamp(value.cancelAcknowledgedAt, 'dispatch.cancelAcknowledgedAt') }),
  };
  if (Boolean(child.executionIdentity) !== Boolean(child.executionBoundaryId)) {
    throw new Error(`Invalid A2A dispatch child execution identity: ${filePath}`);
  }
  return child;
}

function loadMessageInfo(value: unknown): A2AStoredMessageInfo {
  if (!isRecord(value)) throw new Error('Invalid A2A stored message info.');
  assertExactKeys(value, ['messageId', 'role', 'partCount', 'contextId', 'taskId'], 'Invalid A2A stored message info.');
  const messageId = validateTaskIdForPersistence(value.messageId, 'message.messageId');
  if (value.role !== 'user' && value.role !== 'agent') throw new Error('Invalid A2A stored message role.');
  const partCount = value.partCount;
  if (typeof partCount !== 'number' || !Number.isSafeInteger(partCount) || partCount < 1 || partCount > 16) {
    throw new Error('Invalid A2A stored message part count.');
  }
  const contextId = validateTaskIdForPersistence(value.contextId, 'message.contextId');
  const taskId = validateTaskIdForPersistence(value.taskId, 'message.taskId');
  return { messageId, role: value.role, partCount, contextId, taskId };
}

function validateState(state: A2AStoreState, filePath: string): void {
  if (state.schemaVersion !== SCHEMA_VERSION) throw new Error(`Invalid A2A store schema: ${filePath}`);
  if (
    Object.keys(state.tasks).length > MAX_RECORDS
    || Object.keys(state.records).length > MAX_RECORDS
    || Object.keys(state.jobBindings).length > MAX_RECORDS
    || Object.keys(state.dispatchIntents).length > MAX_RECORDS
  ) {
    throw new Error(`A2A store exceeds its bounded record limit: ${filePath}`);
  }
  for (const [taskId, task] of Object.entries(state.tasks)) {
    if (taskId !== task.id) throw new Error(`A2A task key does not match task.id: ${filePath}`);
    validateTask(task);
  }
  for (const [recordKey, record] of Object.entries(state.records)) {
    if (recordKey !== makeRecordKey(record.scope, record.idempotencyKey)) {
      throw new Error(`A2A record key is invalid: ${filePath}`);
    }
    const task = state.tasks[record.taskId];
    if (!task || !sameScope(task.scope, record.scope)) throw new Error(`A2A record scope is invalid: ${filePath}`);
    validateFingerprint(record.fingerprint);
    validateTimestamp(record.createdAt, 'record.createdAt');
    if (record.message.taskId !== record.taskId || record.message.contextId !== task.contextId) {
      throw new Error(`A2A message record does not match its task: ${filePath}`);
    }
  }
  for (const [taskId, binding] of Object.entries(state.jobBindings)) {
    if (binding.taskId !== taskId) throw new Error(`A2A job binding key is invalid: ${filePath}`);
    const task = state.tasks[taskId];
    if (!task || !sameScope(task.scope, binding.scope)) throw new Error(`A2A job binding scope is invalid: ${filePath}`);
    validateTimestamp(binding.createdAt, 'jobBinding.createdAt');
  }
  for (const [parentTaskId, dispatch] of Object.entries(state.dispatchIntents)) {
    if (dispatch.parentTaskId !== parentTaskId) throw new Error(`A2A dispatch key is invalid: ${filePath}`);
    const parent = state.tasks[parentTaskId];
    if (!parent || !sameScope(parent.scope, dispatch.scope)) {
      throw new Error(`A2A dispatch parent scope is invalid: ${filePath}`);
    }
    validateDispatchIntent(dispatch, filePath);
  }
}

function validateContextId(value: unknown): string {
  const scope = {
    tenantId: 'tenant-validation',
    requesterId: 'requester-validation',
    conversationId: 'conversation-validation',
  } satisfies A2AScope;
  return validateTask({ id: 'task-validation', contextId: value, status: 'submitted', scope, artifacts: [] }).contextId;
}

function validateTaskId(id: unknown, scope: A2AScope): string {
  const normalizedScope = validateScope(scope);
  return validateTask({ id, contextId: 'context-validation', status: 'submitted', scope: normalizedScope, artifacts: [] }).id;
}

function validateTaskIdForPersistence(value: unknown, field: string): string {
  if (typeof value !== 'string' || !OPAQUE_VALUE.test(value)) throw new Error(`${field} is invalid.`);
  return value;
}

function validateFingerprint(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_FINGERPRINT_LENGTH
    || CONTROL_CHARACTERS.test(value) || !OPAQUE_VALUE.test(value)) {
    CONTROL_CHARACTERS.lastIndex = 0;
    throw new A2AContractError('InvalidRequestError', 'fingerprint is invalid.');
  }
  CONTROL_CHARACTERS.lastIndex = 0;
  return value;
}

function validateTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} is invalid.`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) throw new Error(`${field} is invalid.`);
  return value;
}

function normalizeDispatchPlanChildren(value: readonly A2ADispatchChildPlan[]): A2ADispatchChildPlan[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_DISPATCH_CHILDREN) {
    throw new A2AContractError('GraphLimitExceededError', 'A2A dispatch children are outside the allowed bounds.');
  }
  const childKeys = new Set<string>();
  const idempotencyKeys = new Set<string>();
  return value.map((child) => {
    if (!isRecord(child)) throw new A2AContractError('InvalidRequestError', 'A2A dispatch child plan is invalid.');
    assertObjectKeys(
      child,
      ['childKey', 'childIdempotencyKey', 'role', 'agentId', 'providerId', 'requestSha256'],
      ['executionIdentity', 'executionBoundaryId'],
      'Invalid A2A dispatch child plan.',
    );
    const normalized: A2ADispatchChildPlan = {
      childKey: validateTaskIdForPersistence(child.childKey, 'dispatch.childKey'),
      childIdempotencyKey: validateTaskIdForPersistence(child.childIdempotencyKey, 'dispatch.childIdempotencyKey'),
      role: validateDispatchText(child.role, 'dispatch.role', MAX_DISPATCH_ROLE_LENGTH),
      agentId: validateTaskIdForPersistence(child.agentId, 'dispatch.agentId'),
      providerId: validateTaskIdForPersistence(child.providerId, 'dispatch.providerId'),
      ...(child.executionIdentity === undefined
        ? {}
        : { executionIdentity: validateTaskIdForPersistence(child.executionIdentity, 'dispatch.executionIdentity') }),
      ...(child.executionBoundaryId === undefined
        ? {}
        : { executionBoundaryId: validateTaskIdForPersistence(child.executionBoundaryId, 'dispatch.executionBoundaryId') }),
      requestSha256: validateSha256(child.requestSha256, 'dispatch.requestSha256'),
    };
    if (Boolean(normalized.executionIdentity) !== Boolean(normalized.executionBoundaryId)) {
      throw new A2AContractError(
        'InvalidRequestError',
        'A2A dispatch child execution identity and boundary must be provided together.',
      );
    }
    if (childKeys.has(normalized.childKey) || idempotencyKeys.has(normalized.childIdempotencyKey)) {
      throw new A2AContractError('InvalidRequestError', 'A2A dispatch child identities must be unique.');
    }
    childKeys.add(normalized.childKey);
    idempotencyKeys.add(normalized.childIdempotencyKey);
    return normalized;
  });
}

function normalizeDispatchOutcome(value: A2ADispatchChildOutcome): A2ADispatchChildOutcome {
  if (!isRecord(value)) throw new A2AContractError('InvalidTaskError', 'A2A dispatch child outcome is invalid.');
  assertObjectKeys(value, ['childKey', 'status'], ['agentJobId'], 'Invalid A2A dispatch child outcome.');
  const status = validateDispatchChildStatus(value.status);
  if (!isTerminalDispatchChildStatus(status)) {
    throw new A2AContractError('InvalidTaskError', 'A2A dispatch child outcome must be terminal.');
  }
  return {
    childKey: validateTaskIdForPersistence(value.childKey, 'dispatch.childKey'),
    status,
    ...(value.agentJobId === undefined
      ? {}
      : { agentJobId: validateTaskIdForPersistence(value.agentJobId, 'dispatch.agentJobId') }),
  };
}

function normalizeDispatchOutcomes(value: readonly A2ADispatchChildOutcome[]): A2ADispatchChildOutcome[] {
  if (!Array.isArray(value) || value.length > MAX_DISPATCH_CHILDREN) {
    throw new A2AContractError('GraphLimitExceededError', 'A2A dispatch outcomes are outside the allowed bounds.');
  }
  const childKeys = new Set<string>();
  return value.map((outcome) => {
    const normalized = normalizeDispatchOutcome(outcome);
    if (childKeys.has(normalized.childKey)) {
      throw new A2AContractError('InvalidTaskError', 'A2A dispatch outcomes contain duplicate child keys.');
    }
    childKeys.add(normalized.childKey);
    return normalized;
  });
}

function sameDispatchPlan(left: readonly A2ADispatchChildIntent[], right: readonly A2ADispatchChildPlan[]): boolean {
  return left.length === right.length && left.every((child, index) => {
    const candidate = right[index];
    return Boolean(candidate
      && child.childKey === candidate.childKey
      && child.childIdempotencyKey === candidate.childIdempotencyKey
      && child.role === candidate.role
      && child.agentId === candidate.agentId
      && child.providerId === candidate.providerId
      && child.executionIdentity === candidate.executionIdentity
      && child.executionBoundaryId === candidate.executionBoundaryId
      && child.requestSha256 === candidate.requestSha256);
  });
}

function mutableDispatchForScope(
  state: A2AStoreState,
  parentTaskId: string,
  scope: A2AScope,
): A2ADispatchIntent | undefined {
  const dispatch = state.dispatchIntents[parentTaskId];
  if (!dispatch || !sameScope(dispatch.scope, scope)) return undefined;
  return dispatch;
}

function findDispatchChild(dispatch: A2ADispatchIntent, childKey: string): A2ADispatchChildIntent {
  const child = dispatch.children.find((candidate) => candidate.childKey === childKey);
  if (!child) throw new A2AContractError('InvalidTaskError', 'A2A dispatch child is not available.');
  return child;
}

function bindDispatchChildValue(child: A2ADispatchChildIntent, agentJobId: string): void {
  if (child.agentJobId) {
    if (child.agentJobId !== agentJobId) {
      throw new A2AStoreConflictError('The A2A dispatch child is already bound to a different agent job.');
    }
    return;
  }
  if (isTerminalDispatchChildStatus(child.status)) {
    throw new A2AContractError('TerminalStateImmutableError', 'A2A terminal dispatch child cannot acquire a new job binding.');
  }
  child.agentJobId = agentJobId;
  child.boundAt = new Date().toISOString();
}

function applyDispatchChildOutcome(dispatch: A2ADispatchIntent, outcome: A2ADispatchChildOutcome): void {
  const child = findDispatchChild(dispatch, outcome.childKey);
  if (outcome.agentJobId) bindDispatchChildValue(child, outcome.agentJobId);
  if (isTerminalDispatchChildStatus(child.status)) {
    if (child.status !== outcome.status) {
      throw new A2AContractError('TerminalStateImmutableError', 'A2A dispatch child outcome is already terminal.');
    }
    return;
  }
  child.status = outcome.status;
  child.settledAt = new Date().toISOString();
  if (!dispatch.cancelRequestedAt && dispatch.status === 'pending') dispatch.status = 'working';
}

function validateDispatchIntent(dispatch: A2ADispatchIntent, filePath: string): void {
  validateTaskIdForPersistence(dispatch.parentTaskId, 'dispatch.parentTaskId');
  validateScope(dispatch.scope);
  validateFingerprint(dispatch.requestFingerprint);
  validateTimestamp(dispatch.deadlineAt, 'dispatch.deadlineAt');
  validateDispatchStatus(dispatch.status);
  validateTimestamp(dispatch.createdAt, 'dispatch.createdAt');
  validateTimestamp(dispatch.updatedAt, 'dispatch.updatedAt');
  if (dispatch.cancelRequestedAt) validateTimestamp(dispatch.cancelRequestedAt, 'dispatch.cancelRequestedAt');
  if (!Array.isArray(dispatch.children) || dispatch.children.length < 1 || dispatch.children.length > MAX_DISPATCH_CHILDREN) {
    throw new Error(`Invalid A2A dispatch child count: ${filePath}`);
  }
  if (dispatch.status === 'canceling' && !dispatch.cancelRequestedAt) {
    throw new Error(`Invalid A2A dispatch cancellation state: ${filePath}`);
  }
  if (dispatch.cancelRequestedAt && (dispatch.status === 'pending' || dispatch.status === 'working')) {
    throw new Error(`Invalid A2A dispatch cancellation status: ${filePath}`);
  }

  const childKeys = new Set<string>();
  const idempotencyKeys = new Set<string>();
  for (const child of dispatch.children) {
    validateTaskIdForPersistence(child.childKey, 'dispatch.childKey');
    validateTaskIdForPersistence(child.childIdempotencyKey, 'dispatch.childIdempotencyKey');
    validateDispatchText(child.role, 'dispatch.role', MAX_DISPATCH_ROLE_LENGTH);
    validateTaskIdForPersistence(child.agentId, 'dispatch.agentId');
    validateTaskIdForPersistence(child.providerId, 'dispatch.providerId');
    if (Boolean(child.executionIdentity) !== Boolean(child.executionBoundaryId)) {
      throw new Error(`Invalid A2A dispatch child execution identity: ${filePath}`);
    }
    if (child.executionIdentity) validateTaskIdForPersistence(child.executionIdentity, 'dispatch.executionIdentity');
    if (child.executionBoundaryId) validateTaskIdForPersistence(child.executionBoundaryId, 'dispatch.executionBoundaryId');
    validateSha256(child.requestSha256, 'dispatch.requestSha256');
    validateDispatchChildStatus(child.status);
    if (childKeys.has(child.childKey) || idempotencyKeys.has(child.childIdempotencyKey)) {
      throw new Error(`Duplicate A2A dispatch child identity: ${filePath}`);
    }
    childKeys.add(child.childKey);
    idempotencyKeys.add(child.childIdempotencyKey);
    if (Boolean(child.agentJobId) !== Boolean(child.boundAt)) {
      throw new Error(`Invalid A2A dispatch child binding: ${filePath}`);
    }
    if (child.agentJobId) validateTaskIdForPersistence(child.agentJobId, 'dispatch.agentJobId');
    if (child.boundAt) validateTimestamp(child.boundAt, 'dispatch.boundAt');
    if (isTerminalDispatchChildStatus(child.status) !== Boolean(child.settledAt)) {
      throw new Error(`Invalid A2A dispatch child terminal state: ${filePath}`);
    }
    if (child.settledAt) validateTimestamp(child.settledAt, 'dispatch.settledAt');
    if (child.cancelAcknowledgedAt) {
      if (!dispatch.cancelRequestedAt) throw new Error(`Invalid A2A dispatch child cancellation acknowledgement: ${filePath}`);
      validateTimestamp(child.cancelAcknowledgedAt, 'dispatch.cancelAcknowledgedAt');
    }
  }
  if (isTerminalDispatchStatus(dispatch.status)
    && dispatch.children.some((child) => !isTerminalDispatchChildStatus(child.status))) {
    throw new Error(`Invalid terminal A2A dispatch: ${filePath}`);
  }
  if (dispatch.status === 'completed' && dispatch.children.some((child) => child.status !== 'completed')) {
    throw new Error(`Invalid completed A2A dispatch: ${filePath}`);
  }
}

function validateDispatchStatus(value: unknown): A2ADispatchStatus {
  const statuses: readonly A2ADispatchStatus[] = ['pending', 'working', 'canceling', 'completed', 'failed', 'canceled'];
  if (!statuses.includes(value as A2ADispatchStatus)) throw new Error('dispatch.status is invalid.');
  return value as A2ADispatchStatus;
}

function validateTerminalDispatchStatus(
  value: unknown,
): Extract<A2ADispatchStatus, 'completed' | 'failed' | 'canceled'> {
  if (value !== 'completed' && value !== 'failed' && value !== 'canceled') {
    throw new A2AContractError('InvalidTaskError', 'A2A dispatch terminal status is invalid.');
  }
  return value;
}

function validateDispatchChildStatus(value: unknown): A2ADispatchChildStatus {
  const statuses: readonly A2ADispatchChildStatus[] = ['pending', 'working', 'completed', 'failed', 'canceled'];
  if (!statuses.includes(value as A2ADispatchChildStatus)) throw new Error('dispatch.child.status is invalid.');
  return value as A2ADispatchChildStatus;
}

function validateDispatchText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || CONTROL_CHARACTERS.test(value)) {
    CONTROL_CHARACTERS.lastIndex = 0;
    throw new Error(`${field} is invalid.`);
  }
  CONTROL_CHARACTERS.lastIndex = 0;
  return value;
}

function validateSha256(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SHA256_VALUE.test(value)) throw new Error(`${field} is invalid.`);
  return value;
}

function validateRecoveryLimit(limit: number, recordKind: string): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RECORDS) {
    throw new Error(`A2A recoverable ${recordKind} limit is invalid.`);
  }
}

function isTerminalDispatchChildStatus(
  status: A2ADispatchChildStatus,
): status is Extract<A2ADispatchChildStatus, 'completed' | 'failed' | 'canceled'> {
  return status === 'completed' || status === 'failed' || status === 'canceled';
}

function isTerminalDispatchStatus(status: A2ADispatchStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'canceled';
}

function isTerminalTaskStatus(status: A2ATaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'canceled' || status === 'rejected';
}

function transitionStoredTask(
  current: A2ATask,
  transition: { status: A2ATaskStatus; artifacts?: A2ATask['artifacts']; error?: string },
): A2ATask {
  const updated: A2ATask = {
    ...cloneTask(current),
    status: transition.status,
    ...(transition.artifacts === undefined ? {} : { artifacts: transition.artifacts.map(cloneArtifact) }),
    ...(transition.error === undefined ? {} : { error: transition.error }),
  };
  assertTaskTransition(current, updated);
  assertAllowedTransition(current.status, updated.status);
  return validateTask(updated);
}

function normalizeTransition(next: A2ATaskTransition, scope: A2AScope): { status: A2ATaskStatus; artifacts?: A2ATask['artifacts']; error?: string } {
  if (typeof next === 'string') return { status: next as A2ATaskStatus };
  if (!isRecord(next)) throw new A2AContractError('InvalidTaskError', 'task transition must be a status or task patch.');
  assertExactKeys(next, ['status', 'artifacts', 'error'], 'InvalidTaskError');
  const statuses: readonly A2ATaskStatus[] = [
    'submitted',
    'working',
    'input-required',
    'auth-required',
    'completed',
    'failed',
    'canceled',
    'rejected',
  ];
  if (!statuses.includes(next.status as A2ATaskStatus)) {
    throw new A2AContractError('InvalidTaskError', 'task transition status is invalid.');
  }
  const status = next.status as A2ATaskStatus;
  const artifacts = next.artifacts === undefined
    ? undefined
    : next.artifacts.map((artifact) => validateArtifactRef(artifact, scope));
  return {
    status,
    ...(artifacts ? { artifacts: artifacts.flat() } : {}),
    ...(next.error === undefined ? {} : { error: String(next.error) }),
  };
}

function assertAllowedTransition(previous: A2ATaskStatus, next: A2ATaskStatus): void {
  const allowed: Record<A2ATaskStatus, readonly A2ATaskStatus[]> = {
    submitted: ['submitted', 'working', 'input-required', 'auth-required', 'failed', 'canceled', 'rejected'],
    working: ['working', 'input-required', 'auth-required', 'completed', 'failed', 'canceled', 'rejected'],
    'input-required': ['input-required', 'working', 'auth-required', 'failed', 'canceled', 'rejected'],
    'auth-required': ['auth-required', 'input-required', 'working', 'failed', 'canceled', 'rejected'],
    completed: ['completed'],
    failed: ['failed'],
    canceled: ['canceled'],
    rejected: ['rejected'],
  };
  if (!allowed[previous].includes(next)) {
    throw new A2AContractError('InvalidTaskError', `Invalid A2A task transition: ${previous} -> ${next}.`);
  }
}

function makeRecordKey(scope: A2AScope, idempotencyKey: string): string {
  return `record-${sha256(JSON.stringify([scope.tenantId, scope.requesterId, scope.conversationId, idempotencyKey]))}`;
}

function makeTaskId(scope: A2AScope, contextId: string, idempotencyKey: string): string {
  return `task-${sha256(JSON.stringify([scope.tenantId, scope.requesterId, scope.conversationId, contextId, idempotencyKey]))}`;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ v: CURSOR_VERSION, offset }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): number {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (!isRecord(parsed) || parsed.v !== CURSOR_VERSION || !Number.isSafeInteger(parsed.offset) || (parsed.offset as number) < 0) {
      throw new Error('invalid');
    }
    return parsed.offset as number;
  } catch {
    throw new A2AContractError('InvalidRequestError', 'cursor is invalid.');
  }
}

function sameScope(left: A2AScope, right: A2AScope): boolean {
  return left.tenantId === right.tenantId
    && left.requesterId === right.requesterId
    && left.conversationId === right.conversationId;
}

function sameTaskOwner(left: A2AScope, right: A2AScope): boolean {
  return left.tenantId === right.tenantId
    && left.requesterId === right.requesterId;
}

function cloneState(state: A2AStoreState): A2AStoreState {
  const clone = createEmptyState();
  for (const [id, task] of Object.entries(state.tasks)) clone.tasks[id] = cloneTask(task);
  for (const [key, record] of Object.entries(state.records)) clone.records[key] = cloneRecord(record);
  for (const [taskId, binding] of Object.entries(state.jobBindings)) clone.jobBindings[taskId] = cloneJobBinding(binding);
  for (const [parentTaskId, dispatch] of Object.entries(state.dispatchIntents)) {
    clone.dispatchIntents[parentTaskId] = cloneDispatchIntent(dispatch);
  }
  return clone;
}

function cloneTask(task: A2ATask): A2ATask {
  return {
    id: task.id,
    contextId: task.contextId,
    status: task.status,
    scope: cloneScope(task.scope),
    artifacts: task.artifacts.map(cloneArtifact),
    ...(task.error === undefined ? {} : { error: task.error }),
  };
}

function cloneArtifact(artifact: A2ATask['artifacts'][number]): A2ATask['artifacts'][number] {
  return {
    ...artifact,
    scope: cloneScope(artifact.scope),
    ...(artifact.metadata === undefined ? {} : { metadata: cloneJson(artifact.metadata) as Record<string, unknown> }),
  };
}

function cloneScope(scope: A2AScope): A2AScope {
  return { tenantId: scope.tenantId, requesterId: scope.requesterId, conversationId: scope.conversationId };
}

function cloneMessageInfo(message: A2AStoredMessageInfo): A2AStoredMessageInfo {
  return { ...message };
}

function cloneRecord(record: A2AStoreRecord): A2AStoreRecord {
  return { ...record, scope: cloneScope(record.scope), message: cloneMessageInfo(record.message) };
}

function cloneJobBinding(binding: A2AAgentJobBinding): A2AAgentJobBinding {
  return { ...binding, scope: cloneScope(binding.scope) };
}

function cloneDispatchIntent(dispatch: A2ADispatchIntent): A2ADispatchIntent {
  return {
    parentTaskId: dispatch.parentTaskId,
    scope: cloneScope(dispatch.scope),
    requestFingerprint: dispatch.requestFingerprint,
    deadlineAt: dispatch.deadlineAt,
    status: dispatch.status,
    ...(dispatch.cancelRequestedAt === undefined ? {} : { cancelRequestedAt: dispatch.cancelRequestedAt }),
    createdAt: dispatch.createdAt,
    updatedAt: dispatch.updatedAt,
    children: dispatch.children.map((child) => ({ ...child })),
  };
}

function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], message: string): void {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key)) || keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new Error(message);
  }
}

function assertObjectKeys(
  value: Record<string, unknown>,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  message: string,
): void {
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  if (Object.keys(value).some((key) => !allowed.has(key))
    || requiredKeys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new Error(message);
  }
}

function isSafeMapKey(value: string): boolean {
  return OPAQUE_VALUE.test(value);
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
