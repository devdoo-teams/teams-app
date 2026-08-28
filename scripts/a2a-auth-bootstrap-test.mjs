import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createLoginInvocation,
  inspectAuthMetadata,
  parseArguments,
  prepareWorkerHome,
  resolveWorkerHome,
  resolveDistinctWorkerHomes,
  runWorkerLogin,
  validateExecutableInputs,
} from './a2a-auth-bootstrap.mjs';

assert.deepEqual(parseArguments([]), { workers: ['main'], runLogin: false });
assert.deepEqual(parseArguments(['--worker', '1', '--run-login']), { workers: ['1'], runLogin: true });
assert.deepEqual(parseArguments(['--all']), { workers: ['main', '1', '2'], runLogin: false });
assert.throws(() => parseArguments(['--worker', '3']), /worker must be main, 1, or 2/i);
assert.throws(() => parseArguments(['--all', '--worker', '1']), /cannot be combined/i);

const env = {
  AGENT_CODEX_HOME: '/var/lib/teams/codex-main',
  AGENT_CODEX_HOME_1: '/var/lib/teams/codex-worker-1',
  AGENT_CODEX_HOME_2: '/var/lib/teams/codex-worker-2',
};
assert.equal(resolveWorkerHome(env, 'main'), env.AGENT_CODEX_HOME);
assert.equal(resolveWorkerHome(env, '1'), env.AGENT_CODEX_HOME_1);
assert.throws(() => resolveWorkerHome({}, '1'), /AGENT_CODEX_HOME_1 is required/i);

assert.deepEqual(
  createLoginInvocation({
    codexBin: '/Applications/ChatGPT.app/Contents/Resources/codex',
    codexHome: '/var/lib/teams/codex-worker-1',
  }),
  {
    command: '/Applications/ChatGPT.app/Contents/Resources/codex',
    args: ['login', '--device-auth'],
    options: {
      env: { CODEX_HOME: '/var/lib/teams/codex-worker-1' },
      stdio: 'inherit',
    },
  },
);
assert.throws(() => createLoginInvocation({ codexBin: 'codex', codexHome: '/tmp/home' }), /absolute/i);

let capturedLoginOptions;
let successfulAbortCount = 0;
const successfulChild = new EventEmitter();
successfulChild.kill = () => false;
const sentinelSecret = 'a2a-bootstrap-sentinel-secret';
const successfulLogin = await runWorkerLogin({
  codexBin: '/Applications/ChatGPT.app/Contents/Resources/codex',
  codexHome: '/var/lib/teams/codex-worker-1',
  env: {
    PATH: '/usr/bin',
    HOME: '/Users/operator',
    TERM: 'xterm-256color',
    CODEX_HOME: '/wrong/inherited/home',
    A2A_BOOTSTRAP_SENTINEL: sentinelSecret,
    OPENAI_API_KEY: sentinelSecret,
    CODEX_BIN_SHA256: sentinelSecret,
  },
  maxAttempts: 1,
  timeoutMs: 25,
  spawnImpl: (_command, _args, options) => {
    capturedLoginOptions = options;
    options.signal.addEventListener('abort', () => {
      successfulAbortCount += 1;
    }, { once: true });
    queueMicrotask(() => successfulChild.emit('close', 0, null));
    return successfulChild;
  },
});
assert.deepEqual(successfulLogin, { code: 0, signal: null });
assert.equal(capturedLoginOptions.env.CODEX_HOME, '/var/lib/teams/codex-worker-1');
assert.equal(capturedLoginOptions.env.PATH, '/usr/bin');
assert.equal(capturedLoginOptions.env.HOME, '/Users/operator');
assert.equal(capturedLoginOptions.env.CI, '1');
assert.equal(capturedLoginOptions.env.A2A_BOOTSTRAP_SENTINEL, undefined);
assert.equal(capturedLoginOptions.env.OPENAI_API_KEY, undefined);
assert.equal(capturedLoginOptions.env.CODEX_BIN_SHA256, undefined);
assert.doesNotMatch(JSON.stringify(capturedLoginOptions.env), new RegExp(sentinelSecret, 'u'));
await new Promise((resolve) => setTimeout(resolve, 40));
assert.equal(successfulAbortCount, 0, 'a completed login must clear its timeout');

let timeoutSignal;
let timeoutAbortCount = 0;
const timedOutChild = new EventEmitter();
timedOutChild.kill = () => false;
await assert.rejects(
  () => runWorkerLogin({
    codexBin: '/Applications/ChatGPT.app/Contents/Resources/codex',
    codexHome: '/var/lib/teams/codex-worker-1',
    env: { PATH: '/usr/bin' },
    maxAttempts: 1,
    timeoutMs: 10,
    spawnImpl: (_command, _args, options) => {
      timeoutSignal = options.signal;
      options.signal.addEventListener('abort', () => {
        timeoutAbortCount += 1;
        queueMicrotask(() => timedOutChild.emit('close', null, 'SIGTERM'));
      }, { once: true });
      return timedOutChild;
    },
  }),
  (error) => {
    assert.equal(error.code, 'CODEX_LOGIN_TIMEOUT');
    assert.match(error.message, /timed out/i);
    return true;
  },
);
assert.equal(timeoutSignal.aborted, true, 'timed-out login must abort its child process');
assert.equal(timeoutAbortCount, 1);
await new Promise((resolve) => setTimeout(resolve, 30));
assert.equal(timeoutAbortCount, 1, 'the timeout must be cleared after cleanup');

let retryAttempts = 0;
let activeLogins = 0;
let maxActiveLogins = 0;
const retriedLogin = await runWorkerLogin({
  codexBin: '/Applications/ChatGPT.app/Contents/Resources/codex',
  codexHome: '/var/lib/teams/codex-worker-1',
  env: { PATH: '/usr/bin' },
  maxAttempts: 2,
  timeoutMs: 10,
  spawnImpl: (_command, _args, options) => {
    retryAttempts += 1;
    activeLogins += 1;
    maxActiveLogins = Math.max(maxActiveLogins, activeLogins);
    const child = new EventEmitter();
    child.kill = () => false;
    if (retryAttempts === 1) {
      options.signal.addEventListener('abort', () => {
        queueMicrotask(() => {
          activeLogins -= 1;
          child.emit('close', null, 'SIGTERM');
        });
      }, { once: true });
    } else {
      queueMicrotask(() => {
        activeLogins -= 1;
        child.emit('close', 0, null);
      });
    }
    return child;
  },
});
assert.deepEqual(retriedLogin, { code: 0, signal: null });
assert.equal(retryAttempts, 2, 'a timed-out worker login gets one deterministic retry');
assert.equal(maxActiveLogins, 1, 'a retry must wait for the timed-out child cleanup');

let stubbornRetryAttempts = 0;
let stubbornActiveLogins = 0;
let stubbornMaxActiveLogins = 0;
let stubbornChildReaped = false;
let retryStartedBeforeReap = false;
const stubbornSignals = [];
const stubbornRetriedLogin = await runWorkerLogin({
  codexBin: '/Applications/ChatGPT.app/Contents/Resources/codex',
  codexHome: '/var/lib/teams/codex-worker-1',
  env: { PATH: '/usr/bin' },
  maxAttempts: 2,
  timeoutMs: 10,
  spawnImpl: (_command, _args, options) => {
    stubbornRetryAttempts += 1;
    stubbornActiveLogins += 1;
    stubbornMaxActiveLogins = Math.max(stubbornMaxActiveLogins, stubbornActiveLogins);
    const child = new EventEmitter();
    child.kill = (signal) => {
      stubbornSignals.push(signal);
      if (stubbornRetryAttempts === 1 && signal === 'SIGTERM') {
        return true;
      }
      if (stubbornRetryAttempts === 1 && signal === 'SIGKILL') {
        queueMicrotask(() => {
          stubbornChildReaped = true;
          stubbornActiveLogins -= 1;
          child.emit('close', null, 'SIGKILL');
        });
        return true;
      }
      return false;
    };
    if (stubbornRetryAttempts === 2) {
      retryStartedBeforeReap = !stubbornChildReaped;
      queueMicrotask(() => {
        stubbornActiveLogins -= 1;
        child.emit('close', 0, null);
      });
    }
    return child;
  },
});
assert.deepEqual(stubbornRetriedLogin, { code: 0, signal: null });
assert.equal(retryStartedBeforeReap, false, 'a retry must not start before a SIGTERM-resistant child is reaped');
assert.deepEqual(stubbornSignals, ['SIGTERM', 'SIGKILL']);
assert.equal(stubbornMaxActiveLogins, 1, 'a stubborn timed-out child must not overlap its retry');
assert.equal(stubbornActiveLogins, 0);

let unreapableAttempts = 0;
const unreapableSignals = [];
await assert.rejects(
  () => runWorkerLogin({
    codexBin: '/Applications/ChatGPT.app/Contents/Resources/codex',
    codexHome: '/var/lib/teams/codex-worker-1',
    env: { PATH: '/usr/bin' },
    maxAttempts: 2,
    timeoutMs: 10,
    spawnImpl: (_command, _args, _options) => {
      unreapableAttempts += 1;
      const child = new EventEmitter();
      child.kill = (signal) => {
        unreapableSignals.push(signal);
        return true;
      };
      if (unreapableAttempts > 1) queueMicrotask(() => child.emit('close', 0, null));
      return child;
    },
  }),
  (error) => {
    assert.equal(error.code, 'CODEX_LOGIN_REAP_FAILED');
    assert.match(error.message, /reap/i);
    return true;
  },
);
assert.equal(unreapableAttempts, 1, 'an unreaped child must fail closed without retry');
assert.deepEqual(unreapableSignals, ['SIGTERM', 'SIGKILL']);

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-auth-'));
const executableFixture = path.join(root, 'codex-bin');
await fs.copyFile(process.execPath, executableFixture);
await fs.chmod(executableFixture, 0o755);
const executableDigest = crypto.createHash('sha256').update(await fs.readFile(executableFixture)).digest('hex');
assert.equal(
  await validateExecutableInputs({ CODEX_BIN: executableFixture, CODEX_BIN_SHA256: executableDigest }),
  executableFixture,
);
await assert.rejects(
  () => validateExecutableInputs({ CODEX_BIN: executableFixture, CODEX_BIN_SHA256: '0'.repeat(64) }),
  /does not match/i,
);

const home = path.join(root, 'worker-1');
await prepareWorkerHome(home);
const homeStat = await fs.lstat(home);
assert.equal(homeStat.isDirectory(), true);
assert.equal(homeStat.mode & 0o077, 0, 'new worker homes must be owner-only');

const authPath = path.join(home, 'auth.json');
await fs.writeFile(authPath, '{"token":"fixture-secret"}\n', { mode: 0o600 });
const authMetadata = await inspectAuthMetadata(authPath);
assert.deepEqual(authMetadata, { state: 'valid', mode: 0o600, size: 27 });
assert.equal(Object.hasOwn(authMetadata, 'contents'), false, 'auth contents must never be returned');

const alias = path.join(root, 'worker-1-alias');
await fs.symlink(home, alias, 'dir');
await assert.rejects(
  () => resolveDistinctWorkerHomes({
    AGENT_CODEX_HOME_1: home,
    AGENT_CODEX_HOME_2: alias,
  }, ['1', '2']),
  /distinct worker home|alias/i,
  'symlink aliases must be rejected before any login or home preparation',
);

const lexicalAlias = path.join(root, 'worker-1', '..', 'worker-1');
await assert.rejects(
  () => resolveDistinctWorkerHomes({
    AGENT_CODEX_HOME: home,
    AGENT_CODEX_HOME_1: lexicalAlias,
  }, ['main', '1']),
  /distinct worker home|alias/i,
  'lexical path aliases must be rejected before any login or home preparation',
);

await fs.rm(root, { recursive: true, force: true });
console.log('PASS: A2A auth bootstrap argument, worker-home, and metadata contracts');
