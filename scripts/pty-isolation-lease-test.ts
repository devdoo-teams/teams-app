import assert from 'node:assert/strict';

import { AgentIsolationProvider, type AgentIsolationAcquireInput, type AgentIsolationLease, type AgentIsolationPtySpawnOptions } from '../src/server/agent-execution-policy.js';
import type { ManagedAgentPtyProcess } from '../src/server/agent-pty-process.js';
import type { NodePtyProcessPort, PtyExit } from '../src/server/node-pty-read-process.js';
import { PtyReadSessionRegistry } from '../src/server/pty-read-session.js';
import { createPtyReadTestContext } from './fixtures/pty-read-test-context.js';

class FixtureProvider extends AgentIsolationProvider {
  launches = 0;
  releases = 0;
  pipeStarts = 0;
  launch?: () => ManagedAgentPtyProcess;
  prepare?: () => void;
  constructor(readonly ttlMs = 10000) { super('synthetic-pty-lease'); }
  override async acquire(input: AgentIsolationAcquireInput): Promise<AgentIsolationLease> {
    return this.issueLease({ ...input, ttlMs: this.ttlMs,
      spawn: () => { this.pipeStarts++; throw new Error('No pipe fallback is permitted in this test.'); },
      preparePty: () => { this.prepare?.(); return () => { this.launches++; return this.launch!(); }; },
      dispose: () => { this.releases++; },
    });
  }
}
class SyntheticNativePty implements NodePtyProcessPort {
  readonly pid = 234567;
  data = new Set<(value: string) => void>();
  exits = new Set<(value: PtyExit) => void>();
  rawKills = 0;
  onData = (cb: (value: string) => void) => { this.data.add(cb); return { dispose: () => { this.data.delete(cb); } }; };
  onExit = (cb: (value: PtyExit) => void) => { this.exits.add(cb); return { dispose: () => { this.exits.delete(cb); } }; };
  kill() { this.rawKills++; throw new Error('Raw native kill must be delegated to the verified tree controller.'); }
  emit(value: string) { for (const cb of [...this.data]) cb(value); }
  exit(exitCode = 0) { for (const cb of [...this.exits]) cb({ exitCode }); }
}

const context = await createPtyReadTestContext();
const subject = { ...context.scope, jobId: context.jobId };
const input = { subject, workspace: context.directory, sourceWorkspace: '/synthetic/source', protectedRoots: ['/synthetic/protected'], environmentOverrides: {}, prompt: 'synthetic bounded read only' };
const options: AgentIsolationPtySpawnOptions = { cwd: context.directory, env: {}, cols: 80, rows: 24 };
const provider = new FixtureProvider();
const firstLease = await provider.acquire(input);
assert.equal(typeof firstLease.spawnPty, 'function', 'provider-owned lease must expose only its explicitly supplied PTY capability');
const { ownNodePtyProcess } = await import('../src/server/agent-pty-process.js');
let count = 0;
async function check(name: string, run: () => void | Promise<void>) { await run(); count++; console.log(`PASS ${name}`); }
function native(autoExit = true, failCleanup = false) {
  const process = new SyntheticNativePty();
  let resolveExit!: () => void;
  const exit = new Promise<void>(resolve => { resolveExit = resolve; });
  process.onExit(() => resolveExit());
  let terminations = 0;
  let cleanups = 0;
  const resource = ownNodePtyProcess(process, {
    available: true, platform: 'posix',
    requestTermination() { terminations++; if (autoExit) queueMicrotask(() => process.exit()); },
    async cleanup() { cleanups++; await exit; if (failCleanup) throw new Error('synthetic token=not-published'); },
  }, { cleanupTimeoutMs: 40 });
  return { process, resource, terminations: () => terminations, cleanups: () => cleanups };
}
const unavailable = (reason: string) => (error: unknown) => error instanceof Error && 'reason' in error && error.reason === reason;

try {
  await firstLease.dispose();
  await check('concurrent PTY starts reserve one lease launch before yielding', async () => {
    const p = new FixtureProvider(); const n = native(); p.launch = () => n.resource;
    const lease = await p.acquire(input);
    const first = lease.spawnPty!(subject, 'synthetic-executable', [], options);
    await assert.rejects(() => lease.spawnPty!(subject, 'synthetic-executable', [], options), unavailable('provider-rejected-request'));
    const resource = await first;
    assert.equal(resource, n.resource); assert.equal(p.launches, 1); assert.equal(p.pipeStarts, 0);
    await lease.dispose();
    assert.equal(n.terminations(), 1); assert.equal(n.cleanups(), 1); assert.equal(p.releases, 1);
    assert.equal(n.process.rawKills, 0);
  });
  await check('lease disposal waits for native exit and verified tree cleanup before provider release', async () => {
    const p = new FixtureProvider(); const n = native(false); p.launch = () => n.resource;
    const lease = await p.acquire(input); await lease.spawnPty!(subject, 'synthetic', [], options);
    let disposed = false;
    const disposing = lease.dispose().then(() => { disposed = true; });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(disposed, false); assert.equal(p.releases, 0);
    n.process.exit(3); await disposing;
    assert.deepEqual(await n.resource.exited, { exitCode: 3 });
    assert.equal(p.releases, 1); assert.equal(n.terminations(), 1);
    await lease.dispose(); assert.equal(p.releases, 1);
  });
  await check('dispose during launch handoff reaps child and rejects a stale capability', async () => {
    const p = new FixtureProvider(); const n = native(); p.launch = () => n.resource;
    const lease = await p.acquire(input);
    const starting = lease.spawnPty!(subject, 'synthetic', [], options);
    const disposing = lease.dispose();
    await assert.rejects(() => starting, unavailable('stale-isolation-lease'));
    await disposing;
    assert.equal(n.terminations(), 1); assert.equal(n.cleanups(), 1); assert.equal(p.releases, 1);
  });
  await check('pre-aborted starts never invoke native launch; abort during handoff cleans once', async () => {
    const p = new FixtureProvider(); const n = native(); p.launch = () => n.resource;
    const lease = await p.acquire(input); const aborted = new AbortController(); aborted.abort();
    await assert.rejects(() => lease.spawnPty!(subject, 'synthetic', [], { ...options, signal: aborted.signal }));
    assert.equal(p.launches, 0);
    const controller = new AbortController();
    const starting = lease.spawnPty!(subject, 'synthetic', [], { ...options, signal: controller.signal }); controller.abort();
    await assert.rejects(() => starting);
    await lease.dispose(); assert.equal(n.terminations(), 1); assert.equal(p.releases, 1);
  });
  await check('natural exit, cancellation, observer termination and disposal share one tree cleanup', async () => {
    const p = new FixtureProvider(); const n = native(false); p.launch = () => n.resource;
    const lease = await p.acquire(input); const resource = await lease.spawnPty!(subject, 'synthetic', [], options);
    const registry = new PtyReadSessionRegistry({ jobs: context.jobs });
    const identity = registry.register(context.scope, context.jobId, resource.readProcess);
    n.process.emit('synthetic native output\n');
    const cursor = registry.read(context.scope, identity).nextCursor;
    assert.equal(registry.read(context.scope, identity, cursor).generation, identity.generation);
    assert.equal(p.launches, 1);
    n.process.exit(7); registry.terminate(context.scope, identity);
    await Promise.all([resource.terminate(), lease.dispose(), resource.finished]);
    assert.equal(registry.read(context.scope, identity).state, 'exited');
    assert.equal(n.terminations(), 1); assert.equal(n.cleanups(), 1); assert.equal(n.process.rawKills, 0);
    registry.dispose();
  });
  await check('late observer receives an already-observed native exit, not a false running state', async () => {
    const n = native(false); n.process.exit(9); await n.resource.finished;
    const registry = new PtyReadSessionRegistry({ jobs: context.jobs });
    const identity = registry.register(context.scope, context.jobId, n.resource.readProcess);
    assert.equal(registry.read(context.scope, identity).state, 'exited');
    assert.equal(registry.read(context.scope, identity).exit?.exitCode, 9); registry.dispose();
  });
  await check('cleanup failure keeps provider reservation and never reports disposed success', async () => {
    const p = new FixtureProvider(); const n = native(true, true); p.launch = () => n.resource;
    const lease = await p.acquire(input); await lease.spawnPty!(subject, 'synthetic', [], options);
    await assert.rejects(() => lease.dispose(), /PTY_CLEANUP_UNVERIFIED/);
    await assert.rejects(() => lease.dispose(), /PTY_CLEANUP_UNVERIFIED/);
    assert.equal(p.releases, 0); assert.equal(n.terminations(), 1);
    assert.equal(n.cleanups(), 1);
  });
  await check('unconfirmed native exit times out without releasing the lease', async () => {
    const p = new FixtureProvider(); const n = native(false); p.launch = () => n.resource;
    const lease = await p.acquire(input); await lease.spawnPty!(subject, 'synthetic', [], options);
    await assert.rejects(() => lease.dispose(), /PTY_CLEANUP_UNVERIFIED/);
    assert.equal(p.releases, 0); n.process.exit();
    assert.equal(n.process.exits.size, 1, 'late native exit removes the managed lifecycle listener after a timed-out cleanup');
  });
  await check('owner, tenant, job, workspace, protected path and dimensions reject before launch', async () => {
    const p = new FixtureProvider(); p.launch = () => { throw new Error('must not launch'); };
    const lease = await p.acquire(input);
    for (const patch of [{ requesterId: 'other' }, { tenantId: 'other' }, { jobId: 'other' }, { conversationId: 'other' }]) {
      await assert.rejects(() => lease.spawnPty!({ ...subject, ...patch }, 'synthetic', [], options));
    }
    await assert.rejects(() => lease.spawnPty!(subject, 'synthetic', [], { ...options, cwd: '/other' }));
    await assert.rejects(() => lease.spawnPty!(subject, 'synthetic', ['/synthetic/protected/private'], options));
    for (const cols of [0, -1, 1.1, Infinity, 10000]) await assert.rejects(() => lease.spawnPty!(subject, 'synthetic', [], { ...options, cols }));
    assert.equal(p.launches, 0); await lease.dispose();
  });
  await check('PTY-capable lease never starts pipe and PTY executions together', async () => {
    const p = new FixtureProvider(); const n = native(); p.launch = () => n.resource;
    const lease = await p.acquire(input); await lease.spawnPty!(subject, 'synthetic', [], options);
    await assert.rejects(() => lease.spawn(subject, 'synthetic', [], { cwd: context.directory, env: {}, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }));
    assert.equal(p.pipeStarts, 0); await lease.dispose();
  });
  await check('expiry closes the PTY through the same bounded cleanup path', async () => {
    const p = new FixtureProvider(15); const n = native(); p.launch = () => n.resource;
    const lease = await p.acquire(input); await lease.spawnPty!(subject, 'synthetic', [], options);
    await new Promise(resolve => setTimeout(resolve, 25));
    await lease.dispose(); assert.equal(p.releases, 1); assert.equal(n.terminations(), 1);
    await assert.rejects(() => lease.spawnPty!(subject, 'synthetic', [], options), unavailable('stale-isolation-lease'));
  });
  await check('unknown native start failure quarantines reservation instead of claiming cleanup', async () => {
    const p = new FixtureProvider(); p.launch = () => { throw new Error('synthetic token=must-not-escape'); };
    const lease = await p.acquire(input);
    await assert.rejects(() => lease.spawnPty!(subject, 'synthetic', [], options), /PTY_START_UNVERIFIED/);
    await assert.rejects(() => lease.dispose(), /PTY_START_UNVERIFIED/);
    assert.equal(p.releases, 0); assert.equal(p.launches, 1);
  });
  await check('caller mutation cannot replace the cancellation signal during handoff', async () => {
    const p = new FixtureProvider(); const n = native(); p.launch = () => n.resource;
    const lease = await p.acquire(input); const original = new AbortController(); const replacement = new AbortController();
    const mutable = { ...options, signal: original.signal };
    const starting = lease.spawnPty!(subject, 'synthetic', [], mutable);
    mutable.signal = replacement.signal; original.abort();
    await assert.rejects(() => starting, unavailable('stale-isolation-lease'));
    await lease.dispose(); assert.equal(n.terminations(), 1);
  });
  await check('cancellation or disposal during trusted preparation never starts a native child', async () => {
    for (const action of ['abort', 'dispose']) {
      const p = new FixtureProvider(); const n = native(); p.launch = () => n.resource;
      const lease = await p.acquire(input); const cancellation = new AbortController();
      p.prepare = () => { if (action === 'abort') cancellation.abort(); else void lease.dispose(); };
      await assert.rejects(() => lease.spawnPty!(subject, 'synthetic', [], { ...options, signal: cancellation.signal }));
      assert.equal(p.launches, 0); await lease.dispose();
      await n.resource.terminate();
    }
  });
  console.log(`PTY isolation lease: ${count} checks PASS (synthetic process/control; Core ownership and lease validation are real).`);
} finally { await context.cleanup(); }
