import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { verifyTeamsRegistration } from './teams-registration.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-registration-test-'));
const expectedPackagePath = path.join(root, 'expected.zip');
const expectedPackageDir = path.join(root, 'expected-package');
await fs.mkdir(expectedPackageDir);
await fs.writeFile(
  path.join(expectedPackageDir, 'manifest.json'),
  JSON.stringify({ manifestVersion: '1.25', version: '1.0.88', id: 'app-1' }),
);
await fs.writeFile(path.join(expectedPackageDir, 'color.png'), Buffer.from('deterministic icon bytes'));
execFileSync('zip', ['-X', '-q', expectedPackagePath, 'manifest.json', 'color.png'], { cwd: expectedPackageDir });
const packageBytes = await fs.readFile(expectedPackagePath);
const expectedPackageSha256 = crypto.createHash('sha256').update(packageBytes).digest('hex');

function createCli({
  version = '1.0.88',
  endpoint = 'https://runtime.example.com/api/messages',
  registeredPackagePath = expectedPackagePath,
} = {}) {
  return async (args) => {
    if (args[0] === 'app' && args[1] === 'get') {
      return { stdout: JSON.stringify({ appId: 'app-1', version, endpoint }), stderr: '' };
    }
    if (args[0] === 'app' && args[1] === 'package' && args[2] === 'download') {
      const outputIndex = args.indexOf('--output');
      await fs.copyFile(registeredPackagePath, args[outputIndex + 1]);
      return { stdout: 'Package saved', stderr: '' };
    }
    throw new Error(`unexpected CLI args: ${args.join(' ')}`);
  };
}

const verified = await verifyTeamsRegistration({
  appId: 'app-1',
  expectedVersion: '1.0.88',
  expectedEndpoint: 'https://runtime.example.com/api/messages',
  expectedPackagePath,
  expectedPackageSha256,
  runCli: createCli(),
  now: new Date('2026-08-20T10:00:00.000Z'),
});
assert.equal(verified.status, 'VERIFIED');
assert.equal(verified.appId, 'app-1');
assert.equal(verified.version, '1.0.88');
assert.equal(verified.endpoint, 'https://runtime.example.com/api/messages');
assert.equal(verified.packageSha256, expectedPackageSha256);

const normalizedPackageRoot = await fs.mkdtemp(path.join(root, 'normalized-package-'));
const candidatePackageDir = path.join(normalizedPackageRoot, 'candidate');
const registeredPackageDir = path.join(normalizedPackageRoot, 'registered');
await fs.mkdir(candidatePackageDir);
await fs.mkdir(registeredPackageDir);
const candidateManifest = {
  manifestVersion: '1.25',
  version: '1.0.89',
  id: 'app-1',
  name: { short: 'Example' },
  bots: [{
    botId: 'bot-1',
    scopes: ['personal', 'team', 'groupChat'],
    supportsFiles: false,
    commandLists: [{ scopes: ['personal', 'team', 'groupChat'], commands: [] }],
  }],
};
const registeredManifest = {
  ...candidateManifest,
  bots: [{
    ...candidateManifest.bots[0],
    scopes: ['groupChat', 'personal', 'team'],
    supportsCalling: false,
    supportsVideo: false,
    commandLists: [{ scopes: ['groupChat', 'personal', 'team'], commands: [] }],
  }],
};
for (const [directory, manifest] of [
  [candidatePackageDir, candidateManifest],
  [registeredPackageDir, registeredManifest],
]) {
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  await fs.writeFile(path.join(directory, 'color.png'), Buffer.from('same icon bytes'));
}
const normalizedCandidateZip = path.join(normalizedPackageRoot, 'candidate.zip');
const normalizedRegisteredZip = path.join(normalizedPackageRoot, 'registered.zip');
execFileSync('zip', ['-X', '-q', normalizedCandidateZip, 'manifest.json', 'color.png'], { cwd: candidatePackageDir });
execFileSync('zip', ['-X', '-q', normalizedRegisteredZip, 'manifest.json', 'color.png'], { cwd: registeredPackageDir });
const normalizedCandidateBytes = await fs.readFile(normalizedCandidateZip);
const normalizedCandidateSha256 = crypto.createHash('sha256').update(normalizedCandidateBytes).digest('hex');
const normalizedRegisteredBytes = await fs.readFile(normalizedRegisteredZip);
const normalizedRegisteredSha256 = crypto.createHash('sha256').update(normalizedRegisteredBytes).digest('hex');
assert.notEqual(normalizedCandidateSha256, normalizedRegisteredSha256);

const normalizedVerified = await verifyTeamsRegistration({
  appId: 'app-1',
  expectedVersion: '1.0.89',
  expectedEndpoint: 'https://runtime.example.com/api/messages',
  expectedPackagePath: normalizedCandidateZip,
  expectedPackageSha256: normalizedCandidateSha256,
  runCli: createCli({ version: '1.0.89', registeredPackagePath: normalizedRegisteredZip }),
});
assert.equal(normalizedVerified.status, 'VERIFIED');
assert.equal(normalizedVerified.packageSha256, normalizedCandidateSha256);
assert.equal(normalizedVerified.registeredPackageSha256, normalizedRegisteredSha256);
assert.equal(normalizedVerified.packageComparison, 'manifest-normalized-assets-exact');

await assert.rejects(
  () => verifyTeamsRegistration({
    appId: 'app-1',
    expectedVersion: '1.0.88',
    expectedEndpoint: 'https://runtime.example.com/api/messages',
    expectedPackagePath,
    expectedPackageSha256,
    runCli: createCli({ version: '1.0.76' }),
  }),
  (error) => error?.code === 'ETEAMSREGISTRATIONMISMATCH'
    && /version/.test(error.message)
    && /1\.0\.76/.test(error.message),
  'a registered older app must block release handoff',
);

console.log('teams-registration-test: PASS');
