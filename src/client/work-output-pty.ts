import { ApiAuthError, isApiAuthError } from './auth.js';
import { CoreOrchestrationClientError } from './core-orchestration-client.js';
import type { createPtyOutputAccessGroup } from './pty-output-access.js';
import { PtyOutputReadError, type PtyDisplayViewport, type PtyOutputViewSnapshot } from './pty-output-reader.js';
import { PtyOutputAccessError, type PtySessionIdentity } from '../shared/pty-read.js';

type AccessGroup = ReturnType<typeof createPtyOutputAccessGroup>;
type Reader = ReturnType<AccessGroup['open']>;

/** Deliberately no URL, token, scope claims or execution/control capability. */
export type WorkOutputPtyClient = Readonly<{
  describe(jobId: string, signal: AbortSignal): Promise<unknown>;
  read(identity: PtySessionIdentity, after: number, signal: AbortSignal): Promise<unknown>;
}>;
export type WorkOutputPtyCapability = Readonly<{
  client: WorkOutputPtyClient;
  getAccessGroup(): AccessGroup | undefined;
  getAccessGeneration(): number;
}>;
export type WorkOutputPtySnapshot = Readonly<{
  jobId: string;
  phase: 'idle' | 'discovering' | 'observing' | 'unavailable' | 'failed' | 'blocked' | 'closed';
  view?: PtyOutputViewSnapshot;
}>;

/** One existing Core job, one observation. Discovery cannot start or resume it. */
export function createWorkOutputPtyObserver(options: Readonly<{
  jobId: string; capability: WorkOutputPtyCapability;
  onChange?(snapshot: WorkOutputPtySnapshot): void;
  onAccessDenied(error: ApiAuthError): void;
  timeoutMs?: number;
}>) {
  const { jobId, capability } = options;
  if (!identifier(jobId)) throw new TypeError('Invalid observation job.');
  const generation = capability.getAccessGeneration();
  if (!Number.isSafeInteger(generation) || generation < 0) throw new TypeError('Invalid observation access generation.');
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20_000) throw new RangeError('Invalid discovery deadline.');
  let state: WorkOutputPtySnapshot = Object.freeze({ jobId, phase: 'idle' });
  let epoch = 0; let disposed = false; let blocked = false;
  let reader: Reader | undefined; let opening: Promise<void> | undefined; let discovery: AbortController | undefined;
  const publish = (value: WorkOutputPtySnapshot) => { state = Object.freeze(value); options.onChange?.(state); };
  const clear = (phase: 'closed' | 'blocked' | 'idle') => {
    epoch++; discovery?.abort(); discovery = undefined; opening = undefined;
    const previous = reader; reader = undefined; previous?.dispose(); publish({ jobId, phase });
  };
  const current = () => {
    if (!disposed && !blocked) {
      try { if (capability.getAccessGeneration() !== generation) { blocked = true; clear('blocked'); } }
      catch { blocked = true; clear('blocked'); }
    }
    return !disposed && !blocked;
  };
  return Object.freeze({
    getSnapshot(): WorkOutputPtySnapshot { current(); return state; },
    open(): Promise<void> {
      if (!current()) return Promise.resolve();
      if (opening) return opening;
      if (reader) return reader.read();
      const attempt = ++epoch; const abort = new AbortController(); discovery = abort;
      const group = capability.getAccessGroup();
      if (!group) { publish({ jobId, phase: 'unavailable' }); return Promise.resolve(); }
      const active = () => current() && epoch === attempt && !abort.signal.aborted;
      // Reserve before publishing so double clicks and reentrant observers share it.
      const promise = Promise.resolve().then(async () => {
        if (!active()) return;
        publish({ jobId, phase: 'discovering' });
        if (!active()) return;
        let removeAbort = () => {};
        const cancelled = new Promise<never>((_resolve, reject) => {
          const cancel = () => reject(new Error('Discovery stopped.'));
          abort.signal.addEventListener('abort', cancel, { once: true });
          removeAbort = () => abort.signal.removeEventListener('abort', cancel);
        });
        const timer = setTimeout(() => abort.abort(), timeoutMs);
        try {
          const raw = await Promise.race([capability.client.describe(jobId, abort.signal), cancelled]);
          if (!active()) return;
          if (capability.getAccessGroup() !== group || !validIdentity(raw, jobId)) {
            publish({ jobId, phase: 'unavailable' }); return;
          }
          reader = group.open({ identity: raw, transport: { read: capability.client.read.bind(capability.client) },
            onChange(view) { if (current() && epoch === attempt) publish({ jobId, phase: 'observing', view }); },
          });
          await reader.read();
        } catch (error) {
          if (!current() || epoch !== attempt) return;
          const denied = denial(error);
          if (denied) {
            blocked = true; group.invalidate(); clear('blocked'); options.onAccessDenied(denied);
          } else publish({ jobId, phase: unavailable(error) ? 'unavailable' : 'failed' });
        } finally {
          clearTimeout(timer); removeAbort();
          if (discovery === abort) discovery = undefined;
          if (opening === promise) opening = undefined;
        }
      });
      opening = promise; return promise;
    },
    read(): Promise<void> { return current() && reader ? reader.read() : Promise.resolve(); },
    disconnect(): void { if (!current()) return; if (reader) reader.disconnect(); else clear('idle'); },
    resize(viewport: PtyDisplayViewport): void { if (current()) reader?.resize(viewport); },
    close(): void { if (current()) clear('closed'); },
    dispose(): void { if (disposed) return; disposed = true; clear('closed'); },
  });
}

const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value);
function validIdentity(value: unknown, jobId: string): value is PtySessionIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const identity = value as Record<string, unknown>;
  return Object.keys(identity).length === 3 && Object.keys(identity).every(key => ['jobId', 'sessionId', 'generation'].includes(key))
    && identity.jobId === jobId && identifier(identity.sessionId) && Number.isSafeInteger(identity.generation) && Number(identity.generation) > 0;
}
function denial(error: unknown): ApiAuthError | undefined {
  if (isApiAuthError(error)) return new ApiAuthError(error.kind);
  if (error instanceof CoreOrchestrationClientError && [401, 403].includes(error.status)) return new ApiAuthError(error.status === 401 ? 'auth-expired' : 'forbidden');
  if ((error instanceof PtyOutputAccessError || error instanceof PtyOutputReadError) && error.code === 'access-denied') return new ApiAuthError('forbidden');
  return undefined;
}
function unavailable(error: unknown): boolean {
  return error instanceof PtyOutputAccessError && ['session-unavailable', 'invalid-request'].includes(error.code)
    || error instanceof PtyOutputReadError && error.code === 'session-unavailable'
    || error instanceof CoreOrchestrationClientError && [404, 410].includes(error.status);
}
