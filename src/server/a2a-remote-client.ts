import crypto from 'node:crypto';
import { isIP } from 'node:net';

const PROTOCOL_VERSION = '1.0' as const;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_BODY_BYTES = 1_000_000;
const MAX_REDIRECTS = 5;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export type A2ARemoteAgentCard = Readonly<{
  name: string;
  description: string;
  version: string;
  supportedInterfaces: readonly Readonly<{
    url: string;
    protocolBinding: string;
    protocolVersion: string;
    tenant?: string;
  }>[];
  capabilities: Readonly<{
    streaming: boolean;
    pushNotifications: boolean;
    extendedAgentCard: boolean;
  }>;
  securitySchemes: Record<string, unknown>;
  securityRequirements: readonly A2ARemoteSecurityRequirement[];
  defaultInputModes: readonly string[];
  defaultOutputModes: readonly string[];
  skills: readonly Record<string, unknown>[];
}>;

export type A2ARemoteSecurityRequirement =
  | Readonly<{ schemes: Readonly<Record<string, readonly string[]>> }>
  | Readonly<Record<string, readonly string[]>>;

export type A2ARemoteJsonRpcInterface = Readonly<{
  url: string;
  protocolBinding: 'JSONRPC';
  protocolVersion: '1.0';
  tenant?: string;
}>;

export type A2ARemoteFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type A2ARemoteTokenProvider = () => string | Promise<string>;
export type A2ARemoteRequestOptions = Readonly<{ signal?: AbortSignal }>;
export type A2ARemoteMessagePart = Readonly<{ text: string; mediaType?: string }>;
export type A2ARemoteMessage = Readonly<{
  messageId: string;
  role: string;
  contextId?: string;
  taskId?: string;
  parts: readonly A2ARemoteMessagePart[];
}>;
export type A2ARemoteTask = Readonly<Record<string, unknown>>;

export type A2ARemoteClientErrorCode =
  | 'UNSUPPORTED_PROTOCOL'
  | 'SSRF_BLOCKED'
  | 'INVALID_AGENT_CARD'
  | 'AUTHENTICATION_REQUIRED'
  | 'AUTHENTICATION_FAILED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'JSON_RPC_ERROR'
  | 'INVALID_RESPONSE';

export class A2ARemoteClientError extends Error {
  readonly code: A2ARemoteClientErrorCode;

  constructor(code: A2ARemoteClientErrorCode) {
    super(`A2A remote operation failed (${code}).`);
    this.name = 'A2ARemoteClientError';
    this.code = code;
  }

  toJSON(): { name: string; code: A2ARemoteClientErrorCode; message: string } {
    return { name: this.name, code: this.code, message: this.message };
  }
}

export function serializeA2ARemoteError(error: unknown): Record<string, string> {
  if (error instanceof A2ARemoteClientError) return error.toJSON();
  return {
    name: 'A2ARemoteClientError',
    code: 'NETWORK_ERROR',
    message: 'A2A remote operation failed (NETWORK_ERROR).',
  };
}

export type A2ARemoteClient = Readonly<{
  card: A2ARemoteAgentCard;
  selectedInterface: A2ARemoteJsonRpcInterface;
  sendMessage: (input: Readonly<{
    messageId: string;
    contextId?: string;
    parts: readonly A2ARemoteMessagePart[];
  }>, options?: A2ARemoteRequestOptions) => Promise<A2ARemoteTask | A2ARemoteMessage>;
  getTask: (id: string, options?: Readonly<{ historyLength?: number; signal?: AbortSignal }>) => Promise<A2ARemoteTask>;
  listTasks: (options?: Readonly<{ pageSize?: number; pageToken?: string; historyLength?: number; signal?: AbortSignal }>) => Promise<Record<string, unknown>>;
  cancelTask: (id: string, options?: A2ARemoteRequestOptions) => Promise<A2ARemoteTask>;
}>;

type ClientOptions = Readonly<{
  fetch?: A2ARemoteFetch;
  bearerTokenProvider?: A2ARemoteTokenProvider;
  requestTimeoutMs?: number;
}>;

function fail(code: A2ARemoteClientErrorCode): never {
  throw new A2ARemoteClientError(code);
}

function validateBaseUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { return fail('UNSUPPORTED_PROTOCOL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) fail('UNSUPPORTED_PROTOCOL');
  assertPublicHost(url);
  return url;
}

function assertPublicHost(url: URL): void {
  const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '0.0.0.0' || host === '::1') {
    fail('SSRF_BLOCKED');
  }
  if (isIP(host) === 6) {
    const words = ipv6Words(host);
    const isUnspecified = words.every((word) => word === 0);
    const isLoopback = words.slice(0, 7).every((word) => word === 0) && words[7] === 1;
    const isUniqueLocal = (words[0] & 0xfe00) === 0xfc00;
    const isLinkLocal = (words[0] & 0xffc0) === 0xfe80;
    const isMappedIpv4 = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
    if (isUnspecified || isLoopback || isUniqueLocal || isLinkLocal) fail('SSRF_BLOCKED');
    if (isMappedIpv4) {
      assertPublicIpv4([
        words[6] >>> 8,
        words[6] & 0xff,
        words[7] >>> 8,
        words[7] & 0xff,
      ]);
    }
    return;
  }
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4) assertPublicIpv4(ipv4.slice(1).map(Number));
}

function assertPublicIpv4(octets: number[]): void {
  const [a, b] = octets;
  if (octets.some((entry) => entry < 0 || entry > 255)
    || a === 10
    || a === 127
    || a === 169 && b === 254
    || a === 172 && b >= 16 && b <= 31
    || a === 192 && b === 168
    || a === 100 && b >= 64 && b <= 127) fail('SSRF_BLOCKED');
}

function ipv6Words(address: string): number[] {
  let normalized = address;
  const ipv4Tail = normalized.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (ipv4Tail) {
    const octets = ipv4Tail.split('.').map(Number);
    normalized = `${normalized.slice(0, -ipv4Tail.length)}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = normalized.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const zeroCount = halves.length === 2 ? 8 - left.length - right.length : 0;
  return [...left, ...Array.from({ length: zeroCount }, () => '0'), ...right].map((word) => Number.parseInt(word || '0', 16));
}

function boundedTimeout(value: number | undefined): number {
  const timeout = value ?? REQUEST_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout < 1) throw new TypeError('A2A remote timeout must be positive.');
  return Math.min(Math.trunc(timeout), MAX_TIMEOUT_MS);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_RESPONSE');
  return value as Record<string, unknown>;
}

function asCardRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_AGENT_CARD');
  return value as Record<string, unknown>;
}

const OFFICIAL_SECURITY_SCHEME_FIELDS = Object.freeze([
  'apiKeySecurityScheme',
  'httpAuthSecurityScheme',
  'oauth2SecurityScheme',
  'openIdConnectSecurityScheme',
  'mtlsSecurityScheme',
] as const);

function validateSecurityScheme(value: unknown): Readonly<Record<string, unknown>> {
  const scheme = asCardRecord(value);
  const officialFields = OFFICIAL_SECURITY_SCHEME_FIELDS.filter((field) => Object.hasOwn(scheme, field));
  if (officialFields.length > 0) {
    if (officialFields.length !== 1 || Object.keys(scheme).length !== 1) fail('INVALID_AGENT_CARD');
    const field = officialFields[0];
    const definition = asCardRecord(scheme[field]);
    if (field === 'httpAuthSecurityScheme'
      && (typeof definition.scheme !== 'string' || !definition.scheme.trim())) {
      fail('INVALID_AGENT_CARD');
    }
    return Object.freeze({ [field]: Object.freeze({ ...definition }) });
  }

  const legacyFields = new Set(['type', 'scheme', 'description', 'bearerFormat']);
  if (
    scheme.type !== 'http'
    || typeof scheme.scheme !== 'string'
    || scheme.scheme.toLowerCase() !== 'bearer'
    || Object.keys(scheme).some((field) => !legacyFields.has(field))
  ) {
    fail('INVALID_AGENT_CARD');
  }
  return Object.freeze({ ...scheme });
}

function validateRequirementSchemes(
  value: unknown,
  securitySchemes: Readonly<Record<string, unknown>>,
): Readonly<Record<string, readonly string[]>> {
  const schemes = asCardRecord(value);
  return Object.freeze(Object.fromEntries(Object.entries(schemes).map(([name, scopes]) => {
    if (
      !Object.hasOwn(securitySchemes, name)
      || !Array.isArray(scopes)
      || scopes.some((scope) => typeof scope !== 'string')
    ) {
      fail('INVALID_AGENT_CARD');
    }
    return [name, Object.freeze([...scopes])];
  })));
}

function validateSecurityRequirement(
  value: unknown,
  securitySchemes: Readonly<Record<string, unknown>>,
): A2ARemoteSecurityRequirement {
  const requirement = asCardRecord(value);
  if (Object.hasOwn(requirement, 'schemes')) {
    if (Object.keys(requirement).length !== 1) fail('INVALID_AGENT_CARD');
    return Object.freeze({
      schemes: validateRequirementSchemes(requirement.schemes, securitySchemes),
    });
  }
  return validateRequirementSchemes(requirement, securitySchemes);
}

function optionalCapabilityBoolean(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') fail('INVALID_AGENT_CARD');
  return value;
}

function validateCard(value: unknown): A2ARemoteAgentCard {
  const card = asCardRecord(value);
  if (typeof card.name !== 'string' || typeof card.description !== 'string' || typeof card.version !== 'string') fail('INVALID_AGENT_CARD');
  if (!Array.isArray(card.supportedInterfaces) || card.supportedInterfaces.length === 0) fail('INVALID_AGENT_CARD');
  const supportedInterfaces = card.supportedInterfaces.map((entry) => {
    const item = asCardRecord(entry);
    if (
      typeof item.protocolBinding !== 'string'
      || !item.protocolBinding.trim()
      || typeof item.protocolVersion !== 'string'
      || !item.protocolVersion.trim()
      || typeof item.url !== 'string'
      || (item.tenant !== undefined && (typeof item.tenant !== 'string' || !item.tenant))
    ) fail('INVALID_AGENT_CARD');
    return Object.freeze({
      url: item.url,
      protocolBinding: item.protocolBinding,
      protocolVersion: item.protocolVersion,
      ...(typeof item.tenant === 'string' ? { tenant: item.tenant } : {}),
    });
  });
  const selectedInterfaceIndex = supportedInterfaces.findIndex((item) => (
    item.protocolBinding === 'JSONRPC' && item.protocolVersion === PROTOCOL_VERSION
  ));
  if (selectedInterfaceIndex < 0) fail('UNSUPPORTED_PROTOCOL');
  const selectedInterface = supportedInterfaces[selectedInterfaceIndex];
  const selectedEndpoint = validateBaseUrl(selectedInterface.url);
  supportedInterfaces[selectedInterfaceIndex] = Object.freeze({
    ...selectedInterface,
    url: selectedEndpoint.toString(),
  });
  const rawSecuritySchemes = asCardRecord(card.securitySchemes);
  const securitySchemes = Object.freeze(Object.fromEntries(
    Object.entries(rawSecuritySchemes).map(([name, scheme]) => [name, validateSecurityScheme(scheme)]),
  ));
  if (!Array.isArray(card.securityRequirements)) fail('INVALID_AGENT_CARD');
  const securityRequirements = card.securityRequirements.map((entry) => (
    validateSecurityRequirement(entry, securitySchemes)
  ));
  const capabilities = asCardRecord(card.capabilities);
  const streaming = optionalCapabilityBoolean(capabilities.streaming);
  const pushNotifications = optionalCapabilityBoolean(capabilities.pushNotifications);
  const extendedAgentCard = optionalCapabilityBoolean(capabilities.extendedAgentCard);
  if (
    !Array.isArray(card.defaultInputModes)
    || card.defaultInputModes.some((mode) => typeof mode !== 'string')
    || !Array.isArray(card.defaultOutputModes)
    || card.defaultOutputModes.some((mode) => typeof mode !== 'string')
    || !Array.isArray(card.skills)
  ) fail('INVALID_AGENT_CARD');
  const skills = card.skills.map((value) => {
    const skill = asCardRecord(value);
    if (
      typeof skill.id !== 'string' || !skill.id.trim()
      || typeof skill.name !== 'string' || !skill.name.trim()
      || typeof skill.description !== 'string' || !skill.description.trim()
      || !Array.isArray(skill.tags) || skill.tags.length === 0
      || skill.tags.some((tag) => typeof tag !== 'string' || !tag.trim())
    ) fail('INVALID_AGENT_CARD');
    return Object.freeze({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tags: Object.freeze([...skill.tags] as string[]),
    });
  });
  return Object.freeze({
    name: card.name,
    description: card.description,
    version: card.version,
    supportedInterfaces: Object.freeze(supportedInterfaces),
    capabilities: Object.freeze({
      streaming,
      pushNotifications,
      extendedAgentCard,
    }),
    securitySchemes,
    securityRequirements: Object.freeze(securityRequirements),
    defaultInputModes: Object.freeze([...card.defaultInputModes] as string[]),
    defaultOutputModes: Object.freeze([...card.defaultOutputModes] as string[]),
    skills: Object.freeze(skills),
  });
}

function validateMessage(value: unknown): A2ARemoteMessage {
  const message = asRecord(value);
  if (
    typeof message.messageId !== 'string'
    || message.messageId.length === 0
    || message.messageId.length > 200
    || typeof message.role !== 'string'
    || message.role.length === 0
  ) fail('INVALID_RESPONSE');
  if (!Array.isArray(message.parts) || message.parts.length === 0) fail('INVALID_RESPONSE');
  const parts = message.parts.map((part) => {
    const item = asRecord(part);
    if (typeof item.text !== 'string') fail('INVALID_RESPONSE');
    return Object.freeze({
      text: boundedText(item.text),
      mediaType: typeof item.mediaType === 'string' && item.mediaType.trim()
        ? item.mediaType
        : 'text/plain',
    });
  });
  if (message.contextId !== undefined && typeof message.contextId !== 'string') fail('INVALID_RESPONSE');
  if (message.taskId !== undefined && typeof message.taskId !== 'string') fail('INVALID_RESPONSE');
  const contextId = message.contextId === undefined ? undefined : boundedId(message.contextId);
  const taskId = message.taskId === undefined ? undefined : boundedId(message.taskId);
  return Object.freeze({
    messageId: message.messageId,
    role: message.role,
    ...(contextId ? { contextId } : {}),
    ...(taskId ? { taskId } : {}),
    parts: Object.freeze(parts),
  });
}

function requestId(): string {
  return crypto.randomUUID();
}

function boundedId(value: string, code: A2ARemoteClientErrorCode = 'INVALID_RESPONSE'): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) fail(code);
  return value;
}

function boundedText(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 20_000) fail('INVALID_RESPONSE');
  return value;
}

async function fetchWithTimeout(
  fetcher: A2ARemoteFetch,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response> {
  if (signal?.aborted) throw signal.reason ?? new Error('A2A remote operation was canceled.');
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = (): void => {
    controller.abort(signal?.reason ?? new Error('A2A remote operation was canceled.'));
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    let current = requestUrl(input);
    let currentInit: RequestInit = { ...init, redirect: 'manual', signal: controller.signal };
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      validateFetchUrl(current);
      const response = await fetcher(current, currentInit);
      if (timedOut) fail('TIMEOUT');
      if (signal?.aborted) throw signal.reason ?? new Error('A2A remote operation was canceled.');
      if (response.url) validateFetchUrl(new URL(response.url));
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      if (redirects === MAX_REDIRECTS) fail('HTTP_ERROR');
      const location = response.headers.get('location');
      if (!location) fail('HTTP_ERROR');
      const next = new URL(location, current);
      validateFetchUrl(next);
      const originChanged = next.origin !== current.origin;
      const headers = new Headers(currentInit.headers);
      if (originChanged) headers.delete('authorization');
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && currentInit.method === 'POST')) {
        headers.delete('content-type');
        currentInit = { ...currentInit, method: 'GET', body: undefined, headers };
      } else {
        currentInit = { ...currentInit, headers };
      }
      current = next;
    }
    return fail('HTTP_ERROR');
  } catch (error) {
    if (timedOut) fail('TIMEOUT');
    if (signal?.aborted) throw signal.reason ?? error;
    if (error instanceof A2ARemoteClientError) throw error;
    return fail('NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) return new URL(input.href);
  if (typeof input === 'string') return new URL(input);
  return new URL(input.url);
}

function validateFetchUrl(url: URL): void {
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) fail('UNSUPPORTED_PROTOCOL');
  assertPublicHost(url);
}

export async function createA2ARemoteClient(baseUrl: string, options: ClientOptions = {}): Promise<A2ARemoteClient> {
  const base = validateBaseUrl(baseUrl);
  const fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = boundedTimeout(options.requestTimeoutMs);
  const cardUrl = new URL('/.well-known/agent-card.json', base);
  const cardResponse = await fetchWithTimeout(fetcher, cardUrl, { method: 'GET', headers: { accept: 'application/json' } }, timeoutMs);
  if (cardResponse.status === 401 || cardResponse.status === 403) fail('AUTHENTICATION_FAILED');
  if (!cardResponse.ok) fail('HTTP_ERROR');
  const rawCard = await readJson(cardResponse);
  const card = validateCard(rawCard);
  const selectedInterface = card.supportedInterfaces.find((item) => (
    item.protocolBinding === 'JSONRPC' && item.protocolVersion === PROTOCOL_VERSION
  )) as A2ARemoteJsonRpcInterface;
  const endpoint = new URL(selectedInterface.url);

  function withSelectedTenant(params: Record<string, unknown>): Record<string, unknown> {
    return selectedInterface.tenant === undefined
      ? params
      : { tenant: selectedInterface.tenant, ...params };
  }

  async function authorizationHeaders(): Promise<Record<string, string>> {
    if (card.securityRequirements.length === 0) return {};
    if (!options.bearerTokenProvider) fail('AUTHENTICATION_REQUIRED');
    let token: string;
    try { token = String(await options.bearerTokenProvider()).trim(); } catch { fail('AUTHENTICATION_FAILED'); }
    if (!token) fail('AUTHENTICATION_FAILED');
    return { authorization: `Bearer ${token}` };
  }

  async function rpc<T>(
    method: string,
    params: Record<string, unknown>,
    requestOptions: A2ARemoteRequestOptions = {},
  ): Promise<T> {
    const headers = await authorizationHeaders();
    const id = requestId();
    const response = await fetchWithTimeout(fetcher, endpoint, {
      method: 'POST',
      headers: { ...headers, accept: 'application/json', 'content-type': 'application/json', 'a2a-version': PROTOCOL_VERSION },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params: withSelectedTenant(params),
      }),
    }, timeoutMs, requestOptions.signal);
    if (response.status === 401 || response.status === 403) fail('AUTHENTICATION_FAILED');
    if (!response.ok) fail('HTTP_ERROR');
    const body = asRecord(await readJson(response));
    if (body.jsonrpc !== '2.0' || typeof body.id !== typeof id || body.id !== id) fail('INVALID_RESPONSE');
    if (body.error !== undefined) fail('JSON_RPC_ERROR');
    if (body.result === undefined) fail('INVALID_RESPONSE');
    return body.result as T;
  }

  return Object.freeze({
    card,
    selectedInterface,
    async sendMessage(input, requestOptions = {}) {
      const messageId = boundedId(input.messageId);
      const parts = input.parts.map((part) => ({ text: boundedText(part.text), mediaType: part.mediaType ?? 'text/plain' }));
      const result = await rpc<{ task?: unknown; message?: unknown }>('SendMessage', {
        message: {
          messageId,
          role: 'ROLE_USER',
          ...(input.contextId ? { contextId: boundedId(input.contextId) } : {}),
          parts,
        },
      }, requestOptions);
      const hasTask = result.task !== undefined;
      const hasMessage = result.message !== undefined;
      if (hasTask === hasMessage) fail('INVALID_RESPONSE');
      if (hasTask) return asRecord(result.task);
      return validateMessage(result.message);
    },
    async getTask(id, options = {}) {
      const result = await rpc<A2ARemoteTask>(
        'GetTask',
        { id: boundedId(id), historyLength: options.historyLength ?? 0 },
        options,
      );
      return asRecord(result);
    },
    async listTasks(options = {}) {
      const result = await rpc<Record<string, unknown>>('ListTasks', {
        ...(options.pageSize === undefined ? {} : { pageSize: options.pageSize }),
        ...(options.pageToken ? { pageToken: options.pageToken } : {}),
        historyLength: options.historyLength ?? 0,
      }, options);
      return result;
    },
    async cancelTask(id, requestOptions = {}) {
      const result = await rpc<A2ARemoteTask>('CancelTask', { id: boundedId(id) }, requestOptions);
      return asRecord(result);
    },
  });
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) fail('INVALID_RESPONSE');
  try { return JSON.parse(text); } catch { fail('INVALID_RESPONSE'); }
}
