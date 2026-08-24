import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { verifyTeamsRegistration } from './teams-registration.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-registration-test-'));
const expectedPackagePath = path.join(root, 'expected.zip');
const packageBytes = Buffer.from('deterministic registered package fixture');
await fs.writeFile(expectedPackagePath, packageBytes);
const expectedPackageSha256 = crypto.createHash('sha256').update(packageBytes).digest('hex');

function createCli({ version = '1.0.88', endpoint = 'https://runtime.example.com/api/messages' } = {}) {
  return async (args) => {
    if (args[0] === 'app' && args[1] === 'get') {
      return { stdout: JSON.stringify({ appId: 'app-1', version, endpoint }), stderr: '' };
    }
    if (args[0] === 'app' && args[1] === 'package' && args[2] === 'download') {
      const outputIndex = args.indexOf('--output');
      await fs.copyFile(expectedPackagePath, args[outputIndex + 1]);
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
