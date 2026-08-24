import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  assertReleaseVersionBumped,
  compareReleaseVersions,
  parsePrepareArgs,
  parseReleaseVersion,
  prepareReleaseVersion,
  readReleaseVersionSet,
} from './release-prepare.mjs';

assert.equal(parseReleaseVersion('1.2.3'), '1.2.3');
assert.equal(compareReleaseVersions('1.0.10', '1.0.9'), 1);
assert.equal(compareReleaseVersions('1.0.9', '1.0.10'), -1);
assert.deepEqual(assertReleaseVersionBumped('1.0.62', '1.0.63'), { current: '1.0.62', next: '1.0.63' });
assert.throws(() => parseReleaseVersion('1.0'), /stable X\.Y\.Z/);
assert.throws(() => assertReleaseVersionBumped('1.0.62', '1.0.62'), (error) => error.code === 'EVERSIONNOTBUMPED');
assert.throws(() => parsePrepareArgs(['--dry-run']), /requires --version/);
assert.deepEqual(parsePrepareArgs(['--version', '1.0.63', '--dry-run', '--json']).nextVersion, '1.0.63');

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

console.log('release-prepare-test: PASS');
