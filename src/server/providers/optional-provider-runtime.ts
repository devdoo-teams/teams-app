import crypto from 'node:crypto';

import type { A2AScope } from '../a2a-contract.js';
import {
  ProviderLifecycleRunner,
  type ProviderLifecycleRecord,
  type ProviderLifecycleRunInput,
  type ProviderLifecycleStore,
} from '../provider-lifecycle-runner.js';
import type { ResponseEngine } from '../response-engine.js';
import { GrokResponseEngine } from '../response-engine-grok.js';
import {
  isOpaqueProviderCredentialReference,
  type ProviderRuntimeAdapter,
  type ProviderRuntimeIdentities,
  type ProviderRuntimeOperationInput,
  type ProviderRuntimePreflight,
} from '../provider-runtime-adapter.js';
import { createGitHubAgentTasksAdapter } from './github-agent-tasks-adapter.js';
import {
  createGrokProviderRuntimeAdapter,
  GrokProviderTransportError,
  type GrokProviderExecutionPort,
  type GrokProviderExecutionSnapshot,
  type GrokProviderPreflightPort,
} from './grok-provider-runtime-adapter.js';
import {
  resolveOptionalProviderRuntimeFactory,
  type OptionalProviderRuntimeId,
} from './optional-provider-entrypoint.js';

const MAX_CONFIGURATION_CHARS = 32_768;
const MAX_PROVIDERS = 8;
const MAX_CAPABILITIES = 8;
const MAX_PRINCIPAL_LENGTH = 200;
const MAX_MODEL_LENGTH = 120;
const MAX_CREDENTIAL_LENGTH = 512;
const MAX_SECRET_LENGTH = 4_096;
const SAFE_ID = /^[A-Za-z][A-Za-z0-9._:-]{0,199}$/u;
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u;
const SAFE_ENV_NAME = /^[A-Z][A-Z0-9_]{0,127}$/u;
const SAFE_KEY_VAULT_REFERENCE = /^key-vault:\/\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/(?:[A-Za-z0-9][A-Za-z0-9._-]{0,127})(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,127})*$/u;
const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u;
const XAI_BASE_URL = 'https://api.x.ai/v1';
const GITHUB_AGENT_TASKS_CAPABILITIES = Object.freeze(['agent-tasks', 'pull-request-artifact'] as const);
const GROK_CAPABILITIES = Object.freeze(['responses'] as const);

type OptionalProviderPolicy = Readonly<{
  durable: boolean;
  userAuth: 'server' | 'user-to-server';
  cancellation: 'supported' | 'unsupported';
}>;

export type OptionalProviderConfig = Readonly<{
  providerId: OptionalProviderRuntimeId;
  principal: string;
  credentialReference: string;
  capabilities: readonly string[];
  policy: OptionalProviderPolicy;
  model?: string;
  baseUrl?: string;
  defaultRepository?: string;
}>;

export class OptionalProviderConfigurationError extends Error {
  readonly code = 'OPTIONAL_PROVIDER_CONFIGURATION_INVALID' as const;

  constructor(message: string) {
    super(message);
    this.name = 'OptionalProviderConfigurationError';
  }
}

export type ServerOwnedCredentialResolver = Readonly<{
  resolve(reference: string, principalId: string): Promise<string>;
  isAvailable(reference: string, principalId: string): Promise<boolean>;
}>;

export type KeyVaultCredentialResolver = (
  reference: string,
  principalId: string,
) => Promise<string | undefined>;

export type OptionalProviderRuntimeFact = Readonly<{
  providerId: OptionalProviderRuntimeId;
  kind: 'response-only' | 'durable-agent';
  configured: boolean;
  durable: boolean;
  capabilities: readonly string[];
  policy: OptionalProviderPolicy;
  status: 'configured-unverified' | 'unavailable';
  reason: string;
}>;

export type OptionalProviderPreflightInput = Readonly<{
  scope: A2AScope;
  idempotencyKey: string;
  requestHash: string;
  payload: Readonly<Record<string, unknown>>;
  requestedCapabilities?: readonly string[];
  timeoutMs?: number;
  signal?: AbortSignal;
}>;

export type OptionalProviderRunInput = Readonly<{
  scope: A2AScope;
  idempotencyKey: string;
  requestHash: string;
  payload: Readonly<Record<string, unknown>>;
  requestedCapabilities?: readonly string[];
  timeoutMs: number;
  signal?: AbortSignal;
  onAccepted?: ProviderLifecycleRunInput['onAccepted'];
}>;

export type OptionalProviderRuntime = Readonly<{
  providerId: OptionalProviderRuntimeId;
  kind: 'response-only' | 'durable-agent';
  durable: boolean;
  config: OptionalProviderConfig;
  adapter: ProviderRuntimeAdapter;
  lifecycle?: ProviderLifecycleRunner;
  facts: OptionalProviderRuntimeFact;
  preflight(input: OptionalProviderPreflightInput): Promise<ProviderRuntimePreflight>;
  run(input: OptionalProviderRunInput): Promise<ProviderLifecycleRecord>;
}>;

export type OptionalProviderRuntimeSnapshot = Readonly<{
  providers: readonly OptionalProviderRuntime[];
  facts: readonly OptionalProviderRuntimeFact[];
  responseEngines: readonly ResponseEngine[];
  responseProviderConfigured: boolean;
  responseModel?: string;
}>;

export type OptionalProviderRuntimeOptions = Readonly<{
  enabled: boolean;
  configuration?: string;
  environment?: Readonly<Record<string, string | undefined>>;
  lifecycleStore?: ProviderLifecycleStore;
  fetch?: typeof fetch;
  resolveKeyVault?: KeyVaultCredentialResolver;
  verifyGitHubExecutionReadiness?: (
    input: Readonly<{
      repository: string;
      credentialReference: string;
      principalId: string;
      signal: AbortSignal;
    }>
  ) => Promise<Readonly<{ ready: boolean; reason: string }>>;
  grokPreflight?: GrokProviderPreflightPort;
  grokExecution?: GrokProviderExecutionPort;
}>;

export function parseOptionalProviderConfiguration(raw: string | undefined): readonly OptionalProviderConfig[] {
  if (raw === undefined || raw.trim() === '') return Object.freeze([]);
  if (raw.length > MAX_CONFIGURATION_CHARS) {
    throw new OptionalProviderConfigurationError('Optional provider configuration is too large.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new OptionalProviderConfigurationError('Optional provider configuration must be valid JSON.');
  }
  if (!Array.isArray(parsed)) {
    throw new OptionalProviderConfigurationError('Optional provider configuration must be an array.');
  }
  if (parsed.length > MAX_PROVIDERS) {
    throw new OptionalProviderConfigurationError('Optional provider configuration has too many providers.');
  }

  const seenProviders = new Set<string>();
  const seenPrincipals = new Set<string>();
  const configs = parsed.map((value, index) => {
    const config = parseConfig(value, index);
    if (seenProviders.has(config.providerId)) {
      throw new OptionalProviderConfigurationError('Optional provider IDs must be unique.');
    }
    if (seenPrincipals.has(config.principal)) {
      throw new OptionalProviderConfigurationError('Optional provider principals must be unique.');
    }
    seenProviders.add(config.providerId);
    seenPrincipals.add(config.principal);
    return config;
  });
  return Object.freeze(configs);
}

export function createServerOwnedCredentialResolver(options: Readonly<{
  environment?: Readonly<Record<string, string | undefined>>;
  resolveKeyVault?: KeyVaultCredentialResolver;
}> = {}): ServerOwnedCredentialResolver {
  const environment = options.environment ?? process.env;

  const resolve = async (reference: string, principalId: string): Promise<string> => {
    const kind = credentialReferenceKind(reference);
    if (!kind || !SAFE_ID.test(principalId)) throw unavailableCredential();

    if (kind === 'env') {
      const match = reference.match(/^env:\/\/([A-Z][A-Z0-9_]{0,127})$/u);
      const value = match ? environment[match[1]] : undefined;
      return requireCredentialValue(value);
    }

    if (!options.resolveKeyVault) throw unavailableCredential();
    try {
      return requireCredentialValue(await options.resolveKeyVault(reference, principalId));
    } catch {
      throw unavailableCredential();
    }
  };

  return Object.freeze({
    resolve,
    async isAvailable(reference: string, principalId: string): Promise<boolean> {
      try {
        await resolve(reference, principalId);
        return true;
      } catch {
        return false;
      }
    },
  });
}

export async function createOptionalProviderRuntime(
  options: OptionalProviderRuntimeOptions,
): Promise<OptionalProviderRuntimeSnapshot> {
  if (!options.enabled) return emptyRuntimeSnapshot();

  const configurations = parseOptionalProviderConfiguration(options.configuration);
  const resolver = createServerOwnedCredentialResolver({
    environment: options.environment,
    resolveKeyVault: options.resolveKeyVault,
  });
  const fetchImpl = options.fetch ?? fetch;
  const created = await Promise.all(configurations.map(async (config) => (
    createRuntime(config, { ...options, fetch: fetchImpl }, resolver)
  )));
  const responseEngines = created
    .map(({ responseEngine }) => responseEngine)
    .filter((engine): engine is ResponseEngine => engine !== undefined);
  const responseModel = created.find(({ responseModel: model }) => model !== undefined)?.responseModel;
  return Object.freeze({
    providers: Object.freeze(created.map(({ runtime }) => runtime)),
    facts: Object.freeze(created.map(({ runtime }) => runtime.facts)),
    responseEngines: Object.freeze(responseEngines),
    responseProviderConfigured: responseEngines.length > 0,
    ...(responseModel === undefined ? {} : { responseModel }),
  });
}

export function createGrokHttpExecutionPort(options: Readonly<{
  fetch: typeof fetch;
  resolveCredential: ServerOwnedCredentialResolver;
  baseUrl?: string;
}>): GrokProviderExecutionPort {
  const baseUrl = approvedGrokBaseUrl(options.baseUrl ?? XAI_BASE_URL);

  const request = async (
    method: 'GET' | 'POST',
    path: string,
    input: Readonly<{
      credentialReference: string;
      principalId: string;
      signal: AbortSignal;
      body?: Readonly<Record<string, unknown>>;
    }>,
  ): Promise<GrokProviderExecutionSnapshot> => {
    let credential: string;
    try {
      credential = await options.resolveCredential.resolve(input.credentialReference, input.principalId);
    } catch {
      throw new GrokProviderTransportError(401, 'Grok provider credential is unavailable.', false);
    }

    let response: Response;
    try {
      response = await options.fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${credential}`,
          ...(input.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
        signal: input.signal,
      });
    } catch {
      throw new GrokProviderTransportError(503, 'Grok provider request was not completed.', true);
    }
    if (!response.ok) {
      throw new GrokProviderTransportError(
        response.status,
        `Grok provider request failed with HTTP ${response.status}.`,
        response.status === 429 || response.status >= 500,
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new GrokProviderTransportError(200, 'Grok provider returned an invalid response.', false);
    }
    return grokExecutionSnapshot(body);
  };

  return Object.freeze({
    submit: (input) => request('POST', '/responses', {
      credentialReference: input.credentialReference,
      principalId: input.principalId,
      signal: input.signal,
      body: { model: input.model, input: input.payload.input },
    }),
    retrieve: (input) => request('GET', `/responses/${encodeURIComponent(input.responseId)}`, input),
    async reconcile() {
      return undefined;
    },
  });
}

function parseConfig(value: unknown, index: number): OptionalProviderConfig {
  if (!isRecord(value)) throw invalidConfiguration(`provider at index ${index} must be an object.`);
  const providerId = boundedProviderId(value.providerId);
  const allowedKeys = providerId === 'grok-xai'
    ? ['providerId', 'principal', 'credentialReference', 'capabilities', 'policy', 'model', 'baseUrl']
    : ['providerId', 'principal', 'credentialReference', 'capabilities', 'policy', 'defaultRepository'];
  assertAllowedKeys(value, allowedKeys);

  const principal = boundedIdentifier(value.principal, 'principal', MAX_PRINCIPAL_LENGTH);
  const credentialReference = boundedCredentialReference(value.credentialReference);
  const capabilities = parseCapabilities(value.capabilities, providerId);
  const policy = parsePolicy(value.policy, providerId);
  const model = value.model === undefined ? undefined : boundedModel(value.model);
  const baseUrl = value.baseUrl === undefined ? undefined : approvedGrokBaseUrl(value.baseUrl);
  const defaultRepository = value.defaultRepository === undefined
    ? undefined
    : boundedRepository(value.defaultRepository);

  if (providerId === 'grok-xai') {
    if (defaultRepository !== undefined) throw invalidConfiguration('Grok does not accept a default repository.');
    return Object.freeze({
      providerId,
      principal,
      credentialReference,
      capabilities,
      policy,
      ...(model === undefined ? {} : { model }),
      ...(baseUrl === undefined ? {} : { baseUrl }),
    });
  }

  if (model !== undefined || baseUrl !== undefined) {
    throw invalidConfiguration('GitHub Agent Tasks does not accept Grok settings.');
  }
  return Object.freeze({
    providerId,
    principal,
    credentialReference,
    capabilities,
    policy,
    ...(defaultRepository === undefined ? {} : { defaultRepository }),
  });
}

function parseCapabilities(value: unknown, providerId: OptionalProviderRuntimeId): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CAPABILITIES) {
    throw invalidConfiguration('Optional provider capabilities must be a bounded non-empty array.');
  }
  const allowed = providerId === 'grok-xai' ? GROK_CAPABILITIES : GITHUB_AGENT_TASKS_CAPABILITIES;
  const capabilities = value.map((capability) => {
    if (typeof capability !== 'string' || !capability.trim() || !allowed.includes(capability as never)) {
      throw invalidConfiguration('Optional provider capability is not approved.');
    }
    return capability;
  });
  if (new Set(capabilities).size !== capabilities.length) {
    throw invalidConfiguration('Optional provider capabilities must be unique.');
  }
  if (!capabilities.some((capability) => capability === allowed[0])) {
    throw invalidConfiguration('Optional provider is missing its required capability.');
  }
  return Object.freeze(capabilities);
}

function parsePolicy(value: unknown, providerId: OptionalProviderRuntimeId): OptionalProviderPolicy {
  if (!isRecord(value)) throw invalidConfiguration('Optional provider policy must be an object.');
  assertAllowedKeys(value, ['durable', 'userAuth', 'cancellation']);
  if (typeof value.durable !== 'boolean'
    || (value.userAuth !== 'server' && value.userAuth !== 'user-to-server')
    || (value.cancellation !== 'supported' && value.cancellation !== 'unsupported')) {
    throw invalidConfiguration('Optional provider policy is invalid.');
  }
  const expected = providerId === 'grok-xai'
    ? { durable: false, userAuth: 'server', cancellation: 'unsupported' } as const
    : { durable: true, userAuth: 'user-to-server', cancellation: 'unsupported' } as const;
  if (value.durable !== expected.durable
    || value.userAuth !== expected.userAuth
    || value.cancellation !== expected.cancellation) {
    throw invalidConfiguration('Optional provider policy does not match the approved provider contract.');
  }
  return Object.freeze({
    durable: value.durable,
    userAuth: value.userAuth,
    cancellation: value.cancellation,
  });
}

function boundedProviderId(value: unknown): OptionalProviderRuntimeId {
  if (value !== 'github-agent-tasks' && value !== 'grok-xai') {
    throw invalidConfiguration('Optional providerId is not approved.');
  }
  return value;
}

function boundedIdentifier(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.length > maximum || !SAFE_ID.test(value)) {
    throw invalidConfiguration(`Optional provider ${label} is invalid.`);
  }
  return value;
}

function boundedCredentialReference(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_CREDENTIAL_LENGTH || !credentialReferenceKind(value)) {
    throw invalidConfiguration('Optional provider credentialReference must be an opaque env:// or key-vault:// reference.');
  }
  return value;
}

function boundedModel(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_MODEL_LENGTH || !SAFE_MODEL.test(value)) {
    throw invalidConfiguration('Grok model is invalid.');
  }
  return value;
}

function boundedRepository(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_REPOSITORY.test(value)) {
    throw invalidConfiguration('GitHub repository must be owner/name.');
  }
  return value;
}

function approvedGrokBaseUrl(value: unknown): string {
  if (typeof value !== 'string') throw invalidConfiguration('Grok baseUrl is invalid.');
  const normalized = value.trim().replace(/\/$/u, '');
  if (normalized !== XAI_BASE_URL) throw invalidConfiguration('Grok baseUrl must be https://api.x.ai/v1.');
  return normalized;
}

function credentialReferenceKind(value: string): 'env' | 'key-vault' | undefined {
  if (typeof value !== 'string' || value.length > MAX_CREDENTIAL_LENGTH || !isOpaqueProviderCredentialReference(value)) {
    return undefined;
  }
  if (SAFE_ENV_NAME.test(value.slice('env://'.length)) && value.startsWith('env://')) return 'env';
  if (SAFE_KEY_VAULT_REFERENCE.test(value)) return 'key-vault';
  return undefined;
}

async function createRuntime(
  config: OptionalProviderConfig,
  options: OptionalProviderRuntimeOptions,
  resolver: ServerOwnedCredentialResolver,
): Promise<Readonly<{
  runtime: OptionalProviderRuntime;
  responseEngine?: ResponseEngine;
  responseModel?: string;
}>> {
  const configured = await resolver.isAvailable(config.credentialReference, config.principal);
  const adapter = createAdapter(config, options, resolver);
  const kind = config.policy.durable ? 'durable-agent' : 'response-only';
  const lifecycle = config.policy.durable && options.lifecycleStore
    ? new ProviderLifecycleRunner({ adapter, store: options.lifecycleStore })
    : undefined;
  const responseEngine = config.providerId === 'grok-xai' && configured
    ? new GrokResponseEngine({
      credentialReference: config.credentialReference,
      credentialPrincipal: config.principal,
      resolveCredential: resolver.resolve,
      baseUrl: config.baseUrl ?? XAI_BASE_URL,
      model: config.model ?? 'grok-4.6',
      fetchImpl: options.fetch ?? fetch,
    })
    : undefined;
  const facts: OptionalProviderRuntimeFact = Object.freeze({
    providerId: config.providerId,
    kind,
    configured,
    durable: config.policy.durable,
    capabilities: Object.freeze([...config.capabilities]),
    policy: config.policy,
    status: configured ? 'configured-unverified' : 'unavailable',
    reason: configured
      ? 'Server credential reference is available; live provider execution remains unverified.'
      : 'Server-owned provider credential is unavailable.',
  });

  const runtime: OptionalProviderRuntime = Object.freeze({
    providerId: config.providerId,
    kind,
    durable: config.policy.durable,
    config,
    adapter,
    ...(lifecycle === undefined ? {} : { lifecycle }),
    facts,
    async preflight(input) {
      const operation = operationInput(config, input);
      if (!(await resolver.isAvailable(config.credentialReference, config.principal))) {
        return { ready: false, reason: 'Server-owned provider credential is unavailable.' };
      }
      try {
        return await adapter.preflight(operation);
      } catch {
        return { ready: false, reason: 'Optional provider preflight was not verified.' };
      }
    },
    async run(input) {
      if (!config.policy.durable) {
        throw new Error('This optional provider is response-only and cannot run a durable agent.');
      }
      if (!lifecycle) {
        throw new Error('Optional provider durable lifecycle store is unavailable.');
      }
      const payload = payloadWithDefaults(config, input.payload);
      return lifecycle.run({
        scope: input.scope,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        payload,
        requestedCapabilities: requestedCapabilities(config, input.requestedCapabilities),
        identities: identitiesFor(config, input),
        timeoutMs: input.timeoutMs,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        ...(input.onAccepted === undefined ? {} : { onAccepted: input.onAccepted }),
      });
    },
  });
  return Object.freeze({
    runtime,
    ...(responseEngine === undefined ? {} : { responseEngine, responseModel: config.model ?? 'grok-4.6' }),
  });
}

function createAdapter(
  config: OptionalProviderConfig,
  options: OptionalProviderRuntimeOptions,
  resolver: ServerOwnedCredentialResolver,
): ProviderRuntimeAdapter {
  const factory = resolveOptionalProviderRuntimeFactory(config.providerId);
  if (!factory) throw new OptionalProviderConfigurationError('Optional provider factory is not registered.');

  if (config.providerId === 'github-agent-tasks') {
    const githubFactory = factory as typeof createGitHubAgentTasksAdapter;
    return githubFactory({
      fetch: options.fetch ?? fetch,
      resolveUserToken: resolver.resolve,
      ...(options.verifyGitHubExecutionReadiness === undefined
        ? {}
        : { verifyExecutionReadiness: options.verifyGitHubExecutionReadiness }),
    });
  }

  const grokFactory = factory as typeof createGrokProviderRuntimeAdapter;
  const preflight = options.grokPreflight ?? createDefaultGrokPreflight(resolver);
  const execution = options.grokExecution ?? createGrokHttpExecutionPort({
    fetch: options.fetch ?? fetch,
    resolveCredential: resolver,
    ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
  });
  return grokFactory({
    model: config.model ?? 'grok-4.6',
    preflight,
    execution,
  });
}

function createDefaultGrokPreflight(resolver: ServerOwnedCredentialResolver): GrokProviderPreflightPort {
  return {
    async verify(input) {
      try {
        await resolver.resolve(input.credentialReference, input.principalId);
        return {
          ready: true,
          modelId: input.model,
          reason: 'Server credential reference resolved; live xAI capability check is deferred to the request.',
        };
      } catch {
        return { ready: false, reason: 'Server-owned Grok credential is unavailable.' };
      }
    },
  };
}

function operationInput(
  config: OptionalProviderConfig,
  input: OptionalProviderPreflightInput,
): ProviderRuntimeOperationInput {
  const requested = requestedCapabilities(config, input.requestedCapabilities);
  const controller = new AbortController();
  const signal = input.signal ?? controller.signal;
  return {
    scope: input.scope,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    payload: payloadWithDefaults(config, input.payload),
    requestedCapabilities: requested,
    identities: identitiesFor(config, input),
    deadlineAtMs: Date.now() + Math.max(10, Math.min(30_000, input.timeoutMs ?? 30_000)),
    signal,
  };
}

function requestedCapabilities(
  config: OptionalProviderConfig,
  requested: readonly string[] | undefined,
): readonly string[] {
  const values = requested === undefined || requested.length === 0 ? config.capabilities : requested;
  if (values.some((capability) => !config.capabilities.includes(capability))) {
    throw new OptionalProviderConfigurationError('Requested optional provider capability is not configured.');
  }
  return Object.freeze([...values]);
}

function payloadWithDefaults(
  config: OptionalProviderConfig,
  payload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (config.providerId !== 'github-agent-tasks' || payload.repository !== undefined || config.defaultRepository === undefined) {
    return payload;
  }
  return Object.freeze({ ...payload, repository: config.defaultRepository });
}

function identitiesFor(
  config: OptionalProviderConfig,
  input: Readonly<Pick<OptionalProviderPreflightInput, 'scope' | 'idempotencyKey'>>,
): ProviderRuntimeIdentities {
  const digest = crypto.createHash('sha256').update(JSON.stringify([
    config.providerId,
    config.principal,
    input.scope.tenantId,
    input.scope.requesterId,
    input.scope.conversationId,
    input.idempotencyKey,
  ])).digest('hex').slice(0, 48);
  return Object.freeze({
    provider: { id: config.providerId },
    credential: { principalId: config.principal, reference: config.credentialReference },
    execution: { id: `optional-execution-${digest}` },
    context: { id: `optional-context-${digest}` },
    runtime: { boundaryId: `optional-${config.providerId}` },
    audit: { id: `optional-audit-${digest}` },
  });
}

function grokExecutionSnapshot(value: unknown): GrokProviderExecutionSnapshot {
  if (!isRecord(value) || typeof value.id !== 'string' || !SAFE_ID.test(value.id)) {
    throw new GrokProviderTransportError(200, 'Grok provider response has no valid response receipt.', false);
  }
  const result = extractGrokText(value.output_text ?? value.output);
  const status = typeof value.status === 'string' && value.status.trim()
    ? value.status.trim()
    : result
      ? 'completed'
      : 'working';
  return Object.freeze({
    responseId: value.id,
    status,
    ...(result === undefined ? {} : { result }),
    verified: true,
  });
}

function extractGrokText(value: unknown): string | undefined {
  const parts: string[] = [];
  const visit = (candidate: unknown, depth: number): void => {
    if (depth > 8 || parts.join('').length >= 65_536) return;
    if (typeof candidate === 'string') {
      if (candidate.trim()) parts.push(candidate.trim());
      return;
    }
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item, depth + 1);
      return;
    }
    if (!isRecord(candidate)) return;
    if (typeof candidate.output_text === 'string') parts.push(candidate.output_text.trim());
    else if (typeof candidate.text === 'string') parts.push(candidate.text.trim());
    else if (typeof candidate.content === 'string') parts.push(candidate.content.trim());
    else if (candidate.content !== undefined) visit(candidate.content, depth + 1);
    if (candidate.output !== undefined) visit(candidate.output, depth + 1);
  };
  visit(value, 0);
  const result = parts.filter(Boolean).join('\n').trim().slice(0, 65_536);
  return result || undefined;
}

function emptyRuntimeSnapshot(): OptionalProviderRuntimeSnapshot {
  return Object.freeze({
    providers: Object.freeze([]),
    facts: Object.freeze([]),
    responseEngines: Object.freeze([]),
    responseProviderConfigured: false,
  });
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    throw invalidConfiguration('Optional provider configuration contains an unsupported field.');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function invalidConfiguration(message: string): OptionalProviderConfigurationError {
  return new OptionalProviderConfigurationError(message);
}

function unavailableCredential(): Error {
  return new Error('Optional provider credential is unavailable.');
}

function requireCredentialValue(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_SECRET_LENGTH || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw unavailableCredential();
  }
  return value.trim();
}
