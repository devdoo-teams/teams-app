import crypto from 'node:crypto';

export type RuntimeScope = {
  tenantId: string;
  requesterId: string;
  conversationId: string;
};

export type RuntimeRecord<T = unknown> = {
  id: string;
  value: T;
  etag: string;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeRecordDocument<T = unknown> = RuntimeRecord<T> & RuntimeScope & {
  partitionKey: string;
  idempotencyKey: string;
  contentHash: string;
};

export type RuntimeWrite<T> = {
  id: string;
  idempotencyKey: string;
  value: T;
  expectedEtag?: string;
};

export interface RuntimeStore {
  read<T = unknown>(scope: RuntimeScope, id: string): Promise<RuntimeRecord<T> | null>;
  list<T = unknown>(scope: RuntimeScope, options?: { limit?: number }): Promise<Array<RuntimeRecord<T>>>;
  write<T = unknown>(scope: RuntimeScope, input: RuntimeWrite<T>): Promise<RuntimeRecord<T>>;
}

export class RuntimeStoreValidationError extends Error {
  readonly code = 'RUNTIME_STORE_VALIDATION';
}

export class RuntimeStoreConflictError extends Error {
  readonly code = 'RUNTIME_STORE_CONFLICT';
}

export const MAX_RUNTIME_RECORD_BYTES = 256 * 1024;
const MAX_IDENTIFIER_LENGTH = 256;

export function deriveRuntimePartitionKey(scope: RuntimeScope): string {
  assertRuntimeScope(scope);
  const digest = crypto
    .createHash('sha256')
    .update(JSON.stringify([scope.tenantId, scope.requesterId, scope.conversationId]), 'utf8')
    .digest('hex');
  return `scope-${digest}`;
}

export function assertRuntimeScope(scope: RuntimeScope): void {
  assertIdentifier(scope?.tenantId, 'tenantId');
  assertIdentifier(scope?.requesterId, 'requesterId');
  assertIdentifier(scope?.conversationId, 'conversationId');
}

export function assertRuntimeIdentifier(value: string, field: string): void {
  assertIdentifier(value, field);
}

export function stableRuntimeJson(value: unknown): string {
  const seen = new Set<object>();
  const normalize = (candidate: unknown): unknown => {
    if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean') return candidate;
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) throw new RuntimeStoreValidationError('runtime value must contain finite numbers');
      return candidate;
    }
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (typeof candidate !== 'object') {
      throw new RuntimeStoreValidationError('runtime value must be JSON serializable');
    }
    if (seen.has(candidate)) throw new RuntimeStoreValidationError('runtime value must not contain cycles');
    seen.add(candidate);
    const record = candidate as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) throw new RuntimeStoreValidationError('runtime value must not contain undefined');
      normalized[key] = normalize(record[key]);
    }
    seen.delete(candidate);
    return normalized;
  };
  return JSON.stringify(normalize(value));
}

export function runtimeContentHash(value: unknown): string {
  return crypto.createHash('sha256').update(stableRuntimeJson(value), 'utf8').digest('hex');
}

export function assertRuntimeDocumentBounded(document: RuntimeRecordDocument): void {
  const bytes = Buffer.byteLength(stableRuntimeJson(document), 'utf8');
  if (bytes > MAX_RUNTIME_RECORD_BYTES) {
    throw new RuntimeStoreValidationError(`runtime record exceeds ${MAX_RUNTIME_RECORD_BYTES} bytes`);
  }
}

function assertIdentifier(value: unknown, field: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new RuntimeStoreValidationError(`${field} must be a nonempty bounded identifier`);
  }
}
