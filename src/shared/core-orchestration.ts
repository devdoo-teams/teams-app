export const CORE_AGENT_PROMPT_MAX_LENGTH = 2_000;

export type CoreExecutionEnvironment = 'local-macos' | 'local-linux' | 'local-windows' | 'external-worker';
/** Trusted worker observations, independent of immutable submission selections. */
export type CoreExecutionReceipt = Readonly<{
  source: 'worker-observation';
  observedAt: string;
  platform?: 'darwin' | 'linux' | 'win32';
  model?: string;
  reasoningEffort?: CoreCodexReasoningEffort;
}>;
export type CoreOrchestrationMode = 'read-only' | 'workspace-write';
export type CoreOrchestrationProvider = 'codex' | 'copilot';
export type CoreCodexReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
export type CoreCodexModelSelection = Readonly<{
  model: string;
  reasoningEffort: CoreCodexReasoningEffort;
  catalogRevision: string;
}>;
export type CoreCodexModelOption = Readonly<{
  id: string;
  label: string;
  defaultReasoningEffort: CoreCodexReasoningEffort;
  reasoningEfforts: readonly CoreCodexReasoningEffort[];
}>;
export type CoreCodexModelCatalog = Readonly<{
  revision: string;
  observedAt: string;
  source: 'codex-debug-models';
  models: readonly CoreCodexModelOption[];
}>;
export type CoreAgentTokenUsage = Readonly<{
  source: 'codex.exec.jsonl.turn.completed.usage';
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens?: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}>;
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

/** Display identity only. Expiry/consumption belong to existing confirmation grants. */
export type CorePendingOperation = Readonly<{ kind: 'job-approval'; jobId: string; revision: string }>;
export type CoreOrchestrationJob = Readonly<{
  pendingOperation?: CorePendingOperation;
  id: string;
  /** Server-owned execution boundary; legacy jobs have no observed environment. */
  executionEnvironment?: CoreExecutionEnvironment;
  executionReceipt?: CoreExecutionReceipt;
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
  /** Immutable installed-Codex selection. Legacy/default-model jobs omit these fields. */
  model?: string;
  reasoningEffort?: CoreCodexReasoningEffort;
  catalogRevision?: string;
  /** Exact terminal `turn.completed.usage`; account quota is intentionally not inferred. */
  tokenUsage?: CoreAgentTokenUsage;
  createdAt: string;
  /** Server-owned durable timestamp of the last meaningful job mutation. */
  updatedAt?: string;
  notificationDelivery?: { state: 'waiting-personal-chat' | 'pending' | 'sending' | 'accepted' | 'rejected' | 'ambiguous'; observedAt: string; activityId?: string };
  startedAt?: string;
  finishedAt?: string;
}>;

export type CoreSubmitRequest = Readonly<{
  idempotencyKey: string;
  prompt: string;
  provider?: CoreOrchestrationProvider;
  mode: CoreOrchestrationMode;
  model?: string;
  reasoningEffort?: CoreCodexReasoningEffort;
  catalogRevision?: string;
  notify?: boolean;
}>;

export type CoreJobRequest = Readonly<{ jobId: string }>;
export type CoreContinueRequest = Readonly<{ jobId: string; prompt: string }>;
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
export type CoreProviderConfiguredState = 'configured' | 'not-configured' | 'unknown';
export type CoreProviderExecutableState = 'present' | 'absent' | 'unknown';
export type CoreProviderAuthenticationState = 'authenticated' | 'not-authenticated' | 'unknown';
export type CoreProviderEntitlementState = 'allowed' | 'blocked' | 'unknown';
export type CoreProviderProbeState = 'passed' | 'not-run' | 'failed' | 'unknown';
export type CoreProviderReadinessReason =
  | 'verified'
  | 'missing'
  | 'auth-required'
  | 'policy-blocked'
  | 'execution-failed'
  | 'unknown';

/** Measured provider dimensions; configuration is not proof of execution. */
export type CoreProviderReadiness = Readonly<{
  configured: CoreProviderConfiguredState;
  executable: CoreProviderExecutableState;
  authentication: CoreProviderAuthenticationState;
  entitlement: CoreProviderEntitlementState;
  probe: CoreProviderProbeState;
  reason: CoreProviderReadinessReason;
}>;

/** Provider facts are observations, never configuration or fixture declarations. */
export type CoreProviderFact = Readonly<{
  provider: string;
  availability: CoreProviderAvailability;
  capabilities: readonly string[];
  observedAt: string;
  source: CoreProviderFactSource;
  readiness?: CoreProviderReadiness;
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

export const CORE_JOB_STATUS_LABELS: Record<CoreOrchestrationJobStatus, string> = {
  queued: '대기 중', awaiting_approval: '승인 필요', input_required: '입력 필요',
  running: '실행 중', completed: '완료', failed: '실패', cancelled: '취소됨',
};
