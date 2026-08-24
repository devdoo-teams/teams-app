import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const VERSION_FILES = [
  'package.json',
  'package-lock.json',
  'appPackage/manifest.json',
];

function releaseError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function parseReleaseVersion(value, label = 'release version') {
  const version = String(value ?? '').trim();
  if (!VERSION_PATTERN.test(version)) {
    throw releaseError('EINVALIDVERSION', `${label} must be a stable X.Y.Z version: ${version || '<empty>'}`);
  }
  return version;
}

export function compareReleaseVersions(left, right) {
  const a = parseReleaseVersion(left, 'left version').split('.').map(Number);
  const b = parseReleaseVersion(right, 'right version').split('.').map(Number);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function assertReleaseVersionBumped(currentVersion, nextVersion) {
  const current = parseReleaseVersion(currentVersion, 'current release version');
  const next = parseReleaseVersion(nextVersion, 'next release version');
  if (compareReleaseVersions(next, current) <= 0) {
    throw releaseError(
      'EVERSIONNOTBUMPED',
      `next release version must be greater than current version: ${current} -> ${next}`,
    );
  }
  return { current, next };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function replaceVersionFields(text, expectedVersion, nextVersion, count, label) {
  let replaced = 0;
  const updated = text.replace(/^(\s*"version"\s*:\s*")([^"]+)(")/gm, (match, prefix, value, suffix) => {
    if (replaced >= count) return match;
    if (value !== expectedVersion) {
      throw releaseError('EVERSIONSET', `${label} version field does not match the validated current version: ${value}`);
    }
    replaced += 1;
    return `${prefix}${nextVersion}${suffix}`;
  });
  if (replaced !== count) {
    throw releaseError('EVERSIONSET', `${label} must contain exactly ${count} version field(s); found ${replaced}`);
  }
  return updated;
}

export async function readReleaseVersionSet(rootDir = root) {
  const rawEntries = await Promise.all(VERSION_FILES.map(async (relativePath) => [
    relativePath,
    await fs.readFile(path.join(rootDir, relativePath), 'utf8'),
  ]));
  const rawDocuments = Object.fromEntries(rawEntries);
  const packageJson = JSON.parse(rawDocuments['package.json']);
  const packageLock = JSON.parse(rawDocuments['package-lock.json']);
  const manifest = JSON.parse(rawDocuments['appPackage/manifest.json']);
  const versions = {
    packageJson: parseReleaseVersion(packageJson.version, 'package.json version'),
    packageLock: parseReleaseVersion(packageLock.version, 'package-lock.json version'),
    packageLockRoot: parseReleaseVersion(packageLock.packages?.['']?.version, 'package-lock root version'),
    manifest: parseReleaseVersion(manifest.version, 'appPackage/manifest.json version'),
  };
  const unique = new Set(Object.values(versions));
  if (unique.size !== 1) {
    throw releaseError(
      'EVERSIONSET',
      `release version files must agree: ${Object.entries(versions).map(([key, value]) => `${key}=${value}`).join(', ')}`,
    );
  }
  return {
    currentVersion: versions.packageJson,
    versions,
    documents: { packageJson, packageLock, manifest },
    rawDocuments,
  };
}

async function writeAtomically(filePath, contents) {
  const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    await fs.writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryPath, filePath);
  } finally {
    try { await fs.unlink(temporaryPath); } catch {}
  }
}

export async function prepareReleaseVersion({ rootDir = root, nextVersion, dryRun = false } = {}) {
  const current = await readReleaseVersionSet(rootDir);
  const { current: currentVersion, next } = assertReleaseVersionBumped(current.currentVersion, nextVersion);
  const contents = {
    'package.json': replaceVersionFields(current.rawDocuments['package.json'], currentVersion, next, 1, 'package.json'),
    'package-lock.json': replaceVersionFields(current.rawDocuments['package-lock.json'], currentVersion, next, 2, 'package-lock.json'),
    'appPackage/manifest.json': replaceVersionFields(current.rawDocuments['appPackage/manifest.json'], currentVersion, next, 1, 'appPackage/manifest.json'),
  };
  if (!dryRun) {
    const originals = await Promise.all(
      VERSION_FILES.map(async (relativePath) => [relativePath, await fs.readFile(path.join(rootDir, relativePath), 'utf8')]),
    );
    const written = [];
    try {
      for (const relativePath of VERSION_FILES) {
        await writeAtomically(path.join(rootDir, relativePath), contents[relativePath]);
        written.push(relativePath);
      }
    } catch (error) {
      for (const [relativePath, original] of originals) {
        if (written.includes(relativePath)) {
          try { await writeAtomically(path.join(rootDir, relativePath), original); } catch {}
        }
      }
      throw error;
    }
  }
  return {
    status: dryRun ? 'DRY_RUN' : 'READY',
    currentVersion,
    nextVersion: next,
    changedFiles: VERSION_FILES.map((relativePath) => path.join(rootDir, relativePath)),
    nextAction: dryRun
      ? 'Run release:prepare without --dry-run to update the three version files.'
      : 'Review git diff -- package.json package-lock.json appPackage/manifest.json, run git diff --check, then commit before release:update.',
  };
}

export function parsePrepareArgs(argv) {
  const options = { nextVersion: undefined, dryRun: false, rootDir: root, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--version') {
      options.nextVersion = argv[index + 1];
      index += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--root') {
      options.rootDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (arg === '--json') {
      options.json = true;
    } else {
      throw releaseError('EINVALIDARGUMENT', `unknown release:prepare argument: ${arg}`);
    }
  }
  if (!options.nextVersion) throw releaseError('EINVALIDARGUMENT', 'release:prepare requires --version X.Y.Z');
  return options;
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  try {
    const options = parsePrepareArgs(process.argv.slice(2));
    const result = await prepareReleaseVersion(options);
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`${result.status}: ${result.currentVersion} -> ${result.nextVersion}\n${result.nextAction}`);
  } catch (error) {
    console.error(JSON.stringify({
      status: 'BLOCKED',
      phase: 'prepare',
      blocker: { code: error.code ?? 'EUNKNOWN', message: error.message },
      nextAction: 'Fix the version input or version-file mismatch, then rerun release:prepare.',
    }, null, 2));
    process.exitCode = 1;
  }
}
