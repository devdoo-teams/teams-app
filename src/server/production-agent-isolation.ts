import { spawn, type ChildProcess } from 'node:child_process';

import type { AgentJobScope } from './agent-job-store.js';
import {
  AgentExecutionPolicy,
  AgentIsolationProvider,
  type AgentIsolationAcquireInput,
  type AgentIsolationLease,
  type AgentIsolationSpawnOptions,
} from './agent-execution-policy.js';
import {
  CODEX_EXTERNAL_TOOL_SURFACE_POLICY,
  CodexPermissionProfileIsolationProvider,
  type ExecutableTrustVerifier,
} from './codex-permission-profile-isolation-provider.js';
import { MacOSSeatbeltIsolationProvider } from './macos-seatbelt-isolation-provider.js';

export type ProductionAgentExecutionPolicyOptions = Readonly<{
  sourceWorkspace: string;
  isProduction: boolean;
  canReadScope?: (scope: AgentJobScope) => boolean;
  canMutateScope?: (scope: AgentJobScope) => boolean;
  /** Dedicated service auth home used only by the trusted Codex parent. */
  codexHome?: string;
  /** Explicit pinned Codex executable. Relative PATH lookup is not a production boundary. */
  codexExecutable?: string;
  /** Operator-pinned SHA-256 of the signed Codex executable. */
  codexExecutableSha256?: string;
  /** Test seam for the native permission-profile enforcement probe. */
  nativePreflight?: (input: {
    codexExecutable: string;
    codexHome: string;
    workspace: string;
    environment: Readonly<NodeJS.ProcessEnv>;
    toolSurfacePolicy: typeof CODEX_EXTERNAL_TOOL_SURFACE_POLICY;
  }) => Promise<void>;
  /** Test seam only; production uses the OpenAI Developer ID requirement. */
  nativeExecutableTrustVerifier?: ExecutableTrustVerifier;
  /** Local test-only compatibility seam; never enabled by production composition. */
  allowLegacySeatbeltTestProvider?: boolean;
  /**
   * Explicit cross-platform process fixture for loopback integration tests.
   * It is not an OS security boundary and must remain disabled in production.
   */
  allowUnsafeTestProcessProvider?: boolean;
  /** Explicitly trusted, absolute Seatbelt profile for hermetic local fixtures only. */
  profilePath?: string;
  /** Optional explicit absolute sandbox-exec path for hermetic local fixtures only. */
  sandboxExecPath?: string;
  /** Test seam for the platform-gated provider. */
  platform?: NodeJS.Platform;
  /** Test seam; production defaults to node:child_process spawn. */
  spawn?: (command: string, args: readonly string[], options: AgentIsolationSpawnOptions) => ChildProcess;
}>;

/**
 * Production is opt-in: native Codex inputs must be complete and trusted or
 * AgentExecutionPolicy remains fail-closed. Local providers are explicit test
 * seams and are rejected whenever isProduction is true.
 */
export function createProductionAgentIsolationProvider(
  options: ProductionAgentExecutionPolicyOptions,
): AgentIsolationProvider | undefined {
  const platform = options.platform ?? process.platform;
  const spawnChild = options.spawn ?? ((command, args, spawnOptions) => (
    spawn(command, [...args], spawnOptions as any)
  ));

  if (!options.isProduction && options.allowUnsafeTestProcessProvider) {
    return new UnsafeTestProcessIsolationProvider(spawnChild);
  }

  const profilePath = normalizedOptionalValue(options.profilePath);
  const sandboxExecPath = normalizedOptionalValue(options.sandboxExecPath);
  if (sandboxExecPath && !profilePath) {
    throw new Error('AGENT_SANDBOX_EXEC_PATH requires AGENT_ISOLATION_PROFILE.');
  }
  if (!options.isProduction) {
    if (!options.allowLegacySeatbeltTestProvider || !profilePath || platform !== 'darwin') return undefined;
    return new MacOSSeatbeltIsolationProvider({
      profilePath,
      platform,
      spawn: spawnChild,
      ...(sandboxExecPath ? { sandboxExecPath } : {}),
    });
  }

  const codexHome = normalizedOptionalValue(options.codexHome);
  const codexExecutable = normalizedOptionalValue(options.codexExecutable);
  const codexExecutableSha256 = normalizedOptionalValue(options.codexExecutableSha256)?.toLowerCase();
  const configuredNativeInputs = [codexHome, codexExecutable, codexExecutableSha256].filter(Boolean).length;
  if (configuredNativeInputs !== 0 && configuredNativeInputs !== 3) {
    throw new Error('AGENT_CODEX_HOME, absolute CODEX_BIN, and CODEX_BIN_SHA256 must be configured together.');
  }
  if (codexHome && codexExecutable && codexExecutableSha256) {
    if (platform !== 'darwin') return undefined;
    return new CodexPermissionProfileIsolationProvider({
      codexHome,
      codexExecutable,
      codexExecutableSha256,
      platform,
      ...(options.nativePreflight ? { preflight: options.nativePreflight } : {}),
      ...(options.spawn ? { spawn: options.spawn } : {}),
      ...(options.nativeExecutableTrustVerifier
        ? { executableTrustVerifier: options.nativeExecutableTrustVerifier }
        : {}),
    });
  }

  return undefined;
}

export function createProductionAgentExecutionPolicy(
  options: ProductionAgentExecutionPolicyOptions,
): AgentExecutionPolicy {
  const isolationProvider = createProductionAgentIsolationProvider(options);
  return new AgentExecutionPolicy(options.sourceWorkspace, {
    ...(options.canReadScope ? { canReadScope: options.canReadScope } : {}),
    ...(options.canMutateScope ? { canMutateScope: options.canMutateScope } : {}),
    ...(isolationProvider ? { isolationProvider } : {}),
  });
}

function normalizedOptionalValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

class UnsafeTestProcessIsolationProvider extends AgentIsolationProvider {
  constructor(
    private readonly spawnChild: (
      command: string,
      args: readonly string[],
      options: AgentIsolationSpawnOptions,
    ) => ChildProcess,
  ) {
    super('unsafe-test-process');
  }

  override async acquire(input: AgentIsolationAcquireInput): Promise<AgentIsolationLease> {
    await this.validateRequest(input);
    return this.issueLease({
      subject: input.subject,
      workspace: input.workspace,
      protectedRoots: input.protectedRoots,
      environmentOverrides: input.environmentOverrides,
      spawn: this.spawnChild,
    });
  }
}
