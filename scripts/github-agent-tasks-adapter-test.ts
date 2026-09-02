import assert from 'node:assert/strict';

import { createGitHubAgentTasksAdapter } from '../src/server/providers/github-agent-tasks-adapter.js';
import type { ProviderRuntimeOperationInput } from '../src/server/provider-runtime-adapter.js';

const requests: Array<{ url: string; init?: RequestInit }> = [];
let taskState = 'queued';
const fetchFixture: typeof fetch = async (input, init) => {
  const url = String(input);
  requests.push({ url, init });
  if (url.endsWith('/repos/octo/repo')) return Response.json({ full_name: 'octo/repo' });
  if (url.endsWith('/agents/repos/octo/repo/tasks') && init?.method !== 'POST') return Response.json({ tasks: [] });
  if (url.endsWith('/agents/repos/octo/repo/tasks') && init?.method === 'POST') {
    return Response.json({
      id: 'task-123',
      url: 'https://api.github.com/agents/repos/octo/repo/tasks/task-123',
      html_url: 'https://github.com/octo/repo/copilot/tasks/task-123',
      state: 'queued',
      artifacts: [],
    }, { status: 201 });
  }
  if (url.endsWith('/agents/repos/octo/repo/tasks/task-123')) {
    return Response.json({
      id: 'task-123',
      url: 'https://api.github.com/agents/repos/octo/repo/tasks/task-123',
      html_url: 'https://github.com/octo/repo/copilot/tasks/task-123',
      state: taskState,
      artifacts: taskState === 'completed' ? [{ provider: 'github', type: 'pull', data: { id: 42 } }] : [],
    });
  }
  if (url.endsWith('/repos/octo/repo/pulls/42')) {
    return Response.json({
      number: 42,
      html_url: 'https://github.com/octo/repo/pull/42',
      head: { sha: 'b'.repeat(40), repo: { full_name: 'octo/repo' } },
      base: { repo: { full_name: 'octo/repo' } },
    });
  }
  return new Response('not found', { status: 404 });
};

let resolvedReference = '';
const adapter = createGitHubAgentTasksAdapter({
  fetch: fetchFixture,
  resolveUserToken: async (reference) => {
    resolvedReference = reference;
    return 'transient-user-token';
  },
});

const input = {
  scope: { tenantId: 'tenant', requesterId: 'requester', conversationId: 'conversation' },
  idempotencyKey: 'idem-1',
  requestHash: 'c'.repeat(64),
  payload: { repository: 'octo/repo', prompt: 'Fix the bug', baseRef: 'main', createPullRequest: true },
  requestedCapabilities: ['agent-tasks'],
  identities: {
    provider: { id: 'github-agent-tasks' },
    credential: { principalId: 'github-user', reference: 'key-vault://github/user-token' },
    execution: { id: 'execution-1' },
    context: { id: 'context-1' },
    runtime: { boundaryId: 'runtime-1' },
    audit: { id: 'audit-1' },
  },
  deadlineAtMs: Date.now() + 10_000,
  signal: new AbortController().signal,
} satisfies ProviderRuntimeOperationInput;

assert.deepEqual(await adapter.preflight(input), { ready: true, capabilities: ['agent-tasks', 'pull-request-artifact'] });
assert.equal(resolvedReference, 'key-vault://github/user-token');
const submitted = await adapter.submit(input);
assert.deepEqual(submitted, {
  rawState: 'queued',
  providerExecutionId: 'task-123',
  providerContextId: 'octo/repo',
  auditRefs: ['https://github.com/octo/repo/copilot/tasks/task-123'],
});

const receipt = { providerExecutionId: 'task-123', providerContextId: 'octo/repo', acceptedAt: '2026-09-03T00:00:00.000Z', rawState: 'queued' };
assert.equal((await adapter.get({ ...input, receipt })).rawState, 'queued');
taskState = 'completed';
const completed = await adapter.get({ ...input, receipt });
assert.equal(completed.rawState, 'completed');
assert.equal(completed.result, 'GitHub pull request #42 at bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
assert.deepEqual(completed.artifacts?.[0], {
  artifactId: 'github-pr-octo-repo-42-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  name: 'octo/repo#42',
  mediaType: 'application/vnd.github.pull-request+json',
  uri: 'https://github.com/octo/repo/pull/42',
  repository: 'octo/repo',
  commitSha: 'b'.repeat(40),
  authorship: { provider: 'github', pullNumber: '42' },
});

assert.deepEqual(await adapter.list(input), []);
assert.deepEqual(await adapter.cancel({ ...input, receipt }), { rawState: 'unsupported', error: 'GitHub Agent Tasks REST API does not document a cancel endpoint.' });
assert.deepEqual(await adapter.steer({ ...input, receipt }, 'continue'), { rawState: 'unsupported', error: 'GitHub Agent Tasks REST API does not document a steer endpoint.' });

assert.equal(requests.every(({ init }) => String(new Headers(init?.headers).get('Authorization')).includes('transient-user-token')), true);
assert.equal(JSON.stringify(requests).includes('key-vault://github/user-token'), false, 'opaque reference must not be sent to GitHub');
assert.equal(JSON.stringify(requests).includes('installation'), false, 'adapter must not use installation-token semantics');

const badCredentialAdapter = createGitHubAgentTasksAdapter({ fetch: fetchFixture, resolveUserToken: async () => 'token' });
await assert.rejects(
  badCredentialAdapter.preflight({ ...input, identities: { ...input.identities, credential: { ...input.identities.credential, reference: 'raw-token' } } }),
  /opaque/i,
);

console.log('PASS: GitHub Agent Tasks adapter preflights, polls, and verifies immutable PR results');
