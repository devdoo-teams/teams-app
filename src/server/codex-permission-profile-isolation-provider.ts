import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  AgentExecutionUnavailableError,
  AgentIsolationProvider,
  type AgentIsolationAcquireInput,
  type AgentIsolationLease,
  type AgentIsolationSpawnOptions,
} from './agent-execution-policy.js';

const execFileAsync = promisify(execFile);
const PROVIDER_ID = 'codex-permission-profile';
const PROFILE_NAME = 'teams-agent-read-only';
const MAX_AUTH_FILE_BYTES = 1024 * 1024;
const PREFLIGHT_TIMEOUT_MS = 15_000;

const DEFAULT_PERMISSION_VALUE = `default_permissions="${PROFILE_NAME}"`;
const PERMISSION_PROFILE_VALUE = `permissions.${PROFILE_NAME}={description="Teams Core read only",filesystem={":minimal"="read",":workspace_roots"={"."="read"}},network={enabled=false}}`;

export const CODEX_READ_ONLY_PERMISSION_ARGS = Object.freeze([
  '--strict-config',
  '--ignore-user-config',
  '--ignore-rules',
  '--skip-git-repo-check',
  '-c',
  'approval_policy="never"',
  '-c',
  'web_search="disabled"',
  '-c',
  DEFAULT_PERMISSION_VALUE,
  '-c',
  PERMISSION_PROFILE_VALUE,
] as const);

export type CodexPermissionProfileIsolationProviderOptions = Readonly<{
  codexExecutable: string;
  codexHome: string;
  platform?: NodeJS.Platform;
  spawn?: (command: string, args: readonly string[], options: AgentIsolationSpawnOptions) => ChildProcess;
  preflight?: (input: { codexExecutable: string; codexHome: string; workspace: string }) => Promise<void>;
}>;

export class CodexPermissionProfileIsolationProvider extends AgentIsolationProvider {
  private readonly codexExecutable: string;
  private readonly codexHome: string;
  private readonly platform: NodeJS.Platform;
  private readonly spawnChild: NonNullable<CodexPermissionProfileIsolationProviderOptions['spawn']>;
  private readonly preflight: NonNullable<CodexPermissionProfileIsolationProviderOptions['preflight']>;
  private preflightPromise: Promise<void> | undefined;

  constructor(options: CodexPermissionProfileIsolationProviderOptions) {
    super(PROVIDER_ID);
    if (!isAbsolutePath(options?.codexExecutable) || !isAbsolutePath(options?.codexHome)) {
      throw new Error('Codex executable and service CODEX_HOME must be explicit absolute paths.');
    }
    this.codexExecutable = path.normalize(options.codexExecutable);
    this.codexHome = path.normalize(options.codexHome);
    this.platform = options.platform ?? process.platform;
    this.spawnChild = options.spawn ?? ((command, args, spawnOptions) => (
      spawn(command, [...args], spawnOptions as any)
    ));
    this.preflight = options.preflight ?? runNativePermissionPreflight;
  }

  override async acquire(input: AgentIsolationAcquireInput): Promise<AgentIsolationLease> {
    if (this.platform !== 'darwin') {
      throw unavailable('native Codex permission-profile isolation is currently verified only on macOS.');
    }
    await this.validateRequest(input);

    const sourceWorkspace = await requireDirectory(input.sourceWorkspace, 'source workspace');
    const workspace = await requireDirectory(input.workspace, 'projected workspace');
    const leaseWorkspace = path.normalize(input.workspace);
    const codexHome = await requirePrivateDirectory(this.codexHome, 'service CODEX_HOME');
    const codexExecutable = await requireExecutable(this.codexExecutable);
    await requirePrivateAuthFile(path.join(codexHome, 'auth.json'));

    if (pathsOverlap(sourceWorkspace, workspace)) {
      throw rejected('projected workspace must be disjoint from the source workspace.');
    }
    if (pathsOverlap(codexHome, sourceWorkspace) || pathsOverlap(codexHome, workspace)) {
      throw rejected('service CODEX_HOME must stay outside source and projected workspaces.');
    }
    if (input.protectedRoots.some((root) => pathsOverlap(workspace, path.resolve(root)))) {
      throw rejected('projected workspace overlaps a protected root.');
    }

    this.preflightPromise ??= this.preflight({ codexExecutable, codexHome, workspace })
      .catch((error) => {
        this.preflightPromise = undefined;
        const detail = error instanceof Error ? error.message : String(error);
        throw unavailable(`native Codex permission-profile preflight failed: ${detail}`);
      });
    await this.preflightPromise;

    const environmentOverrides = {
      ...input.environmentOverrides,
      CODEX_HOME: codexHome,
    };
    return this.issueLease({
      subject: input.subject,
      workspace: leaseWorkspace,
      protectedRoots: input.protectedRoots,
      environmentOverrides,
      spawn: (command, args, options) => {
        validateLaunch({
          command,
          args,
          options,
          codexExecutable,
          codexHome,
          workspace: leaseWorkspace,
        });
        return this.spawnChild(codexExecutable, args, {
          ...options,
          env: { ...options.env, CODEX_HOME: codexHome },
        });
      },
    });
  }
}

function validateLaunch(input: {
  command: string;
  args: readonly string[];
  options: AgentIsolationSpawnOptions;
  codexExecutable: string;
  codexHome: string;
  workspace: string;
}): void {
  let actualExecutable: string;
  try {
    actualExecutable = fsSync.realpathSync.native(input.command);
  } catch {
    throw rejected('Codex executable identity cannot be verified at launch.');
  }
  if (!samePath(actualExecutable, input.codexExecutable)) {
    throw rejected('isolation lease can launch only the pinned Codex executable.');
  }
  if (!Array.isArray(input.args) || input.args.some((value) => typeof value !== 'string')) {
    throw rejected('Codex launch arguments are invalid.');
  }
  const separatorIndex = input.args.indexOf('--');
  if (separatorIndex < 0 || input.args.indexOf('--', separatorIndex + 1) >= 0) {
    throw rejected('Codex prompt separator is missing or ambiguous.');
  }
  const commandArgs = input.args.slice(0, separatorIndex);
  if (commandArgs[0] !== 'exec') {
    throw rejected('Codex executable prefixes and alternate subcommands are forbidden.');
  }
  const forbidden = new Set([
    '--sandbox', '-s', '--dangerously-bypass-approvals-and-sandbox', '--dangerously-bypass-hook-trust',
    '--add-dir', '--enable', '--search', '--profile', '-p', '--config',
  ]);
  if (commandArgs.some((value) => forbidden.has(value) || value.startsWith('sandbox_mode='))) {
    throw rejected('legacy sandbox or permission-widening arguments are forbidden.');
  }
  for (const required of ['exec', '--json', '--strict-config', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check']) {
    if (!commandArgs.includes(required)) throw rejected(`required Codex isolation argument is missing: ${required}`);
  }
  const expectedConfigValues = new Set([
    'approval_policy="never"',
    'web_search="disabled"',
    DEFAULT_PERMISSION_VALUE,
    PERMISSION_PROFILE_VALUE,
  ]);
  const actualConfigValues = commandArgs.flatMap((value, index) => value === '-c' ? [commandArgs[index + 1] ?? ''] : []);
  if (actualConfigValues.length !== expectedConfigValues.size
    || actualConfigValues.some((value) => !expectedConfigValues.has(value))
    || [...expectedConfigValues].some((value) => !actualConfigValues.includes(value))) {
    throw rejected('Codex permission-profile configuration is incomplete or altered.');
  }
  const cdIndex = commandArgs.indexOf('--cd');
  if (cdIndex < 0 || commandArgs.indexOf('--cd', cdIndex + 1) >= 0
    || !samePath(commandArgs[cdIndex + 1] ?? '', input.workspace)) {
    throw rejected('Codex working root does not match the projected workspace.');
  }
  if (!samePath(input.options.cwd, input.workspace)) {
    throw rejected('spawn cwd does not match the projected workspace.');
  }
  if (!samePath(input.options.env.CODEX_HOME ?? '', input.codexHome)) {
    throw rejected('trusted Codex parent did not receive the pinned service CODEX_HOME.');
  }
}

async function runNativePermissionPreflight(input: {
  codexExecutable: string;
  codexHome: string;
  workspace: string;
}): Promise<void> {
  const version = await execFileAsync(input.codexExecutable, ['--version'], {
    encoding: 'utf8',
    timeout: PREFLIGHT_TIMEOUT_MS,
    maxBuffer: 4 * 1024,
  });
  if (!/codex-cli\s+0\.(?:1(?:3[89]|[4-9]\d)|[2-9]\d{2})\b/u.test(version.stdout)) {
    throw new Error(`unsupported Codex permission-profile version: ${version.stdout.trim()}`);
  }

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-codex-permission-preflight-'));
  try {
    const probeHome = path.join(root, 'codex-home');
    const allowedRoot = path.join(root, 'allowed');
    const deniedRoot = path.join(root, 'denied');
    const allowedFile = path.join(allowedRoot, 'canary.txt');
    const deniedFile = path.join(deniedRoot, 'canary.txt');
    await fs.mkdir(probeHome, { mode: 0o700 });
    await fs.mkdir(allowedRoot, { mode: 0o700 });
    await fs.mkdir(deniedRoot, { mode: 0o700 });
    await fs.writeFile(allowedFile, 'allowed\n', { mode: 0o600 });
    await fs.writeFile(deniedFile, 'denied\n', { mode: 0o600 });
    await fs.writeFile(path.join(probeHome, 'config.toml'), [
      'default_permissions = "teams-preflight"',
      '',
      '[permissions.teams-preflight.filesystem]',
      `":minimal" = "read"`,
      `${tomlString(allowedRoot)} = "read"`,
      '',
      '[permissions.teams-preflight.network]',
      'enabled = false',
      '',
    ].join('\n'), { mode: 0o600 });

    const environment = { ...process.env, CODEX_HOME: probeHome };
    await execFileAsync(input.codexExecutable, [
      'sandbox', '-P', 'teams-preflight', '-C', allowedRoot, '--',
      '/bin/sh', '-c', 'cat "$1" >/dev/null', 'probe', allowedFile,
    ], { env: environment, timeout: PREFLIGHT_TIMEOUT_MS, maxBuffer: 8 * 1024 });

    let denied = false;
    try {
      await execFileAsync(input.codexExecutable, [
        'sandbox', '-P', 'teams-preflight', '-C', allowedRoot, '--',
        '/bin/sh', '-c', 'cat "$1" >/dev/null', 'probe', deniedFile,
      ], { env: environment, timeout: PREFLIGHT_TIMEOUT_MS, maxBuffer: 8 * 1024 });
    } catch {
      denied = true;
    }
    if (!denied) throw new Error('native sandbox allowed a default-denied file read');
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
  }
}

async function requireDirectory(candidate: string, label: string): Promise<string> {
  if (!isAbsolutePath(candidate)) throw rejected(`${label} path must be absolute.`);
  try {
    const stat = await fs.lstat(candidate);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('not a real directory');
    return path.normalize(await fs.realpath(candidate));
  } catch {
    throw unavailable(`${label} is unavailable.`);
  }
}

async function requirePrivateDirectory(candidate: string, label: string): Promise<string> {
  const real = await requireDirectory(candidate, label);
  const stat = await fs.lstat(real);
  const currentUserId = typeof process.getuid === 'function' ? process.getuid() : undefined;
  if ((stat.mode & 0o077) !== 0 || (currentUserId !== undefined && stat.uid !== currentUserId)) {
    throw rejected(`${label} must be owner-only and owned by the current user.`);
  }
  return real;
}

async function requirePrivateAuthFile(candidate: string): Promise<void> {
  let handle: fs.FileHandle | undefined;
  try {
    const initial = await fs.lstat(candidate);
    const currentUserId = typeof process.getuid === 'function' ? process.getuid() : undefined;
    if (!initial.isFile() || initial.isSymbolicLink() || initial.nlink !== 1
      || initial.size <= 0 || initial.size > MAX_AUTH_FILE_BYTES
      || (initial.mode & 0o077) !== 0
      || (currentUserId !== undefined && initial.uid !== currentUserId)) {
      throw new Error('unsafe auth file metadata');
    }
    handle = await fs.open(candidate, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (opened.dev !== initial.dev || opened.ino !== initial.ino || opened.size !== initial.size) {
      throw new Error('auth file identity changed');
    }
  } catch {
    throw rejected('service CODEX_HOME/auth.json must be one owner-only regular file.');
  } finally {
    await handle?.close();
  }
}

async function requireExecutable(candidate: string): Promise<string> {
  if (!isAbsolutePath(candidate)) throw rejected('Codex executable path must be absolute.');
  try {
    const stat = await fs.lstat(candidate);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('not a regular executable');
    await fs.access(candidate, fsConstants.X_OK);
    return path.normalize(await fs.realpath(candidate));
  } catch {
    throw unavailable('pinned Codex executable is unavailable.');
  }
}

function isAbsolutePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\u0000') && path.isAbsolute(value);
}

function pathsOverlap(left: string, right: string): boolean {
  const a = path.normalize(path.resolve(left));
  const b = path.normalize(path.resolve(right));
  return samePath(a, b) || isInside(a, b) || isInside(b, a);
}

function isInside(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function samePath(left: string, right: string): boolean {
  if (!left || !right) return false;
  const a = path.normalize(path.resolve(left));
  const b = path.normalize(path.resolve(right));
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function rejected(message: string): AgentExecutionUnavailableError {
  return new AgentExecutionUnavailableError('provider-rejected-request', message);
}

function unavailable(message: string): AgentExecutionUnavailableError {
  return new AgentExecutionUnavailableError('trusted-isolation-required', message);
}
