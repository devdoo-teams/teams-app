import assert from 'node:assert/strict';
import http from 'node:http';
import { RepositoryPrService, type RepositoryDefinition, type RepositoryGrant } from '../../src/server/repository-pr.js';
import { BitbucketDcReadAdapter } from '../../src/server/bitbucket-dc-read.js';

export const repoFixtureOwner = { tenantId: 'fixture-tenant', requesterId: 'fixture-owner' };
export const repoFixtureBaseUrl = 'https://dc.fixture.test/bitbucket';
const repoNames = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];
const grant = (id: string): RepositoryGrant => ({ ...repoFixtureOwner, repositoryId: id, revision: 'acl-1', user: { id: 7, name: 'fixture-owner' } });
export function repoFixtureRecord(repo = 'alpha', id = 1, author = 7, merged = false) {
  return { id, version: 3, title: `합성 ${repo} PR ${id} <script>`, state: merged ? 'MERGED' : 'OPEN',
    author: { user: { id: author, name: 'fixture-author' } },
    reviewers: [{ user: { id: 7 }, approved: false, status: 'UNAPPROVED' }],
    fromRef: { latestCommit: 'a'.repeat(40) },
    toRef: { latestCommit: 'b'.repeat(40), repository: { id: 11 + repoNames.indexOf(repo), slug: repo, project: { key: 'TEST' } } },
    updatedDate: 1792195200000, ...(merged ? { closedDate: 1792195100000 + id } : {}),
    links: { self: [{ href: `${repoFixtureBaseUrl}/projects/TEST/repos/${repo}/pull-requests/${id}/overview` }] } };
}

export async function createRepositoryPrFixture(repositoryCount = 2, timeoutMs = 100) {
  const requests: Array<{ path: string; method: string; user?: string }> = [];
  let payload: unknown, delayMs = 0, status = 200, oversized = false, revoked = false, paging = false, aclRevision = 'acl-1';
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://fixture');
    requests.push({ path: req.url!, method: req.method!, user: req.headers['x-fixture-owner'] as string });
    if (req.headers['x-fixture-owner'] !== repoFixtureOwner.requesterId || req.headers['x-fixture-tenant'] !== repoFixtureOwner.tenantId) {
      res.statusCode = 403; res.end('{}'); return;
    }
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
    res.statusCode = status; res.setHeader('content-type', 'application/json');
    if (status === 302) res.setHeader('location', 'https://evil.invalid/redirect');
    if (oversized) { res.end('x'.repeat(270000)); return; }
    if (!url.pathname.endsWith('/pull-requests')) {
      const slug = url.pathname.split('/').at(-1)!;
      res.end(JSON.stringify({ id: 11 + repoNames.indexOf(slug), slug, project: { key: 'TEST' } })); return;
    }
    const repo = url.pathname.split('/').at(-2)!;
    const merged = url.searchParams.get('state') === 'MERGED';
    const start = Number(url.searchParams.get('start') ?? 0);
    res.end(JSON.stringify(payload ?? { start, isLastPage: !paging || start >= 20, ...(!paging || start >= 20 ? {} : { nextPageStart: start + 20 }),
      values: [repoFixtureRecord(repo, 1 + start, 7, merged), repoFixtureRecord(repo, 2 + start, 8, merged)] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const adapter = new BitbucketDcReadAdapter({ timeoutMs, request: async (access, url, init) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://dc.fixture.test');
    return fetch(`http://127.0.0.1:${port}${parsed.pathname}${parsed.search}`, {
      ...init, headers: { 'x-fixture-owner': access.requesterId, 'x-fixture-tenant': access.tenantId },
    });
  } });
  const repositories: RepositoryDefinition[] = repoNames.slice(0, repositoryCount).map((id, index) => ({ id, label: `합성 ${id}`, provider: 'bitbucket-dc',
    baseUrl: repoFixtureBaseUrl, projectKey: 'TEST', slug: id, remoteId: 11 + index, adapter }));
  const service = new RepositoryPrService({ repositories, mode: 'fixture', authorize: async (principal, repo) =>
    !revoked && principal.tenantId === repoFixtureOwner.tenantId && principal.requesterId === repoFixtureOwner.requesterId ? { ...grant(repo.id), revision: aclRevision } : undefined });
  return { service, adapter, repositories, requests, set payload(v: unknown) { payload = v; }, set delay(v: number) { delayMs = v; },
    set paging(v: boolean) { paging = v; },
    set revision(v: string) { aclRevision = v; },
    set status(v: number) { status = v; }, set oversized(v: boolean) { oversized = v; }, revoke() { revoked = true; },
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
