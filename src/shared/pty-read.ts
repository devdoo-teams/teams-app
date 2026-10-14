/** A lossy, masked line projection. These types do not describe a VT screen or an input channel. */
export type PtySessionIdentity = Readonly<{ jobId: string; sessionId: string; generation: number }>;
export type PtyReadState = 'running' | 'terminating' | 'termination_unverified' | 'exited';
export type PtyReadFrame = Readonly<{ sequence: number; text: string }>;
export type PtyReadExit = Readonly<{ exitCode: number; signal?: number }>;

/** Value-free failures of the internal read adapter; no HTTP or credential contract. */
export class PtyOutputAccessError extends Error {
  constructor(readonly code: 'access-denied' | 'session-unavailable' | 'invalid-request' | 'read-failed') {
    super(code);
    this.name = 'PtyOutputAccessError';
  }
}
export type PtyReadSnapshot = PtySessionIdentity & Readonly<{
  source: 'pty';
  outputMode: 'redacted-lines';
  state: PtyReadState;
  frames: readonly PtyReadFrame[];
  nextCursor: number;
  firstAvailableSequence: number;
  truncated: boolean;
  pendingOutput: boolean;
  outputSuppressed: boolean;
  outputClipped: boolean;
  exit?: PtyReadExit;
}>;
