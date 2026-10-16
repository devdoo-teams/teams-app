import { apiFetch, readApiResponseJson } from './auth.js';
import { createLatestDetailRequestController } from './latest-detail-request.js';
import { RepositoryCatalogSchema, RepositoryPrRequestSchema, RepositoryPrSnapshotSchema, repositoryPrSnapshotContent, repositoryPrStart,
  type RepositoryCatalog, type RepositoryPrRequest, type RepositoryPrSnapshot } from '../shared/repository-pr.js';

type ApiFetch = (input: string, init?: RequestInit) => Promise<Response>;
export class RepositoryPrClientError extends Error {
  constructor(readonly code: string, readonly status = 502) { super(code); this.name = 'RepositoryPrClientError'; }
}
export type RepositoryPrClient = Readonly<{ catalog(signal?: AbortSignal): Promise<RepositoryCatalog>;
  query(catalog: RepositoryCatalog, request: RepositoryPrRequest, signal?: AbortSignal): Promise<RepositoryPrSnapshot> }>;
export function createRepositoryPrClient(fetcher: ApiFetch = apiFetch): RepositoryPrClient {
  async function read(path: string, init: RequestInit) {
    const response = await fetcher(`/api/repository-pr/${path}`, { ...init, cache: 'no-store' });
    if (!response.ok) {
      const code = response.status === 401 ? 'AUTH_REQUIRED' : response.status === 403 ? 'FORBIDDEN'
        : response.status === 409 ? 'STALE_CATALOG' : response.status === 503 ? 'NOT_CONFIGURED' : 'UNAVAILABLE';
      throw new RepositoryPrClientError(code, response.status);
    }
    return readApiResponseJson(response);
  }
  return {
    async catalog(signal) { return RepositoryCatalogSchema.parse(await read('catalog', { signal })); },
    async query(catalog, input, signal) {
      const request = RepositoryPrRequestSchema.parse(input);
      if (request.catalogRevision !== catalog.revision) throw new RepositoryPrClientError('STALE_CATALOG', 409);
      const result = RepositoryPrSnapshotSchema.parse(await read('query', { method: 'POST', signal,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) }));
      const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(repositoryPrSnapshotContent(result)));
      const revision = Array.from(new Uint8Array(bytes), v => v.toString(16).padStart(2, '0')).join('');
      if (revision !== result.revision) throw new RepositoryPrClientError('UNAVAILABLE');
      if (result.scopeKey !== catalog.scopeKey || result.catalogRevision !== catalog.revision || result.category !== request.category
        || JSON.stringify(result.repositoryIds) !== JSON.stringify(request.repositoryIds)
        || result.batches.some(b => b.start !== repositoryPrStart(request.starts, b.repository.id)
          || JSON.stringify(b.repository) !== JSON.stringify(catalog.repositories.find(r => r.id === b.repository.id))
          || b.items.some(i => i.state !== (request.category === 'merged' ? 'MERGED' : 'OPEN')))) throw new RepositoryPrClientError('UNAVAILABLE');
      return result;
    },
  };
}
export function createRepositoryQueryController(client: RepositoryPrClient) {
  const latest = createLatestDetailRequestController();
  let active: { key: string; done: Promise<void> } | undefined;
  return {
    run(catalog: RepositoryCatalog, request: RepositoryPrRequest, handlers: {
      success(value: RepositoryPrSnapshot): void; error?(error: unknown): void; settled?(): void;
    }): Promise<void> {
      const key = JSON.stringify([catalog.scopeKey, request]);
      if (active?.key === key) return active.done;
      const operation = { key, done: Promise.resolve() };
      operation.done = latest.request(signal => client.query(catalog, request, signal), handlers)
        .finally(() => { if (active === operation) active = undefined; });
      active = operation; return operation.done;
    },
    reset() { active = undefined; latest.dispose(); },
  };
}
