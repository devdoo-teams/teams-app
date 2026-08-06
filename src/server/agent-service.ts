import type { AgentJob, AgentJobMode } from './agent-job-store.js';
import { AgentJobStore } from './agent-job-store.js';
import { CodexRunner, type CodexRunEvent } from './codex-runner.js';
import { GitService } from './git-service.js';
import { diagnoseRemoteAgentResult, formatRemoteTroubleshooting } from './remote-troubleshooting.js';

type Notify = (conversationId: string, text: string) => Promise<void>;
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
    conversationId: string;
    requesterId: string;
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
    options: { notify?: boolean; onProgress?: ProgressListener } = {},
  ): Promise<AgentJob | undefined> {
    const previous = this.store.get(id);
    if (!previous) return undefined;
    if (!previous.threadId) return undefined;

    return this.submit({
      prompt,
      mode: previous.mode,
      conversationId: previous.conversationId,
      requesterId: previous.requesterId,
      parentJobId: previous.id,
      threadId: previous.threadId,
      notify: options.notify,
      onProgress: options.onProgress,
    });
  }

  async runForCopilot(input: {
    prompt: string;
    conversationId: string;
    requesterId: string;
    onProgress?: ProgressListener;
    timeoutMs?: number;
  }): Promise<AgentJob> {
    const job = await this.submit({
      prompt: input.prompt,
      mode: 'read-only',
      conversationId: input.conversationId,
      requesterId: input.requesterId,
      notify: false,
      onProgress: input.onProgress,
    });

    return this.waitForTerminal(job.id, input.timeoutMs);
  }

  async waitForTerminal(id: string, timeoutMs = 10 * 60 * 1000): Promise<AgentJob> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const job = this.store.get(id);
      if (!job) throw new Error(`작업 ${id}을 찾을 수 없습니다.`);

      if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled' || job.status === 'awaiting_approval') {
        return job;
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    await this.cancel(id);
    const job = this.store.get(id);
    if (!job) throw new Error(`작업 ${id}을 찾을 수 없습니다.`);
    return job;
  }

  async approve(id: string): Promise<AgentJob | undefined> {
    const job = this.store.get(id);
    if (!job || job.status !== 'awaiting_approval') return job;

    await this.store.update(id, { status: 'queued', error: undefined });
    const refreshed = this.store.get(id);
    if (refreshed) void this.execute(refreshed, true);
    return refreshed;
  }

  async cancel(id: string): Promise<AgentJob | undefined> {
    const job = this.store.get(id);
    if (!job) return undefined;

    if (job.status === 'awaiting_approval' || job.status === 'queued') {
      return this.store.update(id, {
        status: 'cancelled',
        finishedAt: new Date().toISOString(),
      });
    }

    if (job.status === 'running') {
      this.runner.cancel(id);
      return this.store.update(id, {
        status: 'cancelled',
        finishedAt: new Date().toISOString(),
      });
    }

    return job;
  }

  get(id: string): AgentJob | undefined {
    return this.store.get(id);
  }

  list(limit = 8): AgentJob[] {
    return this.store.list(limit);
  }

  latestCompletedForConversation(conversationId: string): AgentJob | undefined {
    return this.store.latestCompletedWithThread(conversationId);
  }

  countActive(): number {
    return this.store.countActive();
  }

  async commit(id: string, message: string): Promise<AgentJob | undefined> {
    const job = this.store.get(id);
    if (!job) return undefined;
    if (job.status !== 'completed') return job;

    const commit = await this.gitService.commit(message);
    if (!commit.committed) {
      await this.store.update(id, { commitMessage: commit.message });
      return this.store.get(id);
    }

    await this.store.update(id, {
      commitHash: commit.hash,
      commitMessage: commit.message,
    });
    await this.notify(job.conversationId, `작업 ${id}: ${commit.message}`);
    return this.store.get(id);
  }

  private async execute(job: AgentJob, shouldNotify: boolean, onProgress?: ProgressListener): Promise<void> {
    this.progressStates.set(job.id, { notifiedKeys: new Set(), notify: shouldNotify, onProgress });
    await this.store.update(job.id, {
      status: 'running',
      startedAt: new Date().toISOString(),
    });
    await this.store.appendProgress(job.id, 'Codex 작업을 시작했습니다.');

    try {
      const result = await this.runner.run({
        jobId: job.id,
        prompt: job.prompt,
        workspace: this.workspace,
        mode: job.mode,
        threadId: job.threadId,
        onEvent: (event) => this.handleEvent(job, event),
      });

      const latest = this.store.get(job.id);
      if (!latest || latest.status === 'cancelled') return;

      const diagnostic = diagnoseRemoteAgentResult(result.finalMessage);
      const diagnosticMessage = formatRemoteTroubleshooting(diagnostic);
      if (diagnosticMessage) {
        await this.store.update(job.id, {
          status: 'failed',
          error: diagnosticMessage,
          finishedAt: new Date().toISOString(),
        });
        await this.store.appendProgress(job.id, `Codex 작업이 차단되었습니다: ${diagnostic.code}`);
        await this.notifyIfEnabled(job, `작업 ${job.id}이 차단되었습니다.\n\n${diagnosticMessage}`);
        return;
      }

      await this.store.update(job.id, {
        status: 'completed',
        threadId: result.threadId,
        result: result.finalMessage,
        finishedAt: new Date().toISOString(),
      });
      await this.store.appendProgress(job.id, `Codex 작업 완료 (${result.eventCount}개 이벤트).`);
      await this.notifyIfEnabled(job, this.formatCompletion(job.id, result.finalMessage));
    } catch (error: any) {
      const latest = this.store.get(job.id);
      if (!latest || latest.status === 'cancelled') return;

      const message = error?.message || '알 수 없는 Codex 실행 오류';
      await this.store.update(job.id, {
        status: 'failed',
        error: message,
        finishedAt: new Date().toISOString(),
      });
      await this.store.appendProgress(job.id, 'Codex 작업이 실패했습니다.');
      await this.notifyIfEnabled(job, `작업 ${job.id}이 실패했습니다.\n\n${message}`);
    } finally {
      this.progressStates.delete(job.id);
    }
  }

  private async handleEvent(job: AgentJob, event: CodexRunEvent): Promise<void> {
    const state = this.progressStates.get(job.id) ?? { notifiedKeys: new Set<string>(), notify: true };
    this.progressStates.set(job.id, state);

    if (event.type === 'thread.started' && event.thread_id) {
      await this.store.update(job.id, { threadId: event.thread_id });
      return;
    }

    if (event.type === 'turn.started') {
      await this.publishProgress(job, state, 'analysis', 'Codex가 작업을 분석하고 있습니다.', 'Codex 분석을 시작했습니다.');
      return;
    }

    if (event.type === 'item.started' && event.item?.type === 'command_execution') {
      await this.flushPendingAgentMessage(job, state);
      await this.publishProgress(job, state, 'tools', 'Codex가 필요한 도구를 실행하고 있습니다.', 'Codex가 필요한 도구를 실행하고 있습니다.');
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
    await this.store.appendProgress(job.id, `Codex 업데이트: ${compact}`);
    await state.onProgress?.(`Codex 업데이트: ${compact}`);
    await this.notifyIfEnabled(job, `작업 ${job.id}: Codex 업데이트\n\n${compact}`);
  }

  private async publishProgress(
    job: AgentJob,
    state: ProgressState,
    key: string,
    storedMessage: string,
    notification: string,
  ): Promise<void> {
    if (state.notifiedKeys.has(key)) return;
    state.notifiedKeys.add(key);
    await this.store.appendProgress(job.id, storedMessage);
    await state.onProgress?.(storedMessage);
    await this.notifyIfEnabled(job, `작업 ${job.id}: ${notification}`);
  }

  private async notifyIfEnabled(job: AgentJob, message: string): Promise<void> {
    const state = this.progressStates.get(job.id);
    if (state?.notify !== false) await this.notify(job.conversationId, message);
  }

  private formatCompletion(id: string, result: string): string {
    const maxLength = 7000;
    const compact = result.length > maxLength ? `${result.slice(0, maxLength)}\n\n(결과가 길어 일부만 표시되었습니다.)` : result;
    return `작업 ${id}이 완료되었습니다.\n\n${compact}`;
  }
}
