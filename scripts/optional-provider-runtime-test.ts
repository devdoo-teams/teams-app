import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createOptionalProviderRuntime,
  createServerOwnedCredentialResolver,
  parseOptionalProviderConfiguration,
  type OptionalProviderConfig,
} from '../src/server/providers/optional-provider-runtime.js';
import { FileProviderLifecycleStore } from '../src/server/provider-lifecycle-runner.js';

const grokConfig: OptionalProviderConfig = {
  providerId: 'grok-xai',
  principal: 'teamsapp-xai',
  credentialReference: 'env://XAI_API_KEY',
  capabilities: ['responses'],
  policy: { durable: false, userAuth: 'server', cancellation: 'unsupported' },
  model: 'grok-4.6',
};

const githubConfig: OptionalProviderConfig = {
  providerId: 'github-agent-tasks',
  principal: 'github-user',
  credentialReference: 'key-vault://github/user-token',
  capabilities: ['agent-tasks', 'pull-request-artifact'],
  policy: { durable: true, userAuth: 'user-to-server', cancellation: 'unsupported' },
  defaultRepository: 'octo/repo',
};

assert.deepEqual(parseOptionalProviderConfiguration(undefined), []);
assert.deepEqual(parseOptionalProviderConfiguration(JSON.stringify([grokConfig])), [grokConfig]);
assert.throws(
  () => parseOptionalProviderConfiguration(JSON.stringify([{ ...grokConfig, providerId: 'buzz' }])) ,
  /providerId|unsupported/i,
  'unapproved Buzz must be rejected by the optional configuration schema',
);
assert.throws(
  () => parseOptionalProviderConfiguration(JSON.stringify([{ ...grokConfig, credentialReference: 'raw-xai-secret' }])) ,
  /credential|opaque/i,
  'raw credentials must be rejected by the optional configuration schema',
);
assert.throws(
  () => parseOptionalProviderConfiguration(JSON.stringify([{
    ...grokConfig,
    policy: { durable: true, userAuth: 'server', cancellation: 'unsupported' },
  }])),
  /policy|response-only|durable/i,
  'Grok cannot be configured as a durable agent',
);
assert.throws(
  () => parseOptionalProviderConfiguration(JSON.stringify([{
    ...grokConfig,
    policy: { ...grokConfig.policy, cancellation: 'supported' },
  }])),
  /policy|cancellation/i,
  'unsupported provider cancellation must remain explicit',
);

const secret = 'xai-fixture-secret-never-public';
const resolver = createServerOwnedCredentialResolver({
  environment: { XAI_API_KEY: secret },
  resolveKeyVault: async (reference, principal) => {
    assert.equal(reference, githubConfig.credentialReference);
    assert.equal(principal, githubConfig.principal);
    return 'github-fixture-token-never-public';
  },
});
assert.equal(await resolver.resolve(grokConfig.credentialReference, grokConfig.principal), secret);
assert.equal(await resolver.resolve(githubConfig.credentialReference, githubConfig.principal), 'github-fixture-token-never-public');
await assert.rejects(
  resolver.resolve('env://MISSING_SECRET', 'teamsapp-xai'),
  /unavailable|configured/i,
);

const disabled = await createOptionalProviderRuntime({
  enabled: false,
  configuration: '{not-json',
  environment: {},
});
assert.deepEqual(disabled.providers, [], 'Core/disabled runtime must not parse or load optional providers');
assert.deepEqual(disabled.responseEngines, []);

const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-optional-runtime-'));
try {
  const store = new FileProviderLifecycleStore(path.join(dataRoot, 'provider-lifecycle.json'));
  await store.initialize();
  const githubRequests: Array<{ url: string; init?: RequestInit }> = [];
  let taskState = 'queued';
  const githubFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    githubRequests.push({ url, init });
    const requestUrl = new URL(url);
    if (requestUrl.pathname === '/repos/octo/repo') return Response.json({ full_name: 'octo/repo' });
    if (requestUrl.pathname === '/agents/repos/octo/repo/tasks' && init?.method !== 'POST') {
      return Response.json({ tasks: [] });
    }
    if (requestUrl.pathname === '/agents/repos/octo/repo/tasks' && init?.method === 'POST') {
      return Response.json({
        id: 'task-optional-1',
        url: 'https://api.github.com/agents/repos/octo/repo/tasks/task-optional-1',
        html_url: 'https://github.com/octo/repo/copilot/tasks/task-optional-1',
        state: 'queued',
        artifacts: [],
      }, { status: 201 });
    }
    if (requestUrl.pathname === '/agents/repos/octo/repo/tasks/task-optional-1') {
      return Response.json({
        id: 'task-optional-1',
        url: 'https://api.github.com/agents/repos/octo/repo/tasks/task-optional-1',
        html_url: 'https://github.com/octo/repo/copilot/tasks/task-optional-1',
        state: taskState,
        artifacts: taskState === 'completed' ? [{ provider: 'github', type: 'pull', data: { id: 7 } }] : [],
      });
    }
    if (requestUrl.pathname === '/repos/octo/repo/pulls/7') {
      return Response.json({
        number: 7,
        html_url: 'https://github.com/octo/repo/pull/7',
        head: { sha: 'd'.repeat(40), repo: { full_name: 'octo/repo' } },
        base: { repo: { full_name: 'octo/repo' } },
      });
    }
    return new Response('not found', { status: 404 });
  };

  const runtime = await createOptionalProviderRuntime({
    enabled: true,
    configuration: JSON.stringify([githubConfig, grokConfig]),
    environment: { XAI_API_KEY: secret },
    lifecycleStore: store,
    fetch: githubFetch,
    resolveKeyVault: async () => 'github-fixture-token-never-public',
    verifyGitHubExecutionReadiness: async ({ repository, credentialReference, principalId }) => ({
      ready: repository === 'octo/repo'
        && credentialReference === githubConfig.credentialReference
        && principalId === githubConfig.principal,
      reason: 'fixture entitlement verified',
    }),
  });

  assert.deepEqual(runtime.providers.map(({ providerId }) => providerId), ['github-agent-tasks', 'grok-xai']);
  assert.equal(runtime.providers.find(({ providerId }) => providerId === 'grok-xai')?.kind, 'response-only');
  assert.equal(runtime.providers.find(({ providerId }) => providerId === 'grok-xai')?.lifecycle, undefined, 'Grok response engine must not receive a durable lifecycle runner');
  assert.equal(runtime.responseEngines.length, 1, 'configured Grok response engine must be connected through the resolver');
  assert.equal(runtime.facts.find(({ providerId }) => providerId === 'grok-xai')?.durable, false);
  assert.equal(runtime.facts.find(({ providerId }) => providerId === 'github-agent-tasks')?.durable, true);
  assert.equal(JSON.stringify(runtime.facts).includes(secret), false, 'optional provider facts must never contain credential values');
  assert.equal(JSON.stringify(runtime.facts).includes('github-fixture-token-never-public'), false);

  const githubRuntime = runtime.providers.find(({ providerId }) => providerId === 'github-agent-tasks');
  assert.ok(githubRuntime?.lifecycle, 'GitHub Agent Tasks must be registered through the durable lifecycle runner');
  const preflight = await githubRuntime.preflight({
    scope: { tenantId: 'tenant', requesterId: 'requester', conversationId: 'conversation' },
    idempotencyKey: 'optional-preflight',
    requestHash: 'a'.repeat(64),
    payload: { repository: 'octo/repo', prompt: 'Check the release' },
    requestedCapabilities: ['agent-tasks'],
  });
  assert.deepEqual(preflight, { ready: true, capabilities: ['agent-tasks', 'pull-request-artifact'] });

  taskState = 'completed';
  const recordPromise = githubRuntime.run({
    scope: { tenantId: 'tenant', requesterId: 'requester', conversationId: 'conversation' },
    idempotencyKey: 'optional-run-1',
    requestHash: 'b'.repeat(64),
    payload: { prompt: 'Check the release' },
    requestedCapabilities: ['agent-tasks'],
    timeoutMs: 2_000,
  });
  const record = await recordPromise;
  assert.equal(record.state, 'completed');
  assert.match(record.result ?? '', /pull request #7/);
  assert.equal(record.identities.provider.id, githubConfig.providerId);
  assert.equal(record.identities.credential.reference, githubConfig.credentialReference);
  assert.equal(record.identities.credential.principalId, githubConfig.principal);
  assert.equal(JSON.stringify(record).includes('github-fixture-token-never-public'), false);
  assert.equal(JSON.stringify(record).includes(secret), false);
  assert.equal(githubRequests.every(({ init }) => String(new Headers(init?.headers).get('Authorization')).includes('github-fixture-token-never-public')), true);
  assert.equal(githubRequests.some(({ url }) => url.includes('key-vault://')), false, 'GitHub must receive the resolved token, not the opaque reference');
  assert.equal(runtime.providers.find(({ providerId }) => providerId === 'grok-xai')?.facts.durable, false);
} finally {
  await fs.rm(dataRoot, { recursive: true, force: true });
}

console.log('optional-provider-runtime-test: PASS');
