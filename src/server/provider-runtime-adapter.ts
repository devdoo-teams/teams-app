import crypto from 'node:crypto';

import type { A2AScope } from './a2a-contract.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAX_RESULT_CHARS = 65_536;
const MAX_ERROR_CHARS = 4_000;
const MAX_ARTIFACTS = 32;
const MAX_ARTIFACT_TEXT_CHARS = 65_536;
const MAX_AUDIT_REFS = 64;

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
  reconcile?(input: ProviderRuntimeOperationInput): Promise<ProviderRuntimeObservation>;
}>;

export type ProviderRuntimeObservationPhase = 'submit' | 'get' | 'cancel' | 'reconcile';

export type ValidatedProviderRuntimeObservation = ProviderRuntimeObservation & Readonly<{
  state: ProviderRuntimeState;
}>;

export class ProviderRuntimeObservationValidationError extends Error {
  constructor(
    readonly code: 'invalid-provider-observation' | 'invalid-completion-evidence',
    message: string,
  ) {
    super(message);
    this.name = 'ProviderRuntimeObservationValidationError';
  }
}

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
  if (adapter.reconcile !== undefined && typeof adapter.reconcile !== 'function') {
    throw new TypeError('provider runtime adapter reconcile must be a function when provided');
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
    typeof artifact.sha256 === 'string'
    && SHA256.test(artifact.sha256)
    && (
      typeof artifact.uri === 'string' && isSafeArtifactUrl(artifact.uri)
      || typeof artifact.text === 'string'
        && Boolean(artifact.text.trim())
        && crypto.createHash('sha256').update(artifact.text).digest('hex') === artifact.sha256
    )
  )));
}

export function isOpaqueProviderCredentialReference(value: string): boolean {
  if (typeof value !== 'string' || value.length > 512 || /\s/u.test(value)) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'env:' && parsed.protocol !== 'key-vault:') return false;
    if (!parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) return false;
    return !parsed.pathname.split('/').includes('..');
  } catch {
    return false;
  }
}

export function validateProviderRuntimeObservation(
  adapter: Pick<ProviderRuntimeAdapter, 'classifyState'>,
  observation: ProviderRuntimeObservation,
  context: Readonly<{
    phase: ProviderRuntimeObservationPhase;
    receipt?: ProviderAcceptedReceipt;
  }>,
): ValidatedProviderRuntimeObservation {
  if (!observation || typeof observation !== 'object') {
    throw new TypeError('Provider observation must be an object.');
  }
  if ((context.phase === 'get' || context.phase === 'cancel') && !context.receipt) {
    throw new TypeError(`Provider ${context.phase} observation requires an accepted receipt.`);
  }

  const rawState = boundedRedactedText(observation.rawState, 200, 'rawState');
  const state = resolveProviderRuntimeState(adapter, rawState);
  const providerExecutionId = optionalId(observation.providerExecutionId, 'providerExecutionId');
  const providerSessionId = optionalId(observation.providerSessionId, 'providerSessionId');
  const providerContextId = optionalId(observation.providerContextId, 'providerContextId');
  const providerCursor = optionalBoundedText(observation.providerCursor, 512, 'providerCursor');
  assertReceiptContinuity(context.receipt, { providerExecutionId, providerSessionId, providerContextId });
  if (context.phase === 'cancel' && state === 'completed') {
    throw new ProviderRuntimeObservationValidationError(
      'invalid-provider-observation',
      'Provider cancel observation cannot transition the lifecycle to completed.',
    );
  }

  const result = optionalBoundedText(observation.result, MAX_RESULT_CHARS, 'result');
  const error = optionalBoundedText(observation.error, MAX_ERROR_CHARS, 'error');
  const artifacts = observation.artifacts === undefined
    ? undefined
    : observation.artifacts.slice(0, MAX_ARTIFACTS).map(sanitizeArtifact);
  const auditRefs = observation.auditRefs === undefined
    ? undefined
    : observation.auditRefs.slice(0, MAX_AUDIT_REFS).map((reference) => (
      boundedRedactedText(reference, 512, 'auditRef')
    ));

  const validated: ValidatedProviderRuntimeObservation = {
    rawState,
    state,
    ...(providerExecutionId === undefined ? {} : { providerExecutionId }),
    ...(providerSessionId === undefined ? {} : { providerSessionId }),
    ...(providerContextId === undefined ? {} : { providerContextId }),
    ...(providerCursor === undefined ? {} : { providerCursor }),
    ...(result === undefined ? {} : { result }),
    ...(error === undefined ? {} : { error }),
    ...(artifacts === undefined ? {} : { artifacts }),
    ...(auditRefs === undefined ? {} : { auditRefs }),
  };
  if (state === 'completed' && !hasProviderCompletionEvidence(validated)) {
    throw new ProviderRuntimeObservationValidationError(
      'invalid-completion-evidence',
      'Provider completed observation requires a non-empty result or immutable content-addressed artifact.',
    );
  }
  return Object.freeze(validated);
}

function sanitizeArtifact(artifact: ProviderRuntimeArtifact): ProviderRuntimeArtifact {
  if (!artifact || typeof artifact !== 'object') throw new TypeError('Provider artifact must be an object.');
  const artifactId = boundedId(artifact.artifactId, 'artifactId');
  const name = boundedRedactedText(artifact.name, 512, 'artifact name');
  const mediaType = boundedRedactedText(artifact.mediaType, 200, 'artifact mediaType');
  const rawText = artifact.text;
  const text = rawText === undefined ? undefined : boundedArtifactText(rawText);
  const uri = artifact.uri === undefined ? undefined : validateArtifactUrl(artifact.uri);
  const sha256 = artifact.sha256 === undefined ? undefined : validateSha256(artifact.sha256);
  if (rawText !== undefined && sha256 !== undefined) {
    const actual = crypto.createHash('sha256').update(rawText).digest('hex');
    if (actual !== sha256) throw new Error('Provider artifact sha256 does not match its text content.');
  }
  const byteSize = artifact.byteSize === undefined ? undefined : boundedByteSize(artifact.byteSize);
  const repository = artifact.repository === undefined
    ? undefined
    : sanitizeRepository(artifact.repository);
  const commitSha = artifact.commitSha === undefined
    ? undefined
    : validateCommitSha(artifact.commitSha);
  const authorship = artifact.authorship === undefined
    ? undefined
    : sanitizeAuthorship(artifact.authorship);
  const textWasRedacted = rawText !== undefined && text !== rawText;

  return Object.freeze({
    artifactId,
    name,
    mediaType,
    ...(text === undefined ? {} : { text }),
    ...(uri === undefined ? {} : { uri }),
    ...(sha256 === undefined || textWasRedacted ? {} : { sha256 }),
    ...(byteSize === undefined ? {} : { byteSize }),
    ...(repository === undefined ? {} : { repository }),
    ...(commitSha === undefined ? {} : { commitSha }),
    ...(authorship === undefined ? {} : { authorship }),
  });
}

function assertReceiptContinuity(
  receipt: ProviderAcceptedReceipt | undefined,
  observation: Pick<ProviderRuntimeObservation, 'providerExecutionId' | 'providerSessionId' | 'providerContextId'>,
): void {
  if (!receipt) return;
  for (const [label, expected, actual] of [
    ['task', receipt.providerExecutionId, observation.providerExecutionId],
    ['session', receipt.providerSessionId, observation.providerSessionId],
    ['context', receipt.providerContextId, observation.providerContextId],
  ] as const) {
    if (expected !== undefined && actual !== expected) {
      throw new Error(`Provider ${label} continuity validation failed.`);
    }
  }
}

function boundedId(value: string, field: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new TypeError(`Provider ${field} must be a bounded identifier.`);
  }
  return value;
}

function optionalId(value: string | undefined, field: string): string | undefined {
  return value === undefined ? undefined : boundedId(value, field);
}

function boundedRedactedText(value: string, maximum: number, field: string): string {
  if (typeof value !== 'string') throw new TypeError(`Provider ${field} must be a string.`);
  return redactProviderRuntimeText(value, maximum);
}

function optionalBoundedText(value: string | undefined, maximum: number, field: string): string | undefined {
  return value === undefined ? undefined : boundedRedactedText(value, maximum, field);
}

export function redactProviderRuntimeText(value: string, maximum = MAX_ERROR_CHARS): string {
  if (typeof value !== 'string') return '';
  return redactCredentialFragments(value)
    .slice(0, maximum)
    .trim();
}

function boundedArtifactText(value: string): string {
  if (typeof value !== 'string') throw new TypeError('Provider artifact text must be a string.');
  return redactCredentialFragments(value).slice(0, MAX_ARTIFACT_TEXT_CHARS);
}

function redactCredentialFragments(value: string): string {
  return redactCredentialUrls(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}={0,2}/giu, 'Bearer [REDACTED]')
    .replace(/\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret|token)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu, '$1[REDACTED]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|xai-[A-Za-z0-9_-]{8,})\b/gu, '[REDACTED]');
}

function redactCredentialUrls(value: string): string {
  return value.replace(/[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"']+/gu, (candidate) => {
    try {
      const parsed = new URL(candidate);
      const sensitiveQuery = hasSensitiveUriParameters(parsed.search);
      const sensitiveFragment = hasSensitiveUriParameters(parsed.hash);
      return parsed.username || parsed.password || sensitiveQuery || sensitiveFragment
        ? '[REDACTED_URL]'
        : candidate;
    } catch {
      return candidate;
    }
  });
}

function hasSensitiveUriParameters(value: string): boolean {
  const parameters = value.replace(/^[?#]/u, '');
  if ([...new URLSearchParams(parameters).keys()].some(isSensitiveUriParameterName)) return true;
  let decoded = parameters;
  for (let attempt = 0; attempt <= parameters.length; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded.split(/[?&#;/]/u).some(isSensitiveUriParameterName);
}

function isSensitiveUriParameterName(value: string): boolean {
  const normalized = value.split('=', 1)[0]?.toLowerCase().replace(/[^a-z0-9]/gu, '') ?? '';
  return /api.?key|oauth|code|accesstoken|sig|token|secret|password|auth|credential/u.test(normalized);
}

function validateArtifactUrl(value: string): string {
  if (!isSafeArtifactUrl(value)) {
    throw new Error('Provider artifact uri must be bounded HTTPS without credentials, query, or fragment.');
  }
  return value;
}

function isSafeArtifactUrl(value: string): boolean {
  if (typeof value !== 'string' || value.length > 2_048) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:'
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password
      && !parsed.search
      && !parsed.hash;
  } catch {
    return false;
  }
}

function validateSha256(value: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new TypeError('Provider artifact sha256 must be a lowercase SHA-256 digest.');
  }
  return value;
}

function boundedByteSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('Provider artifact byteSize must be a non-negative safe integer.');
  }
  return value;
}

function sanitizeRepository(value: string): string {
  const bounded = boundedRedactedText(value, 512, 'artifact repository');
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(bounded) && !isSafeArtifactUrl(bounded)) {
    throw new Error('Provider artifact repository URL must not contain credentials, query, or fragment.');
  }
  return bounded;
}

function validateCommitSha(value: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{7,64}$/u.test(value)) {
    throw new TypeError('Provider artifact commitSha must be a hexadecimal commit identifier.');
  }
  return value;
}

function sanitizeAuthorship(value: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Provider artifact authorship must be an object.');
  }
  const entries = Object.entries(value).slice(0, 32).map(([key, author]) => [
    boundedRedactedText(key, 100, 'artifact authorship key'),
    boundedRedactedText(author, 512, 'artifact authorship value'),
  ] as const);
  return Object.freeze(Object.fromEntries(entries));
}
