import { atomicWriteJson, readAtomicJsonStore } from './atomic-file.js';
import {
  DEFAULT_RESPONSE_MODE,
  ResponseModeSchema,
  ResponseModeScopeSchema,
  responseModeLabel,
  type ResponseMode,
  type ResponseModeAvailability,
  type ResponseModeScope,
} from '../shared/response-mode.js';

const MAX_RESPONSE_MODE_ENTRIES = 1_000;
const RESPONSE_MODE_RECORD_KEYS = new Set(['tenantId', 'requesterId', 'mode', 'updatedAt']);

type StoredResponseMode = ResponseModeScope & {
  mode: ResponseMode;
  updatedAt: string;
};

export class ResponseModeStore {
  private preferences: StoredResponseMode[] = [];
  private loaded = false;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly dataFile: string,
    private readonly options: {
      defaultMode?: ResponseMode;
      providers?: { openai: boolean; local: boolean; grok?: boolean };
    } = {},
  ) {
    this.defaultMode = parseMode(options.defaultMode ?? DEFAULT_RESPONSE_MODE);
  }

  private readonly defaultMode: ResponseMode;

  /** Load the store and create an empty file when no store exists yet. */
  async initialize(): Promise<void> {
    await this.enqueue(async () => {
      const missing = await this.loadIfNeeded();
      if (missing) await atomicWriteJson(this.dataFile, []);
    });
  }

  async get(scope: ResponseModeScope): Promise<ResponseMode> {
    const validScope = parseScope(scope);
    return this.enqueue(async () => {
      await this.loadIfNeeded();
      return this.preferences.find((preference) => matchesScope(preference, validScope))?.mode
        ?? this.defaultMode;
    });
  }

  async set(scope: ResponseModeScope, mode: ResponseMode): Promise<void> {
    const validScope = parseScope(scope);
    const validMode = parseMode(mode);

    await this.enqueue(async () => {
      await this.loadIfNeeded();

      const updated: StoredResponseMode = {
        ...validScope,
        mode: validMode,
        updatedAt: new Date().toISOString(),
      };
      const next = this.preferences.filter((preference) => !matchesScope(preference, validScope));
      next.push(updated);
      if (next.length > MAX_RESPONSE_MODE_ENTRIES) {
        throw new RangeError(`response mode store supports at most ${MAX_RESPONSE_MODE_ENTRIES} entries`);
      }

      await atomicWriteJson(this.dataFile, next);
      this.preferences = next;
    });
  }

  availability(): ResponseModeAvailability[] {
    return [
      {
        mode: 'deterministic',
        label: responseModeLabel('deterministic'),
        configured: true,
        requiresServerConfiguration: false,
      },
      {
        mode: 'openai',
        label: responseModeLabel('openai'),
        configured: this.options.providers?.openai === true,
        requiresServerConfiguration: true,
      },
      {
        mode: 'local',
        label: responseModeLabel('local'),
        configured: this.options.providers?.local === true,
        requiresServerConfiguration: true,
      },
      {
        mode: 'grok',
        label: responseModeLabel('grok'),
        configured: this.options.providers?.grok === true,
        requiresServerConfiguration: true,
      },
    ];
  }

  private async loadIfNeeded(): Promise<boolean> {
    if (this.loaded) return false;

    try {
      const contents = await readAtomicJsonStore(this.dataFile);
      let parsed: unknown;
      try {
        parsed = JSON.parse(contents) as unknown;
      } catch {
        throw invalidStore(this.dataFile, 'persisted JSON is malformed');
      }
      this.preferences = parseStoredResponseModes(parsed, this.dataFile);
      this.loaded = true;
      return false;
    } catch (error) {
      if (!isFileNotFound(error)) throw error;
      this.preferences = [];
      this.loaded = true;
      return true;
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationQueue.then(operation);
    this.operationQueue = next.then(() => undefined, () => undefined);
    return next;
  }
}

function parseScope(value: unknown): ResponseModeScope {
  const parsed = ResponseModeScopeSchema.safeParse(value);
  if (!parsed.success) throw new RangeError('Invalid response mode scope');
  return parsed.data;
}

function parseMode(value: unknown): ResponseMode {
  const parsed = ResponseModeSchema.safeParse(value);
  if (!parsed.success) throw new RangeError('Invalid response mode');
  return parsed.data;
}

function parseStoredResponseModes(value: unknown, dataFile: string): StoredResponseMode[] {
  if (!Array.isArray(value) || value.length > MAX_RESPONSE_MODE_ENTRIES) {
    throw invalidStore(dataFile, 'expected a bounded array of response mode records');
  }

  const scopes = new Set<string>();
  return value.map((record, index) => {
    if (!isRecord(record) || !hasOnlyKeys(record, RESPONSE_MODE_RECORD_KEYS)) {
      throw invalidStore(dataFile, `record ${index} is not a response mode record`);
    }

    const scope = parsePersistedScope(record, dataFile, index);
    const mode = parsePersistedMode(record.mode, dataFile, index);
    const updatedAt = parseTimestamp(record.updatedAt);
    if (!updatedAt) throw invalidStore(dataFile, `record ${index} has an invalid updatedAt`);

    const scopeKey = `${scope.tenantId}\u0000${scope.requesterId}`;
    if (scopes.has(scopeKey)) throw invalidStore(dataFile, `record ${index} duplicates a scope`);
    scopes.add(scopeKey);

    return { ...scope, mode, updatedAt };
  });
}

function parsePersistedScope(
  record: Record<string, unknown>,
  dataFile: string,
  index: number,
): ResponseModeScope {
  const parsed = ResponseModeScopeSchema.safeParse({
    tenantId: record.tenantId,
    requesterId: record.requesterId,
  });
  if (!parsed.success) throw invalidStore(dataFile, `record ${index} has an invalid scope`);
  return parsed.data;
}

function parsePersistedMode(value: unknown, dataFile: string, index: number): ResponseMode {
  const parsed = ResponseModeSchema.safeParse(value);
  if (!parsed.success) throw invalidStore(dataFile, `record ${index} has an invalid mode`);
  return parsed.data;
}

function parseTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 30) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  try {
    return new Date(timestamp).toISOString() === value ? value : undefined;
  } catch {
    return undefined;
  }
}

function matchesScope(left: ResponseModeScope, right: ResponseModeScope): boolean {
  return left.tenantId === right.tenantId && left.requesterId === right.requesterId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function invalidStore(dataFile: string, reason: string): Error {
  return new Error(`Invalid response mode store format: ${dataFile}: ${reason}`);
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
