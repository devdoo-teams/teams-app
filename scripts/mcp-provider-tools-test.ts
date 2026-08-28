import assert from 'node:assert/strict';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  ATLASSIAN_ROVO_PROVIDER_CAPABILITIES,
  createMcpProviderToolRegistry,
  type ProviderName,
} from '../src/server/mcp-provider-tools.js';
import { implementedRovoCapability } from '../src/server/atlassian-rovo-provider-parity.js';
import { createPrincipalScopedProviderHttpBroker } from '../src/server/mcp-provider-http-broker.js';
import { createMcpGenUiServer } from '../src/server/mcp-genui.js';

type RegisteredTool = {
  handler: (input: Record<string, unknown>, extra?: unknown) => Promise<Record<string, any>>;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean };
  _meta: Record<string, unknown>;
  inputSchema: { safeParse(value: unknown): { success: boolean } };
};

const toolNames = [
  'jira_search_jql',
  'jira_get_issue',
  'jira_get_issue_changelogs',
  'jira_create_issue',
  'jira_edit_issue',
  'jira_list_transitions',
  'jira_transition_issue',
  'jira_get_remote_issue_links',
  'jira_create_issue_link',
  'jira_get_issue_link',
  'jira_delete_issue_link',
  'jira_create_or_update_remote_issue_link',
  'jira_get_remote_issue_link',
  'jira_update_remote_issue_link',
  'jira_delete_remote_issue_link',
  'jira_delete_remote_issue_link_by_global_id',
  'jira_get_issue_type_fields',
  'jira_get_project_issue_types',
  'jira_get_issue_link_types',
  'jira_get_visible_projects',
  'jira_lookup_account_ids',
  'jira_add_comment',
  'jira_add_worklog',
  'jira_get_issue_worklogs',
  'jira_edit_worklog',
  'jira_get_project_versions',
  'jira_find_assignable_users',
  'confluence_search_cql',
  'confluence_get_page',
  'confluence_create_page',
  'confluence_update_page',
  'confluence_get_page_descendants',
  'confluence_get_page_footer_comments',
  'confluence_get_page_inline_comments',
  'confluence_get_comment_children',
  'confluence_get_spaces',
  'confluence_get_pages_in_space',
  'confluence_create_footer_comment',
  'confluence_create_inline_comment',
  'confluence_get_footer_comment',
  'confluence_update_footer_comment',
  'confluence_delete_footer_comment',
  'confluence_get_inline_comment',
  'confluence_update_inline_comment',
  'confluence_delete_inline_comment',
  'confluence_delete_page',
  'bitbucket_current_user',
  'bitbucket_workspaces',
  'bitbucket_workspace_permissions',
  'bitbucket_repositories',
  'bitbucket_commits',
  'bitbucket_pull_requests',
  'bitbucket_issues',
  'bitbucket_get_workspace',
  'bitbucket_get_repository',
  'bitbucket_default_reviewers',
  'bitbucket_user_pull_requests',
  'bitbucket_deployments',
  'bitbucket_get_deployment',
  'bitbucket_get_pull_request',
  'bitbucket_pull_request_comments',
  'bitbucket_pull_request_activity',
  'bitbucket_pull_request_diff',
  'bitbucket_pull_request_diffstat',
  'bitbucket_pull_request_statuses',
  'bitbucket_get_branch',
  'bitbucket_branches',
  'bitbucket_get_commit',
  'bitbucket_get_files',
  'bitbucket_commits_for_revision',
  'bitbucket_file_history',
  'bitbucket_source_root',
  'bitbucket_pipelines',
  'bitbucket_get_pipeline',
  'bitbucket_pipeline_steps',
  'bitbucket_get_pipeline_step',
  'bitbucket_pipeline_step_log',
  'bitbucket_environments',
  'bitbucket_get_environment',
  'bitbucket_repository_user_permissions',
  'bitbucket_get_repository_user_permission',
  'bitbucket_update_repository_user_permission',
  'bitbucket_delete_repository_user_permission',
  'bitbucket_repository_group_permissions',
  'bitbucket_get_repository_group_permission',
  'bitbucket_update_repository_group_permission',
  'bitbucket_delete_repository_group_permission',
  'bitbucket_create_pull_request',
  'bitbucket_merge_pull_request',
  'bitbucket_approve_pull_request',
  'bitbucket_update_pull_request',
  'bitbucket_decline_pull_request',
  'bitbucket_unapprove_pull_request',
  'bitbucket_add_pull_request_comment',
  'bitbucket_create_branch',
  'bitbucket_create_commit',
  'bitbucket_run_pipeline',
  'bitbucket_stop_pipeline',
  'bitbucket_create_environment',
  'bitbucket_update_environment',
  'bitbucket_delete_environment',
  'bitbucket_delete_branch',
];

function registeredTools(server: McpServer): Record<string, RegisteredTool> {
  return (server as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
}

function serverWithRegistry(
  resolveCredential: (provider: ProviderName) => string | undefined,
  fetchImpl: typeof fetch,
): McpServer {
  const server = new McpServer({ name: 'provider-tools-test', version: '1.0.0' });
  createMcpProviderToolRegistry({
    principal: { tenantId: 'tenant-1', requesterId: 'requester-1' },
    resolveCredential: (provider) => resolveCredential(provider),
    atlassianSiteUrl: 'https://devdoo.atlassian.net',
    fetchImpl,
  }).register(server);
  return server;
}

const requests: Array<{ url: string; method: string | undefined; authorization: string | null; body: string | undefined }> = [];
const fetchImpl: typeof fetch = async (input, init) => {
  requests.push({
    url: String(input),
    method: init?.method,
    authorization: new Headers(init?.headers).get('authorization'),
    body: typeof init?.body === 'string' ? init.body : undefined,
  });
  return new Response(JSON.stringify({
    values: [{
      id: 'public-id',
      text: 'Bearer should-be-redacted',
      link: 'https://example.test/?api_key=secret-from-provider',
    }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const server = serverWithRegistry((provider) => provider === 'bitbucket' ? 'bb-secret-token' : 'atlassian-secret-token', fetchImpl);
const tools = registeredTools(server);
assert.deepEqual(Object.keys(tools).sort(), [...toolNames].sort(), 'all optional provider tools are registered');
assert.equal(toolNames.length, 102, 'provider parity includes confirmed Jira, Bitbucket, and Confluence operations');
const createIssueLinkCapability = implementedRovoCapability('jira_create_issue_link');
assert.equal(createIssueLinkCapability?.officialTool, 'createIssueLink', 'official Rovo createIssueLink is represented in parity inventory');
assert.equal(createIssueLinkCapability?.provenance, 'rovo-preview', 'createIssueLink keeps official Rovo Preview provenance');
assert.equal(createIssueLinkCapability?.method, 'POST', 'createIssueLink records the official Jira HTTP method');
assert.equal(createIssueLinkCapability?.path, '/rest/api/3/issueLink', 'createIssueLink records the official Jira REST route');
const unsupported = ATLASSIAN_ROVO_PROVIDER_CAPABILITIES.filter((capability) => capability.status === 'unsupported');
assert.deepEqual(
  unsupported.map((capability) => `${capability.officialTool}:${capability.action}`),
  [],
  'the local adapter has no declared implementation gaps in its bounded inventory',
);
assert.equal(
  ATLASSIAN_ROVO_PROVIDER_CAPABILITIES.filter((capability) => capability.status === 'implemented').length,
  97,
  'every bounded inventory row maps to a local implementation',
);
const provenanceValues = new Set(ATLASSIAN_ROVO_PROVIDER_CAPABILITIES.map((capability) => capability.provenance));
assert.deepEqual(
  [...provenanceValues].sort(),
  ['rest-extension', 'rovo-preview'],
  'every inventory row identifies whether it is an exact Rovo Preview operation or a local REST extension',
);
assert.equal(
  ATLASSIAN_ROVO_PROVIDER_CAPABILITIES.every((capability) => capability.provenance !== undefined),
  true,
  'no implementation row silently omits contract provenance',
);
assert.equal(
  ATLASSIAN_ROVO_PROVIDER_CAPABILITIES.some((capability) => capability.provenance === 'rovo-supported'),
  false,
  'the GA supported-tools page is not treated as row-level proof when it does not publish operation names',
);
assert.deepEqual(
  ATLASSIAN_ROVO_PROVIDER_CAPABILITIES
    .filter((capability) => capability.provenance === 'rovo-preview')
    .map((capability) => capability.officialTool),
  [
    'getJiraIssue',
    'getJiraIssueRemoteIssueLinks',
    'createIssueLink',
    'getJiraIssueTypeMetaWithFields',
    'getJiraProjectIssueTypesMetadata',
    'getIssueLinkTypes',
    'getTransitionsForJiraIssue',
    'getVisibleJiraProjects',
    'lookupJiraAccountId',
    'getIssueWorklog',
    'addOrEditJiraIssueWorklog',
    'getJiraProjectVersions',
    'findAssignableUsers',
    'createJiraIssue',
    'editJiraIssue',
    'transitionJiraIssue',
    'searchJiraIssuesUsingJql',
  ],
  'only exact operation names published by the official Rovo Preview page are tagged as Rovo Preview',
);
assert.deepEqual(
  ATLASSIAN_ROVO_PROVIDER_CAPABILITIES
    .filter((capability) => capability.status === 'implemented')
    .map((capability) => capability.localTool)
    .filter((name, index, names) => names.indexOf(name) !== index),
  [],
  'each official operation maps to a unique local MCP tool',
);
assert.equal(
  ATLASSIAN_ROVO_PROVIDER_CAPABILITIES
    .filter((capability) => capability.status === 'implemented')
    .every((capability) => capability.localTool && toolNames.includes(capability.localTool)),
  true,
  'every implemented inventory row is registered',
);
assert.deepEqual(tools.jira_get_visible_projects.annotations, {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
  idempotentHint: true,
});
assert.equal(tools.jira_get_visible_projects._meta.requiredProviderScope, 'read:jira-work');
assert.equal(tools.jira_get_issue_changelogs.annotations.readOnlyHint, true, 'Jira changelog reads are explicitly read-only');
assert.equal(tools.jira_get_issue_changelogs.annotations.destructiveHint, false, 'Jira changelog reads are non-destructive');
assert.equal(tools.jira_get_issue_changelogs.annotations.idempotentHint, true, 'Jira changelog reads are idempotent');
assert.deepEqual(
  tools.jira_get_issue_changelogs._meta.requiredProviderScopes,
  ['read:issue-meta:jira', 'read:avatar:jira', 'read:issue.changelog:jira'],
  'Jira changelog metadata preserves all granular scopes published by Atlassian',
);
assert.equal(tools.bitbucket_merge_pull_request.annotations.destructiveHint, true, 'PR merge is explicitly destructive');
assert.equal(tools.bitbucket_delete_environment.annotations.destructiveHint, true, 'environment deletion is explicitly destructive');
assert.equal(tools.bitbucket_approve_pull_request.annotations.idempotentHint, true, 'repeated approval is annotated idempotent');
assert.equal(tools.bitbucket_branches.annotations.readOnlyHint, true, 'branch listing is read-only');
assert.equal(tools.bitbucket_commits_for_revision.annotations.readOnlyHint, true, 'revision commit history is read-only');
assert.equal(tools.bitbucket_file_history.annotations.readOnlyHint, true, 'file history is read-only');
assert.equal(tools.bitbucket_source_root.annotations.readOnlyHint, true, 'source root listing is read-only');
assert.equal(tools.bitbucket_pull_request_diffstat.annotations.readOnlyHint, true, 'PR diffstat is read-only');
assert.equal(tools.bitbucket_pull_request_diffstat.annotations.destructiveHint, false, 'PR diffstat is non-destructive');
assert.equal(tools.bitbucket_pull_request_diffstat.annotations.idempotentHint, true, 'PR diffstat is idempotent');
assert.equal(tools.bitbucket_pull_request_diffstat._meta.requiredProviderScope, 'read:pullrequest:bitbucket');
assert.equal(tools.bitbucket_pull_request_activity.annotations.readOnlyHint, true, 'PR activity is read-only');
assert.equal(tools.bitbucket_pull_request_activity.annotations.destructiveHint, false, 'PR activity is non-destructive');
assert.equal(tools.bitbucket_pull_request_activity.annotations.idempotentHint, true, 'PR activity is idempotent');
assert.equal(tools.bitbucket_pull_request_activity._meta.requiredProviderScope, 'read:pullrequest:bitbucket');
assert.equal(tools.bitbucket_source_root._meta.requiredProviderScope, 'read:repository:bitbucket');
assert.equal(tools.bitbucket_workspace_permissions.annotations.readOnlyHint, true, 'workspace permission listing is read-only');
assert.equal(tools.bitbucket_workspace_permissions._meta.requiredProviderScope, 'read:workspace:bitbucket');
assert.equal(tools.bitbucket_update_pull_request.annotations.destructiveHint, true, 'PR update is explicitly destructive');
assert.equal(tools.bitbucket_delete_branch.annotations.destructiveHint, true, 'branch deletion is explicitly destructive');
assert.equal(tools.bitbucket_repository_user_permissions.annotations.readOnlyHint, true, 'repository user permission listing is read-only');
assert.equal(tools.bitbucket_update_repository_group_permission.annotations.destructiveHint, true, 'repository group permission updates are explicitly destructive');
assert.equal(tools.bitbucket_delete_repository_user_permission.annotations.destructiveHint, true, 'repository user permission deletions are explicitly destructive');
assert.deepEqual(tools.bitbucket_get_repository_group_permission._meta.requiredProviderScopes, ['read:repository:bitbucket']);
assert.deepEqual(tools.bitbucket_update_repository_user_permission._meta.requiredProviderScopes, ['admin:repository:bitbucket', 'write:permission:bitbucket']);
assert.deepEqual(tools.bitbucket_delete_repository_group_permission._meta.requiredProviderScopes, ['admin:repository:bitbucket', 'delete:permission:bitbucket']);
assert.equal(tools.confluence_get_footer_comment._meta.requiredProviderScope, 'read:comment:confluence');
assert.equal(tools.confluence_update_inline_comment._meta.requiredProviderScope, 'write:comment:confluence');
assert.equal(tools.confluence_delete_page._meta.requiredProviderScope, 'delete:page:confluence');
assert.deepEqual(
  ATLASSIAN_ROVO_PROVIDER_CAPABILITIES
    .filter((capability) => capability.status === 'implemented' && capability.access === 'write' && !capability.destructive)
    .map((capability) => capability.localTool),
  [],
  'every state-changing provider operation is marked destructive',
);
assert.deepEqual(
  ATLASSIAN_ROVO_PROVIDER_CAPABILITIES
    .filter((capability) => capability.status === 'implemented' && capability.access === 'write' && capability.idempotent)
    .map((capability) => capability.localTool),
  ['bitbucket_approve_pull_request', 'bitbucket_delete_environment'],
  'only verified retry-safe provider mutations are marked idempotent',
);
assert.equal(tools.bitbucket_create_commit.annotations.destructiveHint, true, 'commit creation is explicitly destructive');
assert.equal(tools.bitbucket_update_environment.annotations.destructiveHint, true, 'environment update is explicitly destructive');
assert.equal(
  tools.bitbucket_create_commit.inputSchema.safeParse({
    workspace: 'devdoo-teams',
    repository: 'teams-app',
    files: [{ path: 'README.md', content: 'hello' }],
    message: 'Create README',
  }).success,
  true,
  'commit creation accepts bounded URL-encoded text files',
);
assert.equal(
  tools.bitbucket_commits_for_revision.inputSchema.safeParse({
    workspace: 'devdoo-teams',
    repository: 'teams-app',
    revision: 'main',
    path: '../secret.txt',
  }).success,
  false,
  'revision commit history rejects traversal paths before provider access',
);
assert.equal(
  tools.bitbucket_file_history.inputSchema.safeParse({
    workspace: 'devdoo-teams',
    repository: 'teams-app',
    commit: 'main',
    path: ' ',
  }).success,
  false,
  'file history rejects empty paths before provider access',
);
assert.equal(
  tools.bitbucket_get_files.inputSchema.safeParse({
    workspace: 'devdoo-teams',
    repository: 'teams-app',
    commit: 'main',
    path: 'src/../secret.txt',
  }).success,
  false,
  'file reads reject traversal paths before provider access',
);
assert.equal(
  tools.bitbucket_create_commit.inputSchema.safeParse({
    workspace: 'devdoo-teams',
    repository: 'teams-app',
    files: [{ path: 'src\\..\\secret.txt', content: 'unsafe' }],
  }).success,
  false,
  'commit file paths reject backslash traversal before provider access',
);
assert.equal(
  tools.bitbucket_create_commit.inputSchema.safeParse({
    workspace: 'devdoo-teams',
    repository: 'teams-app',
    deleteFiles: ['%2e%2e/secret.txt'],
  }).success,
  false,
  'commit delete paths reject encoded dot segments before provider access',
);
assert.equal(
  tools.bitbucket_file_history.inputSchema.safeParse({
    workspace: 'devdoo-teams',
    repository: 'teams-app',
    commit: 'main',
    path: 'src/has\u0000nul.ts',
  }).success,
  false,
  'file history rejects control-character paths before provider access',
);
assert.equal(
  tools.bitbucket_file_history.inputSchema.safeParse({
    workspace: 'devdoo-teams',
    repository: 'teams-app',
    commit: 'main',
    path: 'src/index.ts',
    q: 'unsafe\u0000query',
  }).success,
  false,
  'file history rejects unsafe query values before provider access',
);
assert.equal(
  tools.bitbucket_source_root.inputSchema.safeParse({
    workspace: 'devdoo-teams',
    repository: 'teams-app',
    commit: 'main',
    format: 'unsupported',
  }).success,
  false,
  'source root permits only the documented format values',
);
assert.equal(
  tools.bitbucket_source_root.inputSchema.safeParse({
    workspace: 'devdoo-teams',
    repository: 'teams-app',
    commit: 'main',
    page: 2,
  }).success,
  false,
  'source root rejects unsupported pagination instead of accepting and discarding it',
);
assert.equal(
  tools.bitbucket_workspace_permissions.inputSchema.safeParse({
    workspace: 'devdoo-teams',
    q: 'permission=\u0000"owner"',
  }).success,
  false,
  'workspace permission filters reject control characters before provider access',
);
for (const capability of ATLASSIAN_ROVO_PROVIDER_CAPABILITIES.filter((entry) => entry.status === 'implemented')) {
  const registered = tools[capability.localTool!];
  assert.equal(registered.annotations.readOnlyHint, capability.access !== 'write', `${capability.localTool} read semantics match inventory`);
  assert.equal(registered.annotations.destructiveHint, capability.destructive, `${capability.localTool} destructive semantics match inventory`);
  assert.equal(registered.annotations.idempotentHint, capability.idempotent, `${capability.localTool} idempotency matches inventory`);
  assert.deepEqual(registered._meta.requiredProviderScopes, capability.requiredScopes, `${capability.localTool} carries complete required scope metadata`);
}
assert.equal(
  tools.jira_add_worklog.inputSchema.safeParse({ issueIdOrKey: 'MP-1', timeSpentSeconds: 0 }).success,
  false,
  'typed worklog schema rejects a zero-duration write before provider access',
);
assert.equal(
  tools.jira_add_comment.inputSchema.safeParse({
    issueIdOrKey: 'MP-1',
    body: { type: 'doc', version: 1, content: [{ type: 'text', text: 'é'.repeat(33_000) }] },
  }).success,
  false,
  'Jira write schemas enforce the transport byte bound for multibyte ADF content',
);
assert.equal(
  tools.bitbucket_add_pull_request_comment.inputSchema.safeParse({
    workspace: 'devdoo-teams',
    repository: 'teams-app',
    pullRequestId: 17,
    content: { raw: 'é'.repeat(33_000) },
  }).success,
  false,
  'Bitbucket write schemas enforce the transport byte bound for multibyte content',
);
assert.equal(
  tools.bitbucket_update_repository_user_permission.inputSchema.safeParse({
    workspace: 'devdoo-teams',
    repository: 'teams-app',
    selectedUser: '557058:user-id',
    permission: 'read',
    unexpected: true,
  }).success,
  false,
  'provider tool inputs reject unknown top-level fields instead of silently discarding them',
);
assert.equal(
  tools.jira_create_issue_link.inputSchema.safeParse({
    inwardIssue: { key: 'MP-2' },
    outwardIssue: { key: 'MP-1' },
  }).success,
  false,
  'issue-link creation requires an explicit Jira link type before provider access',
);
assert.equal(
  tools.jira_create_or_update_remote_issue_link.inputSchema.safeParse({
    issueIdOrKey: 'MP-1',
    object: {},
    globalId: 'x'.repeat(4_001),
  }).success,
  false,
  'remote-link mutations reject oversized identifiers before provider access',
);
assert.equal(
  tools.confluence_create_inline_comment.inputSchema.safeParse({
    pageId: '123',
    body: { representation: 'storage', value: 'review' },
  }).success,
  false,
  'typed inline-comment schema requires a text selection for top-level comments',
);
assert.equal(
  tools.bitbucket_update_pull_request.inputSchema.safeParse({
    workspace: 'devdoo-teams',
    repository: 'teams-app',
    pullRequestId: 17,
  }).success,
  false,
  'pull-request update requires at least one mutable field',
);
assert.equal(
  tools.bitbucket_pull_request_diffstat.inputSchema.safeParse({
    workspace: 'devdoo-teams',
    repository: 'teams-app',
    pullRequestId: 0,
  }).success,
  false,
  'pull-request diffstat rejects a non-positive pull request ID before provider access',
);
assert.equal(
  tools.bitbucket_pull_request_activity.inputSchema.safeParse({
    workspace: 'devdoo-teams',
    repository: 'teams-app',
    pullRequestId: 17,
    page: 2,
    pagelen: 25,
  }).success,
  true,
  'pull-request activity accepts bounded pagination',
);
assert.equal(
  tools.bitbucket_pull_request_activity.inputSchema.safeParse({
    workspace: 'devdoo-teams',
    repository: 'teams-app',
    pullRequestId: 0,
  }).success,
  false,
  'pull-request activity rejects a non-positive pull request ID before provider access',
);
assert.equal(
  tools.bitbucket_update_repository_user_permission.inputSchema.safeParse({
    workspace: 'devdoo-teams',
    repository: 'teams-app',
    selectedUser: '557058:user-id',
    permission: 'none',
  }).success,
  false,
  'repository user permission updates reject the unsupported none value before provider access',
);
assert.equal(
  tools.bitbucket_update_repository_group_permission.inputSchema.safeParse({
    workspace: 'devdoo-teams',
    repository: 'teams-app',
    groupSlug: 'developers',
    permission: 'x'.repeat(513),
  }).success,
  false,
  'repository group permission updates reject oversized permission values before provider access',
);
assert.equal(
  tools.confluence_update_inline_comment.inputSchema.safeParse({
    commentId: '42',
    version: { number: 2 },
  }).success,
  false,
  'inline-comment update requires body or resolved state',
);
assert.equal(
  tools.confluence_delete_page.inputSchema.safeParse({ pageId: '123', purge: 'true' }).success,
  false,
  'page deletion validates draft and purge flags as booleans',
);

const bitbucketResult = await tools.bitbucket_workspaces.handler({ pagelen: 2 });
assert.equal(bitbucketResult.isError, undefined, 'authenticated provider read succeeds');
assert.equal(requests[0]?.url, 'https://api.bitbucket.org/2.0/workspaces?pagelen=2', 'Bitbucket request keeps the v2 API prefix');
assert.equal(requests[0]?.authorization, 'Bearer bb-secret-token', 'credential resolver is the only auth source');
assert.equal(JSON.stringify(bitbucketResult).includes('bb-secret-token'), false, 'credential is absent from the result');
assert.equal(JSON.stringify(bitbucketResult).includes('secret-from-provider'), false, 'provider response credential-shaped values are redacted');

const commitResult = await tools.bitbucket_create_commit.handler({
  workspace: 'devdoo-teams',
  repository: 'teams-app',
  files: [{ path: 'README.md', content: 'hello' }],
  message: 'Create README',
});
assert.equal(commitResult.isError, undefined, 'authenticated Bitbucket commit creation succeeds');
assert.equal(requests[1]?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/src', 'commit creation uses the documented source endpoint');
assert.equal(requests[1]?.body, '%2FREADME.md=hello&message=Create+README', 'commit creation uses bounded form encoding');
assert.equal(requests[1]?.authorization, 'Bearer bb-secret-token', 'commit creation uses the credential resolver');

const updateEnvironmentResult = await tools.bitbucket_update_environment.handler({
  workspace: 'devdoo-teams',
  repository: 'teams-app',
  environmentUuid: '{environment-uuid}',
});
assert.equal(updateEnvironmentResult.isError, undefined, 'authenticated Bitbucket environment update succeeds');
assert.equal(requests[2]?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/environments/%7Benvironment-uuid%7D/changes', 'environment update uses the documented changes endpoint');
assert.equal(requests[2]?.body, undefined, 'environment update sends no speculative request body');

const editResult = await tools.jira_edit_issue.handler({
  issueIdOrKey: 'MP-1',
  fields: { summary: 'updated' },
  idempotencyKey: 'mcp-test:provider-body',
});
assert.equal(editResult.isError, undefined, 'authenticated provider write succeeds');
assert.equal(requests[3]?.url, 'https://devdoo.atlassian.net/rest/api/3/issue/MP-1', 'Jira edit uses the expected API path');
assert.equal(requests[3]?.body?.includes('issueIdOrKey'), false, 'Jira issue key is not sent as an unexpected body field');
assert.equal(requests[3]?.body?.includes('idempotencyKey'), false, 'Jira idempotency key is not sent as a provider body field');

const issueLinkResult = await tools.jira_create_issue_link.handler({
  inwardIssue: { key: 'MP/2' },
  outwardIssue: { key: 'MP-1' },
  type: { name: 'Blocks' },
});
assert.equal(issueLinkResult.isError, undefined, 'Jira issue-link creation succeeds through the optional provider path');
assert.equal(requests[4]?.url, 'https://devdoo.atlassian.net/rest/api/3/issueLink', 'Jira issue-link creation uses the official API path');
assert.deepEqual(JSON.parse(requests[4]?.body ?? '{}'), {
  inwardIssue: { key: 'MP/2' },
  outwardIssue: { key: 'MP-1' },
  type: { name: 'Blocks' },
}, 'Jira issue-link tool forwards only the documented payload');

const remoteLinkResult = await tools.jira_create_or_update_remote_issue_link.handler({
  issueIdOrKey: 'MP/1',
  globalId: 'system=https://tracker.example.test&id=22',
  object: { url: 'https://tracker.example.test/22', title: 'Tracker 22' },
});
assert.equal(remoteLinkResult.isError, undefined, 'Jira remote-link upsert succeeds through the optional provider path');
assert.equal(requests[5]?.url, 'https://devdoo.atlassian.net/rest/api/3/issue/MP%2F1/remotelink', 'Jira remote-link upsert encodes the issue identifier');
assert.equal(requests[5]?.body?.includes('issueIdOrKey'), false, 'Jira remote-link issue identifier is excluded from the provider payload');

const remoteLinkUpdate = await tools.jira_update_remote_issue_link.handler({
  issueIdOrKey: 'MP/1',
  linkId: '100/2',
  object: { url: 'https://tracker.example.test/22', title: 'Tracker 22' },
});
assert.equal(remoteLinkUpdate.isError, undefined, 'Jira remote-link update succeeds through the optional provider path');
assert.equal(requests[6]?.url, 'https://devdoo.atlassian.net/rest/api/3/issue/MP%2F1/remotelink/100%2F2', 'Jira remote-link update encodes both path identifiers');
assert.equal(requests[6]?.body?.includes('linkId'), false, 'Jira remote-link update excludes path identifiers from the provider payload');

const remoteLinkDelete = await tools.jira_delete_remote_issue_link_by_global_id.handler({
  issueIdOrKey: 'MP/1',
  globalId: 'system=https://tracker.example.test&id=22',
});
assert.equal(remoteLinkDelete.isError, undefined, 'Jira remote-link global-ID deletion succeeds through the optional provider path');
assert.equal(requests[7]?.url, 'https://devdoo.atlassian.net/rest/api/3/issue/MP%2F1/remotelink?globalId=system%3Dhttps%3A%2F%2Ftracker.example.test%26id%3D22', 'Jira remote-link global IDs are query encoded');
assert.equal(requests[7]?.body, undefined, 'Jira remote-link deletion has no speculative body');

const branchesResult = await tools.bitbucket_branches.handler({
  workspace: 'devdoo-teams',
  repository: 'teams-app',
  pagelen: 3,
  q: 'name ~ "feature"',
  sort: '-target.date',
});
assert.equal(branchesResult.isError, undefined, 'Bitbucket branch listing succeeds through the optional provider path');
assert.equal(requests[8]?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/refs/branches?pagelen=3&q=name+%7E+%22feature%22&sort=-target.date', 'Bitbucket branch listing forwards bounded query parameters');

const updatePullRequestResult = await tools.bitbucket_update_pull_request.handler({
  workspace: 'devdoo-teams',
  repository: 'teams-app',
  pullRequestId: 17,
  title: 'Updated title',
  description: 'Updated description',
  destination: { branch: { name: 'main' } },
  idempotencyKey: 'mcp-test:provider-body',
});
assert.equal(updatePullRequestResult.isError, undefined, 'Bitbucket pull-request update succeeds through the optional provider path');
assert.equal(requests[9]?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/pullrequests/17', 'Bitbucket pull-request update uses the documented resource endpoint');
assert.deepEqual(JSON.parse(requests[9]?.body ?? '{}'), {
  title: 'Updated title',
  description: 'Updated description',
  destination: { branch: { name: 'main' } },
}, 'Bitbucket pull-request update excludes routing identifiers from the provider body');

const declinePullRequestResult = await tools.bitbucket_decline_pull_request.handler({
  workspace: 'devdoo-teams',
  repository: 'teams-app',
  pullRequestId: 17,
});
assert.equal(declinePullRequestResult.isError, undefined, 'Bitbucket pull-request decline succeeds through the optional provider path');
assert.equal(requests[10]?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/pullrequests/17/decline', 'Bitbucket pull-request decline uses the documented endpoint');
assert.equal(requests[10]?.body, undefined, 'Bitbucket pull-request decline sends no speculative body');

const unapprovePullRequestResult = await tools.bitbucket_unapprove_pull_request.handler({
  workspace: 'devdoo-teams',
  repository: 'teams-app',
  pullRequestId: 17,
});
assert.equal(unapprovePullRequestResult.isError, undefined, 'Bitbucket pull-request unapproval succeeds through the optional provider path');
assert.equal(requests[11]?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/pullrequests/17/approve', 'Bitbucket pull-request unapproval uses the documented approval endpoint');
assert.equal(requests[11]?.body, undefined, 'Bitbucket pull-request unapproval sends no speculative body');

const deleteBranchResult = await tools.bitbucket_delete_branch.handler({
  workspace: 'devdoo-teams',
  repository: 'teams-app',
  name: 'feature/parity',
});
assert.equal(deleteBranchResult.isError, undefined, 'Bitbucket branch deletion succeeds through the optional provider path');
assert.equal(requests[12]?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/refs/branches/feature%2Fparity', 'Bitbucket branch deletion uses the documented endpoint and encodes the branch name');
assert.equal(requests[12]?.body, undefined, 'Bitbucket branch deletion sends no speculative body');

const footerCommentResult = await tools.confluence_get_footer_comment.handler({
  commentId: '42',
  bodyFormat: 'storage',
  version: 3,
  includeOperations: true,
});
assert.equal(footerCommentResult.isError, undefined, 'Confluence footer-comment read succeeds through the optional provider path');
assert.equal(requests[13]?.url, 'https://devdoo.atlassian.net/wiki/api/v2/footer-comments/42?body-format=storage&version=3&include-operations=true', 'Confluence footer-comment read forwards documented query options');

const updateFooterCommentResult = await tools.confluence_update_footer_comment.handler({
  commentId: '42',
  version: { number: 4, message: 'edit' },
  body: { representation: 'storage', value: 'Updated footer' },
});
assert.equal(updateFooterCommentResult.isError, undefined, 'Confluence footer-comment update succeeds through the optional provider path');
assert.equal(requests[14]?.url, 'https://devdoo.atlassian.net/wiki/api/v2/footer-comments/42', 'Confluence footer-comment update uses the documented resource endpoint');
assert.deepEqual(JSON.parse(requests[14]?.body ?? '{}'), {
  version: { number: 4, message: 'edit' },
  body: { representation: 'storage', value: 'Updated footer' },
}, 'Confluence footer-comment update excludes the comment ID from the body');

const deleteFooterCommentResult = await tools.confluence_delete_footer_comment.handler({ commentId: '42' });
assert.equal(deleteFooterCommentResult.isError, undefined, 'Confluence footer-comment deletion succeeds through the optional provider path');
assert.equal(requests[15]?.url, 'https://devdoo.atlassian.net/wiki/api/v2/footer-comments/42', 'Confluence footer-comment deletion uses the documented endpoint');
assert.equal(requests[15]?.body, undefined, 'Confluence footer-comment deletion sends no speculative body');

const inlineCommentResult = await tools.confluence_get_inline_comment.handler({ commentId: '43', includeProperties: true });
assert.equal(inlineCommentResult.isError, undefined, 'Confluence inline-comment read succeeds through the optional provider path');
assert.equal(requests[16]?.url, 'https://devdoo.atlassian.net/wiki/api/v2/inline-comments/43?include-properties=true', 'Confluence inline-comment read uses the documented resource endpoint');

const updateInlineCommentResult = await tools.confluence_update_inline_comment.handler({
  commentId: '43',
  version: { number: 5 },
  resolved: true,
});
assert.equal(updateInlineCommentResult.isError, undefined, 'Confluence inline-comment update succeeds through the optional provider path');
assert.equal(requests[17]?.url, 'https://devdoo.atlassian.net/wiki/api/v2/inline-comments/43', 'Confluence inline-comment update uses the documented resource endpoint');
assert.deepEqual(JSON.parse(requests[17]?.body ?? '{}'), {
  version: { number: 5 },
  resolved: true,
}, 'Confluence inline-comment update excludes the comment ID from the body');

const deleteInlineCommentResult = await tools.confluence_delete_inline_comment.handler({ commentId: '43' });
assert.equal(deleteInlineCommentResult.isError, undefined, 'Confluence inline-comment deletion succeeds through the optional provider path');
assert.equal(requests[18]?.url, 'https://devdoo.atlassian.net/wiki/api/v2/inline-comments/43', 'Confluence inline-comment deletion uses the documented endpoint');
assert.equal(requests[18]?.body, undefined, 'Confluence inline-comment deletion sends no speculative body');

const invalidDeletePageResult = await tools.confluence_delete_page.handler({ pageId: '123', draft: true, purge: true });
assert.equal(invalidDeletePageResult.isError, true, 'Confluence page deletion rejects draft and purge together before provider access');
assert.equal(requests.length, 19, 'invalid Confluence page deletion does not issue a provider request');

const deletePageResult = await tools.confluence_delete_page.handler({ pageId: '123', purge: true });
assert.equal(deletePageResult.isError, undefined, 'Confluence page deletion succeeds through the optional provider path');
assert.equal(requests[19]?.url, 'https://devdoo.atlassian.net/wiki/api/v2/pages/123?purge=true', 'Confluence page deletion forwards the documented purge flag');
assert.equal(requests[19]?.body, undefined, 'Confluence page deletion sends no speculative body');

const userPermissionList = await tools.bitbucket_repository_user_permissions.handler({ workspace: 'devdoo-teams', repository: 'teams-app', pagelen: 10 });
assert.equal(userPermissionList.isError, undefined, 'repository user permission list succeeds through the optional provider path');
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/permissions-config/users?pagelen=10', 'repository user permission list uses the Cloud v2 endpoint');
assert.equal(requests.at(-1)?.method, 'GET', 'repository user permission list uses GET');
assert.equal(requests.at(-1)?.body, undefined, 'repository user permission list sends no body');
const userPermissionGet = await tools.bitbucket_get_repository_user_permission.handler({ workspace: 'devdoo-teams', repository: 'teams-app', selectedUser: '557058:user/id' });
assert.equal(userPermissionGet.isError, undefined, 'repository user permission get succeeds through the optional provider path');
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/permissions-config/users/557058%3Auser%2Fid', 'repository user permission get encodes the selected user identifier');
assert.equal(requests.at(-1)?.method, 'GET', 'repository user permission get uses GET');
assert.equal(requests.at(-1)?.body, undefined, 'repository user permission get sends no body');
const userPermissionUpdate = await tools.bitbucket_update_repository_user_permission.handler({ workspace: 'devdoo-teams', repository: 'teams-app', selectedUser: '557058:user/id', permission: 'write' });
assert.equal(userPermissionUpdate.isError, undefined, 'repository user permission update succeeds through the optional provider path');
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/permissions-config/users/557058%3Auser%2Fid', 'repository user permission update encodes the selected user identifier');
assert.equal(requests.at(-1)?.method, 'PUT', 'repository user permission update uses PUT');
assert.equal(requests.at(-1)?.body, JSON.stringify({ permission: 'write' }), 'repository user permission update forwards only the documented permission body');
const userPermissionDelete = await tools.bitbucket_delete_repository_user_permission.handler({ workspace: 'devdoo-teams', repository: 'teams-app', selectedUser: '557058:user/id' });
assert.equal(userPermissionDelete.isError, undefined, 'repository user permission deletion succeeds through the optional provider path');
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/permissions-config/users/557058%3Auser%2Fid', 'repository user permission deletion encodes the selected user identifier');
assert.equal(requests.at(-1)?.method, 'DELETE', 'repository user permission deletion uses DELETE');
assert.equal(requests.at(-1)?.body, undefined, 'repository user permission deletion sends no speculative body');
const groupPermissionList = await tools.bitbucket_repository_group_permissions.handler({ workspace: 'devdoo-teams', repository: 'teams-app', page: 2 });
assert.equal(groupPermissionList.isError, undefined, 'repository group permission list succeeds through the optional provider path');
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/permissions-config/groups?page=2', 'repository group permission list uses the Cloud v2 endpoint');
assert.equal(requests.at(-1)?.method, 'GET', 'repository group permission list uses GET');
assert.equal(requests.at(-1)?.body, undefined, 'repository group permission list sends no body');
const groupPermissionGet = await tools.bitbucket_get_repository_group_permission.handler({ workspace: 'devdoo-teams', repository: 'teams-app', groupSlug: 'release/group' });
assert.equal(groupPermissionGet.isError, undefined, 'repository group permission get succeeds through the optional provider path');
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/permissions-config/groups/release%2Fgroup', 'repository group permission get encodes the group slug');
assert.equal(requests.at(-1)?.method, 'GET', 'repository group permission get uses GET');
assert.equal(requests.at(-1)?.body, undefined, 'repository group permission get sends no body');
const groupPermissionUpdate = await tools.bitbucket_update_repository_group_permission.handler({ workspace: 'devdoo-teams', repository: 'teams-app', groupSlug: 'release/group', permission: 'admin' });
assert.equal(groupPermissionUpdate.isError, undefined, 'repository group permission update succeeds through the optional provider path');
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/permissions-config/groups/release%2Fgroup', 'repository group permission update encodes the group slug');
assert.equal(requests.at(-1)?.method, 'PUT', 'repository group permission update uses PUT');
assert.equal(requests.at(-1)?.body, JSON.stringify({ permission: 'admin' }), 'repository group permission update forwards only the documented permission body');
const groupPermissionDelete = await tools.bitbucket_delete_repository_group_permission.handler({ workspace: 'devdoo-teams', repository: 'teams-app', groupSlug: 'release/group' });
assert.equal(groupPermissionDelete.isError, undefined, 'repository group permission deletion succeeds through the optional provider path');
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/permissions-config/groups/release%2Fgroup', 'repository group permission deletion encodes the group slug');
assert.equal(requests.at(-1)?.method, 'DELETE', 'repository group permission deletion uses DELETE');
assert.equal(requests.at(-1)?.body, undefined, 'repository group permission deletion sends no speculative body');

const commitsForRevisionResult = await tools.bitbucket_commits_for_revision.handler({
  workspace: 'devdoo-teams',
  repository: 'teams-app',
  revision: 'feature/parity',
  page: 2,
  pagelen: 25,
  path: 'src/server',
  include: ['main', 'release/1'],
  exclude: ['legacy'],
});
assert.equal(commitsForRevisionResult.isError, undefined, 'revision commit history succeeds through the optional provider path');
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/commits/feature%2Fparity?page=2&pagelen=25&path=src%2Fserver&include=main&include=release%2F1&exclude=legacy', 'revision commit history uses the official GET route and query contract');
assert.equal(requests.at(-1)?.method, 'GET', 'revision commit history uses GET');
assert.equal(requests.at(-1)?.body, undefined, 'revision commit history has no request body');

const fileHistoryResult = await tools.bitbucket_file_history.handler({
  workspace: 'devdoo-teams',
  repository: 'teams-app',
  commit: 'abc123',
  path: 'src/server/index.ts',
  renames: true,
  q: 'author.raw = "Ada"',
  sort: '-date',
});
assert.equal(fileHistoryResult.isError, undefined, 'file history succeeds through the optional provider path');
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/filehistory/abc123/src%2Fserver%2Findex.ts?renames=true&q=author.raw+%3D+%22Ada%22&sort=-date', 'file history uses the official GET route and query contract');
assert.equal(requests.at(-1)?.method, 'GET', 'file history uses GET');
assert.equal(requests.at(-1)?.body, undefined, 'file history has no request body');

const sourceRootResult = await tools.bitbucket_source_root.handler({
  workspace: 'devdoo-teams',
  repository: 'teams-app',
  commit: 'main',
  format: 'meta',
});
assert.equal(sourceRootResult.isError, undefined, 'source root listing succeeds through the optional provider path');
assert.equal(requests.at(-1)?.url, 'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/src/main/?format=meta', 'source root uses the official trailing-slash GET route');
assert.equal(requests.at(-1)?.method, 'GET', 'source root uses GET');
assert.equal(requests.at(-1)?.body, undefined, 'source root has no request body');

const workspacePermissionList = await tools.bitbucket_workspace_permissions.handler({
  workspace: 'devdoo-teams',
  page: 2,
  pagelen: 10,
  q: 'permission="owner"',
});
assert.equal(workspacePermissionList.isError, undefined, 'workspace permission listing succeeds through the optional provider path');
assert.equal(
  requests.at(-1)?.url,
  'https://api.bitbucket.org/2.0/workspaces/devdoo-teams/permissions?page=2&pagelen=10&q=permission%3D%22owner%22',
  'workspace permission listing uses the documented Cloud v2 endpoint and bounded filter',
);
assert.equal(requests.at(-1)?.method, 'GET');
assert.equal(requests.at(-1)?.body, undefined);

const oversizedBitbucketPayload = JSON.stringify({
  values: [{
    link: 'https://example.test/?api_key=provider-secret-for-structured-output',
    content: 'x'.repeat(60_000),
  }],
});
const oversizedBitbucketFetch: typeof fetch = async () => new Response(oversizedBitbucketPayload, {
  status: 200,
  headers: { 'content-type': 'application/json' },
});
const boundedBitbucketServer = serverWithRegistry(() => 'bb-secret-token', oversizedBitbucketFetch);
const boundedBitbucketTools = registeredTools(boundedBitbucketServer);
const boundedFileHistoryResult = await boundedBitbucketTools.bitbucket_file_history.handler({
  workspace: 'devdoo-teams',
  repository: 'teams-app',
  commit: 'main',
  path: 'src/index.ts',
});
assert.equal(boundedFileHistoryResult.isError, undefined, 'Bitbucket read output boundary returns a successful file-history result');
const boundedStructuredData = boundedFileHistoryResult.structuredContent?.data as { truncated?: boolean; preview?: string };
assert.equal(boundedStructuredData.truncated, true, 'Bitbucket file-history structuredContent is marked truncated for oversized provider data');
assert.equal(boundedStructuredData.preview?.length, 48_000, 'Bitbucket file-history structuredContent preview is bounded to 48,000 characters');
assert.equal(JSON.stringify(boundedFileHistoryResult.structuredContent).includes('provider-secret-for-structured-output'), false, 'Bitbucket file-history structuredContent redacts credential-shaped provider URLs');
assert.equal(JSON.stringify(boundedFileHistoryResult.structuredContent).includes('x'.repeat(60_000)), false, 'Bitbucket file-history structuredContent does not expose the raw oversized provider payload');
const boundedTextData = JSON.parse(boundedFileHistoryResult.content[0]?.text ?? '{}').data;
assert.deepEqual(boundedTextData, boundedStructuredData, 'Bitbucket file-history text and structuredContent share the same sanitized output representation');

const unicodeOutputPayload = JSON.stringify({ values: [{ content: 'é'.repeat(47_000) }] });
const unicodeOutputServer = serverWithRegistry(() => 'bb-secret-token', async () => new Response(unicodeOutputPayload, {
  status: 200,
  headers: { 'content-type': 'application/json' },
}));
const unicodeOutputResult = await registeredTools(unicodeOutputServer).bitbucket_file_history.handler({
  workspace: 'devdoo-teams',
  repository: 'teams-app',
  commit: 'main',
  path: 'src/index.ts',
});
assert.equal(unicodeOutputResult.isError, undefined, 'multibyte provider output remains a successful bounded read');
const unicodeOutputData = unicodeOutputResult.structuredContent?.data as { truncated?: boolean; preview?: string };
assert.equal(unicodeOutputData.truncated, true, 'multibyte provider output is truncated by the byte boundary');
assert.ok(new TextEncoder().encode(unicodeOutputData.preview ?? '').byteLength <= 48_000, 'multibyte output previews stay within the byte boundary');

const unauthenticated = serverWithRegistry(() => undefined, fetchImpl);
const unauthenticatedResult = await registeredTools(unauthenticated).jira_search_jql.handler({ jql: 'project = MP' });
assert.equal(unauthenticatedResult.isError, true, 'missing provider credential fails closed');
assert.equal(unauthenticatedResult.structuredContent?.error?.code, 'credentials-unavailable', 'missing credential has a stable safe error');
const unauthenticatedRequestCount = requests.length;
const unauthenticatedBitbucketResult = await registeredTools(unauthenticated).bitbucket_update_repository_user_permission.handler({
  workspace: 'devdoo-teams',
  repository: 'teams-app',
  selectedUser: '557058:user-id',
  permission: 'read',
});
assert.equal(unauthenticatedBitbucketResult.isError, true, 'missing Bitbucket credentials fail closed for repository permission mutations');
assert.equal(unauthenticatedBitbucketResult.structuredContent?.error?.code, 'credentials-unavailable', 'missing Bitbucket permission credentials have a stable safe error');
assert.equal(requests.length, unauthenticatedRequestCount, 'missing Bitbucket permission credentials prevent network access');
const unauthenticatedReadRequestCount = requests.length;
const unauthenticatedBitbucketRead = await registeredTools(unauthenticated).bitbucket_file_history.handler({
  workspace: 'devdoo-teams',
  repository: 'teams-app',
  commit: 'main',
  path: 'src/index.ts',
});
assert.equal(unauthenticatedBitbucketRead.isError, true, 'missing Bitbucket credentials fail closed for file history reads');
assert.equal(unauthenticatedBitbucketRead.structuredContent?.error?.code, 'credentials-unavailable', 'missing Bitbucket read credentials have a stable safe error');
assert.equal(requests.length, unauthenticatedReadRequestCount, 'missing Bitbucket read credentials prevent network access');

const mutationAuthorizationServer = new McpServer({ name: 'mutation-authorization-test', version: '1.0.0' });
createMcpProviderToolRegistry({
  principal: { tenantId: 'tenant-1', requesterId: 'requester-1' },
  allowMutations: () => false,
  resolveCredential: () => 'server-side-token',
  atlassianSiteUrl: 'https://devdoo.atlassian.net',
  fetchImpl,
}).register(mutationAuthorizationServer);
const mutationAuthorizationRequestCount = requests.length;
const mutationAuthorizationResult = await registeredTools(mutationAuthorizationServer).jira_create_issue.handler({
  fields: { project: { key: 'MP' }, summary: 'must be denied' },
  idempotencyKey: 'mcp-test:authorization-denied',
});
assert.equal(mutationAuthorizationResult.isError, true, 'non-operator provider mutations fail closed');
assert.equal(mutationAuthorizationResult.structuredContent?.error?.code, 'MUTATION_NOT_AUTHORIZED', 'mutation denial exposes a deterministic authorization code');
assert.equal(requests.length, mutationAuthorizationRequestCount, 'non-operator mutation is rejected before provider access');

const brokerRequests: Array<{ authorization: string | null }> = [];
const providerBroker = createPrincipalScopedProviderHttpBroker({
  principal: { tenantId: 'tenant-1', requesterId: 'requester-1' },
  resolveCredential: () => 'broker-secret-token',
  allowedOrigins: {
    atlassian: ['https://devdoo.atlassian.net'],
    bitbucket: ['https://api.bitbucket.org'],
  },
  fetchImpl: async (input, init) => {
    brokerRequests.push({ authorization: new Headers(init?.headers).get('authorization') });
    return new Response(JSON.stringify({ values: [{ id: 'broker-result' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  },
});
assert.throws(
  () => createMcpProviderToolRegistry({
    principal: { tenantId: 'tenant-1', requesterId: 'requester-1' },
    providerBroker,
    resolveCredential: () => 'legacy-token',
    atlassianSiteUrl: 'https://devdoo.atlassian.net',
  }),
  /mutually exclusive/,
  'broker and legacy credential resolver cannot be configured together',
);
assert.throws(
  () => createMcpProviderToolRegistry({
    principal: { tenantId: 'tenant-1', requesterId: 'requester-2' },
    providerBroker,
    atlassianSiteUrl: 'https://devdoo.atlassian.net',
  }),
  /principal/,
  'provider tool registry rejects a broker bound to a different principal',
);
const brokerServer = new McpServer({ name: 'provider-broker-test', version: '1.0.0' });
createMcpProviderToolRegistry({
  principal: { tenantId: 'tenant-1', requesterId: 'requester-1' },
  providerBroker,
  atlassianSiteUrl: 'https://devdoo.atlassian.net',
}).register(brokerServer);
const brokerResult = await registeredTools(brokerServer).jira_search_jql.handler({ jql: 'project = MP' });
assert.equal(brokerResult.isError, undefined, 'provider tool registry uses the principal-scoped broker path');
assert.equal(brokerRequests[0]?.authorization, 'Bearer broker-secret-token', 'broker owns credential injection outside the provider tool registry');
assert.equal(JSON.stringify(brokerResult).includes('broker-secret-token'), false, 'broker credentials never cross the tool result boundary');

const rawFileBroker = createPrincipalScopedProviderHttpBroker({
  principal: { tenantId: 'tenant-1', requesterId: 'requester-1' },
  resolveCredential: () => 'broker-secret-token',
  allowedOrigins: {
    atlassian: ['https://devdoo.atlassian.net'],
    bitbucket: ['https://api.bitbucket.org'],
  },
  fetchImpl: async () => new Response('export const answer = 42;\n', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  }),
});
const rawFileServer = new McpServer({ name: 'raw-file-provider-broker-test', version: '1.0.0' });
createMcpProviderToolRegistry({
  principal: { tenantId: 'tenant-1', requesterId: 'requester-1' },
  providerBroker: rawFileBroker,
  atlassianSiteUrl: 'https://devdoo.atlassian.net',
}).register(rawFileServer);
const rawFileResult = await registeredTools(rawFileServer).bitbucket_get_files.handler({
  workspace: 'devdoo-teams',
  repository: 'teams-app',
  commit: 'main',
  path: 'src/index.ts',
});
assert.equal(rawFileResult.isError, undefined, 'Bitbucket raw file reads succeed through the broker-backed provider tool');
assert.equal(
  rawFileResult.structuredContent?.data,
  'export const answer = 42;\n',
  'Bitbucket raw file content is not parsed as JSON after crossing the provider tool broker',
);

assert.throws(
  () => createMcpProviderToolRegistry({
    principal: { tenantId: ' ', requesterId: 'requester-1' },
    resolveCredential: () => 'secret',
    atlassianSiteUrl: 'https://devdoo.atlassian.net',
  }),
  /validated provider principal is required/,
  'blank principals are rejected before tool registration',
);

const jiraWorklogListResult = await tools.jira_get_issue_worklogs.handler({
  issueIdOrKey: 'MP/1',
  startAt: 10,
  maxResults: 25,
  startedAfter: 1_700_000_000_000,
  expand: 'properties',
});
assert.equal(jiraWorklogListResult.isError, undefined, 'Jira worklog listing succeeds through the optional provider path');
assert.equal(
  requests.at(-1)?.url,
  'https://devdoo.atlassian.net/rest/api/3/issue/MP%2F1/worklog?startAt=10&maxResults=25&startedAfter=1700000000000&expand=properties',
  'Jira worklog listing uses the documented endpoint and bounded query contract',
);
const jiraChangelogResult = await tools.jira_get_issue_changelogs.handler({
  issueIdOrKey: 'MP/1',
  startAt: 2,
  maxResults: 50,
});
assert.equal(jiraChangelogResult.isError, undefined, 'Jira changelog listing succeeds through the optional provider path');
assert.equal(
  requests.at(-1)?.url,
  'https://devdoo.atlassian.net/rest/api/3/issue/MP%2F1/changelog?startAt=2&maxResults=50',
  'Jira changelog listing uses the documented endpoint and bounded pagination contract',
);
assert.equal(requests.at(-1)?.method, 'GET');
const jiraWorklogEditResult = await tools.jira_edit_worklog.handler({
  issueIdOrKey: 'MP/1',
  worklogId: '100/2',
  timeSpentSeconds: 600,
  notifyUsers: false,
  adjustEstimate: 'leave',
  overrideEditableFlag: true,
});
assert.equal(jiraWorklogEditResult.isError, undefined, 'Jira worklog editing succeeds through the optional provider path');
assert.equal(
  requests.at(-1)?.url,
  'https://devdoo.atlassian.net/rest/api/3/issue/MP%2F1/worklog/100%2F2?notifyUsers=false&adjustEstimate=leave&overrideEditableFlag=true',
  'Jira worklog editing uses the documented endpoint and excludes routing identifiers from the body',
);
assert.equal(requests.at(-1)?.method, 'PUT');
assert.equal(requests.at(-1)?.body?.includes('worklogId'), false);
const jiraVersionsResult = await tools.jira_get_project_versions.handler({
  projectIdOrKey: 'MP/2',
  expand: 'issuesStatusForFixVersion',
});
assert.equal(jiraVersionsResult.isError, undefined, 'Jira project-version listing succeeds through the optional provider path');
assert.equal(
  requests.at(-1)?.url,
  'https://devdoo.atlassian.net/rest/api/3/project/MP%2F2/versions?expand=issuesStatusForFixVersion',
  'Jira project-version listing uses the documented endpoint',
);
const jiraAssignableResult = await tools.jira_find_assignable_users.handler({
  issueKey: 'MP/1',
  query: 'Baek',
  maxResults: 10,
});
assert.equal(jiraAssignableResult.isError, undefined, 'Jira assignable-user search succeeds through the optional provider path');
assert.equal(
  requests.at(-1)?.url,
  'https://devdoo.atlassian.net/rest/api/3/user/assignable/search?query=Baek&issueKey=MP%2F1&maxResults=10',
  'Jira assignable-user search uses the issue-scoped endpoint',
);
assert.equal(
  tools.jira_find_assignable_users.inputSchema.safeParse({ query: 'Baek' }).success,
  false,
  'Jira assignable-user search requires an explicit project or issue scope',
);

const pullRequestStatusesResult = await tools.bitbucket_pull_request_statuses.handler({
  workspace: 'devdoo-teams',
  repository: 'teams-app',
  pullRequestId: 17,
  q: 'state = "FAILED"',
  sort: '-updated_on',
});
assert.equal(pullRequestStatusesResult.isError, undefined, 'Bitbucket pull-request statuses succeed through the optional provider path');
assert.equal(
  requests.at(-1)?.url,
  'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/pullrequests/17/statuses?q=state+%3D+%22FAILED%22&sort=-updated_on',
  'Bitbucket pull-request statuses use the documented endpoint and bounded query contract',
);
assert.equal(requests.at(-1)?.method, 'GET');

const pullRequestActivityResult = await tools.bitbucket_pull_request_activity.handler({
  workspace: 'devdoo-teams',
  repository: 'teams-app',
  pullRequestId: 17,
  page: 2,
  pagelen: 25,
});
assert.equal(pullRequestActivityResult.isError, undefined, 'Bitbucket pull-request activity succeeds through the optional provider path');
assert.equal(
  requests.at(-1)?.url,
  'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/pullrequests/17/activity?page=2&pagelen=25',
  'Bitbucket pull-request activity uses the documented endpoint and bounded pagination',
);
assert.equal(requests.at(-1)?.method, 'GET');
assert.equal(requests.at(-1)?.body, undefined);

const pullRequestDiffstatResult = await tools.bitbucket_pull_request_diffstat.handler({
  workspace: 'devdoo-teams',
  repository: 'teams-app',
  pullRequestId: 17,
});
assert.equal(pullRequestDiffstatResult.isError, undefined, 'Bitbucket pull-request diffstat succeeds through the optional provider path');
assert.equal(
  requests.at(-1)?.url,
  'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/pullrequests/17/diffstat',
  'Bitbucket pull-request diffstat uses the documented endpoint',
);
assert.equal(requests.at(-1)?.method, 'GET');
assert.equal(requests.at(-1)?.body, undefined);

const stopPipelineResult = await tools.bitbucket_stop_pipeline.handler({
  workspace: 'devdoo-teams',
  repository: 'teams-app',
  pipelineUuid: '{pipeline-uuid}',
});
assert.equal(stopPipelineResult.isError, undefined, 'Bitbucket pipeline stop succeeds through the optional provider path');
assert.equal(
  requests.at(-1)?.url,
  'https://api.bitbucket.org/2.0/repositories/devdoo-teams/teams-app/pipelines/%7Bpipeline-uuid%7D/stopPipeline',
  'Bitbucket pipeline stop uses the documented endpoint',
);
assert.equal(requests.at(-1)?.method, 'POST');
assert.equal(requests.at(-1)?.body, undefined);

const createIssueResult = await tools.jira_create_issue.handler({
  fields: { project: { key: 'MP' }, summary: 'created' },
  idempotencyKey: 'mcp-test:create-issue',
});
assert.equal(createIssueResult.isError, undefined, 'Jira issue creation succeeds through the optional provider path');
const createIssueBody = JSON.parse(requests.at(-1)?.body ?? '{}') as Record<string, unknown>;
assert.equal(createIssueBody.idempotencyKey, undefined, 'Jira create must not forward the idempotency key to the provider body');

const integrated = createMcpGenUiServer({
  itemStore: { list: () => [], summary: () => ({ total: 0, open: 0, done: 0 }) },
  agentService: { getLocalOnly: () => undefined, listLocalOnly: () => [], countActiveLocalOnly: () => 0 },
  getWeather: async () => ({
    source: 'demo',
    location: { name: 'test', latitude: 0, longitude: 0, timezone: 'UTC' },
    current: {
      time: '2026-08-19T00:00:00.000Z',
      temperature: 20,
      apparentTemperature: 20,
      humidity: 50,
      precipitation: 0,
      weatherCode: 0,
      isDay: true,
      windSpeed: 0,
      condition: 'clear',
      icon: 'sun',
    },
  }),
  widgetHtml: '<!doctype html><html><body>test</body></html>',
  providerTools: createMcpProviderToolRegistry({
    principal: { tenantId: 'tenant-1', requesterId: 'requester-1' },
    resolveCredential: () => undefined,
    atlassianSiteUrl: 'https://devdoo.atlassian.net',
    fetchImpl,
  }),
});
await integrated.ready;
assert.ok(registeredTools(integrated.server).jira_search_jql, 'MCP GenUI server accepts the optional provider registrar');
await integrated.close();

console.log('PASS: optional provider MCP tools register Jira/Confluence/Bitbucket capabilities with principal-scoped, fail-closed, redacted credentials');
