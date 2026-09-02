import type { A2AJsonData, A2AScope } from './a2a-contract.js';

export type ProviderRuntimeState =
  | 'accepted'
  | 'working'
  | 'input-required'
  | 'auth-required'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'delivery-unknown'
  | 'unknown';

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
  uri?: string;
  text?: string;
  sha256?: string;
}>;

export type ProviderRuntimeReceipt = Readonly<{
  providerExecutionId: string;
  providerContextId?: string;
  acceptedAt: string;
  rawState: string;
}>;

export type ProviderRuntimeObservation = Readonly<{
  rawState: string;
  providerExecutionId?: string;
  providerContextId?: string;
  result?: string;
  artifacts?: readonly ProviderRuntimeArtifact[];
  error?: string;
}>;

export type ProviderRuntimeOperationInput = Readonly<{
  scope: A2AScope;
  idempotencyKey: string;
  requestHash: string;
  payload: A2AJsonData;
  requestedCapabilities: readonly string[];
  identities: ProviderRuntimeIdentities;
  deadlineAtMs: number;
  signal: AbortSignal;
}>;

export type ProviderRuntimeReceiptOperationInput = ProviderRuntimeOperationInput & Readonly<{
  receipt: ProviderRuntimeReceipt;
}>;

export type ProviderRuntimePreflightResult =
  | Readonly<{ ready: true; capabilities: readonly string[] }>
  | Readonly<{ ready: false; reason: string }>;

export type ProviderRuntimeAdapter = Readonly<{
  providerId: string;
  classifyState: (rawState: string) => ProviderRuntimeState;
  preflight: (input: ProviderRuntimeOperationInput) => Promise<ProviderRuntimePreflightResult>;
  submit: (input: ProviderRuntimeOperationInput) => Promise<ProviderRuntimeObservation>;
  get: (input: ProviderRuntimeReceiptOperationInput) => Promise<ProviderRuntimeObservation>;
  cancel: (input: ProviderRuntimeReceiptOperationInput) => Promise<ProviderRuntimeObservation>;
}>;

const RUNTIME_STATES = new Set<ProviderRuntimeState>([
  'accepted',
  'working',
  'input-required',
  'auth-required',
  'completed',
  'failed',
  'canceled',
  'delivery-unknown',
  'unknown',
]);

const IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

export function createProviderRuntimeAdapter(adapter: ProviderRuntimeAdapter): ProviderRuntimeAdapter {
  if (!IDENTITY_PATTERN.test(adapter.providerId)) {
    throw new TypeError('providerId must be a stable non-empty provider identity.');
  }
  for (const operation of ['classifyState', 'preflight', 'submit', 'get', 'cancel'] as const) {
    if (typeof adapter[operation] !== 'function') {
      throw new TypeError(`Provider runtime adapter ${operation} must be a function.`);
    }
  }
  return Object.freeze({ ...adapter });
}

export function resolveProviderRuntimeState(adapter: ProviderRuntimeAdapter, rawState: string): ProviderRuntimeState {
  if (typeof rawState !== 'string' || rawState.trim().length === 0) return 'unknown';
  try {
    const state = adapter.classifyState(rawState);
    return RUNTIME_STATES.has(state) ? state : 'unknown';
  } catch {
    return 'unknown';
  }
}

export function hasProviderCompletionEvidence(
  value: Pick<ProviderRuntimeObservation, 'result' | 'artifacts'>,
): boolean {
  if (typeof value.result === 'string' && value.result.trim().length > 0) return true;
  return value.artifacts?.some((artifact) => {
    if (!artifact || typeof artifact.artifactId !== 'string' || artifact.artifactId.trim().length === 0) return false;
    return hasText(artifact.text) || hasText(artifact.uri) || hasText(artifact.sha256);
  }) ?? false;
}

function hasText(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
