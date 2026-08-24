import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-package-determinism-'));
const fixturePackage = path.join(fixtureRoot, 'appPackage');
fs.mkdirSync(fixturePackage, { recursive: true });

fs.copyFileSync(path.join(root, 'appPackage', 'manifest.json'), path.join(fixturePackage, 'manifest.json'));
fs.copyFileSync(path.join(root, 'appPackage', 'color.png'), path.join(fixturePackage, 'color.png'));
fs.copyFileSync(path.join(root, 'appPackage', 'outline.png'), path.join(fixturePackage, 'outline.png'));

const runGit = (args) => execFileSync('git', args, {
  cwd: fixtureRoot,
  encoding: 'utf8',
  env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  timeout: 5_000,
  killSignal: 'SIGKILL',
}).trim();
runGit(['init', '-q']);
runGit(['config', 'user.name', 'Teams Package Test']);
runGit(['config', 'user.email', 'teams-package@example.invalid']);
runGit(['add', '--', 'appPackage/manifest.json', 'appPackage/color.png', 'appPackage/outline.png']);
runGit(['commit', '-q', '-m', 'package source']);
const sourceCommit = runGit(['rev-parse', '--verify', 'HEAD^{commit}']);

const env = {
  ...process.env,
  TEAMS_APP_ID: 'e915b402-eed4-4ee2-ba1f-c31d75c870a5',
  BOT_ID: '32127cdd-f19d-4fce-95c9-431e27cca739',
  TAB_DOMAIN: 'runtime.example.com',
  CLIENT_ID: '32127cdd-f19d-4fce-95c9-431e27cca739',
  APPLICATION_ID_URI: 'api://runtime.example.com/botid-32127cdd-f19d-4fce-95c9-431e27cca739',
  TEAMS_SOURCE_COMMIT: sourceCommit,
};
const script = path.join(root, 'scripts', 'package-app.mjs');
const packagePath = path.join(fixturePackage, 'build', 'teams-sdk-mvp.zip');
const build = () => {
  const output = execFileSync(process.execPath, [script], { cwd: fixtureRoot, env, stdio: 'pipe', encoding: 'utf8' });
  return {
    output,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(packagePath)).digest('hex'),
  };
};

try {
  const first = build();
  assert.match(first.output, new RegExp(sourceCommit), 'package evidence must report the explicit source OID');
  runGit(['commit', '--allow-empty', '-q', '-m', 'move HEAD without changing package inputs']);
  assert.notEqual(runGit(['rev-parse', '--verify', 'HEAD^{commit}']), sourceCommit);
  await new Promise((resolve) => setTimeout(resolve, 2_200));
  const second = build();
  assert.equal(second.sha256, first.sha256, 'identical pinned Teams app inputs must produce an identical ZIP SHA across rebuilds');
  console.log('PASS: Teams app ZIP packaging is deterministic across rebuilds');
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
