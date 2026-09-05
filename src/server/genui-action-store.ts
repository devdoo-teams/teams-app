import crypto from 'node:crypto';

import { atomicWriteJson, readAtomicJsonStore } from './atomic-file.js';

export type GenUiActionName = 'approve' | 'cancel' | 'refresh' | 'retry' | 'open-tab' | 'feedback';

export type GenUiActionGrant = {
  action: GenUiActionName;
  entityId: string;
  correlationId: string;
  conversationId: string;
  requesterId: string;
  tenantId: string;
  expiresAt: string;
};

type StoredActionGrant = GenUiActionGrant & {
  tokenHash: string;
  consumedAt?: string;
};

export type GenUiActionConsumeResult =
  | { ok: true; grant: GenUiActionGrant }
  | { ok: false; reason: 'invalid' | 'expired' | 'consumed' | 'mismatch' };

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const MAX_GRANT_FIELD_LENGTH = 200;
const MAX_ACTION_TOKEN_LENGTH = 512;
const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/;
const ACTION_NAMES = ['approve', 'cancel', 'refresh', 'retry', 'open-tab', 'feedback'] as const;
const CURRENT_GRANT_KEYS = new Set([
  'action',
  'entityId',
  'correlationId',
  'conversationId',
  'requesterId',
  'tenantId',
  'expiresAt',
  'tokenHash',
  'consumedAt',
]);
const LEGACY_GRANT_KEYS = new Set([
  'action',
  'entityId',
  'correlationId',
  'conversationId',
  'requesterId',
  'expiresAt',
  'tokenHash',
  'consumedAt',
]);

export class GenUiActionStore {
  private grants: StoredActionGrant[] = [];
  private mutationQueue: Promise<void> = Promise.resolve();
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly dataFile: string,
    private readonly ttlMs = DEFAULT_TTL_MS,
  ) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new RangeError('GenUI action grant ttl must be a positive finite number');
    }
  }

  async initialize(): Promise<void> {
    try {
      const contents = await readAtomicJsonStore(this.dataFile);
      const parsed = JSON.parse(contents) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error(`Invalid GenUI action store format: ${this.dataFile}`);
      }

      // Parse every record before changing in-memory state or writing a
      // migration. A malformed current-format file therefore fails closed and
      // remains byte-for-byte unchanged on disk.
      const loaded = parseStoredActionGrants(parsed, this.dataFile);
      const grants = loaded.grants;
      const pruned = pruneGrants(grants, Date.now(), this.ttlMs);
      if (loaded.legacyCount > 0 || pruned) {
        // Drop pre-tenant grants and expired/old consumed grants in one atomic
        // replacement. They can never be used as cross-tenant authority.
        await this.persist(grants);
      }
      this.grants = grants;
    } catch (error) {
      if (!isFileNotFound(error)) throw error;
      this.grants = [];
      await this.persist();
    }
  }

  async issue(input: Omit<GenUiActionGrant, 'expiresAt'>): Promise<string> {
    assertGrantScope(input);
    return this.mutate(async () => {
      const previous = this.grants.slice();
      const token = crypto.randomBytes(32).toString('base64url');
      const grant: StoredActionGrant = {
        action: input.action,
        entityId: input.entityId,
        correlationId: input.correlationId,
        conversationId: input.conversationId,
        requesterId: input.requesterId,
        tenantId: input.tenantId,
        expiresAt: new Date(Date.now() + this.ttlMs).toISOString(),
        tokenHash: hashToken(token),
      };
      this.grants.push(grant);
      try {
        await this.prune(false);
        await this.persist();
        return token;
      } catch (error) {
        this.grants.splice(0, this.grants.length, ...previous);
        throw error;
      }
    });
  }

  async consume(input: {
    token: string;
    action: GenUiActionName;
    entityId: string;
    correlationId: string;
    conversationId: string;
    requesterId: string;
    tenantId: string;
  }): Promise<GenUiActionConsumeResult> {
    if (!isConsumableInput(input)) return { ok: false, reason: 'invalid' };
    const tokenHash = hashToken(input.token);
    return this.mutate(async () => {
      const grant = this.grants.find((candidate) => safeEqual(candidate.tokenHash, tokenHash));

      if (!grant) return { ok: false, reason: 'invalid' };
      if (grant.consumedAt) return { ok: false, reason: 'consumed' };
      if (Date.parse(grant.expiresAt) <= Date.now()) {
        await this.prune();
        return { ok: false, reason: 'expired' };
      }

      const matches = grant.action === input.action
        && grant.entityId === input.entityId
        && grant.correlationId === input.correlationId
        && grant.conversationId === input.conversationId
        && grant.requesterId === input.requesterId
        && grant.tenantId === input.tenantId;
      if (!matches) return { ok: false, reason: 'mismatch' };

      const previousConsumedAt = grant.consumedAt;
      grant.consumedAt = new Date().toISOString();
      try {
        await this.persist();
        return { ok: true, grant: publicGrant(grant) };
      } catch (error) {
        if (previousConsumedAt === undefined) delete grant.consumedAt;
        else grant.consumedAt = previousConsumedAt;
        throw error;
      }
    });
  }

  private async prune(persist = true): Promise<void> {
    const previous = this.grants.slice();
    const changed = pruneGrants(this.grants, Date.now(), this.ttlMs);
    if (persist && changed) {
      try {
        await this.persist();
      } catch (error) {
        this.grants.splice(0, this.grants.length, ...previous);
        throw error;
      }
    }
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(operation);
    this.mutationQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  private async persist(snapshot = this.grants): Promise<void> {
    // Capture a value snapshot when the write is queued. The queue still
    // serializes all writes, while a later mutation cannot alter an earlier
    // atomic write's payload.
    const value = snapshot.map((grant) => ({ ...grant }));
    const nextWrite = this.writeQueue.then(() => atomicWriteJson(this.dataFile, value));
    this.writeQueue = nextWrite.catch(() => undefined);
    await nextWrite;
  }
}

function publicGrant(grant: StoredActionGrant): GenUiActionGrant {
  return {
    action: grant.action,
    entityId: grant.entityId,
    correlationId: grant.correlationId,
    conversationId: grant.conversationId,
    requesterId: grant.requesterId,
    tenantId: grant.tenantId,
    expiresAt: grant.expiresAt,
  };
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseStoredActionGrants(
  parsed: unknown[],
  dataFile: string,
): { grants: StoredActionGrant[]; legacyCount: number } {
  const grants: StoredActionGrant[] = [];
  const tokenHashes = new Set<string>();
  let legacyCount = 0;

  parsed.forEach((value, index) => {
    if (isLegacyStoredActionGrant(value, index, dataFile)) {
      legacyCount += 1;
      return;
    }

    const grant = parseCurrentStoredActionGrant(value, index, dataFile);
    if (tokenHashes.has(grant.tokenHash)) {
      throw invalidStoreRecord(dataFile, index, 'tokenHash must be unique');
    }
    tokenHashes.add(grant.tokenHash);
    grants.push(grant);
  });

  return { grants, legacyCount };
}

function parseCurrentStoredActionGrant(
  value: unknown,
  index: number,
  dataFile: string,
): StoredActionGrant {
  if (!isRecord(value)) throw invalidStoreRecord(dataFile, index, 'record must be an object');
  if (!hasOnlyKeys(value, CURRENT_GRANT_KEYS)) {
    throw invalidStoreRecord(dataFile, index, 'record contains unknown fields');
  }

  const grant = value as Partial<StoredActionGrant>;
  if (!isActionName(grant.action)) {
    throw invalidStoreRecord(dataFile, index, 'action is not supported');
  }
  if (!isBoundedText(grant.entityId)
    || !isBoundedText(grant.correlationId)
    || !isBoundedText(grant.conversationId)
    || !isBoundedText(grant.requesterId)
    || !isBoundedText(grant.tenantId)) {
    throw invalidStoreRecord(dataFile, index, 'scope fields must be bounded non-empty strings');
  }
  if (typeof grant.tokenHash !== 'string' || !TOKEN_HASH_PATTERN.test(grant.tokenHash)) {
    throw invalidStoreRecord(dataFile, index, 'tokenHash must be a lowercase SHA-256 hex digest');
  }

  const expiresAt = parseTimestamp(grant.expiresAt);
  const consumedAt = grant.consumedAt === undefined ? undefined : parseTimestamp(grant.consumedAt);
  if (expiresAt === undefined) {
    throw invalidStoreRecord(dataFile, index, 'expiresAt must be a finite canonical ISO timestamp');
  }
  if (grant.consumedAt !== undefined && consumedAt === undefined) {
    throw invalidStoreRecord(dataFile, index, 'consumedAt must be a finite canonical ISO timestamp');
  }
  if (consumedAt !== undefined && consumedAt > expiresAt) {
    throw invalidStoreRecord(dataFile, index, 'consumedAt must not be later than expiresAt');
  }

  return {
    action: grant.action,
    entityId: grant.entityId,
    correlationId: grant.correlationId,
    conversationId: grant.conversationId,
    requesterId: grant.requesterId,
    tenantId: grant.tenantId,
    expiresAt: grant.expiresAt!,
    tokenHash: grant.tokenHash,
    ...(grant.consumedAt === undefined ? {} : { consumedAt: grant.consumedAt }),
  };
}

function isLegacyStoredActionGrant(value: unknown, index: number, dataFile: string): boolean {
  if (!isRecord(value) || Object.prototype.hasOwnProperty.call(value, 'tenantId')) return false;
  if (!hasOnlyKeys(value, LEGACY_GRANT_KEYS)) {
    throw invalidStoreRecord(dataFile, index, 'legacy record contains unknown fields');
  }

  const grant = value as Partial<StoredActionGrant>;
  // Legacy records are never loaded into this.grants. We still validate their
  // shape before deleting them so an unrelated/corrupt object is not silently
  // treated as a migration candidate. The old hash is not required to match
  // the current digest format because it has no surviving authority.
  if (!isActionName(grant.action)
    || !isBoundedText(grant.entityId)
    || !isBoundedText(grant.correlationId)
    || !isBoundedText(grant.conversationId)
    || !isBoundedText(grant.requesterId)
    || typeof grant.tokenHash !== 'string'
    || !isBoundedText(grant.tokenHash, MAX_ACTION_TOKEN_LENGTH)) {
    throw invalidStoreRecord(dataFile, index, 'legacy record has invalid fields');
  }
  const expiresAt = parseTimestamp(grant.expiresAt);
  const consumedAt = grant.consumedAt === undefined ? undefined : parseTimestamp(grant.consumedAt);
  if (expiresAt === undefined || (grant.consumedAt !== undefined && consumedAt === undefined)) {
    throw invalidStoreRecord(dataFile, index, 'legacy record has invalid timestamps');
  }
  if (consumedAt !== undefined && consumedAt > expiresAt) {
    throw invalidStoreRecord(dataFile, index, 'legacy consumedAt must not be later than expiresAt');
  }
  return true;
}

function assertGrantScope(input: Omit<GenUiActionGrant, 'expiresAt'>): void {
  if (!isRecord(input)) throw new RangeError('GenUI action scope is required');
  if (!isActionName(input.action)) throw new RangeError('unsupported GenUI action');
  if (!isBoundedText(input.entityId)
    || !isBoundedText(input.correlationId)
    || !isBoundedText(input.conversationId)
    || !isBoundedText(input.requesterId)
    || !isBoundedText(input.tenantId)) {
    throw new RangeError('GenUI action scope fields must be bounded non-empty strings');
  }
}

function isConsumableInput(input: unknown): input is {
  token: string;
  action: GenUiActionName;
  entityId: string;
  correlationId: string;
  conversationId: string;
  requesterId: string;
  tenantId: string;
} {
  if (!isRecord(input)) return false;
  return typeof input.token === 'string'
    && isBoundedText(input.token, MAX_ACTION_TOKEN_LENGTH)
    && isActionName(input.action)
    && isBoundedText(input.entityId)
    && isBoundedText(input.correlationId)
    && isBoundedText(input.conversationId)
    && isBoundedText(input.requesterId)
    && isBoundedText(input.tenantId);
}

function isActionName(value: unknown): value is GenUiActionName {
  return typeof value === 'string' && ACTION_NAMES.includes(value as GenUiActionName);
}

function isBoundedText(value: unknown, maxLength = MAX_GRANT_FIELD_LENGTH): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= maxLength
    && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.length > 40) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  try {
    return new Date(timestamp).toISOString() === value ? timestamp : undefined;
  } catch {
    return undefined;
  }
}

function pruneGrants(grants: StoredActionGrant[], cutoff: number, ttlMs: number): boolean {
  const previousLength = grants.length;
  const kept = grants.filter((grant) => {
    const expiresAt = Date.parse(grant.expiresAt);
    if (expiresAt <= cutoff) return false;
    if (!grant.consumedAt) return true;
    return Date.parse(grant.consumedAt) > cutoff - ttlMs;
  });
  if (kept.length === previousLength) return false;
  grants.splice(0, grants.length, ...kept);
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function invalidStoreRecord(dataFile: string, index: number, reason: string): Error {
  return new Error(`Invalid GenUI action store format: ${dataFile}: record ${index}: ${reason}`);
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
