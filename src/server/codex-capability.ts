import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_PROBE_TIMEOUT_MS = 1_500;
const MAX_PROBE_TIMEOUT_MS = 2_000;
const MAX_PROBE_OUTPUT_CHARS = 8_192;

export const CLI_CAPABILITY_STATES = ['available', 'unavailable', 'unknown'] as const;
export const CLI_EXECUTABLE_STATES = ['present', 'absent', 'unknown'] as const;
export const CLI_LOGIN_STATES = ['authenticated', 'not-authenticated', 'unknown'] as const;

export type CliCapabilityState = (typeof CLI_CAPABILITY_STATES)[number];
export type CliExecutableState = (typeof CLI_EXECUTABLE_STATES)[number];
export type CliLoginState = (typeof CLI_LOGIN_STATES)[number];

export type CliCapability = Readonly<{
  state: CliCapabilityState;
  executable: CliExecutableState;
  login: CliLoginState;
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
  environment?: NodeJS.ProcessEnv;
  runCommand?: CliCommandRunner;
  timeoutMs?: number;
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
    await execFileAsync(command, [...args], {
      timeout: timeoutMs,
      maxBuffer: MAX_PROBE_OUTPUT_CHARS,
      windowsHide: true,
    });
    return { outcome: 'success' };
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

function outputText(result: CliCommandResult): string {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`.toLowerCase();
}

function indicatesNotAuthenticated(result: CliCommandResult): boolean {
  return /(not logged|not authenticated|authentication required|login required|please run .*auth login|no oauth token)/i.test(outputText(result));
}

function indicatesUnsupported(result: CliCommandResult): boolean {
  return /(unknown command|command .* not found|not installed|could not find)/i.test(outputText(result));
}

function unavailable(executable: CliExecutableState, login: CliLoginState): CliCapability {
  return { state: 'unavailable', executable, login };
}

function unknown(executable: CliExecutableState = 'unknown', login: CliLoginState = 'unknown'): CliCapability {
  return { state: 'unknown', executable, login };
}

function capabilityAfterLoginProbe(result: CliCommandResult, executable: CliExecutableState = 'present'): CliCapability {
  if (result.outcome === 'success') return { state: 'available', executable, login: 'authenticated' };
  if (result.outcome === 'exit' && indicatesNotAuthenticated(result)) {
    return unavailable(executable, 'not-authenticated');
  }
  return unknown(executable, 'unknown');
}

function codexCapability(result: CliCommandResult): CliCapability {
  if (result.outcome === 'missing') return unavailable('absent', 'unknown');
  if (result.outcome === 'exit' && indicatesNotAuthenticated(result)) {
    return unavailable('present', 'not-authenticated');
  }
  if (result.outcome === 'success') return { state: 'available', executable: 'present', login: 'authenticated' };
  return unknown(result.outcome === 'error' ? 'unknown' : 'present');
}

function ghcpCapability(helpResult: CliCommandResult, authResult?: CliCommandResult): CliCapability {
  if (helpResult.outcome === 'missing') return unavailable('absent', 'unknown');
  if (helpResult.outcome === 'exit' && indicatesUnsupported(helpResult)) return unavailable('present', 'unknown');
  if (helpResult.outcome !== 'success') return unknown('present');
  if (!authResult) return unknown('present');
  return capabilityAfterLoginProbe(authResult, 'present');
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
  const login = CLI_LOGIN_STATES.includes(candidate.login as CliLoginState)
    ? candidate.login as CliLoginState
    : 'unknown';

  if (state === 'available' && (executable !== 'present' || login !== 'authenticated')) {
    return unknown(executable, login);
  }
  if (state === 'unavailable' && executable === 'present' && login === 'authenticated') {
    return unknown(executable, login);
  }
  return { state, executable, login };
}

export async function probeCliCapabilities(options: ProbeCliCapabilitiesOptions = {}): Promise<CliCapabilities> {
  const environment = options.environment ?? process.env;
  const codexCommand = normalizedSpec(
    options.codexCommand,
    environment.CODEX_BIN?.trim() || 'codex',
    environment.CODEX_SCRIPT?.trim() ? [environment.CODEX_SCRIPT.trim()] : [],
  );
  const ghcpCommand = normalizedSpec(options.ghcpCommand, environment.GHCP_BIN?.trim() || 'gh');
  const timeoutMs = normalizedTimeout(options.timeoutMs);
  const runner = options.runCommand ?? runCommand;

  const [codexResult, ghcpHelpResult] = await Promise.all([
    runner(codexCommand.command, [...(codexCommand.args ?? []), 'login', 'status'], timeoutMs),
    runner(ghcpCommand.command, [...(ghcpCommand.args ?? []), 'copilot', '--help'], timeoutMs),
  ]);

  const ghcpAuthResult = ghcpHelpResult.outcome === 'success'
    ? await runner(ghcpCommand.command, [...(ghcpCommand.args ?? []), 'auth', 'status', '--hostname', 'github.com'], timeoutMs)
    : undefined;

  return {
    codex: codexCapability(codexResult),
    ghcp: ghcpCapability(ghcpHelpResult, ghcpAuthResult),
  };
}
