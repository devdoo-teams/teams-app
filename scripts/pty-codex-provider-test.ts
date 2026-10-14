import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { ownNodePtyProcess } from '../src/server/agent-pty-process.js';
import type { AgentIsolationPtyLaunchCapability, AgentIsolationPtySpawnOptions } from '../src/server/agent-execution-policy.js';
import type { PtyExit } from '../src/server/node-pty-read-process.js';
import { createCodexPtyLeaseContext } from './fixtures/codex-pty-lease-context.js';

const subject = { tenantId: 'synthetic-tenant', requesterId: 'synthetic-owner', conversationId: 'synthetic-chat', jobId: 'synthetic-job' };
let checks = 0;
async function check(name: string, run: () => Promise<void>) { await run(); checks++; console.log(`PASS ${name}`); }
function capability(failCleanup = false) {
  const launches: Array<{ command: string; args: readonly string[]; options: AgentIsolationPtySpawnOptions }> = [];
  let preflights = 0;
  const pty: AgentIsolationPtyLaunchCapability = {
    preflight() { preflights++; },
    spawn(command, args, options) {
      launches.push({ command, args, options });
      const listeners = new Set<(event: PtyExit) => void>();
      let ended!: () => void; const exit = new Promise<void>(resolve => { ended = resolve; });
      return ownNodePtyProcess({ pid: 345678,
        onData() { return { dispose() {} }; },
        onExit(cb) { listeners.add(cb); return { dispose() { listeners.delete(cb); } }; },
        kill() { throw new Error('Raw native kill must not be used.'); },
      }, { available: true, platform: 'posix', requestTermination() { queueMicrotask(() => { for (const cb of [...listeners]) cb({ exitCode: 0 }); ended(); }); },
        async cleanup() { await exit; if (failCleanup) throw new Error('synthetic token=do-not-publish'); },
      });
    },
  };
  return { pty, launches, preflights: () => preflights };
}

await check('production-style provider is pipe-only unless explicit PTY capability is supplied', async () => {
  const c = await createCodexPtyLeaseContext(subject);
  try { const lease = await c.provider.acquire(c.acquireInput); assert.equal(lease.spawnPty, undefined); await lease.dispose(); assert.equal(c.pipeLaunches(), 0); }
  finally { await c.cleanup(); }
});
await check('PTY receives the same pinned command, strict read-only grammar and trusted environment', async () => {
  const port = capability(); const c = await createCodexPtyLeaseContext(subject, port.pty);
  try {
    const lease = await c.provider.acquire(c.acquireInput);
    const args = c.args(); const resource = await lease.spawnPty!(subject, c.executable, args, { cwd: c.workspace, env: { ...lease.environmentOverrides }, cols: 80, rows: 24 });
    assert.equal(port.preflights(), 1); assert.equal(port.launches.length, 1);
    assert.equal(port.launches[0]!.command, await fs.realpath(c.executable));
    assert.deepEqual(port.launches[0]!.args, args);
    assert.deepEqual(port.launches[0]!.options.env, lease.environmentOverrides);
    assert.equal(port.launches[0]!.options.env.CODEX_HOME, await fs.realpath(c.codexHome));
    assert.equal(c.pipeLaunches(), 0);
    await Promise.all([resource.terminate(), lease.dispose()]);
    const again = await c.provider.acquire(c.acquireInput); await again.dispose();
  } finally { await c.cleanup(); }
});
await check('shells, altered permissions/model/tool args and wrong identity never reach native PTY', async () => {
  const port = capability(); const c = await createCodexPtyLeaseContext(subject, port.pty);
  try {
    const options = { cwd: c.workspace, env: {}, cols: 80, rows: 24 };
    for (const args of [['exec', '--json', '--', 'unprotected'], [...c.args().slice(0, -2), '--config', 'approval_policy="on-request"', '--', 'fixture'], c.args().map(x => x === 'gpt-6-luna' ? 'other-model' : x)]) {
      const lease = await c.provider.acquire(c.acquireInput);
      assert.notDeepEqual(args, c.args(), 'each denial probe must actually alter the trusted grammar');
      await assert.rejects(() => lease.spawnPty!(subject, c.executable, args, { ...options, env: { ...lease.environmentOverrides } }));
      await lease.dispose();
    }
    for (const command of ['/bin/sh', process.execPath]) {
      const fresh = await c.provider.acquire(c.acquireInput);
      await assert.rejects(() => fresh.spawnPty!(subject, command, c.args(), { ...options, env: { ...fresh.environmentOverrides } }));
      await fresh.dispose();
    }
    const ownerLease = await c.provider.acquire(c.acquireInput);
    await assert.rejects(() => ownerLease.spawnPty!({ ...subject, requesterId: 'other' }, c.executable, c.args(), options));
    await ownerLease.dispose(); assert.equal(port.launches.length, 0); assert.equal(c.pipeLaunches(), 0);
  } finally { await c.cleanup(); }
});
await check('launch rechecks executable bytes and owner-only auth metadata before PTY creation', async () => {
  const port = capability(); const c = await createCodexPtyLeaseContext(subject, port.pty);
  try {
    const lease = await c.provider.acquire(c.acquireInput);
    await fs.appendFile(c.executable, '\n// changed after acquisition\n');
    await assert.rejects(() => lease.spawnPty!(subject, c.executable, c.args(), { cwd: c.workspace, env: { ...lease.environmentOverrides }, cols: 80, rows: 24 }));
    await lease.dispose(); assert.equal(port.launches.length, 0);
  } finally { await c.cleanup(); }
  const authPort = capability(); const a = await createCodexPtyLeaseContext(subject, authPort.pty);
  try {
    const lease = await a.provider.acquire(a.acquireInput); await fs.chmod(a.auth, 0o644);
    await assert.rejects(() => lease.spawnPty!(subject, a.executable, a.args(), { cwd: a.workspace, env: { ...lease.environmentOverrides }, cols: 80, rows: 24 }));
    await lease.dispose(); assert.equal(authPort.launches.length, 0);
  } finally { await a.cleanup(); }
});
await check('failed process-controller preflight rejects acquisition before any PTY or pipe spawn', async () => {
  const port = capability(); const c = await createCodexPtyLeaseContext(subject, { ...port.pty, preflight() { throw new Error('synthetic unavailable controller'); } });
  try { await assert.rejects(() => c.provider.acquire(c.acquireInput), /PTY.*preflight/u); assert.equal(port.launches.length, 0); assert.equal(c.pipeLaunches(), 0); }
  finally { await c.cleanup(); }
});
await check('failed PTY tree cleanup keeps the actual provider reservation quarantined', async () => {
  const port = capability(true); const c = await createCodexPtyLeaseContext(subject, port.pty);
  try {
    const lease = await c.provider.acquire(c.acquireInput);
    await lease.spawnPty!(subject, c.executable, c.args(), { cwd: c.workspace, env: { ...lease.environmentOverrides }, cols: 80, rows: 24 });
    await assert.rejects(() => lease.dispose(), /PTY_CLEANUP_UNVERIFIED/);
    await assert.rejects(() => c.provider.acquire(c.acquireInput), /active or starting/);
    assert.equal(port.launches.length, 1); assert.equal(c.pipeLaunches(), 0);
  } finally { await c.cleanup(); }
});
console.log(`Codex PTY provider: ${checks} checks PASS (synthetic signature/auth/preflight; real provider launch and reservation gates).`);
