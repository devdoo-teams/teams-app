import crypto from 'node:crypto';

import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import {
  AtlassianCloudClient,
  type AtlassianFetch,
  type AtlassianResult,
} from './atlassian-cloud-client.js';
import {
  BitbucketCloudClient,
  isSafeBitbucketPath,
  type BitbucketFetch,
  type BitbucketResult,
} from './bitbucket-cloud-client.js';
import type { PrincipalScopedProviderHttpBroker } from './mcp-provider-http-broker.js';
import type { ProviderMutationReplayStore } from './provider-mutation-replay-store.js';
import { redactSensitiveValue } from './sensitive-text.js';
import {
  implementedRovoCapability,
} from './atlassian-rovo-provider-parity.js';

export { ATLASSIAN_ROVO_PROVIDER_CAPABILITIES } from './atlassian-rovo-provider-parity.js';

export type ProviderName = 'atlassian' | 'bitbucket';

export type ProviderPrincipal = Readonly<{
  tenantId: string;
  requesterId: string;
}>;

export type ProviderCredentialResolver = (
  provider: ProviderName,
  principal: ProviderPrincipal,
) => Promise<string | undefined> | string | undefined;

export type McpProviderToolOptions = Readonly<{
  principal: ProviderPrincipal;
  /** Optional authorization gate for provider mutations. Reads remain available. */
  allowMutations?: (principal: ProviderPrincipal) => boolean;
  /** Legacy local adapter. Prefer providerBroker for bounded transport and credential isolation. */
  resolveCredential?: ProviderCredentialResolver;
  /** Optional server-side broker that owns credential injection and transport bounds. */
  providerBroker?: PrincipalScopedProviderHttpBroker;
  atlassianSiteUrl: string;
  bitbucketBaseUrl?: string;
  fetchImpl?: AtlassianFetch & BitbucketFetch;
  /** Optional-only replay boundary for state-changing provider tools. */
  mutationReplayStore?: ProviderMutationReplayStore;
}>;

export type McpProviderToolRegistry = Readonly<{
  register(server: McpServer): void;
}>;

const MAX_OUTPUT_CHARS = 48_000;
const MAX_INPUT_JSON_CHARS = 64_000;
const MAX_INPUT_JSON_BYTES = 64_000;
const PRINCIPAL_VALUE = /^[^\u0000-\u001f\u007f]{1,512}$/u;
const MUTATION_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

const strictObject = <T extends z.ZodRawShape>(shape: T): z.ZodObject<T> => z.object(shape).strict();

const pageOptions = strictObject({
  page: z.number().int().min(1).max(10_000).optional(),
  pagelen: z.number().int().min(1).max(100).optional(),
});

const jiraPageOptions = strictObject({
  startAt: z.number().int().min(0).max(1_000_000).optional(),
  maxResults: z.number().int().min(1).max(200).optional(),
});

const jiraIssueKey = strictObject({
  issueIdOrKey: z.string().trim().min(1).max(512),
  idempotencyKey: z.string().trim().regex(MUTATION_KEY).optional(),
});

const jiraSearchInput = strictObject({
  jql: z.string().trim().min(1).max(4_000),
  maxResults: z.number().int().min(1).max(100).optional(),
  nextPageToken: z.string().trim().min(1).max(4_000).optional(),
});

const jiraGetInput = jiraIssueKey.extend({
  fields: z.array(z.string().trim().min(1).max(256)).max(100).optional(),
  expand: z.string().trim().min(1).max(4_000).optional(),
});

const jiraIssueChangelogInput = jiraIssueKey.extend({
  startAt: z.number().int().min(0).max(1_000_000).optional(),
  maxResults: z.number().int().min(1).max(200).optional(),
});

const jiraLinkedIssue = strictObject({
  id: z.string().trim().min(1).max(4_000).optional(),
  key: z.string().trim().min(1).max(4_000).optional(),
}).superRefine((value, context) => {
  if ((value.id ? 1 : 0) + (value.key ? 1 : 0) !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Exactly one linked issue identifier is required.' });
  }
});

const jiraIssueLinkType = strictObject({
  id: z.string().trim().min(1).max(4_000).optional(),
  name: z.string().trim().min(1).max(4_000).optional(),
}).superRefine((value, context) => {
  if ((value.id ? 1 : 0) + (value.name ? 1 : 0) !== 1) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Exactly one Jira issue link type identifier is required.' });
  }
});

const jiraIssueLinkInput = strictObject({
  inwardIssue: jiraLinkedIssue,
  outwardIssue: jiraLinkedIssue,
  type: jiraIssueLinkType,
  comment: z.record(z.unknown()).optional(),
  idempotencyKey: z.string().trim().regex(MUTATION_KEY).optional(),
}).superRefine((value, context) => enforceJsonByteBound(value, context, 'Jira issue-link input is too large.'));

const jiraIssueLinkIdInput = strictObject({
  linkId: z.string().trim().min(1).max(4_000),
  idempotencyKey: z.string().trim().regex(MUTATION_KEY).optional(),
});

const jiraRemoteIssueLinkPayload = {
  application: z.record(z.unknown()).optional(),
  globalId: z.string().trim().min(1).max(4_000).optional(),
  object: z.record(z.unknown()),
  relationship: z.string().trim().min(1).max(4_000).optional(),
};

const jiraRemoteIssueLinkCreateInput = jiraIssueKey.extend(jiraRemoteIssueLinkPayload)
  .superRefine((value, context) => enforceJsonByteBound(value, context, 'Jira remote-link input is too large.'));

const jiraRemoteIssueLinkIdInput = jiraIssueKey.extend({
  linkId: z.string().trim().min(1).max(4_000),
});

const jiraRemoteIssueLinkUpdateInput = jiraRemoteIssueLinkIdInput.extend(jiraRemoteIssueLinkPayload)
  .superRefine((value, context) => enforceJsonByteBound(value, context, 'Jira remote-link input is too large.'));

const jiraRemoteIssueLinkGlobalIdInput = jiraIssueKey.extend({
  globalId: z.string().trim().min(1).max(4_000),
});

const jiraIssueMutationBase = strictObject({
  fields: z.record(z.unknown()),
  update: z.record(z.unknown()).optional(),
  properties: z.array(z.record(z.unknown())).max(50).optional(),
  idempotencyKey: z.string().trim().regex(MUTATION_KEY).optional(),
});

const jiraCreateIssueInput = jiraIssueMutationBase.superRefine((value, context) => {
  enforceJsonByteBound(value, context, 'Jira mutation input is too large.');
});

const jiraEditIssueInput = jiraIssueMutationBase.extend({
  issueIdOrKey: z.string().trim().min(1).max(512),
}).superRefine((value, context) => {
  enforceJsonByteBound(value, context, 'Jira mutation input is too large.');
});

const jiraTransitionInput = jiraIssueKey.extend({
  transitionId: z.string().trim().min(1).max(256),
  fields: z.record(z.unknown()).optional(),
  update: z.record(z.unknown()).optional(),
  properties: z.array(z.record(z.unknown())).max(50).optional(),
}).superRefine((value, context) => {
  enforceJsonByteBound(value, context, 'Jira transition input is too large.');
});

const jiraProjectIssueTypesInput = jiraPageOptions.extend({
  projectIdOrKey: z.string().trim().min(1).max(512),
});

const jiraIssueTypeFieldsInput = jiraProjectIssueTypesInput.extend({
  issueTypeId: z.string().trim().min(1).max(512),
});

const jiraVisibleProjectsInput = jiraPageOptions.extend({
  maxResults: z.number().int().min(1).max(100).optional(),
  query: z.string().trim().min(1).max(4_000).optional(),
});

const jiraAccountLookupInput = strictObject({
  query: z.string().trim().min(1).max(4_000),
  maxResults: z.number().int().min(1).max(100).optional(),
});

const jiraCommentInput = jiraIssueKey.extend({
  body: z.record(z.unknown()),
  visibility: z.record(z.unknown()).optional(),
}).superRefine((value, context) => enforceJsonByteBound(value, context, 'Jira comment input is too large.'));

const jiraWorklogFields = jiraIssueKey.extend({
  timeSpentSeconds: z.number().int().min(1).max(31_536_000),
  started: z.string().trim().min(1).max(128).optional(),
  comment: z.record(z.unknown()).optional(),
  visibility: z.record(z.unknown()).optional(),
  properties: z.array(z.record(z.unknown())).max(50).optional(),
  notifyUsers: z.boolean().optional(),
  adjustEstimate: z.enum(['new', 'leave', 'manual', 'auto']).optional(),
  newEstimate: z.string().trim().min(1).max(128).optional(),
  reduceBy: z.string().trim().min(1).max(128).optional(),
  expand: z.string().trim().min(1).max(4_000).optional(),
  overrideEditableFlag: z.boolean().optional(),
});

const validateJiraWorklogInput = (value: z.infer<typeof jiraWorklogFields>, context: z.RefinementCtx): void => {
  enforceJsonByteBound(value, context, 'Jira worklog input is too large.');
  if (value.adjustEstimate === 'new' && !value.newEstimate) context.addIssue({ code: z.ZodIssueCode.custom, message: 'newEstimate is required for the new adjustment mode.' });
  if (value.adjustEstimate === 'manual' && !value.reduceBy) context.addIssue({ code: z.ZodIssueCode.custom, message: 'reduceBy is required for the manual adjustment mode.' });
};

const jiraWorklogInput = jiraWorklogFields.superRefine(validateJiraWorklogInput);

const jiraWorklogListInput = jiraIssueKey.extend({
  startAt: z.number().int().min(0).max(1_000_000).optional(),
  maxResults: z.number().int().min(1).max(1_000).optional(),
  startedAfter: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  startedBefore: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  expand: z.string().trim().min(1).max(4_000).optional(),
});

const jiraEditWorklogInput = jiraWorklogFields.extend({
  worklogId: z.string().trim().min(1).max(512),
}).superRefine(validateJiraWorklogInput);

const jiraProjectVersionsInput = strictObject({
  projectIdOrKey: z.string().trim().min(1).max(512),
  expand: z.string().trim().min(1).max(4_000).optional(),
});

const jiraAssignableUsersInput = strictObject({
  projectKeys: z.array(z.string().trim().min(1).max(512)).min(1).max(50).optional(),
  project: z.string().trim().min(1).max(512).optional(),
  issueKey: z.string().trim().min(1).max(512).optional(),
  query: z.string().trim().min(1).max(4_000).optional(),
  accountId: z.string().trim().min(1).max(512).optional(),
  startAt: z.number().int().min(0).max(1_000_000).optional(),
  maxResults: z.number().int().min(1).max(1_000).optional(),
  actionDescriptorId: z.number().int().min(0).max(1_000_000).optional(),
}).superRefine((value, context) => {
  const hasProjectKeys = value.projectKeys !== undefined;
  const hasIssueOrProject = value.issueKey !== undefined || value.project !== undefined;
  if (hasProjectKeys === hasIssueOrProject) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Exactly one assignable-user scope is required.' });
  }
});

const confluenceSearchInput = strictObject({
  cql: z.string().trim().min(1).max(4_000),
  limit: z.number().int().min(1).max(250).optional(),
  cursor: z.string().trim().min(1).max(4_000).optional(),
});

const confluencePageInput = strictObject({
  pageId: z.string().trim().min(1).max(512),
  bodyFormat: z.enum(['storage', 'atlas_doc_format', 'view']).optional(),
});

const confluenceCreateInput = strictObject({
  spaceId: z.string().trim().min(1).max(512),
  title: z.string().trim().min(1).max(512),
  body: z.record(z.unknown()),
  parentId: z.string().trim().min(1).max(512).optional(),
  status: z.enum(['current', 'draft']).optional(),
  idempotencyKey: z.string().trim().regex(MUTATION_KEY).optional(),
}).superRefine((value, context) => {
  enforceJsonByteBound(value, context, 'Confluence page input is too large.');
});

const confluenceUpdateInput = strictObject({
  id: z.string().trim().min(1).max(512),
  status: z.enum(['current', 'draft', 'trashed']).optional(),
  title: z.string().trim().min(1).max(512).optional(),
  spaceId: z.string().trim().min(1).max(512).optional(),
  parentId: z.string().trim().min(1).max(512).optional(),
  body: z.record(z.unknown()).optional(),
  version: strictObject({
    number: z.number().int().min(1).max(1_000_000),
    message: z.string().max(4_000).optional(),
  }),
  idempotencyKey: z.string().trim().regex(MUTATION_KEY).optional(),
}).superRefine((value, context) => {
  enforceJsonByteBound(value, context, 'Confluence update input is too large.');
});

const confluencePageCollectionInput = strictObject({
  pageId: z.string().trim().min(1).max(512),
  limit: z.number().int().min(1).max(250).optional(),
  cursor: z.string().trim().min(1).max(4_000).optional(),
});

const confluenceDescendantsInput = confluencePageCollectionInput.extend({
  depth: z.number().int().min(1).max(10).optional(),
});

const confluenceCommentChildrenInput = strictObject({
  commentType: z.enum(['footer', 'inline']),
  commentId: z.string().trim().min(1).max(512),
  limit: z.number().int().min(1).max(250).optional(),
  cursor: z.string().trim().min(1).max(4_000).optional(),
});

const confluenceSpacesInput = strictObject({
  keys: z.array(z.string().trim().min(1).max(512)).min(1).max(250).optional(),
  type: z.enum(['global', 'collaboration', 'knowledge_base', 'personal', 'system', 'onboarding', 'xflow_sample_space']).optional(),
  status: z.enum(['current', 'archived', 'trashed']).optional(),
  limit: z.number().int().min(1).max(250).optional(),
  cursor: z.string().trim().min(1).max(4_000).optional(),
});

const confluencePagesInSpaceInput = strictObject({
  spaceId: z.string().trim().min(1).max(512),
  depth: z.enum(['all', 'root']).optional(),
  status: z.array(z.enum(['current', 'archived', 'deleted', 'trashed'])).min(1).max(4).optional(),
  title: z.string().trim().min(1).max(4_000).optional(),
  bodyFormat: z.enum(['storage', 'atlas_doc_format']).optional(),
  limit: z.number().int().min(1).max(250).optional(),
  cursor: z.string().trim().min(1).max(4_000).optional(),
});

const confluenceCommentBody = strictObject({
  representation: z.enum(['storage', 'atlas_doc_format']),
  value: z.string().max(48_000),
});

const confluenceFooterCommentInput = strictObject({
  pageId: z.string().trim().min(1).max(512).optional(),
  parentCommentId: z.string().trim().min(1).max(512).optional(),
  body: confluenceCommentBody,
  idempotencyKey: z.string().trim().regex(MUTATION_KEY).optional(),
}).superRefine((value, context) => {
  if ((value.pageId ? 1 : 0) + (value.parentCommentId ? 1 : 0) !== 1) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Exactly one comment target is required.' });
  enforceJsonByteBound(value, context, 'Confluence comment input is too large.');
});

const confluenceInlineCommentInput = strictObject({
  pageId: z.string().trim().min(1).max(512).optional(),
  parentCommentId: z.string().trim().min(1).max(512).optional(),
  body: confluenceCommentBody,
  inlineCommentProperties: strictObject({
    textSelection: z.string().min(1).max(4_000),
    textSelectionMatchCount: z.number().int().min(1).max(100_000),
    textSelectionMatchIndex: z.number().int().min(0).max(99_999),
  }).optional(),
  idempotencyKey: z.string().trim().regex(MUTATION_KEY).optional(),
}).superRefine((value, context) => {
  const topLevel = Boolean(value.pageId);
  if ((value.pageId ? 1 : 0) + (value.parentCommentId ? 1 : 0) !== 1) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Exactly one comment target is required.' });
  if (topLevel && !value.inlineCommentProperties) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Top-level inline comments require a text selection.' });
  if (value.inlineCommentProperties && value.inlineCommentProperties.textSelectionMatchIndex >= value.inlineCommentProperties.textSelectionMatchCount) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Inline comment match index must be below match count.' });
  enforceJsonByteBound(value, context, 'Confluence inline comment input is too large.');
});

const confluenceCommentGetInput = strictObject({
  commentId: z.string().trim().min(1).max(512),
  bodyFormat: z.enum(['storage', 'atlas_doc_format', 'view']).optional(),
  version: z.number().int().min(1).max(1_000_000).optional(),
  includeProperties: z.boolean().optional(),
  includeOperations: z.boolean().optional(),
  includeLikes: z.boolean().optional(),
  includeVersions: z.boolean().optional(),
  includeVersion: z.boolean().optional(),
});

const confluenceFooterCommentUpdateInput = strictObject({
  commentId: z.string().trim().min(1).max(512),
  version: strictObject({
    number: z.number().int().min(1).max(1_000_000),
    message: z.string().max(4_000).optional(),
  }),
  body: confluenceCommentBody,
  idempotencyKey: z.string().trim().regex(MUTATION_KEY).optional(),
}).superRefine((value, context) => enforceJsonByteBound(value, context, 'Confluence footer comment update is too large.'));

const confluenceInlineCommentUpdateInput = strictObject({
  commentId: z.string().trim().min(1).max(512),
  version: strictObject({
    number: z.number().int().min(1).max(1_000_000),
    message: z.string().max(4_000).optional(),
  }),
  body: confluenceCommentBody.optional(),
  resolved: z.boolean().optional(),
  idempotencyKey: z.string().trim().regex(MUTATION_KEY).optional(),
}).superRefine((value, context) => {
  if (value.body === undefined && value.resolved === undefined) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Inline comment update requires body or resolved.' });
  enforceJsonByteBound(value, context, 'Confluence inline comment update is too large.');
});

const confluenceCommentIdInput = strictObject({
  commentId: z.string().trim().min(1).max(512),
  idempotencyKey: z.string().trim().regex(MUTATION_KEY).optional(),
});
const confluenceDeletePageInput = strictObject({
  pageId: z.string().trim().min(1).max(512),
  draft: z.boolean().optional(),
  purge: z.boolean().optional(),
  idempotencyKey: z.string().trim().regex(MUTATION_KEY).optional(),
});

const bitbucketWorkspaceInput = pageOptions.extend({
  workspace: z.string().trim().min(1).max(512),
  q: z.string().trim().min(1).max(512).optional(),
});

const bitbucketRepositoryInput = pageOptions.extend({
  workspace: z.string().trim().min(1).max(512),
  repository: z.string().trim().min(1).max(512),
  idempotencyKey: z.string().trim().regex(MUTATION_KEY).optional(),
});

const bitbucketCommitsInput = bitbucketRepositoryInput.extend({
  include: z.string().trim().min(1).max(512).optional(),
});

const bitbucketPullRequestInput = bitbucketRepositoryInput.extend({
  state: z.string().trim().min(1).max(128).optional(),
});

const bitbucketIssueInput = bitbucketRepositoryInput.extend({
  priority: z.string().trim().min(1).max(128).optional(),
  status: z.string().trim().min(1).max(128).optional(),
});

const bitbucketWorkspaceGetInput = strictObject({ workspace: z.string().trim().min(1).max(512) });
const bitbucketWorkspacePermissionsInput = pageOptions.extend({
  workspace: z.string().trim().min(1).max(512),
  q: z.string().trim().min(1).max(512).refine(
    (value) => !/[\u0000-\u001f\u007f]/u.test(value),
    'Bitbucket workspace permission filters must not contain control characters.',
  ).optional(),
});
const bitbucketUserPullRequestsInput = pageOptions.extend({
  workspace: z.string().trim().min(1).max(512),
  selectedUser: z.string().trim().min(1).max(512),
  state: z.string().trim().min(1).max(128).optional(),
});
const bitbucketPullRequestIdInput = bitbucketRepositoryInput.extend({
  pullRequestId: z.number().int().min(1).max(2_147_483_647),
});
const bitbucketPagedPullRequestInput = bitbucketPullRequestIdInput.extend(pageOptions.shape);
const bitbucketPullRequestStatusesInput = bitbucketPullRequestIdInput.extend({
  q: z.string().trim().min(1).max(4_000).optional(),
  sort: z.string().trim().min(1).max(512).optional(),
});
const bitbucketDeploymentInput = bitbucketRepositoryInput.extend({ deploymentUuid: z.string().trim().min(1).max(512) });
const bitbucketBranchInput = bitbucketRepositoryInput.extend({ name: z.string().trim().min(1).max(512) });
const bitbucketBranchListInput = bitbucketRepositoryInput.extend({
  q: z.string().trim().min(1).max(4_000).optional(),
  sort: z.string().trim().min(1).max(512).optional(),
});
const bitbucketCommitInput = bitbucketRepositoryInput.extend({ commit: z.string().trim().min(1).max(512) });
const bitbucketBoundedValueInput = z.string().trim().min(1).max(512).refine(
  (value) => !/[\u0000-\u001f\u007f]/u.test(value),
  'Bitbucket values must not contain control characters.',
);
const bitbucketPathInput = bitbucketBoundedValueInput.refine(
  isSafeBitbucketPath,
  'Bitbucket paths must not contain traversal segments.',
);
const bitbucketFilesInput = bitbucketCommitInput.extend({ path: bitbucketPathInput });
const bitbucketCommitsForRevisionInput = bitbucketRepositoryInput.extend({
  revision: bitbucketBoundedValueInput,
  path: bitbucketPathInput.optional(),
  include: z.array(bitbucketBoundedValueInput).max(100).optional(),
  exclude: z.array(bitbucketBoundedValueInput).max(100).optional(),
});
const bitbucketFileHistoryInput = bitbucketCommitInput.extend({
  path: bitbucketPathInput,
  renames: z.boolean().optional(),
  q: bitbucketBoundedValueInput.optional(),
  sort: bitbucketBoundedValueInput.optional(),
});
const bitbucketSourceRootInput = bitbucketRepositoryInput.omit({ page: true, pagelen: true }).extend({
  commit: bitbucketBoundedValueInput,
  format: z.enum(['meta', 'rendered']).optional(),
}).strict();
const bitbucketPipelineInput = bitbucketRepositoryInput.extend({ pipelineUuid: z.string().trim().min(1).max(512) });
const bitbucketPipelineStepsInput = bitbucketPipelineInput.extend(pageOptions.shape);
const bitbucketPipelineStepInput = bitbucketPipelineInput.extend({ stepUuid: z.string().trim().min(1).max(512) });
const bitbucketEnvironmentInput = bitbucketRepositoryInput.extend({ environmentUuid: z.string().trim().min(1).max(512) });
const bitbucketRepositoryUserPermissionInput = bitbucketRepositoryInput.extend({ selectedUser: z.string().trim().min(1).max(512) });
const bitbucketRepositoryGroupPermissionInput = bitbucketRepositoryInput.extend({ groupSlug: z.string().trim().min(1).max(512) });
const bitbucketRepositoryUserPermissionUpdateInput = bitbucketRepositoryUserPermissionInput.extend({
  permission: z.enum(['admin', 'write', 'read']),
}).superRefine((value, context) => enforceJsonByteBound(value, context, 'Bitbucket repository user permission input is too large.'));
const bitbucketRepositoryGroupPermissionUpdateInput = bitbucketRepositoryGroupPermissionInput.extend({
  permission: z.enum(['admin', 'write', 'read']),
}).superRefine((value, context) => enforceJsonByteBound(value, context, 'Bitbucket repository group permission input is too large.'));

const bitbucketCreatePullRequestInput = bitbucketRepositoryInput.extend({
  title: z.string().trim().min(1).max(512),
  source: z.record(z.unknown()),
  destination: z.record(z.unknown()),
  description: z.string().max(48_000).optional(),
  close_source_branch: z.boolean().optional(),
  reviewers: z.array(z.record(z.unknown())).max(100).optional(),
}).superRefine((value, context) => enforceJsonByteBound(value, context, 'Bitbucket pull request input is too large.'));

const bitbucketMergePullRequestInput = bitbucketPullRequestIdInput.extend({
  type: z.string().trim().min(1).max(128),
  message: z.string().max(48_000).optional(),
  close_source_branch: z.boolean().optional(),
  merge_strategy: z.enum(['merge_commit', 'squash', 'fast_forward', 'squash_fast_forward', 'rebase_fast_forward', 'rebase_merge']).optional(),
}).superRefine((value, context) => enforceJsonByteBound(value, context, 'Bitbucket merge input is too large.'));

const bitbucketPullRequestCommentInput = bitbucketPullRequestIdInput.extend({
  content: strictObject({ raw: z.string().min(1).max(48_000) }),
}).superRefine((value, context) => enforceJsonByteBound(value, context, 'Bitbucket comment input is too large.'));

const bitbucketUpdatePullRequestInput = bitbucketPullRequestIdInput.extend({
  title: z.string().trim().min(1).max(512).optional(),
  description: z.string().max(48_000).optional(),
  source: z.record(z.unknown()).optional(),
  destination: z.record(z.unknown()).optional(),
  close_source_branch: z.boolean().optional(),
  reviewers: z.array(z.record(z.unknown())).max(100).optional(),
}).superRefine((value, context) => {
  const { workspace: _workspace, repository: _repository, pullRequestId: _pullRequestId, page: _page, pagelen: _pagelen, ...payload } = value;
  if (Object.keys(payload).length === 0) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Bitbucket pull request update requires at least one mutable field.' });
  enforceJsonByteBound(value, context, 'Bitbucket pull request update is too large.');
});

const bitbucketCreateBranchInput = bitbucketRepositoryInput.extend({
  name: z.string().trim().min(1).max(512),
  target: strictObject({ hash: z.string().trim().min(1).max(512) }),
});

const bitbucketCreateCommitInput = bitbucketRepositoryInput.extend({
  files: z.array(strictObject({
    path: bitbucketPathInput,
    content: z.string().max(MAX_INPUT_JSON_CHARS),
  })).max(100).optional(),
  deleteFiles: z.array(bitbucketPathInput).max(100).optional(),
  message: z.string().trim().min(1).max(512).optional(),
  author: z.string().trim().min(1).max(512).optional(),
  parents: z.string().trim().min(1).max(512).optional(),
  branch: z.string().trim().min(1).max(512).optional(),
}).superRefine((value, context) => enforceJsonByteBound(value, context, 'Bitbucket commit input is too large.'));

const bitbucketRunPipelineInput = bitbucketRepositoryInput.extend({
  target: z.record(z.unknown()),
  variables: z.array(z.record(z.unknown())).max(100).optional(),
}).superRefine((value, context) => enforceJsonByteBound(value, context, 'Bitbucket pipeline input is too large.'));

const bitbucketCreateEnvironmentInput = bitbucketRepositoryInput.extend({
  name: z.string().trim().min(1).max(512),
  environment_type: z.record(z.unknown()).optional(),
  rank: z.number().int().min(0).max(1_000_000).optional(),
}).superRefine((value, context) => enforceJsonByteBound(value, context, 'Bitbucket environment input is too large.'));

function enforceJsonByteBound(value: unknown, context: z.RefinementCtx, message: string): void {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > MAX_INPUT_JSON_BYTES) {
      context.addIssue({ code: z.ZodIssueCode.custom, message });
    }
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message });
  }
}

function validatePrincipal(principal: ProviderPrincipal): ProviderPrincipal {
  const tenantId = principal.tenantId.trim();
  const requesterId = principal.requesterId.trim();
  if (!PRINCIPAL_VALUE.test(tenantId) || !PRINCIPAL_VALUE.test(requesterId)) {
    throw new Error('validated provider principal is required');
  }
  return {
    tenantId,
    requesterId,
  };
}

function providerForTool(toolName: string): ProviderName {
  return toolName.startsWith('bitbucket_') ? 'bitbucket' : 'atlassian';
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function mutationFingerprint(toolName: string, input: Record<string, unknown>): string {
  const { idempotencyKey: _idempotencyKey, ...payload } = input;
  return crypto.createHash('sha256').update(canonicalJson({ toolName, payload }), 'utf8').digest('hex');
}

function mutationReplayFailure(provider: ProviderName, error: unknown): CallToolResult {
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'provider-error';
  return {
    isError: true,
    content: [{ type: 'text', text: `${provider} mutation replay rejected (${code}).` }],
    structuredContent: { provider, ok: false, error: { code } },
  };
}

function boundedOutput(value: unknown): unknown {
  const redacted = redactSensitiveValue(value);
  const encoded = JSON.stringify(redacted) ?? 'null';
  if (new TextEncoder().encode(encoded).byteLength <= MAX_OUTPUT_CHARS) return redacted;
  return {
    truncated: true,
    preview: truncateUtf8(encoded, MAX_OUTPUT_CHARS),
  };
}

function truncateUtf8(value: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) return value;
  let low = 0;
  let high = Math.min(value.length, maxBytes);
  let best = '';
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = value.slice(0, middle);
    if (encoder.encode(candidate).byteLength <= maxBytes) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  const end = best.length > 0
    && best.length < value.length
    && /[\uD800-\uDBFF]/u.test(best.at(-1) ?? '')
    && /[\uDC00-\uDFFF]/u.test(value[best.length] ?? '')
    ? best.slice(0, -1)
    : best;
  return end;
}

function strictInputSchema<T extends z.ZodTypeAny>(schema: T): T {
  return schema instanceof z.ZodObject ? schema.strict() as unknown as T : schema;
}

function result<T>(provider: ProviderName, response: AtlassianResult<T> | BitbucketResult<T>): CallToolResult {
  if (!response.ok) {
    const code = response.error.code === 'credentials-unavailable' || response.error.status === 401 || response.error.status === 403
      ? 'credentials-unavailable'
      : response.error.code;
    return {
      isError: true,
      content: [{ type: 'text', text: `${provider} provider request failed (${code}).` }],
      structuredContent: {
        provider,
        ok: false,
        error: {
          code,
          status: response.error.status,
          requestPath: response.error.requestPath,
        },
      },
    };
  }

  const data = boundedOutput(response.data);
  return {
    content: [{ type: 'text', text: JSON.stringify({ provider, status: response.status, data }) }],
    structuredContent: { provider, ok: true, status: response.status, data },
  };
}

function unavailable(provider: ProviderName): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: `${provider} provider credentials are not configured for this principal.` }],
    structuredContent: {
      provider,
      ok: false,
      error: { code: 'credentials-unavailable' },
    },
  };
}

function providerFailure(provider: ProviderName): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: `${provider} provider request failed.` }],
    structuredContent: { provider, ok: false, error: { code: 'provider-error' } },
  };
}

function brokerFetch(
  provider: ProviderName,
  broker: PrincipalScopedProviderHttpBroker,
): AtlassianFetch & BitbucketFetch {
  return async (input, init = {}) => {
    const headers = Object.fromEntries([...new Headers(init.headers).entries()]);
    const body = typeof init.body === 'string' || init.body instanceof Uint8Array || init.body instanceof ReadableStream
      ? init.body
      : undefined;
    const response = await broker.fetch(provider, {
      url: input,
      ...(init.method ? { method: init.method } : {}),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...(body === undefined ? {} : { body }),
      ...(init.signal == null ? {} : { signal: init.signal }),
    });
    if (!response.ok) {
      return new Response(null, { status: response.error.status ?? 502 });
    }
    const serialized = response.data === undefined || response.data === null
      ? ''
      : typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data);
    return new Response(serialized, {
      status: response.status,
      headers: { 'content-type': response.contentType ?? 'application/json' },
    });
  };
}

export function createMcpProviderToolRegistry(options: McpProviderToolOptions): McpProviderToolRegistry {
  const principal = validatePrincipal(options.principal);
  if (options.providerBroker && options.resolveCredential) {
    throw new Error('provider broker and legacy credential resolver are mutually exclusive');
  }
  if (!options.providerBroker && !options.resolveCredential) {
    throw new Error('MCP provider tools require a credential resolver or principal-scoped broker.');
  }
  if (options.providerBroker) {
    const brokerPrincipal = validatePrincipal(options.providerBroker.principal);
    if (brokerPrincipal.tenantId !== principal.tenantId || brokerPrincipal.requesterId !== principal.requesterId) {
      throw new Error('provider broker principal does not match registry principal');
    }
  }
  const providerBroker = options.providerBroker;
  const resolveCredential = options.resolveCredential;
  const fetchImpl = options.fetchImpl;

  const atlassian = (token: string): AtlassianCloudClient => new AtlassianCloudClient({
    siteUrl: options.atlassianSiteUrl,
    authProvider: providerBroker ? () => undefined : () => token,
    credentialMode: providerBroker ? 'broker' : 'direct',
    ...(providerBroker
      ? { fetchImpl: brokerFetch('atlassian', providerBroker) }
      : fetchImpl ? { fetchImpl } : {}),
  });
  const bitbucket = (token: string): BitbucketCloudClient => new BitbucketCloudClient({
    authProvider: providerBroker ? () => undefined : () => token,
    credentialMode: providerBroker ? 'broker' : 'direct',
    ...(options.bitbucketBaseUrl ? { baseUrl: options.bitbucketBaseUrl } : {}),
    ...(providerBroker
      ? { fetchImpl: brokerFetch('bitbucket', providerBroker) }
      : fetchImpl ? { fetchImpl } : {}),
  });

  async function withCredential<T>(provider: ProviderName, operation: (token: string) => Promise<T>): Promise<T | CallToolResult> {
    if (providerBroker) {
      try {
        return await operation('');
      } catch {
        return providerFailure(provider);
      }
    }
    try {
      const token = await resolveCredential!(provider, principal);
      if (!token?.trim()) return unavailable(provider);
      return await operation(token);
    } catch {
      return providerFailure(provider);
    }
  }

  function registerReadTool<T extends z.ZodTypeAny>(
    server: McpServer,
    name: string,
    title: string,
    description: string,
    inputSchema: T,
    handler: (input: z.infer<T>) => Promise<CallToolResult>,
  ): void {
    const capability = implementedRovoCapability(name);
    const callback = async (input: z.infer<T>, _extra: unknown): Promise<CallToolResult> => handler(input);
    registerAppTool<z.ZodTypeAny, T>(server, name, {
      title,
      description,
      inputSchema: strictInputSchema(inputSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
      _meta: {
        ui: { visibility: ['model'] },
        provider: 'optional',
        principalScoped: true,
        ...(capability ? {
          requiredProviderScopes: capability.requiredScopes,
          ...(capability.requiredScopes.length === 1 ? { requiredProviderScope: capability.requiredScopes[0] } : {}),
          rovoTool: capability.officialTool,
          rovoAction: capability.action,
        } : { parityStatus: 'legacy-extra' }),
      },
    // ext-apps exposes an output-first generic that cannot preserve this constructed Zod v3 schema.
    // The MCP SDK validates the schema before invoking this callback.
    }, callback as never);
  }

  function registerWriteTool<T extends z.ZodTypeAny>(
    server: McpServer,
    name: string,
    title: string,
    description: string,
    inputSchema: T,
    handler: (input: z.infer<T>) => Promise<CallToolResult>,
  ): void {
    const capability = implementedRovoCapability(name);
    const wrappedHandler = async (input: z.infer<T>): Promise<CallToolResult> => {
      if (options.allowMutations && !options.allowMutations(principal)) {
        return mutationReplayFailure(providerForTool(name), { code: 'MUTATION_NOT_AUTHORIZED' });
      }
      const record = input as Record<string, unknown>;
      const { idempotencyKey: _idempotencyKey, ...providerInput } = record;
      const invoke = (): Promise<CallToolResult> => handler(providerInput as z.infer<T>);
      const replayStore = options.mutationReplayStore;
      if (!replayStore) return invoke();
      const idempotencyKey = typeof record.idempotencyKey === 'string' ? record.idempotencyKey.trim() : '';
      const provider = providerForTool(name);
      if (!MUTATION_KEY.test(idempotencyKey)) {
        return mutationReplayFailure(provider, { code: 'MUTATION_IDEMPOTENCY_REQUIRED' });
      }
      try {
        const replay = await replayStore.execute({
          scope: { ...principal, provider },
          mutationKey: `${name}:${idempotencyKey}`,
          fingerprint: mutationFingerprint(name, record),
        }, invoke);
        return replay.result;
      } catch (error) {
        return mutationReplayFailure(provider, error);
      }
    };
    const callback = async (input: z.infer<T>, _extra: unknown): Promise<CallToolResult> => wrappedHandler(input);
    registerAppTool<z.ZodTypeAny, T>(server, name, {
      title,
      description,
      inputSchema: strictInputSchema(inputSchema),
      annotations: {
        readOnlyHint: false,
        destructiveHint: capability?.destructive ?? true,
        openWorldHint: true,
        idempotentHint: capability?.idempotent ?? false,
      },
      _meta: {
        ui: { visibility: ['model'] },
        provider: 'optional',
        principalScoped: true,
        ...(capability ? {
          requiredProviderScopes: capability.requiredScopes,
          ...(capability.requiredScopes.length === 1 ? { requiredProviderScope: capability.requiredScopes[0] } : {}),
          rovoTool: capability.officialTool,
          rovoAction: capability.action,
        } : { parityStatus: 'legacy-extra' }),
      },
    }, callback as never);
  }

  return {
    register(server: McpServer): void {
      registerReadTool(server, 'jira_search_jql', 'Search Jira issues', 'Search Jira issues using bounded JQL.', jiraSearchInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).jiraSearchJql(input))) as Promise<CallToolResult>);
      registerReadTool(server, 'jira_get_issue', 'Get Jira issue', 'Read one Jira issue by key or ID.', jiraGetInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).jiraGetIssue(input.issueIdOrKey, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'jira_get_issue_changelogs', 'Get Jira issue changelogs', 'List bounded change history for one Jira issue.', jiraIssueChangelogInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).jiraGetIssueChangelogs(input.issueIdOrKey, input))) as Promise<CallToolResult>);
      registerWriteTool(server, 'jira_create_issue', 'Create Jira issue', 'Create a Jira issue with caller-supplied fields.', jiraCreateIssueInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).jiraCreateIssue(input))) as Promise<CallToolResult>);
      registerWriteTool(server, 'jira_edit_issue', 'Edit Jira issue', 'Edit a Jira issue by key or ID.', jiraEditIssueInput, async (input) => withCredential('atlassian', async (token) => {
        const { issueIdOrKey, ...payload } = input;
        return result('atlassian', await atlassian(token).jiraEditIssue(issueIdOrKey, payload));
      }) as Promise<CallToolResult>);
      registerReadTool(server, 'jira_list_transitions', 'List Jira transitions', 'List currently available Jira workflow transitions.', jiraIssueKey, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).jiraListTransitions(input.issueIdOrKey))) as Promise<CallToolResult>);
      registerWriteTool(server, 'jira_transition_issue', 'Transition Jira issue', 'Apply one explicitly selected Jira workflow transition.', jiraTransitionInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).jiraTransitionIssue(input.issueIdOrKey, { transition: { id: input.transitionId }, fields: input.fields, update: input.update, properties: input.properties }))) as Promise<CallToolResult>);
      registerReadTool(server, 'jira_get_remote_issue_links', 'Get Jira remote links', 'List remote issue links for one Jira issue.', jiraIssueKey, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).jiraGetRemoteIssueLinks(input.issueIdOrKey))) as Promise<CallToolResult>);
      registerWriteTool(server, 'jira_create_issue_link', 'Create Jira issue link', 'Create a bounded link between two explicitly identified Jira issues.', jiraIssueLinkInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).jiraCreateIssueLink(input))) as Promise<CallToolResult>);
      registerReadTool(server, 'jira_get_issue_link', 'Get Jira issue link', 'Read one Jira issue link by ID.', jiraIssueLinkIdInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).jiraGetIssueLink(input.linkId))) as Promise<CallToolResult>);
      registerWriteTool(server, 'jira_delete_issue_link', 'Delete Jira issue link', 'Delete one explicitly identified Jira issue link.', jiraIssueLinkIdInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).jiraDeleteIssueLink(input.linkId))) as Promise<CallToolResult>);
      registerWriteTool(server, 'jira_create_or_update_remote_issue_link', 'Create or update Jira remote link', 'Create or global-ID-upsert a bounded remote link for one Jira issue.', jiraRemoteIssueLinkCreateInput, async (input) => withCredential('atlassian', async (token) => {
        const { issueIdOrKey, ...payload } = input;
        return result('atlassian', await atlassian(token).jiraCreateOrUpdateRemoteIssueLink(issueIdOrKey, payload));
      }) as Promise<CallToolResult>);
      registerReadTool(server, 'jira_get_remote_issue_link', 'Get Jira remote link', 'Read one Jira remote link by its issue and link IDs.', jiraRemoteIssueLinkIdInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).jiraGetRemoteIssueLink(input.issueIdOrKey, input.linkId))) as Promise<CallToolResult>);
      registerWriteTool(server, 'jira_update_remote_issue_link', 'Update Jira remote link', 'Update one explicitly identified Jira remote link.', jiraRemoteIssueLinkUpdateInput, async (input) => withCredential('atlassian', async (token) => {
        const { issueIdOrKey, linkId, ...payload } = input;
        return result('atlassian', await atlassian(token).jiraUpdateRemoteIssueLink(issueIdOrKey, linkId, payload));
      }) as Promise<CallToolResult>);
      registerWriteTool(server, 'jira_delete_remote_issue_link', 'Delete Jira remote link', 'Delete one explicitly identified Jira remote link.', jiraRemoteIssueLinkIdInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).jiraDeleteRemoteIssueLink(input.issueIdOrKey, input.linkId))) as Promise<CallToolResult>);
      registerWriteTool(server, 'jira_delete_remote_issue_link_by_global_id', 'Delete Jira remote link by global ID', 'Delete one Jira remote link by its encoded global ID.', jiraRemoteIssueLinkGlobalIdInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).jiraDeleteRemoteIssueLinkByGlobalId(input.issueIdOrKey, input.globalId))) as Promise<CallToolResult>);
      registerReadTool(server, 'jira_get_issue_type_fields', 'Get Jira issue type fields', 'Get bounded create-field metadata for a project and issue type.', jiraIssueTypeFieldsInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).jiraGetIssueTypeFields(input.projectIdOrKey, input.issueTypeId, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'jira_get_project_issue_types', 'Get Jira project issue types', 'List issue types available to a Jira project.', jiraProjectIssueTypesInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).jiraGetProjectIssueTypes(input.projectIdOrKey, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'jira_get_issue_link_types', 'Get Jira issue link types', 'List configured Jira issue link types.', strictObject({}), async () => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).jiraGetIssueLinkTypes())) as Promise<CallToolResult>);
      registerReadTool(server, 'jira_get_visible_projects', 'Get visible Jira projects', 'List Jira projects visible to the principal with bounded pagination.', jiraVisibleProjectsInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).jiraGetVisibleProjects(input))) as Promise<CallToolResult>);
      registerReadTool(server, 'jira_lookup_account_ids', 'Look up Jira account IDs', 'Find Jira account IDs by a bounded name or email query.', jiraAccountLookupInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).jiraLookupAccountIds(input))) as Promise<CallToolResult>);
      registerWriteTool(server, 'jira_add_comment', 'Add Jira comment', 'Add an Atlassian Document Format comment to one Jira issue.', jiraCommentInput, async (input) => withCredential('atlassian', async (token) => {
        const { issueIdOrKey, ...payload } = input;
        return result('atlassian', await atlassian(token).jiraAddComment(issueIdOrKey, payload));
      }) as Promise<CallToolResult>);
      registerWriteTool(server, 'jira_add_worklog', 'Add Jira worklog', 'Add a bounded worklog with explicit estimate behavior.', jiraWorklogInput, async (input) => withCredential('atlassian', async (token) => {
        const { issueIdOrKey, notifyUsers, adjustEstimate, newEstimate, reduceBy, expand, overrideEditableFlag, ...payload } = input;
        return result('atlassian', await atlassian(token).jiraAddWorklog(issueIdOrKey, payload, { notifyUsers, adjustEstimate, newEstimate, reduceBy, expand, overrideEditableFlag }));
      }) as Promise<CallToolResult>);
      registerReadTool(server, 'jira_get_issue_worklogs', 'Get Jira issue worklogs', 'List bounded worklogs for one Jira issue.', jiraWorklogListInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).jiraGetIssueWorklogs(input.issueIdOrKey, input))) as Promise<CallToolResult>);
      registerWriteTool(server, 'jira_edit_worklog', 'Edit Jira worklog', 'Edit one Jira worklog with explicit estimate behavior.', jiraEditWorklogInput, async (input) => withCredential('atlassian', async (token) => {
        const { issueIdOrKey, worklogId, notifyUsers, adjustEstimate, newEstimate, reduceBy, expand, overrideEditableFlag, ...payload } = input;
        return result('atlassian', await atlassian(token).jiraEditWorklog(issueIdOrKey, worklogId, payload, { notifyUsers, adjustEstimate, newEstimate, reduceBy, expand, overrideEditableFlag }));
      }) as Promise<CallToolResult>);
      registerReadTool(server, 'jira_get_project_versions', 'Get Jira project versions', 'List project versions for one Jira project.', jiraProjectVersionsInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).jiraGetProjectVersions(input.projectIdOrKey, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'jira_find_assignable_users', 'Find assignable Jira users', 'Find users assignable to one explicit project or issue scope.', jiraAssignableUsersInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).jiraFindAssignableUsers(input))) as Promise<CallToolResult>);

      registerReadTool(server, 'confluence_search_cql', 'Search Confluence', 'Search Confluence using bounded CQL.', confluenceSearchInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).confluenceSearchCql(input))) as Promise<CallToolResult>);
      registerReadTool(server, 'confluence_get_page', 'Get Confluence page', 'Read a Confluence page by ID.', confluencePageInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).confluenceGetPage(input.pageId, input.bodyFormat))) as Promise<CallToolResult>);
      registerWriteTool(server, 'confluence_create_page', 'Create Confluence page', 'Create a Confluence page with bounded content.', confluenceCreateInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).confluenceCreatePage(input))) as Promise<CallToolResult>);
      registerWriteTool(server, 'confluence_update_page', 'Update Confluence page', 'Update a Confluence page with an explicit version.', confluenceUpdateInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).confluenceUpdatePage(input))) as Promise<CallToolResult>);
      registerReadTool(server, 'confluence_get_page_descendants', 'Get Confluence descendants', 'List bounded descendants of one Confluence page.', confluenceDescendantsInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).confluenceGetPageDescendants(input.pageId, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'confluence_get_page_footer_comments', 'Get Confluence footer comments', 'List footer comments on one Confluence page.', confluencePageCollectionInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).confluenceGetPageFooterComments(input.pageId, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'confluence_get_page_inline_comments', 'Get Confluence inline comments', 'List inline comments on one Confluence page.', confluencePageCollectionInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).confluenceGetPageInlineComments(input.pageId, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'confluence_get_comment_children', 'Get Confluence comment replies', 'List replies to a footer or inline comment.', confluenceCommentChildrenInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).confluenceGetCommentChildren(input.commentType, input.commentId, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'confluence_get_spaces', 'Get Confluence spaces', 'List visible Confluence spaces with bounded filters.', confluenceSpacesInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).confluenceGetSpaces(input))) as Promise<CallToolResult>);
      registerReadTool(server, 'confluence_get_pages_in_space', 'Get pages in Confluence space', 'List bounded pages in one Confluence space.', confluencePagesInSpaceInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).confluenceGetPagesInSpace(input.spaceId, input))) as Promise<CallToolResult>);
      registerWriteTool(server, 'confluence_create_footer_comment', 'Create Confluence footer comment', 'Create a footer comment or reply with one explicit target.', confluenceFooterCommentInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).confluenceCreateFooterComment(input))) as Promise<CallToolResult>);
      registerWriteTool(server, 'confluence_create_inline_comment', 'Create Confluence inline comment', 'Create an inline comment with a validated text selection or reply target.', confluenceInlineCommentInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).confluenceCreateInlineComment(input))) as Promise<CallToolResult>);
      registerReadTool(server, 'confluence_get_footer_comment', 'Get Confluence footer comment', 'Read one Confluence footer comment by ID.', confluenceCommentGetInput, async (input) => withCredential('atlassian', async (token) => {
        const { commentId, ...options } = input;
        return result('atlassian', await atlassian(token).confluenceGetFooterComment(commentId, options));
      }) as Promise<CallToolResult>);
      registerWriteTool(server, 'confluence_update_footer_comment', 'Update Confluence footer comment', 'Update one Confluence footer comment with an explicit version.', confluenceFooterCommentUpdateInput, async (input) => withCredential('atlassian', async (token) => {
        const { commentId, ...payload } = input;
        return result('atlassian', await atlassian(token).confluenceUpdateFooterComment(commentId, payload));
      }) as Promise<CallToolResult>);
      registerWriteTool(server, 'confluence_delete_footer_comment', 'Delete Confluence footer comment', 'Permanently delete one Confluence footer comment.', confluenceCommentIdInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).confluenceDeleteFooterComment(input.commentId))) as Promise<CallToolResult>);
      registerReadTool(server, 'confluence_get_inline_comment', 'Get Confluence inline comment', 'Read one Confluence inline comment by ID.', confluenceCommentGetInput, async (input) => withCredential('atlassian', async (token) => {
        const { commentId, ...options } = input;
        return result('atlassian', await atlassian(token).confluenceGetInlineComment(commentId, options));
      }) as Promise<CallToolResult>);
      registerWriteTool(server, 'confluence_update_inline_comment', 'Update Confluence inline comment', 'Update or resolve one Confluence inline comment with an explicit version.', confluenceInlineCommentUpdateInput, async (input) => withCredential('atlassian', async (token) => {
        const { commentId, ...payload } = input;
        return result('atlassian', await atlassian(token).confluenceUpdateInlineComment(commentId, payload));
      }) as Promise<CallToolResult>);
      registerWriteTool(server, 'confluence_delete_inline_comment', 'Delete Confluence inline comment', 'Permanently delete one Confluence inline comment.', confluenceCommentIdInput, async (input) => withCredential('atlassian', async (token) => result('atlassian', await atlassian(token).confluenceDeleteInlineComment(input.commentId))) as Promise<CallToolResult>);
      registerWriteTool(server, 'confluence_delete_page', 'Delete Confluence page', 'Delete or purge one Confluence page with explicit draft and purge flags.', confluenceDeletePageInput, async (input) => withCredential('atlassian', async (token) => {
        const { pageId, ...options } = input;
        return result('atlassian', await atlassian(token).confluenceDeletePage(pageId, options));
      }) as Promise<CallToolResult>);

      registerReadTool(server, 'bitbucket_current_user', 'Get Bitbucket user', 'Read the authenticated Bitbucket user.', strictObject({}), async () => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).currentUser())) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_workspaces', 'List Bitbucket workspaces', 'List Bitbucket workspaces visible to the caller.', pageOptions, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).workspaces(input))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_workspace_permissions', 'List Bitbucket workspace permissions', 'List user permissions in one Bitbucket workspace.', bitbucketWorkspacePermissionsInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).workspacePermissions(input.workspace, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_repositories', 'List Bitbucket repositories', 'List repositories in a Bitbucket workspace.', bitbucketWorkspaceInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).repositories(input.workspace, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_commits', 'List Bitbucket commits', 'List commits in a Bitbucket repository.', bitbucketCommitsInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).commits(input.workspace, input.repository, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_pull_requests', 'List Bitbucket pull requests', 'List pull requests in a Bitbucket repository.', bitbucketPullRequestInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).pullRequests(input.workspace, input.repository, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_issues', 'List Bitbucket issues', 'List issues in a Bitbucket repository.', bitbucketIssueInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).issues(input.workspace, input.repository, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_get_workspace', 'Get Bitbucket workspace', 'Get one Bitbucket workspace.', bitbucketWorkspaceGetInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).workspace(input.workspace))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_get_repository', 'Get Bitbucket repository', 'Get one Bitbucket repository.', bitbucketRepositoryInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).repository(input.workspace, input.repository))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_default_reviewers', 'Get Bitbucket default reviewers', 'List effective default reviewers for a repository.', bitbucketRepositoryInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).defaultReviewers(input.workspace, input.repository, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_user_pull_requests', 'Get Bitbucket user pull requests', 'List workspace pull requests associated with one selected user.', bitbucketUserPullRequestsInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).userPullRequests(input.workspace, input.selectedUser, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_deployments', 'List Bitbucket deployments', 'List deployments for a repository.', bitbucketRepositoryInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).deployments(input.workspace, input.repository, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_get_deployment', 'Get Bitbucket deployment', 'Get one deployment by UUID.', bitbucketDeploymentInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).deployment(input.workspace, input.repository, input.deploymentUuid))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_get_pull_request', 'Get Bitbucket pull request', 'Get one pull request by numeric ID.', bitbucketPullRequestIdInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).pullRequest(input.workspace, input.repository, input.pullRequestId))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_pull_request_comments', 'Get Bitbucket pull request comments', 'List comments on one pull request.', bitbucketPagedPullRequestInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).pullRequestComments(input.workspace, input.repository, input.pullRequestId, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_pull_request_activity', 'Get Bitbucket pull request activity', 'List activity events for one pull request.', bitbucketPagedPullRequestInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).pullRequestActivity(input.workspace, input.repository, input.pullRequestId, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_pull_request_diff', 'Get Bitbucket pull request diff', 'Read the bounded textual diff for one pull request.', bitbucketPullRequestIdInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).pullRequestDiff(input.workspace, input.repository, input.pullRequestId))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_pull_request_diffstat', 'Get Bitbucket pull request diffstat', 'Read the diffstat for one pull request.', bitbucketPullRequestIdInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).pullRequestDiffstat(input.workspace, input.repository, input.pullRequestId))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_pull_request_statuses', 'Get Bitbucket pull request statuses', 'List build and deployment statuses attached to one pull request.', bitbucketPullRequestStatusesInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).pullRequestStatuses(input.workspace, input.repository, input.pullRequestId, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_get_branch', 'Get Bitbucket branch', 'Get one repository branch.', bitbucketBranchInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).branch(input.workspace, input.repository, input.name))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_branches', 'List Bitbucket branches', 'List repository branches with bounded filtering and sorting.', bitbucketBranchListInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).branches(input.workspace, input.repository, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_get_commit', 'Get Bitbucket commit', 'Get one repository commit.', bitbucketCommitInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).commit(input.workspace, input.repository, input.commit))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_get_files', 'Get Bitbucket repository files', 'Read bounded file content or a directory listing at one commit.', bitbucketFilesInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).files(input.workspace, input.repository, input.commit, input.path))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_commits_for_revision', 'List Bitbucket commits for revision', 'List bounded commit history for one revision and optional repository path.', bitbucketCommitsForRevisionInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).commitsForRevision(input.workspace, input.repository, input.revision, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_file_history', 'Get Bitbucket file history', 'List bounded commit history for one repository file.', bitbucketFileHistoryInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).fileHistory(input.workspace, input.repository, input.commit, input.path, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_source_root', 'Get Bitbucket source root', 'List the repository root at one commit.', bitbucketSourceRootInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).sourceRoot(input.workspace, input.repository, input.commit, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_pipelines', 'List Bitbucket pipelines', 'List repository pipelines.', bitbucketRepositoryInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).pipelines(input.workspace, input.repository, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_get_pipeline', 'Get Bitbucket pipeline', 'Get one pipeline by UUID.', bitbucketPipelineInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).pipeline(input.workspace, input.repository, input.pipelineUuid))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_pipeline_steps', 'List Bitbucket pipeline steps', 'List steps for one pipeline.', bitbucketPipelineStepsInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).pipelineSteps(input.workspace, input.repository, input.pipelineUuid, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_get_pipeline_step', 'Get Bitbucket pipeline step', 'Get one pipeline step by UUID.', bitbucketPipelineStepInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).pipelineStep(input.workspace, input.repository, input.pipelineUuid, input.stepUuid))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_pipeline_step_log', 'Get Bitbucket pipeline step log', 'Read one bounded pipeline step log.', bitbucketPipelineStepInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).pipelineStepLog(input.workspace, input.repository, input.pipelineUuid, input.stepUuid))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_environments', 'List Bitbucket environments', 'List deployment environments for a repository.', bitbucketRepositoryInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).environments(input.workspace, input.repository, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_get_environment', 'Get Bitbucket environment', 'Get one deployment environment by UUID.', bitbucketEnvironmentInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).environment(input.workspace, input.repository, input.environmentUuid))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_repository_user_permissions', 'List Bitbucket repository user permissions', 'List explicit user permissions for a repository.', bitbucketRepositoryInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).repositoryUserPermissions(input.workspace, input.repository, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_get_repository_user_permission', 'Get Bitbucket repository user permission', 'Read one explicit repository user permission.', bitbucketRepositoryUserPermissionInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).repositoryUserPermission(input.workspace, input.repository, input.selectedUser))) as Promise<CallToolResult>);
      registerWriteTool(server, 'bitbucket_update_repository_user_permission', 'Update Bitbucket repository user permission', 'Set one explicit repository user permission.', bitbucketRepositoryUserPermissionUpdateInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).updateRepositoryUserPermission(input.workspace, input.repository, input.selectedUser, { permission: input.permission }))) as Promise<CallToolResult>);
      registerWriteTool(server, 'bitbucket_delete_repository_user_permission', 'Delete Bitbucket repository user permission', 'Delete one explicit repository user permission.', bitbucketRepositoryUserPermissionInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).deleteRepositoryUserPermission(input.workspace, input.repository, input.selectedUser))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_repository_group_permissions', 'List Bitbucket repository group permissions', 'List explicit group permissions for a repository.', bitbucketRepositoryInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).repositoryGroupPermissions(input.workspace, input.repository, input))) as Promise<CallToolResult>);
      registerReadTool(server, 'bitbucket_get_repository_group_permission', 'Get Bitbucket repository group permission', 'Read one explicit repository group permission.', bitbucketRepositoryGroupPermissionInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).repositoryGroupPermission(input.workspace, input.repository, input.groupSlug))) as Promise<CallToolResult>);
      registerWriteTool(server, 'bitbucket_update_repository_group_permission', 'Update Bitbucket repository group permission', 'Set one explicit repository group permission.', bitbucketRepositoryGroupPermissionUpdateInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).updateRepositoryGroupPermission(input.workspace, input.repository, input.groupSlug, { permission: input.permission }))) as Promise<CallToolResult>);
      registerWriteTool(server, 'bitbucket_delete_repository_group_permission', 'Delete Bitbucket repository group permission', 'Delete one explicit repository group permission.', bitbucketRepositoryGroupPermissionInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).deleteRepositoryGroupPermission(input.workspace, input.repository, input.groupSlug))) as Promise<CallToolResult>);
      registerWriteTool(server, 'bitbucket_create_pull_request', 'Create Bitbucket pull request', 'Create a pull request with explicit source and destination.', bitbucketCreatePullRequestInput, async (input) => withCredential('bitbucket', async (token) => {
        const { workspace, repository, page: _page, pagelen: _pagelen, ...payload } = input;
        return result('bitbucket', await bitbucket(token).createPullRequest(workspace, repository, payload));
      }) as Promise<CallToolResult>);
      registerWriteTool(server, 'bitbucket_merge_pull_request', 'Merge Bitbucket pull request', 'Merge one pull request using an explicit strategy.', bitbucketMergePullRequestInput, async (input) => withCredential('bitbucket', async (token) => {
        const { workspace, repository, pullRequestId, page: _page, pagelen: _pagelen, ...payload } = input;
        return result('bitbucket', await bitbucket(token).mergePullRequest(workspace, repository, pullRequestId, payload));
      }) as Promise<CallToolResult>);
      registerWriteTool(server, 'bitbucket_approve_pull_request', 'Approve Bitbucket pull request', 'Approve one pull request.', bitbucketPullRequestIdInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).approvePullRequest(input.workspace, input.repository, input.pullRequestId))) as Promise<CallToolResult>);
      registerWriteTool(server, 'bitbucket_update_pull_request', 'Update Bitbucket pull request', 'Update mutable fields on one open pull request.', bitbucketUpdatePullRequestInput, async (input) => withCredential('bitbucket', async (token) => {
        const { workspace, repository, pullRequestId, page: _page, pagelen: _pagelen, ...payload } = input;
        return result('bitbucket', await bitbucket(token).updatePullRequest(workspace, repository, pullRequestId, payload));
      }) as Promise<CallToolResult>);
      registerWriteTool(server, 'bitbucket_decline_pull_request', 'Decline Bitbucket pull request', 'Decline one pull request.', bitbucketPullRequestIdInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).declinePullRequest(input.workspace, input.repository, input.pullRequestId))) as Promise<CallToolResult>);
      registerWriteTool(server, 'bitbucket_unapprove_pull_request', 'Unapprove Bitbucket pull request', 'Withdraw the caller approval from one pull request.', bitbucketPullRequestIdInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).unapprovePullRequest(input.workspace, input.repository, input.pullRequestId))) as Promise<CallToolResult>);
      registerWriteTool(server, 'bitbucket_add_pull_request_comment', 'Comment on Bitbucket pull request', 'Add a bounded raw-text comment to one pull request.', bitbucketPullRequestCommentInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).addPullRequestComment(input.workspace, input.repository, input.pullRequestId, { content: input.content }))) as Promise<CallToolResult>);
      registerWriteTool(server, 'bitbucket_create_branch', 'Create Bitbucket branch', 'Create one branch at an explicit commit hash.', bitbucketCreateBranchInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).createBranch(input.workspace, input.repository, { name: input.name, target: input.target }))) as Promise<CallToolResult>);
      registerWriteTool(server, 'bitbucket_create_commit', 'Create Bitbucket commit', 'Create a commit using bounded URL-encoded text files and explicit metadata.', bitbucketCreateCommitInput, async (input) => withCredential('bitbucket', async (token) => {
        const { workspace, repository, page: _page, pagelen: _pagelen, ...payload } = input;
        return result('bitbucket', await bitbucket(token).createCommit(workspace, repository, payload));
      }) as Promise<CallToolResult>);
      registerWriteTool(server, 'bitbucket_run_pipeline', 'Run Bitbucket pipeline', 'Run a pipeline with an explicit bounded target.', bitbucketRunPipelineInput, async (input) => withCredential('bitbucket', async (token) => {
        const { workspace, repository, page: _page, pagelen: _pagelen, ...payload } = input;
        return result('bitbucket', await bitbucket(token).runPipeline(workspace, repository, payload));
      }) as Promise<CallToolResult>);
      registerWriteTool(server, 'bitbucket_stop_pipeline', 'Stop Bitbucket pipeline', 'Stop one explicitly identified running pipeline.', bitbucketPipelineInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).stopPipeline(input.workspace, input.repository, input.pipelineUuid))) as Promise<CallToolResult>);
      registerWriteTool(server, 'bitbucket_create_environment', 'Create Bitbucket environment', 'Create one deployment environment.', bitbucketCreateEnvironmentInput, async (input) => withCredential('bitbucket', async (token) => {
        const { workspace, repository, page: _page, pagelen: _pagelen, ...payload } = input;
        return result('bitbucket', await bitbucket(token).createEnvironment(workspace, repository, payload));
      }) as Promise<CallToolResult>);
      registerWriteTool(server, 'bitbucket_update_environment', 'Update Bitbucket environment', 'Request an update for one explicitly identified deployment environment.', bitbucketEnvironmentInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).updateEnvironment(input.workspace, input.repository, input.environmentUuid))) as Promise<CallToolResult>);
      registerWriteTool(server, 'bitbucket_delete_environment', 'Delete Bitbucket environment', 'Delete one explicitly identified deployment environment.', bitbucketEnvironmentInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).deleteEnvironment(input.workspace, input.repository, input.environmentUuid))) as Promise<CallToolResult>);
      registerWriteTool(server, 'bitbucket_delete_branch', 'Delete Bitbucket branch', 'Permanently delete one non-default repository branch.', bitbucketBranchInput, async (input) => withCredential('bitbucket', async (token) => result('bitbucket', await bitbucket(token).deleteBranch(input.workspace, input.repository, input.name))) as Promise<CallToolResult>);
    },
  };
}
