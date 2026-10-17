import express from 'express';
import { createPullWorkerHost } from './pull-worker.js';
import { createPullWorkerRouter } from './pull-worker-http.js';
import { createUserAuthMiddleware } from './user-auth.js';
import type { PortableHostConfig } from './portable-runtime-config.js';

export type PortableTokenValidator = Readonly<{ validateAccessToken(token: string): Promise<unknown | null> }>;

/** Explicit startup composition; importing this module starts no listener. */
export async function createPortableHostRuntime(options: Readonly<{
  config: PortableHostConfig; sourceCommit: string; validator: PortableTokenValidator;
  acceptedAudiences: readonly string[]; logger?: Pick<Console, 'warn'>;
}>) {
  const { config } = options;
  const host = await createPullWorkerHost({ file: config.storePath('TEAMS_PULL_LEDGER_PATH', 'pull-handoff.json'),
    workerId: config.binding.workerId, sourceCommit: options.sourceCommit });
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
  const router = createPullWorkerRouter({ host, authenticate,
    resolveWorker: (_request, response) => response.locals.portableWorker });
  return { host, router, dispatcher: host.dispatcher, close: () => host.close() };
}
