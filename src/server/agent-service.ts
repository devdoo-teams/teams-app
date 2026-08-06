import type { AgentJob, AgentJobMode } from './agent-job-store.js';
import { AgentJobStore } from './agent-job-store.js';
import { CodexRunner, type CodexRunEvent } from './codex-runner.js';

type Notify = (conversationId: string, text: string) => Promise<void>;

export class AgentService {
  constructor(
    private readonly store: AgentJobStore,
    private readonly runner: CodexRunner,
    private readonly workspace: string,
    private readonly notify: Notify,
  ) {}

  async initialize(): Promise<void> {
    await this.store.initialize();
    await this.store.recoverInterruptedJobs();
  }

  async submit(input: {
    prompt: string;
    mode: AgentJobMode;
    conversationId: string;
    requesterId: string;
  }): Promise<AgentJob> {
    const job = await this.store.create(input);
    if (job.mode === 'read-only') void this.execute(job);
    return job;
  }

  async approve(id: string): Promise<AgentJob | undefined> {
    const job = this.store.get(id);
    if (!job || job.status !== 'awaiting_approval') return job;

    await this.store.update(id, { status: 'queued', error: undefined });
    const refreshed = this.store.get(id);
    if (refreshed) void this.execute(refreshed);
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

  countActive(): number {
    return this.store.countActive();
  }

  private async execute(job: AgentJob): Promise<void> {
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
        onEvent: (event) => this.handleEvent(job, event),
      });

      const latest = this.store.get(job.id);
      if (!latest || latest.status === 'cancelled') return;

      await this.store.update(job.id, {
        status: 'completed',
        threadId: result.threadId,
        result: result.finalMessage,
        finishedAt: new Date().toISOString(),
      });
      await this.store.appendProgress(job.id, `Codex 작업 완료 (${result.eventCount}개 이벤트).`);
      await this.notify(job.conversationId, this.formatCompletion(job.id, result.finalMessage));
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
      await this.notify(job.conversationId, `작업 ${job.id}이 실패했습니다.\n\n${message}`);
    }
  }

  private async handleEvent(job: AgentJob, event: CodexRunEvent): Promise<void> {
    if (event.type === 'thread.started' && event.thread_id) {
      await this.store.update(job.id, { threadId: event.thread_id });
      return;
    }

    if (event.type === 'turn.started') {
      await this.store.appendProgress(job.id, 'Codex가 작업을 분석하고 있습니다.');
      return;
    }

    if (event.type === 'item.started' && event.item?.type === 'command_execution') {
      await this.store.appendProgress(job.id, 'Codex가 저장소를 확인하고 있습니다.');
    }
  }

  private formatCompletion(id: string, result: string): string {
    const maxLength = 7000;
    const compact = result.length > maxLength ? `${result.slice(0, maxLength)}\n\n(결과가 길어 일부만 표시되었습니다.)` : result;
    return `작업 ${id}이 완료되었습니다.\n\n${compact}`;
  }
}
