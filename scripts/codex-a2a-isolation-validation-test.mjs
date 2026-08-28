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
  const validEnvironment = {
    AGENT_CODEX_HOME: serviceHome,
    CODEX_BIN: executable,
    CODEX_BIN_SHA256: digest,
  };

  const result = await validateCodexA2AIsolation({
    env: validEnvironment,
    platform: 'darwin',
    verifyExecutableSignature: () => undefined,
  });

  assert.deepEqual(result, { ok: true, issues: [] });
  assert.deepEqual(await fs.readdir(serviceHome), ['auth.json'], 'validation must not create service-home files');

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
