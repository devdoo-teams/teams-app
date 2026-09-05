import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const installer = path.join(root, 'infra', 'azure', 'scripts', 'install-worker-runtime.sh');
const manifestValidator = path.join(root, 'infra', 'azure', 'scripts', 'validate-worker-runtime-manifest.mjs');
assert.ok(fs.existsSync(installer), 'worker archive installer must exist');
assert.ok(fs.existsSync(manifestValidator), 'worker runtime manifest validator must exist');

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'teamsapp-worker-bootstrap-'));
try {
  const payload = path.join(fixture, 'payload');
  fs.mkdirSync(path.join(payload, 'dist', 'worker'), { recursive: true });
  fs.mkdirSync(path.join(payload, 'node', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(payload, 'codex-runtime', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(payload, 'codex-runtime', 'codex-path'), { recursive: true });
  fs.mkdirSync(path.join(payload, 'codex-runtime', 'codex-resources'), { recursive: true });
  fs.mkdirSync(path.join(payload, 'codex-runtime', 'codex-resources', 'zsh', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(payload, 'dist', 'worker', 'index.js'), 'process.exit(0);\n');
  fs.writeFileSync(path.join(payload, 'dist', 'worker', 'composition.js'), 'export const state = {};\n');
  fs.writeFileSync(
    path.join(payload, 'node', 'bin', 'node'),
    `#!/bin/sh\nif [ "\${1:-}" = "--version" ]; then\n  printf "v24.19.0\\n"\nelse\n  exec ${JSON.stringify(process.execPath)} "$@"\nfi\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(payload, 'codex-runtime', 'bin', 'codex'), '#!/bin/sh\nprintf "codex-cli 0.153.4\\n"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(payload, 'codex-runtime', 'bin', 'codex-code-mode-host'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(payload, 'codex-runtime', 'codex-path', 'rg'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(payload, 'codex-runtime', 'codex-resources', 'bwrap'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(payload, 'codex-runtime', 'codex-resources', 'zsh', 'bin', 'zsh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(payload, 'codex-runtime', 'codex-package.json'), `${JSON.stringify({
    layoutVersion: 1,
    version: '0.153.4',
    target: 'x86_64-unknown-linux-musl',
    variant: 'codex',
    entrypoint: 'bin/codex',
    resourcesDir: 'codex-resources',
    pathDir: 'codex-path',
  })}\n`);
  fs.copyFileSync(manifestValidator, path.join(payload, 'validate-worker-runtime-manifest.mjs'));
  const commit = 'a'.repeat(40);
  const codexDigest = crypto.createHash('sha256').update(fs.readFileSync(path.join(payload, 'codex-runtime', 'bin', 'codex'))).digest('hex');
  const codexPackageDigest = 'c'.repeat(64);
  fs.writeFileSync(path.join(payload, 'manifest.json'), `${JSON.stringify({
    schemaVersion: 2,
    commit,
    codexPackageVersion: '0.153.4',
    codexPackageSha256: codexPackageDigest,
    codexBinSha256: codexDigest,
  })}\n`);
  const archive = path.join(fixture, 'worker-runtime.tar');
  const tar = spawnSync('tar', ['-cf', archive, '-C', payload, '.'], { encoding: 'utf8' });
  assert.equal(tar.status, 0, tar.stderr);
  const archiveDigest = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  const targetRoot = path.join(fixture, 'root');
  const systemctlLog = path.join(fixture, 'systemctl.log');
  const fakeBin = path.join(fixture, 'fake-bin');
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(path.join(fakeBin, 'systemctl'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${systemctlLog}"\n`, { mode: 0o755 });

  const args = [
    installer,
    '--archive', archive,
    '--archive-sha256', archiveDigest,
    '--codex-sha256', codexDigest,
    '--commit', commit,
    '--root', targetRoot,
    '--azure-client-id', '11111111-1111-1111-1111-111111111111',
    '--queue-endpoint', 'https://example.queue.core.windows.net/agent-dispatch',
    '--poison-queue-endpoint', 'https://example.queue.core.windows.net/agent-dispatch-poison',
    '--cosmos-endpoint', 'https://example.documents.azure.com/',
    '--cosmos-database', 'teamsapp',
    '--cosmos-container', 'runtime-records',
  ];
  const installed = spawnSync('bash', args, { encoding: 'utf8', env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` } });
  assert.equal(installed.status, 0, installed.stderr || installed.stdout);
  const current = path.join(targetRoot, 'opt', 'teamsapp', 'current');
  assert.equal(fs.realpathSync(current), fs.realpathSync(path.join(targetRoot, 'opt', 'teamsapp', 'releases', commit)));
  assert.ok(fs.statSync(path.join(current, 'dist', 'worker', 'index.js')).isFile());
  assert.ok(fs.statSync(path.join(current, 'dist', 'worker', 'composition.js')).isFile());
  for (const relativePath of [
    'codex-runtime/bin/codex',
    'codex-runtime/bin/codex-code-mode-host',
    'codex-runtime/codex-path/rg',
    'codex-runtime/codex-resources/bwrap',
    'codex-runtime/codex-resources/zsh/bin/zsh',
    'codex-runtime/codex-package.json',
  ]) {
    assert.ok(fs.statSync(path.join(current, relativePath)).isFile(), `installed worker must preserve ${relativePath}`);
  }
  assert.equal(fs.statSync(path.join(current, 'codex-runtime', 'bin', 'codex')).mode & 0o777, 0o500);
  assert.equal(fs.statSync(path.join(current, 'codex-runtime', 'bin', 'codex-code-mode-host')).mode & 0o777, 0o500);
  assert.equal(fs.statSync(path.join(current, 'codex-runtime', 'codex-path', 'rg')).mode & 0o777, 0o500);
  assert.equal(fs.statSync(path.join(current, 'codex-runtime', 'codex-resources', 'bwrap')).mode & 0o777, 0o500);
  assert.equal(fs.statSync(path.join(current, 'codex-runtime', 'codex-resources', 'zsh', 'bin', 'zsh')).mode & 0o777, 0o500);
  const envPath = path.join(targetRoot, 'etc', 'teamsapp', 'worker.env');
  assert.equal(fs.statSync(envPath).mode & 0o777, 0o600, 'worker environment file must be owner-only');
  assert.doesNotMatch(fs.readFileSync(envPath, 'utf8'), /token|password|accountkey|sas=/i, 'worker environment must not embed secrets');
  assert.match(fs.readFileSync(envPath, 'utf8'), /AGENT_CODEX_HOME=\/var\/lib\/teamsapp\/codex-home/);
  assert.match(fs.readFileSync(envPath, 'utf8'), /CODEX_BIN=\/opt\/teamsapp\/current\/codex-runtime\/bin\/codex/);
  assert.doesNotMatch(fs.readFileSync(envPath, 'utf8'), /CODEX_BIN=\/opt\/teamsapp\/current\/bin\/codex/);
  assert.doesNotMatch(fs.readFileSync(envPath, 'utf8'), /TEAMS_WORKER_EXECUTION_MODE=/,
    'bootstrap must not override the immutable per-task execution mode');
  assert.equal(fs.statSync(path.join(targetRoot, 'var', 'lib', 'teamsapp', 'workspace')).mode & 0o777, 0o700);
  assert.match(fs.readFileSync(systemctlLog, 'utf8'), /daemon-reload/);
  assert.match(fs.readFileSync(systemctlLog, 'utf8'), /enable --now teamsapp-worker\.service/);

  const rejectedArgs = [...args];
  rejectedArgs[rejectedArgs.indexOf('--archive-sha256') + 1] = 'f'.repeat(64);
  const rejected = spawnSync('bash', rejectedArgs, {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
  });
  assert.notEqual(rejected.status, 0, 'installer must reject an archive that does not match the expected immutable digest');
  assert.match(rejected.stderr, /archive SHA-256 mismatch/i);

  console.log('PASS: worker bootstrap verifies immutable archive and Codex digests, installs owner-only configuration, and enables the service.');
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
