export * from './github-agent-tasks-contract.js';
export * from './github-agent-tasks-adapter.js';
export * from './grok-provider-runtime-adapter.js';
import { createGitHubAgentTasksAdapter } from './github-agent-tasks-adapter.js';
import { createGrokProviderRuntimeAdapter } from './grok-provider-runtime-adapter.js';

export const OPTIONAL_PROVIDER_RUNTIME_REGISTRY = Object.freeze({
  'github-agent-tasks': createGitHubAgentTasksAdapter,
  'grok-xai': createGrokProviderRuntimeAdapter,
});

export type OptionalProviderRuntimeId = keyof typeof OPTIONAL_PROVIDER_RUNTIME_REGISTRY;

export const OPTIONAL_PROVIDER_RUNTIME_IDS = Object.freeze(
  Object.keys(OPTIONAL_PROVIDER_RUNTIME_REGISTRY) as OptionalProviderRuntimeId[],
);

export function resolveOptionalProviderRuntimeFactory(providerId: string):
  (typeof OPTIONAL_PROVIDER_RUNTIME_REGISTRY)[OptionalProviderRuntimeId] | undefined {
  if (!Object.prototype.hasOwnProperty.call(OPTIONAL_PROVIDER_RUNTIME_REGISTRY, providerId)) return undefined;
  return OPTIONAL_PROVIDER_RUNTIME_REGISTRY[providerId as OptionalProviderRuntimeId];
}

export const OPTIONAL_PROVIDER_BUILD_MANIFEST = Object.freeze([
  'github-agent-tasks',
  'grok-xai',
] as const);
