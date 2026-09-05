import {
  createProviderRuntimeAdapter,
  hasProviderCompletionEvidence,
  isOpaqueProviderCredentialReference,
  redactProviderRuntimeText,
  type ProviderRuntimeAdapter,
  type ProviderRuntimeArtifact,
  type ProviderRuntimeObservation,
  type ProviderRuntimeOperationInput,
  type ProviderRuntimeReceiptOperationInput,
} from '../provider-runtime-adapter.js';

const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_ATTEMPTS = 5;
const MAX_RETRY_DELAY_MS = 2_000;
const RESPONSE_PAYLOAD_KEYS = new Set(['input']);

export type GrokProviderPreflightPort = Readonly<{
  verify(input: Readonly<{
    model: string;
    credentialReference: string;
    principalId: string;
    signal: AbortSignal;
  }>): Promise<Readonly<{
    ready: boolean;
    modelId?: string;
    reason: string;
  }>>;
}>;

export type GrokProviderExecutionSnapshot = Readonly<{
  responseId: string;
  status: string;
  result?: string;
  artifacts?: readonly ProviderRuntimeArtifact[];
  error?: string;
  verified?: boolean;
}>;

export class GrokProviderTransportError extends Error {
  constructor(
    readonly status: number,
    diagnostic: string,
    readonly retryable: boolean,
  ) {
    super(diagnostic);
    this.name = 'GrokProviderTransportError';
  }
}

export type GrokProviderExecutionPort = Readonly<{
  submit(input: Readonly<{
    model: string;
    credentialReference: string;
    principalId: string;
    idempotencyKey: string;
    requestHash: string;
    payload: Readonly<Record<string, unknown>>;
    signal: AbortSignal;
  }>): Promise<GrokProviderExecutionSnapshot>;
  retrieve(input: Readonly<{
    responseId: string;
    model: string;
    credentialReference: string;
    principalId: string;
    signal: AbortSignal;
  }>): Promise<GrokProviderExecutionSnapshot>;
  reconcile(input: Readonly<{
    model: string;
    credentialReference: string;
    principalId: string;
    idempotencyKey: string;
    requestHash: string;
    signal: AbortSignal;
  }>): Promise<GrokProviderExecutionSnapshot | undefined>;
}>;

export function createGrokProviderRuntimeAdapter(options: Readonly<{
  model: string;
  preflight: GrokProviderPreflightPort;
  execution: GrokProviderExecutionPort;
  maxAttempts?: number;
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}>): ProviderRuntimeAdapter {
  const model = requireModel(options.model);
  const maxAttempts = requireMaxAttempts(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const sleep = options.sleep ?? defaultSleep;

  const execute = <T>(signal: AbortSignal, operation: () => Promise<T>) => (
    withBoundedRetry(operation, { maxAttempts, signal, sleep })
  );

  return createProviderRuntimeAdapter({
    providerId: 'grok-xai',
    classifyState: classifyGrokState,
    async preflight(input) {
      const credential = credentialFor(input);
      let checked: Awaited<ReturnType<GrokProviderPreflightPort['verify']>>;
      try {
        checked = await execute(input.signal, () => options.preflight.verify({
          model,
          credentialReference: credential.reference,
          principalId: credential.principalId,
          signal: input.signal,
        }));
      } catch (error) {
        if (input.signal.aborted) throw abortReason(input.signal);
        return {
          ready: false,
          reason: `Grok model and credential preflight failed: ${safeDiagnostic(error)}`,
        };
      }
      if (!checked.ready || checked.modelId !== model) {
        return { ready: false, reason: 'Grok model and credential preflight was not verified.' };
      }
      const requested = uniqueCapabilities(input.requestedCapabilities);
      if (requested.some((capability) => capability !== 'responses')) {
        return { ready: false, reason: 'Grok adapter does not support every requested capability.' };
      }
      return { ready: true, capabilities: requested };
    },
    async submit(input) {
      const credential = credentialFor(input);
      const payload = validateResponsePayload(input.payload);
      // A Responses POST may have been accepted before a 5xx/network error is
      // observed. xAI's public contract does not provide a durable POST
      // idempotency guarantee for this adapter, so an ambiguous submit is
      // surfaced to the lifecycle quarantine path instead of being replayed.
      const submitted = await executeWithoutRetry(input.signal, () => options.execution.submit({
        model,
        credentialReference: credential.reference,
        principalId: credential.principalId,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        payload,
        signal: input.signal,
      }));
      return submissionObservation(submitted, input.identities.context.id);
    },
    async get(input) {
      const credential = receiptCredentialFor(input);
      const snapshot = await execute(input.signal, () => options.execution.retrieve({
        responseId: input.receipt.providerExecutionId,
        model,
        credentialReference: credential.reference,
        principalId: credential.principalId,
        signal: input.signal,
      }));
      return snapshotObservation(snapshot, input.receipt.providerExecutionId, input.identities.context.id);
    },
    async cancel(input) {
      receiptCredentialFor(input);
      return {
        rawState: 'unsupported',
        providerExecutionId: input.receipt.providerExecutionId,
        providerContextId: input.identities.context.id,
        error: 'Local HTTP abort cannot cancel an xAI provider task; no official remote cancellation endpoint is documented.',
      };
    },
    async reconcile(input) {
      const credential = credentialFor(input);
      const snapshot = await execute(input.signal, () => options.execution.reconcile({
        model,
        credentialReference: credential.reference,
        principalId: credential.principalId,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        signal: input.signal,
      }));
      if (!snapshot) {
        return {
          rawState: 'delivery-unknown',
          providerContextId: input.identities.context.id,
          error: 'No durable xAI response receipt was found during restart reconciliation.',
        };
      }
      return snapshotObservation(snapshot, undefined, input.identities.context.id);
    },
  });
}

function acceptedObservation(responseId: string, contextId: string): ProviderRuntimeObservation {
  return {
    rawState: 'accepted',
    providerExecutionId: responseId,
    providerContextId: contextId,
    providerCursor: responseId,
    auditRefs: [`xai-response:${responseId}`],
  };
}

function submissionObservation(
  snapshot: GrokProviderExecutionSnapshot,
  contextId: string,
): ProviderRuntimeObservation {
  const status = normalizedStatus(snapshot.status);
  const state = classifyGrokState(status);
  if (state === 'accepted' || state === 'working') {
    return acceptedObservation(requireResponseId(snapshot.responseId), contextId);
  }
  if (state === 'completed') {
    const observation = snapshotObservation(snapshot, undefined, contextId);
    if (classifyGrokState(observation.rawState) === 'completed') return observation;
  }
  const diagnostic = snapshot.error
    ? redactProviderRuntimeText(snapshot.error, 500)
    : `status=${status}`;
  throw new Error(`Grok provider submission was not accepted: ${diagnostic || 'provider rejected the request'}`);
}

function snapshotObservation(
  snapshot: GrokProviderExecutionSnapshot,
  expectedResponseId: string | undefined,
  contextId: string,
): ProviderRuntimeObservation {
  const responseId = requireResponseId(snapshot.responseId);
  if (expectedResponseId !== undefined && responseId !== expectedResponseId) {
    throw new Error('Grok response receipt continuity mismatch.');
  }
  const rawState = normalizedStatus(snapshot.status);
  const state = classifyGrokState(rawState);
  const common = {
    rawState,
    providerExecutionId: responseId,
    providerContextId: contextId,
    providerCursor: responseId,
    auditRefs: [`xai-response:${responseId}`],
  } as const;
  if (state === 'completed') {
    const evidence = {
      ...(snapshot.result === undefined ? {} : { result: snapshot.result }),
      ...(snapshot.artifacts === undefined ? {} : { artifacts: snapshot.artifacts }),
    };
    if (snapshot.verified !== true || !hasProviderCompletionEvidence(evidence)) {
      return {
        ...common,
        rawState: 'failed',
        error: 'Grok completed response did not include verified completion evidence.',
      };
    }
    return { ...common, ...evidence };
  }
  return {
    ...common,
    ...(snapshot.error === undefined ? {} : { error: redactProviderRuntimeText(snapshot.error) }),
  };
}

function requireModel(value: string): string {
  if (typeof value !== 'string' || !SAFE_MODEL.test(value)) throw new TypeError('Grok model must be a bounded identifier.');
  return value;
}

function requireMaxAttempts(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_ATTEMPTS) {
    throw new TypeError(`Grok maxAttempts must be an integer from 1 to ${MAX_ATTEMPTS}.`);
  }
  return value;
}

function credentialFor(input: ProviderRuntimeOperationInput) {
  if (input.identities.provider.id !== 'grok-xai') throw new Error('Grok provider identity mismatch.');
  const credential = input.identities.credential;
  if (!isOpaqueProviderCredentialReference(credential.reference)) {
    throw new TypeError('Grok credential must be an opaque env:// or key-vault:// reference.');
  }
  return credential;
}

function receiptCredentialFor(input: ProviderRuntimeReceiptOperationInput) {
  const credential = credentialFor(input);
  if (input.receipt.providerContextId !== undefined && input.receipt.providerContextId !== input.identities.context.id) {
    throw new Error('Grok response context continuity mismatch.');
  }
  requireResponseId(input.receipt.providerExecutionId);
  return credential;
}

function requireResponseId(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)) {
    throw new Error('Grok submission did not return a durable response receipt.');
  }
  return value;
}

function validateResponsePayload(payload: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  const unsupported = Object.keys(payload).filter((key) => !RESPONSE_PAYLOAD_KEYS.has(key));
  if (unsupported.length > 0) {
    throw new TypeError('Grok Responses payload contains unsupported fields.');
  }
  const input = payload.input;
  if (typeof input === 'string' ? !input.trim() : !Array.isArray(input) || input.length === 0) {
    throw new TypeError('Grok Responses payload requires non-empty input.');
  }
  return Object.freeze({ input: typeof input === 'string' ? input.trim() : input });
}

function uniqueCapabilities(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values.map((value) => value.trim()).filter(Boolean))]);
}

function normalizedStatus(value: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) return 'unknown';
  return value.trim().toLowerCase();
}

function classifyGrokState(rawState: string) {
  switch (rawState.trim().toLowerCase()) {
    case 'accepted':
    case 'queued': return 'accepted' as const;
    case 'in_progress':
    case 'working': return 'working' as const;
    case 'completed': return 'completed' as const;
    case 'failed':
    case 'incomplete': return 'failed' as const;
    case 'canceled':
    case 'cancelled': return 'canceled' as const;
    default: return 'unknown' as const;
  }
}

async function withBoundedRetry<T>(
  operation: () => Promise<T>,
  options: Readonly<{
    maxAttempts: number;
    signal: AbortSignal;
    sleep: (delayMs: number, signal: AbortSignal) => Promise<void>;
  }>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    if (options.signal.aborted) throw abortReason(options.signal);
    try {
      return await operation();
    } catch (error) {
      if (options.signal.aborted) throw abortReason(options.signal);
      lastError = error;
      if (!isRetryable(error) || attempt === options.maxAttempts) break;
      await options.sleep(Math.min(MAX_RETRY_DELAY_MS, 100 * 2 ** (attempt - 1)), options.signal);
    }
  }
  throw projectedTransportError(lastError);
}

async function executeWithoutRetry<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  if (signal.aborted) throw abortReason(signal);
  try {
    return await operation();
  } catch (error) {
    if (signal.aborted) throw abortReason(signal);
    throw projectedTransportError(error);
  }
}

function isRetryable(error: unknown): boolean {
  return error instanceof GrokProviderTransportError
    && error.retryable
    && (error.status === 429 || error.status >= 500 && error.status <= 599);
}

function projectedTransportError(error: unknown): Error {
  if (error instanceof GrokProviderTransportError) {
    return new Error(`Grok provider request failed with HTTP ${error.status}: ${safeDiagnostic(error)}`);
  }
  return new Error(`Grok provider request failed: ${safeDiagnostic(error)}`);
}

function safeDiagnostic(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redactProviderRuntimeText(raw, 500) || 'provider diagnostic unavailable';
}

function abortReason(signal: AbortSignal): unknown {
  return new Error(signal.aborted
    ? 'Grok local HTTP operation was aborted.'
    : 'Grok local HTTP operation did not complete.');
}

function defaultSleep(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
