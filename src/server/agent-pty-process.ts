import type { AgentProcessTreeController } from './agent-process-controller.js';
import { connectNodePtyReadProcess, type NodePtyProcessPort, type NodePtyReadProcess, type PtyExit } from './node-pty-read-process.js';

export type ManagedAgentPtyProcess = Readonly<{
  readProcess: NodePtyReadProcess;
  exited: Promise<PtyExit>;
  finished: Promise<void>;
  requestTermination(): void;
  terminate(): Promise<void>;
}>;

const managedProcesses = new WeakSet<object>();

export class AgentPtyCleanupError extends Error {
  readonly code = 'PTY_CLEANUP_UNVERIFIED' as const;
  constructor() { super('PTY_CLEANUP_UNVERIFIED'); this.name = 'AgentPtyCleanupError'; }
}

/**
 * The provider supplies an already-attached, verified tree controller. No
 * process is launched here. Exit and tree cleanup are separate requirements;
 * neither observer disposal nor a successful signal is a reap receipt.
 */
export function ownNodePtyProcess(
  process: NodePtyProcessPort,
  controller: AgentProcessTreeController,
  options: Readonly<{ cleanupTimeoutMs?: number }> = {},
): ManagedAgentPtyProcess {
  if (controller?.available !== true || typeof controller.requestTermination !== 'function'
    || typeof controller.cleanup !== 'function') throw new AgentPtyCleanupError();
  const timeoutMs = options.cleanupTimeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new TypeError('PTY cleanup timeout is invalid.');
  let exit: PtyExit | undefined;
  let resolveExited!: (value: PtyExit) => void;
  const exited = new Promise<PtyExit>(resolve => { resolveExited = resolve; });
  let resolveFinished!: () => void;
  let rejectFinished!: (error: Error) => void;
  const finished = new Promise<void>((resolve, reject) => { resolveFinished = resolve; rejectFinished = reject; });
  // Retain a rejected result for lease.dispose(), without crashing a worker
  // before its owner consumes the receipt. Failed cleanup never releases it.
  void finished.catch(() => undefined);
  let requested = false;
  let cleaning = false;
  let exitSubscription: { dispose(): void } | undefined;

  const requestTermination = () => {
    if (!requested) {
      requested = true;
      try { controller.requestTermination(); } catch { /* still require independent cleanup + native exit */ }
    }
    if (cleaning) return;
    cleaning = true;
    void (async () => {
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          Promise.all([exited, controller.cleanup()]),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AgentPtyCleanupError()), timeoutMs); }),
        ]);
        resolveFinished();
      } catch {
        rejectFinished(new AgentPtyCleanupError());
      } finally {
        if (timer) clearTimeout(timer);
        if (exit) exitSubscription?.dispose();
      }
    })();
  };
  const readProcess = connectNodePtyReadProcess(process, {
    requestTermination,
    observedExit: () => exit,
  });
  exitSubscription = process.onExit(value => {
    if (exit) return;
    exit = Object.freeze({ exitCode: exitNumber(value.exitCode), ...(value.signal === undefined ? {} : { signal: exitNumber(value.signal) }) });
    resolveExited(exit);
    // A naturally ended parent may still have descendants. The verified tree
    // controller owns their cleanup, including any platform-specific handles.
    requestTermination();
    exitSubscription?.dispose();
  });
  if (exit) exitSubscription.dispose();
  const resource = Object.freeze<ManagedAgentPtyProcess>({
    readProcess, exited, finished, requestTermination,
    terminate() { requestTermination(); return finished; },
  });
  managedProcesses.add(resource);
  return resource;
}

export function isManagedAgentPtyProcess(value: unknown): value is ManagedAgentPtyProcess {
  return typeof value === 'object' && value !== null && managedProcesses.has(value);
}

function exitNumber(value: number): number {
  return Number.isSafeInteger(value) && value >= -2_147_483_648 && value <= 2_147_483_647 ? value : -1;
}
