/** Teams-launched CLI agents only; never change the developer's global Codex config. */
export const TEAMS_CLI_AGENT_POLICY = Object.freeze({
  model: 'gpt-6-luna',
  reasoningEffort: 'xhigh',
  modelProvider: 'openai',
} as const);

export class TeamsCliAgentPolicyError extends Error {
  readonly code = 'TEAMS_CLI_AGENT_POLICY_UNAVAILABLE' as const;
  constructor(message: string) {
    super(`Teams CLI policy: ${message}`);
    this.name = 'TeamsCliAgentPolicyError';
  }
}

export function assertTeamsCliAgentProvider(provider: unknown): void {
  if (provider !== 'codex') {
    throw new TeamsCliAgentPolicyError('gpt-6-luna/xhigh support is unverified for this provider; no alternative provider or default model will run.');
  }
}

export function assertTeamsCliAgentSelection(value?: Readonly<{ model?: unknown; reasoningEffort?: unknown }>): void {
  if (value?.model === undefined && value?.reasoningEffort === undefined) return;
  if (value?.model !== TEAMS_CLI_AGENT_POLICY.model || value.reasoningEffort !== TEAMS_CLI_AGENT_POLICY.reasoningEffort) {
    throw new TeamsCliAgentPolicyError('Teams agents are fixed to gpt-6-luna/xhigh; conflicting or incomplete selections are refused.');
  }
}

export const TEAMS_CLI_AGENT_MODEL_ARGS: readonly string[] = Object.freeze([
  '--model', TEAMS_CLI_AGENT_POLICY.model,
  '--config', `model_reasoning_effort="${TEAMS_CLI_AGENT_POLICY.reasoningEffort}"`,
  '--config', `model_provider="${TEAMS_CLI_AGENT_POLICY.modelProvider}"`,
]);

export function assertTeamsCliAgentPrefix(prefixArgs: readonly string[]): void {
  if (prefixArgs.some(arg => typeof arg !== 'string' || arg.startsWith('-'))) {
    throw new TeamsCliAgentPolicyError('CLI prefix/config/profile overrides are refused.');
  }
}

export function assertTeamsCliAgentEnvironment(environment?: Readonly<Record<string, string | undefined>>): void {
  if (!environment) return;
  for (const [key, expected] of [
    ['CODEX_MODEL', TEAMS_CLI_AGENT_POLICY.model],
    ['CODEX_REASONING_EFFORT', TEAMS_CLI_AGENT_POLICY.reasoningEffort],
    ['MODEL_REASONING_EFFORT', TEAMS_CLI_AGENT_POLICY.reasoningEffort],
    ['CODEX_MODEL_PROVIDER', TEAMS_CLI_AGENT_POLICY.modelProvider],
  ] as const) {
    if (environment[key] !== undefined && environment[key] !== expected) {
      throw new TeamsCliAgentPolicyError('Conflicting model/effort/provider environment override is refused.');
    }
  }
  for (const key of ['CODEX_PROFILE', 'CODEX_CONFIG', 'CODEX_CONFIG_OVERRIDES', 'CODEX_SCRIPT']) {
    if (environment[key] !== undefined && environment[key] !== '') {
      throw new TeamsCliAgentPolicyError('Config/profile environment overrides are refused.');
    }
  }
}
