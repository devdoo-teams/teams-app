import { createHash } from 'node:crypto';
import type { CoreOrchestrationJob, CorePendingOperation } from '../shared/core-orchestration.js';

/** Legacy jobs retain display identity, while durable-backed jobs also expose callback identity. */
export function projectPendingOperation(job: CoreOrchestrationJob): CorePendingOperation | undefined {
  if (job.status !== 'awaiting_approval' || job.mode !== 'workspace-write'
    || !job.id?.trim() || !job.prompt?.trim()) return undefined;
  const approvalJob = job as CoreOrchestrationJob & { durableApproval?: import('./core-approval-recovery.js').CoreDurableApproval };
  const approval = approvalJob.durableApproval ?? approvalJob.approval;
  const revision = pendingOperationRevision(job);
  if (approval && (approval.state !== 'pending' || approval.revision !== revision
    || approval.settledStatus || Date.parse(approval.deadline) <= Date.now())) return undefined;
  return { kind: 'job-approval', jobId: job.id, revision,
    ...(approval ? { approvalId: approval.approvalId, approverId: approval.approverId,
      tenantId: approval.tenantId, deadline: approval.deadline } : {}) };
}

export function pendingOperationRevision(job: CoreOrchestrationJob): string {
  const argumentsSnapshot = [2, job.id, job.prompt, job.mode, job.provider ?? null,
    job.executionEnvironment ?? null, job.model ?? null, job.reasoningEffort ?? null,
    job.catalogRevision ?? null, job.parentJobId ?? null];
  return createHash('sha256').update(JSON.stringify(argumentsSnapshot)).digest('hex');
}
