import { isApiAuthError } from './auth.js';
import { CoreOrchestrationClientError, type CoreOrchestrationClient } from './core-orchestration-client.js';
import { createExecutionPresentation, ExecutionPresentationJobIdSchema, type ExecutionPresentation } from '../shared/execution-presentation.js';
import type { CoreAgentToolExecution, CoreOrchestrationJob } from '../shared/core-orchestration.js';

export type OutputMonitorSlots = readonly (string | undefined)[];
export function normalizeOutputMonitorSlots(values: OutputMonitorSlots): OutputMonitorSlots {
  const used = new Set<string>();
  return Array.from({ length: 4 }, (_, index) => {
    const id = values[index];
    if (!ExecutionPresentationJobIdSchema.safeParse(id).success || used.has(id!)) return undefined;
    used.add(id!);
    return id;
  });
}
export type OutputMonitorEntry = Readonly<{
  status: 'ready' | 'missing' | 'error'; presentation?: ExecutionPresentation; checkedAt: string;
  commands?: readonly OutputMonitorCommand[];
}>;
export type OutputMonitorCommand = Readonly<CoreAgentToolExecution & { name: string }>;

/** Existing authorized API output is masked before persistence. Keep its
 * bounded excerpt separate from the shorter tool summary and Core outcome. */
export function projectOutputMonitorCommands(job: CoreOrchestrationJob): readonly OutputMonitorCommand[] {
  return (job.tools ?? []).filter(tool => tool.category === 'cli'
    && tool.execution?.source === 'codex.exec.jsonl.command_execution'
    && /^item_[0-9]{1,10}$/u.test(tool.execution.itemId)
    && ['in_progress', 'completed', 'failed', 'declined'].includes(tool.execution.status))
    .slice(-16).map(tool => {
      const execution = tool.execution!;
      const base = { source: execution.source, itemId: execution.itemId, status: execution.status, name: tool.name.slice(0, 120) };
      if (execution.status === 'in_progress') return Object.freeze(base);
      return Object.freeze({ ...base,
        ...(execution.observedAt ? { observedAt: execution.observedAt } : {}),
        ...(Number.isInteger(execution.exitCode) ? { exitCode: execution.exitCode } : {}),
        ...(typeof execution.output === 'string' ? { output: execution.output.slice(0, 1024),
          outputTruncated: execution.outputTruncated === true || execution.output.length > 1024 } : {}),
      });
    });
}
export type OutputMonitorSnapshot = Readonly<{
  key: string; phase: 'loading' | 'ready' | 'blocked'; connection: 'connected' | 'paused';
  entries: Readonly<Record<string, OutputMonitorEntry>>;
}>;
export const outputMonitorKey = (slots: OutputMonitorSlots) => normalizeOutputMonitorSlots(slots).filter(Boolean).join('|');

/** Only GET is available at this boundary. Job ownership and output masking
 * remain enforced by the existing authenticated Core API and server projection. */
export function createOutputMonitorReader(options: {
  client: Pick<CoreOrchestrationClient, 'getJob'>;
  onChange: (snapshot: OutputMonitorSnapshot) => void;
  onAccessDenied?: (error: unknown) => void;
  timeoutMs?: number;
  initialSlots?: OutputMonitorSlots;
}) {
  let disposed = false;
  let blocked = false;
  let paused = false;
  let generation = 0;
  let active: { key: string; abort: AbortController; promise: Promise<void> } | undefined;
  let snapshot: OutputMonitorSnapshot = { key: outputMonitorKey(options.initialSlots ?? []), phase: 'ready', connection: 'connected', entries: {} };
  const publish = (value: OutputMonitorSnapshot) => { snapshot = value; options.onChange(value); };
  return {
    getSnapshot() { return snapshot; },
    read(slots: OutputMonitorSlots): Promise<void> {
      if (disposed || blocked || paused) return Promise.resolve();
      const ids = normalizeOutputMonitorSlots(slots).filter((id): id is string => Boolean(id));
      const key = outputMonitorKey(ids);
      if (active?.key === key) return active.promise;
      active?.abort.abort();
      const attempt = ++generation;
      const abort = new AbortController();
      const current = () => !disposed && !blocked && generation === attempt;
      publish({ key, phase: 'loading', connection: 'connected', entries: snapshot.key === key ? snapshot.entries : {} });
      if (!current() || paused) return Promise.resolve();
      let timedOut = false;
      let onAbort!: () => void;
      const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new Error('Monitor read aborted'));
        abort.signal.addEventListener('abort', onAbort, { once: true });
      });
      const timer = setTimeout(() => { timedOut = true; abort.abort(); }, options.timeoutMs ?? 20_000);
      const reads = ids.map(async id => {
        try {
          const job = await options.client.getJob(id, abort.signal);
          if (job?.id !== id) throw new Error('Monitor response identity mismatch');
          return [id, { status: 'ready', presentation: createExecutionPresentation(job),
            commands: projectOutputMonitorCommands(job), checkedAt: new Date().toISOString() }] as const;
        } catch (error) {
          if (current() && (isApiAuthError(error) || (error instanceof CoreOrchestrationClientError && [401, 403].includes(error.status)))) {
            blocked = true;
            generation++;
            abort.abort();
            publish({ key, phase: 'blocked', connection: 'connected', entries: {} });
            options.onAccessDenied?.(error);
          }
          const status = error instanceof CoreOrchestrationClientError && error.status === 404 ? 'missing' : 'error';
          return [id, { status, checkedAt: new Date().toISOString() }] as const;
        }
      });
      const promise = Promise.race([Promise.all(reads), aborted]).then(entries => {
        if (current() && !abort.signal.aborted) publish({ key, phase: 'ready', connection: 'connected', entries: Object.fromEntries(entries) });
      }, () => {
        if (current() && timedOut) publish({ key, phase: 'ready', connection: 'connected', entries: Object.fromEntries(ids.map(id =>
          [id, { status: 'error', checkedAt: new Date().toISOString() }])) });
      }).finally(() => {
        clearTimeout(timer);
        abort.signal.removeEventListener('abort', onAbort);
        if (active?.abort === abort) active = undefined;
      });
      active = { key, abort, promise };
      return promise;
    },
    pause() {
      if (disposed || blocked || paused) return;
      paused = true; generation++; active?.abort.abort(); active = undefined;
      publish({ ...snapshot, phase: 'ready', connection: 'paused' });
    },
    resume(slots: OutputMonitorSlots): Promise<void> {
      if (disposed || blocked) return Promise.resolve();
      paused = false; return this.read(slots);
    },
    dispose() { disposed = true; generation++; active?.abort.abort(); },
  };
}

/** Own the poller and its GETs together. These controls never invoke a Core
 * mutation or a CLI process; reopening is a fresh read of the same job IDs. */
export function createOutputMonitorSession(options: Parameters<typeof createOutputMonitorReader>[0] & {
  slots: OutputMonitorSlots;
  initiallyPaused?: boolean;
  createPolling(options: { refresh: () => Promise<void> }): { start(): void; stop(): void };
}) {
  const slots = normalizeOutputMonitorSlots(options.slots);
  const reader = createOutputMonitorReader({ ...options, initialSlots: slots, onChange(snapshot) {
    if (snapshot.phase === 'blocked') { epoch++; stopPolling(); }
    options.onChange(snapshot);
  } });
  let disposed = false;
  let paused = options.initiallyPaused === true;
  let epoch = 0;
  let pollingStarted = false;
  const polling = options.createPolling({ refresh: () => reader.read(slots) });
  const stopPolling = () => { if (pollingStarted) { pollingStarted = false; polling.stop(); } };
  const begin = async (reconnect: boolean) => {
    if (disposed) return;
    if (paused) { reader.pause(); return; }
    const attempt = epoch;
    await (reconnect ? reader.resume(slots) : reader.read(slots));
    if (!disposed && !paused && attempt === epoch && !pollingStarted && reader.getSnapshot().phase !== 'blocked') {
      pollingStarted = true; polling.start();
    }
  };
  return Object.freeze({
    start: () => begin(false),
    refresh: () => disposed ? Promise.resolve() : reader.read(slots),
    pause() {
      if (disposed || paused) return;
      paused = true; epoch++; stopPolling(); reader.pause();
    },
    resume() {
      if (disposed) return Promise.resolve();
      paused = false; return begin(true);
    },
    dispose() {
      if (disposed) return;
      disposed = true; epoch++; stopPolling(); reader.dispose();
    },
  });
}
