import express, { type Request, type Response, type RequestHandler } from 'express';
import { z } from 'zod';
import { isValidPublicHostname } from '../shared/public-hostname.js';
import { PullWorkerError, pullClaimSchema, pullLeaseSchema, pullResultSchema,
  type PullWorkerHost, type PullWorkerIdentity, type PullLease, type PullResult } from './pull-worker.js';

const empty = z.object({}).strict();
const heartbeatSchema = z.object({ cancellationRequested: z.boolean() }).strict();
const finishSchema = pullLeaseSchema.extend({ result: pullResultSchema }).strict();
/** Opt-in composition only. Existing production routes are unchanged. */
export function createPullWorkerRouter(options: Readonly<{
  host: PullWorkerHost;
  authenticate: RequestHandler;
  resolveWorker(request: Request, response: Response): PullWorkerIdentity | undefined;
}>): express.Router {
  const router = express.Router();
  router.use(options.authenticate);
  router.use(express.json({ limit: '256kb', strict: true }));
  const route = (action: (request: Request, identity: PullWorkerIdentity) => Promise<unknown>): RequestHandler => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const identity = options.resolveWorker(req, res);
      if (!identity) { res.sendStatus(401); return; }
      if (Object.keys(req.query).length) throw new PullWorkerError('invalid');
      res.json(await action(req, identity));
    } catch (error) {
      const status = error instanceof z.ZodError ? 400 : error instanceof PullWorkerError
        ? error.code === 'owner' ? 403 : error.code === 'invalid' ? 400 : error.code === 'unavailable' ? 503 : 409 : 500;
      // Never echo prompts, authentication headers, raw errors or storage paths.
      res.status(status).json({ error: status === 500 ? 'PULL_WORKER_UNAVAILABLE' : `PULL_WORKER_${status}` });
    }
  };
  router.post('/claim', route(async (req, identity) => { empty.parse(req.body ?? {}); return { claim: await options.host.claim(identity) ?? null }; }));
  router.post('/begin', route(async (req, identity) => options.host.begin(identity, pullLeaseSchema.parse(req.body))));
  router.post('/heartbeat', route(async (req, identity) => options.host.heartbeat(identity, pullLeaseSchema.parse(req.body))));
  router.post('/finish', route(async (req, identity) => {
    const { result, ...lease } = finishSchema.parse(req.body);
    await options.host.finish(identity, lease, result); return { accepted: true };
  }));
  router.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    const status = (error as { status?: number })?.status === 413 ? 413 : 400;
    res.status(status).json({ error: `PULL_WORKER_${status}` });
  });
  return router;
}

export type PullTransport = Readonly<{
  claim(): Promise<import('./pull-worker.js').PullClaim | undefined>;
  begin(lease: PullLease): Promise<import('./pull-worker.js').PullClaim>;
  heartbeat(lease: PullLease): Promise<z.infer<typeof heartbeatSchema>>;
  finish(lease: PullLease, result: PullResult): Promise<void>;
}>;
/** The caller supplies an existing in-memory delegated authorization value.
 * This client cannot log in, refresh credentials, follow redirects or expose a Mac port. */
export function createAuthenticatedPullTransport(options: Readonly<{
  baseUrl: string; authorization(): string; requestTimeoutMs?: number; testLoopback?: boolean;
}>): PullTransport {
  const url = new URL(options.baseUrl);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new PullWorkerError('invalid', 'plain HTTPS origin required');
  if (url.hostname.endsWith('.devtunnels.ms')) throw new PullWorkerError('invalid', 'DevTunnel relay is not a cloud/Mac split');
  const fixtureLoopback = options.testLoopback === true && url.protocol === 'http:' && url.hostname === '127.0.0.1';
  if (!fixtureLoopback && (url.protocol !== 'https:' || !isValidPublicHostname(url.hostname))) throw new PullWorkerError('invalid', 'public HTTPS origin required');
  const timeout = options.requestTimeoutMs ?? 5000;
  if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 30000) throw new PullWorkerError('invalid');
  async function post(operation: string, body: unknown): Promise<unknown> {
    const authorization = options.authorization();
    if (!authorization || /[\r\n]/.test(authorization)) throw new PullWorkerError('unavailable', 'existing authorization required');
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeout);
    try {
      const response = await fetch(`${url.origin}/api/pull-worker/${operation}`, { method: 'POST',
        headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify(body),
        redirect: 'error', signal: abort.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new PullWorkerError('unavailable', `PULL_WORKER_HTTP_${response.status}`);
      if (!response.body) throw new PullWorkerError('unavailable');
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          length += part.value.byteLength;
          if (length > 256 * 1024) { abort.abort(); throw new PullWorkerError('unavailable', 'response limit exceeded'); }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      if (error instanceof PullWorkerError) throw error;
      throw new PullWorkerError('unavailable', 'PULL_WORKER_DISCONNECTED');
    } finally { clearTimeout(timer); }
  }
  const reference = (lease: PullLease) => pullLeaseSchema.parse({ jobId: lease.jobId, leaseId: lease.leaseId });
  return {
    async claim() { const value = z.object({ claim: pullClaimSchema.nullable() }).strict().parse(await post('claim', {})); return value.claim ?? undefined; },
    async begin(lease) { return pullClaimSchema.parse(await post('begin', reference(lease))); },
    async heartbeat(lease) { return heartbeatSchema.parse(await post('heartbeat', reference(lease))); },
    async finish(lease, result) { z.object({ accepted: z.literal(true) }).strict().parse(await post('finish', { ...reference(lease), result: pullResultSchema.parse(result) })); },
  };
}
