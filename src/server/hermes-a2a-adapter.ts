import crypto from 'node:crypto';

import type { A2AAgentAuthorizationPolicy } from './a2a-agent-authorization.js';
import type {
  A2AOrchestratorChildExecutionResult,
} from './a2a-orchestrator.js';
import type {
  A2AProductionAgent,
  A2AProductionChildExecutionInput,
  A2AProductionChildRecoveryInput,
} from './a2a-production-runtime.js';
import {
  createA2ARemoteClient,
  type A2ARemoteAgentCard,
  type A2ARemoteClient,
  type A2ARemoteFetch,
  type A2ARemoteJsonRpcInterface,
  type A2ARemoteMessage,
  type A2ARemoteSecurityRequirement,
  type A2ARemoteTask,
} from './a2a-remote-client.js';
import {
  createProviderRuntimeAdapter,
  type ProviderAcceptedReceipt,
  type ProviderRuntimeAdapter,
  type ProviderRuntimeArtifact,
  type ProviderRuntimeObservation,
  type ProviderRuntimeOperationInput,
} from './provider-runtime-adapter.js';
import {
  ProviderLifecycleRunner,
  isProviderLifecycleTerminal,
  type ProviderLifecycleRecord,
  type ProviderLifecycleStore,
} from './provider-lifecycle-runner.js';

const SAFE_ENV_REFERENCE = /^[A-Z][A-Z0-9_]{0,127}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const MAX_TEXT_LENGTH = 20_000;

export type HermesA2AAdapterOptions = Readonly<{
  providerId: string;
  origin: string;
  expectedPeerIdentity: string;
  credentialPrincipal: string;
  credentialRef: string;
  executionBoundaryId?: string;
  environment?: Readonly<Record<string, string | undefined>>;
  fetch?: A2ARemoteFetch;
  requestTimeoutMs?: number;
  agentCardTtlMs?: number;
  now?: () => number;
}>;

export async function createHermesA2AAdapter(
  options: HermesA2AAdapterOptions,
): Promise<ProviderRuntimeAdapter> {
  const origin = configuredOrigin(options.origin);
  const expectedPeerIdentity = boundedText(options.expectedPeerIdentity, 'expectedPeerIdentity', 200);
  const credentialPrincipal = boundedText(options.credentialPrincipal, 'credentialPrincipal', 200);
  const executionBoundaryId = options.executionBoundaryId === undefined
    ? origin.hostname
    : boundedId(options.executionBoundaryId, 'executionBoundaryId');
  if (!SAFE_ENV_REFERENCE.test(options.credentialRef)) {
    throw new TypeError('Hermes credentialRef must be an uppercase environment variable reference.');
  }
  const environment = options.environment ?? process.env;
  const now = options.now ?? (() => Date.now());
  const agentCardTtlMs = boundedTtl(options.agentCardTtlMs ?? 60_000);
  let cache = await loadClient();

  async function loadClient() {
    const client = await createA2ARemoteClient(origin.href, {
      ...(options.fetch ? { fetch: options.fetch } : {}),
      bearerTokenProvider: () => resolveBearerToken(environment, options.credentialRef),
      ...(options.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: options.requestTimeoutMs }),
    });
    const advertisedCapabilities = validateHermesCard(
      client.card,
      client.selectedInterface,
      origin,
      expectedPeerIdentity,
    );
    resolveBearerToken(environment, options.credentialRef);
    return {
      client,
      advertisedCapabilities,
      validatedAt: now(),
    };
  }

  async function currentClient(): Promise<typeof cache> {
    if (now() - cache.validatedAt >= agentCardTtlMs) cache = await loadClient();
    return cache;
  }

  async function callWithCardRevalidation<T>(operation: (client: A2ARemoteClient) => Promise<T>): Promise<T> {
    const current = await currentClient();
    try {
      return await operation(current.client);
    } catch (error) {
      try {
        cache = await loadClient();
      } catch {
        // Preserve the operation failure while leaving future calls fail-closed.
        cache = { ...current, validatedAt: Number.NEGATIVE_INFINITY };
      }
      throw error;
    }
  }

  return createProviderRuntimeAdapter({
    providerId: options.providerId,
    classifyState: classifyHermesState,
    async preflight(input) {
      validateOperationIdentity(input, options.providerId, credentialPrincipal, options.credentialRef, executionBoundaryId);
      const { advertisedCapabilities } = await currentClient();
      const requested = uniqueStrings(input.requestedCapabilities);
      if (requested.some((capability) => !advertisedCapabilities.includes(capability))) {
        return {
          ready: false,
          capabilities: requested.filter((capability) => advertisedCapabilities.includes(capability)),
          reason: 'Hermes Agent Card does not advertise every requested capability.',
        };
      }
      resolveBearerToken(environment, options.credentialRef);
      return { ready: true, capabilities: requested };
    },
    async submit(input) {
      validateOperationIdentity(input, options.providerId, credentialPrincipal, options.credentialRef, executionBoundaryId);
      const payload = parsePayload(input);
      const response = await callWithCardRevalidation((client) => client.sendMessage({
          messageId: payload.messageId,
          contextId: payload.contextId,
          parts: [{ text: payload.prompt, mediaType: 'text/plain' }],
        }, { signal: input.signal }));
      if (isRemoteMessage(response)) {
        throw new Error('Hermes A2A SendMessage must return a durable task receipt.');
      }
      return taskObservation(response, {
        expectedTaskId: undefined,
        expectedContextId: payload.contextId,
        providerCursor: payload.messageId,
      });
    },
    async get(input) {
      validateOperationIdentity(input, options.providerId, credentialPrincipal, options.credentialRef, executionBoundaryId);
      const task = await callWithCardRevalidation((client) => (
        client.getTask(input.receipt.providerExecutionId, { signal: input.signal })
      ));
      return taskObservation(task, continuity(input.receipt));
    },
    async cancel(input) {
      validateOperationIdentity(input, options.providerId, credentialPrincipal, options.credentialRef, executionBoundaryId);
      const task = await callWithCardRevalidation((client) => (
        client.cancelTask(input.receipt.providerExecutionId, { signal: input.signal })
      ));
      return taskObservation(task, continuity(input.receipt));
    },
  });
}

export type HermesA2AProductionAgentOptions = HermesA2AAdapterOptions & Readonly<{
  store: ProviderLifecycleStore;
  agentId: string;
  executionIdentity: string;
  executionBoundaryId: string;
  roles: readonly string[];
  capabilities: readonly string[];
  authorizationPolicy: A2AAgentAuthorizationPolicy;
  pollIntervalMs?: number;
  cancellationTimeoutMs?: number;
}>;

export async function createHermesA2AProductionAgent(
  options: HermesA2AProductionAgentOptions,
): Promise<A2AProductionAgent> {
  const agentId = boundedId(options.agentId, 'agentId');
  const providerId = boundedId(options.providerId, 'providerId');
  const executionIdentity = boundedId(options.executionIdentity, 'executionIdentity');
  const executionBoundaryId = boundedId(options.executionBoundaryId, 'executionBoundaryId');
  const credentialPrincipal = boundedId(options.credentialPrincipal, 'credentialPrincipal');
  const roles = Object.freeze(uniqueStrings(options.roles));
  const capabilities = Object.freeze(uniqueStrings(options.capabilities));
  if (roles.length === 0 || capabilities.length === 0) {
    throw new TypeError('Hermes production agent roles and capabilities are required.');
  }
  const adapter = await createHermesA2AAdapter({ ...options, executionBoundaryId });
  const runner = new ProviderLifecycleRunner({
    adapter,
    store: options.store,
    ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
    ...(options.cancellationTimeoutMs === undefined ? {} : { cancellationTimeoutMs: options.cancellationTimeoutMs }),
  });
  const credentialReference = `env://${options.credentialRef}`;

  const lifecycleInput = (input: A2AProductionChildExecutionInput) => {
    validateProductionIdentity(input, { agentId, providerId, executionIdentity, executionBoundaryId });
    const providerContextId = providerContextIdentity(input, agentId, providerId);
    const requestedCapabilities = Object.freeze([...(input.capabilities ?? [])]);
    return {
      scope: input.scope,
      idempotencyKey: input.childIdempotencyKey,
      requestHash: requestDigest(input, requestedCapabilities),
      payload: {
        prompt: input.prompt,
        messageId: input.childIdempotencyKey,
        contextId: providerContextId,
      },
      requestedCapabilities,
      identities: {
        provider: { id: providerId },
        credential: { principalId: credentialPrincipal, reference: credentialReference },
        execution: { id: executionIdentity },
        context: { id: providerContextId },
        runtime: { boundaryId: executionBoundaryId },
        audit: { id: auditIdentity(input, agentId, providerId) },
      },
      timeoutMs: remainingMs(input.deadlineAtMs),
      signal: input.signal,
      onAccepted: (receipt: ProviderAcceptedReceipt) => input.bindChild(receipt.providerExecutionId),
    } as const;
  };

  const settle = async (
    initial: ProviderLifecycleRecord,
    input: A2AProductionChildExecutionInput | A2AProductionChildRecoveryInput,
  ): Promise<A2AOrchestratorChildExecutionResult> => {
    let record = initial;
    while (record.state === 'input-required' || record.state === 'auth-required') {
      if (!record.receipt) throw new Error('Hermes nonterminal task is missing its durable accepted receipt.');
      try {
        await waitForProviderResume(input.signal, input.deadlineAtMs, options.pollIntervalMs ?? 250);
      } catch (error) {
        record = await runner.cancel({
          scope: input.scope,
          idempotencyKey: requiredChildIdempotencyKey(input),
          expectedProviderExecutionId: record.receipt.providerExecutionId,
          reason: error instanceof Error ? error.message : 'Hermes task canceled.',
        });
        return terminalChildResult(record);
      }
      if (input.signal.aborted || input.deadlineAtMs <= Date.now()) {
        record = await runner.cancel({
          scope: input.scope,
          idempotencyKey: requiredChildIdempotencyKey(input),
          expectedProviderExecutionId: record.receipt.providerExecutionId,
          reason: input.signal.aborted ? 'Hermes task canceled.' : 'Hermes task deadline exceeded.',
        });
        return terminalChildResult(record);
      }
      record = await runner.recover({
        scope: input.scope,
        idempotencyKey: requiredChildIdempotencyKey(input),
        expectedProviderExecutionId: record.receipt.providerExecutionId,
        timeoutMs: remainingMs(input.deadlineAtMs),
        signal: input.signal,
      });
    }
    return terminalChildResult(record);
  };

  return Object.freeze({
    agentId,
    providerId,
    kind: 'hermes',
    executionIdentity,
    executionBoundaryId,
    roles,
    capabilities,
    authorizationPolicy: options.authorizationPolicy,
    authorize(input) {
      return options.authorizationPolicy.evaluate({
        agentId,
        scope: input.scope,
        role: input.role,
        capabilities: input.capabilities,
      }).allowed;
    },
    async executeChild(input) {
      const record = await runner.run(lifecycleInput(input));
      return settle(record, input);
    },
    async recoverChild(input) {
      validateProductionIdentity(input, { agentId, providerId, executionIdentity, executionBoundaryId });
      const childIdempotencyKey = requiredChildIdempotencyKey(input);
      const record = await runner.recover({
        scope: input.scope,
        idempotencyKey: childIdempotencyKey,
        expectedProviderExecutionId: input.agentJobId,
        timeoutMs: remainingMs(input.deadlineAtMs),
        signal: input.signal,
      });
      return settle(record, input);
    },
    async cancelChild(input) {
      validateProductionIdentity(input, { agentId, providerId, executionIdentity, executionBoundaryId });
      const record = await runner.cancel({
        scope: input.scope,
        idempotencyKey: input.childIdempotencyKey,
        expectedProviderExecutionId: input.agentJobId,
        reason: 'A2A parent requested child cancellation.',
      });
      if (record.state !== 'canceled' && record.state !== 'rejected' && record.state !== 'failed') {
        throw new Error(`Hermes cancellation did not reach an allowed terminal state: ${record.state}.`);
      }
    },
  });
}

function boundedTtl(value: number): number {
  if (!Number.isFinite(value) || value < 1) throw new TypeError('Hermes Agent Card TTL must be positive.');
  return Math.min(Math.trunc(value), 300_000);
}

function configuredOrigin(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError('Hermes A2A origin must be an absolute HTTPS origin.');
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
  ) {
    throw new TypeError('Hermes A2A origin must be an absolute HTTPS origin.');
  }
  return parsed;
}

function validateHermesCard(
  card: A2ARemoteAgentCard,
  selectedInterface: A2ARemoteJsonRpcInterface,
  configured: URL,
  expectedPeerIdentity: string,
): readonly string[] {
  if (card.name !== expectedPeerIdentity) throw new Error('Hermes A2A Agent Card peer identity does not match configuration.');
  if (
    selectedInterface.protocolBinding !== 'JSONRPC'
    || selectedInterface.protocolVersion !== '1.0'
    || new URL(selectedInterface.url).origin !== configured.origin
  ) {
    throw new Error('Hermes A2A preferred JSON-RPC 1.0 interface is not at the configured origin.');
  }
  if (!card.defaultInputModes.includes('text/plain') || !card.defaultOutputModes.includes('text/plain')) {
    throw new Error('Hermes A2A Agent Card must advertise text/plain input and output modes.');
  }
  const bearerSchemes = new Set(Object.entries(card.securitySchemes).flatMap(([name, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const scheme = value as Record<string, unknown>;
    const officialHttp = recordValue(scheme.httpAuthSecurityScheme);
    const officialBearer = typeof officialHttp?.scheme === 'string'
      && officialHttp.scheme.toLowerCase() === 'bearer';
    const legacyBearer = scheme.type === 'http'
      && typeof scheme.scheme === 'string'
      && scheme.scheme.toLowerCase() === 'bearer';
    return officialBearer || legacyBearer ? [name] : [];
  }));
  if (
    bearerSchemes.size === 0
    || !card.securityRequirements.some((requirement) => {
      const names = Object.keys(requirementSchemes(requirement));
      return names.length === 1 && bearerSchemes.has(names[0]);
    })
  ) {
    throw new Error('Hermes A2A Agent Card must require bearer authentication.');
  }
  const capabilities = card.skills.flatMap((skill) => {
    const id = typeof skill.id === 'string' ? [skill.id] : [];
    const tags = Array.isArray(skill.tags) ? skill.tags.filter((tag): tag is string => typeof tag === 'string') : [];
    return [...id, ...tags];
  });
  return Object.freeze(uniqueStrings(capabilities));
}

function requirementSchemes(
  requirement: A2ARemoteSecurityRequirement,
): Readonly<Record<string, readonly string[]>> {
  const official = recordValue((requirement as Readonly<{ schemes?: unknown }>).schemes);
  return official
    ? official as Record<string, readonly string[]>
    : requirement as Readonly<Record<string, readonly string[]>>;
}

function validateOperationIdentity(
  input: ProviderRuntimeOperationInput,
  providerId: string,
  credentialPrincipal: string,
  credentialRef: string,
  executionBoundaryId: string,
): void {
  if (input.identities.provider.id !== providerId) throw new Error('Hermes provider identity mismatch.');
  if (
    input.identities.credential.principalId !== credentialPrincipal
    || input.identities.credential.reference !== `env://${credentialRef}`
  ) {
    throw new Error('Hermes credential principal or reference mismatch.');
  }
  if (input.identities.runtime.boundaryId !== executionBoundaryId) {
    throw new Error('Hermes runtime boundary does not match the registered execution boundary.');
  }
}

function validateProductionIdentity(
  input: Readonly<{
    agentId: string;
    providerId: string;
    executionIdentity?: string;
    executionBoundaryId?: string;
  }>,
  expected: Readonly<{
    agentId: string;
    providerId: string;
    executionIdentity: string;
    executionBoundaryId: string;
  }>,
): void {
  if (
    input.agentId !== expected.agentId
    || input.providerId !== expected.providerId
    || input.executionIdentity !== expected.executionIdentity
    || input.executionBoundaryId !== expected.executionBoundaryId
  ) {
    throw new Error('Hermes production agent identity or execution boundary mismatch.');
  }
}

function requestDigest(
  input: A2AProductionChildExecutionInput,
  capabilities: readonly string[],
): string {
  return crypto.createHash('sha256').update(JSON.stringify([
    input.scope.tenantId,
    input.scope.requesterId,
    input.scope.conversationId,
    input.parentTaskId,
    input.childKey,
    input.childIdempotencyKey,
    input.role,
    input.prompt,
    capabilities,
    input.agentId,
    input.providerId,
    input.executionIdentity ?? null,
    input.executionBoundaryId ?? null,
  ])).digest('hex');
}

function providerContextIdentity(
  input: Pick<A2AProductionChildExecutionInput, 'scope' | 'parentTaskId'>,
  agentId: string,
  providerId: string,
): string {
  return `ctx-${shortDigest([providerId, agentId, input.scope.tenantId, input.scope.requesterId, input.scope.conversationId, input.parentTaskId])}`;
}

function auditIdentity(
  input: Pick<A2AProductionChildExecutionInput, 'scope' | 'parentTaskId' | 'childIdempotencyKey'>,
  agentId: string,
  providerId: string,
): string {
  return `audit-${shortDigest([providerId, agentId, input.scope.tenantId, input.scope.requesterId, input.scope.conversationId, input.parentTaskId, input.childIdempotencyKey])}`;
}

function shortDigest(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 48);
}

function remainingMs(deadlineAtMs: number): number {
  if (!Number.isFinite(deadlineAtMs)) throw new TypeError('Hermes production deadline must be finite.');
  const remaining = Math.trunc(deadlineAtMs - Date.now());
  if (remaining < 1) throw new Error('Hermes production deadline has expired.');
  return remaining;
}

function requiredChildIdempotencyKey(
  input: Pick<A2AProductionChildExecutionInput, 'childIdempotencyKey'> | A2AProductionChildRecoveryInput,
): string {
  if (typeof input.childIdempotencyKey !== 'string' || !input.childIdempotencyKey.trim()) {
    throw new Error('Hermes recovery requires the durable child idempotency key.');
  }
  return input.childIdempotencyKey;
}

function terminalChildResult(record: ProviderLifecycleRecord): A2AOrchestratorChildExecutionResult {
  if (record.state === 'quarantined') {
    throw new Error(`Hermes task was quarantined: ${record.quarantine?.reason ?? 'contract mismatch'}.`);
  }
  const taskId = record.receipt?.providerExecutionId;
  if (!taskId) throw new Error('Hermes lifecycle is missing a durable provider task identity.');
  if (record.state === 'completed') {
    const result = record.result?.trim() || record.artifacts?.map((artifact) => artifact.text).filter(Boolean).join('\n').trim();
    return { taskId, status: 'completed', ...(result ? { result } : {}) };
  }
  if (record.state === 'failed' || record.state === 'rejected') {
    return { taskId, status: 'failed', error: record.error ?? `Hermes task ended in ${record.state}.` };
  }
  if (record.state === 'canceled') return { taskId, status: 'canceled', ...(record.error ? { error: record.error } : {}) };
  if (record.state === 'canceling') throw new Error('Hermes task cancellation requires reconciliation.');
  if (!isProviderLifecycleTerminal(record.state)) throw new Error(`Hermes task remains nonterminal: ${record.state}.`);
  throw new Error('Hermes task returned an unsupported terminal state.');
}

async function waitForProviderResume(signal: AbortSignal, deadlineAtMs: number, configuredDelay: number): Promise<void> {
  const delayMs = Math.max(1, Math.min(configuredDelay, remainingMs(deadlineAtMs)));
  await new Promise<void>((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason ?? new Error('Hermes task canceled.'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

function parsePayload(input: ProviderRuntimeOperationInput): Readonly<{
  prompt: string;
  messageId: string;
  contextId: string;
}> {
  const prompt = boundedText(input.payload.prompt, 'payload.prompt', MAX_TEXT_LENGTH);
  const messageId = boundedId(input.payload.messageId, 'payload.messageId');
  const contextId = boundedId(input.payload.contextId, 'payload.contextId');
  if (contextId !== input.identities.context.id) {
    throw new Error('Hermes payload context must match the registered context identity.');
  }
  return { prompt, messageId, contextId };
}

function classifyHermesState(rawState: string) {
  const states = {
    TASK_STATE_SUBMITTED: 'accepted',
    TASK_STATE_WORKING: 'working',
    TASK_STATE_INPUT_REQUIRED: 'input-required',
    TASK_STATE_AUTH_REQUIRED: 'auth-required',
    TASK_STATE_COMPLETED: 'completed',
    TASK_STATE_FAILED: 'failed',
    TASK_STATE_CANCELED: 'canceled',
    TASK_STATE_REJECTED: 'rejected',
  } as const;
  return states[rawState as keyof typeof states] ?? 'unknown';
}

function taskObservation(
  task: A2ARemoteTask,
  expected: Readonly<{
    expectedTaskId?: string;
    expectedContextId?: string;
    providerCursor?: string;
  }>,
): ProviderRuntimeObservation {
  const id = boundedId(task.id, 'Hermes task.id');
  if (expected.expectedTaskId && id !== expected.expectedTaskId) {
    throw new Error('Hermes A2A task identity changed during the lifecycle.');
  }
  const contextId = boundedId(task.contextId, 'Hermes task.contextId');
  if (expected.expectedContextId && contextId !== expected.expectedContextId) {
    throw new Error('Hermes A2A context identity changed during the lifecycle.');
  }
  const status = record(task.status, 'Hermes task.status');
  const rawState = boundedText(status.state, 'Hermes task.status.state', 100);
  const artifacts = parseArtifacts(task.artifacts);
  const result = artifacts
    .map((artifact) => artifact.text)
    .filter((text): text is string => Boolean(text?.trim()))
    .join('\n')
    .trim();
  const auditRefs = uniqueStrings([
    ...metadataAuditRefs(task.metadata),
    ...artifacts.flatMap((artifact) => metadataAuditRefs(
      Array.isArray(task.artifacts)
        ? (task.artifacts.find((candidate) => recordValue(candidate)?.artifactId === artifact.artifactId) as Record<string, unknown> | undefined)?.metadata
        : undefined,
    )),
  ]);
  const error = statusMessage(status.message);
  return {
    rawState,
    providerExecutionId: id,
    providerContextId: contextId,
    ...(expected.providerCursor ? { providerCursor: expected.providerCursor } : {}),
    ...(result ? { result } : {}),
    ...(error ? { error } : {}),
    ...(artifacts.length > 0 ? { artifacts } : {}),
    ...(auditRefs.length > 0 ? { auditRefs } : {}),
  };
}

function parseArtifacts(value: unknown): readonly ProviderRuntimeArtifact[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new Error('Hermes A2A task artifacts must be an array.');
  return Object.freeze(value.map((entry) => {
    const artifact = record(entry, 'Hermes artifact');
    const artifactId = boundedId(artifact.artifactId, 'Hermes artifact.artifactId');
    const name = boundedText(artifact.name, 'Hermes artifact.name', 500);
    if (!Array.isArray(artifact.parts) || artifact.parts.length === 0) {
      throw new Error('Hermes A2A artifact must contain at least one part.');
    }
    const textParts = artifact.parts.map((part) => record(part, 'Hermes artifact part')).filter((part) => part.text !== undefined);
    const text = textParts.map((part) => boundedText(part.text, 'Hermes artifact text', MAX_TEXT_LENGTH)).join('\n').trim();
    const mediaType = textParts.find((part) => typeof part.mediaType === 'string')?.mediaType;
    const metadata = artifact.metadata === undefined ? {} : record(artifact.metadata, 'Hermes artifact metadata');
    const uri = metadata.uri === undefined ? undefined : httpsUrl(metadata.uri, 'Hermes artifact metadata.uri');
    const sha256 = metadata.sha256 === undefined ? undefined : sha(metadata.sha256);
    return Object.freeze({
      artifactId,
      name,
      mediaType: typeof mediaType === 'string' && mediaType.trim() ? mediaType : 'application/octet-stream',
      ...(text ? { text } : {}),
      ...(uri ? { uri } : {}),
      ...(sha256 ? { sha256 } : {}),
    });
  }));
}

function continuity(receipt: ProviderAcceptedReceipt) {
  return {
    expectedTaskId: receipt.providerExecutionId,
    ...(receipt.providerContextId ? { expectedContextId: receipt.providerContextId } : {}),
  };
}

function isRemoteMessage(value: A2ARemoteTask | A2ARemoteMessage): value is A2ARemoteMessage {
  return 'messageId' in value && typeof value.messageId === 'string';
}

function resolveBearerToken(
  environment: Readonly<Record<string, string | undefined>>,
  credentialRef: string,
): string {
  const value = environment[credentialRef];
  if (typeof value !== 'string' || !value.trim() || value.length > 4_096 || /[\r\n]/u.test(value)) {
    throw new Error('Hermes bearer credential reference is unavailable or invalid.');
  }
  return value.trim();
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object.`);
  return value as Record<string, unknown>;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function boundedId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new Error(`${field} must be a bounded identifier.`);
  return value;
}

function boundedText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) throw new Error(`${field} must be bounded text.`);
  return value.trim();
}

function httpsUrl(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be an HTTPS URL.`);
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error();
    return parsed.toString();
  } catch {
    throw new Error(`${field} must be an HTTPS URL.`);
  }
}

function sha(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error('Hermes artifact sha256 must be a SHA-256 digest.');
  }
  return value;
}

function metadataAuditRefs(value: unknown): string[] {
  const metadata = recordValue(value);
  if (!metadata || !Array.isArray(metadata.auditRefs)) return [];
  return metadata.auditRefs.map((entry) => boundedId(entry, 'Hermes audit reference'));
}

function statusMessage(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 4_000);
  const message = recordValue(value);
  if (!message || !Array.isArray(message.parts)) return undefined;
  const text = message.parts.flatMap((part) => {
    const item = recordValue(part);
    return typeof item?.text === 'string' ? [item.text] : [];
  }).join('\n').trim();
  return text ? text.slice(0, 4_000) : undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
