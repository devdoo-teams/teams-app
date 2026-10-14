import type { NodePtyProcessPort, PtyExit } from '../../src/server/node-pty-read-process.js';

/** Events only. No OS process, shell, input, network or credential access. */
export class SyntheticPtyReadSource implements NodePtyProcessPort {
  readonly pid = 654321;
  readonly data = new Set<(value: string) => void>();
  readonly exits = new Set<(value: PtyExit) => void>();
  kills = 0;
  onData = (fn: (value: string) => void) => { this.data.add(fn); return { dispose: () => { this.data.delete(fn); } }; };
  onExit = (fn: (value: PtyExit) => void) => { this.exits.add(fn); return { dispose: () => { this.exits.delete(fn); } }; };
  kill() { this.kills++; }
  emit(value: string) { for (const fn of this.data) fn(value); }
  exit(exitCode = 0) { for (const fn of [...this.exits]) fn({ exitCode }); }
}
