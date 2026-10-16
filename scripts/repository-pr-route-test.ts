import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import http from 'node:http';
import { createUserAuthMiddleware } from '../src/server/user-auth.js';
import { mountRepositoryPrRoutes } from '../src/server/repository-pr-route.js';
import { createRepositoryPrFixture, repoFixtureOwner as owner } from './fixtures/repository-pr-fixture.js';

test('real auth-first owner routes isolate catalog/query and redact provider failures', async () => {
  const f = await createRepositoryPrFixture(); const app = express();
  mountRepositoryPrRoutes(app, { service: f.service, authenticate: createUserAuthMiddleware({ allowUnauthenticated: false,
    acceptedAudiences: ['fixture-audience'], configuredTenantId: owner.tenantId, logger: { warn() {} },
    validator: { async validateAccessToken(token) { return token === 'synthetic-fixture' ? {
      aud: 'fixture-audience', scp: 'access_as_user', tid: owner.tenantId, oid: owner.requesterId } : null; } } }),
    resolvePrincipal: (_req, res) => res.locals.user ? { tenantId: res.locals.user.tid, requesterId: res.locals.user.requesterId } : undefined });
  const server = http.createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const headers = { Authorization: 'Bearer synthetic-fixture', 'content-type': 'application/json' };
  try {
    const denied = await fetch(`${origin}/api/repository-pr/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{broken' });
    assert.equal(denied.status, 401); assert.equal(denied.headers.get('cache-control'), 'no-store');
    const response = await fetch(`${origin}/api/repository-pr/catalog`, { headers }); const catalog = await response.json();
    assert.equal(response.status, 200); assert.equal(catalog.repositories.length, 2);
    const request = { repositoryIds: ['alpha', 'beta'], category: 'mine', catalogRevision: catalog.revision };
    const read = await fetch(`${origin}/api/repository-pr/query`, { method: 'POST', headers, body: JSON.stringify(request) });
    assert.equal(read.status, 200); const result = await read.json(); assert.equal(result.batches.length, 2);
    for (const body of [{ ...request, requesterId: 'other' }, { ...request, baseUrl: 'https://evil.invalid' }, { ...request, repositoryIds: ['unknown'] }]) {
      const r = await fetch(`${origin}/api/repository-pr/query`, { method: 'POST', headers, body: JSON.stringify(body) }); assert.ok([400, 403].includes(r.status));
    }
    f.status = 403;
    const failure = await fetch(`${origin}/api/repository-pr/query`, { method: 'POST', headers, body: JSON.stringify(request) });
    assert.equal(failure.status, 403); assert.doesNotMatch(await failure.text(), /fixture-owner|dc\.fixture|Bearer|stack/);
    const large = await fetch(`${origin}/api/repository-pr/query`, { method: 'POST', headers, body: JSON.stringify({ value: 'x'.repeat(9000) }) });
    assert.equal(large.status, 413);
    const queryIdentity = await fetch(`${origin}/api/repository-pr/catalog?tenantId=forged`, { headers }); assert.equal(queryIdentity.status, 400);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await f.close(); }
});
