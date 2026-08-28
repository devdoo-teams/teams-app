import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
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
const PREFLIGHT_TIMEOUT_MS = 45_000;
const OPENAI_TEAM_IDENTIFIER = '2DC432GLL2';
const TRUSTED_PARENT_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
const MACOS_PERMISSION_PROFILE_DENIAL_SIGNATURE = /\bOperation not permitted\b/u;

const DISABLED_CODEX_FEATURES = Object.freeze([
  'apps',
  'auth_elicitation',
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'code_mode_host',
  'computer_use',
  'goals',
  'hooks',
  'image_generation',
  'in_app_browser',
  'in_app_updates',
  'multi_agent',
  'plugin_sharing',
  'plugins',
  'remote_plugin',
  'skill_mcp_dependency_install',
  'skill_search',
  'tool_call_mcp_elicitation',
  'tool_suggest',
  'view_image',
] as const);

export const CODEX_EXTERNAL_TOOL_SURFACE_POLICY = Object.freeze({
  apps: false,
  connectors: false,
  browser: false,
  inAppBrowser: false,
  computerUse: false,
  plugins: false,
  mcp: false,
  mcpElicitations: false,
  multiAgent: false,
  webSearch: false,
  imageTools: false,
  hooks: false,
  skillInstall: false,
  skillSearch: false,
  requireEmptyMcpInventory: true,
  requireEmptyPluginInventory: true,
} as const);

const DEFAULT_PERMISSION_VALUE = `default_permissions="${PROFILE_NAME}"`;
const PERMISSION_PROFILE_VALUE = `permissions.${PROFILE_NAME}={description="Teams Core read only",filesystem={":minimal"="read",":workspace_roots"={"."="read"}},network={enabled=false}}`;

export const CODEX_READ_ONLY_PERMISSION_ARGS = Object.freeze([
  '--strict-config',
  '--ignore-user-config',
  '--ignore-rules',
  '--skip-git-repo-check',
  '--ephemeral',
  ...DISABLED_CODEX_FEATURES.flatMap((feature) => ['--disable', feature]),
  '-c',
  'approval_policy="never"',
  '-c',
  'web_search="disabled"',
  '-c',
  DEFAULT_PERMISSION_VALUE,
  '-c',
  PERMISSION_PROFILE_VALUE,
] as const);

type StableFileIdentity = Readonly<{
  dev: string;
  ino: string;
  mode: number;
  nlink: number;
  size: number;
  uid: number;
  mtimeMs: number;
  ctimeMs: number;
}>;

type TrustedPathSnapshot = Readonly<{
  path: string;
  identity: StableFileIdentity;
}>;

type TrustedExecutableSnapshot = TrustedPathSnapshot & Readonly<{
  sha256: string;
}>;

export type ExecutableTrustVerifier = (input: Readonly<{ path: string; sha256: string }>) => void;

export type CodexPermissionProfilePreflightClassification =
  | 'command-not-found'
  | 'malformed-profile'
  | 'timeout'
  | 'genuine-denial'
  | 'unknown-infrastructure';

type ThrownPreflightClassification = Exclude<CodexPermissionProfilePreflightClassification, 'genuine-denial'>;

export class CodexPermissionProfilePreflightError extends AgentExecutionUnavailableError {
  readonly classification: ThrownPreflightClassification;

  constructor(classification: ThrownPreflightClassification, message: string) {
    super('trusted-isolation-required', message);
    this.name = 'CodexPermissionProfilePreflightError';
    this.classification = classification;
  }
}

export type CodexPermissionProfileIsolationProviderOptions = Readonly<{
  codexExecutable: string;
  codexExecutableSha256: string;
  codexHome: string;
  platform?: NodeJS.Platform;
  spawn?: (command: string, args: readonly string[], options: AgentIsolationSpawnOptions) => ChildProcess;
  preflight?: (input: {
    codexExecutable: string;
    codexHome: string;
    workspace: string;
    environment: Readonly<NodeJS.ProcessEnv>;
    toolSurfacePolicy: typeof CODEX_EXTERNAL_TOOL_SURFACE_POLICY;
  }) => Promise<void>;
  /** Test seam only. Production verifies the OpenAI Developer ID requirement with codesign. */
  executableTrustVerifier?: ExecutableTrustVerifier;
}>;

export class CodexPermissionProfileIsolationProvider extends AgentIsolationProvider {
  private readonly codexExecutable: string;
  private readonly codexExecutableSha256: string;
  private readonly codexHome: string;
  private readonly platform: NodeJS.Platform;
  private readonly spawnChild: NonNullable<CodexPermissionProfileIsolationProviderOptions['spawn']>;
  private readonly preflight: NonNullable<CodexPermissionProfileIsolationProviderOptions['preflight']>;
  private readonly executableTrustVerifier: ExecutableTrustVerifier;
  private leaseReserved = false;

  constructor(options: CodexPermissionProfileIsolationProviderOptions) {
    super(PROVIDER_ID);
    if (!isAbsolutePath(options?.codexExecutable) || !isAbsolutePath(options?.codexHome)) {
      throw new Error('Codex executable and service CODEX_HOME must be explicit absolute paths.');
    }
    if (!/^[a-f0-9]{64}$/u.test(options.codexExecutableSha256?.toLowerCase() ?? '')) {
      throw new Error('Codex executable SHA-256 must be an explicit 64-character hex digest.');
    }
    this.codexExecutable = path.normalize(options.codexExecutable);
    this.codexExecutableSha256 = options.codexExecutableSha256.toLowerCase();
    this.codexHome = path.normalize(options.codexHome);
    this.platform = options.platform ?? process.platform;
    this.spawnChild = options.spawn ?? ((command, args, spawnOptions) => (
      spawn(command, [...args], spawnOptions as any)
    ));
    this.preflight = options.preflight ?? runNativePermissionPreflight;
    this.executableTrustVerifier = options.executableTrustVerifier ?? verifyOpenAICodexSignature;
  }

  override async acquire(input: AgentIsolationAcquireInput): Promise<AgentIsolationLease> {
    if (this.platform !== 'darwin') {
      throw unavailable('native Codex permission-profile isolation is currently verified only on macOS.');
    }
    if (this.leaseReserved) {
      throw unavailable('the dedicated service CODEX_HOME already has one active or starting Codex workflow.');
    }
    this.leaseReserved = true;
    try {
      return await this.acquireReserved(input);
    } catch (error) {
      this.leaseReserved = false;
      throw error;
    }
  }

  private async acquireReserved(input: AgentIsolationAcquireInput): Promise<AgentIsolationLease> {
    await this.validateRequest(input);

    const sourceWorkspace = await requireDirectory(input.sourceWorkspace, 'source workspace');
    const workspace = await requireDirectory(input.workspace, 'projected workspace');
    const protectedRoots = await Promise.all(input.protectedRoots.map((root) => (
      requireCanonicalPath(root, 'protected root')
    )));
    let codexHome = await requirePrivateDirectory(this.codexHome, 'service CODEX_HOME');
    const codexExecutable = await requireExecutable(
      this.codexExecutable,
      this.codexExecutableSha256,
      this.executableTrustVerifier,
    );
    let authFile = await requirePrivateAuthFile(path.join(codexHome.path, 'auth.json'));

    if (pathsOverlap(sourceWorkspace, workspace)) {
      throw rejected('projected workspace must be disjoint from the source workspace.');
    }
    if (pathsOverlap(codexHome.path, sourceWorkspace) || pathsOverlap(codexHome.path, workspace)) {
      throw rejected('service CODEX_HOME must stay outside source and projected workspaces.');
    }
    if (protectedRoots.some((root) => pathsOverlap(workspace, root))) {
      throw rejected('projected workspace overlaps a protected root.');
    }
    if (protectedRoots.some((root) => pathsOverlap(codexExecutable.path, root))
      || pathsOverlap(codexExecutable.path, sourceWorkspace)
      || pathsOverlap(codexExecutable.path, workspace)
      || pathsOverlap(codexExecutable.path, codexHome.path)) {
      throw rejected('pinned Codex executable must stay outside protected, source, workspace, and auth roots.');
    }

    const environmentOverrides = await buildTrustedParentEnvironment(input, workspace, codexHome.path);
    try {
      await this.preflight({
        codexExecutable: codexExecutable.path,
        codexHome: codexHome.path,
        workspace,
        environment: environmentOverrides,
        toolSurfacePolicy: CODEX_EXTERNAL_TOOL_SURFACE_POLICY,
      });
    } catch (error) {
      if (error instanceof CodexPermissionProfilePreflightError) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      const classification = classifyPreflightFailure(error);
      throw preflightFailure(
        classification === 'genuine-denial' ? 'unknown-infrastructure' : classification,
        `native Codex permission-profile preflight failed: ${detail}`,
      );
    }
    codexHome = await requirePrivateDirectory(this.codexHome, 'service CODEX_HOME');
    authFile = await requirePrivateAuthFile(path.join(codexHome.path, 'auth.json'));

    return this.issueLease({
      subject: input.subject,
      workspace,
      protectedRoots,
      environmentOverrides,
      dispose: () => { this.leaseReserved = false; },
      spawn: (command, args, options) => {
        assertTrustedPathSnapshot(codexHome, 'service CODEX_HOME');
        assertPrivateAuthSnapshot(authFile);
        assertTrustedExecutableSnapshot(
          codexExecutable,
          this.codexExecutableSha256,
          this.executableTrustVerifier,
        );
        validateLaunch({
          command,
          args,
          options,
          codexExecutable: codexExecutable.path,
          codexHome: codexHome.path,
          workspace,
        });
        const trustedArgs = buildTrustedExecArgs(args, workspace);
        return this.spawnChild(codexExecutable.path, trustedArgs, {
          ...options,
          cwd: workspace,
          env: { ...environmentOverrides },
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
  buildTrustedExecArgs(input.args, input.workspace);
  if (!samePath(input.options.cwd, input.workspace)) {
    throw rejected('spawn cwd does not match the projected workspace.');
  }
  if (!samePath(input.options.env.CODEX_HOME ?? '', input.codexHome)) {
    throw rejected('trusted Codex parent did not receive the pinned service CODEX_HOME.');
  }
}

function buildTrustedExecArgs(args: readonly string[], workspace: string): string[] {
  const separatorIndex = args.indexOf('--');
  if (separatorIndex < 0 || args.indexOf('--', separatorIndex + 1) >= 0 || args.length !== separatorIndex + 2) {
    throw rejected('Codex prompt separator or prompt cardinality is invalid.');
  }
  const prompt = args[separatorIndex + 1];
  if (typeof prompt !== 'string' || !prompt.trim()) throw rejected('Codex prompt must be one non-empty argument.');
  const commandArgs = args.slice(0, separatorIndex);
  const base = ['exec', '--json', ...CODEX_READ_ONLY_PERMISSION_ARGS, '--cd', workspace];
  const isFresh = arraysEqual(commandArgs, base);
  const resumeArgs = commandArgs.slice(base.length);
  const isResume = arraysEqual(commandArgs.slice(0, base.length), base)
    && resumeArgs.length === 2
    && resumeArgs[0] === 'resume'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(resumeArgs[1] ?? '');
  if (!isFresh && !isResume) {
    throw rejected('Codex launch arguments must exactly match the provider-owned read-only grammar.');
  }
  return [...commandArgs, '--', prompt];
}

async function runNativePermissionPreflight(input: {
  codexExecutable: string;
  codexHome: string;
  workspace: string;
  environment: Readonly<NodeJS.ProcessEnv>;
  toolSurfacePolicy: typeof CODEX_EXTERNAL_TOOL_SURFACE_POLICY;
}): Promise<void> {
  void input.toolSurfacePolicy;
  const environment = { ...input.environment };
  const version = await execFileAsync(input.codexExecutable, ['--version'], {
    env: environment,
    encoding: 'utf8',
    timeout: PREFLIGHT_TIMEOUT_MS,
    maxBuffer: 4 * 1024,
  });
  if (!/codex-cli\s+0\.(?:1(?:3[89]|[4-9]\d)|[2-9]\d{2})\b/u.test(version.stdout)) {
    throw new Error(`unsupported Codex permission-profile version: ${version.stdout.trim()}`);
  }

  const mcpInventory = await execFileAsync(input.codexExecutable, ['mcp', 'list', '--json'], {
    env: environment,
    encoding: 'utf8',
    timeout: PREFLIGHT_TIMEOUT_MS,
    maxBuffer: 32 * 1024,
  });
  const mcpServers = parseJson(mcpInventory.stdout, 'MCP inventory');
  if (!Array.isArray(mcpServers) || mcpServers.length !== 0) {
    throw new Error('service Codex MCP inventory must be empty');
  }
  const pluginInventory = await execFileAsync(input.codexExecutable, ['plugin', 'list', '--json'], {
    env: environment,
    encoding: 'utf8',
    timeout: PREFLIGHT_TIMEOUT_MS,
    maxBuffer: 32 * 1024,
  });
  const plugins = parseJson(pluginInventory.stdout, 'plugin inventory');
  if (!isPlainRecord(plugins) || !Array.isArray(plugins.installed) || plugins.installed.length !== 0) {
    throw new Error('service Codex installed plugin inventory must be empty');
  }

  const workspaceCanary = await findWorkspaceCanary(input.workspace);
  const serviceCanary = await ensureServiceCanary(input.codexHome);
  const sandboxPrefix = [
    'sandbox',
    '-c', DEFAULT_PERMISSION_VALUE,
    '-c', PERMISSION_PROFILE_VALUE,
    '-P', PROFILE_NAME,
    '-C', input.workspace,
    '--',
  ];
  await execFileAsync(input.codexExecutable, [
    ...sandboxPrefix,
    '/bin/sh', '-c', 'test -r "$1"', 'workspace-read-canary', workspaceCanary,
  ], { env: environment, timeout: PREFLIGHT_TIMEOUT_MS, maxBuffer: 16 * 1024 });
  await expectSandboxDenial(input.codexExecutable, [
    ...sandboxPrefix,
    '/bin/sh', '-c', 'cat "$1" >/dev/null', 'service-read-denied-canary', serviceCanary,
  ], environment, 'service-home read');
  const writeCanary = path.join(input.workspace, 'write-denied-canary');
  await expectSandboxDenial(input.codexExecutable, [
    ...sandboxPrefix,
    '/bin/sh', '-c', ': > "$1"', 'workspace-write-denied-canary', writeCanary,
  ], environment, 'workspace write');
  await withLoopbackServer(async (port) => {
    await expectSandboxDenial(input.codexExecutable, [
      ...sandboxPrefix,
      '/bin/sh', '-c', 'exec /usr/bin/nc -z 127.0.0.1 "$1"', 'network-denied-canary', String(port),
    ], environment, 'network');
  });

  const authenticated = await execFileAsync(input.codexExecutable, [
    'exec', '--json', ...CODEX_READ_ONLY_PERMISSION_ARGS,
    '--cd', input.workspace,
    '--', 'Reply with exactly TEAMS_CODEX_AUTH_PREFLIGHT_OK. Do not call any tool.',
  ], {
    env: environment,
    cwd: input.workspace,
    encoding: 'utf8',
    timeout: PREFLIGHT_TIMEOUT_MS,
    maxBuffer: 128 * 1024,
  });
  if (!hasExactPreflightMessage(authenticated.stdout)) {
    throw new Error('authenticated Codex exec preflight did not return the exact terminal canary');
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

async function requireCanonicalPath(candidate: string, label: string): Promise<string> {
  if (!isAbsolutePath(candidate)) throw rejected(`${label} path must be absolute.`);
  try {
    return path.normalize(await fs.realpath(candidate));
  } catch {
    throw unavailable(`${label} is unavailable.`);
  }
}

async function requirePrivateDirectory(candidate: string, label: string): Promise<TrustedPathSnapshot> {
  const real = await requireDirectory(candidate, label);
  const stat = await fs.lstat(real);
  const currentUserId = typeof process.getuid === 'function' ? process.getuid() : undefined;
  if ((stat.mode & 0o077) !== 0 || (currentUserId !== undefined && stat.uid !== currentUserId)) {
    throw rejected(`${label} must be owner-only and owned by the current user.`);
  }
  return { path: real, identity: stableIdentity(stat) };
}

async function requirePrivateAuthFile(candidate: string): Promise<TrustedPathSnapshot> {
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
    if (!sameStableIdentity(stableIdentity(opened), stableIdentity(initial))) {
      throw new Error('auth file identity changed');
    }
    return { path: path.normalize(await fs.realpath(candidate)), identity: stableIdentity(opened) };
  } catch {
    throw rejected('service CODEX_HOME/auth.json must be one owner-only regular file.');
  } finally {
    await handle?.close();
  }
}

async function requireExecutable(
  candidate: string,
  expectedSha256: string,
  verifyTrust: ExecutableTrustVerifier,
): Promise<TrustedExecutableSnapshot> {
  if (!isAbsolutePath(candidate)) throw rejected('Codex executable path must be absolute.');
  let handle: fs.FileHandle | undefined;
  try {
    const stat = await fs.lstat(candidate);
    const currentUserId = typeof process.getuid === 'function' ? process.getuid() : undefined;
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1
      || (stat.mode & 0o022) !== 0
      || (currentUserId !== undefined && stat.uid !== 0 && stat.uid !== currentUserId)) {
      throw new Error('not a trusted regular executable');
    }
    await fs.access(candidate, fsConstants.X_OK);
    const real = path.normalize(await fs.realpath(candidate));
    handle = await fs.open(real, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (!sameStableIdentity(stableIdentity(opened), stableIdentity(stat))) {
      throw new Error('executable identity changed while opened');
    }
    const sha256 = crypto.createHash('sha256').update(await handle.readFile()).digest('hex');
    const afterRead = await handle.stat();
    if (!sameStableIdentity(stableIdentity(afterRead), stableIdentity(opened)) || sha256 !== expectedSha256) {
      throw new Error('executable identity or SHA-256 does not match the configured pin');
    }
    verifyTrust({ path: real, sha256 });
    return { path: real, identity: stableIdentity(afterRead), sha256 };
  } catch {
    throw unavailable('signed and SHA-pinned Codex executable is unavailable.');
  } finally {
    await handle?.close();
  }
}

async function buildTrustedParentEnvironment(
  input: AgentIsolationAcquireInput,
  workspace: string,
  codexHome: string,
): Promise<Record<string, string>> {
  const allowedInputKeys = new Set(['HOME', 'USERPROFILE', 'CODEX_HOME']);
  const unexpected = Object.keys(input.environmentOverrides).filter((key) => !allowedInputKeys.has(key));
  if (unexpected.length > 0) {
    throw rejected(`trusted Codex parent environment contains forbidden keys: ${unexpected.sort().join(', ')}`);
  }
  const requestedHome = input.environmentOverrides.HOME;
  if (!isAbsolutePath(requestedHome)) throw rejected('isolated HOME must be an explicit absolute path.');
  const home = await requirePrivateDirectory(requestedHome, 'isolated HOME');
  if (pathsOverlap(home.path, codexHome)) throw rejected('isolated HOME must stay outside service CODEX_HOME.');
  const requestedUserProfile = input.environmentOverrides.USERPROFILE;
  if (requestedUserProfile && !samePath(await requireCanonicalPath(requestedUserProfile, 'isolated USERPROFILE'), home.path)) {
    throw rejected('isolated HOME and USERPROFILE must resolve to the same directory.');
  }
  const tempDirectory = path.join(home.path, '.teams-agent-tmp');
  await fs.mkdir(tempDirectory, { recursive: true, mode: 0o700 });
  await fs.chmod(tempDirectory, 0o700);
  const temp = await requirePrivateDirectory(tempDirectory, 'isolated temporary directory');
  if (pathsOverlap(temp.path, codexHome) || !isInside(temp.path, home.path)) {
    throw rejected('isolated temporary directory escaped the isolated HOME.');
  }
  void workspace;
  return {
    CI: '1',
    PATH: TRUSTED_PARENT_PATH,
    HOME: home.path,
    USERPROFILE: home.path,
    CODEX_HOME: codexHome,
    TMPDIR: temp.path,
    TMP: temp.path,
    TEMP: temp.path,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
  };
}

function stableIdentity(stat: fsSync.Stats): StableFileIdentity {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    mode: stat.mode,
    nlink: stat.nlink,
    size: stat.size,
    uid: stat.uid,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

function sameStableIdentity(left: StableFileIdentity, right: StableFileIdentity): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.size === right.size
    && left.uid === right.uid
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function assertTrustedPathSnapshot(snapshot: TrustedPathSnapshot, label: string): void {
  try {
    const real = fsSync.realpathSync.native(snapshot.path);
    const stat = fsSync.lstatSync(real);
    if (stat.isSymbolicLink() || !stat.isDirectory() || !samePath(real, snapshot.path)
      || !sameStableIdentity(stableIdentity(stat), snapshot.identity)) {
      throw new Error('identity changed');
    }
  } catch {
    throw rejected(`${label} identity changed after the isolation lease was acquired.`);
  }
}

function assertPrivateAuthSnapshot(snapshot: TrustedPathSnapshot): void {
  let descriptor: number | undefined;
  try {
    const initial = fsSync.lstatSync(snapshot.path);
    if (initial.isSymbolicLink() || !initial.isFile() || initial.nlink !== 1
      || initial.size <= 0 || initial.size > MAX_AUTH_FILE_BYTES || (initial.mode & 0o077) !== 0
      || !sameStableIdentity(stableIdentity(initial), snapshot.identity)) {
      throw new Error('unsafe auth identity');
    }
    descriptor = fsSync.openSync(snapshot.path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = fsSync.fstatSync(descriptor);
    if (!sameStableIdentity(stableIdentity(opened), snapshot.identity)) throw new Error('auth identity changed');
  } catch {
    throw rejected('service CODEX_HOME/auth.json identity changed after the isolation lease was acquired.');
  } finally {
    if (descriptor !== undefined) fsSync.closeSync(descriptor);
  }
}

function assertTrustedExecutableSnapshot(
  snapshot: TrustedExecutableSnapshot,
  expectedSha256: string,
  verifyTrust: ExecutableTrustVerifier,
): void {
  let descriptor: number | undefined;
  try {
    const real = fsSync.realpathSync.native(snapshot.path);
    const initial = fsSync.lstatSync(real);
    if (!samePath(real, snapshot.path) || initial.isSymbolicLink() || !initial.isFile() || initial.nlink !== 1
      || (initial.mode & 0o022) !== 0 || !sameStableIdentity(stableIdentity(initial), snapshot.identity)) {
      throw new Error('executable identity changed');
    }
    descriptor = fsSync.openSync(real, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = fsSync.fstatSync(descriptor);
    if (!sameStableIdentity(stableIdentity(opened), snapshot.identity)) throw new Error('executable identity changed');
    const sha256 = crypto.createHash('sha256').update(fsSync.readFileSync(descriptor)).digest('hex');
    const afterRead = fsSync.fstatSync(descriptor);
    if (!sameStableIdentity(stableIdentity(afterRead), snapshot.identity)
      || sha256 !== snapshot.sha256 || sha256 !== expectedSha256) {
      throw new Error('executable SHA-256 changed');
    }
    verifyTrust({ path: real, sha256 });
  } catch {
    throw rejected('signed and SHA-pinned Codex executable identity changed before launch.');
  } finally {
    if (descriptor !== undefined) fsSync.closeSync(descriptor);
  }
}

function verifyOpenAICodexSignature(input: Readonly<{ path: string; sha256: string }>): void {
  void input.sha256;
  const requirement = `identifier "codex" and anchor apple generic and certificate leaf[subject.OU] = "${OPENAI_TEAM_IDENTIFIER}"`;
  execFileSync('/usr/bin/codesign', [
    '--verify', '--strict', '--verbose=2', `-R=${requirement}`, input.path,
  ], { encoding: 'utf8', timeout: PREFLIGHT_TIMEOUT_MS, maxBuffer: 16 * 1024, stdio: 'pipe' });
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} was not valid JSON`);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function findWorkspaceCanary(workspace: string): Promise<string> {
  for (const name of ['workspace-canary.txt', 'package.json', 'AGENTS.md', 'README.md']) {
    const candidate = path.join(workspace, name);
    try {
      const stat = await fs.lstat(candidate);
      if (stat.isFile() && !stat.isSymbolicLink()) return candidate;
    } catch {
      // Continue to the next deterministic projected file.
    }
  }
  throw new Error('projected workspace has no deterministic readable canary');
}

async function ensureServiceCanary(codexHome: string): Promise<string> {
  for (const name of ['service-secret-canary.txt', '.teams-permission-canary']) {
    const existing = path.join(codexHome, name);
    try {
      const stat = await fs.lstat(existing);
      const currentUserId = typeof process.getuid === 'function' ? process.getuid() : undefined;
      if (stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && (stat.mode & 0o077) === 0
        && (currentUserId === undefined || stat.uid === currentUserId)) return existing;
      throw new Error('service canary metadata is unsafe');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const candidate = path.join(codexHome, '.teams-permission-canary');
  await fs.writeFile(candidate, 'teams-permission-boundary\n', { flag: 'wx', mode: 0o600 });
  return candidate;
}

async function expectSandboxDenial(
  executable: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
  label: string,
): Promise<void> {
  try {
    await execFileAsync(executable, [...args], {
      env: environment,
      timeout: PREFLIGHT_TIMEOUT_MS,
      maxBuffer: 16 * 1024,
    });
  } catch (error) {
    const classification = classifyPreflightFailure(error);
    if (classification === 'genuine-denial') return;
    const detail = error instanceof Error ? error.message : String(error);
    throw preflightFailure(classification, `${label} preflight failed: ${detail}`);
  }
  throw new Error(`native permission profile allowed forbidden ${label}`);
}

function classifyPreflightFailure(error: unknown): CodexPermissionProfilePreflightClassification {
  const candidate = (error && typeof error === 'object' ? error : {}) as {
    code?: string | number;
    killed?: boolean;
    signal?: NodeJS.Signals | null;
    stdout?: string | Buffer;
    stderr?: string | Buffer;
  };
  const message = error instanceof Error ? error.message : String(error);
  const stdout = typeof candidate.stdout === 'string'
    ? candidate.stdout
    : candidate.stdout?.toString('utf8') ?? '';
  const stderr = typeof candidate.stderr === 'string'
    ? candidate.stderr
    : candidate.stderr?.toString('utf8') ?? '';
  // execFile includes the complete command line in Error.message. That line
  // contains the permission/profile arguments by design, so using it beside
  // a numeric exit code can misclassify an ordinary canary failure as a
  // malformed profile. Structured child output is authoritative; only use a
  // message for injected/non-process errors that have no exit-code metadata.
  const diagnostics = [
    candidate.code === undefined ? message : '',
    stdout,
    stderr,
  ].filter(Boolean).join('\n');
  if (candidate.code === 'ENOENT' || /\bENOENT\b|(?:command|executable|file).{0,40}(?:not found|no such file)/iu.test(diagnostics)) {
    return 'command-not-found';
  }
  if (candidate.code === 'ETIMEDOUT' || candidate.killed === true || candidate.signal === 'SIGTERM'
    || /\b(?:timed out|timeout|time limit exceeded)\b/iu.test(diagnostics)) {
    return 'timeout';
  }
  if (/(?:\b(?:invalid|malformed|unknown|unrecognized|unsupported|bad|failed)\b.{0,80}\b(?:permission|profile|config|sandbox)\b|\b(?:permission|profile|config|sandbox)\b.{0,80}\b(?:invalid|malformed|unknown|unrecognized|unsupported|bad|failed)\b)/iu.test(diagnostics)) {
    return 'malformed-profile';
  }
  if (typeof candidate.code === 'number' && candidate.code !== 0
    && MACOS_PERMISSION_PROFILE_DENIAL_SIGNATURE.test(stderr)) {
    return 'genuine-denial';
  }
  return 'unknown-infrastructure';
}

function preflightFailure(classification: ThrownPreflightClassification, message: string): CodexPermissionProfilePreflightError {
  return new CodexPermissionProfilePreflightError(classification, message);
}

async function withLoopbackServer(operation: (port: number) => Promise<void>): Promise<void> {
  const server = net.createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('loopback preflight listener is unavailable');
    await operation(address.port);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function hasExactPreflightMessage(stdout: string): boolean {
  return stdout.split('\n').filter(Boolean).some((line) => {
    try {
      const event = JSON.parse(line) as { type?: unknown; item?: { type?: unknown; text?: unknown } };
      return event.type === 'item.completed'
        && event.item?.type === 'agent_message'
        && event.item.text === 'TEAMS_CODEX_AUTH_PREFLIGHT_OK';
    } catch {
      return false;
    }
  });
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

function rejected(message: string): AgentExecutionUnavailableError {
  return new AgentExecutionUnavailableError('provider-rejected-request', message);
}

function unavailable(message: string): AgentExecutionUnavailableError {
  return new AgentExecutionUnavailableError('trusted-isolation-required', message);
}
