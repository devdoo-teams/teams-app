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
  CoreOrchestrationProvider,
  CoreProviderFact,
  CoreProvideInputRequest,
  CoreProvideInputResult,
  CoreSubmitRequest,
  CoreSubmitResult,
} from '../shared/core-orchestration.js';
import {
  CoreOrchestrationIdempotencyConflictError,
  CoreOrchestrationProviderCapabilityError,
  CoreOrchestrationProviderUnavailableError,
  CoreOrchestrationValidationError,
} from '../shared/core-orchestration.js';

const SERVER_SCOPE = Symbol('server-derived-core-orchestration-scope');
const MAX_LIST_LIMIT = 100;
const MAX_PROVIDER_INPUT_BYTES = 8_192;
const MAX_PROVIDER_INPUT_DEPTH = 8;
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
  getForPrincipal?(
    id: string,
    principal: Pick<AgentJobScope, 'tenantId' | 'requesterId'>,
  ): AgentJob | undefined;
  list(scope: AgentJobScope, limit?: number): AgentJob[];
  listForPrincipal?(
    principal: Pick<AgentJobScope, 'tenantId' | 'requesterId'>,
    limit?: number,
  ): AgentJob[];
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
  getForPrincipal?(
    id: string,
    principal: Pick<AgentJobScope, 'tenantId' | 'requesterId'>,
  ): AgentJob | undefined;
  listForPrincipal?(
    principal: Pick<AgentJobScope, 'tenantId' | 'requesterId'>,
    limit?: number,
  ): AgentJob[];
}

export type CoreInputResumeObservation = Readonly<{
  supported: boolean;
  awaitingInput: boolean;
  source: 'runtime-probe' | 'runtime-observation';
  observedAt: string;
  reason?: 'provider-input-unsupported' | 'job-not-awaiting-input';
}>;

/** A provider-specific port whose support and task state are measured at call time. */
export interface CoreInputResumePort {
  observe(job: AgentJob, scope: AgentJobScope): CoreInputResumeObservation | Promise<CoreInputResumeObservation>;
  resume(job: AgentJob, scope: AgentJobScope, input: unknown): Promise<AgentJob>;
}

export type CoreOrchestrationServiceOptions = Readonly<{
  agentService: CoreAgentServicePort;
  jobStore: CoreAgentJobStorePort;
  defaultProvider?: CoreOrchestrationProvider;
  observeProviderFacts?: () => readonly CoreProviderFact[];
  inputResume?: CoreInputResumePort;
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

        const provider = normalized.provider ?? this.defaultProvider();
        this.assertProviderCapability(provider, 'submit');
        const job = await this.options.agentService.submit({
          ...normalized,
          provider,
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
    const job = this.resolveJob(scope, normalizeJobId(request.jobId));
    return mapOptional(job && storedScopeForPrincipal(job, scope) ? job : undefined);
  }

  list(scope: ServerDerivedCoreScope, request: CoreListRequest = {}): CoreOrchestrationJob[] {
    assertServerScope(scope);
    assertNoClientScope(request);
    const limit = request.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
      throw new CoreOrchestrationValidationError(`limit must be an integer from 1 to ${MAX_LIST_LIMIT}.`);
    }
    const principal = { tenantId: scope.tenantId, requesterId: scope.requesterId };
    const jobs = this.options.agentService.listForPrincipal?.(principal, limit)
      ?? this.options.jobStore.listForPrincipal?.(principal, limit)
      ?? this.options.agentService.list(scope, limit);
    return jobs
      .filter((job) => Boolean(storedScopeForPrincipal(job, scope)))
      .map(toCoreJob);
  }

  async cancel(scope: ServerDerivedCoreScope, request: CoreJobRequest): Promise<CoreOrchestrationJob | undefined> {
    return this.mutate(scope, request, (job, storedScope) => this.options.agentService.cancelStrict(job.id, storedScope));
  }

  async approve(scope: ServerDerivedCoreScope, request: CoreJobRequest): Promise<CoreOrchestrationJob | undefined> {
    return this.mutate(scope, request, (job, storedScope) => {
      this.assertProviderCapability(this.providerForJob(job), 'approve');
      return this.options.agentService.approve(job.id, storedScope);
    });
  }

  async retry(scope: ServerDerivedCoreScope, request: CoreJobRequest): Promise<CoreOrchestrationJob | undefined> {
    return this.mutate(scope, request, (job, storedScope) => {
      this.assertProviderCapability(this.providerForJob(job), 'retry');
      return this.options.agentService.retry(job.id, storedScope);
    });
  }

  async provideInput(
    scope: ServerDerivedCoreScope,
    request: CoreProvideInputRequest,
  ): Promise<CoreProvideInputResult | undefined> {
    assertServerScope(scope);
    assertNoClientScope(request);
    const job = this.resolveJob(scope, normalizeJobId(request.jobId));
    if (!job) return undefined;
    const storedScope = storedScopeForPrincipal(job, scope);
    if (!storedScope) return undefined;
    if (!this.options.inputResume) {
      return {
        status: 'unsupported',
        job: toCoreJob(job),
        reason: 'agent-service-does-not-support-input',
      };
    }
    const observation = validateInputResumeObservation(
      await this.options.inputResume.observe(job, storedScope),
    );
    if (!observation.supported) {
      return {
        status: 'unsupported',
        job: toCoreJob(job),
        reason: 'provider-input-unsupported',
      };
    }
    if (!observation.awaitingInput) {
      return {
        status: 'unsupported',
        job: toCoreJob(job),
        reason: 'job-not-awaiting-input',
      };
    }
    const boundedInput = normalizeProviderInput(request.input);
    const resumed = await this.options.inputResume.resume(job, storedScope, boundedInput);
    assertSameDurableIdentity(job, resumed, storedScope);
    return {
      status: 'accepted',
      job: toCoreJob(resumed),
    };
  }

  listProviderFacts(): CoreProviderFact[] {
    return (this.options.observeProviderFacts?.() ?? []).map(validateProviderFact);
  }

  private async mutate(
    scope: ServerDerivedCoreScope,
    request: CoreJobRequest,
    operation: (job: AgentJob, storedScope: ServerDerivedCoreScope) => Promise<AgentJob | undefined>,
  ): Promise<CoreOrchestrationJob | undefined> {
    assertServerScope(scope);
    assertNoClientScope(request);
    const job = this.resolveJob(scope, normalizeJobId(request.jobId));
    if (!job) return undefined;
    const storedScope = storedScopeForPrincipal(job, scope);
    if (!storedScope) return undefined;
    return mapOptional(await operation(job, storedScope));
  }

  private resolveJob(scope: ServerDerivedCoreScope, id: string): AgentJob | undefined {
    const direct = this.options.agentService.get(id, scope);
    if (direct) return direct;
    const principal = { tenantId: scope.tenantId, requesterId: scope.requesterId };
    return this.options.agentService.getForPrincipal?.(id, principal)
      ?? this.options.jobStore.getForPrincipal?.(id, principal);
  }

  private defaultProvider(): CoreOrchestrationProvider {
    return this.options.defaultProvider ?? 'codex';
  }

  private providerForJob(job: AgentJob): CoreOrchestrationProvider {
    const provider = job.provider ?? this.defaultProvider();
    if (provider !== 'codex' && provider !== 'copilot') {
      throw new CoreOrchestrationProviderUnavailableError(String(provider), 'unknown');
    }
    return provider;
  }

  private assertProviderCapability(
    provider: CoreOrchestrationProvider,
    capability: string,
  ): void {
    const fact = this.listProviderFacts().find((candidate) => candidate.provider === provider);
    if (!fact || fact.availability !== 'available') {
      throw new CoreOrchestrationProviderUnavailableError(provider, fact?.availability ?? 'unknown');
    }
    if (!fact.capabilities.includes(capability)) {
      throw new CoreOrchestrationProviderCapabilityError(provider, capability);
    }
  }
}

function validateInputResumeObservation(observation: CoreInputResumeObservation): CoreInputResumeObservation {
  if (!observation || typeof observation !== 'object'
    || typeof observation.supported !== 'boolean'
    || typeof observation.awaitingInput !== 'boolean'
    || (observation.source !== 'runtime-probe' && observation.source !== 'runtime-observation')
    || typeof observation.observedAt !== 'string'
    || !Number.isFinite(Date.parse(observation.observedAt))) {
    throw new CoreOrchestrationValidationError('Input resume support requires a measured runtime observation.');
  }
  return observation;
}

function storedScopeForPrincipal(
  job: AgentJob,
  principal: Pick<AgentJobScope, 'tenantId' | 'requesterId'>,
): ServerDerivedCoreScope | undefined {
  if (typeof job.tenantId !== 'string'
    || job.tenantId !== principal.tenantId
    || job.requesterId !== principal.requesterId) {
    return undefined;
  }
  return createServerDerivedCoreScope({
    tenantId: job.tenantId,
    requesterId: job.requesterId,
    conversationId: job.conversationId,
  });
}

function normalizeProviderInput(value: unknown): unknown {
  assertJsonValue(value, 0);
  const serialized = JSON.stringify(value);
  if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > MAX_PROVIDER_INPUT_BYTES) {
    throw new CoreOrchestrationValidationError(`input must be JSON and at most ${MAX_PROVIDER_INPUT_BYTES} bytes.`);
  }
  return JSON.parse(serialized) as unknown;
}

function assertJsonValue(value: unknown, depth: number): void {
  if (depth > MAX_PROVIDER_INPUT_DEPTH) {
    throw new CoreOrchestrationValidationError(`input JSON depth must not exceed ${MAX_PROVIDER_INPUT_DEPTH}.`);
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CoreOrchestrationValidationError('input must contain only JSON objects.');
    }
    for (const item of Object.values(value as Record<string, unknown>)) assertJsonValue(item, depth + 1);
    return;
  }
  throw new CoreOrchestrationValidationError('input must be JSON-safe.');
}

function assertSameDurableIdentity(previous: AgentJob, resumed: AgentJob, scope: AgentJobScope): void {
  if (!resumed
    || resumed.id !== previous.id
    || resumed.tenantId !== scope.tenantId
    || resumed.requesterId !== scope.requesterId
    || resumed.conversationId !== scope.conversationId) {
    throw new CoreOrchestrationValidationError('Input resume must preserve the durable job identity and scope.');
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
