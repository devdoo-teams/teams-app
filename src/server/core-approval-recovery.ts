import { randomUUID } from 'node:crypto';
import type { AgentJob, AgentJobScope, AgentJobStatus } from './agent-job-store.js';
import { pendingOperationRevision } from './personal-approval-projection.js';
import type { CoreDurableApproval } from '../shared/core-orchestration.js';
export type { CoreDurableApproval } from '../shared/core-orchestration.js';

/** Same 15 minute lifetime as the existing confirmation grants; never renewed by a callback. */
export const CORE_APPROVAL_TTL_MS = 15 * 60 * 1_000;
export type CoreApprovalDecision = 'accept' | 'deny' | 'expire';
export type CoreApprovalIdentity = Readonly<{ approvalId: string; revision: string }>;
export type CoreApprovalJob = AgentJob & { durableApproval?: CoreDurableApproval };
export type CoreApprovalTransition = Readonly<{
  patch: Partial<CoreApprovalJob>;
  dispatch: boolean;
  replayed: boolean;
}>;
export type CoreApprovalDecisionResult = Readonly<{ job: AgentJob; replayed: boolean; dispatch: boolean }>;

export class CoreApprovalRecoveryError extends Error {
  readonly code = 'CORE_APPROVAL_RECOVERY_REFUSED';
  constructor(readonly reason: 'unsupported' | 'invalid' | 'mismatch' | 'conflict') {
    super(`Durable approval refused: ${reason}.`);
    this.name = 'CoreApprovalRecoveryError';
  }
}

export function createDurableApproval(job: AgentJob, ttlMs = CORE_APPROVAL_TTL_MS): CoreDurableApproval {
  if (job.mode !== 'workspace-write' || job.status !== 'awaiting_approval'
    || !bounded(job.tenantId) || !bounded(job.requesterId)
    || !canonicalTimestamp(job.createdAt) || !Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new CoreApprovalRecoveryError('invalid');
  }
  const deadline = new Date(Date.parse(job.createdAt) + ttlMs).toISOString();
  return { schemaVersion: '1', approvalId: `approval-${randomUUID()}`,
    revision: pendingOperationRevision(job), approverId: job.requesterId,
    tenantId: job.tenantId, deadline, state: 'pending' };
}

/** Validate persisted authority before any load/mutation; absent legacy authority stays absent. */
export function readDurableApproval(value: unknown, job: AgentJob): CoreDurableApproval | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CoreApprovalRecoveryError('invalid');
  const record = value as Record<string, unknown>;
  const allowed = ['schemaVersion', 'approvalId', 'revision', 'approverId', 'tenantId', 'deadline', 'state', 'decidedAt', 'settledStatus', 'settledAt'];
  if (Object.keys(record).some(key => !allowed.includes(key))
    || record.schemaVersion !== '1' || !approvalId(record.approvalId)
    || typeof record.revision !== 'string' || !/^[a-f0-9]{64}$/u.test(record.revision)
    || !bounded(record.approverId) || record.approverId !== job.requesterId
    || !bounded(record.tenantId) || record.tenantId !== job.tenantId
    || job.mode !== 'workspace-write' || record.revision !== pendingOperationRevision(job)
    || !canonicalTimestamp(record.deadline) || Date.parse(record.deadline) <= Date.parse(job.createdAt)
    || !['pending', 'accepted', 'denied', 'expired'].includes(String(record.state))) {
    throw new CoreApprovalRecoveryError('invalid');
  }
  const pending = record.state === 'pending';
  if ((pending && record.decidedAt !== undefined)
    || (!pending && !canonicalTimestamp(record.decidedAt))) throw new CoreApprovalRecoveryError('invalid');
  if (canonicalTimestamp(record.decidedAt)) {
    const decided = Date.parse(record.decidedAt);
    if (decided < Date.parse(job.createdAt)
      || (record.state === 'expired' ? decided < Date.parse(record.deadline) : decided >= Date.parse(record.deadline))) {
      throw new CoreApprovalRecoveryError('invalid');
    }
  }
  if ((record.settledStatus === undefined) !== (record.settledAt === undefined)
    || (record.settledStatus !== undefined && (!terminalStatus(record.settledStatus)
      || !canonicalTimestamp(record.settledAt)
      || Date.parse(record.settledAt) < Date.parse((record.decidedAt ?? job.createdAt) as string)))) {
    throw new CoreApprovalRecoveryError('invalid');
  }
  if ((record.state === 'denied' || record.state === 'expired')
    && (record.settledStatus !== 'cancelled' || job.status !== 'cancelled')) throw new CoreApprovalRecoveryError('invalid');
  if ((record.state === 'pending' && !terminalStatus(job.status) && job.status !== 'awaiting_approval')
    || (record.state === 'accepted' && job.status === 'awaiting_approval')) throw new CoreApprovalRecoveryError('invalid');
  if (record.settledStatus !== undefined && record.settledStatus !== job.status) throw new CoreApprovalRecoveryError('invalid');
  return { ...record } as CoreDurableApproval;
}

export function assertApprovalIdentity(value: unknown): asserts value is CoreApprovalIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CoreApprovalRecoveryError('invalid');
  const identity = value as Record<string, unknown>;
  if (!approvalId(identity.approvalId) || typeof identity.revision !== 'string'
    || !/^[a-f0-9]{64}$/u.test(identity.revision)) throw new CoreApprovalRecoveryError('invalid');
}

/** Invoke inside the existing job-store mutation queue/CAS, never before a plain update(). */
export function transitionDurableApproval(
  job: CoreApprovalJob,
  scope: AgentJobScope,
  request: CoreApprovalIdentity,
  decision: CoreApprovalDecision,
  now = Date.now(),
): CoreApprovalTransition {
  assertApprovalIdentity(request);
  if (!Number.isFinite(now) || !['accept', 'deny', 'expire'].includes(decision)) throw new CoreApprovalRecoveryError('invalid');
  const approval = readDurableApproval(job.durableApproval, job);
  if (!approval) throw new CoreApprovalRecoveryError('unsupported');
  if (job.tenantId !== scope.tenantId || job.requesterId !== scope.requesterId
    || job.conversationId !== scope.conversationId || approval.approverId !== scope.requesterId
    || approval.tenantId !== scope.tenantId || approval.approvalId !== request.approvalId
    || approval.revision !== request.revision) throw new CoreApprovalRecoveryError('mismatch');
  if (approval.state !== 'pending') {
    if ((decision === 'accept' && approval.state === 'accepted')
      || (decision === 'deny' && approval.state === 'denied') || approval.state === 'expired') {
      return { patch: {}, dispatch: false, replayed: true };
    }
    throw new CoreApprovalRecoveryError('conflict');
  }
  if (job.status !== 'awaiting_approval' || approval.settledStatus) throw new CoreApprovalRecoveryError('conflict');
  const expired = now >= Date.parse(approval.deadline);
  if (decision === 'expire' && !expired) return { patch: {}, dispatch: false, replayed: true };
  const decidedAt = new Date(now).toISOString();
  if (expired || decision === 'deny') {
    return { patch: { status: 'cancelled', finishedAt: decidedAt, durableApproval: {
      ...approval, state: expired ? 'expired' : 'denied', decidedAt, settledStatus: 'cancelled', settledAt: decidedAt,
    } }, dispatch: false, replayed: false };
  }
  return { patch: { status: 'queued', error: undefined, durableApproval: {
    ...approval, state: 'accepted', decidedAt,
  } }, dispatch: true, replayed: false };
}

/** Terminal read-back is recorded alongside the terminal job write; never means delivery succeeded. */
export function settleDurableApproval(job: CoreApprovalJob): CoreDurableApproval | undefined {
  const approval = readDurableApproval(job.durableApproval, job);
  if (!approval || !terminalStatus(job.status)) return approval;
  if (approval.settledStatus) {
    if (approval.settledStatus !== job.status) throw new CoreApprovalRecoveryError('conflict');
    return approval;
  }
  if (!canonicalTimestamp(job.finishedAt)) throw new CoreApprovalRecoveryError('invalid');
  if (approval.state === 'pending' && job.status === 'cancelled') {
    return readDurableApproval({ ...approval,
      state: Date.parse(job.finishedAt) >= Date.parse(approval.deadline) ? 'expired' : 'denied',
      decidedAt: job.finishedAt, settledStatus: 'cancelled', settledAt: job.finishedAt,
    }, job);
  }
  return readDurableApproval({ ...approval, settledStatus: job.status, settledAt: job.finishedAt }, job);
}

function approvalId(value: unknown): value is string {
  return typeof value === 'string' && /^approval-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value);
}
function bounded(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}
function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return false;
  return new Date(Date.parse(value)).toISOString() === value;
}
function terminalStatus(value: unknown): value is Extract<AgentJobStatus, 'completed' | 'failed' | 'cancelled'> {
  return value === 'completed' || value === 'failed' || value === 'cancelled';
}
