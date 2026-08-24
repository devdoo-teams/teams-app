import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { runWithTimeout } from './release-gate.mjs';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function processExists(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function killFixture(pid, signal = 'SIGKILL') {
  if (!pid) return;
  try {
    if (process.platform === 'win32') process.kill(pid, signal);
    else process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // The fixture may have exited during cleanup.
    }
  }
}

async function readPid(pidPath) {
  try {
    return Number.parseInt(await fs.readFile(pidPath, 'utf8'), 10);
  } catch {
    return undefined;
  }
}

async function waitForExit(pidPath, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pid = await readPid(pidPath);
    if (!processExists(pid)) return;
    await wait(10);
  }
}

async function cleanupFixture(pidPath) {
  const pid = await readPid(pidPath);
  if (processExists(pid)) killFixture(pid);
  await waitForExit(pidPath);
}

async function assertSigtermChildIsReaped(directory) {
  const pidPath = path.join(directory, 'sigterm.pid');
  const childCode = [
    `require('node:fs').writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));`,
    "process.stdout.write('sigterm-child-started\\n');",
    "process.on('SIGTERM', () => {",
    "  process.stdout.write('sigterm-received\\n');",
    "  setTimeout(() => {",
    "    process.stdout.write('sigterm-child-exited\\n');",
    "    process.exit(0);",
    "  }, 120);",
    "});",
    'setInterval(() => {}, 1_000);',
  ].join('\n');
  const startedAt = Date.now();
  const error = await runWithTimeout(process.execPath, ['-e', childCode], {
    timeoutMs: 250,
    terminationGraceMs: 300,
  }).then(() => undefined, (reason) => reason);

  assert.ok(error instanceof Error, 'a timed out child must reject');
  assert.equal(error.code, 'ETIMEDOUT');
  assert.match(error.stdout, /sigterm-child-exited/);
  assert.ok(
    Date.now() - startedAt >= 100,
    'runWithTimeout must settle after the SIGTERM child has exited',
  );
  assert.equal(processExists(await readPid(pidPath)), false, 'the SIGTERM child must be reaped');
}

async function assertStubbornChildIsKilledAndReaped(directory) {
  const pidPath = path.join(directory, 'stubborn.pid');
  const childCode = [
    `require('node:fs').writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));`,
    "process.stdout.write('stubborn-child-started\\n');",
    "process.on('SIGTERM', () => process.stdout.write('sigterm-ignored\\n'));",
    'setInterval(() => {}, 1_000);',
  ].join('\n');
  const startedAt = Date.now();
  const error = await runWithTimeout(process.execPath, ['-e', childCode], {
    timeoutMs: 250,
    terminationGraceMs: 120,
  }).then(() => undefined, (reason) => reason);

  assert.ok(error instanceof Error, 'a stubborn child must reject after forced termination');
  assert.equal(error.code, 'ETIMEDOUT');
  assert.match(error.stdout, /stubborn-child-started/);
  assert.ok(
    Date.now() - startedAt >= 100,
    'SIGKILL fallback must be bounded but occur before timeout rejection',
  );
  assert.equal(processExists(await readPid(pidPath)), false, 'SIGKILL fallback must reap the stubborn child');
}

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-release-gate-timeout-'));
try {
  const failures = [];
  for (const [name, test] of [
    ['SIGTERM child reaping', assertSigtermChildIsReaped],
    ['stubborn child SIGKILL fallback', assertStubbornChildIsKilledAndReaped],
  ]) {
    try {
      await test(directory);
    } catch (error) {
      failures.push(`${name}: ${error.message}`);
    } finally {
      await cleanupFixture(path.join(directory, name.startsWith('SIGTERM') ? 'sigterm.pid' : 'stubborn.pid'));
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
} finally {
  await cleanupFixture(path.join(directory, 'sigterm.pid'));
  await cleanupFixture(path.join(directory, 'stubborn.pid'));
  await fs.rm(directory, { recursive: true, force: true });
}

console.log('release-gate-timeout-test: PASS');
