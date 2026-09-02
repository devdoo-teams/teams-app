import type { A2AScope } from './a2a-contract.js';
import {
  hasProviderCompletionEvidence,
  resolveProviderRuntimeState,
  type ProviderAcceptedReceipt,
  type ProviderRuntimeAdapter,
  type ProviderRuntimeArtifact,
  type ProviderRuntimeIdentities,
  type ProviderRuntimeObservation,
  type ProviderRuntimeOperationInput,
  type ProviderRuntimeState,
} from './provider-runtime-adapter.js';

export type ProviderLifecycleQuarantineReason =
  | 'delivery-unknown'
  | 'unknown-provider-state'
  | 'missing-accepted-receipt'
  | 'invalid-completion-evidence';

export type ProviderLifecycleState = Exclude<ProviderRuntimeState, 'delivery-unknown' | 'unknown'>
  | 'submitting'
  | 'quarantined';

export type ProviderLifecycleSubmittingIntent = Readonly<{
  scope: A2AScope;
  idempotencyKey: string;
  requestHash: string;
  payload: Readonly<Record<string, unknown>>;
  requestedCapabilities: readonly string[];
  identities: ProviderRuntimeIdentities;
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
  createdAt: string;
  updatedAt: string;
  terminalAt?: string;
}>;

export type ProviderLifecycleStore = Readonly<{
  get(scope: A2AScope, idempotencyKey: string): Promise<ProviderLifecycleRecord | undefined>;
  createOrGetSubmitting(
    intent: ProviderLifecycleSubmittingIntent,
  ): Promise<{ record: ProviderLifecycleRecord; created: boolean }>;
  update(record: ProviderLifecycleRecord, expectedRevision: number): Promise<ProviderLifecycleRecord>;
}>;

export type ProviderLifecycleRunInput = ProviderLifecycleSubmittingIntent & Readonly<{
  timeoutMs: number;
  signal?: AbortSignal;
}>;

export class ProviderLifecycleConflictError extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT' as const;

  constructor() {
    super('The provider lifecycle idempotency key is already bound to a different request hash.');
    this.name = 'ProviderLifecycleConflictError';
  }
}

export type ProviderLifecycleRunnerOptions = Readonly<{
  adapter: ProviderRuntimeAdapter;
  store: ProviderLifecycleStore;
  pollIntervalMs?: number;
  now?: () => number;
  wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}>;

export class ProviderLifecycleRunner {
  private readonly pollIntervalMs: number;
  private readonly now: () => number;
  private readonly wait: (delayMs: number, signal: AbortSignal) => Promise<void>;

  constructor(private readonly options: ProviderLifecycleRunnerOptions) {
    if (!options?.adapter || !options?.store) throw new TypeError('provider lifecycle adapter and store are required');
    this.pollIntervalMs = boundedNonnegative(options.pollIntervalMs ?? 250, 'pollIntervalMs');
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

    try {
      const preflight = await this.options.adapter.preflight(operation);
      if (!preflight.ready) {
        throw new Error(preflight.reason?.trim() || 'Provider preflight is not ready.');
      }
      if (input.requestedCapabilities.some((capability) => !preflight.capabilities.includes(capability))) {
        throw new Error('Provider preflight does not advertise every requested capability.');
      }

      const created = await this.options.store.createOrGetSubmitting(intentFrom(input));
      let record = created.record;
      assertSameRequest(record, input);

      if (!created.created) {
        if (isProviderLifecycleTerminal(record.state) || record.state === 'quarantined') return record;
        if (!record.receipt) {
          return this.quarantine(record, 'delivery-unknown', record.rawProviderState ?? 'DELIVERY_UNKNOWN');
        }
        return await this.observe(record, operation, controller);
      }

      let submitted: ProviderRuntimeObservation;
      try {
        submitted = await this.options.adapter.submit(operation);
      } catch (error) {
        if (controller.signal.aborted) return this.cancel(record, operation, controller.signal.reason);
        return this.quarantine(record, 'delivery-unknown', 'DELIVERY_UNKNOWN', safeError(error));
      }
      record = await this.applyObservation(record, submitted);
      return record.state === 'accepted' || record.state === 'working'
        ? await this.observe(record, operation, controller)
        : record;
    } finally {
      clearTimeout(timer);
      cleanupParent();
    }
  }

  private async observe(
    record: ProviderLifecycleRecord,
    operation: ProviderRuntimeOperationInput,
    controller: AbortController,
  ): Promise<ProviderLifecycleRecord> {
    let current = record;
    while (true) {
      if (controller.signal.aborted) return this.cancel(current, operation, controller.signal.reason);
      let observation: ProviderRuntimeObservation;
      try {
        observation = await this.options.adapter.get({
          ...operation,
          signal: controller.signal,
          receipt: requiredReceipt(current),
        });
      } catch (error) {
        if (controller.signal.aborted) return this.cancel(current, operation, controller.signal.reason);
        throw error;
      }
      current = await this.applyObservation(current, observation);
      if (current.state !== 'accepted' && current.state !== 'working') return current;
      if (this.pollIntervalMs > 0) {
        try {
          await this.wait(this.pollIntervalMs, controller.signal);
        } catch {
          return this.cancel(current, operation, controller.signal.reason);
        }
      }
    }
  }

  private async applyObservation(
    record: ProviderLifecycleRecord,
    observation: ProviderRuntimeObservation,
  ): Promise<ProviderLifecycleRecord> {
    const state = resolveProviderRuntimeState(this.options.adapter, observation.rawState);
    if (state === 'delivery-unknown') {
      return this.quarantine(record, 'delivery-unknown', observation.rawState);
    }
    if (state === 'unknown') {
      return this.quarantine(record, 'unknown-provider-state', observation.rawState);
    }

    let current = record;
    const acceptedNow = !current.receipt;
    if (acceptedNow) {
      if (!observation.providerExecutionId?.trim()) {
        return this.quarantine(record, 'missing-accepted-receipt', observation.rawState);
      }
      current = await this.persist(current, {
        state: 'accepted',
        rawProviderState: observation.rawState,
        receipt: receiptFrom(observation, this.now()),
      });
    } else if (
      observation.providerExecutionId !== undefined
      && observation.providerExecutionId !== current.receipt?.providerExecutionId
    ) {
      return this.quarantine(current, 'missing-accepted-receipt', observation.rawState);
    }

    if (state === 'completed' && !hasProviderCompletionEvidence(observation)) {
      return this.quarantine(current, 'invalid-completion-evidence', observation.rawState);
    }
    if (state === 'accepted' && acceptedNow && noObservationEvidence(observation)) return current;

    return this.persist(current, {
      state,
      rawProviderState: observation.rawState,
      ...(observation.result === undefined ? {} : { result: observation.result.trim() }),
      ...(observation.error === undefined ? {} : { error: observation.error }),
      ...(observation.artifacts === undefined ? {} : { artifacts: clone(observation.artifacts) }),
      ...(observation.auditRefs === undefined ? {} : { auditRefs: clone(observation.auditRefs) }),
      ...(isProviderLifecycleTerminal(state) ? { terminalAt: new Date(this.now()).toISOString() } : {}),
    });
  }

  private async cancel(
    record: ProviderLifecycleRecord,
    operation: ProviderRuntimeOperationInput,
    reason: unknown,
  ): Promise<ProviderLifecycleRecord> {
    const message = safeError(reason) || 'Provider lifecycle canceled.';
    if (!record.receipt) {
      return this.quarantine(record, 'delivery-unknown', record.rawProviderState ?? 'DELIVERY_UNKNOWN', message);
    }
    let current = record;
    if (!current.cancelRequestedAt) {
      current = await this.persist(current, {
        cancelRequestedAt: new Date(this.now()).toISOString(),
      });
    }
    const observation = await this.options.adapter.cancel({
      ...operation,
      signal: new AbortController().signal,
      receipt: requiredReceipt(current),
    });
    const state = resolveProviderRuntimeState(this.options.adapter, observation.rawState);
    if (state === 'unknown' || state === 'delivery-unknown') {
      return this.quarantine(
        current,
        state === 'unknown' ? 'unknown-provider-state' : 'delivery-unknown',
        observation.rawState,
        message,
      );
    }
    return this.persist(current, {
      state,
      rawProviderState: observation.rawState,
      error: message,
      ...(observation.artifacts === undefined ? {} : { artifacts: clone(observation.artifacts) }),
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
      ...(error ? { error } : {}),
      terminalAt: new Date(this.now()).toISOString(),
    });
  }

  private async persist(
    record: ProviderLifecycleRecord,
    patch: Partial<ProviderLifecycleRecord>,
  ): Promise<ProviderLifecycleRecord> {
    return this.options.store.update({ ...record, ...patch }, record.revision);
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
  return error instanceof Error && error.message.trim() ? error.message.slice(0, 4_000) : '';
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
