import {
  createProviderRuntimeAdapter,
  isOpaqueProviderCredentialReference,
  type ProviderRuntimeAdapter,
  type ProviderRuntimeObservation,
  type ProviderRuntimeOperationInput,
  type ProviderRuntimeReceiptOperationInput,
} from '../provider-runtime-adapter.js';
import {
  findPullRequestNumber,
  mapGitHubAgentTaskState,
  parseGitHubAgentTask,
  parseGitHubAgentTaskList,
  verifyGitHubPullRequestArtifact,
} from './github-agent-tasks-contract.js';

const API_VERSION = '2026-03-10';
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u;
const MAX_LIST_PAGES = 10;
const MAX_RETRY_DELAY_MS = 86_400_000;

export type GitHubAgentTasksRetryGuidance = Readonly<{
  pollIntervalMs?: number;
  retryAfterMs?: number;
  rateLimitResetAtMs?: number;
}>;

export type GitHubAgentTaskObservation = ProviderRuntimeObservation & Readonly<{
  retryGuidance?: GitHubAgentTasksRetryGuidance;
}>;

export class GitHubAgentTasksRequestError extends Error {
  constructor(readonly status: number, readonly retryGuidance: GitHubAgentTasksRetryGuidance) {
    super(`GitHub API request failed with HTTP ${status}.`);
    this.name = 'GitHubAgentTasksRequestError';
  }
}

export type GitHubAgentTasksAdapter = Omit<ProviderRuntimeAdapter, 'get'> & Readonly<{
  get(input: ProviderRuntimeReceiptOperationInput): Promise<GitHubAgentTaskObservation>;
  list(input: ProviderRuntimeOperationInput): Promise<readonly ReturnType<typeof parseGitHubAgentTask>[]>;
  steer(input: ProviderRuntimeReceiptOperationInput, prompt: string): Promise<ProviderRuntimeObservation>;
}>;

export function createGitHubAgentTasksAdapter(options: Readonly<{
  fetch: typeof fetch;
  resolveUserToken(reference: string, principalId: string): Promise<string>;
  verifyExecutionReadiness?(input: Readonly<{
    repository: string;
    credentialReference: string;
    principalId: string;
    signal: AbortSignal;
  }>): Promise<Readonly<{ ready: boolean; reason: string }>>;
  apiBaseUrl?: string;
  apiVersion?: string;
}>): GitHubAgentTasksAdapter {
  const apiBaseUrl = options.apiBaseUrl ?? 'https://api.github.com';
  if (apiBaseUrl !== 'https://api.github.com') throw new TypeError('GitHub Agent Tasks production API must use https://api.github.com.');
  const apiVersion = options.apiVersion ?? API_VERSION;

  const request = async (input: ProviderRuntimeOperationInput, path: string, init: RequestInit = {}): Promise<Readonly<{
    body: unknown;
    retryGuidance: GitHubAgentTasksRetryGuidance;
    headers: Headers;
  }>> => {
    const reference = input.identities.credential.reference;
    if (!isOpaqueProviderCredentialReference(reference)) throw new TypeError('GitHub credential must be an opaque env:// or key-vault:// reference.');
    const token = await options.resolveUserToken(reference, input.identities.credential.principalId);
    if (typeof token !== 'string' || !token.trim()) throw new Error('GitHub user-to-server credential is unavailable.');
    const response = await options.fetch(`${apiBaseUrl}${path}`, {
      ...init,
      signal: input.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': apiVersion,
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...init.headers,
      },
    });
    const retryGuidance = parseRetryGuidance(response.headers);
    if (!response.ok) throw new GitHubAgentTasksRequestError(response.status, retryGuidance);
    return Object.freeze({ body: await response.json(), retryGuidance, headers: response.headers });
  };

  const repositoryFor = (input: ProviderRuntimeOperationInput): string => {
    const repository = input.payload.repository;
    if (typeof repository !== 'string' || !REPOSITORY.test(repository)) throw new TypeError('GitHub repository must be owner/name.');
    return repository;
  };

  const taskPath = (repository: string, taskId?: string): string => {
    const [owner, repo] = repository.split('/').map(encodeURIComponent);
    return `/agents/repos/${owner}/${repo}/tasks${taskId ? `/${encodeURIComponent(taskId)}` : ''}`;
  };

  const observe = async (input: ProviderRuntimeReceiptOperationInput): Promise<GitHubAgentTaskObservation> => {
    const repository = repositoryFor(input);
    if (input.receipt.providerContextId !== repository) throw new Error('GitHub receipt repository continuity mismatch.');
    const response = await request(input, taskPath(repository, input.receipt.providerExecutionId));
    const task = parseGitHubAgentTask(response.body);
    if (task.id !== input.receipt.providerExecutionId) throw new Error('GitHub task receipt continuity mismatch.');
    if (task.state !== 'completed') {
      return {
        rawState: task.state,
        providerExecutionId: task.id,
        providerContextId: repository,
        auditRefs: [task.htmlUrl],
        ...(hasRetryGuidance(response.retryGuidance) ? { retryGuidance: response.retryGuidance } : {}),
      };
    }
    const pullNumber = findPullRequestNumber(task);
    if (pullNumber === undefined) throw new Error('GitHub completed task has no pull request artifact receipt.');
    const pullResponse = await request(input, `/repos/${repository.split('/').map(encodeURIComponent).join('/')}/pulls/${pullNumber}`);
    const artifact = verifyGitHubPullRequestArtifact({ repository, pullNumber, task, pullRequest: pullResponse.body });
    return {
      rawState: task.state,
      providerExecutionId: task.id,
      providerContextId: repository,
      result: `GitHub pull request #${artifact.pullNumber} at ${artifact.headSha}`,
      artifacts: [{
        artifactId: `github-pr-${repository.replace('/', '-')}-${artifact.pullNumber}-${artifact.headSha}`,
        name: `${repository}#${artifact.pullNumber}`,
        mediaType: 'application/vnd.github.pull-request+json',
        uri: artifact.url,
        repository: artifact.repository,
        commitSha: artifact.headSha,
        authorship: { provider: 'github', pullNumber: String(artifact.pullNumber) },
      }],
      auditRefs: [task.htmlUrl],
    };
  };

  const base = createProviderRuntimeAdapter({
    providerId: 'github-agent-tasks',
    classifyState: mapGitHubAgentTaskState,
    async preflight(input) {
      const repository = repositoryFor(input);
      await request(input, `/repos/${repository.split('/').map(encodeURIComponent).join('/')}`);
      if (!options.verifyExecutionReadiness) {
        return { ready: false, reason: 'configured-unverified: GitHub Agent Tasks write entitlement and Copilot subscription were not verified.' };
      }
      const readiness = await options.verifyExecutionReadiness({
        repository,
        credentialReference: input.identities.credential.reference,
        principalId: input.identities.credential.principalId,
        signal: input.signal,
      });
      if (!readiness.ready) return { ready: false, reason: `configured-unverified: ${readiness.reason}` };
      return { ready: true, capabilities: ['agent-tasks', 'pull-request-artifact'] };
    },
    async submit(input) {
      const repository = repositoryFor(input);
      const prompt = input.payload.prompt;
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 16_000) throw new TypeError('GitHub task prompt must be bounded and non-empty.');
      if (input.payload.createPullRequest !== undefined && typeof input.payload.createPullRequest !== 'boolean') {
        throw new TypeError('createPullRequest must be boolean.');
      }
      if (input.payload.createPullRequest === false) {
        throw new TypeError('GitHub Agent Tasks adapter is PR-only and requires createPullRequest=true.');
      }
      const body: Record<string, unknown> = { prompt: prompt.trim(), create_pull_request: true };
      if (input.payload.baseRef !== undefined) body.base_ref = boundedRef(input.payload.baseRef);
      const response = await request(input, taskPath(repository), { method: 'POST', body: JSON.stringify(body) });
      const task = parseGitHubAgentTask(response.body);
      return { rawState: task.state, providerExecutionId: task.id, providerContextId: repository, auditRefs: [task.htmlUrl] };
    },
    get: observe,
    async cancel() {
      return { rawState: 'unsupported', error: 'GitHub Agent Tasks REST API does not document a cancel endpoint.' };
    },
  });

  return Object.freeze({
    ...base,
    get: observe,
    async list(input) {
      const repository = repositoryFor(input);
      const tasks: ReturnType<typeof parseGitHubAgentTask>[] = [];
      let path: string | undefined = `${taskPath(repository)}?per_page=100&page=1`;
      for (let page = 0; path !== undefined && page < MAX_LIST_PAGES; page += 1) {
        const response = await request(input, path);
        tasks.push(...parseGitHubAgentTaskList(response.body));
        path = parseNextPagePath(response.headers.get('link'), repository);
      }
      if (path !== undefined) throw new Error(`GitHub Agent Tasks list exceeded ${MAX_LIST_PAGES} pages.`);
      return Object.freeze(tasks);
    },
    async steer(_input, prompt) {
      if (typeof prompt !== 'string' || !prompt.trim()) throw new TypeError('Steer prompt must be non-empty.');
      return { rawState: 'unsupported', error: 'GitHub Agent Tasks REST API does not document a steer endpoint.' };
    },
  });
}

function parseRetryGuidance(headers: Headers): GitHubAgentTasksRetryGuidance {
  const pollIntervalMs = parseDelaySeconds(headers.get('x-poll-interval'));
  const retryAfterMs = parseRetryAfter(headers.get('retry-after'));
  const rateLimitResetAtMs = parseEpochSeconds(headers.get('x-ratelimit-reset'));
  return Object.freeze({
    ...(pollIntervalMs === undefined ? {} : { pollIntervalMs }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    ...(rateLimitResetAtMs === undefined ? {} : { rateLimitResetAtMs }),
  });
}

function hasRetryGuidance(guidance: GitHubAgentTasksRetryGuidance): boolean {
  return Object.keys(guidance).length > 0;
}

function parseDelaySeconds(value: string | null): number | undefined {
  if (value === null || !/^\d{1,6}$/u.test(value)) return undefined;
  const milliseconds = Number(value) * 1_000;
  return Number.isSafeInteger(milliseconds) && milliseconds <= MAX_RETRY_DELAY_MS ? milliseconds : undefined;
}

function parseRetryAfter(value: string | null): number | undefined {
  const seconds = parseDelaySeconds(value);
  if (seconds !== undefined) return seconds;
  if (value === null) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, Math.min(MAX_RETRY_DELAY_MS, timestamp - Date.now()));
}

function parseEpochSeconds(value: string | null): number | undefined {
  if (value === null || !/^\d{9,12}$/u.test(value)) return undefined;
  const milliseconds = Number(value) * 1_000;
  return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
}

function parseNextPagePath(link: string | null, repository: string): string | undefined {
  if (!link) return undefined;
  const next = link.split(',').map((part) => part.trim()).find((part) => /;\s*rel="next"\s*$/u.test(part));
  const match = next?.match(/^<([^>]+)>;/u);
  if (!match) return undefined;
  const parsed = new URL(match[1]);
  const expectedPath = `/agents/repos/${repository.split('/').map(encodeURIComponent).join('/')}/tasks`;
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.github.com' || parsed.pathname !== expectedPath
    || parsed.username || parsed.password || parsed.hash) {
    throw new Error('GitHub Agent Tasks pagination link crossed the approved repository boundary.');
  }
  const page = parsed.searchParams.get('page');
  const perPage = parsed.searchParams.get('per_page');
  if (!page || !/^\d{1,3}$/u.test(page) || perPage !== '100') throw new Error('GitHub Agent Tasks pagination link is invalid.');
  return `${parsed.pathname}${parsed.search}`;
}

function boundedRef(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,254}$/u.test(value) || value.includes('..')) {
    throw new TypeError('GitHub base ref is invalid.');
  }
  return value;
}
