import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ghcpCliCommandFromEnvironment,
  probeGitHubCopilotCliCapability,
  type GhcpCliExecutableResolver,
  type GhcpCliCapabilityProbe,
} from './ghcp-cli-adapter.js';

const execFileAsync = promisify(execFile);
const DEFAULT_PROBE_TIMEOUT_MS = 1_500;
const MAX_PROBE_TIMEOUT_MS = 2_000;
const MAX_PROBE_OUTPUT_CHARS = 8_192;
const CAPABILITY_CACHE_TTL_MS = 15_000;
export const GHCP_CAPABILITY_PROBE_ENV = 'TEAMS_GHCP_CAPABILITY_PROBE';

export const CLI_CAPABILITY_STATES = ['available', 'unavailable', 'unknown'] as const;
export const CLI_EXECUTABLE_STATES = ['present', 'absent', 'unknown'] as const;
export const CLI_LOGIN_STATES = ['authenticated', 'not-authenticated', 'unknown'] as const;
export const CLI_PROBE_STATES = ['passed', 'not-run', 'failed', 'unknown'] as const;
export const CLI_ENTITLEMENT_STATES = ['allowed', 'blocked', 'unknown'] as const;
export const CLI_CAPABILITY_REASONS = [
  'verified',
  'missing',
  'auth-required',
  'policy-blocked',
  'execution-failed',
  'unknown',
] as const;

export type CliCapabilityState = (typeof CLI_CAPABILITY_STATES)[number];
export type CliExecutableState = (typeof CLI_EXECUTABLE_STATES)[number];
export type CliLoginState = (typeof CLI_LOGIN_STATES)[number];
export type CliProbeState = (typeof CLI_PROBE_STATES)[number];
export type CliEntitlementState = (typeof CLI_ENTITLEMENT_STATES)[number];
export type CliCapabilityReason = (typeof CLI_CAPABILITY_REASONS)[number];

export type CliCapability = Readonly<{
  state: CliCapabilityState;
  executable: CliExecutableState;
  probe: CliProbeState;
  authentication: CliLoginState;
  login: CliLoginState;
  entitlement: CliEntitlementState;
  reason: CliCapabilityReason;
}>;

export type CliCommandResult = Readonly<{
  outcome: 'success' | 'exit' | 'missing' | 'timeout' | 'error';
  exitCode?: number;
  stdout?: string;
  stderr?: string;
}>;

export type CliCommandRunner = (
  command: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<CliCommandResult>;

export type CliCommandSpec = Readonly<{
  command: string;
  args?: readonly string[];
}>;

export type CliCapabilities = Readonly<{
  codex: CliCapability;
  ghcp: CliCapability;
}>;

export type ProbeCliCapabilitiesOptions = Readonly<{
  codexCommand?: CliCommandSpec;
  ghcpCommand?: CliCommandSpec;
  /** Opt in to a bounded GHCP turn; --help remains the default presence check. */
  ghcpCapabilityProbe?: boolean;
  resolveExecutable?: GhcpCliExecutableResolver;
  environment?: NodeJS.ProcessEnv;
  runCommand?: CliCommandRunner;
  timeoutMs?: number;
  now?: () => number;
}>;

type ExecFileFailure = Error & {
  code?: string | number;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
  stdout?: string | Buffer;
  stderr?: string | Buffer;
};

function outputOf(value: string | Buffer | undefined): string {
  return typeof value === 'string' ? value.slice(0, MAX_PROBE_OUTPUT_CHARS) : value?.toString('utf8').slice(0, MAX_PROBE_OUTPUT_CHARS) ?? '';
}

async function runCommand(
  command: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<CliCommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, [...args], {
      timeout: timeoutMs,
      maxBuffer: MAX_PROBE_OUTPUT_CHARS,
      windowsHide: true,
    });
    return {
      outcome: 'success',
      stdout: outputOf(stdout),
      stderr: outputOf(stderr),
    };
  } catch (caught) {
    const error = caught as ExecFileFailure;
    if (error.code === 'ENOENT') return { outcome: 'missing' };
    if (error.code === 'ETIMEDOUT' || error.killed || error.signal === 'SIGTERM') {
      return { outcome: 'timeout' };
    }
    if (typeof error.code === 'number') {
      return {
        outcome: 'exit',
        exitCode: error.code,
        stdout: outputOf(error.stdout),
        stderr: outputOf(error.stderr),
      };
    }
    return {
      outcome: 'error',
      stdout: outputOf(error.stdout),
      stderr: outputOf(error.stderr),
    };
  }
}

function normalizedSpec(spec: CliCommandSpec | undefined, fallback: string, args: readonly string[] = []): CliCommandSpec {
  const command = spec?.command.trim() || fallback;
  return { command, args: [...(spec?.args ?? args)] };
}

function normalizedTimeout(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined) return DEFAULT_PROBE_TIMEOUT_MS;
  return Math.min(MAX_PROBE_TIMEOUT_MS, Math.max(100, Math.floor(value)));
}

function enabledByEnvironment(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

const CODEX_AUTHENTICATED_STATUS = new Set([
  'Logged in using an API key',
  'Logged in using ChatGPT',
  'Logged in using Agent Identity',
]);
const CODEX_NOT_AUTHENTICATED_STATUS = 'Not logged in';

function codexStatusText(result: CliCommandResult): string {
  return [result.stdout, result.stderr]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.replace(/\r\n/gu, '\n').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function codexAuthenticationState(result: CliCommandResult): CliLoginState {
  const status = codexStatusText(result);
  if (CODEX_AUTHENTICATED_STATUS.has(status)) return 'authenticated';
  if (status === CODEX_NOT_AUTHENTICATED_STATUS) return 'not-authenticated';
  return 'unknown';
}

function createCapability(
  capability: Omit<CliCapability, 'login'>,
): CliCapability {
  return { ...capability, login: capability.authentication };
}

function unknown(
  executable: CliExecutableState = 'unknown',
  authentication: CliLoginState = 'unknown',
  options: Partial<Pick<CliCapability, 'probe' | 'entitlement' | 'reason'>> = {},
): CliCapability {
  return createCapability({
    state: 'unknown',
    executable,
    probe: options.probe ?? 'unknown',
    authentication,
    entitlement: options.entitlement ?? 'unknown',
    reason: options.reason ?? 'unknown',
  });
}

function codexCapability(result: CliCommandResult): CliCapability {
  if (result.outcome === 'missing') {
    return createCapability({
      state: 'unavailable',
      executable: 'absent',
      probe: 'not-run',
      authentication: 'unknown',
      entitlement: 'unknown',
      reason: 'missing',
    });
  }
  const authentication = codexAuthenticationState(result);
  if (authentication === 'not-authenticated' && (result.outcome === 'success' || result.outcome === 'exit')) {
    return createCapability({
      state: 'unavailable',
      executable: 'present',
      probe: 'failed',
      authentication: 'not-authenticated',
      entitlement: 'unknown',
      reason: 'auth-required',
    });
  }
  if (result.outcome === 'success' && authentication === 'authenticated') {
    // `codex login status` is an official, non-interactive authentication
    // check. It does not prove a bounded agent turn or an entitlement, so
    // keep the overall capability state conservative.
    return createCapability({
      state: 'unknown',
      executable: 'present',
      probe: 'not-run',
      authentication: 'authenticated',
      entitlement: 'unknown',
      reason: 'unknown',
    });
  }
  return unknown(result.outcome === 'error' ? 'unknown' : 'present', 'unknown', {
    probe: result.outcome === 'exit'
      ? 'failed'
      : result.outcome === 'success' ? 'not-run' : 'unknown',
    reason: result.outcome === 'error' || result.outcome === 'exit' ? 'execution-failed' : 'unknown',
  });
}

export function normalizeCliCapability(value: unknown): CliCapability {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unknown();
  const candidate = value as Record<string, unknown>;
  const state = CLI_CAPABILITY_STATES.includes(candidate.state as CliCapabilityState)
    ? candidate.state as CliCapabilityState
    : 'unknown';
  const executable = CLI_EXECUTABLE_STATES.includes(candidate.executable as CliExecutableState)
    ? candidate.executable as CliExecutableState
    : 'unknown';
  const authentication = CLI_LOGIN_STATES.includes(candidate.authentication as CliLoginState)
    ? candidate.authentication as CliLoginState
    : CLI_LOGIN_STATES.includes(candidate.login as CliLoginState)
      ? candidate.login as CliLoginState
    : 'unknown';
  const probe = CLI_PROBE_STATES.includes(candidate.probe as CliProbeState)
    ? candidate.probe as CliProbeState
    : 'unknown';
  const entitlement = CLI_ENTITLEMENT_STATES.includes(candidate.entitlement as CliEntitlementState)
    ? candidate.entitlement as CliEntitlementState
    : 'unknown';
  const reason = CLI_CAPABILITY_REASONS.includes(candidate.reason as CliCapabilityReason)
    ? candidate.reason as CliCapabilityReason
    : 'unknown';
  const normalized = createCapability({
    state,
    executable,
    probe,
    authentication,
    entitlement,
    reason,
  });

  if (
    state === 'available'
    && (executable !== 'present' || probe !== 'passed' || authentication !== 'authenticated' || entitlement !== 'allowed')
  ) {
    return unknown(executable, authentication, { probe, entitlement });
  }
  if (state === 'unavailable' && executable === 'present' && authentication === 'authenticated' && entitlement !== 'blocked') {
    return unknown(executable, authentication, { probe, entitlement });
  }
  return normalized;
}

function ghcpCapability(probe: GhcpCliCapabilityProbe): CliCapability {
  const state: CliCapabilityState = probe.state === 'available'
    ? 'available'
    : probe.state === 'missing' || probe.state === 'auth-required' || probe.state === 'policy-blocked'
      ? 'unavailable'
      : 'unknown';
  const reason: CliCapabilityReason = probe.state === 'available' ? 'verified' : probe.state;

  return createCapability({
    state,
    executable: probe.executable,
    probe: probe.probe,
    authentication: probe.authentication,
    entitlement: probe.entitlement,
    reason,
  });
}

export function unknownCliCapabilities(): CliCapabilities {
  return {
    codex: unknown(),
    ghcp: unknown('unknown', 'unknown', { probe: 'not-run', reason: 'unknown' }),
  };
}

type CapabilityCacheEntry = Readonly<{
  expiresAt: number;
  promise: Promise<CliCapabilities>;
}>;

const capabilityCache = new Map<string, CapabilityCacheEntry>();
const runnerIdentity = new WeakMap<object, number>();
let nextRunnerIdentity = 1;

function stableFunctionIdentity(value: object | undefined, fallback: string): string {
  if (!value) return fallback;
  const existing = runnerIdentity.get(value);
  if (existing !== undefined) return `injected-${existing}`;
  const identity = nextRunnerIdentity++;
  runnerIdentity.set(value, identity);
  return `injected-${identity}`;
}

function capabilityCacheKey(input: {
  environment: NodeJS.ProcessEnv;
  codexCommand: CliCommandSpec;
  ghcpCommand: CliCommandSpec;
  ghcpCapabilityProbe: boolean;
  timeoutMs: number;
  runner: CliCommandRunner;
  resolveExecutable?: GhcpCliExecutableResolver;
}): string {
  return JSON.stringify({
    codex: input.codexCommand,
    ghcp: input.ghcpCommand,
    ghcpCapabilityProbe: input.ghcpCapabilityProbe,
    timeoutMs: input.timeoutMs,
    runner: stableFunctionIdentity(input.runner, 'default-runner'),
    resolver: stableFunctionIdentity(input.resolveExecutable, 'default-resolver'),
    environment: {
      CODEX_BIN: input.environment.CODEX_BIN ?? '',
      CODEX_SCRIPT: input.environment.CODEX_SCRIPT ?? '',
      GHCP_BIN: input.environment.GHCP_BIN ?? '',
      GHCP_SCRIPT: input.environment.GHCP_SCRIPT ?? '',
    },
  });
}

async function probeCliCapabilitiesUncached(options: ProbeCliCapabilitiesOptions): Promise<CliCapabilities> {
  const environment = options.environment ?? process.env;
  const codexCommand = normalizedSpec(
    options.codexCommand,
    environment.CODEX_BIN?.trim() || 'codex',
    environment.CODEX_SCRIPT?.trim() ? [environment.CODEX_SCRIPT.trim()] : [],
  );
  const ghcpEnvironmentCommand = ghcpCliCommandFromEnvironment(environment);
  const ghcpCommand = options.ghcpCommand
    ? normalizedSpec(options.ghcpCommand, 'copilot')
    : { command: ghcpEnvironmentCommand.executable, args: [...(ghcpEnvironmentCommand.prefixArgs ?? [])] };
  const ghcpPrefixArgs = ghcpCommand.args;
  const ghcpCapabilityProbe = options.ghcpCapabilityProbe
    ?? enabledByEnvironment(environment[GHCP_CAPABILITY_PROBE_ENV]);
  const timeoutMs = normalizedTimeout(options.timeoutMs);
  const runner = options.runCommand ?? runCommand;
  const resolveExecutable = options.resolveExecutable
    ?? (options.runCommand
      ? async (command: string) => ({ state: 'resolved' as const, command })
      : undefined);

  const codexPromise = runner(codexCommand.command, [...(codexCommand.args ?? []), 'login', 'status'], timeoutMs);
  const ghcpPromise = ghcpCapabilityProbe
    ? probeGitHubCopilotCliCapability({
      executable: ghcpCommand.command,
      prefixArgs: ghcpPrefixArgs,
      capabilityArgs: undefined,
      timeoutMs,
      ...(resolveExecutable ? { resolveExecutable } : {}),
      ...(options.runCommand ? {
        runProcess: async (command, args, boundedTimeout) => runner(command, args, boundedTimeout),
      } : {}),
    })
    : Promise.resolve(undefined);

  const [codexResult, ghcpResult] = await Promise.all([
    codexPromise,
    ghcpPromise,
  ]);

  return {
    codex: codexCapability(codexResult),
    ghcp: ghcpResult ? ghcpCapability(ghcpResult) : unknownCliCapabilities().ghcp,
  };
}

export async function probeCliCapabilities(options: ProbeCliCapabilitiesOptions = {}): Promise<CliCapabilities> {
  const environment = options.environment ?? process.env;
  const codexCommand = normalizedSpec(
    options.codexCommand,
    environment.CODEX_BIN?.trim() || 'codex',
    environment.CODEX_SCRIPT?.trim() ? [environment.CODEX_SCRIPT.trim()] : [],
  );
  const ghcpEnvironmentCommand = ghcpCliCommandFromEnvironment(environment);
  const ghcpCommand = options.ghcpCommand
    ? normalizedSpec(options.ghcpCommand, 'copilot')
    : { command: ghcpEnvironmentCommand.executable, args: [...(ghcpEnvironmentCommand.prefixArgs ?? [])] };
  const ghcpCapabilityProbe = options.ghcpCapabilityProbe
    ?? enabledByEnvironment(environment[GHCP_CAPABILITY_PROBE_ENV]);
  const timeoutMs = normalizedTimeout(options.timeoutMs);
  const runner = options.runCommand ?? runCommand;
  const now = options.now ?? Date.now;
  const key = capabilityCacheKey({
    environment,
    codexCommand,
    ghcpCommand,
    ghcpCapabilityProbe,
    timeoutMs,
    runner,
    resolveExecutable: options.resolveExecutable,
  });
  const currentTime = now();
  const cached = capabilityCache.get(key);
  if (cached && cached.expiresAt > currentTime) return cached.promise;
  if (cached) capabilityCache.delete(key);

  const promise = probeCliCapabilitiesUncached(options);
  capabilityCache.set(key, { expiresAt: currentTime + CAPABILITY_CACHE_TTL_MS, promise });
  void promise.catch(() => {
    const current = capabilityCache.get(key);
    if (current?.promise === promise) capabilityCache.delete(key);
  });
  return promise;
}
