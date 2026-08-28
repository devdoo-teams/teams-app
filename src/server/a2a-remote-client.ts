import crypto from 'node:crypto';

const PROTOCOL_VERSION = '1.0' as const;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_BODY_BYTES = 1_000_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export type A2ARemoteAgentCard = Readonly<{
  name: string;
  description: string;
  version: string;
  supportedInterfaces: readonly Readonly<{
    url: string;
    protocolBinding: 'JSONRPC';
    protocolVersion: '1.0';
  }>[];
  capabilities: Readonly<{
    streaming: boolean;
    pushNotifications: boolean;
    extendedAgentCard: boolean;
  }>;
  securitySchemes: Record<string, unknown>;
  securityRequirements: readonly Record<string, readonly string[]>[];
  defaultInputModes: readonly string[];
  defaultOutputModes: readonly string[];
  skills: readonly Record<string, unknown>[];
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
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '0.0.0.0' || host === '::1') {
    fail('SSRF_BLOCKED');
  }
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4) return;
  const octets = ipv4.slice(1).map(Number);
  const [a, b] = octets;
  if (octets.some((entry) => entry < 0 || entry > 255)
    || a === 10
    || a === 127
    || a === 169 && b === 254
    || a === 172 && b >= 16 && b <= 31
    || a === 192 && b === 168
    || a === 100 && b >= 64 && b <= 127) fail('SSRF_BLOCKED');
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

function validateCard(value: unknown): A2ARemoteAgentCard {
  const card = asRecord(value);
  if (typeof card.name !== 'string' || typeof card.description !== 'string' || typeof card.version !== 'string') fail('INVALID_AGENT_CARD');
  if (!Array.isArray(card.supportedInterfaces) || card.supportedInterfaces.length === 0) fail('INVALID_AGENT_CARD');
  const supportedInterfaces = card.supportedInterfaces.map((entry) => {
    const item = asRecord(entry);
    if (item.protocolBinding !== 'JSONRPC' || item.protocolVersion !== PROTOCOL_VERSION || typeof item.url !== 'string') fail('INVALID_AGENT_CARD');
    const endpoint = validateBaseUrl(item.url);
    return Object.freeze({ url: endpoint.toString(), protocolBinding: 'JSONRPC' as const, protocolVersion: PROTOCOL_VERSION });
  });
  const securitySchemes = asRecord(card.securitySchemes);
  if (!Array.isArray(card.securityRequirements)) fail('INVALID_AGENT_CARD');
  const securityRequirements = card.securityRequirements.map((entry) => {
    const requirement = asRecord(entry);
    return Object.freeze(Object.fromEntries(Object.entries(requirement).map(([name, scopes]) => {
      if (!(name in securitySchemes) || !Array.isArray(scopes) || scopes.some((scope) => typeof scope !== 'string')) fail('INVALID_AGENT_CARD');
      return [name, Object.freeze([...scopes])];
    })) as Record<string, readonly string[]>);
  });
  const capabilities = asRecord(card.capabilities);
  if (
    typeof capabilities.streaming !== 'boolean'
    || typeof capabilities.pushNotifications !== 'boolean'
    || typeof capabilities.extendedAgentCard !== 'boolean'
  ) fail('INVALID_AGENT_CARD');
  if (!Array.isArray(card.defaultInputModes) || !Array.isArray(card.defaultOutputModes) || !Array.isArray(card.skills)) fail('INVALID_AGENT_CARD');
  return Object.freeze({
    name: card.name,
    description: card.description,
    version: card.version,
    supportedInterfaces: Object.freeze(supportedInterfaces),
    capabilities: Object.freeze({
      streaming: capabilities.streaming,
      pushNotifications: capabilities.pushNotifications,
      extendedAgentCard: capabilities.extendedAgentCard,
    }),
    securitySchemes,
    securityRequirements: Object.freeze(securityRequirements),
    defaultInputModes: Object.freeze([...card.defaultInputModes] as string[]),
    defaultOutputModes: Object.freeze([...card.defaultOutputModes] as string[]),
    skills: Object.freeze([...card.skills] as Record<string, unknown>[]),
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
    const response = await fetcher(input, { ...init, signal: controller.signal });
    if (timedOut) fail('TIMEOUT');
    if (signal?.aborted) throw signal.reason ?? new Error('A2A remote operation was canceled.');
    return response;
  } catch (error) {
    if (timedOut) fail('TIMEOUT');
    if (signal?.aborted) throw signal.reason ?? error;
    if (error instanceof A2ARemoteClientError) throw error;
    fail('NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
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
  const endpoint = new URL(card.supportedInterfaces[0].url);

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
    const response = await fetchWithTimeout(fetcher, endpoint, {
      method: 'POST',
      headers: { ...headers, accept: 'application/json', 'content-type': 'application/json', 'a2a-version': PROTOCOL_VERSION },
      body: JSON.stringify({ jsonrpc: '2.0', id: requestId(), method, params }),
    }, timeoutMs, requestOptions.signal);
    if (response.status === 401 || response.status === 403) fail('AUTHENTICATION_FAILED');
    if (!response.ok) fail('HTTP_ERROR');
    const body = asRecord(await readJson(response));
    if (body.error !== undefined) fail('JSON_RPC_ERROR');
    if (body.jsonrpc !== '2.0' || body.result === undefined) fail('INVALID_RESPONSE');
    return body.result as T;
  }

  return Object.freeze({
    card,
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
