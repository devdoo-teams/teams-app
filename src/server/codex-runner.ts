import { spawn, type ChildProcess } from 'node:child_process';

import { MAX_AGENT_RESULT_LENGTH, type AgentJobMode } from './agent-job-store.js';
import { REMOTE_AGENT_GUIDANCE } from './remote-agent-guidance.js';
import { diagnoseRemoteTroubleshooting, formatRemoteTroubleshooting } from './remote-troubleshooting.js';

export interface CodexRunEvent {
  type?: string;
  item?: {
    type?: string;
    text?: string;
    command?: string;
  };
  thread_id?: string;
  error?: string;
}

export interface CodexRunResult {
  threadId?: string;
  finalMessage: string;
  eventCount: number;
}

type RunningCodexProcess = {
  child: ChildProcess;
  terminate: (error?: Error) => void;
};

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const FORCE_KILL_DELAY_MS = 5_000;
const MAX_STDOUT_BUFFER_CHARS = 64 * 1024;
const MAX_STDERR_CHARS = 8 * 1024;
const MAX_EVENT_COUNT = 10_000;
const CODEX_THREAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CODEX_CHILD_ENV_ALLOWLIST = [
  'PATH',
  'Path',
  'HOME',
  'CODEX_HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'LOCALAPPDATA',
  'APPDATA',
  'SYSTEMROOT',
  'SystemRoot',
  'WINDIR',
  'PATHEXT',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
] as const;

function codexChildEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { CI: '1' };
  for (const key of CODEX_CHILD_ENV_ALLOWLIST) {
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

function signalProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall through when the process has not established, or has already left,
      // its isolated process group.
    }
  }

  try {
    child.kill(signal);
  } catch {
    // The process may exit between the lifecycle check and the signal.
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export class CodexRunner {
  private readonly processes = new Map<string, RunningCodexProcess>();

  async run(options: {
    jobId: string;
    prompt: string;
    workspace: string;
    mode: AgentJobMode;
    threadId?: string;
    onEvent?: (event: CodexRunEvent) => Promise<void> | void;
  }): Promise<CodexRunResult> {
    const command = process.env.CODEX_BIN ?? 'codex';
    const script = process.env.CODEX_SCRIPT;
    const enrichedPrompt = `${REMOTE_AGENT_GUIDANCE}\n\nUSER REQUEST:\n${options.prompt}`;
    if (options.threadId && !CODEX_THREAD_ID_PATTERN.test(options.threadId)) {
      throw new Error('Invalid Codex thread ID.');
    }
    const args = [...(script ? [script] : []), 'exec'];
    if (options.threadId) {
      args.push('resume', options.threadId, '--json', '--', enrichedPrompt);
    } else {
      args.push('--json', '--sandbox', options.mode, '--cd', options.workspace, '--', enrichedPrompt);
    }

    const child = spawn(command, args, {
      cwd: options.workspace,
      env: codexChildEnvironment(process.env),
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let threadId: string | undefined;
    let finalMessage = '';
    let eventCount = 0;
    let stdoutBuffer = '';
    let stderr = '';
    let eventQueue = Promise.resolve();
    let terminationError: Error | undefined;
    let terminationRequested = false;
    let timeoutHandle: NodeJS.Timeout | undefined;
    let forceKillHandle: NodeJS.Timeout | undefined;
    let resolveTermination!: (error: Error) => void;
    const terminationPromise = new Promise<Error>((resolve) => {
      resolveTermination = resolve;
    });
    const configuredTimeout = Number(process.env.CODEX_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : DEFAULT_TIMEOUT_MS;

    const terminate = (error?: Error): void => {
      if (!terminationError) terminationError = error ?? new Error('Codex process terminated.');
      if (terminationRequested) return;
      terminationRequested = true;
      resolveTermination(terminationError);
      signalProcessGroup(child, 'SIGTERM');
      forceKillHandle = setTimeout(() => signalProcessGroup(child, 'SIGKILL'), FORCE_KILL_DELAY_MS);
      forceKillHandle.unref();
    };
    const runningProcess: RunningCodexProcess = { child, terminate };
    this.processes.set(options.jobId, runningProcess);

    const queueEvent = (event: CodexRunEvent): void => {
      eventQueue = eventQueue.then(async () => {
        if (terminationError) return;
        try {
          await options.onEvent?.(event);
        } catch (error) {
          terminate(asError(error));
        }
      });
    };

    const handleLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed || terminationError) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return;
      }
      if (!isRecord(parsed)) return;

      if (eventCount >= MAX_EVENT_COUNT) {
        terminate(new Error('Codex event count exceeded safe limit.'));
        return;
      }
      eventCount += 1;

      const event = parsed as CodexRunEvent;
      if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
        threadId = event.thread_id;
      }
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
        const message = typeof event.item.text === 'string' ? event.item.text.trim() : '';
        if (message.length > MAX_AGENT_RESULT_LENGTH) {
          terminate(new Error('Codex final message exceeded safe limit.'));
          return;
        }
        if (message) finalMessage = message;
      }

      queueEvent(event);
    };

    const handleStdout = (chunk: string): void => {
      if (terminationError) return;
      let offset = 0;
      let newlineIndex = chunk.indexOf('\n', offset);
      while (newlineIndex >= 0) {
        const segment = chunk.slice(offset, newlineIndex);
        if (stdoutBuffer.length + segment.length > MAX_STDOUT_BUFFER_CHARS) {
          terminate(new Error('Codex stdout buffer exceeded safe limit.'));
          return;
        }
        stdoutBuffer += segment;
        handleLine(stdoutBuffer);
        stdoutBuffer = '';
        if (terminationError) return;
        offset = newlineIndex + 1;
        newlineIndex = chunk.indexOf('\n', offset);
      }

      const remainder = chunk.slice(offset);
      if (stdoutBuffer.length + remainder.length > MAX_STDOUT_BUFFER_CHARS) {
        terminate(new Error('Codex stdout buffer exceeded safe limit.'));
        return;
      }
      stdoutBuffer += remainder;
    };

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', handleStdout);
    child.stderr?.on('data', (chunk: string) => {
      if (terminationError) return;
      if (stderr.length + chunk.length > MAX_STDERR_CHARS) {
        terminate(new Error('Codex stderr exceeded safe limit.'));
        return;
      }
      stderr += chunk;
    });

    try {
      const exitCode = await new Promise<number>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
        timeoutHandle = setTimeout(() => {
          terminate(new Error(`Codex 작업이 ${Math.ceil(timeoutMs / 1000)}초 시간 제한을 초과했습니다.`));
        }, timeoutMs);
        timeoutHandle.unref();
      });

      if (!terminationError && stdoutBuffer.trim()) handleLine(stdoutBuffer);
      await Promise.race([eventQueue, terminationPromise]);
      if (terminationError) throw terminationError;

      if (exitCode !== 0) {
        const reason = stderr.trim().split('\n').slice(-3).join('\n') || `Codex exited with code ${exitCode}`;
        const diagnostic = formatRemoteTroubleshooting(diagnoseRemoteTroubleshooting(reason));
        throw new Error(diagnostic ? `${reason}\n\n${diagnostic}` : reason);
      }

      if (!finalMessage) {
        throw new Error('Codex did not return a final agent message; task cannot be marked completed.');
      }

      return {
        threadId,
        finalMessage,
        eventCount,
      };
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (forceKillHandle) clearTimeout(forceKillHandle);
      if (terminationRequested) signalProcessGroup(child, 'SIGKILL');
      if (this.processes.get(options.jobId) === runningProcess) {
        this.processes.delete(options.jobId);
      }
    }
  }

  cancel(jobId: string): boolean {
    const runningProcess = this.processes.get(jobId);
    if (!runningProcess) return false;
    runningProcess.terminate(new Error('Codex 작업이 취소되었습니다.'));
    return true;
  }
}
