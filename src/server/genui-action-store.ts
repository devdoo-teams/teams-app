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

export class GenUiActionStore {
  private grants: StoredActionGrant[] = [];
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly dataFile: string,
    private readonly ttlMs = DEFAULT_TTL_MS,
  ) {}

  async initialize(): Promise<void> {
    try {
      const contents = await readAtomicJsonStore(this.dataFile);
      const parsed = JSON.parse(contents) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error(`Invalid GenUI action store format: ${this.dataFile}`);
      }

      const valid = parsed.filter(isStoredActionGrant);
      const legacy = parsed.filter(isLegacyStoredActionGrant);
      if (valid.length + legacy.length !== parsed.length) {
        throw new Error(`Invalid GenUI action store format: ${this.dataFile}`);
      }

      // Pre-tenant grants are deliberately invalidated on restart and are never
      // accepted by consume. A malformed non-legacy record still fails closed.
      this.grants = valid;
      if (legacy.length > 0) await this.persist();
      await this.prune();
    } catch (error) {
      if (!isFileNotFound(error)) throw error;
      this.grants = [];
      await this.persist();
    }
  }

  async issue(input: Omit<GenUiActionGrant, 'expiresAt'>): Promise<string> {
    const token = crypto.randomBytes(32).toString('base64url');
    this.grants.push({
      ...input,
      expiresAt: new Date(Date.now() + this.ttlMs).toISOString(),
      tokenHash: hashToken(token),
    });
    await this.prune(false);
    await this.persist();
    return token;
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
    const tokenHash = hashToken(input.token);
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

    grant.consumedAt = new Date().toISOString();
    await this.persist();
    return { ok: true, grant: publicGrant(grant) };
  }

  private async prune(persist = true): Promise<void> {
    const cutoff = Date.now();
    const previousLength = this.grants.length;
    this.grants = this.grants.filter((grant) => {
      if (Date.parse(grant.expiresAt) <= cutoff) return false;
      if (!grant.consumedAt) return true;
      return Date.parse(grant.consumedAt) > cutoff - this.ttlMs;
    });
    if (persist && this.grants.length !== previousLength) await this.persist();
  }

  private async persist(): Promise<void> {
    const nextWrite = this.writeQueue.then(() => atomicWriteJson(this.dataFile, this.grants));
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

function isStoredActionGrant(value: unknown): value is StoredActionGrant {
  if (!value || typeof value !== 'object') return false;
  const grant = value as Partial<StoredActionGrant>;
  return (
    typeof grant.tokenHash === 'string'
    && ['approve', 'cancel', 'refresh', 'retry', 'open-tab', 'feedback'].includes(grant.action ?? '')
    && typeof grant.entityId === 'string'
    && typeof grant.correlationId === 'string'
    && typeof grant.conversationId === 'string'
    && typeof grant.requesterId === 'string'
    && typeof grant.tenantId === 'string'
    && typeof grant.expiresAt === 'string'
    && (grant.consumedAt === undefined || typeof grant.consumedAt === 'string')
  );
}

function isLegacyStoredActionGrant(value: unknown): value is Omit<StoredActionGrant, 'tenantId'> {
  if (!value || typeof value !== 'object') return false;
  const grant = value as Partial<StoredActionGrant>;
  return (
    grant.tenantId === undefined
    && typeof grant.tokenHash === 'string'
    && ['approve', 'cancel', 'refresh', 'retry', 'open-tab', 'feedback'].includes(grant.action ?? '')
    && typeof grant.entityId === 'string'
    && typeof grant.correlationId === 'string'
    && typeof grant.conversationId === 'string'
    && typeof grant.requesterId === 'string'
    && typeof grant.expiresAt === 'string'
    && (grant.consumedAt === undefined || typeof grant.consumedAt === 'string')
  );
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
