import { apiFetch, type ApiOperationRequest } from './auth.js';
import { ExecutionPresentationJobIdSchema } from '../shared/execution-presentation.js';

export type CoreResultPublication = Readonly<{
  operationId: string; jobId: string; resultRevision: string;
  state: 'preview' | 'sending' | 'connector-accepted' | 'failed' | 'ambiguous';
  origin: Readonly<{ conversationType: 'personal' | 'groupChat' | 'channel' }>;
  failure?: string;
}>;
export type CoreResultStatus = Readonly<{ publication?: CoreResultPublication; canPreview: boolean; returnToConversation?: string }>;
export type CoreResultIdentity = Pick<CoreResultPublication, 'operationId' | 'resultRevision'>;
export type CoreResultClient = Readonly<{
  getStatus(jobId: string, signal?: AbortSignal): Promise<CoreResultStatus>;
  preview(jobId: string, signal?: AbortSignal): Promise<{ publication: CoreResultPublication; text: string }>;
  confirm(jobId: string, identity: CoreResultIdentity, signal?: AbortSignal): Promise<{ publication: CoreResultPublication }>;
  download(jobId: string, signal?: AbortSignal): Promise<Blob>;
}>;
export class CoreResultClientError extends Error {
  constructor(readonly status: number) { super('결과 공유 상태를 확인하지 못했습니다. 개인 작업과 Teams 인증 상태를 다시 확인하세요.'); }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CoreResultClientError(502);
  return value as Record<string, unknown>;
}
function isIdentity(value: unknown): value is CoreResultIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).length === 2 && Object.keys(item).every(key => key === 'operationId' || key === 'resultRevision')
    && typeof item.operationId === 'string' && /^publication-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(item.operationId)
    && typeof item.resultRevision === 'string' && /^[a-f0-9]{64}$/u.test(item.resultRevision);
}
function publication(value: unknown, jobId: string): CoreResultPublication {
  const item = record(value), origin = record(item.origin);
  if (!isIdentity({ operationId: item.operationId, resultRevision: item.resultRevision }) || item.jobId !== jobId
    || !['preview', 'sending', 'connector-accepted', 'failed', 'ambiguous'].includes(String(item.state))
    || !['personal', 'groupChat', 'channel'].includes(String(origin.conversationType))) throw new CoreResultClientError(502);
  return { operationId: item.operationId as string, jobId, resultRevision: item.resultRevision as string,
    state: item.state as CoreResultPublication['state'], origin: { conversationType: origin.conversationType as CoreResultPublication['origin']['conversationType'] },
    ...(typeof item.failure === 'string' ? { failure: item.failure.slice(0, 100) } : {}) };
}
/** Existing-chat navigation only, from the authenticated server response. No new-chat query or client-derived mapping. */
export function safeCoreResultReturnLink(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\\]/u.test(value)) return;
  try {
    const url = new URL(value);
    if (url.origin !== 'https://teams.microsoft.com' || url.username || url.password || url.search || url.hash
      || !/^\/l\/chat\/19:[^\s/?#]+\/conversations$/u.test(decodeURIComponent(url.pathname))) return;
    return url.href;
  } catch { return; }
}
function path(jobId: string, action: string) {
  if (!ExecutionPresentationJobIdSchema.safeParse(jobId).success) throw new CoreResultClientError(400);
  return `/api/core-results/jobs/${encodeURIComponent(jobId)}/${action}`;
}
export function createCoreResultClient(request: ApiOperationRequest = apiFetch): CoreResultClient {
  async function json(jobId: string, action: string, init: RequestInit) {
    const response = await request(path(jobId, action), { cache: 'no-store', ...init });
    if (!response.ok) throw new CoreResultClientError(response.status);
    try { return record(await response.json()); } catch (error) { if (error instanceof CoreResultClientError) throw error; throw new CoreResultClientError(502); }
  }
  const post = (body: Record<string, unknown>, signal?: AbortSignal): RequestInit => ({ method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  return {
    async getStatus(jobId, signal) {
      const body = await json(jobId, 'publication', { signal });
      if (typeof body.canPreview !== 'boolean') throw new CoreResultClientError(502);
      const value = body.publication === undefined ? undefined : publication(body.publication, jobId);
      const link = safeCoreResultReturnLink(body.returnToConversation);
      return { canPreview: body.canPreview && (!value || value.state === 'preview'),
        ...(value ? { publication: value } : {}), ...(link ? { returnToConversation: link } : {}) };
    },
    async preview(jobId, signal) {
      const body = await json(jobId, 'preview', post({}, signal));
      if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 24_000) throw new CoreResultClientError(502);
      return { publication: publication(body.publication, jobId), text: body.text };
    },
    async confirm(jobId, identity, signal) {
      if (!isIdentity(identity)) throw new CoreResultClientError(400);
      const body = await json(jobId, 'publication', post({ operationId: identity.operationId, resultRevision: identity.resultRevision }, signal));
      const value = publication(body.publication, jobId);
      if (value.operationId !== identity.operationId || value.resultRevision !== identity.resultRevision) throw new CoreResultClientError(502);
      return { publication: value };
    },
    async download(jobId, signal) {
      const response = await request(path(jobId, 'result.txt'), { signal, cache: 'no-store' });
      if (!response.ok) throw new CoreResultClientError(response.status);
      return response.blob();
    },
  };
}
