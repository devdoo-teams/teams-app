import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { connectNodePtyReadProcess, type NodePtyProcessPort } from '../src/server/node-pty-read-process.js';
import { PtyReadSessionRegistry, type PtySessionIdentity } from '../src/server/pty-read-session.js';
import { createPtyReadTestContext } from './fixtures/pty-read-test-context.js';

const moduleDirectory = process.argv[2];
const receiptPath = process.argv[3];
if (!moduleDirectory || !receiptPath || process.argv.length !== 4) throw new Error('Usage: pty-native-read-smoke-test.ts <node-pty-package-directory> <receipt.json>');
const packageDirectory = await fs.realpath(moduleDirectory);
const metadata = JSON.parse(await fs.readFile(path.join(packageDirectory, 'package.json'), 'utf8'));
assert.equal(metadata.name, 'node-pty');
assert.equal(metadata.version, '1.1.0');
const native: { spawn(file: string, args: string[], options: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string>; encoding: 'utf8' }): NodePtyProcessPort } = createRequire(import.meta.url)(packageDirectory);
const nativeAddon = Object.keys(createRequire(import.meta.url).cache).find(name => name.startsWith(packageDirectory + path.sep) && name.endsWith(`${path.sep}pty.node`));
assert.ok(nativeAddon, 'The loaded node-pty native addon must be identifiable.');
const spawnHelper = process.platform === 'darwin' ? path.join(path.dirname(nativeAddon), 'spawn-helper') : undefined;
if (spawnHelper) {
  const mode = (await fs.stat(spawnHelper)).mode;
  assert.ok(mode & 0o100, 'PTY_HELPER_NOT_EXECUTABLE: node-pty1.1.0 packaging defect microsoft/node-pty#850; no automatic chmod or permission bypass.');
}
const context = await createPtyReadTestContext();
const registry = new PtyReadSessionRegistry({ jobs: context.jobs });
const fixture = fileURLToPath(new URL('./fixtures/pty-native-output.mjs', import.meta.url));
const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const nativeLibrary = fileURLToPath(new URL('../src/server/node-pty-read-process.ts', import.meta.url));
const startedAt = new Date().toISOString();
const spawns: Array<{ pid: number; mode: string; nonce: string; source: ReturnType<typeof connectNodePtyReadProcess> }> = [];
const checks: string[] = [];
const snapshots: unknown[] = [];
function spawnFixture(mode: 'natural' | 'wait') {
  const nonce = randomBytes(16).toString('hex');
  const processPort = native.spawn(process.execPath, [fixture, nonce, mode], {
    name: 'xterm-256color', cols: 80, rows: 24, cwd: context.directory, encoding: 'utf8',
    // No inherited credentials, HOME, login profile or application environment.
    env: { PATH: path.dirname(process.execPath), LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', TERM: 'xterm-256color' },
  });
  const source = connectNodePtyReadProcess(processPort);
  spawns.push({ pid: processPort.pid, nonce, mode, source });
  const identity = registry.register(context.scope, context.jobId, source);
  return { identity, pid: processPort.pid, nonce };
}
async function until(label: string, predicate: () => boolean, timeoutMs = 3000) {
  const end = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= end) throw new Error(`Bounded PTY smoke timed out: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  checks.push(label);
}
function read(identity: PtySessionIdentity, after = 0) { return registry.read(context.scope, identity, after); }
function output(identity: PtySessionIdentity, after = 0) { return read(identity, after).frames.map(frame => frame.text).join(''); }
function gone(pid: number) {
  try { process.kill(pid, 0); return false; }
  catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ESRCH') return true; throw error; }
}

let passed = false;
try {
  const first = spawnFixture('natural');
  await until('actual child reports stdin/stdout TTY with per-run nonce', () => read(first.identity).frames.length > 0);
  const evidence = JSON.parse(read(first.identity).frames[0]!.text);
  assert.deepEqual(evidence, { nonce: first.nonce, ttyIn: true, ttyOut: true, pid: first.pid });
  const cursor = read(first.identity).nextCursor;
  await until('unfinished actual PTY line remains private across reads', () => read(first.identity).pendingOutput);
  assert.doesNotMatch(output(first.identity), /synthetic-|token=/);
  await until('actual PTY completes and masks the split credential', () => output(first.identity, cursor).includes('second-output'));
  assert.match(output(first.identity, cursor), /한글 😀 token=\[REDACTED\]/);
  assert.doesNotMatch(output(first.identity), /synthetic-private-value/);
  const latest = read(first.identity);
  assert.equal(output(first.identity, latest.nextCursor), '');
  assert.equal(spawns.length, 1, 'reconnect is read only, never spawn');
  checks.push('same-identity cursor reconnect does not respawn or replay acknowledged lines');
  await until('natural native onExit captured', () => read(first.identity).state === 'exited');
  assert.equal(read(first.identity).exit?.exitCode, 7);
  assert.match(output(first.identity), /final-without-newline/);
  await until('natural child PID actually reaped', () => gone(first.pid));
  snapshots.push(read(first.identity));

  const second = spawnFixture('wait');
  assert.notEqual(second.identity.sessionId, first.identity.sessionId);
  assert.ok(second.identity.generation > first.identity.generation);
  assert.throws(() => read(first.identity), /PTY_SESSION_NOT_FOUND/);
  await until('replacement native PTY produces its own output', () => output(second.identity).includes('second-output'));
  const beforeStop = read(second.identity);
  registry.terminate(context.scope, second.identity);
  registry.terminate(context.scope, second.identity);
  assert.equal(read(second.identity).state, 'terminating');
  assert.equal(read(second.identity).exit, undefined);
  await until('one native termination request leads to observed onExit', () => read(second.identity).state === 'exited');
  await until('terminated native child PID actually reaped', () => gone(second.pid));
  assert.equal(spawns.length, 2);
  snapshots.push(beforeStop, read(second.identity));
  passed = true;
  const receipt = {
    result: 'PASS', startedAt, completedAt: new Date().toISOString(), platform: process.platform, arch: process.arch,
    node: process.version, nodeExecutableSha256: sha256(await fs.readFile(process.execPath)),
    nativePackage: { name: metadata.name, version: metadata.version, license: metadata.license, path: packageDirectory,
      packageJsonSha256: sha256(await fs.readFile(path.join(packageDirectory, 'package.json'))) },
    nativeAddon: { path: nativeAddon, sha256: sha256(await fs.readFile(nativeAddon)) },
    ...(spawnHelper ? { spawnHelper: { path: spawnHelper, mode: ((await fs.stat(spawnHelper)).mode & 0o777).toString(8), sha256: sha256(await fs.readFile(spawnHelper)) } } : {}),
    adapterSourceSha256: sha256(await fs.readFile(nativeLibrary)),
    sourceSha256: Object.fromEntries(await Promise.all([
      'src/server/node-pty-read-process.ts', 'src/server/pty-output-lines.ts', 'src/server/pty-read-session.ts',
      'scripts/pty-native-read-smoke-test.ts', 'scripts/fixtures/pty-native-output.mjs', 'scripts/fixtures/pty-read-test-context.ts',
    ].map(async relative => [relative, sha256(await fs.readFile(fileURLToPath(new URL('../' + relative, import.meta.url))))]))),
    nativeTtyEvidence: evidence, checks, snapshots, childPids: spawns.map(entry => entry.pid), allChildrenReaped: spawns.every(entry => gone(entry.pid)),
    publicRouteAdded: false, credentialsInherited: false, productionJobsUsed: false, screenControlled: false,
    limits: ['Synthetic bounded native Node fixtures only; no real Codex session.', 'No Windows/ConPTY execution on this Mac.', 'Redacted line projection is not raw VT/xterm byte rendering.', 'No UI/Teams host/foreground acceptance claim.'],
  };
  await fs.writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  console.log(`Native PTY smoke PASS: ${checks.length} checks, ${spawns.length} genuine PTYs, all children reaped; receipt ${receiptPath}`);
} finally {
  if (!passed) for (const entry of spawns) if (!gone(entry.pid)) entry.source.requestTermination();
  registry.dispose();
  await context.cleanup();
}
