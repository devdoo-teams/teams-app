import crypto from 'node:crypto';

import { atomicWriteJson, readAtomicJsonStore } from './atomic-file.js';

const SCHEMA_VERSION = 1 as const;
const MAX_RECORDS = 10_000;
const MAX_KEY_LENGTH = 256;
const MAX_PRINCIPAL_LENGTH = 512;
const MAX_RESULT_BYTES = 48 * 1024;
const MAX_FINGERPRINT_LENGTH = 128;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const VALUE = /^[^\u0000-\u001f\u007f]{1,512}$/u;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const FINGERPRINT = /^[a-f0-9]{64}$/u;

export type ProviderMutationReplayScope = Readonly<{
  tenantId: string;
  requesterId: string;
  provider: string;
}>;

export type ProviderMutationReplayInput = Readonly<{
  scope: ProviderMutationReplayScope;
  mutationKey: string;
  fingerprint: string;
}>;

export type ProviderMutationReplayResult<T> = Readonly<{
  replayed: boolean;
  result: T;
}>;

type ReplayRecordBase = Readonly<{
  scope: ProviderMutationReplayScope;
  mutationKey: string;
  fingerprint: string;
  createdAt: string;
  updatedAt: string;
}>;

type PendingRecord = ReplayRecordBase & Readonly<{
  status: 'pending';
}>;

type CompletedRecord = ReplayRecordBase & Readonly<{
  status: 'completed';
  result: string;
}>;

type ReplayRecord = PendingRecord | CompletedRecord;

type ReplayState = {
  schemaVersion: typeof SCHEMA_VERSION;
  records: Record<string, ReplayRecord>;
};

export class ProviderMutationReplayConflictError extends Error {
  readonly code = 'MUTATION_IDEMPOTENCY_CONFLICT' as const;

  constructor(message = 'The mutation key is already bound to a different request fingerprint.') {
    super(message);
    this.name = 'ProviderMutationReplayConflictError';
  }
}

export class ProviderMutationReplayInFlightError extends Error {
  readonly code = 'MUTATION_IN_FLIGHT' as const;

  constructor(message = 'The mutation is already in flight for this principal.') {
    super(message);
    this.name = 'ProviderMutationReplayInFlightError';
  }
}

export class ProviderMutationReplayStore {
  private state: ReplayState = createEmptyState();
  private writeChain: Promise<void> = Promise.resolve();
  private initialized = false;
  private initialization?: Promise<void>;
  private readonly inFlight = new Map<string, { fingerprint: string; promise: Promise<ProviderMutationReplayResult<unknown>> }>();

  constructor(
    private readonly filePath: string,
    private readonly options: Readonly<{ ttlMs?: number }> = {},
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initialization) return this.initialization;
    this.initialization = (async () => {
      const previous = this.state;
      try {
        let loaded: ReplayState;
        try {
          loaded = loadState(JSON.parse(await readAtomicJsonStore(this.filePath)) as unknown, this.filePath);
        } catch (error) {
          if (!isFileNotFound(error)) throw error;
          loaded = createEmptyState();
          await atomicWriteJson(this.filePath, loaded);
        }
        this.state = loaded;
        const pruned = pruneExpired(this.state, this.now(), this.ttlMs());
        if (pruned) await atomicWriteJson(this.filePath, this.state);
        this.initialized = true;
      } catch (error) {
        this.state = previous;
        this.initialized = false;
        throw error;
      }
    })();
    try {
      await this.initialization;
    } finally {
      this.initialization = undefined;
    }
  }

  async execute<T>(
    input: ProviderMutationReplayInput,
    operation: () => Promise<T>,
  ): Promise<ProviderMutationReplayResult<T>> {
    this.assertInitialized();
    const normalized = normalizeInput(input);
    const key = recordKey(normalized);
    const existingInFlight = this.inFlight.get(key);
    if (existingInFlight) {
      if (existingInFlight.fingerprint !== normalized.fingerprint) throw new ProviderMutationReplayConflictError();
      return existingInFlight.promise as Promise<ProviderMutationReplayResult<T>>;
    }

    const promise = (async (): Promise<ProviderMutationReplayResult<T>> => {
      let replayedResult: T | undefined;
      let wasReplayed = false;
      await this.enqueueMutation(() => {
        pruneExpired(this.state, this.now(), this.ttlMs());
        const existing = this.state.records[key];
        if (existing) {
          assertFingerprint(existing, normalized.fingerprint);
          if (existing.status === 'pending') throw new ProviderMutationReplayInFlightError();
          replayedResult = JSON.parse(existing.result) as T;
          wasReplayed = true;
          return;
        }
        if (Object.keys(this.state.records).length >= MAX_RECORDS) {
          throw new Error('Provider mutation replay store capacity is exhausted.');
        }
        const now = this.now();
        this.state.records[key] = {
          ...normalized,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        };
      });
      if (wasReplayed) return { replayed: true, result: replayedResult as T };

      try {
        const result = await operation();
        const serialized = serializeResult(result);
        await this.enqueueMutation(() => {
          const current = this.state.records[key];
          if (!current || current.status !== 'pending') throw new Error('Provider mutation replay reservation disappeared.');
          assertFingerprint(current, normalized.fingerprint);
          this.state.records[key] = {
            ...current,
            status: 'completed',
            result: serialized,
            updatedAt: this.now(),
          } as CompletedRecord;
        });
        return { replayed: false, result };
      } catch (error) {
        try {
          await this.enqueueMutation(() => {
            const current = this.state.records[key];
            if (current?.status === 'pending' && current.fingerprint === normalized.fingerprint) delete this.state.records[key];
          });
        } catch {
          // Preserve the reservation when cleanup fails; a retry must not repeat
          // an unknown provider side effect.
        }
        throw error;
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, { fingerprint: normalized.fingerprint, promise: promise as Promise<ProviderMutationReplayResult<unknown>> });
    return promise;
  }

  async replay<T>(input: ProviderMutationReplayInput): Promise<ProviderMutationReplayResult<T> | undefined> {
    this.assertInitialized();
    const normalized = normalizeInput(input);
    const key = recordKey(normalized);
    const active = this.inFlight.get(key);
    if (active) {
      if (active.fingerprint !== normalized.fingerprint) throw new ProviderMutationReplayConflictError();
      throw new ProviderMutationReplayInFlightError();
    }
    const record = this.state.records[key];
    if (!record) return undefined;
    assertFingerprint(record, normalized.fingerprint);
    if (record.status === 'pending') throw new ProviderMutationReplayInFlightError();
    return { replayed: true, result: JSON.parse(record.result) as T };
  }

  private ttlMs(): number {
    const value = this.options.ttlMs;
    if (value === undefined || !Number.isFinite(value)) return DEFAULT_TTL_MS;
    return Math.min(MAX_TTL_MS, Math.max(1, Math.floor(value)));
  }

  private now(): string {
    return new Date().toISOString();
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('ProviderMutationReplayStore.initialize() must complete before use.');
  }

  private enqueueMutation<T>(mutate: () => T): Promise<T> {
    const operation = this.writeChain.then(async () => {
      const previous = cloneState(this.state);
      try {
        const result = mutate();
        validateState(this.state, this.filePath);
        await atomicWriteJson(this.filePath, this.state);
        return result;
      } catch (error) {
        this.state = previous;
        throw error;
      }
    });
    this.writeChain = operation.then(() => undefined, () => undefined);
    return operation;
  }
}

function createEmptyState(): ReplayState {
  return { schemaVersion: SCHEMA_VERSION, records: Object.create(null) as Record<string, ReplayRecord> };
}

function normalizeInput(input: ProviderMutationReplayInput): ProviderMutationReplayInput {
  const scope = input.scope;
  if (!scope || !VALUE.test(scope.tenantId) || scope.tenantId.length > MAX_PRINCIPAL_LENGTH
    || !VALUE.test(scope.requesterId) || scope.requesterId.length > MAX_PRINCIPAL_LENGTH
    || !VALUE.test(scope.provider) || scope.provider.length > MAX_PRINCIPAL_LENGTH) {
    throw new Error('A validated provider mutation principal is required.');
  }
  if (!KEY.test(input.mutationKey) || input.mutationKey.length > MAX_KEY_LENGTH) throw new Error('A bounded mutation key is required.');
  if (!FINGERPRINT.test(input.fingerprint)) throw new Error('A SHA-256 mutation fingerprint is required.');
  return {
    scope: { tenantId: scope.tenantId, requesterId: scope.requesterId, provider: scope.provider },
    mutationKey: input.mutationKey,
    fingerprint: input.fingerprint,
  };
}

function recordKey(input: ProviderMutationReplayInput): string {
  return crypto.createHash('sha256').update(JSON.stringify({ scope: input.scope, mutationKey: input.mutationKey }), 'utf8').digest('hex');
}

function assertFingerprint(record: ReplayRecord, fingerprint: string): void {
  if (record.fingerprint !== fingerprint) throw new ProviderMutationReplayConflictError();
}

function serializeResult(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > MAX_RESULT_BYTES) {
    throw new Error('Provider mutation replay result is too large or not JSON serializable.');
  }
  return serialized;
}

function cloneState(value: ReplayState): ReplayState {
  return JSON.parse(JSON.stringify(value)) as ReplayState;
}

function pruneExpired(state: ReplayState, now: string, ttlMs: number): boolean {
  const nowMs = Date.parse(now);
  let changed = false;
  for (const [key, record] of Object.entries(state.records)) {
    if (nowMs - Date.parse(record.updatedAt) > ttlMs) {
      delete state.records[key];
      changed = true;
    }
  }
  return changed;
}

function validateState(value: ReplayState, filePath: string): void {
  if (value.schemaVersion !== SCHEMA_VERSION || !value.records || typeof value.records !== 'object' || Array.isArray(value.records)) {
    throw new Error(`Invalid provider mutation replay store: ${filePath}`);
  }
  const entries = Object.entries(value.records);
  if (entries.length > MAX_RECORDS) throw new Error(`Provider mutation replay store exceeds ${MAX_RECORDS} records: ${filePath}`);
  for (const [key, record] of entries) {
    if (!/^[a-f0-9]{64}$/u.test(key) || !record || typeof record !== 'object') throw new Error(`Invalid provider mutation replay record: ${filePath}`);
    const normalized = normalizeInput(record as ProviderMutationReplayInput);
    if (recordKey(normalized) !== key) throw new Error(`Provider mutation replay key does not match its record: ${filePath}`);
    if (record.status !== 'pending' && record.status !== 'completed') throw new Error(`Invalid provider mutation replay status: ${filePath}`);
    if (!isIso(record.createdAt) || !isIso(record.updatedAt)) throw new Error(`Invalid provider mutation replay timestamp: ${filePath}`);
    if (record.status === 'completed') {
      if (typeof record.result !== 'string' || Buffer.byteLength(record.result, 'utf8') > MAX_RESULT_BYTES) throw new Error(`Invalid provider mutation replay result: ${filePath}`);
      JSON.parse(record.result);
    }
  }
}

function loadState(value: unknown, filePath: string): ReplayState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid provider mutation replay store: ${filePath}`);
  const state = value as ReplayState;
  validateState(state, filePath);
  return state;
}

function isIso(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
