import assert from 'node:assert/strict';
import { createPtyOutputAccessGroup } from '../src/client/pty-output-access.js';
import { PtyOutputAccessError, type PtyReadSnapshot } from '../src/shared/pty-read.js';
import { ApiAuthError } from '../src/client/auth.js';

// Production change caught by this suite: starting/resuming while observing,
// re-describing on reconnect, or retaining frames after close/access withdrawal.
const module = await import('../src/client/work-output-pty.js').catch((error: unknown) => {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
assert.equal(typeof (module as Record<string, unknown>).createWorkOutputPtyObserver, 'function',
  'the hub needs an explicitly injected, one-job read-only PTY observer');
const { createWorkOutputPtyObserver } = module as typeof import('../src/client/work-output-pty.js');
const identity = { jobId: 'task-1', sessionId: 'native-existing-session', generation: 1 };
const finalText = '{"type":"turn.completed","usage":{"input_tokens":999999},"result":"FAKE_COMPLETE"}\n';
const snapshot = (after: number): PtyReadSnapshot => ({ ...identity, source: 'pty', outputMode: 'redacted-lines',
  state: 'running', frames: [{ sequence: 1, text: finalText }, { sequence: 2, text: '한글 😀 [REDACTED]\n' }].filter(x => x.sequence > after),
  firstAvailableSequence: 1, nextCursor: 2, truncated: false, pendingOutput: false, outputSuppressed: false, outputClipped: false });
let checks = 0;
async function check(name: string, run: () => Promise<void>) { await run(); checks++; console.log('PASS ' + name); }
function context(overrides: { describe?: (jobId: string, signal: AbortSignal) => Promise<unknown> } = {}) {
  let generation = 0; const requests: Array<{ kind: string; jobId?: string; after?: number }> = []; const denied: unknown[] = [];
  const group = createPtyOutputAccessGroup({ getAccessGeneration: () => generation, onAccessDenied: error => denied.push(error) });
  const observer = createWorkOutputPtyObserver({ jobId: identity.jobId,
    capability: { getAccessGroup: () => group, getAccessGeneration: () => generation, client: {
      async describe(jobId, signal) { requests.push({ kind: 'describe', jobId }); return overrides.describe ? overrides.describe(jobId, signal) : identity; },
      async read(id, after, signal) { signal.throwIfAborted(); requests.push({ kind: 'read', after }); assert.deepEqual(id, identity); return snapshot(after); },
    } }, onAccessDenied: error => denied.push(error),
  });
  return { observer, requests, denied, group, invalidate: () => { generation++; }, cleanup: () => { observer.dispose(); group.dispose(); } };
}

await check('open is explicit and duplicate metadata/read calls share one observation', async () => {
  const c = context(); try {
    assert.equal(c.requests.length, 0); const first = c.observer.open(); assert.equal(c.observer.open(), first); await first;
    assert.equal(c.requests.filter(r => r.kind === 'describe').length, 1); assert.equal(c.requests.filter(r => r.kind === 'read').length, 1);
    assert.equal(c.observer.getSnapshot().view?.frames[0]?.text, finalText);
    assert.deepEqual(Object.keys(c.observer).sort(), ['close', 'disconnect', 'dispose', 'getSnapshot', 'open', 'read', 'resize']);
  } finally { c.cleanup(); }
});
await check('reconnect reuses identity/cursor, resize and close invoke no launch or metadata operation', async () => {
  const c = context(); try {
    await c.observer.open(); c.observer.disconnect(); c.observer.resize({ columns: 40, rows: 12 }); await c.observer.read();
    assert.equal(c.requests.filter(r => r.kind === 'describe').length, 1); assert.equal(c.requests.at(-1)?.after, 2);
    assert.equal(c.observer.getSnapshot().view?.frames.filter(f => f.text === finalText).length, 1);
    const count = c.requests.length; c.observer.close(); assert.equal(c.observer.getSnapshot().view, undefined); await c.observer.read();
    assert.equal(c.requests.length, count); assert.equal(c.observer.getSnapshot().phase, 'closed');
  } finally { c.cleanup(); }
});
await check('missing session is unavailable and never falls back to a new execution', async () => {
  const c = context({ describe: async () => { throw new PtyOutputAccessError('session-unavailable'); } }); try {
    await c.observer.open(); assert.equal(c.observer.getSnapshot().phase, 'unavailable'); await c.observer.read(); c.observer.disconnect(); c.observer.close();
    assert.deepEqual(c.requests.map(r => r.kind), ['describe']); assert.equal(c.denied.length, 0);
  } finally { c.cleanup(); }
});
await check('closing pending discovery aborts it and a late response cannot publish', async () => {
  let resolve!: (value: unknown) => void; let signal!: AbortSignal;
  const c = context({ describe: async (_job, s) => { signal = s; return new Promise(r => { resolve = r; }); } }); try {
    const opening = c.observer.open(); await Promise.resolve(); c.observer.close(); resolve(identity); await opening;
    assert.equal(signal.aborted, true); assert.equal(c.observer.getSnapshot().phase, 'closed'); assert.equal(c.requests.filter(r => r.kind === 'read').length, 0);
  } finally { c.cleanup(); }
});
await check('parent access generation immediately clears output and cannot reopen the old observer', async () => {
  const c = context(); try {
    await c.observer.open(); c.invalidate(); assert.equal(c.observer.getSnapshot().view, undefined); const calls = c.requests.length;
    await c.observer.open(); await c.observer.read(); assert.equal(c.requests.length, calls); assert.equal(c.denied.length, 0);
  } finally { c.cleanup(); }
});
await check('discovery denial invalidates private readers and reports one sanitized hub failure', async () => {
  const c = context({ describe: async () => { throw new ApiAuthError('auth-expired'); } }); try {
    await c.observer.open(); await c.observer.open(); assert.equal(c.observer.getSnapshot().phase, 'blocked'); assert.equal(c.observer.getSnapshot().view, undefined);
    assert.equal(c.denied.length, 1); assert(c.denied[0] instanceof ApiAuthError);
  } finally { c.cleanup(); }
});
await check('metadata cannot bind a different Core job or copy raw diagnostics into UI state', async () => {
  const c = context({ describe: async () => ({ ...identity, jobId: 'task-private-other' }) }); try {
    await c.observer.open(); assert.equal(c.observer.getSnapshot().phase, 'unavailable'); assert.equal(c.requests.filter(r => r.kind === 'read').length, 0);
    assert(!JSON.stringify(c.observer.getSnapshot()).includes('task-private-other'));
  } finally { c.cleanup(); }
});
await check('reentrant close during discovering publication prevents a metadata request', async () => {
  let describes = 0;
  const group = createPtyOutputAccessGroup({ getAccessGeneration: () => 0, onAccessDenied() {} });
  let observer: ReturnType<typeof createWorkOutputPtyObserver>;
  observer = createWorkOutputPtyObserver({ jobId: identity.jobId, capability: {
    getAccessGeneration: () => 0, getAccessGroup: () => group,
    client: { async describe() { describes++; return identity; }, async read() { return snapshot(0); } },
  }, onAccessDenied() {}, onChange(state) { if (state.phase === 'discovering') observer.close(); } });
  try { await observer.open(); assert.equal(describes, 0); assert.equal(observer.getSnapshot().phase, 'closed'); }
  finally { observer.dispose(); group.dispose(); }
});
await check('a nonsettling metadata port reaches a bounded failure without fallback or private diagnostics', async () => {
  let observed: AbortSignal | undefined; let reads = 0;
  const group = createPtyOutputAccessGroup({ getAccessGeneration: () => 0, onAccessDenied() {} });
  const observer = createWorkOutputPtyObserver({ jobId: identity.jobId, timeoutMs: 15, capability: {
    getAccessGeneration: () => 0, getAccessGroup: () => group,
    client: { async describe(_job, signal) { observed = signal; return new Promise(() => {}); }, async read() { reads++; return snapshot(0); } },
  }, onAccessDenied() {} });
  try { await observer.open(); assert.equal(observed?.aborted, true); assert.equal(observer.getSnapshot().phase, 'failed'); assert.equal(reads, 0); }
  finally { observer.dispose(); group.dispose(); }
});
console.log(JSON.stringify({ result: 'PASS', checks, cliOrModelOrNativeProcessStarts: 0 }));
