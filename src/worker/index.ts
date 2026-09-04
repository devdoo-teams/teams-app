import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  AgentDispatchQueue,
  AgentDispatchTask,
} from '../server/queue/agent-dispatch-queue.js';
import {
  AzureAgentDispatchQueue,
  createProductionAzureQueueClient,
  type AgentDispatchStatePort,
  type ProductionAzureQueueClientOptions,
} from '../server/azure-agent-dispatch-queue.js';

export type WorkerExecutionResult = Readonly<{
  result: string;
  providerExecutionId: string;
}>;

export type WorkerExecutionHandle = Readonly<{
  result: Promise<WorkerExecutionResult>;
  terminateProcessTree(): Promise<void>;
  cleanupProcessTree(): Promise<void>;
}>;

export interface WorkerExecutionPort {
  start(task: AgentDispatchTask, context: {
    signal: AbortSignal;
    checkpoint(message: string): Promise<void>;
  }): Promise<WorkerExecutionHandle>;
}

export class AzureCodexWorker {
  private readonly visibilityTimeoutSeconds: number;
  private readonly heartbeatIntervalMs: number;
  private readonly preflight: () => Promise<void>;
  private preflightPromise: Promise<void> | undefined;

  constructor(
    private readonly queue: AgentDispatchQueue,
    private readonly executor: WorkerExecutionPort,
    options: {
      visibilityTimeoutSeconds?: number;
      heartbeatIntervalMs?: number;
      preflight?: () => Promise<void>;
    } = {},
  ) {
    this.visibilityTimeoutSeconds = options.visibilityTimeoutSeconds ?? 30;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 10_000;
    this.preflight = options.preflight ?? (async () => undefined);
  }

  async runOnce(): Promise<'idle' | 'completed' | 'failed' | 'cancelled' | 'duplicate'> {
    await (this.preflightPromise ??= this.preflight());
    const initialLease = await this.queue.lease({ visibilityTimeoutSeconds: this.visibilityTimeoutSeconds });
    if (!initialLease) return 'idle';
    let lease = initialLease;
    const existing = await this.queue.observe(lease.task);
    if (existing && (existing.status === 'completed' || existing.status === 'failed' || existing.status === 'cancelled' || existing.status === 'quarantined')) {
      return 'duplicate';
    }
    if (existing?.cancellationRequested) {
      await this.queue.cancel(lease, existing.cancellationReason ?? 'cancellation requested before execution');
      return 'cancelled';
    }

    const abort = new AbortController();
    let sequence = existing?.checkpoint?.sequence ?? 0;
    let renewalChain: Promise<void> = Promise.resolve();
    let stopped = false;
    let cancelDetected = false;
    let wake!: () => void;
    let wakeReason: 'cancelled' | 'lease-lost' = 'cancelled';
    const cancellation = new Promise<'cancelled' | 'lease-lost'>((resolve) => {
      wake = () => resolve(wakeReason);
    });
    const renew = (message: string): Promise<void> => {
      const operation = renewalChain.then(async () => {
        sequence += 1;
        lease = await this.queue.heartbeat(lease, { sequence, message }, this.visibilityTimeoutSeconds);
      });
      renewalChain = operation.catch(() => undefined);
      return operation;
    };

    let handle: WorkerExecutionHandle;
    try {
      handle = await this.executor.start(lease.task, { signal: abort.signal, checkpoint: renew });
    } catch (cause) {
      const error = asWorkerError(cause);
      await this.queue.fail(lease, error);
      return 'failed';
    }

    const heartbeat = setInterval(() => {
      void (async () => {
        if (stopped) return;
        const state = await this.queue.observe(lease.task);
        if (state?.cancellationRequested && !cancelDetected) {
          cancelDetected = true;
          abort.abort(state.cancellationReason ?? 'cancelled');
          await handle.terminateProcessTree();
          wake();
          return;
        }
        await renew('worker heartbeat');
      })().catch(async () => {
        // A lost pop receipt means another delivery owns the work. Abort this
        // generation and let the durable visibility-timeout recovery proceed.
        wakeReason = 'lease-lost';
        abort.abort('lease-lost');
        await handle.terminateProcessTree();
        wake();
      });
    }, this.heartbeatIntervalMs);

    try {
      const outcome = await Promise.race([
        handle.result.then((result) => ({ kind: 'result' as const, result }), (error) => ({ kind: 'error' as const, error })),
        cancellation.then((reason) => reason === 'cancelled'
          ? ({ kind: 'cancelled' as const })
          : ({ kind: 'lease-lost' as const })),
      ]);
      stopped = true;
      clearInterval(heartbeat);
      await renewalChain;
      if (outcome.kind === 'lease-lost') return 'failed';
      if (outcome.kind === 'cancelled') {
        await this.queue.cancel(lease, 'worker cancellation observed');
        return 'cancelled';
      }
      if (outcome.kind === 'error') {
        if (cancelDetected || abort.signal.aborted) {
          await this.queue.cancel(lease, 'worker cancellation observed');
          return 'cancelled';
        }
        await this.queue.fail(lease, asWorkerError(outcome.error));
        return 'failed';
      }
      if (!outcome.result.result.trim() || !outcome.result.providerExecutionId.trim()) {
        await this.queue.fail(lease, { code: 'EMPTY_TERMINAL_RECEIPT', message: 'worker exited without a nonempty result receipt' });
        return 'failed';
      }
      await this.queue.complete(lease, outcome.result);
      return 'completed';
    } finally {
      stopped = true;
      clearInterval(heartbeat);
      await handle.cleanupProcessTree();
    }
  }
}

export type ProductionAzureCodexWorkerOptions = {
  env: Record<string, string | undefined>;
  state: AgentDispatchStatePort;
  executor: WorkerExecutionPort;
  createDefaultAzureCredential?: ProductionAzureQueueClientOptions['createDefaultAzureCredential'];
  createQueueClient?: ProductionAzureQueueClientOptions['createQueueClient'];
  platform?: NodeJS.Platform;
};

export function createProductionAzureCodexWorker(options: ProductionAzureCodexWorkerOptions): AzureCodexWorker {
  const agentCodexHome = requiredEnvironment(options.env, 'AGENT_CODEX_HOME');
  const codexBin = requiredEnvironment(options.env, 'CODEX_BIN');
  const codexBinSha256 = requiredEnvironment(options.env, 'CODEX_BIN_SHA256');
  const managedIdentityClientId = requiredEnvironment(options.env, 'AZURE_CLIENT_ID');
  const visibilityTimeoutSeconds = positiveIntegerEnvironment(options.env, 'TEAMS_WORKER_VISIBILITY_TIMEOUT_SECONDS', 30);
  const heartbeatIntervalMs = positiveIntegerEnvironment(options.env, 'TEAMS_WORKER_HEARTBEAT_INTERVAL_MS', 10_000);
  if (heartbeatIntervalMs >= visibilityTimeoutSeconds * 1_000) {
    throw new Error('TEAMS_WORKER_HEARTBEAT_INTERVAL_MS must be less than the visibility timeout');
  }
  const client = createProductionAzureQueueClient({
    env: options.env,
    createDefaultAzureCredential: options.createDefaultAzureCredential,
    createQueueClient: options.createQueueClient,
  });
  const queue = new AzureAgentDispatchQueue(client, options.state);
  return new AzureCodexWorker(queue, options.executor, {
    visibilityTimeoutSeconds,
    heartbeatIntervalMs,
    preflight: () => preflightLinuxCodexWorker({
      platform: options.platform,
      agentCodexHome,
      codexBin,
      codexBinSha256,
      managedIdentityClientId,
    }),
  });
}

export async function runAzureCodexWorkerLoop(
  worker: Pick<AzureCodexWorker, 'runOnce'>,
  options: { signal: AbortSignal; idleDelayMs?: number },
): Promise<void> {
  const idleDelayMs = options.idleDelayMs ?? 1_000;
  if (!Number.isSafeInteger(idleDelayMs) || idleDelayMs < 1) throw new Error('worker idle delay must be a positive integer');
  while (!options.signal.aborted) {
    const result = await worker.runOnce();
    if (result === 'idle' && !options.signal.aborted) await abortableDelay(idleDelayMs, options.signal);
  }
}

export type ProductionWorkerComposition = Readonly<{
  state: AgentDispatchStatePort;
  executor: WorkerExecutionPort;
}>;

export async function startProductionAzureCodexWorker(options: {
  env: Record<string, string | undefined>;
  signal: AbortSignal;
  loadComposition?: (absoluteModulePath: string) => Promise<ProductionWorkerComposition>;
}): Promise<void> {
  const modulePath = requiredEnvironment(options.env, 'TEAMS_WORKER_COMPOSITION_MODULE');
  requireAbsolute(modulePath, 'TEAMS_WORKER_COMPOSITION_MODULE');
  const loadComposition = options.loadComposition ?? (async (absolutePath) => {
    const loaded = await import(pathToFileURL(absolutePath).href) as Partial<ProductionWorkerComposition>;
    if (!loaded.state || !loaded.executor) {
      throw new Error('worker composition module must export state and executor');
    }
    return { state: loaded.state, executor: loaded.executor };
  });
  const composition = await loadComposition(path.resolve(modulePath));
  if (!composition?.state || !composition?.executor) {
    throw new Error('worker composition module must provide state and executor');
  }
  const worker = createProductionAzureCodexWorker({
    env: options.env,
    state: composition.state,
    executor: composition.executor,
  });
  await runAzureCodexWorkerLoop(worker, { signal: options.signal });
}

export async function preflightLinuxCodexWorker(input: {
  platform?: NodeJS.Platform;
  agentCodexHome: string;
  codexBin: string;
  codexBinSha256: string;
  managedIdentityClientId: string;
}): Promise<void> {
  if ((input.platform ?? process.platform) !== 'linux') throw new Error('Linux worker platform is required');
  requireAbsolute(input.agentCodexHome, 'AGENT_CODEX_HOME');
  requireAbsolute(input.codexBin, 'CODEX_BIN');
  if (!/^[a-f0-9]{64}$/i.test(input.codexBinSha256)) throw new Error('CODEX_BIN SHA-256 is invalid');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.managedIdentityClientId)) {
    throw new Error('managed identity client ID is invalid');
  }
  const home = await fs.lstat(input.agentCodexHome);
  if (!home.isDirectory() || home.isSymbolicLink() || (home.mode & 0o077) !== 0) {
    throw new Error('AGENT_CODEX_HOME must be an owner-only real directory');
  }
  const executable = await fs.lstat(input.codexBin);
  if (!executable.isFile() || executable.isSymbolicLink() || (executable.mode & 0o111) === 0) {
    throw new Error('CODEX_BIN must be an executable regular file');
  }
  const actual = crypto.createHash('sha256').update(await fs.readFile(input.codexBin)).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(input.codexBinSha256, 'hex'))) {
    throw new Error('CODEX_BIN SHA-256 mismatch');
  }
}

function requireAbsolute(value: string, name: string): void {
  if (!value.startsWith('/') || value.includes('\0')) throw new Error(`${name} must be an absolute path`);
}

function requiredEnvironment(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for production worker configuration`);
  return value;
}

function positiveIntegerEnvironment(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, delayMs);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

function asWorkerError(cause: unknown): { code: string; message: string } {
  const error = cause as { code?: unknown; message?: unknown };
  return {
    code: typeof error?.code === 'string' && error.code.trim() ? error.code.trim() : 'WORKER_EXECUTION_FAILED',
    message: typeof error?.message === 'string' && error.message.trim() ? error.message.trim() : String(cause),
  };
}

if (process.argv.includes('--run')) {
  const shutdown = new AbortController();
  process.once('SIGINT', () => shutdown.abort());
  process.once('SIGTERM', () => shutdown.abort());
  void startProductionAzureCodexWorker({ env: process.env, signal: shutdown.signal }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
