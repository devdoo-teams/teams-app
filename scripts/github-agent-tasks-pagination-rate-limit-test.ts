import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  GitHubAgentTasksRequestError,
  createGitHubAgentTasksAdapter,
} from '../src/server/providers/github-agent-tasks-adapter.js';
import type { ProviderRuntimeOperationInput } from '../src/server/provider-runtime-adapter.js';

const calls: string[] = [];
let mode: 'pages' | 'poll' | 'rate-limit' | 'unbounded' | 'cross-origin' = 'pages';
const repositoryContextId = `github-repository-${crypto.createHash('sha256').update('octo/repo').digest('hex').slice(0, 48)}`;
const fetchFixture: typeof fetch = async (input) => {
  const url = String(input);
  calls.push(url);
  if (mode === 'pages' || mode === 'unbounded') {
    const page = new URL(url).searchParams.get('page') ?? '1';
    const task = (id: string) => ({
      id,
      url: `https://api.github.com/agents/repos/octo/repo/tasks/${id}`,
      html_url: `https://github.com/octo/repo/copilot/tasks/${id}`,
      state: 'queued',
      artifacts: [],
    });
    if (page === '1') {
      return Response.json({ tasks: [task('task-1')] }, {
        headers: { Link: '<https://api.github.com/agents/repos/octo/repo/tasks?per_page=100&page=2>; rel="next"' },
      });
    }
    if (mode === 'unbounded') {
      const nextPage = Number(page) + 1;
      return Response.json({ tasks: [task(`task-${page}`)] }, {
        headers: { Link: `<https://api.github.com/agents/repos/octo/repo/tasks?per_page=100&page=${nextPage}>; rel="next"` },
      });
    }
    return Response.json({ tasks: [task('task-2')] });
  }
  if (mode === 'poll') {
    return Response.json({
      id: 'task-1',
      url: 'https://api.github.com/agents/repos/octo/repo/tasks/task-1',
      html_url: 'https://github.com/octo/repo/copilot/tasks/task-1',
      state: 'in_progress',
      artifacts: [],
    }, { headers: { 'x-poll-interval': '7' } });
  }
  if (mode === 'cross-origin') {
    return Response.json({ tasks: [] }, {
      headers: { Link: '<https://evil.example/agents/repos/octo/repo/tasks?per_page=100&page=2>; rel="next"' },
    });
  }
  return new Response(JSON.stringify({ message: 'rate limited' }), {
    status: 429,
    headers: {
      'content-type': 'application/json',
      'retry-after': '3',
      'x-ratelimit-reset': '1893456000',
      'x-poll-interval': '9',
    },
  });
};

const adapter = createGitHubAgentTasksAdapter({
  fetch: fetchFixture,
  resolveUserToken: async () => 'transient-user-token',
});
const input = {
  scope: { tenantId: 'tenant', requesterId: 'requester', conversationId: 'conversation' },
  idempotencyKey: 'idem-1',
  requestHash: 'c'.repeat(64),
  payload: { repository: 'octo/repo', prompt: 'Fix the bug' },
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

const listed = await adapter.list(input);
assert.deepEqual(listed.map(({ id }) => id), ['task-1', 'task-2']);
assert.equal(calls.length, 2);

mode = 'unbounded';
await assert.rejects(adapter.list(input), /exceeded 10 pages/i);

mode = 'cross-origin';
await assert.rejects(adapter.list(input), /approved repository boundary/i);

mode = 'poll';
const observed = await adapter.get({
  ...input,
  receipt: { providerExecutionId: 'task-1', providerContextId: repositoryContextId, acceptedAt: '2026-09-03T00:00:00.000Z', rawState: 'queued' },
});
assert.deepEqual(observed.retryGuidance, { pollIntervalMs: 7_000 });

mode = 'rate-limit';
await assert.rejects(
  adapter.get({
    ...input,
    receipt: { providerExecutionId: 'task-1', providerContextId: repositoryContextId, acceptedAt: '2026-09-03T00:00:00.000Z', rawState: 'queued' },
  }),
  (error) => error instanceof GitHubAgentTasksRequestError
    && error.status === 429
    && error.retryGuidance.pollIntervalMs === 9_000
    && error.retryGuidance.retryAfterMs === 3_000
    && error.retryGuidance.rateLimitResetAtMs === 1_893_456_000_000,
);

console.log('PASS: GitHub Agent Tasks pagination is bounded and retry guidance preserves provider headers');
