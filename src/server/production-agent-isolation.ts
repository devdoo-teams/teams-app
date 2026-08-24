import { spawn, type ChildProcess } from 'node:child_process';

import type { AgentJobScope } from './agent-job-store.js';
import {
  AgentExecutionPolicy,
  AgentIsolationProvider,
  type AgentIsolationSpawnOptions,
} from './agent-execution-policy.js';
import { MacOSSeatbeltIsolationProvider } from './macos-seatbelt-isolation-provider.js';

export type ProductionAgentExecutionPolicyOptions = Readonly<{
  sourceWorkspace: string;
  isProduction: boolean;
  canReadScope?: (scope: AgentJobScope) => boolean;
  canMutateScope?: (scope: AgentJobScope) => boolean;
  /** Explicitly trusted, absolute Seatbelt profile; never inferred. */
  profilePath?: string;
  /** Optional explicit absolute sandbox-exec path. */
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
  const profilePath = normalizedOptionalValue(options.profilePath);
  const sandboxExecPath = normalizedOptionalValue(options.sandboxExecPath);
  if (sandboxExecPath && !profilePath) {
    throw new Error('AGENT_SANDBOX_EXEC_PATH requires AGENT_ISOLATION_PROFILE.');
  }
  if (!options.isProduction || !profilePath) return undefined;

  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin') return undefined;

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
