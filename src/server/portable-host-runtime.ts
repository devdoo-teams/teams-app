import express from 'express';
import { PullWorkerError, createPullWorkerHost } from './pull-worker.js';
import { createPullWorkerRouter } from './pull-worker-http.js';
import { createUserAuthMiddleware } from './user-auth.js';
import { PORTABLE_OBSERVATION_MAX_AGE_MS, validatePortableObservation, type PortableWorkerObservation } from './portable-observation.js';
import type { CoreProviderFact } from '../shared/core-orchestration.js';
import type { AgentJobScope } from './agent-job-store.js';
import type { AgentExecutionDispatcher } from './agent-execution-port.js';
import type { PortableHostConfig } from './portable-runtime-config.js';

export type PortableTokenValidator = Readonly<{ validateAccessToken(token: string): Promise<unknown | null> }>;

/** Explicit startup composition; importing this module starts no listener. */
export async function createPortableHostRuntime(options: Readonly<{
  config: PortableHostConfig; sourceCommit: string; validator: PortableTokenValidator;
  acceptedAudiences: readonly string[]; logger?: Pick<Console, 'warn'>; now?: () => number;
}>) {
  const { config } = options;
  const now = options.now ?? Date.now;
  let observed: Readonly<{ value: PortableWorkerObservation; receivedAt: number }> | undefined;
  const boundScope = (scope: Partial<Pick<AgentJobScope, 'tenantId' | 'requesterId'>>) => scope.tenantId === config.binding.tenantId && scope.requesterId === config.binding.requesterId;
  const fresh = () => observed && now() >= observed.receivedAt && now() - observed.receivedAt <= PORTABLE_OBSERVATION_MAX_AGE_MS
    && now() - Date.parse(observed.value.providerFact.observedAt) <= PORTABLE_OBSERVATION_MAX_AGE_MS ? observed.value : undefined;
  const host = await createPullWorkerHost({ file: config.storePath('TEAMS_PULL_LEDGER_PATH', 'pull-handoff.json'),
    workerId: config.binding.workerId, sourceCommit: options.sourceCommit, now });
  const authenticate = express.Router();
  authenticate.use(createUserAuthMiddleware({ allowUnauthenticated: false, validator: options.validator,
    configuredTenantId: config.binding.tenantId, acceptedAudiences: options.acceptedAudiences,
    logger: { warn() { (options.logger ?? console).warn('Portable worker authentication rejected'); } },
  }));
  authenticate.use((_request, response, next) => {
    const user = response.locals.user;
    const client = user?.azp ?? user?.appid;
    if (!user || user.tid !== config.binding.tenantId || user.requesterId !== config.binding.requesterId
      || client !== config.binding.clientId || (user.azp && user.appid && user.azp !== user.appid)) {
      response.status(403).json({ error: 'PULL_WORKER_FORBIDDEN' }); return;
    }
    response.locals.portableWorker = Object.freeze({ id: config.binding.workerId,
      tenantId: config.binding.tenantId, requesterId: config.binding.requesterId });
    next();
  });
  const router = express.Router();
  router.use(authenticate);
  router.post('/observe', express.json({ limit: '256kb', strict: true }), (request, response) => {
    response.set('Cache-Control', 'no-store');
    try {
      if (Object.keys(request.query).length) throw new PullWorkerError('invalid');
      const value = validatePortableObservation(request.body, options.sourceCommit, now());
      observed = Object.freeze({ value, receivedAt: now() });
      response.json({ accepted: true });
    } catch { response.status(400).json({ error: 'PULL_WORKER_INVALID_OBSERVATION' }); }
  });
  router.use(createPullWorkerRouter({ host, authenticate: (_request, _response, next) => next(),
    resolveWorker: (_request, response) => response.locals.portableWorker }));
  router.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    response.status((error as { status?: number })?.status === 413 ? 413 : 400).json({ error: 'PULL_WORKER_INVALID_REQUEST' });
  });
  const dispatcher: AgentExecutionDispatcher = { ...host.dispatcher, close: () => host.close(),
    async dispatch(job) {
      if (!boundScope(job)) throw new PullWorkerError('owner');
      if (fresh()?.providerFact.availability !== 'available') throw new PullWorkerError('unavailable', 'fresh worker observation required');
      await host.dispatcher.dispatch(job);
    },
    async observe(job) { if (!boundScope(job)) throw new PullWorkerError('owner'); return host.dispatcher.observe(job); },
    async cancel(job, reason) { if (!boundScope(job)) throw new PullWorkerError('owner'); await host.dispatcher.cancel(job, reason); },
  };
  return { host, router, dispatcher, boundScope,
    modelCatalog: () => fresh()?.providerFact.availability === 'available' ? fresh()?.catalog : undefined,
    providerFacts(): CoreProviderFact[] {
      const current = fresh();
      if (current) return [structuredClone(current.providerFact)];
      return [{ provider: 'codex', availability: observed ? 'unavailable' : 'unknown', capabilities: [],
        observedAt: new Date(now()).toISOString(), source: 'runtime-observation', readiness: {
          configured: 'configured', executable: 'unknown', authentication: 'unknown', entitlement: 'unknown',
          probe: 'not-run', reason: 'unknown',
        } }];
    },
    close: () => host.close() };
}
