import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export type GenUiActionName = 'approve' | 'cancel' | 'refresh' | 'retry' | 'open-tab' | 'feedback';

export type GenUiActionGrant = {
  action: GenUiActionName;
  entityId: string;
  correlationId: string;
  conversationId: string;
  requesterId: string;
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
    await fs.mkdir(path.dirname(this.dataFile), { recursive: true });

    try {
      const contents = await fs.readFile(this.dataFile, 'utf8');
      const parsed = JSON.parse(contents) as unknown;
      if (!Array.isArray(parsed) || !parsed.every(isStoredActionGrant)) {
        throw new Error(`Invalid GenUI action store format: ${this.dataFile}`);
      }
      this.grants = parsed;
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
      && grant.requesterId === input.requesterId;
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
    const snapshot = `${JSON.stringify(this.grants, null, 2)}\n`;
    const nextWrite = this.writeQueue.then(() => fs.writeFile(this.dataFile, snapshot, 'utf8'));
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
    && typeof grant.expiresAt === 'string'
    && (grant.consumedAt === undefined || typeof grant.consumedAt === 'string')
  );
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
