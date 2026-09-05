export type CoreOrchestrationMode = 'read-only' | 'workspace-write';
export type CoreOrchestrationProvider = 'codex' | 'copilot';
export type CoreOrchestrationJobStatus =
  | 'queued'
  | 'awaiting_approval'
  | 'input_required'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type CoreAgentToolCategory = 'skill' | 'plugin' | 'mcp' | 'cli' | 'builtin';
export type CoreAgentToolUsage = Readonly<{
  category: CoreAgentToolCategory;
  name: string;
  observedAt: string;
}>;

export type CoreOrchestrationJob = Readonly<{
  id: string;
  idempotencyKey?: string;
  prompt: string;
  provider?: CoreOrchestrationProvider;
  mode: CoreOrchestrationMode;
  status: CoreOrchestrationJobStatus;
  parentJobId?: string;
  threadId?: string;
  result?: string;
  error?: string;
  progress: readonly string[];
  /** Safe, argument-free tool observations. Legacy jobs may omit this field. */
  tools?: readonly CoreAgentToolUsage[];
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}>;

export type CoreSubmitRequest = Readonly<{
  idempotencyKey: string;
  prompt: string;
  provider?: CoreOrchestrationProvider;
  mode: CoreOrchestrationMode;
}>;

export type CoreJobRequest = Readonly<{ jobId: string }>;
export type CoreListRequest = Readonly<{ limit?: number }>;
export type CoreProvideInputRequest = Readonly<{ jobId: string; input: unknown }>;

export type CoreSubmitResult = Readonly<{
  job: CoreOrchestrationJob;
  replayed: boolean;
  requestHash: string;
}>;

export type CoreProvideInputResult =
  | Readonly<{ status: 'accepted'; job: CoreOrchestrationJob }>
  | Readonly<{
      status: 'unsupported';
      job: CoreOrchestrationJob;
      reason:
        | 'agent-service-does-not-support-input'
        | 'provider-input-unsupported'
        | 'job-not-awaiting-input';
    }>;

export type CoreProviderAvailability = 'available' | 'unavailable' | 'unknown';
export type CoreProviderFactSource = 'runtime-probe' | 'runtime-observation';

/** Provider facts are observations, never configuration or fixture declarations. */
export type CoreProviderFact = Readonly<{
  provider: string;
  availability: CoreProviderAvailability;
  capabilities: readonly string[];
  observedAt: string;
  source: CoreProviderFactSource;
}>;

export class CoreOrchestrationProviderUnavailableError extends Error {
  readonly code = 'CORE_ORCHESTRATION_PROVIDER_UNAVAILABLE' as const;

  constructor(
    readonly provider: string,
    readonly availability: CoreProviderAvailability,
  ) {
    super(`Provider ${provider} is ${availability} and cannot accept Core orchestration work.`);
    this.name = 'CoreOrchestrationProviderUnavailableError';
  }
}

export class CoreOrchestrationProviderCapabilityError extends Error {
  readonly code = 'CORE_ORCHESTRATION_PROVIDER_CAPABILITY_UNAVAILABLE' as const;

  constructor(
    readonly provider: string,
    readonly capability: string,
  ) {
    super(`Provider ${provider} has no measured ${capability} capability.`);
    this.name = 'CoreOrchestrationProviderCapabilityError';
  }
}

export class CoreOrchestrationIdempotencyConflictError extends Error {
  readonly code = 'CORE_ORCHESTRATION_IDEMPOTENCY_CONFLICT' as const;

  constructor(readonly idempotencyKey: string) {
    super(`Idempotency key ${idempotencyKey} was already used for a different canonical request.`);
    this.name = 'CoreOrchestrationIdempotencyConflictError';
  }
}

export class CoreOrchestrationValidationError extends Error {
  readonly code = 'CORE_ORCHESTRATION_INVALID_REQUEST' as const;

  constructor(message: string) {
    super(message);
    this.name = 'CoreOrchestrationValidationError';
  }
}
