import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  createAgentProcessTreeController,
  isProcessTreeControllerAvailable,
} from '../src/server/agent-process-controller.js';
import { CodexRunner, CodexProcessControlUnavailableError } from '../src/server/codex-runner.js';

function fakeChild(pid: number) {
  const events = new EventEmitter() as EventEmitter & { pid: number; kill: (signal: NodeJS.Signals) => boolean };
  events.pid = pid;
  events.kill = () => true;
  return events;
}

let groupPresent = true;
let childClosed = false;
const signals: Array<{ pid: number; signal: NodeJS.Signals }> = [];
const child = fakeChild(101);
const closeTimer = setTimeout(() => {
  childClosed = true;
  groupPresent = false;
  child.emit('close', 0, null);
}, 12);
const posix = createAgentProcessTreeController(child as any, {
  platform: 'posix',
  graceMs: 5,
  cleanupWaitMs: 40,
  sendSignal: (pid, signal) => {
    signals.push({ pid, signal });
    if (signal === 'SIGKILL') {
      childClosed = true;
      groupPresent = false;
      child.emit('close', 0, null);
    }
  },
  groupAlive: () => groupPresent,
});
assert.ok(posix);
posix.requestTermination();
await posix.cleanup();
assert.equal(childClosed, true);
assert.deepEqual(signals, [
  { pid: -101, signal: 'SIGTERM' },
  { pid: -101, signal: 'SIGKILL' },
], 'POSIX cleanup uses only process-group TERM then bounded KILL and verifies absence');

assert.equal(isProcessTreeControllerAvailable({ platform: 'win32' }), false, 'production Windows has no implicit taskkill boundary');
assert.equal(
  createAgentProcessTreeController(fakeChild(202) as any, { platform: 'win32' }),
  undefined,
  'Windows workload control is unsupported without an injected OS-backed provider',
);

let preflightCalled = false;
let attachCalled = false;
const fakeWindowsProvider = {
  async preflight(): Promise<void> { preflightCalled = true; },
  attach(): undefined { attachCalled = true; return undefined; },
};
await fakeWindowsProvider.preflight();
assert.equal(preflightCalled, true);
assert.equal(fakeWindowsProvider.attach(fakeChild(303) as any), undefined);
assert.equal(attachCalled, true, 'a Windows seam is exercised on macOS without claiming production taskkill support');

let windowsSpawnCount = 0;
const windowsRunner = new CodexRunner({
  platform: 'win32',
  spawn: () => {
    windowsSpawnCount += 1;
    throw new Error('Windows workload spawn must not be reached without a provider');
  },
});
await assert.rejects(
  () => windowsRunner.run({ jobId: 'windows-no-provider', prompt: 'probe', workspace: '.', mode: 'workspace-write' }),
  CodexProcessControlUnavailableError,
);
assert.equal(windowsSpawnCount, 0, 'unsupported Windows process control rejects before workload spawn');

console.log('PASS: POSIX process-group TERM/KILL/reap is verified and Windows production fails closed without a supported injected controller');
