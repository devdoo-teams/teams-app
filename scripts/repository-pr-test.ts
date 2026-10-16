import assert from 'node:assert/strict';
import test from 'node:test';
import { RepositoryPrService, publicRepository } from '../src/server/repository-pr.js';
import { createRepositoryPrFixture as fixture, repoFixtureOwner as owner, repoFixtureRecord as record, repoFixtureBaseUrl as baseUrl } from './fixtures/repository-pr-fixture.js';
import { RepositoryDescriptorSchema, RepositoryPrRequestSchema } from '../src/shared/repository-pr.js';

test('actual mock DC multi-repository read pins revisions and canonical verified links', async () => {
  const f = await fixture();
  try {
    const catalog = await f.service.catalog(owner);
    assert.equal(catalog.repositories.length, 2);
    const result = await f.service.query(owner, { repositoryIds: ['alpha', 'beta'], category: 'mine', catalogRevision: catalog.revision });
    assert.deepEqual(result.batches.map(v => v.repository.id), ['alpha', 'beta']);
    assert.equal(result.batches[0].items.length, 1);
    const item = result.batches[0].items[0];
    assert.equal(item.version, 3); assert.equal(item.sourceCommit, 'a'.repeat(40)); assert.equal(item.targetCommit, 'b'.repeat(40));
    assert.equal(item.source.webUrl, `${baseUrl}/projects/TEST/repos/alpha/pull-requests/1/overview`);
    assert.equal(item.source.linkVerification, 'api-identity'); assert.match(result.revision, /^[0-9a-f]{64}$/);
    assert.ok(f.requests.every(r => r.method === 'GET' && r.user === owner.requesterId));
    assert.ok(f.requests.some(r => r.path.includes('role.1=AUTHOR') && r.path.includes('username.1=fixture-owner')));
  } finally { await f.close(); }
});

test('review and merged filters remain deterministic, bounded and page-aware', async () => {
  const f = await fixture();
  try {
    const catalog = await f.service.catalog(owner);
    const review = await f.service.query(owner, { repositoryIds: ['alpha'], category: 'review', catalogRevision: catalog.revision });
    assert.equal(review.batches[0].items.length, 1, 'own authored PR is not a review request');
    assert.ok(f.requests.some(r => r.path.includes('role.1=REVIEWER') && r.path.includes('approved.1=false')));
    const merged = await f.service.query(owner, { repositoryIds: ['alpha'], category: 'merged', catalogRevision: catalog.revision });
    assert.deepEqual(merged.batches[0].items.map(i => i.id), [2, 1]);
    f.payload = { start: 20, isLastPage: false, nextPageStart: 37, values: [record()] };
    const next = await f.service.query(owner, { repositoryIds: ['alpha'], category: 'mine', catalogRevision: catalog.revision, starts: { alpha: 20 } });
    assert.equal(next.batches[0].nextStart, 37); assert.equal(next.batches[0].start, 20);
  } finally { await f.close(); }
});

test('the mock DC transport independently refuses a foreign requester or tenant', async () => {
  const f = await fixture();
  try {
    for (const foreign of [{ ...owner, requesterId: 'foreign' }, { ...owner, tenantId: 'foreign' }]) {
      await assert.rejects(f.adapter.read(publicRepository(f.repositories[0]), { ...foreign, repositoryId: 'alpha', revision: 'acl-1',
        user: { id: 7, name: 'fixture-owner' } }, 'mine', 0), { code: 'FORBIDDEN' });
    }
  } finally { await f.close(); }
});

test('owner, tenant, selection and stale catalog checks precede any provider read', async () => {
  const f = await fixture();
  try {
    const catalog = await f.service.catalog(owner); const request = { repositoryIds: ['alpha'], category: 'mine', catalogRevision: catalog.revision };
    for (const principal of [{ ...owner, requesterId: 'other' }, { ...owner, tenantId: 'other' }]) {
      assert.equal((await f.service.catalog(principal)).repositories.length, 0);
      await assert.rejects(f.service.query(principal, request));
    }
    for (const invalid of [{ ...request, repositoryIds: ['missing'] }, { ...request, repositoryIds: ['alpha', 'alpha'] },
      { ...request, catalogRevision: 'f'.repeat(64) }, { ...request, tenantId: owner.tenantId },
      { ...request, starts: { beta: 5 } }, { ...request, starts: { alpha: -1 } },
      { ...request, repositoryIds: ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'] }]) await assert.rejects(f.service.query(owner, invalid));
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test('revocation during a delayed real HTTP result prevents all publication', async () => {
  const f = await fixture();
  try {
    const catalog = await f.service.catalog(owner); f.delay = 20;
    const pending = f.service.query(owner, { repositoryIds: ['alpha'], category: 'mine', catalogRevision: catalog.revision });
    const deadline = Date.now() + 1000;
    while (!f.requests.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(f.requests.length); f.revoke(); await assert.rejects(pending);
  } finally { await f.close(); }
});

test('a policy revision change during real provider I/O invalidates the full snapshot', async () => {
  const f = await fixture();
  try {
    const catalog = await f.service.catalog(owner); f.delay = 20;
    const pending = f.service.query(owner, { repositoryIds: ['alpha', 'beta'], category: 'mine', catalogRevision: catalog.revision });
    const deadline = Date.now() + 1000;
    while (!f.requests.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(f.requests.length); f.revision = 'acl-2'; await assert.rejects(pending, { code: 'STALE_CATALOG' });
  } finally { await f.close(); }
});

test('malformed provider identity/revision/page and redirects fail closed', async () => {
  const f = await fixture();
  try {
    const catalog = await f.service.catalog(owner); const request = { repositoryIds: ['alpha'], category: 'mine', catalogRevision: catalog.revision };
    for (const value of [{ ...record(), toRef: record('beta').toRef }, { ...record(), fromRef: { latestCommit: 'short' } },
      { ...record(), version: -1 }, { ...record(), state: 'DECLINED' }]) {
      f.payload = { start: 0, isLastPage: true, values: [value] }; await assert.rejects(f.service.query(owner, request));
    }
    f.payload = { start: 0, isLastPage: false, nextPageStart: 0, values: [] }; await assert.rejects(f.service.query(owner, request));
    f.payload = undefined; f.status = 302; await assert.rejects(f.service.query(owner, request));
    f.status = 403; await assert.rejects(f.service.query(owner, request));
    f.status = 200; f.oversized = true; await assert.rejects(f.service.query(owner, request));
  } finally { await f.close(); }
});

test('missing or foreign provider web links never become a verified invented URL', async () => {
  const f = await fixture();
  try {
    const catalog = await f.service.catalog(owner);
    for (const links of [undefined, { self: [{ href: 'https://evil.invalid/forged' }] },
      { self: [{ href: `${baseUrl}/projects/TEST/repos/beta/pull-requests/1/overview` }] }]) {
      f.payload = { start: 0, isLastPage: true, values: [{ ...record(), links }] };
      const value = await f.service.query(owner, { repositoryIds: ['alpha'], category: 'mine', catalogRevision: catalog.revision });
      assert.equal(value.batches[0].items[0].source.webUrl, undefined);
      assert.equal(value.batches[0].items[0].source.linkVerification, 'unverified');
    }
  } finally { await f.close(); }
});

test('timeouts/cancellation are bounded and unconfigured production has no invented repositories', async () => {
  const f = await fixture();
  try {
    const catalog = await f.service.catalog(owner); f.delay = 200;
    await assert.rejects(f.service.query(owner, { repositoryIds: ['alpha'], category: 'mine', catalogRevision: catalog.revision }));
    const controller = new AbortController(); controller.abort(); await assert.rejects(f.service.query(owner, {
      repositoryIds: ['alpha'], category: 'mine', catalogRevision: catalog.revision }, controller.signal));
    const empty = new RepositoryPrService({ repositories: [], authorize: async () => undefined });
    assert.equal((await empty.catalog(owner)).connection, 'not-configured');
    await assert.rejects(empty.query(owner, { repositoryIds: ['alpha'], category: 'mine', catalogRevision: catalog.revision }));
  } finally { await f.close(); }
});

test('allowed Object prototype names use only own page offsets and unsafe IDs remain rejected', async () => {
  const f = await fixture();
  try {
    for (const id of ['toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString']) {
      const service = new RepositoryPrService({ mode: 'fixture', repositories: [{ ...f.repositories[0], id }],
        authorize: async (scope, repo) => ({ ...scope, repositoryId: repo.id, revision: 'acl-1', user: { id: 7, name: 'fixture-owner' } }) });
      const catalog = await service.catalog(owner);
      const request = { repositoryIds: [id], category: 'mine', catalogRevision: catalog.revision };
      for (const starts of [undefined, {}]) {
        const result = await service.query(owner, { ...request, starts });
        assert.equal(result.batches[0].start, 0); assert.equal(result.batches[0].items.length, 1);
      }
      f.payload = { start: 20, isLastPage: true, values: [record()] };
      assert.equal((await service.query(owner, { ...request, starts: { [id]: 20 } })).batches[0].start, 20);
      f.payload = undefined;
    }
    for (const id of ['constructor', 'prototype', '__proto__']) {
      assert.equal(RepositoryDescriptorSchema.safeParse({ ...publicRepository(f.repositories[0]), id }).success, false);
      const request = { repositoryIds: [id], category: 'mine', catalogRevision: 'a'.repeat(64) };
      assert.equal(RepositoryPrRequestSchema.safeParse(request).success, false);
      assert.equal(RepositoryPrRequestSchema.safeParse({ ...request, repositoryIds: ['alpha'], starts: JSON.parse(`{"${id}":20}`) }).success, false);
    }
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  } finally { await f.close(); }
});
