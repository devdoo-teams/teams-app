import assert from 'node:assert/strict';

import { AtlassianCloudClient } from '../src/server/atlassian-cloud-client.js';

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

const secret = 'secret-atlassian-token';
const requests: Array<{ url: string; init?: RequestInit }> = [];
const client = new AtlassianCloudClient({
  siteUrl: 'https://devdoo.atlassian.net',
  authProvider: () => secret,
  fetchImpl: async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  },
});

assert.equal((await client.jiraSearchJql({ jql: 'project = MP AND summary ~ "A/B"', maxResults: 10 })).ok, true);
assert.match(requests.at(-1)?.url ?? '', /\/rest\/api\/3\/search\/jql\?jql=/);
assert.match(requests.at(-1)?.url ?? '', /A%2FB/);
assert.equal(new Headers(requests.at(-1)?.init?.headers).get('authorization'), `Bearer ${secret}`);
assert.equal((await client.jiraGetIssue('MP-1')).ok, true);
assert.equal((await client.jiraGetIssueChangelogs('MP/1', { startAt: 10, maxResults: 50 })).ok, true);
assert.equal(
  requests.at(-1)?.url,
  'https://devdoo.atlassian.net/rest/api/3/issue/MP%2F1/changelog?startAt=10&maxResults=50',
  'Jira changelog reads use the documented issue changelog route and pagination query',
);
assert.equal((await client.jiraCreateIssue({ fields: { summary: 'test' } })).ok, true);
assert.equal((await client.jiraEditIssue('MP-1', { fields: { summary: 'updated' } })).ok, true);
assert.equal((await client.jiraListTransitions('MP-1')).ok, true);
assert.equal((await client.jiraTransitionIssue('MP-1', { transition: { id: '31' } })).ok, true);
assert.equal((await client.jiraGetRemoteIssueLinks('MP-1')).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/rest/api/3/issue/MP-1/remotelink');
const issueLinkPayload = {
  inwardIssue: { key: 'MP/2' },
  outwardIssue: { key: 'MP-1' },
  type: { name: 'Blocks' },
};
assert.equal((await client.jiraCreateIssueLink(issueLinkPayload)).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/rest/api/3/issueLink');
assert.equal(requests.at(-1)?.init?.method, 'POST');
assert.deepEqual(JSON.parse(String(requests.at(-1)?.init?.body)), issueLinkPayload, 'issue-link creation keeps the official request payload');
assert.equal((await client.jiraGetIssueLink('100/2')).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/rest/api/3/issueLink/100%2F2');
assert.equal((await client.jiraDeleteIssueLink('100/2')).ok, true);
assert.equal(requests.at(-1)?.init?.method, 'DELETE');
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/rest/api/3/issueLink/100%2F2');
const remoteLinkPayload = {
  globalId: 'system=https://tracker.example.test&id=22',
  object: { url: 'https://tracker.example.test/22', title: 'Tracker 22' },
  relationship: 'relates to',
};
assert.equal((await client.jiraCreateOrUpdateRemoteIssueLink('MP/1', remoteLinkPayload)).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/rest/api/3/issue/MP%2F1/remotelink');
assert.equal(requests.at(-1)?.init?.method, 'POST');
assert.deepEqual(JSON.parse(String(requests.at(-1)?.init?.body)), remoteLinkPayload, 'remote-link upsert keeps the official request payload');
assert.equal((await client.jiraGetRemoteIssueLink('MP/1', '100/2')).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/rest/api/3/issue/MP%2F1/remotelink/100%2F2');
assert.equal((await client.jiraUpdateRemoteIssueLink('MP/1', '100/2', remoteLinkPayload)).ok, true);
assert.equal(requests.at(-1)?.init?.method, 'PUT');
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/rest/api/3/issue/MP%2F1/remotelink/100%2F2');
assert.equal((await client.jiraDeleteRemoteIssueLink('MP/1', '100/2')).ok, true);
assert.equal(requests.at(-1)?.init?.method, 'DELETE');
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/rest/api/3/issue/MP%2F1/remotelink/100%2F2');
assert.equal((await client.jiraDeleteRemoteIssueLinkByGlobalId('MP/1', remoteLinkPayload.globalId)).ok, true);
assert.equal(requests.at(-1)?.init?.method, 'DELETE');
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/rest/api/3/issue/MP%2F1/remotelink?globalId=system%3Dhttps%3A%2F%2Ftracker.example.test%26id%3D22');
assert.equal((await client.jiraGetIssueTypeFields('MP', '10001', { startAt: 0, maxResults: 50 })).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/rest/api/3/issue/createmeta/MP/issuetypes/10001?startAt=0&maxResults=50');
assert.equal((await client.jiraGetProjectIssueTypes('MP', { maxResults: 25 })).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/rest/api/3/issue/createmeta/MP/issuetypes?maxResults=25');
assert.equal((await client.jiraGetIssueLinkTypes()).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/rest/api/3/issueLinkType');
assert.equal((await client.jiraGetVisibleProjects({ startAt: 0, maxResults: 20, query: 'mobile core' })).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/rest/api/3/project/search?startAt=0&maxResults=20&query=mobile+core');
assert.equal((await client.jiraLookupAccountIds({ query: 'Doosan', maxResults: 10 })).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/rest/api/3/user/picker?query=Doosan&maxResults=10');
assert.equal((await client.jiraAddComment('MP-1', { body: { type: 'doc', version: 1, content: [] } })).ok, true);
assert.equal(requests.at(-1)?.init?.method, 'POST');
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/rest/api/3/issue/MP-1/comment');
assert.equal((await client.jiraAddWorklog('MP-1', { timeSpentSeconds: 900 }, { adjustEstimate: 'leave', notifyUsers: false })).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/rest/api/3/issue/MP-1/worklog?notifyUsers=false&adjustEstimate=leave');
assert.equal((await client.jiraGetIssueWorklogs('MP/1', {
  startAt: 10,
  maxResults: 50,
  startedAfter: 1_700_000_000_000,
  startedBefore: 1_700_100_000_000,
  expand: 'properties,visibility',
})).ok, true);
assert.equal(
  requests.at(-1)?.url,
  'https://devdoo.atlassian.net/rest/api/3/issue/MP%2F1/worklog?startAt=10&maxResults=50&startedAfter=1700000000000&startedBefore=1700100000000&expand=properties%2Cvisibility',
);
const worklogUpdate = {
  started: '2026-08-19T10:20:00.000+0000',
  timeSpentSeconds: 1_200,
  comment: { type: 'doc', version: 1, content: [] },
  visibility: { type: 'group', value: 'jira-users' },
  properties: [{ key: 'teams.release', value: '1.0.54' }],
};
const requestCountBeforeWorklogUpdate = requests.length;
assert.equal((await client.jiraEditWorklog('MP/1', '100/2', worklogUpdate, {
  notifyUsers: false,
  adjustEstimate: 'manual',
  newEstimate: '2h',
  reduceBy: '1h',
  expand: 'properties',
  overrideEditableFlag: true,
})).ok, true);
assert.equal(requests.at(-1)?.init?.method, 'PUT');
assert.equal(
  requests.at(-1)?.url,
  'https://devdoo.atlassian.net/rest/api/3/issue/MP%2F1/worklog/100%2F2?notifyUsers=false&adjustEstimate=manual&newEstimate=2h&reduceBy=1h&expand=properties&overrideEditableFlag=true',
);
assert.deepEqual(JSON.parse(String(requests.at(-1)?.init?.body)), worklogUpdate, 'worklog update preserves the documented JSON body');
assert.equal((await client.jiraEditWorklog('MP/1', '100/2', worklogUpdate, {
  adjustEstimate: 'manual',
})).ok, false, 'manual estimate adjustment rejects a missing reduceBy before provider access');
assert.equal(requests.length, requestCountBeforeWorklogUpdate + 1, 'invalid manual estimate does not issue a network request');
assert.equal((await client.jiraAddWorklog('MP/1', { timeSpentSeconds: 900 }, {
  adjustEstimate: 'new',
})).ok, false, 'new estimate adjustment rejects a missing newEstimate before provider access');
assert.equal(requests.length, requestCountBeforeWorklogUpdate + 1, 'invalid new estimate does not issue a network request');
assert.equal((await client.jiraGetProjectVersions('MP/2', { expand: 'issuesStatusForFixVersion' })).ok, true);
assert.equal(
  requests.at(-1)?.url,
  'https://devdoo.atlassian.net/rest/api/3/project/MP%2F2/versions?expand=issuesStatusForFixVersion',
);
assert.equal((await client.jiraFindAssignableUsers({
  projectKeys: ['MP/2', 'OPS'],
  query: 'Baek /',
  accountId: 'acct/1',
  startAt: 5,
  maxResults: 25,
})).ok, true);
assert.equal(
  requests.at(-1)?.url,
  'https://devdoo.atlassian.net/rest/api/3/user/assignable/multiProjectSearch?query=Baek+%2F&accountId=acct%2F1&projectKeys=MP%2F2%2COPS&startAt=5&maxResults=25',
);
assert.equal((await client.jiraFindAssignableUsers({
  issueKey: 'MP/1',
  query: 'Baek /',
  actionDescriptorId: 7,
  maxResults: 10,
})).ok, true);
assert.equal(
  requests.at(-1)?.url,
  'https://devdoo.atlassian.net/rest/api/3/user/assignable/search?query=Baek+%2F&issueKey=MP%2F1&maxResults=10&actionDescriptorId=7',
);
assert.equal((await client.confluenceSearchCql({ cql: 'title ~ "Teams / Core"' })).ok, true);
assert.equal((await client.confluenceGetPage('123')).ok, true);
assert.equal((await client.confluenceCreatePage({ spaceId: '42', title: 'Core', body: { value: 'body' } })).ok, true);
assert.equal((await client.confluenceUpdatePage({ id: '123', version: { number: 2 }, title: 'Core 2' })).ok, true);
assert.equal((await client.confluenceGetPageDescendants('123', { limit: 25, depth: 3, cursor: 'next' })).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/wiki/api/v2/pages/123/descendants?limit=25&depth=3&cursor=next');
assert.equal((await client.confluenceGetPageFooterComments('123', { limit: 10 })).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/wiki/api/v2/pages/123/footer-comments?limit=10');
assert.equal((await client.confluenceGetPageInlineComments('123', { limit: 10 })).ok, true);
assert.equal((await client.confluenceGetCommentChildren('footer', '900', { cursor: 'child-next' })).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/wiki/api/v2/footer-comments/900/children?cursor=child-next');
assert.equal((await client.confluenceGetSpaces({ keys: ['ENG', 'OPS'], limit: 50 })).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/wiki/api/v2/spaces?keys=ENG%2COPS&limit=50');
assert.equal((await client.confluenceGetPagesInSpace('42', { depth: 'root', status: ['current'], limit: 25 })).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/wiki/api/v2/spaces/42/pages?depth=root&status=current&limit=25');
assert.equal((await client.confluenceCreateFooterComment({ pageId: '123', body: { representation: 'storage', value: '<p>review</p>' } })).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/wiki/api/v2/footer-comments');
assert.equal((await client.confluenceGetFooterComment('900')).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/wiki/api/v2/footer-comments/900');
const footerCommentUpdateWithLinks = {
  version: { number: 2, message: 'revise' },
  body: { representation: 'storage' as const, value: '<p>updated</p>' },
  _links: { base: 'https://devdoo.atlassian.net/wiki' },
};
assert.equal((await client.confluenceUpdateFooterComment('900', footerCommentUpdateWithLinks)).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/wiki/api/v2/footer-comments/900');
assert.equal(requests.at(-1)?.init?.method, 'PUT');
assert.deepEqual(JSON.parse(String(requests.at(-1)?.init?.body)), footerCommentUpdateWithLinks);
assert.equal((await client.confluenceDeleteFooterComment('900')).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/wiki/api/v2/footer-comments/900');
assert.equal(requests.at(-1)?.init?.method, 'DELETE');
assert.equal((await client.confluenceCreateInlineComment({
  pageId: '123',
  body: { representation: 'storage', value: '<p>nit</p>' },
  inlineCommentProperties: { textSelection: 'selected text', textSelectionMatchCount: 1, textSelectionMatchIndex: 0 },
})).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/wiki/api/v2/inline-comments');
assert.equal((await client.confluenceGetInlineComment('901')).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/wiki/api/v2/inline-comments/901');
const inlineCommentUpdateWithBasicBody = {
  version: { number: 3 },
  body: { representation: 'atlas_doc_format' as const, value: '{"type":"doc"}' },
  resolved: true,
};
assert.equal((await client.confluenceUpdateInlineComment('901', inlineCommentUpdateWithBasicBody)).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/wiki/api/v2/inline-comments/901');
assert.equal(requests.at(-1)?.init?.method, 'PUT');
assert.deepEqual(JSON.parse(String(requests.at(-1)?.init?.body)), inlineCommentUpdateWithBasicBody);
assert.equal((await client.confluenceDeleteInlineComment('901')).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/wiki/api/v2/inline-comments/901');
assert.equal(requests.at(-1)?.init?.method, 'DELETE');
assert.equal((await client.confluenceDeletePage('123')).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/wiki/api/v2/pages/123');
assert.equal(requests.at(-1)?.init?.method, 'DELETE');
assert.equal((await client.confluenceDeletePage('123', { draft: true })).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/wiki/api/v2/pages/123?draft=true');
assert.equal((await client.confluenceDeletePage('123', { purge: true })).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/wiki/api/v2/pages/123?purge=true');

assert.equal((await client.confluenceGetFooterComment('900', {
  bodyFormat: 'storage',
  version: 2,
  includeProperties: true,
  includeVersion: false,
})).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/wiki/api/v2/footer-comments/900?body-format=storage&version=2&include-properties=true&include-version=false');

const footerCommentUpdate = {
  version: { number: 3, message: 'reviewed' },
  body: { representation: 'storage' as const, value: '<p>updated</p>' },
};
assert.equal((await client.confluenceUpdateFooterComment('900', footerCommentUpdate)).ok, true);
assert.equal(requests.at(-1)?.init?.method, 'PUT');
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/wiki/api/v2/footer-comments/900');
assert.deepEqual(JSON.parse(String(requests.at(-1)?.init?.body)), footerCommentUpdate);
assert.equal((await client.confluenceDeleteFooterComment('900')).ok, true);
assert.equal(requests.at(-1)?.init?.method, 'DELETE');
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/wiki/api/v2/footer-comments/900');

assert.equal((await client.confluenceGetInlineComment('901', { bodyFormat: 'atlas_doc_format', includeOperations: true })).ok, true);
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/wiki/api/v2/inline-comments/901?body-format=atlas_doc_format&include-operations=true');

const inlineCommentUpdate = {
  version: { number: 4 },
  body: { representation: 'atlas_doc_format' as const, value: '{"type":"doc"}' },
  resolved: true,
};
assert.equal((await client.confluenceUpdateInlineComment('901', inlineCommentUpdate)).ok, true);
assert.equal(requests.at(-1)?.init?.method, 'PUT');
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/wiki/api/v2/inline-comments/901');
assert.deepEqual(JSON.parse(String(requests.at(-1)?.init?.body)), inlineCommentUpdate);
assert.equal((await client.confluenceDeleteInlineComment('901')).ok, true);
assert.equal(requests.at(-1)?.init?.method, 'DELETE');
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/wiki/api/v2/inline-comments/901');

assert.equal((await client.confluenceDeletePage('123', { draft: true })).ok, true);
assert.equal(requests.at(-1)?.init?.method, 'DELETE');
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/wiki/api/v2/pages/123?draft=true');
assert.equal((await client.confluenceDeletePage('123', { purge: true })).ok, true);
assert.equal(requests.at(-1)?.init?.method, 'DELETE');
assert.equal(requests.at(-1)?.url, 'https://devdoo.atlassian.net/wiki/api/v2/pages/123?purge=true');

const invalidFooterUpdate = await client.confluenceUpdateFooterComment('900', {
  version: { number: 0 },
  body: { representation: 'storage', value: '<p>invalid</p>' },
});
assert.equal(invalidFooterUpdate.ok, false);
if (!invalidFooterUpdate.ok) {
  assert.equal(invalidFooterUpdate.error.code, 'invalid-request');
  assert.equal(invalidFooterUpdate.error.requestPath, '/wiki/api/v2/footer-comments');
}
const invalidInlineUpdate = await client.confluenceUpdateInlineComment('901', { version: { number: 1 } });
assert.equal(invalidInlineUpdate.ok, false);
if (!invalidInlineUpdate.ok) {
  assert.equal(invalidInlineUpdate.error.code, 'invalid-request');
  assert.equal(invalidInlineUpdate.error.requestPath, '/wiki/api/v2/inline-comments');
}

const unauthorized = new AtlassianCloudClient({
  siteUrl: 'https://devdoo.atlassian.net',
  authProvider: () => 'super-secret-token',
  fetchImpl: async () => new Response('denied', { status: 403 }),
});
const denied = await unauthorized.jiraGetIssue('MP-1');
assert.equal(denied.ok, false);
assert.equal(JSON.stringify(denied).includes('super-secret-token'), false);
const deniedConfluence = await unauthorized.confluenceDeleteInlineComment('901');
assert.equal(deniedConfluence.ok, false);
assert.equal(JSON.stringify(deniedConfluence).includes('super-secret-token'), false);

const malformed = new AtlassianCloudClient({
  siteUrl: 'https://devdoo.atlassian.net',
  authProvider: () => secret,
  fetchImpl: async () => new Response('{bad', { status: 200 }),
});
const malformedResult = await malformed.jiraGetIssue('MP-1');
assert.equal(malformedResult.ok, false);
if (!malformedResult.ok) assert.equal(malformedResult.error.code, 'malformed-response');

const timeout = new AtlassianCloudClient({
  siteUrl: 'https://devdoo.atlassian.net',
  authProvider: () => secret,
  timeoutMs: 20,
  fetchImpl: async (_input, init) => await new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  }),
});
const timedOut = await timeout.jiraGetIssue('MP-1');
assert.equal(timedOut.ok, false);
if (!timedOut.ok) assert.equal(timedOut.error.code, 'timeout');

const bodyTimeoutState = { canceled: false };
const bodyTimeout = new AtlassianCloudClient({
  siteUrl: 'https://devdoo.atlassian.net',
  authProvider: () => secret,
  timeoutMs: 100,
  fetchImpl: async () => createNeverEndingJsonResponse(bodyTimeoutState),
});
const bodyTimedOut = await Promise.race([
  bodyTimeout.jiraGetIssue('MP-1'),
  delay(350, 'did-not-settle' as const),
]);
assert.notEqual(bodyTimedOut, 'did-not-settle', 'response body read must honor request timeout');
if (bodyTimedOut !== 'did-not-settle') {
  assert.equal(bodyTimedOut.ok, false);
  if (!bodyTimedOut.ok) assert.equal(bodyTimedOut.error.code, 'timeout');
}
assert.equal(bodyTimeoutState.canceled, true, 'timed out body readers are canceled');

let invalidRequestResult: Awaited<ReturnType<typeof client.jiraSearchJql>> | undefined;
await assert.doesNotReject(async () => {
  invalidRequestResult = await client.jiraSearchJql({ jql: 'project = MP\u0000' });
}, 'invalid Jira input should fail closed instead of throwing');
assert.equal(invalidRequestResult?.ok, false);
if (invalidRequestResult && !invalidRequestResult.ok) {
  assert.equal(invalidRequestResult.error.code, 'invalid-request');
  assert.equal(invalidRequestResult.error.requestPath, '/rest/api/3/search/jql');
}

const invalidLinkId = await client.jiraGetIssueLink('100\u0000');
assert.equal(invalidLinkId.ok, false, 'invalid issue-link IDs fail closed without calling the provider');
if (!invalidLinkId.ok) {
  assert.equal(invalidLinkId.error.code, 'invalid-request');
  assert.equal(invalidLinkId.error.requestPath, '/rest/api/3/issueLink');
}

const invalidConfluenceComment = await client.confluenceUpdateFooterComment('900', {
  version: { number: 0 },
  body: { representation: 'storage', value: '<p>invalid</p>' },
});
assert.equal(invalidConfluenceComment.ok, false, 'invalid Confluence comment versions fail closed');
if (!invalidConfluenceComment.ok) assert.equal(invalidConfluenceComment.error.code, 'invalid-request');
const invalidConfluenceDelete = await client.confluenceDeletePage('123', { draft: true, purge: true });
assert.equal(invalidConfluenceDelete.ok, false, 'draft and purge cannot be requested together');
if (!invalidConfluenceDelete.ok) assert.equal(invalidConfluenceDelete.error.code, 'invalid-request');
const invalidWorklogUpdate = await client.jiraEditWorklog('MP-1', '100', { timeSpentSeconds: 0 });
assert.equal(invalidWorklogUpdate.ok, false, 'worklog updates reject non-positive durations before provider access');
if (!invalidWorklogUpdate.ok) {
  assert.equal(invalidWorklogUpdate.error.code, 'invalid-request');
  assert.equal(invalidWorklogUpdate.error.requestPath, '/rest/api/3/issue/worklog');
}
const invalidAssignableUsers = await client.jiraFindAssignableUsers({ query: 'Baek' });
assert.equal(invalidAssignableUsers.ok, false, 'assignable-user searches require a project or issue scope');
if (!invalidAssignableUsers.ok) {
  assert.equal(invalidAssignableUsers.error.code, 'invalid-request');
  assert.equal(invalidAssignableUsers.error.requestPath, '/rest/api/3/user/assignable/search');
}
const requestCountBeforeUnicodePath = requests.length;
const unicodePath = await client.jiraGetIssue('é'.repeat(3_000));
assert.equal(unicodePath.ok, false, 'Atlassian path identifiers enforce their UTF-8 byte bound');
if (!unicodePath.ok) assert.equal(unicodePath.error.code, 'invalid-request');
assert.equal(requests.length, requestCountBeforeUnicodePath, 'oversized UTF-8 Atlassian identifiers never reach fetch');

const oversized = new AtlassianCloudClient({
  siteUrl: 'https://devdoo.atlassian.net',
  authProvider: () => secret,
  fetchImpl: async () => new Response(JSON.stringify({ value: 'x'.repeat(300_000) }), { status: 200 }),
});
const oversizedResult = await oversized.jiraGetIssue('MP-1');
assert.equal(oversizedResult.ok, false, 'provider responses are bounded before JSON parsing');
if (!oversizedResult.ok) assert.equal(oversizedResult.error.code, 'response-too-large');

assert.throws(() => new AtlassianCloudClient({
  siteUrl: 'https://attacker.example.test',
  authProvider: () => secret,
}), /siteUrl must target an Atlassian Cloud site/);

let missingCredentialFetchCalled = false;
const missingCredentialClient = new AtlassianCloudClient({
  siteUrl: 'https://devdoo.atlassian.net',
  authProvider: () => undefined,
  fetchImpl: async () => {
    missingCredentialFetchCalled = true;
    return new Response('{}', { status: 200 });
  },
});
const missingCredentialResult = await missingCredentialClient.jiraGetIssue('MP-1');
assert.equal(missingCredentialResult.ok, false, 'direct Atlassian requests fail closed without credentials');
if (!missingCredentialResult.ok) assert.equal(missingCredentialResult.error.code, 'credentials-unavailable');
assert.equal(missingCredentialFetchCalled, false, 'missing Atlassian credentials never reach fetch');

console.log('PASS: Atlassian Jira/Confluence client paths, auth redaction, timeout, malformed response, and URL encoding');
