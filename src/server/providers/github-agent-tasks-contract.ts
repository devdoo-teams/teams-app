import type { ProviderRuntimeState } from '../provider-runtime-adapter.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/u;
const COMMIT_SHA = /^[a-f0-9]{40,64}$/u;

export type GitHubAgentTaskState =
  | 'queued'
  | 'in_progress'
  | 'waiting_for_user'
  | 'completed'
  | 'failed'
  | 'idle'
  | 'timed_out'
  | 'cancelled';

export type GitHubAgentTask = Readonly<{
  id: string;
  url: string;
  htmlUrl: string;
  state: string;
  artifacts: readonly Readonly<{
    provider: string;
    type: string;
    data: Readonly<{ id: number }>;
  }>[];
}>;

export type VerifiedGitHubPullRequestArtifact = Readonly<{
  repository: string;
  pullNumber: number;
  headSha: string;
  url: string;
}>;

export class GitHubAgentTasksContractError extends Error {
  constructor(
    readonly code: 'invalid-response' | 'missing-receipt' | 'invalid-artifact',
    message: string,
  ) {
    super(message);
    this.name = 'GitHubAgentTasksContractError';
  }
}

export function mapGitHubAgentTaskState(rawState: string): ProviderRuntimeState {
  switch (rawState) {
    case 'queued': return 'accepted';
    case 'in_progress': return 'working';
    case 'waiting_for_user': return 'input-required';
    case 'completed': return 'completed';
    case 'failed':
    case 'timed_out': return 'failed';
    case 'cancelled': return 'canceled';
    case 'idle':
    default: return 'unknown';
  }
}

export function parseGitHubAgentTask(value: unknown): GitHubAgentTask {
  const record = asRecord(value, 'Agent task');
  if (typeof record.id !== 'string' || !record.id.trim()) {
    throw new GitHubAgentTasksContractError('missing-receipt', 'Agent task response has no non-empty receipt id.');
  }
  const id = requiredString(record.id, 'Agent task id');
  if (!SAFE_ID.test(id)) throw new GitHubAgentTasksContractError('missing-receipt', 'Agent task receipt id is invalid.');
  const url = requiredGitHubUrl(record.url, 'api.github.com', 'Agent task API URL');
  const htmlUrl = requiredGitHubUrl(record.html_url, 'github.com', 'Agent task HTML URL');
  const state = requiredString(record.state, 'Agent task state');
  if (!Array.isArray(record.artifacts)) {
    throw new GitHubAgentTasksContractError('invalid-response', 'Agent task artifacts must be an array.');
  }
  const artifacts = record.artifacts.map((entry) => {
    const artifact = asRecord(entry, 'Agent task artifact');
    const data = asRecord(artifact.data, 'Agent task artifact data');
    const artifactId = positiveInteger(data.id, 'Agent task artifact id');
    return Object.freeze({
      provider: requiredString(artifact.provider, 'Agent task artifact provider'),
      type: requiredString(artifact.type, 'Agent task artifact type'),
      data: Object.freeze({ id: artifactId }),
    });
  });
  return Object.freeze({ id, url, htmlUrl, state, artifacts: Object.freeze(artifacts) });
}

export function parseGitHubAgentTaskList(value: unknown): readonly GitHubAgentTask[] {
  const record = asRecord(value, 'Agent task list');
  if (!Array.isArray(record.tasks)) {
    throw new GitHubAgentTasksContractError('invalid-response', 'Agent task list tasks must be an array.');
  }
  return Object.freeze(record.tasks.map(parseGitHubAgentTask));
}

export function findPullRequestNumber(task: GitHubAgentTask): number | undefined {
  return task.artifacts.find((artifact) => artifact.provider === 'github' && artifact.type === 'pull')?.data.id;
}

export function verifyGitHubPullRequestArtifact(input: Readonly<{
  repository: string;
  pullNumber: number;
  task: GitHubAgentTask;
  pullRequest: unknown;
}>): VerifiedGitHubPullRequestArtifact {
  if (!REPOSITORY.test(input.repository)) {
    throw new GitHubAgentTasksContractError('invalid-artifact', 'Repository identity is invalid.');
  }
  if (input.task.state !== 'completed' || findPullRequestNumber(input.task) !== input.pullNumber) {
    throw new GitHubAgentTasksContractError('invalid-artifact', 'Completed task does not contain the expected pull request receipt.');
  }
  const pull = asRecord(input.pullRequest, 'Pull request');
  if (positiveInteger(pull.number, 'Pull request number') !== input.pullNumber) {
    throw new GitHubAgentTasksContractError('invalid-artifact', 'Pull request number does not match the task artifact.');
  }
  const head = asRecord(pull.head, 'Pull request head');
  const headRepository = asRecord(head.repo, 'Pull request head repository');
  const base = asRecord(pull.base, 'Pull request base');
  const baseRepository = asRecord(base.repo, 'Pull request base repository');
  const expectedRepository = input.repository.toLowerCase();
  requiredString(headRepository.full_name, 'Pull request head repository');
  const baseFullName = requiredString(baseRepository.full_name, 'Pull request base repository').toLowerCase();
  if (baseFullName !== expectedRepository) {
    throw new GitHubAgentTasksContractError('invalid-artifact', 'Pull request base repository does not match the requested repository.');
  }
  const headSha = requiredString(head.sha, 'Pull request head SHA').toLowerCase();
  if (!COMMIT_SHA.test(headSha)) {
    throw new GitHubAgentTasksContractError('invalid-artifact', 'Pull request head SHA is invalid.');
  }
  const url = requiredGitHubUrl(pull.html_url, 'github.com', 'Pull request URL');
  const parsedUrl = new URL(url);
  if (parsedUrl.pathname.toLowerCase() !== `/${expectedRepository}/pull/${input.pullNumber}`) {
    throw new GitHubAgentTasksContractError('invalid-artifact', 'Pull request URL does not match repository and number.');
  }
  return Object.freeze({ repository: input.repository, pullNumber: input.pullNumber, headSha, url });
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GitHubAgentTasksContractError('invalid-response', `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_048) {
    throw new GitHubAgentTasksContractError('invalid-response', `${label} must be a bounded non-empty string.`);
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new GitHubAgentTasksContractError('invalid-response', `${label} must be a positive integer.`);
  }
  return Number(value);
}

function requiredGitHubUrl(value: unknown, host: 'github.com' | 'api.github.com', label: string): string {
  const text = requiredString(value, label);
  let parsed: URL;
  try { parsed = new URL(text); } catch {
    throw new GitHubAgentTasksContractError('invalid-response', `${label} must be a valid URL.`);
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== host || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new GitHubAgentTasksContractError('invalid-response', `${label} must be a credential-free GitHub HTTPS URL.`);
  }
  return parsed.toString();
}
