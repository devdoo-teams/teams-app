import crypto from 'node:crypto';

import type { AgentJob, AgentJobDurableLedger } from '../agent-job-store.js';
import {
  RuntimeStoreConflictError,
  stableRuntimeJson,
  type RuntimeScope,
  type RuntimeStore,
} from './runtime-store.js';

const AGENT_JOB_LEDGER_SCOPE: RuntimeScope = Object.freeze({
  tenantId: 'teams-core-system',
  requesterId: 'agent-job-ledger',
  conversationId: 'global',
});
const MAX_DURABLE_AGENT_JOBS = 999;

/**
 * Stores one AgentJob per shared-runtime record. The server-owned partition is
 * an implementation detail; each job retains its authenticated tenant,
 * requester and conversation scope and AgentJobStore enforces that scope.
 */
export class RuntimeStoreAgentJobLedger implements AgentJobDurableLedger {
  constructor(private readonly runtimeStore: RuntimeStore) {}

  async load(): Promise<unknown> {
    const records = await this.runtimeStore.list<AgentJob>(AGENT_JOB_LEDGER_SCOPE, {
      limit: MAX_DURABLE_AGENT_JOBS + 1,
    });
    if (records.length > MAX_DURABLE_AGENT_JOBS) {
      throw new Error(`durable AgentJob ledger exceeds ${MAX_DURABLE_AGENT_JOBS} records`);
    }
    return records
      .map((record) => jsonClone(record.value))
      .sort(compareJobsNewestFirst);
  }

  async persist(previousJobs: readonly AgentJob[], nextJobs: readonly AgentJob[]): Promise<void> {
    const previousById = new Map(previousJobs.map((job) => [job.id, jsonClone(job)]));
    const nextById = new Map(nextJobs.map((job) => [job.id, jsonClone(job)]));
    for (const id of previousById.keys()) {
      if (!nextById.has(id)) throw new Error('durable AgentJob ledger does not permit record deletion');
    }

    const changed = [...nextById.values()].filter((job) => {
      const previous = previousById.get(job.id);
      return !previous || stableRuntimeJson(previous) !== stableRuntimeJson(job);
    });
    for (const job of changed) {
      const previous = previousById.get(job.id);
      const current = await this.runtimeStore.read<AgentJob>(AGENT_JOB_LEDGER_SCOPE, job.id);
      if (previous) {
        if (!current || stableRuntimeJson(jsonClone(current.value)) !== stableRuntimeJson(previous)) {
          throw new RuntimeStoreConflictError('durable AgentJob ledger changed concurrently');
        }
      } else if (current) {
        if (stableRuntimeJson(jsonClone(current.value)) === stableRuntimeJson(job)) continue;
        if (!isLegacyProviderMigration(current.value, job)) {
          throw new RuntimeStoreConflictError('durable AgentJob ID already exists');
        }
      }

      const contentHash = crypto.createHash('sha256').update(stableRuntimeJson(job), 'utf8').digest('hex');
      await this.runtimeStore.write<AgentJob>(AGENT_JOB_LEDGER_SCOPE, {
        id: job.id,
        idempotencyKey: `agent-job:${contentHash}`,
        ...(current ? { expectedEtag: current.etag } : {}),
        value: job,
      });
    }
  }
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function compareJobsNewestFirst(left: AgentJob, right: AgentJob): number {
  const byCreatedAt = String(right?.createdAt ?? '').localeCompare(String(left?.createdAt ?? ''));
  return byCreatedAt || String(right?.id ?? '').localeCompare(String(left?.id ?? ''));
}

function isLegacyProviderMigration(current: unknown, next: AgentJob): boolean {
  if (!current || typeof current !== 'object' || Array.isArray(current)) return false;
  const record = jsonClone(current as Record<string, unknown>);
  if (Object.prototype.hasOwnProperty.call(record, 'provider') || !next.provider) return false;
  record.provider = next.provider;
  return stableRuntimeJson(record) === stableRuntimeJson(jsonClone(next));
}
