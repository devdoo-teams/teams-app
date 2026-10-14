import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { runSupervisedCommand, SupervisedCommandCleanupError } from '../src/server/supervised-command.js';
import { createAgentProcessTreeController } from '../src/server/agent-process-controller.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
