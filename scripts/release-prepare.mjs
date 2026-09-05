import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const VERSION_FILES = [
  'package.json',
  'package-lock.json',
  'appPackage/manifest.json',
];
const GIT_LINEAGE_TIMEOUT_MS = 30_000;
const GIT_LINEAGE_MAX_COMMITS = 5_000;
const execFileAsync = promisify(execFile);

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

export function sanitizeGitEnvironment(environment = process.env) {
  return Object.fromEntries(
    Object.entries(environment).filter(([key]) => !key.toUpperCase().startsWith('GIT_')),
  );
}

async function runGit(rootDir, args, { timeoutMs = GIT_LINEAGE_TIMEOUT_MS } = {}) {
  const cleanEnvironment = sanitizeGitEnvironment();
  try {
    return await execFileAsync('git', args, {
      cwd: rootDir,
      encoding: 'utf8',
      env: {
        ...cleanEnvironment,
        GIT_CEILING_DIRECTORIES: path.resolve(rootDir),
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
      },
      maxBuffer: 8 * 1024 * 1024,
      timeout: timeoutMs,
    });
  } catch (cause) {
    const detail = String(cause?.stderr || cause?.message || cause).trim();
    throw releaseError('EGITLINEAGE', `failed to inspect Git release lineage: ${detail}`);
  }
}

async function runWithinLineageDeadline({ deadline, timeoutMs, label, operation }) {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    throw releaseError('EGITLINEAGE', `Git release lineage inspection exceeded ${timeoutMs}ms during ${label}`);
  }
  let timeout;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(releaseError(
            'EGITLINEAGE',
            `Git release lineage inspection exceeded ${timeoutMs}ms during ${label}`,
          )),
          remainingMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function readGitReleaseVersionLineage(
  rootDir = root,
  { realpath = fs.realpath, timeoutMs = GIT_LINEAGE_TIMEOUT_MS } = {},
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw releaseError('EGITLINEAGE', `Git release lineage timeout must be positive: ${timeoutMs}`);
  }
  const deadline = Date.now() + timeoutMs;
  const runLineageGit = (args) => {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw releaseError('EGITLINEAGE', `Git release lineage inspection exceeded ${timeoutMs}ms`);
    }
    return runGit(rootDir, args, { timeoutMs: remainingMs });
  };

  const { stdout: topLevelOutput } = await runLineageGit(['rev-parse', '--show-toplevel']);
  const topLevel = path.resolve(topLevelOutput.trim());
  const [topLevelRealPath, rootRealPath] = await runWithinLineageDeadline({
    deadline,
    timeoutMs,
    label: 'canonical path resolution',
    operation: () => Promise.all([
      realpath(topLevel),
      realpath(rootDir),
    ]),
  });
  if (topLevelRealPath !== rootRealPath) {
    throw releaseError('EGITLINEAGE', `release root must be the Git top level: ${rootDir} != ${topLevel}`);
  }

  const { stdout: commitOutput } = await runLineageGit([
    'log',
    '--all',
    '--full-history',
    '--format=%H',
    '--diff-filter=AM',
    '--',
    'appPackage/manifest.json',
  ]);
  const commits = [...new Set(commitOutput.split(/\r?\n/).map((value) => value.trim()).filter(Boolean))];
  if (commits.length === 0) {
    throw releaseError('EGITLINEAGE', 'no committed Teams manifest was found across Git refs');
  }
  if (commits.length > GIT_LINEAGE_MAX_COMMITS) {
    throw releaseError(
      'EGITLINEAGE',
      `Git release lineage contains ${commits.length} manifest commits; bounded maximum is ${GIT_LINEAGE_MAX_COMMITS}`,
    );
  }

  const entries = [];
  for (const commit of commits) {
    const { stdout } = await runLineageGit(['show', `${commit}:appPackage/manifest.json`]);
    let manifest;
    try {
      manifest = JSON.parse(stdout);
    } catch (cause) {
      throw releaseError('EGITLINEAGE', `cannot parse appPackage/manifest.json at ${commit}: ${cause.message}`);
    }
    const candidate = String(manifest?.version ?? '').trim();
    if (!VERSION_PATTERN.test(candidate)) continue;
    entries.push({ commit, version: candidate });
  }
  if (entries.length === 0) {
    throw releaseError('EGITLINEAGE', 'no stable Teams manifest version was found across Git refs');
  }

  const highest = entries.reduce((best, entry) => (
    compareReleaseVersions(entry.version, best.version) > 0 ? entry : best
  ));
  return {
    highestVersion: highest.version,
    highestCommit: highest.commit,
    observedStableVersions: entries.length,
  };
}

export function assertReleaseVersionAboveLineage(currentVersion, nextVersion, lineage) {
  const result = assertReleaseVersionBumped(currentVersion, nextVersion);
  const highest = parseReleaseVersion(lineage?.highestVersion, 'highest Git release version');
  if (compareReleaseVersions(result.next, highest) <= 0) {
    throw releaseError(
      'EVERSIONRESERVED',
      `next release version must be greater than every version observed across Git refs: ${result.next} <= ${highest} at ${lineage.highestCommit}`,
    );
  }
  return { ...result, highestGitVersion: highest, highestGitCommit: lineage.highestCommit };
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
  const lineage = await readGitReleaseVersionLineage(rootDir);
  const { current: currentVersion, next } = assertReleaseVersionAboveLineage(
    current.currentVersion,
    nextVersion,
    lineage,
  );
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
    highestGitVersion: lineage.highestVersion,
    highestGitCommit: lineage.highestCommit,
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
    const lineageBlocked = error.code === 'EVERSIONRESERVED' || error.code === 'EGITLINEAGE';
    console.error(JSON.stringify({
      status: 'BLOCKED',
      phase: 'prepare',
      blocker: { code: error.code ?? 'EUNKNOWN', message: error.message },
      nextAction: lineageBlocked
        ? 'Refresh and inspect every remote branch, tag, and pull-request head; choose a version above the highest observed reservation, then rerun release:prepare.'
        : 'Fix the version input or version-file mismatch, then rerun release:prepare.',
    }, null, 2));
    process.exitCode = 1;
  }
}
