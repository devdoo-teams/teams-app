import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Teams registration verification requires ${label}`);
  }
  return value.trim();
}
function registrationMismatch(message, details = {}) {
  const error = new Error(`Teams registered app does not match the release: ${message}`);
  error.code = 'ETEAMSREGISTRATIONMISMATCH';
  error.details = details;
  return error;
}

function parseJsonOutput(output, label) {
  const text = String(output ?? '').trim();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Teams registration ${label} did not return JSON`);
  }
}

async function runTeamsCli(args, { cliPath = process.env.TEAMS_CLI_BIN?.trim() || 'teams', timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  try {
    return await execFileAsync(cliPath, args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      const missing = new Error(`Teams Developer CLI executable was not found: ${cliPath}`);
      missing.code = 'ETEAMSCLIMISSING';
      throw missing;
    }
    const failed = new Error(`Teams Developer CLI failed: ${String(error?.stderr || error?.message || error).trim()}`);
    failed.code = error?.killed || error?.signal === 'SIGTERM' ? 'ETEAMSCLITIMEOUT' : 'ETEAMSCLI';
    throw failed;
  }
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function assertSha256(value, label) {
  const normalized = requiredText(value, label).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label} must be a SHA-256 hex digest`);
  return normalized;
}

function assertHttpsUrl(value, label) {
  const normalized = requiredText(value, label);
  let parsed;
  try { parsed = new URL(normalized); } catch { throw new Error(`${label} must be an absolute HTTPS URL`); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error(`${label} must be an absolute HTTPS URL without credentials`);
  }
  return parsed.href;
}

/**
 * Verify the package currently registered in Teams Developer CLI is the exact
 * package that the release state is about to attest in the portal.
 *
 * The CLI calls are injected in tests because they are the external boundary;
 * the response parsing, package hashing, and fail-closed comparisons remain
 * real production code.
 */
export async function verifyTeamsRegistration({
  appId,
  expectedVersion,
  expectedEndpoint,
  expectedPackagePath,
  expectedPackageSha256,
  runCli = (args) => runTeamsCli(args),
  now = new Date(),
}) {
  const expectedAppId = requiredText(appId, 'appId');
  const version = requiredText(expectedVersion, 'expectedVersion');
  const endpoint = assertHttpsUrl(expectedEndpoint, 'expectedEndpoint');
  const packagePath = requiredText(expectedPackagePath, 'expectedPackagePath');
  const packageSha256 = assertSha256(expectedPackageSha256, 'expectedPackageSha256');
  const appResult = await runCli(['app', 'get', expectedAppId, '--json']);
  const registered = parseJsonOutput(appResult?.stdout, 'app get');
  const registeredAppId = String(registered?.appId ?? registered?.teamsAppId ?? '').trim();
  const registeredVersion = String(registered?.version ?? '').trim();
  const registeredEndpoint = String(registered?.endpoint ?? '').trim();
  if (registeredAppId !== expectedAppId) {
    throw registrationMismatch(`appId is ${registeredAppId || '<missing>'}, expected ${expectedAppId}`, {
      field: 'appId',
      actual: registeredAppId || null,
      expected: expectedAppId,
    });
  }
  if (registeredVersion !== version) {
    throw registrationMismatch(`version is ${registeredVersion || '<missing>'}, expected ${version}`, {
      field: 'version',
      actual: registeredVersion || null,
      expected: version,
    });
  }
  if (registeredEndpoint !== endpoint) {
    throw registrationMismatch(`endpoint is ${registeredEndpoint || '<missing>'}, expected ${endpoint}`, {
      field: 'endpoint',
      actual: registeredEndpoint || null,
      expected: endpoint,
    });
  }

  const expectedBytes = await fs.readFile(path.resolve(packagePath));
  if (sha256(expectedBytes) !== packageSha256) {
    throw registrationMismatch('release package path does not match its recorded SHA-256', {
      field: 'expectedPackageSha256',
      actual: sha256(expectedBytes),
      expected: packageSha256,
    });
  }

  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-registration-'));
  const registeredPackagePath = path.join(temporaryDirectory, 'registered.zip');
  try {
    await runCli(['app', 'package', 'download', expectedAppId, '--output', registeredPackagePath]);
    const registeredBytes = await fs.readFile(registeredPackagePath);
    const registeredPackageSha256 = sha256(registeredBytes);
    if (registeredPackageSha256 !== packageSha256) {
      throw registrationMismatch(
        `registered ZIP SHA-256 is ${registeredPackageSha256}, expected ${packageSha256}`,
        { field: 'packageSha256', actual: registeredPackageSha256, expected: packageSha256 },
      );
    }
    return {
      status: 'VERIFIED',
      source: 'teams-developer-cli',
      observedAt: new Date(now).toISOString(),
      appId: expectedAppId,
      version,
      endpoint,
      packageSha256,
    };
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}
