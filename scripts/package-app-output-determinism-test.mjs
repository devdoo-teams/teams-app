import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageScript = path.join(root, 'scripts', 'package-app.mjs');
const packagePath = path.join(root, 'appPackage', 'build', 'teams-sdk-mvp.zip');

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function packageOnce() {
  execFileSync(process.execPath, [packageScript], {
    cwd: root,
    env: process.env,
    stdio: 'pipe',
    encoding: 'utf8',
    timeout: 300_000,
    killSignal: 'SIGKILL',
  });
  return fs.readFileSync(packagePath);
}

const first = packageOnce();
const second = packageOnce();
assert.equal(
  sha256(second),
  sha256(first),
  'the exact appPackage/build ZIP must remain deterministic across consecutive builds',
);

const manifest = JSON.parse(execFileSync('unzip', ['-p', packagePath, 'manifest.json'], { encoding: 'utf8' }));
assert.equal(manifest.devicePermissions?.includes('geolocation') ?? false, false, 'packaged manifest must not request removed geolocation');
assert.equal(JSON.stringify(manifest).includes('${{'), false, 'packaged manifest contains unresolved placeholders');

console.log(`PASS: exact Teams package is deterministic (${sha256(second)}) and agent-only permissions are verified`);
