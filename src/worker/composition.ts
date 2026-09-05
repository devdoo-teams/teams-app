import type { RuntimeStore } from '../server/storage/runtime-store.js';
import { createRuntimeStore } from '../server/storage/runtime-store-factory.js';
import {
  createRuntimeStoreAgentDispatchStatePort,
  createRuntimeStoreLegacyDispatchMigration,
} from '../server/storage/agent-dispatch-state-port.js';
import type { AgentDispatchStatePort } from '../server/azure-agent-dispatch-queue.js';
import type { WorkerExecutionPort } from './index.js';
import { createWorkerExecutor } from './executor.js';
import { createRuntimeStoreCodexWorkerCatalogPort } from '../server/storage/codex-worker-catalog-port.js';

const unavailableFileStore: RuntimeStore = {
  read: async () => { throw new Error('Production worker requires Cosmos runtime storage.'); },
  list: async () => { throw new Error('Production worker requires Cosmos runtime storage.'); },
  write: async () => { throw new Error('Production worker requires Cosmos runtime storage.'); },
};

const runtimeStore = await createRuntimeStore({ env: process.env, fileStore: unavailableFileStore });

export const state: AgentDispatchStatePort = createRuntimeStoreAgentDispatchStatePort(runtimeStore);
export const legacyMigration = createRuntimeStoreLegacyDispatchMigration(runtimeStore);
export const modelCatalog = createRuntimeStoreCodexWorkerCatalogPort(runtimeStore);

export const executor: WorkerExecutionPort = createWorkerExecutor({ env: process.env });
