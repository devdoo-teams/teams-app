export const AGENT_DISPATCH_SCHEMA_VERSION = 1 as const;

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
}>;

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
  observe(taskId: string): Promise<AgentDispatchRecord | undefined>;
  lease(options: { visibilityTimeoutSeconds: number; maxDequeueCount?: number }): Promise<AgentDispatchLease | undefined>;
  heartbeat(lease: AgentDispatchLease, checkpoint: AgentDispatchCheckpoint, visibilityTimeoutSeconds: number): Promise<AgentDispatchLease>;
  complete(lease: AgentDispatchLease, receipt: AgentDispatchCompletionReceipt): Promise<void>;
  fail(lease: AgentDispatchLease, error: AgentDispatchErrorReceipt): Promise<void>;
  cancel(lease: AgentDispatchLease, reason: string): Promise<void>;
  requestCancellation(taskId: string, reason: string): Promise<void>;
}

/** The Container App surface: it cannot lease work or execute child processes. */
export type AgentDispatchSubmissionPort = Pick<AgentDispatchQueue, 'enqueue' | 'observe' | 'requestCancellation'>;

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
