import type { CoreOrchestrationClient } from './core-orchestration-client.js';

/** Teams context and URL parameters select a view; neither supplies authorization. */
export function parseRequestedJobId(search: string, subPageId?: unknown): string | undefined {
  const params = new URLSearchParams(search);
  if (params.getAll('jobId').length > 1) return undefined;
  const query = params.get('jobId');
  const context = typeof subPageId === 'string' && subPageId ? subPageId : undefined;
  if (query !== null && context !== undefined && query !== context) return undefined;
  const id = context ?? query;
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id) ? id : undefined;
}

export function loadRequestedJob(id: string, client: Pick<CoreOrchestrationClient, 'getJob'>, signal?: AbortSignal) {
  return client.getJob(id, signal);
}

export function includeRequestedJob<T extends { id: string }>(jobs: readonly T[], requested?: T): readonly T[] {
  return requested && !jobs.some(job => job.id === requested.id) ? [requested, ...jobs] : jobs;
}
