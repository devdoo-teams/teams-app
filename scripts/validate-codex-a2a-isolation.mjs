#!/usr/bin/env node

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_AUTH_FILE_BYTES = 1024 * 1024;
const SIGNATURE_TIMEOUT_MS = 45_000;
const CODE_SIGN_PATH = '/usr/bin/codesign';
const OPENAI_TEAM_IDENTIFIER = '2DC432GLL2';
const CODE_SIGN_REQUIREMENT = `identifier "codex" and anchor apple generic and certificate leaf[subject.OU] = "${OPENAI_TEAM_IDENTIFIER}"`;
const NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;
const MAX_A2A_CLI_WORKERS = 8;

const ISSUE_MESSAGES = Object.freeze({
  AGENT_CODEX_HOME_REQUIRED: 'AGENT_CODEX_HOME is required.',
  AGENT_CODEX_HOME_ABSOLUTE: 'AGENT_CODEX_HOME must be an absolute path.',
  AGENT_CODEX_HOME_UNAVAILABLE: 'AGENT_CODEX_HOME is unavailable.',
  AGENT_CODEX_HOME_PRIVATE: 'AGENT_CODEX_HOME must be an owner-only directory owned by the service user.',
  AGENT_CODEX_HOME_SYMLINK: 'AGENT_CODEX_HOME must not be a symbolic link.',
  CODEX_AUTH_FILE_UNAVAILABLE: 'AGENT_CODEX_HOME/auth.json is unavailable.',
  CODEX_AUTH_FILE_PRIVATE: 'AGENT_CODEX_HOME/auth.json must be a readable owner-only regular file.',
  CODEX_AUTH_FILE_SYMLINK: 'AGENT_CODEX_HOME/auth.json must not be a symbolic link.',
  CODEX_AUTH_FILE_CHANGED: 'AGENT_CODEX_HOME/auth.json changed during validation.',
  CODEX_BIN_REQUIRED: 'CODEX_BIN is required.',
  CODEX_BIN_ABSOLUTE: 'CODEX_BIN must be an absolute path.',
  CODEX_BIN_UNAVAILABLE: 'CODEX_BIN is unavailable.',
  CODEX_BIN_PRIVATE: 'CODEX_BIN must be a regular executable with no group or other write permission.',
  CODEX_BIN_SYMLINK: 'CODEX_BIN must not be a symbolic link.',
  CODEX_BIN_CHANGED: 'CODEX_BIN changed during validation.',
  CODEX_BIN_SHA256_REQUIRED: 'CODEX_BIN_SHA256 is required.',
  CODEX_BIN_SHA256_FORMAT: 'CODEX_BIN_SHA256 must be a 64-character hexadecimal SHA-256 digest.',
  CODEX_BIN_SHA256_MISMATCH: 'CODEX_BIN does not match CODEX_BIN_SHA256.',
  CODEX_SIGNATURE_PLATFORM: 'Signed Codex executable validation requires macOS.',
  CODEX_SIGNATURE_PREREQUISITE: 'The macOS codesign prerequisite is unavailable.',
  CODEX_SIGNATURE_INVALID: 'CODEX_BIN does not satisfy the trusted Codex signing requirement.',
  TEAMS_AGENT_CLI_PROVIDER_INVALID: 'TEAMS_AGENT_CLI_PROVIDER must be either codex or copilot.',
  TEAMS_A2A_AGENT_PROVIDERS_INVALID: 'TEAMS_A2A_AGENT_PROVIDERS may contain only codex and copilot.',
  TEAMS_A2A_AGENT_PROVIDERS_LIMIT: `TEAMS_A2A_AGENT_PROVIDERS may register at most ${MAX_A2A_CLI_WORKERS} workers.`,
});

class SignaturePrerequisiteError extends Error {}

/**
 * Validate the operator-owned inputs required by the production Codex A2A
 * isolation provider. This is deliberately metadata-only for auth.json: its
 * contents are never parsed, copied, or included in a diagnostic.
 */
export async function validateCodexA2AIsolation({
  env = process.env,
  platform = process.platform,
  currentUid = typeof process.getuid === 'function' ? process.getuid() : undefined,
  verifyExecutableSignature = verifySignedCodexExecutable,
} = {}) {
  const issues = [];
  const codexHome = requiredAbsoluteValue(env.AGENT_CODEX_HOME, 'AGENT_CODEX_HOME', issues);
  const codexBin = requiredAbsoluteValue(env.CODEX_BIN, 'CODEX_BIN', issues);
  const expectedDigest = requiredDigest(env.CODEX_BIN_SHA256, issues);

  let serviceHome;
  if (codexHome) {
    serviceHome = await validateServiceHome(codexHome, currentUid, issues);
  }
  if (serviceHome) {
    await validateAuthFile(path.join(serviceHome, 'auth.json'), currentUid, issues);
  }
  await validateIndexedA2AHomes({ env, serviceHome, currentUid, issues });
  if (codexBin) {
    await validateExecutable({
      candidate: codexBin,
      expectedDigest,
      currentUid,
      platform,
      verifyExecutableSignature,
      issues,
    });
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

async function validateIndexedA2AHomes({ env, serviceHome, currentUid, issues }) {
  let ordinal = 0;
  const indexedHomes = new Set();
  const providers = normalizeA2AAgentProviders(env, issues);
  if (!providers) return;
  for (const provider of providers) {
    if (provider !== 'codex') continue;
    ordinal += 1;
    const variableName = `AGENT_CODEX_HOME_${ordinal}`;
    const indexedHome = requiredAbsoluteValue(env[variableName], variableName, issues);
    if (!indexedHome) continue;
    const realHome = await validateServiceHome(indexedHome, currentUid, issues);
    if (!realHome) continue;
    if (indexedHomes.has(realHome)) {
      issues.push({
        code: 'A2A_CODEX_HOME_DUPLICATE',
        message: 'Indexed A2A Codex homes must be distinct.',
      });
    }
    if (serviceHome && realHome === serviceHome) {
      issues.push({
        code: 'A2A_CODEX_HOME_LEGACY_ALIAS',
        message: 'Indexed A2A Codex homes must be distinct from AGENT_CODEX_HOME.',
      });
    }
    indexedHomes.add(realHome);
    await validateAuthFile(path.join(realHome, 'auth.json'), currentUid, issues);
  }
}

function normalizeA2AAgentProviders(env, issues) {
  const defaultProvider = typeof env.TEAMS_AGENT_CLI_PROVIDER === 'string'
    ? env.TEAMS_AGENT_CLI_PROVIDER.trim() || 'codex'
    : 'codex';
  if (!isSupportedA2AProvider(defaultProvider)) {
    issues.push(issue('TEAMS_AGENT_CLI_PROVIDER_INVALID'));
    return undefined;
  }
  const rawProviders = typeof env.TEAMS_A2A_AGENT_PROVIDERS === 'string'
    ? env.TEAMS_A2A_AGENT_PROVIDERS.trim()
    : '';
  const requestedProviders = rawProviders
    ? rawProviders.split(',').map((entry) => entry.trim())
    : [defaultProvider];
  for (const provider of requestedProviders) {
    if (!isSupportedA2AProvider(provider)) {
      issues.push(issue('TEAMS_A2A_AGENT_PROVIDERS_INVALID'));
      return undefined;
    }
  }

  const providers = requestedProviders.includes(defaultProvider)
    ? requestedProviders
    : [defaultProvider, ...requestedProviders];
  if (providers.length > MAX_A2A_CLI_WORKERS) {
    issues.push(issue('TEAMS_A2A_AGENT_PROVIDERS_LIMIT'));
    return undefined;
  }
  return providers;
}

function isSupportedA2AProvider(provider) {
  return provider === 'codex' || provider === 'copilot';
}

function requiredAbsoluteValue(value, name, issues) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    issues.push(issue(`${name}_REQUIRED`));
    return undefined;
  }
  if (normalized.includes('\u0000') || !path.isAbsolute(normalized)) {
    issues.push(issue(`${name}_ABSOLUTE`));
    return undefined;
  }
  return normalized;
}

function requiredDigest(value, issues) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized) {
    issues.push(issue('CODEX_BIN_SHA256_REQUIRED'));
    return undefined;
  }
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    issues.push(issue('CODEX_BIN_SHA256_FORMAT'));
    return undefined;
  }
  return normalized;
}

async function validateServiceHome(candidate, currentUid, issues) {
  let initial;
  try {
    initial = await fs.lstat(candidate);
  } catch {
    issues.push(issue('AGENT_CODEX_HOME_UNAVAILABLE'));
    return undefined;
  }
  if (initial.isSymbolicLink()) {
    issues.push(issue('AGENT_CODEX_HOME_SYMLINK'));
    return undefined;
  }
  if (!initial.isDirectory()) {
    issues.push(issue('AGENT_CODEX_HOME_UNAVAILABLE'));
    return undefined;
  }

  let real;
  let stat;
  try {
    real = path.normalize(await fs.realpath(candidate));
    stat = await fs.lstat(real);
  } catch {
    issues.push(issue('AGENT_CODEX_HOME_UNAVAILABLE'));
    return undefined;
  }
  if (!stat.isDirectory()) {
    issues.push(issue('AGENT_CODEX_HOME_UNAVAILABLE'));
    return undefined;
  }
  if (!isPrivateDirectory(stat, currentUid)) {
    issues.push(issue('AGENT_CODEX_HOME_PRIVATE'));
    return undefined;
  }
  return real;
}

async function validateAuthFile(candidate, currentUid, issues) {
  let initial;
  try {
    initial = await fs.lstat(candidate);
  } catch {
    issues.push(issue('CODEX_AUTH_FILE_UNAVAILABLE'));
    return;
  }
  if (initial.isSymbolicLink()) {
    issues.push(issue('CODEX_AUTH_FILE_SYMLINK'));
    return;
  }
  if (!isPrivateAuthFile(initial, currentUid)) {
    issues.push(issue('CODEX_AUTH_FILE_PRIVATE'));
    return;
  }

  let handle;
  try {
    handle = await fs.open(candidate, fsConstants.O_RDONLY | NOFOLLOW);
    const opened = await handle.stat();
    if (!sameStableIdentity(initial, opened)) {
      issues.push(issue('CODEX_AUTH_FILE_CHANGED'));
    }
  } catch {
    issues.push(issue('CODEX_AUTH_FILE_UNAVAILABLE'));
  } finally {
    await handle?.close();
  }
}

async function validateExecutable({
  candidate,
  expectedDigest,
  currentUid,
  platform,
  verifyExecutableSignature,
  issues,
}) {
  let initial;
  try {
    initial = await fs.lstat(candidate);
  } catch {
    issues.push(issue('CODEX_BIN_UNAVAILABLE'));
    return;
  }
  if (initial.isSymbolicLink()) {
    issues.push(issue('CODEX_BIN_SYMLINK'));
    return;
  }
  if (!isTrustedExecutable(initial, currentUid)) {
    issues.push(issue('CODEX_BIN_PRIVATE'));
    return;
  }
  try {
    await fs.access(candidate, fsConstants.X_OK);
  } catch {
    issues.push(issue('CODEX_BIN_UNAVAILABLE'));
    return;
  }

  let handle;
  let real;
  let digest;
  try {
    real = path.normalize(await fs.realpath(candidate));
    handle = await fs.open(real, fsConstants.O_RDONLY | NOFOLLOW);
    const opened = await handle.stat();
    if (!sameStableIdentity(initial, opened)) {
      issues.push(issue('CODEX_BIN_CHANGED'));
      return;
    }
    digest = crypto.createHash('sha256').update(await handle.readFile()).digest('hex');
    const afterRead = await handle.stat();
    if (!sameStableIdentity(opened, afterRead)) {
      issues.push(issue('CODEX_BIN_CHANGED'));
      return;
    }
  } catch {
    issues.push(issue('CODEX_BIN_UNAVAILABLE'));
    return;
  } finally {
    await handle?.close();
  }

  if (expectedDigest && digest !== expectedDigest) {
    issues.push(issue('CODEX_BIN_SHA256_MISMATCH'));
    return;
  }
  if (platform !== 'darwin') {
    issues.push(issue('CODEX_SIGNATURE_PLATFORM'));
    return;
  }
  try {
    await verifyExecutableSignature({ path: real, sha256: digest });
  } catch (error) {
    issues.push(issue(error instanceof SignaturePrerequisiteError
      ? 'CODEX_SIGNATURE_PREREQUISITE'
      : 'CODEX_SIGNATURE_INVALID'));
  }
}

async function verifySignedCodexExecutable({ path: executablePath }) {
  try {
    await fs.access(CODE_SIGN_PATH, fsConstants.X_OK);
  } catch {
    throw new SignaturePrerequisiteError();
  }
  await execFileAsync(CODE_SIGN_PATH, [
    '--verify',
    '--strict',
    '--verbose=2',
    `-R=${CODE_SIGN_REQUIREMENT}`,
    executablePath,
  ], {
    encoding: 'utf8',
    timeout: SIGNATURE_TIMEOUT_MS,
    maxBuffer: 16 * 1024,
    stdio: 'pipe',
  });
}

function isPrivateDirectory(stat, currentUid) {
  return stat.isDirectory()
    && (stat.mode & 0o077) === 0
    && (currentUid === undefined || stat.uid === currentUid);
}

function isPrivateAuthFile(stat, currentUid) {
  return stat.isFile()
    && stat.nlink === 1
    && stat.size > 0
    && stat.size <= MAX_AUTH_FILE_BYTES
    && (stat.mode & 0o077) === 0
    && (stat.mode & 0o400) !== 0
    && (currentUid === undefined || stat.uid === currentUid);
}

function isTrustedExecutable(stat, currentUid) {
  return stat.isFile()
    && stat.nlink === 1
    && (stat.mode & 0o022) === 0
    && (currentUid === undefined || stat.uid === 0 || stat.uid === currentUid);
}

function stableIdentity(stat) {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    mode: stat.mode,
    nlink: stat.nlink,
    size: stat.size,
    uid: stat.uid,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

function sameStableIdentity(left, right) {
  const a = stableIdentity(left);
  const b = stableIdentity(right);
  return a.dev === b.dev
    && a.ino === b.ino
    && a.mode === b.mode
    && a.nlink === b.nlink
    && a.size === b.size
    && a.uid === b.uid
    && a.mtimeMs === b.mtimeMs
    && a.ctimeMs === b.ctimeMs;
}

function issue(code) {
  return { code, message: ISSUE_MESSAGES[code] ?? 'Codex A2A isolation validation failed.' };
}

async function main() {
  const result = await validateCodexA2AIsolation();
  if (!result.ok) {
    console.error('Codex A2A isolation configuration is not ready.');
    for (const current of result.issues) console.error(`- ${current.message}`);
    process.exitCode = 1;
    return;
  }
  console.log('Codex A2A isolation configuration is valid.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch {
    console.error('Codex A2A isolation validation could not complete safely.');
    process.exitCode = 2;
  }
}
