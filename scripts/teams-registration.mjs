import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_PACKAGE_ENTRIES = 128;
const BOT_DEFAULT_FALSE_FIELDS = new Set(['supportsCalling', 'supportsVideo', 'supportsFiles']);

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

async function readZipEntries(packagePath) {
  const resolvedPath = path.resolve(packagePath);
  let listing;
  try {
    listing = await execFileAsync('unzip', ['-Z1', resolvedPath], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: DEFAULT_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
  } catch (error) {
    throw registrationMismatch(`could not inspect package entries: ${String(error?.stderr || error?.message || error).trim()}`, {
      field: 'packageFormat',
    });
  }
  const entries = String(listing.stdout ?? '')
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length > MAX_PACKAGE_ENTRIES) {
    throw registrationMismatch(`package contains ${entries.length} entries, maximum is ${MAX_PACKAGE_ENTRIES}`, {
      field: 'packageEntries',
    });
  }
  const files = entries.filter((entry) => !entry.endsWith('/'));
  if (new Set(files).size !== files.length) {
    throw registrationMismatch('package contains duplicate file entries', { field: 'packageEntries' });
  }
  const contents = new Map();
  for (const entry of files) {
    if (entry.includes('\0') || path.posix.isAbsolute(entry) || entry.split('/').includes('..')) {
      throw registrationMismatch(`package contains an unsafe entry: ${entry}`, { field: 'packageEntries' });
    }
    try {
      const result = await execFileAsync('unzip', ['-p', resolvedPath, entry], {
        cwd: process.cwd(),
        encoding: 'buffer',
        timeout: DEFAULT_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
      });
      const bytes = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? '');
      contents.set(entry, { bytes, sha256: sha256(bytes) });
    } catch (error) {
      throw registrationMismatch(`could not read package entry ${entry}: ${String(error?.stderr || error?.message || error).trim()}`, {
        field: 'packageFormat',
        entry,
      });
    }
  }
  return contents;
}

function canonicalizeManifest(value, parentKey = '') {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalizeManifest(item, parentKey));
    if (parentKey === 'scopes') return items.sort((left, right) => String(left).localeCompare(String(right)));
    return items;
  }
  if (value && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (parentKey === 'bots' && BOT_DEFAULT_FALSE_FIELDS.has(key) && value[key] === false) continue;
      result[key] = canonicalizeManifest(value[key], key);
    }
    return result;
  }
  return value;
}

function parseManifestEntry(entries, label) {
  const entry = entries.get('manifest.json');
  if (!entry) throw registrationMismatch(`${label} is missing manifest.json`, { field: 'manifest' });
  try {
    return JSON.parse(entry.bytes.toString('utf8'));
  } catch {
    throw registrationMismatch(`${label} manifest.json is not valid JSON`, { field: 'manifest' });
  }
}

async function compareRegisteredPackage({ expectedPackagePath, registeredPackagePath, appId, version, registeredPackageSha256 }) {
  const expectedEntries = await readZipEntries(expectedPackagePath);
  const registeredEntries = await readZipEntries(registeredPackagePath);
  const expectedNames = [...expectedEntries.keys()].sort();
  const registeredNames = [...registeredEntries.keys()].sort();
  if (JSON.stringify(expectedNames) !== JSON.stringify(registeredNames)) {
    throw registrationMismatch('registered package file set differs from the release package', {
      field: 'packageEntries',
      actual: registeredNames,
      expected: expectedNames,
    });
  }

  const expectedManifest = parseManifestEntry(expectedEntries, 'release package');
  const registeredManifest = parseManifestEntry(registeredEntries, 'registered package');
  if (String(expectedManifest.id ?? '') !== appId || String(expectedManifest.version ?? '') !== version) {
    throw registrationMismatch('release package manifest identity does not match app registration', {
      field: 'manifest',
      actual: { id: expectedManifest.id ?? null, version: expectedManifest.version ?? null },
      expected: { id: appId, version },
    });
  }
  if (String(registeredManifest.id ?? '') !== appId || String(registeredManifest.version ?? '') !== version) {
    throw registrationMismatch('registered package manifest identity does not match app registration', {
      field: 'manifest',
      actual: { id: registeredManifest.id ?? null, version: registeredManifest.version ?? null },
      expected: { id: appId, version },
    });
  }
  if (JSON.stringify(canonicalizeManifest(expectedManifest)) !== JSON.stringify(canonicalizeManifest(registeredManifest))) {
    throw registrationMismatch('registered package manifest differs from the release package', {
      field: 'manifest',
    });
  }
  for (const entryName of expectedNames) {
    if (entryName === 'manifest.json') continue;
    if (expectedEntries.get(entryName).sha256 !== registeredEntries.get(entryName).sha256) {
      throw registrationMismatch(`registered package entry differs: ${entryName}`, {
        field: 'packageEntry',
        entry: entryName,
        actual: registeredEntries.get(entryName).sha256,
        expected: expectedEntries.get(entryName).sha256,
      });
    }
  }
  return {
    registeredPackageSha256,
    packageComparison: 'manifest-normalized-assets-exact',
  };
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
 * Verify the package currently registered in Teams Developer CLI has the same
 * release identity and assets as the package the release state is about to
 * attest in the portal. Teams may reserialize manifest.json and ZIP metadata
 * during registration, so the archive byte hash is retained as evidence but
 * is not used as the identity comparison.
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
    const packageComparison = await compareRegisteredPackage({
      expectedPackagePath: packagePath,
      registeredPackagePath,
      appId: expectedAppId,
      version,
      registeredPackageSha256,
    });
    return {
      status: 'VERIFIED',
      source: 'teams-developer-cli',
      observedAt: new Date(now).toISOString(),
      appId: expectedAppId,
      version,
      endpoint,
      packageSha256,
      ...packageComparison,
    };
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}
