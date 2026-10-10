import { atomicWriteJson, readAtomicJsonStore } from './atomic-file.js';
import {
  assertTeamsJobProgressLedger, createTeamsJobProgressLedger,
  type TeamsJobProgressLedger, type TeamsJobProgressStatePort,
} from './teams-job-progress.js';

/**
 * One shared instance in one process, on a private local JSON path supplied by
 * the caller. The queue is not an inter-process lock or a multi-replica CAS.
 * All writers of this ledger must use this instance; a deployment with multiple
 * workers needs a different state port with shared atomic transactions.
 *
 * The existing atomic-file helper supplies path guards, private permissions,
 * temp-file fsync and atomic rename (directory fsync is best effort there).
 * No candidate is retained in memory after a callback or write failure.
 */
export class TeamsJobProgressJsonStore implements TeamsJobProgressStatePort {
  readonly consistency = 'single-process-local-json' as const;
  private tail: Promise<void> = Promise.resolve();
  private initialized = false;

  constructor(private readonly filePath: string, private readonly writer: typeof atomicWriteJson = atomicWriteJson) {}

  initialize(): Promise<void> { return this.enqueue(() => this.initializeInsideQueue()); }

  transact<T>(apply: (ledger: TeamsJobProgressLedger) => T): Promise<T> {
    return this.enqueue(async () => {
      if (!this.initialized) await this.initializeInsideQueue();
      const latest = await this.readLatest();
      const candidate = structuredClone(latest);
      const result = apply(candidate);
      if (result && (typeof result === 'object' || typeof result === 'function')
        && typeof (result as { then?: unknown }).then === 'function') {
        // A violating async callback cannot commit, including after it resumes.
        void Promise.resolve(result).catch(() => undefined);
        throw new Error('TEAMS_PROGRESS_TRANSACTION_SYNCHRONOUS_REQUIRED');
      }
      assertTeamsJobProgressLedger(candidate);
      const persisted = structuredClone(candidate);
      const detachedResult = structuredClone(result);
      if (JSON.stringify(persisted) !== JSON.stringify(latest)) await this.writer(this.filePath, persisted);
      return detachedResult;
    });
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(work);
    this.tail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async initializeInsideQueue(): Promise<void> {
    try { await this.readLatest(); }
    catch (error) {
      if (this.initialized || !isMissing(error)) throw error;
      await this.writer(this.filePath, createTeamsJobProgressLedger());
    }
    this.initialized = true;
  }

  private async readLatest(): Promise<TeamsJobProgressLedger> {
    const text = await readAtomicJsonStore(this.filePath);
    let decoded: TeamsJobProgressLedger;
    try { decoded = JSON.parse(text) as TeamsJobProgressLedger; }
    catch { throw new Error('TEAMS_PROGRESS_STATE_INVALID'); }
    assertTeamsJobProgressLedger(decoded);
    return decoded;
  }
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
