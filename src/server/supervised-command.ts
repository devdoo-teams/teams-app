import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { createAgentProcessTreeController, processPlatform, type AgentProcessTreeController } from './agent-process-controller.js';

export class SupervisedCommandCleanupError extends Error {
  readonly code = 'PREFLIGHT_CLEANUP_UNVERIFIED' as const;
  constructor() { super('PREFLIGHT_CLEANUP_UNVERIFIED'); this.name = 'SupervisedCommandCleanupError'; }
}

type Options = Readonly<{ env: NodeJS.ProcessEnv; cwd?: string; encoding?: 'utf8'; timeout?: number; maxBuffer?: number; cleanupTimeoutMs?: number; signal?: AbortSignal }>;
type Dependencies = Readonly<{
  /** Synthetic test seams only; real calls use detached spawn and the existing controller. */
  spawn?: (file: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
  controller?: (child: ChildProcess) => AgentProcessTreeController | undefined;
}>;

/** Closed stdin, distinct output pipes and a reap receipt before any result/error.
 * No shell, PTY, permission fallback, credential acquisition or raw diagnostic logging. */
export async function runSupervisedCommand(file: string, args: readonly string[], options: Options, dependencies: Dependencies = {}): Promise<{ stdout: string; stderr: string }> {
  const timeout = options.timeout ?? 45_000; const maxBuffer = options.maxBuffer ?? 16_384;
  const cleanupTimeout = options.cleanupTimeoutMs ?? 15_000;
  if (processPlatform() !== 'posix' || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000
    || !Number.isSafeInteger(cleanupTimeout) || cleanupTimeout < 1 || cleanupTimeout > 60_000
    || !Number.isSafeInteger(maxBuffer) || maxBuffer < 1 || maxBuffer > 4 * 1024 * 1024) throw new TypeError('Supervised command limits/platform are invalid.');
  if (options.signal?.aborted) throw commandFailure('ABORT_ERR', '', '');
  let child: ChildProcess;
  try {
    child = (dependencies.spawn ?? ((command, commandArgs, spawnOptions) => spawn(command, [...commandArgs], spawnOptions)))(file, [...args], {
      env: { ...options.env }, ...(options.cwd ? { cwd: options.cwd } : {}), detached: true, stdio: ['pipe', 'pipe', 'pipe'], shell: false,
    });
  } catch { throw new SupervisedCommandCleanupError(); }
  let stdout = ''; let stderr = ''; let stdoutBytes = 0; let stderrBytes = 0;
  let closed = false; let spawnError: NodeJS.ErrnoException | undefined; let primary: Error | undefined;
  let finish!: (value: { code: number | null; signal: NodeJS.Signals | null }) => void;
  const close = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve => { finish = resolve; });
  child.once('error', error => { spawnError = error; });
  child.once('close', (code, signal) => { closed = true; finish({ code, signal }); });
  let controller: AgentProcessTreeController | undefined;
  try { controller = (dependencies.controller ?? createAgentProcessTreeController)(child); }
  catch { throw new SupervisedCommandCleanupError(); }
  let rejectStopped!: (error: Error) => void;
  const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject; });
  const stop = (code: string) => {
    if (primary) return;
    primary = commandFailure(code, stdout, stderr);
    try { controller?.requestTermination(); } catch { /* cleanup and close still must prove absence */ }
    rejectStopped(primary);
  };
  const capture = (which: 'stdout' | 'stderr', chunk: string) => {
    if (primary) return;
    const bytes = Buffer.byteLength(chunk, 'utf8');
    if ((which === 'stdout' ? stdoutBytes : stderrBytes) + bytes > maxBuffer) { stop('ERR_CHILD_PROCESS_STDIO_MAXBUFFER'); return; }
    if (which === 'stdout') { stdout += chunk; stdoutBytes += bytes; } else { stderr += chunk; stderrBytes += bytes; }
  };
  const out = (chunk: string) => capture('stdout', chunk); const err = (chunk: string) => capture('stderr', chunk);
  child.stdout?.setEncoding('utf8'); child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', out); child.stderr?.on('data', err); child.stdin?.end();
  const timer = setTimeout(() => stop('ETIMEDOUT'), timeout);
  const abort = () => stop(options.signal?.reason?.name === 'TimeoutError' ? 'ETIMEDOUT' : 'ABORT_ERR'); options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  let result: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  try { result = await Promise.race([close, stopped]); }
  catch (error) { primary ??= error as Error; }
  finally {
    clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
    child.stdout?.removeListener('data', out); child.stderr?.removeListener('data', err);
  }
  try {
    if (controller) {
      // A naturally closed parent can leave descendants. The same controller
      // terminates/reaps its owned group before publication on every path.
      try { controller.requestTermination(); } catch { /* require the independent cleanup receipt */ }
      let cleanupTimer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([controller.cleanup(), new Promise<never>((_resolve, reject) => {
          cleanupTimer = setTimeout(() => reject(new SupervisedCommandCleanupError()), cleanupTimeout);
        })]);
      } finally { if (cleanupTimer) clearTimeout(cleanupTimer); }
    } else if (child.pid || !closed || spawnError?.code !== 'ENOENT') throw new SupervisedCommandCleanupError();
  } catch { throw new SupervisedCommandCleanupError(); }
  if (primary) throw primary;
  if (spawnError) throw commandFailure(spawnError.code ?? 'EIO', stdout, stderr);
  if (!result || result.signal || result.code !== 0) throw commandFailure(result?.code ?? 'EIO', stdout, stderr, result?.signal);
  return { stdout, stderr };
}

function commandFailure(code: string | number, stdout: string, stderr: string, signal?: NodeJS.Signals | null): Error {
  return Object.assign(new Error('Supervised preflight command failed.'), { code, stdout, stderr, signal: signal ?? null, killed: code === 'ETIMEDOUT' });
}
