import type { PtyReadExit, PtyReadFrame, PtyReadSnapshot, PtyReadState, PtySessionIdentity } from '../shared/pty-read.js';

export type PtyDisplayViewport = Readonly<{ columns: number; rows: number }>;
export type PtyOutputViewSnapshot = Readonly<{
  identity: PtySessionIdentity;
  phase: 'idle' | 'loading' | 'ready' | 'disconnected' | 'blocked' | 'closed';
  frames: readonly PtyReadFrame[];
  cursor: number;
  sessionState?: PtyReadState;
  exit?: PtyReadExit;
  historyTruncated: boolean;
  pendingOutput: boolean;
  outputSuppressed: boolean;
  outputClipped: boolean;
  viewport: PtyDisplayViewport;
  error?: 'read-failed' | 'read-timeout' | 'access-denied' | 'session-unavailable' | 'invalid-snapshot';
}>;

/** An adapter must translate authenticated denial/missing-session responses to these fixed codes. */
export class PtyOutputReadError extends Error {
  constructor(readonly code: 'access-denied' | 'session-unavailable') { super(code); this.name = 'PtyOutputReadError'; }
}

/**
 * Injected read capability only: no URL, socket, credentials, process launch or input.
 * Cursor acknowledgement follows validation/publication, and stale attempts cannot publish.
 */
export function createPtyOutputReader(options: Readonly<{
  identity: PtySessionIdentity;
  transport: Readonly<{ read: (identity: PtySessionIdentity, after: number, signal: AbortSignal) => Promise<unknown> }>;
  onChange?: (snapshot: PtyOutputViewSnapshot) => void;
  timeoutMs?: number;
  maxFrames?: number;
  maxBufferedBytes?: number;
}>) {
  const candidate = options.identity;
  const identifier = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);
  if (!identifier(candidate.jobId) || !identifier(candidate.sessionId)
    || !Number.isSafeInteger(candidate.generation) || candidate.generation < 1) throw new TypeError('Invalid PTY identity.');
  const identity = Object.freeze({ jobId: candidate.jobId, sessionId: candidate.sessionId, generation: candidate.generation });
  const read = options.transport.read.bind(options.transport);
  const timeout = limit(options.timeoutMs, 20_000, 30_000);
  const maxFrames = limit(options.maxFrames, 256, 4096);
  const maxBytes = limit(options.maxBufferedBytes, 65_536, 1_048_576);
  let epoch = 0;
  let active: { abort: AbortController; promise: Promise<void> } | undefined;
  let state: PtyOutputViewSnapshot = Object.freeze({ identity, phase: 'idle', frames: Object.freeze([]), cursor: 0,
    historyTruncated: false, pendingOutput: false, outputSuppressed: false, outputClipped: false,
    viewport: Object.freeze({ columns: 80, rows: 24 }) });
  const publish = (patch: Partial<PtyOutputViewSnapshot>) => {
    state = Object.freeze({ ...state, ...patch }); options.onChange?.(state);
  };
  const closed = () => state.phase === 'closed' || state.phase === 'blocked';
  const detach = () => { epoch++; active?.abort.abort(); active = undefined; };
  return {
    getSnapshot: () => state,
    read(): Promise<void> {
      if (closed()) return Promise.resolve();
      if (active) return active.promise;
      const attempt = ++epoch;
      const abort = new AbortController();
      const after = state.cursor;
      const current = () => epoch === attempt && !closed() && !abort.signal.aborted;
      // Defer publication so reentrant observers see the already reserved request.
      const promise = Promise.resolve().then(async () => {
        if (!current()) return;
        publish({ phase: 'loading', error: undefined });
        if (!current()) return;
        let timedOut = false;
        let onAbort!: () => void;
        const cancelled = new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(new Error('Read stopped.'));
          abort.signal.addEventListener('abort', onAbort, { once: true });
        });
        const timer = setTimeout(() => { timedOut = true; abort.abort(); }, timeout);
        try {
          const raw = await Promise.race([read(identity, after, abort.signal), cancelled]);
          if (!current()) return;
          const snapshot = parseSnapshot(raw, identity, after);
          const order = { running: 0, terminating: 1, termination_unverified: 2, exited: 3 };
          if (!snapshot || (state.sessionState && order[snapshot.state] < order[state.sessionState])
            || (state.exit && (state.exit.exitCode !== snapshot.exit?.exitCode || state.exit.signal !== snapshot.exit.signal))
            || (state.outputSuppressed && !snapshot.outputSuppressed) || (state.outputClipped && !snapshot.outputClipped)) {
            publish({ phase: 'blocked', frames: Object.freeze([]), cursor: 0, sessionState: undefined,
              exit: undefined, pendingOutput: false, error: 'invalid-snapshot' });
            return;
          }
          const frames = [...(snapshot.truncated ? [] : state.frames), ...snapshot.frames];
          let bytes = frames.reduce((total, frame) => total + byteLength(frame.text), 0);
          let lost = state.historyTruncated || snapshot.truncated;
          while (frames.length > maxFrames || bytes > maxBytes) {
            bytes -= byteLength(frames.shift()!.text); lost = true;
          }
          publish({ phase: 'ready', frames: Object.freeze(frames), cursor: snapshot.nextCursor,
            sessionState: snapshot.state, exit: snapshot.exit, historyTruncated: lost,
            pendingOutput: snapshot.pendingOutput, outputSuppressed: snapshot.outputSuppressed,
            outputClipped: snapshot.outputClipped, error: undefined });
        } catch (error) {
          if (epoch !== attempt || closed()) return;
          if (error instanceof PtyOutputReadError) {
            publish({ phase: 'blocked', frames: Object.freeze([]), cursor: 0, sessionState: undefined,
              exit: undefined, pendingOutput: false, error: error.code });
          } else {
            publish({ phase: 'disconnected', error: timedOut ? 'read-timeout' : 'read-failed' });
          }
        } finally {
          clearTimeout(timer); abort.signal.removeEventListener('abort', onAbort);
          if (active?.abort === abort) active = undefined;
        }
      });
      active = { abort, promise };
      return promise;
    },
    disconnect(): void {
      if (closed()) return;
      detach(); publish({ phase: 'disconnected', error: undefined });
    },
    resize(viewport: PtyDisplayViewport): void {
      if (state.phase === 'closed') return;
      if (!Number.isSafeInteger(viewport.columns) || viewport.columns < 20 || viewport.columns > 240
        || !Number.isSafeInteger(viewport.rows) || viewport.rows < 4 || viewport.rows > 80) {
        throw new RangeError('Invalid display viewport.');
      }
      publish({ viewport: Object.freeze({ columns: viewport.columns, rows: viewport.rows }) });
    },
    dispose(): void {
      if (state.phase === 'closed') return;
      detach(); publish({ phase: 'closed', frames: Object.freeze([]), cursor: 0, sessionState: undefined,
        exit: undefined, pendingOutput: false, outputClipped: false, outputSuppressed: false,
        historyTruncated: false, error: undefined });
    },
  };
}

const encoder = new TextEncoder();
const byteLength = (value: string) => encoder.encode(value).byteLength;
const unsafe = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object';

/** Reject an entire response before cursor advancement; never interpret VT or HTML. */
function parseSnapshot(value: unknown, identity: PtySessionIdentity, after: number): PtyReadSnapshot | undefined {
  if (!record(value) || value.jobId !== identity.jobId || value.sessionId !== identity.sessionId
    || value.generation !== identity.generation || value.source !== 'pty' || value.outputMode !== 'redacted-lines'
    || !['running', 'terminating', 'termination_unverified', 'exited'].includes(String(value.state))
    || !integer(value.nextCursor) || value.nextCursor < after || !integer(value.firstAvailableSequence)
    || value.firstAvailableSequence < 1 || value.firstAvailableSequence > value.nextCursor + 1
    || !Array.isArray(value.frames) || value.frames.length > 4096
    || !['truncated', 'pendingOutput', 'outputSuppressed', 'outputClipped'].every(key => typeof value[key] === 'boolean')
    || value.truncated !== (after < value.firstAvailableSequence - 1)) return undefined;
  if (value.state === 'exited' ? !validExit(value.exit) : value.exit !== undefined) return undefined;
  const frames: PtyReadFrame[] = [];
  let expected = Math.max(after + 1, value.firstAvailableSequence);
  let bytes = 0;
  for (const frame of value.frames) {
    if (!record(frame) || frame.sequence !== expected++ || typeof frame.text !== 'string'
      || unsafe.test(frame.text) || (bytes += byteLength(frame.text)) > 1_048_576) return undefined;
    frames.push(Object.freeze({ sequence: frame.sequence as number, text: frame.text }));
  }
  if (expected - 1 !== value.nextCursor) return undefined;
  return Object.freeze({ ...identity, source: 'pty', outputMode: 'redacted-lines', state: value.state as PtyReadState,
    frames: Object.freeze(frames), nextCursor: value.nextCursor, firstAvailableSequence: value.firstAvailableSequence,
    truncated: value.truncated as boolean, pendingOutput: value.pendingOutput as boolean,
    outputSuppressed: value.outputSuppressed as boolean, outputClipped: value.outputClipped as boolean,
    ...(validExit(value.exit) ? { exit: Object.freeze({ exitCode: value.exit.exitCode,
      ...(value.exit.signal === undefined ? {} : { signal: value.exit.signal }) }) } : {}) });
}

function validExit(value: unknown): value is { exitCode: number; signal?: number } {
  const valid = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= -2_147_483_648 && n <= 2_147_483_647;
  return record(value) && valid(value.exitCode) && (value.signal === undefined || valid(value.signal));
}
function limit(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError('Invalid PTY display resource limit.');
  return value;
}
