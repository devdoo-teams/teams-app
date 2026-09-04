export const AGENT_DISPATCH_SCHEMA_VERSION = 2 as const;
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
