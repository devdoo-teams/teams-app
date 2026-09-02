import crypto from 'node:crypto';

import { CodexRunner } from '../server/codex-runner.js';
import {
  RuntimeStoreConflictError,
  type RuntimeScope,
  type RuntimeStore,
} from '../server/storage/runtime-store.js';
import { createRuntimeStore } from '../server/storage/runtime-store-factory.js';
import type { AgentDispatchRecord, AgentDispatchStatePort } from '../server/azure-agent-dispatch-queue.js';
import type { AgentDispatchTask } from '../server/queue/agent-dispatch-queue.js';
import type { WorkerExecutionPort } from './index.js';

const DISPATCH_SCOPE: RuntimeScope = Object.freeze({
  tenantId: 'teams-core-system',
  requesterId: 'agent-dispatch',
  conversationId: 'global',
});

const unavailableFileStore: RuntimeStore = {
  read: async () => { throw new Error('Production worker requires Cosmos runtime storage.'); },
  list: async () => { throw new Error('Production worker requires Cosmos runtime storage.'); },
  write: async () => { throw new Error('Production worker requires Cosmos runtime storage.'); },
};

const runtimeStore = await createRuntimeStore({ env: process.env, fileStore: unavailableFileStore });

export const state: AgentDispatchStatePort = {
  async create(record) {
    try {
      await runtimeStore.write(DISPATCH_SCOPE, {
        id: record.taskId,
        idempotencyKey: `dispatch-create:${record.requestHash}`,
        value: record,
      });
      return 'created';
    } catch (error) {
      if (error instanceof RuntimeStoreConflictError) return 'exists';
      throw error;
    }
  },
  async get(taskId) {
    const record = await runtimeStore.read<AgentDispatchRecord>(DISPATCH_SCOPE, taskId);
    return record?.value;
  },
  async compareAndSwap(taskId, expected, mutate) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await runtimeStore.read<AgentDispatchRecord>(DISPATCH_SCOPE, taskId);
      if (!current) throw new Error(`No durable dispatch record exists for ${taskId}.`);
      if (current.value.leaseOwner !== expected.leaseOwner || current.value.leaseGeneration !== expected.leaseGeneration) return undefined;
      const next = mutate(structuredClone(current.value));
      const contentHash = crypto.createHash('sha256').update(JSON.stringify(next), 'utf8').digest('hex');
      try {
        const updated = await runtimeStore.write<AgentDispatchRecord>(DISPATCH_SCOPE, {
          id: taskId,
          idempotencyKey: `dispatch-update:${contentHash}`,
          expectedEtag: current.etag,
          value: next,
        });
        return updated.value;
      } catch (error) {
        if (!(error instanceof RuntimeStoreConflictError)) throw error;
        if (attempt === 3) return undefined;
      }
    }
    return undefined;
  },
};

const workspace = requiredEnvironment('TEAMS_WORKER_WORKSPACE');
if (requiredEnvironment('TEAMS_WORKER_EXECUTION_MODE') !== 'workspace-write') {
  throw new Error('TEAMS_WORKER_EXECUTION_MODE must explicitly be workspace-write until a Linux read-only isolation provider is available.');
}
const runner = new CodexRunner({ command: { executable: requiredEnvironment('CODEX_BIN') } });

export const executor: WorkerExecutionPort = {
  async start(task: AgentDispatchTask, context) {
    if (task.provider !== 'codex') throw new Error(`Unsupported Azure worker provider: ${task.provider}`);
    const abort = new AbortController();
    const propagateAbort = () => abort.abort(context.signal.reason);
    context.signal.addEventListener('abort', propagateAbort, { once: true });
    if (context.signal.aborted) propagateAbort();
    const result = runner.run({
      jobId: task.taskId,
      prompt: task.prompt,
      workspace,
      mode: 'workspace-write',
      signal: abort.signal,
      subject: {
        tenantId: task.tenantId,
        requesterId: task.requesterId,
        conversationId: task.conversationId,
        jobId: task.taskId,
      },
      onEvent: async (event) => {
        if (event.type) await context.checkpoint(event.type);
      },
    }).then((outcome) => {
      if (!outcome.threadId) throw new Error('Codex worker completed without a provider execution ID.');
      return { result: outcome.finalMessage, providerExecutionId: outcome.threadId };
    }).finally(() => context.signal.removeEventListener('abort', propagateAbort));
    return {
      result,
      terminateProcessTree: async () => { abort.abort('worker cancellation'); runner.cancel(task.taskId); },
      cleanupProcessTree: async () => { context.signal.removeEventListener('abort', propagateAbort); },
    };
  },
};

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for production worker configuration`);
  return value;
}
