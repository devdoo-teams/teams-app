import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { validateCodexA2AIsolation } from './validate-codex-a2a-isolation.mjs';

const execFileAsync = promisify(execFile);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-codex-a2a-validation-'));
const serviceHome = path.join(root, 'service-home');
const executable = path.join(root, 'codex');
const authFile = path.join(serviceHome, 'auth.json');
const authSecret = 'fixture-secret-that-must-never-be-printed';

try {
  await fs.mkdir(serviceHome, { mode: 0o700 });
  await fs.writeFile(authFile, `{"token":"${authSecret}"}\n`, { mode: 0o600 });
  await fs.writeFile(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const digest = crypto.createHash('sha256').update(await fs.readFile(executable)).digest('hex');
  const baseEnvironment = {
    AGENT_CODEX_HOME: serviceHome,
    CODEX_BIN: executable,
    CODEX_BIN_SHA256: digest,
  };

  const missingDefaultWorker = await validateCodexA2AIsolation({
    env: baseEnvironment,
    platform: 'darwin',
    verifyExecutableSignature: () => undefined,
  });
  assert.equal(missingDefaultWorker.ok, false, 'the omitted roster still creates the default Codex worker');
  assert.deepEqual(missingDefaultWorker.issues.map(({ code }) => code), ['AGENT_CODEX_HOME_1_REQUIRED']);

  const a2aHome1 = path.join(root, 'a2a-home-1');
  const a2aHome2 = path.join(root, 'a2a-home-2');
  await fs.mkdir(a2aHome1, { mode: 0o700 });
  await fs.mkdir(a2aHome2, { mode: 0o700 });
  await fs.writeFile(path.join(a2aHome1, 'auth.json'), `{"token":"${authSecret}"}\n`, { mode: 0o600 });
  await fs.writeFile(path.join(a2aHome2, 'auth.json'), `{"token":"${authSecret}"}\n`, { mode: 0o600 });
  const validEnvironment = {
    ...baseEnvironment,
    AGENT_CODEX_HOME_1: a2aHome1,
  };

  const result = await validateCodexA2AIsolation({
    env: validEnvironment,
    platform: 'darwin',
    verifyExecutableSignature: () => undefined,
  });

  assert.deepEqual(result, { ok: true, issues: [] });
  assert.deepEqual(await fs.readdir(serviceHome), ['auth.json'], 'validation must not create service-home files');

  const explicitSingle = await validateCodexA2AIsolation({
    env: { ...baseEnvironment, TEAMS_A2A_AGENT_PROVIDERS: 'codex', AGENT_CODEX_HOME_1: a2aHome1 },
    platform: 'darwin',
    verifyExecutableSignature: () => undefined,
  });
  assert.deepEqual(explicitSingle, { ok: true, issues: [] }, 'an explicit single Codex worker remains valid');

  const missingPrependedDefault = await validateCodexA2AIsolation({
    env: { ...baseEnvironment, TEAMS_A2A_AGENT_PROVIDERS: 'copilot' },
    platform: 'darwin',
    verifyExecutableSignature: () => undefined,
  });
  assert.deepEqual(missingPrependedDefault.issues.map(({ code }) => code), ['AGENT_CODEX_HOME_1_REQUIRED']);

  const prependedDefault = await validateCodexA2AIsolation({
    env: { ...baseEnvironment, TEAMS_A2A_AGENT_PROVIDERS: 'copilot', AGENT_CODEX_HOME_1: a2aHome1 },
    platform: 'darwin',
    verifyExecutableSignature: () => undefined,
  });
  assert.deepEqual(prependedDefault, { ok: true, issues: [] }, 'the runtime default worker remains valid when prepended');

  const copilotDefault = await validateCodexA2AIsolation({
    env: { ...baseEnvironment, TEAMS_AGENT_CLI_PROVIDER: 'copilot' },
    platform: 'darwin',
    verifyExecutableSignature: () => undefined,
  });
  assert.deepEqual(copilotDefault, { ok: true, issues: [] }, 'a Copilot default has no effective Codex worker');

  const unknownDefaultProvider = await validateCodexA2AIsolation({
    env: {
      ...validEnvironment,
      TEAMS_AGENT_CLI_PROVIDER: 'grok',
    },
    platform: 'darwin',
    verifyExecutableSignature: () => undefined,
  });
  assert.deepEqual(unknownDefaultProvider.issues.map(({ code }) => code), [
    'TEAMS_AGENT_CLI_PROVIDER_INVALID',
  ], 'an unknown default provider must be rejected like the runtime parser');

  const unknownProvider = await validateCodexA2AIsolation({
    env: {
      ...validEnvironment,
      TEAMS_A2A_AGENT_PROVIDERS: 'codex,grok',
    },
    platform: 'darwin',
    verifyExecutableSignature: () => undefined,
  });
  assert.deepEqual(unknownProvider.issues.map(({ code }) => code), [
    'TEAMS_A2A_AGENT_PROVIDERS_INVALID',
  ], 'unknown A2A providers must be rejected like the runtime roster parser');

  const blankProvider = await validateCodexA2AIsolation({
    env: {
      ...validEnvironment,
      TEAMS_A2A_AGENT_PROVIDERS: 'codex,',
    },
    platform: 'darwin',
    verifyExecutableSignature: () => undefined,
  });
  assert.deepEqual(blankProvider.issues.map(({ code }) => code), [
    'TEAMS_A2A_AGENT_PROVIDERS_INVALID',
  ], 'blank A2A provider entries must be rejected instead of filtered');

  const maxRoster = await validateCodexA2AIsolation({
    env: {
      ...baseEnvironment,
      TEAMS_AGENT_CLI_PROVIDER: 'copilot',
      TEAMS_A2A_AGENT_PROVIDERS: Array.from({ length: 8 }, () => 'copilot').join(','),
    },
    platform: 'darwin',
    verifyExecutableSignature: () => undefined,
  });
  assert.deepEqual(maxRoster, { ok: true, issues: [] }, 'the runtime maximum of eight workers remains valid');

  const overLimitRoster = await validateCodexA2AIsolation({
    env: {
      ...baseEnvironment,
      TEAMS_A2A_AGENT_PROVIDERS: Array.from({ length: 8 }, () => 'copilot').join(','),
    },
    platform: 'darwin',
    verifyExecutableSignature: () => undefined,
  });
  assert.deepEqual(overLimitRoster.issues.map(({ code }) => code), [
    'TEAMS_A2A_AGENT_PROVIDERS_LIMIT',
  ], 'rosters above the runtime maximum must be rejected');

  const indexed = await validateCodexA2AIsolation({
    env: {
      ...validEnvironment,
      TEAMS_A2A_AGENT_PROVIDERS: 'codex,codex',
      AGENT_CODEX_HOME_1: a2aHome1,
      AGENT_CODEX_HOME_2: a2aHome2,
    },
    platform: 'darwin',
    verifyExecutableSignature: () => undefined,
  });
  assert.deepEqual(indexed, { ok: true, issues: [] }, 'indexed A2A homes must be validated independently');

  const missingIndexed = await validateCodexA2AIsolation({
    env: {
      ...validEnvironment,
      TEAMS_A2A_AGENT_PROVIDERS: 'codex,codex',
      AGENT_CODEX_HOME_1: a2aHome1,
    },
    platform: 'darwin',
    verifyExecutableSignature: () => undefined,
  });
  assert.ok(missingIndexed.issues.some(({ code }) => code === 'AGENT_CODEX_HOME_2_REQUIRED'));

  const homeLink = path.join(root, 'service-home-link');
  await fs.symlink(serviceHome, homeLink);
  const linkedHome = await validateCodexA2AIsolation({
    env: { ...validEnvironment, AGENT_CODEX_HOME: homeLink },
    platform: 'darwin',
    verifyExecutableSignature: () => undefined,
  });
  assert.deepEqual(linkedHome.issues.map(({ code }) => code), ['AGENT_CODEX_HOME_SYMLINK']);
  await fs.rm(homeLink);

  const authBackup = `${authFile}.real`;
  await fs.rename(authFile, authBackup);
  await fs.symlink(authBackup, authFile);
  const linkedAuth = await validateCodexA2AIsolation({
    env: validEnvironment,
    platform: 'darwin',
    verifyExecutableSignature: () => undefined,
  });
  assert.deepEqual(linkedAuth.issues.map(({ code }) => code), ['CODEX_AUTH_FILE_SYMLINK']);
  await fs.rm(authFile);
  await fs.rename(authBackup, authFile);

  const missing = await validateCodexA2AIsolation({
    env: {},
    platform: 'darwin',
    verifyExecutableSignature: () => undefined,
  });
  assert.deepEqual(missing.issues.map(({ code }) => code), [
    'AGENT_CODEX_HOME_REQUIRED',
    'CODEX_BIN_REQUIRED',
    'CODEX_BIN_SHA256_REQUIRED',
    'AGENT_CODEX_HOME_1_REQUIRED',
  ]);

  const malformed = await validateCodexA2AIsolation({
    env: {
      AGENT_CODEX_HOME: 'relative-service-home',
      CODEX_BIN: 'relative-codex',
      CODEX_BIN_SHA256: 'not-a-digest',
    },
    platform: 'darwin',
    verifyExecutableSignature: () => undefined,
  });
  assert.deepEqual(malformed.issues.map(({ code }) => code), [
    'AGENT_CODEX_HOME_ABSOLUTE',
    'CODEX_BIN_ABSOLUTE',
    'CODEX_BIN_SHA256_FORMAT',
    'AGENT_CODEX_HOME_1_REQUIRED',
  ]);

  await fs.chmod(serviceHome, 0o750);
  const publicHome = await validateCodexA2AIsolation({
    env: validEnvironment,
    platform: 'darwin',
    verifyExecutableSignature: () => undefined,
  });
  assert.ok(publicHome.issues.some(({ code }) => code === 'AGENT_CODEX_HOME_PRIVATE'));
  await fs.chmod(serviceHome, 0o700);

  await fs.chmod(authFile, 0o640);
  const publicAuth = await validateCodexA2AIsolation({
    env: validEnvironment,
    platform: 'darwin',
    verifyExecutableSignature: () => undefined,
  });
  assert.ok(publicAuth.issues.some(({ code }) => code === 'CODEX_AUTH_FILE_PRIVATE'));
  await fs.chmod(authFile, 0o600);

  await fs.chmod(executable, 0o770);
  const writableExecutable = await validateCodexA2AIsolation({
    env: validEnvironment,
    platform: 'darwin',
    verifyExecutableSignature: () => undefined,
  });
  assert.ok(writableExecutable.issues.some(({ code }) => code === 'CODEX_BIN_PRIVATE'));
  await fs.chmod(executable, 0o700);

  const mismatchedDigest = await validateCodexA2AIsolation({
    env: { ...validEnvironment, CODEX_BIN_SHA256: '0'.repeat(64) },
    platform: 'darwin',
    verifyExecutableSignature: () => undefined,
  });
  assert.ok(mismatchedDigest.issues.some(({ code }) => code === 'CODEX_BIN_SHA256_MISMATCH'));

  const failedSignature = await validateCodexA2AIsolation({
    env: validEnvironment,
    platform: 'darwin',
    verifyExecutableSignature: () => { throw new Error(authSecret); },
  });
  assert.deepEqual(failedSignature.issues.map(({ code }) => code), ['CODEX_SIGNATURE_INVALID']);
  assert.doesNotMatch(JSON.stringify(failedSignature), new RegExp(authSecret, 'u'));

  const defaultSignature = await validateCodexA2AIsolation({
    env: validEnvironment,
    platform: 'darwin',
  });
  assert.equal(defaultSignature.ok, false);
  assert.ok(defaultSignature.issues.some(({ code }) => (
    code === 'CODEX_SIGNATURE_PREREQUISITE' || code === 'CODEX_SIGNATURE_INVALID'
  )));

  const unsupportedPlatform = await validateCodexA2AIsolation({
    env: validEnvironment,
    platform: 'linux',
    verifyExecutableSignature: () => undefined,
  });
  assert.deepEqual(unsupportedPlatform.issues.map(({ code }) => code), ['CODEX_SIGNATURE_PLATFORM']);

  const cliEnvironment = {
    ...process.env,
    AGENT_CODEX_HOME: serviceHome,
    CODEX_BIN: executable,
    CODEX_BIN_SHA256: 'f'.repeat(64),
  };
  await assert.rejects(
    () => execFileAsync(process.execPath, ['scripts/validate-codex-a2a-isolation.mjs'], {
      cwd: process.cwd(),
      env: cliEnvironment,
      encoding: 'utf8',
    }),
    (error) => {
      assert.equal(error.code, 1);
      const output = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
      assert.match(output, /CODEX_BIN does not match CODEX_BIN_SHA256/u);
      assert.doesNotMatch(output, new RegExp(authSecret, 'u'));
      assert.doesNotMatch(output, /f{64}/u);
      assert.doesNotMatch(output, new RegExp(serviceHome.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
      return true;
    },
  );
  console.log('PASS: valid Codex A2A isolation operator configuration is accepted');
} finally {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}
