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

export type GitHubAgentTasksAdapter = ProviderRuntimeAdapter & Readonly<{
  list(input: ProviderRuntimeOperationInput): Promise<readonly ReturnType<typeof parseGitHubAgentTask>[]>;
  steer(input: ProviderRuntimeReceiptOperationInput, prompt: string): Promise<ProviderRuntimeObservation>;
}>;

export function createGitHubAgentTasksAdapter(options: Readonly<{
  fetch: typeof fetch;
  resolveUserToken(reference: string, principalId: string): Promise<string>;
  apiBaseUrl?: string;
  apiVersion?: string;
}>): GitHubAgentTasksAdapter {
  const apiBaseUrl = options.apiBaseUrl ?? 'https://api.github.com';
  if (apiBaseUrl !== 'https://api.github.com') throw new TypeError('GitHub Agent Tasks production API must use https://api.github.com.');
  const apiVersion = options.apiVersion ?? API_VERSION;

  const request = async (input: ProviderRuntimeOperationInput, path: string, init: RequestInit = {}): Promise<unknown> => {
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
    if (!response.ok) throw new Error(`GitHub API request failed with HTTP ${response.status}.`);
    return response.json();
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

  const observe = async (input: ProviderRuntimeReceiptOperationInput): Promise<ProviderRuntimeObservation> => {
    const repository = repositoryFor(input);
    if (input.receipt.providerContextId !== repository) throw new Error('GitHub receipt repository continuity mismatch.');
    const task = parseGitHubAgentTask(await request(input, taskPath(repository, input.receipt.providerExecutionId)));
    if (task.id !== input.receipt.providerExecutionId) throw new Error('GitHub task receipt continuity mismatch.');
    if (task.state !== 'completed') {
      return { rawState: task.state, providerExecutionId: task.id, providerContextId: repository, auditRefs: [task.htmlUrl] };
    }
    const pullNumber = findPullRequestNumber(task);
    if (pullNumber === undefined) throw new Error('GitHub completed task has no pull request artifact receipt.');
    const pullRequest = await request(input, `/repos/${repository.split('/').map(encodeURIComponent).join('/')}/pulls/${pullNumber}`);
    const artifact = verifyGitHubPullRequestArtifact({ repository, pullNumber, task, pullRequest });
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
      await request(input, taskPath(repository));
      return { ready: true, capabilities: ['agent-tasks', 'pull-request-artifact'] };
    },
    async submit(input) {
      const repository = repositoryFor(input);
      const prompt = input.payload.prompt;
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 16_000) throw new TypeError('GitHub task prompt must be bounded and non-empty.');
      const body: Record<string, unknown> = { prompt: prompt.trim() };
      if (input.payload.baseRef !== undefined) body.base_ref = boundedRef(input.payload.baseRef);
      if (input.payload.createPullRequest !== undefined) {
        if (typeof input.payload.createPullRequest !== 'boolean') throw new TypeError('createPullRequest must be boolean.');
        body.create_pull_request = input.payload.createPullRequest;
      }
      const task = parseGitHubAgentTask(await request(input, taskPath(repository), { method: 'POST', body: JSON.stringify(body) }));
      return { rawState: task.state, providerExecutionId: task.id, providerContextId: repository, auditRefs: [task.htmlUrl] };
    },
    get: observe,
    async cancel() {
      return { rawState: 'unsupported', error: 'GitHub Agent Tasks REST API does not document a cancel endpoint.' };
    },
  });

  return Object.freeze({
    ...base,
    async list(input) {
      const repository = repositoryFor(input);
      return parseGitHubAgentTaskList(await request(input, taskPath(repository)));
    },
    async steer(_input, prompt) {
      if (typeof prompt !== 'string' || !prompt.trim()) throw new TypeError('Steer prompt must be non-empty.');
      return { rawState: 'unsupported', error: 'GitHub Agent Tasks REST API does not document a steer endpoint.' };
    },
  });
}

function boundedRef(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,254}$/u.test(value) || value.includes('..')) {
    throw new TypeError('GitHub base ref is invalid.');
  }
  return value;
}
