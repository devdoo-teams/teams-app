import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

const runnerUrl = new URL('./core-test-runner.mjs', import.meta.url);
const { createCoreTestInvocations, createProcessTreeTerminator, runProcessWithTimeout } = await import(runnerUrl.href);
const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

{
  const invocations = createCoreTestInvocations({
    rootCwd: '/repo',
    sourceCwd: '/tmp/pinned-source',
    sourceCommit: SOURCE_COMMIT,
    env: { EXISTING: 'value' },
  });
  assert.ok(invocations.length > 2);
  const workspaceContract = invocations.find(({ args }) => args.includes('scripts/core-test-workspace-test.mjs'));
  const sourceContract = invocations.find(({ args }) => args.includes('scripts/client-item-mutation-test.ts'));
  const renderContract = invocations.find(({ args }) => args.includes('scripts/client-work-item-render-test.ts'));
  assert.equal(workspaceContract.cwd, '/repo', 'plain runner contract tests execute against the orchestrator root');
  assert.equal(sourceContract.cwd, '/tmp/pinned-source', 'TypeScript behavior tests execute the pinned source tree');
  assert.equal(renderContract.cwd, '/tmp/pinned-source', 'client render tests execute the pinned source tree');
  assert.equal(
    invocations.filter(({ kind }) => kind === 'source').every(({ cwd }) => cwd === '/tmp/pinned-source'),
    true,
  );
  assert.equal(
    invocations.every(({ env }) => env.TEAMS_SOURCE_COMMIT === SOURCE_COMMIT && env.EXISTING === 'value'),
    true,
    'every Core child test must receive the one release-pinned source OID',
  );
}

{
  const calls = [];
  const terminate = createProcessTreeTerminator({
    platform: 'win32',
    runWindowsTaskkill(command, args, options) {
      calls.push({ command, args, options });
      return '';
    },
  });
  const child = {
    pid: 4242,
    exitCode: null,
    signalCode: null,
    kill() {
      throw new Error('Windows descendant termination must use taskkill /T, not child.kill');
    },
  };
  assert.equal(terminate(child, { force: false }), true);
  assert.equal(terminate(child, { force: true }), true);
  assert.deepEqual(calls.map(({ command, args }) => ({ command, args })), [
    { command: 'taskkill.exe', args: ['/PID', '4242', '/T'] },
    { command: 'taskkill.exe', args: ['/PID', '4242', '/T', '/F'] },
  ]);
  for (const { options } of calls) {
    assert.equal(options.windowsHide, true);
    assert.ok(Number.isInteger(options.timeout) && options.timeout > 0 && options.timeout <= 5_000);
  }
}

{
  const spawnCalls = [];
  const taskkillCalls = [];
  const child = new EventEmitter();
  child.pid = 4343;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {
    throw new Error('Windows descendant termination must use taskkill /T, not child.kill');
  };
  const windowsTerminator = createProcessTreeTerminator({
    platform: 'win32',
    runWindowsTaskkill(command, args, options) {
      taskkillCalls.push({ command, args, options });
      if (args.includes('/F')) {
        child.exitCode = 1;
        child.signalCode = 'SIGKILL';
        queueMicrotask(() => child.emit('close', 1, 'SIGKILL'));
      }
      return '';
    },
  });

  await assert.rejects(
    runProcessWithTimeout('fake-node', ['--child'], {
      platform: 'win32',
      spawnProcess(command, args, options) {
        spawnCalls.push({ command, args, options });
        return child;
      },
      terminateTree: windowsTerminator,
      timeoutMs: 10,
      terminationGraceMs: 0,
      reapTimeoutMs: 100,
    }),
    (error) => {
      assert.equal(error?.code, 'ETIMEDOUT');
      assert.equal(error?.termination?.sentTerm, true);
      assert.equal(error?.termination?.sentKill, true);
      assert.equal(error?.termination?.reaped, true);
      return true;
    },
  );
  assert.deepEqual(spawnCalls, [
    {
      command: 'fake-node',
      args: ['--child'],
      options: {
        cwd: process.cwd(),
        env: process.env,
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    },
  ]);
  assert.deepEqual(
    taskkillCalls.map(({ command, args }) => ({ command, args })),
    [
      { command: 'taskkill.exe', args: ['/PID', '4343', '/T'] },
      { command: 'taskkill.exe', args: ['/PID', '4343', '/T', '/F'] },
    ],
  );
}

let reportedProcessGroup;
const startedAt = Date.now();
await assert.rejects(
  runProcessWithTimeout(
    process.execPath,
    [
      '-e',
      `
        const { spawn } = require('node:child_process');
        process.on('SIGTERM', () => {});
        const grandchild = spawn(process.execPath, [
          '-e',
          "process.on('SIGTERM', () => {}); process.stdout.write(String(process.pid) + '\\\\n'); setInterval(() => {}, 1000);",
        ], { stdio: ['ignore', 'pipe', 'ignore'] });
        grandchild.stdout.once('data', (chunk) => {
          process.stdout.write(JSON.stringify({ child: process.pid, grandchild: Number(chunk.toString().trim()) }) + '\\n');
        });
        setInterval(() => {}, 1000);
      `,
    ],
    {
      cwd: process.cwd(),
      timeoutMs: 500,
      terminationGraceMs: 75,
      reapTimeoutMs: 2_000,
    },
  ),
  (error) => {
    assert.equal(error?.code, 'ETIMEDOUT');
    assert.equal(error?.termination?.sentTerm, true);
    assert.equal(error?.termination?.sentKill, true);
    assert.equal(error?.termination?.reaped, true);
    reportedProcessGroup = JSON.parse(error.stdout.trim());
    return true;
  },
);

assert.ok(reportedProcessGroup.child > 0);
assert.ok(reportedProcessGroup.grandchild > 0);
assert.ok(Date.now() - startedAt < 5_000, 'SIGTERM-resistant child must be killed and reaped within the hard bound');
for (const [label, pid] of Object.entries(reportedProcessGroup)) {
  assert.throws(
    () => process.kill(pid, 0),
    (error) => error?.code === 'ESRCH',
    `reaped ${label} process must no longer exist`,
  );
}

console.log(
  'PASS: Core test runner models Windows taskkill tree termination and reaps a resistant POSIX descendant process group',
);
