import crypto from 'node:crypto';
import path from 'node:path';

import type { A2AScope } from './a2a-contract.js';
import { atomicWriteJson, readAtomicJsonStore } from './atomic-file.js';
import {
  isOpaqueProviderCredentialReference,
  redactProviderRuntimeText,
  validateProviderRuntimeObservation,
  ProviderRuntimeObservationValidationError,
  type ProviderAcceptedReceipt,
  type ProviderRuntimeAdapter,
  type ProviderRuntimeArtifact,
  type ProviderRuntimeIdentities,
  type ProviderRuntimeObservation,
  type ProviderRuntimeOperationInput,
  type ProviderRuntimeState,
  type ProviderRuntimeObservationPhase,
  type ValidatedProviderRuntimeObservation,
} from './provider-runtime-adapter.js';

export type ProviderLifecycleQuarantineReason =
  | 'delivery-unknown'
  | 'unknown-provider-state'
  | 'missing-accepted-receipt'
  | 'invalid-completion-evidence'
  | 'invalid-provider-observation';

export type ProviderLifecycleState = Exclude<ProviderRuntimeState, 'delivery-unknown' | 'unknown'>
  | 'submitting'
  | 'canceling'
  | 'quarantined';

export type ProviderLifecycleSubmittingIntent = Readonly<{
  scope: A2AScope;
  idempotencyKey: string;
  requestHash: string;
  payload: Readonly<Record<string, unknown>>;
  requestedCapabilities: readonly string[];
  identities: ProviderRuntimeIdentities;
}>;

export type ProviderLifecycleLease = Readonly<{
  ownerId: string;
  expiresAt: string;
}>;

export type ProviderLifecycleRecord = ProviderLifecycleSubmittingIntent & Readonly<{
  state: ProviderLifecycleState;
  revision: number;
  rawProviderState?: string;
  receipt?: ProviderAcceptedReceipt;
  result?: string;
  error?: string;
  artifacts?: readonly ProviderRuntimeArtifact[];
  auditRefs?: readonly string[];
  quarantine?: Readonly<{ reason: ProviderLifecycleQuarantineReason }>;
  cancelRequestedAt?: string;
  lease?: ProviderLifecycleLease;
  createdAt: string;
  updatedAt: string;
  terminalAt?: string;
}>;

export type ProviderLifecycleStore = Readonly<{
  get(scope: A2AScope, idempotencyKey: string): Promise<ProviderLifecycleRecord | undefined>;
  createOrGetSubmitting(
    intent: ProviderLifecycleSubmittingIntent,
    lease?: ProviderLifecycleLease,
  ): Promise<{ record: ProviderLifecycleRecord; created: boolean }>;
  update(record: ProviderLifecycleRecord, expectedRevision: number): Promise<ProviderLifecycleRecord>;
  scanRecoverable(): Promise<readonly ProviderLifecycleRecord[]>;
}>;

export type ProviderLifecycleRunInput = ProviderLifecycleSubmittingIntent & Readonly<{
  timeoutMs: number;
  signal?: AbortSignal;
  onAccepted?: (receipt: ProviderAcceptedReceipt) => Promise<void> | void;
}>;

export type ProviderLifecycleRecoveryInput = Readonly<{
  scope: A2AScope;
  idempotencyKey: string;
  expectedProviderExecutionId?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}>;

export type ProviderLifecycleCancellationInput = Readonly<{
  scope: A2AScope;
  idempotencyKey: string;
  expectedProviderExecutionId: string;
  reason: string;
  timeoutMs?: number;
}>;

export class ProviderLifecycleConflictError extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT' as const;

  constructor() {
    super('The provider lifecycle idempotency key is already bound to a different request hash.');
    this.name = 'ProviderLifecycleConflictError';
  }
}

export class ProviderLifecycleRevisionConflictError extends Error {
  readonly code = 'REVISION_CONFLICT' as const;

  constructor() {
    super('The provider lifecycle record changed before the compare-and-swap update.');
    this.name = 'ProviderLifecycleRevisionConflictError';
  }
}

type ProviderLifecycleFile = Readonly<{
  schemaVersion: 1;
  records: Readonly<Record<string, ProviderLifecycleRecord>>;
}>;

export type FileProviderLifecycleStoreOptions = Readonly<{
  readJson?: (filePath: string) => Promise<string>;
  writeJson?: (filePath: string, value: unknown) => Promise<void>;
}>;

const lifecycleFileLocks = new Map<string, Promise<void>>();

export class FileProviderLifecycleStore implements ProviderLifecycleStore {
  private state: ProviderLifecycleFile = emptyFileState();
  private initialized = false;
  private initialization?: Promise<void>;
  private readonly filePath: string;
  private readonly readJson: (filePath: string) => Promise<string>;
  private readonly writeJson: (filePath: string, value: unknown) => Promise<void>;

  constructor(filePath: string, options: FileProviderLifecycleStoreOptions = {}) {
    this.filePath = path.resolve(filePath);
    this.readJson = options.readJson ?? readAtomicJsonStore;
    this.writeJson = options.writeJson ?? atomicWriteJson;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initialization) return this.initialization;
    this.initialization = withLifecycleFileLock(this.filePath, async () => {
      try {
        this.state = await this.readState();
      } catch (error) {
        if (!isFileNotFound(error)) throw error;
        const empty = emptyFileState();
        await this.writeJson(this.filePath, empty);
        this.state = empty;
      }
      this.initialized = true;
    });
    try {
      await this.initialization;
    } finally {
      this.initialization = undefined;
    }
  }

  async close(): Promise<void> {
    if (this.initialization) await this.initialization;
    await withLifecycleFileLock(this.filePath, async () => {
      this.state = emptyFileState();
      this.initialized = false;
    });
  }

  async get(scope: A2AScope, idempotencyKey: string): Promise<ProviderLifecycleRecord | undefined> {
    this.assertInitialized();
    return withLifecycleFileLock(this.filePath, async () => {
      this.assertInitialized();
      this.state = await this.readState();
      const record = this.state.records[lifecycleKey(scope, idempotencyKey)];
      return record ? clone(record) : undefined;
    });
  }

  async createOrGetSubmitting(
    intent: ProviderLifecycleSubmittingIntent,
    lease?: ProviderLifecycleLease,
  ): Promise<{ record: ProviderLifecycleRecord; created: boolean }> {
    this.assertInitialized();
    return this.mutate(() => {
      const key = lifecycleKey(intent.scope, intent.idempotencyKey);
      const existing = this.state.records[key];
      if (existing) return { record: clone(existing), created: false };
      const now = new Date().toISOString();
      const record: ProviderLifecycleRecord = {
        ...clone(intent),
        state: 'submitting',
        ...(lease ? { lease: clone(lease) } : {}),
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      this.state = {
        ...this.state,
        records: { ...this.state.records, [key]: record },
      };
      return { record: clone(record), created: true };
    });
  }

  async update(record: ProviderLifecycleRecord, expectedRevision: number): Promise<ProviderLifecycleRecord> {
    this.assertInitialized();
    return this.mutate(() => {
      const key = lifecycleKey(record.scope, record.idempotencyKey);
      const existing = this.state.records[key];
      if (!existing || existing.revision !== expectedRevision) {
        throw new ProviderLifecycleRevisionConflictError();
      }
      if (existing.requestHash !== record.requestHash) throw new ProviderLifecycleConflictError();
      const updated: ProviderLifecycleRecord = {
        ...clone(record),
        revision: expectedRevision + 1,
        updatedAt: new Date().toISOString(),
      };
      this.state = {
        ...this.state,
        records: { ...this.state.records, [key]: updated },
      };
      return clone(updated);
    });
  }

  async scanRecoverable(): Promise<readonly ProviderLifecycleRecord[]> {
    this.assertInitialized();
    return withLifecycleFileLock(this.filePath, async () => {
      this.assertInitialized();
      this.state = await this.readState();
      return Object.values(this.state.records)
        .filter(isRecoverableRecord)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)
          || left.idempotencyKey.localeCompare(right.idempotencyKey))
        .map(clone);
    });
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('FileProviderLifecycleStore.initialize() must complete before use.');
  }

  private async mutate<T>(mutation: () => T): Promise<T> {
    return withLifecycleFileLock(this.filePath, async () => {
      this.assertInitialized();
      const previous = await this.readState();
      this.state = previous;
      const result = mutation();
      try {
        this.state = loadFileState(this.state);
        await this.writeJson(this.filePath, this.state);
      } catch (error) {
        this.state = previous;
        throw error;
      }
      return result;
    });
  }

  private async readState(): Promise<ProviderLifecycleFile> {
    return loadFileState(JSON.parse(await this.readJson(this.filePath)) as unknown);
  }
}

export type ProviderLifecycleRunnerOptions = Readonly<{
  adapter: ProviderRuntimeAdapter;
  store: ProviderLifecycleStore;
  pollIntervalMs?: number;
  cancellationTimeoutMs?: number;
  now?: () => number;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}>;

export class ProviderLifecycleRunner {
  private readonly pollIntervalMs: number;
  private readonly cancellationTimeoutMs: number;
  private readonly now: () => number;
  private readonly wait: (delayMs: number, signal: AbortSignal) => Promise<void>;

  constructor(private readonly options: ProviderLifecycleRunnerOptions) {
    if (!options?.adapter || !options?.store) throw new TypeError('provider lifecycle adapter and store are required');
    this.pollIntervalMs = boundedNonnegative(options.pollIntervalMs ?? 250, 'pollIntervalMs');
    this.cancellationTimeoutMs = boundedPositive(options.cancellationTimeoutMs ?? 5_000, 'cancellationTimeoutMs');
    this.now = options.now ?? (() => Date.now());
    this.wait = options.wait ?? waitForDelay;
  }

  async run(input: ProviderLifecycleRunInput): Promise<ProviderLifecycleRecord> {
    validateInput(input, this.options.adapter.providerId);
    const timeoutMs = boundedPositive(input.timeoutMs, 'timeoutMs');
    const deadlineAtMs = this.now() + timeoutMs;
    const controller = new AbortController();
    const cleanupParent = forwardAbort(input.signal, controller);
    const timer = setTimeout(() => {
      controller.abort(new Error('Provider lifecycle deadline exceeded.'));
    }, timeoutMs);
    const operation = operationInput(input, deadlineAtMs, controller.signal);
    const leaseOwnerId = crypto.randomUUID();

    try {
      const existing = await this.options.store.get(input.scope, input.idempotencyKey);
      if (existing) {
        assertSameRequest(existing, input);
        return await this.resumeExisting(existing, operation, controller, leaseOwnerId, input.onAccepted);
      }

      const preflight = await raceAgainstSignal(
        () => this.options.adapter.preflight(operation),
        controller.signal,
      );
      if (!preflight.ready) {
        throw new Error(preflight.reason?.trim() || 'Provider preflight is not ready.');
      }
      if (input.requestedCapabilities.some((capability) => !preflight.capabilities.includes(capability))) {
        throw new Error('Provider preflight does not advertise every requested capability.');
      }

      const created = await this.options.store.createOrGetSubmitting(
        intentFrom(input),
        this.newLease(leaseOwnerId, deadlineAtMs),
      );
      let record = created.record;
      assertSameRequest(record, input);

      if (!created.created) {
        return await this.resumeExisting(record, operation, controller, leaseOwnerId, input.onAccepted);
      }

      let submitted: ProviderRuntimeObservation;
      try {
        submitted = await raceAgainstSignal(
          () => this.options.adapter.submit(operation),
          controller.signal,
        );
      } catch (error) {
        if (controller.signal.aborted) return this.requestCancellation(record, operation, controller.signal.reason);
        return this.quarantine(record, 'delivery-unknown', 'DELIVERY_UNKNOWN', safeError(error));
      }
      record = await this.applyObservation(record, submitted, 'submit', input.onAccepted);
      return record.state === 'accepted' || record.state === 'working'
        ? await this.observe(record, operation, controller)
        : record;
    } finally {
      clearTimeout(timer);
      cleanupParent();
    }
  }

  async recover(input: ProviderLifecycleRecoveryInput): Promise<ProviderLifecycleRecord> {
    const record = await this.options.store.get(input.scope, input.idempotencyKey);
    if (!record) throw new Error('Provider lifecycle record is not available for recovery.');
    if (input.expectedProviderExecutionId !== undefined) {
      if (!record.receipt) throw new Error('Provider accepted receipt is not available for recovery.');
      if (record.receipt.providerExecutionId !== input.expectedProviderExecutionId) {
        throw new ProviderLifecycleConflictError();
      }
    }
    if (isProviderLifecycleTerminal(record.state)
      || (record.state === 'quarantined' && record.quarantine?.reason !== 'delivery-unknown')) return record;
    const timeoutMs = boundedPositive(input.timeoutMs, 'timeoutMs');
    const controller = new AbortController();
    const cleanupParent = forwardAbort(input.signal, controller);
    const timer = setTimeout(() => {
      controller.abort(new Error('Provider lifecycle recovery deadline exceeded.'));
    }, timeoutMs);
    const operation = operationFromRecord(record, this.now() + timeoutMs, controller.signal);
    try {
      return await this.resumeExisting(record, operation, controller, crypto.randomUUID());
    } finally {
      clearTimeout(timer);
      cleanupParent();
    }
  }

  async cancel(input: ProviderLifecycleCancellationInput): Promise<ProviderLifecycleRecord> {
    const record = await this.requiredRecord(input.scope, input.idempotencyKey, input.expectedProviderExecutionId);
    if (isProviderLifecycleTerminal(record.state) || record.state === 'quarantined') return record;
    const operation = operationFromRecord(record, this.now() + 5_000, new AbortController().signal);
    return this.requestCancellation(
      record,
      operation,
      new Error(input.reason),
      boundedPositive(input.timeoutMs ?? this.cancellationTimeoutMs, 'timeoutMs'),
    );
  }

  private async observe(
    record: ProviderLifecycleRecord,
    operation: ProviderRuntimeOperationInput,
    controller: AbortController,
  ): Promise<ProviderLifecycleRecord> {
    let current = record;
    while (true) {
      if (current.cancelRequestedAt || current.state === 'canceling') {
        return this.requestCancellation(current, operation, new Error('Resuming durable provider cancellation.'));
      }
      if (controller.signal.aborted) return this.requestCancellation(current, operation, controller.signal.reason);
      let observation: ProviderRuntimeObservation;
      try {
        observation = await raceAgainstSignal(
          () => this.options.adapter.get({
            ...operation,
            signal: controller.signal,
            receipt: requiredReceipt(current),
          }),
          controller.signal,
        );
      } catch (error) {
        if (controller.signal.aborted) return this.requestCancellation(current, operation, controller.signal.reason);
        throw error;
      }
      current = await this.applyObservation(current, observation, 'get');
      if (current.state !== 'accepted' && current.state !== 'working') return current;
      try {
        await this.wait(this.pollIntervalMs, controller.signal);
      } catch {
        return this.requestCancellation(current, operation, controller.signal.reason);
      }
    }
  }

  private async resumeExisting(
    record: ProviderLifecycleRecord,
    operation: ProviderRuntimeOperationInput,
    controller: AbortController,
    leaseOwnerId: string,
    onAccepted?: (receipt: ProviderAcceptedReceipt) => Promise<void> | void,
  ): Promise<ProviderLifecycleRecord> {
    if (isProviderLifecycleTerminal(record.state)) return record;
    if (record.cancelRequestedAt || record.state === 'canceling') {
      return this.requestCancellation(record, operation, new Error('Resuming durable provider cancellation.'));
    }
    record = await this.acquireLeaseOrWait(record, operation, controller, leaseOwnerId);
    if (isProviderLifecycleTerminal(record.state)) return record;
    if (record.cancelRequestedAt || record.state === 'canceling') {
      return this.requestCancellation(record, operation, new Error('Resuming durable provider cancellation.'));
    }
    if (record.receipt) {
      await onAccepted?.(record.receipt);
      return this.observe(record, operation, controller);
    }
    return this.reconcileWithoutReceipt(record, operation, controller, onAccepted);
  }

  private async acquireLeaseOrWait(
    initial: ProviderLifecycleRecord,
    operation: ProviderRuntimeOperationInput,
    controller: AbortController,
    ownerId: string,
  ): Promise<ProviderLifecycleRecord> {
    let current = initial;
    while (!isProviderLifecycleTerminal(current.state)) {
      const leaseExpiry = current.lease ? Date.parse(current.lease.expiresAt) : Number.NaN;
      if (current.lease?.ownerId === ownerId && leaseExpiry > this.now()) return current;
      if (!current.lease || !Number.isFinite(leaseExpiry) || leaseExpiry <= this.now()) {
        try {
          const claimed = await this.persist(current, {
            lease: this.newLease(ownerId, operation.deadlineAtMs),
          }, 'throw');
          if (claimed.lease?.ownerId === ownerId) return claimed;
        } catch (error) {
          if (!(error instanceof ProviderLifecycleRevisionConflictError)) throw error;
        }
      } else {
        const remaining = Math.max(1, Math.min(
          this.pollIntervalMs || 5,
          leaseExpiry - this.now(),
          operation.deadlineAtMs - this.now(),
        ));
        await this.wait(remaining, controller.signal);
      }
      const reloaded = await this.options.store.get(current.scope, current.idempotencyKey);
      if (!reloaded) throw new Error('Provider lifecycle record disappeared during lease reconciliation.');
      if (reloaded.requestHash !== current.requestHash) throw new ProviderLifecycleConflictError();
      current = reloaded;
    }
    return current;
  }

  private newLease(ownerId: string, operationDeadlineAtMs: number): ProviderLifecycleLease {
    return Object.freeze({ ownerId, expiresAt: new Date(operationDeadlineAtMs).toISOString() });
  }

  private async reconcileWithoutReceipt(
    record: ProviderLifecycleRecord,
    operation: ProviderRuntimeOperationInput,
    controller: AbortController,
    onAccepted?: (receipt: ProviderAcceptedReceipt) => Promise<void> | void,
  ): Promise<ProviderLifecycleRecord> {
    if (!this.options.adapter.reconcile) {
      return record.state === 'quarantined'
        ? record
        : this.quarantine(record, 'delivery-unknown', record.rawProviderState ?? 'DELIVERY_UNKNOWN');
    }
    let observation: ProviderRuntimeObservation;
    try {
      observation = await raceAgainstSignal(
        () => this.options.adapter.reconcile!(operation),
        controller.signal,
      );
    } catch (error) {
      if (record.state === 'quarantined') return record;
      return this.quarantine(record, 'delivery-unknown', 'DELIVERY_UNKNOWN', safeError(error));
    }
    const reconciled = await this.applyObservation(record, observation, 'reconcile', onAccepted);
    return reconciled.state === 'accepted' || reconciled.state === 'working'
      ? this.observe(reconciled, operation, controller)
      : reconciled;
  }

  private async applyObservation(
    record: ProviderLifecycleRecord,
    observation: ProviderRuntimeObservation,
    phase: ProviderRuntimeObservationPhase,
    onAccepted?: (receipt: ProviderAcceptedReceipt) => Promise<void> | void,
  ): Promise<ProviderLifecycleRecord> {
    let validated: ValidatedProviderRuntimeObservation;
    try {
      validated = validateProviderRuntimeObservation(this.options.adapter, observation, {
        phase,
        ...(record.receipt ? { receipt: record.receipt } : {}),
      });
    } catch (error) {
      const reason = error instanceof ProviderRuntimeObservationValidationError
        ? error.code
        : 'invalid-provider-observation';
      return this.quarantine(record, reason, 'INVALID_OBSERVATION', safeError(error));
    }
    const state = validated.state;
    if (state === 'delivery-unknown') {
      return this.quarantine(record, 'delivery-unknown', validated.rawState);
    }
    if (state === 'unknown') {
      return this.quarantine(record, 'unknown-provider-state', validated.rawState);
    }

    let current = record;
    const acceptedNow = !current.receipt;
    if (acceptedNow) {
      if (!validated.providerExecutionId?.trim()) {
        return this.quarantine(record, 'missing-accepted-receipt', validated.rawState);
      }
      current = await this.persist(current, {
        state: 'accepted',
        rawProviderState: validated.rawState,
        receipt: receiptFrom(validated, this.now()),
        quarantine: undefined,
        terminalAt: undefined,
      });
      await onAccepted?.(requiredReceipt(current));
    } else {
      const receipt = mergeReceiptContinuity(requiredReceipt(current), validated);
      if (receipt !== current.receipt) current = await this.persist(current, { receipt });
    }

    if (state === 'accepted' && acceptedNow && noObservationEvidence(validated)) return current;

    return this.persist(current, {
      state,
      rawProviderState: validated.rawState,
      quarantine: undefined,
      ...((state === 'accepted' || state === 'working') ? {} : { lease: undefined }),
      ...(validated.result === undefined ? {} : { result: validated.result }),
      ...(validated.error === undefined ? {} : { error: validated.error }),
      ...(validated.artifacts === undefined ? {} : { artifacts: clone(validated.artifacts) }),
      ...(validated.auditRefs === undefined ? {} : { auditRefs: clone(validated.auditRefs) }),
      ...(isProviderLifecycleTerminal(state) ? { terminalAt: new Date(this.now()).toISOString() } : {}),
    });
  }

  private async requestCancellation(
    record: ProviderLifecycleRecord,
    operation: ProviderRuntimeOperationInput,
    reason: unknown,
    timeoutMs = this.cancellationTimeoutMs,
  ): Promise<ProviderLifecycleRecord> {
    const message = safeError(reason) || 'Provider lifecycle canceled.';
    if (!record.receipt) {
      return this.quarantine(record, 'delivery-unknown', record.rawProviderState ?? 'DELIVERY_UNKNOWN', message);
    }
    let current = record;
    if (!current.cancelRequestedAt) {
      current = await this.persist(current, {
        state: 'canceling',
        cancelRequestedAt: new Date(this.now()).toISOString(),
      });
    }
    const cancellationController = new AbortController();
    const cancellationTimer = setTimeout(() => {
      cancellationController.abort(new Error('Provider cancellation deadline exceeded.'));
    }, timeoutMs);
    let observation: ProviderRuntimeObservation;
    try {
      observation = await raceAgainstSignal(
        () => this.options.adapter.cancel({
          ...operation,
          deadlineAtMs: this.now() + timeoutMs,
          signal: cancellationController.signal,
          receipt: requiredReceipt(current),
        }),
        cancellationController.signal,
      );
    } catch (error) {
      return this.persist(current, {
        state: 'canceling',
        error: safeError(error) || message,
      });
    } finally {
      clearTimeout(cancellationTimer);
    }
    let validated: ValidatedProviderRuntimeObservation;
    try {
      validated = validateProviderRuntimeObservation(this.options.adapter, observation, {
        phase: 'cancel',
        receipt: requiredReceipt(current),
      });
    } catch (error) {
      return this.persist(current, {
        state: 'canceling',
        error: safeError(error) || message,
      });
    }
    const state = validated.state;
    if (state === 'unknown' || state === 'delivery-unknown' || state === 'accepted' || state === 'working'
      || state === 'input-required' || state === 'auth-required') {
      return this.persist(current, {
        state: 'canceling',
        rawProviderState: validated.rawState,
        error: validated.error ?? message,
      });
    }
    return this.persist(current, {
      state,
      rawProviderState: validated.rawState,
      error: validated.error ?? message,
      ...(validated.artifacts === undefined ? {} : { artifacts: clone(validated.artifacts) }),
      ...(validated.auditRefs === undefined ? {} : { auditRefs: clone(validated.auditRefs) }),
      lease: undefined,
      ...(isProviderLifecycleTerminal(state) ? { terminalAt: new Date(this.now()).toISOString() } : {}),
    });
  }

  private async quarantine(
    record: ProviderLifecycleRecord,
    reason: ProviderLifecycleQuarantineReason,
    rawProviderState: string,
    error?: string,
  ): Promise<ProviderLifecycleRecord> {
    return this.persist(record, {
      state: 'quarantined',
      rawProviderState,
      quarantine: { reason },
      lease: undefined,
      ...(error ? { error } : {}),
      terminalAt: new Date(this.now()).toISOString(),
    });
  }

  private async persist(
    record: ProviderLifecycleRecord,
    patch: Partial<ProviderLifecycleRecord>,
    conflictMode: 'reconcile' | 'throw' = 'reconcile',
  ): Promise<ProviderLifecycleRecord> {
    let current = record;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await this.options.store.update({ ...current, ...patch }, current.revision);
      } catch (error) {
        if (!(error instanceof ProviderLifecycleRevisionConflictError) || conflictMode === 'throw') throw error;
        const latest = await this.options.store.get(record.scope, record.idempotencyKey);
        if (!latest) throw error;
        if (latest.requestHash !== record.requestHash || !sameScope(latest.scope, record.scope)) {
          throw new ProviderLifecycleConflictError();
        }
        if (isProviderLifecycleTerminal(latest.state) || latest.state === 'quarantined') return latest;
        if (latest.cancelRequestedAt && !record.cancelRequestedAt) return latest;
        if (latest.lease?.ownerId && record.lease?.ownerId
          && latest.lease.ownerId !== record.lease.ownerId
          && patch.state !== 'canceling') return latest;
        current = latest;
      }
    }
    throw new ProviderLifecycleRevisionConflictError();
  }

  private async requiredRecord(
    scope: A2AScope,
    idempotencyKey: string,
    expectedProviderExecutionId: string,
  ): Promise<ProviderLifecycleRecord> {
    const record = await this.options.store.get(scope, idempotencyKey);
    if (!record?.receipt) throw new Error('Provider accepted receipt is not available for recovery.');
    if (record.receipt.providerExecutionId !== expectedProviderExecutionId) {
      throw new ProviderLifecycleConflictError();
    }
    return record;
  }
}

export function isProviderLifecycleTerminal(state: ProviderLifecycleState): boolean {
  return state === 'completed' || state === 'failed' || state === 'canceled' || state === 'rejected';
}

function validateInput(input: ProviderLifecycleRunInput, providerId: string): void {
  if (!input || typeof input !== 'object') throw new TypeError('provider lifecycle input is required');
  if (input.identities.provider.id !== providerId) {
    throw new Error('Provider lifecycle identity does not match the registered adapter.');
  }
  if (!isOpaqueProviderCredentialReference(input.identities.credential.reference)) {
    throw new TypeError('Provider lifecycle requires an opaque env or key-vault credential reference.');
  }
  assertNoRawCredentialPayload(input.payload);
  if (!/^[a-f0-9]{64}$/u.test(input.requestHash)) throw new TypeError('requestHash must be a SHA-256 digest');
  if (!input.idempotencyKey.trim()) throw new TypeError('idempotencyKey is required');
  for (const value of [input.scope.tenantId, input.scope.requesterId, input.scope.conversationId]) {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError('server-derived provider scope is required');
  }
}

function operationInput(
  input: ProviderLifecycleRunInput,
  deadlineAtMs: number,
  signal: AbortSignal,
): ProviderRuntimeOperationInput {
  return {
    scope: clone(input.scope),
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    payload: clone(input.payload),
    requestedCapabilities: Object.freeze([...input.requestedCapabilities]),
    identities: clone(input.identities),
    deadlineAtMs,
    signal,
  };
}

function operationFromRecord(
  record: ProviderLifecycleRecord,
  deadlineAtMs: number,
  signal: AbortSignal,
): ProviderRuntimeOperationInput {
  return {
    scope: clone(record.scope),
    idempotencyKey: record.idempotencyKey,
    requestHash: record.requestHash,
    payload: clone(record.payload),
    requestedCapabilities: Object.freeze([...record.requestedCapabilities]),
    identities: clone(record.identities),
    deadlineAtMs,
    signal,
  };
}

function intentFrom(input: ProviderLifecycleRunInput): ProviderLifecycleSubmittingIntent {
  return {
    scope: clone(input.scope),
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    payload: clone(input.payload),
    requestedCapabilities: Object.freeze([...input.requestedCapabilities]),
    identities: clone(input.identities),
  };
}

function receiptFrom(observation: ProviderRuntimeObservation, now: number): ProviderAcceptedReceipt {
  return {
    providerExecutionId: observation.providerExecutionId!,
    ...(observation.providerSessionId ? { providerSessionId: observation.providerSessionId } : {}),
    ...(observation.providerContextId ? { providerContextId: observation.providerContextId } : {}),
    acceptedAt: new Date(now).toISOString(),
    rawState: observation.rawState,
    ...(observation.providerCursor ? { reconciliationRef: observation.providerCursor } : {}),
  };
}

function mergeReceiptContinuity(
  receipt: ProviderAcceptedReceipt,
  observation: ProviderRuntimeObservation,
): ProviderAcceptedReceipt {
  if ((!observation.providerSessionId || receipt.providerSessionId)
    && (!observation.providerContextId || receipt.providerContextId)
    && (!observation.providerCursor || receipt.reconciliationRef)) {
    return receipt;
  }
  return {
    ...receipt,
    ...(receipt.providerSessionId || !observation.providerSessionId
      ? {}
      : { providerSessionId: observation.providerSessionId }),
    ...(receipt.providerContextId || !observation.providerContextId
      ? {}
      : { providerContextId: observation.providerContextId }),
    ...(receipt.reconciliationRef || !observation.providerCursor
      ? {}
      : { reconciliationRef: observation.providerCursor }),
  };
}

function requiredReceipt(record: ProviderLifecycleRecord): ProviderAcceptedReceipt {
  if (!record.receipt) throw new Error('Provider accepted receipt is not available.');
  return record.receipt;
}

function assertSameRequest(record: ProviderLifecycleRecord, input: ProviderLifecycleRunInput): void {
  if (record.requestHash !== input.requestHash) throw new ProviderLifecycleConflictError();
  if (!sameScope(record.scope, input.scope)) throw new ProviderLifecycleConflictError();
  if (JSON.stringify(record.identities) !== JSON.stringify(input.identities)) throw new ProviderLifecycleConflictError();
}

function sameScope(left: A2AScope, right: A2AScope): boolean {
  return left.tenantId === right.tenantId
    && left.requesterId === right.requesterId
    && left.conversationId === right.conversationId;
}

function lifecycleKey(scope: A2AScope, idempotencyKey: string): string {
  return crypto.createHash('sha256').update(JSON.stringify([
    scope.tenantId,
    scope.requesterId,
    scope.conversationId,
    idempotencyKey,
  ])).digest('hex');
}

function emptyFileState(): ProviderLifecycleFile {
  return { schemaVersion: 1, records: Object.create(null) as Record<string, ProviderLifecycleRecord> };
}

function loadFileState(value: unknown): ProviderLifecycleFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Provider lifecycle store must contain an object.');
  }
  const candidate = value as Partial<ProviderLifecycleFile>;
  if (candidate.schemaVersion !== 1 || !candidate.records || typeof candidate.records !== 'object' || Array.isArray(candidate.records)) {
    throw new Error('Provider lifecycle store schema is invalid.');
  }
  for (const [key, record] of Object.entries(candidate.records)) {
    if (!/^[a-f0-9]{64}$/u.test(key) || !record || typeof record !== 'object') {
      throw new Error('Provider lifecycle store record is invalid.');
    }
    if (lifecycleKey(record.scope, record.idempotencyKey) !== key || !Number.isSafeInteger(record.revision) || record.revision < 1) {
      throw new Error('Provider lifecycle store record identity is invalid.');
    }
    assertSafeStoredRecord(record);
  }
  return clone(candidate as ProviderLifecycleFile);
}

function isRecoverableRecord(record: ProviderLifecycleRecord): boolean {
  return !isProviderLifecycleTerminal(record.state)
    && (record.state !== 'quarantined' || record.quarantine?.reason === 'delivery-unknown');
}

function assertSafeStoredRecord(record: ProviderLifecycleRecord): void {
  if (!isOpaqueProviderCredentialReference(record.identities?.credential?.reference)) {
    throw new Error('Provider lifecycle store contains a non-opaque credential reference.');
  }
  assertNoRawCredentialPayload(record.payload);
  for (const [value, maximum, label] of [
    [record.result, 65_536, 'result'],
    [record.error, 4_000, 'error'],
  ] as const) {
    if (value !== undefined && (value.length > maximum || redactProviderRuntimeText(value, maximum) !== value)) {
      throw new Error(`Provider lifecycle store contains unsafe ${label}.`);
    }
  }
  if (record.auditRefs && (record.auditRefs.length > 64 || record.auditRefs.some((reference) => (
    reference.length > 512 || redactProviderRuntimeText(reference, 512) !== reference
  )))) {
    throw new Error('Provider lifecycle store contains unsafe audit references.');
  }
  if (record.artifacts && (record.artifacts.length > 32 || record.artifacts.some((artifact) => (
    !artifact || artifact.artifactId.length > 200 || artifact.name.length > 512 || artifact.mediaType.length > 200
    || (artifact.text !== undefined && (
      artifact.text.length > 65_536 || redactProviderRuntimeText(artifact.text, 65_536) !== artifact.text
    ))
    || (artifact.uri !== undefined && !isSafeStoredArtifactUri(artifact.uri))
  )))) {
    throw new Error('Provider lifecycle store contains unsafe artifacts.');
  }
  if (record.lease) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(record.lease.ownerId)
      || !Number.isFinite(Date.parse(record.lease.expiresAt))) {
      throw new Error('Provider lifecycle store contains an invalid lease.');
    }
  }
}

function assertNoRawCredentialPayload(value: unknown): void {
  const seen = new WeakSet<object>();
  const inspect = (candidate: unknown, sensitiveKey = false, depth = 0): void => {
    if (depth > 20) throw new Error('Provider lifecycle payload nesting is too deep.');
    if (typeof candidate === 'string') {
      if ((sensitiveKey && !isOpaqueProviderCredentialReference(candidate))
        || redactProviderRuntimeText(candidate, candidate.length) !== candidate.trim()) {
        throw new Error('Provider lifecycle rejected a raw credential value in payload.');
      }
      return;
    }
    if (!candidate || typeof candidate !== 'object') return;
    if (seen.has(candidate)) throw new Error('Provider lifecycle payload must not contain cycles.');
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      for (const entry of candidate) inspect(entry, false, depth + 1);
    } else {
      for (const [key, entry] of Object.entries(candidate)) {
        inspect(entry, /api.?key|authorization|credential|password|secret|token/iu.test(key), depth + 1);
      }
    }
    seen.delete(candidate);
  };
  inspect(value);
}

function isSafeStoredArtifactUri(value: string): boolean {
  if (value.length > 2_048) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && Boolean(parsed.hostname)
      && !parsed.username && !parsed.password && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}

async function withLifecycleFileLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = lifecycleFileLocks.get(filePath) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  lifecycleFileLocks.set(filePath, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (lifecycleFileLocks.get(filePath) === tail) lifecycleFileLocks.delete(filePath);
  }
}

function isFileNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function noObservationEvidence(observation: ProviderRuntimeObservation): boolean {
  return observation.result === undefined
    && observation.error === undefined
    && observation.artifacts === undefined
    && observation.auditRefs === undefined;
}

function boundedPositive(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 1) throw new TypeError(`${field} must be positive`);
  return Math.trunc(value);
}

function boundedNonnegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${field} must be non-negative`);
  return Math.trunc(value);
}

function forwardAbort(parent: AbortSignal | undefined, controller: AbortController): () => void {
  if (!parent) return () => undefined;
  const abort = (): void => controller.abort(parent.reason ?? new Error('Provider lifecycle canceled.'));
  parent.addEventListener('abort', abort, { once: true });
  if (parent.aborted) abort();
  return () => parent.removeEventListener('abort', abort);
}

async function raceAgainstSignal<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason;
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      callback();
    };
    const abort = (): void => finish(() => reject(signal.reason ?? new Error('Provider operation canceled.')));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve()
      .then(operation)
      .then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
  });
}

async function waitForDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw signal.reason;
  await new Promise<void>((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    signal.addEventListener('abort', abort, { once: true });
  });
}

function safeError(error: unknown): string {
  return error instanceof Error && error.message.trim() ? redactProviderRuntimeText(error.message, 4_000) : '';
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
