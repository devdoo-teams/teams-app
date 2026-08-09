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

const env = {
  ...process.env,
  TEAMS_APP_ID: 'e915b402-eed4-4ee2-ba1f-c31d75c870a5',
  BOT_ID: '32127cdd-f19d-4fce-95c9-431e27cca739',
  TAB_DOMAIN: 'runtime.example.com',
  CLIENT_ID: '32127cdd-f19d-4fce-95c9-431e27cca739',
  APPLICATION_ID_URI: 'api://runtime.example.com/botid-32127cdd-f19d-4fce-95c9-431e27cca739',
};
const script = path.join(root, 'scripts', 'package-app.mjs');
const packagePath = path.join(fixturePackage, 'build', 'teams-sdk-mvp.zip');
const build = () => {
  execFileSync(process.execPath, [script], { cwd: fixtureRoot, env, stdio: 'pipe' });
  return crypto.createHash('sha256').update(fs.readFileSync(packagePath)).digest('hex');
};

try {
  const first = build();
  await new Promise((resolve) => setTimeout(resolve, 2_200));
  const second = build();
  assert.equal(second, first, 'identical Teams app inputs must produce an identical ZIP SHA across rebuilds');
  console.log('PASS: Teams app ZIP packaging is deterministic across rebuilds');
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
