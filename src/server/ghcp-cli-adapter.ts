import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

import { redactCliDiagnostics } from './cli-diagnostics.js';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 1_500;
const MAX_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_CHARS = 8_192;
// Keep the child-process buffer larger than the redacted diagnostic limit.
// The official Copilot CLI help output is currently larger than 8 KiB; using
// the diagnostic limit as maxBuffer turns a successful --help into an error.
const MAX_PROCESS_BUFFER_CHARS = 64 * 1024;
const DEFAULT_HELP_ARGS = ['--help'] as const;
export const GHCP_CAPABILITY_SENTINEL = 'GHCP_CAPABILITY_OK';
export const GHCP_CAPABILITY_PROMPT = `Respond with exactly ${GHCP_CAPABILITY_SENTINEL}.`;
export const GHCP_SECRET_ENV_VARS = [
  'COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN',
] as const;
export const GHCP_CAPABILITY_ARGS = [
  '--prompt', GHCP_CAPABILITY_PROMPT,
  '--output-format', 'json',
  '--stream', 'off',
  '--no-color', '--no-auto-update', '--no-ask-user',
  '--allow-tool=read',
  `--secret-env-vars=${GHCP_SECRET_ENV_VARS.join(',')}`,
] as const;

// Keep health discovery aligned with the official runner's normalized JSONL
// lifecycle. These records may arrive after assistant.turn_end and are
// metadata, not a second assistant turn.
const GHCP_POST_TERMINAL_METADATA = new Set([
  'assistant.usage',
  'session.idle',
  'session.info',
  'session.shutdown',
  'session.usage_info',
  'session.warning',
]);

const GHCP_CLI_CAPABILITY_STATES = [
  'available',
  'missing',
  'auth-required',
  'policy-blocked',
  'execution-failed',
  'unknown',
] as const;

export const GHCP_CLI_EXECUTABLE_STATES = ['present', 'absent', 'unknown'] as const;
export const GHCP_CLI_PROBE_STATES = ['passed', 'not-run', 'failed', 'unknown'] as const;
export const GHCP_CLI_AUTHENTICATION_STATES = ['authenticated', 'not-authenticated', 'unknown'] as const;
export const GHCP_CLI_ENTITLEMENT_STATES = ['allowed', 'blocked', 'unknown'] as const;

type ExecFileFailure = Error & {
  code?: string | number;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
};

export type GhcpCliCapabilityState = (typeof GHCP_CLI_CAPABILITY_STATES)[number];
export type GhcpCliExecutableState = (typeof GHCP_CLI_EXECUTABLE_STATES)[number];
export type GhcpCliProbeState = (typeof GHCP_CLI_PROBE_STATES)[number];
export type GhcpCliAuthenticationState = (typeof GHCP_CLI_AUTHENTICATION_STATES)[number];
export type GhcpCliEntitlementState = (typeof GHCP_CLI_ENTITLEMENT_STATES)[number];
export type GhcpCliProcessOutcome = 'success' | 'exit' | 'missing' | 'timeout' | 'error';

export type GhcpCliExecutableResolution =
  | Readonly<{
    state: 'resolved';
    command: string;
  }>
  | Readonly<{
    state: 'missing';
    command: string;
    diagnostics?: string;
  }>;

export type GhcpCliCommandSpec = Readonly<{
  executable: string;
  prefixArgs?: readonly string[];
}>;

export function ghcpCliCommandFromEnvironment(environment: NodeJS.ProcessEnv = process.env): GhcpCliCommandSpec {
  const script = environment.GHCP_SCRIPT?.trim();
  return {
    executable: environment.GHCP_BIN?.trim() || 'copilot',
    ...(script ? { prefixArgs: [script] } : {}),
  };
}

export type GhcpCliProcessResult = Readonly<{
  outcome: GhcpCliProcessOutcome;
  exitCode?: number;
  elapsedMs?: number;
  stdout?: string;
  stderr?: string;
}>;

export type GhcpCliProcessRunner = (
  command: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<GhcpCliProcessResult>;

export type GhcpCliExecutableResolver = (
  command: string,
  timeoutMs: number,
) => Promise<GhcpCliExecutableResolution>;

export type GhcpCliProbeStep = Readonly<{
  stage: 'help' | 'capability';
  command: string;
  args: readonly string[];
  outcome: GhcpCliProcessOutcome;
  exitStatus: number | null;
  elapsedMs: number;
  stdout: string;
  stderr: string;
}>;

export type GhcpCliCapabilityProbe = Readonly<{
  state: GhcpCliCapabilityState;
  executable: GhcpCliExecutableState;
  probe: GhcpCliProbeState;
  authentication: GhcpCliAuthenticationState;
  entitlement: GhcpCliEntitlementState;
  requestedCommand: string;
  resolvedCommand?: string;
  steps: readonly GhcpCliProbeStep[];
  summary: string;
}>;

export type ProbeGitHubCopilotCliCapabilityOptions = Readonly<{
  executable?: string;
  prefixArgs?: readonly string[];
  helpArgs?: readonly string[];
  capabilityArgs?: readonly string[] | null;
  timeoutMs?: number;
  homeDirectory?: string;
  resolveExecutable?: GhcpCliExecutableResolver;
  runProcess?: GhcpCliProcessRunner;
}>;

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(100, Math.floor(value)));
}

function assertNonInteractiveProbeArgs(args: readonly string[] | null): void {
  if (!args) return;
  if (args.some((arg) => /^(?:--?)?\/?login(?:=|$)/iu.test(arg.trim()))) {
    throw new Error('GitHub Copilot CLI health probe must not invoke login.');
  }
}

function truncateOutput(value: string | Buffer | undefined): string {
  return typeof value === 'string'
    ? value.slice(0, MAX_OUTPUT_CHARS)
    : value?.toString('utf8').slice(0, MAX_OUTPUT_CHARS) ?? '';
}

async function defaultResolveExecutable(command: string, timeoutMs: number): Promise<GhcpCliExecutableResolution> {
  const locator = process.platform === 'win32' ? 'where' : 'which';

  try {
    const { stdout } = await execFileAsync(locator, [command], {
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT_CHARS,
      windowsHide: true,
    });
    const resolved = stdout.split(/\r?\n/u).map((line) => line.trim()).find(Boolean);
    return resolved ? { state: 'resolved', command: resolved } : { state: 'missing', command };
  } catch (caught) {
    const error = caught as ExecFileFailure;
    if (typeof error.code === 'number' || error.code === 'ENOENT') {
      return { state: 'missing', command, diagnostics: truncateOutput(error.stderr) || truncateOutput(error.stdout) };
    }
    return { state: 'resolved', command };
  }
}

const executableResolutionCaches = new WeakMap<object, Map<string, Promise<GhcpCliExecutableResolution>>>();

function immutableExecutableResolution(
  resolution: GhcpCliExecutableResolution,
): GhcpCliExecutableResolution {
  return Object.freeze({ ...resolution });
}

/**
 * Resolve a GHCP command once per resolver/requested command and reuse that
 * immutable identity for both health probes and execution. This prevents a
 * later PATH mutation from selecting a different Copilot executable.
 */
export async function resolveGhcpCliExecutable(
  command: string,
  timeoutMs: number,
  resolver: GhcpCliExecutableResolver = defaultResolveExecutable,
): Promise<GhcpCliExecutableResolution> {
  const requestedCommand = command.trim() || 'copilot';
  let cache = executableResolutionCaches.get(resolver);
  if (!cache) {
    cache = new Map();
    executableResolutionCaches.set(resolver, cache);
  }
  const existing = cache.get(requestedCommand);
  if (existing) return existing;

  const promise = Promise.resolve()
    .then(() => resolver(requestedCommand, timeoutMs))
    .then(immutableExecutableResolution);
  cache.set(requestedCommand, promise);
  void promise.catch(() => {
    if (cache?.get(requestedCommand) === promise) cache.delete(requestedCommand);
  });
  return promise;
}

async function defaultRunProcess(command: string, args: readonly string[], timeoutMs: number): Promise<GhcpCliProcessResult> {
  const startedAt = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync(command, [...args], {
      timeout: timeoutMs,
      maxBuffer: MAX_PROCESS_BUFFER_CHARS,
      windowsHide: true,
    });
    return {
      outcome: 'success',
      elapsedMs: Date.now() - startedAt,
      stdout: truncateOutput(stdout),
      stderr: truncateOutput(stderr),
    };
  } catch (caught) {
    const error = caught as ExecFileFailure;
    const elapsedMs = Date.now() - startedAt;

    if (error.code === 'ENOENT') {
      return { outcome: 'missing', elapsedMs };
    }
    if (error.code === 'ETIMEDOUT' || error.killed || error.signal === 'SIGTERM') {
      return {
        outcome: 'timeout',
        elapsedMs,
        stdout: truncateOutput(error.stdout),
        stderr: truncateOutput(error.stderr),
      };
    }
    if (typeof error.code === 'number') {
      return {
        outcome: 'exit',
        exitCode: error.code,
        elapsedMs,
        stdout: truncateOutput(error.stdout),
        stderr: truncateOutput(error.stderr),
      };
    }

    return {
      outcome: 'error',
      elapsedMs,
      stdout: truncateOutput(error.stdout),
      stderr: truncateOutput(error.stderr ?? error.message),
    };
  }
}

function normalizeStep(
  stage: GhcpCliProbeStep['stage'],
  command: string,
  args: readonly string[],
  result: GhcpCliProcessResult,
  homeDirectory: string,
): GhcpCliProbeStep {
  return {
    stage,
    command,
    args: [...args],
    outcome: result.outcome,
    exitStatus: result.exitCode ?? null,
    elapsedMs: result.elapsedMs ?? 0,
    stdout: redactCliDiagnostics(result.stdout, { paths: [homeDirectory], maxChars: MAX_OUTPUT_CHARS }),
    stderr: redactCliDiagnostics(result.stderr, { paths: [homeDirectory], maxChars: MAX_OUTPUT_CHARS }),
  };
}

function combinedDiagnostics(step: GhcpCliProbeStep): string {
  return `${step.stdout}\n${step.stderr}`.toLowerCase();
}

function isAuthRequired(step: GhcpCliProbeStep): boolean {
  return /(not logged in|not authenticated|unauthenticated|authentication required|login required|please run .*login|one-time code|device code|user code)/iu.test(
    combinedDiagnostics(step),
  );
}

function isPolicyBlocked(step: GhcpCliProbeStep): boolean {
  return /(?:organization policy|enterprise policy|policy.{0,40}(?:block|deny|disable|restrict)|(?:copilot|feature|capability).{0,40}disabled|disabled.{0,40}(?:copilot|feature|capability)|(?:license|licence).{0,40}(?:required|missing|expired|unavailable|not entitled)|no (?:active )?(?:license|licence)|not entitled)/iu.test(
    combinedDiagnostics(step),
  );
}

function isUnsupported(step: GhcpCliProbeStep): boolean {
  return /(unknown command|unsupported|not found)/iu.test(combinedDiagnostics(step));
}

function classifyFailure(step: GhcpCliProbeStep): GhcpCliCapabilityState {
  if (step.outcome === 'missing') return 'missing';
  if (step.outcome === 'timeout') return 'unknown';
  if (step.outcome === 'error') return 'execution-failed';
  if (step.outcome === 'exit') {
    if (isAuthRequired(step)) return 'auth-required';
    if (isPolicyBlocked(step)) return 'policy-blocked';
    if (isUnsupported(step)) return 'unknown';
    return 'execution-failed';
  }
  return 'unknown';
}

function classifyCapabilityStep(step: GhcpCliProbeStep): GhcpCliCapabilityState {
  if (isAuthRequired(step)) return 'auth-required';
  if (isPolicyBlocked(step)) return 'policy-blocked';
  // A zero exit status only proves that the command completed. Human-readable
  // output such as "authenticated", "ready", or "status: ok" is not a
  // provider attestation and must not be promoted to available/authenticated.
  // The selected JSONL capability probe is the only success path that can
  // prove the bounded capability (see isSuccessfulJsonlCapabilityProbe).
  if (step.outcome === 'success') return 'unknown';
  return classifyFailure(step);
}

function isSuccessfulJsonlCapabilityProbe(step: GhcpCliProbeStep): boolean {
  if (step.outcome !== 'success') return false;
  if (isAuthRequired(step) || isPolicyBlocked(step)) return false;
  const records = step.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  let stage: 'session' | 'turn' | 'message' | 'end' | 'terminal' = 'session';
  try {
    for (const line of records) {
      const record = JSON.parse(line) as { type?: unknown; data?: Record<string, unknown> };
      if (!record || typeof record !== 'object' || typeof record.type !== 'string') return false;
      if (record.type === 'session.error') return false;
      if (stage === 'session') {
        if (record.type !== 'session.start' || typeof record.data?.sessionId !== 'string') return false;
        stage = 'turn';
      } else if (stage === 'turn') {
        if (record.type !== 'assistant.turn_start') return false;
        stage = 'message';
      } else if (stage === 'message') {
        if (
          record.type !== 'assistant.message'
          || typeof record.data?.content !== 'string'
          || record.data.content.trim() !== GHCP_CAPABILITY_SENTINEL
        ) return false;
        stage = 'end';
      } else if (stage === 'end') {
        if (record.type !== 'assistant.turn_end') return false;
        stage = 'terminal';
      } else if (!GHCP_POST_TERMINAL_METADATA.has(record.type)) {
        return false;
      }
    }
  } catch {
    return false;
  }
  return stage === 'terminal';
}

function summaryForState(state: GhcpCliCapabilityState): string {
  switch (state) {
    case 'available':
      return 'GitHub Copilot CLI capability probe succeeded.';
    case 'missing':
      return 'GitHub Copilot CLI executable was not found.';
    case 'auth-required':
      return 'GitHub Copilot CLI is installed, but the selected read-only probe requires authentication.';
    case 'policy-blocked':
      return 'GitHub Copilot CLI is installed, but policy, license, or entitlement blocks the selected read-only capability probe.';
    case 'execution-failed':
      return 'GitHub Copilot CLI probe failed without proving an authenticated capability.';
    case 'unknown':
    default:
      return 'GitHub Copilot CLI probe remained inconclusive.';
  }
}

function probeDimensions(
  state: GhcpCliCapabilityState,
  steps: readonly GhcpCliProbeStep[],
): Pick<GhcpCliCapabilityProbe, 'executable' | 'probe' | 'authentication' | 'entitlement'> {
  const capabilityStep = steps.find((step) => step.stage === 'capability');

  return {
    executable: state === 'missing' ? 'absent' : 'present',
    probe: state === 'available'
      ? 'passed'
      : capabilityStep
        ? state === 'unknown' ? 'unknown' : 'failed'
        : 'not-run',
    authentication: state === 'available'
      ? 'authenticated'
      : state === 'auth-required'
        ? 'not-authenticated'
        : 'unknown',
    entitlement: state === 'available'
      ? 'allowed'
      : state === 'policy-blocked'
        ? 'blocked'
        : 'unknown',
  };
}

function withProbeDimensions(
  result: Omit<GhcpCliCapabilityProbe, 'executable' | 'probe' | 'authentication' | 'entitlement'>,
): GhcpCliCapabilityProbe {
  return {
    ...result,
    ...probeDimensions(result.state, result.steps),
  };
}

export async function probeGitHubCopilotCliCapability(
  options: ProbeGitHubCopilotCliCapabilityOptions = {},
): Promise<GhcpCliCapabilityProbe> {
  const requestedCommand = options.executable?.trim() || 'copilot';
  const helpArgs = [...(options.prefixArgs ?? []), ...(options.helpArgs ? options.helpArgs : DEFAULT_HELP_ARGS)];
  // The official `copilot` executable documents `--prompt` for programmatic
  // execution and `--output-format json` for JSONL output, but it does not
  // expose a non-interactive authentication-status command. A health probe
  // therefore runs `--help` followed by a bounded capability turn: help proves
  // presence, while only the exact sentinel proves this selected capability.
  // The probe must not automate the interactive `copilot login` command.
  const capabilityArgs = options.capabilityArgs === undefined
    ? [...(options.prefixArgs ?? []), ...GHCP_CAPABILITY_ARGS]
    : options.capabilityArgs === null
      ? null
      : [...(options.prefixArgs ?? []), ...options.capabilityArgs];
  assertNonInteractiveProbeArgs(helpArgs);
  assertNonInteractiveProbeArgs(capabilityArgs);
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const runProcess = options.runProcess ?? defaultRunProcess;
  const homeDirectory = options.homeDirectory ?? process.env.HOME ?? os.homedir();

  const resolution = await resolveGhcpCliExecutable(requestedCommand, timeoutMs, options.resolveExecutable);
  if (resolution.state === 'missing') {
    return withProbeDimensions({
      state: 'missing',
      requestedCommand,
      steps: [],
      summary: summaryForState('missing'),
    });
  }

  const helpResult = await runProcess(resolution.command, helpArgs, timeoutMs);
  const steps: GhcpCliProbeStep[] = [normalizeStep('help', resolution.command, helpArgs, helpResult, homeDirectory)];
  if (helpResult.outcome !== 'success') {
    const state = classifyFailure(steps[0]);
    return withProbeDimensions({
      state,
      requestedCommand,
      resolvedCommand: resolution.command,
      steps,
      summary: summaryForState(state),
    });
  }

  if (capabilityArgs === null || capabilityArgs.length === 0) {
    return withProbeDimensions({
      state: 'unknown',
      requestedCommand,
      resolvedCommand: resolution.command,
      steps,
      summary: summaryForState('unknown'),
    });
  }

  const capabilityResult = await runProcess(resolution.command, capabilityArgs, timeoutMs);
  const capabilityStep = normalizeStep('capability', resolution.command, capabilityArgs, capabilityResult, homeDirectory);
  steps.push(capabilityStep);

  const state = isSuccessfulJsonlCapabilityProbe(capabilityStep)
    ? 'available'
    : classifyCapabilityStep(capabilityStep);

  return withProbeDimensions({
    state,
    requestedCommand,
    resolvedCommand: resolution.command,
    steps,
    summary: summaryForState(state),
  });
}
