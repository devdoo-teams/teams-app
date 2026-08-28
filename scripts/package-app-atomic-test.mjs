import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-package-atomic-'));
const fixturePackage = path.join(fixtureRoot, 'appPackage');
const fixtureBuild = path.join(fixturePackage, 'build');
const failingBin = path.join(fixtureRoot, 'bin');
const packageScript = path.join(root, 'scripts', 'package-app.mjs');

function runGit(args) {
  return execFileSync('git', args, {
    cwd: fixtureRoot,
    encoding: 'utf8',
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    timeout: 5_000,
    killSignal: 'SIGKILL',
  }).trim();
}

fs.mkdirSync(fixturePackage, { recursive: true });
fs.copyFileSync(path.join(root, 'appPackage', 'manifest.json'), path.join(fixturePackage, 'manifest.json'));
fs.copyFileSync(path.join(root, 'appPackage', 'color.png'), path.join(fixturePackage, 'color.png'));
fs.copyFileSync(path.join(root, 'appPackage', 'outline.png'), path.join(fixturePackage, 'outline.png'));
fs.mkdirSync(fixtureBuild, { recursive: true });
const previousZip = path.join(fixtureBuild, 'teams-sdk-mvp.zip');
const previousBytes = Buffer.from('previous-verified-package');
fs.writeFileSync(previousZip, previousBytes);

runGit(['init', '-q']);
runGit(['config', 'user.name', 'Teams Package Atomic Test']);
runGit(['config', 'user.email', 'teams-package-atomic@example.invalid']);
runGit(['add', '--', 'appPackage/manifest.json', 'appPackage/color.png', 'appPackage/outline.png']);
runGit(['commit', '-q', '-m', 'package source']);
const sourceCommit = runGit(['rev-parse', '--verify', 'HEAD^{commit}']);

fs.mkdirSync(failingBin, { recursive: true });
const failingZip = path.join(failingBin, 'zip');
fs.writeFileSync(failingZip, '#!/bin/sh\necho injected zip failure >&2\nexit 73\n');
fs.chmodSync(failingZip, 0o755);

const env = {
  ...process.env,
  PATH: `${failingBin}${path.delimiter}${process.env.PATH ?? ''}`,
  TEAMS_APP_ID: 'e915b402-eed4-4ee2-ba1f-c31d75c870a5',
  BOT_ID: '32127cdd-f19d-4fce-95c9-431e27cca739',
  TAB_DOMAIN: 'runtime.example.com',
  CLIENT_ID: '32127cdd-f19d-4fce-95c9-431e27cca739',
  APPLICATION_ID_URI: 'api://runtime.example.com/botid-32127cdd-f19d-4fce-95c9-431e27cca739',
  TEAMS_SOURCE_COMMIT: sourceCommit,
};

try {
  assert.throws(
    () => execFileSync(process.execPath, [packageScript], {
      cwd: fixtureRoot,
      env,
      stdio: 'pipe',
      encoding: 'utf8',
    }),
    /injected zip failure|exit code|status 73/i,
    'an injected package failure must be surfaced',
  );
  assert.equal(
    fs.existsSync(previousZip),
    true,
    'a failed package attempt must preserve the previous verified ZIP',
  );
  assert.equal(fs.readFileSync(previousZip).toString(), previousBytes.toString());
  console.log('PASS: failed Teams app packaging preserves the previous verified ZIP');
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
}
