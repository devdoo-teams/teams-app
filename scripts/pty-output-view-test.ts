import assert from 'node:assert/strict';

import { connectNodePtyReadProcess } from '../src/server/node-pty-read-process.js';
import { PtyReadSessionRegistry, type PtyReadSnapshot } from '../src/server/pty-read-session.js';
import { createPtyReadTestContext } from './fixtures/pty-read-test-context.js';
import { SyntheticPtyReadSource as SyntheticPty } from './fixtures/synthetic-pty-read-source.js';

const implementation = await import('../src/client/pty-output-reader.js').catch(() => ({} as Record<string, any>));
assert.equal(typeof implementation.createPtyOutputReader, 'function', 'an isolated redacted-line reader must exist before a terminal view can reconnect');
const { createPtyOutputReader, PtyOutputReadError } = implementation;
type Reader = ReturnType<typeof import('../src/client/pty-output-reader.js')['createPtyOutputReader']>;
const context = await createPtyReadTestContext();
const registry = new PtyReadSessionRegistry({ jobs: context.jobs, maxFrames: 3 });
const pty = new SyntheticPty();
const identity = registry.register(context.scope, context.jobId, connectNodePtyReadProcess(pty));
const readers: Reader[] = [];
let checks = 0;
const check = async (name: string, run: () => void | Promise<void>) => { await run(); checks++; console.log(`PASS ${name}`); };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
const output = (reader: Reader) => reader.getSnapshot().frames.map(frame => frame.text).join('');
const realRead = (_identity: typeof identity, after: number) => Promise.resolve(registry.read(context.scope, _identity, after));
function reader(read = realRead, extra: Record<string, unknown> = {}): Reader {
  const value = createPtyOutputReader({ identity, transport: { read }, ...extra });
  readers.push(value); return value;
}
const snapshot = (text = 'synthetic output\n'): PtyReadSnapshot => ({
  ...identity, source: 'pty', outputMode: 'redacted-lines', state: 'running',
  frames: [{ sequence: 1, text }], nextCursor: 1, firstAvailableSequence: 1,
  truncated: false, pendingOutput: false, outputSuppressed: false, outputClipped: false,
});

try {
  await check('safe projection holds split secrets and omits raw VT before the reader sees them', async () => {
    const view = reader();
    pty.emit('한글 😀 token=synthetic-');
    await view.read(); assert.equal(output(view), ''); assert.equal(view.getSnapshot().pendingOutput, true);
    pty.emit('private\n\x1b]52;c;c2VjcmV0\x07\n<img src=x onerror=alert(1)>\n');
    await view.read();
    assert.match(output(view), /token=\[REDACTED\]/);
    assert.match(output(view), /control output omitted/);
    assert.match(output(view), /<img src=x onerror=alert\(1\)>/);
    assert.doesNotMatch(output(view), /synthetic-private|c2VjcmV0|\x1b|\x07/);
  });
  await check('disconnect/reconnect retains the same identity and requests only the acknowledged cursor', async () => {
    const calls: Array<{ identity: typeof identity; after: number }> = [];
    const view = reader((current, after) => { calls.push({ identity: current, after }); return realRead(current, after); });
    await view.read(); const first = view.getSnapshot();
    view.disconnect(); assert.equal(view.getSnapshot().phase, 'disconnected');
    pty.emit('reconnected\n'); await view.read();
    assert.equal(calls[1]!.after, first.cursor);
    assert.deepEqual(calls[1]!.identity, identity);
    assert.equal(output(view).split('reconnected').length, 2);
    await view.read(); assert.equal(output(view).split('reconnected').length, 2);
    assert.equal(pty.kills, 0);
  });
  await check('duplicate reads including a reentrant loading callback share one read', async () => {
    const result = deferred<PtyReadSnapshot>(); let calls = 0; let nested: Promise<void> | undefined; let view!: Reader;
    view = reader(() => { calls++; return result.promise; }, { onChange: (state: { phase: string }) => {
      if (state.phase === 'loading') nested = view.read();
    } });
    const first = view.read(); assert.equal(view.read(), first);
    await Promise.resolve(); assert.equal(nested, first); assert.equal(calls, 1);
    result.resolve(snapshot()); await first;
  });
  await check('late response from a disconnected attempt cannot overwrite a new reconnect', async () => {
    const stale = deferred<PtyReadSnapshot>(); let calls = 0;
    const view = reader(() => ++calls === 1 ? stale.promise : Promise.resolve(snapshot('current\n')));
    const first = view.read(); await Promise.resolve(); view.disconnect();
    await view.read(); stale.resolve(snapshot('stale\n')); await first;
    assert.equal(output(view), 'current\n'); assert.equal(view.getSnapshot().phase, 'ready');
  });
  await check('buffer gaps are explicit and replay does not silently join discontinuous history', async () => {
    const view = reader(); await view.read(); view.disconnect();
    pty.emit('gap1\ngap2\ngap3\ngap4\n'); await view.read();
    assert.equal(view.getSnapshot().historyTruncated, true);
    assert.equal(output(view), 'gap2\ngap3\ngap4\n');
  });
  await check('bounded client retention drops whole frames and preserves Unicode', async () => {
    const view = reader(async () => ({ ...snapshot(), frames: [
      { sequence: 1, text: '한글😀\n' }, { sequence: 2, text: '둘째😀\n' }, { sequence: 3, text: '셋째😀\n' },
    ], nextCursor: 3 }), { maxFrames: 2, maxBufferedBytes: 32 });
    await view.read();
    assert.equal(view.getSnapshot().frames.length, 2); assert.equal(view.getSnapshot().historyTruncated, true);
    assert.doesNotMatch(output(view), /\uFFFD/); assert.ok(new TextEncoder().encode(output(view)).length <= 32);
  });
  await check('oversized frames are omitted whole without cutting a masked output token', async () => {
    const view = reader(async () => snapshot('token=[REDACTED]\n'), { maxBufferedBytes: 5 });
    await view.read(); assert.equal(output(view), ''); assert.equal(view.getSnapshot().historyTruncated, true);
    assert.equal(view.getSnapshot().cursor, 1);
  });
  await check('authorization/session failure clears retained output and blocks automatic retry', async () => {
    for (const code of ['access-denied', 'session-unavailable'] as const) {
      let calls = 0;
      const view = reader(async () => { if (++calls === 1) return snapshot(); throw new PtyOutputReadError(code); });
      await view.read(); assert.match(output(view), /synthetic output/);
      await view.read(); assert.equal(view.getSnapshot().phase, 'blocked'); assert.equal(output(view), '');
      await view.read(); assert.equal(calls, 2);
    }
  });
  await check('transport failure retains explicitly stale safe output without exposing raw errors', async () => {
    let calls = 0;
    const view = reader(async () => { if (++calls === 1) return snapshot(); throw new Error('token=synthetic-private'); });
    await view.read(); await view.read();
    assert.equal(view.getSnapshot().phase, 'disconnected'); assert.match(output(view), /synthetic output/);
    assert.equal(view.getSnapshot().error, 'read-failed'); assert.doesNotMatch(JSON.stringify(view.getSnapshot()), /synthetic-private/);
  });
  await check('bounded timeout releases an uncooperative transport and ignores its later response', async () => {
    const late = deferred<PtyReadSnapshot>();
    const view = reader(() => late.promise, { timeoutMs: 5 });
    await view.read(); assert.equal(view.getSnapshot().phase, 'disconnected'); assert.equal(view.getSnapshot().error, 'read-timeout');
    late.resolve(snapshot('too late\n')); await Promise.resolve(); assert.equal(output(view), '');
  });
  await check('wrong job/session/generation and raw modes are rejected before publication', async () => {
    for (const change of [{ jobId: 'task-other' }, { sessionId: 'other' }, { generation: identity.generation + 1 },
      { source: 'saved-log' }, { outputMode: 'raw-vt' }, { outputMode: undefined }]) {
      const view = reader(async () => ({ ...snapshot(), ...change }) as PtyReadSnapshot);
      await view.read(); assert.equal(view.getSnapshot().phase, 'blocked'); assert.equal(output(view), '');
      assert.equal(view.getSnapshot().error, 'invalid-snapshot');
    }
  });
  await check('control-bearing claimed-safe frames are rejected, including clipboard, carriage return and bidi controls', async () => {
    for (const value of ['\x1b[2J', '\x1b]52;c;x\x07', '\x08rewrite', '\rrewrite', '\x9b31m', '\u202eforged']) {
      const view = reader(async () => snapshot(value)); await view.read();
      assert.equal(view.getSnapshot().phase, 'blocked'); assert.equal(output(view), '');
    }
  });
  await check('gapped/duplicate/reversed/future cursors and malformed flags fail closed', async () => {
    const invalid = [
      { frames: [{ sequence: 2, text: 'gap\n' }], nextCursor: 2 },
      { frames: [{ sequence: 1, text: 'one\n' }, { sequence: 1, text: 'duplicate\n' }] },
      { nextCursor: -1 }, { firstAvailableSequence: 4 }, { truncated: true }, { pendingOutput: 'yes' },
      { frames: [] }, { state: 'unknown' }, { state: 'exited' }, { exit: { exitCode: 0 } },
      { frames: [{ sequence: 1, text: 4 }] }, { nextCursor: Number.MAX_SAFE_INTEGER + 1 },
    ];
    for (const change of invalid) {
      const view = reader(async () => ({ ...snapshot(), ...change }) as PtyReadSnapshot);
      await view.read(); assert.equal(view.getSnapshot().phase, 'blocked'); assert.equal(output(view), '');
    }
  });
  await check('read cursor regression fails closed even on the same generation', async () => {
    let calls = 0;
    const view = reader(async () => ++calls === 1 ? snapshot() : { ...snapshot(), frames: [], nextCursor: 0 });
    await view.read(); await view.read(); assert.equal(view.getSnapshot().phase, 'blocked'); assert.equal(output(view), '');
  });
  await check('observed exit, uncertain termination and loss flags cannot regress on the same session', async () => {
    for (const previous of [{ state: 'exited', exit: { exitCode: 0 } }, { state: 'termination_unverified' },
      { outputSuppressed: true }, { outputClipped: true }]) {
      let calls = 0;
      const view = reader(async () => ++calls === 1 ? { ...snapshot(), ...previous } as PtyReadSnapshot
        : { ...snapshot(), frames: [] });
      await view.read(); assert.equal(view.getSnapshot().phase, 'ready');
      await view.read(); assert.equal(view.getSnapshot().phase, 'blocked'); assert.equal(output(view), '');
    }
  });
  await check('the identity projection and original read capability remain pinned after caller mutation', async () => {
    const callerIdentity = { ...identity, token: 'synthetic-private' };
    const transport = { read: async () => snapshot() };
    const view = createPtyOutputReader({ identity: callerIdentity, transport }); readers.push(view);
    callerIdentity.jobId = 'task-other';
    transport.read = async () => { throw new Error('replacement capability must not run'); };
    await view.read(); assert.equal(view.getSnapshot().phase, 'ready');
    assert.equal(view.getSnapshot().identity.jobId, identity.jobId);
    assert.doesNotMatch(JSON.stringify(view.getSnapshot()), /synthetic-private/);
  });
  await check('snapshot fields are copied before publication; caller mutation cannot change rendered output', async () => {
    const source = JSON.parse(JSON.stringify(snapshot())) as PtyReadSnapshot;
    const view = reader(async () => source); await view.read();
    (source.frames[0] as { text: string }).text = 'mutated\n';
    assert.equal(output(view), 'synthetic output\n'); assert.ok(Object.isFrozen(view.getSnapshot().frames[0]));
  });
  await check('resizing is display-only and cannot read, write, resize or terminate a PTY', async () => {
    let reads = 0; const view = reader((current, after) => { reads++; return realRead(current, after); });
    await view.read(); const before = view.getSnapshot();
    view.resize({ columns: 40, rows: 12 });
    assert.deepEqual(view.getSnapshot().viewport, { columns: 40, rows: 12 });
    assert.equal(view.getSnapshot().cursor, before.cursor); assert.equal(view.getSnapshot().frames, before.frames);
    assert.equal(reads, 1); assert.equal(pty.kills, 0);
    for (const size of [{ columns: 0, rows: 12 }, { columns: 241, rows: 12 }, { columns: 80, rows: 81 }, { columns: 80.5, rows: 24 }]) {
      assert.throws(() => view.resize(size), /Invalid display viewport/);
    }
    assert.equal('write' in view, false); assert.equal('spawn' in view, false); assert.equal('terminate' in view, false);
  });
  await check('exit is observed independently from connection status and remains reconnectable', async () => {
    pty.exit(); const view = reader(); await view.read();
    assert.equal(view.getSnapshot().sessionState, 'exited'); assert.deepEqual(view.getSnapshot().exit, { exitCode: 0 });
    view.disconnect(); await view.read(); assert.equal(view.getSnapshot().sessionState, 'exited');
    assert.equal(pty.kills, 0);
  });
  await check('close aborts the observer, clears its private text and rejects late publication', async () => {
    const result = deferred<PtyReadSnapshot>(); let signal: AbortSignal | undefined;
    const view = reader((_current, _after, currentSignal?: AbortSignal) => { signal = currentSignal; return result.promise; });
    const first = view.read(); await Promise.resolve(); view.dispose(); view.dispose();
    assert.equal(signal?.aborted, true); result.resolve(snapshot()); await first;
    assert.equal(view.getSnapshot().phase, 'closed'); assert.equal(output(view), ''); assert.equal(pty.kills, 0);
    await view.read(); view.resize({ columns: 80, rows: 24 }); assert.equal(view.getSnapshot().phase, 'closed');
  });
  await check('identity and resource limits fail before transport access', () => {
    for (const changed of [{ generation: 0 }, { jobId: '' }, { sessionId: '' }, { jobId: 5 }, { sessionId: {} }, { jobId: 'task-\u202ebidi' }]) {
      assert.throws(() => createPtyOutputReader({ identity: { ...identity, ...changed }, transport: { read: realRead } }));
    }
    for (const extra of [{ timeoutMs: 0 }, { timeoutMs: 30001 }, { maxFrames: 0 }, { maxBufferedBytes: 1048577 }]) {
      assert.throws(() => reader(realRead, extra));
    }
  });
  console.log(`PTY output view reader: ${checks} checks PASS (real registry/redaction, synthetic source and injected read transport; no production connection).`);
} finally {
  for (const view of readers) view.dispose();
  registry.dispose(); await context.cleanup();
}
