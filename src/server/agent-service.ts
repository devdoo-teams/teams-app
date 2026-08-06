import type { AgentJob, AgentJobMode, AgentJobScope } from './agent-job-store.js';
import { AgentJobStore } from './agent-job-store.js';
import { CodexRunner, type CodexRunEvent } from './codex-runner.js';
import { GitService } from './git-service.js';
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

type ProgressState = {
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
  ) {}

  private readonly progressStates = new Map<string, ProgressState>();

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
    const job = await this.store.create(input);
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
    const previous = this.store.get(id, scope);
    if (!previous) return undefined;
    if (!previous.threadId) return undefined;

    return this.submit({
      prompt,
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
      notify: false,
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

    await this.cancel(id, scope, { notify: true });
    const job = this.store.get(id, scope);
    if (!job) throw new Error(`작업 ${id}을 찾을 수 없습니다.`);
    return job;
  }

  async approve(id: string, scope: AgentJobScope): Promise<AgentJob | undefined> {
    const job = this.store.get(id, scope);
    if (!job || job.status !== 'awaiting_approval') return job;

    await this.store.update(id, scope, { status: 'queued', error: undefined });
    const refreshed = this.store.get(id, scope);
    if (refreshed) void this.execute(refreshed, true);
    return refreshed;
  }

  async cancel(
    id: string,
    scope: AgentJobScope,
    options: { notify?: boolean } = {},
  ): Promise<AgentJob | undefined> {
    const job = this.store.get(id, scope);
    if (!job) return undefined;

    if (job.status === 'awaiting_approval' || job.status === 'queued') {
      const cancelled = await this.store.update(id, scope, {
        status: 'cancelled',
        finishedAt: new Date().toISOString(),
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

    if (job.status === 'running') {
      this.runner.cancel(id);
      const cancelled = await this.store.update(id, scope, {
        status: 'cancelled',
        finishedAt: new Date().toISOString(),
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

    return job;
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
    const job = this.store.get(id, scope);
    if (!job) return undefined;
    if (job.status !== 'completed') return job;

    const commit = await this.gitService.commit(message);
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

  private async execute(job: AgentJob, shouldNotify: boolean, onProgress?: ProgressListener): Promise<void> {
    const scope = scopeForJob(job);
    if (!scope) return;
    this.progressStates.set(job.id, { notifiedKeys: new Set(), notify: shouldNotify, onProgress });
    await this.store.update(job.id, scope, {
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    await this.store.appendProgress(job.id, scope, 'Codex 작업을 시작했습니다.');

    try {
      const result = await this.runner.run({
        jobId: job.id,
        prompt: job.prompt,
        workspace: this.workspace,
        mode: job.mode,
        threadId: job.threadId,
        onEvent: (event) => this.handleEvent(job, event),
      });

      const latest = this.store.get(job.id, scope);
      if (!latest || latest.status === 'cancelled') return;

      const diagnostic = diagnoseRemoteAgentResult(result.finalMessage);
      const diagnosticMessage = formatRemoteTroubleshooting(diagnostic);
      if (diagnosticMessage) {
        await this.store.update(job.id, scope, {
          status: 'failed',
          error: diagnosticMessage,
          finishedAt: new Date().toISOString(),
        });
        await this.store.appendProgress(job.id, scope, `Codex 작업이 차단되었습니다: ${diagnostic.code}`);
        await this.notifyIfEnabled(job, {
          kind: 'error',
          phase: 'blocked',
          message: `작업 ${job.id}이 차단되었습니다.\n\n${diagnosticMessage}`,
        });
        return;
      }

      await this.store.update(job.id, scope, {
        status: 'completed',
        threadId: result.threadId,
        result: result.finalMessage,
        finishedAt: new Date().toISOString(),
      });
      await this.store.appendProgress(job.id, scope, `Codex 작업 완료 (${result.eventCount}개 이벤트).`);
      await this.notifyIfEnabled(job, {
        kind: 'result',
        phase: 'completed',
        message: this.formatCompletion(job.id, result.finalMessage),
      });
    } catch (error: any) {
      const latest = this.store.get(job.id, scope);
      if (!latest || latest.status === 'cancelled') return;

      const message = error?.message || '알 수 없는 Codex 실행 오류';
      await this.store.update(job.id, scope, {
        status: 'failed',
        error: message,
        finishedAt: new Date().toISOString(),
      });
      await this.store.appendProgress(job.id, scope, 'Codex 작업이 실패했습니다.');
      await this.notifyIfEnabled(job, {
        kind: 'error',
        phase: 'failed',
        message: `작업 ${job.id}이 실패했습니다.\n\n${message}`,
      });
    } finally {
      this.progressStates.delete(job.id);
    }
  }

  private async handleEvent(job: AgentJob, event: CodexRunEvent): Promise<void> {
    const state = this.progressStates.get(job.id) ?? { notifiedKeys: new Set<string>(), notify: true };
    this.progressStates.set(job.id, state);

    if (event.type === 'thread.started' && event.thread_id) {
      const scope = scopeForJob(job);
      if (scope) await this.store.update(job.id, scope, { threadId: event.thread_id });
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
        if (state.pendingAgentMessage) await this.publishAgentUpdate(job, state.pendingAgentMessage);
        state.pendingAgentMessage = message;
      }
    }
  }

  private async flushPendingAgentMessage(job: AgentJob, state: ProgressState): Promise<void> {
    if (!state.pendingAgentMessage) return;
    await this.publishAgentUpdate(job, state.pendingAgentMessage);
    state.pendingAgentMessage = undefined;
  }

  private async publishAgentUpdate(job: AgentJob, message: string): Promise<void> {
    const compact = message.length > 1200 ? `${message.slice(0, 1200)}\n\n(중간 업데이트가 일부 생략되었습니다.)` : message;
    const state = this.progressStates.get(job.id);
    if (!state) return;
    const key = `agent:${compact}`;
    if (state.notifiedKeys.has(key)) return;
    state.notifiedKeys.add(key);
    const scope = scopeForJob(job);
    if (!scope) return;
    await this.store.appendProgress(job.id, scope, `Codex 업데이트: ${compact}`);
    await state.onProgress?.(`Codex 업데이트: ${compact}`);
    await this.notifyIfEnabled(job, {
      kind: 'progress',
      phase: 'agent-update',
      message: `작업 ${job.id}: Codex 업데이트\n\n${compact}`,
    });
  }

  private async publishProgress(
    job: AgentJob,
    state: ProgressState,
    key: string,
    phase: Extract<AgentNotificationPhase, 'analysis' | 'tools'>,
    storedMessage: string,
    notification: string,
  ): Promise<void> {
    if (state.notifiedKeys.has(key)) return;
    state.notifiedKeys.add(key);
    const scope = scopeForJob(job);
    if (!scope) return;
    await this.store.appendProgress(job.id, scope, storedMessage);
    await state.onProgress?.(storedMessage);
    await this.notifyIfEnabled(job, {
      kind: 'progress',
      phase,
      message: `작업 ${job.id}: ${notification}`,
    });
  }

  private async notifyIfEnabled(
    job: AgentJob,
    event: Omit<AgentNotification, 'conversationId' | 'job'>,
  ): Promise<void> {
    const state = this.progressStates.get(job.id);
    if (state?.notify === false) return;

    const scope = scopeForJob(job);
    if (!scope) return;
    const current = this.store.get(job.id, scope) ?? job;
    await this.notify({
      ...event,
      conversationId: current.conversationId,
      job: current,
    });
  }

  private formatCompletion(id: string, result: string): string {
    const maxLength = 7000;
    const compact = result.length > maxLength ? `${result.slice(0, maxLength)}\n\n(결과가 길어 일부만 표시되었습니다.)` : result;
    return `작업 ${id}이 완료되었습니다.\n\n${compact}`;
  }
}

function scopeForJob(job: AgentJob): AgentJobScope | undefined {
  if (typeof job.tenantId !== 'string' || !job.tenantId) return undefined;
  return {
    requesterId: job.requesterId,
    conversationId: job.conversationId,
    tenantId: job.tenantId,
  };
}
