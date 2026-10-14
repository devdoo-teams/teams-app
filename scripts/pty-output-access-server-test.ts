import assert from 'node:assert/strict';

import { createServerDerivedCoreScope } from '../src/server/core-orchestration-service.js';
import { connectNodePtyReadProcess } from '../src/server/node-pty-read-process.js';
import { PtyReadSessionRegistry } from '../src/server/pty-read-session.js';
import { createPtyOutputReadAccess } from '../src/server/pty-output-access.js';
import { createPtyReadTestContext } from './fixtures/pty-read-test-context.js';
import { SyntheticPtyReadSource } from './fixtures/synthetic-pty-read-source.js';

const context = await createPtyReadTestContext();
const registry = new PtyReadSessionRegistry({ jobs: context.jobs });
const source = new SyntheticPtyReadSource();
const identity = registry.register(context.scope, context.jobId, connectNodePtyReadProcess(source));
let checks = 0;
const check = (name: string, run: () => void) => { run(); checks++; console.log(`PASS ${name}`); };
try {
  source.emit('token=synthetic-private\n한글😀\n');
  const access = createPtyOutputReadAccess({ jobs: context.jobs, sessions: registry, policy: { authorize: () => ({ allowed: true }) } });
  check('current server-owned Core scope can describe and read only an existing masked session', () => {
    assert.deepEqual(access.describe(context.scope, context.jobId), identity);
    const read = access.read(context.scope, identity, 0);
    assert.equal(read.source, 'pty'); assert.equal(read.outputMode, 'redacted-lines');
    assert.match(read.frames.map((x: { text: string }) => x.text).join(''), /token=\[REDACTED\]/);
    assert.doesNotMatch(JSON.stringify(read), /synthetic-private/);
    assert.equal(source.kills, 0);
  });
  check('each metadata or output read rechecks the current existing execution permission', () => {
    let allowed = true; const observed: Array<{ scope: unknown; mode: unknown }> = [];
    const guarded = createPtyOutputReadAccess({ jobs: context.jobs, sessions: registry, policy: { authorize: (scope: unknown, mode: unknown) => {
      observed.push({ scope, mode }); return allowed ? { allowed: true } : { allowed: false, reason: 'read-forbidden' };
    } } });
    guarded.describe(context.scope, context.jobId); guarded.read(context.scope, identity, 0);
    allowed = false;
    assert.throws(() => guarded.describe(context.scope, context.jobId), /access-denied/);
    assert.throws(() => guarded.read(context.scope, identity, 0), /access-denied/);
    assert.equal(observed.length, 4); assert.ok(observed.every(call => call.scope === context.scope && call.mode === 'read-only'));
  });
  check('client-selected authorization fields cannot be smuggled in a session identity', () => {
    for (const name of ['scope', 'tenantId', 'requesterId', 'conversationId']) {
      assert.throws(() => access.read(context.scope, { ...identity, [name]: 'forged' }, 0), /invalid-request/);
    }
  });
  check('foreign tenant, foreign owner and unbranded scope cannot touch the session source', () => {
    let touched = 0;
    const guarded = createPtyOutputReadAccess({ jobs: context.jobs, policy: { authorize: () => ({ allowed: true }) }, sessions: {
      describe: (...args: Parameters<typeof registry.describe>) => { touched++; return registry.describe(...args); },
      read: (...args: Parameters<typeof registry.read>) => { touched++; return registry.read(...args); },
    } });
    for (const scope of [createServerDerivedCoreScope({ ...context.scope, tenantId: 'foreign' }),
      createServerDerivedCoreScope({ ...context.scope, requesterId: 'foreign' }), JSON.parse(JSON.stringify(context.scope))]) {
      assert.throws(() => guarded.describe(scope, context.jobId), /access-denied|session-unavailable/);
      assert.throws(() => guarded.read(scope, identity, 0), /access-denied|session-unavailable/);
    }
    assert.equal(touched, 0);
  });
  check('the existing principal can reconnect across its authenticated conversations without changing the session', () => {
    const scope = createServerDerivedCoreScope({ ...context.scope, conversationId: 'another-owner-conversation' });
    assert.deepEqual(access.describe(scope, context.jobId), identity);
    const first = access.read(scope, identity, 0);
    assert.equal(access.read(scope, identity, first.nextCursor).frames.length, 0);
    assert.equal(source.kills, 0);
  });
  check('session, generation, cursor and registry closure errors remain fixed and cannot start a replacement', () => {
    for (const other of [{ ...identity, sessionId: 'unknown' }, { ...identity, generation: 2 }]) {
      assert.throws(() => access.read(context.scope, other, 0), /session-unavailable/);
    }
    for (const cursor of [-1, NaN, Infinity, 0.2, 100000]) {
      assert.throws(() => access.read(context.scope, identity, cursor), /invalid-request/);
    }
    assert.throws(() => access.read(context.scope, null as never, 0), /invalid-request/);
    assert.equal(source.kills, 0);
  });
  check('unexpected policy or source diagnostics cannot escape through the read boundary', () => {
    const badPolicy = createPtyOutputReadAccess({ jobs: context.jobs, sessions: registry, policy: {
      authorize: () => { throw new Error('token=synthetic-private'); },
    } });
    assert.throws(() => badPolicy.describe(context.scope, context.jobId), /^PtyOutputAccessError: access-denied$/);
    const badSource = createPtyOutputReadAccess({ jobs: context.jobs, policy: { authorize: () => ({ allowed: true }) }, sessions: {
      describe: () => { throw new Error('token=synthetic-private'); }, read: () => { throw new Error('token=synthetic-private'); },
    } });
    assert.throws(() => badSource.describe(context.scope, context.jobId), /^PtyOutputAccessError: read-failed$/);
    assert.throws(() => badSource.read(context.scope, identity, 0), /^PtyOutputAccessError: read-failed$/);
  });
  check('a closed registry is unavailable and cannot be recreated by discovery', () => {
    registry.dispose(); assert.throws(() => access.describe(context.scope, context.jobId), /session-unavailable/);
    assert.throws(() => access.read(context.scope, identity, 0), /session-unavailable/);
  });
  console.log(`PTY output access server: ${checks} checks PASS (real Core ownership, synthetic source; no public route).`);
} finally { registry.dispose(); await context.cleanup(); }
