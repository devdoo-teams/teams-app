import {
  createPrincipalScopedCredentialBroker,
  type ProviderBrokerRequest,
  type ProviderBrokerResult,
  type ProviderCredentialBackend,
  type ProviderName,
  type ProviderPrincipal,
} from './mcp-provider-auth-boundary.js';
import type { ProviderCredentialResolver } from './mcp-provider-tools.js';
import { redactSensitiveText } from './sensitive-text.js';

export type ProviderHttpFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type ProviderHttpRequestBody = ProviderBrokerRequest['body'] | ReadableStream<Uint8Array>;

export type ProviderHttpBrokerRequest = Omit<ProviderBrokerRequest, 'body'> & Readonly<{
  body?: ProviderHttpRequestBody;
}>;

export type PrincipalScopedProviderHttpBrokerOptions = Readonly<{
  principal: ProviderPrincipal;
  resolveCredential: ProviderCredentialResolver;
  /** Provider-owned HTTPS origins. Credentials are never sent outside this allowlist. */
  allowedOrigins: Readonly<Record<ProviderName, readonly string[]>>;
  fetchImpl?: ProviderHttpFetch;
  timeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
}>;

export interface PrincipalScopedProviderHttpBroker {
  readonly principal: ProviderPrincipal;

  request<T = unknown>(
    provider: ProviderName,
    request: ProviderHttpBrokerRequest,
    decode?: (value: unknown) => T,
  ): Promise<ProviderBrokerResult<T> & Readonly<{ contentType?: string }>>;

  fetch<T = unknown>(
    provider: ProviderName,
    request: ProviderHttpBrokerRequest,
    decode?: (value: unknown) => T,
  ): Promise<ProviderBrokerResult<T> & Readonly<{ contentType?: string }>>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_MAX_REQUEST_BYTES = 64 * 1024;
const MAX_REQUEST_BYTES = 1024 * 1024;
const REDACTED = '[REDACTED]';
const PRINCIPAL_VALUE = /^[^\u0000-\u001f\u007f]{1,512}$/u;

const CREDENTIAL_QUERY_PARAMETER = /^(?:access[_-]?token|api[_-]?key|apikey|client[_-]?secret|code|id[_-]?token|password|passwd|pwd|refresh[_-]?token|secret|signature|sig|token)$/iu;
const CREDENTIAL_HEADER_NAME = /(?:authorization|proxy-authorization|cookie|set-cookie|access[_-]?token|api[_-]?key|apikey|auth[_-]?token|refresh[_-]?token|id[_-]?token|password|passwd|pwd|secret|signature|token)/iu;
const SENSITIVE_RESPONSE_FIELD = /(?:access[_-]?token|api[_-]?key|apikey|authorization|client[_-]?secret|credential|cookie|id[_-]?token|password|passwd|pwd|refresh[_-]?token|secret|signature|token)/iu;

function normalizeBound(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(1, Math.floor(value)));
}

function normalizePrincipal(principal: ProviderPrincipal): ProviderPrincipal {
  const tenantId = principal.tenantId.trim();
  const requesterId = principal.requesterId.trim();
  if (!PRINCIPAL_VALUE.test(tenantId) || !PRINCIPAL_VALUE.test(requesterId)) {
    throw new Error('validated provider principal is required');
  }
  return Object.freeze({ tenantId, requesterId });
}

function normalizeAllowedOrigins(
  value: Readonly<Record<ProviderName, readonly string[]>>,
): Readonly<Record<ProviderName, ReadonlySet<string>>> {
  const providers: ProviderName[] = ['atlassian', 'bitbucket'];
  return Object.freeze(Object.fromEntries(providers.map((provider) => {
    const configured = value[provider];
    if (!Array.isArray(configured) || configured.length === 0 || configured.length > 8) {
      throw new Error(`${provider} provider origin allowlist is required`);
    }
    const origins = configured.map((candidate) => {
      const parsed = new URL(candidate);
      if (
        parsed.protocol !== 'https:'
        || parsed.username
        || parsed.password
        || parsed.port
        || parsed.pathname !== '/'
        || parsed.search
        || parsed.hash
        || !isOfficialProviderHost(provider, parsed.hostname)
      ) {
        throw new Error(`${provider} provider origin must be a clean HTTPS origin`);
      }
      return parsed.origin;
    });
    return [provider, new Set(origins)] as const;
  })) as unknown as Record<ProviderName, ReadonlySet<string>>);
}

function isOfficialProviderHost(provider: ProviderName, hostname: string): boolean {
  if (provider === 'bitbucket') return hostname === 'api.bitbucket.org';
  return hostname === 'api.atlassian.com' || isAtlassianCloudSiteHost(hostname);
}

function isAtlassianCloudSiteHost(hostname: string): boolean {
  const suffix = '.atlassian.net';
  if (!hostname.endsWith(suffix)) return false;
  const site = hostname.slice(0, -suffix.length);
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(site);
}

function isAllowedOrigin(
  allowedOrigins: Readonly<Record<ProviderName, ReadonlySet<string>>>,
  provider: ProviderName,
  request: ProviderBrokerRequest,
): boolean {
  try {
    const parsed = new URL(request.url);
    return parsed.protocol === 'https:' && allowedOrigins[provider].has(parsed.origin);
  } catch {
    return false;
  }
}

function hasCredentialInput(request: ProviderBrokerRequest): boolean {
  try {
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].some((key) => CREDENTIAL_QUERY_PARAMETER.test(key))) return true;
    const headers = new Headers(request.headers);
    return [...headers.keys()].some((key) => CREDENTIAL_HEADER_NAME.test(key));
  } catch {
    return true;
  }
}

function declaredRequestBodyLength(headers: Headers): number | undefined {
  const value = headers.get('content-length');
  if (value === null) return undefined;
  if (!/^(?:0|[1-9]\d*)$/u.test(value.trim())) throw new Error('provider request content length is invalid');
  const length = Number(value);
  if (!Number.isSafeInteger(length)) throw new Error('provider request content length is invalid');
  return length;
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return Boolean(value) && typeof value === 'object' && typeof (value as ReadableStream<Uint8Array>).getReader === 'function';
}

function ensureRequestBodyLength(length: number | undefined, maxRequestBytes: number): void {
  if (length !== undefined && length > maxRequestBytes) {
    throw new Error('provider request exceeds the configured size limit');
  }
}

function abortError(): Error {
  const error = new Error('aborted');
  error.name = 'AbortError';
  return error;
}

async function boundedRequestBody(
  body: ProviderHttpRequestBody | undefined,
  headers: HeadersInit | undefined,
  maxRequestBytes: number,
  signal: AbortSignal | undefined,
): Promise<ProviderBrokerRequest['body'] | undefined> {
  ensureRequestBodyLength(declaredRequestBodyLength(new Headers(headers)), maxRequestBytes);
  if (body === undefined) return undefined;
  if (typeof body === 'string') {
    ensureRequestBodyLength(new TextEncoder().encode(body).byteLength, maxRequestBytes);
    return body;
  }
  if (body instanceof Uint8Array) {
    ensureRequestBodyLength(body.byteLength, maxRequestBytes);
    return body;
  }
  if (!isReadableStream(body)) throw new Error('provider request body is invalid');

  const reader = body.getReader();
  const cancelReader = () => {
    void reader.cancel().catch(() => undefined);
  };
  let onAbort: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    onAbort = () => {
      cancelReader();
      reject(signal?.reason instanceof Error ? signal.reason : abortError());
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const next = await Promise.race([reader.read(), abortPromise]);
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : abortError();
      if (next.done) break;
      totalBytes += next.value.byteLength;
      if (totalBytes > maxRequestBytes) {
        cancelReader();
        throw new Error('provider request exceeds the configured size limit');
      }
      chunks.push(next.value);
    }
  } catch (error) {
    cancelReader();
    throw error;
  } finally {
    if (onAbort && signal) signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function redactTransportValue(value: unknown): unknown {
  if (typeof value === 'string') return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map(redactTransportValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    SENSITIVE_RESPONSE_FIELD.test(key) ? REDACTED : redactTransportValue(entry),
  ]));
}

async function boundedResponse(response: Response, maxResponseBytes: number, signal: AbortSignal): Promise<Response> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isSafeInteger(declaredLength) && declaredLength > maxResponseBytes) {
    throw new Error('provider response exceeds the configured size limit');
  }
  if (!response.body) return response;

  const reader = response.body.getReader();
  const cancelReader = () => {
    void reader.cancel().catch(() => undefined);
  };
  let onAbort: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    onAbort = () => {
      cancelReader();
      reject(signal.reason instanceof Error ? signal.reason : abortError());
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const next = await Promise.race([reader.read(), abortPromise]);
      if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : abortError();
      if (next.done) break;
      const chunk = next.value;
      totalBytes += chunk.byteLength;
      if (totalBytes > maxResponseBytes) {
        cancelReader();
        throw new Error('provider response exceeds the configured size limit');
      }
      chunks.push(chunk);
    }
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function boundedFetch(
  fetchImpl: ProviderHttpFetch,
  request: Parameters<ProviderCredentialBackend['send']>[0],
  credential: string,
  timeoutMs: number,
  maxRequestBytes: number,
  maxResponseBytes: number,
): Promise<Response> {
  const controller = new AbortController();
  const parentSignal = request.signal;
  const headers = new Headers(request.headers);
  headers.set('Authorization', `Bearer ${credential}`);

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onParentAbort: (() => void) | undefined;
  const timeoutFailure = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('provider request timed out'));
    }, timeoutMs);
  });
  const parentFailure = parentSignal === undefined
    ? undefined
    : new Promise<never>((_, reject) => {
      onParentAbort = () => {
        controller.abort();
        reject(new Error('provider request was aborted'));
      };
      if (parentSignal.aborted) onParentAbort();
      else parentSignal.addEventListener('abort', onParentAbort, { once: true });
    });

  const operation = (async (): Promise<Response> => {
    const body = await boundedRequestBody(request.body, headers, maxRequestBytes, controller.signal);
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers,
      ...(body === undefined ? {} : { body: body as BodyInit }),
      signal: controller.signal,
    });
    return response.ok ? boundedResponse(response, maxResponseBytes, controller.signal) : response;
  })();

  try {
    const pending = [operation, timeoutFailure];
    if (parentFailure) pending.push(parentFailure);
    return await Promise.race(pending);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (onParentAbort && parentSignal) parentSignal.removeEventListener('abort', onParentAbort);
  }
}

export function createPrincipalScopedProviderHttpBroker(
  options: PrincipalScopedProviderHttpBrokerOptions,
): PrincipalScopedProviderHttpBroker {
  const principal = normalizePrincipal(options.principal);
  const allowedOrigins = normalizeAllowedOrigins(options.allowedOrigins);
  const timeoutMs = normalizeBound(options.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
  const maxRequestBytes = normalizeBound(options.maxRequestBytes, DEFAULT_MAX_REQUEST_BYTES, MAX_REQUEST_BYTES);
  const maxResponseBytes = normalizeBound(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, MAX_RESPONSE_BYTES);
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request<T = unknown>(
    provider: ProviderName,
    providerRequest: ProviderBrokerRequest,
    decode?: (value: unknown) => T,
  ): Promise<ProviderBrokerResult<T> & Readonly<{ contentType?: string }>> {
    if (!isAllowedOrigin(allowedOrigins, provider, providerRequest)) {
      return { ok: false, provider, error: { code: 'invalid-request' } };
    }
    if (hasCredentialInput(providerRequest)) {
      return { ok: false, provider, error: { code: 'invalid-request' } };
    }
    let body: ProviderBrokerRequest['body'] | undefined;
    try {
      body = await boundedRequestBody(providerRequest.body, providerRequest.headers, maxRequestBytes, providerRequest.signal);
    } catch {
      return { ok: false, provider, error: { code: 'invalid-request' } };
    }
    const decodeValue = decode ?? ((value: unknown) => value as T);
    let contentType: string | undefined;
    const backend: ProviderCredentialBackend = {
      async send(request) {
        const credential = (await options.resolveCredential(request.provider, request.principal))?.trim();
        if (!credential) return new Response(null, { status: 401 });
        const response = await boundedFetch(fetchImpl, request, credential, timeoutMs, maxRequestBytes, maxResponseBytes);
        contentType = response.headers.get('content-type') ?? undefined;
        return response;
      },
    };
    const boundary = createPrincipalScopedCredentialBroker({ principal, backend });
    const result = await boundary.request(provider, {
      ...providerRequest,
      ...(body === undefined ? {} : { body }),
    }, (value) => decodeValue(redactTransportValue(value)));
    if (result.ok && contentType !== undefined) return { ...result, contentType };
    return result;
  }

  async function providerFetch<T = unknown>(
    provider: ProviderName,
    providerRequest: ProviderHttpBrokerRequest,
    decode?: (value: unknown) => T,
  ): Promise<ProviderBrokerResult<T>> {
    return request(provider, providerRequest as ProviderBrokerRequest, decode);
  }

  return Object.freeze({ principal, request, fetch: providerFetch });
}

export const createPrincipalScopedFetchBroker = createPrincipalScopedProviderHttpBroker;
