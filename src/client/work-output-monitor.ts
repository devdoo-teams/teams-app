import { isApiAuthError } from './auth.js';
import { CoreOrchestrationClientError, type CoreOrchestrationClient } from './core-orchestration-client.js';
import { createExecutionPresentation, ExecutionPresentationJobIdSchema, type ExecutionPresentation } from '../shared/execution-presentation.js';

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
}>;
export type OutputMonitorSnapshot = Readonly<{
  key: string; phase: 'loading' | 'ready' | 'blocked'; entries: Readonly<Record<string, OutputMonitorEntry>>;
}>;
export const outputMonitorKey = (slots: OutputMonitorSlots) => normalizeOutputMonitorSlots(slots).filter(Boolean).join('|');

/** Only GET is available at this boundary. Job ownership and output masking
 * remain enforced by the existing authenticated Core API and server projection. */
export function createOutputMonitorReader(options: {
  client: Pick<CoreOrchestrationClient, 'getJob'>;
  onChange: (snapshot: OutputMonitorSnapshot) => void;
  onAccessDenied?: (error: unknown) => void;
  timeoutMs?: number;
}) {
  let disposed = false;
  let blocked = false;
  let generation = 0;
  let active: { key: string; abort: AbortController; promise: Promise<void> } | undefined;
  let snapshot: OutputMonitorSnapshot = { key: '', phase: 'ready', entries: {} };
  const publish = (value: OutputMonitorSnapshot) => { snapshot = value; options.onChange(value); };
  return {
    read(slots: OutputMonitorSlots): Promise<void> {
      if (disposed || blocked) return Promise.resolve();
      const ids = normalizeOutputMonitorSlots(slots).filter((id): id is string => Boolean(id));
      const key = outputMonitorKey(ids);
      if (active?.key === key) return active.promise;
      active?.abort.abort();
      const attempt = ++generation;
      const abort = new AbortController();
      const current = () => !disposed && !blocked && generation === attempt;
      publish({ key, phase: 'loading', entries: snapshot.key === key ? snapshot.entries : {} });
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
          return [id, { status: 'ready', presentation: createExecutionPresentation(job), checkedAt: new Date().toISOString() }] as const;
        } catch (error) {
          if (current() && (isApiAuthError(error) || (error instanceof CoreOrchestrationClientError && [401, 403].includes(error.status)))) {
            blocked = true;
            generation++;
            abort.abort();
            publish({ key, phase: 'blocked', entries: {} });
            options.onAccessDenied?.(error);
          }
          const status = error instanceof CoreOrchestrationClientError && error.status === 404 ? 'missing' : 'error';
          return [id, { status, checkedAt: new Date().toISOString() }] as const;
        }
      });
      const promise = Promise.race([Promise.all(reads), aborted]).then(entries => {
        if (current() && !abort.signal.aborted) publish({ key, phase: 'ready', entries: Object.fromEntries(entries) });
      }, () => {
        if (current() && timedOut) publish({ key, phase: 'ready', entries: Object.fromEntries(ids.map(id =>
          [id, { status: 'error', checkedAt: new Date().toISOString() }])) });
      }).finally(() => {
        clearTimeout(timer);
        abort.signal.removeEventListener('abort', onAbort);
        if (active?.abort === abort) active = undefined;
      });
      active = { key, abort, promise };
      return promise;
    },
    dispose() { disposed = true; generation++; active?.abort.abort(); },
  };
}
