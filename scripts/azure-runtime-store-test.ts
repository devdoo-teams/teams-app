import assert from 'node:assert/strict';

import {
  deriveRuntimePartitionKey,
  runtimeContentHash,
  RuntimeStoreConflictError,
  RuntimeStoreValidationError,
  stableRuntimeJson,
  type RuntimeRecordDocument,
  type RuntimeScope,
} from '../src/server/storage/runtime-store.js';
import {
  CosmosRuntimeStore,
  type CosmosPortResult,
  type CosmosRuntimeContainerPort,
} from '../src/server/storage/cosmos-runtime-store.js';
import { createRuntimeStore } from '../src/server/storage/runtime-store-factory.js';

const scopeA: RuntimeScope = {
  tenantId: 'tenant-a',
  requesterId: 'user-a',
  conversationId: 'conversation-a',
};
const scopeB: RuntimeScope = { ...scopeA, requesterId: 'user-b' };
const scopeC: RuntimeScope = { ...scopeA, tenantId: 'tenant-b' };

class MemoryCosmosPort implements CosmosRuntimeContainerPort {
  readonly documents = new Map<string, RuntimeRecordDocument>();
  readonly calls: Array<{ operation: string; id?: string; partitionKey: string; ifMatch?: string }> = [];
  failNextCreate = false;
  private revision = 0;

  async read(id: string, partitionKey: string) {
    this.calls.push({ operation: 'read', id, partitionKey });
    const document = this.documents.get(this.key(id, partitionKey));
    return document ? { document: structuredClone(document), etag: document.etag } : null;
  }

  async create(document: RuntimeRecordDocument) {
    this.calls.push({ operation: 'create', id: document.id, partitionKey: document.partitionKey });
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new Error('fixture persistence unavailable');
    }
    const key = this.key(document.id, document.partitionKey);
    if (this.documents.has(key)) throw Object.assign(new Error('conflict'), { statusCode: 409 });
    const persisted = { ...structuredClone(document), etag: this.nextEtag() };
    this.documents.set(key, persisted);
    return { document: structuredClone(persisted), etag: persisted.etag };
  }

  async replace(id: string, partitionKey: string, document: RuntimeRecordDocument, ifMatch: string) {
    this.calls.push({ operation: 'replace', id, partitionKey, ifMatch });
    const key = this.key(id, partitionKey);
    const current = this.documents.get(key);
    if (!current || current.etag !== ifMatch) throw Object.assign(new Error('precondition failed'), { statusCode: 412 });
    const persisted = { ...structuredClone(document), etag: this.nextEtag() };
    this.documents.set(key, persisted);
    return { document: structuredClone(persisted), etag: persisted.etag };
  }

  async queryPartition(partitionKey: string, limit: number) {
    this.calls.push({ operation: 'query', partitionKey });
    return [...this.documents.values()]
      .filter((document) => document.partitionKey === partitionKey)
      .slice(0, limit)
      .map((document) => ({ document: structuredClone(document), etag: document.etag }));
  }

  private key(id: string, partitionKey: string): string {
    return `${partitionKey}\u0000${id}`;
  }

  private nextEtag(): string {
    this.revision += 1;
    return `\"etag-${this.revision}\"`;
  }
}

class ConflictReadbackPort implements CosmosRuntimeContainerPort {
  readonly calls: string[] = [];
  private conflicted = false;

  constructor(
    private readonly operation: 'create' | 'replace',
    private readonly statusCode: 409 | 412,
    private readonly initial: { document: RuntimeRecordDocument; etag: string } | null,
    private readonly readBack: Array<{ document: RuntimeRecordDocument; etag: string } | null>,
  ) {}

  async read(_id: string, _partitionKey: string): Promise<CosmosPortResult | null> {
    this.calls.push(this.conflicted ? 'read-back' : 'read-initial');
    if (!this.conflicted) return this.initial ? structuredClone(this.initial) : null;
    const result = this.readBack.shift() ?? null;
    return result ? structuredClone(result) : null;
  }

  async create(_document: RuntimeRecordDocument): Promise<CosmosPortResult> {
    this.calls.push('create');
    assert.equal(this.operation, 'create');
    this.conflicted = true;
    throw Object.assign(new Error('write conflict'), { statusCode: this.statusCode });
  }

  async replace(
    _id: string,
    _partitionKey: string,
    _document: RuntimeRecordDocument,
    _ifMatch: string,
  ): Promise<CosmosPortResult> {
    this.calls.push('replace');
    assert.equal(this.operation, 'replace');
    this.conflicted = true;
    throw Object.assign(new Error('write conflict'), { statusCode: this.statusCode });
  }

  async queryPartition(_partitionKey: string, _limit: number): Promise<CosmosPortResult[]> {
    return [];
  }
}

function persistedDocument(options: {
  scope?: RuntimeScope;
  id?: string;
  idempotencyKey: string;
  value: unknown;
  etag: string;
}): { document: RuntimeRecordDocument; etag: string } {
  const recordScope = options.scope ?? scopeA;
  const timestamp = '2026-09-03T00:00:00.000Z';
  return {
    document: {
      id: options.id ?? 'race-task',
      ...recordScope,
      partitionKey: deriveRuntimePartitionKey(recordScope),
      idempotencyKey: options.idempotencyKey,
      contentHash: runtimeContentHash(options.value),
      value: structuredClone(options.value),
      etag: options.etag,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    etag: options.etag,
  };
}

const port = new MemoryCosmosPort();
let now = Date.parse('2026-09-03T00:00:00.000Z');
const store = new CosmosRuntimeStore({ container: port, now: () => new Date(now) });

const partitionA = deriveRuntimePartitionKey(scopeA);
assert.equal(partitionA, deriveRuntimePartitionKey({ ...scopeA }), 'same server scope has a stable partition key');
assert.notEqual(partitionA, deriveRuntimePartitionKey(scopeB), 'requester participates in partitioning');
assert.notEqual(partitionA, deriveRuntimePartitionKey({ ...scopeA, conversationId: 'other' }), 'conversation participates in partitioning');
assert.throws(
  () => deriveRuntimePartitionKey({ ...scopeA, tenantId: '' }),
  RuntimeStoreValidationError,
  'empty server-derived scope is rejected',
);

const protoOnlyValue = Object.create(null) as Record<string, unknown>;
Object.defineProperty(protoOnlyValue, '__proto__', {
  enumerable: true,
  value: { marker: 'preserved' },
});
assert.equal(
  stableRuntimeJson(protoOnlyValue),
  '{"__proto__":{"marker":"preserved"}}',
  'canonical JSON preserves an enumerable own __proto__ key',
);
assert.notEqual(
  runtimeContentHash(protoOnlyValue),
  runtimeContentHash({}),
  'an own __proto__ key participates in the content hash',
);

const specialOwnKeysValue = Object.create(null) as Record<string, unknown>;
for (const [key, marker] of [
  ['__proto__', 'proto'],
  ['constructor', 'ctor'],
  ['prototype', 'prototype'],
] as const) {
  Object.defineProperty(specialOwnKeysValue, key, {
    enumerable: true,
    value: { marker },
  });
}
const specialOwnKeysJson = '{"__proto__":{"marker":"proto"},"constructor":{"marker":"ctor"},"prototype":{"marker":"prototype"}}';
assert.equal(
  stableRuntimeJson(specialOwnKeysValue),
  specialOwnKeysJson,
  'canonical JSON preserves and sorts __proto__, constructor, and prototype as own keys',
);
assert.equal(
  runtimeContentHash(specialOwnKeysValue),
  '2a3be3dc029fa4abd0db24922636c98a754bb02e5c2c7b9917ab5e4dade9f298',
  'special own keys produce the expected canonical content hash',
);

const created = await store.write(scopeA, {
  id: 'task-1',
  idempotencyKey: 'submit-1',
  value: { state: 'queued', tenantId: 'payload-must-not-control-scope' },
});
assert.equal(created.value.state, 'queued');
assert.equal(port.calls.at(-1)?.partitionKey, partitionA, 'Cosmos operation receives the server-derived partition key');

const duplicateCreate = await store.write(scopeA, {
  id: 'task-1',
  idempotencyKey: 'submit-1',
  value: { state: 'queued', tenantId: 'payload-must-not-control-scope' },
});
assert.equal(duplicateCreate.etag, created.etag, 'duplicate create replay returns the original result');
assert.equal(port.calls.filter((call) => call.operation === 'create').length, 1, 'duplicate create is not persisted twice');

await assert.rejects(
  () => store.write(scopeA, { id: 'task-1', idempotencyKey: 'submit-1', value: { state: 'changed' } }),
  RuntimeStoreConflictError,
  'reusing an idempotency key for different content fails closed',
);

const oversizedProtoValue = Object.create(null) as Record<string, unknown>;
Object.defineProperty(oversizedProtoValue, '__proto__', {
  enumerable: true,
  value: 'x'.repeat(300_000),
});
await assert.rejects(
  () => store.write(scopeA, {
    id: 'oversized-proto',
    idempotencyKey: 'oversized-proto-1',
    value: oversizedProtoValue,
  }),
  RuntimeStoreValidationError,
  'an oversized own __proto__ value cannot bypass the 256 KiB record limit',
);

const oversizedSpecialOwnKeysValue = Object.create(null) as Record<string, unknown>;
for (const key of ['__proto__', 'constructor', 'prototype']) {
  Object.defineProperty(oversizedSpecialOwnKeysValue, key, {
    enumerable: true,
    value: 'x'.repeat(90_000),
  });
}
await assert.rejects(
  () => store.write(scopeA, {
    id: 'oversized-special-own-keys',
    idempotencyKey: 'oversized-special-own-keys-1',
    value: oversizedSpecialOwnKeysValue,
  }),
  RuntimeStoreValidationError,
  'special own keys cannot bypass the 256 KiB record limit in aggregate',
);

for (const [operation, statusCode] of [
  ['create', 409],
  ['create', 412],
  ['replace', 409],
  ['replace', 412],
] as const) {
  const desiredValue = { state: 'committed-by-racer', operation, statusCode };
  const winner = persistedDocument({
    idempotencyKey: `${operation}-${statusCode}`,
    value: desiredValue,
    etag: `\"winner-${operation}-${statusCode}\"`,
  });
  const initial = operation === 'replace'
    ? persistedDocument({ idempotencyKey: 'previous-write', value: { state: 'previous' }, etag: '"previous"' })
    : null;
  const conflictPort = new ConflictReadbackPort(operation, statusCode, initial, [null, null, winner]);
  const conflictStore = new CosmosRuntimeStore({ container: conflictPort });
  const replay = await conflictStore.write(scopeA, {
    id: 'race-task',
    idempotencyKey: `${operation}-${statusCode}`,
    ...(operation === 'replace' ? { expectedEtag: '"previous"' } : {}),
    value: desiredValue,
  });
  assert.equal(replay.etag, winner.etag, `${operation} ${statusCode} returns the matching committed replay`);
  assert.equal(
    conflictPort.calls.filter((call) => call === 'read-back').length,
    3,
    `${operation} ${statusCode} uses bounded read-back attempts`,
  );
}

for (const mismatch of ['scope', 'id', 'idempotencyKey', 'contentHash'] as const) {
  const desiredValue = { state: 'desired' };
  const mismatchScope = { ...scopeA, requesterId: 'other-user' };
  const winner = persistedDocument({
    scope: mismatch === 'scope' ? mismatchScope : scopeA,
    id: mismatch === 'id' ? 'other-task' : 'race-task',
    idempotencyKey: mismatch === 'idempotencyKey' ? 'other-key' : 'create-conflict',
    value: mismatch === 'contentHash' ? { state: 'other' } : desiredValue,
    etag: `\"mismatch-${mismatch}\"`,
  });
  const conflictPort = new ConflictReadbackPort('create', 409, null, [winner, winner, winner]);
  const conflictStore = new CosmosRuntimeStore({ container: conflictPort });
  await assert.rejects(
    () => conflictStore.write(scopeA, {
      id: 'race-task',
      idempotencyKey: 'create-conflict',
      value: desiredValue,
    }),
    RuntimeStoreConflictError,
    `a conflicting ${mismatch} never qualifies as an idempotent replay`,
  );
  assert.equal(
    conflictPort.calls.filter((call) => call === 'read-back').length,
    3,
    `a ${mismatch} mismatch exhausts only the bounded read-back window`,
  );
}
await assert.rejects(
  () => store.write(scopeA, { id: 'task-1', idempotencyKey: 'update-without-etag', value: { state: 'working' } }),
  RuntimeStoreConflictError,
  'an update requires optimistic concurrency evidence',
);

now += 1_000;
const updated = await store.write(scopeA, {
  id: 'task-1',
  idempotencyKey: 'update-1',
  expectedEtag: created.etag,
  value: { state: 'working' },
});
assert.notEqual(updated.etag, created.etag, 'successful update advances the ETag');
const replaceCall = port.calls.find((call) => call.operation === 'replace');
assert.equal(replaceCall?.ifMatch, created.etag, 'update sends the caller ETag as If-Match');

const duplicateUpdate = await store.write(scopeA, {
  id: 'task-1',
  idempotencyKey: 'update-1',
  expectedEtag: created.etag,
  value: { state: 'working' },
});
assert.equal(duplicateUpdate.etag, updated.etag, 'duplicate update replay returns the committed result');
assert.equal(port.calls.filter((call) => call.operation === 'replace').length, 1, 'duplicate update is not replaced twice');

await assert.rejects(
  () => store.write(scopeA, {
    id: 'task-1',
    idempotencyKey: 'stale-update',
    expectedEtag: created.etag,
    value: { state: 'completed' },
  }),
  RuntimeStoreConflictError,
  'a stale ETag is reported as a concurrency conflict',
);

assert.deepEqual((await store.read(scopeA, 'task-1'))?.value, { state: 'working' }, 'scoped read returns its own record');
assert.equal(await store.read(scopeB, 'task-1'), null, 'another requester cannot read the record');
assert.equal(await store.read(scopeC, 'task-1'), null, 'another tenant cannot read the record');
assert.deepEqual((await store.list(scopeA, { limit: 10 })).map((record) => record.id), ['task-1']);
assert.deepEqual(await store.list(scopeB, { limit: 10 }), [], 'queries are partition-scoped');

const sameIdOtherScope = await store.write(scopeB, {
  id: 'task-1',
  idempotencyKey: 'scope-b-submit',
  value: { state: 'private-b' },
});
assert.equal(sameIdOtherScope.value.state, 'private-b', 'the same record id can exist in an isolated user scope');
assert.deepEqual((await store.read(scopeA, 'task-1'))?.value, { state: 'working' });

await assert.rejects(
  () => store.write(scopeA, {
    id: 'oversized',
    idempotencyKey: 'oversized-1',
    value: { content: 'x'.repeat(300_000) },
  }),
  RuntimeStoreValidationError,
  'oversized records are rejected before persistence',
);

port.failNextCreate = true;
await assert.rejects(
  () => store.write(scopeA, { id: 'failed', idempotencyKey: 'failed-1', value: { state: 'queued' } }),
  /fixture persistence unavailable/,
  'persistence failure reaches the caller',
);
assert.equal(await store.read(scopeA, 'failed'), null, 'failed persistence is not hidden by an in-memory fallback');
const recovered = await store.write(scopeA, { id: 'failed', idempotencyKey: 'failed-1', value: { state: 'queued' } });
assert.equal(recovered.value.state, 'queued', 'a later real persistence attempt can recover');

const fileStore = { kind: 'file' } as never;
assert.equal(
  await createRuntimeStore({ env: {}, fileStore }),
  fileStore,
  'file compatibility remains the default backend',
);

for (const forbidden of [
  'AZURE_COSMOS_CONNECTION_STRING',
  'COSMOS_CONNECTION_STRING',
  'AZURE_COSMOS_KEY',
  'COSMOS_KEY',
  'AZURE_COSMOS_ACCOUNT_KEY',
  'AZURE_COSMOS_PRIMARY_KEY',
  'COSMOSDB_CONNECTION_STRING',
]) {
  await assert.rejects(
    () => createRuntimeStore({ env: { TEAMS_STORAGE_BACKEND: 'cosmos', [forbidden]: 'secret' }, fileStore }),
    /key-based|connection string/i,
    `${forbidden} is rejected on the production Cosmos path`,
  );
}

const factoryEvents: string[] = [];
const factoryContainer = new MemoryCosmosPort();
const cosmosStore = await createRuntimeStore({
  env: {
    TEAMS_STORAGE_BACKEND: 'cosmos',
    AZURE_COSMOS_ENDPOINT: 'https://runtime.documents.azure.com:443/',
    AZURE_COSMOS_DATABASE: 'teams-runtime',
    AZURE_COSMOS_CONTAINER: 'records',
  },
  fileStore,
  createDefaultAzureCredential: () => {
    factoryEvents.push('DefaultAzureCredential');
    return { credential: 'fixture' } as never;
  },
  createCosmosContainer: ({ endpoint, databaseId, containerId, credential }) => {
    factoryEvents.push(`${endpoint}|${databaseId}|${containerId}|${String(Boolean(credential))}`);
    return factoryContainer;
  },
});
assert.ok(cosmosStore instanceof CosmosRuntimeStore, 'explicit cosmos selection constructs the Cosmos adapter');
assert.deepEqual(factoryEvents, [
  'DefaultAzureCredential',
  'https://runtime.documents.azure.com:443/|teams-runtime|records|true',
], 'Cosmos uses DefaultAzureCredential and the configured resource path');

await assert.rejects(
  () => createRuntimeStore({ env: { TEAMS_STORAGE_BACKEND: 'unknown' }, fileStore }),
  /unsupported storage backend/i,
);

console.log('PASS: Azure runtime store enforces scoped, bounded, idempotent Cosmos persistence with ETag CAS and RBAC-only construction');
