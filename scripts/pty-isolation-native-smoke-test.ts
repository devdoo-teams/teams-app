import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PtyReadSessionRegistry, type PtySessionIdentity } from '../src/server/pty-read-session.js';
import { createPtyReadTestContext } from './fixtures/pty-read-test-context.js';
import { createCodexPtyLeaseContext } from './fixtures/codex-pty-lease-context.js';
import { nativePtyTreeFixtureCapability, type NativePtyFixtureModule } from './fixtures/pty-tree-test-launcher.js';

const [moduleDirectory, receiptPath] = process.argv.slice(2);
if (!moduleDirectory || !receiptPath || process.argv.length !== 4) throw new Error('Usage: pty-isolation-native-smoke-test.ts <node-pty-package-directory> <receipt.json>');
assert.equal(process.platform, 'darwin', 'this actual native fixture is Mac-only; Windows/ConPTY remains unverified');
const nativeDirectory = await fs.realpath(moduleDirectory);
const metadata = JSON.parse(await fs.readFile(path.join(nativeDirectory, 'package.json'), 'utf8'));
assert.equal(metadata.name, 'node-pty'); assert.equal(metadata.version, '1.1.0');
const native: NativePtyFixtureModule = createRequire(import.meta.url)(nativeDirectory);
const nativeAddon = Object.keys(createRequire(import.meta.url).cache).find(p => p.startsWith(nativeDirectory + path.sep) && p.endsWith(`${path.sep}pty.node`));
assert.ok(nativeAddon);
const helper = path.join(path.dirname(nativeAddon), 'spawn-helper');
assert.ok((await fs.stat(helper)).mode & 0o100, 'PTY_HELPER_NOT_EXECUTABLE; no automatic repair');
const startedAt = new Date().toISOString();
const launcher = nativePtyTreeFixtureCapability(native);
const jobs = await createPtyReadTestContext();
const subject = { ...jobs.scope, jobId: jobs.jobId };
const body = await fs.readFile(new URL('./fixtures/pty-lease-native-program.mjs', import.meta.url), 'utf8');
const context = await createCodexPtyLeaseContext(subject, launcher.capability, body);
const registry = new PtyReadSessionRegistry({ jobs: jobs.jobs });
const checks: string[] = [];
const ttyEvidence: unknown[] = [];
const snapshots: unknown[] = [];
let lease: Awaited<ReturnType<typeof context.provider.acquire>> | undefined;
async function until(label: string, predicate: () => boolean, timeoutMs = 3000) {
  const end = Date.now() + timeoutMs;
  while (!predicate()) { if (Date.now() >= end) throw new Error(`Native lease smoke timed out: ${label}`); await new Promise(resolve => setTimeout(resolve, 10)); }
  checks.push(label);
}
function gone(pid: number) { try { process.kill(pid, 0); return false; } catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH') return true; throw error; } }
function groupGone(pid: number) {
  return !execFileSync('/bin/ps', ['-axo', 'pid=,pgid='], { encoding: 'utf8', timeout: 1000 }).split('\n')
    .some(line => line.trim().split(/\s+/)[1] === String(pid));
}
function read(identity: PtySessionIdentity) { return registry.read(jobs.scope, identity); }
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
let previous: PtySessionIdentity | undefined;

try {
  for (const mode of ['wait', 'natural'] as const) {
    lease = await context.provider.acquire(context.acquireInput);
    const nonce = randomBytes(16).toString('hex');
    const args = context.args(JSON.stringify({ mode, nonce }));
    const before = launcher.records.length;
    const resource = await lease.spawnPty!(subject, context.executable, args, { cwd: lease.workspace, env: { ...lease.environmentOverrides }, cols: 80, rows: 24 });
    assert.equal(launcher.records.length, before + 1);
    const identity = registry.register(jobs.scope, jobs.jobId, resource.readProcess);
    if (previous) {
      assert.notEqual(identity.sessionId, previous.sessionId); assert.ok(identity.generation > previous.generation);
      assert.throws(() => read(previous!), /PTY_SESSION_NOT_FOUND/);
    }
    await until(`${mode}: actual PTY and descendant readiness`, () => read(identity).frames.some(frame => frame.text.includes('childPid')));
    const proof = JSON.parse(read(identity).frames.find(frame => frame.text.includes('childPid'))!.text);
    assert.equal(proof.nonce, nonce); assert.equal(proof.ttyIn, true); assert.equal(proof.ttyOut, true);
    const record = launcher.records.at(-1)!; assert.equal(record.pid, proof.pid);
    const childPgid = Number(execFileSync('/bin/ps', ['-o', 'pgid=', '-p', String(proof.childPid)], { encoding: 'utf8', timeout: 1000 }).trim());
    assert.equal(childPgid, record.pgid); ttyEvidence.push({ ...proof, pgid: record.pgid, childPgid });
    const cursor = read(identity).nextCursor;
    assert.equal(registry.read(jobs.scope, identity, cursor).generation, identity.generation);
    assert.equal(registry.read(jobs.scope, identity, cursor).frames.length, 0);
    await assert.rejects(() => lease!.spawnPty!(subject, context.executable, args, { cwd: lease!.workspace, env: { ...lease!.environmentOverrides }, cols: 80, rows: 24 }));
    await assert.rejects(() => context.provider.acquire(context.acquireInput), /active or starting/);
    assert.equal(launcher.records.length, before + 1, 'reconnect/duplicate operations must not create another native PTY');
    checks.push(`${mode}: same-generation reconnect, duplicate start/acquire rejected`);
    if (mode === 'natural') {
      await resource.exited; assert.equal((await resource.exited).exitCode, 7);
    } else registry.terminate(jobs.scope, identity);
    await Promise.all([resource.terminate(), lease.dispose(), resource.finished]);
    assert.equal(read(identity).state, 'exited');
    await until(`${mode}: native parent, resistant descendant and process group reaped`, () => gone(proof.pid) && gone(proof.childPid) && groupGone(record.pgid));
    assert.equal(record.requested, 1); assert.equal(record.cleanupCalls, 1); assert.equal(record.rawKills, 0);
    assert.ok(record.signals.some(signal => signal.signal === 'SIGKILL' && signal.result === 'sent'), 'resistant descendant must be reaped by a successfully sent signal to the verified own group');
    assert.equal(record.signals.some(signal => signal.code === 'EPERM'), false, 'actual signal denial cannot be a native PASS');
    checks.push(`${mode}: exactly one cleanup request, SIGKILL escalation scoped to verified own group`);
    snapshots.push(read(identity)); previous = identity; lease = undefined;
  }
  lease = await context.provider.acquire(context.acquireInput);
  const start = lease.spawnPty!(subject, context.executable, context.args(JSON.stringify({ mode: 'wait', nonce: randomBytes(16).toString('hex') })), { cwd: lease.workspace, env: { ...lease.environmentOverrides }, cols: 80, rows: 24 });
  const closing = lease.dispose();
  await assert.rejects(() => start, /lease|취소/u); await closing;
  const last = launcher.records.at(-1)!;
  await until('dispose during actual native handoff reaps unpublished child/group', () => gone(last.pid) && groupGone(last.pgid));
  assert.equal(last.requested, 1); assert.equal(last.cleanupCalls, 1); assert.equal(last.rawKills, 0);
  assert.equal(launcher.records.length, 3); assert.equal(launcher.preflights(), 3);
  lease = undefined;
  const sources = ['src/server/agent-execution-policy.ts','src/server/agent-pty-process.ts','src/server/agent-process-controller.ts','src/server/codex-permission-profile-isolation-provider.ts','src/server/node-pty-read-process.ts','src/server/pty-read-session.ts','scripts/pty-isolation-native-smoke-test.ts','scripts/fixtures/pty-lease-native-program.mjs','scripts/fixtures/pty-tree-test-launcher.ts','scripts/fixtures/codex-pty-lease-context.ts'];
  const receipt = { result: 'PASS', startedAt, completedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
    nativePackage: { name: metadata.name, version: metadata.version, license: metadata.license, helperSha256: sha256(await fs.readFile(helper)), addonSha256: sha256(await fs.readFile(nativeAddon)) },
    sourceSha256: Object.fromEntries(await Promise.all(sources.map(async name => [name, sha256(await fs.readFile(fileURLToPath(new URL('../' + name, import.meta.url))))]))),
    ttyEvidence, checks, snapshots,
    processes: launcher.records.map(({ resource: _resource, ...record }) => record),
    allNativeGroupsReaped: launcher.records.every(record => groupGone(record.pgid)),
    pipeFallbackCalls: context.pipeLaunches(), preflights: launcher.preflights(),
    limits: ['Synthetic pinned executable/signature/auth/permission-preflight; no actual Codex permission enforcement claim.', 'Real native PTY + process group/descendant cleanup, not mocked process control.', 'No production composition/151 restart/public terminal/UI or model settings change.', 'Windows/ConPTY remains unverified.'] };
  assert.equal(receipt.pipeFallbackCalls, 0); assert.equal(receipt.allNativeGroupsReaped, true);
  await fs.writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  console.log(`Native PTY lease PASS: ${checks.length} checks, ${launcher.records.length} PTYs, 2 resistant descendants; all owned groups reaped. Receipt ${receiptPath}`);
} catch (error) {
  await fs.writeFile(receiptPath, JSON.stringify({ result: 'FAIL', startedAt, completedAt: new Date().toISOString(),
    error: error instanceof Error ? { name: error.name, message: error.message } : { name: 'unknown', message: 'unknown' },
    checks, ttyEvidence, processes: launcher.records.map(({ resource: _resource, ...record }) => record),
    limits: ['Diagnostic fixture only; no production server or user process signalled.'],
  }, null, 2) + '\n', { mode: 0o600 });
  throw error;
} finally {
  for (const record of launcher.records) if (record.resource) await record.resource.terminate().catch(() => undefined);
  await lease?.dispose().catch(() => undefined);
  // On a failed signal/reap gate, use only bounded read-back while the fixture's
  // own watchdog runs. Never retry denied signals or erase a still-live fixture.
  const end = Date.now() + 7000;
  while (launcher.records.some(record => !groupGone(record.pgid)) && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 25));
  const allGone = launcher.records.every(record => groupGone(record.pgid));
  registry.dispose();
  if (allGone) { await context.cleanup(); await jobs.cleanup(); }
  else console.error('Native fixture cleanup remains UNVERIFIED; owned fixture directories retained.');
}
