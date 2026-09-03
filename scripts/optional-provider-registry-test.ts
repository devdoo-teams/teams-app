import assert from 'node:assert/strict';

import {
  OPTIONAL_PROVIDER_BUILD_MANIFEST,
  OPTIONAL_PROVIDER_RUNTIME_IDS,
  OPTIONAL_PROVIDER_RUNTIME_REGISTRY,
  resolveOptionalProviderRuntimeFactory,
} from '../src/server/providers/optional-provider-entrypoint.js';
import { createGitHubAgentTasksAdapter } from '../src/server/providers/github-agent-tasks-adapter.js';
import { createGrokProviderRuntimeAdapter } from '../src/server/providers/grok-provider-runtime-adapter.js';

assert.deepEqual(OPTIONAL_PROVIDER_RUNTIME_IDS, ['github-agent-tasks', 'grok-xai']);
assert.deepEqual(OPTIONAL_PROVIDER_BUILD_MANIFEST, OPTIONAL_PROVIDER_RUNTIME_IDS);
assert.equal(OPTIONAL_PROVIDER_RUNTIME_REGISTRY['github-agent-tasks'], createGitHubAgentTasksAdapter);
assert.equal(OPTIONAL_PROVIDER_RUNTIME_REGISTRY['grok-xai'], createGrokProviderRuntimeAdapter);
assert.equal(resolveOptionalProviderRuntimeFactory('github-agent-tasks'), createGitHubAgentTasksAdapter);
assert.equal(resolveOptionalProviderRuntimeFactory('grok-xai'), createGrokProviderRuntimeAdapter);
assert.equal(resolveOptionalProviderRuntimeFactory('buzz'), undefined, 'unapproved Buzz transport is not silently registered');
assert.equal(resolveOptionalProviderRuntimeFactory('unknown'), undefined);

console.log('optional-provider-registry-test: PASS');
