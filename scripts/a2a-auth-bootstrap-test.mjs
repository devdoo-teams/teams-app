import assert from 'node:assert/strict';
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
