import assert from 'node:assert/strict';

import { BitbucketCloudClient } from '../src/server/bitbucket-cloud-client.js';

const encoder = new TextEncoder();

function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function createNeverEndingJsonResponse(state: { canceled: boolean }): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('{"partial":'));
    },
    cancel() {
      state.canceled = true;
    },
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const secret = 'secret-bitbucket-token';
const requests: Array<{ url: string; init?: RequestInit }> = [];
const client = new BitbucketCloudClient({
  authProvider: () => secret,
  fetchImpl: async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({ values: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  },
});

assert.equal((await client.currentUser()).ok, true);
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/user');
assert.equal((await client.workspaces({ pagelen: 20 })).ok, true);
assert.equal((await client.workspacePermissions('devdoo-teams', {
  page: 2,
  pagelen: 10,
  q: 'permission="owner"',
})).ok, true);
assert.equal(
  requests.at(-1)?.url,
  'https://api.bitbucket.org/2.0/workspaces/devdoo-teams/permissions?page=2&pagelen=10&q=permission%3D%22owner%22',
  'workspace permission listing uses the documented Cloud v2 endpoint and bounded filter',
);
assert.equal(requests.at(-1)?.init?.method, 'GET');
assert.equal(requests.at(-1)?.init?.body, undefined);
assert.equal((await client.repositories('devdoo-teams', { q: 'name~"a/b"' })).ok, true);
assert.match(requests.at(-1)?.url ?? '', /\/repositories\/devdoo-teams\?/);
assert.match(requests.at(-1)?.url ?? '', /name%7E%22a%2Fb%22/);
assert.equal((await client.commits('devdoo-teams', 'teams-app', { include: 'main' })).ok, true);
assert.equal((await client.pullRequests('devdoo-teams', 'teams-app', { state: 'OPEN' })).ok, true);
assert.equal((await client.issues('devdoo-teams', 'teams-app', { status: 'new' })).ok, true);
assert.equal(new Headers(requests.at(-1)?.init?.headers).get('authorization'), `Bearer ${secret}`);
assert.equal((await client.workspace('devdoo-teams')).ok, true);
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/workspaces/devdoo-teams');
assert.equal((await client.repository('devdoo-teams', 'teams-app')).ok, true);
assert.equal((await client.defaultReviewers('devdoo-teams', 'teams-app', { pagelen: 20 })).ok, true);
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/effective-default-reviewers?pagelen=20');
assert.equal((await client.userPullRequests('devdoo-teams', '{user-uuid}', { state: 'OPEN' })).ok, true);
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/workspaces/devdoo-teams/pullrequests/%7Buser-uuid%7D?state=OPEN');
assert.equal((await client.deployments('devdoo-teams', 'teams-app', { pagelen: 10 })).ok, true);
assert.equal((await client.deployment('devdoo-teams', 'teams-app', '{deployment-uuid}')).ok, true);
assert.equal((await client.pullRequest('devdoo-teams', 'teams-app', 17)).ok, true);
assert.equal((await client.pullRequestComments('devdoo-teams', 'teams-app', 17, { page: 2 })).ok, true);
assert.equal((await client.pullRequestActivity('devdoo-teams', 'teams-app', 17, { page: 2, pagelen: 25 })).ok, true);
assert.equal(
  requests.at(-1)?.url,
  'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/pullrequests/17/activity?page=2&pagelen=25',
  'pull request activity uses the documented GET route with bounded pagination',
);
assert.equal(requests.at(-1)?.init?.method, 'GET');
assert.equal(requests.at(-1)?.init?.body, undefined);
assert.equal((await client.pullRequestDiff('devdoo-teams', 'teams-app', 17)).ok, true);
assert.equal((await client.pullRequestDiffstat('devdoo-teams', 'teams-app', 17)).ok, true);
assert.equal(
  requests.at(-1)?.url,
  'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/pullrequests/17/diffstat',
  'pull request diffstat uses the documented GET route',
);
assert.equal(requests.at(-1)?.init?.method, 'GET');
assert.equal(requests.at(-1)?.init?.body, undefined);
assert.equal((await client.pullRequestStatuses('devdoo-teams', 'teams-app', 17, {
  q: 'state = "FAILED"',
  sort: '-updated_on',
})).ok, true);
assert.equal(
  requests.at(-1)?.url,
  'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/pullrequests/17/statuses?q=state+%3D+%22FAILED%22&sort=-updated_on',
  'pull request statuses use the documented GET route with bounded filtering and sorting',
);
assert.equal(requests.at(-1)?.init?.method, 'GET');
assert.equal(requests.at(-1)?.init?.body, undefined);
assert.equal((await client.branch('devdoo-teams', 'teams-app', 'feature/parity')).ok, true);
assert.match(requests.at(-1)?.url ?? '', /refs\/branches\/feature%2Fparity$/);
assert.equal((await client.branches('devdoo-teams', 'teams-app', {
  page: 2,
  pagelen: 10,
  q: 'name ~ "feature/"',
  sort: '-name',
})).ok, true);
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/refs/branches?page=2&pagelen=10&q=name+%7E+%22feature%2F%22&sort=-name');
assert.equal((await client.commit('devdoo-teams', 'teams-app', 'abc123')).ok, true);
assert.equal((await client.files('devdoo-teams', 'teams-app', 'main', 'src/index.ts')).ok, true);
assert.match(requests.at(-1)?.url ?? '', /src\/main\/src%2Findex.ts$/);
assert.equal((await client.commitsForRevision('devdoo-teams', 'teams-app', 'feature/parity', {
  page: 2,
  pagelen: 25,
  path: 'src/server',
  include: ['main', 'release/1'],
  exclude: ['legacy'],
})).ok, true);
assert.equal(
  requests.at(-1)?.url,
  'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/commits/feature%2Fparity?page=2&pagelen=25&path=src%2Fserver&include=main&include=release%2F1&exclude=legacy',
  'revision commit history uses the documented GET route with encoded bounded queries',
);
assert.equal(requests.at(-1)?.init?.method, 'GET');
assert.equal(requests.at(-1)?.init?.body, undefined);
assert.equal((await client.fileHistory('devdoo-teams', 'teams-app', 'abc123', 'src/server/index.ts', {
  page: 3,
  pagelen: 10,
  renames: true,
  q: 'author.raw = "Ada"',
  sort: '-date',
})).ok, true);
assert.equal(
  requests.at(-1)?.url,
  'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/filehistory/abc123/src%2Fserver%2Findex.ts?page=3&pagelen=10&renames=true&q=author.raw+%3D+%22Ada%22&sort=-date',
  'file history uses the documented GET route with encoded file path and queries',
);
assert.equal(requests.at(-1)?.init?.method, 'GET');
assert.equal(requests.at(-1)?.init?.body, undefined);
assert.equal((await client.sourceRoot('devdoo-teams', 'teams-app', 'main', { format: 'meta' })).ok, true);
assert.equal(
  requests.at(-1)?.url,
  'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/src/main/?format=meta',
  'source root keeps the documented trailing slash and bounded format query',
);
assert.equal(requests.at(-1)?.init?.method, 'GET');
assert.equal(requests.at(-1)?.init?.body, undefined);
assert.equal((await client.pipelines('devdoo-teams', 'teams-app', { page: 2 })).ok, true);
assert.equal((await client.pipeline('devdoo-teams', 'teams-app', '{pipeline-uuid}')).ok, true);
assert.equal((await client.pipelineSteps('devdoo-teams', 'teams-app', '{pipeline-uuid}', { pagelen: 10 })).ok, true);
assert.equal((await client.pipelineStep('devdoo-teams', 'teams-app', '{pipeline-uuid}', '{step-uuid}')).ok, true);
const stoppedPipelineRequests: Array<{ url: string; init?: RequestInit }> = [];
const stoppedPipelineClient = new BitbucketCloudClient({
  authProvider: () => secret,
  fetchImpl: async (input, init) => {
    stoppedPipelineRequests.push({ url: String(input), init });
    return new Response(null, { status: 204 });
  },
});
assert.deepEqual(
  await stoppedPipelineClient.stopPipeline('devdoo-teams', 'teams-app', '{pipeline-uuid}'),
  { ok: true, data: null, status: 204 },
  'stop pipeline accepts the documented 204 no-content response',
);
assert.equal(
  stoppedPipelineRequests.at(-1)?.url,
  'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/pipelines/%7Bpipeline-uuid%7D/stopPipeline',
);
assert.equal(stoppedPipelineRequests.at(-1)?.init?.method, 'POST');
assert.equal(stoppedPipelineRequests.at(-1)?.init?.body, undefined);
assert.equal((await client.environments('devdoo-teams', 'teams-app', { pagelen: 10 })).ok, true);
assert.equal((await client.environment('devdoo-teams', 'teams-app', '{environment-uuid}')).ok, true);
assert.equal((await client.repositoryUserPermissions('devdoo-teams', 'teams-app', { page: 2, pagelen: 10 })).ok, true);
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/permissions-config/users?page=2&pagelen=10');
assert.equal(requests.at(-1)?.init?.method, 'GET');
assert.equal(requests.at(-1)?.init?.body, undefined);
assert.equal((await client.repositoryUserPermission('devdoo-teams', 'teams-app', '557058:user/id')).ok, true);
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/permissions-config/users/557058%3Auser%2Fid');
assert.equal(requests.at(-1)?.init?.method, 'GET');
assert.equal(requests.at(-1)?.init?.body, undefined);
assert.equal((await client.updateRepositoryUserPermission('devdoo-teams', 'teams-app', '557058:user/id', { permission: 'write' })).ok, true);
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/permissions-config/users/557058%3Auser%2Fid');
assert.equal(requests.at(-1)?.init?.method, 'PUT');
assert.equal(requests.at(-1)?.init?.body, JSON.stringify({ permission: 'write' }));
assert.equal((await client.deleteRepositoryUserPermission('devdoo-teams', 'teams-app', '557058:user/id')).ok, true);
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/permissions-config/users/557058%3Auser%2Fid');
assert.equal(requests.at(-1)?.init?.method, 'DELETE');
assert.equal(requests.at(-1)?.init?.body, undefined);
assert.equal((await client.repositoryGroupPermissions('devdoo-teams', 'teams-app', { page: 2, pagelen: 10 })).ok, true);
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/permissions-config/groups?page=2&pagelen=10');
assert.equal(requests.at(-1)?.init?.method, 'GET');
assert.equal(requests.at(-1)?.init?.body, undefined);
assert.equal((await client.repositoryGroupPermission('devdoo-teams', 'teams-app', 'release/group')).ok, true);
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/permissions-config/groups/release%2Fgroup');
assert.equal(requests.at(-1)?.init?.method, 'GET');
assert.equal(requests.at(-1)?.init?.body, undefined);
assert.equal((await client.updateRepositoryGroupPermission('devdoo-teams', 'teams-app', 'release/group', { permission: 'admin' })).ok, true);
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/permissions-config/groups/release%2Fgroup');
assert.equal(requests.at(-1)?.init?.method, 'PUT');
assert.equal(requests.at(-1)?.init?.body, JSON.stringify({ permission: 'admin' }));
assert.equal((await client.deleteRepositoryGroupPermission('devdoo-teams', 'teams-app', 'release/group')).ok, true);
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/permissions-config/groups/release%2Fgroup');
assert.equal(requests.at(-1)?.init?.method, 'DELETE');
assert.equal(requests.at(-1)?.init?.body, undefined);

assert.equal((await client.createPullRequest('devdoo-teams', 'teams-app', {
  title: 'Provider parity',
  source: { branch: { name: 'feature/parity' } },
  destination: { branch: { name: 'main' } },
})).ok, true);
assert.equal(requests.at(-1)?.init?.method, 'POST');
assert.equal((await client.mergePullRequest('devdoo-teams', 'teams-app', 17, { type: 'pullrequest', merge_strategy: 'squash' })).ok, true);
assert.equal((await client.approvePullRequest('devdoo-teams', 'teams-app', 17)).ok, true);
assert.equal((await client.updatePullRequest('devdoo-teams', 'teams-app', 17, {
  title: 'Updated provider parity',
  description: 'Updated description',
  draft: true,
})).ok, true);
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/pullrequests/17');
assert.equal(requests.at(-1)?.init?.method, 'PUT');
assert.equal(new Headers(requests.at(-1)?.init?.headers).get('content-type'), 'application/json');
assert.equal(requests.at(-1)?.init?.body, JSON.stringify({ title: 'Updated provider parity', description: 'Updated description', draft: true }));
assert.equal((await client.declinePullRequest('devdoo-teams', 'teams-app', 17)).ok, true);
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/pullrequests/17/decline');
assert.equal(requests.at(-1)?.init?.method, 'POST');
assert.equal(requests.at(-1)?.init?.body, undefined);
assert.equal((await client.unapprovePullRequest('devdoo-teams', 'teams-app', 17)).ok, true);
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/pullrequests/17/approve');
assert.equal(requests.at(-1)?.init?.method, 'DELETE');
assert.equal(requests.at(-1)?.init?.body, undefined);
assert.equal((await client.addPullRequestComment('devdoo-teams', 'teams-app', 17, { content: { raw: 'Looks good' } })).ok, true);
assert.equal((await client.createBranch('devdoo-teams', 'teams-app', { name: 'feature/parity', target: { hash: 'abc123' } })).ok, true);
assert.equal((await client.runPipeline('devdoo-teams', 'teams-app', { target: { type: 'pipeline_ref_target', ref_type: 'branch', ref_name: 'main' } })).ok, true);
assert.equal((await client.createEnvironment('devdoo-teams', 'teams-app', { name: 'Staging' })).ok, true);
assert.equal((await client.createCommit('devdoo-teams', 'teams-app', {
  files: [{ path: 'README.md', content: 'hello' }],
  deleteFiles: ['old.txt'],
  message: 'Create README',
  branch: 'main',
})).ok, true);
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/src');
assert.equal(requests.at(-1)?.init?.method, 'POST');
assert.equal(new Headers(requests.at(-1)?.init?.headers).get('content-type'), 'application/x-www-form-urlencoded');
assert.equal(requests.at(-1)?.init?.body, '%2FREADME.md=hello&files=%2Fold.txt&message=Create+README&branch=main');
assert.equal((await client.createCommit('devdoo-teams', 'teams-app', {
  files: [{ path: 'docs/guide.txt', content: 'first line\n\tsecond line\r\nthird line' }],
})).ok, true);
assert.equal(requests.at(-1)?.init?.body, '%2Fdocs%2Fguide.txt=first+line%0A%09second+line%0D%0Athird+line');

async function assertInvalidCommit(
  input: Parameters<BitbucketCloudClient['createCommit']>[2],
  message: string,
): Promise<void> {
  const requestCount = requests.length;
  const result = await client.createCommit('devdoo-teams', 'teams-app', input);
  assert.equal(result.ok, false, message);
  if (!result.ok) assert.equal(result.error.code, 'invalid-request', message);
  assert.equal(requests.length, requestCount, `${message}: invalid input must not reach fetch`);
}

await assertInvalidCommit({ files: [{ path: 'README.md', content: 'has\u0000nul' }] }, 'NUL content is rejected');
await assertInvalidCommit({ files: [{ path: 'docs/has\u0000nul.txt', content: 'safe content' }] }, 'NUL path is rejected');
await assertInvalidCommit({ files: [{ path: 'README.md', content: 'has\u000bvertical-tab' }] }, 'unsafe control content is rejected');
await assertInvalidCommit({ files: [{ path: 'README.md', content: 'x'.repeat(64_001) }] }, 'oversized content is rejected');
await assertInvalidCommit({ files: [{ path: '../outside.txt', content: 'unsafe path' }] }, 'path traversal is rejected');
assert.equal((await client.updateEnvironment('devdoo-teams', 'teams-app', '{environment-uuid}')).ok, true);
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/environments/%7Benvironment-uuid%7D/changes');
assert.equal(requests.at(-1)?.init?.method, 'POST');
assert.equal(requests.at(-1)?.init?.body, undefined);
assert.equal((await client.deleteEnvironment('devdoo-teams', 'teams-app', '{environment-uuid}')).ok, true);
assert.equal(requests.at(-1)?.init?.method, 'DELETE');
assert.equal((await client.deleteBranch('devdoo-teams', 'teams-app', 'feature/parity')).ok, true);
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/refs/branches/feature%2Fparity');
assert.equal(requests.at(-1)?.init?.method, 'DELETE');
assert.equal(requests.at(-1)?.init?.body, undefined);

async function assertInvalidRequest(
  operation: () => Promise<Awaited<ReturnType<BitbucketCloudClient['currentUser']>>>,
  message: string,
): Promise<void> {
  const requestCount = requests.length;
  const result = await operation();
  assert.equal(result.ok, false, message);
  if (!result.ok) assert.equal(result.error.code, 'invalid-request', message);
  assert.equal(requests.length, requestCount, `${message}: invalid input must not reach fetch`);
}

await assertInvalidRequest(
  () => client.branches('devdoo-teams', 'teams-app', { q: 'unsafe\u0000filter' }),
  'unsafe branch-list filter is rejected',
);
await assertInvalidRequest(
  () => client.commitsForRevision('devdoo-teams', 'teams-app', 'main', { path: '../secret.txt' }),
  'revision commit history rejects path traversal before fetch',
);
await assertInvalidRequest(
  () => client.commitsForRevision('devdoo-teams', 'teams-app', 'main', { path: ' ' }),
  'revision commit history rejects empty paths before fetch',
);
await assertInvalidRequest(
  () => client.fileHistory('devdoo-teams', 'teams-app', 'main', 'x'.repeat(513)),
  'file history rejects oversized paths before fetch',
);
await assertInvalidRequest(
  () => client.branch('devdoo-teams', 'teams-app', 'é'.repeat(300)),
  'Bitbucket path identifiers enforce their UTF-8 byte bound',
);
await assertInvalidRequest(
  () => client.fileHistory('devdoo-teams', 'teams-app', 'main', 'src/has\u0000nul.ts'),
  'file history rejects control characters in paths before fetch',
);
await assertInvalidRequest(
  () => client.sourceRoot('devdoo-teams', 'teams-app', 'main', { format: 'x'.repeat(513) }),
  'source root rejects oversized query values before fetch',
);
await assertInvalidRequest(
  () => client.fileHistory('devdoo-teams', 'teams-app', 'main', 'src/index.ts', { q: 'unsafe\u0000query' }),
  'file history rejects unsafe query values before fetch',
);
await assertInvalidRequest(
  () => client.pullRequestStatuses('devdoo-teams', 'teams-app', 17, { q: 'unsafe\u0000query' }),
  'pull request statuses reject unsafe query values before fetch',
);
await assertInvalidRequest(
  () => client.pullRequestDiffstat('devdoo-teams', 'teams-app', 0),
  'pull request diffstat rejects a non-positive pull request ID before fetch',
);
await assertInvalidRequest(
  () => client.pullRequestActivity('devdoo-teams', 'teams-app', 0),
  'pull request activity rejects a non-positive pull request ID before fetch',
);
await assertInvalidRequest(
  () => client.deleteBranch('devdoo-teams', 'teams-app', 'feature\u0000parity'),
  'unsafe branch name is rejected',
);
await assertInvalidRequest(
  () => client.updatePullRequest('devdoo-teams', 'teams-app', 17, { title: 'unsafe\u0000title' }),
  'unsafe pull-request update body is rejected',
);
await assertInvalidRequest(
  () => client.updatePullRequest('devdoo-teams', 'teams-app', 17, null as never),
  'malformed pull-request update body is rejected',
);
await assertInvalidRequest(
  () => client.repositoryUserPermission('devdoo-teams', 'teams-app', 'unsafe\u0000principal'),
  'unsafe user permission principal is rejected',
);
await assertInvalidRequest(
  () => client.repositoryGroupPermission('devdoo-teams', 'teams-app', 'unsafe\u0000group'),
  'unsafe repository permission group slug is rejected',
);
await assertInvalidRequest(
  () => client.updateRepositoryUserPermission('devdoo-teams', 'teams-app', 'unsafe\u0000principal', { permission: 'read' }),
  'unsafe repository permission mutation principal is rejected',
);
await assertInvalidRequest(
  () => client.updateRepositoryGroupPermission('devdoo-teams', 'teams-app', 'unsafe\u0000group', { permission: 'read' }),
  'unsafe repository permission mutation group slug is rejected',
);
await assertInvalidRequest(
  () => client.updateRepositoryGroupPermission('devdoo-teams', 'teams-app', 'release-group', { permission: 'none' } as never),
  'unsupported repository permission value is rejected',
);
await assertInvalidRequest(
  () => client.updateRepositoryUserPermission('devdoo-teams', 'teams-app', 'user-id', { permission: 'read', unexpected: true } as never),
  'repository permission update rejects undocumented body fields',
);

const logClient = new BitbucketCloudClient({
  authProvider: () => secret,
  fetchImpl: async () => new Response('bounded pipeline log', { status: 200, headers: { 'content-type': 'application/octet-stream' } }),
});
const logResult = await logClient.pipelineStepLog('devdoo-teams', 'teams-app', '{pipeline-uuid}', '{step-uuid}');
assert.deepEqual(logResult, { ok: true, data: 'bounded pipeline log', status: 200 });

const unauthorized = new BitbucketCloudClient({
  authProvider: () => 'super-secret-token',
  fetchImpl: async () => new Response('denied', { status: 401 }),
});
const denied = await unauthorized.currentUser();
assert.equal(denied.ok, false);
assert.equal(JSON.stringify(denied).includes('super-secret-token'), false);

const malformed = new BitbucketCloudClient({
  authProvider: () => secret,
  fetchImpl: async () => new Response('{bad', { status: 200 }),
});
const malformedResult = await malformed.currentUser();
assert.equal(malformedResult.ok, false);
if (!malformedResult.ok) assert.equal(malformedResult.error.code, 'malformed-response');

const timeout = new BitbucketCloudClient({
  authProvider: () => secret,
  timeoutMs: 20,
  fetchImpl: async (_input, init) => await new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  }),
});
const timedOut = await timeout.currentUser();
assert.equal(timedOut.ok, false);
if (!timedOut.ok) assert.equal(timedOut.error.code, 'timeout');

const bodyTimeoutState = { canceled: false };
const bodyTimeout = new BitbucketCloudClient({
  authProvider: () => secret,
  timeoutMs: 100,
  fetchImpl: async () => createNeverEndingJsonResponse(bodyTimeoutState),
});
const bodyTimedOut = await Promise.race([
  bodyTimeout.currentUser(),
  delay(350, 'did-not-settle' as const),
]);
assert.notEqual(bodyTimedOut, 'did-not-settle', 'response body read must honor request timeout');
if (bodyTimedOut !== 'did-not-settle') {
  assert.equal(bodyTimedOut.ok, false);
  if (!bodyTimedOut.ok) assert.equal(bodyTimedOut.error.code, 'timeout');
}
assert.equal(bodyTimeoutState.canceled, true, 'timed out body readers are canceled');

let invalidRequestResult: Awaited<ReturnType<typeof client.repositories>> | undefined;
await assert.doesNotReject(async () => {
  invalidRequestResult = await client.repositories('devdoo-teams\u0000', {});
}, 'invalid Bitbucket input should fail closed instead of throwing');
assert.equal(invalidRequestResult?.ok, false);
if (invalidRequestResult && !invalidRequestResult.ok) {
  assert.equal(invalidRequestResult.error.code, 'invalid-request');
  assert.equal(invalidRequestResult.error.requestPath, '/2.0/repositories');
}

const oversized = new BitbucketCloudClient({
  authProvider: () => secret,
  fetchImpl: async () => new Response(JSON.stringify({ value: 'x'.repeat(300_000) }), { status: 200 }),
});
const oversizedResult = await oversized.currentUser();
assert.equal(oversizedResult.ok, false, 'provider responses are bounded before JSON parsing');
if (!oversizedResult.ok) assert.equal(oversizedResult.error.code, 'response-too-large');

const revisionResponseLimited = new BitbucketCloudClient({
  authProvider: () => secret,
  fetchImpl: async () => new Response(JSON.stringify({ value: 'x'.repeat(300_000) }), { status: 200 }),
});
const revisionResponseLimitedResult = await revisionResponseLimited.commitsForRevision('devdoo-teams', 'teams-app', 'main');
assert.equal(revisionResponseLimitedResult.ok, false, 'revision commit history responses are bounded before JSON parsing');
if (!revisionResponseLimitedResult.ok) assert.equal(revisionResponseLimitedResult.error.code, 'response-too-large');

assert.throws(() => new BitbucketCloudClient({
  baseUrl: 'https://attacker.example.test/2.0',
  authProvider: () => secret,
}), /baseUrl must target the Bitbucket Cloud API/);

for (const unsafePath of [
  '../secret.txt',
  'src/../secret.txt',
  './README.md',
  'src/./index.ts',
  '..\\secret.txt',
  'src\\..\\secret.ts',
  '%2e%2e/secret.txt',
] as const) {
  await assertInvalidRequest(
    () => client.files('devdoo-teams', 'teams-app', 'main', unsafePath),
    `file reads reject dot-segment path ${unsafePath}`,
  );
}

let missingCredentialFetchCalled = false;
const missingCredentialClient = new BitbucketCloudClient({
  authProvider: () => '  ',
  fetchImpl: async () => {
    missingCredentialFetchCalled = true;
    return new Response('{}', { status: 200 });
  },
});
const missingCredentialResult = await missingCredentialClient.currentUser();
assert.equal(missingCredentialResult.ok, false, 'direct Bitbucket requests fail closed without credentials');
if (!missingCredentialResult.ok) assert.equal(missingCredentialResult.error.code, 'credentials-unavailable');
assert.equal(missingCredentialFetchCalled, false, 'missing Bitbucket credentials never reach fetch');

console.log('PASS: Bitbucket Cloud client paths, URL encoding, auth redaction, timeout, and malformed response');
