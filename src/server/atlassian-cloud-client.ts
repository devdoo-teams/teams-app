export type AtlassianAuthProvider = () => Promise<string | undefined> | string | undefined;

export type AtlassianFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type AtlassianClientErrorCode = 'invalid-request' | 'credentials-unavailable' | 'timeout' | 'network' | 'http' | 'malformed-response' | 'response-too-large';

export type AtlassianClientError = Readonly<{
  code: AtlassianClientErrorCode;
  message: string;
  status?: number;
  requestPath: string;
}>;

export type AtlassianResult<T> =
  | Readonly<{ ok: true; data: T; status: number }>
  | Readonly<{ ok: false; error: AtlassianClientError }>;

export type JiraIssueInput = Readonly<{
  fields: Record<string, unknown>;
  update?: Record<string, unknown>;
  properties?: readonly Record<string, unknown>[];
}>;

export type JiraTransitionInput = Readonly<{
  transition: { id: string };
  fields?: Record<string, unknown>;
  update?: Record<string, unknown>;
  historyMetadata?: Record<string, unknown>;
  properties?: readonly Record<string, unknown>[];
}>;

export type JiraPageOptions = Readonly<{
  startAt?: number;
  maxResults?: number;
}>;

export type JiraCommentInput = Readonly<{
  body: Record<string, unknown>;
  visibility?: Record<string, unknown>;
}>;

export type JiraWorklogInput = Readonly<{
  timeSpentSeconds: number;
  started?: string;
  comment?: Record<string, unknown>;
  visibility?: Record<string, unknown>;
  properties?: readonly Record<string, unknown>[];
}>;

export type JiraWorklogOptions = Readonly<{
  notifyUsers?: boolean;
  adjustEstimate?: 'new' | 'leave' | 'manual' | 'auto';
  newEstimate?: string;
  reduceBy?: string;
  expand?: string;
  overrideEditableFlag?: boolean;
}>;

export type JiraWorklogListOptions = Readonly<{
  startAt?: number;
  maxResults?: number;
  startedAfter?: number;
  startedBefore?: number;
  expand?: string;
}>;

export type JiraProjectVersionOptions = Readonly<{
  expand?: string;
}>;

export type JiraAssignableUsersInput = Readonly<{
  projectKeys?: readonly string[];
  project?: string;
  issueKey?: string;
  query?: string;
  accountId?: string;
  startAt?: number;
  maxResults?: number;
  actionDescriptorId?: number;
}>;

export type JiraIssueLinkInput = Readonly<{
  inwardIssue: Readonly<{ id?: string; key?: string }>;
  outwardIssue: Readonly<{ id?: string; key?: string }>;
  type: Readonly<{ id?: string; name?: string }>;
  comment?: Record<string, unknown>;
}>;

export type JiraRemoteIssueLinkInput = Readonly<{
  application?: Record<string, unknown>;
  globalId?: string;
  object: Record<string, unknown>;
  relationship?: string;
}>;

export type ConfluencePageInput = Readonly<{
  spaceId: string;
  title: string;
  body: Record<string, unknown>;
  parentId?: string;
  status?: 'current' | 'draft';
}>;

export type ConfluencePageUpdate = Readonly<{
  id: string;
  status?: 'current' | 'draft' | 'trashed';
  title?: string;
  spaceId?: string;
  parentId?: string;
  body?: Record<string, unknown>;
  version: { number: number; message?: string };
}>;

export type ConfluencePageOptions = Readonly<{
  limit?: number;
  cursor?: string;
}>;

export type ConfluencePageDeleteOptions = Readonly<{
  draft?: boolean;
  purge?: boolean;
}>;

export type ConfluenceCommentBody = Readonly<{
  representation: 'storage' | 'atlas_doc_format';
  value: string;
}>;

export type ConfluenceCommentGetOptions = Readonly<{
  bodyFormat?: 'storage' | 'atlas_doc_format' | 'view';
  version?: number;
  includeProperties?: boolean;
  includeOperations?: boolean;
  includeLikes?: boolean;
  includeVersions?: boolean;
  includeVersion?: boolean;
}>;

export type ConfluenceCommentVersion = Readonly<{
  number: number;
  message?: string;
}>;

export type ConfluenceFooterCommentUpdate = Readonly<{
  version: ConfluenceCommentVersion;
  body: ConfluenceCommentBody | Record<string, unknown>;
  _links?: Readonly<{ base: string }>;
}>;

export type ConfluenceInlineCommentUpdate = Readonly<{
  version: ConfluenceCommentVersion;
  body?: ConfluenceCommentBody | Record<string, unknown>;
  resolved?: boolean;
}>;

export type ConfluenceFooterCommentInput = Readonly<{
  pageId?: string;
  parentCommentId?: string;
  body: ConfluenceCommentBody | Record<string, unknown>;
}>;

export type ConfluenceInlineCommentInput = ConfluenceFooterCommentInput & Readonly<{
  inlineCommentProperties?: Readonly<{
    textSelection: string;
    textSelectionMatchCount: number;
    textSelectionMatchIndex: number;
  }>;
}>;

export type AtlassianCloudClientOptions = Readonly<{
  siteUrl: string;
  authProvider: AtlassianAuthProvider;
  /** Broker-owned requests deliberately omit a direct credential. */
  credentialMode?: 'direct' | 'broker';
  fetchImpl?: AtlassianFetch;
  timeoutMs?: number;
}>;

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_ERROR_TEXT = 1_000;
const MAX_QUERY_TEXT = 4_000;
const MAX_INPUT_JSON_BYTES = 64_000;
const MAX_RESPONSE_BYTES = 256_000;

export class AtlassianCloudClient {
  private readonly origin: URL;
  private readonly authProvider: AtlassianAuthProvider;
  private readonly credentialMode: 'direct' | 'broker';
  private readonly fetchImpl: AtlassianFetch;
  private readonly timeoutMs: number;

  constructor(options: AtlassianCloudClientOptions) {
    this.origin = parseSiteUrl(options.siteUrl);
    this.authProvider = options.authProvider;
    this.credentialMode = options.credentialMode === 'broker' ? 'broker' : 'direct';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = normalizeTimeout(options.timeoutMs);
  }

  jiraSearchJql(input: { jql: string; maxResults?: number; nextPageToken?: string } ): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/rest/api/3/search/jql', () => {
      const query = new URLSearchParams({ jql: boundedQuery(input.jql, 'jql') });
      if (input.maxResults !== undefined) query.set('maxResults', boundedInteger(input.maxResults, 'maxResults', 1, 100).toString());
      if (input.nextPageToken) query.set('nextPageToken', boundedOpaque(input.nextPageToken, 'nextPageToken'));
      return this.request(`/rest/api/3/search/jql?${query.toString()}`);
    });
  }

  jiraGetIssue(issueIdOrKey: string, options: { fields?: readonly string[]; expand?: string } = {}): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/rest/api/3/issue', () => {
      const query = new URLSearchParams();
      if (options.fields?.length) query.set('fields', options.fields.map((field) => boundedOpaque(field, 'field')).join(','));
      if (options.expand) query.set('expand', boundedQuery(options.expand, 'expand'));
      return this.request(`/rest/api/3/issue/${pathSegment(issueIdOrKey, 'issueIdOrKey')}${query.size ? `?${query}` : ''}`);
    });
  }

  jiraGetIssueChangelogs(issueIdOrKey: string, options: JiraPageOptions = {}): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/rest/api/3/issue/changelog', () => {
      const query = jiraPageQuery(options, 200);
      return this.request(`/rest/api/3/issue/${pathSegment(issueIdOrKey, 'issueIdOrKey')}/changelog${query.size ? `?${query}` : ''}`);
    });
  }

  jiraCreateIssue(input: JiraIssueInput): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/rest/api/3/issue', () => this.request('/rest/api/3/issue', { method: 'POST', body: input }));
  }

  jiraEditIssue(issueIdOrKey: string, input: JiraIssueInput): Promise<AtlassianResult<null>> {
    return this.safeRequest('/rest/api/3/issue', () => this.request(`/rest/api/3/issue/${pathSegment(issueIdOrKey, 'issueIdOrKey')}`, { method: 'PUT', body: input }));
  }

  jiraListTransitions(issueIdOrKey: string): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/rest/api/3/issue/transitions', () => this.request(`/rest/api/3/issue/${pathSegment(issueIdOrKey, 'issueIdOrKey')}/transitions`));
  }

  jiraTransitionIssue(issueIdOrKey: string, input: JiraTransitionInput): Promise<AtlassianResult<null>> {
    return this.safeRequest('/rest/api/3/issue/transitions', () => this.request(`/rest/api/3/issue/${pathSegment(issueIdOrKey, 'issueIdOrKey')}/transitions`, { method: 'POST', body: input }));
  }

  jiraGetRemoteIssueLinks(issueIdOrKey: string): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/rest/api/3/issue/remotelink', () => this.request(`/rest/api/3/issue/${pathSegment(issueIdOrKey, 'issueIdOrKey')}/remotelink`));
  }

  jiraCreateIssueLink(input: JiraIssueLinkInput): Promise<AtlassianResult<null>> {
    return this.safeRequest('/rest/api/3/issueLink', () => this.request('/rest/api/3/issueLink', { method: 'POST', body: validatedIssueLinkInput(input) }));
  }

  jiraGetIssueLink(linkId: string): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/rest/api/3/issueLink', () => this.request(`/rest/api/3/issueLink/${pathSegment(linkId, 'linkId')}`));
  }

  jiraDeleteIssueLink(linkId: string): Promise<AtlassianResult<null>> {
    return this.safeRequest('/rest/api/3/issueLink', () => this.request(`/rest/api/3/issueLink/${pathSegment(linkId, 'linkId')}`, { method: 'DELETE' }));
  }

  jiraCreateOrUpdateRemoteIssueLink(issueIdOrKey: string, input: JiraRemoteIssueLinkInput): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/rest/api/3/issue/remotelink', () => this.request(`/rest/api/3/issue/${pathSegment(issueIdOrKey, 'issueIdOrKey')}/remotelink`, { method: 'POST', body: validatedRemoteIssueLinkInput(input) }));
  }

  jiraGetRemoteIssueLink(issueIdOrKey: string, linkId: string): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/rest/api/3/issue/remotelink', () => this.request(`/rest/api/3/issue/${pathSegment(issueIdOrKey, 'issueIdOrKey')}/remotelink/${pathSegment(linkId, 'linkId')}`));
  }

  jiraUpdateRemoteIssueLink(issueIdOrKey: string, linkId: string, input: JiraRemoteIssueLinkInput): Promise<AtlassianResult<null>> {
    return this.safeRequest('/rest/api/3/issue/remotelink', () => this.request(`/rest/api/3/issue/${pathSegment(issueIdOrKey, 'issueIdOrKey')}/remotelink/${pathSegment(linkId, 'linkId')}`, { method: 'PUT', body: validatedRemoteIssueLinkInput(input) }));
  }

  jiraDeleteRemoteIssueLink(issueIdOrKey: string, linkId: string): Promise<AtlassianResult<null>> {
    return this.safeRequest('/rest/api/3/issue/remotelink', () => this.request(`/rest/api/3/issue/${pathSegment(issueIdOrKey, 'issueIdOrKey')}/remotelink/${pathSegment(linkId, 'linkId')}`, { method: 'DELETE' }));
  }

  jiraDeleteRemoteIssueLinkByGlobalId(issueIdOrKey: string, globalId: string): Promise<AtlassianResult<null>> {
    return this.safeRequest('/rest/api/3/issue/remotelink', () => {
      const query = new URLSearchParams({ globalId: boundedOpaque(globalId, 'globalId') });
      return this.request(`/rest/api/3/issue/${pathSegment(issueIdOrKey, 'issueIdOrKey')}/remotelink?${query}` , { method: 'DELETE' });
    });
  }

  jiraGetIssueTypeFields(projectIdOrKey: string, issueTypeId: string, options: JiraPageOptions = {}): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/rest/api/3/issue/createmeta/issuetypes', () => {
      const query = jiraPageQuery(options, 200);
      return this.request(`/rest/api/3/issue/createmeta/${pathSegment(projectIdOrKey, 'projectIdOrKey')}/issuetypes/${pathSegment(issueTypeId, 'issueTypeId')}${query.size ? `?${query}` : ''}`);
    });
  }

  jiraGetProjectIssueTypes(projectIdOrKey: string, options: JiraPageOptions = {}): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/rest/api/3/issue/createmeta/issuetypes', () => {
      const query = jiraPageQuery(options, 200);
      return this.request(`/rest/api/3/issue/createmeta/${pathSegment(projectIdOrKey, 'projectIdOrKey')}/issuetypes${query.size ? `?${query}` : ''}`);
    });
  }

  jiraGetIssueLinkTypes(): Promise<AtlassianResult<unknown>> {
    return this.request('/rest/api/3/issueLinkType');
  }

  jiraGetVisibleProjects(options: JiraPageOptions & { query?: string } = {}): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/rest/api/3/project/search', () => {
      const query = jiraPageQuery(options, 100);
      if (options.query) query.set('query', boundedQuery(options.query, 'query'));
      return this.request(`/rest/api/3/project/search${query.size ? `?${query}` : ''}`);
    });
  }

  jiraLookupAccountIds(input: { query: string; maxResults?: number }): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/rest/api/3/user/picker', () => {
      const query = new URLSearchParams({ query: boundedQuery(input.query, 'query') });
      if (input.maxResults !== undefined) query.set('maxResults', boundedInteger(input.maxResults, 'maxResults', 1, 100).toString());
      return this.request(`/rest/api/3/user/picker?${query}`);
    });
  }

  jiraAddComment(issueIdOrKey: string, input: JiraCommentInput): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/rest/api/3/issue/comment', () => this.request(`/rest/api/3/issue/${pathSegment(issueIdOrKey, 'issueIdOrKey')}/comment`, { method: 'POST', body: input }));
  }

  jiraAddWorklog(issueIdOrKey: string, input: JiraWorklogInput, options: JiraWorklogOptions = {}): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/rest/api/3/issue/worklog', () => {
      boundedInteger(input.timeSpentSeconds, 'timeSpentSeconds', 1, 31_536_000);
      validateJiraWorklogMutationOptions(options);
      const query = jiraWorklogMutationQuery(options);
      return this.request(`/rest/api/3/issue/${pathSegment(issueIdOrKey, 'issueIdOrKey')}/worklog${query.size ? `?${query}` : ''}`, { method: 'POST', body: input });
    });
  }

  jiraGetIssueWorklogs(issueIdOrKey: string, options: JiraWorklogListOptions = {}): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/rest/api/3/issue/worklog', () => {
      const query = new URLSearchParams();
      if (options.startAt !== undefined) query.set('startAt', boundedInteger(options.startAt, 'startAt', 0, 1_000_000).toString());
      if (options.maxResults !== undefined) query.set('maxResults', boundedInteger(options.maxResults, 'maxResults', 1, 1_000).toString());
      if (options.startedAfter !== undefined) query.set('startedAfter', boundedInteger(options.startedAfter, 'startedAfter', 0, Number.MAX_SAFE_INTEGER).toString());
      if (options.startedBefore !== undefined) query.set('startedBefore', boundedInteger(options.startedBefore, 'startedBefore', 0, Number.MAX_SAFE_INTEGER).toString());
      if (options.expand) query.set('expand', boundedQuery(options.expand, 'expand'));
      return this.request(`/rest/api/3/issue/${pathSegment(issueIdOrKey, 'issueIdOrKey')}/worklog${query.size ? `?${query}` : ''}`);
    });
  }

  jiraEditWorklog(issueIdOrKey: string, worklogId: string, input: JiraWorklogInput, options: JiraWorklogOptions = {}): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/rest/api/3/issue/worklog', () => {
      boundedInteger(input.timeSpentSeconds, 'timeSpentSeconds', 1, 31_536_000);
      validateJiraWorklogMutationOptions(options);
      const query = jiraWorklogMutationQuery(options);
      return this.request(`/rest/api/3/issue/${pathSegment(issueIdOrKey, 'issueIdOrKey')}/worklog/${pathSegment(worklogId, 'worklogId')}${query.size ? `?${query}` : ''}`, { method: 'PUT', body: input });
    });
  }

  jiraGetProjectVersions(projectIdOrKey: string, options: JiraProjectVersionOptions = {}): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/rest/api/3/project/versions', () => {
      const query = new URLSearchParams();
      if (options.expand) query.set('expand', boundedQuery(options.expand, 'expand'));
      return this.request(`/rest/api/3/project/${pathSegment(projectIdOrKey, 'projectIdOrKey')}/versions${query.size ? `?${query}` : ''}`);
    });
  }

  jiraFindAssignableUsers(input: JiraAssignableUsersInput): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/rest/api/3/user/assignable/search', () => {
      const hasProjectKeys = input.projectKeys !== undefined;
      const hasIssueOrProject = input.issueKey !== undefined || input.project !== undefined;
      if (hasProjectKeys === hasIssueOrProject || (hasProjectKeys && input.projectKeys!.length === 0)) {
        throw new Error('Exactly one assignable-user scope is required');
      }
      const route = hasProjectKeys ? '/rest/api/3/user/assignable/multiProjectSearch' : '/rest/api/3/user/assignable/search';
      const query = new URLSearchParams();
      if (input.query) query.set('query', boundedQuery(input.query, 'query'));
      if (input.accountId) query.set('accountId', boundedOpaque(input.accountId, 'accountId'));
      if (input.projectKeys) query.set('projectKeys', boundedList(input.projectKeys, 'projectKeys', 50));
      if (input.issueKey) query.set('issueKey', boundedOpaque(input.issueKey, 'issueKey'));
      if (input.project) query.set('project', boundedOpaque(input.project, 'project'));
      if (input.startAt !== undefined) query.set('startAt', boundedInteger(input.startAt, 'startAt', 0, 1_000_000).toString());
      if (input.maxResults !== undefined) query.set('maxResults', boundedInteger(input.maxResults, 'maxResults', 1, 1_000).toString());
      if (input.actionDescriptorId !== undefined) query.set('actionDescriptorId', boundedInteger(input.actionDescriptorId, 'actionDescriptorId', 0, 1_000_000).toString());
      return this.request(`${route}?${query}`);
    });
  }

  confluenceSearchCql(input: { cql: string; limit?: number; cursor?: string }): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/wiki/rest/api/search', () => {
      const query = new URLSearchParams({ cql: boundedQuery(input.cql, 'cql') });
      if (input.limit !== undefined) query.set('limit', boundedInteger(input.limit, 'limit', 1, 250).toString());
      if (input.cursor) query.set('cursor', boundedOpaque(input.cursor, 'cursor'));
      return this.request(`/wiki/rest/api/search?${query.toString()}`);
    });
  }

  confluenceGetPage(pageId: string, bodyFormat: 'storage' | 'atlas_doc_format' | 'view' = 'atlas_doc_format'): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/wiki/api/v2/pages', () => {
      const query = new URLSearchParams({ 'body-format': bodyFormat });
      return this.request(`/wiki/api/v2/pages/${pathSegment(pageId, 'pageId')}?${query}`);
    });
  }

  confluenceCreatePage(input: ConfluencePageInput): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/wiki/api/v2/pages', () => this.request('/wiki/api/v2/pages', { method: 'POST', body: input }));
  }

  confluenceUpdatePage(input: ConfluencePageUpdate): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/wiki/api/v2/pages', () => this.request(`/wiki/api/v2/pages/${pathSegment(input.id, 'pageId')}`, { method: 'PUT', body: input }));
  }

  confluenceDeletePage(pageId: string, options: ConfluencePageDeleteOptions = {}): Promise<AtlassianResult<null>> {
    return this.safeRequest('/wiki/api/v2/pages', () => {
      const query = confluencePageDeleteQuery(options);
      return this.request(`/wiki/api/v2/pages/${pathSegment(pageId, 'pageId')}${query.size ? `?${query}` : ''}`, { method: 'DELETE' });
    });
  }

  confluenceGetPageDescendants(pageId: string, options: ConfluencePageOptions & { depth?: number } = {}): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/wiki/api/v2/pages/descendants', () => {
      const query = new URLSearchParams();
      if (options.limit !== undefined) query.set('limit', boundedInteger(options.limit, 'limit', 1, 250).toString());
      if (options.depth !== undefined) query.set('depth', boundedInteger(options.depth, 'depth', 1, 10).toString());
      if (options.cursor) query.set('cursor', boundedOpaque(options.cursor, 'cursor'));
      return this.request(`/wiki/api/v2/pages/${pathSegment(pageId, 'pageId')}/descendants${query.size ? `?${query}` : ''}`);
    });
  }

  confluenceGetPageFooterComments(pageId: string, options: ConfluencePageOptions = {}): Promise<AtlassianResult<unknown>> {
    return this.confluencePageCollection(pageId, 'footer-comments', options);
  }

  confluenceGetPageInlineComments(pageId: string, options: ConfluencePageOptions = {}): Promise<AtlassianResult<unknown>> {
    return this.confluencePageCollection(pageId, 'inline-comments', options);
  }

  confluenceGetFooterComment(commentId: string, options: ConfluenceCommentGetOptions = {}): Promise<AtlassianResult<unknown>> {
    return this.confluenceGetComment('footer-comments', commentId, options);
  }

  confluenceUpdateFooterComment(commentId: string, input: ConfluenceFooterCommentUpdate): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/wiki/api/v2/footer-comments', () => this.request(`/wiki/api/v2/footer-comments/${pathSegment(commentId, 'commentId')}`, {
      method: 'PUT',
      body: validatedFooterCommentUpdate(input),
    }));
  }

  confluenceDeleteFooterComment(commentId: string): Promise<AtlassianResult<null>> {
    return this.safeRequest('/wiki/api/v2/footer-comments', () => this.request(`/wiki/api/v2/footer-comments/${pathSegment(commentId, 'commentId')}`, { method: 'DELETE' }));
  }

  confluenceGetInlineComment(commentId: string, options: ConfluenceCommentGetOptions = {}): Promise<AtlassianResult<unknown>> {
    return this.confluenceGetComment('inline-comments', commentId, options);
  }

  confluenceUpdateInlineComment(commentId: string, input: ConfluenceInlineCommentUpdate): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/wiki/api/v2/inline-comments', () => this.request(`/wiki/api/v2/inline-comments/${pathSegment(commentId, 'commentId')}`, {
      method: 'PUT',
      body: validatedInlineCommentUpdate(input),
    }));
  }

  confluenceDeleteInlineComment(commentId: string): Promise<AtlassianResult<null>> {
    return this.safeRequest('/wiki/api/v2/inline-comments', () => this.request(`/wiki/api/v2/inline-comments/${pathSegment(commentId, 'commentId')}`, { method: 'DELETE' }));
  }

  confluenceGetCommentChildren(type: 'footer' | 'inline', commentId: string, options: ConfluencePageOptions = {}): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/wiki/api/v2/comments/children', () => {
      const query = confluencePageQuery(options);
      const collection = type === 'footer' ? 'footer-comments' : 'inline-comments';
      return this.request(`/wiki/api/v2/${collection}/${pathSegment(commentId, 'commentId')}/children${query.size ? `?${query}` : ''}`);
    });
  }

  confluenceGetSpaces(options: ConfluencePageOptions & { keys?: readonly string[]; type?: string; status?: string } = {}): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/wiki/api/v2/spaces', () => {
      const query = new URLSearchParams();
      if (options.keys?.length) query.set('keys', boundedList(options.keys, 'keys', 250));
      if (options.type) query.set('type', boundedOpaque(options.type, 'type'));
      if (options.status) query.set('status', boundedOpaque(options.status, 'status'));
      appendConfluencePageQuery(query, options);
      return this.request(`/wiki/api/v2/spaces${query.size ? `?${query}` : ''}`);
    });
  }

  confluenceGetPagesInSpace(spaceId: string, options: ConfluencePageOptions & { depth?: 'all' | 'root'; status?: readonly ('current' | 'archived' | 'deleted' | 'trashed')[]; title?: string; bodyFormat?: 'storage' | 'atlas_doc_format' } = {}): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/wiki/api/v2/spaces/pages', () => {
      const query = new URLSearchParams();
      if (options.depth) query.set('depth', options.depth);
      if (options.status?.length) query.set('status', boundedList(options.status, 'status', 4));
      if (options.title) query.set('title', boundedQuery(options.title, 'title'));
      if (options.bodyFormat) query.set('body-format', options.bodyFormat);
      appendConfluencePageQuery(query, options);
      return this.request(`/wiki/api/v2/spaces/${pathSegment(spaceId, 'spaceId')}/pages${query.size ? `?${query}` : ''}`);
    });
  }

  confluenceCreateFooterComment(input: ConfluenceFooterCommentInput): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/wiki/api/v2/footer-comments', () => this.request('/wiki/api/v2/footer-comments', { method: 'POST', body: input }));
  }

  confluenceCreateInlineComment(input: ConfluenceInlineCommentInput): Promise<AtlassianResult<unknown>> {
    return this.safeRequest('/wiki/api/v2/inline-comments', () => this.request('/wiki/api/v2/inline-comments', { method: 'POST', body: input }));
  }

  private confluencePageCollection(pageId: string, collection: 'footer-comments' | 'inline-comments', options: ConfluencePageOptions): Promise<AtlassianResult<unknown>> {
    return this.safeRequest(`/wiki/api/v2/pages/${collection}`, () => {
      const query = confluencePageQuery(options);
      return this.request(`/wiki/api/v2/pages/${pathSegment(pageId, 'pageId')}/${collection}${query.size ? `?${query}` : ''}`);
    });
  }

  private confluenceGetComment(collection: 'footer-comments' | 'inline-comments', commentId: string, options: ConfluenceCommentGetOptions): Promise<AtlassianResult<unknown>> {
    return this.safeRequest(`/wiki/api/v2/${collection}`, () => {
      const query = confluenceCommentQuery(options);
      return this.request(`/wiki/api/v2/${collection}/${pathSegment(commentId, 'commentId')}${query.size ? `?${query}` : ''}`);
    });
  }

  private safeRequest<T>(requestPath: string, build: () => Promise<AtlassianResult<T>>): Promise<AtlassianResult<T>> {
    try {
      return build();
    } catch {
      return Promise.resolve(failure('invalid-request', 'Invalid Atlassian API request.', requestPath));
    }
  }

  private async request<T = unknown>(path: string, options: { method?: string; body?: unknown; responseType?: 'json' | 'text' } = {}): Promise<AtlassianResult<T>> {
    let url: URL;
    try {
      url = new URL(path, this.origin);
      if (url.origin !== this.origin.origin || !url.pathname.startsWith('/rest/') && !url.pathname.startsWith('/wiki/')) {
        throw new Error('path outside Atlassian API origin');
      }
    } catch {
      return failure('invalid-request', 'Invalid Atlassian API path.', path);
    }

    let token: string | undefined;
    let serializedBody: string | undefined;
    try {
      const providedToken = await this.authProvider();
      token = typeof providedToken === 'string' ? providedToken.trim() : undefined;
      if (!token && this.credentialMode === 'direct') {
        return failure('credentials-unavailable', 'Atlassian API credentials are unavailable.', url.pathname + url.search);
      }
      serializedBody = options.body === undefined ? undefined : boundedJsonBody(options.body);
    } catch {
      return failure('invalid-request', 'Invalid Atlassian API request.', url.pathname + url.search);
    }
    const headers = new Headers({ Accept: 'application/json' });
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: options.method ?? 'GET',
        headers,
        ...(serializedBody === undefined ? {} : { body: serializedBody }),
        signal: controller.signal,
      });
      const boundedResponse = await readBoundedText(response, controller.signal);
      if (!boundedResponse.ok) return failure('response-too-large', 'Atlassian API response exceeded the configured limit.', url.pathname + url.search, response.status);
      const text = boundedResponse.text;
      if (!response.ok) {
        return failure('http', `Atlassian API returned HTTP ${response.status}.`, url.pathname + url.search, response.status);
      }
      if (!text.trim()) return { ok: true, data: null as T, status: response.status };
      if (options.responseType === 'text') return { ok: true, data: text as T, status: response.status };
      try {
        return { ok: true, data: JSON.parse(text) as T, status: response.status };
      } catch {
        return failure('malformed-response', 'Atlassian API returned malformed JSON.', url.pathname + url.search, response.status);
      }
    } catch (error) {
      if (controller.signal.aborted) return failure('timeout', 'Atlassian API request timed out.', url.pathname + url.search);
      return failure('network', 'Atlassian API request failed.', url.pathname + url.search);
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseSiteUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.port
    || url.pathname !== '/'
    || url.search
    || url.hash
    || !isAtlassianCloudSiteHost(url.hostname)
  ) throw new Error('siteUrl must target an Atlassian Cloud site');
  return url;
}

function isAtlassianCloudSiteHost(hostname: string): boolean {
  const suffix = '.atlassian.net';
  if (!hostname.endsWith(suffix)) return false;
  const site = hostname.slice(0, -suffix.length);
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(site);
}

function normalizeTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(100, Math.floor(value!)));
}

function pathSegment(value: string, field: string): string {
  return encodeURIComponent(boundedOpaque(value, field));
}

function boundedOpaque(value: string, field: string): string {
  if (typeof value !== 'string' || !value.trim() || new TextEncoder().encode(value).byteLength > MAX_QUERY_TEXT || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${field} is invalid`);
  }
  return value.trim();
}

function boundedQuery(value: string, field: string): string {
  return boundedOpaque(value, field);
}

function boundedIssueReference(value: Readonly<{ id?: string; key?: string }>, field: string): Readonly<{ id?: string; key?: string }> {
  const id = value.id === undefined ? undefined : boundedOpaque(value.id, `${field}.id`);
  const key = value.key === undefined ? undefined : boundedOpaque(value.key, `${field}.key`);
  if ((id ? 1 : 0) + (key ? 1 : 0) !== 1) throw new Error(`${field} is invalid`);
  return { ...(id ? { id } : {}), ...(key ? { key } : {}) };
}

function boundedLinkTypeReference(value: Readonly<{ id?: string; name?: string }>): Readonly<{ id?: string; name?: string }> {
  const id = value.id === undefined ? undefined : boundedOpaque(value.id, 'type.id');
  const name = value.name === undefined ? undefined : boundedOpaque(value.name, 'type.name');
  if ((id ? 1 : 0) + (name ? 1 : 0) !== 1) throw new Error('type is invalid');
  return { ...(id ? { id } : {}), ...(name ? { name } : {}) };
}

function validatedIssueLinkInput(input: JiraIssueLinkInput): JiraIssueLinkInput {
  return {
    inwardIssue: boundedIssueReference(input.inwardIssue, 'inwardIssue'),
    outwardIssue: boundedIssueReference(input.outwardIssue, 'outwardIssue'),
    type: boundedLinkTypeReference(input.type),
    ...(input.comment === undefined ? {} : { comment: input.comment }),
  };
}

function validatedRemoteIssueLinkInput(input: JiraRemoteIssueLinkInput): JiraRemoteIssueLinkInput {
  if (!input.object || typeof input.object !== 'object' || Array.isArray(input.object)) throw new Error('object is invalid');
  return {
    ...(input.application === undefined ? {} : { application: input.application }),
    ...(input.globalId === undefined ? {} : { globalId: boundedOpaque(input.globalId, 'globalId') }),
    object: input.object,
    ...(input.relationship === undefined ? {} : { relationship: boundedOpaque(input.relationship, 'relationship') }),
  };
}

function boundedInteger(value: number, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${field} is invalid`);
  return value;
}

function jiraPageQuery(options: JiraPageOptions, maxResults: number): URLSearchParams {
  const query = new URLSearchParams();
  if (options.startAt !== undefined) query.set('startAt', boundedInteger(options.startAt, 'startAt', 0, 1_000_000).toString());
  if (options.maxResults !== undefined) query.set('maxResults', boundedInteger(options.maxResults, 'maxResults', 1, maxResults).toString());
  return query;
}

function jiraWorklogMutationQuery(options: JiraWorklogOptions): URLSearchParams {
  const query = new URLSearchParams();
  if (options.notifyUsers !== undefined) query.set('notifyUsers', String(boundedBoolean(options.notifyUsers, 'notifyUsers')));
  if (options.adjustEstimate) query.set('adjustEstimate', options.adjustEstimate);
  if (options.newEstimate) query.set('newEstimate', boundedOpaque(options.newEstimate, 'newEstimate'));
  if (options.reduceBy) query.set('reduceBy', boundedOpaque(options.reduceBy, 'reduceBy'));
  if (options.expand) query.set('expand', boundedQuery(options.expand, 'expand'));
  if (options.overrideEditableFlag !== undefined) query.set('overrideEditableFlag', String(boundedBoolean(options.overrideEditableFlag, 'overrideEditableFlag')));
  return query;
}

function validateJiraWorklogMutationOptions(options: JiraWorklogOptions): void {
  if (options.adjustEstimate === 'new' && options.newEstimate === undefined) {
    throw new Error('newEstimate is required for the new adjustment mode');
  }
  if (options.adjustEstimate === 'manual' && options.reduceBy === undefined) {
    throw new Error('reduceBy is required for the manual adjustment mode');
  }
  if (options.newEstimate !== undefined) boundedOpaque(options.newEstimate, 'newEstimate');
  if (options.reduceBy !== undefined) boundedOpaque(options.reduceBy, 'reduceBy');
}

function confluencePageQuery(options: ConfluencePageOptions): URLSearchParams {
  const query = new URLSearchParams();
  appendConfluencePageQuery(query, options);
  return query;
}

function appendConfluencePageQuery(query: URLSearchParams, options: ConfluencePageOptions): void {
  if (options.limit !== undefined) query.set('limit', boundedInteger(options.limit, 'limit', 1, 250).toString());
  if (options.cursor) query.set('cursor', boundedOpaque(options.cursor, 'cursor'));
}

function confluenceCommentQuery(options: ConfluenceCommentGetOptions): URLSearchParams {
  const query = new URLSearchParams();
  if (options.bodyFormat) query.set('body-format', options.bodyFormat);
  if (options.version !== undefined) query.set('version', boundedInteger(options.version, 'version', 1, 1_000_000).toString());
  appendBooleanQuery(query, 'include-properties', options.includeProperties);
  appendBooleanQuery(query, 'include-operations', options.includeOperations);
  appendBooleanQuery(query, 'include-likes', options.includeLikes);
  appendBooleanQuery(query, 'include-versions', options.includeVersions);
  appendBooleanQuery(query, 'include-version', options.includeVersion);
  return query;
}

function appendBooleanQuery(query: URLSearchParams, name: string, value: boolean | undefined): void {
  if (value !== undefined) query.set(name, String(boundedBoolean(value, name)));
}

function boundedBoolean(value: boolean, field: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${field} is invalid`);
  return value;
}

function boundedCommentVersion(value: ConfluenceCommentVersion): ConfluenceCommentVersion {
  return {
    number: boundedInteger(value.number, 'version.number', 1, 1_000_000),
    ...(value.message === undefined ? {} : { message: boundedOpaque(value.message, 'version.message') }),
  };
}

function boundedCommentBody(value: ConfluenceCommentBody | Record<string, unknown>): ConfluenceCommentBody | Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('body is invalid');
  return value;
}

function validatedFooterCommentUpdate(input: ConfluenceFooterCommentUpdate): ConfluenceFooterCommentUpdate {
  return {
    version: boundedCommentVersion(input.version),
    body: boundedCommentBody(input.body),
    ...(input._links === undefined ? {} : {
      _links: {
        base: boundedOpaque(input._links.base, '_links.base'),
      },
    }),
  };
}

function validatedInlineCommentUpdate(input: ConfluenceInlineCommentUpdate): ConfluenceInlineCommentUpdate {
  if (input.body === undefined && input.resolved === undefined) throw new Error('inline comment update is invalid');
  return {
    version: boundedCommentVersion(input.version),
    ...(input.body === undefined ? {} : { body: boundedCommentBody(input.body) }),
    ...(input.resolved === undefined ? {} : { resolved: boundedBoolean(input.resolved, 'resolved') }),
  };
}

function confluencePageDeleteQuery(options: ConfluencePageDeleteOptions): URLSearchParams {
  if (typeof options.draft !== 'undefined' && typeof options.draft !== 'boolean') throw new Error('draft is invalid');
  if (typeof options.purge !== 'undefined' && typeof options.purge !== 'boolean') throw new Error('purge is invalid');
  if (options.draft === true && options.purge === true) throw new Error('draft and purge cannot both be requested');
  const query = new URLSearchParams();
  if (options.draft !== undefined) query.set('draft', String(options.draft));
  if (options.purge !== undefined) query.set('purge', String(options.purge));
  return query;
}

function boundedList(values: readonly string[], field: string, maxItems: number): string {
  if (values.length < 1 || values.length > maxItems) throw new Error(`${field} is invalid`);
  return values.map((value) => boundedOpaque(value, field)).join(',');
}

function boundedJsonBody(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined || new TextEncoder().encode(encoded).byteLength > MAX_INPUT_JSON_BYTES) throw new Error('request body is invalid');
  return encoded;
}

async function readBoundedText(response: Response, signal: AbortSignal): Promise<{ ok: true; text: string } | { ok: false }> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (!response.body) return Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES ? { ok: false } : { ok: true, text: '' };
  const reader = response.body.getReader();
  const cancelReader = () => {
    void reader.cancel().catch(() => undefined);
  };
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    cancelReader();
    return { ok: false };
  }
  const abortError = () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    return error;
  };
  const throwIfAborted = () => {
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : abortError();
  };
  let onAbort: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    onAbort = () => {
      cancelReader();
      reject(signal.reason instanceof Error ? signal.reason : abortError());
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await Promise.race([reader.read(), abortPromise]);
      throwIfAborted();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        cancelReader();
        return { ok: false };
      }
      chunks.push(next.value);
    }
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
  throwIfAborted();
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(bytes) };
}

function failure(code: AtlassianClientErrorCode, message: string, requestPath: string, status?: number): AtlassianResult<never> {
  return { ok: false, error: { code, message: redact(message), ...(status === undefined ? {} : { status }), requestPath: redact(requestPath) } };
}

function redact(value: string): string {
  return value
    .replace(/authorization\s*[:=]\s*[^\s]+/giu, 'Authorization: <redacted>')
    .replace(/\b(?:bearer|token|secret|password|device[- ]?code)\b\s*[:=]?\s*[^\s]+/giu, '$1 <redacted>')
    .slice(0, MAX_ERROR_TEXT);
}
