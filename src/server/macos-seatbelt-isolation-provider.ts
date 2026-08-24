import type { ChildProcess } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  AgentExecutionUnavailableError,
  AgentIsolationProvider,
  type AgentIsolationAcquireInput,
  type AgentIsolationLease,
  type AgentIsolationSpawnOptions,
} from './agent-execution-policy.js';

const DEFAULT_SANDBOX_EXEC_PATH = '/usr/bin/sandbox-exec';
const PROVIDER_ID = 'macos-seatbelt';

export type MacOSSeatbeltIsolationProviderOptions = {
  /** An explicitly selected, trusted Seatbelt profile. */
  profilePath: string;
  /** The only process-launch seam; production callers must inject the real spawn implementation. */
  spawn: (command: string, args: readonly string[], options: AgentIsolationSpawnOptions) => ChildProcess;
  /** Test seam for platform-gated contract tests. Defaults to the host platform. */
  platform?: NodeJS.Platform;
  /** Absolute executable seam for tests; production defaults to the system sandbox-exec path. */
  sandboxExecPath?: string;
};

/**
 * Prototype macOS Seatbelt boundary. It is intentionally not registered by
 * production composition: callers must opt in with both a profile and spawn.
 */
export class MacOSSeatbeltIsolationProvider extends AgentIsolationProvider {
  private readonly profilePath: string;
  private readonly spawnChild: MacOSSeatbeltIsolationProviderOptions['spawn'];
  private readonly platform: NodeJS.Platform;
  private readonly sandboxExecPath: string;

  constructor(options: MacOSSeatbeltIsolationProviderOptions) {
    super(PROVIDER_ID);
    if (!options || typeof options !== 'object') {
      throw new Error('macOS Seatbelt provider options are required');
    }
    if (!isAbsolutePath(options.profilePath)) {
      throw new Error('macOS Seatbelt sandbox profile path must be absolute');
    }
    if (typeof options.spawn !== 'function') {
      throw new Error('macOS Seatbelt provider requires an injected spawn function');
    }

    const sandboxExecPath = options.sandboxExecPath ?? DEFAULT_SANDBOX_EXEC_PATH;
    if (!isAbsolutePath(sandboxExecPath)) {
      throw new Error('macOS Seatbelt executable path must be absolute');
    }

    this.profilePath = path.normalize(options.profilePath);
    this.spawnChild = options.spawn;
    this.platform = options.platform ?? process.platform;
    this.sandboxExecPath = path.normalize(sandboxExecPath);
  }

  override async acquire(input: AgentIsolationAcquireInput): Promise<AgentIsolationLease> {
    this.assertDarwin();
    validateSubject(input.subject);
    if (typeof input.prompt !== 'string') {
      throw providerRejected('Codex 격리 요청의 prompt가 유효하지 않습니다.');
    }

    await this.validateRequest(input);
    const sourceWorkspace = await validateDirectory(input.sourceWorkspace, 'source workspace');
    const workspace = await validateDirectory(input.workspace, 'workspace');
    const protectedRoots = await validateProtectedRoots(input.protectedRoots);
    const leaseWorkspace = path.normalize(input.workspace);

    if (pathsOverlap(sourceWorkspace, workspace)) {
      throw providerRejected('Codex 격리 작업공간이 원본 작업공간과 겹칩니다.');
    }
    if (protectedRoots.some((root) => pathsOverlap(workspace, root))) {
      throw providerRejected('Codex 격리 작업공간이 보호된 경로와 겹칩니다.');
    }
    if (containsProtectedText(input.prompt, protectedRoots)) {
      throw providerRejected('Codex 격리 요청의 prompt에 보호된 경로가 포함되어 실행을 거부했습니다.');
    }
    validateEnvironmentOverrides(input.environmentOverrides, protectedRoots);
    if (pathsOverlap(this.profilePath, sourceWorkspace) || pathsOverlap(this.profilePath, workspace)
      || protectedRoots.some((root) => pathsOverlap(this.profilePath, root))) {
      throw providerRejected('Seatbelt profile은 격리 작업공간 또는 보호된 경로 안에 둘 수 없습니다.');
    }
    if (pathsOverlap(this.sandboxExecPath, sourceWorkspace) || pathsOverlap(this.sandboxExecPath, workspace)
      || protectedRoots.some((root) => pathsOverlap(this.sandboxExecPath, root))) {
      throw providerRejected('sandbox-exec은 격리 작업공간 또는 보호된 경로 안에 둘 수 없습니다.');
    }

    await assertProfileAvailable(this.profilePath);
    await assertExecutableAvailable(this.sandboxExecPath);

    return this.issueLease({
      subject: input.subject,
      workspace: leaseWorkspace,
      protectedRoots,
      environmentOverrides: input.environmentOverrides,
      spawn: (command, args, options) => this.spawnSandboxed(command, args, options, protectedRoots),
    });
  }

  private assertDarwin(): void {
    if (this.platform !== 'darwin') {
      throw new AgentExecutionUnavailableError(
        'trusted-isolation-required',
        'macOS Seatbelt 격리 provider는 macOS에서만 사용할 수 있습니다.',
      );
    }
  }

  private spawnSandboxed(
    command: string,
    args: readonly string[],
    options: AgentIsolationSpawnOptions,
    protectedRoots: readonly string[],
  ): ChildProcess {
    if (typeof command !== 'string' || command.length === 0 || !Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
      throw providerRejected('Codex 실행 command 또는 args가 유효하지 않습니다.');
    }
    if (containsProtectedPath(command, args, options.cwd, protectedRoots)) {
      throw providerRejected('Codex 실행 command/args에 보호된 경로가 포함되어 실행을 거부했습니다.');
    }

    try {
      assertProfileAvailableSync(this.profilePath);
      assertExecutableAvailableSync(this.sandboxExecPath);
    } catch {
      throw new AgentExecutionUnavailableError(
        'trusted-isolation-required',
        'Seatbelt profile 또는 sandbox-exec를 확인하지 못해 Codex 실행을 거부했습니다.',
      );
    }

    try {
      return this.spawnChild(
        this.sandboxExecPath,
        ['-f', this.profilePath, command, ...args],
        options,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new AgentExecutionUnavailableError(
        'trusted-isolation-required',
        `sandbox-exec 실행을 시작하지 못해 Codex 실행을 거부했습니다: ${detail}`,
      );
    }
  }
}

/** Compatibility spelling for callers that use the lowercase macOS style. */
export { MacOSSeatbeltIsolationProvider as MacosSeatbeltIsolationProvider };

function isAbsolutePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\u0000') && path.isAbsolute(value);
}

function validateSubject(subject: AgentIsolationAcquireInput['subject']): void {
  if (!subject || typeof subject !== 'object') {
    throw providerRejected('Codex 격리 요청의 subject가 유효하지 않습니다.');
  }
  const required = [subject.tenantId, subject.requesterId, subject.conversationId];
  if (required.some((value) => !isNonEmptySafeString(value))
    || (subject.jobId !== undefined && !isNonEmptySafeString(subject.jobId))) {
    throw providerRejected('Codex 격리 요청의 사용자·테넌트·대화 주체가 유효하지 않습니다.');
  }
}

function isNonEmptySafeString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
}

async function validateDirectory(candidate: string, label: string): Promise<string> {
  if (!isAbsolutePath(candidate)) throw providerRejected(`${label} path must be absolute.`);
  try {
    const stat = await fs.lstat(candidate);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw providerRejected(`${label} must be a regular directory.`);
    }
    const real = await fs.realpath(candidate);
    return path.normalize(real);
  } catch (error) {
    if (error instanceof AgentExecutionUnavailableError) throw error;
    throw new AgentExecutionUnavailableError('trusted-isolation-required', `${label}를 확인하지 못해 Codex 실행을 거부했습니다.`);
  }
}

async function validateProtectedRoots(roots: readonly string[]): Promise<string[]> {
  if (!Array.isArray(roots) || roots.length === 0) {
    throw providerRejected('Codex 격리 provider에는 보호된 경로가 하나 이상 필요합니다.');
  }
  const result: string[] = [];
  for (const root of roots) {
    if (!isAbsolutePath(root)) throw providerRejected('보호된 경로는 absolute path여야 합니다.');
    result.push(path.normalize(root), await validateDirectory(root, 'protected root'));
  }
  return [...new Set(result)];
}

function validateEnvironmentOverrides(
  overrides: Record<string, string>,
  protectedRoots: readonly string[],
): void {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw providerRejected('Codex 격리 환경 override가 유효하지 않습니다.');
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!isNonEmptySafeString(key) || typeof value !== 'string' || value.includes('\u0000')) {
      throw providerRejected('Codex 격리 환경 override가 유효하지 않습니다.');
    }
    if (containsProtectedText(value, protectedRoots)) {
      throw providerRejected('Codex 격리 환경 override가 보호된 경로를 가리킵니다.');
    }
  }
}

async function assertProfileAvailable(profilePath: string): Promise<void> {
  try {
    const stat = await fs.lstat(profilePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('profile is not a regular file');
    await fs.access(profilePath, fsConstants.R_OK);
  } catch {
    throw new AgentExecutionUnavailableError(
      'trusted-isolation-required',
      'Seatbelt sandbox profile이 없거나 읽을 수 없어 Codex 실행을 거부했습니다.',
    );
  }
}

async function assertExecutableAvailable(executablePath: string): Promise<void> {
  try {
    const stat = await fs.lstat(executablePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('sandbox-exec is not a regular file');
    await fs.access(executablePath, fsConstants.X_OK);
  } catch {
    throw new AgentExecutionUnavailableError(
      'trusted-isolation-required',
      'sandbox-exec를 사용할 수 없어 Codex 실행을 거부했습니다.',
    );
  }
}

function assertProfileAvailableSync(profilePath: string): void {
  const stat = fsSync.lstatSync(profilePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('profile is not a regular file');
  fsSync.accessSync(profilePath, fsConstants.R_OK);
}

function assertExecutableAvailableSync(executablePath: string): void {
  const stat = fsSync.lstatSync(executablePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('sandbox-exec is not a regular file');
  fsSync.accessSync(executablePath, fsConstants.X_OK);
}

function pathsOverlap(left: string, right: string): boolean {
  const a = path.normalize(path.resolve(left));
  const b = path.normalize(path.resolve(right));
  return isSameOrDescendant(a, b) || isSameOrDescendant(b, a);
}

function isSameOrDescendant(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function containsProtectedPath(
  command: string,
  args: readonly string[],
  cwd: string,
  protectedRoots: readonly string[],
): boolean {
  if (containsProtectedText([command, ...args].join('\n'), protectedRoots)) return true;
  return [command, ...args].some((value) => {
    if (value.startsWith('-')) return false;
    const candidate = path.isAbsolute(value) ? path.normalize(value) : path.resolve(cwd, value);
    return protectedRoots.some((root) => isSameOrDescendant(candidate, root));
  });
}

function containsProtectedText(value: string, protectedRoots: readonly string[]): boolean {
  const normalized = value.replaceAll('\\', path.sep);
  return protectedRoots.some((root) => normalized.includes(path.normalize(root)));
}

function providerRejected(message: string): AgentExecutionUnavailableError {
  return new AgentExecutionUnavailableError('provider-rejected-request', message);
}
