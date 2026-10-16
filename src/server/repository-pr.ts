import crypto from 'node:crypto';
import { RepositoryCatalogSchema, RepositoryDescriptorSchema, RepositoryGrantSchema, RepositoryPrincipalSchema,
  RepositoryPrRequestSchema, RepositoryPrSnapshotSchema, repositoryPrStart, type RepositoryCatalog, type RepositoryDescriptor,
  type RepositoryGrant, type RepositoryPrincipal, type RepositoryPrBatch, type RepositoryPrCategory,
  type RepositoryPrSnapshot } from '../shared/repository-pr.js';

export type { RepositoryGrant } from '../shared/repository-pr.js';
export type RepositoryReadAdapter = Readonly<{ read(repository: RepositoryDescriptor, grant: RepositoryGrant,
  category: RepositoryPrCategory, start: number, signal?: AbortSignal): Promise<RepositoryPrBatch> }>;
export type RepositoryDefinition = RepositoryDescriptor & Readonly<{ adapter: RepositoryReadAdapter }>;
export class RepositoryPrError extends Error {
  constructor(readonly code: 'INVALID_REQUEST' | 'AUTH_REQUIRED' | 'FORBIDDEN' | 'STALE_CATALOG' | 'NOT_CONFIGURED' | 'UNAVAILABLE' | 'TIMEOUT' | 'CANCELLED', readonly status: number) {
    super(code); this.name = 'RepositoryPrError';
  }
}
export async function boundedRepositoryRead<T>(work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, timeoutMs = 10_000): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15_000) throw new RepositoryPrError('INVALID_REQUEST', 400);
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  let stop!: (reason: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => { stop = reject; });
  const cancel = (reason: RepositoryPrError) => { controller.abort(reason); stop(reason); };
  const onAbort = () => cancel(new RepositoryPrError('CANCELLED', 408));
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  timer = setTimeout(() => cancel(new RepositoryPrError('TIMEOUT', 504)), timeoutMs);
  try {
    return await Promise.race([aborted, Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new RepositoryPrError('CANCELLED', 408);
      return work(controller.signal);
    })]);
  } finally { controller.abort(); clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
}
const hash = (v: unknown) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function publicRepository(repo: RepositoryDefinition): RepositoryDescriptor {
  return RepositoryDescriptorSchema.parse({ id: repo.id, label: repo.label, provider: repo.provider,
    baseUrl: repo.baseUrl, projectKey: repo.projectKey, slug: repo.slug, remoteId: repo.remoteId });
}

/** Independent deterministic reading; never delegates to AgentService or an LLM. */
export class RepositoryPrService {
  private readonly repositories: readonly RepositoryDefinition[];
  constructor(private readonly options: Readonly<{ repositories: readonly RepositoryDefinition[];
    authorize: (scope: RepositoryPrincipal, repository: RepositoryDescriptor, signal?: AbortSignal) => Promise<RepositoryGrant | undefined>;
    mode?: 'fixture' | 'unverified'; timeoutMs?: number }>) {
    if (options.repositories.length > 20 || new Set(options.repositories.map(r => r.id)).size !== options.repositories.length) throw new RepositoryPrError('INVALID_REQUEST', 400);
    this.repositories = options.repositories.map(r => Object.freeze({ ...publicRepository(r), adapter: r.adapter }));
  }
  private async loadCatalog(scope: RepositoryPrincipal, signal: AbortSignal) {
    const principal = Object.freeze(RepositoryPrincipalSchema.parse(scope));
    const allowed = await Promise.all(this.repositories.map(async repo => {
      const raw = await this.options.authorize(principal, publicRepository(repo), signal);
      if (!raw) return undefined;
      const parsedAccess = RepositoryGrantSchema.parse(raw);
      const access = Object.freeze({ ...parsedAccess, user: Object.freeze(parsedAccess.user) });
      if (access.tenantId !== principal.tenantId || access.requesterId !== principal.requesterId || access.repositoryId !== repo.id) throw new RepositoryPrError('FORBIDDEN', 403);
      return { repo, access };
    }));
    const grants = allowed.filter((v): v is NonNullable<typeof v> => v !== undefined);
    const scopeKey = hash([principal.tenantId, principal.requesterId]);
    const catalog = RepositoryCatalogSchema.parse({ scopeKey,
      revision: hash([scopeKey, grants.map(g => [publicRepository(g.repo), g.access.revision, g.access.user])]),
      connection: this.repositories.length ? this.options.mode ?? 'unverified' : 'not-configured',
      repositories: grants.map(g => publicRepository(g.repo)) });
    return { catalog, grants };
  }
  async catalog(scope: RepositoryPrincipal, signal?: AbortSignal): Promise<RepositoryCatalog> {
    return boundedRepositoryRead(async s => (await this.loadCatalog(scope, s)).catalog, signal, this.options.timeoutMs);
  }
  async query(scope: RepositoryPrincipal, input: unknown, signal?: AbortSignal): Promise<RepositoryPrSnapshot> {
    const parsed = RepositoryPrRequestSchema.safeParse(input);
    if (!parsed.success) throw new RepositoryPrError('INVALID_REQUEST', 400);
    const request = parsed.data;
    return boundedRepositoryRead(async s => {
      const before = await this.loadCatalog(scope, s);
      if (before.catalog.connection === 'not-configured') throw new RepositoryPrError('NOT_CONFIGURED', 503);
      const selected = request.repositoryIds.map(id => {
        const entry = before.grants.find(v => v.repo.id === id);
        if (!entry) throw new RepositoryPrError('FORBIDDEN', 403);
        return entry;
      });
      if (request.catalogRevision !== before.catalog.revision) throw new RepositoryPrError('STALE_CATALOG', 409);
      const batches = await Promise.all(selected.map(async ({ repo, access }) => {
        const batch = await repo.adapter.read(publicRepository(repo), access, request.category, repositoryPrStart(request.starts, repo.id), s);
        if (JSON.stringify(batch.repository) !== JSON.stringify(publicRepository(repo))) throw new RepositoryPrError('UNAVAILABLE', 502);
        return batch;
      }));
      const after = await this.loadCatalog(scope, s);
      if (selected.some(v => !after.grants.some(g => g.repo.id === v.repo.id))) throw new RepositoryPrError('FORBIDDEN', 403);
      if (before.catalog.revision !== after.catalog.revision) throw new RepositoryPrError('STALE_CATALOG', 409);
      if (s.aborted) throw new RepositoryPrError('CANCELLED', 408);
      const value = { scopeKey: before.catalog.scopeKey, catalogRevision: before.catalog.revision,
        connection: before.catalog.connection as 'fixture' | 'unverified', category: request.category,
        repositoryIds: request.repositoryIds, batches, observedAt: new Date().toISOString() };
      return RepositoryPrSnapshotSchema.parse({ ...value, revision: hash(value) });
    }, signal, this.options.timeoutMs);
  }
}
