import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  assertReleaseVersionBumped,
  assertReleaseVersionAboveLineage,
  compareReleaseVersions,
  parsePrepareArgs,
  parseReleaseVersion,
  prepareReleaseVersion,
  readGitReleaseVersionLineage,
  readReleaseVersionSet,
  sanitizeGitEnvironment,
} from './release-prepare.mjs';

function runGit(cwd, args) {
  const cleanEnvironment = sanitizeGitEnvironment();
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...cleanEnvironment,
      GIT_CEILING_DIRECTORIES: path.resolve(cwd),
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

async function writeFixtureVersion(rootDir, version) {
  await fs.writeFile(path.join(rootDir, 'package.json'), JSON.stringify({ name: 'fixture', version }, null, 2) + '\n');
  await fs.writeFile(path.join(rootDir, 'package-lock.json'), JSON.stringify({
    name: 'fixture',
    version,
    lockfileVersion: 3,
    packages: { '': { name: 'fixture', version } },
  }, null, 2) + '\n');
  await fs.writeFile(path.join(rootDir, 'appPackage/manifest.json'), JSON.stringify({ id: 'fixture', version }, null, 2) + '\n');
}

assert.equal(parseReleaseVersion('1.2.3'), '1.2.3');
assert.equal(compareReleaseVersions('1.0.10', '1.0.9'), 1);
assert.equal(compareReleaseVersions('1.0.9', '1.0.10'), -1);
assert.deepEqual(assertReleaseVersionBumped('1.0.62', '1.0.63'), { current: '1.0.62', next: '1.0.63' });
assert.throws(
  () => assertReleaseVersionAboveLineage('1.0.100', '1.0.101', { highestVersion: '1.0.101', highestCommit: 'a'.repeat(40) }),
  (error) => error.code === 'EVERSIONRESERVED',
);
assert.throws(() => parseReleaseVersion('1.0'), /stable X\.Y\.Z/);
assert.throws(() => assertReleaseVersionBumped('1.0.62', '1.0.62'), (error) => error.code === 'EVERSIONNOTBUMPED');
assert.throws(() => parsePrepareArgs(['--dry-run']), /requires --version/);
assert.deepEqual(parsePrepareArgs(['--version', '1.0.63', '--dry-run', '--json']).nextVersion, '1.0.63');
assert.deepEqual(
  sanitizeGitEnvironment({ PATH: '/bin', GIT_DIR: '/tmp/a', Git_WORK_TREE: '/tmp/b', gIt_Config_Count: '1' }),
  { PATH: '/bin' },
  'Git environment filtering must be case-insensitive on Windows',
);

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-release-prepare-'));
await fs.mkdir(path.join(rootDir, 'appPackage'), { recursive: true });
await fs.writeFile(path.join(rootDir, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.0.62' }, null, 2) + '\n');
await fs.writeFile(path.join(rootDir, 'package-lock.json'), JSON.stringify({
  name: 'fixture',
  version: '1.0.62',
  lockfileVersion: 3,
  packages: { '': { name: 'fixture', version: '1.0.62' } },
}, null, 2) + '\n');
await fs.writeFile(path.join(rootDir, 'appPackage/manifest.json'), JSON.stringify({ id: 'fixture', version: '1.0.62' }, null, 2) + '\n');
runGit(rootDir, ['init', '-b', 'main']);
runGit(rootDir, ['add', 'package.json', 'package-lock.json', 'appPackage/manifest.json']);
runGit(rootDir, ['-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', 'commit', '-m', 'release 1.0.62']);

const before = await readReleaseVersionSet(rootDir);
assert.equal(before.currentVersion, '1.0.62');
const beforeBytes = Object.fromEntries(await Promise.all([
  'package.json',
  'package-lock.json',
  'appPackage/manifest.json',
].map(async (relativePath) => [relativePath, await fs.readFile(path.join(rootDir, relativePath), 'utf8')])));
const dryRun = await prepareReleaseVersion({ rootDir, nextVersion: '1.0.63', dryRun: true });
assert.equal(dryRun.status, 'DRY_RUN');
assert.equal((await readReleaseVersionSet(rootDir)).currentVersion, '1.0.62');

const prepared = await prepareReleaseVersion({ rootDir, nextVersion: '1.0.63' });
assert.equal(prepared.status, 'READY');
const after = await readReleaseVersionSet(rootDir);
assert.equal(after.currentVersion, '1.0.63');
assert.equal(after.versions.packageLockRoot, '1.0.63');
assert.equal(JSON.parse(await fs.readFile(path.join(rootDir, 'appPackage/manifest.json'), 'utf8')).id, 'fixture');
assert.equal(
  (await fs.readFile(path.join(rootDir, 'package.json'), 'utf8')).replace('1.0.63', '1.0.62'),
  beforeBytes['package.json'],
  'prepare must preserve package.json formatting and unrelated bytes',
);
assert.equal(
  (await fs.readFile(path.join(rootDir, 'appPackage/manifest.json'), 'utf8')).replace('1.0.63', '1.0.62'),
  beforeBytes['appPackage/manifest.json'],
  'prepare must preserve manifest formatting and unrelated bytes',
);
assert.equal(
  (await fs.readFile(path.join(rootDir, 'package-lock.json'), 'utf8')).replaceAll('1.0.63', '1.0.62'),
  beforeBytes['package-lock.json'],
  'prepare must preserve lockfile formatting and unrelated bytes',
);

await fs.writeFile(path.join(rootDir, 'package-lock.json'), JSON.stringify({
  ...after.documents.packageLock,
  version: '1.0.64',
}, null, 2) + '\n');
await assert.rejects(() => readReleaseVersionSet(rootDir), /must agree/);

const lineageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-release-lineage-'));
await fs.mkdir(path.join(lineageRoot, 'appPackage'), { recursive: true });
await writeFixtureVersion(lineageRoot, '1.0.100');
runGit(lineageRoot, ['init', '-b', 'main']);
runGit(lineageRoot, ['add', 'package.json', 'package-lock.json', 'appPackage/manifest.json']);
runGit(lineageRoot, ['-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', 'commit', '-m', 'release 1.0.100']);
runGit(lineageRoot, ['switch', '-c', 'release/reserved']);
await writeFixtureVersion(lineageRoot, '1.0.101');
runGit(lineageRoot, ['add', 'package.json', 'package-lock.json', 'appPackage/manifest.json']);
runGit(lineageRoot, ['-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', 'commit', '-m', 'reserve 1.0.101']);
runGit(lineageRoot, ['switch', 'main']);

const lineage = await readGitReleaseVersionLineage(lineageRoot);
assert.equal(lineage.highestVersion, '1.0.101');

const hostileGitEnvironment = {
  GIT_DIR: '/private/tmp/nonexistent-release-git-dir',
  GIT_WORK_TREE: '/private/tmp/nonexistent-release-worktree',
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'commit.gpgSign',
  GIT_CONFIG_VALUE_0: 'true',
};
const originalGitEnvironment = new Map(
  Object.keys(hostileGitEnvironment).map((key) => [key, process.env[key]]),
);
try {
  Object.assign(process.env, hostileGitEnvironment);
  const sanitizedLineage = await readGitReleaseVersionLineage(lineageRoot);
  assert.equal(sanitizedLineage.highestVersion, '1.0.101');
} finally {
  for (const [key, value] of originalGitEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

await assert.rejects(
  () => readGitReleaseVersionLineage(lineageRoot, {
    timeoutMs: 100,
    realpath: (filePath) => new Promise((resolve) => setTimeout(() => resolve(filePath), 500)),
  }),
  (error) => error.code === 'EGITLINEAGE' && /exceeded/.test(error.message),
  'canonical path resolution must share the bounded lineage deadline',
);

await assert.rejects(
  () => prepareReleaseVersion({ rootDir: lineageRoot, nextVersion: '1.0.101', dryRun: true }),
  (error) => error.code === 'EVERSIONRESERVED' && /1\.0\.101/.test(error.message),
  'release preparation must reject a version already assigned on another Git ref',
);

const collisionFree = await prepareReleaseVersion({ rootDir: lineageRoot, nextVersion: '1.0.102', dryRun: true });
assert.equal(collisionFree.highestGitVersion, '1.0.101');
assert.equal(collisionFree.highestGitCommit, lineage.highestCommit);

const nonGitRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-release-no-lineage-'));
await fs.mkdir(path.join(nonGitRoot, 'appPackage'), { recursive: true });
await writeFixtureVersion(nonGitRoot, '1.0.100');
await assert.rejects(
  () => prepareReleaseVersion({ rootDir: nonGitRoot, nextVersion: '1.0.102', dryRun: true }),
  (error) => error.code === 'EGITLINEAGE',
  'release preparation must fail closed when authoritative Git lineage is unavailable',
);

const mergedLineageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-release-merged-lineage-'));
await fs.mkdir(path.join(mergedLineageRoot, 'appPackage'), { recursive: true });
await writeFixtureVersion(mergedLineageRoot, '1.0.100');
runGit(mergedLineageRoot, ['init', '-b', 'main']);
runGit(mergedLineageRoot, ['add', 'package.json', 'package-lock.json', 'appPackage/manifest.json']);
runGit(mergedLineageRoot, ['-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', 'commit', '-m', 'release 1.0.100']);
runGit(mergedLineageRoot, ['switch', '-c', 'release/merged-reservation']);
await writeFixtureVersion(mergedLineageRoot, '1.0.105');
runGit(mergedLineageRoot, ['add', 'package.json', 'package-lock.json', 'appPackage/manifest.json']);
runGit(mergedLineageRoot, ['-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', 'commit', '-m', 'reserve 1.0.105']);
runGit(mergedLineageRoot, ['switch', 'main']);
await fs.writeFile(path.join(mergedLineageRoot, 'README.md'), 'main-line change\n');
runGit(mergedLineageRoot, ['add', 'README.md']);
runGit(mergedLineageRoot, ['-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', 'commit', '-m', 'main-line change']);
runGit(mergedLineageRoot, ['-c', 'user.name=Release Test', '-c', 'user.email=release-test@example.invalid', 'merge', '--strategy=ours', '--no-edit', 'release/merged-reservation']);
runGit(mergedLineageRoot, ['branch', '-D', 'release/merged-reservation']);

const mergedLineage = await readGitReleaseVersionLineage(mergedLineageRoot);
assert.equal(
  mergedLineage.highestVersion,
  '1.0.105',
  'lineage scan must retain versions reachable only through a TREESAME merge side-parent',
);

console.log('release-prepare-test: PASS');
