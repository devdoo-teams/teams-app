import crypto from 'node:crypto';

import {
  RuntimeStoreConflictError,
  type RuntimeScope,
  type RuntimeStore,
} from './runtime-store.js';
import { AGENT_JOB_LEDGER_SCOPE } from './agent-job-durable-ledger.js';
import type { AgentJob } from '../agent-job-store.js';
import {
  applyAgentDispatchRecordMutation,
  assertCanonicalAgentDispatchRecord,
  latestDurableWorkerHeartbeat,
  type AgentDispatchRecord,
  type AgentDispatchStatePort,
} from '../azure-agent-dispatch-queue.js';
import {
  AGENT_DISPATCH_LINUX_READ_ONLY_ISOLATION_REFERENCE,
  AGENT_DISPATCH_WORKSPACE_REFERENCE,
  hashLegacyAgentDispatchTask,
  type AgentDispatchExecution,
  type AgentDispatchTaskReference,
  type LegacyAgentDispatchRecord,
  type ServerOwnedLegacyDispatchMigration,
} from '../queue/agent-dispatch-queue.js';

/** Historical pre-scope partition used by the v1 queue implementation. */
export const LEGACY_AGENT_DISPATCH_GLOBAL_SCOPE: RuntimeScope = Object.freeze({
  tenantId: 'teams-core-system',
  requesterId: 'agent-dispatch',
  conversationId: 'global',
});

export function createRuntimeStoreAgentDispatchStatePort(
  runtimeStore: RuntimeStore,
  options: { legacyScope?: RuntimeScope } = {},
): AgentDispatchStatePort {
  const legacyScope = options.legacyScope ?? LEGACY_AGENT_DISPATCH_GLOBAL_SCOPE;
  return {
    async create(record) {
      assertCanonicalAgentDispatchRecord(record);
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
      assertCanonicalAgentDispatchRecord(record.value);
      assertRecordScope(record.value, reference);
      return record.value;
    },
    async getLegacy(reference) {
      const record = await runtimeStore.read<LegacyAgentDispatchRecord>(legacyScope, reference.taskId);
      return record ? structuredClone(record.value) : undefined;
    },
    async compareAndSwap(reference, expected, mutate) {
      const scope = scopeFor(reference);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const current = await runtimeStore.read<AgentDispatchRecord>(scope, reference.taskId);
        if (!current) throw new Error(`No durable dispatch record exists for ${reference.taskId}.`);
        assertCanonicalAgentDispatchRecord(current.value);
        assertRecordScope(current.value, reference);
        if (
          current.value.leaseOwner !== expected.leaseOwner
          || current.value.leaseGeneration !== expected.leaseGeneration
        ) return undefined;
        const next = applyAgentDispatchRecordMutation(current.value, mutate);
        assertRecordScope(next, reference);
        const contentHash = crypto.createHash('sha256').update(JSON.stringify(next), 'utf8').digest('hex');
        try {
          const updated = await runtimeStore.write<AgentDispatchRecord>(scope, {
            id: reference.taskId,
            idempotencyKey: `dispatch-update:${contentHash}`,
            expectedEtag: current.etag,
            value: next,
          });
          assertCanonicalAgentDispatchRecord(updated.value);
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
      if (reference) {
        await runtimeStore.read<AgentDispatchRecord>(scopeFor(reference), reference.taskId);
      } else {
        await runtimeStore.list<AgentJob>(AGENT_JOB_LEDGER_SCOPE, { limit: 1 });
      }
      return { reachable: true };
    },
    async readWorkerHeartbeat(reference) {
      const records = await runtimeStore.list<AgentDispatchRecord>(scopeFor(reference), { limit: 100 });
      for (const record of records) {
        assertCanonicalAgentDispatchRecord(record.value);
        assertRecordScope(record.value, reference, false);
      }
      return latestDurableWorkerHeartbeat(records.map(({ value }) => value));
    },
  };
}

/**
 * Derives the missing v2 execution contract from the durable AgentJob ledger,
 * which is server-owned and separate from the v1 Queue Storage message. It
 * never infers write access from a legacy message; a missing/mismatched job
 * leaves the message deferred until the immutable source is available.
 */
export function createRuntimeStoreLegacyDispatchMigration(
  runtimeStore: RuntimeStore,
): ServerOwnedLegacyDispatchMigration {
  return Object.freeze({
    async resolveExecution(task, requestHash): Promise<AgentDispatchExecution | undefined> {
      if (!/^[0-9a-f]{64}$/u.test(requestHash) || hashLegacyAgentDispatchTask(task) !== requestHash) return undefined;
      const record = await runtimeStore.read<AgentJob>(AGENT_JOB_LEDGER_SCOPE, task.taskId);
      const job = record?.value;
      if (!job || !isMatchingServerOwnedJob(job, task)) return undefined;
      return job.mode === 'read-only'
        ? Object.freeze({
            mode: 'read-only',
            workspaceReference: AGENT_DISPATCH_WORKSPACE_REFERENCE,
            isolationReference: AGENT_DISPATCH_LINUX_READ_ONLY_ISOLATION_REFERENCE,
          })
        : Object.freeze({
            mode: 'workspace-write',
            workspaceReference: AGENT_DISPATCH_WORKSPACE_REFERENCE,
          });
    },
  });
}

function scopeFor(reference: AgentDispatchTaskReference): RuntimeScope {
  return {
    tenantId: reference.tenantId,
    requesterId: reference.requesterId,
    conversationId: reference.conversationId,
  };
}

function referenceForRecord(record: AgentDispatchRecord): AgentDispatchTaskReference {
  assertCanonicalAgentDispatchRecord(record);
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

function isMatchingServerOwnedJob(
  job: AgentJob,
  task: LegacyAgentDispatchRecord['task'],
): boolean {
  return job.id === task.taskId
    && job.prompt === task.prompt
    && job.tenantId === task.tenantId
    && job.requesterId === task.requesterId
    && job.conversationId === task.conversationId
    && (job.provider ?? 'codex') === task.provider
    && (job.mode === 'read-only' || job.mode === 'workspace-write');
}
