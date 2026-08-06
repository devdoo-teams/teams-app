import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const required = ['TEAMS_APP_ID', 'BOT_ID', 'TAB_DOMAIN', 'CLIENT_ID', 'APPLICATION_ID_URI'];
const missing = required.filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const root = path.resolve('.');
const sourceDir = path.join(root, 'appPackage');
const buildDir = path.join(sourceDir, 'build');
const template = fs.readFileSync(path.join(sourceDir, 'manifest.json'), 'utf8');
const manifest = template
  .replaceAll('${{TEAMS_APP_ID}}', process.env.TEAMS_APP_ID)
  .replaceAll('${{BOT_ID}}', process.env.BOT_ID)
  .replaceAll('${{TAB_DOMAIN}}', process.env.TAB_DOMAIN)
  .replaceAll('${{CLIENT_ID}}', process.env.CLIENT_ID)
  .replaceAll('${{APPLICATION_ID_URI}}', process.env.APPLICATION_ID_URI);

fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(path.join(buildDir, 'manifest.json'), manifest);
fs.copyFileSync(path.join(sourceDir, 'color.png'), path.join(buildDir, 'color.png'));
fs.copyFileSync(path.join(sourceDir, 'outline.png'), path.join(buildDir, 'outline.png'));

const zipPath = path.join(buildDir, 'teams-sdk-mvp.zip');
execFileSync('zip', ['-q', '-r', zipPath, 'manifest.json', 'color.png', 'outline.png'], { cwd: buildDir });

const packagedManifest = JSON.parse(execFileSync('unzip', ['-p', zipPath, 'manifest.json'], { encoding: 'utf8' }));
if (packagedManifest.version !== JSON.parse(manifest).version) {
  throw new Error('Packaged manifest version does not match the source manifest.');
}
if (packagedManifest.devicePermissions?.includes('geolocation') !== true) {
  throw new Error('Packaged manifest must declare geolocation device permission.');
}
if (JSON.stringify(packagedManifest).includes('${{')) {
  throw new Error('Packaged manifest still contains unresolved environment placeholders.');
}

console.log(`Teams app package created: ${zipPath} (manifest v${packagedManifest.version}, geolocation permission verified)`);
