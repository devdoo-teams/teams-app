import { spawn, type ChildProcess } from 'node:child_process';

import { MAX_AGENT_RESULT_LENGTH, type AgentJobMode } from './agent-job-store.js';
import {
  AgentExecutionUnavailableError,
  isAgentIsolationLease,
  type AgentIsolationLease,
  type AgentIsolationSpawnOptions,
  type AgentIsolationSubject,
} from './agent-execution-policy.js';
import {
  createAgentProcessTreeController,
  isProcessTreeControllerAvailable,
  processPlatform,
  type AgentProcessControllerOptions,
  type AgentProcessControllerProvider,
  type AgentProcessPlatform,
  type AgentProcessTreeController,
} from './agent-process-controller.js';
import { REMOTE_AGENT_GUIDANCE } from './remote-agent-guidance.js';
import { diagnoseRemoteTroubleshooting, formatRemoteTroubleshooting } from './remote-troubleshooting.js';
import { redactCliDiagnostics } from './cli-diagnostics.js';
import { CODEX_READ_ONLY_PERMISSION_ARGS } from './codex-permission-profile-isolation-provider.js';
import { redactSensitiveText, redactSensitiveValue } from './sensitive-text.js';

export interface CodexRunEvent {
  type?: string;
  item?: {
    type?: string;
    text?: string;
    command?: string;
    message?: string;
  };
  thread_id?: string;
  error?: unknown;
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

export type CodexCommandSpec = Readonly<{
  executable: string;
  prefixArgs?: readonly string[];
}>;

type CodexRunnerOptions = {
  command?: CodexCommandSpec;
  platform?: NodeJS.Platform | AgentProcessPlatform;
  processControllerOptions?: Omit<AgentProcessControllerOptions, 'platform'>;
  processControllerProvider?: AgentProcessControllerProvider;
  spawn?: (command: string, args: readonly string[], options: AgentIsolationSpawnOptions) => ChildProcess;
  /** Test seam for the already-created POSIX controller. Never used as a Windows boundary. */
  processControllerFactory?: (
    child: ChildProcess,
    options: AgentProcessControllerOptions,
  ) => AgentProcessTreeController | undefined;
};

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_STDOUT_BUFFER_CHARS = 64 * 1024;
const MAX_STDERR_CHARS = 8 * 1024;
const MAX_EVENT_COUNT = 10_000;
const CONTROLLER_ATTACHMENT_REAP_TIMEOUT_MS = 1_000;
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

export class CodexTerminalProtocolError extends Error {
  readonly code = 'CODEX_TERMINAL_PROTOCOL_INVALID' as const;

  constructor(message: string) {
    super(message);
    this.name = 'CodexTerminalProtocolError';
  }
}

export class CodexProcessControlUnavailableError extends AgentExecutionUnavailableError {
  readonly reason = 'process-tree-control-required' as const;

  constructor() {
    super('process-tree-control-required', 'Codex 프로세스 전체 트리를 제어할 수 있는 지원 경계가 없습니다.');
    this.name = 'CodexProcessControlUnavailableError';
  }
}

export async function reapChildProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    const cleanup = (): void => {
      if (timeout) clearTimeout(timeout);
      child.removeListener('close', onClose);
      child.removeListener('error', onError);
    };
    const finish = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onClose = (): void => finish();
    const onError = (): void => finish();

    child.once('close', onClose);
    child.once('error', onError);
    timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('spawned CLI child did not close after controller attachment failed.'));
    }, CONTROLLER_ATTACHMENT_REAP_TIMEOUT_MS);
    try {
      child.kill('SIGKILL');
    } catch {
      // The child may have exited between the state check and kill().
    }
    if (child.exitCode !== null || child.signalCode !== null) finish();
  });
}

function codexChildEnvironment(
  source: NodeJS.ProcessEnv,
  overrides: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { CI: '1' };
  for (const key of CODEX_CHILD_ENV_ALLOWLIST) {
    const value = source[key];
    if (value !== undefined) environment[key] = value;
  }
  for (const key of CODEX_CHILD_ENV_ALLOWLIST) {
    const value = overrides[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function errorPayload(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!isRecord(value)) return '';
  const message = value.message;
  return typeof message === 'string' ? message.trim() : '';
}

function isFailureType(type: string): boolean {
  return type === 'error' || type === 'turn.failed' || type === 'turn.cancelled' || type === 'turn.aborted';
}

function sanitizeRunEvent(value: Record<string, unknown>): CodexRunEvent {
  const event: CodexRunEvent = {};
  if (typeof value.type === 'string') event.type = value.type;
  if (typeof value.thread_id === 'string') event.thread_id = value.thread_id;

  if (isRecord(value.item)) {
    const item: NonNullable<CodexRunEvent['item']> = {};
    if (typeof value.item.type === 'string') item.type = value.item.type;
    if (typeof value.item.text === 'string') item.text = value.item.text;
    if (typeof value.item.command === 'string') item.command = value.item.command;
    if (typeof value.item.message === 'string') item.message = value.item.message;
    if (Object.keys(item).length > 0) event.item = item;
  }

  if (typeof value.error === 'string') {
    event.error = value.error;
  } else if (isRecord(value.error) && typeof value.error.message === 'string') {
    event.error = { message: value.error.message };
  }

  return redactSensitiveValue(event) as CodexRunEvent;
}

type ProtocolState = 'thread' | 'turn' | 'items' | 'message' | 'completed';

export class CodexRunner {
  private readonly processes = new Map<string, RunningCodexProcess>();

  constructor(private readonly runnerOptions: CodexRunnerOptions = {}) {}

  async run(options: {
    jobId: string;
    prompt: string;
    workspace: string;
    mode: AgentJobMode;
    threadId?: string;
    isolationLease?: AgentIsolationLease;
    subject?: AgentIsolationSubject;
    environmentOverrides?: Record<string, string>;
    timeoutMs?: number;
    signal?: AbortSignal;
    onEvent?: (event: CodexRunEvent) => Promise<void> | void;
  }): Promise<CodexRunResult> {
    if (options.signal?.aborted) throw new Error('Codex 작업이 취소되었습니다.');
    if (options.threadId && !CODEX_THREAD_ID_PATTERN.test(options.threadId)) {
      throw new Error('Invalid Codex thread ID.');
    }

    if (options.mode === 'read-only') {
      if (!options.subject || !isAgentIsolationLease(options.isolationLease)) {
        throw new AgentExecutionUnavailableError();
      }
      if (options.isolationLease.workspace !== options.workspace) {
        throw new AgentExecutionUnavailableError('provider-rejected-request', 'Codex 격리 lease와 작업공간이 일치하지 않습니다.');
      }
    }

    const platform = processPlatform(this.runnerOptions.platform ?? process.platform);
    const controllerOptions: AgentProcessControllerOptions = {
      ...this.runnerOptions.processControllerOptions,
      platform,
    };
    const injectedController = this.runnerOptions.processControllerProvider;
    if (platform === 'win32') {
      if (!injectedController) throw new CodexProcessControlUnavailableError();
      await injectedController.preflight();
    } else if (!isProcessTreeControllerAvailable(controllerOptions)) {
      throw new CodexProcessControlUnavailableError();
    }

    const command = this.runnerOptions.command?.executable ?? process.env.CODEX_BIN ?? 'codex';
    const prefixArgs = this.runnerOptions.command?.prefixArgs
      ?? (process.env.CODEX_SCRIPT ? [process.env.CODEX_SCRIPT] : []);
    const enrichedPrompt = `${REMOTE_AGENT_GUIDANCE}\n\nUSER REQUEST:\n${options.prompt}`;
    const args = [
      ...prefixArgs,
      'exec',
      '--json',
      ...(options.mode === 'read-only'
        ? CODEX_READ_ONLY_PERMISSION_ARGS
        : ['--sandbox', options.mode]),
      '--cd',
      options.workspace,
    ];
    if (options.threadId) {
      args.push('resume', options.threadId, '--', enrichedPrompt);
    } else {
      args.push('--', enrichedPrompt);
    }

    const environment = codexChildEnvironment(process.env, options.environmentOverrides);
    const spawnOptions: AgentIsolationSpawnOptions = {
      cwd: options.workspace,
      env: environment,
      detached: platform === 'posix',
      stdio: ['ignore', 'pipe', 'pipe'],
    };

    let child: ChildProcess;
    if (options.mode === 'read-only') {
      // A provider-owned lease is the only read-only launch path. No cwd,
      // protected-root claim, or assert-only callback can reach spawn.
      child = await options.isolationLease!.spawn(options.subject!, command, args, spawnOptions);
    } else {
      const spawnChild = this.runnerOptions.spawn ?? ((childCommand, childArgs, childOptions) =>
        spawn(childCommand, [...childArgs], childOptions as any));
      child = spawnChild(command, args, spawnOptions);
    }

    let processController: AgentProcessTreeController | undefined;
    try {
      processController = injectedController
        ? await injectedController.attach(child)
        : this.runnerOptions.processControllerFactory
          ? this.runnerOptions.processControllerFactory(child, controllerOptions)
          : createAgentProcessTreeController(child, controllerOptions);
      if (!processController) {
        throw new CodexProcessControlUnavailableError();
      }
    } catch (error) {
      try {
        await reapChildProcess(child);
      } catch {
        throw new CodexProcessControlUnavailableError();
      }
      throw error;
    }

    let threadId: string | undefined;
    let finalMessage = '';
    let eventCount = 0;
    let stdoutBuffer = '';
    let stderr = '';
    let eventQueue = Promise.resolve();
    let terminationError: Error | undefined;
    let terminationRequested = false;
    let protocolState: ProtocolState = 'thread';
    let agentMessageCount = 0;
    const currentProtocolState = (): ProtocolState => protocolState;
    let timeoutHandle: NodeJS.Timeout | undefined;
    let resolveTermination!: (error: Error) => void;
    const terminationPromise = new Promise<Error>((resolve) => { resolveTermination = resolve; });
    const configuredTimeout = Number(options.timeoutMs ?? process.env.CODEX_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
      ? configuredTimeout
      : DEFAULT_TIMEOUT_MS;

    const terminate = (error?: Error): void => {
      if (!terminationError) terminationError = error ?? new Error('Codex process terminated.');
      if (terminationRequested) return;
      terminationRequested = true;
      resolveTermination(terminationError);
      processController.requestTermination();
    };
    const runningProcess: RunningCodexProcess = { child, terminate };
    this.processes.set(options.jobId, runningProcess);
    const abort = (): void => terminate(new Error('Codex 작업이 취소되었습니다.'));
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();

    const protocolFailure = (message: string): void => {
      terminate(new CodexTerminalProtocolError(message));
    };

    const observeEvent = (event: CodexRunEvent): void => {
      const type = event.type;
      if (typeof type !== 'string' || !type) {
        protocolFailure('Codex JSONL event type is missing.');
        return;
      }
      if (protocolState === 'completed') {
        protocolFailure('Codex emitted an event after turn.completed.');
        return;
      }
      if (isFailureType(type) || (type === 'item.completed' && event.item?.type === 'error')) {
        const detail = redactCliDiagnostics(
          errorPayload(event.error) || errorPayload(event.item?.message),
          { paths: [options.workspace, process.env.HOME, process.env.USERPROFILE] },
        );
        protocolFailure(detail ? `Codex reported a terminal failure: ${detail}` : 'Codex reported a terminal failure.');
        return;
      }

      if (type === 'thread.started') {
        if (protocolState !== 'thread' || typeof event.thread_id !== 'string' || !CODEX_THREAD_ID_PATTERN.test(event.thread_id)) {
          protocolFailure('Codex thread.started ordering or thread_id is invalid.');
          return;
        }
        threadId = event.thread_id;
        protocolState = 'turn';
        return;
      }
      if (type === 'turn.started') {
        if (protocolState !== 'turn') {
          protocolFailure('Codex turn.started ordering is invalid.');
          return;
        }
        protocolState = 'items';
        return;
      }
      if (type === 'item.started') {
        if ((protocolState !== 'items' && protocolState !== 'message') || !event.item || typeof event.item.type !== 'string' || !event.item.type) {
          protocolFailure('Codex item.started ordering or item type is invalid.');
          return;
        }
        protocolState = 'items';
        return;
      }
      if (type === 'item.completed') {
        if ((protocolState !== 'items' && protocolState !== 'message') || !event.item || typeof event.item.type !== 'string' || !event.item.type) {
          protocolFailure('Codex item.completed ordering or item type is invalid.');
          return;
        }
        if (event.item.type !== 'agent_message') {
          if (protocolState !== 'items') protocolFailure('Codex item.completed ordering is invalid.');
          return;
        }
        const message = typeof event.item.text === 'string' ? event.item.text.trim() : '';
        if (!message) {
          protocolFailure('Codex agent_message must be non-empty.');
          return;
        }
        if (message.length > MAX_AGENT_RESULT_LENGTH) {
          protocolFailure('Codex final message exceeded safe limit.');
          return;
        }
        agentMessageCount += 1;
        finalMessage = message;
        protocolState = 'message';
        return;
      }
      if (type === 'turn.completed') {
        if (protocolState !== 'message' || agentMessageCount < 1 || errorPayload(event.error)) {
          protocolFailure('Codex must emit a non-empty final agent_message immediately before turn.completed.');
          return;
        }
        protocolState = 'completed';
        return;
      }
      protocolFailure(`Codex emitted an unsupported JSONL event: ${type}.`);
    };

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
      if (!trimmed) {
        protocolFailure('Codex emitted a blank JSONL record.');
        return;
      }
      if (terminationError) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        protocolFailure('Codex emitted malformed JSONL.');
        return;
      }
      if (!isRecord(parsed)) {
        protocolFailure('Codex JSONL records must be objects.');
        return;
      }
      if (eventCount >= MAX_EVENT_COUNT) {
        terminate(new Error('Codex event count exceeded safe limit.'));
        return;
      }
      eventCount += 1;
      const event = sanitizeRunEvent(parsed);
      observeEvent(event);
      if (terminationError) return;
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

    let primaryError: Error | undefined;
    try {
      const exitResult = await Promise.race([
        new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
          child.once('error', reject);
          child.once('close', (code, signal) => resolve({ code, signal }));
          timeoutHandle = setTimeout(() => {
            terminate(new Error(`Codex 작업이 ${Math.ceil(timeoutMs / 1000)}초 시간 제한을 초과했습니다.`));
          }, timeoutMs);
          timeoutHandle.unref();
        }),
        terminationPromise.then((error) => { throw error; }),
      ]);

      if (!terminationError && stdoutBuffer.length > 0) {
        handleLine(stdoutBuffer);
        stdoutBuffer = '';
      }
      await Promise.race([eventQueue, terminationPromise.then((error) => { throw error; })]);
      if (terminationError) throw terminationError;
      if (exitResult.signal || exitResult.code !== 0) {
        const reason = redactCliDiagnostics(redactSensitiveText(stderr.trim().split('\n').slice(-3).join('\n')), {
          paths: [options.workspace, process.env.HOME, process.env.USERPROFILE],
        }) || `Codex exited with code ${exitResult.code ?? 'signal'}`;
        const diagnostic = formatRemoteTroubleshooting(diagnoseRemoteTroubleshooting(reason));
        throw new Error(diagnostic ? `${reason}\n\n${diagnostic}` : reason);
      }
      if (currentProtocolState() !== 'completed' || agentMessageCount < 1 || !finalMessage) {
        throw new CodexTerminalProtocolError('Codex did not emit a non-empty final agent message followed by turn.completed.');
      }
      return { threadId, finalMessage, eventCount };
    } catch (error) {
      primaryError = asError(error);
      throw primaryError;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      options.signal?.removeEventListener('abort', abort);
      try {
        await processController.cleanup();
      } catch (cleanupError) {
        if (!primaryError) throw asError(cleanupError);
      }
      if (this.processes.get(options.jobId) === runningProcess) this.processes.delete(options.jobId);
    }
  }

  cancel(jobId: string): boolean {
    const runningProcess = this.processes.get(jobId);
    if (!runningProcess) return false;
    runningProcess.terminate(new Error('Codex 작업이 취소되었습니다.'));
    return true;
  }

  close(): void {
    for (const runningProcess of this.processes.values()) {
      runningProcess.terminate(new Error('Codex 서버가 종료 중입니다.'));
    }
  }
}
