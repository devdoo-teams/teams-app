export type BitbucketAuthProvider = () => Promise<string | undefined> | string | undefined;
export type BitbucketFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type BitbucketClientErrorCode = 'invalid-request' | 'credentials-unavailable' | 'timeout' | 'network' | 'http' | 'malformed-response' | 'response-too-large';
export type BitbucketClientError = Readonly<{
  code: BitbucketClientErrorCode;
  message: string;
  requestPath: string;
  status?: number;
}>;
export type BitbucketResult<T> =
  | Readonly<{ ok: true; data: T; status: number }>
  | Readonly<{ ok: false; error: BitbucketClientError }>;

export type BitbucketClientOptions = Readonly<{
  authProvider: BitbucketAuthProvider;
  /** Broker-owned requests deliberately omit a direct credential. */
  credentialMode?: 'direct' | 'broker';
  baseUrl?: string;
  fetchImpl?: BitbucketFetch;
  timeoutMs?: number;
}>;

export type BitbucketPageOptions = Readonly<{ page?: number; pagelen?: number }>;
export type BitbucketWorkspacePermissionListOptions = Readonly<BitbucketPageOptions & { q?: string }>;
export type BitbucketBranchListOptions = Readonly<BitbucketPageOptions & { q?: string; sort?: string }>;
export type BitbucketCommitsForRevisionOptions = Readonly<BitbucketPageOptions & {
  path?: string;
  include?: readonly string[];
  exclude?: readonly string[];
}>;
export type BitbucketFileHistoryOptions = Readonly<BitbucketPageOptions & {
  renames?: boolean;
  q?: string;
  sort?: string;
}>;
export type BitbucketPullRequestStatusesOptions = Readonly<{ q?: string; sort?: string }>;
export type BitbucketSourceRootOptions = Readonly<{ format?: 'meta' | 'rendered' }>;
export type BitbucketPullRequestCreateInput = Readonly<{
  title: string;
  source: Record<string, unknown>;
  destination: Record<string, unknown>;
  description?: string;
  close_source_branch?: boolean;
  reviewers?: readonly Record<string, unknown>[];
}>;
export type BitbucketPullRequestUpdateInput = Readonly<Record<string, unknown>>;
export type BitbucketBranchCreateInput = Readonly<{
  name: string;
  target: Readonly<{ hash: string }>;
}>;
export type BitbucketCommitCreateInput = Readonly<{
  files?: readonly Readonly<{ path: string; content: string }>[];
  deleteFiles?: readonly string[];
  message?: string;
  author?: string;
  parents?: string;
  branch?: string;
}>;
export type BitbucketRepositoryPermission = 'admin' | 'write' | 'read';
export type BitbucketRepositoryPermissionUpdateInput = Readonly<{
  permission: BitbucketRepositoryPermission;
}>;

const DEFAULT_BASE_URL = 'https://api.bitbucket.org/2.0/';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_VALUE_LENGTH = 512;
const MAX_ERROR_TEXT = 1_000;
const MAX_INPUT_JSON_BYTES = 64_000;
const MAX_RESPONSE_BYTES = 256_000;

export class BitbucketCloudClient {
  private readonly baseUrl: URL;
  private readonly authProvider: BitbucketAuthProvider;
  private readonly credentialMode: 'direct' | 'broker';
  private readonly fetchImpl: BitbucketFetch;
  private readonly timeoutMs: number;

  constructor(options: BitbucketClientOptions) {
    this.baseUrl = parseBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.authProvider = options.authProvider;
    this.credentialMode = options.credentialMode === 'broker' ? 'broker' : 'direct';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = normalizeTimeout(options.timeoutMs);
  }

  currentUser(): Promise<BitbucketResult<unknown>> {
    return this.request('/user');
  }

  workspaces(options: { page?: number; pagelen?: number } = {}): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/workspaces', () => this.request(`/workspaces?${pageQuery(options)}`));
  }

  workspacePermissions(workspace: string, options: BitbucketWorkspacePermissionListOptions = {}): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/workspaces/permissions', () => {
      const query = pageQuery(options);
      if (options.q !== undefined) query.set('q', bounded(options.q, 'q'));
      return this.request(`/workspaces/${segment(workspace, 'workspace')}/permissions${query.size ? `?${query}` : ''}`);
    });
  }

  repositories(workspace: string, options: { page?: number; pagelen?: number; q?: string } = {}): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/repositories', () => {
      const query = pageQuery(options);
      if (options.q) query.set('q', bounded(options.q, 'q'));
      return this.request(`/repositories/${segment(workspace, 'workspace')}?${query}`);
    });
  }

  commits(workspace: string, repository: string, options: { page?: number; pagelen?: number; include?: string } = {}): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/repositories/commits', () => {
      const query = pageQuery(options);
      if (options.include) query.set('include', bounded(options.include, 'include'));
      return this.request(`/repositories/${segment(workspace, 'workspace')}/${segment(repository, 'repository')}/commits?${query}`);
    });
  }

  pullRequests(workspace: string, repository: string, options: { page?: number; pagelen?: number; state?: string } = {}): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/repositories/pullrequests', () => {
      const query = pageQuery(options);
      if (options.state) query.set('state', bounded(options.state, 'state'));
      return this.request(`/repositories/${segment(workspace, 'workspace')}/${segment(repository, 'repository')}/pullrequests?${query}`);
    });
  }

  issues(workspace: string, repository: string, options: { page?: number; pagelen?: number; priority?: string; status?: string } = {}): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/repositories/issues', () => {
      const query = pageQuery(options);
      if (options.priority) query.set('priority', bounded(options.priority, 'priority'));
      if (options.status) query.set('status', bounded(options.status, 'status'));
      return this.request(`/repositories/${segment(workspace, 'workspace')}/${segment(repository, 'repository')}/issues?${query}`);
    });
  }

  workspace(workspace: string): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/workspaces', () => this.request(`/workspaces/${segment(workspace, 'workspace')}`));
  }

  repository(workspace: string, repository: string): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/repositories', () => this.request(repositoryPath(workspace, repository)));
  }

  defaultReviewers(workspace: string, repository: string, options: BitbucketPageOptions = {}): Promise<BitbucketResult<unknown>> {
    return this.repositoryCollection(workspace, repository, 'effective-default-reviewers', options);
  }

  userPullRequests(workspace: string, selectedUser: string, options: BitbucketPageOptions & { state?: string } = {}): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/workspaces/pullrequests', () => {
      const query = pageQuery(options);
      if (options.state) query.set('state', bounded(options.state, 'state'));
      return this.request(`/workspaces/${segment(workspace, 'workspace')}/pullrequests/${segment(selectedUser, 'selectedUser')}${query.size ? `?${query}` : ''}`);
    });
  }

  deployments(workspace: string, repository: string, options: BitbucketPageOptions = {}): Promise<BitbucketResult<unknown>> {
    return this.repositoryCollection(workspace, repository, 'deployments', options);
  }

  deployment(workspace: string, repository: string, deploymentUuid: string): Promise<BitbucketResult<unknown>> {
    return this.repositoryItem(workspace, repository, 'deployments', deploymentUuid, 'deploymentUuid');
  }

  pullRequest(workspace: string, repository: string, pullRequestId: number): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/repositories/pullrequests', () => this.request(`${repositoryPath(workspace, repository)}/pullrequests/${id(pullRequestId, 'pullRequestId')}`));
  }

  pullRequestComments(workspace: string, repository: string, pullRequestId: number, options: BitbucketPageOptions = {}): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/repositories/pullrequests/comments', () => {
      const query = pageQuery(options);
      return this.request(`${repositoryPath(workspace, repository)}/pullrequests/${id(pullRequestId, 'pullRequestId')}/comments${query.size ? `?${query}` : ''}`);
    });
  }

  pullRequestActivity(workspace: string, repository: string, pullRequestId: number, options: BitbucketPageOptions = {}): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/repositories/pullrequests/activity', () => {
      const query = pageQuery(options);
      return this.request(`${repositoryPath(workspace, repository)}/pullrequests/${id(pullRequestId, 'pullRequestId')}/activity${query.size ? `?${query}` : ''}`);
    });
  }

  pullRequestDiff(workspace: string, repository: string, pullRequestId: number): Promise<BitbucketResult<string>> {
    return this.safeRequest('/2.0/repositories/pullrequests/diff', () => this.request(`${repositoryPath(workspace, repository)}/pullrequests/${id(pullRequestId, 'pullRequestId')}/diff`, { responseType: 'text' }));
  }

  pullRequestDiffstat(workspace: string, repository: string, pullRequestId: number): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/repositories/pullrequests/diffstat', () => this.request(`${repositoryPath(workspace, repository)}/pullrequests/${id(pullRequestId, 'pullRequestId')}/diffstat`));
  }

  pullRequestStatuses(workspace: string, repository: string, pullRequestId: number, options: BitbucketPullRequestStatusesOptions = {}): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/repositories/pullrequests/statuses', () => {
      const query = new URLSearchParams();
      if (options.q !== undefined) query.set('q', bounded(options.q, 'q'));
      if (options.sort !== undefined) query.set('sort', bounded(options.sort, 'sort'));
      return this.request(`${repositoryPath(workspace, repository)}/pullrequests/${id(pullRequestId, 'pullRequestId')}/statuses${query.size ? `?${query}` : ''}`);
    });
  }

  branch(workspace: string, repository: string, name: string): Promise<BitbucketResult<unknown>> {
    return this.repositoryItem(workspace, repository, 'refs/branches', name, 'branchName');
  }

  branches(workspace: string, repository: string, options: BitbucketBranchListOptions = {}): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/repositories/refs/branches', () => {
      const query = pageQuery(options);
      if (options.q !== undefined) query.set('q', bounded(options.q, 'q'));
      if (options.sort !== undefined) query.set('sort', bounded(options.sort, 'sort'));
      return this.request(`${repositoryPath(workspace, repository)}/refs/branches${query.size ? `?${query}` : ''}`);
    });
  }

  commit(workspace: string, repository: string, commit: string): Promise<BitbucketResult<unknown>> {
    return this.repositoryItem(workspace, repository, 'commit', commit, 'commit');
  }

  files(workspace: string, repository: string, commit: string, path: string): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/repositories/src', () => this.request(`${repositoryPath(workspace, repository)}/src/${segment(commit, 'commit')}/${segment(boundedPath(path, 'path'), 'path')}`, { responseType: 'auto' }));
  }

  commitsForRevision(workspace: string, repository: string, revision: string, options: BitbucketCommitsForRevisionOptions = {}): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/repositories/commits', () => {
      const query = pageQuery(options);
      if (options.path !== undefined) query.set('path', boundedPath(options.path, 'path'));
      appendBoundedQueryValues(query, 'include', options.include);
      appendBoundedQueryValues(query, 'exclude', options.exclude);
      return this.request(`${repositoryPath(workspace, repository)}/commits/${segment(revision, 'revision')}${query.size ? `?${query}` : ''}`);
    });
  }

  fileHistory(workspace: string, repository: string, commit: string, path: string, options: BitbucketFileHistoryOptions = {}): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/repositories/filehistory', () => {
      const query = pageQuery(options);
      if (options.renames !== undefined) query.set('renames', options.renames ? 'true' : 'false');
      if (options.q !== undefined) query.set('q', bounded(options.q, 'q'));
      if (options.sort !== undefined) query.set('sort', bounded(options.sort, 'sort'));
      return this.request(`${repositoryPath(workspace, repository)}/filehistory/${segment(commit, 'commit')}/${segment(boundedPath(path, 'path'), 'path')}${query.size ? `?${query}` : ''}`);
    });
  }

  sourceRoot(workspace: string, repository: string, commit: string, options: BitbucketSourceRootOptions = {}): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/repositories/src', () => {
      const query = new URLSearchParams();
      if (options.format !== undefined) query.set('format', boundedSourceFormat(options.format));
      return this.request(`${repositoryPath(workspace, repository)}/src/${segment(commit, 'commit')}/${query.size ? `?${query}` : ''}`);
    });
  }

  pipelines(workspace: string, repository: string, options: BitbucketPageOptions = {}): Promise<BitbucketResult<unknown>> {
    return this.repositoryCollection(workspace, repository, 'pipelines', options);
  }

  pipeline(workspace: string, repository: string, pipelineUuid: string): Promise<BitbucketResult<unknown>> {
    return this.repositoryItem(workspace, repository, 'pipelines', pipelineUuid, 'pipelineUuid');
  }

  pipelineSteps(workspace: string, repository: string, pipelineUuid: string, options: BitbucketPageOptions = {}): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/repositories/pipelines/steps', () => {
      const query = pageQuery(options);
      return this.request(`${repositoryPath(workspace, repository)}/pipelines/${segment(pipelineUuid, 'pipelineUuid')}/steps${query.size ? `?${query}` : ''}`);
    });
  }

  pipelineStep(workspace: string, repository: string, pipelineUuid: string, stepUuid: string): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/repositories/pipelines/steps', () => this.request(`${repositoryPath(workspace, repository)}/pipelines/${segment(pipelineUuid, 'pipelineUuid')}/steps/${segment(stepUuid, 'stepUuid')}`));
  }

  pipelineStepLog(workspace: string, repository: string, pipelineUuid: string, stepUuid: string): Promise<BitbucketResult<string>> {
    return this.safeRequest('/2.0/repositories/pipelines/steps/log', () => this.request(`${repositoryPath(workspace, repository)}/pipelines/${segment(pipelineUuid, 'pipelineUuid')}/steps/${segment(stepUuid, 'stepUuid')}/log`, { responseType: 'text' }));
  }

  stopPipeline(workspace: string, repository: string, pipelineUuid: string): Promise<BitbucketResult<null>> {
    return this.safeRequest('/2.0/repositories/pipelines/stop', () => this.request(`${repositoryPath(workspace, repository)}/pipelines/${segment(pipelineUuid, 'pipelineUuid')}/stopPipeline`, { method: 'POST' }));
  }

  environments(workspace: string, repository: string, options: BitbucketPageOptions = {}): Promise<BitbucketResult<unknown>> {
    return this.repositoryCollection(workspace, repository, 'environments', options);
  }

  environment(workspace: string, repository: string, environmentUuid: string): Promise<BitbucketResult<unknown>> {
    return this.repositoryItem(workspace, repository, 'environments', environmentUuid, 'environmentUuid');
  }

  repositoryUserPermissions(workspace: string, repository: string, options: BitbucketPageOptions = {}): Promise<BitbucketResult<unknown>> {
    return this.repositoryPermissionCollection(workspace, repository, 'users', options);
  }

  repositoryUserPermission(workspace: string, repository: string, selectedUser: string): Promise<BitbucketResult<unknown>> {
    return this.repositoryPermissionItem(workspace, repository, 'users', selectedUser, 'selectedUser');
  }

  updateRepositoryUserPermission(workspace: string, repository: string, selectedUser: string, input: BitbucketRepositoryPermissionUpdateInput): Promise<BitbucketResult<unknown>> {
    return this.updateRepositoryPermission(workspace, repository, 'users', selectedUser, 'selectedUser', input);
  }

  deleteRepositoryUserPermission(workspace: string, repository: string, selectedUser: string): Promise<BitbucketResult<null>> {
    return this.deleteRepositoryPermission(workspace, repository, 'users', selectedUser, 'selectedUser');
  }

  repositoryGroupPermissions(workspace: string, repository: string, options: BitbucketPageOptions = {}): Promise<BitbucketResult<unknown>> {
    return this.repositoryPermissionCollection(workspace, repository, 'groups', options);
  }

  repositoryGroupPermission(workspace: string, repository: string, groupSlug: string): Promise<BitbucketResult<unknown>> {
    return this.repositoryPermissionItem(workspace, repository, 'groups', groupSlug, 'groupSlug');
  }

  updateRepositoryGroupPermission(workspace: string, repository: string, groupSlug: string, input: BitbucketRepositoryPermissionUpdateInput): Promise<BitbucketResult<unknown>> {
    return this.updateRepositoryPermission(workspace, repository, 'groups', groupSlug, 'groupSlug', input);
  }

  deleteRepositoryGroupPermission(workspace: string, repository: string, groupSlug: string): Promise<BitbucketResult<null>> {
    return this.deleteRepositoryPermission(workspace, repository, 'groups', groupSlug, 'groupSlug');
  }

  createPullRequest(workspace: string, repository: string, input: BitbucketPullRequestCreateInput): Promise<BitbucketResult<unknown>> {
    return this.repositoryWrite(workspace, repository, 'pullrequests', 'POST', input);
  }

  mergePullRequest(workspace: string, repository: string, pullRequestId: number, input: Record<string, unknown> = {}): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/repositories/pullrequests/merge', () => this.request(`${repositoryPath(workspace, repository)}/pullrequests/${id(pullRequestId, 'pullRequestId')}/merge`, { method: 'POST', body: input }));
  }

  approvePullRequest(workspace: string, repository: string, pullRequestId: number): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/repositories/pullrequests/approve', () => this.request(`${repositoryPath(workspace, repository)}/pullrequests/${id(pullRequestId, 'pullRequestId')}/approve`, { method: 'POST' }));
  }

  updatePullRequest(workspace: string, repository: string, pullRequestId: number, input: BitbucketPullRequestUpdateInput): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/repositories/pullrequests', () => this.request(`${repositoryPath(workspace, repository)}/pullrequests/${id(pullRequestId, 'pullRequestId')}`, { method: 'PUT', body: boundedPullRequestUpdateInput(input) }));
  }

  declinePullRequest(workspace: string, repository: string, pullRequestId: number): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/repositories/pullrequests/decline', () => this.request(`${repositoryPath(workspace, repository)}/pullrequests/${id(pullRequestId, 'pullRequestId')}/decline`, { method: 'POST' }));
  }

  unapprovePullRequest(workspace: string, repository: string, pullRequestId: number): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/repositories/pullrequests/approve', () => this.request(`${repositoryPath(workspace, repository)}/pullrequests/${id(pullRequestId, 'pullRequestId')}/approve`, { method: 'DELETE' }));
  }

  addPullRequestComment(workspace: string, repository: string, pullRequestId: number, input: Record<string, unknown>): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/repositories/pullrequests/comments', () => this.request(`${repositoryPath(workspace, repository)}/pullrequests/${id(pullRequestId, 'pullRequestId')}/comments`, { method: 'POST', body: input }));
  }

  createBranch(workspace: string, repository: string, input: BitbucketBranchCreateInput): Promise<BitbucketResult<unknown>> {
    return this.repositoryWrite(workspace, repository, 'refs/branches', 'POST', input);
  }

  createCommit(workspace: string, repository: string, input: BitbucketCommitCreateInput): Promise<BitbucketResult<unknown>> {
    return this.safeRequest('/2.0/repositories/src', () => {
      const form = new URLSearchParams();
      for (const file of boundedFiles(input.files)) {
        form.append(file.path, file.content);
      }
      for (const path of boundedDeleteFiles(input.deleteFiles)) {
        form.append('files', path);
      }
      for (const [name, value] of [
        ['message', input.message],
        ['author', input.author],
        ['parents', input.parents],
        ['branch', input.branch],
      ] as const) {
        if (value !== undefined) form.set(name, bounded(value, name));
      }
      return this.request(`${repositoryPath(workspace, repository)}/src`, {
        method: 'POST',
        body: form.toString(),
        bodyType: 'form',
      });
    });
  }

  runPipeline(workspace: string, repository: string, input: Record<string, unknown>): Promise<BitbucketResult<unknown>> {
    return this.repositoryWrite(workspace, repository, 'pipelines', 'POST', input);
  }

  createEnvironment(workspace: string, repository: string, input: Record<string, unknown>): Promise<BitbucketResult<unknown>> {
    return this.repositoryWrite(workspace, repository, 'environments', 'POST', input);
  }

  updateEnvironment(workspace: string, repository: string, environmentUuid: string): Promise<BitbucketResult<null>> {
    return this.safeRequest('/2.0/repositories/environments/changes', () => this.request(`${repositoryPath(workspace, repository)}/environments/${segment(environmentUuid, 'environmentUuid')}/changes`, { method: 'POST' }));
  }

  deleteEnvironment(workspace: string, repository: string, environmentUuid: string): Promise<BitbucketResult<null>> {
    return this.safeRequest('/2.0/repositories/environments', () => this.request(`${repositoryPath(workspace, repository)}/environments/${segment(environmentUuid, 'environmentUuid')}`, { method: 'DELETE' }));
  }

  deleteBranch(workspace: string, repository: string, name: string): Promise<BitbucketResult<null>> {
    return this.safeRequest('/2.0/repositories/refs/branches', () => this.request(`${repositoryPath(workspace, repository)}/refs/branches/${segment(name, 'branchName')}`, { method: 'DELETE' }));
  }

  private repositoryCollection(workspace: string, repository: string, collection: string, options: BitbucketPageOptions): Promise<BitbucketResult<unknown>> {
    return this.safeRequest(`/2.0/repositories/${collection}`, () => {
      const query = pageQuery(options);
      return this.request(`${repositoryPath(workspace, repository)}/${collection}${query.size ? `?${query}` : ''}`);
    });
  }

  private repositoryItem(workspace: string, repository: string, collection: string, value: string, field: string): Promise<BitbucketResult<unknown>> {
    return this.safeRequest(`/2.0/repositories/${collection}`, () => this.request(`${repositoryPath(workspace, repository)}/${collection}/${segment(value, field)}`));
  }

  private repositoryPermissionCollection(workspace: string, repository: string, principalKind: 'users' | 'groups', options: BitbucketPageOptions): Promise<BitbucketResult<unknown>> {
    return this.safeRequest(`/2.0/repositories/permissions-config/${principalKind}`, () => {
      const query = pageQuery(options);
      return this.request(`${repositoryPermissionPath(workspace, repository, principalKind)}${query.size ? `?${query}` : ''}`);
    });
  }

  private repositoryPermissionItem(workspace: string, repository: string, principalKind: 'users' | 'groups', principal: string, field: string): Promise<BitbucketResult<unknown>> {
    return this.safeRequest(`/2.0/repositories/permissions-config/${principalKind}`, () => this.request(`${repositoryPermissionPath(workspace, repository, principalKind)}/${segment(principal, field)}`));
  }

  private updateRepositoryPermission(workspace: string, repository: string, principalKind: 'users' | 'groups', principal: string, field: string, input: BitbucketRepositoryPermissionUpdateInput): Promise<BitbucketResult<unknown>> {
    return this.safeRequest(`/2.0/repositories/permissions-config/${principalKind}`, () => this.request(`${repositoryPermissionPath(workspace, repository, principalKind)}/${segment(principal, field)}`, { method: 'PUT', body: boundedRepositoryPermissionUpdateInput(input) }));
  }

  private deleteRepositoryPermission(workspace: string, repository: string, principalKind: 'users' | 'groups', principal: string, field: string): Promise<BitbucketResult<null>> {
    return this.safeRequest(`/2.0/repositories/permissions-config/${principalKind}`, () => this.request(`${repositoryPermissionPath(workspace, repository, principalKind)}/${segment(principal, field)}`, { method: 'DELETE' }));
  }

  private repositoryWrite<T>(workspace: string, repository: string, collection: string, method: 'POST' | 'PUT', body: unknown): Promise<BitbucketResult<T>> {
    return this.safeRequest(`/2.0/repositories/${collection}`, () => this.request(`${repositoryPath(workspace, repository)}/${collection}`, { method, body }));
  }

  private safeRequest<T>(requestPath: string, build: () => Promise<BitbucketResult<T>>): Promise<BitbucketResult<T>> {
    try {
      return build();
    } catch {
      return Promise.resolve(failure('invalid-request', 'Invalid Bitbucket API request.', requestPath));
    }
  }

  private async request<T = unknown>(path: string, options: { method?: string; body?: unknown; bodyType?: 'json' | 'form'; responseType?: 'json' | 'text' | 'auto' } = {}): Promise<BitbucketResult<T>> {
    let url: URL;
    try {
      // The client stores the /2.0/ API root; strip the leading slash so
      // URL resolution cannot accidentally discard that version prefix.
      url = new URL(path.replace(/^\/+/, ''), this.baseUrl);
      if (url.origin !== this.baseUrl.origin || !url.pathname.startsWith('/2.0/')) throw new Error('outside Bitbucket API origin');
    } catch {
      return failure('invalid-request', 'Invalid Bitbucket API path.', path);
    }

    let token: string | undefined;
    let serializedBody: string | undefined;
    try {
      const providedToken = await this.authProvider();
      token = typeof providedToken === 'string' ? providedToken.trim() : undefined;
      if (!token && this.credentialMode === 'direct') {
        return failure('credentials-unavailable', 'Bitbucket API credentials are unavailable.', url.pathname + url.search);
      }
      serializedBody = options.body === undefined
        ? undefined
        : options.bodyType === 'form'
          ? boundedFormBody(options.body)
          : boundedJsonBody(options.body);
    } catch {
      return failure('invalid-request', 'Invalid Bitbucket API request.', url.pathname + url.search);
    }
    const headers = new Headers({ Accept: 'application/json' });
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (options.body !== undefined) headers.set('Content-Type', options.bodyType === 'form' ? 'application/x-www-form-urlencoded' : 'application/json');
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
      if (!boundedResponse.ok) return failure('response-too-large', 'Bitbucket API response exceeded the configured limit.', url.pathname + url.search, response.status);
      const text = boundedResponse.text;
      if (!response.ok) return failure('http', `Bitbucket API returned HTTP ${response.status}.`, url.pathname + url.search, response.status);
      if (!text.trim()) return { ok: true, data: null as T, status: response.status };
      const responseType = options.responseType === 'auto'
        ? response.headers.get('content-type')?.includes('application/json') ? 'json' : 'text'
        : options.responseType ?? 'json';
      if (responseType === 'text') return { ok: true, data: text as T, status: response.status };
      try {
        return { ok: true, data: JSON.parse(text) as T, status: response.status };
      } catch {
        return failure('malformed-response', 'Bitbucket API returned malformed JSON.', url.pathname + url.search, response.status);
      }
    } catch {
      if (controller.signal.aborted) return failure('timeout', 'Bitbucket API request timed out.', url.pathname + url.search);
      return failure('network', 'Bitbucket API request failed.', url.pathname + url.search);
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'api.bitbucket.org' || url.username || url.password || url.port || url.search || url.hash) throw new Error('baseUrl must target the Bitbucket Cloud API');
  const pathname = url.pathname.replace(/\/+$/u, '');
  if (pathname !== '/2.0') throw new Error('baseUrl must target the Bitbucket Cloud v2 API root');
  url.pathname = '/2.0/';
  return url;
}

function normalizeTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(100, Math.floor(value!)));
}

function segment(value: string, field: string): string {
  return encodeURIComponent(bounded(value, field));
}

function repositoryPath(workspace: string, repository: string): string {
  return `/repositories/${segment(workspace, 'workspace')}/${segment(repository, 'repository')}`;
}

function repositoryPermissionPath(workspace: string, repository: string, principalKind: 'users' | 'groups'): string {
  return `${repositoryPath(workspace, repository)}/permissions-config/${principalKind}`;
}

function id(value: number, field: string): number {
  return integer(value, field, 1, 2_147_483_647);
}

function bounded(value: string, field: string): string {
  if (typeof value !== 'string' || !value.trim() || new TextEncoder().encode(value).byteLength > MAX_VALUE_LENGTH || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`${field} is invalid`);
  return value.trim();
}

function pageQuery(options: { page?: number; pagelen?: number }): URLSearchParams {
  const query = new URLSearchParams();
  if (options.page !== undefined) query.set('page', integer(options.page, 'page', 1, 10_000).toString());
  if (options.pagelen !== undefined) query.set('pagelen', integer(options.pagelen, 'pagelen', 1, 100).toString());
  return query;
}

function appendBoundedQueryValues(query: URLSearchParams, name: string, values: readonly string[] | undefined): void {
  if (values === undefined) return;
  if (!Array.isArray(values) || values.length > 100) throw new Error(`${name} is invalid`);
  for (const value of values) query.append(name, bounded(value, name));
}

function boundedSourceFormat(value: string): 'meta' | 'rendered' {
  if (value === 'meta' || value === 'rendered') return value;
  throw new Error('format is invalid');
}

function integer(value: number, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${field} is invalid`);
  return value;
}

function boundedJsonBody(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined || new TextEncoder().encode(encoded).byteLength > MAX_INPUT_JSON_BYTES) throw new Error('request body is invalid');
  return encoded;
}

function boundedPullRequestUpdateInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('pull request update is invalid');
  validateJsonValue(value, new WeakSet<object>());
  boundedJsonBody(value);
  return value as Record<string, unknown>;
}

function boundedRepositoryPermissionUpdateInput(value: unknown): BitbucketRepositoryPermissionUpdateInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('repository permission update is invalid');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || !['admin', 'write', 'read'].includes(input.permission as string)) throw new Error('repository permission update is invalid');
  validateJsonValue(input, new WeakSet<object>());
  boundedJsonBody(input);
  return input as BitbucketRepositoryPermissionUpdateInput;
}

function validateJsonValue(value: unknown, seen: WeakSet<object>): void {
  if (typeof value === 'string') {
    if (value.length > MAX_INPUT_JSON_BYTES || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value)) throw new Error('request body is invalid');
    return;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return;
  if (typeof value !== 'object') throw new Error('request body is invalid');
  if (seen.has(value)) throw new Error('request body is invalid');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (const item of value) validateJsonValue(item, seen);
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      if (/[\u0000-\u001f\u007f-\u009f]/u.test(key)) throw new Error('request body is invalid');
      validateJsonValue(item, seen);
    }
  } finally {
    seen.delete(value);
  }
}

function boundedFormBody(value: unknown): string {
  if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > MAX_INPUT_JSON_BYTES) throw new Error('request body is invalid');
  return value;
}

function boundedFiles(files: BitbucketCommitCreateInput['files']): Array<{ path: string; content: string }> {
  if (files === undefined) return [];
  if (!Array.isArray(files) || files.length > 100) throw new Error('files is invalid');
  return files.map((file) => {
    if (!file || typeof file !== 'object') throw new Error('file is invalid');
    const path = boundedPath(file.path, 'path');
    const content = boundedText(file.content, 'content');
    return { path: path.startsWith('/') ? path : `/${path}`, content };
  });
}

function boundedDeleteFiles(files: BitbucketCommitCreateInput['deleteFiles']): string[] {
  if (files === undefined) return [];
  if (!Array.isArray(files) || files.length > 100) throw new Error('deleteFiles is invalid');
  return files.map((path) => {
    const value = boundedPath(path, 'path');
    return value.startsWith('/') ? value : `/${value}`;
  });
}

function boundedText(value: string, field: string): string {
  if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > MAX_INPUT_JSON_BYTES || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value)) throw new Error(`${field} is invalid`);
  return value;
}

function boundedPath(value: string, field: string): string {
  const path = bounded(value, field);
  if (hasDotSegment(path)) throw new Error(`${field} is invalid`);
  return path;
}

export function isSafeBitbucketPath(value: string): boolean {
  try {
    boundedPath(value, 'path');
    return true;
  } catch {
    return false;
  }
}

function hasDotSegment(path: string): boolean {
  let candidate = path;
  for (let index = 0; index < 4; index += 1) {
    if (candidate.split(/[\\/]/u).some((part) => part === '.' || part === '..')) return true;
    let decoded: string;
    try {
      decoded = decodeURIComponent(candidate);
    } catch {
      return false;
    }
    if (decoded === candidate) return false;
    candidate = decoded;
  }
  return candidate.split(/[\\/]/u).some((part) => part === '.' || part === '..');
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

function failure(code: BitbucketClientErrorCode, message: string, requestPath: string, status?: number): BitbucketResult<never> {
  return { ok: false, error: { code, message: redact(message), requestPath: redact(requestPath), ...(status === undefined ? {} : { status }) } };
}

function redact(value: string): string {
  return value
    .replace(/authorization\s*[:=]\s*[^\s]+/giu, 'Authorization: <redacted>')
    .replace(/\b(?:bearer|token|secret|password|device[- ]?code)\b\s*[:=]?\s*[^\s]+/giu, '$1 <redacted>')
    .slice(0, MAX_ERROR_TEXT);
}
