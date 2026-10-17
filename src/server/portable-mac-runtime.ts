import type { TokenCredential } from '@azure/identity';
import { createAuthenticatedPullTransport } from './pull-worker-http.js';
import { MacPullWorker, createAgentServiceMacExecutor } from './mac-pull-worker.js';
import { portableWorkerBindingSchema, type PortableWorkerBinding } from './portable-runtime-config.js';
import { validatePortableObservation, type PortableWorkerObservation } from './portable-observation.js';
import type { AgentService } from './agent-service.js';
import { PullWorkerError } from './pull-worker.js';

/** Reuse a caller-owned delegated credential. Never initiate login, persist tokens or log claims. */
export function createExistingDelegatedAuthorization(options: Readonly<{
  resource: string; credential: Pick<TokenCredential, 'getToken'>;
}>): (signal: AbortSignal) => Promise<string> {
  const resource = options.resource;
  let uri: URL;
  try { uri = new URL(resource); } catch { throw new PullWorkerError('invalid', 'explicit API resource required'); }
  if (uri.protocol !== 'api:' || !uri.hostname || uri.username || uri.password || uri.port || uri.search || uri.hash
    || !/^\/botid-[0-9a-f-]{36}$/iu.test(uri.pathname) || /\s/u.test(resource)) {
    throw new PullWorkerError('invalid', 'explicit API resource required');
  }
  return async signal => {
    try {
      signal.throwIfAborted();
      const receipt = await options.credential.getToken(`${resource}/.default`, { abortSignal: signal });
      signal.throwIfAborted();
      if (!receipt?.token || /[\r\n]/u.test(receipt.token) || !Number.isFinite(receipt.expiresOnTimestamp)
        || receipt.expiresOnTimestamp <= Date.now()) throw new Error('invalid receipt');
      return `Bearer ${receipt.token}`;
    } catch { throw new PullWorkerError('unavailable', 'existing delegated credential unavailable'); }
  };
}


/** Compose only the existing local service. No listener, second executor, login or service close. */
export function createMacPullRuntime(options: Readonly<{
  baseUrl: string; authorization(signal: AbortSignal): string | Promise<string>;
  binding: PortableWorkerBinding; sourceCommit: string;
  service: Pick<AgentService, 'submit' | 'waitForExecutionSettlement' | 'cancelStrict'>;
  observe(signal: AbortSignal): Promise<PortableWorkerObservation>;
  pollIntervalMs?: number; requestTimeoutMs?: number; testLoopback?: boolean;
}>) {
  const binding = portableWorkerBindingSchema.parse(options.binding);
  const interval = options.pollIntervalMs ?? 1000;
  const timeout = options.requestTimeoutMs ?? 3000;
  if (!Number.isSafeInteger(interval) || interval < 100 || interval > 3000
    || !Number.isSafeInteger(timeout) || timeout < 100 || timeout > 5000) throw new PullWorkerError('invalid', 'polling must fit the 30-second lease budget');
  const transport = createAuthenticatedPullTransport({ ...options, requestTimeoutMs: timeout });
  const worker = new MacPullWorker({ transport, executor: createAgentServiceMacExecutor(options.service),
    principal: binding, sourceCommit: options.sourceCommit });
  let closed = false, scheduled = false;
  let status: 'idle' | 'running' | 'settled' | 'blocked' | 'closed' = 'idle';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<unknown> = Promise.resolve();
  function step(): Promise<'idle' | 'running' | 'settled' | 'blocked'> {
    const operation = chain.then(async () => {
      if (closed || status === 'blocked') return 'blocked' as const;
      const abort = new AbortController();
      let observationTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const observation = await Promise.race([options.observe(abort.signal), new Promise<never>((_resolve, reject) => {
          observationTimer = setTimeout(() => { abort.abort(); reject(new PullWorkerError('unavailable')); }, 5000);
        })]);
        abort.signal.throwIfAborted();
        await transport.observe(validatePortableObservation(observation, options.sourceCommit, Date.now()));
        status = await worker.step();
      } catch { await worker.disconnect(); status = 'blocked'; }
      finally { if (observationTimer) clearTimeout(observationTimer); }
      return status;
    });
    chain = operation.catch(() => undefined); return operation;
  }
  function schedule() {
    if (!scheduled || closed || status === 'blocked') return;
    timer = setTimeout(() => { timer = undefined; void step().then(schedule, () => { status = 'blocked'; }); }, interval);
  }
  return {
    step,
    start() { if (closed || status === 'blocked') throw new PullWorkerError('unavailable'); if (!scheduled) { scheduled = true; schedule(); } },
    reconnect() { if (closed) throw new PullWorkerError('unavailable'); worker.reconnect(); status = 'idle'; },
    status: () => status,
    async close(): Promise<boolean> {
      closed = true; scheduled = false; if (timer) clearTimeout(timer);
      await chain; const verified = await worker.close(); status = 'closed'; return verified;
    },
  };
}
