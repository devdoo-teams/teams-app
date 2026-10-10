import { randomUUID } from 'node:crypto';
import { assertTeamsJobProgressLedger, TeamsJobProgressTransport, type TeamsJobProgressBinding, type TeamsJobProgressSnapshot,
  type TeamsJobProgressStatePort, type TeamsJobProgressResult, type TeamsJobProgressStopDispatch } from './teams-job-progress.js';

export type TeamsJobProgressCoordinatorOptions = {
  latestSnapshot?(binding: TeamsJobProgressBinding): Promise<Omit<TeamsJobProgressSnapshot, 'revision'> | undefined>;
  /** Revalidate the current job owner and cancel only this persisted scope. */
  onStopped?(binding: TeamsJobProgressBinding): Promise<void>;
};

/** Timers and queues coordinate one process; authority and send intents live in
 * the durable port. A restart uses retained snapshots, never repeats an unknown send. */
export class TeamsJobProgressCoordinator {
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  // This set drains callbacks only. Their authority and deduplication live in
  // the durable record, including when separate coordinators share a port.
  private readonly stopCallbacks = new Set<Promise<void>>();
  private closed = false;
  constructor(private readonly state: TeamsJobProgressStatePort, private readonly transport: TeamsJobProgressTransport,
    private readonly options?: TeamsJobProgressCoordinatorOptions) {}
  private serial<T>(id: string, callback: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('TEAMS_PROGRESS_CLOSED'));
    const next = (this.chains.get(id) ?? Promise.resolve()).catch(() => undefined).then(callback);
    this.chains.set(id, next);
    void next.finally(() => { if (this.chains.get(id) === next) this.chains.delete(id); }).catch(() => undefined);
    return next;
  }
  async publish(binding: TeamsJobProgressBinding, value: Omit<TeamsJobProgressSnapshot, 'revision'>): Promise<TeamsJobProgressResult> {
    const completed = await this.serial(binding.jobId, async () => {
      const previous = await this.state.transact(ledger => ledger.records.find(record => record.binding.jobId === binding.jobId)?.latest);
      const comparable = (snapshot: TeamsJobProgressSnapshot) => { const { revision: _revision, ...content } = snapshot; return JSON.stringify(content); };
      const snapshot = { ...value, revision: previous && comparable(previous) === JSON.stringify(value)
        ? previous.revision : (previous?.revision ?? -1) + 1 };
      const result = await this.transport.publish(binding, snapshot);
      const stopClaim = await this.claimStopped(binding, result);
      this.schedule(binding, result); return { result, stopClaim };
    });
    // Cancellation can await a job notification that re-enters publish. Start
    // it only after the initiating per-job chain has released its durable claim.
    this.dispatchStopped(completed.stopClaim);
    return completed.result;
  }
  async recover(): Promise<void> {
    if (this.closed) throw new Error('TEAMS_PROGRESS_CLOSED');
    await this.state.transact(ledger => {
      assertTeamsJobProgressLedger(ledger);
      for (const record of ledger.records) if (record.stopDispatch?.state === 'claimed') {
        // The old process may have performed cancellation before disappearing.
        // Preserve its operation ID and never call the action again.
        record.stopDispatch.state = 'ambiguous';
        record.stopDispatch.settledAt = Math.max(Date.now(), record.stopDispatch.claimedAt);
      }
    });
    // Recover authoritative job state before any outbound flush. Retained
    // progress alone cannot establish that an interrupted job is running.
    if (this.options?.latestSnapshot) {
      const bindings = await this.state.transact(ledger => ledger.records.map(record => structuredClone(record.binding)));
      for (const binding of bindings) {
        const current = await this.options.latestSnapshot(binding);
        await this.state.transact(ledger => {
          const record = ledger.records.find(value => value.binding.jobId === binding.jobId);
          if (!record || record.state === 'terminal' || record.state === 'stopped') return;
          if (!current) { record.state = 'blocked'; return; }
          const { revision: _revision, ...previous } = record.latest;
          if (JSON.stringify(previous) !== JSON.stringify(current)) record.latest = { ...current, revision: record.latest.revision + 1 };
        });
      }
    }
    const results = await this.transport.recover();
    const bindings = await this.state.transact(ledger => ledger.records.map(record => record.binding));
    for (const result of results) {
      const binding = bindings.find(value => value.jobId === result.jobId);
      if (binding) {
        const stopClaim = await this.claimStopped(binding, result);
        this.schedule(binding, result); this.dispatchStopped(stopClaim);
      }
    }
  }
  private async claimStopped(binding: TeamsJobProgressBinding, result: TeamsJobProgressResult): Promise<TeamsJobProgressStopDispatch | undefined> {
    if (!this.options?.onStopped || result.state !== 'stopped') return undefined;
    return this.state.transact(ledger => {
      assertTeamsJobProgressLedger(ledger);
      const record = ledger.records.find(candidate => candidate.binding.jobId === binding.jobId);
      if (!record || record.state !== 'stopped') return undefined;
      if (Object.keys(record.binding).some(key => record.binding[key as keyof TeamsJobProgressBinding] !== binding[key as keyof TeamsJobProgressBinding])) {
        throw new Error('TEAMS_PROGRESS_AUTHORITY_MISMATCH');
      }
      if (record.stopDispatch) return undefined;
      const claim: TeamsJobProgressStopDispatch = { operationId: randomUUID(), binding: structuredClone(record.binding), state: 'claimed', claimedAt: Date.now() };
      record.stopDispatch = claim;
      return structuredClone(claim);
    });
  }
  private dispatchStopped(claim: TeamsJobProgressStopDispatch | undefined): void {
    const callback = this.options?.onStopped;
    if (!claim || !callback) return;
    const running = Promise.resolve().then(async () => {
      let outcome: 'settled' | 'ambiguous' = 'settled';
      try { await callback(structuredClone(claim.binding)); }
      catch { outcome = 'ambiguous'; }
      await this.state.transact(ledger => {
        assertTeamsJobProgressLedger(ledger);
        const record = ledger.records.find(candidate => candidate.binding.jobId === claim.binding.jobId);
        const dispatch = record?.stopDispatch;
        if (!record || record.state !== 'stopped' || !dispatch || dispatch.operationId !== claim.operationId
          || Object.keys(claim.binding).some(key => dispatch.binding[key as keyof TeamsJobProgressBinding] !== claim.binding[key as keyof TeamsJobProgressBinding])) {
          throw new Error('TEAMS_PROGRESS_STOP_DISPATCH_MISMATCH');
        }
        if (dispatch.state !== 'claimed') return;
        dispatch.state = outcome;
        dispatch.settledAt = Math.max(Date.now(), dispatch.claimedAt);
      });
    }).catch(() => { console.warn('TEAMS_PROGRESS_STOP_DISPATCH_UNVERIFIED'); });
    this.stopCallbacks.add(running);
    void running.finally(() => { this.stopCallbacks.delete(running); });
  }
  private schedule(binding: TeamsJobProgressBinding, result: TeamsJobProgressResult): void {
    const previous = this.timers.get(binding.jobId); if (previous) clearTimeout(previous);
    this.timers.delete(binding.jobId);
    if (this.closed || result.nextDueAt === undefined || ['ambiguous', 'blocked', 'stopped', 'terminal'].includes(result.state)) return;
    const timer = setTimeout(() => {
      this.timers.delete(binding.jobId);
      void this.serial(binding.jobId, async () => {
        const next = await this.transport.flush(binding); const stopClaim = await this.claimStopped(binding, next);
        this.schedule(binding, next); return stopClaim;
      }).then(stopClaim => this.dispatchStopped(stopClaim)).catch(() => console.warn('TEAMS_PROGRESS_FLUSH_UNVERIFIED'));
    }, Math.max(1, result.nextDueAt - Date.now()));
    timer.unref(); this.timers.set(binding.jobId, timer);
  }
  async close(): Promise<void> {
    this.closed = true; for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear(); await Promise.allSettled([...this.chains.values()]);
    while (this.stopCallbacks.size) await Promise.allSettled([...this.stopCallbacks]);
  }
}
