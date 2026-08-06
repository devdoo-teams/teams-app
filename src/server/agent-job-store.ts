import crypto from 'node:crypto';

import { atomicWriteJson, readAtomicJsonStore } from './atomic-file.js';

export type AgentJobMode = 'read-only' | 'workspace-write';
export type AgentJobStatus =
  | 'queued'
  | 'awaiting_approval'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AgentJobScope {
  requesterId: string;
  conversationId: string;
  tenantId: string;
}

export interface AgentJob {
  id: string;
  prompt: string;
  mode: AgentJobMode;
  status: AgentJobStatus;
  conversationId: string;
  requesterId: string;
  /** Missing only on legacy records; scoped access deliberately rejects them. */
  tenantId?: string;
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
    try {
      const raw = await readAtomicJsonStore(this.filePath);
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
    scope: AgentJobScope;
    parentJobId?: string;
    threadId?: string;
  }): Promise<AgentJob> {
    const job: AgentJob = {
      id: `task-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
      prompt: input.prompt,
      mode: input.mode,
      status: input.mode === 'workspace-write' ? 'awaiting_approval' : 'queued',
      conversationId: input.scope.conversationId,
      requesterId: input.scope.requesterId,
      tenantId: input.scope.tenantId,
      parentJobId: input.parentJobId,
      threadId: input.threadId,
      progress: [],
      createdAt: new Date().toISOString(),
    };

    this.jobs.unshift(job);
    await this.persist();
    return job;
  }

  get(id: string, scope: AgentJobScope): AgentJob | undefined {
    return this.jobs.find((job) => job.id === id && matchesScope(job, scope));
  }

  list(scope: AgentJobScope, limit = 10): AgentJob[] {
    return this.jobs.filter((job) => matchesScope(job, scope)).slice(0, limit);
  }

  latestCompletedWithThread(scope: AgentJobScope): AgentJob | undefined {
    return this.jobs.find((job) =>
      matchesScope(job, scope) &&
      job.status === 'completed' &&
      Boolean(job.threadId),
    );
  }

  async update(
    id: string,
    scope: AgentJobScope,
    patch: Partial<Omit<AgentJob, keyof AgentJobScope>>,
  ): Promise<AgentJob | undefined> {
    const job = this.get(id, scope);
    if (!job) return undefined;

    Object.assign(job, patch);
    await this.persist();
    return job;
  }

  async appendProgress(id: string, scope: AgentJobScope, message: string): Promise<AgentJob | undefined> {
    const job = this.get(id, scope);
    if (!job) return undefined;

    if (job.progress.at(-1) === message) return job;

    job.progress = [...job.progress.slice(-7), message];
    await this.persist();
    return job;
  }

  countActive(scope: AgentJobScope): number {
    return this.jobs.filter((job) =>
      matchesScope(job, scope) &&
      (job.status === 'queued' || job.status === 'awaiting_approval' || job.status === 'running'),
    ).length;
  }

  /** Local-only MCP/debug reader. Never use this from an authenticated request path. */
  getLocalOnly(id: string): AgentJob | undefined {
    return this.jobs.find((job) => job.id === id);
  }

  /** Local-only MCP/debug reader. Never use this from an authenticated request path. */
  listLocalOnly(limit = 10): AgentJob[] {
    return this.jobs.slice(0, limit);
  }

  /** Local-only MCP/debug reader. Never use this from an authenticated request path. */
  countActiveLocalOnly(): number {
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
    const nextWrite = this.writeChain.then(() => atomicWriteJson(this.filePath, this.jobs));
    this.writeChain = nextWrite.catch(() => undefined);
    await nextWrite;
  }
}

function matchesScope(job: AgentJob, scope: AgentJobScope): boolean {
  // Legacy records without tenantId are intentionally inaccessible through all
  // scoped reads and mutations; startup recovery is the only admin operation.
  return typeof job.tenantId === 'string'
    && job.requesterId === scope.requesterId
    && job.conversationId === scope.conversationId
    && job.tenantId === scope.tenantId;
}
