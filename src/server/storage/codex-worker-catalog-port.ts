import type { CoreCodexModelCatalog } from '../../shared/core-orchestration.js';
import { assertCoreCodexModelCatalog } from '../codex-model-catalog.js';
import {
  RuntimeStoreConflictError,
  type RuntimeScope,
  type RuntimeStore,
} from './runtime-store.js';

export const CODEX_WORKER_CATALOG_SCOPE: RuntimeScope = Object.freeze({
  tenantId: 'teams-core-system',
  requesterId: 'codex-worker',
  conversationId: 'model-catalog',
});
export const CODEX_WORKER_CATALOG_ID = 'installed-codex-model-catalog' as const;

export interface CodexWorkerCatalogPort {
  publish(catalog: CoreCodexModelCatalog): Promise<CoreCodexModelCatalog>;
  read(): Promise<CoreCodexModelCatalog | undefined>;
}

/** Shared Cosmos-backed handoff: the Linux worker observes; ACA only reads. */
export function createRuntimeStoreCodexWorkerCatalogPort(
  runtimeStore: RuntimeStore,
): CodexWorkerCatalogPort {
  const read = async (): Promise<CoreCodexModelCatalog | undefined> => {
    const record = await runtimeStore.read<CoreCodexModelCatalog>(
      CODEX_WORKER_CATALOG_SCOPE,
      CODEX_WORKER_CATALOG_ID,
    );
    return record ? assertCoreCodexModelCatalog(record.value) : undefined;
  };

  return Object.freeze({
    read,
    async publish(input: CoreCodexModelCatalog) {
      const catalog = assertCoreCodexModelCatalog(input);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const current = await runtimeStore.read<CoreCodexModelCatalog>(
          CODEX_WORKER_CATALOG_SCOPE,
          CODEX_WORKER_CATALOG_ID,
        );
        if (current) {
          const existing = assertCoreCodexModelCatalog(current.value);
          const existingObservedAt = Date.parse(existing.observedAt);
          const nextObservedAt = Date.parse(catalog.observedAt);
          if (existingObservedAt > nextObservedAt) return existing;
          if (existingObservedAt === nextObservedAt) {
            if (existing.revision !== catalog.revision) {
              throw new Error('Codex worker catalogs conflict at the same observation time.');
            }
            return existing;
          }
        }
        try {
          const written = await runtimeStore.write<CoreCodexModelCatalog>(CODEX_WORKER_CATALOG_SCOPE, {
            id: CODEX_WORKER_CATALOG_ID,
            idempotencyKey: `codex-worker-catalog:${catalog.revision}:${catalog.observedAt}`,
            value: catalog,
            ...(current ? { expectedEtag: current.etag } : {}),
          });
          return assertCoreCodexModelCatalog(written.value);
        } catch (error) {
          if (!(error instanceof RuntimeStoreConflictError) || attempt === 3) throw error;
        }
      }
      throw new Error('Codex worker catalog could not be published after bounded retries.');
    },
  });
}
