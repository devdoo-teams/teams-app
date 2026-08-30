import crypto from 'node:crypto';

import { atomicWriteJson, readAtomicJsonStore } from './atomic-file.js';
import type { AgentJobScope, AgentJobStatus } from './agent-job-store.js';
import type { CliAgentProvider } from './cli-agent-runner.js';
import { redactSensitiveText } from './sensitive-text.js';

/**
 * Durable, server-owned audit events for agent work.  This is deliberately a
 * Teams/Core seam rather than a provider protocol: Codex, Copilot, and future
 * remote providers use the same event shape and scope boundary.
 */
export const AGENT_EVENT_SCHEMA_VERSION = 1 as const;
export const MAX_AGENT_EVENT_MESSAGE_LENGTH = 4_000;
export const MAX_AGENT_EVENT_CORRELATION_LENGTH = 256;
export const MAX_AGENT_EVENT_RECORDS = 20_000;
export const MAX_AGENT_EVENT_LIST_LIMIT = 200;

const EVENT_KINDS = [
  'submitted',
  'approval-required',
  'approved',
  'started',
  'progress',
  'result',
  'error',
  'cancelled',
  'retry',
  'commit',
  'reconciled',
] as const;

const EVENT_PHASES = [
  'submission',
  'approval',
  'execution',
  'analysis',
  'tools',
  'agent-update',
  'completion',
  'failure',
  'cancellation',
  'commit',
  'reconciliation',
] as const;

export type AgentEventKind = typeof EVENT_KINDS[number];
export type AgentEventPhase = typeof EVENT_PHASES[number];

export type AgentEventInput = Readonly<{
  jobId: string;
  scope: AgentJobScope;
  provider?: CliAgentProvider;
  status: AgentJobStatus;
  kind: AgentEventKind;
  phase: AgentEventPhase;
  /** Stable per-job key. Replaying it with the same payload is idempotent. */
  correlationId: string;
  message: string;
  parentJobId?: string;
}>;

export type AgentEvent = Readonly<{
  id: string;
  sequence: number;
  jobId: string;
  scope: AgentJobScope;
  provider?: CliAgentProvider;
  status: AgentJobStatus;
  kind: AgentEventKind;
  phase: AgentEventPhase;
  correlationId: string;
  message: string;
  parentJobId?: string;
  createdAt: string;
}>;

export type AgentEventStoreSnapshot = Readonly<{
  schemaVersion: typeof AGENT_EVENT_SCHEMA_VERSION;
  nextSequence: number;
  droppedEvents: number;
  events: readonly AgentEvent[];
}>;

export type AgentEventStoreOptions = Readonly<{
  maxEvents?: number;
}>;

export class AgentEventStoreConflictError extends Error {
  readonly code = 'AGENT_EVENT_IDEMPOTENCY_CONFLICT' as const;

  constructor(readonly jobId: string, readonly correlationId: string) {
    super(`Agent event correlation key is already bound to a different payload: ${jobId}/${correlationId}`);
    this.name = 'AgentEventStoreConflictError';
  }
}

type EventStoreFile = {
  schemaVersion: typeof AGENT_EVENT_SCHEMA_VERSION;
  nextSequence: number;
  droppedEvents: number;
  events: AgentEvent[];
};

type LoadedState = {
  state: EventStoreFile;
  migrated: boolean;
};

export class AgentEventStore {
  private state: EventStoreFile = emptyState();
  private writeChain: Promise<void> = Promise.resolve();
  private initialized = false;
  private initialization?: Promise<void>;

  constructor(
    private readonly filePath: string,
    private readonly options: AgentEventStoreOptions = {},
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initialization) return this.initialization;

    this.initialization = this.writeChain.then(async () => {
      const previousState = cloneState(this.state);
      try {
        let loaded: LoadedState;
        try {
          const raw = await readAtomicJsonStore(this.filePath);
          loaded = loadState(JSON.parse(raw) as unknown, this.filePath);
        } catch (error: unknown) {
          if (!isFileNotFound(error)) throw error;
          loaded = { state: emptyState(), migrated: false };
          await atomicWriteJson(this.filePath, loaded.state);
        }

        if (loaded.migrated) await atomicWriteJson(this.filePath, loaded.state);
        this.state = loaded.state;
        this.initialized = true;
      } catch (error) {
        this.state = previousState;
        this.initialized = false;
        throw error;
      }
    });
    this.writeChain = this.initialization.then(() => undefined, () => undefined);
    try {
      await this.initialization;
    } finally {
      this.initialization = undefined;
    }
  }

  async append(input: AgentEventInput): Promise<AgentEvent> {
    this.assertInitialized();
    const normalized = normalizeInput(input);
    const eventFingerprint = fingerprint(normalized);

    return this.enqueueMutation(() => {
      const existing = this.state.events.find((event) =>
        event.jobId === normalized.jobId
        && sameScope(event.scope, normalized.scope)
        && event.correlationId === normalized.correlationId,
      );
      if (existing) {
        if (fingerprint(existing) !== eventFingerprint) {
          throw new AgentEventStoreConflictError(normalized.jobId, normalized.correlationId);
        }
        return cloneEvent(existing);
      }

      const event: AgentEvent = {
        id: `agent-event-${this.state.nextSequence.toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
        sequence: this.state.nextSequence,
        jobId: normalized.jobId,
        scope: cloneScope(normalized.scope),
        ...(normalized.provider ? { provider: normalized.provider } : {}),
        status: normalized.status,
        kind: normalized.kind,
        phase: normalized.phase,
        correlationId: normalized.correlationId,
        message: normalized.message,
        ...(normalized.parentJobId ? { parentJobId: normalized.parentJobId } : {}),
        createdAt: new Date().toISOString(),
      };

      this.state.events.push(event);
      this.state.nextSequence += 1;
      const maxEvents = this.maxEvents();
      while (this.state.events.length > maxEvents) {
        this.state.events.shift();
        this.state.droppedEvents += 1;
      }
      return cloneEvent(event);
    });
  }

  /** Return chronological events for a job, restricted to its full owner scope. */
  list(scope: AgentJobScope, jobId: string, limit = MAX_AGENT_EVENT_LIST_LIMIT): AgentEvent[] {
    this.assertInitialized();
    const normalizedScope = validateScope(scope);
    const normalizedJobId = validateOpaqueText(jobId, 'jobId', 200);
    const normalizedLimit = validateLimit(limit);
    return this.state.events
      .filter((event) => event.jobId === normalizedJobId && sameScope(event.scope, normalizedScope))
      .slice(-normalizedLimit)
      .map(cloneEvent);
  }

  snapshot(): AgentEventStoreSnapshot {
    this.assertInitialized();
    return Object.freeze({
      schemaVersion: this.state.schemaVersion,
      nextSequence: this.state.nextSequence,
      droppedEvents: this.state.droppedEvents,
      events: Object.freeze(this.state.events.map(cloneEvent)),
    });
  }

  private maxEvents(): number {
    const configured = this.options.maxEvents ?? MAX_AGENT_EVENT_RECORDS;
    if (!Number.isSafeInteger(configured) || configured < 1) {
      throw new Error(`Agent event maxEvents must be an integer between 1 and ${MAX_AGENT_EVENT_RECORDS}.`);
    }
    return Math.min(configured, MAX_AGENT_EVENT_RECORDS);
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('AgentEventStore.initialize() must complete before use.');
  }

  private enqueueMutation<T>(mutate: () => T): Promise<T> {
    const operation = this.writeChain.then(async () => {
      const previousState = cloneState(this.state);
      let result: T;
      let nextState: EventStoreFile;
      try {
        this.state = cloneState(previousState);
        result = mutate();
        nextState = cloneState(this.state);
      } catch (error) {
        this.state = previousState;
        throw error;
      }
      this.state = previousState;
      try {
        await atomicWriteJson(this.filePath, nextState);
      } catch (error) {
        this.state = previousState;
        throw error;
      }
      this.state = nextState;
      return result;
    });
    this.writeChain = operation.then(() => undefined, () => undefined);
    return operation;
  }
}

function emptyState(): EventStoreFile {
  return {
    schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
    nextSequence: 1,
    droppedEvents: 0,
    events: [],
  };
}

function normalizeInput(input: AgentEventInput): AgentEventInput {
  if (!input || typeof input !== 'object') throw new Error('Agent event input must be an object.');
  const jobId = validateOpaqueText(input.jobId, 'jobId', 200);
  const scope = validateScope(input.scope);
  const correlationId = validateOpaqueText(input.correlationId, 'correlationId', MAX_AGENT_EVENT_CORRELATION_LENGTH);
  const message = redactSensitiveText(validateMessage(input.message));
  const parentJobId = input.parentJobId === undefined
    ? undefined
    : validateOpaqueText(input.parentJobId, 'parentJobId', 200);
  if (!EVENT_KINDS.includes(input.kind)) throw new Error('Agent event kind is invalid.');
  if (!EVENT_PHASES.includes(input.phase)) throw new Error('Agent event phase is invalid.');
  if (!['queued', 'awaiting_approval', 'running', 'completed', 'failed', 'cancelled'].includes(input.status)) {
    throw new Error('Agent event status is invalid.');
  }
  if (input.provider !== undefined && input.provider !== 'codex' && input.provider !== 'copilot') {
    throw new Error('Agent event provider is invalid.');
  }
  return {
    jobId,
    scope,
    ...(input.provider ? { provider: input.provider } : {}),
    status: input.status,
    kind: input.kind,
    phase: input.phase,
    correlationId,
    message,
    ...(parentJobId ? { parentJobId } : {}),
  };
}

function validateScope(value: AgentJobScope): AgentJobScope {
  if (!value || typeof value !== 'object') throw new Error('Agent event scope must be an object.');
  return {
    requesterId: validateOpaqueText(value.requesterId, 'scope.requesterId', 256),
    conversationId: validateOpaqueText(value.conversationId, 'scope.conversationId', 256),
    tenantId: validateOpaqueText(value.tenantId, 'scope.tenantId', 256),
  };
}

function validateMessage(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Agent event message must be a string.');
  const normalized = value.replace(/\r\n/gu, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, '').trim();
  if (!normalized || normalized.length > MAX_AGENT_EVENT_MESSAGE_LENGTH) {
    throw new Error(`Agent event message must contain 1-${MAX_AGENT_EVENT_MESSAGE_LENGTH} characters.`);
  }
  return normalized;
}

function validateOpaqueText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    throw new Error(`Agent event ${field} is invalid.`);
  }
  return value.trim();
}

function validateLimit(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_AGENT_EVENT_LIST_LIMIT) {
    throw new Error(`Agent event list limit must be between 1 and ${MAX_AGENT_EVENT_LIST_LIMIT}.`);
  }
  return value as number;
}

function loadState(value: unknown, filePath: string): LoadedState {
  const record = asRecord(value, `Invalid agent event store format: ${filePath}`);
  assertKeys(record, ['schemaVersion', 'nextSequence', 'droppedEvents', 'events'], filePath);
  if (record.schemaVersion !== AGENT_EVENT_SCHEMA_VERSION) {
    throw new Error(`Invalid agent event store format: unsupported schema in ${filePath}`);
  }
  if (!Number.isSafeInteger(record.nextSequence) || (record.nextSequence as number) < 1) {
    throw new Error(`Invalid agent event store format: nextSequence in ${filePath}`);
  }
  if (!Number.isSafeInteger(record.droppedEvents) || (record.droppedEvents as number) < 0) {
    throw new Error(`Invalid agent event store format: droppedEvents in ${filePath}`);
  }
  if (!Array.isArray(record.events) || record.events.length > MAX_AGENT_EVENT_RECORDS) {
    throw new Error(`Invalid agent event store format: events in ${filePath}`);
  }

  let migrated = false;
  const events = record.events.map((entry, index) => {
    const loaded = loadEvent(entry, index, filePath);
    migrated ||= loaded.migrated;
    return loaded.event;
  });
  let previousSequence = 0;
  for (const event of events) {
    if (event.sequence <= previousSequence || event.sequence >= (record.nextSequence as number)) {
      throw new Error(`Invalid agent event store format: event sequence in ${filePath}`);
    }
    previousSequence = event.sequence;
  }

  return {
    state: {
      schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
      nextSequence: record.nextSequence as number,
      droppedEvents: record.droppedEvents as number,
      events,
    },
    migrated,
  };
}

function loadEvent(value: unknown, index: number, filePath: string): { event: AgentEvent; migrated: boolean } {
  const record = asRecord(value, `Invalid agent event store format: event ${index} in ${filePath}`);
  assertKeys(record, [
    'id',
    'sequence',
    'jobId',
    'scope',
    'status',
    'kind',
    'phase',
    'correlationId',
    'message',
    'createdAt',
  ], filePath, ['provider', 'parentJobId']);
  if (!Number.isSafeInteger(record.sequence) || (record.sequence as number) < 1) {
    throw new Error(`Invalid agent event store format: event sequence ${index} in ${filePath}`);
  }
  const id = validateOpaqueText(record.id, `events[${index}].id`, 256);
  const jobId = validateOpaqueText(record.jobId, `events[${index}].jobId`, 200);
  const scope = validateScope(record.scope as AgentJobScope);
  const correlationId = validateOpaqueText(record.correlationId, `events[${index}].correlationId`, MAX_AGENT_EVENT_CORRELATION_LENGTH);
  const originalMessage = validateMessage(record.message);
  const message = redactSensitiveText(originalMessage);
  if (!EVENT_KINDS.includes(record.kind as AgentEventKind) || !EVENT_PHASES.includes(record.phase as AgentEventPhase)) {
    throw new Error(`Invalid agent event store format: event kind or phase ${index} in ${filePath}`);
  }
  if (!['queued', 'awaiting_approval', 'running', 'completed', 'failed', 'cancelled'].includes(record.status as string)) {
    throw new Error(`Invalid agent event store format: event status ${index} in ${filePath}`);
  }
  if (record.provider !== undefined && record.provider !== 'codex' && record.provider !== 'copilot') {
    throw new Error(`Invalid agent event store format: event provider ${index} in ${filePath}`);
  }
  const parentJobId = record.parentJobId === undefined
    ? undefined
    : validateOpaqueText(record.parentJobId, `events[${index}].parentJobId`, 200);
  if (typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))) {
    throw new Error(`Invalid agent event store format: event timestamp ${index} in ${filePath}`);
  }

  return {
    event: {
      id,
      sequence: record.sequence as number,
      jobId,
      scope,
      ...(record.provider ? { provider: record.provider as CliAgentProvider } : {}),
      status: record.status as AgentJobStatus,
      kind: record.kind as AgentEventKind,
      phase: record.phase as AgentEventPhase,
      correlationId,
      message,
      ...(parentJobId ? { parentJobId } : {}),
      createdAt: new Date(record.createdAt).toISOString(),
    },
    migrated: message !== originalMessage || new Date(record.createdAt).toISOString() !== record.createdAt,
  };
}

function fingerprint(value: Pick<AgentEvent, 'jobId' | 'scope' | 'provider' | 'status' | 'kind' | 'phase' | 'correlationId' | 'message' | 'parentJobId'>): string {
  return JSON.stringify({
    jobId: value.jobId,
    scope: value.scope,
    provider: value.provider,
    status: value.status,
    kind: value.kind,
    phase: value.phase,
    correlationId: value.correlationId,
    message: value.message,
    parentJobId: value.parentJobId,
  });
}

function sameScope(left: AgentJobScope, right: AgentJobScope): boolean {
  return left.requesterId === right.requesterId
    && left.conversationId === right.conversationId
    && left.tenantId === right.tenantId;
}

function cloneScope(scope: AgentJobScope): AgentJobScope {
  return {
    requesterId: scope.requesterId,
    conversationId: scope.conversationId,
    tenantId: scope.tenantId,
  };
}

function cloneEvent(event: AgentEvent): AgentEvent {
  return { ...event, scope: cloneScope(event.scope) };
}

function cloneState(state: EventStoreFile): EventStoreFile {
  return { ...state, events: state.events.map(cloneEvent) };
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function assertKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  filePath: string,
  optional: readonly string[] = [],
): void {
  const actual = Object.keys(record).sort();
  const allowed = new Set([...required, ...optional]);
  if (actual.some((key) => !allowed.has(key)) || required.some((key) => !actual.includes(key))) {
    throw new Error(`Invalid agent event store format: unsupported fields in ${filePath}`);
  }
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
