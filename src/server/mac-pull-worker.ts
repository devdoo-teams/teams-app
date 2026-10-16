import crypto from 'node:crypto';
import { AgentJobIdempotentReplayError, type AgentJob } from './agent-job-store.js';
import type { AgentService } from './agent-service.js';
import type { PullTransport } from './pull-worker-http.js';
import { PullWorkerError, pullClaimSchema, pullResultSchema, pullTaskSchema,
  type PullClaim, type PullResult, type PullTask } from './pull-worker.js';
import { assertSafeCodexModelSelection } from './codex-model-catalog.js';
import { assertTeamsCliAgentSelection } from '../shared/teams-cli-agent-policy.js';

/** result resolves only after the trusted executor's process/lease cleanup.
 * cancel resolves only after cancellation and cleanup, never merely signal delivery. */
export type MacExecution = Readonly<{ result: Promise<PullResult>; cancel(): Promise<void> }>;
export type MacExecutionPort = Readonly<{ start(task: PullTask): Promise<MacExecution> }>;
const hash = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function terminalResult(job: AgentJob): PullResult {
  return pullResultSchema.parse({ status: job.status,
    ...(job.result === undefined ? {} : { result: job.result }),
    ...(job.error === undefined ? {} : { error: job.error }),
    ...(job.threadId ? { providerExecutionId: job.threadId } : {}) });
}

/** Reuses the existing local AgentService; no direct CLI spawn, approval or model override. */
export function createAgentServiceMacExecutor(service: Pick<AgentService, 'submit' | 'waitForExecutionSettlement' | 'cancelStrict'>): MacExecutionPort {
  return {
    async start(input) {
      const task = pullTaskSchema.parse(input);
      assertSafeCodexModelSelection(task.selection); assertTeamsCliAgentSelection(task.selection);
      const idempotencyKey = `pull-worker:${hash([task.scope, task.jobId])}`;
      const requestHash = hash(task);
      let job: AgentJob;
      try {
        job = await service.submit({ scope: task.scope, prompt: task.prompt, provider: task.provider,
          mode: task.mode, ...task.selection, idempotencyKey, requestHash, notify: false });
      } catch (error) {
        if (!(error instanceof AgentJobIdempotentReplayError)) throw error;
        job = error.job;
      }
      if (job.executionEnvironment !== 'local-macos' || job.requestHash !== requestHash || job.idempotencyKey !== idempotencyKey
        || job.tenantId !== task.scope.tenantId || job.requesterId !== task.scope.requesterId
        || job.conversationId !== task.scope.conversationId || job.provider !== task.provider
        || job.mode !== task.mode || job.prompt !== task.prompt || job.model !== task.selection.model
        || job.reasoningEffort !== task.selection.reasoningEffort || job.catalogRevision !== task.selection.catalogRevision) {
        throw new PullWorkerError('conflict', 'local execution identity conflict');
      }
      const settled = async () => {
        const receipt = await service.waitForExecutionSettlement(job.id, task.scope);
        if (receipt.execution !== 'settled' || receipt.cleanup !== 'verified') throw new PullWorkerError('unavailable', 'Mac execution/cleanup unverified');
        return receipt.job;
      };
      const result = settled().then(terminalResult);
      // A caller may still be acknowledging begin when an immediate policy/runtime failure arrives.
      void result.catch(() => undefined);
      return { result, async cancel() {
        const stopped = await service.cancelStrict(job.id, task.scope, { notify: false, provider: task.provider });
        if (!stopped || stopped.status !== 'cancelled') throw new PullWorkerError('unavailable', 'Mac cancellation cleanup unverified');
        terminalResult(await settled());
      } };
    },
  };
}

type Active = { claim: PullClaim; execution: MacExecution; outcome?: PullResult; failed?: boolean; cleanupVerified?: boolean };
export class MacPullWorker {
  private active?: Active;
  private blocked = false;
  private uncertainStart = false;
  private closed = false;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly cleanupTimeoutMs: number;
  constructor(private readonly options: Readonly<{
    transport: PullTransport; executor: MacExecutionPort;
    principal: Readonly<{ tenantId: string; requesterId: string }>;
    sourceCommit: string; cleanupTimeoutMs?: number;
  }>) {
    this.options = { ...options, principal: { ...options.principal } };
    if (!/^[0-9a-f]{40}$/.test(options.sourceCommit) || !options.principal.tenantId || !options.principal.requesterId) throw new PullWorkerError('invalid');
    this.cleanupTimeoutMs = options.cleanupTimeoutMs ?? 15000;
    if (!Number.isSafeInteger(this.cleanupTimeoutMs) || this.cleanupTimeoutMs < 100 || this.cleanupTimeoutMs > 30000) throw new PullWorkerError('invalid');
  }
  /** One bounded poll/ack cycle. Scheduling and existing token acquisition belong to the caller. */
  step(): Promise<'idle' | 'running' | 'settled' | 'blocked'> {
    const operation = this.chain.then(() => this.stepOnce());
    this.chain = operation.catch(() => undefined); return operation;
  }
  reconnect(): void {
    if (this.closed || this.uncertainStart || (this.active && !this.active.outcome && !this.active.cleanupVerified)) {
      throw new PullWorkerError('unavailable', 'operator reconciliation required');
    }
    this.blocked = false;
  }
  private validate(claim: PullClaim): PullClaim {
    const value = pullClaimSchema.parse(claim);
    if (value.task.sourceCommit !== this.options.sourceCommit
      || value.task.scope.tenantId !== this.options.principal.tenantId
      || value.task.scope.requesterId !== this.options.principal.requesterId) throw new PullWorkerError('owner');
    assertSafeCodexModelSelection(value.task.selection); assertTeamsCliAgentSelection(value.task.selection);
    return value;
  }
  private async stopOwned(): Promise<void> {
    const active = this.active;
    if (!active || active.outcome) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        Promise.all([active.execution.cancel(), active.execution.result]).then(([, result]) => result),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new PullWorkerError('unavailable', 'cleanup timeout')), this.cleanupTimeoutMs); }),
      ]);
      if (result.status !== 'cancelled') throw new PullWorkerError('unavailable', 'cancellation outcome is ambiguous');
      active.outcome = pullResultSchema.parse(result); active.cleanupVerified = true;
    } finally { if (timer) clearTimeout(timer); }
  }
  private async startBounded(claim: PullClaim): Promise<MacExecution> {
    const pending = this.options.executor.start(structuredClone(claim.task));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      return await Promise.race([pending, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { timedOut = true; reject(new PullWorkerError('unavailable', 'start timeout')); }, this.cleanupTimeoutMs);
      })]);
    } catch (error) {
      if (timedOut) void pending.then(async execution => {
        // A start may succeed after its caller timed out. Retain ownership and
        // stop it; never turn a late handle into another accepted execution.
        this.active = { claim, execution };
        try { await this.stopOwned(); this.uncertainStart = false; }
        catch { /* retained as uncertain; operator reconciliation is required */ }
      }, () => undefined);
      throw error;
    } finally { if (timer) clearTimeout(timer); }
  }
  private async stepOnce(): Promise<'idle' | 'running' | 'settled' | 'blocked'> {
    if (this.closed || this.blocked) return 'blocked';
    try {
      if (this.active?.outcome) {
        await this.options.transport.finish(this.active.claim, this.active.outcome);
        this.active = undefined; return 'settled';
      }
      if (this.active) {
        if (this.active.failed) throw new PullWorkerError('unavailable', 'execution cleanup unverified');
        const status = await this.options.transport.heartbeat(this.active.claim);
        if (status.cancellationRequested) {
          await this.stopOwned();
          await this.options.transport.finish(this.active.claim, this.active.outcome!);
          this.active = undefined; return 'settled';
        }
        return 'running';
      }
      const next = await this.options.transport.claim(); if (!next) return 'idle';
      const claim = this.validate(next);
      const begun = this.validate(await this.options.transport.begin(claim));
      if (hash(claim) !== hash(begun)) throw new PullWorkerError('conflict', 'begin identity changed');
      this.uncertainStart = true;
      const execution = await this.startBounded(begun);
      const active: Active = { claim: begun, execution };
      this.active = active; this.uncertainStart = false;
      void execution.result.then(value => {
        try { active.outcome = pullResultSchema.parse(value); } catch { active.failed = true; }
      }, () => { active.failed = true; });
      return 'running';
    } catch {
      this.blocked = true;
      try { await this.stopOwned(); } catch { /* unresolved cleanup remains blocked; no new claim */ }
      return 'blocked';
    }
  }
  /** Stops only this connector's execution; does not close shared AgentService/server. */
  close(): Promise<boolean> {
    this.closed = true;
    const operation = this.chain.then(async () => {
      try { await this.stopOwned(); return !this.uncertainStart; } catch { return false; }
    });
    this.chain = operation.catch(() => undefined); return operation;
  }
}
