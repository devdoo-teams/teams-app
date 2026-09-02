import crypto from 'node:crypto';

import {
  AGENT_DISPATCH_SCHEMA_VERSION,
  type AgentDispatchCheckpoint,
  type AgentDispatchCompletionReceipt,
  type AgentDispatchErrorReceipt,
  type AgentDispatchLease,
  type AgentDispatchQueue,
  type AgentDispatchRecord,
  type AgentDispatchTask,
  isTerminalDispatchStatus,
} from './agent-dispatch-queue.js';

export type { AgentDispatchRecord } from './agent-dispatch-queue.js';

export interface AgentDispatchStatePort {
  create(record: AgentDispatchRecord): Promise<'created' | 'exists'>;
  get(taskId: string): Promise<AgentDispatchRecord | undefined>;
  /** Must atomically read, transform, and persist one task record. */
  update(taskId: string, mutate: (current: AgentDispatchRecord) => AgentDispatchRecord): Promise<AgentDispatchRecord>;
}

export interface AzureQueueClientPort {
  sendMessage(messageText: string): Promise<{ messageId: string }>;
  receiveMessage(options: { visibilityTimeoutSeconds: number }): Promise<{
    messageId: string;
    popReceipt: string;
    messageText: string;
    dequeueCount: number;
  } | undefined>;
  updateMessage(messageId: string, popReceipt: string, messageText: string | undefined, visibilityTimeoutSeconds: number): Promise<{ popReceipt: string }>;
  deleteMessage(messageId: string, popReceipt: string): Promise<void>;
  sendPoisonMessage(messageText: string): Promise<void>;
}

export class DispatchConflictError extends Error {
  readonly code = 'AGENT_DISPATCH_CONFLICT' as const;
  constructor(taskId: string) {
    super(`Task ${taskId} is already bound to a different dispatch request.`);
    this.name = 'DispatchConflictError';
  }
}

type Clock = { now(): Date };

export class AzureAgentDispatchQueue implements AgentDispatchQueue {
  private readonly clock: Clock;

  constructor(
    private readonly client: AzureQueueClientPort,
    private readonly state: AgentDispatchStatePort,
    options: { clock?: Clock } = {},
  ) {
    this.clock = options.clock ?? { now: () => new Date() };
  }

  async enqueue(task: AgentDispatchTask): Promise<AgentDispatchRecord> {
    validateTask(task);
    const requestHash = hashTask(task);
    const now = this.clock.now().toISOString();
    const record: AgentDispatchRecord = {
      taskId: task.taskId,
      idempotencyKey: task.idempotencyKey,
      requestHash,
      status: 'queued',
      task: structuredClone(task),
      enqueued: false,
      dequeueCount: 0,
      updatedAt: now,
    };
    const created = await this.state.create(record);
    if (created === 'exists') {
      const existing = await this.state.get(task.taskId);
      if (!existing || existing.requestHash !== requestHash || existing.idempotencyKey !== task.idempotencyKey) {
        throw new DispatchConflictError(task.taskId);
      }
      if (existing.enqueued || isTerminalDispatchStatus(existing.status)) return structuredClone(existing);
      // A previous producer may have stopped after creating durable state but
      // before (or immediately after) Queue Storage accepted the message.
      // Re-sending is intentionally at-least-once; task identity prevents a
      // duplicate delivery from becoming a duplicate execution.
      await this.client.sendMessage(JSON.stringify(task));
      return this.state.update(task.taskId, (current) => ({
        ...current,
        enqueued: true,
        updatedAt: this.clock.now().toISOString(),
      }));
    }
    await this.client.sendMessage(JSON.stringify(task));
    return this.state.update(task.taskId, (current) => ({
      ...current,
      enqueued: true,
      updatedAt: this.clock.now().toISOString(),
    }));
  }

  observe(taskId: string): Promise<AgentDispatchRecord | undefined> {
    return this.state.get(requireText(taskId, 'taskId')).then((record) => record && structuredClone(record));
  }

  async lease(options: { visibilityTimeoutSeconds: number; maxDequeueCount?: number }): Promise<AgentDispatchLease | undefined> {
    validateVisibility(options.visibilityTimeoutSeconds);
    const message = await this.client.receiveMessage({ visibilityTimeoutSeconds: options.visibilityTimeoutSeconds });
    if (!message) return undefined;

    let task: AgentDispatchTask;
    try {
      task = parseTask(message.messageText);
    } catch (error) {
      await this.quarantineMessage(message, undefined, error instanceof Error ? error.message : 'invalid dispatch message');
      return undefined;
    }

    const record = await this.state.get(task.taskId);
    if (!record || record.requestHash !== hashTask(task)) {
      await this.quarantineMessage(message, record, 'unknown or mismatched durable dispatch record');
      return undefined;
    }
    if (isTerminalDispatchStatus(record.status)) {
      await this.client.deleteMessage(message.messageId, message.popReceipt);
      return {
        task,
        messageId: message.messageId,
        popReceipt: message.popReceipt,
        dequeueCount: message.dequeueCount,
      };
    }
    if (message.dequeueCount > (options.maxDequeueCount ?? 5)) {
      await this.quarantineMessage(message, record, 'maximum dequeue count exceeded');
      return undefined;
    }
    await this.state.update(task.taskId, (current) => ({
      ...current,
      status: 'leased',
      dequeueCount: message.dequeueCount,
      updatedAt: this.clock.now().toISOString(),
    }));
    return { task, messageId: message.messageId, popReceipt: message.popReceipt, dequeueCount: message.dequeueCount };
  }

  async heartbeat(lease: AgentDispatchLease, checkpoint: AgentDispatchCheckpoint, visibilityTimeoutSeconds: number): Promise<AgentDispatchLease> {
    validateLease(lease);
    validateVisibility(visibilityTimeoutSeconds);
    if (!Number.isInteger(checkpoint.sequence) || checkpoint.sequence < 0) throw new TypeError('checkpoint sequence is invalid');
    requireText(checkpoint.message, 'checkpoint message');
    const update = await this.client.updateMessage(lease.messageId, lease.popReceipt, undefined, visibilityTimeoutSeconds);
    await this.state.update(lease.task.taskId, (record) => {
      if (isTerminalDispatchStatus(record.status)) throw new Error('terminal dispatch cannot be renewed');
      return {
        ...record,
        status: 'leased',
        checkpoint: { ...checkpoint, recordedAt: this.clock.now().toISOString() },
        updatedAt: this.clock.now().toISOString(),
      };
    });
    return { ...lease, popReceipt: requireText(update.popReceipt, 'renewed popReceipt') };
  }

  async complete(lease: AgentDispatchLease, receipt: AgentDispatchCompletionReceipt): Promise<void> {
    validateLease(lease);
    const result = requireText(receipt.result, 'nonempty completion result');
    const providerExecutionId = requireText(receipt.providerExecutionId, 'providerExecutionId');
    await this.state.update(lease.task.taskId, (record) => {
      if (record.cancellationRequested) throw new Error('cancelled dispatch cannot be completed');
      return {
        ...record,
        status: 'completed',
        receipt: { result, providerExecutionId, completedAt: this.clock.now().toISOString() },
        error: undefined,
        updatedAt: this.clock.now().toISOString(),
      };
    });
    await this.client.deleteMessage(lease.messageId, lease.popReceipt);
  }

  async fail(lease: AgentDispatchLease, error: AgentDispatchErrorReceipt): Promise<void> {
    validateLease(lease);
    await this.state.update(lease.task.taskId, (record) => ({
      ...record,
      status: 'failed',
      error: {
        code: requireText(error.code, 'error code'),
        message: requireText(error.message, 'error message'),
        failedAt: this.clock.now().toISOString(),
      },
      updatedAt: this.clock.now().toISOString(),
    }));
    await this.client.deleteMessage(lease.messageId, lease.popReceipt);
  }

  async cancel(lease: AgentDispatchLease, reason: string): Promise<void> {
    validateLease(lease);
    await this.state.update(lease.task.taskId, (record) => ({
      ...record,
      status: 'cancelled',
      cancellationRequested: true,
      cancellationReason: requireText(reason, 'cancellation reason'),
      updatedAt: this.clock.now().toISOString(),
    }));
    await this.client.deleteMessage(lease.messageId, lease.popReceipt);
  }

  async requestCancellation(taskId: string, reason: string): Promise<void> {
    await this.state.update(taskId, (record) => isTerminalDispatchStatus(record.status) ? record : ({
      ...record,
      cancellationRequested: true,
      cancellationReason: requireText(reason, 'cancellation reason'),
      updatedAt: this.clock.now().toISOString(),
    }));
  }

  private async requiredRecord(taskId: string): Promise<AgentDispatchRecord> {
    const record = await this.state.get(requireText(taskId, 'taskId'));
    if (!record) throw new Error(`No durable dispatch record exists for ${taskId}.`);
    return record;
  }

  private async quarantineMessage(
    message: { messageId: string; popReceipt: string; messageText: string; dequeueCount: number },
    record: AgentDispatchRecord | undefined,
    reason: string,
  ): Promise<void> {
    await this.client.sendPoisonMessage(JSON.stringify({
      schemaVersion: 1,
      quarantinedAt: this.clock.now().toISOString(),
      reason,
      messageId: message.messageId,
      dequeueCount: message.dequeueCount,
      messageSha256: crypto.createHash('sha256').update(message.messageText, 'utf8').digest('hex'),
    }));
    if (record) {
      await this.state.update(record.taskId, (current) => ({
        ...current,
        status: 'quarantined',
        quarantineReason: reason,
        updatedAt: this.clock.now().toISOString(),
      }));
    }
    await this.client.deleteMessage(message.messageId, message.popReceipt);
  }
}

function parseTask(messageText: string): AgentDispatchTask {
  let value: unknown;
  try { value = JSON.parse(messageText); } catch { throw new Error('dispatch message is not valid JSON'); }
  validateTask(value);
  return structuredClone(value);
}

function validateTask(value: unknown): asserts value is AgentDispatchTask {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('dispatch task must be an object');
  const task = value as Record<string, unknown>;
  if (task.schemaVersion !== AGENT_DISPATCH_SCHEMA_VERSION) throw new TypeError('unknown dispatch schema version');
  for (const key of ['taskId', 'idempotencyKey', 'tenantId', 'requesterId', 'conversationId', 'provider', 'prompt', 'createdAt']) {
    requireText(task[key], key);
  }
  if (Buffer.byteLength(JSON.stringify(task), 'utf8') > 48 * 1024) {
    throw new TypeError('dispatch task exceeds the bounded Queue Storage payload');
  }
}

function hashTask(task: AgentDispatchTask): string {
  return crypto.createHash('sha256').update(JSON.stringify({
    schemaVersion: task.schemaVersion,
    taskId: task.taskId,
    idempotencyKey: task.idempotencyKey,
    tenantId: task.tenantId,
    requesterId: task.requesterId,
    conversationId: task.conversationId,
    provider: task.provider,
    prompt: task.prompt,
    createdAt: task.createdAt,
  })).digest('hex');
}

function validateLease(lease: AgentDispatchLease): void {
  requireText(lease.messageId, 'messageId');
  requireText(lease.popReceipt, 'popReceipt');
  validateTask(lease.task);
}

function validateVisibility(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 604_800) throw new TypeError('visibility timeout must be between 1 and 604800 seconds');
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be nonempty`);
  return value.trim();
}
