import type { A2AScope } from './a2a-contract.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;

export type ProviderRuntimeState =
  | 'accepted'
  | 'working'
  | 'input-required'
  | 'auth-required'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'rejected'
  | 'delivery-unknown'
  | 'unknown';

const PROVIDER_RUNTIME_STATES = new Set<ProviderRuntimeState>([
  'accepted', 'working', 'input-required', 'auth-required', 'completed',
  'failed', 'canceled', 'rejected', 'delivery-unknown', 'unknown',
]);

export type ProviderRuntimeIdentities = Readonly<{
  provider: Readonly<{ id: string }>;
  credential: Readonly<{ principalId: string; reference: string }>;
  execution: Readonly<{ id: string }>;
  context: Readonly<{ id: string }>;
  runtime: Readonly<{ boundaryId: string }>;
  audit: Readonly<{ id: string }>;
}>;

export type ProviderRuntimeArtifact = Readonly<{
  artifactId: string;
  name: string;
  mediaType: string;
  text?: string;
  uri?: string;
  sha256?: string;
  byteSize?: number;
  repository?: string;
  commitSha?: string;
  authorship?: Readonly<Record<string, string>>;
}>;

export type ProviderAcceptedReceipt = Readonly<{
  providerExecutionId: string;
  providerSessionId?: string;
  providerContextId?: string;
  acceptedAt: string;
  rawState: string;
  reconciliationRef?: string;
}>;

/** Backward-compatible lifecycle name used by the durable runner. */
export type ProviderRuntimeReceipt = ProviderAcceptedReceipt;

export type ProviderRuntimeObservation = Readonly<{
  rawState: string;
  providerExecutionId?: string;
  providerSessionId?: string;
  providerContextId?: string;
  providerCursor?: string;
  result?: string;
  error?: string;
  artifacts?: readonly ProviderRuntimeArtifact[];
  auditRefs?: readonly string[];
}>;

export type ProviderRuntimeOperationInput = Readonly<{
  scope: A2AScope;
  idempotencyKey: string;
  requestHash: string;
  payload: Readonly<Record<string, unknown>>;
  requestedCapabilities: readonly string[];
  identities: ProviderRuntimeIdentities;
  deadlineAtMs: number;
  signal: AbortSignal;
}>;

export type ProviderRuntimeReceiptOperationInput = ProviderRuntimeOperationInput & Readonly<{
  receipt: ProviderAcceptedReceipt;
}>;

export type ProviderRuntimePreflight =
  | Readonly<{ ready: true; capabilities: readonly string[] }>
  | Readonly<{ ready: false; reason: string }>;

export type ProviderRuntimeAdapter = Readonly<{
  providerId: string;
  classifyState(rawState: string): ProviderRuntimeState;
  preflight(input: ProviderRuntimeOperationInput): Promise<ProviderRuntimePreflight>;
  submit(input: ProviderRuntimeOperationInput): Promise<ProviderRuntimeObservation>;
  get(input: ProviderRuntimeReceiptOperationInput): Promise<ProviderRuntimeObservation>;
  cancel(input: ProviderRuntimeReceiptOperationInput): Promise<ProviderRuntimeObservation>;
}>;

export function createProviderRuntimeAdapter(adapter: ProviderRuntimeAdapter): ProviderRuntimeAdapter {
  if (!adapter || typeof adapter !== 'object') throw new TypeError('provider runtime adapter is required');
  if (typeof adapter.providerId !== 'string' || !SAFE_ID.test(adapter.providerId)) {
    throw new TypeError('provider runtime adapter providerId must be a bounded identifier');
  }
  for (const method of ['classifyState', 'preflight', 'submit', 'get', 'cancel'] as const) {
    if (typeof adapter[method] !== 'function') {
      throw new TypeError(`provider runtime adapter ${method} must be a function`);
    }
  }
  return Object.freeze({ ...adapter });
}

export function resolveProviderRuntimeState(
  adapter: Pick<ProviderRuntimeAdapter, 'classifyState'>,
  rawState: string,
): ProviderRuntimeState {
  if (typeof rawState !== 'string' || !rawState.trim()) return 'unknown';
  try {
    const state = adapter.classifyState(rawState);
    return PROVIDER_RUNTIME_STATES.has(state) ? state : 'unknown';
  } catch {
    return 'unknown';
  }
}

export function hasProviderCompletionEvidence(
  observation: Pick<ProviderRuntimeObservation, 'result' | 'artifacts'>,
): boolean {
  if (typeof observation.result === 'string' && Boolean(observation.result.trim())) return true;
  return Boolean(observation.artifacts?.some((artifact) => (
    typeof artifact.text === 'string' && Boolean(artifact.text.trim())
    || typeof artifact.uri === 'string' && isHttpsUrl(artifact.uri)
    || typeof artifact.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(artifact.sha256)
  )));
}

function isHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}
