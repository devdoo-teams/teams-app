import express, { type RequestHandler, type Request, type Response, type NextFunction } from 'express';
import { CoreResultPublicationError, type CoreResultPublication, type CoreResultOrigin,
  type CoreResultPublicationJob, type CoreResultPublicationPrincipal, type CoreResultPublicationService } from './core-result-publication.js';

export function resultPublicationView(publication: CoreResultPublication) {
  return { operationId: publication.operationId, jobId: publication.jobId, resultRevision: publication.resultRevision,
    state: publication.state, origin: { conversationType: publication.origin.conversationType },
    ...(publication.failure ? { failure: publication.failure } : {}) };
}

/** Only the documented 19: chat ID can navigate an existing chat. Bot a: IDs
 * and channels without team/channel metadata are not guessed or converted.
 * https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/deep-link-teams#deep-link-to-navigate-to-a-chat */
export function coreResultConversationLink(origin?: CoreResultOrigin): string | undefined {
  if (!origin || origin.conversationType === 'channel' || !/^19:[^\s/?#]+$/u.test(origin.conversationId)) return undefined;
  return `https://teams.microsoft.com/l/chat/${encodeURIComponent(origin.conversationId)}/conversations`;
}

export function mountCoreResultRoutes(app: Pick<express.Application, 'use'>, options: {
  authenticate: RequestHandler;
  resolvePrincipal(request: Request, response: Response): CoreResultPublicationPrincipal | undefined;
  readJob(id: string, principal: CoreResultPublicationPrincipal): CoreResultPublicationJob | undefined;
  service: CoreResultPublicationService;
  canPublish(): boolean;
}): void {
  const router = express.Router();
  router.use(options.authenticate, express.json({ limit: '4kb', strict: true }));
  const owned = (request: Request, response: Response) => {
    if (Object.keys(request.query).length) throw new CoreResultPublicationError('invalid');
    const principal = options.resolvePrincipal(request, response);
    if (!principal) { response.status(401).json({ error: { code: 'AUTH_REQUIRED', retryable: false } }); return; }
    const id = request.params.jobId;
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(id)) throw new CoreResultPublicationError('invalid');
    const job = options.readJob(id, principal);
    if (!job) { response.status(404).json({ error: { code: 'NOT_FOUND', retryable: false } }); return; }
    response.set('Cache-Control', 'no-store');
    return { principal, job, jobId: id };
  };
  const handle = (callback: (q: Request, s: Response) => Promise<void>): RequestHandler => (q, s, n) => { void callback(q, s).catch(n); };
  const body = (value: unknown, keys: string[]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new CoreResultPublicationError('invalid');
    return value as Record<string, unknown>;
  };
  router.get('/jobs/:jobId/publication', handle(async (q, s) => {
    const context = owned(q, s); if (!context) return;
    const publication = await options.service.status(context.principal, { jobId: context.jobId });
    const returnToConversation = coreResultConversationLink(context.job.resultOrigin);
    s.json({ ...(publication ? { publication: resultPublicationView(publication) } : {}),
      canPreview: options.canPublish() && Boolean(context.job.resultOrigin) && context.job.status === 'completed',
      ...(returnToConversation ? { returnToConversation } : {}) });
  }));
  router.post('/jobs/:jobId/preview', handle(async (q, s) => {
    body(q.body ?? {}, []); const context = owned(q, s); if (!context) return;
    if (!options.canPublish()) { s.status(501).json({ error: { code: 'PUBLICATION_UNAVAILABLE', retryable: false } }); return; }
    const result = await options.service.preview(context.principal, { jobId: context.jobId });
    if (!result) { s.status(404).end(); return; }
    s.json({ text: result.text, publication: resultPublicationView(result.publication) });
  }));
  router.post('/jobs/:jobId/publication', handle(async (q, s) => {
    const input = body(q.body, ['operationId', 'resultRevision']);
    if (typeof input.operationId !== 'string' || typeof input.resultRevision !== 'string') throw new CoreResultPublicationError('invalid');
    const context = owned(q, s); if (!context) return;
    if (!options.canPublish()) { s.status(501).json({ error: { code: 'PUBLICATION_UNAVAILABLE', retryable: false } }); return; }
    const publication = await options.service.confirm(context.principal,
      { jobId: context.jobId, operationId: input.operationId, resultRevision: input.resultRevision });
    if (!publication) { s.status(404).end(); return; }
    s.json({ publication: resultPublicationView(publication) });
  }));
  router.get('/jobs/:jobId/result.txt', handle(async (q, s) => {
    const context = owned(q, s); if (!context) return;
    if (context.job.status !== 'completed' || !context.job.result?.trim()) throw new CoreResultPublicationError('not-completed');
    const filename = `${context.jobId.replace(/[^A-Za-z0-9._-]/gu, '_')}-result.txt`;
    s.set('Content-Disposition', `attachment; filename="${filename}"`).set('X-Content-Type-Options', 'nosniff')
      .type('text/plain; charset=utf-8').send(context.job.result);
  }));
  router.use((error: unknown, _q: Request, s: Response, _n: NextFunction) => {
    const refused = error instanceof CoreResultPublicationError;
    s.set('Cache-Control', 'no-store').status(refused ? (error.reason === 'invalid' ? 400 : 409) : 500)
      .json({ error: { code: refused ? error.code : 'RESULT_REQUEST_FAILED',
        message: '결과 공유 상태를 확인하지 못했습니다. 개인 작업을 다시 조회하세요.', retryable: false } });
  });
  app.use('/api/core-results', router);
}
