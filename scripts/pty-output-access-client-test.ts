import assert from 'node:assert/strict';

import { ApiAuthError } from '../src/client/auth.js';
import { CoreOrchestrationClientError } from '../src/client/core-orchestration-client.js';
import { createPtyOutputAccessGroup } from '../src/client/pty-output-access.js';
import { PtyOutputReadError } from '../src/client/pty-output-reader.js';
import { PtyOutputAccessError, type PtyReadSnapshot, type PtySessionIdentity } from '../src/shared/pty-read.js';

const identity: PtySessionIdentity = { jobId: 'synthetic-task', sessionId: 'synthetic-session', generation: 1 };
const snapshot = (id = identity, text = '한글😀 synthetic output\n'): PtyReadSnapshot => ({
  ...id, source: 'pty', outputMode: 'redacted-lines', state: 'running',
  frames: [{ sequence: 1, text }], nextCursor: 1, firstAvailableSequence: 1,
  truncated: false, pendingOutput: false, outputSuppressed: false, outputClipped: false,
});
let checks = 0;
const check = async (name: string, run: () => void | Promise<void>) => { await run(); checks++; console.log(`PASS ${name}`); };
const output = (reader: { getSnapshot(): { frames: readonly { text: string }[] } }) => reader.getSnapshot().frames.map(frame => frame.text).join('');
const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

await check('an injected read produces the existing masked view without a URL or execution capability', async () => {
  const group = createPtyOutputAccessGroup({ getAccessGeneration: () => 0, onAccessDenied: () => undefined });
  const reader = group.open({ identity, transport: { read: async () => snapshot() } });
  await reader.read(); assert.equal(output(reader), '한글😀 synthetic output\n');
  group.dispose(); assert.equal(output(reader), '');
});

await check('one current authentication denial clears every reader before notifying the hub', async () => {
  for (const denial of [new ApiAuthError('auth-expired'), new ApiAuthError('forbidden'), new PtyOutputReadError('access-denied'),
    new CoreOrchestrationClientError('synthetic private diagnostic', { code: 'Denied', status: 401, retryable: false }),
    new CoreOrchestrationClientError('synthetic private diagnostic', { code: 'Denied', status: 403, retryable: false })]) {
    let fail = false; const notifications: Array<{ error: unknown; output: string }> = [];
    const group = createPtyOutputAccessGroup({ getAccessGeneration: () => 0, onAccessDenied: (error: unknown) => {
      notifications.push({ error, output: output(first) + output(second) });
    } });
    const first = group.open({ identity, transport: { read: async () => { if (fail) throw denial; return snapshot(); } } });
    const other = { ...identity, jobId: 'synthetic-second', sessionId: 'synthetic-second-session' };
    const second = group.open({ identity: other, transport: { read: async () => snapshot(other) } });
    await first.read(); await second.read(); assert.ok(output(first) && output(second));
    fail = true; await first.read();
    assert.equal(output(first) + output(second), '', 'authentication denial cannot retain stale output in any panel');
    assert.equal(notifications.length, 1);
    assert.ok(notifications[0]!.error instanceof ApiAuthError);
    assert.equal(notifications[0]!.output, '', 'all private output is gone before the parent callback');
    assert.doesNotMatch(String(notifications[0]!.error), /synthetic private/);
    group.dispose();
  }
});

await check('a denial aborts sibling reads and late success or denial cannot publish or notify twice', async () => {
  for (const lateKind of ['success', 'denial'] as const) {
    const late = deferred<PtyReadSnapshot>(); let pending = false; let signal: AbortSignal | undefined; let notices = 0;
    const group = createPtyOutputAccessGroup({ getAccessGeneration: () => 0, onAccessDenied: () => { notices++; } });
    const first = group.open({ identity, transport: { read: async () => { throw new ApiAuthError('forbidden'); } } });
    const other = { ...identity, jobId: 'second', sessionId: 'second-session' };
    let renders = 0;
    const second = group.open({ identity: other, onChange: () => { renders++; }, transport: { read: async (_id: PtySessionIdentity, _after: number, abort: AbortSignal) => {
      signal = abort; return pending ? late.promise : snapshot(other);
    } } });
    await second.read(); pending = true;
    const attempt = second.read(); await Promise.resolve();
    await first.read(); assert.equal(signal?.aborted, true); assert.equal(output(second), '');
    const before = renders;
    if (lateKind === 'success') late.resolve(snapshot(other, 'late private output\n')); else late.reject(new ApiAuthError('auth-expired'));
    await attempt; await new Promise(resolve => setImmediate(resolve));
    assert.equal(renders, before); assert.equal(notices, 1); assert.equal(output(second), ''); group.dispose();
  }
});

await check('the parent access generation invalidates old readers and cannot be recovered by an old response', async () => {
  let generation = 4; let notices = 0;
  const late = deferred<PtyReadSnapshot>(); let calls = 0;
  const group = createPtyOutputAccessGroup({ getAccessGeneration: () => generation, onAccessDenied: () => { notices++; } });
  const reader = group.open({ identity, transport: { read: async () => ++calls === 1 ? snapshot() : late.promise } });
  await reader.read(); const pending = reader.read(); await Promise.resolve();
  generation++;
  assert.equal(output(reader), '', 'a snapshot from an old access generation must not expose retained text');
  late.resolve(snapshot(identity, 'old account output\n')); await pending;
  assert.equal(output(reader), ''); assert.equal(notices, 0);
  assert.throws(() => group.open({ identity, transport: { read: async () => snapshot() } }), /access-denied/);
  await reader.read(); assert.equal(calls, 2); group.dispose();
});

await check('internal access denial clears the group, while a missing session clears only that reader', async () => {
  for (const code of ['access-denied', 'session-unavailable', 'invalid-request'] as const) {
    let fail = false; let notices = 0;
    const group = createPtyOutputAccessGroup({ getAccessGeneration: () => 0, onAccessDenied: () => { notices++; } });
    const reader = group.open({ identity, transport: { read: async () => { if (fail) throw new PtyOutputAccessError(code); return snapshot(); } } });
    const secondIdentity = { ...identity, jobId: 'second', sessionId: 'second-session' };
    const second = group.open({ identity: secondIdentity, transport: { read: async () => snapshot(secondIdentity) } });
    await reader.read(); await second.read(); fail = true; await reader.read();
    assert.equal(output(reader), '');
    assert.equal(notices, code === 'access-denied' ? 1 : 0);
    assert.equal(Boolean(output(second)), code !== 'access-denied'); group.dispose();
  }
});

await check('one view callback cannot prevent clearing other views, and the group has four reusable observation slots', async () => {
  const group = createPtyOutputAccessGroup({ getAccessGeneration: () => 0, onAccessDenied: () => undefined });
  const readers = Array.from({ length: 4 }, () => group.open({ identity, transport: { read: async () => snapshot() } }));
  assert.throws(() => group.open({ identity, transport: { read: async () => snapshot() } }), /capacity/);
  readers[0]!.dispose();
  let ready = false;
  const throwing = group.open({ identity, onChange: state => { if (state.phase === 'closed') throw new Error('synthetic callback failure'); },
    transport: { read: async () => { ready = true; return snapshot(); } } });
  await throwing.read(); await readers[1]!.read(); assert.equal(ready, true);
  assert.doesNotThrow(() => group.invalidate());
  assert.equal(output(readers[1]!) + output(throwing), ''); group.dispose();
});

console.log(`PTY output access client: ${checks} checks PASS (injected transport only; no Teams or native process).`);
