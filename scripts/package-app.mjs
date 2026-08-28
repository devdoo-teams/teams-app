import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertCleanTrackedWorktreeForFileProvider,
  resolvePinnedCommitOid,
} from './fileprovider-git-clean.mjs';

const required = ['TEAMS_APP_ID', 'BOT_ID', 'TAB_DOMAIN', 'CLIENT_ID', 'APPLICATION_ID_URI'];
const missing = required.filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const root = path.resolve('.');
const sourceDir = path.join(root, 'appPackage');
const buildDir = path.join(sourceDir, 'build');
const sourceCommit = process.env.TEAMS_SOURCE_COMMIT ?? resolvePinnedCommitOid(root);
const sourceVerification = assertCleanTrackedWorktreeForFileProvider(root, {
  commitOid: sourceCommit,
});
if (sourceVerification.commitOid !== sourceCommit) {
  throw new Error('Teams package source verification changed the pinned Git OID');
}
const gitEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
const readCommittedFile = (relativePath, encoding) => execFileSync(
  'git',
  ['show', `${sourceCommit}:${relativePath}`],
  {
    cwd: root,
    env: gitEnv,
    ...(encoding ? { encoding } : {}),
    timeout: 10_000,
    killSignal: 'SIGKILL',
  },
);
const template = readCommittedFile('appPackage/manifest.json', 'utf8');
const manifest = template
  .replaceAll('${{TEAMS_APP_ID}}', process.env.TEAMS_APP_ID)
  .replaceAll('${{BOT_ID}}', process.env.BOT_ID)
  .replaceAll('${{TAB_DOMAIN}}', process.env.TAB_DOMAIN)
  .replaceAll('${{CLIENT_ID}}', process.env.CLIENT_ID)
  .replaceAll('${{APPLICATION_ID_URI}}', process.env.APPLICATION_ID_URI);

let stagingDir = fs.mkdtempSync(path.join(sourceDir, '.teams-sdk-build-'));
let packagedManifest;
try {
  fs.writeFileSync(path.join(stagingDir, 'manifest.json'), manifest);
  fs.writeFileSync(path.join(stagingDir, 'color.png'), readCommittedFile('appPackage/color.png'));
  fs.writeFileSync(path.join(stagingDir, 'outline.png'), readCommittedFile('appPackage/outline.png'));

  const packagedFiles = ['manifest.json', 'color.png', 'outline.png'];
  const archiveTimestamp = new Date('2000-01-01T00:00:00.000Z');
  for (const file of packagedFiles) {
    fs.utimesSync(path.join(stagingDir, file), archiveTimestamp, archiveTimestamp);
  }

  const stagedZipPath = path.join(stagingDir, 'teams-sdk-mvp.zip');
  execFileSync('zip', ['-X', '-q', stagedZipPath, ...packagedFiles], {
    cwd: stagingDir,
    // zip serializes DOS timestamps in the process timezone. Pin it here so
    // the same committed inputs produce the same archive bytes on a Seoul
    // workstation and a UTC CI runner.
    env: { ...process.env, TZ: 'UTC' },
  });

  packagedManifest = JSON.parse(execFileSync('unzip', ['-p', stagedZipPath, 'manifest.json'], { encoding: 'utf8' }));
  if (packagedManifest.version !== JSON.parse(manifest).version) {
    throw new Error('Packaged manifest version does not match the source manifest.');
  }
  if (packagedManifest.devicePermissions?.includes('geolocation') !== true) {
    throw new Error('Packaged manifest must declare geolocation device permission.');
  }
  if (JSON.stringify(packagedManifest).includes('${{')) {
    throw new Error('Packaged manifest still contains unresolved environment placeholders.');
  }

  // Keep the previous verified package intact until every staged validation
  // above has passed. Rename within the same parent so the final replacement
  // is atomic and a failed swap can restore the previous build directory.
  const backupDir = path.join(sourceDir, `.teams-sdk-build-backup-${process.pid}-${Date.now()}`);
  let previousBuildMoved = false;
  let newBuildMoved = false;
  try {
    if (fs.existsSync(buildDir)) {
      fs.renameSync(buildDir, backupDir);
      previousBuildMoved = true;
    }
    fs.renameSync(stagingDir, buildDir);
    stagingDir = undefined;
    newBuildMoved = true;
    if (previousBuildMoved) fs.rmSync(backupDir, { recursive: true, force: true });
  } catch (error) {
    if (newBuildMoved && fs.existsSync(buildDir)) fs.rmSync(buildDir, { recursive: true, force: true });
    if (previousBuildMoved && fs.existsSync(backupDir) && !fs.existsSync(buildDir)) fs.renameSync(backupDir, buildDir);
    throw error;
  }

  const zipPath = path.join(buildDir, 'teams-sdk-mvp.zip');
  console.log(`Teams app package created from ${sourceCommit}: ${zipPath} (manifest v${packagedManifest.version}, geolocation permission verified)`);
} finally {
  if (stagingDir && fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
}
