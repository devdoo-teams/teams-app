export type RovoProviderCapabilityStatus = 'implemented' | 'unsupported';
export type RovoProviderAccess = 'read' | 'search' | 'write';
export type RovoProviderProvenance = 'rovo-supported' | 'rovo-preview' | 'rest-extension' | 'unverified-official';

export type RovoProviderCapability = Readonly<{
  provider: 'jira' | 'confluence' | 'bitbucket';
  officialTool: string;
  action: string;
  access: RovoProviderAccess;
  requiredScopes: readonly string[];
  status: RovoProviderCapabilityStatus;
  provenance: RovoProviderProvenance;
  localTool?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path?: string;
  destructive: boolean;
  idempotent: boolean;
  gapReason?: string;
}>;

/**
 * The GA supported-tools page documents product/auth availability but does not
 * publish a row-level operation catalog. The Preview page does publish exact
 * primary and discovery operation names. We only label an inventory row as
 * Rovo preview when its officialTool is an exact name from that page; every
 * other local REST adapter is explicitly not claimed as Rovo parity.
 */
const ROVO_PREVIEW_OPERATION_NAMES: ReadonlySet<string> = new Set([
  'getJiraIssue',
  'searchJiraIssuesUsingJql',
  'createJiraIssue',
  'editJiraIssue',
  'transitionJiraIssue',
  'getJiraIssueRemoteIssueLinks',
  'createIssueLink',
  'getIssueWorklog',
  'addOrEditJiraIssueWorklog',
  'getIssueLinkTypes',
  'getTransitionsForJiraIssue',
  'getJiraIssueTypeMetaWithFields',
  'getJiraProjectIssueTypesMetadata',
  'getJiraProjectVersions',
  'findAssignableUsers',
  'getVisibleJiraProjects',
  'lookupJiraAccountId',
]);

const provenanceForOfficialTool = (officialTool: string): RovoProviderProvenance => (
  ROVO_PREVIEW_OPERATION_NAMES.has(officialTool) ? 'rovo-preview' : 'rest-extension'
);

const implemented = (
  provider: RovoProviderCapability['provider'],
  officialTool: string,
  action: string,
  access: RovoProviderAccess,
  requiredScopes: string | readonly string[],
  localTool: string,
  method: NonNullable<RovoProviderCapability['method']>,
  path: string,
  options: { destructive?: boolean; idempotent?: boolean; provenance?: RovoProviderProvenance } = {},
): RovoProviderCapability => ({
  provider,
  officialTool,
  action,
  access,
  requiredScopes: typeof requiredScopes === 'string' ? [requiredScopes] : requiredScopes,
  status: 'implemented',
  provenance: options.provenance ?? provenanceForOfficialTool(officialTool),
  localTool,
  method,
  path,
  destructive: options.destructive ?? access === 'write',
  idempotent: options.idempotent ?? access !== 'write',
});

/**
 * Bounded parity inventory for the official Atlassian Rovo MCP supported-tools
 * contract. JSM, Compass, Teamwork Graph, Rovo search/fetch, and common
 * cloud-resource discovery are intentionally outside this adapter.
 */
export const ATLASSIAN_ROVO_PROVIDER_CAPABILITIES: readonly RovoProviderCapability[] = [
  implemented('jira', 'getJiraIssue', 'invoke', 'read', 'read:jira-work', 'jira_get_issue', 'GET', '/rest/api/3/issue/{issueIdOrKey}'),
  implemented('jira', 'getJiraIssueChangelogs', 'invoke', 'read', ['read:issue-meta:jira', 'read:avatar:jira', 'read:issue.changelog:jira'], 'jira_get_issue_changelogs', 'GET', '/rest/api/3/issue/{issueIdOrKey}/changelog', { provenance: 'rest-extension' }),
  implemented('jira', 'getJiraIssueRemoteIssueLinks', 'invoke', 'read', 'read:issue.remote-link:jira', 'jira_get_remote_issue_links', 'GET', '/rest/api/3/issue/{issueIdOrKey}/remotelink'),
  implemented('jira', 'createIssueLink', 'invoke', 'write', 'write:jira-work', 'jira_create_issue_link', 'POST', '/rest/api/3/issueLink'),
  implemented('jira', 'createOrUpdateJiraIssueRemoteLink', 'invoke', 'write', 'write:issue.remote-link:jira', 'jira_create_or_update_remote_issue_link', 'POST', '/rest/api/3/issue/{issueIdOrKey}/remotelink'),
  implemented('jira', 'getJiraIssueRemoteLink', 'invoke', 'read', 'read:issue.remote-link:jira', 'jira_get_remote_issue_link', 'GET', '/rest/api/3/issue/{issueIdOrKey}/remotelink/{linkId}'),
  implemented('jira', 'updateJiraIssueRemoteLink', 'invoke', 'write', 'write:issue.remote-link:jira', 'jira_update_remote_issue_link', 'PUT', '/rest/api/3/issue/{issueIdOrKey}/remotelink/{linkId}'),
  implemented('jira', 'deleteJiraIssueRemoteLink', 'invoke', 'write', 'delete:issue.remote-link:jira', 'jira_delete_remote_issue_link', 'DELETE', '/rest/api/3/issue/{issueIdOrKey}/remotelink/{linkId}', { destructive: true }),
  implemented('jira', 'deleteJiraIssueRemoteIssueLinkByGlobalId', 'invoke', 'write', 'delete:issue.remote-link:jira', 'jira_delete_remote_issue_link_by_global_id', 'DELETE', '/rest/api/3/issue/{issueIdOrKey}/remotelink', { destructive: true }),
  implemented('jira', 'getJiraIssueTypeMetaWithFields', 'invoke', 'read', 'read:jira-work', 'jira_get_issue_type_fields', 'GET', '/rest/api/3/issue/createmeta/{projectIdOrKey}/issuetypes/{issueTypeId}'),
  implemented('jira', 'getJiraProjectIssueTypesMetadata', 'invoke', 'read', 'read:jira-work', 'jira_get_project_issue_types', 'GET', '/rest/api/3/issue/createmeta/{projectIdOrKey}/issuetypes'),
  implemented('jira', 'getIssueLinkTypes', 'invoke', 'read', 'read:jira-work', 'jira_get_issue_link_types', 'GET', '/rest/api/3/issueLinkType'),
  implemented('jira', 'getTransitionsForJiraIssue', 'invoke', 'read', 'read:jira-work', 'jira_list_transitions', 'GET', '/rest/api/3/issue/{issueIdOrKey}/transitions'),
  implemented('jira', 'getVisibleJiraProjects', 'invoke', 'read', 'read:jira-work', 'jira_get_visible_projects', 'GET', '/rest/api/3/project/search'),
  implemented('jira', 'lookupJiraAccountId', 'invoke', 'read', 'read:jira-work', 'jira_lookup_account_ids', 'GET', '/rest/api/3/user/picker'),
  implemented('jira', 'addCommentToJiraIssue', 'invoke', 'write', 'write:jira-work', 'jira_add_comment', 'POST', '/rest/api/3/issue/{issueIdOrKey}/comment'),
  implemented('jira', 'addWorklogToJiraIssue', 'invoke', 'write', 'write:jira-work', 'jira_add_worklog', 'POST', '/rest/api/3/issue/{issueIdOrKey}/worklog'),
  implemented('jira', 'getIssueWorklog', 'invoke', 'read', 'read:issue-worklog:jira', 'jira_get_issue_worklogs', 'GET', '/rest/api/3/issue/{issueIdOrKey}/worklog'),
  implemented('jira', 'addOrEditJiraIssueWorklog', 'invoke', 'write', 'write:issue-worklog:jira', 'jira_edit_worklog', 'PUT', '/rest/api/3/issue/{issueIdOrKey}/worklog/{worklogId}'),
  implemented('jira', 'getJiraProjectVersions', 'invoke', 'read', 'read:project-version:jira', 'jira_get_project_versions', 'GET', '/rest/api/3/project/{projectIdOrKey}/versions'),
  implemented('jira', 'findAssignableUsers', 'invoke', 'read', 'read:jira-user', 'jira_find_assignable_users', 'GET', '/rest/api/3/user/assignable/search'),
  implemented('jira', 'createJiraIssue', 'invoke', 'write', 'write:jira-work', 'jira_create_issue', 'POST', '/rest/api/3/issue'),
  implemented('jira', 'editJiraIssue', 'invoke', 'write', 'write:jira-work', 'jira_edit_issue', 'PUT', '/rest/api/3/issue/{issueIdOrKey}'),
  implemented('jira', 'transitionJiraIssue', 'invoke', 'write', 'write:jira-work', 'jira_transition_issue', 'POST', '/rest/api/3/issue/{issueIdOrKey}/transitions'),
  implemented('jira', 'searchJiraIssuesUsingJql', 'invoke', 'search', 'search:jira-work', 'jira_search_jql', 'GET', '/rest/api/3/search/jql'),

  implemented('confluence', 'getConfluencePage', 'invoke', 'read', 'read:page:confluence', 'confluence_get_page', 'GET', '/wiki/api/v2/pages/{id}'),
  implemented('confluence', 'getConfluencePageDescendants', 'invoke', 'read', 'read:hierarchical-content:confluence', 'confluence_get_page_descendants', 'GET', '/wiki/api/v2/pages/{id}/descendants'),
  implemented('confluence', 'getConfluencePageFooterComments', 'invoke', 'read', 'read:comment:confluence', 'confluence_get_page_footer_comments', 'GET', '/wiki/api/v2/pages/{id}/footer-comments'),
  implemented('confluence', 'getConfluencePageInlineComments', 'invoke', 'read', 'read:comment:confluence', 'confluence_get_page_inline_comments', 'GET', '/wiki/api/v2/pages/{id}/inline-comments'),
  implemented('confluence', 'getConfluenceCommentChildren', 'invoke', 'read', 'read:comment:confluence', 'confluence_get_comment_children', 'GET', '/wiki/api/v2/{commentType}-comments/{id}/children'),
  implemented('confluence', 'getConfluenceSpaces', 'invoke', 'read', 'read:space:confluence', 'confluence_get_spaces', 'GET', '/wiki/api/v2/spaces'),
  implemented('confluence', 'getPagesInConfluenceSpace', 'invoke', 'read', 'read:page:confluence', 'confluence_get_pages_in_space', 'GET', '/wiki/api/v2/spaces/{id}/pages'),
  implemented('confluence', 'createConfluencePage', 'invoke', 'write', 'write:page:confluence', 'confluence_create_page', 'POST', '/wiki/api/v2/pages'),
  implemented('confluence', 'updateConfluencePage', 'invoke', 'write', 'write:page:confluence', 'confluence_update_page', 'PUT', '/wiki/api/v2/pages/{id}'),
  implemented('confluence', 'createConfluenceFooterComment', 'invoke', 'write', 'write:comment:confluence', 'confluence_create_footer_comment', 'POST', '/wiki/api/v2/footer-comments'),
  implemented('confluence', 'createConfluenceInlineComment', 'invoke', 'write', 'write:comment:confluence', 'confluence_create_inline_comment', 'POST', '/wiki/api/v2/inline-comments'),
  implemented('confluence', 'getConfluenceFooterComment', 'invoke', 'read', 'read:comment:confluence', 'confluence_get_footer_comment', 'GET', '/wiki/api/v2/footer-comments/{comment-id}'),
  implemented('confluence', 'updateConfluenceFooterComment', 'invoke', 'write', 'write:comment:confluence', 'confluence_update_footer_comment', 'PUT', '/wiki/api/v2/footer-comments/{comment-id}'),
  implemented('confluence', 'deleteConfluenceFooterComment', 'invoke', 'write', 'delete:comment:confluence', 'confluence_delete_footer_comment', 'DELETE', '/wiki/api/v2/footer-comments/{comment-id}', { destructive: true }),
  implemented('confluence', 'getConfluenceInlineComment', 'invoke', 'read', 'read:comment:confluence', 'confluence_get_inline_comment', 'GET', '/wiki/api/v2/inline-comments/{comment-id}'),
  implemented('confluence', 'updateConfluenceInlineComment', 'invoke', 'write', 'write:comment:confluence', 'confluence_update_inline_comment', 'PUT', '/wiki/api/v2/inline-comments/{comment-id}'),
  implemented('confluence', 'deleteConfluenceInlineComment', 'invoke', 'write', 'delete:comment:confluence', 'confluence_delete_inline_comment', 'DELETE', '/wiki/api/v2/inline-comments/{comment-id}', { destructive: true }),
  implemented('confluence', 'deleteConfluencePage', 'invoke', 'write', 'delete:page:confluence', 'confluence_delete_page', 'DELETE', '/wiki/api/v2/pages/{id}', { destructive: true }),
  implemented('confluence', 'searchConfluenceUsingCql', 'invoke', 'search', 'search:confluence', 'confluence_search_cql', 'GET', '/wiki/rest/api/search'),

  implemented('bitbucket', 'bitbucketWorkspace', 'list', 'read', 'read:workspace:bitbucket', 'bitbucket_workspaces', 'GET', '/2.0/workspaces'),
  implemented('bitbucket', 'bitbucketWorkspace', 'get', 'read', 'read:workspace:bitbucket', 'bitbucket_get_workspace', 'GET', '/2.0/workspaces/{workspace}'),
  implemented('bitbucket', 'bitbucketWorkspacePermission', 'user.list', 'read', 'read:workspace:bitbucket', 'bitbucket_workspace_permissions', 'GET', '/2.0/workspaces/{workspace}/permissions'),
  implemented('bitbucket', 'bitbucketRepository', 'list', 'read', 'read:repository:bitbucket', 'bitbucket_repositories', 'GET', '/2.0/repositories/{workspace}'),
  implemented('bitbucket', 'bitbucketRepository', 'get', 'read', 'read:repository:bitbucket', 'bitbucket_get_repository', 'GET', '/2.0/repositories/{workspace}/{repo_slug}'),
  implemented('bitbucket', 'bitbucketRepository', 'defaultReviewers', 'read', 'read:repository:bitbucket', 'bitbucket_default_reviewers', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/effective-default-reviewers'),
  implemented('bitbucket', 'bitbucketUser', 'pullRequests', 'read', 'read:pullrequest:bitbucket', 'bitbucket_user_pull_requests', 'GET', '/2.0/workspaces/{workspace}/pullrequests/{selected_user}'),
  implemented('bitbucket', 'bitbucketDeployment', 'list', 'read', 'read:pipeline:bitbucket', 'bitbucket_deployments', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/deployments'),
  implemented('bitbucket', 'bitbucketDeployment', 'get', 'read', 'read:pipeline:bitbucket', 'bitbucket_get_deployment', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/deployments/{deployment_uuid}'),
  implemented('bitbucket', 'bitbucketPullRequest', 'list', 'read', 'read:pullrequest:bitbucket', 'bitbucket_pull_requests', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/pullrequests'),
  implemented('bitbucket', 'bitbucketPullRequest', 'get', 'read', 'read:pullrequest:bitbucket', 'bitbucket_get_pull_request', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}'),
  implemented('bitbucket', 'bitbucketPullRequest', 'comments', 'read', 'read:pullrequest:bitbucket', 'bitbucket_pull_request_comments', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/comments'),
  implemented('bitbucket', 'bitbucketPullRequest', 'activity', 'read', 'read:pullrequest:bitbucket', 'bitbucket_pull_request_activity', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/activity', { provenance: 'rest-extension' }),
  implemented('bitbucket', 'bitbucketPullRequest', 'diff', 'read', 'read:pullrequest:bitbucket', 'bitbucket_pull_request_diff', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/diff'),
  implemented('bitbucket', 'bitbucketPullRequest', 'diffstat', 'read', 'read:pullrequest:bitbucket', 'bitbucket_pull_request_diffstat', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/diffstat'),
  implemented('bitbucket', 'bitbucketPullRequest', 'statuses', 'read', 'read:pullrequest:bitbucket', 'bitbucket_pull_request_statuses', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/statuses'),
  implemented('bitbucket', 'bitbucketRepoContent', 'branch.get', 'read', 'read:repository:bitbucket', 'bitbucket_get_branch', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/refs/branches/{name}'),
  implemented('bitbucket', 'bitbucketRepoContent', 'branch.list', 'read', 'read:repository:bitbucket', 'bitbucket_branches', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/refs/branches'),
  implemented('bitbucket', 'bitbucketRepoContent', 'commit.get', 'read', 'read:repository:bitbucket', 'bitbucket_get_commit', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/commit/{commit}'),
  implemented('bitbucket', 'bitbucketRepoContent', 'files.get', 'read', 'read:repository:bitbucket', 'bitbucket_get_files', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/src/{commit}/{path}'),
  implemented('bitbucket', 'bitbucketRepoContent', 'commit.listForRevision', 'read', 'read:repository:bitbucket', 'bitbucket_commits_for_revision', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/commits/{revision}'),
  implemented('bitbucket', 'bitbucketRepoContent', 'file.history', 'read', 'read:repository:bitbucket', 'bitbucket_file_history', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/filehistory/{commit}/{path}'),
  implemented('bitbucket', 'bitbucketRepoContent', 'source.root', 'read', 'read:repository:bitbucket', 'bitbucket_source_root', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/src/{commit}/'),
  implemented('bitbucket', 'bitbucketPipeline', 'list', 'read', 'read:pipeline:bitbucket', 'bitbucket_pipelines', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/pipelines'),
  implemented('bitbucket', 'bitbucketPipeline', 'get', 'read', 'read:pipeline:bitbucket', 'bitbucket_get_pipeline', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/pipelines/{pipeline_uuid}'),
  implemented('bitbucket', 'bitbucketPipeline', 'steps', 'read', 'read:pipeline:bitbucket', 'bitbucket_pipeline_steps', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/pipelines/{pipeline_uuid}/steps'),
  implemented('bitbucket', 'bitbucketPipeline', 'step.get', 'read', 'read:pipeline:bitbucket', 'bitbucket_get_pipeline_step', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/pipelines/{pipeline_uuid}/steps/{step_uuid}'),
  implemented('bitbucket', 'bitbucketPipeline', 'step.log', 'read', 'read:pipeline:bitbucket', 'bitbucket_pipeline_step_log', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/pipelines/{pipeline_uuid}/steps/{step_uuid}/log'),
  implemented('bitbucket', 'bitbucketEnvironment', 'list', 'read', 'read:pipeline:bitbucket', 'bitbucket_environments', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/environments'),
  implemented('bitbucket', 'bitbucketEnvironment', 'get', 'read', 'read:pipeline:bitbucket', 'bitbucket_get_environment', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/environments/{environment_uuid}'),
  implemented('bitbucket', 'bitbucketRepositoryPermission', 'user.list', 'read', 'read:repository:bitbucket', 'bitbucket_repository_user_permissions', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/permissions-config/users'),
  implemented('bitbucket', 'bitbucketRepositoryPermission', 'user.get', 'read', 'read:repository:bitbucket', 'bitbucket_get_repository_user_permission', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/permissions-config/users/{selected_user_id}'),
  implemented('bitbucket', 'bitbucketRepositoryPermission', 'user.update', 'write', ['admin:repository:bitbucket', 'write:permission:bitbucket'], 'bitbucket_update_repository_user_permission', 'PUT', '/2.0/repositories/{workspace}/{repo_slug}/permissions-config/users/{selected_user_id}'),
  implemented('bitbucket', 'bitbucketRepositoryPermission', 'user.delete', 'write', ['admin:repository:bitbucket', 'delete:permission:bitbucket'], 'bitbucket_delete_repository_user_permission', 'DELETE', '/2.0/repositories/{workspace}/{repo_slug}/permissions-config/users/{selected_user_id}', { destructive: true }),
  implemented('bitbucket', 'bitbucketRepositoryPermission', 'group.list', 'read', 'read:repository:bitbucket', 'bitbucket_repository_group_permissions', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/permissions-config/groups'),
  implemented('bitbucket', 'bitbucketRepositoryPermission', 'group.get', 'read', 'read:repository:bitbucket', 'bitbucket_get_repository_group_permission', 'GET', '/2.0/repositories/{workspace}/{repo_slug}/permissions-config/groups/{group_slug}'),
  implemented('bitbucket', 'bitbucketRepositoryPermission', 'group.update', 'write', ['admin:repository:bitbucket', 'write:permission:bitbucket'], 'bitbucket_update_repository_group_permission', 'PUT', '/2.0/repositories/{workspace}/{repo_slug}/permissions-config/groups/{group_slug}'),
  implemented('bitbucket', 'bitbucketRepositoryPermission', 'group.delete', 'write', ['admin:repository:bitbucket', 'delete:permission:bitbucket'], 'bitbucket_delete_repository_group_permission', 'DELETE', '/2.0/repositories/{workspace}/{repo_slug}/permissions-config/groups/{group_slug}', { destructive: true }),
  implemented('bitbucket', 'bitbucketPullRequest', 'create', 'write', 'write:pullrequest:bitbucket', 'bitbucket_create_pull_request', 'POST', '/2.0/repositories/{workspace}/{repo_slug}/pullrequests'),
  implemented('bitbucket', 'bitbucketPullRequest', 'merge', 'write', 'write:pullrequest:bitbucket', 'bitbucket_merge_pull_request', 'POST', '/2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/merge', { destructive: true }),
  implemented('bitbucket', 'bitbucketPullRequest', 'approve', 'write', 'write:pullrequest:bitbucket', 'bitbucket_approve_pull_request', 'POST', '/2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/approve', { idempotent: true }),
  implemented('bitbucket', 'bitbucketPullRequest', 'update', 'write', 'write:pullrequest:bitbucket', 'bitbucket_update_pull_request', 'PUT', '/2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}'),
  implemented('bitbucket', 'bitbucketPullRequest', 'decline', 'write', 'write:pullrequest:bitbucket', 'bitbucket_decline_pull_request', 'POST', '/2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/decline'),
  implemented('bitbucket', 'bitbucketPullRequest', 'unapprove', 'write', 'write:pullrequest:bitbucket', 'bitbucket_unapprove_pull_request', 'DELETE', '/2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/approve'),
  implemented('bitbucket', 'bitbucketPullRequest', 'comment', 'write', 'write:pullrequest:bitbucket', 'bitbucket_add_pull_request_comment', 'POST', '/2.0/repositories/{workspace}/{repo_slug}/pullrequests/{pull_request_id}/comments'),
  implemented('bitbucket', 'bitbucketRepoContent', 'branch.create', 'write', 'write:repository:bitbucket', 'bitbucket_create_branch', 'POST', '/2.0/repositories/{workspace}/{repo_slug}/refs/branches'),
  implemented('bitbucket', 'bitbucketRepoContent', 'commit.create', 'write', 'write:repository:bitbucket', 'bitbucket_create_commit', 'POST', '/2.0/repositories/{workspace}/{repo_slug}/src'),
  implemented('bitbucket', 'bitbucketPipeline', 'run', 'write', 'write:pipeline:bitbucket', 'bitbucket_run_pipeline', 'POST', '/2.0/repositories/{workspace}/{repo_slug}/pipelines'),
  implemented('bitbucket', 'bitbucketPipeline', 'stop', 'write', 'write:pipeline:bitbucket', 'bitbucket_stop_pipeline', 'POST', '/2.0/repositories/{workspace}/{repo_slug}/pipelines/{pipeline_uuid}/stopPipeline', { destructive: true }),
  implemented('bitbucket', 'bitbucketEnvironment', 'create', 'write', 'admin:pipeline:bitbucket', 'bitbucket_create_environment', 'POST', '/2.0/repositories/{workspace}/{repo_slug}/environments'),
  implemented('bitbucket', 'bitbucketEnvironment', 'update', 'write', 'admin:pipeline:bitbucket', 'bitbucket_update_environment', 'POST', '/2.0/repositories/{workspace}/{repo_slug}/environments/{environment_uuid}/changes'),
  implemented('bitbucket', 'bitbucketEnvironment', 'delete', 'write', 'admin:pipeline:bitbucket', 'bitbucket_delete_environment', 'DELETE', '/2.0/repositories/{workspace}/{repo_slug}/environments/{environment_uuid}', { destructive: true, idempotent: true }),
  implemented('bitbucket', 'bitbucketRepoContent', 'branch.delete', 'write', 'write:repository:bitbucket', 'bitbucket_delete_branch', 'DELETE', '/2.0/repositories/{workspace}/{repo_slug}/refs/branches/{name}', { destructive: true }),
] as const;

export function implementedRovoCapability(localTool: string): RovoProviderCapability | undefined {
  return ATLASSIAN_ROVO_PROVIDER_CAPABILITIES.find((capability) => capability.status === 'implemented' && capability.localTool === localTool);
}
