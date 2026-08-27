import { spawn, type ChildProcess } from 'node:child_process';

import type { AgentJobScope } from './agent-job-store.js';
import {
  AgentExecutionPolicy,
  AgentIsolationProvider,
  type AgentIsolationSpawnOptions,
} from './agent-execution-policy.js';
import {
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
  nativePreflight?: (input: { codexExecutable: string; codexHome: string; workspace: string }) => Promise<void>;
  /** Test seam only; production uses the OpenAI Developer ID requirement. */
  nativeExecutableTrustVerifier?: ExecutableTrustVerifier;
  /** Local test-only compatibility seam; never enabled by production composition. */
  allowLegacySeatbeltTestProvider?: boolean;
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
 * Production is opt-in: without an explicit profile this returns no provider,
 * so AgentExecutionPolicy keeps read-only execution fail-closed. The profile
 * itself is an operator-managed Seatbelt boundary; this function never
 * invents credentials, paths, or permissions.
 */
export function createProductionAgentIsolationProvider(
  options: ProductionAgentExecutionPolicyOptions,
): AgentIsolationProvider | undefined {
  if (!options.isProduction) return undefined;
  const platform = options.platform ?? process.platform;
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

  const profilePath = normalizedOptionalValue(options.profilePath);
  const sandboxExecPath = normalizedOptionalValue(options.sandboxExecPath);
  if (sandboxExecPath && !profilePath) {
    throw new Error('AGENT_SANDBOX_EXEC_PATH requires AGENT_ISOLATION_PROFILE.');
  }
  if (!options.allowLegacySeatbeltTestProvider || !profilePath || platform !== 'darwin') return undefined;

  const spawnChild = options.spawn ?? ((command, args, spawnOptions) => (
    spawn(command, [...args], spawnOptions as any)
  ));
  return new MacOSSeatbeltIsolationProvider({
    profilePath,
    platform,
    spawn: spawnChild,
    ...(sandboxExecPath ? { sandboxExecPath } : {}),
  });
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
