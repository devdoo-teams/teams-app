import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { AgentJobScope } from './agent-job-store.js';
import type { ServerDerivedCoreScope } from './core-orchestration-service.js';

export type CoreResultOrigin = Readonly<{
  schemaVersion: '1'; source: 'authenticated-teams-activity';
  tenantId: string; requesterId: string; conversationId: string;
  conversationType: 'personal' | 'groupChat' | 'channel';
  serviceUrl: string; activityId: string; originThreadId?: string;
}>;
export type CoreResultPublication = Readonly<{
  schemaVersion: '1'; operationId: string; jobId: string; tenantId: string; requesterId: string;
  origin: CoreResultOrigin; resultDigest: string; resultRevision: string; publicationTextDigest: string;
  state: 'preview' | 'sending' | 'connector-accepted' | 'failed' | 'ambiguous';
  previewedAt: string; sendingAt?: string; settledAt?: string; activityId?: string;
  failure?: 'connector-rejected' | 'connector-outcome-unknown' | 'invalid-connector-receipt' | 'sending-after-restart';
}>;
export type CoreResultPublicationJob = Readonly<{
  id: string; requesterId: string; tenantId?: string; conversationId: string;
  status: string; result?: string; finishedAt?: string;
  resultOrigin?: CoreResultOrigin; resultPublication?: CoreResultPublication;
}>;
export type CoreResultPublicationPrincipal = Pick<AgentJobScope, 'tenantId' | 'requesterId'>;
export interface CoreResultPublicationStatePort {
  read(jobId: string, principal: CoreResultPublicationPrincipal): Promise<CoreResultPublicationJob | undefined>;
  /** Same-job atomic queue/CAS. Persist publication before resolving; reducer must never send. */
  mutate<T>(jobId: string, principal: CoreResultPublicationPrincipal,
    reducer: (job: CoreResultPublicationJob) => { publication: CoreResultPublication; value: T }): Promise<T | undefined>;
}
export type CoreResultPublicationSender = (origin: CoreResultOrigin,
  payload: Readonly<{ text: string; operationId: string; resultRevision: string }>) => Promise<{ state: 'connector-accepted'; activityId: string }>;
export class CoreResultPublicationError extends Error {
  readonly code = 'CORE_RESULT_PUBLICATION_REFUSED';
  constructor(readonly reason: 'invalid' | 'unsupported-origin' | 'not-completed' | 'mismatch' | 'stale-result' | 'missing-preview') {
    super(`Result publication refused: ${reason}.`); this.name = 'CoreResultPublicationError';
  }
}
/** Only an observed connector rejection may establish that sending failed; other errors are ambiguous. */
export class CoreResultConnectorRejectedError extends Error {
  constructor(readonly statusCode: number) {
    super('Teams connector rejected the publication.');
    if (!Number.isSafeInteger(statusCode) || statusCode < 400 || statusCode >= 500 || statusCode === 408) throw new CoreResultPublicationError('invalid');
    this.name = 'CoreResultConnectorRejectedError';
  }
}

/** Call only in a verified Teams activity handler. It validates/copies existing identity; it grants no access. */
export function captureCoreResultOrigin(scope: ServerDerivedCoreScope, activity: {
  channelId?: unknown; id?: unknown; serviceUrl?: unknown; replyToId?: unknown;
  from?: { aadObjectId?: unknown; id?: unknown };
  conversation?: { id?: unknown; tenantId?: unknown; conversationType?: unknown };
  channelData?: { tenant?: { id?: unknown } };
}): CoreResultOrigin {
  const requester = activity.from?.aadObjectId ?? activity.from?.id;
  const tenant = activity.conversation?.tenantId ?? activity.channelData?.tenant?.id;
  if (activity.channelId !== 'msteams' || activity.conversation?.id !== scope.conversationId
    || requester !== scope.requesterId || tenant !== scope.tenantId) throw new CoreResultPublicationError('mismatch');
  return readCoreResultOrigin({ schemaVersion: '1', source: 'authenticated-teams-activity',
    tenantId: scope.tenantId, requesterId: scope.requesterId, conversationId: scope.conversationId,
    conversationType: activity.conversation?.conversationType, serviceUrl: activity.serviceUrl, activityId: activity.id,
    ...(activity.replyToId !== undefined ? { originThreadId: activity.replyToId } : {}) }, scope)!;
}

/** Reads server-persisted provenance. Private review may use another server-owned conversation; owner and tenant remain exact. */
export function readCoreResultOrigin(value: unknown, job: CoreResultPublicationPrincipal & { conversationId: string }): CoreResultOrigin | undefined {
  if (value === undefined) return undefined;
  const record = strictRecord(value, ['schemaVersion', 'source', 'tenantId', 'requesterId', 'conversationId', 'conversationType', 'serviceUrl', 'activityId', 'originThreadId']);
  if (record.schemaVersion !== '1' || record.source !== 'authenticated-teams-activity'
    || !text(record.tenantId) || record.tenantId !== job.tenantId
    || !text(record.requesterId) || record.requesterId !== job.requesterId
    || !text(record.conversationId)
    || !['personal', 'groupChat', 'channel'].includes(String(record.conversationType))
    || !text(record.activityId) || (record.originThreadId !== undefined && !text(record.originThreadId))
    || !teamsServiceUrl(record.serviceUrl)) throw new CoreResultPublicationError('invalid');
  return { ...record } as CoreResultOrigin;
}

export function readCoreResultPublication(value: unknown, job: CoreResultPublicationJob): CoreResultPublication | undefined {
  if (value === undefined) return undefined;
  const record = strictRecord(value, ['schemaVersion', 'operationId', 'jobId', 'tenantId', 'requesterId', 'origin',
    'resultDigest', 'resultRevision', 'publicationTextDigest', 'state', 'previewedAt', 'sendingAt', 'settledAt', 'activityId', 'failure']);
  const origin = requiredOrigin(job);
  const recordedOrigin = readCoreResultOrigin(record.origin, origin);
  if (record.schemaVersion !== '1' || !nonce(record.operationId) || record.jobId !== job.id
    || record.tenantId !== job.tenantId || record.requesterId !== job.requesterId
    || !recordedOrigin || !sameOrigin(recordedOrigin, origin)
    || !digest(record.resultDigest) || !digest(record.resultRevision) || !digest(record.publicationTextDigest)
    || !timestamp(record.previewedAt) || !['preview', 'sending', 'connector-accepted', 'failed', 'ambiguous'].includes(String(record.state))) {
    throw new CoreResultPublicationError('invalid');
  }
  const preview = record.state === 'preview';
  const sending = record.state === 'sending';
  if ((preview && ['sendingAt', 'settledAt', 'activityId', 'failure'].some(key => record[key] !== undefined))
    || (!preview && (!timestamp(record.sendingAt) || Date.parse(record.sendingAt) < Date.parse(record.previewedAt)))
    || (sending && ['settledAt', 'activityId', 'failure'].some(key => record[key] !== undefined))
    || (!preview && !sending && (!timestamp(record.settledAt) || Date.parse(record.settledAt) < Date.parse(record.sendingAt as string)))
    || (record.state === 'connector-accepted' ? (!text(record.activityId) || record.failure !== undefined) : record.activityId !== undefined)
    || ((record.state === 'failed') && record.failure !== 'connector-rejected')
    || ((record.state === 'ambiguous') && !['connector-outcome-unknown', 'invalid-connector-receipt', 'sending-after-restart'].includes(String(record.failure)))) {
    throw new CoreResultPublicationError('invalid');
  }
  return { ...record, origin: recordedOrigin } as CoreResultPublication;
}

export class CoreResultPublicationService {
  constructor(private readonly options: Readonly<{ state: CoreResultPublicationStatePort; sender: CoreResultPublicationSender }>) {}

  async preview(scope: CoreResultPublicationPrincipal, request: { jobId: string }): Promise<{ publication: CoreResultPublication; text: string } | undefined> {
    assertRequest(scope, request, ['jobId']);
    return this.options.state.mutate(request.jobId, scope, job => {
      assertOwner(job, scope); assertCompleted(job);
      const origin = requiredOrigin(job);
      const identity = coreResultIdentity(job);
      const publicationText = renderCoreResultPublicationText(job.result!);
      const previous = readCoreResultPublication(job.resultPublication, job);
      if (previous && previous.state !== 'preview') {
        if (previous.resultRevision !== identity.resultRevision || previous.publicationTextDigest !== hash(publicationText)) throw new CoreResultPublicationError('stale-result');
        return { publication: previous, value: { publication: previous, text: publicationText } };
      }
      const publication: CoreResultPublication = previous?.resultRevision === identity.resultRevision && previous.publicationTextDigest === hash(publicationText) ? previous : {
        schemaVersion: '1', operationId: `publication-${randomUUID()}`, jobId: job.id,
        tenantId: scope.tenantId, requesterId: scope.requesterId, origin, ...identity, publicationTextDigest: hash(publicationText),
        state: 'preview', previewedAt: new Date().toISOString(),
      };
      return { publication, value: { publication, text: publicationText } };
    });
  }

  async confirm(scope: CoreResultPublicationPrincipal, request: {
    jobId: string; operationId: string; resultRevision: string;
  }): Promise<CoreResultPublication | undefined> {
    assertRequest(scope, request, ['jobId', 'operationId', 'resultRevision']);
    if (!nonce(request.operationId) || !digest(request.resultRevision)) throw new CoreResultPublicationError('invalid');
    const claimed = await this.options.state.mutate(request.jobId, scope, job => {
      assertOwner(job, scope); assertCompleted(job);
      const previous = readCoreResultPublication(job.resultPublication, job);
      if (!previous) throw new CoreResultPublicationError('missing-preview');
      if (previous.operationId !== request.operationId || previous.resultRevision !== request.resultRevision) throw new CoreResultPublicationError('mismatch');
      const publicationText = renderCoreResultPublicationText(job.result!);
      if (coreResultIdentity(job).resultRevision !== previous.resultRevision || previous.publicationTextDigest !== hash(publicationText)) throw new CoreResultPublicationError('stale-result');
      if (previous.state !== 'preview') return { publication: previous, value: { publication: previous, send: false, text: publicationText } };
      const publication: CoreResultPublication = { ...previous, state: 'sending', sendingAt: new Date().toISOString() };
      return { publication, value: { publication, send: true, text: publicationText } };
    });
    if (!claimed || !claimed.send) return claimed?.publication;

    let outcome: Pick<CoreResultPublication, 'state' | 'activityId' | 'failure'>;
    try {
      const receipt = await this.options.sender({ ...claimed.publication.origin }, {
        text: claimed.text, operationId: claimed.publication.operationId, resultRevision: claimed.publication.resultRevision,
      });
      outcome = receipt?.state === 'connector-accepted' && text(receipt.activityId)
        ? { state: 'connector-accepted', activityId: receipt.activityId }
        : { state: 'ambiguous', failure: 'invalid-connector-receipt' };
    } catch (error) {
      outcome = error instanceof CoreResultConnectorRejectedError
        ? { state: 'failed', failure: 'connector-rejected' }
        : { state: 'ambiguous', failure: 'connector-outcome-unknown' };
    }
    // If settlement persistence fails, durable sending remains. No retry may resend it.
    return this.options.state.mutate(request.jobId, scope, job => {
      assertOwner(job, scope);
      const previous = readCoreResultPublication(job.resultPublication, job);
      if (!previous || previous.operationId !== claimed.publication.operationId
        || previous.state !== 'sending') throw new CoreResultPublicationError('mismatch');
      const publication: CoreResultPublication = { ...previous, ...outcome, settledAt: new Date().toISOString() };
      return { publication, value: publication };
    });
  }

  async status(scope: CoreResultPublicationPrincipal, request: { jobId: string }): Promise<CoreResultPublication | undefined> {
    assertRequest(scope, request, ['jobId']);
    const job = await this.options.state.read(request.jobId, scope);
    if (!job) return undefined;
    assertOwner(job, scope);
    const publication = readCoreResultPublication(job.resultPublication, job);
    // A sending record may belong to an in-flight process or a crashed one. Both are ambiguous to this reader.
    return publication?.state === 'sending' ? { ...publication, state: 'ambiguous',
      failure: 'connector-outcome-unknown', settledAt: new Date().toISOString() } : publication;
  }
}

export function coreResultIdentity(job: Pick<CoreResultPublicationJob, 'id' | 'result' | 'finishedAt'>): { resultDigest: string; resultRevision: string } {
  if (typeof job.result !== 'string' || !job.result.trim()) throw new CoreResultPublicationError('not-completed');
  const resultDigest = hash(job.result);
  return { resultDigest, resultRevision: hash(JSON.stringify([1, job.id, resultDigest, job.finishedAt ?? null])) };
}

export const CORE_RESULT_PUBLICATION_MAX_BYTES = 24_000;
const PUBLICATION_TRUNCATION_NOTICE = '\n\n긴 결과 일부 생략…전체 결과는 개인 작업에서 확인';
/** The private preview and connector payload share this exact UTF-8 bounded text. */
export function renderCoreResultPublicationText(result: string): string {
  if (Buffer.byteLength(result, 'utf8') <= CORE_RESULT_PUBLICATION_MAX_BYTES) return result;
  const contentBudget = CORE_RESULT_PUBLICATION_MAX_BYTES - Buffer.byteLength(PUBLICATION_TRUNCATION_NOTICE, 'utf8');
  let bytes = 0;
  let end = 0;
  for (const character of result) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > contentBudget) break;
    bytes += size; end += character.length;
  }
  return result.slice(0, end) + PUBLICATION_TRUNCATION_NOTICE;
}

export type CoreResultSource = Readonly<{ url: string; host: string; evidence: 'result-text'; retrieval: 'unverified'; action: 'explicit-open' }>;
export type CoreResultResources = Readonly<{
  sources: CoreResultSource[];
  file: { name: 'result.txt'; state: 'unsupported'; reason: 'manifest-supports-files-false'; alternative: 'authenticated-result-download' };
}>;
/** Extracts evidence already in the result; it never fetches a URL or claims source retrieval. */
export function projectCoreResultResources(job: Pick<CoreResultPublicationJob, 'status' | 'result'>): CoreResultResources | undefined {
  if (job.status !== 'completed' || !job.result?.trim()) return undefined;
  const sources: CoreResultSource[] = [];
  const seen = new Set<string>();
  for (const match of job.result.matchAll(/https:\/\/[^\s<>"'`\]\)]+/gu)) {
    const url = safeCoreResultUrl(match[0].replace(/[.,;!?]+$/u, ''));
    if (!url || seen.has(url) || sources.length >= 20) continue;
    seen.add(url); sources.push({ url, host: new URL(url).host, evidence: 'result-text', retrieval: 'unverified', action: 'explicit-open' });
  }
  return { sources, file: { name: 'result.txt', state: 'unsupported', reason: 'manifest-supports-files-false', alternative: 'authenticated-result-download' } };
}

export function safeCoreResultUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2_048 || /[\u0000-\u0020\u007f-\u009f\\]/u.test(value)) return undefined;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || isIP(host.replace(/^\[|\]$/gu, ''))
      || !host.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/u.test(host)
      || url.port && url.port !== '443'
      || [...url.searchParams.keys()].some(key => /^(?:token|access_token|api_key|apikey|secret|password|code|sig|signature|authorization)$/iu.test(key))) return undefined;
    return url.href;
  } catch { return undefined; }
}

export type CoreFileEvidence = Readonly<{
  name: string; state: 'prepared' | 'consent-requested' | 'uploaded' | 'delivered' | 'failed' | 'unsupported';
  preparedAt?: string; contentDigest?: string; sizeBytes?: number;
  consentActivityId?: string; consentRequestedAt?: string;
  consentAcceptedAt?: string;
  remoteFileId?: string; uploadedAt?: string;
  deliveryActivityId?: string; userReceiptAt?: string;
  failedAt?: string; reason?: 'manifest-supports-files-false' | 'scope-unsupported' | 'user-declined' | 'upload-failed';
}>;
/** Status is admitted only with its own evidence; consent/connector acceptance never imply file delivery. */
export function readCoreFileEvidence(value: unknown): CoreFileEvidence {
  const record = strictRecord(value, ['name', 'state', 'preparedAt', 'contentDigest', 'sizeBytes', 'consentActivityId', 'consentRequestedAt', 'consentAcceptedAt',
    'remoteFileId', 'uploadedAt', 'deliveryActivityId', 'userReceiptAt', 'failedAt', 'reason']);
  if (!text(record.name) || !['prepared', 'consent-requested', 'uploaded', 'delivered', 'failed', 'unsupported'].includes(String(record.state))) throw new CoreResultPublicationError('invalid');
  const preparationKeys = ['name', 'state', 'preparedAt', 'contentDigest', 'sizeBytes'];
  const consentKeys = [...preparationKeys, 'consentActivityId', 'consentRequestedAt'];
  const uploadKeys = [...consentKeys, 'consentAcceptedAt', 'remoteFileId', 'uploadedAt'];
  const stateKeys: Record<CoreFileEvidence['state'], string[]> = {
    prepared: preparationKeys, 'consent-requested': consentKeys, uploaded: uploadKeys,
    delivered: [...uploadKeys, 'deliveryActivityId', 'userReceiptAt'],
    failed: ['name', 'state', 'failedAt', 'reason'], unsupported: ['name', 'state', 'reason'],
  };
  strictRecord(value, stateKeys[record.state as CoreFileEvidence['state']]);
  if (record.state === 'unsupported') {
    if (!['manifest-supports-files-false', 'scope-unsupported'].includes(String(record.reason))) throw new CoreResultPublicationError('invalid');
  } else if (record.state === 'failed') {
    if (!timestamp(record.failedAt) || !['user-declined', 'upload-failed'].includes(String(record.reason))) throw new CoreResultPublicationError('invalid');
  } else {
    if (!timestamp(record.preparedAt) || !digest(record.contentDigest) || !Number.isSafeInteger(record.sizeBytes)
      || (record.sizeBytes as number) < 0) throw new CoreResultPublicationError('invalid');
    if (record.state !== 'prepared' && (!text(record.consentActivityId) || !timestamp(record.consentRequestedAt)
      || Date.parse(record.consentRequestedAt) < Date.parse(record.preparedAt))) throw new CoreResultPublicationError('invalid');
    if ((record.state === 'uploaded' || record.state === 'delivered') && (!text(record.remoteFileId) || !timestamp(record.uploadedAt)
      || !timestamp(record.consentAcceptedAt) || Date.parse(record.consentAcceptedAt) < Date.parse(record.consentRequestedAt as string)
      || Date.parse(record.uploadedAt) < Date.parse(record.consentAcceptedAt))) throw new CoreResultPublicationError('invalid');
    if (record.state === 'delivered' && (!text(record.deliveryActivityId) || !timestamp(record.userReceiptAt)
      || Date.parse(record.userReceiptAt) < Date.parse(record.uploadedAt as string))) throw new CoreResultPublicationError('invalid');
  }
  return { ...record } as CoreFileEvidence;
}

function requiredOrigin(job: CoreResultPublicationJob): CoreResultOrigin {
  if (!job.tenantId) throw new CoreResultPublicationError('unsupported-origin');
  const origin = readCoreResultOrigin(job.resultOrigin, { tenantId: job.tenantId, requesterId: job.requesterId, conversationId: job.conversationId });
  if (!origin) throw new CoreResultPublicationError('unsupported-origin');
  return origin;
}
function assertOwner(job: CoreResultPublicationJob, scope: CoreResultPublicationPrincipal): void {
  if (job.tenantId !== scope.tenantId || job.requesterId !== scope.requesterId) throw new CoreResultPublicationError('mismatch');
}
function assertCompleted(job: CoreResultPublicationJob): void {
  if (job.status !== 'completed' || typeof job.result !== 'string' || !job.result.trim()) throw new CoreResultPublicationError('not-completed');
}
function assertRequest(scope: CoreResultPublicationPrincipal, request: unknown, allowed: string[]): void {
  if (!scope || !text(scope.tenantId) || !text(scope.requesterId)) throw new CoreResultPublicationError('invalid');
  const record = strictRecord(request, allowed);
  if (!text(record.jobId)) throw new CoreResultPublicationError('invalid');
}
function strictRecord(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !allowed.includes(key))) throw new CoreResultPublicationError('invalid');
  return value as Record<string, unknown>;
}
function teamsServiceUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !text(value, 2_048)) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && (!url.port || url.port === '443'); }
  catch { return false; }
}
function sameOrigin(a: CoreResultOrigin, b: CoreResultOrigin): boolean {
  return ['schemaVersion', 'source', 'tenantId', 'requesterId', 'conversationId', 'conversationType', 'serviceUrl', 'activityId', 'originThreadId']
    .every(key => a[key as keyof CoreResultOrigin] === b[key as keyof CoreResultOrigin]);
}
function text(value: unknown, max = 256): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/u.test(value); }
function digest(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value); }
function nonce(value: unknown): value is string { return typeof value === 'string' && /^publication-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value); }
function timestamp(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value; }
function hash(value: string): string { return createHash('sha256').update(value).digest('hex'); }
