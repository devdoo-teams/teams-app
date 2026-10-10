import type { Express, RequestHandler } from 'express';
import type { ExecutionPresentationStore } from './execution-presentation-store.js';
import { ExecutionPresentationScopeSchema, ExecutionPresentationSelectionSchema } from '../shared/execution-presentation.js';

export type ExecutionPresentationRouteOptions = {
  store: ExecutionPresentationStore;
  authenticate: RequestHandler;
  resolveScope: (request: any, response: any) => { tenantId: string; requesterId: string } | undefined;
  richEnabled: () => boolean;
};

export function mountExecutionPresentationRoutes(http: Express, options: ExecutionPresentationRouteOptions): void {
  async function handle(request: any, response: any, write: boolean) {
    response.set('Cache-Control', 'no-store');
    const scope = ExecutionPresentationScopeSchema.safeParse(options.resolveScope(request, response));
    if (!scope.success) return response.status(401).json({ error: 'validated owner identity required' });
    try {
      if (write) {
        const selection = ExecutionPresentationSelectionSchema.safeParse(request.body);
        if (!selection.success) return response.status(400).json({ error: 'invalid display selection' });
        if (selection.data.mode === 'rich' && !options.richEnabled()) {
          return response.status(503).json({ error: 'CopilotKit 화면을 현재 사용할 수 없습니다.' });
        }
        await options.store.setSelection(scope.data, selection.data);
      }
      return response.json({ ...await options.store.getSelection(scope.data),
        availableModes: options.richEnabled() ? ['text', 'summary', 'rich'] : ['text', 'summary'] });
    } catch {
      return response.status(503).json({ error: '표시 설정을 저장하거나 읽지 못했습니다. 다시 시도하세요.' });
    }
  }
  http.get('/api/execution-presentation', options.authenticate, (q, s) => handle(q, s, false));
  http.post('/api/execution-presentation', options.authenticate, (q, s) => handle(q, s, true));
}
