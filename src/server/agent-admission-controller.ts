import crypto from 'node:crypto';

import { atomicWriteJson, readAtomicJsonStore } from './atomic-file.js';
import type { AgentJobStatus } from './agent-job-store.js';

export type AgentAdmissionScope = {
  tenantId: string;
  requesterId: string;
};

export type AgentCapacityDimension = 'global' | 'tenant' | 'requester' | 'closing';

export type AgentAdmissionRejection = {
  ok: false;
  code: 'AGENT_CAPACITY_EXCEEDED' | 'AGENT_ADMISSION_CLOSED';
  dimension: AgentCapacityDimension;
  limit: number;
  retryable: boolean;
};

export type AgentCapacityPublic = {
  code: AgentAdmissionRejection['code'];
  dimension: AgentCapacityDimension;
  limit: number;
  retryable: boolean;
};

export type AgentAdmissionResult =
  | { ok: true; lease: AgentAdmissionLease }
  | AgentAdmissionRejection;

export type AgentAdmissionRecord = AgentAdmissionScope & {
  id: string;
  status: AgentJobStatus;
};

export type AgentAdmissionSnapshot = {
  closing: boolean;
  global: number;
  tenants: Record<string, number>;
  requesters: Record<string, number>;
};

export const AGENT_ADMISSION_LIMIT_MAXIMA = Object.freeze({
  global: 64,
  tenant: 32,
  requester: 16,
});

type JournalPhase = 'reserved' | 'bound' | 'terminal_pending' | 'unresolved' | 'released';

type JournalEntry = {
  token: string;
  scope: AgentAdmissionScope;
  jobId?: string;
  phase: JournalPhase;
  attempts: number;
  failureCode?: string;
  retryUntil?: string;
  updatedAt: string;
};

type JournalDocument = {
  version: 1;
  closing: boolean;
  entries: JournalEntry[];
};

type Reservation = {
  scope: AgentAdmissionScope;
  jobId?: string;
  phase: Exclude<JournalPhase, 'released'>;
  attempts: number;
  failureCode?: string;
  retryUntil?: string;
};

export class AgentCapacityError extends Error {
  readonly code: AgentAdmissionRejection['code'];
  readonly dimension: AgentCapacityDimension;
  readonly limit: number;
  readonly retryable: boolean;

  constructor(readonly rejection: AgentAdmissionRejection) {
    const message = rejection.code === 'AGENT_ADMISSION_CLOSED'
      ? '서버가 종료 중이어서 새 Codex 작업을 시작할 수 없습니다.'
      : `Codex 작업 용량이 가득 찼습니다 (${rejection.dimension}: ${rejection.limit}). 잠시 후 다시 시도하세요.`;
    super(message);
    this.name = 'AgentCapacityError';
    this.code = rejection.code;
    this.dimension = rejection.dimension;
    this.limit = rejection.limit;
    this.retryable = rejection.retryable;
  }

  toPublic(): AgentCapacityPublic {
    return {
      code: this.code,
      dimension: this.dimension,
      limit: this.limit,
      retryable: this.retryable,
    };
  }
}

export class AgentAdmissionConfigurationError extends Error {
  readonly code = 'AGENT_ADMISSION_CONFIG_INVALID' as const;

  constructor(message: string) {
    super(message);
    this.name = 'AgentAdmissionConfigurationError';
  }
}

export class AgentAdmissionLease {
  readonly scope: AgentAdmissionScope;

  constructor(
    private readonly controller: AgentAdmissionController,
    readonly token: string,
    scope: AgentAdmissionScope,
  ) {
    this.scope = { ...scope };
  }

  async bindJob(jobId: string): Promise<void> {
    await this.controller.bindJob(this.token, jobId);
  }

  async markTerminalPending(): Promise<void> {
    await this.controller.markTerminalPendingToken(this.token);
  }

  async markUnresolved(failureCode: string): Promise<void> {
    await this.controller.markUnresolvedToken(this.token, failureCode);
  }

  async release(): Promise<void> {
    await this.controller.releaseToken(this.token);
  }
}

export class AgentAdmissionController {
  private readonly reservations = new Map<string, Reservation>();
  private readonly jobTokens = new Map<string, string>();
  private closing = false;
  private initialized = false;
  private initializePromise: Promise<void> | undefined;
  private journalChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly limits: {
      globalLimit: number;
      perTenantLimit: number;
      perRequesterLimit: number;
    },
    private readonly options: {
      journalPath?: string;
      retryLeaseMs?: number;
    } = {},
  ) {
    assertLimit('globalLimit', limits.globalLimit, AGENT_ADMISSION_LIMIT_MAXIMA.global);
    assertLimit('perTenantLimit', limits.perTenantLimit, AGENT_ADMISSION_LIMIT_MAXIMA.tenant);
    assertLimit('perRequesterLimit', limits.perRequesterLimit, AGENT_ADMISSION_LIMIT_MAXIMA.requester);
    if (limits.perRequesterLimit > limits.perTenantLimit || limits.perTenantLimit > limits.globalLimit) {
      throw new AgentAdmissionConfigurationError(
        'agent admission limits must satisfy requester <= tenant <= global',
      );
    }
    if (options.retryLeaseMs !== undefined && (!Number.isSafeInteger(options.retryLeaseMs) || options.retryLeaseMs <= 0 || options.retryLeaseMs > 60_000)) {
      throw new AgentAdmissionConfigurationError('retryLeaseMs must be a finite positive safe integer <= 60000');
    }
  }

  async initialize(): Promise<void> {
    this.initializePromise ??= this.loadJournal();
    await this.initializePromise;
  }

  async tryAcquire(scope: AgentAdmissionScope): Promise<AgentAdmissionResult> {
    await this.initialize();
    return this.mutate(async () => {
      if (this.closing) {
        return {
          ok: false,
          code: 'AGENT_ADMISSION_CLOSED',
          dimension: 'closing',
          limit: 0,
          retryable: false,
        };
      }
      const requesterKey = requesterScopeKey(scope);
      if (this.count((reservation) => requesterScopeKey(reservation.scope) === requesterKey) >= this.limits.perRequesterLimit) {
        return capacityRejection('requester', this.limits.perRequesterLimit);
      }
      if (this.count((reservation) => reservation.scope.tenantId === scope.tenantId) >= this.limits.perTenantLimit) {
        return capacityRejection('tenant', this.limits.perTenantLimit);
      }
      if (this.reservations.size >= this.limits.globalLimit) {
        return capacityRejection('global', this.limits.globalLimit);
      }

      const token = `admission-${crypto.randomUUID()}`;
      this.reservations.set(token, { scope: { ...scope }, phase: 'reserved', attempts: 0 });
      return { ok: true, lease: new AgentAdmissionLease(this, token, scope) };
    });
  }

  async reconstruct(records: readonly AgentAdmissionRecord[]): Promise<void> {
    await this.initialize();
    await this.mutate(async () => {
      const activeJobIds = new Set(records.filter((record) => isActive(record.status)).map((record) => record.id));
      for (const [token, reservation] of this.reservations) {
        if (reservation.jobId && !activeJobIds.has(reservation.jobId) && reservation.phase === 'bound') {
          reservation.phase = 'unresolved';
          reservation.failureCode = 'RESTART_RECONCILIATION_REQUIRED';
          reservation.attempts += 1;
          reservation.retryUntil = new Date(Date.now() + this.retryLeaseMs()).toISOString();
        }
      }
      for (const record of records) {
        if (!isActive(record.status) || !record.tenantId || !record.requesterId || !record.id) continue;
        const existingToken = this.jobTokens.get(record.id);
        if (existingToken) {
          const existing = this.reservations.get(existingToken);
          if (existing) {
            existing.scope = { tenantId: record.tenantId, requesterId: record.requesterId };
            existing.phase = 'bound';
            continue;
          }
        }
        const token = `recovered:${record.id}`;
        this.reservations.set(token, {
          scope: { tenantId: record.tenantId, requesterId: record.requesterId },
          jobId: record.id,
          phase: 'bound',
          attempts: 0,
        });
        this.jobTokens.set(record.id, token);
      }
    });
  }

  async markTerminalPending(jobId: string): Promise<void> {
    await this.initialize();
    const token = this.jobTokens.get(jobId);
    if (!token) throw new Error('agent admission job lease is not active');
    await this.markTerminalPendingToken(token);
  }

  async markUnresolved(jobId: string, failureCode: string): Promise<void> {
    await this.initialize();
    const token = this.jobTokens.get(jobId);
    if (!token) throw new Error('agent admission job lease is not active');
    await this.markUnresolvedToken(token, failureCode);
  }

  async releaseJob(jobId: string): Promise<void> {
    await this.initialize();
    const token = this.jobTokens.get(jobId);
    if (token) await this.releaseToken(token);
  }

  async close(): Promise<void> {
    await this.initialize();
    await this.mutate(async () => {
      this.closing = true;
    });
  }

  /** Explicit operator recovery boundary. It is intentionally not automatic. */
  async recoverUnresolved(jobId: string): Promise<void> {
    await this.initialize();
    const token = this.jobTokens.get(jobId);
    if (!token) throw new Error('agent admission unresolved job lease is not active');
    await this.releaseToken(token);
  }

  snapshot(): AgentAdmissionSnapshot {
    const tenants = new Map<string, number>();
    const requesters = new Map<string, number>();
    for (const reservation of this.reservations.values()) {
      tenants.set(reservation.scope.tenantId, (tenants.get(reservation.scope.tenantId) ?? 0) + 1);
      const requesterKey = requesterScopeKey(reservation.scope);
      requesters.set(requesterKey, (requesters.get(requesterKey) ?? 0) + 1);
    }
    return {
      closing: this.closing,
      global: this.reservations.size,
      tenants: Object.fromEntries([...tenants.entries()].sort(([left], [right]) => left.localeCompare(right))),
      requesters: Object.fromEntries([...requesters.entries()].sort(([left], [right]) => left.localeCompare(right))),
    };
  }

  async bindJob(token: string, jobId: string): Promise<void> {
    await this.initialize();
    await this.mutate(async () => {
      const reservation = this.reservations.get(token);
      if (!reservation) throw new Error('agent admission lease is no longer active');
      if (reservation.jobId === jobId) return;
      if (reservation.jobId || this.jobTokens.has(jobId)) throw new Error('agent admission lease is already bound');
      reservation.jobId = jobId;
      reservation.phase = 'bound';
      this.jobTokens.set(jobId, token);
    });
  }

  async markTerminalPendingToken(token: string): Promise<void> {
    await this.initialize();
    await this.mutate(async () => {
      const reservation = this.requireReservation(token);
      if (reservation.phase === 'unresolved') return;
      reservation.phase = 'terminal_pending';
    });
  }

  async markUnresolvedToken(token: string, failureCode: string): Promise<void> {
    await this.initialize();
    await this.mutate(async () => {
      const reservation = this.requireReservation(token);
      reservation.phase = 'unresolved';
      reservation.failureCode = sanitizeFailureCode(failureCode);
      reservation.attempts += 1;
      reservation.retryUntil = new Date(Date.now() + this.retryLeaseMs()).toISOString();
    });
  }

  async releaseToken(token: string): Promise<void> {
    await this.initialize();
    await this.mutate(async () => {
      const reservation = this.reservations.get(token);
      if (!reservation) return;
      this.reservations.delete(token);
      if (reservation.jobId && this.jobTokens.get(reservation.jobId) === token) this.jobTokens.delete(reservation.jobId);
    }, token);
  }

  private requireReservation(token: string): Reservation {
    const reservation = this.reservations.get(token);
    if (!reservation) throw new Error('agent admission lease is no longer active');
    return reservation;
  }

  private async loadJournal(): Promise<void> {
    if (!this.options.journalPath) {
      this.initialized = true;
      return;
    }
    let reopenAfterRestart = false;
    try {
      const raw = await readAtomicJsonStore(this.options.journalPath);
      const parsed = JSON.parse(raw) as unknown;
      this.loadDocument(parsed);
      reopenAfterRestart = this.closing;
    } catch (error) {
      if (!isFileNotFound(error)) throw error;
      await atomicWriteJson(this.options.journalPath, { version: 1, closing: false, entries: [] } satisfies JournalDocument);
    }
    if (reopenAfterRestart) {
      // `closing` gates admissions for this process only. The process lease
      // makes journal handoff exclusive, so a new owner may reopen after a
      // graceful predecessor shutdown while retaining active reservations.
      this.closing = false;
      await this.persistJournal();
    }
    this.initialized = true;
  }

  private loadDocument(value: unknown): void {
    if (!value || typeof value !== 'object') throw new Error('agent admission journal is invalid');
    const document = value as Partial<JournalDocument>;
    if (document.version !== 1 || typeof document.closing !== 'boolean' || !Array.isArray(document.entries)) {
      throw new Error('agent admission journal schema is invalid');
    }
    this.closing = document.closing;
    for (const rawEntry of document.entries) {
      if (!isJournalEntry(rawEntry)) throw new Error('agent admission journal entry is invalid');
      if (rawEntry.phase === 'released') continue;
      this.reservations.set(rawEntry.token, {
        scope: { ...rawEntry.scope },
        jobId: rawEntry.jobId,
        phase: rawEntry.phase,
        attempts: rawEntry.attempts,
        failureCode: rawEntry.failureCode,
        retryUntil: rawEntry.retryUntil,
      });
      if (rawEntry.jobId) this.jobTokens.set(rawEntry.jobId, rawEntry.token);
    }
  }

  private async mutate<T>(operation: () => T | Promise<T>, releasingToken?: string): Promise<T> {
    if (!this.initialized && this.options.journalPath) throw new Error('agent admission controller is not initialized');
    const next = this.journalChain.then(async () => {
      const previousReservations = cloneReservations(this.reservations);
      const previousJobTokens = new Map(this.jobTokens);
      const previousClosing = this.closing;
      try {
        const result = await operation();
        await this.persistJournal(releasingToken);
        return result;
      } catch (error) {
        this.reservations.clear();
        for (const [token, reservation] of previousReservations) this.reservations.set(token, reservation);
        this.jobTokens.clear();
        for (const [jobId, token] of previousJobTokens) this.jobTokens.set(jobId, token);
        this.closing = previousClosing;
        throw error;
      }
    });
    this.journalChain = next.then(() => undefined, () => undefined);
    return next;
  }

  private async persistJournal(releasingToken?: string): Promise<void> {
    if (!this.options.journalPath) return;
    const entries: JournalEntry[] = [];
    for (const [token, reservation] of this.reservations) {
      entries.push({
        token,
        scope: { ...reservation.scope },
        ...(reservation.jobId ? { jobId: reservation.jobId } : {}),
        phase: reservation.phase,
        attempts: reservation.attempts,
        ...(reservation.failureCode ? { failureCode: reservation.failureCode } : {}),
        ...(reservation.retryUntil ? { retryUntil: reservation.retryUntil } : {}),
        updatedAt: new Date().toISOString(),
      });
    }
    if (releasingToken) {
      entries.push({
        token: releasingToken,
        scope: { tenantId: 'released', requesterId: 'released' },
        phase: 'released',
        attempts: 0,
        updatedAt: new Date().toISOString(),
      });
    }
    const released = entries.filter((entry) => entry.phase === 'released');
    const active = entries.filter((entry) => entry.phase !== 'released');
    const boundedEntries = [...active, ...released].slice(-2_000);
    await atomicWriteJson(this.options.journalPath, {
      version: 1,
      closing: this.closing,
      entries: boundedEntries,
    } satisfies JournalDocument);
  }

  private count(predicate: (reservation: Reservation) => boolean): number {
    let count = 0;
    for (const reservation of this.reservations.values()) if (predicate(reservation)) count += 1;
    return count;
  }

  private retryLeaseMs(): number {
    return this.options.retryLeaseMs ?? 30_000;
  }
}

export function publicAgentCapacityError(error: AgentCapacityError): AgentCapacityPublic {
  return error.toPublic();
}

export function agentCapacityText(error: AgentCapacityError): string {
  const details = error.toPublic();
  return details.code === 'AGENT_ADMISSION_CLOSED'
    ? '현재 서버가 종료 중이어서 새 작업을 시작할 수 없습니다.'
    : `현재 작업 용량이 가득 찼습니다. 차원 ${details.dimension}, 한도 ${details.limit}입니다. 잠시 후 다시 시도하세요.`;
}

function capacityRejection(
  dimension: Exclude<AgentCapacityDimension, 'closing'>,
  limit: number,
): AgentAdmissionRejection {
  return { ok: false, code: 'AGENT_CAPACITY_EXCEEDED', dimension, limit, retryable: true };
}

function requesterScopeKey(scope: AgentAdmissionScope): string {
  return JSON.stringify([scope.tenantId, scope.requesterId]);
}

function isActive(status: AgentJobStatus): boolean {
  return status === 'queued' || status === 'awaiting_approval' || status === 'running';
}

function assertLimit(name: string, value: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || !Number.isFinite(value) || value <= 0 || value > maximum) {
    throw new AgentAdmissionConfigurationError(`${name} must be a finite positive safe integer <= ${maximum}`);
  }
}

function cloneReservations(source: Map<string, Reservation>): Map<string, Reservation> {
  return new Map([...source.entries()].map(([token, reservation]) => [token, {
    ...reservation,
    scope: { ...reservation.scope },
  }]));
}

function sanitizeFailureCode(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120);
  return normalized || 'UNKNOWN_CLEANUP_FAILURE';
}

function isJournalEntry(value: unknown): value is JournalEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<JournalEntry>;
  return typeof entry.token === 'string'
    && Boolean(entry.scope && typeof entry.scope.tenantId === 'string' && typeof entry.scope.requesterId === 'string')
    && typeof entry.phase === 'string'
    && ['reserved', 'bound', 'terminal_pending', 'unresolved', 'released'].includes(entry.phase)
    && Number.isSafeInteger(entry.attempts)
    && typeof entry.updatedAt === 'string'
    && (entry.jobId === undefined || typeof entry.jobId === 'string')
    && (entry.failureCode === undefined || typeof entry.failureCode === 'string')
    && (entry.retryUntil === undefined || typeof entry.retryUntil === 'string');
}

function isFileNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT');
}
