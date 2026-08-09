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

export const MAX_AGENT_JOB_ID_LENGTH = 200;
export const MAX_AGENT_SCOPE_VALUE_LENGTH = 256;
export const MAX_AGENT_PROMPT_LENGTH = 2_000;
export const MAX_AGENT_PROGRESS_MESSAGE_LENGTH = 2_000;
export const MAX_AGENT_RESULT_LENGTH = 20_000;
export const MAX_AGENT_ERROR_LENGTH = 10_000;
export const MAX_AGENT_COMMIT_MESSAGE_LENGTH = 2_000;
export const MAX_AGENT_PROGRESS_ENTRIES = 100;
export const MAX_AGENT_CHANGED_PATH_LENGTH = 512;
export const MAX_AGENT_CHANGED_PATHS = 256;

const AGENT_JOB_STATUSES: readonly AgentJobStatus[] = [
  'queued',
  'awaiting_approval',
  'running',
  'completed',
  'failed',
  'cancelled',
];
const AGENT_JOB_MODES: readonly AgentJobMode[] = ['read-only', 'workspace-write'];
// Preserve the whitespace characters used by normal multi-line Codex output
// while rejecting the remaining C0/C1 control range in persisted records.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

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
  changedPaths?: string[];
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
      const parsed = JSON.parse(raw) as unknown;
      const loaded = loadJobs(parsed, this.filePath);
      // Do not replace the in-memory state or rewrite the file until every
      // record and cross-record scope relationship has passed validation.
      this.jobs = loaded.jobs;
      if (loaded.migrated) await this.persist();
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

    return this.enqueueMutation(() => {
      this.jobs = [job, ...this.jobs];
      return cloneAgentJob(job);
    });
  }

  get(id: string, scope: AgentJobScope): AgentJob | undefined {
    const job = this.jobs.find((candidate) => candidate.id === id && matchesScope(candidate, scope));
    return job ? cloneAgentJob(job) : undefined;
  }

  list(scope: AgentJobScope, limit = 10): AgentJob[] {
    return this.jobs
      .filter((job) => matchesScope(job, scope))
      .slice(0, limit)
      .map(cloneAgentJob);
  }

  latestCompletedWithThread(scope: AgentJobScope): AgentJob | undefined {
    const job = this.jobs.find((candidate) =>
      matchesScope(candidate, scope) &&
      candidate.status === 'completed' &&
      Boolean(candidate.threadId),
    );
    return job ? cloneAgentJob(job) : undefined;
  }

  async update(
    id: string,
    scope: AgentJobScope,
    patch: Partial<Omit<AgentJob, keyof AgentJobScope>>,
  ): Promise<AgentJob | undefined> {
    return this.enqueueMutation(() => {
      const index = this.jobs.findIndex((job) => job.id === id && matchesScope(job, scope));
      if (index === -1) return undefined;

      const updated = { ...this.jobs[index], ...patch } as AgentJob;
      if (updated.status === 'completed' && (!updated.result || !updated.result.trim())) {
        throw new Error('completed jobs must contain a result');
      }
      this.jobs = this.jobs.map((job, jobIndex) => jobIndex === index ? updated : job);
      return cloneAgentJob(updated);
    });
  }

  async appendProgress(id: string, scope: AgentJobScope, message: string): Promise<AgentJob | undefined> {
    return this.enqueueMutation(() => {
      const index = this.jobs.findIndex((job) => job.id === id && matchesScope(job, scope));
      if (index === -1) return undefined;

      const job = this.jobs[index];
      if (job.progress.at(-1) === message) return cloneAgentJob(job);

      const updated = { ...job, progress: [...job.progress.slice(-7), message] };
      this.jobs = this.jobs.map((candidate, jobIndex) => jobIndex === index ? updated : candidate);
      return cloneAgentJob(updated);
    });
  }

  countActive(scope: AgentJobScope): number {
    return this.jobs.filter((job) =>
      matchesScope(job, scope) &&
      (job.status === 'queued' || job.status === 'awaiting_approval' || job.status === 'running'),
    ).length;
  }

  /** Local-only MCP/debug reader. Never use this from an authenticated request path. */
  getLocalOnly(id: string): AgentJob | undefined {
    const job = this.jobs.find((candidate) => candidate.id === id);
    return job ? cloneAgentJob(job) : undefined;
  }

  /** Local-only MCP/debug reader. Never use this from an authenticated request path. */
  listLocalOnly(limit = 10): AgentJob[] {
    return this.jobs.slice(0, limit).map(cloneAgentJob);
  }

  /** Local-only MCP/debug reader. Never use this from an authenticated request path. */
  countActiveLocalOnly(): number {
    return this.jobs.filter((job) =>
      job.status === 'queued' || job.status === 'awaiting_approval' || job.status === 'running',
    ).length;
  }

  async recoverInterruptedJobs(): Promise<void> {
    await this.enqueueMutation(() => {
      const finishedAt = new Date().toISOString();
      this.jobs = this.jobs.map((job) =>
        job.status === 'queued' || job.status === 'running'
          ? {
              ...job,
              status: 'failed',
              error: '서버가 재시작되어 작업이 중단되었습니다.',
              finishedAt,
            }
          : job,
      );
    });
  }

  private async persist(): Promise<void> {
    const snapshot = this.jobs.map(cloneAgentJob);
    const nextWrite = this.writeChain.then(() => atomicWriteJson(this.filePath, snapshot));
    this.writeChain = nextWrite.catch(() => undefined);
    await nextWrite;
  }

  private enqueueMutation<T>(mutate: () => T): Promise<T> {
    const operation = this.writeChain.then(async () => {
      const previousJobs = this.jobs;
      try {
        const result = mutate();
        await atomicWriteJson(this.filePath, this.jobs.map(cloneAgentJob));
        return result;
      } catch (error) {
        this.jobs = previousJobs;
        throw error;
      }
    });
    this.writeChain = operation.then(() => undefined, () => undefined);
    return operation;
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

function cloneAgentJob(job: AgentJob): AgentJob {
  return {
    ...job,
    progress: [...job.progress],
    ...(job.changedPaths ? { changedPaths: [...job.changedPaths] } : {}),
  };
}

type JobRecord = Record<string, unknown>;

type LoadedJobs = {
  jobs: AgentJob[];
  migrated: boolean;
};

type LoadedValue<T> = {
  value: T;
  migrated: boolean;
};

function loadJobs(value: unknown, filePath: string): LoadedJobs {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid agent job store format: ${filePath}`);
  }

  const ids = new Set<string>();
  const loaded = value.map((record, index) => loadJob(record, index, ids));
  const jobs = loaded.map((entry) => entry.job);
  validateParentScopes(jobs);

  return {
    jobs,
    migrated: loaded.some((entry) => entry.migrated),
  };
}

function loadJob(value: unknown, index: number, ids: Set<string>): { job: AgentJob; migrated: boolean } {
  if (!isRecord(value)) throw invalidJob(index, 'record must be an object');

  // Records created before tenant scoping have no tenantId. They remain
  // intentionally inaccessible to scoped reads; accepting them here is only a
  // compatibility migration and never supplies a guessed tenant.
  const legacy = !hasOwn(value, 'tenantId');
  let migrated = legacy;

  const idLoaded = readRequiredText(value.id, 'id', MAX_AGENT_JOB_ID_LENGTH, index, legacy);
  const id = idLoaded.value;
  if (ids.has(id)) throw invalidJob(index, 'id must be unique');
  ids.add(id);

  const prompt = readRequiredText(value.prompt, 'prompt', MAX_AGENT_PROMPT_LENGTH, index, legacy);
  const mode = readEnum(value.mode, 'mode', AGENT_JOB_MODES, index);
  let status = readEnum(value.status, 'status', AGENT_JOB_STATUSES, index);
  const conversationId = readRequiredText(
    value.conversationId,
    'conversationId',
    MAX_AGENT_SCOPE_VALUE_LENGTH,
    index,
    legacy,
  );
  const requesterId = readRequiredText(
    value.requesterId,
    'requesterId',
    MAX_AGENT_SCOPE_VALUE_LENGTH,
    index,
    legacy,
  );
  const tenantId = hasOwn(value, 'tenantId')
    ? readRequiredText(value.tenantId, 'tenantId', MAX_AGENT_SCOPE_VALUE_LENGTH, index, false).value
    : undefined;

  const parentJobId = readOptionalText(
    value,
    'parentJobId',
    MAX_AGENT_JOB_ID_LENGTH,
    index,
    legacy,
  );
  const threadId = readOptionalText(value, 'threadId', MAX_AGENT_JOB_ID_LENGTH, index, legacy);
  const result = readOptionalText(value, 'result', MAX_AGENT_RESULT_LENGTH, index, legacy);
  const commitHash = readOptionalText(value, 'commitHash', MAX_AGENT_JOB_ID_LENGTH, index, legacy);
  const commitMessage = readOptionalText(
    value,
    'commitMessage',
    MAX_AGENT_COMMIT_MESSAGE_LENGTH,
    index,
    legacy,
  );
  const changedPaths = readChangedPaths(value, index, legacy);
  let error = readOptionalText(value, 'error', MAX_AGENT_ERROR_LENGTH, index, legacy);
  const progress = readProgress(value, index, legacy);
  const createdAt = readTimestamp(value.createdAt, 'createdAt', index, legacy);
  const startedAt = readOptionalTimestamp(value, 'startedAt', index, legacy);
  const finishedAt = readOptionalTimestamp(value, 'finishedAt', index, legacy);

  if (status === 'completed' && !result.value) {
    if (!legacy) throw invalidJob(index, 'completed jobs must contain a result');
    status = 'failed';
    error = {
      value: error.value || '이전 완료 작업에 결과가 없어 실패 상태로 복구했습니다.',
      migrated: true,
    };
  }

  migrated ||= [
    idLoaded.migrated,
    prompt.migrated,
    conversationId.migrated,
    requesterId.migrated,
    parentJobId.migrated,
    threadId.migrated,
    result.migrated,
    commitHash.migrated,
    commitMessage.migrated,
    changedPaths.migrated,
    error.migrated,
    progress.migrated,
    createdAt.migrated,
    startedAt.migrated,
    finishedAt.migrated,
  ].some(Boolean);

  const job: AgentJob = {
    id,
    prompt: prompt.value,
    mode,
    status,
    conversationId: conversationId.value,
    requesterId: requesterId.value,
    ...(tenantId ? { tenantId } : {}),
    ...(parentJobId.value ? { parentJobId: parentJobId.value } : {}),
    ...(threadId.value ? { threadId: threadId.value } : {}),
    ...(result.value ? { result: result.value } : {}),
    ...(commitHash.value ? { commitHash: commitHash.value } : {}),
    ...(commitMessage.value ? { commitMessage: commitMessage.value } : {}),
    ...(changedPaths.value ? { changedPaths: changedPaths.value } : {}),
    ...(error.value ? { error: error.value } : {}),
    progress: progress.value,
    createdAt: createdAt.value,
    ...(startedAt.value ? { startedAt: startedAt.value } : {}),
    ...(finishedAt.value ? { finishedAt: finishedAt.value } : {}),
  };

  return { job, migrated };
}

function readChangedPaths(
  value: JobRecord,
  index: number,
  legacy: boolean,
): LoadedValue<string[] | undefined> {
  if (!hasOwn(value, 'changedPaths') || value.changedPaths === undefined) {
    return { value: undefined, migrated: false };
  }
  if (!Array.isArray(value.changedPaths)) throw invalidJob(index, 'changedPaths must be an array');
  if (!legacy && value.changedPaths.length > MAX_AGENT_CHANGED_PATHS) {
    throw invalidJob(index, `changedPaths must contain ${MAX_AGENT_CHANGED_PATHS} entries or fewer`);
  }

  const source = legacy ? value.changedPaths.slice(0, MAX_AGENT_CHANGED_PATHS) : value.changedPaths;
  const paths: string[] = [];
  const seen = new Set<string>();
  let migrated = legacy && source.length !== value.changedPaths.length;
  for (const [pathIndex, pathValue] of source.entries()) {
    const loaded = readText(
      pathValue,
      `changedPaths[${pathIndex}]`,
      MAX_AGENT_CHANGED_PATH_LENGTH,
      index,
      legacy,
      true,
    );
    migrated ||= loaded.migrated;
    if (seen.has(loaded.value)) {
      if (!legacy) throw invalidJob(index, 'changedPaths entries must be unique');
      migrated = true;
      continue;
    }
    seen.add(loaded.value);
    paths.push(loaded.value);
  }
  return { value: paths, migrated };
}

function readProgress(value: JobRecord, index: number, legacy: boolean): LoadedValue<string[]> {
  if (!hasOwn(value, 'progress')) {
    if (!legacy) throw invalidJob(index, 'progress must be an array');
    return { value: [], migrated: true };
  }
  if (!Array.isArray(value.progress)) throw invalidJob(index, 'progress must be an array');
  if (!legacy && value.progress.length > MAX_AGENT_PROGRESS_ENTRIES) {
    throw invalidJob(index, `progress must contain ${MAX_AGENT_PROGRESS_ENTRIES} entries or fewer`);
  }

  const source = legacy ? value.progress.slice(-MAX_AGENT_PROGRESS_ENTRIES) : value.progress;
  let migrated = legacy && source.length !== value.progress.length;
  const progress: string[] = [];
  for (const [entryIndex, entry] of source.entries()) {
    const loaded = readText(
      entry,
      `progress[${entryIndex}]`,
      MAX_AGENT_PROGRESS_MESSAGE_LENGTH,
      index,
      legacy,
      false,
    );
    migrated ||= loaded.migrated;
    if (loaded.value) progress.push(loaded.value);
    else if (!legacy) throw invalidJob(index, `progress[${entryIndex}] must be non-empty`);
  }
  return { value: progress, migrated };
}

function readOptionalText(
  record: JobRecord,
  field: string,
  maxLength: number,
  index: number,
  legacy: boolean,
): LoadedValue<string | undefined> {
  if (!hasOwn(record, field) || record[field] === undefined) {
    return { value: undefined, migrated: false };
  }
  return readText(record[field], field, maxLength, index, legacy, false);
}

function readRequiredText(
  value: unknown,
  field: string,
  maxLength: number,
  index: number,
  legacy: boolean,
): LoadedValue<string> {
  const loaded = readText(value, field, maxLength, index, legacy, true);
  if (!loaded.value) throw invalidJob(index, `${field} must be non-empty`);
  return loaded as LoadedValue<string>;
}

function readText(
  value: unknown,
  field: string,
  maxLength: number,
  index: number,
  legacy: boolean,
  required: boolean,
): LoadedValue<string> {
  if (typeof value !== 'string') throw invalidJob(index, `${field} must be a string`);

  const normalized = legacy ? value.replace(CONTROL_CHARACTERS, '').trim() : value;
  if (!normalized || (required && !normalized.trim())) {
    if (legacy && !required) return { value: '', migrated: normalized !== value };
    throw invalidJob(index, `${field} must be non-empty`);
  }
  if (!legacy && normalized.trim() === '') throw invalidJob(index, `${field} must be non-empty`);
  if (!legacy && CONTROL_CHARACTERS.test(normalized)) {
    CONTROL_CHARACTERS.lastIndex = 0;
    throw invalidJob(index, `${field} contains unsupported control characters`);
  }
  CONTROL_CHARACTERS.lastIndex = 0;

  if (normalized.length > maxLength) {
    if (!legacy) throw invalidJob(index, `${field} must be ${maxLength} characters or fewer`);
    return { value: normalized.slice(0, maxLength), migrated: true };
  }

  return { value: normalized, migrated: legacy && normalized !== value };
}

function readTimestamp(value: unknown, field: string, index: number, legacy: boolean): LoadedValue<string> {
  if (typeof value !== 'string' || !value.trim()) {
    throw invalidJob(index, `${field} must be a valid timestamp`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw invalidJob(index, `${field} must be a valid timestamp`);
  const normalized = new Date(milliseconds).toISOString();
  return { value: legacy ? normalized : value, migrated: legacy && normalized !== value };
}

function readOptionalTimestamp(
  record: JobRecord,
  field: string,
  index: number,
  legacy: boolean,
): LoadedValue<string | undefined> {
  if (!hasOwn(record, field) || record[field] === undefined) {
    return { value: undefined, migrated: false };
  }
  return readTimestamp(record[field], field, index, legacy);
}

function readEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
  index: number,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw invalidJob(index, `${field} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function validateParentScopes(jobs: AgentJob[]): void {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  for (const [index, job] of jobs.entries()) {
    if (!job.parentJobId) continue;
    if (job.parentJobId === job.id) throw invalidJob(index, 'parentJobId must not equal id');

    const parent = byId.get(job.parentJobId);
    if (!parent || !job.tenantId || !parent.tenantId) continue;
    if (
      parent.tenantId !== job.tenantId
      || parent.requesterId !== job.requesterId
      || parent.conversationId !== job.conversationId
    ) {
      throw invalidJob(index, 'parentJobId must belong to the same tenant and conversation scope');
    }
  }
}

function isRecord(value: unknown): value is JobRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasOwn(record: JobRecord, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, field);
}

function invalidJob(index: number, reason: string): Error {
  return new Error(`Invalid agent job store format: record ${index}: ${reason}`);
}
