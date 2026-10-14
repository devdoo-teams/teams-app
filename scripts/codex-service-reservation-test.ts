import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CodexRunner } from '../src/server/codex-runner.js';
import { SupervisedCommandCleanupError } from '../src/server/supervised-command.js';
import { acquirePrivateDirectoryProcessLease } from '../src/server/process-lease.js';
import { CodexPermissionProfileIsolationProvider } from '../src/server/codex-permission-profile-isolation-provider.js';
import { createCodexPtyLeaseContext } from './fixtures/codex-pty-lease-context.js';

if (process.argv[2] === '--reservation-child') {
  const input = JSON.parse(await fs.readFile(process.argv[3]!, 'utf8')); let preflights = 0;
  const childProvider = new CodexPermissionProfileIsolationProvider({ ...input.options, preflight: async () => { preflights++; },
    executableTrustVerifier: () => undefined, spawn: () => { throw new Error('No native process allowed'); } });
  try { const lease = await childProvider.acquire(input.acquire); await lease.dispose(); console.log(JSON.stringify({ acquired: true, preflights })); }
  catch (error) { assert.match(String(error), /reserved|leased|active|busy/i); console.log(JSON.stringify({ acquired: false, preflights })); }
  process.exit(0);
}

const subject = { tenantId: 'synthetic', requesterId: 'synthetic', conversationId: 'synthetic', jobId: 'synthetic' };
const context = await createCodexPtyLeaseContext(subject, undefined, `
if (process.argv.at(-1) === '--version') { console.log('codex-cli 99.0.0-fixture'); process.exit(0); }
for (const event of [{ type: 'thread.started', thread_id: '019fd700-51cd-7862-a4ef-74ccae0f2b4e' }, { type: 'turn.started' },
 { type: 'item.completed', item: { type: 'agent_message', text: 'SYNTHETIC_PIPE_FINAL' } }, { type: 'turn.completed' }]) console.log(JSON.stringify(event));
`);
let checks = 0;
const check = async (label: string, run: () => Promise<void>) => { await run(); checks++; console.log(`PASS ${label}`); };
const provider = (preflight: () => Promise<void> = async () => undefined) => new CodexPermissionProfileIsolationProvider({
  codexExecutable: context.executable, codexExecutableSha256: context.executableSha256, codexHome: context.codexHome,
  platform: 'darwin', preflight, executableTrustVerifier: () => undefined,
  spawn: () => { throw new Error('No process may start in this reservation-only fixture.'); },
});
try {
  await check('different provider instances reserve one service auth home before any second preflight', async () => {
    let secondPreflights = 0;
    const first = provider(); const second = provider(async () => { secondPreflights++; });
    const lease = await first.acquire(context.acquireInput);
    let unexpected: Awaited<ReturnType<typeof second.acquire>> | undefined;
    try {
      await assert.rejects(async () => { unexpected = await second.acquire(context.acquireInput); }, /reserved|leased|active|busy/i);
      assert.equal(secondPreflights, 0);
    } finally { await unexpected?.dispose(); await lease.dispose(); }
    const next = await second.acquire(context.acquireInput); await next.dispose();
    assert.equal(secondPreflights, 1);
  });
  await check('another OS process sharing the synthetic home is blocked before its preflight', async () => {
    const first = provider(); const lease = await first.acquire(context.acquireInput);
    const input = path.join(context.directory, 'reservation-child.json');
    await fs.writeFile(input, JSON.stringify({ options: { codexExecutable: context.executable, codexExecutableSha256: context.executableSha256,
      codexHome: context.codexHome, platform: 'darwin' }, acquire: context.acquireInput }), { mode: 0o600 });
    const call = () => promisify(execFile)(process.execPath, ['--import', 'tsx/esm', 'scripts/run-module-test.mjs', 'scripts/codex-service-reservation-test.ts', '--reservation-child', input], { timeout: 5000, maxBuffer: 4096 });
    try { assert.deepEqual(JSON.parse((await call()).stdout), { acquired: false, preflights: 0 }); }
    finally { await lease.dispose(); }
    assert.deepEqual(JSON.parse((await call()).stdout), { acquired: true, preflights: 1 });
  });
  await check('the real pipe runner cleanup receipt releases the synthetic service home after a blocked competitor', async () => {
    const owner = new CodexPermissionProfileIsolationProvider({ codexExecutable: context.executable, codexExecutableSha256: context.executableSha256,
      codexHome: context.codexHome, platform: 'darwin', preflight: async () => undefined, executableTrustVerifier: () => undefined });
    const lease = await owner.acquire(context.acquireInput);
    await assert.rejects(() => provider().acquire(context.acquireInput), /leased|reserved|busy/i);
    const runner = new CodexRunner({ command: { executable: context.executable }, processControllerOptions: { graceMs: 20, cleanupWaitMs: 500 } });
    const result = await runner.run({ jobId: subject.jobId, prompt: 'synthetic only', workspace: lease.workspace, mode: 'read-only', subject,
      isolationLease: lease, environmentOverrides: { ...lease.environmentOverrides }, signal: new AbortController().signal, timeoutMs: 2000 });
    assert.equal(result.finalMessage, 'SYNTHETIC_PIPE_FINAL'); await lease.dispose();
    const next = await provider().acquire(context.acquireInput); await next.dispose();
  });
  await check('auth contents and metadata are untouched, and competing attempts leave the active lease usable', async () => {
    const before = await fs.stat(context.auth); const first = provider(); const second = provider();
    const lease = await first.acquire(context.acquireInput);
    await assert.rejects(() => second.acquire(context.acquireInput));
    await lease.dispose(); const after = await fs.stat(context.auth);
    assert.deepEqual([after.ino, after.mode, after.mtimeMs, after.ctimeMs, after.size], [before.ino, before.mode, before.mtimeMs, before.ctimeMs, before.size]);
  });
  await check('private coordination does not reclaim a dead, malformed or foreign owner', async () => {
    const coordination = path.join(context.codexHome, '.teams-execution-coordination');
    const reservation = path.join(coordination, '.execution.teams-sdk-store-lease');
    for (const owner of ['{', JSON.stringify({ version: 1, pid: 2147483647, hostname: os.hostname(), token: 'synthetic', storePath: path.join(coordination, 'execution'), startedAt: new Date().toISOString() }),
      JSON.stringify({ version: 1, pid: process.pid, hostname: 'foreign-host', token: 'synthetic', storePath: path.join(coordination, 'execution'), startedAt: new Date().toISOString() })]) {
      await fs.mkdir(reservation, { mode: 0o700 }); await fs.writeFile(path.join(reservation, 'owner.json'), owner, { mode: 0o600 });
      await assert.rejects(() => provider().acquire(context.acquireInput), /leased|reserved|busy/i);
      assert.equal(await fs.readFile(path.join(reservation, 'owner.json'), 'utf8'), owner);
      await fs.rm(reservation, { recursive: true });
    }
  });
  await check('a replacement owner is preserved and release cannot report success', async () => {
    const reservation = path.join(context.codexHome, '.teams-execution-coordination', '.execution.teams-sdk-store-lease');
    const lease = await provider().acquire(context.acquireInput); const owner = JSON.parse(await fs.readFile(path.join(reservation, 'owner.json'), 'utf8'));
    owner.token = 'synthetic-replacement'; await fs.writeFile(path.join(reservation, 'owner.json'), JSON.stringify(owner), { mode: 0o600 });
    await assert.rejects(() => lease.dispose(), /unverified/i);
    assert.equal(JSON.parse(await fs.readFile(path.join(reservation, 'owner.json'), 'utf8')).token, 'synthetic-replacement');
    await fs.rm(reservation, { recursive: true });
  });
  await check('release never exposes a replacement reservation to an interleaving acquirer', async () => {
    const reservation = path.join(context.codexHome, '.teams-execution-coordination', '.execution.teams-sdk-store-lease');
    const owner = provider(); const lease = await owner.acquire(context.acquireInput);
    const data = JSON.parse(await fs.readFile(path.join(reservation, 'owner.json'), 'utf8'));
    data.token = 'synthetic-interleaving-replacement';
    await fs.writeFile(path.join(reservation, 'owner.json'), JSON.stringify(data));
    const rename = fs.rename;
    let exposed = false; let competitor: Awaited<ReturnType<typeof owner.acquire>> | undefined;
    fs.rename = async (from, to) => {
      await rename(from, to);
      if (String(from) === reservation) {
        try { competitor = await provider().acquire(context.acquireInput); exposed = true; } catch { /* blocked */ }
      }
    };
    try {
      await assert.rejects(() => lease.dispose(), /unverified/i);
      assert.equal(exposed, false, 'an unverified owner must retain its final CAS path throughout release');
      assert.equal(JSON.parse(await fs.readFile(path.join(reservation, 'owner.json'), 'utf8')).token, data.token);
    } finally { fs.rename = rename; await competitor?.dispose(); await fs.rm(reservation, { recursive: true, force: true }); }
  });
  await check('an empty reservation is never overwritten or reclaimed', async () => {
    const reservation = path.join(context.codexHome, '.teams-execution-coordination', '.execution.teams-sdk-store-lease');
    await fs.mkdir(reservation, { mode: 0o700 });
    const before = await fs.stat(reservation);
    let unexpected: Awaited<ReturnType<ReturnType<typeof provider>['acquire']>> | undefined;
    try {
      await assert.rejects(async () => { unexpected = await provider().acquire(context.acquireInput); }, /leased|reserved|busy/i);
      assert.equal((await fs.stat(reservation)).ino, before.ino);
      assert.deepEqual(await fs.readdir(reservation), []);
    } finally { await unexpected?.dispose(); await fs.rm(reservation, { recursive: true, force: true }); }
  });
  await check('a valid release keeps its CAS path until its owner file has been removed', async () => {
    const reservation = path.join(context.codexHome, '.teams-execution-coordination', '.execution.teams-sdk-store-lease');
    const lease = await provider().acquire(context.acquireInput); const unlink = fs.unlink;
    let observedEmpty = false; let exposed = false; let competitor: Awaited<ReturnType<ReturnType<typeof provider>['acquire']>> | undefined;
    fs.unlink = async target => {
      await unlink(target);
      if (String(target) === path.join(reservation, 'owner.json')) {
        observedEmpty = true; assert.deepEqual(await fs.readdir(reservation), []);
        try { competitor = await provider().acquire(context.acquireInput); exposed = true; } catch { /* blocked */ }
      }
    };
    try { await lease.dispose(); assert.equal(observedEmpty, true); assert.equal(exposed, false); }
    finally { fs.unlink = unlink; await competitor?.dispose(); }
    const next = await provider().acquire(context.acquireInput); await next.dispose();
  });
  await check('unsafe coordination directories are rejected without permission repair', async () => {
    const home = path.join(context.directory, 'unsafe-home'); await fs.mkdir(home, { mode: 0o755 });
    await assert.rejects(() => acquirePrivateDirectoryProcessLease(home), /unsafe/);
    assert.equal((await fs.stat(home)).mode & 0o777, 0o755);
  });
  await check('the native lease rejects stdio merging or missing detached ownership before spawn', async () => {
    let starts = 0;
    const owner = new CodexPermissionProfileIsolationProvider({ codexExecutable: context.executable, codexExecutableSha256: context.executableSha256,
      codexHome: context.codexHome, platform: 'darwin', preflight: async () => undefined, executableTrustVerifier: () => undefined,
      spawn: () => { starts++; return Object.assign(new EventEmitter(), { pid: 123459 }) as unknown as ChildProcess; } });
    const lease = await owner.acquire(context.acquireInput);
    try {
      for (const change of [{ detached: false }, { stdio: ['ignore', 'pipe', 'inherit'] }]) await assert.rejects(() => lease.spawn(subject, context.executable, context.args(), {
        cwd: lease.workspace, env: { ...lease.environmentOverrides }, detached: true, stdio: ['ignore', 'pipe', 'pipe'], ...change,
      } as any), /pipe|stdio|detached/i);
      assert.equal(starts, 0);
    } finally { await lease.dispose().catch(() => undefined); }
  });
  await check('a pipe child without a verified tree cleanup cannot release the service home', async () => {
    const child = Object.assign(new EventEmitter(), { pid: 123456 }) as unknown as ChildProcess;
    const owner = new CodexPermissionProfileIsolationProvider({ codexExecutable: context.executable, codexExecutableSha256: context.executableSha256,
      codexHome: context.codexHome, platform: 'darwin', preflight: async () => undefined, executableTrustVerifier: () => undefined, spawn: () => child });
    const lease = await owner.acquire(context.acquireInput);
    await lease.spawn(subject, context.executable, context.args(), { cwd: lease.workspace, env: { ...lease.environmentOverrides }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.emit('close', 0, null);
    await assert.rejects(() => lease.dispose(), /CLEANUP_UNVERIFIED/);
    await assert.rejects(() => provider().acquire(context.acquireInput), /leased|reserved|busy/i);
    // No OS child exists in this fixture; remove only this synthetic quarantine.
    await fs.rm(path.join(context.codexHome, '.teams-execution-coordination', '.execution.teams-sdk-store-lease'), { recursive: true });
  });
  await check('uncertain pipe factory failure cannot release the reservation', async () => {
    const owner = new CodexPermissionProfileIsolationProvider({ codexExecutable: context.executable, codexExecutableSha256: context.executableSha256,
      codexHome: context.codexHome, platform: 'darwin', preflight: async () => undefined, executableTrustVerifier: () => undefined,
      spawn: () => { throw new Error('synthetic factory handoff failed'); } });
    const lease = await owner.acquire(context.acquireInput);
    await assert.rejects(() => lease.spawn(subject, context.executable, context.args(), { cwd: lease.workspace, env: { ...lease.environmentOverrides }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }));
    await assert.rejects(() => lease.dispose(), /CLEANUP_UNVERIFIED/);
    await assert.rejects(() => provider().acquire(context.acquireInput), /leased|reserved|busy/i);
    await fs.rm(path.join(context.codexHome, '.teams-execution-coordination', '.execution.teams-sdk-store-lease'), { recursive: true });
  });
  await check('unverified preflight cleanup quarantines the service reservation across provider instances', async () => {
    const failed = provider(async () => { throw new SupervisedCommandCleanupError(); });
    await assert.rejects(() => failed.acquire(context.acquireInput), /CLEANUP_UNVERIFIED/);
    let preflights = 0;
    await assert.rejects(() => provider(async () => { preflights++; }).acquire(context.acquireInput), /leased|reserved|busy/i);
    assert.equal(preflights, 0);
  });
  console.log(`Codex service reservation: ${checks} checks PASS; synthetic auth/preflight only.`);
} finally { await context.cleanup(); }
