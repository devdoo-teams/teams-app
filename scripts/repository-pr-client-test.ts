import assert from 'node:assert/strict';
import test from 'node:test';
import { createRepositoryPrClient, createRepositoryQueryController } from '../src/client/repository-pr-client.js';
import { createRepositoryPrFixture, repoFixtureOwner as owner } from './fixtures/repository-pr-fixture.js';
import { RepositoryPrService } from '../src/server/repository-pr.js';

test('client validates scope, selected repositories and immutable response identities', async () => {
  const f = await createRepositoryPrFixture();
  try {
    const catalog = await f.service.catalog(owner); const request = { repositoryIds: ['alpha'], category: 'mine' as const, catalogRevision: catalog.revision };
    const snapshot = await f.service.query(owner, request); let body: unknown = snapshot;
    const client = createRepositoryPrClient(async () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } }));
    assert.equal((await client.query(catalog, request)).revision, snapshot.revision);
    for (const invalid of [{ ...snapshot, revision: 'f'.repeat(64) }, { ...snapshot, scopeKey: 'f'.repeat(64) }, { ...snapshot, category: 'review' },
      { ...snapshot, repositoryIds: ['beta'] }, { ...snapshot, batches: [{ ...snapshot.batches[0], items: [{ ...snapshot.batches[0].items[0],
        source: { ...snapshot.batches[0].items[0].source, webUrl: 'https://evil.invalid/forged' } }] }] }]) {
      body = invalid; await assert.rejects(client.query(catalog, request));
    }
  } finally { await f.close(); }
});

test('selection generations reject abort-ignoring late values and duplicate clicks share one read', async () => {
  const f = await createRepositoryPrFixture();
  try {
    const catalog = await f.service.catalog(owner); const alpha = { repositoryIds: ['alpha'], category: 'mine' as const, catalogRevision: catalog.revision };
    const beta = { ...alpha, repositoryIds: ['beta'] }; const values = [await f.service.query(owner, alpha), await f.service.query(owner, beta)];
    const resolve: Array<(value: typeof values[0]) => void> = []; let calls = 0; const seen: string[] = [];
    const controller = createRepositoryQueryController({ async catalog() { return catalog; }, query() { calls++; return new Promise(done => resolve.push(done)); } });
    const a = controller.run(catalog, alpha, { success: value => seen.push(value.repositoryIds[0]) });
    const duplicate = controller.run(catalog, alpha, { success: value => seen.push(value.repositoryIds[0]) }); assert.equal(calls, 1);
    const b = controller.run(catalog, beta, { success: value => seen.push(value.repositoryIds[0]) });
    resolve[1](values[1]); await b; resolve[0](values[0]); await Promise.all([a, duplicate]); assert.deepEqual(seen, ['beta']);
    const late = controller.run(catalog, alpha, { success: () => seen.push('closed') }); controller.reset(); resolve[2](values[0]); await late;
    assert.deepEqual(seen, ['beta']);
  } finally { await f.close(); }
});

test('client accepts an omitted own offset for a valid toString repository ID', async () => {
  const f = await createRepositoryPrFixture();
  try {
    const service = new RepositoryPrService({ mode: 'fixture', repositories: [{ ...f.repositories[0], id: 'toString' }],
      authorize: async (scope, repo) => ({ ...scope, repositoryId: repo.id, revision: 'acl-1', user: { id: 7, name: 'fixture-owner' } }) });
    const catalog = await service.catalog(owner);
    const request = { repositoryIds: ['toString'], category: 'mine' as const, catalogRevision: catalog.revision };
    const snapshot = await service.query(owner, request);
    const client = createRepositoryPrClient(async () => Response.json(snapshot));
    assert.equal((await client.query(catalog, { ...request, starts: {} })).batches[0].start, 0);
  } finally { await f.close(); }
});
