import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createLoginEnvironment,
  createLoginInvocation,
  inspectAuthMetadata,
  parseArguments,
  prepareWorkerHome,
  resolveWorkerHome,
  resolveDistinctWorkerHomes,
  runWorkerLogin,
  validateExecutableInputs,
} from './a2a-auth-bootstrap.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-auth-'));
const executableFixture = path.join(root, 'codex-bin');
await fs.copyFile(process.execPath, executableFixture);
await fs.chmod(executableFixture, 0o755);
const executableDigest = crypto.createHash('sha256').update(await fs.readFile(executableFixture)).digest('hex');

assert.deepEqual(parseArguments([]), { workers: ['main'], runLogin: false });
assert.deepEqual(parseArguments(['--worker', '1', '--run-login']), { workers: ['1'], runLogin: true });
assert.deepEqual(
  parseArguments(['--all']),
  { workers: ['main', '1', '2', '3', '4', '5', '6', '7', '8'], runLogin: false },
);
assert.deepEqual(parseArguments(['--worker', '8']), { workers: ['8'], runLogin: false });
assert.throws(() => parseArguments(['--worker', '9']), /worker must be main or 1 through 8/i);
assert.throws(() => parseArguments(['--all', '--worker', '1']), /cannot be combined/i);

const env = {
  AGENT_CODEX_HOME: '/var/lib/teams/codex-main',
  AGENT_CODEX_HOME_1: '/var/lib/teams/codex-worker-1',
  AGENT_CODEX_HOME_2: '/var/lib/teams/codex-worker-2',
  AGENT_CODEX_HOME_8: '/var/lib/teams/codex-worker-8',
};
assert.equal(resolveWorkerHome(env, 'main'), env.AGENT_CODEX_HOME);
assert.equal(resolveWorkerHome(env, '1'), env.AGENT_CODEX_HOME_1);
assert.equal(resolveWorkerHome(env, '8'), env.AGENT_CODEX_HOME_8);
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

assert.deepEqual(
  createLoginEnvironment({
    PATH: '/usr/bin',
    HOME: '/Users/operator',
    TERM: 'xterm-256color',
    SHELL: '/bin/zsh',
    OPENAI_API_KEY: 'must-not-cross-the-boundary',
    CODEX_HOME: '/wrong/inherited/home',
  }, '/var/lib/teams/codex-worker-1'),
  {
    CI: '1',
    PATH: '/usr/bin',
    HOME: '/Users/operator',
    TERM: 'xterm-256color',
    CODEX_HOME: '/var/lib/teams/codex-worker-1',
  },
  'the login child receives only the documented runtime environment and its worker home',
);

const caseInsensitiveEnvironment = createLoginEnvironment({
  PATH: '/safe/path',
  Path: '/ambiguous/path',
  SYSTEMROOT: '/safe/system-root',
  SystemRoot: '/ambiguous/system-root',
}, '/var/lib/teams/codex-worker-1');
assert.deepEqual(
  Object.keys(caseInsensitiveEnvironment)
    .filter((key) => key.toLowerCase() === 'path'),
  ['PATH'],
  'the login child must receive one deterministic PATH key across case-insensitive platforms',
);
assert.deepEqual(
  Object.keys(caseInsensitiveEnvironment)
    .filter((key) => key.toLowerCase() === 'systemroot'),
  ['SYSTEMROOT'],
  'the login child must not receive duplicate case variants of an allowlisted variable',
);
assert.equal(caseInsensitiveEnvironment.PATH, '/safe/path');
assert.equal(caseInsensitiveEnvironment.SYSTEMROOT, '/safe/system-root');

let capturedLoginOptions;
let successfulAbortCount = 0;
const successfulChild = new EventEmitter();
successfulChild.kill = () => false;
const sentinelSecret = 'a2a-bootstrap-sentinel-secret';
const successfulLogin = await runWorkerLogin({
  codexBin: executableFixture,
  codexBinSha256: executableDigest,
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

let missingDigestSpawned = false;
const missingDigestChild = new EventEmitter();
missingDigestChild.kill = () => false;
await assert.rejects(
  () => runWorkerLogin({
    codexBin: executableFixture,
    codexHome: '/var/lib/teams/codex-worker-1',
    env: { PATH: '/usr/bin' },
    maxAttempts: 1,
    timeoutMs: 10,
    spawnImpl: (_command, _args, _options) => {
      missingDigestSpawned = true;
      queueMicrotask(() => missingDigestChild.emit('close', 0, null));
      return missingDigestChild;
    },
  }),
  /CODEX_BIN_SHA256/i,
  'login must require the pinned executable digest before spawning the child',
);
assert.equal(missingDigestSpawned, false, 'a missing digest must fail before process execution');

let timeoutSignal;
let timeoutAbortCount = 0;
const timedOutChild = new EventEmitter();
timedOutChild.kill = () => false;
await assert.rejects(
  () => runWorkerLogin({
    codexBin: executableFixture,
    codexBinSha256: executableDigest,
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

const callerAbortController = new AbortController();
let callerAbortSignal;
let callerAbortAttempts = 0;
const callerAbortedChild = new EventEmitter();
const callerAbortSignals = [];
callerAbortedChild.kill = (signal) => {
  callerAbortSignals.push(signal);
  queueMicrotask(() => callerAbortedChild.emit('close', null, signal));
  return true;
};
await assert.rejects(
  () => runWorkerLogin({
    codexBin: executableFixture,
    codexBinSha256: executableDigest,
    codexHome: '/var/lib/teams/codex-worker-1',
    env: { PATH: '/usr/bin' },
    signal: callerAbortController.signal,
    maxAttempts: 2,
    timeoutMs: 100,
    spawnImpl: (_command, _args, options) => {
      callerAbortAttempts += 1;
      callerAbortSignal = options.signal;
      queueMicrotask(() => callerAbortController.abort());
      return callerAbortedChild;
    },
  }),
  (error) => {
    assert.equal(error.code, 'CODEX_LOGIN_ABORTED');
    assert.match(error.message, /aborted/i);
    return true;
  },
  'caller cancellation must terminate the login child with an explicit abort result',
);
assert.equal(callerAbortSignal.aborted, true, 'caller cancellation must propagate to the child AbortSignal');
assert.equal(callerAbortAttempts, 1, 'caller cancellation must not retry the login child');
assert.deepEqual(callerAbortSignals, ['SIGTERM']);

let retryAttempts = 0;
let activeLogins = 0;
let maxActiveLogins = 0;
const retriedLogin = await runWorkerLogin({
  codexBin: executableFixture,
  codexBinSha256: executableDigest,
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
  codexBin: executableFixture,
  codexBinSha256: executableDigest,
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
    codexBin: executableFixture,
    codexBinSha256: executableDigest,
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

const emptyAuthPath = path.join(home, 'empty-auth.json');
await fs.writeFile(emptyAuthPath, '', { mode: 0o600 });
assert.deepEqual(
  await inspectAuthMetadata(emptyAuthPath),
  { state: 'invalid-file' },
  'empty auth metadata must fail the same readiness contract as the final validator',
);

const unreadableAuthPath = path.join(home, 'unreadable-auth.json');
await fs.writeFile(unreadableAuthPath, '{"token":"fixture-secret"}\n', { mode: 0o200 });
await fs.chmod(unreadableAuthPath, 0o200);
assert.deepEqual(
  await inspectAuthMetadata(unreadableAuthPath),
  { state: 'invalid-permissions' },
  'auth metadata without owner-read permission must fail closed',
);

const hardlinkedAuthPath = path.join(root, 'hardlinked-auth.json');
await fs.link(authPath, hardlinkedAuthPath);
assert.deepEqual(
  await inspectAuthMetadata(hardlinkedAuthPath),
  { state: 'invalid-hardlink' },
  'auth metadata must reject a hardlink so one credential file cannot have another inode name',
);

const hardlinkedExecutable = path.join(root, 'hardlinked-codex-bin');
await fs.link(executableFixture, hardlinkedExecutable);
await assert.rejects(
  () => validateExecutableInputs({ CODEX_BIN: hardlinkedExecutable, CODEX_BIN_SHA256: executableDigest }),
  /hardlink|one owner-only regular file/i,
  'executable validation must reject a hardlinked binary',
);

const raceExecutable = path.join(root, 'race-codex-bin');
await fs.copyFile(executableFixture, raceExecutable);
await fs.chmod(raceExecutable, 0o755);
const raceDigest = crypto.createHash('sha256').update(await fs.readFile(raceExecutable)).digest('hex');
let raceAttempts = 0;
await assert.rejects(
  () => runWorkerLogin({
    codexBin: raceExecutable,
    codexBinSha256: raceDigest,
    codexHome: '/var/lib/teams/codex-worker-1',
    env: { PATH: '/usr/bin' },
    maxAttempts: 2,
    timeoutMs: 10,
    spawnImpl: (_command, _args, options) => {
      raceAttempts += 1;
      const child = new EventEmitter();
      child.kill = () => false;
      if (raceAttempts === 1) {
        options.signal.addEventListener('abort', () => {
          fs.writeFile(raceExecutable, 'tampered executable\n');
          queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
        }, { once: true });
      }
      return child;
    },
  }),
  /does not match|changed/i,
  'a login retry must revalidate the pinned executable digest',
);
assert.equal(raceAttempts, 1, 'a changed executable must block the retry before spawn');

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

const legacyHomeAlias = path.join(root, 'legacy-home-alias');
await fs.symlink(home, legacyHomeAlias, 'dir');
await assert.rejects(
  () => resolveDistinctWorkerHomes({
    AGENT_CODEX_HOME: legacyHomeAlias,
    AGENT_CODEX_HOME_1: home,
  }, ['1']),
  /AGENT_CODEX_HOME.*distinct|legacy.*AGENT_CODEX_HOME/i,
  'an indexed worker must not alias the legacy unsuffixed Codex home even when bootstrapped alone',
);

const uniqueHomeAlias = path.join(root, 'unique-home-alias');
await fs.symlink(home, uniqueHomeAlias, 'dir');
await assert.rejects(
  () => resolveDistinctWorkerHomes({ AGENT_CODEX_HOME_1: uniqueHomeAlias }, ['1']),
  /symbolic link|alias/i,
  'a worker home symlink must be rejected even when it has no duplicate configured path',
);

await fs.rm(root, { recursive: true, force: true });
console.log('PASS: A2A auth bootstrap argument, worker-home, and metadata contracts');
