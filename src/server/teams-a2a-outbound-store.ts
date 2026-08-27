import crypto from 'node:crypto';

import { atomicWriteJson, readAtomicJsonStore } from './atomic-file.js';
import type { A2AScope } from './a2a-contract.js';

const SCHEMA_VERSION = 1 as const;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_ERROR_LENGTH = 500;

export type TeamsA2AOutboundStatus =
  | 'queued'
  | 'dispatching'
  | 'connector-accepted'
  | 'connector-rejected'
  | 'ambiguous';

export type TeamsA2AOutboundIntent = {
  id: string;
  parentTaskId: string;
  scope: A2AScope;
  kind: 'teams-completion';
  payloadSha256: string;
  status: TeamsA2AOutboundStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  leaseToken?: string;
  leaseExpiresAt?: string;
  activityId?: string;
  error?: string;
};

type TeamsA2AOutboundState = {
  schemaVersion: typeof SCHEMA_VERSION;
  intents: Record<string, TeamsA2AOutboundIntent>;
};

export type TeamsA2AOutboundCreateResult = Readonly<{
  intent: TeamsA2AOutboundIntent;
  created: boolean;
}>;

export class TeamsA2AOutboundConflictError extends Error {
  readonly code = 'A2A_OUTBOUND_CONFLICT' as const;

  constructor(message: string) {
    super(message);
    this.name = 'TeamsA2AOutboundConflictError';
  }
}

export class TeamsA2AOutboundStore {
  private state: TeamsA2AOutboundState = emptyState();
  private initialized = false;
  private initialization?: Promise<void>;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initialization) return this.initialization;
    this.initialization = (async () => {
      const previous = this.state;
      try {
        try {
          this.state = loadState(JSON.parse(await readAtomicJsonStore(this.filePath)) as unknown);
        } catch (error) {
          if (!isFileNotFound(error)) throw error;
          this.state = emptyState();
          await atomicWriteJson(this.filePath, this.state);
        }
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

  async createOrGetCompletionIntent(input: {
    parentTaskId: string;
    scope: A2AScope;
    payloadSha256: string;
  }): Promise<TeamsA2AOutboundCreateResult> {
    this.assertInitialized();
    const parentTaskId = safeId(input.parentTaskId, 'parentTaskId');
    const scope = safeScope(input.scope);
    const payloadSha256 = safeSha256(input.payloadSha256);
    const id = intentId(scope, parentTaskId);

    return this.mutate(() => {
      const existing = this.state.intents[id];
      if (existing) {
        if (!sameScope(existing.scope, scope) || existing.parentTaskId !== parentTaskId) {
          throw new TeamsA2AOutboundConflictError('Outbound intent identity does not match its durable key.');
        }
        if (existing.payloadSha256 !== payloadSha256) {
          throw new TeamsA2AOutboundConflictError('Outbound intent is already bound to a different completion payload.');
        }
        return { intent: cloneIntent(existing), created: false };
      }

      const timestamp = new Date(this.now()).toISOString();
      const intent: TeamsA2AOutboundIntent = {
        id,
        parentTaskId,
        scope,
        kind: 'teams-completion',
        payloadSha256,
        status: 'queued',
        attempts: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      this.state.intents[id] = intent;
      return { intent: cloneIntent(intent), created: true };
    });
  }

  async claim(
    intentIdValue: string,
    scopeValue: A2AScope,
    leaseTokenValue: string,
    leaseMs: number,
  ): Promise<TeamsA2AOutboundIntent | undefined> {
    this.assertInitialized();
    const id = safeId(intentIdValue, 'intentId');
    const scope = safeScope(scopeValue);
    const leaseToken = safeId(leaseTokenValue, 'leaseToken');
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 5 * 60_000) {
      throw new Error('Outbound leaseMs must be an integer between 1000 and 300000.');
    }

    return this.mutate(() => {
      const intent = this.state.intents[id];
      if (!intent || !sameScope(intent.scope, scope)) return undefined;
      const now = this.now();
      const expired = intent.status === 'dispatching'
        && intent.leaseExpiresAt !== undefined
        && Date.parse(intent.leaseExpiresAt) <= now;
      if (intent.status !== 'queued' && !expired) return undefined;

      intent.status = 'dispatching';
      intent.attempts += 1;
      intent.leaseToken = leaseToken;
      intent.leaseExpiresAt = new Date(now + leaseMs).toISOString();
      intent.updatedAt = new Date(now).toISOString();
      delete intent.error;
      return cloneIntent(intent);
    });
  }

  async recordConnectorAccepted(
    intentIdValue: string,
    scopeValue: A2AScope,
    leaseTokenValue: string,
    activityIdValue?: string,
  ): Promise<TeamsA2AOutboundIntent> {
    const activityId = activityIdValue === undefined ? undefined : safeId(activityIdValue, 'activityId');
    return this.recordOutcome(intentIdValue, scopeValue, leaseTokenValue, {
      status: 'connector-accepted',
      ...(activityId === undefined ? {} : { activityId }),
    });
  }

  async recordAmbiguous(
    intentIdValue: string,
    scopeValue: A2AScope,
    leaseTokenValue: string,
    errorValue?: string,
  ): Promise<TeamsA2AOutboundIntent> {
    const error = errorValue === undefined ? undefined : safeError(errorValue);
    return this.recordOutcome(intentIdValue, scopeValue, leaseTokenValue, {
      status: 'ambiguous',
      ...(error === undefined ? {} : { error }),
    });
  }

  async recordConnectorRejected(
    intentIdValue: string,
    scopeValue: A2AScope,
    leaseTokenValue: string,
    errorValue: string,
  ): Promise<TeamsA2AOutboundIntent> {
    return this.recordOutcome(intentIdValue, scopeValue, leaseTokenValue, {
      status: 'connector-rejected',
      error: safeError(errorValue),
    });
  }

  getIntent(intentIdValue: string, scopeValue: A2AScope): TeamsA2AOutboundIntent | undefined {
    this.assertInitialized();
    const id = safeId(intentIdValue, 'intentId');
    const scope = safeScope(scopeValue);
    const intent = this.state.intents[id];
    return intent && sameScope(intent.scope, scope) ? cloneIntent(intent) : undefined;
  }

  private async recordOutcome(
    intentIdValue: string,
    scopeValue: A2AScope,
    leaseTokenValue: string,
    outcome: Readonly<{
      status: Extract<TeamsA2AOutboundStatus, 'connector-accepted' | 'connector-rejected' | 'ambiguous'>;
      activityId?: string;
      error?: string;
    }>,
  ): Promise<TeamsA2AOutboundIntent> {
    this.assertInitialized();
    const id = safeId(intentIdValue, 'intentId');
    const scope = safeScope(scopeValue);
    const leaseToken = safeId(leaseTokenValue, 'leaseToken');
    return this.mutate(() => {
      const intent = this.state.intents[id];
      if (!intent || !sameScope(intent.scope, scope)) throw new Error('Outbound intent was not found.');
      if (intent.status !== 'dispatching' || intent.leaseToken !== leaseToken) {
        throw new TeamsA2AOutboundConflictError('Outbound intent lease is no longer active.');
      }
      intent.status = outcome.status;
      intent.updatedAt = new Date(this.now()).toISOString();
      delete intent.leaseToken;
      delete intent.leaseExpiresAt;
      delete intent.activityId;
      delete intent.error;
      if (outcome.activityId !== undefined) intent.activityId = outcome.activityId;
      if (outcome.error !== undefined) intent.error = outcome.error;
      return cloneIntent(intent);
    });
  }

  private mutate<T>(operation: () => T): Promise<T> {
    const result = this.writeChain.then(async () => {
      const before = cloneState(this.state);
      try {
        const value = operation();
        await atomicWriteJson(this.filePath, this.state);
        return value;
      } catch (error) {
        this.state = before;
        throw error;
      }
    });
    this.writeChain = result.then(() => undefined, () => undefined);
    return result;
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('Teams A2A outbound store is not initialized.');
  }
}

function emptyState(): TeamsA2AOutboundState {
  return { schemaVersion: SCHEMA_VERSION, intents: {} };
}

function loadState(value: unknown): TeamsA2AOutboundState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Teams A2A outbound store.');
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== SCHEMA_VERSION || !record.intents || typeof record.intents !== 'object' || Array.isArray(record.intents)) {
    throw new Error('Unsupported Teams A2A outbound store schema.');
  }
  const intents: Record<string, TeamsA2AOutboundIntent> = {};
  for (const [key, candidate] of Object.entries(record.intents as Record<string, unknown>)) {
    const intent = loadIntent(candidate);
    if (key !== intent.id) throw new Error('Teams A2A outbound intent key mismatch.');
    intents[key] = intent;
  }
  return { schemaVersion: SCHEMA_VERSION, intents };
}

function loadIntent(value: unknown): TeamsA2AOutboundIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Teams A2A outbound intent.');
  const record = value as Record<string, unknown>;
  const status = record.status;
  if (!['queued', 'dispatching', 'connector-accepted', 'connector-rejected', 'ambiguous'].includes(String(status))) {
    throw new Error('Invalid Teams A2A outbound status.');
  }
  if (record.kind !== 'teams-completion' || !Number.isSafeInteger(record.attempts) || Number(record.attempts) < 0) {
    throw new Error('Invalid Teams A2A outbound intent metadata.');
  }
  const intent: TeamsA2AOutboundIntent = {
    id: safeId(record.id, 'id'),
    parentTaskId: safeId(record.parentTaskId, 'parentTaskId'),
    scope: safeScope(record.scope),
    kind: 'teams-completion',
    payloadSha256: safeSha256(record.payloadSha256),
    status: status as TeamsA2AOutboundStatus,
    attempts: Number(record.attempts),
    createdAt: safeTimestamp(record.createdAt, 'createdAt'),
    updatedAt: safeTimestamp(record.updatedAt, 'updatedAt'),
    ...(record.leaseToken === undefined ? {} : { leaseToken: safeId(record.leaseToken, 'leaseToken') }),
    ...(record.leaseExpiresAt === undefined ? {} : { leaseExpiresAt: safeTimestamp(record.leaseExpiresAt, 'leaseExpiresAt') }),
    ...(record.activityId === undefined ? {} : { activityId: safeId(record.activityId, 'activityId') }),
    ...(record.error === undefined ? {} : { error: safeError(record.error) }),
  };
  if (intent.status === 'dispatching' && (!intent.leaseToken || !intent.leaseExpiresAt)) {
    throw new Error('Dispatching Teams A2A outbound intent requires a durable lease.');
  }
  if (intent.status !== 'dispatching' && (intent.leaseToken || intent.leaseExpiresAt)) {
    throw new Error('Terminal Teams A2A outbound intent cannot retain a lease.');
  }
  return intent;
}

function intentId(scope: A2AScope, parentTaskId: string): string {
  const digest = crypto.createHash('sha256').update(JSON.stringify({ scope, parentTaskId, kind: 'teams-completion' }), 'utf8').digest('hex');
  return `outbound-${digest}`;
}

function safeScope(value: unknown): A2AScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Outbound scope is required.');
  const record = value as Record<string, unknown>;
  return {
    tenantId: safeId(record.tenantId, 'scope.tenantId'),
    requesterId: safeId(record.requesterId, 'scope.requesterId'),
    conversationId: safeId(record.conversationId, 'scope.conversationId'),
  };
}

function safeId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new Error(`Invalid outbound ${label}.`);
  return value;
}

function safeSha256(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error('Invalid outbound payload SHA-256.');
  return value;
}

function safeTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`Invalid outbound ${label}.`);
  return new Date(value).toISOString();
}

function safeError(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid outbound error.');
  const bounded = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_ERROR_LENGTH);
  return bounded || 'outbound transport outcome is unknown';
}

function sameScope(left: A2AScope, right: A2AScope): boolean {
  return left.tenantId === right.tenantId
    && left.requesterId === right.requesterId
    && left.conversationId === right.conversationId;
}

function cloneIntent(intent: TeamsA2AOutboundIntent): TeamsA2AOutboundIntent {
  return { ...intent, scope: { ...intent.scope } };
}

function cloneState(state: TeamsA2AOutboundState): TeamsA2AOutboundState {
  return {
    schemaVersion: SCHEMA_VERSION,
    intents: Object.fromEntries(Object.entries(state.intents).map(([key, intent]) => [key, cloneIntent(intent)])),
  };
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
