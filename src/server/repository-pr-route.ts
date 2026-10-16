import express, { type Request, type RequestHandler, type Response } from 'express';
import { RepositoryPrincipalSchema } from '../shared/repository-pr.js';
import { RepositoryPrError, type RepositoryPrService } from './repository-pr.js';

export const REPOSITORY_PR_API_PATH = '/api/repository-pr';
export function mountRepositoryPrRoutes(app: Pick<express.Application, 'use'>, options: Readonly<{
  service: Pick<RepositoryPrService, 'catalog' | 'query'>; authenticate: RequestHandler;
  resolvePrincipal: (request: Request, response: Response) => unknown;
}>) {
  const router = express.Router();
  router.use((_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });
  router.use(options.authenticate);
  router.use(express.json({ limit: '8kb', strict: true }));
  for (const [method, path] of [['get', '/catalog'], ['post', '/query']] as const) {
    router[method](path, async (request, response, next) => {
      const controller = new AbortController();
      const stop = () => { if (!response.writableEnded) controller.abort(); };
      response.once('close', stop);
      try {
        const principal = RepositoryPrincipalSchema.safeParse(options.resolvePrincipal(request, response));
        if (!principal.success) throw new RepositoryPrError('AUTH_REQUIRED', 401);
        if (Object.keys(request.query).length) throw new RepositoryPrError('INVALID_REQUEST', 400);
        const result = method === 'get' ? await options.service.catalog(principal.data, controller.signal)
          : await options.service.query(principal.data, request.body, controller.signal);
        if (!controller.signal.aborted) response.json(result);
      } catch (error) { if (!controller.signal.aborted) next(error); }
      finally { response.removeListener('close', stop); }
    });
  }
  router.use((error: unknown, _request: Request, response: Response, _next: express.NextFunction) => {
    const tooLarge = error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large';
    const known = error instanceof RepositoryPrError ? error : new RepositoryPrError(error instanceof SyntaxError || tooLarge ? 'INVALID_REQUEST' : 'UNAVAILABLE', tooLarge ? 413 : error instanceof SyntaxError ? 400 : 502);
    response.status(known.status).json({ error: { code: known.code, message: repositoryPrMessage(known.code) } });
  });
  app.use(REPOSITORY_PR_API_PATH, router);
}
export function repositoryPrMessage(code: string): string {
  switch (code) {
    case 'AUTH_REQUIRED': return 'Teams 인증을 확인한 뒤 다시 조회하세요.';
    case 'FORBIDDEN': return '현재 계정의 저장소 읽기 권한을 확인할 수 없습니다.';
    case 'STALE_CATALOG': return '저장소 또는 권한 정보가 변경되었습니다. 목록을 다시 읽으세요.';
    case 'NOT_CONFIGURED': return '운영 연결 미완료: 승인된 사내 저장소 연결이 필요합니다.';
    case 'INVALID_REQUEST': return '저장소 선택과 조회 조건을 확인하세요.';
    case 'TIMEOUT': return '저장소 조회 시간이 초과되었습니다. 다시 시도하세요.';
    case 'CANCELLED': return '저장소 조회가 중단되었습니다.';
    default: return '저장소 응답을 검증하지 못했습니다. 다시 시도하세요.';
  }
}
