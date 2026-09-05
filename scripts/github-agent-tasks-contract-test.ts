import assert from 'node:assert/strict';

import {
  GitHubAgentTasksContractError,
  mapGitHubAgentTaskState,
  parseGitHubAgentTask,
  parseGitHubAgentTaskList,
  verifyGitHubPullRequestArtifact,
} from '../src/server/providers/github-agent-tasks-contract.js';

assert.equal(mapGitHubAgentTaskState('queued'), 'accepted');
assert.equal(mapGitHubAgentTaskState('in_progress'), 'working');
assert.equal(mapGitHubAgentTaskState('waiting_for_user'), 'input-required');
assert.equal(mapGitHubAgentTaskState('failed'), 'failed');
assert.equal(mapGitHubAgentTaskState('timed_out'), 'failed');
assert.equal(mapGitHubAgentTaskState('cancelled'), 'canceled');
assert.equal(mapGitHubAgentTaskState('idle'), 'unknown');
assert.equal(mapGitHubAgentTaskState('future_state'), 'unknown');

const acceptedResponse = {
  id: 'task-123',
  url: 'https://api.github.com/agents/repos/octo/repo/tasks/task-123',
  html_url: 'https://github.com/octo/repo/copilot/tasks/task-123',
  state: 'queued',
  artifacts: [],
};
const accepted = parseGitHubAgentTask(acceptedResponse);
assert.equal(accepted.id, 'task-123');
assert.equal(accepted.state, 'queued');

assert.throws(
  () => parseGitHubAgentTask({ state: 'queued', artifacts: [] }),
  (error) => error instanceof GitHubAgentTasksContractError && error.code === 'missing-receipt',
);

assert.deepEqual(parseGitHubAgentTaskList({ tasks: [acceptedResponse] }), [accepted]);
assert.throws(() => parseGitHubAgentTaskList({ tasks: 'not-an-array' }), /tasks/i);

const pullArtifact = verifyGitHubPullRequestArtifact({
  repository: 'octo/repo',
  pullNumber: 42,
  task: {
    ...accepted,
    state: 'completed',
    artifacts: [{ provider: 'github', type: 'pull', data: { id: 42 } }],
  },
  pullRequest: {
    number: 42,
    html_url: 'https://github.com/octo/repo/pull/42',
    head: { sha: 'a'.repeat(40), repo: { full_name: 'octo/repo' } },
    base: { repo: { full_name: 'octo/repo' } },
  },
});
assert.deepEqual(pullArtifact, {
  repository: 'octo/repo',
  pullNumber: 42,
  headSha: 'a'.repeat(40),
  url: 'https://github.com/octo/repo/pull/42',
});

assert.throws(
  () => verifyGitHubPullRequestArtifact({
    repository: 'octo/repo',
    pullNumber: 42,
    task: {
      ...accepted,
      state: 'completed',
      artifacts: [{ provider: 'github', type: 'pull', data: { id: 42 } }],
    },
    pullRequest: {
      number: 42,
      html_url: 'https://github.com/octo/repo/pull/42',
      head: { sha: 'a'.repeat(40), repo: { full_name: 'fork/repo' } },
      base: { repo: { full_name: 'other/repo' } },
    },
  }),
  /base repository/i,
);

for (const invalid of [
  { repository: 'octo/repo', pullNumber: 42, task: { ...accepted, state: 'completed', artifacts: [] }, pullRequest: {} },
  { repository: 'octo/repo', pullNumber: 42, task: { ...accepted, state: 'completed', artifacts: [{ provider: 'github', type: 'pull', data: { id: 42 } }] }, pullRequest: { number: 42, html_url: 'https://evil.example/pull/42', head: { sha: 'a'.repeat(40), repo: { full_name: 'octo/repo' } }, base: { repo: { full_name: 'octo/repo' } } } },
  { repository: 'octo/repo', pullNumber: 42, task: { ...accepted, state: 'completed', artifacts: [{ provider: 'github', type: 'pull', data: { id: 42 } }] }, pullRequest: { number: 42, html_url: 'https://github.com/octo/repo/pull/42', head: { sha: '', repo: { full_name: 'octo/repo' } }, base: { repo: { full_name: 'octo/repo' } } } },
]) {
  assert.throws(() => verifyGitHubPullRequestArtifact(invalid as never), GitHubAgentTasksContractError);
}

console.log('PASS: GitHub Agent Tasks contract fails closed and verifies PR identity');
