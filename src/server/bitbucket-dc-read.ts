import { z } from 'zod';
import { RepositoryDescriptorSchema, RepositoryGrantSchema, RepositoryPrBatchSchema, RepositoryPrCategorySchema, repositoryPrUrls,
  type RepositoryDescriptor, type RepositoryGrant, type RepositoryPrCategory, type RepositoryPrBatch } from '../shared/repository-pr.js';
import { boundedRepositoryRead, RepositoryPrError, type RepositoryReadAdapter } from './repository-pr.js';

const user = z.object({ id: z.number().int().positive() });
const remoteRepo = z.object({ id: z.number().int().positive(), slug: z.string(), project: z.object({ key: z.string() }) });
const timestamp = z.number().int().min(0).max(8_640_000_000_000_000);
const row = z.object({ id: z.number().int().positive(), version: z.number().int().nonnegative(), title: z.string().min(1).max(300),
  state: z.enum(['OPEN', 'MERGED']), author: z.object({ user }), reviewers: z.array(z.object({ user, approved: z.boolean(),
    status: z.enum(['UNAPPROVED', 'APPROVED', 'NEEDS_WORK']) })).max(100),
  fromRef: z.object({ latestCommit: z.string().regex(/^[a-f0-9]{40}$/u) }),
  toRef: z.object({ latestCommit: z.string().regex(/^[a-f0-9]{40}$/u), repository: remoteRepo }),
  updatedDate: timestamp, closedDate: timestamp.optional() });
const page = z.object({ start: z.number().int().min(0).max(1_000_000), isLastPage: z.boolean(),
  nextPageStart: z.number().int().min(1).max(1_000_000).optional(), values: z.array(row).max(20) });

/** Explicit principal-bound transport. No credentials, Cloud API reuse or env activation. */
export class BitbucketDcReadAdapter implements RepositoryReadAdapter {
  constructor(private readonly options: Readonly<{ timeoutMs?: number;
    request: (grant: RepositoryGrant, url: string, init: RequestInit) => Promise<Response> }>) {}
  async read(repository: RepositoryDescriptor, grant: RepositoryGrant, category: RepositoryPrCategory,
    start: number, signal?: AbortSignal): Promise<RepositoryPrBatch> {
    const repo = RepositoryDescriptorSchema.parse(repository); const parsedAccess = RepositoryGrantSchema.parse(grant);
    const access = Object.freeze({ ...parsedAccess, user: Object.freeze(parsedAccess.user) });
    RepositoryPrCategorySchema.parse(category);
    if (access.repositoryId !== repo.id || !Number.isSafeInteger(start) || start < 0 || start > 1_000_000) throw new RepositoryPrError('INVALID_REQUEST', 400);
    return boundedRepositoryRead(async s => {
      const repositoryPath = `${repo.baseUrl}/rest/api/latest/projects/${encodeURIComponent(repo.projectKey)}/repos/${encodeURIComponent(repo.slug)}`;
      const actual = remoteRepo.parse(await this.get(access, repositoryPath, s));
      if (actual.id !== repo.remoteId || actual.slug !== repo.slug || actual.project.key !== repo.projectKey) throw new RepositoryPrError('UNAVAILABLE', 502);
      const query = new URLSearchParams({ direction: 'INCOMING', state: category === 'merged' ? 'MERGED' : 'OPEN',
        order: 'NEWEST', limit: '20', start: String(start), withAttributes: 'false', withProperties: 'false' });
      if (category !== 'merged') {
        query.set('username.1', access.user.name); query.set('role.1', category === 'mine' ? 'AUTHOR' : 'REVIEWER');
        if (category === 'review') query.set('approved.1', 'false');
      }
      const result = page.parse(await this.get(access, `${repositoryPath}/pull-requests?${query}`, s));
      if (result.start !== start || !result.isLastPage && (result.nextPageStart === undefined || result.nextPageStart <= start)) throw new RepositoryPrError('UNAVAILABLE', 502);
      const observedAt = new Date().toISOString();
      const items = result.values.flatMap(value => {
        const target = value.toRef.repository;
        if (target.id !== repo.remoteId || target.slug !== repo.slug || target.project.key !== repo.projectKey
          || value.state !== (category === 'merged' ? 'MERGED' : 'OPEN') || value.state === 'MERGED' && value.closedDate === undefined) throw new RepositoryPrError('UNAVAILABLE', 502);
        const mine = value.author.user.id === access.user.id;
        const review = !mine && value.reviewers.some(r => r.user.id === access.user.id && !r.approved && r.status !== 'APPROVED');
        if (category === 'mine' && !mine || category === 'review' && !review) return [];
        return [{ repositoryId: repo.id, id: value.id, version: value.version, title: value.title, state: value.state,
          sourceCommit: value.fromRef.latestCommit, targetCommit: value.toRef.latestCommit,
          updatedAt: new Date(value.updatedDate).toISOString(), ...(value.closedDate === undefined ? {} : { closedAt: new Date(value.closedDate).toISOString() }),
          source: { ...repositoryPrUrls(repo, value.id), linkVerification: 'api-identity' as const,
            contract: 'bitbucket-dc-rest-10.5' as const, observedAt } }];
      });
      if (category === 'merged') items.sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? '') || b.id - a.id);
      return RepositoryPrBatchSchema.parse({ repository: repo, items, start,
        ...(!result.isLastPage ? { nextStart: result.nextPageStart } : {}) });
    }, signal, this.options.timeoutMs ?? 6000);
  }
  private async get(access: RepositoryGrant, url: string, signal: AbortSignal): Promise<unknown> {
    try {
      const response = await this.options.request(access, url, { method: 'GET', redirect: 'error', signal,
        headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok || response.redirected) throw new RepositoryPrError(response.status === 401 || response.status === 403 ? 'FORBIDDEN' : 'UNAVAILABLE', response.status === 401 || response.status === 403 ? 403 : 502);
      if (!response.body || Number(response.headers.get('content-length')) > 256_000) throw new RepositoryPrError('UNAVAILABLE', 502);
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      try {
        while (true) {
          const next = await reader.read(); if (next.done) break;
          size += next.value.byteLength;
          if (size > 256_000 || signal.aborted) { await reader.cancel(); throw new RepositoryPrError('UNAVAILABLE', 502); }
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
      const all = new Uint8Array(size); let offset = 0;
      for (const c of chunks) { all.set(c, offset); offset += c.length; }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all));
    } catch (error) {
      if (error instanceof RepositoryPrError) throw error;
      throw new RepositoryPrError('UNAVAILABLE', 502);
    }
  }
}
