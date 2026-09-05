import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'teamsapp-azure-release-receipt-'));
const validator = path.join(root, 'scripts', 'azure-release-input.mjs');

const receipt = {
  schemaVersion: 1,
  source: 'github-actions',
  commit: 'a'.repeat(40),
  version: '1.0.100',
  image: 'ghcr.io/devdoo-teams/teams-app',
  imageDigest: `sha256:${'b'.repeat(64)}`,
  teamsPackageSha256: 'c'.repeat(64),
  clientBundleSha256: 'd'.repeat(64),
  serverBundleSha256: 'e'.repeat(64),
};

function writeFixture(name, value) {
  const fixturePath = path.join(fixtureDirectory, name);
  fs.writeFileSync(fixturePath, `${JSON.stringify(value, null, 2)}\n`);
  return fixturePath;
}

function validate(name, value, ...args) {
  return spawnSync(process.execPath, [validator, ...args, writeFixture(name, value)], {
    cwd: root,
    encoding: 'utf8',
  });
}

try {
  const valid = validate('valid.json', receipt, '--json');
  assert.equal(valid.status, 0, valid.stderr || valid.stdout);
  assert.deepEqual(JSON.parse(valid.stdout), receipt, 'the validator must preserve the immutable GitHub receipt exactly');

  const mutableImage = validate('mutable-image.json', { ...receipt, imageDigest: 'latest' });
  assert.notEqual(mutableImage.status, 0, 'a tag or other mutable image reference must be rejected');
  assert.match(`${mutableImage.stdout}\n${mutableImage.stderr}`, /imageDigest/i);

  const missingClientDigest = { ...receipt };
  delete missingClientDigest.clientBundleSha256;
  const missingDigest = validate('missing-client-digest.json', missingClientDigest);
  assert.notEqual(missingDigest.status, 0, 'the handoff must bind the exact client bundle digest');
  assert.match(`${missingDigest.stdout}\n${missingDigest.stderr}`, /clientBundleSha256/);

  const secretBearing = validate('secret-bearing.json', { ...receipt, connectionString: 'do-not-accept-secrets' });
  assert.notEqual(secretBearing.status, 0, 'a release handoff must fail closed if it contains an unexpected secret-bearing field');
  assert.match(`${secretBearing.stdout}\n${secretBearing.stderr}`, /unexpected/i);

  console.log('PASS: Azure release receipt accepts one complete immutable GitHub handoff and rejects mutable, incomplete, or secret-bearing input.');
} finally {
  fs.rmSync(fixtureDirectory, { recursive: true, force: true });
}
