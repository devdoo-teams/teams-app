import type { AgentJob, AgentJobMode, AgentJobScope } from './agent-job-store.js';
import { AgentJobStore } from './agent-job-store.js';
import {
  AgentExecutionUnavailableError,
  AgentExecutionPolicy,
  type AgentExecutionWorkspace,
} from './agent-execution-policy.js';
import {
  AgentAdmissionController,
  type AgentAdmissionLease,
  AgentCapacityError,
} from './agent-admission-controller.js';
import { CodexRunner, type CodexRunEvent } from './codex-runner.js';
import type { CliAgentProvider } from './cli-agent-runner.js';
import { redactCliDiagnostics } from './cli-diagnostics.js';
import { GitService, type GitWorkspaceSnapshot } from './git-service.js';
import { diagnoseRemoteAgentResult, formatRemoteTroubleshooting } from './remote-troubleshooting.js';

export type AgentNotificationKind = 'progress' | 'result' | 'error' | 'cancelled';
export type AgentNotificationPhase =
  | 'analysis'
  | 'tools'
  | 'agent-update'
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'cancelled'
  | 'commit';

export type AgentNotification = {
  conversationId: string;
  job: AgentJob;
  kind: AgentNotificationKind;
  phase: AgentNotificationPhase;
  message: string;
};

type Notify = (notification: AgentNotification) => Promise<void>;
type ProgressListener = (message: string) => Promise<void> | void;
type ReconciliationState = {
  jobId: string;
  attempts: number;
  durable: boolean;
  lastFailureCode: string;
};

export type AgentExecutionObservation = Readonly<{
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'quarantined';
  result?: string;
  providerExecutionId?: string;
  error?: string;
}>;

/**
 * Durable execution boundary used by runtimes that submit work to an external
 * worker. Implementations must not execute a CLI in the HTTP server process.
 */
export interface AgentExecutionDispatcher {
  readonly kind: 'azure-queue';
  dispatch(job: AgentJob): Promise<void>;
  observe(job: AgentJob): Promise<AgentExecutionObservation | undefined>;
  cancel(job: AgentJob, reason: string): Promise<void>;
  close?(): Promise<void> | void;
}

export const MAX_AGENT_PROMPT_LENGTH = 2_000;

export class AgentPromptValidationError extends Error {
  readonly code = 'INVALID_AGENT_PROMPT' as const;

  constructor(message = `작업 요청은 ${MAX_AGENT_PROMPT_LENGTH}자 이내로 입력하세요.`) {
    super(message);
    this.name = 'AgentPromptValidationError';
  }
}

export type AgentJobMutation = 'approve' | 'cancel' | 'retry';

export class AgentJobConflictError extends Error {
  readonly code = 'AGENT_JOB_CONFLICT' as const;

  constructor(
    readonly action: AgentJobMutation,
    readonly job: AgentJob,
  ) {
    const label = action === 'approve' ? '승인' : action === 'cancel' ? '취소' : '재시도';
    super(`작업 ${job.id}은 현재 상태(${job.status})에서 ${label}할 수 없습니다. 최신 상태를 확인하세요.`);
    this.name = 'AgentJobConflictError';
  }
}

export class AgentMutationAuthorizationError extends Error {
  readonly code = 'AGENT_MUTATION_FORBIDDEN' as const;

  constructor(message = '이 작업은 허용된 운영자만 실행할 수 있습니다.') {
    super(message);
    this.name = 'AgentMutationAuthorizationError';
  }
}

export class AgentProviderUnavailableError extends Error {
  readonly code = 'AGENT_PROVIDER_UNAVAILABLE' as const;

  constructor(readonly provider: CliAgentProvider) {
    super(`에이전트 provider(${provider})가 이 런타임에 명시적으로 구성되지 않았습니다.`);
    this.name = 'AgentProviderUnavailableError';
  }
}

export class AgentProviderConflictError extends Error {
  readonly code = 'AGENT_PROVIDER_CONFLICT' as const;

  constructor(readonly job: AgentJob, requested: CliAgentProvider) {
    super(`작업 ${job.id}은 provider(${job.provider ?? 'legacy-default'})로 생성되어 provider(${requested})로 조작할 수 없습니다.`);
    this.name = 'AgentProviderConflictError';
  }
}

export class AgentProviderIdentityError extends Error {
  readonly code = 'AGENT_PROVIDER_IDENTITY_MISSING' as const;

  constructor(readonly job: AgentJob) {
    super(`작업 ${job.id}에 생성 당시 provider identity가 없어 안전하게 복구할 수 없습니다.`);
    this.name = 'AgentProviderIdentityError';
  }
}

export function normalizeAgentPrompt(prompt: unknown): string {
  if (typeof prompt !== 'string') {
    throw new AgentPromptValidationError('작업 요청 내용을 입력하세요.');
  }

  const normalized = prompt.trim();
  if (!normalized) throw new AgentPromptValidationError('작업 요청 내용을 입력하세요.');
  if (normalized.length > MAX_AGENT_PROMPT_LENGTH) {
    throw new AgentPromptValidationError();
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    throw new AgentPromptValidationError('작업 요청에 허용되지 않는 제어 문자가 포함되어 있습니다.');
  }
  return normalized;
}

type ProgressState = {
  generation: number;
  notifiedKeys: Set<string>;
  pendingAgentMessage?: string;
  notify: boolean;
  onProgress?: ProgressListener;
};

export class AgentService {
  private readonly executionPolicy: AgentExecutionPolicy;
  private readonly admissionController: AgentAdmissionController;
  private readonly agentLabel: string;
  private readonly defaultProvider: CliAgentProvider;
  private readonly providerRunners: ReadonlyMap<CliAgentProvider, CodexRunner>;

  constructor(
    private readonly store: AgentJobStore,
    runner: CodexRunner | undefined,
    private readonly workspace: string,
    private readonly notify: Notify,
    private readonly gitService: GitService,
    private readonly options: {
      canMutateScope?: (scope: AgentJobScope) => boolean;
      canReadScope?: (scope: AgentJobScope) => boolean;
      admissionController?: AgentAdmissionController;
      executionPolicy?: AgentExecutionPolicy;
      admissionJournalPath?: string;
      agentLabel?: string;
      defaultProvider?: CliAgentProvider;
      providerRunners?: Partial<Record<CliAgentProvider, CodexRunner>>;
      executionDispatcher?: AgentExecutionDispatcher;
    } = {},
  ) {
    this.agentLabel = options.agentLabel?.trim() || 'Codex';
    this.defaultProvider = options.defaultProvider ?? 'codex';
    const providerRunners = new Map<CliAgentProvider, CodexRunner>();
    if (runner && !options.executionDispatcher) providerRunners.set(this.defaultProvider, runner);
    for (const provider of ['codex', 'copilot'] as const) {
      const configuredRunner = options.providerRunners?.[provider];
      if (configuredRunner) providerRunners.set(provider, configuredRunner);
    }
    this.providerRunners = providerRunners;
    this.executionPolicy = options.executionPolicy ?? new AgentExecutionPolicy(workspace, options);
    this.admissionController = options.admissionController ?? new AgentAdmissionController({
      globalLimit: 4,
      perTenantLimit: 2,
      perRequesterLimit: 1,
    }, { journalPath: options.admissionJournalPath });
  }

  private readonly progressStates = new Map<string, ProgressState>();
  private readonly progressGenerations = new Map<string, number>();
  private readonly mutationChains = new Map<string, Promise<void>>();
  private readonly executionWorkspaces = new Map<string, AgentExecutionWorkspace>();
  private readonly admissionLeases = new Map<string, AgentAdmissionLease>();
  private readonly executions = new Set<Promise<void>>();
  private readonly executionByJob = new Map<string, Promise<void>>();
  private readonly reconciliation = new Map<string, ReconciliationState>();
  private pendingSubmissions = 0;
  private readonly submissionDrainWaiters = new Set<() => void>();
  private closing = false;
  // A workspace-write job's changed-path proof is a before/after observation
  // of the shared checkout. Serialize the whole observation and runner
  // lifetime so another job cannot contaminate that proof or the commit step.
  private workspaceWriteChain: Promise<void> = Promise.resolve();

  async initialize(): Promise<void> {
    await this.store.initialize();
    const missingProvider = this.store.listLocalOnly(Number.MAX_SAFE_INTEGER).find((job) => !job.provider);
    if (missingProvider) throw new AgentProviderIdentityError(missingProvider);
    await this.admissionController.initialize();
    if (this.options.executionDispatcher) {
      await this.reconstructAdmissionFromStore();
      for (const job of this.store.listLocalOnly(Number.MAX_SAFE_INTEGER)) {
        const scope = scopeForJob(job);
        if (!scope || job.status === 'awaiting_approval') continue;
        const reconciled = await this.reconcileDurableObservation(job, scope);
        if (reconciled && !isTerminalJob(job) && isTerminalJob(reconciled)) {
          await this.finalizeAdmission(reconciled, scope);
        }
      }
    } else {
      await this.store.recoverInterruptedJobs();
      await this.reconstructAdmissionFromStore();
    }
  }

  private async reconstructAdmissionFromStore(): Promise<void> {
    await this.admissionController.reconstruct(
      this.store.listLocalOnly(Number.MAX_SAFE_INTEGER).flatMap((job) =>
        typeof job.tenantId === 'string' && job.tenantId
          ? [{
              id: job.id,
              status: job.status,
              tenantId: job.tenantId,
              requesterId: job.requesterId,
            }]
          : [],
      ),
    );
  }

  async submit(input: {
    prompt: string;
    provider?: CliAgentProvider;
    mode: AgentJobMode;
    scope: AgentJobScope;
    parentJobId?: string;
    threadId?: string;
    notify?: boolean;
    onProgress?: ProgressListener;
  }): Promise<AgentJob> {
    const prompt = normalizeAgentPrompt(input.prompt);
    const provider = input.provider ?? this.defaultProvider;
    if (!this.options.executionDispatcher) this.runnerFor(provider);
    if (input.mode === 'workspace-write') {
      this.assertMutationAllowed(input.scope);
    } else {
      this.assertReadAllowed(input.scope);
    }
    const admission = await this.admissionController.tryAcquire(input.scope);
    if (!admission.ok) throw new AgentCapacityError(admission);

    this.pendingSubmissions += 1;
    try {
      let executionWorkspace: AgentExecutionWorkspace | undefined;
      let job: AgentJob;
      try {
        if (!this.options.executionDispatcher) {
          executionWorkspace = await this.executionPolicy.prepareWorkspace(input.mode, input.scope, prompt);
        }
        job = await this.store.create({ ...input, prompt, provider });
        await admission.lease.bindJob(job.id);
        this.admissionLeases.set(job.id, admission.lease);
        if (executionWorkspace) this.executionWorkspaces.set(job.id, executionWorkspace);
      } catch (error) {
        let disposed = true;
        try {
          await executionWorkspace?.dispose();
        } catch {
          disposed = false;
        }
        if (disposed) await admission.lease.release();
        else await admission.lease.markUnresolved('SUBMIT_CLEANUP_FAILED');
        throw error;
      }
      if (job.mode === 'read-only') {
        if (this.options.executionDispatcher) {
          await this.dispatchExternally(job, input.scope);
        } else {
          this.launchExecution(job, input.notify !== false, input.onProgress);
        }
      }
      return job;
    } finally {
      this.finishPendingSubmission();
    }
  }

  async continue(
    id: string,
    prompt: string,
    scope: AgentJobScope,
    options: { notify?: boolean; onProgress?: ProgressListener } = {},
  ): Promise<AgentJob | undefined> {
    const normalizedPrompt = normalizeAgentPrompt(prompt);
    const previous = this.store.get(id, scope);
    if (!previous) return undefined;
    if (!previous.threadId) return undefined;
    if (previous.mode === 'workspace-write') this.assertMutationAllowed(scope);

    return this.submit({
      prompt: normalizedPrompt,
      mode: previous.mode,
      scope,
      provider: this.providerForJob(previous),
      parentJobId: previous.id,
      threadId: previous.threadId,
      notify: options.notify,
      onProgress: options.onProgress,
    });
  }

  async runForCopilot(input: {
    prompt: string;
    provider?: CliAgentProvider;
    scope: AgentJobScope;
    onProgress?: ProgressListener;
    notify?: boolean;
    onSubmitted?: (job: AgentJob) => Promise<void> | void;
    timeoutMs?: number;
  }): Promise<AgentJob> {
    const job = await this.submit({
      prompt: input.prompt,
      provider: input.provider,
      mode: 'read-only',
      scope: input.scope,
      notify: input.notify,
      onProgress: input.onProgress,
    });
    await input.onSubmitted?.(job);

    return this.waitForTerminal(job.id, input.scope, input.timeoutMs);
  }

  async waitForTerminal(id: string, scope: AgentJobScope, timeoutMs = 10 * 60 * 1000): Promise<AgentJob> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const job = await this.observe(id, scope);
      if (!job) throw new Error(`작업 ${id}을 찾을 수 없습니다.`);

      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled' || job.status === 'awaiting_approval') {
        return job;
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    try {
      await this.cancel(id, scope, { notify: true });
    } catch (error) {
      if (!(error instanceof AgentJobConflictError)) throw error;
    }
    const job = this.store.get(id, scope);
    if (!job) throw new Error(`작업 ${id}을 찾을 수 없습니다.`);
    return job;
  }

  async approve(id: string, scope: AgentJobScope): Promise<AgentJob | undefined> {
    const existing = this.store.get(id, scope);
    if (existing?.mode === 'workspace-write') this.assertMutationAllowed(scope);
    const queued = await this.withJobMutationLock(id, scope, async () => {
      const job = this.store.get(id, scope);
      if (!job) return undefined;
      if (job.status !== 'awaiting_approval') {
        throw new AgentJobConflictError('approve', snapshotAgentJob(job));
      }

      const refreshed = await this.store.update(id, scope, { status: 'queued', error: undefined });
      if (!refreshed) {
        const latest = this.store.get(id, scope);
        if (latest) throw new AgentJobConflictError('approve', snapshotAgentJob(latest));
        return undefined;
      }
      return refreshed;
    });

    if (queued) {
      if (this.options.executionDispatcher) await this.dispatchExternally(queued, scope);
      else this.launchExecution(queued, true);
    }
    return queued;
  }

  async close(options: { closeAdmission?: boolean } = {}): Promise<void> {
    this.closing = true;
    if (options.closeAdmission !== false) await this.admissionController.close();
    await this.waitForPendingSubmissions();
    const closed = new Set<CodexRunner>();
    for (const runner of this.providerRunners.values()) {
      if (closed.has(runner)) continue;
      closed.add(runner);
      runner.close?.();
    }
    await this.options.executionDispatcher?.close?.();
    await Promise.allSettled([...this.executions]);
    for (const jobId of [...this.executionWorkspaces.keys()]) {
      try {
        await this.releaseExecutionWorkspace(jobId);
        await this.releaseAdmission(jobId);
      } catch {
        await this.admissionController.markUnresolved(jobId, 'SHUTDOWN_CLEANUP_FAILED').catch(() => undefined);
      }
    }
  }

  private finishPendingSubmission(): void {
    this.pendingSubmissions -= 1;
    if (this.pendingSubmissions !== 0) return;
    for (const resolve of this.submissionDrainWaiters) resolve();
    this.submissionDrainWaiters.clear();
  }

  private waitForPendingSubmissions(): Promise<void> {
    if (this.pendingSubmissions === 0) return Promise.resolve();
    return new Promise((resolve) => this.submissionDrainWaiters.add(resolve));
  }

  async cancel(
    id: string,
    scope: AgentJobScope,
    options: { notify?: boolean; strict?: boolean; provider?: CliAgentProvider } = {},
  ): Promise<AgentJob | undefined> {
    const existing = this.store.get(id, scope);
    if (existing?.mode === 'workspace-write') this.assertMutationAllowed(scope);
    let cancelledWasRunning = false;
    const cancelled = await this.withJobMutationLock(id, scope, async () => {
      const job = this.store.get(id, scope);
      if (!job) return undefined;
      if (!['awaiting_approval', 'queued', 'running'].includes(job.status)) {
        if (options.strict) throw new AgentJobConflictError('cancel', snapshotAgentJob(job));
        // CopilotKit calls cancel from an Observable teardown even after a
        // successful run. That cleanup path must be idempotent and must not
        // turn a completed response into an unhandled rejection.
        return undefined;
      }

      const provider = this.providerForJob(job, options.provider);
      this.invalidateProgressState(job.id);
      cancelledWasRunning = job.status === 'running';
      if (this.options.executionDispatcher) {
        await this.options.executionDispatcher.cancel(job, 'cancellation requested by the Teams user');
        const durable = await this.reconcileDurableObservation(job, scope);
        if (durable && isTerminalJob(durable)) return durable;
      } else if (cancelledWasRunning) {
        this.runnerFor(provider).cancel(id);
      }
      const refreshed = await this.store.update(id, scope, {
        status: 'cancelled',
        finishedAt: new Date().toISOString(),
      });
      if (!refreshed) {
        const latest = this.store.get(id, scope);
        if (latest) throw new AgentJobConflictError('cancel', snapshotAgentJob(latest));
        return undefined;
      }
      return refreshed;
    });

    if (cancelledWasRunning) await this.executionByJob.get(id);
    if (cancelled) await this.finalizeAdmission(cancelled, scope);

    if (options.notify && cancelled?.status === 'cancelled') {
      await this.notifyIfEnabled(cancelled, {
        kind: 'cancelled',
        phase: 'cancelled',
        message: `작업 ${id}이 취소되었습니다.`,
      });
    }
    return cancelled;
  }

  async cancelStrict(
    id: string,
    scope: AgentJobScope,
    options: { notify?: boolean; provider?: CliAgentProvider } = {},
  ): Promise<AgentJob | undefined> {
    // `cancel()` is also used by internal timeout/teardown cleanup and keeps
    // its idempotent behavior. The user-facing strict routes and card action
    // must always enforce the same operator boundary as approve/commit.
    this.assertMutationAllowed(scope);
    return this.cancel(id, scope, { ...options, strict: true });
  }

  async reconcileTerminal(id: string, scope: AgentJobScope): Promise<AgentJob | undefined> {
    this.assertMutationAllowed(scope);
    const reconciled = await this.withJobMutationLock(id, scope, async () => {
      const latest = this.store.get(id, scope);
      if (!latest) return undefined;
      if (!this.reconciliation.has(id) && latest.status !== 'running') return latest;
      return this.store.update(id, scope, {
        status: 'failed',
        error: 'AGENT_OPERATOR_RECONCILED: 운영자가 미해결 terminal 상태를 실패로 확정했습니다.',
        finishedAt: new Date().toISOString(),
      });
    });
    if (reconciled) {
      this.reconciliation.delete(id);
      try {
        await this.finalizeAdmission(reconciled, scope);
      } catch {
        // The visible durable error and held capacity are the recovery state.
      }
    }
    return reconciled;
  }

  async retry(
    id: string,
    scope: AgentJobScope,
    options: { notify?: boolean; onProgress?: ProgressListener } = {},
  ): Promise<AgentJob | undefined> {
    const previous = this.store.get(id, scope);
    if (!previous) return undefined;
    if (previous.status !== 'failed') {
      throw new AgentJobConflictError('retry', snapshotAgentJob(previous));
    }
    if (previous.mode === 'workspace-write') this.assertMutationAllowed(scope);

    return this.submit({
      prompt: previous.prompt,
      mode: previous.mode,
      scope,
      provider: this.providerForJob(previous),
      parentJobId: previous.id,
      threadId: previous.threadId,
      notify: options.notify,
      onProgress: options.onProgress,
    });
  }

  get(id: string, scope: AgentJobScope): AgentJob | undefined {
    return this.store.get(id, scope);
  }

  /**
   * Server-owned cross-surface reader. The principal dimensions come from
   * authenticated request state; callers must use the returned job's stored
   * conversation scope for any mutation.
   */
  getForPrincipal(
    id: string,
    principal: Pick<AgentJobScope, 'tenantId' | 'requesterId'>,
  ): AgentJob | undefined {
    return this.store.getForPrincipal(id, principal);
  }

  async observe(id: string, scope: AgentJobScope): Promise<AgentJob | undefined> {
    const job = this.store.get(id, scope);
    const dispatcher = this.options.executionDispatcher;
    if (!job || !dispatcher || job.status === 'awaiting_approval') return job;

    const refreshed = await this.reconcileDurableObservation(job, scope);
    if (refreshed && !isTerminalJob(job) && isTerminalJob(refreshed)) {
      await this.finalizeAdmission(refreshed, scope);
    }
    return refreshed;
  }

  private async reconcileDurableObservation(
    job: AgentJob,
    scope: AgentJobScope,
  ): Promise<AgentJob | undefined> {
    const dispatcher = this.options.executionDispatcher;
    if (!dispatcher) return job;
    const observation = await dispatcher.observe(job);
    if (!observation) return job;
    const status = observation.status === 'quarantined' ? 'failed' : observation.status;
    if (isTerminalJob(job) && !isTerminalStatus(status)) return job;
    const update: Partial<AgentJob> = { status };
    if (status === 'running' && !job.startedAt) update.startedAt = new Date().toISOString();
    if (status === 'completed') {
      update.result = observation.result;
      update.error = undefined;
      update.finishedAt = new Date().toISOString();
    } else if (status === 'failed') {
      update.result = undefined;
      update.error = observation.error ?? (observation.status === 'quarantined'
        ? 'AZURE_DISPATCH_QUARANTINED: durable worker delivery was quarantined.'
        : 'AZURE_DISPATCH_FAILED: durable worker execution failed.');
      update.finishedAt = new Date().toISOString();
    } else if (status === 'cancelled') {
      update.result = undefined;
      update.error = undefined;
      update.finishedAt = new Date().toISOString();
    }
    return this.store.update(job.id, scope, update);
  }

  list(scope: AgentJobScope, limit = 8): AgentJob[] {
    return this.store.list(scope, limit);
  }

  /** Server-owned cross-surface list for one validated tenant/requester. */
  listForPrincipal(
    principal: Pick<AgentJobScope, 'tenantId' | 'requesterId'>,
    limit = 8,
  ): AgentJob[] {
    return this.store.listForPrincipal(principal, limit);
  }

  latestCompletedForConversation(scope: AgentJobScope): AgentJob | undefined {
    return this.store.latestCompletedWithThread(scope);
  }

  countActive(scope: AgentJobScope): number {
    return this.store.countActive(scope);
  }

  async commit(id: string, message: string, scope: AgentJobScope): Promise<AgentJob | undefined> {
    this.assertMutationAllowed(scope);
    // Keep lock ordering identical to execute(): workspace first, then the
    // per-job mutation lock. This prevents a commit waiting on a running job
    // from deadlocking with that job's terminal update.
    return this.withWorkspaceWriteLock(() => this.withJobMutationLock(id, scope, async () => {
      const job = this.store.get(id, scope);
      if (!job) return undefined;
      if (job.status !== 'completed') return job;
      if (job.mode !== 'workspace-write') {
        await this.store.update(id, scope, {
          commitMessage: '읽기 전용 작업은 커밋할 수 없습니다. completed workspace-write 작업만 커밋할 수 있습니다.',
        });
        return this.store.get(id, scope);
      }

      const ownedPaths = recordedChangedPaths(job);
      if (!ownedPaths) {
        await this.store.update(id, scope, {
          commitMessage: '작업의 기록된 변경 경로 소유권을 증명할 수 없어 커밋을 중단했습니다.',
        });
        return this.store.get(id, scope);
      }

      const commit = await this.gitService.commit(message, { ownedPaths });
      if (!commit.committed) {
        await this.store.update(id, scope, { commitMessage: commit.message });
        return this.store.get(id, scope);
      }

      const refreshed = await this.store.update(id, scope, {
        commitHash: commit.hash,
        commitMessage: commit.message,
      });
      if (refreshed) {
        await this.notifyIfEnabled(refreshed, {
          kind: 'result',
          phase: 'commit',
          message: `작업 ${id}: ${commit.message}`,
        });
      }
      return refreshed;
    }));
  }

  /** Local-only MCP/debug reader. Authenticated callers must use scoped methods. */
  getLocalOnly(id: string): AgentJob | undefined {
    return this.store.getLocalOnly(id);
  }

  /** Local-only MCP/debug reader. Authenticated callers must use scoped methods. */
  listLocalOnly(limit = 8): AgentJob[] {
    return this.store.listLocalOnly(limit);
  }

  /** Local-only MCP/debug reader. Authenticated callers must use scoped methods. */
  countActiveLocalOnly(): number {
    return this.store.countActiveLocalOnly();
  }

  private assertMutationAllowed(scope: AgentJobScope): void {
    const allowed = this.options.executionDispatcher
      ? this.options.canMutateScope?.(scope) === true
      : this.executionPolicy.authorize(scope, 'workspace-write').allowed;
    if (!allowed) {
      throw new AgentMutationAuthorizationError(
        '운영자 권한이 필요합니다. 관리자에게 TEAMS_OPERATOR_REQUESTER_ALLOWLIST 설정을 요청하세요.',
      );
    }
  }

  private providerForJob(job: AgentJob, requested?: CliAgentProvider): CliAgentProvider {
    if (!job.provider) throw new AgentProviderIdentityError(job);
    if (requested && job.provider && requested !== job.provider) {
      throw new AgentProviderConflictError(job, requested);
    }
    return job.provider;
  }

  private runnerFor(provider: CliAgentProvider): CodexRunner {
    const runner = this.providerRunners.get(provider);
    if (!runner) throw new AgentProviderUnavailableError(provider);
    return runner;
  }

  private assertReadAllowed(scope: AgentJobScope): void {
    if (this.options.executionDispatcher) {
      if (this.options.canReadScope?.(scope) === true) return;
      throw new AgentMutationAuthorizationError(
        `${this.agentLabel} 읽기 작업은 허용된 운영자만 실행할 수 있습니다.`,
      );
    }
    const decision = this.executionPolicy.authorize(scope, 'read-only');
    if (!decision.allowed && decision.reason === 'isolation-unavailable') {
      throw new AgentExecutionUnavailableError();
    }
    if (!decision.allowed) {
      throw new AgentMutationAuthorizationError(
        `${this.agentLabel} 읽기 작업은 허용된 운영자만 실행할 수 있습니다.`,
      );
    }
  }

  private async execute(job: AgentJob, shouldNotify: boolean, onProgress?: ProgressListener): Promise<void> {
    if (job.mode === 'workspace-write') {
      await this.withWorkspaceWriteLock(() => this.executeUnlocked(job, shouldNotify, onProgress));
      return;
    }
    await this.executeUnlocked(job, shouldNotify, onProgress);
  }

  private launchExecution(job: AgentJob, shouldNotify: boolean, onProgress?: ProgressListener): void {
    const execution = this.execute(job, shouldNotify, onProgress).catch((error) => {
      console.error(`Agent execution cleanup failed for ${job.id}`, error);
    });
    this.executions.add(execution);
    this.executionByJob.set(job.id, execution);
    void execution.then(() => {
      this.executions.delete(execution);
      if (this.executionByJob.get(job.id) === execution) this.executionByJob.delete(job.id);
    });
  }

  private async executeUnlocked(job: AgentJob, shouldNotify: boolean, onProgress?: ProgressListener): Promise<void> {
    const scope = scopeForJob(job);
    if (!scope) return;

    let runningJob: AgentJob | undefined;
    let runPromise: ReturnType<CodexRunner['run']> | undefined;
    let workspaceSnapshot: GitWorkspaceSnapshot | undefined;
    let progressState: ProgressState | undefined;

    try {
      runningJob = await this.withJobMutationLock(job.id, scope, async () => {
        const current = this.store.get(job.id, scope);
        if (!current || current.status !== 'queued') return undefined;

        const started = await this.store.update(job.id, scope, {
          status: 'running',
          startedAt: new Date().toISOString(),
        });
        if (!started) return undefined;

        progressState = this.createProgressState(job.id, shouldNotify, onProgress);
        await this.store.appendProgress(job.id, scope, `${this.agentLabel} 작업을 시작했습니다.`);
        if (started.mode === 'workspace-write') {
          workspaceSnapshot = await this.gitService.captureWorkspaceSnapshot();
        }
        const executionWorkspace = this.executionWorkspaces.get(started.id);
        if (started.mode === 'read-only' && (!executionWorkspace || !executionWorkspace.projected)) {
          throw new Error(`${this.agentLabel} 읽기 전용 작업공간 투영을 확인할 수 없습니다.`);
        }
        if (this.closing) {
          throw new Error(`${this.agentLabel} 서버가 종료 중이어서 작업 실행을 시작하지 않았습니다.`);
        }

        // Start the runner while the mutation lock is held. CodexRunner registers
        // the child process synchronously, so a concurrent cancel can reliably
        // signal it after this lock is released.
        const runner = this.runnerFor(this.providerForJob(started));
        runPromise = runner.run({
          jobId: started.id,
          prompt: started.prompt,
          workspace: executionWorkspace?.workspace ?? this.workspace,
          mode: started.mode,
          threadId: started.threadId,
          isolationLease: executionWorkspace?.isolationLease,
          subject: {
            tenantId: scope.tenantId,
            requesterId: scope.requesterId,
            conversationId: scope.conversationId,
            jobId: started.id,
          },
          environmentOverrides: executionWorkspace?.environmentOverrides,
          onEvent: (event) => this.handleEvent(started, progressState!.generation, event),
        });
        // A cancellation can reject the runner before this execute loop reaches
        // the await below (for example while the initial Teams notification is
        // still being persisted). Observe that rejection immediately so Node's
        // strict unhandled-rejection policy cannot tear down the Bot server.
        void runPromise.catch(() => undefined);
        return started;
      });

      if (!runningJob || !runPromise) {
        this.clearProgressState(job.id, progressState?.generation);
        return;
      }

      await this.notifyIfEnabled(runningJob, {
        kind: 'progress',
        phase: 'analysis',
        message: `작업 ${runningJob.id}이 실행을 시작했습니다.`,
      }, progressState);

      const result = await runPromise;
      const changedPaths = runningJob.mode === 'workspace-write' && workspaceSnapshot
        ? await this.gitService.changedPathsSince(workspaceSnapshot)
        : undefined;

      const diagnostic = diagnoseRemoteAgentResult(result.finalMessage);
      const diagnosticMessage = formatRemoteTroubleshooting(diagnostic);
      let terminal: AgentJob | undefined;
      try {
        terminal = await this.withJobMutationLock(job.id, scope, async () => {
          const latest = this.store.get(job.id, scope);
          if (!latest || latest.status !== 'running') {
            this.invalidateProgressState(job.id, progressState?.generation);
            return undefined;
          }
          this.invalidateProgressState(job.id, progressState?.generation);
          return diagnosticMessage
            ? this.store.update(job.id, scope, {
              status: 'failed',
              error: diagnosticMessage,
              ...(changedPaths ? { changedPaths } : {}),
              finishedAt: new Date().toISOString(),
            })
            : this.store.update(job.id, scope, {
              status: 'completed',
              threadId: result.threadId,
              result: result.finalMessage,
              ...(result.tokenUsage ? { tokenUsage: result.tokenUsage } : {}),
              ...(changedPaths ? { changedPaths } : {}),
              finishedAt: new Date().toISOString(),
            });
        });
      } catch (error) {
        await this.markReconciliationRequired(job, scope, error);
        return;
      }
      if (!terminal) return;
      try {
        await this.finalizeAdmission(terminal, scope);
      } catch (cleanupError) {
        await this.markReconciliationRequired(job, scope, cleanupError);
        return;
      }

      if (diagnosticMessage) {
        await this.store.appendProgress(job.id, scope, `${this.agentLabel} 작업이 차단되었습니다: ${diagnostic.code}`);
        await this.notifyIfEnabled(terminal, {
          kind: 'error',
          phase: 'blocked',
          message: `작업 ${job.id}이 차단되었습니다.\n\n${diagnosticMessage}`,
        }, undefined, shouldNotify);
        return;
      }

      await this.store.appendProgress(job.id, scope, `${this.agentLabel} 작업 완료 (${result.eventCount}개 이벤트).`);
      await this.notifyIfEnabled(terminal, {
        kind: 'result',
        phase: 'completed',
        message: this.formatCompletion(job.id, result.finalMessage),
      }, undefined, shouldNotify);
    } catch (error: any) {
      const rawMessage = error?.message || `알 수 없는 ${this.agentLabel} 실행 오류`;
      const message = redactCliDiagnostics(rawMessage, {
        paths: [this.workspace, process.env.HOME, process.env.USERPROFILE],
        maxChars: 4_000,
      }) || `알 수 없는 ${this.agentLabel} 실행 오류`;
      let changedPaths: string[] | undefined;
      if (workspaceSnapshot) {
        try {
          changedPaths = await this.gitService.changedPathsSince(workspaceSnapshot);
        } catch {
          // Preserve the primary runner or Git snapshot error.
        }
      }
      let failed: AgentJob | undefined;
      try {
        failed = await this.withJobMutationLock(job.id, scope, async () => {
          const latest = this.store.get(job.id, scope);
          if (!latest || latest.status !== 'running') {
            this.invalidateProgressState(job.id, progressState?.generation);
            return undefined;
          }
          this.invalidateProgressState(job.id, progressState?.generation);
          return this.store.update(job.id, scope, {
            status: 'failed',
            error: message,
            ...(changedPaths ? { changedPaths } : {}),
            finishedAt: new Date().toISOString(),
          });
        });
      } catch (persistenceError) {
        await this.markReconciliationRequired(job, scope, persistenceError);
        return;
      }
      if (!failed) return;
      try {
        await this.finalizeAdmission(failed, scope);
      } catch (cleanupError) {
        await this.markReconciliationRequired(job, scope, cleanupError);
        return;
      }

      await this.store.appendProgress(job.id, scope, `${this.agentLabel} 작업이 실패했습니다.`);
      await this.notifyIfEnabled(failed, {
        kind: 'error',
        phase: 'failed',
        message: `작업 ${job.id}이 실패했습니다.\n\n${message}`,
      }, undefined, shouldNotify);
    } finally {
      this.clearProgressState(job.id, progressState?.generation);
    }
  }

  private async releaseExecutionWorkspace(id: string): Promise<void> {
    const executionWorkspace = this.executionWorkspaces.get(id);
    if (!executionWorkspace) return;
    await executionWorkspace.dispose();
    if (this.executionWorkspaces.get(id) === executionWorkspace) this.executionWorkspaces.delete(id);
  }

  private async releaseAdmission(id: string): Promise<void> {
    const lease = this.admissionLeases.get(id);
    if (lease) {
      await lease.release();
      if (this.admissionLeases.get(id) === lease) this.admissionLeases.delete(id);
      return;
    }
    await this.admissionController.releaseJob(id);
  }

  private async finalizeAdmission(job: AgentJob, scope: AgentJobScope): Promise<void> {
    try {
      const lease = this.admissionLeases.get(job.id);
      if (lease) await lease.markTerminalPending();
      else await this.admissionController.markTerminalPending(job.id);
      await this.releaseExecutionWorkspace(job.id);
      await this.releaseAdmission(job.id);
    } catch (error) {
      const failureCode = error instanceof Error && error.name ? error.name : 'CLEANUP_FAILED';
      const lease = this.admissionLeases.get(job.id);
      if (lease) await lease.markUnresolved(failureCode).catch(() => undefined);
      else await this.admissionController.markUnresolved(job.id, failureCode).catch(() => undefined);
      await this.store.update(job.id, scope, {
        error: 'AGENT_RECONCILIATION_REQUIRED: 작업 종료 후 정리와 admission release가 완료되지 않았습니다. 운영자 복구가 필요합니다.',
      }).catch(() => undefined);
      throw error;
    }
  }

  private async markReconciliationRequired(job: AgentJob, scope: AgentJobScope, failure: unknown): Promise<void> {
    const state: ReconciliationState = {
      jobId: job.id,
      attempts: 0,
      durable: false,
      lastFailureCode: failure instanceof Error && failure.name ? failure.name : 'PERSISTENCE_FAILURE',
    };
    this.reconciliation.set(job.id, state);
    const lease = this.admissionLeases.get(job.id);
    if (lease) await lease.markUnresolved(state.lastFailureCode).catch(() => undefined);
    else await this.admissionController.markUnresolved(job.id, state.lastFailureCode).catch(() => undefined);
    const visibleError = 'AGENT_RECONCILIATION_REQUIRED: terminal 상태 저장에 실패했습니다. 운영자 reconcile이 필요합니다.';
    for (let attempt = 0; attempt < 3 && !state.durable; attempt += 1) {
      state.attempts += 1;
      try {
        const persisted = await this.store.update(job.id, scope, { error: visibleError });
        state.durable = Boolean(persisted);
      } catch {
        // Bounded retry only. The lease remains held for operator recovery.
      }
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.store.appendProgress(job.id, scope, 'AGENT_RECONCILIATION_REQUIRED: 운영자 복구가 필요합니다.');
        break;
      } catch {
        // Keep the durable error as the primary visible reconciliation marker.
      }
    }
  }

  private async handleEvent(job: AgentJob, generation: number, event: CodexRunEvent): Promise<void> {
    const state = this.progressStates.get(job.id);
    if (!state || state.generation !== generation || !this.isCurrentRunningProgress(job, state)) return;

    if (event.type === 'thread.started' && event.thread_id) {
      const scope = scopeForJob(job);
      if (scope) {
        await this.withJobMutationLock(job.id, scope, async () => {
          if (!this.isCurrentRunningProgress(job, state)) return;
          await this.store.update(job.id, scope, { threadId: event.thread_id });
        });
      }
      return;
    }

    if (event.type === 'turn.started') {
      await this.publishProgress(job, state, 'analysis', 'analysis', `${this.agentLabel}가 작업을 분석하고 있습니다.`, `${this.agentLabel} 분석을 시작했습니다.`);
      return;
    }

    if (event.type === 'item.started' && event.item?.type === 'command_execution') {
      await this.flushPendingAgentMessage(job, state);
      await this.publishProgress(job, state, 'tools', 'tools', `${this.agentLabel}가 필요한 도구를 실행하고 있습니다.`, `${this.agentLabel}가 필요한 도구를 실행하고 있습니다.`);
      return;
    }

    if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
      const message = event.item.text?.trim();
      if (message && message !== state.pendingAgentMessage) {
        if (state.pendingAgentMessage) await this.publishAgentUpdate(job, state, state.pendingAgentMessage);
        if (!this.isCurrentRunningProgress(job, state)) return;
        state.pendingAgentMessage = message;
      }
    }
  }

  private async flushPendingAgentMessage(job: AgentJob, state: ProgressState): Promise<void> {
    if (!state.pendingAgentMessage) return;
    await this.publishAgentUpdate(job, state, state.pendingAgentMessage);
    if (!this.isCurrentRunningProgress(job, state)) return;
    state.pendingAgentMessage = undefined;
  }

  private async publishAgentUpdate(job: AgentJob, state: ProgressState, message: string): Promise<void> {
    const compact = message.length > 1200 ? `${message.slice(0, 1200)}\n\n(중간 업데이트가 일부 생략되었습니다.)` : message;
    if (!this.isCurrentRunningProgress(job, state)) return;
    const key = `agent:${compact}`;
    if (state.notifiedKeys.has(key)) return;
    state.notifiedKeys.add(key);
    const scope = scopeForJob(job);
    if (!scope) return;
    if (!this.isCurrentRunningProgress(job, state)) return;
    await this.store.appendProgress(job.id, scope, `${this.agentLabel} 업데이트: ${compact}`);
    if (!this.isCurrentRunningProgress(job, state)) return;
    await state.onProgress?.(`${this.agentLabel} 업데이트: ${compact}`);
    if (!this.isCurrentRunningProgress(job, state)) return;
    await this.notifyIfEnabled(job, {
      kind: 'progress',
      phase: 'agent-update',
      message: `작업 ${job.id}: ${this.agentLabel} 업데이트\n\n${compact}`,
    }, state);
  }

  private async publishProgress(
    job: AgentJob,
    state: ProgressState,
    key: string,
    phase: Extract<AgentNotificationPhase, 'analysis' | 'tools'>,
    storedMessage: string,
    notification: string,
  ): Promise<void> {
    if (!this.isCurrentRunningProgress(job, state)) return;
    if (state.notifiedKeys.has(key)) return;
    state.notifiedKeys.add(key);
    const scope = scopeForJob(job);
    if (!scope) return;
    if (!this.isCurrentRunningProgress(job, state)) return;
    await this.store.appendProgress(job.id, scope, storedMessage);
    if (!this.isCurrentRunningProgress(job, state)) return;
    await state.onProgress?.(storedMessage);
    if (!this.isCurrentRunningProgress(job, state)) return;
    await this.notifyIfEnabled(job, {
      kind: 'progress',
      phase,
      message: `작업 ${job.id}: ${notification}`,
    }, state);
  }

  private async notifyIfEnabled(
    job: AgentJob,
    event: Omit<AgentNotification, 'conversationId' | 'job'>,
    progressState?: ProgressState,
    notificationIntent?: boolean,
  ): Promise<void> {
    const state = this.progressStates.get(job.id);
    if ((notificationIntent ?? progressState?.notify ?? state?.notify ?? true) === false) return;

    const scope = scopeForJob(job);
    if (!scope) return;
    if (!progressState) {
      const current = this.store.get(job.id, scope) ?? job;
      await this.notify({
        ...event,
        conversationId: current.conversationId,
        job: current,
      });
      return;
    }

    await this.withJobMutationLock(job.id, scope, async () => {
      if (!this.isCurrentRunningProgress(job, progressState)) return;
      const current = this.store.get(job.id, scope);
      if (!current) return;
      await this.notify({
        ...event,
        conversationId: current.conversationId,
        job: current,
      });
    });
  }

  private createProgressState(id: string, notify: boolean, onProgress?: ProgressListener): ProgressState {
    const generation = (this.progressGenerations.get(id) ?? 0) + 1;
    this.progressGenerations.set(id, generation);
    const state: ProgressState = { generation, notifiedKeys: new Set(), notify, onProgress };
    this.progressStates.set(id, state);
    return state;
  }

  private invalidateProgressState(id: string, generation?: number): void {
    const current = this.progressStates.get(id);
    if (!current || generation === undefined || current.generation === generation) {
      this.progressStates.delete(id);
    }
  }

  private clearProgressState(id: string, generation?: number): void {
    const current = this.progressStates.get(id);
    if (current && (generation === undefined || current.generation === generation)) {
      this.progressStates.delete(id);
    }
  }

  private isCurrentRunningProgress(job: AgentJob, state: ProgressState): boolean {
    const currentState = this.progressStates.get(job.id);
    if (!currentState || currentState.generation !== state.generation) return false;
    const scope = scopeForJob(job);
    return Boolean(scope && this.store.get(job.id, scope)?.status === 'running');
  }

  private async withJobMutationLock<T>(
    id: string,
    scope: AgentJobScope,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = JSON.stringify([scope.requesterId, scope.conversationId, scope.tenantId, id]);
    const previous = this.mutationChains.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.mutationChains.set(key, queued);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.mutationChains.get(key) === queued) this.mutationChains.delete(key);
    }
  }

  private async withWorkspaceWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.workspaceWriteChain;
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.workspaceWriteChain = queued;

    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private formatCompletion(id: string, result: string): string {
    const maxLength = 7000;
    const compact = result.length > maxLength ? `${result.slice(0, maxLength)}\n\n(결과가 길어 일부만 표시되었습니다.)` : result;
    return `작업 ${id}이 완료되었습니다.\n\n${compact}`;
  }

  private async dispatchExternally(job: AgentJob, scope: AgentJobScope): Promise<void> {
    try {
      await this.options.executionDispatcher!.dispatch(job);
    } catch (error) {
      const message = redactCliDiagnostics(error instanceof Error ? error.message : String(error), {
        paths: [this.workspace, process.env.HOME, process.env.USERPROFILE],
        maxChars: 4_000,
      }) || 'Azure Queue dispatch failed.';
      const failed = await this.store.update(job.id, scope, {
        status: 'failed',
        error: `AZURE_DISPATCH_FAILED: ${message}`,
        finishedAt: new Date().toISOString(),
      });
      if (failed) await this.finalizeAdmission(failed, scope);
      throw error;
    }
  }
}

function isTerminalJob(job: AgentJob): boolean {
  return job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
}

function isTerminalStatus(status: AgentJob['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function recordedChangedPaths(job: AgentJob): string[] | undefined {
  const value = job.changedPaths;
  if (!Array.isArray(value)) return undefined;
  const paths = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return paths.length > 0 ? paths : undefined;
}

function scopeForJob(job: AgentJob): AgentJobScope | undefined {
  if (typeof job.tenantId !== 'string' || !job.tenantId) return undefined;
  return {
    requesterId: job.requesterId,
    conversationId: job.conversationId,
    tenantId: job.tenantId,
  };
}

function snapshotAgentJob(job: AgentJob): AgentJob {
  return {
    ...job,
    progress: [...job.progress],
    ...(job.changedPaths ? { changedPaths: [...job.changedPaths] } : {}),
  };
}
