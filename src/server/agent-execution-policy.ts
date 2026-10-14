import { constants as fsConstants } from 'node:fs';
import type { ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import { SupervisedCommandCleanupError } from './supervised-command.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { AgentJobMode, AgentJobScope } from './agent-job-store.js';
import { isManagedAgentPtyProcess, type ManagedAgentPtyProcess } from './agent-pty-process.js';

const DEFAULT_ALLOWED_DIRECTORIES = [
  'appPackage',
  'assets',
  'docs',
  'public',
  'scripts',
  'src',
  'test',
  'tests',
] as const;
const DEFAULT_ALLOWED_FILES = new Set([
  'AGENTS.md',
  'CONTEXT.md',
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'tsconfig.json',
]);
const MAX_PROJECTED_FILES = 10_000;
const MAX_PROJECTED_FILE_BYTES = 4 * 1024 * 1024;
const MAX_PROJECTED_TOTAL_BYTES = 64 * 1024 * 1024;
const DEFAULT_LEASE_TTL_MS = 15 * 60 * 1000;
const PROVIDER_BRAND = Symbol('agent-isolation-provider');
const LEASE_BRAND = Symbol('agent-isolation-lease');

export type AgentExecutionDecision =
  | { allowed: true }
  | { allowed: false; reason: 'read-forbidden' | 'write-forbidden' | 'isolation-unavailable' };

export type AgentExecutionReadiness =
  | { state: 'configured'; providerId: string }
  | { state: 'unavailable'; reason: 'isolation-unavailable' };

export type AgentIsolationSubject = Pick<AgentJobScope, 'tenantId' | 'requesterId' | 'conversationId'> & {
  jobId?: string;
};

export type AgentIsolationSpawnOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  detached: boolean;
  stdio: ['ignore', 'pipe', 'pipe'];
};

export type AgentIsolationPtySpawnOptions = Pick<AgentIsolationSpawnOptions, 'cwd' | 'env'> & {
  cols: number;
  rows: number;
  signal?: AbortSignal;
};

/** Provider-owned atomic factory: throw before creating a child, or return its
 * managed cleanup capability synchronously. Async post-spawn handoff is unsupported. */
export type AgentIsolationPtyLaunchCapability = Readonly<{
  preflight(): Promise<void> | void;
  spawn(command: string, args: readonly string[], options: AgentIsolationPtySpawnOptions): ManagedAgentPtyProcess;
}>;

export type AgentIsolationAcquireInput = {
  subject: AgentIsolationSubject;
  sourceWorkspace: string;
  workspace: string;
  protectedRoots: readonly string[];
  environmentOverrides: Record<string, string>;
  prompt: string;
};

type ProviderLeaseInput = {
  subject: AgentIsolationSubject;
  workspace: string;
  protectedRoots: readonly string[];
  environmentOverrides: Record<string, string>;
  spawn: (command: string, args: readonly string[], options: AgentIsolationSpawnOptions) => ChildProcess;
  /** Validate/build the trusted launch before reserving execution. The returned
   * atomic function is the only phase allowed to create a native process. */
  preparePty?: (command: string, args: readonly string[], options: AgentIsolationPtySpawnOptions) => () => ManagedAgentPtyProcess;
  observeCliVersion?: (signal: AbortSignal) => Promise<string | undefined>;
  dispose?: () => Promise<void> | void;
  ttlMs?: number;
};

export type AgentIsolationLease = {
  readonly leaseId: string;
  readonly providerId: string;
  readonly workspace: string;
  readonly environmentOverrides: Readonly<Record<string, string>>;
  bindJob: (jobId: string) => void;
  spawn: (
    subject: AgentIsolationSubject,
    command: string,
    args: readonly string[],
    options: AgentIsolationSpawnOptions,
  ) => Promise<ChildProcess>;
  /** Absent unless this exact provider preflighted and supplied native PTY/tree control. */
  spawnPty?: (subject: AgentIsolationSubject, command: string, args: readonly string[], options: AgentIsolationPtySpawnOptions) => Promise<ManagedAgentPtyProcess>;
  /** Fixed metadata operation; provider owns executable identity and environment. */
  observeCliVersion?: (subject: AgentIsolationSubject, signal: AbortSignal) => Promise<string | undefined>;
  dispose: () => Promise<void>;
};

type LeaseObservations = { closed: boolean; unverified: boolean; pending: Set<Promise<unknown>> };
const leaseObservations = new WeakMap<AgentIsolationLease, LeaseObservations>();

/** Trusted internal metadata work shares the lease lifetime. This grants no
 * launch/input capability and cannot clear an uncertain cleanup. */
export function withAgentIsolationObservation<T>(lease: AgentIsolationLease, operation: () => Promise<T>): Promise<T> {
  const state = leaseObservations.get(lease);
  if (!state || state.closed) return Promise.reject(new AgentExecutionUnavailableError('stale-isolation-lease', '격리 관측 lease가 폐기되었습니다.'));
  const pending = Promise.resolve().then(() => {
    if (state.closed) throw new AgentExecutionUnavailableError('stale-isolation-lease', '격리 관측 lease가 폐기되었습니다.');
    return operation();
  }).catch(error => {
    if (error instanceof SupervisedCommandCleanupError) state.unverified = true;
    throw error;
  });
  state.pending.add(pending);
  void pending.finally(() => state.pending.delete(pending)).catch(() => undefined);
  return pending;
}

export class AgentExecutionUnavailableError extends Error {
  readonly code = 'UNAVAILABLE' as const;
  readonly reason:
    | 'trusted-isolation-required'
    | 'canonicalization-failed'
    | 'provider-rejected-request'
    | 'stale-isolation-lease'
    | 'process-tree-control-required' = 'trusted-isolation-required';

  constructor(
    reason: AgentExecutionUnavailableError['reason'] = 'trusted-isolation-required',
    message = '읽기 전용 Codex는 원본 저장소와 사용자 홈을 차단하는 신뢰된 격리 경계가 구성된 경우에만 사용할 수 있습니다.',
  ) {
    super(message);
    this.name = 'AgentExecutionUnavailableError';
    this.reason = reason;
  }
}

export class AgentWorkspaceProjectionError extends Error {
  readonly code = 'AGENT_WORKSPACE_PROJECTION_FAILED' as const;

  constructor(message = 'Codex 읽기 전용 작업공간을 안전하게 준비하지 못했습니다.') {
    super(message);
    this.name = 'AgentWorkspaceProjectionError';
  }
}

/**
 * Only a provider can mint a lease. A cwd, a protected-roots claim, or an
 * assertLaunch callback is intentionally not a provider and cannot be passed
 * to the runner. Production has no provider until a real OS-enforced one is
 * implemented and injected.
 */
export abstract class AgentIsolationProvider {
  readonly [PROVIDER_BRAND] = true;

  constructor(readonly providerId: string) {
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(providerId)) {
      throw new Error('agent isolation provider id is invalid');
    }
  }

  async validateRequest(input: {
    subject: AgentIsolationSubject;
    sourceWorkspace: string;
    prompt: string;
  }): Promise<void> {
    const sourceRoot = await canonicalPath(input.sourceWorkspace);
    const homeRoot = await canonicalPath(os.homedir());
    const sourceClaim = path.resolve(input.sourceWorkspace);
    const homeClaim = path.resolve(os.homedir());
    if (containsProtectedPath(input.prompt, [sourceRoot, sourceClaim, homeRoot, homeClaim])) {
      throw new AgentExecutionUnavailableError(
        'provider-rejected-request',
        '읽기 전용 Codex 요청에 원본 저장소 또는 사용자 홈의 절대 경로가 포함되어 실행을 거부했습니다.',
      );
    }
  }

  abstract acquire(input: AgentIsolationAcquireInput): Promise<AgentIsolationLease>;

  protected issueLease(input: ProviderLeaseInput): AgentIsolationLease {
    const leaseId = crypto.randomUUID();
    const originalSubject = { ...input.subject };
    const protectedRoots = input.protectedRoots.map((entry) => path.normalize(entry));
    const ttlMs = Number.isSafeInteger(input.ttlMs) && (input.ttlMs ?? 0) > 0
      ? input.ttlMs!
      : DEFAULT_LEASE_TTL_MS;
    const expiresAt = Date.now() + ttlMs;
    let boundJobId = input.subject.jobId;
    let disposed = false;
    let disposePromise: Promise<void> | undefined;
    let executionReserved = false;
    let ptyStart: Promise<ManagedAgentPtyProcess> | undefined;
    let ptyProcess: ManagedAgentPtyProcess | undefined;
    let unverifiedPtyStart = false;
    let expiryTimer: NodeJS.Timeout | undefined;
    const observations: LeaseObservations = { closed: false, unverified: false, pending: new Set() };

    const validate = (subject: AgentIsolationSubject, options: Pick<AgentIsolationSpawnOptions, 'cwd' | 'env'>, args: readonly string[]): void => {
      if (disposed || Date.now() >= expiresAt) {
        throw new AgentExecutionUnavailableError('stale-isolation-lease', '읽기 전용 Codex 격리 lease가 만료되었거나 폐기되었습니다.');
      }
      if (
        subject.tenantId !== originalSubject.tenantId
        || subject.requesterId !== originalSubject.requesterId
        || subject.conversationId !== originalSubject.conversationId
        || (boundJobId !== undefined && subject.jobId !== boundJobId)
      ) {
        throw new AgentExecutionUnavailableError('provider-rejected-request', 'Codex 격리 lease의 사용자·테넌트·작업 주체가 일치하지 않습니다.');
      }
      if (path.normalize(options.cwd) !== path.normalize(input.workspace)) {
        throw new AgentExecutionUnavailableError('provider-rejected-request', 'Codex 격리 lease의 작업공간이 일치하지 않습니다.');
      }
      if (containsProtectedPath(args.join('\n'), protectedRoots)) {
        throw new AgentExecutionUnavailableError(
          'provider-rejected-request',
          'Codex 실행 인자에 원본 저장소 또는 사용자 홈의 절대 경로가 포함되어 실행을 거부했습니다.',
        );
      }
      if (options.env.HOME && containsProtectedPath(options.env.HOME, protectedRoots)) {
        throw new AgentExecutionUnavailableError('provider-rejected-request', 'Codex 실행 환경이 원본 사용자 홈을 가리킵니다.');
      }
    };

    const lease: AgentIsolationLease & {
      [LEASE_BRAND]: AgentIsolationProvider;
    } = {
      [LEASE_BRAND]: this,
      leaseId,
      providerId: this.providerId,
      workspace: input.workspace,
      environmentOverrides: Object.freeze({ ...input.environmentOverrides }),
      bindJob: (jobId: string): void => {
        if (disposed || !jobId || (boundJobId !== undefined && boundJobId !== jobId)) {
          throw new AgentExecutionUnavailableError('stale-isolation-lease', 'Codex 격리 lease를 작업에 바인딩할 수 없습니다.');
        }
        boundJobId = jobId;
      },
      spawn: async (subject, command, args, options): Promise<ChildProcess> => {
        validate(subject, options, args);
        if (input.preparePty) {
          if (executionReserved) throw new AgentExecutionUnavailableError('provider-rejected-request', '격리 lease의 실행은 이미 시작되었습니다.');
          executionReserved = true;
        }
        return input.spawn(command, args, options);
      },
      ...(input.observeCliVersion ? {
        observeCliVersion: (subject: AgentIsolationSubject, signal: AbortSignal) => {
          validate(subject, { cwd: input.workspace, env: { ...input.environmentOverrides } }, ['--version']);
          if (signal.aborted) return Promise.reject(new AgentExecutionUnavailableError('stale-isolation-lease', '격리 관측이 취소되었습니다.'));
          return withAgentIsolationObservation(lease, () => input.observeCliVersion!(signal));
        },
      } : {}),
      ...(input.preparePty ? {
        spawnPty: async (subject: AgentIsolationSubject, command: string, args: readonly string[], options: AgentIsolationPtySpawnOptions): Promise<ManagedAgentPtyProcess> => {
          validate(subject, options, args);
          if (!boundJobId || subject.jobId !== boundJobId || executionReserved
            || !Number.isSafeInteger(options.cols) || options.cols < 1 || options.cols > 512
            || !Number.isSafeInteger(options.rows) || options.rows < 1 || options.rows > 256) {
            throw new AgentExecutionUnavailableError('provider-rejected-request', 'PTY 작업 바인딩, 실행 상태 또는 크기가 유효하지 않습니다.');
          }
          const signal = options.signal;
          if (signal?.aborted) throw new AgentExecutionUnavailableError('stale-isolation-lease', 'PTY 시작이 취소되었습니다.');
          executionReserved = true;
          let launch: () => ManagedAgentPtyProcess;
          try {
            launch = input.preparePty!(command, Object.freeze([...args]), { ...options, env: { ...options.env }, signal });
            if (typeof launch !== 'function') throw new AgentExecutionUnavailableError('process-tree-control-required', '원자적인 PTY 시작 capability가 필요합니다.');
            validate(subject, options, args);
            if (signal?.aborted) throw new AgentExecutionUnavailableError('stale-isolation-lease', 'PTY 준비 중 시작이 취소되었습니다.');
          } catch (error) { executionReserved = false; throw error; }
          let resolveStart!: (value: ManagedAgentPtyProcess) => void;
          let rejectStart!: (error: unknown) => void;
          ptyStart = new Promise((resolve, reject) => { resolveStart = resolve; rejectStart = reject; });
          void ptyStart.catch(() => undefined);
          try {
            const resource = launch();
            if (!isManagedAgentPtyProcess(resource)) throw new AgentExecutionUnavailableError('process-tree-control-required', '관리되는 PTY 정리 capability가 필요합니다.');
            ptyProcess = resource;
            const cancel = () => resource.requestTermination();
            signal?.addEventListener('abort', cancel, { once: true });
            const removeAbort = () => signal?.removeEventListener('abort', cancel);
            void resource.finished.then(removeAbort, removeAbort);
            queueMicrotask(() => {
              if (disposed || signal?.aborted) {
                void resource.terminate().then(
                  () => rejectStart(new AgentExecutionUnavailableError('stale-isolation-lease', 'PTY 시작 중 lease가 종료되거나 취소되었습니다.')),
                  rejectStart,
                );
              } else resolveStart(resource);
            });
          } catch {
            unverifiedPtyStart = true;
            rejectStart(new AgentExecutionUnavailableError('process-tree-control-required', 'PTY_START_UNVERIFIED'));
          }
          return ptyStart;
        },
      } : {}),
      dispose: async (): Promise<void> => {
        disposePromise ??= (async () => {
          disposed = true;
          observations.closed = true;
          if (expiryTimer) clearTimeout(expiryTimer);
          await Promise.allSettled([...observations.pending]);
          if (ptyStart) {
            try { await ptyStart; } catch { /* still reap any resource created before the failed handoff */ }
            if (ptyProcess) await ptyProcess.terminate();
            else if (unverifiedPtyStart) throw new AgentExecutionUnavailableError('process-tree-control-required', 'PTY_START_UNVERIFIED');
          }
          if (observations.unverified) throw new AgentExecutionUnavailableError('process-tree-control-required', 'AUXILIARY_PROCESS_CLEANUP_UNVERIFIED');
          await input.dispose?.();
        })();
        await disposePromise;
      },
    };
    leaseObservations.set(lease, observations);
    if (input.preparePty) {
      expiryTimer = setTimeout(() => { void lease.dispose().catch(() => undefined); }, ttlMs);
      expiryTimer.unref();
    }
    return lease;
  }
}

export function isProviderOwnedLease(
  provider: AgentIsolationProvider,
  value: unknown,
): value is AgentIsolationLease {
  return Boolean(
    value
    && typeof value === 'object'
    && (value as { [LEASE_BRAND]?: unknown })[LEASE_BRAND] === provider
    && typeof (value as AgentIsolationLease).bindJob === 'function'
    && typeof (value as AgentIsolationLease).spawn === 'function'
    && typeof (value as AgentIsolationLease).dispose === 'function',
  );
}

export function isAgentIsolationLease(value: unknown): value is AgentIsolationLease {
  return Boolean(
    value
    && typeof value === 'object'
    && (value as { [LEASE_BRAND]?: unknown })[LEASE_BRAND] instanceof AgentIsolationProvider
    && typeof (value as AgentIsolationLease).leaseId === 'string'
    && typeof (value as AgentIsolationLease).providerId === 'string'
    && typeof (value as AgentIsolationLease).bindJob === 'function'
    && typeof (value as AgentIsolationLease).spawn === 'function'
    && typeof (value as AgentIsolationLease).dispose === 'function',
  );
}

export type AgentExecutionWorkspace = {
  workspace: string;
  projected: boolean;
  isolationLease?: AgentIsolationLease;
  environmentOverrides?: Record<string, string>;
  dispose: () => Promise<void>;
};

type ProjectionBudget = { files: number; bytes: number };
type ProjectionKind = 'directory' | 'file';
type ProjectionIdentity = {
  kind: ProjectionKind;
  dev: string;
  ino: string;
  mode: number;
  nlink: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
  contentHash?: string;
};
type ProjectionSnapshot = Map<string, ProjectionIdentity>;

export class AgentExecutionPolicy {
  constructor(
    private readonly sourceWorkspace: string,
    private readonly options: {
      canReadScope?: (scope: AgentJobScope) => boolean;
      canMutateScope?: (scope: AgentJobScope) => boolean;
      allowedDirectories?: readonly string[];
      isolationProvider?: AgentIsolationProvider;
      projectionHooks?: { afterCopy?: () => Promise<void> | void };
    } = {},
  ) {}

  /**
   * Reports only startup configuration. A configured provider still performs
   * its native, per-job preflight in prepareWorkspace(); this method must not
   * be used as proof that a child process has already run successfully.
   */
  readOnlyExecutionReadiness(): AgentExecutionReadiness {
    const provider = this.options.isolationProvider;
    return provider
      ? { state: 'configured', providerId: provider.providerId }
      : { state: 'unavailable', reason: 'isolation-unavailable' };
  }

  authorize(scope: AgentJobScope, mode: AgentJobMode): AgentExecutionDecision {
    if (mode === 'workspace-write') {
      return this.options.canMutateScope?.(scope) === true
        ? { allowed: true }
        : { allowed: false, reason: 'write-forbidden' };
    }
    const canRead = this.options.canReadScope
      ? this.options.canReadScope(scope)
      : this.options.canMutateScope?.(scope);
    if (canRead !== true) return { allowed: false, reason: 'read-forbidden' };
    return this.options.isolationProvider
      ? { allowed: true }
      : { allowed: false, reason: 'isolation-unavailable' };
  }

  async prepareWorkspace(
    mode: AgentJobMode,
    scope?: AgentJobScope,
    prompt = '',
  ): Promise<AgentExecutionWorkspace> {
    if (mode === 'workspace-write') {
      return { workspace: this.sourceWorkspace, projected: false, dispose: async () => undefined };
    }
    const provider = this.options.isolationProvider;
    if (!provider || !scope) throw new AgentExecutionUnavailableError();
    await provider.validateRequest({ subject: scope, sourceWorkspace: this.sourceWorkspace, prompt });
    return this.createReadOnlyProjection(provider, scope, prompt);
  }

  private async createReadOnlyProjection(
    provider: AgentIsolationProvider,
    scope: AgentJobScope,
    prompt: string,
  ): Promise<AgentExecutionWorkspace> {
    let projectionRoot: string | undefined;
    let lease: AgentIsolationLease | undefined;
    try {
      assertNoFollowSupport();
      const sourceRoot = await canonicalPathOrUnavailable(this.sourceWorkspace);
      const homeRoot = await canonicalPathOrUnavailable(os.homedir());
      projectionRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-agent-projection-'));
      await fs.chmod(projectionRoot, 0o700);
      const isolatedHome = path.join(projectionRoot, '.isolated-home');
      const isolatedCodexHome = path.join(isolatedHome, '.codex');
      await fs.mkdir(isolatedCodexHome, { recursive: true, mode: 0o700 });
      const environmentOverrides = { HOME: isolatedHome, USERPROFILE: isolatedHome, CODEX_HOME: isolatedCodexHome };
      const allowedDirectories = new Set(this.options.allowedDirectories ?? DEFAULT_ALLOWED_DIRECTORIES);
      const budget: ProjectionBudget = { files: 0, bytes: 0 };
      const before = await captureProjectionSnapshot(sourceRoot, allowedDirectories, budget);
      const rootEntries = (await fs.readdir(sourceRoot, { withFileTypes: true }))
        .sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of rootEntries) {
        if (isDeniedEntry(entry.name)) continue;
        const allowed = (entry.isDirectory() && allowedDirectories.has(entry.name))
          || (entry.isFile() && isAllowedRootFile(entry.name));
        if (!allowed) continue;
        await copyProjectionEntry(sourceRoot, path.join(sourceRoot, entry.name), path.join(projectionRoot, entry.name), before);
      }
      await this.options.projectionHooks?.afterCopy?.();
      await verifyProjectionSnapshot(sourceRoot, allowedDirectories, before);
      await verifyProjectionContents(projectionRoot, sourceRoot, allowedDirectories, before);
      await fs.chmod(projectionRoot, 0o500);
      lease = await provider.acquire({
        subject: scope,
        sourceWorkspace: sourceRoot,
        workspace: projectionRoot,
        protectedRoots: [sourceRoot, homeRoot],
        environmentOverrides,
        prompt,
      });
      if (!isProviderOwnedLease(provider, lease)) {
        throw new AgentExecutionUnavailableError('provider-rejected-request', '격리 provider가 소유한 lease가 아닙니다.');
      }
      return {
        workspace: lease.workspace,
        projected: true,
        isolationLease: lease,
        environmentOverrides: { ...lease.environmentOverrides },
        dispose: onceAsync(async () => {
          let leaseError: unknown;
          try {
            await lease?.dispose();
          } catch (error) {
            leaseError = error;
          }
          try {
            if (projectionRoot) {
              await makeTreeWritable(projectionRoot);
              await fs.rm(projectionRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
            }
          } catch (cleanupError) {
            if (!leaseError) throw cleanupError;
          }
          if (leaseError) throw leaseError;
        }),
      };
    } catch (error) {
      try { await lease?.dispose(); } catch { /* durable cleanup is tracked by the caller */ }
      if (projectionRoot) {
        try {
          await makeTreeWritable(projectionRoot);
          await fs.rm(projectionRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
        } catch {
          // Preserve the primary fail-closed error.
        }
      }
      if (error instanceof AgentExecutionUnavailableError) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new AgentWorkspaceProjectionError(`Codex 읽기 전용 작업공간을 안전하게 준비하지 못했습니다: ${detail}`);
    }
  }
}

function assertNoFollowSupport(): void {
  if (typeof fsConstants.O_NOFOLLOW !== 'number') {
    throw new AgentExecutionUnavailableError('canonicalization-failed', 'O_NOFOLLOW를 지원하지 않는 실행 환경에서는 읽기 전용 Codex를 시작하지 않습니다.');
  }
}

async function canonicalPath(candidate: string): Promise<string> {
  try {
    return await fs.realpath(candidate);
  } catch {
    throw new AgentExecutionUnavailableError('canonicalization-failed', 'Codex 격리 경계의 canonical 경로를 확인하지 못했습니다.');
  }
}

async function canonicalPathOrUnavailable(candidate: string): Promise<string> {
  return canonicalPath(candidate);
}

function isAllowedRootFile(name: string): boolean {
  return DEFAULT_ALLOWED_FILES.has(name) || /^README(?:\..+)?$/i.test(name) || /^tsconfig(?:\..+)?\.json$/i.test(name);
}

function isDeniedEntry(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === '.git' || lower === 'data' || lower === 'node_modules' || lower === 'dist'
    || lower === 'secrets' || lower === 'credentials' || lower === '.codex' || lower === '.superpowers'
    || lower === '.env' || lower.startsWith('.env.') || lower === 'id_rsa' || lower.startsWith('id_rsa.')
    || lower === 'id_ed25519' || lower.startsWith('id_ed25519.')
    || /\.(?:key|pem|p12|pfx|jks|keystore)$/i.test(name);
}

async function captureProjectionSnapshot(
  sourceRoot: string,
  allowedDirectories: ReadonlySet<string>,
  budget: ProjectionBudget,
): Promise<ProjectionSnapshot> {
  const snapshot: ProjectionSnapshot = new Map();
  await captureDirectory(sourceRoot, '.', true, snapshot, allowedDirectories, budget);
  return snapshot;
}

async function captureDirectory(
  directoryPath: string,
  relativeDirectory: string,
  isRoot: boolean,
  snapshot: ProjectionSnapshot,
  allowedDirectories: ReadonlySet<string>,
  budget: ProjectionBudget,
): Promise<void> {
  const directoryStat = await fs.lstat(directoryPath);
  assertRegularDirectory(directoryStat, relativeDirectory);
  snapshot.set(relativeDirectory, identityOf('directory', directoryStat));
  const entries = (await fs.readdir(directoryPath, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relative = relativeDirectory === '.' ? entry.name : path.join(relativeDirectory, entry.name);
    const entryPath = path.join(directoryPath, entry.name);
    const stat = await fs.lstat(entryPath);
    const isProjected = isRoot ? (entry.isDirectory() ? allowedDirectories.has(entry.name) : isAllowedRootFile(entry.name)) : true;
    const identity = await inspectEntry(stat, relative, entryPath, isProjected, budget);
    snapshot.set(relative, identity);
    if (identity.kind === 'directory' && (isRoot ? allowedDirectories.has(entry.name) : !isDeniedEntry(entry.name))) {
      await captureDirectory(entryPath, relative, false, snapshot, allowedDirectories, budget);
    }
  }
}

async function verifyProjectionSnapshot(
  sourceRoot: string,
  allowedDirectories: ReadonlySet<string>,
  expected: ProjectionSnapshot,
): Promise<void> {
  const actual = await captureProjectionSnapshot(sourceRoot, allowedDirectories, { files: 0, bytes: 0 });
  if (actual.size !== expected.size) throw new Error('projection source directory entries changed during final re-enumeration');
  for (const [relative, identity] of expected) {
    const current = actual.get(relative);
    if (!current || !sameIdentity(identity, current)) throw new Error(`projection source changed: ${relative}`);
  }
}

async function verifyProjectionContents(
  projectionRoot: string,
  sourceRoot: string,
  allowedDirectories: ReadonlySet<string>,
  sourceSnapshot: ProjectionSnapshot,
): Promise<void> {
  const expected = new Set<string>(['.', '.isolated-home', path.join('.isolated-home', '.codex')]);
  for (const [relative] of sourceSnapshot) {
    if (relative === '.' || isProjectedRelative(relative, allowedDirectories)) expected.add(relative);
  }
  const actual = new Map<string, ProjectionIdentity>();
  await captureDestinationDirectory(projectionRoot, '.', actual);
  if (actual.size !== expected.size) throw new Error('projection destination changed during final enumeration');
  for (const relative of expected) {
    const identity = actual.get(relative);
    if (!identity) throw new Error(`projection destination is missing: ${relative}`);
    if (relative === '.' || relative.startsWith('.isolated-home')) continue;
    const source = sourceSnapshot.get(relative);
    if (!source || source.kind !== identity.kind || source.size !== identity.size || source.contentHash !== identity.contentHash) {
      throw new Error(`projection destination content identity mismatch: ${relative}`);
    }
  }
  void sourceRoot;
}

function isProjectedRelative(relative: string, allowedDirectories: ReadonlySet<string>): boolean {
  const first = relative.split(path.sep)[0];
  return allowedDirectories.has(first) || (relative === first && isAllowedRootFile(first));
}

async function captureDestinationDirectory(directoryPath: string, relativeDirectory: string, output: Map<string, ProjectionIdentity>): Promise<void> {
  const stat = await fs.lstat(directoryPath);
  assertRegularDirectory(stat, relativeDirectory);
  output.set(relativeDirectory, identityOf('directory', stat));
  const entries = (await fs.readdir(directoryPath, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const relative = relativeDirectory === '.' ? entry.name : path.join(relativeDirectory, entry.name);
    const entryPath = path.join(directoryPath, entry.name);
    const entryStat = await fs.lstat(entryPath);
    if (entryStat.isSymbolicLink() || (!entryStat.isDirectory() && !entryStat.isFile()) || (entryStat.isFile() && entryStat.nlink !== 1)) {
      throw new Error(`projection destination contains an unsafe entry: ${relative}`);
    }
    output.set(relative, {
      ...identityOf(entryStat.isDirectory() ? 'directory' : 'file', entryStat),
      ...(entryStat.isFile() ? { contentHash: hashBuffer(await fs.readFile(entryPath)) } : {}),
    });
    if (entryStat.isDirectory()) await captureDestinationDirectory(entryPath, relative, output);
  }
}

async function inspectEntry(
  stat: Awaited<ReturnType<typeof fs.lstat>>,
  relative: string,
  absolutePath: string,
  hashFile: boolean,
  budget: ProjectionBudget,
): Promise<ProjectionIdentity> {
  if (stat.isSymbolicLink()) throw new Error(`symbolic links and reparse points are not allowed: ${relative}`);
  if (stat.isDirectory()) return identityOf('directory', stat);
  if (!stat.isFile()) throw new Error(`non-regular files are not allowed: ${relative}`);
  if (stat.nlink !== 1) throw new Error(`hard-linked files are not allowed: ${relative}`);
  if (hashFile) {
    const size = statNumber(stat.size, relative);
    if (size > MAX_PROJECTED_FILE_BYTES) throw new Error(`projection file exceeds the per-file limit: ${relative}`);
    budget.files += 1;
    budget.bytes += size;
    if (budget.files > MAX_PROJECTED_FILES || budget.bytes > MAX_PROJECTED_TOTAL_BYTES) throw new Error('projection exceeds bounded limits');
  }
  return {
    ...identityOf('file', stat),
    ...(hashFile ? { contentHash: hashBuffer(await fs.readFile(absolutePath)) } : {}),
  };
}

async function copyProjectionEntry(sourceRoot: string, sourcePath: string, destinationPath: string, snapshot: ProjectionSnapshot): Promise<void> {
  const relative = path.relative(sourceRoot, sourcePath);
  const expected = snapshot.get(relative);
  if (!relative || !expected || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`invalid projection path: ${relative}`);
  const resolved = await canonicalPath(sourcePath);
  if (!samePath(resolved, path.resolve(sourcePath))) throw new Error(`projection crossed a reparse point: ${relative}`);
  const stat = await fs.lstat(sourcePath);
  if (!sameIdentity(expected, await inspectEntry(stat, relative, sourcePath, false, { files: 0, bytes: 0 }))) throw new Error(`projection source changed: ${relative}`);
  if (stat.isDirectory()) {
    await fs.mkdir(destinationPath, { recursive: false, mode: 0o700 });
    const children = (await fs.readdir(sourcePath, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      if (isDeniedEntry(child.name)) continue;
      await copyProjectionEntry(sourceRoot, path.join(sourcePath, child.name), path.join(destinationPath, child.name), snapshot);
    }
    const after = await fs.lstat(sourcePath);
    if (!sameIdentity(expected, identityOf('directory', after))) throw new Error(`projection directory changed: ${relative}`);
    await fs.chmod(destinationPath, 0o500);
    return;
  }
  const handle = await fs.open(sourcePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) throw new Error(`projection source changed while opened: ${relative}`);
    const contents = await handle.readFile();
    const afterRead = await handle.stat();
    if (afterRead.dev !== opened.dev || afterRead.ino !== opened.ino || afterRead.size !== opened.size || afterRead.mtimeMs !== opened.mtimeMs || afterRead.ctimeMs !== opened.ctimeMs || hashBuffer(contents) !== expected.contentHash) throw new Error(`projection source changed while read: ${relative}`);
    await fs.writeFile(destinationPath, contents, { flag: 'wx', mode: 0o400 });
  } finally {
    await handle.close();
  }
}

function identityOf(kind: ProjectionKind, stat: Awaited<ReturnType<typeof fs.lstat>>): ProjectionIdentity {
  return {
    kind,
    dev: String(stat.dev),
    ino: String(stat.ino),
    mode: statNumber(stat.mode, 'mode'),
    nlink: statNumber(stat.nlink, 'nlink'),
    size: statNumber(stat.size, 'size'),
    mtimeMs: statNumber(stat.mtimeMs, 'mtimeMs'),
    ctimeMs: statNumber(stat.ctimeMs, 'ctimeMs'),
    birthtimeMs: statNumber(stat.birthtimeMs, 'birthtimeMs'),
  };
}

function statNumber(value: number | bigint, field: string): number {
  if (typeof value === 'number') return value;
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized)) throw new Error(`filesystem ${field} is outside the supported numeric range`);
  return normalized;
}

function sameIdentity(left: ProjectionIdentity, right: ProjectionIdentity): boolean {
  return left.kind === right.kind && left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.nlink === right.nlink && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs && left.birthtimeMs === right.birthtimeMs && (left.contentHash === undefined || right.contentHash === undefined || left.contentHash === right.contentHash);
}

function assertRegularDirectory(stat: Awaited<ReturnType<typeof fs.lstat>>, relative: string): void {
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`projection path is not a regular directory: ${relative}`);
}

function samePath(left: string, right: string): boolean {
  const a = path.normalize(left);
  const b = path.normalize(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function containsProtectedPath(value: string, roots: readonly string[]): boolean {
  const normalized = value.replaceAll('\\', path.sep);
  return roots.some((root) => {
    const candidate = path.normalize(root);
    return normalized === candidate || normalized.includes(`${candidate}${path.sep}`) || normalized.includes(candidate);
  });
}

function hashBuffer(contents: Uint8Array): string {
  return crypto.createHash('sha256').update(contents).digest('hex');
}

async function makeTreeWritable(root: string): Promise<void> {
  try {
    await fs.chmod(root, 0o700);
    const entries = await fs.readdir(root, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      const child = path.join(root, entry.name);
      if (entry.isDirectory()) await makeTreeWritable(child);
      else await fs.chmod(child, 0o600).catch(() => undefined);
    }));
  } catch {
    // The caller performs the bounded force-removal attempt.
  }
}

function onceAsync(operation: () => Promise<void>): () => Promise<void> {
  let pending: Promise<void> | undefined;
  return () => {
    pending ??= operation();
    return pending;
  };
}
