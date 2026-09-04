import crypto from 'node:crypto';

import {
  RuntimeStoreConflictError,
  type RuntimeScope,
  type RuntimeStore,
} from './runtime-store.js';
import {
  latestDurableWorkerHeartbeat,
  type AgentDispatchRecord,
  type AgentDispatchStatePort,
} from '../azure-agent-dispatch-queue.js';
import type { AgentDispatchTaskReference } from '../queue/agent-dispatch-queue.js';

export function createRuntimeStoreAgentDispatchStatePort(runtimeStore: RuntimeStore): AgentDispatchStatePort {
  return {
    async create(record) {
      const reference = referenceForRecord(record);
      try {
        await runtimeStore.write(scopeFor(reference), {
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
    async get(reference) {
      const record = await runtimeStore.read<AgentDispatchRecord>(scopeFor(reference), reference.taskId);
      if (!record) return undefined;
      assertRecordScope(record.value, reference);
      return record.value;
    },
    async compareAndSwap(reference, expected, mutate) {
      const scope = scopeFor(reference);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const current = await runtimeStore.read<AgentDispatchRecord>(scope, reference.taskId);
        if (!current) throw new Error(`No durable dispatch record exists for ${reference.taskId}.`);
        assertRecordScope(current.value, reference);
        if (
          current.value.leaseOwner !== expected.leaseOwner
          || current.value.leaseGeneration !== expected.leaseGeneration
        ) return undefined;
        const next = mutate(structuredClone(current.value));
        assertRecordScope(next, reference);
        const contentHash = crypto.createHash('sha256').update(JSON.stringify(next), 'utf8').digest('hex');
        try {
          const updated = await runtimeStore.write<AgentDispatchRecord>(scope, {
            id: reference.taskId,
            idempotencyKey: `dispatch-update:${contentHash}`,
            expectedEtag: current.etag,
            value: next,
          });
          assertRecordScope(updated.value, reference);
          return updated.value;
        } catch (error) {
          if (!(error instanceof RuntimeStoreConflictError)) throw error;
          if (attempt === 3) return undefined;
        }
      }
      return undefined;
    },
    async probeDependency(reference) {
      await runtimeStore.read<AgentDispatchRecord>(scopeFor(reference), reference.taskId);
      return { reachable: true };
    },
    async readWorkerHeartbeat(reference) {
      const records = await runtimeStore.list<AgentDispatchRecord>(scopeFor(reference), { limit: 100 });
      for (const record of records) assertRecordScope(record.value, reference, false);
      return latestDurableWorkerHeartbeat(records.map(({ value }) => value));
    },
  };
}

function scopeFor(reference: AgentDispatchTaskReference): RuntimeScope {
  return {
    tenantId: reference.tenantId,
    requesterId: reference.requesterId,
    conversationId: reference.conversationId,
  };
}

function referenceForRecord(record: AgentDispatchRecord): AgentDispatchTaskReference {
  const reference = {
    taskId: record.taskId,
    tenantId: record.task.tenantId,
    requesterId: record.task.requesterId,
    conversationId: record.task.conversationId,
  };
  assertRecordScope(record, reference);
  return reference;
}

function assertRecordScope(
  record: AgentDispatchRecord,
  reference: AgentDispatchTaskReference,
  requireTaskId = true,
): void {
  if (
    (requireTaskId && (record.taskId !== reference.taskId || record.task.taskId !== reference.taskId))
    || record.task.tenantId !== reference.tenantId
    || record.task.requesterId !== reference.requesterId
    || record.task.conversationId !== reference.conversationId
  ) {
    throw new Error(`Durable dispatch record scope mismatch for ${reference.taskId}.`);
  }
}
