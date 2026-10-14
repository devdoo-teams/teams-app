import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { runSupervisedCommand, SupervisedCommandCleanupError } from '../src/server/supervised-command.js';
import { createAgentProcessTreeController } from '../src/server/agent-process-controller.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { observeCodexCliVersion } from '../src/server/agent-cli-invocation-receipt.js';
let release!: () => void;
const cleanup = new Promise<void>(resolve => { release = resolve; });
let stdinClosed = false; let requested = 0; let settled = false;
const child = Object.assign(new EventEmitter(), { pid: 123456, stdin: { end() { stdinClosed = true; } }, stdout: new PassThrough(), stderr: new PassThrough() }) as unknown as ChildProcess;
const pending = runSupervisedCommand('synthetic-only', [], { env: {}, timeout: 1000, maxBuffer: 1024 }, {
  spawn: (_file: string, _args: readonly string[], options: SpawnOptions) => {
    assert.equal(options.detached, true); assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
    setImmediate(() => { child.stdout!.emit('data', 'SAFE\n'); child.emit('close', 0, null); }); return child;
  },
  controller: () => ({ available: true, platform: 'posix', requestTermination() { requested++; }, cleanup: () => cleanup }),
}).then((result: { stdout: string }) => { settled = true; return result; });
await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
assert.equal(stdinClosed, true); assert.equal(settled, false, 'parent close must not publish success before owned descendant cleanup');
release(); assert.equal((await pending).stdout, 'SAFE\n'); assert.equal(requested, 1);
console.log('PASS preflight waits for owned-tree cleanup after close and closes stdin');

const fake = () => Object.assign(new EventEmitter(), { pid: 123457, stdin: { end() {} }, stdout: new PassThrough(), stderr: new PassThrough() }) as unknown as ChildProcess;
for (const hang of [false, true]) {
  const target = fake();
  await assert.rejects(() => runSupervisedCommand('synthetic', [], { env: {}, timeout: 1000, cleanupTimeoutMs: 15 }, {
    spawn: () => { setImmediate(() => target.emit('close', 0, null)); return target; },
    controller: () => ({ available: true, platform: 'posix', requestTermination() {}, cleanup: async () => { if (hang) await new Promise(() => {}); else throw new Error('synthetic private diagnostic'); } }),
  }), (error: unknown) => error instanceof SupervisedCommandCleanupError && error.message === 'PREFLIGHT_CLEANUP_UNVERIFIED');
}
console.log('PASS cleanup rejection or nonsettling cleanup has a bounded value-free quarantine error');
await assert.rejects(() => runSupervisedCommand('/synthetic-missing-codex', [], { env: {}, timeout: 1000 }), (error: any) => error.code === 'ENOENT');
console.log('PASS a known no-PID spawn failure remains distinct from uncertain cleanup');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-preflight-descendants-'));
const program = path.join(directory, 'fixture.mjs');
await fs.writeFile(program, `import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});console.log("ready");setInterval(()=>{},1000)'], { stdio: ['ignore','pipe','ignore'] });
child.stdout.once('data',()=>{ console.log(child.pid); if (process.argv[2] === 'natural') process.exit(0); });
setInterval(()=>{},1000);
`);
const knownGroups: number[] = [];
const absent = (pid: number) => { try { process.kill(-pid, 0); return false; } catch (error: any) { return error.code === 'ESRCH'; } };
try {
  for (const kind of ['natural', 'timeout']) {
    const signals: string[] = []; let pid = 0;
    const invoke = () => runSupervisedCommand(process.execPath, [program, kind], { env: { PATH: '/usr/bin:/bin' }, timeout: kind === 'timeout' ? 300 : 2000, cleanupTimeoutMs: 2000 }, {
      controller(target) { pid = target.pid!; knownGroups.push(pid); return createAgentProcessTreeController(target, { graceMs: 20, cleanupWaitMs: 1000,
        sendSignal(group, signal) { signals.push(signal); process.kill(group, signal); } }); },
    });
    if (kind === 'natural') assert.match((await invoke()).stdout, /^\d+\n$/); else await assert.rejects(invoke, (error: any) => error.code === 'ETIMEDOUT');
    assert.ok(signals.includes('SIGKILL'), 'resistant descendant requires owned-group KILL');
    assert.equal(absent(pid), true, 'parent and descendant process group must be absent before resolution');
  }
  console.log('PASS real synthetic Node descendants are reaped after natural parent exit and timeout');
} finally {
  for (const pid of knownGroups) { if (!absent(pid)) { try { process.kill(-pid, 'SIGKILL'); } catch {} } }
  await fs.rm(directory, { recursive: true, force: true });
}

const probeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-version-probe-tree-'));
const probe = path.join(probeDirectory, 'codex-version.mjs'); const pidFile = path.join(probeDirectory, 'descendant.json');
await fs.writeFile(probe, `#!${process.execPath}\nimport {spawn} from 'node:child_process';import fs from 'node:fs';
const child=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});console.log("ready");setInterval(()=>{},1000)'],{stdio:['ignore','pipe','ignore']});
child.stdout.once('data',()=>{fs.writeFileSync(${JSON.stringify(pidFile)},JSON.stringify({parent:process.pid,child:child.pid}));console.log('codex-cli 99.0.0-fixture');process.exit(0);});\n`, { mode: 0o700 });
let probeChild = 0;
try {
  const version = await observeCodexCliVersion(probe, [], { cwd: probeDirectory, env: { PATH: '/usr/bin:/bin' }, signal: new AbortController().signal },
    (file, args, options) => runSupervisedCommand(file, args, options, { controller: target => createAgentProcessTreeController(target, { graceMs: 20, cleanupWaitMs: 1000 }) }));
  probeChild = JSON.parse(await fs.readFile(pidFile, 'utf8')).child;
  assert.equal(version, 'codex-cli 99.0.0-fixture');
  assert.throws(() => process.kill(probeChild, 0), (error: any) => error.code === 'ESRCH', 'version observation cannot finish while its descendant remains');
  console.log('PASS the version metadata probe also reaps its real synthetic descendant before returning');
} finally {
  if (!probeChild) { try { probeChild = JSON.parse(await fs.readFile(pidFile, 'utf8')).child; } catch {} }
  if (probeChild) { try { process.kill(probeChild, 'SIGKILL'); } catch {} }
  await fs.rm(probeDirectory, { recursive: true, force: true });
}
