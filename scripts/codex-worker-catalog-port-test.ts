import assert from 'node:assert/strict';

import { parseCodexModelCatalogPayload } from '../src/server/codex-model-catalog.js';
import {
  CODEX_WORKER_CATALOG_ID,
  CODEX_WORKER_CATALOG_SCOPE,
  createRuntimeStoreCodexWorkerCatalogPort,
} from '../src/server/storage/codex-worker-catalog-port.js';
import {
  RuntimeStoreConflictError,
  type RuntimeRecord,
  type RuntimeScope,
  type RuntimeStore,
  type RuntimeWrite,
} from '../src/server/storage/runtime-store.js';

const catalog = parseCodexModelCatalogPayload({
  models: [{
    slug: 'gpt-5.6-sol',
    display_name: 'GPT-5.6-Sol',
    visibility: 'list',
    default_reasoning_level: 'high',
    supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }],
  }],
}, '2026-09-05T06:00:00.000Z');

class MemoryRuntimeStore implements RuntimeStore {
  record: RuntimeRecord | null = null;
  scopes: RuntimeScope[] = [];
  writes = 0;

  async read<T>(scope: RuntimeScope, id: string): Promise<RuntimeRecord<T> | null> {
    this.scopes.push({ ...scope });
    assert.equal(id, CODEX_WORKER_CATALOG_ID);
    return this.record ? structuredClone(this.record) as RuntimeRecord<T> : null;
  }

  async list<T>(): Promise<Array<RuntimeRecord<T>>> {
    return [];
  }

  async write<T>(scope: RuntimeScope, input: RuntimeWrite<T>): Promise<RuntimeRecord<T>> {
    this.scopes.push({ ...scope });
    assert.equal(input.id, CODEX_WORKER_CATALOG_ID);
    if (this.record && input.expectedEtag !== this.record.etag) throw new RuntimeStoreConflictError('stale ETag');
    if (!this.record && input.expectedEtag) throw new RuntimeStoreConflictError('missing record');
    const now = '2026-09-05T06:00:01.000Z';
    const next: RuntimeRecord<T> = {
      id: input.id,
      value: structuredClone(input.value),
      etag: `etag-${++this.writes}`,
      createdAt: this.record?.createdAt ?? now,
      updatedAt: now,
    };
    this.record = structuredClone(next) as RuntimeRecord;
    return structuredClone(next);
  }
}

const store = new MemoryRuntimeStore();
const port = createRuntimeStoreCodexWorkerCatalogPort(store);
assert.equal(await port.read(), undefined, 'an unobserved worker catalog remains unavailable');
assert.deepEqual(await port.publish(catalog), catalog);
assert.deepEqual(await port.read(), catalog, 'ACA reads the exact durable catalog published by the worker');
assert.ok(
  store.scopes.every((scope) => JSON.stringify(scope) === JSON.stringify(CODEX_WORKER_CATALOG_SCOPE)),
  'the catalog is isolated in one server-owned system scope',
);

store.record = {
  ...store.record!,
  value: { ...catalog, revision: '0'.repeat(64) },
};
await assert.rejects(port.read(), /revision|catalog/i, 'tampered durable catalog data fails closed');

console.log('codex-worker-catalog-port-test: PASS');
