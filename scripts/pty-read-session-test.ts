import assert from 'node:assert/strict';

import { createServerDerivedCoreScope } from '../src/server/core-orchestration-service.js';
import { connectNodePtyReadProcess, type NodePtyProcessPort } from '../src/server/node-pty-read-process.js';
import { PtyReadSessionRegistry } from '../src/server/pty-read-session.js';
import { createPtyReadTestContext } from './fixtures/pty-read-test-context.js';

class SyntheticPty implements NodePtyProcessPort {
  readonly pid = 123456;
  readonly data = new Set<(value: string) => void>();
  readonly exits = new Set<(value: { exitCode: number; signal?: number }) => void>();
  kills = 0;
  killError = false;
  onData = (callback: (value: string) => void) => { this.data.add(callback); return { dispose: () => { this.data.delete(callback); } }; };
  onExit = (callback: (value: { exitCode: number; signal?: number }) => void) => { this.exits.add(callback); return { dispose: () => { this.exits.delete(callback); } }; };
  kill() { this.kills++; if (this.killError) throw new Error('synthetic token=do-not-publish'); }
  emit(value: string) { for (const callback of [...this.data]) callback(value); }
  exit(exitCode = 0, signal?: number) { for (const callback of [...this.exits]) callback({ exitCode, ...(signal === undefined ? {} : { signal }) }); }
}

const context = await createPtyReadTestContext();
let checks = 0;
function check(name: string, run: () => void) { run(); checks++; console.log(`PASS ${name}`); }
const text = (value: ReturnType<PtyReadSessionRegistry['read']>) => value.frames.map(frame => frame.text).join('');
const code = (expected: string) => (error: unknown) => error instanceof Error && 'code' in error && error.code === expected;
const { jobs, scope, jobId } = context;
const registry = new PtyReadSessionRegistry({ jobs });
const pty = new SyntheticPty();
const source = connectNodePtyReadProcess(pty);
const identity = registry.register(scope, jobId, source);

try {
  check('opaque identity describes actual PTY attachment, never a PID or saved job result', () => {
    assert.match(identity.sessionId, /^[a-f\d-]{36}$/);
    assert.equal(identity.jobId, jobId);
    assert.equal(identity.generation, 1);
    assert.equal(registry.read(scope, identity).source, 'pty');
    assert.equal(registry.read(scope, identity).outputMode, 'redacted-lines');
    assert.equal(registry.read(scope, identity).state, 'running');
    assert.doesNotMatch(JSON.stringify(identity), /123456/);
    assert.equal('write' in source, false);
    assert.equal('resize' in source, false);
  });
  check('ordinary saved-log objects cannot register as a PTY source', () => {
    assert.throws(() => registry.register(scope, jobId, JSON.parse('{"kind":"node-pty","output":"saved log"}')), code('PTY_SOURCE_REQUIRED'));
  });
  check('one job has at most one live PTY; reconnect never creates a process', () => {
    assert.throws(() => registry.register(scope, jobId, connectNodePtyReadProcess(new SyntheticPty())), code('PTY_SESSION_ACTIVE'));
    assert.deepEqual(registry.read(scope, identity), registry.read(scope, identity));
    assert.equal(pty.kills, 0);
  });
  check('read with an unfinished credential publishes no prefix', () => {
    pty.emit('한글 😀 token=synthetic-');
    assert.equal(text(registry.read(scope, identity)), '');
    assert.equal(registry.read(scope, identity).pendingOutput, true);
    pty.emit('private-value\r\n');
    assert.equal(text(registry.read(scope, identity)), '한글 😀 token=[REDACTED]\n');
  });
  check('cursor reconnect replays only retained new lines from the same session', () => {
    const first = registry.read(scope, identity);
    pty.emit('second\nthird\n');
    const resumed = registry.read(scope, identity, first.nextCursor);
    assert.equal(text(resumed), 'second\nthird\n');
    assert.equal(resumed.truncated, false);
    assert.equal(text(registry.read(scope, identity, resumed.nextCursor)), '');
  });
  check('VT/clipboard control lines are omitted; no raw control byte crosses the text projection', () => {
    pty.emit('\x1b]52;c;c2VjcmV0\x07\n');
    pty.emit('to\x1b[31mken=synthetic-private\n');
    const output = text(registry.read(scope, identity));
    assert.doesNotMatch(output, /c2VjcmV0|synthetic-private|\x1b|\x07/);
    assert.match(output, /control output omitted/);
  });
  check('multi-line private key bodies are suppressed across callbacks', () => {
    pty.emit('-----BEGIN RSA PRIVATE KEY-----\nsynthetic-key-body\n');
    assert.doesNotMatch(text(registry.read(scope, identity)), /synthetic-key-body/);
    pty.emit('more-private-body\n-----END RSA PRIVATE KEY-----\nnormal\n');
    assert.doesNotMatch(text(registry.read(scope, identity)), /more-private-body/);
    assert.match(text(registry.read(scope, identity)), /normal/);
  });
  check('cross-tenant, cross-owner and missing authentication cannot read or stop a PTY', () => {
    for (const change of [{ tenantId: 'other' }, { requesterId: 'other' }]) {
      const other = createServerDerivedCoreScope({ ...scope, ...change });
      assert.throws(() => registry.read(other, identity), code('PTY_SESSION_NOT_FOUND'));
      assert.throws(() => registry.terminate(other, identity), code('PTY_SESSION_NOT_FOUND'));
    }
    assert.throws(() => registry.read(JSON.parse(JSON.stringify(scope)), identity));
    assert.equal(pty.kills, 0);
  });
  check('same principal can reconnect from another authenticated conversation', () => {
    const other = createServerDerivedCoreScope({ ...scope, conversationId: 'second-owner-chat' });
    assert.equal(registry.read(other, identity).sessionId, identity.sessionId);
  });
  check('malformed/future cursors and wrong identity fail closed', () => {
    for (const cursor of [-1, NaN, Infinity, 0.2, 100000]) assert.throws(() => registry.read(scope, identity, cursor), code('PTY_CURSOR_INVALID'));
    assert.throws(() => registry.read(scope, { ...identity, sessionId: 'unknown' }), code('PTY_SESSION_NOT_FOUND'));
    assert.throws(() => registry.read(scope, { ...identity, generation: identity.generation + 1 }), code('PTY_SESSION_NOT_FOUND'));
  });
  check('termination request is idempotent and is not actual process exit', () => {
    registry.terminate(scope, identity);
    registry.terminate(scope, identity);
    assert.equal(pty.kills, 1);
    assert.equal(registry.read(scope, identity).state, 'terminating');
    assert.equal(registry.read(scope, identity).exit, undefined);
  });
  const late = [...pty.data][0]!;
  check('native exit flushes a final masked line, records exit and disposes listeners', () => {
    pty.emit('password=synthetic-final-secret');
    pty.exit(7, 15);
    const result = registry.read(scope, identity);
    assert.equal(result.state, 'exited');
    assert.deepEqual(result.exit, { exitCode: 7, signal: 15 });
    assert.match(text(result), /password=\[REDACTED\]/);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-final-secret/);
    assert.equal(pty.data.size + pty.exits.size, 0);
    registry.terminate(scope, identity);
    assert.equal(pty.kills, 1);
  });
  check('late output after exit cannot mutate replay', () => {
    const before = registry.read(scope, identity);
    late('late-private\n');
    assert.deepEqual(registry.read(scope, identity), before);
  });
  const nextPty = new SyntheticPty();
  const next = registry.register(scope, jobId, connectNodePtyReadProcess(nextPty));
  check('new execution gets a new session ID and generation; stale reconnect never attaches', () => {
    assert.notEqual(next.sessionId, identity.sessionId);
    assert.equal(next.generation, 2);
    assert.throws(() => registry.read(scope, identity), code('PTY_SESSION_NOT_FOUND'));
  });
  check('termination failure stays unverified without leaking errors or double kill', () => {
    nextPty.killError = true;
    registry.terminate(scope, next);
    registry.terminate(scope, next);
    const result = registry.read(scope, next);
    assert.equal(result.state, 'termination_unverified');
    assert.equal(result.exit, undefined);
    assert.equal(nextPty.kills, 1);
    assert.doesNotMatch(JSON.stringify(result), /do-not-publish/);
    assert.throws(() => registry.register(scope, jobId, connectNodePtyReadProcess(new SyntheticPty())), code('PTY_SESSION_ACTIVE'));
    nextPty.exit();
    assert.equal(registry.read(scope, next).state, 'exited');
  });
  check('bounded replay reports an explicit gap; no silent full-replay claim', () => {
    const bounded = new PtyReadSessionRegistry({ jobs, maxBufferedBytes: 40, maxFrames: 2 });
    const process = new SyntheticPty();
    const current = bounded.register(scope, jobId, connectNodePtyReadProcess(process));
    process.emit('line-one\nline-two\nline-three\n');
    const result = bounded.read(scope, current);
    assert.equal(result.truncated, true);
    assert.equal(text(result), 'line-two\nline-three\n');
    assert.equal(result.frames.length, 2);
    assert.ok(Buffer.byteLength(text(result)) <= 40);
    const again = bounded.read(scope, current, result.frames[0]!.sequence);
    assert.equal(again.truncated, false);
    assert.equal(text(again), 'line-three\n');
    bounded.dispose();
    assert.equal(process.kills, 0, 'observer disposal is never a job cancellation');
  });
  check('observer disposal rejects reads/registrations without cancelling the process', () => {
    const current = registry.register(scope, jobId, connectNodePtyReadProcess(new SyntheticPty()));
    registry.dispose();
    assert.throws(() => registry.read(scope, current), code('PTY_REGISTRY_CLOSED'));
    assert.throws(() => registry.register(scope, jobId, connectNodePtyReadProcess(new SyntheticPty())), code('PTY_REGISTRY_CLOSED'));
  });
  const bounded = new PtyReadSessionRegistry({ jobs, maxPendingBytes: 32 });
  const longPty = new SyntheticPty();
  const longIdentity = bounded.register(scope, jobId, connectNodePtyReadProcess(longPty));
  check('overlong line suppresses the remainder of the session after losing framing', () => {
    longPty.emit('token=' + 'x'.repeat(200000));
    assert.equal(bounded.read(scope, longIdentity).outputSuppressed, true);
    longPty.emit('private-tail\nnormal\n');
    const result = text(bounded.read(scope, longIdentity));
    assert.doesNotMatch(result, /private-tail|xxx|normal/);
    assert.match(result, /line too long/);
  });
  check('server restart does not recreate or adopt old sessions', () => {
    const restarted = new PtyReadSessionRegistry({ jobs });
    assert.throws(() => restarted.read(scope, longIdentity), code('PTY_SESSION_NOT_FOUND'));
    restarted.dispose();
  });
  bounded.dispose();
  check('a clipped retained line has an explicit output-loss flag', () => {
    const small = new PtyReadSessionRegistry({ jobs, maxBufferedBytes: 12 });
    const child = new SyntheticPty();
    const current = small.register(scope, jobId, connectNodePtyReadProcess(child));
    child.emit('한글😀more-output\n');
    const result = small.read(scope, current);
    assert.ok(Buffer.byteLength(text(result)) <= 12);
    assert.doesNotMatch(text(result), /\uFFFD/u);
    assert.equal(result.outputClipped, true);
    small.dispose();
  });
  check('authorization is rechecked for each reconnect and termination request', () => {
    let visible = true;
    const revocable = new PtyReadSessionRegistry({ jobs: { get: (principal, request) => {
      const authorized = jobs.get(principal, request);
      return visible ? authorized : undefined;
    } } });
    const child = new SyntheticPty();
    const current = revocable.register(scope, jobId, connectNodePtyReadProcess(child));
    child.emit('synthetic-private-output\n');
    assert.match(text(revocable.read(scope, current)), /synthetic-private-output/);
    visible = false;
    assert.throws(() => revocable.read(scope, current), code('PTY_SESSION_NOT_FOUND'));
    assert.throws(() => revocable.terminate(scope, current), code('PTY_SESSION_NOT_FOUND'));
    assert.equal(child.kills, 0);
    revocable.dispose();
  });
  check('native exit remains authoritative even when kill subsequently throws', () => {
    class ExitThenThrow extends SyntheticPty {
      override kill() { this.kills++; this.exit(0); throw new Error('synthetic native cleanup failure'); }
    }
    const safe = new PtyReadSessionRegistry({ jobs });
    const child = new ExitThenThrow();
    const current = safe.register(scope, jobId, connectNodePtyReadProcess(child));
    safe.terminate(scope, current);
    assert.equal(safe.read(scope, current).state, 'exited');
    assert.equal(child.kills, 1);
    safe.dispose();
  });
  check('invalid native ports and limits fail before observing a process', () => {
    assert.throws(() => connectNodePtyReadProcess({ ...new SyntheticPty(), pid: 0, kill() {} }));
    for (const maximum of [0, -1, NaN, Infinity, 1.1, 1048577]) {
      assert.throws(() => new PtyReadSessionRegistry({ jobs, maxBufferedBytes: maximum }));
    }
  });
  const secondJob = await context.store.create({ scope, prompt: 'Second synthetic job', mode: 'read-only', provider: 'codex' });
  await context.store.update(secondJob.id, scope, { status: 'running' });
  check('capacity blocks live sessions and evicts only exited output', () => {
    const limited = new PtyReadSessionRegistry({ jobs, maxSessions: 1 });
    const first = new SyntheticPty();
    const old = limited.register(scope, jobId, connectNodePtyReadProcess(first));
    assert.throws(() => limited.register(scope, secondJob.id, connectNodePtyReadProcess(new SyntheticPty())), code('PTY_CAPACITY'));
    first.exit();
    limited.register(scope, secondJob.id, connectNodePtyReadProcess(new SyntheticPty()));
    assert.throws(() => limited.read(scope, old), code('PTY_SESSION_NOT_FOUND'));
    limited.dispose();
  });
  check('an already attached source cannot be rebound to another registry', () => {
    const first = new PtyReadSessionRegistry({ jobs });
    const second = new PtyReadSessionRegistry({ jobs });
    const child = connectNodePtyReadProcess(new SyntheticPty());
    first.register(scope, jobId, child);
    assert.throws(() => second.register(scope, jobId, child), code('PTY_SOURCE_UNAVAILABLE'));
    first.dispose(); second.dispose();
  });
  check('one native process cannot be wrapped twice for two different jobs/owners', () => {
    const child = new SyntheticPty();
    connectNodePtyReadProcess(child);
    assert.throws(() => connectNodePtyReadProcess(child), /already attached/);
  });
  await context.store.update(secondJob.id, scope, { status: 'completed', result: 'Synthetic completed result; not PTY output.' });
  check('completed jobs are not relabelled as live PTY sessions', () => {
    const safe = new PtyReadSessionRegistry({ jobs });
    assert.throws(() => safe.register(scope, secondJob.id, connectNodePtyReadProcess(new SyntheticPty())), code('PTY_JOB_NOT_RUNNING'));
    safe.dispose();
  });
  console.log(`PTY read session contract: ${checks} checks PASS (synthetic event driver; no native PTY claim).`);
} finally {
  registry.dispose();
  await context.cleanup();
}
