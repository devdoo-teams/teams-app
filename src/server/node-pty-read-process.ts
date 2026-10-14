type Disposable = Readonly<{ dispose(): void }>;
export type PtyExit = Readonly<{ exitCode: number; signal?: number }>;

/** Structural subset of node-pty 1.1.0 IPty. Only a trusted executor supplies it. */
export interface NodePtyProcessPort {
  readonly pid: number;
  onData(callback: (data: string) => void): Disposable;
  onExit(callback: (event: PtyExit) => void): Disposable;
  kill(): void;
}

export interface NodePtyReadProcess {
  subscribe(callbacks: Readonly<{ data(value: string): void; exit(value: PtyExit): void }>): Disposable;
  requestTermination(): void;
}

const sources = new WeakSet<object>();
const nativeProcesses = new WeakSet<object>();

/**
 * Attach an already-created native IPty. This adapter cannot spawn, write,
 * resize, or acquire execution permission. The executor retains process ownership.
 */
export function connectNodePtyReadProcess(pty: NodePtyProcessPort, lifecycle?: Readonly<{
  requestTermination(): void;
  observedExit(): PtyExit | undefined;
}>): NodePtyReadProcess {
  if (!pty || !Number.isSafeInteger(pty.pid) || pty.pid < 1
    || typeof pty.onData !== 'function' || typeof pty.onExit !== 'function' || typeof pty.kill !== 'function') {
    throw new TypeError('A native node-pty process is required.');
  }
  if (nativeProcesses.has(pty)) throw new Error('PTY output is already attached.');
  nativeProcesses.add(pty);
  let used = false;
  let exited = false;
  let terminationRequested = false;
  const source = Object.freeze<NodePtyReadProcess>({
    subscribe(callbacks) {
      if (used) throw new Error('PTY output is already attached.');
      used = true;
      let disposed = false;
      const listeners: Disposable[] = [];
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        for (const listener of listeners) listener.dispose();
      };
      try {
        listeners.push(pty.onData(value => { if (!disposed && !exited) callbacks.data(value); }));
        const deliverExit = (value: PtyExit) => {
          if (disposed || exited) return;
          exited = true;
          callbacks.exit(value);
        };
        listeners.push(pty.onExit(deliverExit));
        const alreadyExited = lifecycle?.observedExit();
        if (alreadyExited) deliverExit(alreadyExited);
        return { dispose };
      } catch (error) {
        dispose();
        throw error;
      }
    },
    requestTermination() {
      if (terminationRequested || exited) return;
      // Mark before invoking native code: a thrown kill must never cause a
      // second close of the same ConPTY handle on a repeated request.
      terminationRequested = true;
      if (lifecycle) lifecycle.requestTermination();
      else pty.kill();
    },
  });
  sources.add(source);
  return source;
}

export function isNodePtyReadProcess(value: unknown): value is NodePtyReadProcess {
  return typeof value === 'object' && value !== null && sources.has(value);
}
