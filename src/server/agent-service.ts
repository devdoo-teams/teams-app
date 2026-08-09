import type { AgentJob, AgentJobMode, AgentJobScope } from './agent-job-store.js';
import { AgentJobStore } from './agent-job-store.js';
import { CodexRunner, type CodexRunEvent } from './codex-runner.js';
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

export const MAX_AGENT_PROMPT_LENGTH = 2_000;

export class AgentPromptValidationError extends Error {
  readonly code = 'INVALID_AGENT_PROMPT' as const;

  constructor(message = `작업 요청은 ${MAX_AGENT_PROMPT_LENGTH}자 이내로 입력하세요.`) {
    super(message);
    this.name = 'AgentPromptValidationError';
  }
}

export type AgentJobMutation = 'approve' | 'cancel';

export class AgentJobConflictError extends Error {
  readonly code = 'AGENT_JOB_CONFLICT' as const;

  constructor(
    readonly action: AgentJobMutation,
    readonly job: AgentJob,
  ) {
    const label = action === 'approve' ? '승인' : '취소';
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
  constructor(
    private readonly store: AgentJobStore,
    private readonly runner: CodexRunner,
    private readonly workspace: string,
    private readonly notify: Notify,
    private readonly gitService: GitService,
    private readonly options: {
      canMutateScope?: (scope: AgentJobScope) => boolean;
    } = {},
  ) {}

  private readonly progressStates = new Map<string, ProgressState>();
  private readonly progressGenerations = new Map<string, number>();
  private readonly mutationChains = new Map<string, Promise<void>>();
  // A workspace-write job's changed-path proof is a before/after observation
  // of the shared checkout. Serialize the whole observation and runner
  // lifetime so another job cannot contaminate that proof or the commit step.
  private workspaceWriteChain: Promise<void> = Promise.resolve();

  async initialize(): Promise<void> {
    await this.store.initialize();
    await this.store.recoverInterruptedJobs();
  }

  async submit(input: {
    prompt: string;
    mode: AgentJobMode;
    scope: AgentJobScope;
    parentJobId?: string;
    threadId?: string;
    notify?: boolean;
    onProgress?: ProgressListener;
  }): Promise<AgentJob> {
    const prompt = normalizeAgentPrompt(input.prompt);
    if (input.mode === 'workspace-write') {
      this.assertMutationAllowed(input.scope);
    }
    const job = await this.store.create({ ...input, prompt });
    if (job.mode === 'read-only') {
      void this.execute(job, input.notify !== false, input.onProgress);
    }
    return job;
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
      parentJobId: previous.id,
      threadId: previous.threadId,
      notify: options.notify,
      onProgress: options.onProgress,
    });
  }

  async runForCopilot(input: {
    prompt: string;
    scope: AgentJobScope;
    onProgress?: ProgressListener;
    timeoutMs?: number;
  }): Promise<AgentJob> {
    const job = await this.submit({
      prompt: input.prompt,
      mode: 'read-only',
      scope: input.scope,
      notify: true,
      onProgress: input.onProgress,
    });

    return this.waitForTerminal(job.id, input.scope, input.timeoutMs);
  }

  async waitForTerminal(id: string, scope: AgentJobScope, timeoutMs = 10 * 60 * 1000): Promise<AgentJob> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const job = this.store.get(id, scope);
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

    if (queued) void this.execute(queued, true);
    return queued;
  }

  async cancel(
    id: string,
    scope: AgentJobScope,
    options: { notify?: boolean; strict?: boolean } = {},
  ): Promise<AgentJob | undefined> {
    const existing = this.store.get(id, scope);
    if (existing?.mode === 'workspace-write') this.assertMutationAllowed(scope);
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

      this.invalidateProgressState(job.id);
      if (job.status === 'running') this.runner.cancel(id);
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

    if (options.notify && cancelled) {
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
    options: { notify?: boolean } = {},
  ): Promise<AgentJob | undefined> {
    return this.cancel(id, scope, { ...options, strict: true });
  }

  get(id: string, scope: AgentJobScope): AgentJob | undefined {
    return this.store.get(id, scope);
  }

  list(scope: AgentJobScope, limit = 8): AgentJob[] {
    return this.store.list(scope, limit);
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
    if (this.options.canMutateScope?.(scope) !== true) {
      throw new AgentMutationAuthorizationError(
        '운영자 권한이 필요합니다. 관리자에게 TEAMS_OPERATOR_REQUESTER_ALLOWLIST 설정을 요청하세요.',
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
        await this.store.appendProgress(job.id, scope, 'Codex 작업을 시작했습니다.');
        if (started.mode === 'workspace-write') {
          workspaceSnapshot = await this.gitService.captureWorkspaceSnapshot();
        }

        // Start the runner while the mutation lock is held. CodexRunner registers
        // the child process synchronously, so a concurrent cancel can reliably
        // signal it after this lock is released.
        runPromise = this.runner.run({
          jobId: started.id,
          prompt: started.prompt,
          workspace: this.workspace,
          mode: started.mode,
          threadId: started.threadId,
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
      const terminal = await this.withJobMutationLock(job.id, scope, async () => {
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
            ...(changedPaths ? { changedPaths } : {}),
            finishedAt: new Date().toISOString(),
          });
      });
      if (!terminal) return;

      if (diagnosticMessage) {
        await this.store.appendProgress(job.id, scope, `Codex 작업이 차단되었습니다: ${diagnostic.code}`);
        await this.notifyIfEnabled(terminal, {
          kind: 'error',
          phase: 'blocked',
          message: `작업 ${job.id}이 차단되었습니다.\n\n${diagnosticMessage}`,
        });
        return;
      }

      await this.store.appendProgress(job.id, scope, `Codex 작업 완료 (${result.eventCount}개 이벤트).`);
      await this.notifyIfEnabled(terminal, {
        kind: 'result',
        phase: 'completed',
        message: this.formatCompletion(job.id, result.finalMessage),
      });
    } catch (error: any) {
      const message = error?.message || '알 수 없는 Codex 실행 오류';
      let changedPaths: string[] | undefined;
      if (workspaceSnapshot) {
        try {
          changedPaths = await this.gitService.changedPathsSince(workspaceSnapshot);
        } catch {
          // Preserve the primary runner or Git snapshot error.
        }
      }
      const failed = await this.withJobMutationLock(job.id, scope, async () => {
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
      if (!failed) return;

      await this.store.appendProgress(job.id, scope, 'Codex 작업이 실패했습니다.');
      await this.notifyIfEnabled(failed, {
        kind: 'error',
        phase: 'failed',
        message: `작업 ${job.id}이 실패했습니다.\n\n${message}`,
      });
    } finally {
      this.clearProgressState(job.id, progressState?.generation);
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
      await this.publishProgress(job, state, 'analysis', 'analysis', 'Codex가 작업을 분석하고 있습니다.', 'Codex 분석을 시작했습니다.');
      return;
    }

    if (event.type === 'item.started' && event.item?.type === 'command_execution') {
      await this.flushPendingAgentMessage(job, state);
      await this.publishProgress(job, state, 'tools', 'tools', 'Codex가 필요한 도구를 실행하고 있습니다.', 'Codex가 필요한 도구를 실행하고 있습니다.');
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
    await this.store.appendProgress(job.id, scope, `Codex 업데이트: ${compact}`);
    if (!this.isCurrentRunningProgress(job, state)) return;
    await state.onProgress?.(`Codex 업데이트: ${compact}`);
    if (!this.isCurrentRunningProgress(job, state)) return;
    await this.notifyIfEnabled(job, {
      kind: 'progress',
      phase: 'agent-update',
      message: `작업 ${job.id}: Codex 업데이트\n\n${compact}`,
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
  ): Promise<void> {
    const state = this.progressStates.get(job.id);
    if (state?.notify === false) return;

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
