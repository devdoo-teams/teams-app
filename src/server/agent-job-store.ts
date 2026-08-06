import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export type AgentJobMode = 'read-only' | 'workspace-write';
export type AgentJobStatus =
  | 'queued'
  | 'awaiting_approval'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AgentJob {
  id: string;
  prompt: string;
  mode: AgentJobMode;
  status: AgentJobStatus;
  conversationId: string;
  requesterId: string;
  parentJobId?: string;
  threadId?: string;
  result?: string;
  commitHash?: string;
  commitMessage?: string;
  error?: string;
  progress: string[];
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export class AgentJobStore {
  private jobs: AgentJob[] = [];
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.jobs = Array.isArray(parsed) ? parsed : [];
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
      await this.persist();
    }
  }

  async create(input: {
    prompt: string;
    mode: AgentJobMode;
    conversationId: string;
    requesterId: string;
    parentJobId?: string;
    threadId?: string;
  }): Promise<AgentJob> {
    const job: AgentJob = {
      id: `task-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
      prompt: input.prompt,
      mode: input.mode,
      status: input.mode === 'workspace-write' ? 'awaiting_approval' : 'queued',
      conversationId: input.conversationId,
      requesterId: input.requesterId,
      parentJobId: input.parentJobId,
      threadId: input.threadId,
      progress: [],
      createdAt: new Date().toISOString(),
    };

    this.jobs.unshift(job);
    await this.persist();
    return job;
  }

  get(id: string): AgentJob | undefined {
    return this.jobs.find((job) => job.id === id);
  }

  list(limit = 10): AgentJob[] {
    return this.jobs.slice(0, limit);
  }

  latestCompletedWithThread(conversationId: string): AgentJob | undefined {
    return this.jobs.find((job) =>
      job.conversationId === conversationId &&
      job.status === 'completed' &&
      Boolean(job.threadId),
    );
  }

  async update(id: string, patch: Partial<AgentJob>): Promise<AgentJob | undefined> {
    const job = this.get(id);
    if (!job) return undefined;

    Object.assign(job, patch);
    await this.persist();
    return job;
  }

  async appendProgress(id: string, message: string): Promise<AgentJob | undefined> {
    const job = this.get(id);
    if (!job) return undefined;

    if (job.progress.at(-1) === message) return job;

    job.progress = [...job.progress.slice(-7), message];
    await this.persist();
    return job;
  }

  countActive(): number {
    return this.jobs.filter((job) =>
      job.status === 'queued' || job.status === 'awaiting_approval' || job.status === 'running',
    ).length;
  }

  async recoverInterruptedJobs(): Promise<void> {
    let changed = false;

    for (const job of this.jobs) {
      if (job.status === 'queued' || job.status === 'running') {
        job.status = 'failed';
        job.error = '서버가 재시작되어 작업이 중단되었습니다.';
        job.finishedAt = new Date().toISOString();
        changed = true;
      }
    }

    if (changed) await this.persist();
  }

  private async persist(): Promise<void> {
    const snapshot = JSON.stringify(this.jobs, null, 2);
    this.writeChain = this.writeChain.then(() => fs.writeFile(this.filePath, snapshot, 'utf8'));
    await this.writeChain;
  }
}
