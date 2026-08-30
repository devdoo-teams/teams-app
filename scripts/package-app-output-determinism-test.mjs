import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageScript = path.join(root, 'scripts', 'package-app.mjs');
const packagePath = path.join(root, 'appPackage', 'build', 'teams-sdk-mvp.zip');
const sourceCommit = execFileSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
  cwd: root,
  encoding: 'utf8',
  env: { PATH: process.env.PATH ?? '' },
  timeout: 10_000,
  killSignal: 'SIGKILL',
}).trim();

// Keep this test independent from a deployer's credentials and runtime
// configuration. The production package command must still require its real
// environment; only the test fixture gets synthetic, contract-valid values.
const packageEnv = {
  PATH: process.env.PATH ?? '',
  TZ: 'UTC',
  TEAMS_APP_ID: 'e915b402-eed4-4ee2-ba1f-c31d75c870a5',
  BOT_ID: '32127cdd-f19d-4fce-95c9-431e27cca739',
  TAB_DOMAIN: 'runtime.example.com',
  CLIENT_ID: '32127cdd-f19d-4fce-95c9-431e27cca739',
  APPLICATION_ID_URI: 'api://runtime.example.com/botid-32127cdd-f19d-4fce-95c9-431e27cca739',
  TEAMS_SOURCE_COMMIT: sourceCommit,
};

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function packageOnce() {
  execFileSync(process.execPath, [packageScript], {
    cwd: root,
    env: packageEnv,
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
assert.equal(manifest.devicePermissions?.includes('geolocation'), true, 'packaged manifest must declare geolocation');
assert.equal(JSON.stringify(manifest).includes('${{'), false, 'packaged manifest contains unresolved placeholders');

console.log(`PASS: exact Teams package is deterministic (${sha256(second)}) and manifest permissions are verified`);
