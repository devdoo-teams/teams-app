import { randomUUID } from 'node:crypto';

import type { CoreOrchestrationService, ServerDerivedCoreScope } from './core-orchestration-service.js';
import { isNodePtyReadProcess, type NodePtyReadProcess, type PtyExit } from './node-pty-read-process.js';
import { PtyOutputLines } from './pty-output-lines.js';
import type { PtySessionIdentity, PtyReadSnapshot, PtyReadState as SessionState, PtyReadFrame as Frame } from '../shared/pty-read.js';

export type { PtySessionIdentity, PtyReadSnapshot } from '../shared/pty-read.js';

type RecordState = {
  identity: PtySessionIdentity;
  tenantId: string;
  requesterId: string;
  process: NodePtyReadProcess;
  state: SessionState;
  lines: PtyOutputLines;
  frames: Frame[];
  bytes: number;
  sequence: number;
  outputClipped: boolean;
  exit?: PtyExit;
  dispose?: () => void;
};

export class PtyReadSessionError extends Error {
  constructor(readonly code: 'PTY_SOURCE_REQUIRED' | 'PTY_SOURCE_UNAVAILABLE' | 'PTY_SESSION_ACTIVE'
    | 'PTY_SESSION_NOT_FOUND' | 'PTY_JOB_NOT_RUNNING' | 'PTY_CURSOR_INVALID' | 'PTY_CAPACITY' | 'PTY_REGISTRY_CLOSED') {
    super(code);
    this.name = 'PtyReadSessionError';
  }
}

/**
 * Process-local observation boundary. No HTTP route, socket, spawn or input API.
 * Every operation reuses Core.get's authenticated scope/owner checks. A cursor
 * reconnect is a read of the same identity; it never resumes or creates a CLI.
 */
export class PtyReadSessionRegistry {
  private readonly sessions = new Map<string, RecordState>();
  private generation = 0;
  private closed = false;
  private readonly maxSessions: number;
  private readonly maxBufferedBytes: number;
  private readonly maxFrames: number;
  private readonly maxPendingBytes: number;

  constructor(private readonly options: Readonly<{
    jobs: Pick<CoreOrchestrationService, 'get'>;
    maxSessions?: number;
    maxBufferedBytes?: number;
    maxFrames?: number;
    maxPendingBytes?: number;
  }>) {
    this.maxSessions = bound(options.maxSessions, 8, 64);
    this.maxBufferedBytes = bound(options.maxBufferedBytes, 65_536, 1_048_576);
    this.maxFrames = bound(options.maxFrames, 256, 4096);
    this.maxPendingBytes = bound(options.maxPendingBytes, 16_384, 65_536);
  }

  register(scope: ServerDerivedCoreScope, jobId: string, process: NodePtyReadProcess): PtySessionIdentity {
    this.assertOpen();
    const job = this.options.jobs.get(scope, { jobId });
    if (!job) throw new PtyReadSessionError('PTY_SESSION_NOT_FOUND');
    if (!isNodePtyReadProcess(process)) throw new PtyReadSessionError('PTY_SOURCE_REQUIRED');
    if (job.status !== 'running') throw new PtyReadSessionError('PTY_JOB_NOT_RUNNING');
    const previous = this.sessions.get(jobId);
    if (previous && previous.state !== 'exited') throw new PtyReadSessionError('PTY_SESSION_ACTIVE');
    if (!previous && this.sessions.size >= this.maxSessions) {
      const evictable = [...this.sessions.values()].find(entry => entry.state === 'exited');
      if (!evictable) throw new PtyReadSessionError('PTY_CAPACITY');
      this.sessions.delete(evictable.identity.jobId);
    }
    if (!Number.isSafeInteger(this.generation + 1)) throw new PtyReadSessionError('PTY_CAPACITY');
    const identity = Object.freeze({ jobId, sessionId: randomUUID(), generation: ++this.generation });
    const record: RecordState = {
      identity, tenantId: scope.tenantId, requesterId: scope.requesterId, process,
      state: 'running', frames: [], bytes: 0, sequence: 0, outputClipped: false,
      lines: new PtyOutputLines(this.maxPendingBytes, line => this.append(record, line)),
    };
    this.sessions.set(jobId, record);
    try {
      const subscription = process.subscribe({
        data: value => {
          if (!this.closed && record.state !== 'exited') record.lines.push(value);
        },
        exit: value => {
          if (this.closed || record.state === 'exited') return;
          record.lines.finish();
          record.exit = Object.freeze({ exitCode: exitNumber(value.exitCode),
            ...(value.signal === undefined ? {} : { signal: exitNumber(value.signal) }) });
          record.state = 'exited';
          record.dispose?.();
        },
      });
      record.dispose = () => subscription.dispose();
      if (record.state === 'exited') record.dispose();
    } catch {
      this.sessions.delete(jobId);
      throw new PtyReadSessionError('PTY_SOURCE_UNAVAILABLE');
    }
    return identity;
  }

  read(scope: ServerDerivedCoreScope, identity: PtySessionIdentity, after = 0): PtyReadSnapshot {
    const record = this.resolve(scope, identity);
    if (!Number.isSafeInteger(after) || after < 0 || after > record.sequence) throw new PtyReadSessionError('PTY_CURSOR_INVALID');
    const firstAvailableSequence = record.frames[0]?.sequence ?? record.sequence + 1;
    return Object.freeze({
      ...record.identity, source: 'pty', outputMode: 'redacted-lines', state: record.state,
      frames: Object.freeze(record.frames.filter(frame => frame.sequence > after)),
      firstAvailableSequence, nextCursor: record.sequence, truncated: after < firstAvailableSequence - 1,
      pendingOutput: record.lines.pendingOutput, outputSuppressed: record.lines.outputSuppressed,
      outputClipped: record.outputClipped,
      ...(record.exit ? { exit: record.exit } : {}),
    });
  }

  /** Trusted executor control only; an accepted stop is never reported as exit. */
  terminate(scope: ServerDerivedCoreScope, identity: PtySessionIdentity): void {
    const record = this.resolve(scope, identity);
    if (record.state !== 'running') return;
    record.state = 'terminating';
    try { record.process.requestTermination(); }
    catch { if (!record.exit) record.state = 'termination_unverified'; }
  }

  /** Detaching this observer never cancels jobs/processes owned by the executor. */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const record of this.sessions.values()) record.dispose?.();
    this.sessions.clear();
  }

  private resolve(scope: ServerDerivedCoreScope, identity: PtySessionIdentity): RecordState {
    this.assertOpen();
    const job = this.options.jobs.get(scope, { jobId: identity.jobId });
    const record = this.sessions.get(identity.jobId);
    if (!job || !record || record.tenantId !== scope.tenantId || record.requesterId !== scope.requesterId
      || record.identity.sessionId !== identity.sessionId || record.identity.generation !== identity.generation) {
      throw new PtyReadSessionError('PTY_SESSION_NOT_FOUND');
    }
    return record;
  }

  private append(record: RecordState, line: string): void {
    // Masking/framing occurs first; clipping can never disclose a cut secret.
    const safe = clipUtf8(line, this.maxBufferedBytes);
    if (safe !== line) record.outputClipped = true;
    const frame = Object.freeze({ sequence: ++record.sequence, text: safe });
    record.frames.push(frame);
    record.bytes += Buffer.byteLength(safe, 'utf8');
    while (record.frames.length > this.maxFrames || record.bytes > this.maxBufferedBytes) {
      record.bytes -= Buffer.byteLength(record.frames.shift()!.text, 'utf8');
    }
  }

  private assertOpen(): void { if (this.closed) throw new PtyReadSessionError('PTY_REGISTRY_CLOSED'); }
}

function bound(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new TypeError('PTY resource limit is invalid.');
  return value;
}

function exitNumber(value: number): number {
  return Number.isSafeInteger(value) && value >= -2_147_483_648 && value <= 2_147_483_647 ? value : -1;
}

function clipUtf8(value: string, bytes: number): string {
  if (Buffer.byteLength(value, 'utf8') <= bytes) return value;
  let result = '';
  let used = 0;
  for (const character of value) {
    used += Buffer.byteLength(character, 'utf8');
    if (used > bytes) break;
    result += character;
  }
  return result;
}
