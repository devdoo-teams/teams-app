import type { ChildProcess } from 'node:child_process';

export type AgentProcessPlatform = 'posix' | 'win32' | 'unsupported';

export type AgentProcessControllerOptions = {
  platform?: AgentProcessPlatform;
  sendSignal?: (pid: number, signal: NodeJS.Signals) => void;
  groupAlive?: (pid: number) => boolean;
  graceMs?: number;
  cleanupWaitMs?: number;
  retryDelayMs?: number;
  maxAttempts?: number;
};

export type AgentProcessTreeController = {
  readonly available: true;
  readonly platform: AgentProcessPlatform;
  requestTermination: () => void;
  cleanup: () => Promise<void>;
};

export type AgentProcessControllerProvider = {
  preflight: () => Promise<void> | void;
  attach: (child: ChildProcess) => Promise<AgentProcessTreeController | undefined> | AgentProcessTreeController | undefined;
};

export class AgentProcessControlError extends Error {
  readonly code = 'AGENT_PROCESS_CONTROL_FAILED' as const;

  constructor(message: string) {
    super(message);
    this.name = 'AgentProcessControlError';
  }
}

const DEFAULT_TERM_GRACE_MS = 5_000;
const DEFAULT_CLEANUP_WAIT_MS = 1_000;
const DEFAULT_RETRY_DELAY_MS = 25;
const DEFAULT_MAX_ATTEMPTS = 3;

export function processPlatform(platform: NodeJS.Platform | AgentProcessPlatform = process.platform): AgentProcessPlatform {
  if (platform === 'win32') return 'win32';
  if (platform === 'aix' || platform === 'darwin' || platform === 'freebsd' || platform === 'linux' || platform === 'openbsd' || platform === 'sunos') {
    return 'posix';
  }
  if (platform === 'posix') return 'posix';
  return 'unsupported';
}

/**
 * The default controller is deliberately POSIX-only. Windows production must
 * inject a controller backed by a supported OS primitive (for example a Job
 * Object) and pass its asynchronous preflight before spawning any workload.
 */
export function isProcessTreeControllerAvailable(options: AgentProcessControllerOptions = {}): boolean {
  const platform = options.platform ?? processPlatform();
  return platform === 'posix' && typeof process.kill === 'function';
}

export function createAgentProcessTreeController(
  child: ChildProcess,
  options: AgentProcessControllerOptions = {},
): AgentProcessTreeController | undefined {
  const platform = options.platform ?? processPlatform();
  const pid = child.pid;
  if (platform !== 'posix' || !pid || !isProcessTreeControllerAvailable(options)) return undefined;

  const graceMs = boundedMilliseconds(options.graceMs, DEFAULT_TERM_GRACE_MS);
  const cleanupWaitMs = boundedMilliseconds(options.cleanupWaitMs, DEFAULT_CLEANUP_WAIT_MS);
  const retryDelayMs = boundedMilliseconds(options.retryDelayMs, DEFAULT_RETRY_DELAY_MS);
  const maxAttempts = Number.isSafeInteger(options.maxAttempts) && (options.maxAttempts ?? 0) > 0
    ? options.maxAttempts!
    : DEFAULT_MAX_ATTEMPTS;
  const sendSignal = options.sendSignal ?? ((targetPid: number, signal: NodeJS.Signals) => process.kill(targetPid, signal));
  const groupAlive = options.groupAlive ?? ((targetPid: number): boolean => {
    try {
      process.kill(-targetPid, 0);
      return true;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (code === 'ESRCH') return false;
      return true;
    }
  });

  let closed = false;
  let closeError: Error | undefined;
  let terminationRequested = false;
  let termFailure: Error | undefined;
  let killFailure: Error | undefined;
  let cleanupPromise: Promise<void> | undefined;
  let resolveClosed!: () => void;
  const closePromise = new Promise<void>((resolve) => { resolveClosed = resolve; });
  child.once('close', () => {
    closed = true;
    resolveClosed();
  });
  child.once('error', (error) => {
    closeError = error instanceof Error ? error : new Error(String(error));
  });

  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      sendSignal(-pid, signal);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      if (signal === 'SIGTERM') termFailure ??= failure;
      else killFailure ??= failure;
    }
  };

  const awaitClose = async (timeoutMs: number): Promise<boolean> => {
    if (closed) return true;
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        closePromise,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new AgentProcessControlError('Codex process did not close within the bounded cleanup window.')), timeoutMs);
          timeout.unref();
        }),
      ]);
      return true;
    } catch (error) {
      if (error instanceof AgentProcessControlError) return false;
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };

  const awaitGroupAbsence = async (): Promise<void> => {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (!groupAlive(pid)) return;
      if (attempt + 1 < maxAttempts) await delay(retryDelayMs);
    }
    throw new AgentProcessControlError('Codex process group remains present after bounded reap verification.');
  };

  const requestTermination = (): void => {
    if (terminationRequested) return;
    terminationRequested = true;
    signalGroup('SIGTERM');
  };

  const cleanup = async (): Promise<void> => {
    cleanupPromise ??= (async () => {
      if (terminationRequested) {
        const closedAfterTerm = await awaitClose(graceMs);
        if (!closedAfterTerm || groupAlive(pid)) {
          signalGroup('SIGKILL');
          const closedAfterKill = await awaitClose(cleanupWaitMs);
          if (!closedAfterKill) {
            throw new AgentProcessControlError('Codex process group did not close after SIGKILL.');
          }
        }
        await awaitGroupAbsence();
        if (termFailure && killFailure) {
          throw new AgentProcessControlError('Unable to signal the Codex process group for termination.');
        }
      } else {
        const closedNormally = await awaitClose(cleanupWaitMs);
        if (!closedNormally) throw new AgentProcessControlError('Codex process did not close before cleanup completed.');
        await awaitGroupAbsence();
      }
      if (closeError && !terminationRequested) throw closeError;
    })();
    await cleanupPromise;
  };

  return { available: true, platform, requestTermination, cleanup };
}

function boundedMilliseconds(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) >= 0 && (value ?? 0) <= 60_000
    ? Math.floor(value!)
    : fallback;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
