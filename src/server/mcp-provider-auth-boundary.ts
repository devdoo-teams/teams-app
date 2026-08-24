import { redactSensitiveText } from './sensitive-text.js';

export type ProviderName = 'atlassian' | 'bitbucket';

export type ProviderPrincipal = Readonly<{
  tenantId: string;
  requesterId: string;
}>;

export type ProviderBrokerRequest = Readonly<{
  url: string | URL;
  method?: string;
  headers?: Readonly<Record<string, string>>;
  body?: string | Uint8Array;
  signal?: AbortSignal;
}>;

export type ProviderCredentialBackendRequest = Readonly<{
  provider: ProviderName;
  principal: ProviderPrincipal;
  url: string;
  method: string;
  headers: Readonly<Record<string, string>>;
  body?: string | Uint8Array;
  signal?: AbortSignal;
}>;

export interface ProviderCredentialBackend {
  /** The backend adds credentials internally and never returns them to this boundary. */
  send(request: ProviderCredentialBackendRequest): Promise<Response>;
}

export type ProviderBrokerResult<T> =
  | Readonly<{ ok: true; provider: ProviderName; status: number; data: T }>
  | Readonly<{
    ok: false;
    provider: ProviderName;
    error: Readonly<{
      code: 'invalid-request' | 'credentials-unavailable' | 'provider-error';
      status?: number;
    }>;
  }>;

export interface PrincipalScopedCredentialBroker {
  request<T = unknown>(
    provider: ProviderName,
    request: ProviderBrokerRequest,
    decode?: (value: unknown) => T,
  ): Promise<ProviderBrokerResult<T>>;
}

export type PrincipalScopedCredentialBrokerOptions = Readonly<{
  principal: ProviderPrincipal;
  backend: ProviderCredentialBackend;
}>;

const PRINCIPAL_VALUE = /^[^\u0000-\u001f\u007f]{1,512}$/u;
const ALLOWED_METHODS = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT']);
const CREDENTIAL_HEADER = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token)$/iu;
const CREDENTIAL_QUERY = /^(?:access[_-]?token|api[_-]?key|apikey|client[_-]?secret|password|refresh[_-]?token|secret|token)$/iu;
const SENSITIVE_FIELD = /(?:access[_-]?token|api[_-]?key|apikey|authorization|client[_-]?secret|password|refresh[_-]?token|secret|token)/iu;
const REDACTED = '[REDACTED]';
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;

function validatePrincipal(principal: ProviderPrincipal): ProviderPrincipal {
  const tenantId = principal.tenantId.trim();
  const requesterId = principal.requesterId.trim();
  if (!PRINCIPAL_VALUE.test(tenantId) || !PRINCIPAL_VALUE.test(requesterId)) {
    throw new Error('validated provider principal is required');
  }
  return Object.freeze({ tenantId, requesterId });
}

function normalizeRequest(request: ProviderBrokerRequest): Omit<ProviderCredentialBackendRequest, 'provider' | 'principal'> {
  const url = new URL(request.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('provider request must use a clean HTTPS URL');
  }
  for (const key of url.searchParams.keys()) {
    if (CREDENTIAL_QUERY.test(key)) throw new Error('credential query parameters are broker-owned');
  }

  const method = (request.method ?? 'GET').trim().toUpperCase();
  if (!ALLOWED_METHODS.has(method)) throw new Error('provider request method is not allowed');

  const headers = new Headers(request.headers);
  for (const key of headers.keys()) {
    if (CREDENTIAL_HEADER.test(key)) throw new Error('credential headers are broker-owned');
  }
  const normalizedHeaders = Object.fromEntries([...headers.entries()].sort(([a], [b]) => a.localeCompare(b)));
  const body = request.body === undefined ? undefined : boundedRequestBody(request.body);
  return {
    url: url.toString(),
    method,
    headers: Object.freeze(normalizedHeaders),
    ...(body === undefined ? {} : { body }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  };
}

function boundedRequestBody(body: string | Uint8Array): string | Uint8Array {
  const byteLength = typeof body === 'string' ? new TextEncoder().encode(body).byteLength : body.byteLength;
  if (byteLength > MAX_REQUEST_BYTES) throw new Error('provider request body exceeds the configured size limit');
  return body;
}

function redactBoundaryValue(value: unknown): unknown {
  if (typeof value === 'string') return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map(redactBoundaryValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    SENSITIVE_FIELD.test(key) ? REDACTED : redactBoundaryValue(entry),
  ]));
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isSafeInteger(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error('provider response exceeds the configured size limit');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      totalBytes += next.value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new Error('provider response exceeds the configured size limit');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function decodeResponse(response: Response): Promise<unknown> {
  const text = await readBoundedResponseText(response);
  if (!text.trim()) return null;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.toLowerCase().includes('json')) {
    try {
      return JSON.parse(text);
    } catch {
      return redactSensitiveText(text).slice(0, 48_000);
    }
  }
  return redactSensitiveText(text).slice(0, 48_000);
}

export function createPrincipalScopedCredentialBroker(
  options: PrincipalScopedCredentialBrokerOptions,
): PrincipalScopedCredentialBroker {
  const principal = validatePrincipal(options.principal);
  const backend = options.backend;

  return {
    async request<T = unknown>(provider: ProviderName, request: ProviderBrokerRequest, decode = ((value: unknown) => value as T)): Promise<ProviderBrokerResult<T>> {
      let normalized: Omit<ProviderCredentialBackendRequest, 'provider' | 'principal'>;
      try {
        normalized = normalizeRequest(request);
      } catch {
        return { ok: false, provider, error: { code: 'invalid-request' } };
      }

      try {
        const response = await backend.send({ provider, principal, ...normalized });
        if (!response.ok) {
          if (response.body) await response.body.cancel().catch(() => undefined);
          return {
            ok: false,
            provider,
            error: response.status === 401 || response.status === 403
              ? { code: 'credentials-unavailable', status: response.status }
              : { code: 'provider-error', status: response.status },
          };
        }
        const data = decode(redactBoundaryValue(await decodeResponse(response)));
        return { ok: true, provider, status: response.status, data };
      } catch {
        return { ok: false, provider, error: { code: 'provider-error' } };
      }
    },
  };
}
