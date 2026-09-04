import crypto from 'node:crypto';

export const AGENT_DISPATCH_SCHEMA_VERSION = 2 as const;
export const LEGACY_AGENT_DISPATCH_SCHEMA_VERSION = 1 as const;
export const AGENT_DISPATCH_WORKSPACE_REFERENCE = 'teams-core-worker-workspace' as const;
export const AGENT_DISPATCH_LINUX_READ_ONLY_ISOLATION_REFERENCE = 'linux-read-only-required' as const;

export type AgentDispatchExecution = Readonly<
  | {
      mode: 'workspace-write';
      workspaceReference: typeof AGENT_DISPATCH_WORKSPACE_REFERENCE;
    }
  | {
      mode: 'read-only';
      workspaceReference: typeof AGENT_DISPATCH_WORKSPACE_REFERENCE;
      isolationReference: typeof AGENT_DISPATCH_LINUX_READ_ONLY_ISOLATION_REFERENCE;
    }
>;

export type AgentDispatchStatus =
  | 'queued'
  | 'leased'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'quarantined';

export type AgentDispatchTask = Readonly<{
  schemaVersion: typeof AGENT_DISPATCH_SCHEMA_VERSION;
  taskId: string;
  idempotencyKey: string;
  tenantId: string;
  requesterId: string;
  conversationId: string;
  provider: string;
  prompt: string;
  createdAt: string;
  execution: AgentDispatchExecution;
}>;

export type AgentDispatchTaskReference = Readonly<
  Pick<AgentDispatchTask, 'taskId' | 'tenantId' | 'requesterId' | 'conversationId'>
>;

export type AgentDispatchCheckpoint = Readonly<{
  sequence: number;
  message: string;
  recordedAt?: string;
}>;

export type AgentDispatchCompletionReceipt = Readonly<{
  result: string;
  providerExecutionId: string;
  completedAt?: string;
}>;

export type AgentDispatchErrorReceipt = Readonly<{
  code: string;
  message: string;
  failedAt?: string;
}>;

/** The accepted v1 wire shape. It intentionally has no caller-selected execution mode. */
export type LegacyAgentDispatchTask = Readonly<{
  schemaVersion: typeof LEGACY_AGENT_DISPATCH_SCHEMA_VERSION;
  taskId: string;
  idempotencyKey: string;
  tenantId: string;
  requesterId: string;
  conversationId: string;
  provider: string;
  prompt: string;
  createdAt: string;
}>;

/**
 * A v1 record read from the explicitly configured legacy/global partition.
 * The old record remains untouched; migration creates a v2 record beside it.
 */
export type LegacyAgentDispatchRecord = Readonly<{
  taskId: string;
  idempotencyKey: string;
  requestHash: string;
  status: AgentDispatchStatus;
  task: LegacyAgentDispatchTask;
  enqueued: boolean;
  dequeueCount: number;
  updatedAt: string;
  leaseOwner?: string;
  leaseGeneration?: number;
  leaseMessageId?: string;
  leaseExpiresAt?: string;
  cancellationRequested?: boolean;
  cancellationReason?: string;
  checkpoint?: AgentDispatchCheckpoint;
  receipt?: AgentDispatchCompletionReceipt;
  error?: AgentDispatchErrorReceipt;
  quarantineReason?: string;
}>;

/**
 * Server-owned v1 migration capability. Implementations must derive execution
 * from immutable server state, never from the legacy message payload.
 */
export type ServerOwnedLegacyDispatchMigration = Readonly<{
  resolveExecution(
    task: LegacyAgentDispatchTask,
    requestHash: string,
  ): AgentDispatchExecution | undefined | Promise<AgentDispatchExecution | undefined>;
}>;

export type AgentDispatchRecord = {
  taskId: string;
  idempotencyKey: string;
  requestHash: string;
  status: AgentDispatchStatus;
  task: AgentDispatchTask;
  enqueued: boolean;
  dequeueCount: number;
  updatedAt: string;
  cancellationRequested?: boolean;
  cancellationReason?: string;
  checkpoint?: AgentDispatchCheckpoint;
  receipt?: AgentDispatchCompletionReceipt;
  error?: AgentDispatchErrorReceipt;
  quarantineReason?: string;
  leaseOwner?: string;
  leaseGeneration?: number;
  leaseMessageId?: string;
};

const LEGACY_TASK_KEYS = Object.freeze([
  'schemaVersion',
  'taskId',
  'idempotencyKey',
  'tenantId',
  'requesterId',
  'conversationId',
  'provider',
  'prompt',
  'createdAt',
]);

/** Canonicalizes the only execution capabilities accepted by the worker plane. */
export function canonicalAgentDispatchExecution(value: unknown): AgentDispatchExecution {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('dispatch execution must be an object');
  }
  const execution = value as Record<string, unknown>;
  if (execution.workspaceReference !== AGENT_DISPATCH_WORKSPACE_REFERENCE) {
    throw new TypeError('dispatch workspace reference is invalid');
  }
  if (execution.mode === 'workspace-write') {
    if (execution.isolationReference !== undefined) {
      throw new TypeError('workspace-write dispatch must not carry a read-only isolation reference');
    }
    return Object.freeze({
      mode: 'workspace-write',
      workspaceReference: AGENT_DISPATCH_WORKSPACE_REFERENCE,
    });
  }
  if (
    execution.mode === 'read-only'
    && execution.isolationReference === AGENT_DISPATCH_LINUX_READ_ONLY_ISOLATION_REFERENCE
  ) {
    return Object.freeze({
      mode: 'read-only',
      workspaceReference: AGENT_DISPATCH_WORKSPACE_REFERENCE,
      isolationReference: AGENT_DISPATCH_LINUX_READ_ONLY_ISOLATION_REFERENCE,
    });
  }
  throw new TypeError('dispatch execution mode or isolation reference is invalid');
}

function canonicalLegacyAgentDispatchTask(value: unknown): LegacyAgentDispatchTask {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('legacy dispatch task must be an object');
  }
  const task = value as Record<string, unknown>;
  if (task.schemaVersion !== LEGACY_AGENT_DISPATCH_SCHEMA_VERSION) {
    throw new TypeError('unknown legacy dispatch schema version');
  }
  if (JSON.stringify(Object.keys(task).sort()) !== JSON.stringify([...LEGACY_TASK_KEYS].sort())) {
    throw new TypeError('legacy dispatch task contains unsupported fields');
  }
  const taskId = requireLegacyText(task.taskId, 'taskId');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(taskId)) {
    throw new TypeError('legacy taskId must be a canonical bounded identifier');
  }
  const normalized = {
    schemaVersion: LEGACY_AGENT_DISPATCH_SCHEMA_VERSION,
    taskId,
    idempotencyKey: requireLegacyText(task.idempotencyKey, 'idempotencyKey'),
    tenantId: requireLegacyText(task.tenantId, 'tenantId'),
    requesterId: requireLegacyText(task.requesterId, 'requesterId'),
    conversationId: requireLegacyText(task.conversationId, 'conversationId'),
    provider: requireLegacyText(task.provider, 'provider'),
    prompt: requireLegacyText(task.prompt, 'prompt'),
    createdAt: requireLegacyText(task.createdAt, 'createdAt'),
  } satisfies LegacyAgentDispatchTask;
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > 48 * 1024) {
    throw new TypeError('legacy dispatch task exceeds the bounded Queue Storage payload');
  }
  return Object.freeze(normalized);
}

export function hashLegacyAgentDispatchTask(task: LegacyAgentDispatchTask): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalLegacyAgentDispatchTask(task)), 'utf8')
    .digest('hex');
}

export function createServerOwnedLegacyDispatchMigration(
  entries: ReadonlyArray<Readonly<{
    task: LegacyAgentDispatchTask;
    execution: AgentDispatchExecution;
  }>>,
): ServerOwnedLegacyDispatchMigration {
  if (!Array.isArray(entries)) throw new TypeError('legacy migration entries must be an array');
  const byRequest = new Map<string, AgentDispatchExecution>();
  for (const entry of entries) {
    const task = canonicalLegacyAgentDispatchTask(entry?.task);
    const execution = canonicalAgentDispatchExecution(entry?.execution);
    const requestHash = hashLegacyAgentDispatchTask(task);
    const key = `${task.taskId}\u0000${requestHash}`;
    if (byRequest.has(key)) throw new TypeError(`duplicate legacy migration entry for ${task.taskId}`);
    byRequest.set(key, execution);
  }
  return Object.freeze({
    resolveExecution(task: LegacyAgentDispatchTask, requestHash: string): AgentDispatchExecution | undefined {
      const normalized = canonicalLegacyAgentDispatchTask(task);
      if (requestHash !== hashLegacyAgentDispatchTask(normalized)) return undefined;
      return byRequest.get(`${normalized.taskId}\u0000${requestHash}`);
    },
  });
}

function requireLegacyText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new TypeError(`legacy ${label} must be nonempty canonical text`);
  }
  return value;
}

export type AgentDispatchLease = Readonly<{
  task: AgentDispatchTask;
  messageId: string;
  popReceipt: string;
  dequeueCount: number;
  leaseOwner: string;
  leaseGeneration: number;
}>;

export interface AgentDispatchQueue {
  enqueue(task: AgentDispatchTask): Promise<AgentDispatchRecord>;
  observe(reference: AgentDispatchTaskReference): Promise<AgentDispatchRecord | undefined>;
  lease(options: { visibilityTimeoutSeconds: number; maxDequeueCount?: number }): Promise<AgentDispatchLease | undefined>;
  heartbeat(lease: AgentDispatchLease, checkpoint: AgentDispatchCheckpoint, visibilityTimeoutSeconds: number): Promise<AgentDispatchLease>;
  complete(lease: AgentDispatchLease, receipt: AgentDispatchCompletionReceipt): Promise<void>;
  fail(lease: AgentDispatchLease, error: AgentDispatchErrorReceipt): Promise<void>;
  cancel(lease: AgentDispatchLease, reason: string): Promise<void>;
  requestCancellation(reference: AgentDispatchTaskReference, reason: string): Promise<void>;
}

/** The Container App surface: it cannot lease work or execute child processes. */
export type AgentDispatchSubmissionPort = Pick<AgentDispatchQueue, 'enqueue' | 'observe' | 'requestCancellation'>;

export function createAgentDispatchTaskFromJob(job: Readonly<{
  id: string;
  tenantId?: string;
  requesterId: string;
  conversationId: string;
  provider?: string;
  prompt: string;
  createdAt: string;
  mode: 'read-only' | 'workspace-write';
}>): AgentDispatchTask {
  if (!job.tenantId) throw new Error('A server-derived tenant is required for durable dispatch.');
  return Object.freeze({
    schemaVersion: AGENT_DISPATCH_SCHEMA_VERSION,
    taskId: job.id,
    idempotencyKey: `agent-job:${job.id}`,
    tenantId: job.tenantId,
    requesterId: job.requesterId,
    conversationId: job.conversationId,
    provider: job.provider ?? 'codex',
    prompt: job.prompt,
    createdAt: job.createdAt,
    execution: job.mode === 'read-only'
      ? Object.freeze({
          mode: 'read-only',
          workspaceReference: AGENT_DISPATCH_WORKSPACE_REFERENCE,
          isolationReference: AGENT_DISPATCH_LINUX_READ_ONLY_ISOLATION_REFERENCE,
        })
      : Object.freeze({
          mode: 'workspace-write',
          workspaceReference: AGENT_DISPATCH_WORKSPACE_REFERENCE,
        }),
  });
}

export function createAgentDispatchTaskReferenceFromJob(job: Readonly<{
  id: string;
  tenantId?: string;
  requesterId: string;
  conversationId: string;
}>): AgentDispatchTaskReference {
  if (!job.tenantId) throw new Error('A server-derived tenant is required for durable dispatch.');
  return Object.freeze({
    taskId: job.id,
    tenantId: job.tenantId,
    requesterId: job.requesterId,
    conversationId: job.conversationId,
  });
}

export function createAgentDispatchSubmissionPort(queue: AgentDispatchQueue): AgentDispatchSubmissionPort {
  return Object.freeze({
    enqueue: queue.enqueue.bind(queue),
    observe: queue.observe.bind(queue),
    requestCancellation: queue.requestCancellation.bind(queue),
  });
}

export function isTerminalDispatchStatus(status: AgentDispatchStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'quarantined';
}
