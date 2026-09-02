import type { A2AJsonData, A2AScope } from './a2a-contract.js';
import {
  hasProviderCompletionEvidence,
  resolveProviderRuntimeState,
  type ProviderRuntimeAdapter,
  type ProviderRuntimeArtifact,
  type ProviderRuntimeIdentities,
  type ProviderRuntimeObservation,
  type ProviderRuntimeOperationInput,
  type ProviderRuntimeReceipt,
  type ProviderRuntimeState,
} from './provider-runtime-adapter.js';

export type ProviderLifecycleState =
  | 'submitting'
  | 'accepted'
  | 'working'
  | 'input-required'
  | 'auth-required'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'quarantined';

export type ProviderLifecycleQuarantineReason =
  | 'delivery-unknown'
  | 'unknown-provider-state'
  | 'invalid-provider-response'
  | 'invalid-completion-evidence';

export type ProviderLifecycleSubmittingIntent = Readonly<{
  scope: A2AScope;
  idempotencyKey: string;
  requestHash: string;
  payload: A2AJsonData;
  requestedCapabilities: readonly string[];
  identities: ProviderRuntimeIdentities;
}>;

export type ProviderLifecycleRecord = ProviderLifecycleSubmittingIntent & Readonly<{
  state: ProviderLifecycleState;
  revision: number;
  createdAt: string;
  updatedAt: string;
  rawProviderState?: string;
  receipt?: ProviderRuntimeReceipt;
  result?: string;
  artifacts?: readonly ProviderRuntimeArtifact[];
  error?: string;
  cancelRequestedAt?: string;
  terminalAt?: string;
  quarantine?: Readonly<{
    reason: ProviderLifecycleQuarantineReason;
    rawState?: string;
  }>;
}>;

export type ProviderLifecycleStore = Readonly<{
  get: (scope: A2AScope, idempotencyKey: string) => Promise<ProviderLifecycleRecord | undefined>;
  createOrGetSubmitting: (
    intent: ProviderLifecycleSubmittingIntent,
  ) => Promise<Readonly<{ record: ProviderLifecycleRecord; created: boolean }>>;
  update: (record: ProviderLifecycleRecord, expectedRevision: number) => Promise<ProviderLifecycleRecord>;
}>;

export type ProviderLifecycleRunInput = ProviderLifecycleSubmittingIntent & Readonly<{
  timeoutMs: number;
  signal?: AbortSignal;
}>;

export type ProviderLifecycleRunnerOptions = Readonly<{
  adapter: ProviderRuntimeAdapter;
  store: ProviderLifecycleStore;
  pollIntervalMs?: number;
  maxPolls?: number;
  now?: () => number;
}>;

export class ProviderLifecycleConflictError extends Error {
  constructor(readonly idempotencyKey: string) {
    super('Provider lifecycle idempotency key already exists with a different request hash.');
    this.name = 'ProviderLifecycleConflictError';
  }
}

export class ProviderLifecycleContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderLifecycleContractError';
  }
}

class LifecycleBoundaryError extends Error {
  constructor(readonly kind: 'deadline' | 'canceled') {
    super(kind === 'deadline' ? 'Provider lifecycle deadline exceeded.' : 'Provider lifecycle was canceled.');
  }
}

type RunBoundary = Readonly<{
  deadlineAtMs: number;
  signal: AbortSignal;
  termination: () => 'deadline' | 'canceled' | undefined;
  close: () => void;
}>;

const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_MAX_POLLS = 240;

export class ProviderLifecycleRunner {
  private readonly adapter: ProviderRuntimeAdapter;
  private readonly store: ProviderLifecycleStore;
  private readonly pollIntervalMs: number;
  private readonly maxPolls: number;
  private readonly now: () => number;

  constructor(options: ProviderLifecycleRunnerOptions) {
    this.adapter = options.adapter;
    this.store = options.store;
    this.pollIntervalMs = boundedInteger(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, 0, 60_000, 'pollIntervalMs');
    this.maxPolls = boundedInteger(options.maxPolls, DEFAULT_MAX_POLLS, 1, 100_000, 'maxPolls');
    this.now = options.now ?? Date.now;
  }

  async run(input: ProviderLifecycleRunInput): Promise<ProviderLifecycleRecord> {
    const normalized = normalizeInput(input, this.adapter.providerId);
    const existing = await this.store.get(normalized.scope, normalized.idempotencyKey);
    if (existing) {
      assertMatchingRequest(existing, normalized);
      if (isProviderLifecycleTerminal(existing.state)) return existing;
    }

    const boundary = createBoundary(normalized.timeoutMs, input.signal, this.now);
    const operation = operationInput(normalized, boundary);
    try {
      const preflight = await withinBoundary(this.adapter.preflight(operation), boundary);
      if (!preflight.ready) {
        throw new ProviderLifecycleContractError(nonempty(preflight.reason, 'preflight.reason'));
      }

      const created = await this.store.createOrGetSubmitting(normalized);
      assertMatchingRequest(created.record, normalized);
      let record = created.record;
      if (!created.created) {
        if (isProviderLifecycleTerminal(record.state) || record.state === 'quarantined') return record;
        if (record.state === 'submitting' && !record.receipt) {
          return this.quarantine(record, 'delivery-unknown', record.rawProviderState);
        }
        if (!record.receipt) {
          return this.quarantine(record, 'invalid-provider-response', record.rawProviderState);
        }
        return await this.poll(record, normalized, boundary);
      }

      try {
        const observation = await withinBoundary(this.adapter.submit(operation), boundary);
        record = await this.acceptSubmission(record, observation);
      } catch (error) {
        if (error instanceof LifecycleBoundaryError) {
          return this.quarantine(record, 'delivery-unknown', undefined, error.message);
        }
        return this.fail(record, safeError(error));
      }

      if (record.state !== 'accepted' && record.state !== 'working') return record;
      return await this.poll(record, normalized, boundary);
    } finally {
      boundary.close();
    }
  }

  private async acceptSubmission(
    record: ProviderLifecycleRecord,
    observation: ProviderRuntimeObservation,
  ): Promise<ProviderLifecycleRecord> {
    const rawState = validRawState(observation.rawState);
    const canonical = resolveProviderRuntimeState(this.adapter, rawState);
    if (canonical === 'delivery-unknown') {
      return this.quarantine(record, 'delivery-unknown', rawState);
    }
    if (canonical === 'unknown') {
      return this.quarantine(record, 'unknown-provider-state', rawState);
    }

    if (requiresAcceptedReceipt(canonical)) {
      const providerExecutionId = validProviderExecutionId(observation.providerExecutionId);
      const receipt: ProviderRuntimeReceipt = {
        providerExecutionId,
        ...(observation.providerContextId === undefined
          ? {}
          : { providerContextId: nonempty(observation.providerContextId, 'providerContextId') }),
        acceptedAt: isoNow(this.now),
        rawState,
      };
      record = await this.transition(record, {
        state: 'accepted',
        receipt,
        rawProviderState: rawState,
      });
    }
    if (canonical === 'accepted') return record;
    return this.applyObservation(record, observation, canonical);
  }

  private async poll(
    initial: ProviderLifecycleRecord,
    input: ProviderLifecycleRunInput,
    boundary: RunBoundary,
  ): Promise<ProviderLifecycleRecord> {
    let record = initial;
    if (!record.receipt) return this.quarantine(record, 'invalid-provider-response', record.rawProviderState);
    const operation = { ...operationInput(input, boundary), receipt: record.receipt };

    for (let poll = 0; poll < this.maxPolls; poll += 1) {
      try {
        if (this.pollIntervalMs > 0) await wait(this.pollIntervalMs, boundary);
        const observation = await withinBoundary(this.adapter.get(operation), boundary);
        const rawState = validRawState(observation.rawState);
        const canonical = resolveProviderRuntimeState(this.adapter, rawState);
        if (canonical === 'delivery-unknown') {
          return this.quarantine(record, 'delivery-unknown', rawState);
        }
        if (canonical === 'unknown') {
          return this.quarantine(record, 'unknown-provider-state', rawState);
        }
        record = await this.applyObservation(record, observation, canonical);
        if (record.state !== 'accepted' && record.state !== 'working') return record;
      } catch (error) {
        if (error instanceof LifecycleBoundaryError) {
          return this.cancel(record, input, boundary, error);
        }
        return this.quarantine(record, 'delivery-unknown', record.rawProviderState, safeError(error));
      }
    }
    return this.cancel(record, input, boundary, new LifecycleBoundaryError('deadline'));
  }

  private async cancel(
    record: ProviderLifecycleRecord,
    input: ProviderLifecycleRunInput,
    boundary: RunBoundary,
    cause: LifecycleBoundaryError,
  ): Promise<ProviderLifecycleRecord> {
    if (!record.receipt) return this.quarantine(record, 'delivery-unknown', record.rawProviderState, cause.message);
    const receipt = record.receipt;
    record = await this.transition(record, {
      cancelRequestedAt: isoNow(this.now),
      error: cause.message,
    });
    try {
      const cancellationBoundary = createBoundary(5_000, undefined, this.now);
      try {
        const observation = await withinBoundary(this.adapter.cancel({
          ...operationInput(input, cancellationBoundary),
          receipt,
        }), cancellationBoundary);
        const rawState = validRawState(observation.rawState);
        const canonical = resolveProviderRuntimeState(this.adapter, rawState);
        if (canonical === 'unknown') {
          return this.quarantine(record, 'unknown-provider-state', rawState, cause.message);
        }
        if (canonical === 'delivery-unknown') {
          return this.quarantine(record, 'delivery-unknown', rawState, cause.message);
        }
        return this.applyObservation(record, { ...observation, error: cause.message }, canonical);
      } finally {
        cancellationBoundary.close();
      }
    } catch (error) {
      return this.quarantine(record, 'delivery-unknown', record.rawProviderState, safeError(error));
    }
  }

  private async applyObservation(
    record: ProviderLifecycleRecord,
    observation: ProviderRuntimeObservation,
    state: Exclude<ProviderRuntimeState, 'delivery-unknown' | 'unknown'>,
  ): Promise<ProviderLifecycleRecord> {
    const rawProviderState = validRawState(observation.rawState);
    if (state === 'completed' && !hasProviderCompletionEvidence(observation)) {
      return this.quarantine(record, 'invalid-completion-evidence', rawProviderState);
    }
    const terminal = state === 'completed' || state === 'failed' || state === 'canceled';
    return this.transition(record, {
      state,
      rawProviderState,
      ...(observation.result === undefined ? {} : { result: observation.result }),
      ...(observation.artifacts === undefined ? {} : { artifacts: observation.artifacts }),
      ...(observation.error === undefined ? {} : { error: observation.error }),
      ...(terminal ? { terminalAt: isoNow(this.now) } : {}),
    });
  }

  private quarantine(
    record: ProviderLifecycleRecord,
    reason: ProviderLifecycleQuarantineReason,
    rawState?: string,
    error?: string,
  ): Promise<ProviderLifecycleRecord> {
    return this.transition(record, {
      state: 'quarantined',
      ...(rawState === undefined ? {} : { rawProviderState: rawState }),
      ...(error === undefined ? {} : { error }),
      quarantine: { reason, ...(rawState === undefined ? {} : { rawState }) },
      terminalAt: isoNow(this.now),
    });
  }

  private fail(record: ProviderLifecycleRecord, error: string): Promise<ProviderLifecycleRecord> {
    return this.transition(record, {
      state: 'failed',
      error,
      terminalAt: isoNow(this.now),
    });
  }

  private transition(
    record: ProviderLifecycleRecord,
    change: Partial<ProviderLifecycleRecord>,
  ): Promise<ProviderLifecycleRecord> {
    return this.store.update({ ...record, ...change }, record.revision);
  }
}

export function isProviderLifecycleTerminal(state: ProviderLifecycleState): boolean {
  return state === 'completed' || state === 'failed' || state === 'canceled' || state === 'quarantined';
}

function normalizeInput(input: ProviderLifecycleRunInput, providerId: string): ProviderLifecycleRunInput {
  const scope = normalizeScope(input.scope);
  const normalized: ProviderLifecycleRunInput = {
    scope,
    idempotencyKey: nonempty(input.idempotencyKey, 'idempotencyKey'),
    requestHash: validRequestHash(input.requestHash),
    payload: structuredClone(input.payload),
    requestedCapabilities: Object.freeze(input.requestedCapabilities.map((value) => nonempty(value, 'requestedCapability'))),
    identities: normalizeIdentities(input.identities),
    timeoutMs: boundedInteger(input.timeoutMs, 0, 1, 24 * 60 * 60 * 1_000, 'timeoutMs'),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  };
  if (normalized.identities.provider.id !== providerId) {
    throw new ProviderLifecycleContractError('Provider identity does not match the selected runtime adapter.');
  }
  return normalized;
}

function normalizeScope(scope: A2AScope): A2AScope {
  return {
    tenantId: nonempty(scope.tenantId, 'scope.tenantId'),
    requesterId: nonempty(scope.requesterId, 'scope.requesterId'),
    conversationId: nonempty(scope.conversationId, 'scope.conversationId'),
  };
}

function normalizeIdentities(value: ProviderRuntimeIdentities): ProviderRuntimeIdentities {
  return {
    provider: { id: nonempty(value.provider.id, 'identities.provider.id') },
    credential: {
      principalId: nonempty(value.credential.principalId, 'identities.credential.principalId'),
      reference: nonempty(value.credential.reference, 'identities.credential.reference'),
    },
    execution: { id: nonempty(value.execution.id, 'identities.execution.id') },
    context: { id: nonempty(value.context.id, 'identities.context.id') },
    runtime: { boundaryId: nonempty(value.runtime.boundaryId, 'identities.runtime.boundaryId') },
    audit: { id: nonempty(value.audit.id, 'identities.audit.id') },
  };
}

function operationInput(input: ProviderLifecycleRunInput, boundary: RunBoundary): ProviderRuntimeOperationInput {
  return {
    scope: input.scope,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    payload: input.payload,
    requestedCapabilities: input.requestedCapabilities,
    identities: input.identities,
    deadlineAtMs: boundary.deadlineAtMs,
    signal: boundary.signal,
  };
}

function createBoundary(timeoutMs: number, parentSignal: AbortSignal | undefined, now: () => number): RunBoundary {
  const controller = new AbortController();
  let termination: 'deadline' | 'canceled' | undefined;
  const abortFromParent = () => {
    termination = 'canceled';
    controller.abort(parentSignal?.reason ?? new Error('Provider lifecycle was canceled.'));
  };
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  const timer = setTimeout(() => {
    if (controller.signal.aborted) return;
    termination = 'deadline';
    controller.abort(new Error('Provider lifecycle deadline exceeded.'));
  }, timeoutMs);
  return {
    deadlineAtMs: now() + timeoutMs,
    signal: controller.signal,
    termination: () => termination,
    close: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
}

async function withinBoundary<T>(promise: Promise<T>, boundary: RunBoundary): Promise<T> {
  if (boundary.signal.aborted) throw new LifecycleBoundaryError(boundary.termination() ?? 'canceled');
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new LifecycleBoundaryError(boundary.termination() ?? 'canceled'));
    boundary.signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    if (onAbort) boundary.signal.removeEventListener('abort', onAbort);
  }
}

function wait(delayMs: number, boundary: RunBoundary): Promise<void> {
  return withinBoundary(new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  }), boundary);
}

function assertMatchingRequest(record: ProviderLifecycleRecord, input: ProviderLifecycleSubmittingIntent): void {
  if (record.requestHash !== input.requestHash) throw new ProviderLifecycleConflictError(input.idempotencyKey);
  if (!sameScope(record.scope, input.scope)) {
    throw new ProviderLifecycleContractError('Provider lifecycle store returned a record outside server-derived scope.');
  }
}

function sameScope(left: A2AScope, right: A2AScope): boolean {
  return left.tenantId === right.tenantId
    && left.requesterId === right.requesterId
    && left.conversationId === right.conversationId;
}

function requiresAcceptedReceipt(state: ProviderRuntimeState): boolean {
  return state === 'accepted'
    || state === 'working'
    || state === 'input-required'
    || state === 'auth-required'
    || state === 'completed';
}

function validProviderExecutionId(value: string | undefined): string {
  if (value === undefined) throw new ProviderLifecycleContractError('Accepted provider response requires providerExecutionId.');
  return nonempty(value, 'providerExecutionId');
}

function validRawState(value: string): string {
  return nonempty(value, 'rawState');
}

function validRequestHash(value: string): string {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new ProviderLifecycleContractError('requestHash must be a SHA-256 hex digest.');
  return value.toLowerCase();
}

function nonempty(value: string, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 1_024) {
    throw new ProviderLifecycleContractError(`${name} must be a non-empty bounded string.`);
  }
  return value;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const candidate = value ?? fallback;
  if (!Number.isFinite(candidate) || !Number.isInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new ProviderLifecycleContractError(`${name} is outside its supported bounds.`);
  }
  return candidate;
}

function isoNow(now: () => number): string {
  return new Date(now()).toISOString();
}

function safeError(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message.slice(0, 2_000)
    : 'Provider runtime operation failed.';
}
