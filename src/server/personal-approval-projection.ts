import { createHash } from 'node:crypto';
import type { CoreOrchestrationJob, CorePendingOperation } from '../shared/core-orchestration.js';

/** Display-only projection after owner-scoped lookup; never a grant or mutation precondition. */
export function projectPendingOperation(job: CoreOrchestrationJob): CorePendingOperation | undefined {
  if (job.status !== 'awaiting_approval' || job.mode !== 'workspace-write'
    || !job.id?.trim() || !job.prompt?.trim()) return undefined;
  const argumentsSnapshot = [1, job.id, job.prompt, job.mode, job.provider ?? null,
    job.executionEnvironment ?? null, job.model ?? null, job.reasoningEffort ?? null,
    job.catalogRevision ?? null, job.parentJobId ?? null, job.threadId ?? null];
  return { kind: 'job-approval', jobId: job.id,
    revision: createHash('sha256').update(JSON.stringify(argumentsSnapshot)).digest('hex') };
}
