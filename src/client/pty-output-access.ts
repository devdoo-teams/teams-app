import { ApiAuthError, isApiAuthError } from './auth.js';
import { CoreOrchestrationClientError } from './core-orchestration-client.js';
import { createPtyOutputReader, PtyOutputReadError, type PtyDisplayViewport } from './pty-output-reader.js';
import { PtyOutputAccessError } from '../shared/pty-read.js';

type Reader = ReturnType<typeof createPtyOutputReader>;
type OpenOptions = Parameters<typeof createPtyOutputReader>[0];

/** Explicitly injected observation boundary. No default transport or runtime composition. */
export function createPtyOutputAccessGroup(options: Readonly<{
  getAccessGeneration(): number;
  onAccessDenied(error: unknown): void;
}>) {
  const getGeneration = options.getAccessGeneration.bind(options);
  const generation = getGeneration();
  if (!Number.isSafeInteger(generation) || generation < 0) throw new TypeError('Invalid private access generation.');
  const onAccessDenied = options.onAccessDenied.bind(options);
  const readers = new Set<Reader>();
  let blocked = false;
  const clear = () => {
    blocked = true;
    const active = [...readers];
    readers.clear();
    for (const reader of active) {
      try { reader.dispose(); } catch { /* One rendering callback cannot retain another reader's private text. */ }
    }
  };
  const current = () => {
    if (!blocked) {
      try { if (getGeneration() !== generation) clear(); } catch { clear(); }
    }
    return !blocked;
  };
  return {
    open(input: OpenOptions): Reader {
      if (!current()) throw new PtyOutputReadError('access-denied');
      if (readers.size >= 4) throw new RangeError('PTY observation capacity exceeded.');
      const read = input.transport.read.bind(input.transport);
      const changed = input.onChange;
      const reader = createPtyOutputReader({ ...input, onChange(snapshot) {
        if (current() || snapshot.phase === 'closed') changed?.(snapshot);
      }, transport: { async read(identity, after, signal) {
        try {
          if (!current() || signal.aborted) throw new DOMException('Read stopped.', 'AbortError');
          const result = await read(identity, after, signal);
          if (!current() || signal.aborted) throw new DOMException('Read stopped.', 'AbortError');
          return result;
        }
        catch (error) {
          if (!current() || signal.aborted) throw new DOMException('Read stopped.', 'AbortError');
          if (isApiAuthError(error) || (error instanceof CoreOrchestrationClientError && [401, 403].includes(error.status))
            || (error instanceof PtyOutputReadError && error.code === 'access-denied')
            || (error instanceof PtyOutputAccessError && error.code === 'access-denied')) {
            clear();
            onAccessDenied(new ApiAuthError(isApiAuthError(error) ? error.kind
              : error instanceof CoreOrchestrationClientError && error.status === 401 ? 'auth-expired' : 'forbidden'));
            throw new PtyOutputReadError('access-denied');
          }
          if ((error instanceof PtyOutputAccessError && ['session-unavailable', 'invalid-request'].includes(error.code))
            || (error instanceof CoreOrchestrationClientError && [404, 410].includes(error.status))) {
            throw new PtyOutputReadError('session-unavailable');
          }
          throw error;
        }
      } } });
      readers.add(reader);
      return Object.freeze({
        getSnapshot() { current(); return reader.getSnapshot(); },
        read() { return current() ? reader.read() : Promise.resolve(); },
        disconnect() { if (current()) reader.disconnect(); },
        resize(viewport: PtyDisplayViewport) { if (current()) reader.resize(viewport); },
        dispose() { readers.delete(reader); reader.dispose(); },
      });
    },
    invalidate: clear,
    dispose: clear,
  };
}
