import crypto from 'node:crypto';
import { z } from 'zod';
import type { AgentJob, AgentJobScope } from './agent-job-store.js';
import type { AgentExecutionDispatcher, AgentExecutionObservation } from './agent-execution-port.js';
import { atomicWriteJson, readAtomicJsonStore } from './atomic-file.js';
import { acquireStoreProcessLease } from './process-lease.js';
import { TEAMS_CLI_AGENT_POLICY, assertTeamsCliAgentSelection } from '../shared/teams-cli-agent-policy.js';
import { assertSafeCodexModelSelection } from './codex-model-catalog.js';

const identifier = z.string().min(1).max(256).regex(/^[^\u0000-\u001f\u007f]+$/u);
const scopeSchema = z.object({ tenantId: identifier, requesterId: identifier, conversationId: identifier }).strict();
const selectionSchema = z.object({ model: z.literal(TEAMS_CLI_AGENT_POLICY.model),
  reasoningEffort: z.literal(TEAMS_CLI_AGENT_POLICY.reasoningEffort), catalogRevision: z.string().min(1).max(256) }).strict();
export const pullTaskSchema = z.object({ jobId: identifier, scope: scopeSchema,
  provider: z.literal('codex'), mode: z.literal('read-only'), prompt: z.string().min(1).max(20000),
  selection: selectionSchema, createdAt: z.string().datetime(), sourceCommit: z.string().regex(/^[0-9a-f]{40}$/) }).strict();
export const pullLeaseSchema = z.object({ jobId: identifier, leaseId: z.string().uuid() }).strict();
export const pullClaimSchema = pullLeaseSchema.extend({ task: pullTaskSchema }).strict()
  .refine(value => value.jobId === value.task.jobId, 'claim/task identity conflict');
export const pullResultSchema = z.object({ status: z.enum(['completed', 'failed', 'cancelled']),
  result: z.string().max(20000).optional(), error: z.string().max(10000).optional(),
  providerExecutionId: identifier.optional() }).strict().superRefine((value, ctx) => {
  if (value.status === 'completed' && (value.result === undefined || !value.providerExecutionId)) {
    ctx.addIssue({ code: 'custom', message: 'completed result and execution identity are required' });
  }
});
export type PullTask = z.infer<typeof pullTaskSchema>;
export type PullLease = z.infer<typeof pullLeaseSchema>;
export type PullClaim = PullLease & Readonly<{ task: PullTask }>;
export type PullResult = z.infer<typeof pullResultSchema>;
/** Resolved by the host's authenticated identity policy, never by a request body. */
export type PullWorkerIdentity = Readonly<{ id: string; tenantId: string; requesterId: string }>;
const recordSchema = z.object({ task: pullTaskSchema, hash: z.string().regex(/^[0-9a-f]{64}$/),
  state: z.enum(['queued', 'leased', 'running', 'quarantined', 'completed', 'failed', 'cancelled']),
  leaseId: z.string().uuid().optional(), expiresAt: z.number().finite().optional(),
  cancellationRequested: z.boolean(), result: pullResultSchema.optional() }).strict();
const ledgerSchema = z.object({ schemaVersion: z.literal(1), workerId: identifier,
  records: z.array(recordSchema).max(4096) }).strict();
type Ledger = z.infer<typeof ledgerSchema>;
type RecordState = Ledger['records'][number];
export class PullWorkerError extends Error {
  constructor(readonly code: 'owner' | 'lease' | 'conflict' | 'invalid' | 'unavailable', message: string = code) { super(message); }
}
const digest = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const terminal = (r: RecordState) => ['completed', 'failed', 'cancelled'].includes(r.state);

export type PullWorkerHost = Awaited<ReturnType<typeof createPullWorkerHost>>;
export async function createPullWorkerHost(options: Readonly<{
  file: string; workerId: string; sourceCommit: string; leaseMs?: number; now?: () => number;
}>) {
  options = { ...options };
  identifier.parse(options.workerId);
  if (!/^[0-9a-f]{40}$/.test(options.sourceCommit)) throw new PullWorkerError('invalid', 'full source commit required');
  const leaseMs = options.leaseMs ?? 30000;
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 120000) throw new PullWorkerError('invalid');
  const now = options.now ?? Date.now;
  const lease = await acquireStoreProcessLease([options.file]);
  let ledger: Ledger;
  try {
    try { ledger = ledgerSchema.parse(JSON.parse(await readAtomicJsonStore(options.file))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      ledger = { schemaVersion: 1, workerId: options.workerId, records: [] };
    }
    if (ledger.workerId !== options.workerId || ledger.records.some(r => r.hash !== digest(r.task))) throw new PullWorkerError('conflict', 'ledger identity conflict');
  } catch (error) { await lease.release(); throw error; }
  let chain: Promise<unknown> = Promise.resolve();
  let closed = false;
  let closing: Promise<void> | undefined;
  function transaction<T>(operation: (next: Ledger) => T): Promise<T> {
    if (closed) return Promise.reject(new PullWorkerError('unavailable'));
    const result = chain.then(async () => {
      const next = structuredClone(ledger);
      for (const record of next.records) {
        if (record.expiresAt !== undefined && record.expiresAt <= now()) {
          if (record.state === 'leased') { record.state = 'queued'; delete record.leaseId; delete record.expiresAt; }
          else if (record.state === 'running') record.state = 'quarantined';
        }
      }
      const value = operation(next);
      await atomicWriteJson(options.file, next);
      ledger = next;
      return structuredClone(value);
    });
    chain = result.catch(() => undefined);
    return result;
  }
  function sameOwner(record: RecordState, identity: PullWorkerIdentity): boolean {
    return identity.id === options.workerId && identity.tenantId === record.task.scope.tenantId
      && identity.requesterId === record.task.scope.requesterId;
  }
  function owned(next: Ledger, identity: PullWorkerIdentity, input: PullLease): RecordState {
    const ref = pullLeaseSchema.parse({ jobId: input.jobId, leaseId: input.leaseId });
    const record = next.records.find(r => r.task.jobId === ref.jobId);
    if (!record || !sameOwner(record, identity)) throw new PullWorkerError('owner');
    if (record.leaseId !== ref.leaseId) throw new PullWorkerError('lease');
    return record;
  }
  const claimFor = (record: RecordState): PullClaim => ({ jobId: record.task.jobId, leaseId: record.leaseId!, task: record.task });
  function taskFor(job: AgentJob): PullTask {
    if (job.mode !== 'read-only' || job.threadId || job.parentJobId || !['queued', 'running'].includes(job.status)) {
      throw new PullWorkerError('invalid', 'read-only fresh execution required; local approval/continuation is separate');
    }
    const task = pullTaskSchema.parse({ jobId: job.id,
      scope: { tenantId: job.tenantId, requesterId: job.requesterId, conversationId: job.conversationId },
      provider: job.provider, mode: job.mode, prompt: job.prompt, selection: {
        model: job.model, reasoningEffort: job.reasoningEffort, catalogRevision: job.catalogRevision },
      createdAt: job.createdAt, sourceCommit: options.sourceCommit });
    assertSafeCodexModelSelection(task.selection); assertTeamsCliAgentSelection(task.selection);
    return task;
  }
  function referenced(next: Ledger, job: AgentJob): RecordState | undefined {
    const record = next.records.find(r => r.task.jobId === job.id);
    if (record && (record.task.scope.tenantId !== job.tenantId || record.task.scope.requesterId !== job.requesterId
      || record.task.scope.conversationId !== job.conversationId)) throw new PullWorkerError('owner');
    return record;
  }
  const dispatcher: AgentExecutionDispatcher = {
    kind: 'pull-worker',
    async dispatch(job) {
      const task = taskFor(job);
      await transaction(next => {
        const previous = next.records.find(r => r.task.jobId === task.jobId);
        if (previous) { if (previous.hash !== digest(task)) throw new PullWorkerError('conflict'); return; }
        if (next.records.length >= 4096) throw new PullWorkerError('unavailable', 'handoff capacity reached');
        next.records.push({ task, hash: digest(task), state: 'queued', cancellationRequested: false });
      });
    },
    observe(job) {
      return transaction(next => {
        const record = referenced(next, job);
        if (!record) return undefined;
        if (record.result) return record.result;
        return { status: record.state === 'leased' ? 'queued' : record.state,
          ...(record.state === 'quarantined' ? { error: 'PULL_WORKER_CLEANUP_UNVERIFIED' } : {}) } satisfies AgentExecutionObservation;
      });
    },
    async cancel(job, _reason) {
      await transaction(next => { const record = referenced(next, job); if (!record || terminal(record)) return;
        record.cancellationRequested = true;
        if (record.state === 'queued' || record.state === 'leased') {
          record.state = 'cancelled'; record.result = { status: 'cancelled' };
        }
      });
    },
  };
  return {
    dispatcher,
    claim(identity: PullWorkerIdentity): Promise<PullClaim | undefined> {
      return transaction(next => {
        const active = next.records.find(r => sameOwner(r, identity) && ['leased', 'running'].includes(r.state));
        if (active) return claimFor(active);
        // A disconnected started job blocks this worker until cleanup/reconciliation.
        if (next.records.some(r => sameOwner(r, identity) && r.state === 'quarantined')) return undefined;
        const record = next.records.find(r => sameOwner(r, identity) && r.state === 'queued');
        if (!record) return undefined;
        record.state = 'leased'; record.leaseId = crypto.randomUUID(); record.expiresAt = now() + leaseMs;
        return claimFor(record);
      });
    },
    begin(identity: PullWorkerIdentity, input: PullLease): Promise<PullClaim> {
      return transaction(next => {
        const record = owned(next, identity, input);
        if (record.cancellationRequested) throw new PullWorkerError('conflict', 'cancelled');
        if (record.state !== 'leased' && record.state !== 'running') throw new PullWorkerError('lease');
        record.state = 'running'; record.expiresAt = now() + leaseMs;
        return claimFor(record);
      });
    },
    heartbeat(identity: PullWorkerIdentity, input: PullLease) {
      return transaction(next => { const record = owned(next, identity, input);
        if (record.state !== 'running') throw new PullWorkerError('lease', 'execution is not running');
        record.expiresAt = now() + leaseMs;
        return { cancellationRequested: record.cancellationRequested };
      });
    },
    async finish(identity: PullWorkerIdentity, input: PullLease, value: PullResult) {
      await transaction(next => {
        const record = owned(next, identity, input);
        if (record.cancellationRequested && value.status !== 'cancelled') throw new PullWorkerError('conflict', 'cancel cleanup required');
        const result = pullResultSchema.parse(value);
        if (record.result) { if (digest(result) !== digest(record.result)) throw new PullWorkerError('conflict'); return; }
        if (record.state !== 'running' && !(record.state === 'quarantined' && result.status === 'cancelled')) throw new PullWorkerError('lease');
        record.state = result.status; record.result = result;
      });
    },
    close(): Promise<void> { if (!closing) { closed = true; closing = chain.then(() => lease.release()); } return closing; },
  };
}
