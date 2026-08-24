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
import { CodexRunner, type CodexRunEvent } from './codex-runner.js';
import { redactCliDiagnostics } from './cli-diagnostics.js';
import {
  ghcpCliCommandFromEnvironment,
  GHCP_SECRET_ENV_VARS,
  resolveGhcpCliExecutable,
  type GhcpCliExecutableResolver,
} from './ghcp-cli-adapter.js';

export type CliAgentProvider = 'codex' | 'copilot';

export type CliAgentLifecycleEvent = Readonly<{
  provider: CliAgentProvider;
  type: 'session.started' | 'turn.started' | 'tool.started' | 'agent.message' | 'turn.completed';
  sessionId?: string;
  message?: string;
}>;

export type CliAgentRunResult = Readonly<{
  provider: CliAgentProvider;
  sessionId?: string;
  finalResult: string;
  eventCount: number;
}>;

export type CliAgentCommandSpec = Readonly<{
  executable: string;
  prefixArgs?: readonly string[];
}>;

export type CliAgentRunOptions = Readonly<{
  provider: CliAgentProvider;
  jobId: string;
  prompt: string;
  workspace: string;
  mode: AgentJobMode;
  sessionId?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  isolationLease?: AgentIsolationLease;
  subject?: AgentIsolationSubject;
  environmentOverrides?: Record<string, string>;
  onEvent?: (event: CliAgentLifecycleEvent) => Promise<void> | void;
}>;

export type CliAgentRunnerOptions = Readonly<{
  commands?: Partial<Record<CliAgentProvider, CliAgentCommandSpec>>;
  resolveGhcpExecutable?: GhcpCliExecutableResolver;
  /** Explicit Copilot tool permissions. Defaults to read or read+write by job mode. */
  copilotAllowedTools?: readonly string[];
  platform?: NodeJS.Platform | AgentProcessPlatform;
  processControllerOptions?: Omit<AgentProcessControllerOptions, 'platform'>;
  processControllerProvider?: AgentProcessControllerProvider;
  spawn?: (command: string, args: readonly string[], options: AgentIsolationSpawnOptions) => ChildProcess;
  processControllerFactory?: (
    child: ChildProcess,
    options: AgentProcessControllerOptions,
  ) => AgentProcessTreeController | undefined;
}>;

type RunningCliProcess = Readonly<{
  provider: CliAgentProvider;
  terminate: (error: Error) => void;
}>;

type JsonRecord = Record<string, unknown>;

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_STDOUT_BUFFER_CHARS = 64 * 1024;
const MAX_STDERR_CHARS = 8 * 1024;
const MAX_EVENT_COUNT = 10_000;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const COPILOT_POST_TERMINAL_METADATA = new Set([
  'assistant.usage',
  'session.idle',
  'session.info',
  'session.shutdown',
  'session.usage_info',
  'session.warning',
]);
const COPILOT_AUTH_REQUIRED_TEXT =
  /(not logged in|not authenticated|unauthenticated|authentication required|login required|please run .*login|one-time code|device code|user code|no oauth token)/iu;
const COPILOT_AUTH_REQUIRED_MARKER =
  /(?:^|[-_])(auth(?:entication)?|login)(?:[-_])required$|^unauthenticated$|^not[-_]authenticated$/iu;

const CLI_CHILD_ENV_ALLOWLIST = [
  'PATH', 'Path', 'HOME', 'CODEX_HOME', 'COPILOT_HOME', 'USERPROFILE',
  'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'APPDATA', 'SYSTEMROOT',
  'SystemRoot', 'WINDIR', 'PATHEXT', 'TMPDIR', 'TMP', 'TEMP', 'LANG',
  'LC_ALL', 'LC_CTYPE', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
] as const;
const COPILOT_TOKEN_ENV_ALLOWLIST = [
  'COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN',
] as const;
const COPILOT_CONFIG_ENV_ALLOWLIST = [
  'COPILOT_GH_HOST', 'GH_HOST', 'COPILOT_MODEL',
] as const;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function redactRunnerDiagnostics(value: unknown, workspace: string): string {
  return redactCliDiagnostics(value, {
    paths: [workspace, process.env.HOME, process.env.USERPROFILE],
  });
}

function isCopilotAuthRequiredText(value: unknown): boolean {
  return typeof value === 'string' && COPILOT_AUTH_REQUIRED_TEXT.test(value);
}

function isCopilotAuthRequiredMarker(value: unknown): boolean {
  return typeof value === 'string' && COPILOT_AUTH_REQUIRED_MARKER.test(value.trim());
}

function copilotSessionErrorDetails(data: JsonRecord): Readonly<{ message: string; authRequired: boolean }> {
  const nested = isRecord(data.error) ? data.error : undefined;
  const details = [
    typeof data.message === 'string' ? data.message.trim() : '',
    typeof data.reason === 'string' ? data.reason.trim() : '',
    typeof nested?.message === 'string' ? nested.message.trim() : '',
  ].filter(Boolean);
  const message = details.join('\n');
  const authRequired = [
    data.code,
    data.type,
    data.reason,
    nested?.code,
    nested?.type,
    nested?.reason,
  ].some(isCopilotAuthRequiredMarker) || details.some(isCopilotAuthRequiredText);
  return { message, authRequired };
}

export class CopilotCliAuthRequiredError extends Error {
  readonly code = 'COPILOT_AUTH_REQUIRED' as const;
  readonly type = 'auth-required' as const;

  constructor(message = 'GitHub Copilot CLI requires authentication.') {
    super(message);
    this.name = 'CopilotCliAuthRequiredError';
  }
}

function copilotAuthRequiredError(rawDiagnostic: unknown, workspace: string): CopilotCliAuthRequiredError {
  const diagnostic = redactRunnerDiagnostics(rawDiagnostic, workspace);
  return new CopilotCliAuthRequiredError(diagnostic || 'GitHub Copilot CLI requires authentication.');
}

function normalizedTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(1, Math.floor(timeoutMs)));
}

function childEnvironment(
  source: NodeJS.ProcessEnv,
  overrides: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { CI: '1' };
  for (const key of CLI_CHILD_ENV_ALLOWLIST) {
    const value = overrides[key] ?? source[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

function copilotChildEnvironment(
  source: NodeJS.ProcessEnv,
  overrides: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const environment = childEnvironment(source, overrides);
  for (const key of COPILOT_TOKEN_ENV_ALLOWLIST) {
    const value = overrides[key] ?? source[key];
    if (value !== undefined) environment[key] = value;
  }
  for (const key of COPILOT_CONFIG_ENV_ALLOWLIST) {
    const value = overrides[key] ?? source[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

const DEFAULT_COPILOT_ALLOWED_TOOLS: Readonly<Record<AgentJobMode, readonly string[]>> = {
  'read-only': ['read'],
  'workspace-write': ['read', 'write'],
};

function copilotToolAllowList(mode: AgentJobMode, configured: readonly string[] | undefined): string {
  const tools = configured === undefined
    ? DEFAULT_COPILOT_ALLOWED_TOOLS[mode]
    : [...configured];
  if (tools.length === 0 || tools.length > 32) {
    throw new AgentExecutionUnavailableError('provider-rejected-request', 'Copilot tool permissions must be bounded and explicit.');
  }
  const normalized = tools.map((tool) => tool.trim());
  if (normalized.some((tool) => !/^[A-Za-z][A-Za-z0-9_-]*(?:\([^(),\r\n]{0,180}\))?$/u.test(tool))) {
    throw new AgentExecutionUnavailableError('provider-rejected-request', 'Copilot tool permission pattern is invalid.');
  }
  const kinds = normalized.map((tool) => tool.slice(0, tool.indexOf('(') >= 0 ? tool.indexOf('(') : tool.length).toLowerCase());
  if (normalized.some((tool) => tool.toLowerCase() === 'all' || tool.includes('*'))) {
    throw new AgentExecutionUnavailableError('provider-rejected-request', 'Copilot wildcard tool permissions are not allowed.');
  }
  if (mode === 'read-only' && kinds.some((kind) => kind !== 'read')) {
    throw new AgentExecutionUnavailableError('provider-rejected-request', 'Read-only Copilot jobs may use read tools only.');
  }
  return normalized.join(',');
}

function copilotCommand(
  spec: CliAgentCommandSpec,
  options: CliAgentRunOptions,
  runnerOptions: CliAgentRunnerOptions,
): { executable: string; args: string[] } {
  // Official GitHub Copilot CLI automation uses --prompt for a bounded,
  // non-interactive turn and --output-format json for JSONL. `copilot login`
  // is intentionally absent: authentication is a user action, never a probe
  // or runner side effect.
  const args = [
    ...(spec.prefixArgs ?? []),
    '--prompt',
    options.prompt,
    '--output-format',
    'json',
    '--stream',
    'off',
    '--no-color',
    '--no-auto-update',
    '--no-ask-user',
    `--allow-tool=${copilotToolAllowList(options.mode, runnerOptions.copilotAllowedTools)}`,
    `--secret-env-vars=${GHCP_SECRET_ENV_VARS.join(',')}`,
  ];
  if (options.sessionId) args.push(`--resume=${options.sessionId}`);
  return { executable: spec.executable, args };
}

function defaultCommand(provider: CliAgentProvider): CliAgentCommandSpec {
  if (provider === 'copilot') {
    return ghcpCliCommandFromEnvironment();
  }
  const script = process.env.CODEX_SCRIPT?.trim();
  return {
    executable: process.env.CODEX_BIN?.trim() || 'codex',
    ...(script ? { prefixArgs: [script] } : {}),
  };
}

function eventType(record: JsonRecord): string {
  return typeof record.type === 'string' ? record.type : '';
}

function eventData(record: JsonRecord): JsonRecord {
  return isRecord(record.data) ? record.data : {};
}

function normalizeCodexEvent(event: CodexRunEvent): CliAgentLifecycleEvent | undefined {
  if (event.type === 'thread.started' && event.thread_id) {
    return { provider: 'codex', type: 'session.started', sessionId: event.thread_id };
  }
  if (event.type === 'turn.started') return { provider: 'codex', type: 'turn.started' };
  if (event.type === 'item.started' && event.item?.type === 'command_execution') {
    return { provider: 'codex', type: 'tool.started' };
  }
  if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
    const message = event.item.text?.trim();
    return message ? { provider: 'codex', type: 'agent.message', message } : undefined;
  }
  if (event.type === 'turn.completed') return { provider: 'codex', type: 'turn.completed' };
  return undefined;
}

export class CliAgentRunner {
  private readonly processes = new Map<string, RunningCliProcess>();
  private readonly codexRunner: CodexRunner;

  constructor(private readonly options: CliAgentRunnerOptions = {}) {
    this.codexRunner = new CodexRunner({
      command: options.commands?.codex,
      platform: options.platform,
      processControllerOptions: options.processControllerOptions,
      processControllerProvider: options.processControllerProvider,
      spawn: options.spawn,
      processControllerFactory: options.processControllerFactory,
    });
  }

  async run(runOptions: CliAgentRunOptions): Promise<CliAgentRunResult> {
    if (runOptions.provider !== 'codex' && runOptions.provider !== 'copilot') {
      throw new Error(`Unsupported CLI agent provider: ${String(runOptions.provider)}`);
    }
    if (runOptions.signal?.aborted) throw new Error(`${runOptions.provider} CLI agent execution was cancelled.`);
    if (runOptions.provider === 'codex') {
      const result = await this.codexRunner.run({
        jobId: runOptions.jobId,
        prompt: runOptions.prompt,
        workspace: runOptions.workspace,
        mode: runOptions.mode,
        threadId: runOptions.sessionId,
        isolationLease: runOptions.isolationLease,
        subject: runOptions.subject,
        environmentOverrides: runOptions.environmentOverrides,
        timeoutMs: normalizedTimeout(runOptions.timeoutMs),
        signal: runOptions.signal,
        onEvent: async (event) => {
          const normalized = normalizeCodexEvent(event);
          if (normalized) await runOptions.onEvent?.(normalized);
        },
      });
      return {
        provider: 'codex',
        sessionId: result.threadId,
        finalResult: result.finalMessage,
        eventCount: result.eventCount,
      };
    }
    if (runOptions.sessionId && !SESSION_ID_PATTERN.test(runOptions.sessionId)) {
      throw new Error('Invalid CLI agent session ID.');
    }
    if (runOptions.mode === 'read-only') {
      if (!runOptions.subject || !isAgentIsolationLease(runOptions.isolationLease)) {
        throw new AgentExecutionUnavailableError();
      }
      if (runOptions.isolationLease.workspace !== runOptions.workspace) {
        throw new AgentExecutionUnavailableError('provider-rejected-request', 'CLI agent isolation lease workspace mismatch.');
      }
    }

    const platform = processPlatform(this.options.platform ?? process.platform);
    const controllerOptions: AgentProcessControllerOptions = {
      ...this.options.processControllerOptions,
      platform,
    };
    const injectedController = this.options.processControllerProvider;
    if (platform === 'win32') {
      if (!injectedController) throw new AgentExecutionUnavailableError('process-tree-control-required');
      await injectedController.preflight();
    } else if (!isProcessTreeControllerAvailable(controllerOptions)) {
      throw new AgentExecutionUnavailableError('process-tree-control-required');
    }

    const commandSpec = this.options.commands?.[runOptions.provider] ?? defaultCommand(runOptions.provider);
    let resolvedCommandSpec = commandSpec;
    if (runOptions.provider === 'copilot') {
      const resolution = await resolveGhcpCliExecutable(
        commandSpec.executable,
        normalizedTimeout(runOptions.timeoutMs),
        this.options.resolveGhcpExecutable,
      );
      if (resolution.state === 'missing') {
        throw new AgentExecutionUnavailableError(
          'provider-rejected-request',
          'GitHub Copilot CLI executable was not found.',
        );
      }
      resolvedCommandSpec = { ...commandSpec, executable: resolution.command };
    }
    const command = copilotCommand(resolvedCommandSpec, runOptions, this.options);
    const spawnOptions: AgentIsolationSpawnOptions = {
      cwd: runOptions.workspace,
      env: copilotChildEnvironment(process.env, runOptions.environmentOverrides),
      detached: platform === 'posix',
      stdio: ['ignore', 'pipe', 'pipe'],
    };
    const child = runOptions.mode === 'read-only'
      ? await runOptions.isolationLease!.spawn(runOptions.subject!, command.executable, command.args, spawnOptions)
      : (this.options.spawn ?? ((executable, args, options) => spawn(executable, [...args], options as any)))(
        command.executable,
        command.args,
        spawnOptions,
      );
    const processController = injectedController
      ? await injectedController.attach(child)
      : this.options.processControllerFactory
        ? this.options.processControllerFactory(child, controllerOptions)
        : createAgentProcessTreeController(child, controllerOptions);
    if (!processController) throw new AgentExecutionUnavailableError('process-tree-control-required');

    let sessionId: string | undefined;
    let finalResult = '';
    let eventCount = 0;
    let stdoutBuffer = '';
    let stderr = '';
    let completed = false;
    let turnStarted = false;
    let eventQueue = Promise.resolve();
    let terminationError: Error | undefined;
    let resolveTermination!: (error: Error) => void;
    const terminationPromise = new Promise<Error>((resolve) => { resolveTermination = resolve; });
    const timeoutMs = normalizedTimeout(runOptions.timeoutMs);

    const terminate = (error: Error): void => {
      if (terminationError) return;
      terminationError = error;
      resolveTermination(error);
      processController.requestTermination();
    };
    const runningProcess: RunningCliProcess = { provider: runOptions.provider, terminate };
    this.processes.set(runOptions.jobId, runningProcess);

    const queueEvent = (event: CliAgentLifecycleEvent): void => {
      eventQueue = eventQueue.then(() => runOptions.onEvent?.(event));
      void eventQueue.catch((error) => terminate(error instanceof Error ? error : new Error(String(error))));
    };

    const observe = (record: JsonRecord): void => {
      const type = eventType(record);
      const data = eventData(record);
      if (!type) return terminate(new Error('CLI agent JSONL event type is missing.'));
      if (completed) {
        if (COPILOT_POST_TERMINAL_METADATA.has(type)) return;
        return terminate(new Error('CLI agent emitted a lifecycle event after turn completion.'));
      }

      if (type === 'session.error') {
        const details = copilotSessionErrorDetails(data);
        if (details.authRequired) return terminate(copilotAuthRequiredError(details.message, runOptions.workspace));
        return terminate(new Error(
          redactRunnerDiagnostics(details.message, runOptions.workspace) || 'GitHub Copilot CLI reported a session error.',
        ));
      }
      if (type === 'session.start') {
        const value = typeof data.sessionId === 'string' ? data.sessionId : '';
        if (sessionId || !SESSION_ID_PATTERN.test(value)) return terminate(new Error('GitHub Copilot CLI session.start is invalid.'));
        sessionId = value;
        queueEvent({ provider: 'copilot', type: 'session.started', sessionId: value });
        return;
      }
      if (type === 'assistant.turn_start') {
        if (!sessionId || turnStarted) return terminate(new Error('GitHub Copilot CLI turn start ordering is invalid.'));
        turnStarted = true;
        queueEvent({ provider: 'copilot', type: 'turn.started' });
        return;
      }
      if (type === 'assistant.message') {
        if (!turnStarted) return terminate(new Error('GitHub Copilot CLI assistant message ordering is invalid.'));
        const message = typeof data.content === 'string' ? data.content.trim() : '';
        if (message) {
          if (message.length > MAX_AGENT_RESULT_LENGTH) return terminate(new Error('CLI agent final result exceeded safe limit.'));
          finalResult = message;
          queueEvent({ provider: 'copilot', type: 'agent.message', message });
        }
        return;
      }
      if (type === 'tool.execution_start') {
        if (!turnStarted) return terminate(new Error('GitHub Copilot CLI tool ordering is invalid.'));
        queueEvent({ provider: 'copilot', type: 'tool.started' });
        return;
      }
      if (type === 'assistant.turn_end') {
        if (!turnStarted || !finalResult) return terminate(new Error('GitHub Copilot CLI must emit a non-empty final assistant.message result.'));
        completed = true;
        queueEvent({ provider: 'copilot', type: 'turn.completed' });
        return;
      }
      // Other documented JSONL records are progress metadata. They count
      // toward the bounded stream but do not widen the normalized interface.
    };

    const handleLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed) return terminate(new Error('CLI agent emitted a blank JSONL record.'));
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return terminate(new Error('CLI agent emitted malformed JSONL.'));
      }
      if (!isRecord(parsed)) return terminate(new Error('CLI agent JSONL records must be objects.'));
      if (eventCount >= MAX_EVENT_COUNT) return terminate(new Error('CLI agent event count exceeded safe limit.'));
      eventCount += 1;
      observe(parsed);
    };

    const handleStdout = (chunk: string): void => {
      if (terminationError) return;
      const records = `${stdoutBuffer}${chunk}`.split('\n');
      stdoutBuffer = records.pop() ?? '';
      if (stdoutBuffer.length > MAX_STDOUT_BUFFER_CHARS) return terminate(new Error('CLI agent stdout buffer exceeded safe limit.'));
      for (const record of records) {
        if (record.length > MAX_STDOUT_BUFFER_CHARS) return terminate(new Error('CLI agent stdout record exceeded safe limit.'));
        handleLine(record);
        if (terminationError) return;
      }
    };

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', handleStdout);
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length + chunk.length > MAX_STDERR_CHARS) return terminate(new Error('CLI agent stderr exceeded safe limit.'));
      stderr += chunk;
    });

    const abort = (): void => terminate(new Error('CLI agent execution was cancelled.'));
    runOptions.signal?.addEventListener('abort', abort, { once: true });
    if (runOptions.signal?.aborted) abort();
    let timeoutHandle: NodeJS.Timeout | undefined;
    let primaryError: Error | undefined;
    try {
      const exitResult = await Promise.race([
        new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
          child.once('error', reject);
          child.once('close', (code, signal) => resolve({ code, signal }));
          timeoutHandle = setTimeout(() => terminate(new Error(`CLI agent exceeded the ${timeoutMs}ms time limit.`)), timeoutMs);
          timeoutHandle.unref();
        }),
        terminationPromise.then((error) => { throw error; }),
      ]);
      if (stdoutBuffer) handleLine(stdoutBuffer);
      await Promise.race([eventQueue, terminationPromise.then((error) => { throw error; })]);
      if (terminationError) throw terminationError;
      if (exitResult.signal || exitResult.code !== 0) {
        const rawDiagnostic = stderr.trim();
        if (runOptions.provider === 'copilot' && isCopilotAuthRequiredText(rawDiagnostic)) {
          throw copilotAuthRequiredError(rawDiagnostic, runOptions.workspace);
        }
        const diagnostic = redactRunnerDiagnostics(rawDiagnostic, runOptions.workspace);
        throw new Error(diagnostic || `CLI agent exited with code ${exitResult.code ?? 'signal'}.`);
      }
      if (!completed || !finalResult) throw new Error('CLI agent did not emit a non-empty final result.');
      return { provider: runOptions.provider, sessionId, finalResult, eventCount };
    } catch (error) {
      primaryError = error instanceof Error ? error : new Error(String(error));
      throw primaryError;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      runOptions.signal?.removeEventListener('abort', abort);
      try {
        await processController.cleanup();
      } catch (cleanupError) {
        if (!primaryError) throw cleanupError;
      }
      if (this.processes.get(runOptions.jobId) === runningProcess) this.processes.delete(runOptions.jobId);
    }
  }

  cancel(jobId: string): boolean {
    const running = this.processes.get(jobId);
    if (!running) return this.codexRunner.cancel(jobId);
    running.terminate(new Error(`${running.provider} CLI agent execution was cancelled.`));
    return true;
  }

  close(): void {
    this.codexRunner.close();
    for (const running of this.processes.values()) {
      running.terminate(new Error(`${running.provider} CLI agent runner is closing.`));
    }
  }
}
