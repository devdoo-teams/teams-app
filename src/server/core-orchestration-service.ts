import crypto from 'node:crypto';

import type { AgentJob, AgentJobMode, AgentJobScope } from './agent-job-store.js';
import {
  AgentJobIdempotencyConflictError,
  AgentJobIdempotentReplayError,
  MAX_AGENT_IDEMPOTENCY_KEY_LENGTH,
  MAX_AGENT_PROMPT_LENGTH,
  MAX_AGENT_SCOPE_VALUE_LENGTH,
} from './agent-job-store.js';
import type {
  CoreJobRequest,
  CoreListRequest,
  CoreOrchestrationJob,
  CoreProviderFact,
  CoreProvideInputRequest,
  CoreProvideInputResult,
  CoreSubmitRequest,
  CoreSubmitResult,
} from '../shared/core-orchestration.js';
import {
  CoreOrchestrationIdempotencyConflictError,
  CoreOrchestrationValidationError,
} from '../shared/core-orchestration.js';

const SERVER_SCOPE = Symbol('server-derived-core-orchestration-scope');
const MAX_LIST_LIMIT = 100;
const UNSUPPORTED_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const SUBMISSION_LOCKS = new WeakMap<CoreAgentJobStorePort, Map<string, Promise<void>>>();

export type ServerDerivedCoreScope = Readonly<AgentJobScope & { [SERVER_SCOPE]: true }>;

export function createServerDerivedCoreScope(scope: AgentJobScope): ServerDerivedCoreScope {
  for (const name of ['tenantId', 'requesterId', 'conversationId'] as const) {
    const value = scope?.[name];
    if (typeof value !== 'string'
      || !value.trim()
      || value.length > MAX_AGENT_SCOPE_VALUE_LENGTH
      || UNSUPPORTED_CONTROL_CHARACTERS.test(value)) {
      throw new CoreOrchestrationValidationError(`${name} must be a non-empty server-derived value.`);
    }
  }
  return Object.freeze({ ...scope, [SERVER_SCOPE]: true }) as ServerDerivedCoreScope;
}

export interface CoreAgentServicePort {
  submit(input: {
    prompt: string;
    provider?: 'codex' | 'copilot';
    mode: AgentJobMode;
    scope: AgentJobScope;
    idempotencyKey?: string;
    requestHash?: string;
  }): Promise<AgentJob>;
  get(id: string, scope: AgentJobScope): AgentJob | undefined;
  list(scope: AgentJobScope, limit?: number): AgentJob[];
  cancelStrict(id: string, scope: AgentJobScope): Promise<AgentJob | undefined>;
  approve(id: string, scope: AgentJobScope): Promise<AgentJob | undefined>;
  retry(id: string, scope: AgentJobScope): Promise<AgentJob | undefined>;
}

export interface CoreAgentJobStorePort {
  resolveIdempotentSubmission(
    scope: AgentJobScope,
    idempotencyKey: string,
    requestHash: string,
  ): AgentJob | undefined;
}

export type CoreOrchestrationServiceOptions = Readonly<{
  agentService: CoreAgentServicePort;
  jobStore: CoreAgentJobStorePort;
  observeProviderFacts?: () => readonly CoreProviderFact[];
}>;

export class CoreOrchestrationService {
  constructor(private readonly options: CoreOrchestrationServiceOptions) {}

  async submit(scope: ServerDerivedCoreScope, request: CoreSubmitRequest): Promise<CoreSubmitResult> {
    assertServerScope(scope);
    assertNoClientScope(request);
    const normalized = normalizeSubmitRequest(request);
    const requestHash = canonicalRequestHash(normalized);
    return withSubmissionLock(this.options.jobStore, scope, request.idempotencyKey, async () => {
      try {
        const existing = this.options.jobStore.resolveIdempotentSubmission(
          scope,
          request.idempotencyKey,
          requestHash,
        );
        if (existing) return { job: toCoreJob(existing), replayed: true, requestHash };

        const job = await this.options.agentService.submit({
          ...normalized,
          scope,
          idempotencyKey: request.idempotencyKey,
          requestHash,
        });
        return { job: toCoreJob(job), replayed: false, requestHash };
      } catch (error) {
        if (error instanceof AgentJobIdempotentReplayError) {
          return { job: toCoreJob(error.job), replayed: true, requestHash };
        }
        if (error instanceof AgentJobIdempotencyConflictError) {
          throw new CoreOrchestrationIdempotencyConflictError(error.idempotencyKey);
        }
        throw error;
      }
    });
  }

  get(scope: ServerDerivedCoreScope, request: CoreJobRequest): CoreOrchestrationJob | undefined {
    assertServerScope(scope);
    assertNoClientScope(request);
    return mapOptional(this.options.agentService.get(normalizeJobId(request.jobId), scope));
  }

  list(scope: ServerDerivedCoreScope, request: CoreListRequest = {}): CoreOrchestrationJob[] {
    assertServerScope(scope);
    assertNoClientScope(request);
    const limit = request.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
      throw new CoreOrchestrationValidationError(`limit must be an integer from 1 to ${MAX_LIST_LIMIT}.`);
    }
    return this.options.agentService.list(scope, limit).map(toCoreJob);
  }

  async cancel(scope: ServerDerivedCoreScope, request: CoreJobRequest): Promise<CoreOrchestrationJob | undefined> {
    return this.mutate(scope, request, (id) => this.options.agentService.cancelStrict(id, scope));
  }

  async approve(scope: ServerDerivedCoreScope, request: CoreJobRequest): Promise<CoreOrchestrationJob | undefined> {
    return this.mutate(scope, request, (id) => this.options.agentService.approve(id, scope));
  }

  async retry(scope: ServerDerivedCoreScope, request: CoreJobRequest): Promise<CoreOrchestrationJob | undefined> {
    return this.mutate(scope, request, (id) => this.options.agentService.retry(id, scope));
  }

  async provideInput(
    scope: ServerDerivedCoreScope,
    request: CoreProvideInputRequest,
  ): Promise<CoreProvideInputResult | undefined> {
    assertServerScope(scope);
    assertNoClientScope(request);
    const job = this.options.agentService.get(normalizeJobId(request.jobId), scope);
    if (!job) return undefined;
    return {
      status: 'unsupported',
      job: toCoreJob(job),
      reason: 'agent-service-does-not-support-input',
    };
  }

  listProviderFacts(): CoreProviderFact[] {
    return (this.options.observeProviderFacts?.() ?? []).map(validateProviderFact);
  }

  private async mutate(
    scope: ServerDerivedCoreScope,
    request: CoreJobRequest,
    operation: (id: string) => Promise<AgentJob | undefined>,
  ): Promise<CoreOrchestrationJob | undefined> {
    assertServerScope(scope);
    assertNoClientScope(request);
    return mapOptional(await operation(normalizeJobId(request.jobId)));
  }
}

async function withSubmissionLock<T>(
  store: CoreAgentJobStorePort,
  scope: AgentJobScope,
  idempotencyKey: string,
  operation: () => Promise<T>,
): Promise<T> {
  let locks = SUBMISSION_LOCKS.get(store);
  if (!locks) {
    locks = new Map();
    SUBMISSION_LOCKS.set(store, locks);
  }
  const key = JSON.stringify([scope.tenantId, scope.requesterId, scope.conversationId, idempotencyKey]);
  const previous = locks.get(key) ?? Promise.resolve();
  const result = previous.then(operation);
  const tail = result.then(() => undefined, () => undefined);
  locks.set(key, tail);
  try {
    return await result;
  } finally {
    if (locks.get(key) === tail) locks.delete(key);
  }
}

export function canonicalRequestHash(request: Omit<CoreSubmitRequest, 'idempotencyKey'>): string {
  return crypto.createHash('sha256').update(stableStringify(request), 'utf8').digest('hex');
}

function normalizeSubmitRequest(request: CoreSubmitRequest): Omit<CoreSubmitRequest, 'idempotencyKey'> {
  if (typeof request.idempotencyKey !== 'string'
    || !request.idempotencyKey.trim()
    || request.idempotencyKey.trim() !== request.idempotencyKey
    || request.idempotencyKey.length > MAX_AGENT_IDEMPOTENCY_KEY_LENGTH
    || UNSUPPORTED_CONTROL_CHARACTERS.test(request.idempotencyKey)) {
    throw new CoreOrchestrationValidationError(`idempotencyKey must be 1-${MAX_AGENT_IDEMPOTENCY_KEY_LENGTH} characters.`);
  }
  if (typeof request.prompt !== 'string'
    || !request.prompt.trim()
    || request.prompt.trim().length > MAX_AGENT_PROMPT_LENGTH
    || UNSUPPORTED_CONTROL_CHARACTERS.test(request.prompt)) {
    throw new CoreOrchestrationValidationError('prompt must be a non-empty string.');
  }
  if (request.mode !== 'read-only' && request.mode !== 'workspace-write') {
    throw new CoreOrchestrationValidationError('mode is invalid.');
  }
  if (request.provider !== undefined && request.provider !== 'codex' && request.provider !== 'copilot') {
    throw new CoreOrchestrationValidationError('provider is invalid.');
  }
  return {
    prompt: request.prompt.trim(),
    ...(request.provider ? { provider: request.provider } : {}),
    mode: request.mode,
  };
}

function normalizeJobId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CoreOrchestrationValidationError('jobId must be a non-empty string.');
  }
  return value.trim();
}

function assertServerScope(scope: ServerDerivedCoreScope): void {
  if (!scope || scope[SERVER_SCOPE] !== true) {
    throw new CoreOrchestrationValidationError('A server-derived orchestration scope is required.');
  }
}

function assertNoClientScope(request: object): void {
  if (!request || typeof request !== 'object') {
    throw new CoreOrchestrationValidationError('Request must be an object.');
  }
  for (const field of ['scope', 'tenantId', 'requesterId', 'conversationId']) {
    if (field in request) {
      throw new CoreOrchestrationValidationError(`${field} must be derived by the server, not supplied in the request.`);
    }
  }
}

function toCoreJob(job: AgentJob): CoreOrchestrationJob {
  return {
    id: job.id,
    ...(job.idempotencyKey ? { idempotencyKey: job.idempotencyKey } : {}),
    prompt: job.prompt,
    ...(job.provider ? { provider: job.provider } : {}),
    mode: job.mode,
    status: job.status,
    ...(job.parentJobId ? { parentJobId: job.parentJobId } : {}),
    ...(job.threadId ? { threadId: job.threadId } : {}),
    ...(job.result ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
    progress: [...job.progress],
    createdAt: job.createdAt,
    ...(job.startedAt ? { startedAt: job.startedAt } : {}),
    ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
  };
}

function mapOptional(job: AgentJob | undefined): CoreOrchestrationJob | undefined {
  return job ? toCoreJob(job) : undefined;
}

function validateProviderFact(fact: CoreProviderFact): CoreProviderFact {
  if (!fact || typeof fact !== 'object') {
    throw new CoreOrchestrationValidationError('Provider fact must be an object.');
  }
  if (fact.source !== 'runtime-probe' && fact.source !== 'runtime-observation') {
    throw new CoreOrchestrationValidationError('Provider facts require a measured runtime source.');
  }
  if (!['available', 'unavailable', 'unknown'].includes(fact.availability)) {
    throw new CoreOrchestrationValidationError('Provider availability is invalid.');
  }
  if (typeof fact.provider !== 'string'
    || !fact.provider.trim()
    || typeof fact.observedAt !== 'string'
    || !Number.isFinite(Date.parse(fact.observedAt))) {
    throw new CoreOrchestrationValidationError('Provider facts require provider and observedAt values.');
  }
  if (!Array.isArray(fact.capabilities)
    || fact.capabilities.some((capability) => typeof capability !== 'string' || !capability.trim())) {
    throw new CoreOrchestrationValidationError('Provider capabilities must contain measured capability names.');
  }
  return Object.freeze({
    provider: fact.provider,
    availability: fact.availability,
    capabilities: Object.freeze([...fact.capabilities]),
    observedAt: fact.observedAt,
    source: fact.source,
  });
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
