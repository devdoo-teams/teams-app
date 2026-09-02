export * from './github-agent-tasks-contract.js';
export * from './github-agent-tasks-adapter.js';
export * from './grok-provider-runtime-adapter.js';

export const OPTIONAL_PROVIDER_BUILD_MANIFEST = Object.freeze([
  'github-agent-tasks',
  'grok-xai',
] as const);
