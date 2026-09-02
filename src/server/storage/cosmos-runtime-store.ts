import {
  assertRuntimeDocumentBounded,
  assertRuntimeIdentifier,
  assertRuntimeScope,
  deriveRuntimePartitionKey,
  runtimeContentHash,
  RuntimeStoreConflictError,
  RuntimeStoreValidationError,
  type RuntimeRecord,
  type RuntimeRecordDocument,
  type RuntimeScope,
  type RuntimeStore,
  type RuntimeWrite,
} from './runtime-store.js';

export type CosmosPortResult = {
  document: RuntimeRecordDocument;
  etag: string;
};

export interface CosmosRuntimeContainerPort {
  read(id: string, partitionKey: string): Promise<CosmosPortResult | null>;
  create(document: RuntimeRecordDocument): Promise<CosmosPortResult>;
  replace(
    id: string,
    partitionKey: string,
    document: RuntimeRecordDocument,
    ifMatch: string,
  ): Promise<CosmosPortResult>;
  queryPartition(partitionKey: string, limit: number): Promise<CosmosPortResult[]>;
}

export class CosmosRuntimeStore implements RuntimeStore {
  private readonly container: CosmosRuntimeContainerPort;
  private readonly now: () => Date;

  constructor(options: { container: CosmosRuntimeContainerPort; now?: () => Date }) {
    this.container = options.container;
    this.now = options.now ?? (() => new Date());
  }

  async read<T = unknown>(scope: RuntimeScope, id: string): Promise<RuntimeRecord<T> | null> {
    assertRuntimeScope(scope);
    assertRuntimeIdentifier(id, 'id');
    const result = await this.container.read(id, deriveRuntimePartitionKey(scope));
    return result ? this.fromPortResult<T>(scope, result) : null;
  }

  async list<T = unknown>(
    scope: RuntimeScope,
    options: { limit?: number } = {},
  ): Promise<Array<RuntimeRecord<T>>> {
    assertRuntimeScope(scope);
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new RuntimeStoreValidationError('limit must be an integer between 1 and 1000');
    }
    const results = await this.container.queryPartition(deriveRuntimePartitionKey(scope), limit);
    return results.map((result) => this.fromPortResult<T>(scope, result));
  }

  async write<T = unknown>(scope: RuntimeScope, input: RuntimeWrite<T>): Promise<RuntimeRecord<T>> {
    assertRuntimeScope(scope);
    assertRuntimeIdentifier(input.id, 'id');
    assertRuntimeIdentifier(input.idempotencyKey, 'idempotencyKey');
    if (input.expectedEtag !== undefined) assertRuntimeIdentifier(input.expectedEtag, 'expectedEtag');

    const partitionKey = deriveRuntimePartitionKey(scope);
    const contentHash = runtimeContentHash(input.value);
    const current = await this.container.read(input.id, partitionKey);

    if (current) {
      const currentRecord = this.fromPortResult<T>(scope, current);
      if (current.document.idempotencyKey === input.idempotencyKey) {
        if (current.document.contentHash !== contentHash) {
          throw new RuntimeStoreConflictError('idempotency key was already used for different content');
        }
        return currentRecord;
      }
      if (!input.expectedEtag) throw new RuntimeStoreConflictError('expectedEtag is required to update a record');
      if (input.expectedEtag !== currentRecord.etag) throw new RuntimeStoreConflictError('runtime record ETag is stale');

      const document = this.buildDocument(scope, input, partitionKey, contentHash, current.document.createdAt);
      try {
        return this.fromPortResult<T>(scope, await this.container.replace(
          input.id,
          partitionKey,
          document,
          input.expectedEtag,
        ));
      } catch (error) {
        if (hasStatusCode(error, 409) || hasStatusCode(error, 412)) {
          throw new RuntimeStoreConflictError('runtime record changed concurrently');
        }
        throw error;
      }
    }

    if (input.expectedEtag) throw new RuntimeStoreConflictError('cannot update a missing runtime record');
    const document = this.buildDocument(scope, input, partitionKey, contentHash);
    try {
      return this.fromPortResult<T>(scope, await this.container.create(document));
    } catch (error) {
      if (!hasStatusCode(error, 409)) throw error;
      const raced = await this.container.read(input.id, partitionKey);
      if (
        raced &&
        raced.document.idempotencyKey === input.idempotencyKey &&
        raced.document.contentHash === contentHash
      ) {
        return this.fromPortResult<T>(scope, raced);
      }
      throw new RuntimeStoreConflictError('runtime record was created concurrently');
    }
  }

  private buildDocument<T>(
    scope: RuntimeScope,
    input: RuntimeWrite<T>,
    partitionKey: string,
    contentHash: string,
    createdAt?: string,
  ): RuntimeRecordDocument<T> {
    const timestamp = this.now().toISOString();
    const document: RuntimeRecordDocument<T> = {
      id: input.id,
      ...scope,
      partitionKey,
      idempotencyKey: input.idempotencyKey,
      contentHash,
      value: structuredClone(input.value),
      etag: input.expectedEtag ?? '',
      createdAt: createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    assertRuntimeDocumentBounded(document);
    return document;
  }

  private fromPortResult<T>(scope: RuntimeScope, result: CosmosPortResult): RuntimeRecord<T> {
    const expectedPartition = deriveRuntimePartitionKey(scope);
    const document = result.document;
    if (
      document.partitionKey !== expectedPartition ||
      document.tenantId !== scope.tenantId ||
      document.requesterId !== scope.requesterId ||
      document.conversationId !== scope.conversationId
    ) {
      throw new RuntimeStoreValidationError('persisted runtime record scope does not match the requested scope');
    }
    if (!result.etag) throw new RuntimeStoreValidationError('persisted runtime record is missing an ETag');
    return {
      id: document.id,
      value: structuredClone(document.value) as T,
      etag: result.etag,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    };
  }
}

function hasStatusCode(error: unknown, statusCode: number): boolean {
  return Boolean(error && typeof error === 'object' && 'statusCode' in error && error.statusCode === statusCode);
}
