import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  DefaultAzureCredential,
  type DefaultAzureCredentialClientIdOptions,
  type TokenCredential,
} from '@azure/identity';
import { QueueClient } from '@azure/storage-queue';

import {
  AGENT_DISPATCH_SCHEMA_VERSION,
  type AgentDispatchCheckpoint,
  type AgentDispatchCompletionReceipt,
  type AgentDispatchErrorReceipt,
  type AgentDispatchQueue,
  type AgentDispatchTask,
  type AgentDispatchTaskReference,
  type LegacyAgentDispatchRecord,
  type LegacyAgentDispatchTask,
  type ServerOwnedLegacyDispatchMigration,
  canonicalAgentDispatchExecution,
  hashLegacyAgentDispatchTask,
  isTerminalDispatchStatus,
} from './queue/agent-dispatch-queue.js';

export type AgentDispatchRecord = {
  taskId: string;
  idempotencyKey: string;
  requestHash: string;
  status: 'queued' | 'leased' | 'completed' | 'failed' | 'cancelled' | 'quarantined';
  task: AgentDispatchTask;
  enqueued: boolean;
  dequeueCount: number;
  updatedAt: string;
  leaseOwner?: string;
  leaseGeneration: number;
  leaseMessageId?: string;
  leaseExpiresAt?: string;
  cancellationRequested?: boolean;
  cancellationReason?: string;
  checkpoint?: AgentDispatchCheckpoint;
  receipt?: AgentDispatchCompletionReceipt;
  error?: AgentDispatchErrorReceipt;
  quarantineReason?: string;
};

export type AgentDispatchLease = Readonly<{
  task: AgentDispatchTask;
  messageId: string;
  popReceipt: string;
  dequeueCount: number;
  leaseOwner: string;
  leaseGeneration: number;
}>;

export interface AgentDispatchStatePort {
  create(record: AgentDispatchRecord): Promise<'created' | 'exists'>;
  get(reference: AgentDispatchTaskReference): Promise<AgentDispatchRecord | undefined>;
  /** Reads an accepted v1 record from the explicitly configured legacy/global partition. */
  getLegacy?(reference: AgentDispatchTaskReference): Promise<LegacyAgentDispatchRecord | undefined>;
  /**
   * Atomically applies mutate only while owner and generation still match.
   * Implementations must use applyAgentDispatchRecordMutation so immutable
   * server-derived dispatch identity cannot be changed by a CAS callback.
   */
  compareAndSwap(
    reference: AgentDispatchTaskReference,
    expected: { leaseOwner?: string; leaseGeneration: number },
    mutate: (current: AgentDispatchRecord) => AgentDispatchRecord,
  ): Promise<AgentDispatchRecord | undefined>;
  /** Performs a read-only dependency probe without creating durable state. */
  probeDependency?(reference: AgentDispatchTaskReference): Promise<{ reachable: true }>;
  /** Reads the latest durable worker observation without mutating shared state. */
  readWorkerHeartbeat?(reference: AgentDispatchTaskReference): Promise<{ observedAt: string; source: string } | undefined>;
}

export interface AzureQueueClientPort {
  sendMessage(messageText: string): Promise<{ messageId: string }>;
  receiveMessage(options: { visibilityTimeoutSeconds: number }): Promise<{
    messageId: string;
    popReceipt: string;
    messageText: string;
    dequeueCount: number;
  } | undefined>;
  updateMessage(
    messageId: string,
    popReceipt: string,
    messageText: string | undefined,
    visibilityTimeoutSeconds: number,
  ): Promise<{ popReceipt: string }>;
  deleteMessage(messageId: string, popReceipt: string): Promise<void>;
  sendPoisonMessage(messageText: string): Promise<void>;
  /** Performs read-only Queue Storage metadata probes. */
  probeDependency?(): Promise<{ reachable: true }>;
}

type QueueSdkPort = Pick<QueueClient, 'sendMessage' | 'receiveMessages' | 'updateMessage' | 'deleteMessage'> & {
  getProperties?: QueueClient['getProperties'];
};
type Clock = { now(): Date };

type DependencyHealth = Readonly<{ state: 'reachable' | 'unavailable' | 'unverified' }>;

export type AzureDispatchHealth = Readonly<{
  liveness: Readonly<{ state: 'alive' }>;
  configuration: Readonly<{ state: 'configured' }>;
  dependencies: Readonly<{ queue: DependencyHealth; state: DependencyHealth }>;
  workerHeartbeat: Readonly<{
    state: 'observed' | 'stale' | 'not-observed';
    observedAt?: string;
    source?: string;
  }>;
  readiness: Readonly<{ state: 'ready' | 'unavailable' }>;
  executionBoundary: 'external-linux-worker' | 'external-linux-worker-unverified';
}>;

const DIAGNOSTIC_FIELD_LIMITS = Object.freeze({
  checkpoint: 1_024,
  completionResult: 4_096,
  providerExecutionId: 256,
  errorCode: 128,
  errorMessage: 1_024,
  cancellationReason: 512,
  quarantineReason: 512,
});

export type ProductionAzureQueueClientOptions = {
  env: Record<string, string | undefined>;
  createDefaultAzureCredential?: (options: DefaultAzureCredentialClientIdOptions) => TokenCredential;
  createQueueClient?: (endpoint: string, credential: TokenCredential) => QueueSdkPort;
};

export class DispatchConflictError extends Error {
  readonly code = 'AGENT_DISPATCH_CONFLICT' as const;

  constructor(taskId: string) {
    super(`Task ${taskId} is already bound to a different dispatch request.`);
    this.name = 'DispatchConflictError';
  }
}

export class DispatchLeaseConflictError extends Error {
  readonly code = 'AGENT_DISPATCH_LEASE_CONFLICT' as const;

  constructor(taskId: string) {
    super(`Task ${taskId} lease owner or generation is stale.`);
    this.name = 'DispatchLeaseConflictError';
  }
}

export class DispatchImmutableIdentityConflictError extends Error {
  readonly code = 'AGENT_DISPATCH_IMMUTABLE_IDENTITY_CONFLICT' as const;

  constructor(taskId: string) {
    super(`Task ${taskId} compare-and-swap attempted to change immutable dispatch identity.`);
    this.name = 'DispatchImmutableIdentityConflictError';
  }
}

export class DispatchInvalidStateError extends Error {
  readonly code = 'AGENT_DISPATCH_INVALID_STATE' as const;

  constructor(taskId: string) {
    super(`Task ${taskId} has invalid canonical dispatch state.`);
    this.name = 'DispatchInvalidStateError';
  }
}

export class LegacyDispatchMigrationUnavailableError extends Error {
  readonly code = 'AGENT_DISPATCH_LEGACY_MIGRATION_UNAVAILABLE' as const;

  constructor(taskId: string) {
    super(`Legacy dispatch task ${taskId} is retained until its server-owned migration state is available.`);
    this.name = 'LegacyDispatchMigrationUnavailableError';
  }
}

export function assertCanonicalAgentDispatchRecord(record: AgentDispatchRecord): void {
  try {
    const task = canonicalTask(record.task);
    if (
      !isDeepStrictEqual(record.task, task)
      || record.taskId !== task.taskId
      || record.idempotencyKey !== task.idempotencyKey
      || record.requestHash !== hashTask(task)
    ) {
      throw new Error('dispatch identity fields are inconsistent');
    }
  } catch (error) {
    if (error instanceof DispatchInvalidStateError) throw error;
    throw new DispatchInvalidStateError(safeTaskIdForError(record?.taskId));
  }
}

export function applyAgentDispatchRecordMutation(
  current: AgentDispatchRecord,
  mutate: (current: AgentDispatchRecord) => AgentDispatchRecord,
): AgentDispatchRecord {
  assertCanonicalAgentDispatchRecord(current);
  const next = mutate(structuredClone(current));
  if (
    !next
    || typeof next !== 'object'
    || Array.isArray(next)
    || !isDeepStrictEqual(immutableDispatchIdentity(current), immutableDispatchIdentity(next))
  ) {
    throw new DispatchImmutableIdentityConflictError(current.taskId);
  }
  assertCanonicalAgentDispatchRecord(next);
  return next;
}

export class AzureAgentDispatchQueue implements AgentDispatchQueue {
  private readonly clock: Clock;

  constructor(
    private readonly client: AzureQueueClientPort,
    private readonly state: AgentDispatchStatePort,
    options: { clock?: Clock; legacyMigration?: ServerOwnedLegacyDispatchMigration } = {},
  ) {
    this.clock = options.clock ?? { now: () => new Date() };
    this.legacyMigration = options.legacyMigration;
  }

  private readonly legacyMigration?: ServerOwnedLegacyDispatchMigration;

  async enqueue(input: AgentDispatchTask): Promise<AgentDispatchRecord> {
    const task = canonicalTask(input);
    const reference = canonicalTaskReference(task);
    const requestHash = hashTask(task);
    const record: AgentDispatchRecord = {
      taskId: task.taskId,
      idempotencyKey: task.idempotencyKey,
      requestHash,
      status: 'queued',
      task,
      enqueued: false,
      dequeueCount: 0,
      leaseGeneration: 0,
      updatedAt: this.now(),
    };
    const created = await this.state.create(record);
    if (created === 'exists') {
      const existing = await this.state.get(reference);
      if (!existing || existing.requestHash !== requestHash || existing.idempotencyKey !== task.idempotencyKey) {
        throw new DispatchConflictError(task.taskId);
      }
      if (existing.enqueued || isTerminalDispatchStatus(existing.status)) return sanitizeRecordForResponse(existing);
    }

    await this.client.sendMessage(JSON.stringify(task));
    const current = await this.requiredRecord(reference);
    const persisted = await this.compareAndSwap(reference, leaseIdentity(current), (latest) => ({
      ...latest,
      enqueued: true,
      updatedAt: this.now(),
    }));
    if (!persisted) throw new DispatchLeaseConflictError(task.taskId);
    return sanitizeRecordForResponse(persisted);
  }

  async observe(input: AgentDispatchTaskReference): Promise<AgentDispatchRecord | undefined> {
    const reference = canonicalTaskReference(input);
    const record = await this.state.get(reference);
    if (record) assertRecordScope(record, reference);
    return record && sanitizeRecordForResponse(record);
  }

  async readHealth(options: {
    taskReference?: AgentDispatchTaskReference;
    workerHeartbeat?: { observedAt: string; source: string };
    maximumHeartbeatAgeMs?: number;
  } = {}): Promise<AzureDispatchHealth> {
    const reference = options.taskReference && canonicalTaskReference(options.taskReference);
    const [stateDependency, durableHeartbeat] = await Promise.all([
      probeDependency(reference && this.state.probeDependency
        ? () => this.state.probeDependency!(reference)
        : undefined),
      readWorkerHeartbeat(reference && this.state.readWorkerHeartbeat
        ? () => this.state.readWorkerHeartbeat!(reference)
        : undefined),
    ]);
    const maximumHeartbeatAgeMs = options.maximumHeartbeatAgeMs ?? 30_000;
    if (!Number.isSafeInteger(maximumHeartbeatAgeMs) || maximumHeartbeatAgeMs < 1 || maximumHeartbeatAgeMs > 300_000) {
      throw new TypeError('maximum heartbeat age must be between 1 and 300000 milliseconds');
    }
    const heartbeat = classifyWorkerHeartbeat(
      options.workerHeartbeat ?? durableHeartbeat.value,
      this.clock.now(),
      maximumHeartbeatAgeMs,
    );
    const observedStateDependency = durableHeartbeat.failed
      ? Object.freeze({ state: 'unavailable' as const })
      : stateDependency;
    const queueDependency = Object.freeze({
      state: heartbeat.state === 'observed' ? 'reachable' as const : 'unverified' as const,
    });
    const ready = queueDependency.state === 'reachable'
      && observedStateDependency.state === 'reachable'
      && heartbeat.state === 'observed';
    return Object.freeze({
      liveness: Object.freeze({ state: 'alive' as const }),
      configuration: Object.freeze({ state: 'configured' as const }),
      dependencies: Object.freeze({ queue: queueDependency, state: observedStateDependency }),
      workerHeartbeat: heartbeat,
      readiness: Object.freeze({ state: ready ? 'ready' as const : 'unavailable' as const }),
      executionBoundary: ready ? 'external-linux-worker' : 'external-linux-worker-unverified',
    });
  }

  async lease(options: { visibilityTimeoutSeconds: number; maxDequeueCount?: number }): Promise<AgentDispatchLease | undefined> {
    validateVisibility(options.visibilityTimeoutSeconds);
    const message = await this.client.receiveMessage({ visibilityTimeoutSeconds: options.visibilityTimeoutSeconds });
    if (!message) return undefined;

    let task: AgentDispatchTask;
    try {
      task = await this.parseDispatchMessage(message.messageText);
    } catch (error) {
      if (error instanceof LegacyDispatchMigrationUnavailableError) {
        await this.deferMessage(message);
        return undefined;
      }
      await this.quarantineMessage(message, undefined, safeMessage(error));
      return undefined;
    }
    const reference = canonicalTaskReference(task);
    const record = await this.state.get(reference);
    if (record) assertRecordScope(record, reference);
    if (!record || record.requestHash !== hashTask(task)) {
      await this.quarantineMessage(message, undefined, 'unknown or mismatched durable dispatch record');
      return undefined;
    }
    if (isTerminalDispatchStatus(record.status)) {
      await this.client.deleteMessage(message.messageId, message.popReceipt);
      return {
        task,
        messageId: message.messageId,
        popReceipt: message.popReceipt,
        dequeueCount: message.dequeueCount,
        leaseOwner: record.leaseOwner ?? 'terminal',
        leaseGeneration: record.leaseGeneration,
      };
    }
    if (message.dequeueCount > (options.maxDequeueCount ?? 5)) {
      await this.quarantineMessage(message, record, 'maximum dequeue count exceeded');
      return undefined;
    }

    const nowMs = this.clock.now().getTime();
    const leaseExpired = !record.leaseExpiresAt || Date.parse(record.leaseExpiresAt) <= nowMs;
    const sameMessageRedelivery = record.leaseMessageId === message.messageId && message.dequeueCount > record.dequeueCount;
    if (record.leaseOwner && !leaseExpired && !sameMessageRedelivery) {
      await this.client.deleteMessage(message.messageId, message.popReceipt);
      return undefined;
    }

    const leaseOwner = crypto.randomUUID();
    const leaseGeneration = record.leaseGeneration + 1;
    const claimed = await this.compareAndSwap(reference, leaseIdentity(record), (current) => {
      const currentExpired = !current.leaseExpiresAt || Date.parse(current.leaseExpiresAt) <= nowMs;
      const currentRedelivery = current.leaseMessageId === message.messageId && message.dequeueCount > current.dequeueCount;
      if (current.leaseOwner && !currentExpired && !currentRedelivery) {
        throw new DispatchLeaseConflictError(task.taskId);
      }
      return {
        ...current,
        status: 'leased',
        dequeueCount: message.dequeueCount,
        leaseOwner,
        leaseGeneration,
        leaseMessageId: message.messageId,
        leaseExpiresAt: new Date(nowMs + options.visibilityTimeoutSeconds * 1_000).toISOString(),
        updatedAt: this.now(),
      };
    });
    if (!claimed) {
      await this.client.deleteMessage(message.messageId, message.popReceipt);
      return undefined;
    }
    return { task, messageId: message.messageId, popReceipt: message.popReceipt, dequeueCount: message.dequeueCount, leaseOwner, leaseGeneration };
  }

  async heartbeat(
    lease: AgentDispatchLease,
    checkpoint: AgentDispatchCheckpoint,
    visibilityTimeoutSeconds: number,
  ): Promise<AgentDispatchLease> {
    validateLease(lease);
    validateVisibility(visibilityTimeoutSeconds);
    if (!Number.isInteger(checkpoint.sequence) || checkpoint.sequence < 0) throw new TypeError('checkpoint sequence is invalid');
    const message = sanitizeDiagnostic(checkpoint.message, 'checkpoint message', DIAGNOSTIC_FIELD_LIMITS.checkpoint);
    const update = await this.client.updateMessage(lease.messageId, lease.popReceipt, undefined, visibilityTimeoutSeconds);
    const persisted = await this.compareAndSwap(canonicalTaskReference(lease.task), leaseIdentity(lease), (record) => {
      assertOwned(record, lease);
      if (isTerminalDispatchStatus(record.status)) throw new DispatchLeaseConflictError(lease.task.taskId);
      return {
        ...record,
        checkpoint: { sequence: checkpoint.sequence, message, recordedAt: this.now() },
        leaseExpiresAt: new Date(this.clock.now().getTime() + visibilityTimeoutSeconds * 1_000).toISOString(),
        updatedAt: this.now(),
      };
    });
    if (!persisted) throw new DispatchLeaseConflictError(lease.task.taskId);
    return { ...lease, popReceipt: requireText(update.popReceipt, 'renewed popReceipt') };
  }

  async complete(lease: AgentDispatchLease, receipt: AgentDispatchCompletionReceipt): Promise<void> {
    const result = sanitizeDiagnostic(receipt.result, 'nonempty completion result', DIAGNOSTIC_FIELD_LIMITS.completionResult);
    const providerExecutionId = sanitizeDiagnostic(
      receipt.providerExecutionId,
      'providerExecutionId',
      DIAGNOSTIC_FIELD_LIMITS.providerExecutionId,
    );
    await this.terminalUpdate(lease, (record) => {
      if (record.cancellationRequested) throw new Error('cancelled dispatch cannot be completed');
      return {
        ...record,
        status: 'completed',
        receipt: { result, providerExecutionId, completedAt: this.now() },
        error: undefined,
      };
    });
  }

  async fail(lease: AgentDispatchLease, error: AgentDispatchErrorReceipt): Promise<void> {
    const code = sanitizeDiagnostic(error.code, 'error code', DIAGNOSTIC_FIELD_LIMITS.errorCode);
    const message = sanitizeDiagnostic(error.message, 'error message', DIAGNOSTIC_FIELD_LIMITS.errorMessage);
    await this.terminalUpdate(lease, (record) => ({
      ...record,
      status: 'failed',
      error: { code, message, failedAt: this.now() },
    }));
  }

  async cancel(lease: AgentDispatchLease, reason: string): Promise<void> {
    const cancellationReason = sanitizeDiagnostic(
      reason,
      'cancellation reason',
      DIAGNOSTIC_FIELD_LIMITS.cancellationReason,
    );
    await this.terminalUpdate(lease, (record) => ({
      ...record,
      status: 'cancelled',
      cancellationRequested: true,
      cancellationReason,
    }));
  }

  async requestCancellation(input: AgentDispatchTaskReference, reason: string): Promise<void> {
    const reference = canonicalTaskReference(input);
    const id = reference.taskId;
    const cancellationReason = sanitizeDiagnostic(
      reason,
      'cancellation reason',
      DIAGNOSTIC_FIELD_LIMITS.cancellationReason,
    );
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await this.requiredRecord(reference);
      if (isTerminalDispatchStatus(current.status)) return;
      const updated = await this.compareAndSwap(reference, leaseIdentity(current), (record) => ({
        ...record,
        cancellationRequested: true,
        cancellationReason,
        updatedAt: this.now(),
      }));
      if (updated) return;
    }
    throw new DispatchLeaseConflictError(id);
  }

  private async terminalUpdate(
    lease: AgentDispatchLease,
    mutate: (record: AgentDispatchRecord) => AgentDispatchRecord,
  ): Promise<void> {
    validateLease(lease);
    const persisted = await this.compareAndSwap(canonicalTaskReference(lease.task), leaseIdentity(lease), (record) => {
      assertOwned(record, lease);
      return {
        ...mutate(record),
        leaseExpiresAt: undefined,
        updatedAt: this.now(),
      };
    });
    if (!persisted) throw new DispatchLeaseConflictError(lease.task.taskId);
    await this.client.deleteMessage(lease.messageId, lease.popReceipt);
  }

  private async requiredRecord(input: AgentDispatchTaskReference): Promise<AgentDispatchRecord> {
    const reference = canonicalTaskReference(input);
    const record = await this.state.get(reference);
    if (!record) throw new Error(`No durable dispatch record exists for ${reference.taskId}.`);
    assertRecordScope(record, reference);
    return record;
  }

  private async parseDispatchMessage(messageText: string): Promise<AgentDispatchTask> {
    let value: unknown;
    try {
      value = JSON.parse(messageText);
    } catch {
      throw new Error('dispatch message is not valid JSON');
    }
    if (isLegacyDispatchTask(value)) return this.migrateLegacyTask(value);
    return canonicalTask(value);
  }

  private async migrateLegacyTask(legacyTask: LegacyAgentDispatchTask): Promise<AgentDispatchTask> {
    if (!this.legacyMigration) {
      throw new LegacyDispatchMigrationUnavailableError(legacyTask.taskId);
    }
    const legacyReference = canonicalTaskReference({
      taskId: legacyTask.taskId,
      tenantId: legacyTask.tenantId,
      requesterId: legacyTask.requesterId,
      conversationId: legacyTask.conversationId,
    });
    const legacyRequestHash = hashLegacyAgentDispatchTask(legacyTask);
    let legacyRecord: LegacyAgentDispatchRecord | undefined;
    try {
      legacyRecord = this.state.getLegacy
        ? await this.state.getLegacy(legacyReference)
        : undefined;
    } catch {
      throw new LegacyDispatchMigrationUnavailableError(legacyTask.taskId);
    }
    if (legacyRecord && !isMatchingLegacyRecord(legacyRecord, legacyTask, legacyRequestHash)) {
      throw new Error('legacy dispatch record is missing or hash-bound state does not match the accepted message');
    }
    let execution: AgentDispatchTask['execution'] | undefined;
    try {
      execution = await this.legacyMigration.resolveExecution(legacyTask, legacyRequestHash);
    } catch {
      throw new LegacyDispatchMigrationUnavailableError(legacyTask.taskId);
    }
    if (!execution) throw new LegacyDispatchMigrationUnavailableError(legacyTask.taskId);
    const task = canonicalTask({
      ...legacyTask,
      schemaVersion: AGENT_DISPATCH_SCHEMA_VERSION,
      execution: canonicalAgentDispatchExecution(execution),
    });
    const reference = canonicalTaskReference(task);
    let current: AgentDispatchRecord | undefined;
    try {
      current = await this.state.get(reference);
    } catch {
      throw new LegacyDispatchMigrationUnavailableError(legacyTask.taskId);
    }
    if (!current) {
      if (!legacyRecord) throw new LegacyDispatchMigrationUnavailableError(legacyTask.taskId);
      const migrated = migrateLegacyRecord(legacyRecord, task);
      let created: 'created' | 'exists';
      try {
        created = await this.state.create(migrated);
      } catch {
        throw new LegacyDispatchMigrationUnavailableError(legacyTask.taskId);
      }
      if (created === 'created') {
        current = migrated;
      } else {
        try {
          current = await this.state.get(reference);
        } catch {
          throw new LegacyDispatchMigrationUnavailableError(legacyTask.taskId);
        }
      }
    }
    if (!current) throw new LegacyDispatchMigrationUnavailableError(legacyTask.taskId);
    assertRecordScope(current, reference);
    if (current.requestHash !== hashTask(task) || current.idempotencyKey !== task.idempotencyKey) {
      throw new Error('migrated dispatch record does not match the immutable v1 request identity');
    }
    return task;
  }

  private async deferMessage(
    message: { messageId: string; popReceipt: string },
  ): Promise<void> {
    await this.client.updateMessage(message.messageId, message.popReceipt, undefined, 1);
  }

  private async quarantineMessage(
    message: { messageId: string; popReceipt: string; messageText: string; dequeueCount: number },
    record: AgentDispatchRecord | undefined,
    reason: string,
  ): Promise<void> {
    const quarantineReason = sanitizeDiagnostic(
      reason,
      'quarantine reason',
      DIAGNOSTIC_FIELD_LIMITS.quarantineReason,
    );
    await this.client.sendPoisonMessage(JSON.stringify({
      schemaVersion: 1,
      quarantinedAt: this.now(),
      reason: quarantineReason,
      messageId: message.messageId,
      dequeueCount: message.dequeueCount,
      messageSha256: crypto.createHash('sha256').update(message.messageText, 'utf8').digest('hex'),
    }));
    if (record) {
      const updated = await this.compareAndSwap(canonicalTaskReference(record.task), leaseIdentity(record), (current) => ({
        ...current,
        status: 'quarantined',
        quarantineReason,
        leaseExpiresAt: undefined,
        updatedAt: this.now(),
      }));
      if (!updated) throw new DispatchLeaseConflictError(record.taskId);
    }
    await this.client.deleteMessage(message.messageId, message.popReceipt);
  }

  private now(): string {
    return this.clock.now().toISOString();
  }

  private compareAndSwap(
    reference: AgentDispatchTaskReference,
    expected: { leaseOwner?: string; leaseGeneration: number },
    mutate: (current: AgentDispatchRecord) => AgentDispatchRecord,
  ): Promise<AgentDispatchRecord | undefined> {
    return this.state.compareAndSwap(reference, expected, (current) => (
      applyAgentDispatchRecordMutation(current, mutate)
    ));
  }
}

export function createProductionAzureQueueClient(options: ProductionAzureQueueClientOptions): AzureQueueClientPort {
  rejectSecretAuthentication(options.env);
  const queueEndpoint = requireQueueEndpoint(options.env, 'AZURE_STORAGE_QUEUE_ENDPOINT');
  const poisonEndpoint = requireQueueEndpoint(options.env, 'AZURE_STORAGE_POISON_QUEUE_ENDPOINT');
  const credentialOptions: DefaultAzureCredentialClientIdOptions = options.env.AZURE_CLIENT_ID?.trim()
    ? { managedIdentityClientId: options.env.AZURE_CLIENT_ID.trim() }
    : {};
  const credential = (options.createDefaultAzureCredential ?? ((settings) => new DefaultAzureCredential(settings)))(credentialOptions);
  const createClient = options.createQueueClient ?? ((endpoint, tokenCredential) => new QueueClient(endpoint, tokenCredential));
  const queue = createClient(queueEndpoint, credential);
  const poison = createClient(poisonEndpoint, credential);
  return {
    async sendMessage(messageText) {
      const response = await queue.sendMessage(messageText);
      return { messageId: requireText(response.messageId, 'messageId') };
    },
    async receiveMessage({ visibilityTimeoutSeconds }) {
      const response = await queue.receiveMessages({ numberOfMessages: 1, visibilityTimeout: visibilityTimeoutSeconds });
      const item = response.receivedMessageItems[0];
      if (!item) return undefined;
      return {
        messageId: item.messageId,
        popReceipt: item.popReceipt,
        messageText: item.messageText,
        dequeueCount: item.dequeueCount,
      };
    },
    async updateMessage(messageId, popReceipt, messageText, visibilityTimeoutSeconds) {
      const response = await queue.updateMessage(messageId, popReceipt, messageText, visibilityTimeoutSeconds);
      return { popReceipt: requireText(response.popReceipt, 'popReceipt') };
    },
    async deleteMessage(messageId, popReceipt) {
      await queue.deleteMessage(messageId, popReceipt);
    },
    async sendPoisonMessage(messageText) {
      await poison.sendMessage(messageText);
    },
  };
}

export function latestDurableWorkerHeartbeat(
  records: readonly AgentDispatchRecord[],
): { observedAt: string; source: string } | undefined {
  let latest: { observedAt: string; source: string; observedAtMs: number } | undefined;
  for (const record of records) {
    const checkpoint = record.checkpoint;
    if (checkpoint?.message !== 'worker heartbeat') continue;
    const observedAt = checkpoint.recordedAt;
    if (typeof observedAt !== 'string') continue;
    const observedAtMs = Date.parse(observedAt);
    if (!Number.isFinite(observedAtMs) || (latest && observedAtMs <= latest.observedAtMs)) continue;
    latest = {
      observedAt,
      source: 'durable-dispatch-lease-renewal',
      observedAtMs,
    };
  }
  return latest && { observedAt: latest.observedAt, source: latest.source };
}

export function canonicalAgentTaskId(value: unknown): string {
  const taskId = requireText(value, 'taskId');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(taskId)) {
    throw new TypeError('taskId must be a canonical bounded identifier');
  }
  return taskId;
}

function canonicalTask(value: unknown): AgentDispatchTask {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('dispatch task must be an object');
  const task = value as Record<string, unknown>;
  if (task.schemaVersion !== AGENT_DISPATCH_SCHEMA_VERSION) throw new TypeError('unknown dispatch schema version');
  const normalized: AgentDispatchTask = {
    schemaVersion: AGENT_DISPATCH_SCHEMA_VERSION,
    taskId: canonicalAgentTaskId(task.taskId),
    idempotencyKey: requireText(task.idempotencyKey, 'idempotencyKey'),
    tenantId: requireText(task.tenantId, 'tenantId'),
    requesterId: requireText(task.requesterId, 'requesterId'),
    conversationId: requireText(task.conversationId, 'conversationId'),
    provider: requireText(task.provider, 'provider'),
    prompt: requireText(task.prompt, 'prompt'),
    createdAt: requireText(task.createdAt, 'createdAt'),
    execution: canonicalExecution(task.execution),
  };
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > 48 * 1024) {
    throw new TypeError('dispatch task exceeds the bounded Queue Storage payload');
  }
  return Object.freeze(normalized);
}

export function canonicalTaskReference(value: unknown): AgentDispatchTaskReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('dispatch task reference must be an object');
  const reference = value as Record<string, unknown>;
  return Object.freeze({
    taskId: canonicalAgentTaskId(reference.taskId),
    tenantId: requireText(reference.tenantId, 'tenantId'),
    requesterId: requireText(reference.requesterId, 'requesterId'),
    conversationId: requireText(reference.conversationId, 'conversationId'),
  });
}

function assertRecordScope(record: AgentDispatchRecord, reference: AgentDispatchTaskReference): void {
  assertCanonicalAgentDispatchRecord(record);
  if (
    record.taskId !== reference.taskId
    || record.task.taskId !== reference.taskId
    || record.task.tenantId !== reference.tenantId
    || record.task.requesterId !== reference.requesterId
    || record.task.conversationId !== reference.conversationId
  ) {
    throw new Error(`Durable dispatch record scope mismatch for ${reference.taskId}.`);
  }
}

function immutableDispatchIdentity(record: AgentDispatchRecord): Readonly<{
  taskId: string;
  idempotencyKey: string;
  requestHash: string;
  task: AgentDispatchTask;
}> {
  return {
    taskId: record.taskId,
    idempotencyKey: record.idempotencyKey,
    requestHash: record.requestHash,
    task: record.task,
  };
}

function safeTaskIdForError(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value)
    ? value
    : 'unknown';
}

function canonicalExecution(value: unknown): AgentDispatchTask['execution'] {
  return canonicalAgentDispatchExecution(value);
}

function isLegacyDispatchTask(value: unknown): value is LegacyAgentDispatchTask {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && (value as Record<string, unknown>).schemaVersion === 1);
}

function isMatchingLegacyRecord(
  record: LegacyAgentDispatchRecord,
  task: LegacyAgentDispatchTask,
  requestHash: string,
): boolean {
  try {
    if (
      !isDeepStrictEqual(record.task, task)
      || record.taskId !== task.taskId
      || record.idempotencyKey !== task.idempotencyKey
      || record.requestHash !== requestHash
      || !['queued', 'leased', 'completed', 'failed', 'cancelled', 'quarantined'].includes(record.status)
      || typeof record.enqueued !== 'boolean'
      || !Number.isSafeInteger(record.dequeueCount)
      || record.dequeueCount < 0
      || typeof record.updatedAt !== 'string'
      || (record.leaseGeneration !== undefined
        && (!Number.isSafeInteger(record.leaseGeneration) || record.leaseGeneration < 0))
    ) return false;
    return hashLegacyAgentDispatchTask(task) === requestHash;
  } catch {
    return false;
  }
}

function migrateLegacyRecord(
  legacy: LegacyAgentDispatchRecord,
  task: AgentDispatchTask,
): AgentDispatchRecord {
  return {
    taskId: task.taskId,
    idempotencyKey: task.idempotencyKey,
    requestHash: hashTask(task),
    status: legacy.status,
    task,
    enqueued: legacy.enqueued,
    dequeueCount: legacy.dequeueCount,
    updatedAt: legacy.updatedAt,
    leaseOwner: legacy.leaseOwner,
    leaseGeneration: legacy.leaseGeneration ?? 0,
    leaseMessageId: legacy.leaseMessageId,
    leaseExpiresAt: legacy.leaseExpiresAt,
    cancellationRequested: legacy.cancellationRequested,
    cancellationReason: legacy.cancellationReason,
    checkpoint: legacy.checkpoint,
    receipt: legacy.receipt,
    error: legacy.error,
    quarantineReason: legacy.quarantineReason,
  };
}

function hashTask(task: AgentDispatchTask): string {
  return crypto.createHash('sha256').update(JSON.stringify(task), 'utf8').digest('hex');
}

function leaseIdentity(value: { leaseOwner?: string; leaseGeneration: number }): { leaseOwner?: string; leaseGeneration: number } {
  return value.leaseOwner ? { leaseOwner: value.leaseOwner, leaseGeneration: value.leaseGeneration } : { leaseGeneration: value.leaseGeneration };
}

function assertOwned(record: AgentDispatchRecord, lease: AgentDispatchLease): void {
  if (record.leaseOwner !== lease.leaseOwner || record.leaseGeneration !== lease.leaseGeneration) {
    throw new DispatchLeaseConflictError(lease.task.taskId);
  }
}

function validateLease(lease: AgentDispatchLease): void {
  canonicalTask(lease.task);
  requireText(lease.messageId, 'messageId');
  requireText(lease.popReceipt, 'popReceipt');
  requireText(lease.leaseOwner, 'lease owner');
  if (!Number.isSafeInteger(lease.leaseGeneration) || lease.leaseGeneration < 1) throw new TypeError('lease generation is invalid');
}

function validateVisibility(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 604_800) throw new TypeError('visibility timeout must be between 1 and 604800 seconds');
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be nonempty`);
  return value.trim();
}

function requireQueueEndpoint(env: Record<string, string | undefined>, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required for production worker configuration`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be a credential-free HTTPS queue URL`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`${key} must be a credential-free HTTPS queue URL`);
  }
  return url.toString();
}

function rejectSecretAuthentication(env: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(env)) {
    if (!value?.trim()) continue;
    const normalized = key.toUpperCase();
    if (normalized.includes('STORAGE') && (
      normalized.includes('CONNECTION_STRING') || normalized.includes('CONNECTIONSTRING') ||
      normalized.includes('ACCOUNT_KEY') || normalized.includes('SAS')
    )) {
      throw new Error(`Storage connection strings, keys, and SAS credentials are forbidden: ${key}`);
    }
  }
}

function safeMessage(error: unknown): string {
  return sanitizeDiagnostic(
    error instanceof Error ? error.message : String(error),
    'diagnostic message',
    DIAGNOSTIC_FIELD_LIMITS.errorMessage,
  );
}

function sanitizeRecordForResponse(value: AgentDispatchRecord): AgentDispatchRecord {
  return {
    taskId: value.taskId,
    idempotencyKey: value.idempotencyKey,
    requestHash: value.requestHash,
    status: value.status,
    task: {
      schemaVersion: value.task.schemaVersion,
      taskId: value.task.taskId,
      idempotencyKey: value.task.idempotencyKey,
      tenantId: value.task.tenantId,
      requesterId: value.task.requesterId,
      conversationId: value.task.conversationId,
      provider: value.task.provider,
      prompt: value.task.prompt,
      createdAt: value.task.createdAt,
      execution: { ...value.task.execution },
    },
    enqueued: value.enqueued,
    dequeueCount: value.dequeueCount,
    updatedAt: value.updatedAt,
    leaseGeneration: value.leaseGeneration,
    ...(value.leaseOwner !== undefined ? { leaseOwner: value.leaseOwner } : {}),
    ...(value.leaseMessageId !== undefined ? { leaseMessageId: value.leaseMessageId } : {}),
    ...(value.leaseExpiresAt !== undefined ? { leaseExpiresAt: value.leaseExpiresAt } : {}),
    ...(value.cancellationRequested !== undefined ? { cancellationRequested: value.cancellationRequested } : {}),
    ...(value.checkpoint ? {
      checkpoint: {
        sequence: value.checkpoint.sequence,
        message: sanitizeDiagnostic(
          value.checkpoint.message,
          'checkpoint message',
          DIAGNOSTIC_FIELD_LIMITS.checkpoint,
        ),
        recordedAt: value.checkpoint.recordedAt,
      },
    } : {}),
    ...(value.receipt ? {
      receipt: {
        result: sanitizeDiagnostic(
          value.receipt.result,
          'completion result',
          DIAGNOSTIC_FIELD_LIMITS.completionResult,
        ),
        providerExecutionId: sanitizeDiagnostic(
          value.receipt.providerExecutionId,
          'providerExecutionId',
          DIAGNOSTIC_FIELD_LIMITS.providerExecutionId,
        ),
        completedAt: value.receipt.completedAt,
      },
    } : {}),
    ...(value.error ? {
      error: {
        code: sanitizeDiagnostic(value.error.code, 'error code', DIAGNOSTIC_FIELD_LIMITS.errorCode),
        message: sanitizeDiagnostic(
          value.error.message,
          'error message',
          DIAGNOSTIC_FIELD_LIMITS.errorMessage,
        ),
        failedAt: value.error.failedAt,
      },
    } : {}),
    ...(value.cancellationReason ? {
      cancellationReason: sanitizeDiagnostic(
        value.cancellationReason,
        'cancellation reason',
        DIAGNOSTIC_FIELD_LIMITS.cancellationReason,
      ),
    } : {}),
    ...(value.quarantineReason ? {
      quarantineReason: sanitizeDiagnostic(
        value.quarantineReason,
        'quarantine reason',
        DIAGNOSTIC_FIELD_LIMITS.quarantineReason,
      ),
    } : {}),
  };
}

function sanitizeDiagnostic(value: unknown, label: string, maximumBytes: number): string {
  const text = redactDiagnosticCredentials(requireText(value, label))
    .replace(/(?:\\\\|\/\/)[^|,;\r\n]+/gu, '[REDACTED_PATH]')
    .replace(/[A-Za-z]:\\[^|,;\r\n]+/gu, '[REDACTED_PATH]')
    .replace(/~\/[^\s"'`,;|()[\]{}<>]*/gu, '[REDACTED_PATH]')
    .replace(/\/(?:[^\s"'`,;|()[\]{}<>]+\/?)+/gu, '[REDACTED_PATH]')
    .replace(
      /--(?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password)(?:=|\s+)(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      '[REDACTED_CREDENTIAL_ARGUMENT]',
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [REDACTED]')
    .replace(/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu, '[REDACTED_TOKEN]')
    .replace(/\b(?:sk|xai)-[A-Za-z0-9_-]{12,}\b/giu, '[REDACTED]')
    .replace(
      /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password)\b\s*(?:=|:|\s)\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu,
      '$1=[REDACTED]',
    );
  return truncateUtf8(text, maximumBytes);
}

function redactDiagnosticCredentials(value: string): string {
  const credentialAssignment = /(^|[^A-Za-z0-9_])((?:[A-Za-z][A-Za-z0-9_]*_)?(?:API_?KEY|CLIENT_?SECRET|ACCESS_?TOKEN|REFRESH_?TOKEN|TOKEN|SECRET|PASSWORD))\s*(=|:)\s*(?:"[^"]*"|'[^']*'|[^\s,;|]+)/giu;
  return value.replace(
    credentialAssignment,
    (_match, prefix: string, key: string, separator: string) => `${prefix}${key}${separator}[REDACTED]`,
  );
}

function truncateUtf8(value: string, maximumBytes: number): string {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.byteLength <= maximumBytes) return value;
  let end = maximumBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString('utf8');
}

async function probeDependency(
  probe: (() => Promise<{ reachable: true }>) | undefined,
): Promise<DependencyHealth> {
  if (!probe) return Object.freeze({ state: 'unverified' });
  try {
    const result = await probe();
    return Object.freeze({ state: result.reachable === true ? 'reachable' : 'unavailable' });
  } catch {
    return Object.freeze({ state: 'unavailable' });
  }
}

async function readWorkerHeartbeat(
  read: (() => Promise<{ observedAt: string; source: string } | undefined>) | undefined,
): Promise<Readonly<{
  value?: { observedAt: string; source: string };
  failed: boolean;
}>> {
  if (!read) return Object.freeze({ failed: false });
  try {
    const value = await read();
    return Object.freeze({ ...(value ? { value } : {}), failed: false });
  } catch {
    return Object.freeze({ failed: true });
  }
}

function classifyWorkerHeartbeat(
  heartbeat: { observedAt: string; source: string } | undefined,
  now: Date,
  maximumAgeMs: number,
): AzureDispatchHealth['workerHeartbeat'] {
  if (!heartbeat) return Object.freeze({ state: 'not-observed' });
  const observedAtMs = Date.parse(heartbeat.observedAt);
  const source = sanitizeDiagnostic(heartbeat.source, 'worker heartbeat source', 128);
  if (!Number.isFinite(observedAtMs) || observedAtMs > now.getTime() || now.getTime() - observedAtMs > maximumAgeMs) {
    return Object.freeze({ state: 'stale', observedAt: heartbeat.observedAt, source });
  }
  return Object.freeze({ state: 'observed', observedAt: heartbeat.observedAt, source });
}
