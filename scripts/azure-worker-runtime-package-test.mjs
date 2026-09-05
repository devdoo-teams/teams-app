import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const packager = path.join(root, 'scripts', 'azure-worker-runtime-package.mjs');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'teamsapp-worker-runtime-package-'));
const commit = '1'.repeat(40);
const codexPackageSha256 = '2'.repeat(64);
const codexVersion = '0.153.4';
const nodeVersion = '24.19.0';

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function writeExecutable(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, { mode: 0o755 });
}

function run(args) {
  return spawnSync(process.execPath, [packager, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  });
}

try {
  const workerDist = path.join(fixture, 'dist', 'worker');
  fs.mkdirSync(workerDist, { recursive: true });
  fs.writeFileSync(path.join(workerDist, 'index.js'), 'process.exit(0);\n');
  fs.writeFileSync(path.join(workerDist, 'composition.js'), 'export const state = {};\n');

  const nodeToolcache = path.join(fixture, 'toolcache', 'node', nodeVersion, 'x64');
  const nodeBin = path.join(nodeToolcache, 'bin', 'node');
  writeExecutable(nodeBin, `#!/bin/sh\nif [ "\${1:-}" = "--version" ]; then printf 'v${nodeVersion}\\n'; else exit 0; fi\n`);
  fs.symlinkSync('/usr/local/bin/now', path.join(nodeToolcache, 'bin', 'now'));

  const codexRuntime = path.join(fixture, 'codex-runtime');
  writeExecutable(path.join(codexRuntime, 'bin', 'codex'), `#!/bin/sh\nprintf 'codex-cli ${codexVersion}\\n'\n`);
  writeExecutable(path.join(codexRuntime, 'bin', 'codex-code-mode-host'), '#!/bin/sh\nexit 0\n');
  writeExecutable(path.join(codexRuntime, 'codex-path', 'rg'), '#!/bin/sh\nexit 0\n');
  writeExecutable(path.join(codexRuntime, 'codex-resources', 'bwrap'), '#!/bin/sh\nexit 0\n');
  writeExecutable(path.join(codexRuntime, 'codex-resources', 'zsh', 'bin', 'zsh'), '#!/bin/sh\nexit 0\n');
  fs.writeFileSync(path.join(codexRuntime, 'codex-package.json'), `${JSON.stringify({
    layoutVersion: 1,
    version: codexVersion,
    target: 'x86_64-unknown-linux-musl',
    variant: 'codex',
    entrypoint: 'bin/codex',
    resourcesDir: 'codex-resources',
    pathDir: 'codex-path',
  })}\n`);
  const codexFiles = [
    'bin/codex',
    'bin/codex-code-mode-host',
    'codex-package.json',
    'codex-path/rg',
    'codex-resources/bwrap',
    'codex-resources/zsh/bin/zsh',
  ];
  const codexReceipt = path.join(fixture, 'codex-package-receipt.json');
  fs.writeFileSync(codexReceipt, `${JSON.stringify({
    schemaVersion: 1,
    target: 'x86_64-unknown-linux-musl',
    version: codexVersion,
    archiveSha256: codexPackageSha256,
    codexBinSha256: sha256(path.join(codexRuntime, 'bin', 'codex')),
    files: codexFiles,
  })}\n`);

  const installer = path.join(root, 'infra', 'azure', 'scripts', 'install-worker-runtime.sh');
  const validator = path.join(root, 'infra', 'azure', 'scripts', 'validate-worker-runtime-manifest.mjs');
  const buildArgs = (outputDir) => [
    'build',
    '--worker-dist', workerDist,
    '--node-bin', nodeBin,
    '--codex-runtime', codexRuntime,
    '--codex-receipt', codexReceipt,
    '--codex-package-sha256', codexPackageSha256,
    '--codex-version', codexVersion,
    '--commit', commit,
    '--installer', installer,
    '--validator', validator,
    '--expected-node-version', nodeVersion,
    '--output-dir', outputDir,
  ];

  const outputOne = path.join(fixture, 'output-one');
  const builtOne = run(buildArgs(outputOne));
  assert.equal(builtOne.status, 0, builtOne.stderr || builtOne.stdout);
  const receiptOnePath = path.join(outputOne, 'worker-runtime-receipt.json');
  const receiptOne = JSON.parse(fs.readFileSync(receiptOnePath, 'utf8'));
  assert.deepEqual(receiptOne, {
    schemaVersion: 1,
    kind: 'azure-worker-runtime-package',
    sourceCommit: commit,
    nodeVersion: `v${nodeVersion}`,
    nodeBinSha256: sha256(nodeBin),
    codexPackageVersion: codexVersion,
    codexPackageSha256,
    codexBinSha256: sha256(path.join(codexRuntime, 'bin', 'codex')),
    archiveFile: `worker-runtime-${commit}.tar`,
    archiveSha256: receiptOne.archiveSha256,
    fileCount: receiptOne.fileCount,
  });
  assert.match(receiptOne.archiveSha256, /^[0-9a-f]{64}$/u);
  assert.ok(receiptOne.fileCount >= 12);

  const archiveOne = path.join(outputOne, receiptOne.archiveFile);
  assert.equal(sha256(archiveOne), receiptOne.archiveSha256);
  const listed = spawnSync('tar', ['-tf', archiveOne], { encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  assert.match(listed.stdout, /^\.\/node\/bin\/node$/m);
  assert.match(listed.stdout, /^\.\/dist\/worker\/index\.js$/m);
  assert.match(listed.stdout, /^\.\/install-worker-runtime\.sh$/m);
  assert.doesNotMatch(listed.stdout, /(?:^|\/)now$|node_modules|toolcache/m, 'package must not traverse sibling toolcache files or links');

  const extracted = path.join(fixture, 'extracted');
  fs.mkdirSync(extracted);
  const extraction = spawnSync('tar', ['-xf', archiveOne, '-C', extracted], { encoding: 'utf8' });
  assert.equal(extraction.status, 0, extraction.stderr);
  const packagedNode = path.join(extracted, 'node', 'bin', 'node');
  assert.equal(spawnSync(packagedNode, ['--version'], { encoding: 'utf8' }).stdout.trim(), `v${nodeVersion}`);

  const outputTwo = path.join(fixture, 'output-two');
  const builtTwo = run(buildArgs(outputTwo));
  assert.equal(builtTwo.status, 0, builtTwo.stderr || builtTwo.stdout);
  const receiptTwo = JSON.parse(fs.readFileSync(path.join(outputTwo, 'worker-runtime-receipt.json'), 'utf8'));
  assert.equal(receiptTwo.archiveSha256, receiptOne.archiveSha256, 'same inputs must create the same archive digest');

  const verified = run([
    'verify',
    '--archive', archiveOne,
    '--receipt', receiptOnePath,
    '--commit', commit,
    '--codex-package-sha256', codexPackageSha256,
    '--codex-version', codexVersion,
    '--expected-node-version', nodeVersion,
  ]);
  assert.equal(verified.status, 0, verified.stderr || verified.stdout);

  const alteredReceiptPath = path.join(fixture, 'altered-worker-runtime-receipt.json');
  fs.writeFileSync(alteredReceiptPath, `${JSON.stringify({
    ...receiptTwo,
    sourceCommit: '3'.repeat(40),
  })}\n`);
  const alteredReceipt = run([
    'verify',
    '--archive', path.join(outputTwo, receiptTwo.archiveFile),
    '--receipt', alteredReceiptPath,
    '--commit', commit,
    '--codex-package-sha256', codexPackageSha256,
    '--codex-version', codexVersion,
    '--expected-node-version', nodeVersion,
  ]);
  assert.notEqual(alteredReceipt.status, 0, 'receipt identity mismatch must fail closed before Azure mutation');
  assert.match(alteredReceipt.stderr, /receipt commit mismatch/i);

  fs.appendFileSync(archiveOne, 'tamper');
  const tampered = run([
    'verify',
    '--archive', archiveOne,
    '--receipt', receiptOnePath,
    '--commit', commit,
    '--codex-package-sha256', codexPackageSha256,
    '--codex-version', codexVersion,
    '--expected-node-version', nodeVersion,
  ]);
  assert.notEqual(tampered.status, 0, 'tampered current-run artifact must fail closed before Azure mutation');
  assert.match(tampered.stderr, /archive SHA-256 mismatch/i);

  const unsafeWorkerDist = path.join(fixture, 'unsafe-dist');
  fs.cpSync(workerDist, unsafeWorkerDist, { recursive: true });
  fs.symlinkSync('/etc/passwd', path.join(unsafeWorkerDist, 'unexpected-link'));
  const unsafeOutput = path.join(fixture, 'unsafe-output');
  const unsafe = run([
    ...buildArgs(unsafeOutput).map((value, index, values) => (
      index > 0 && values[index - 1] === '--worker-dist' ? unsafeWorkerDist : value
    )),
  ]);
  assert.notEqual(unsafe.status, 0, 'runtime packaging must reject symlinks inside copied payloads');
  assert.match(unsafe.stderr, /symbolic link/i);
  assert.equal(fs.existsSync(unsafeOutput), false, 'failed packaging must not publish a partial artifact');

  const occupiedOutput = path.join(fixture, 'occupied-output');
  fs.mkdirSync(occupiedOutput);
  const occupiedMarker = path.join(occupiedOutput, 'owned-by-another-process');
  fs.writeFileSync(occupiedMarker, 'preserve\n');
  const occupied = run(buildArgs(occupiedOutput));
  assert.notEqual(occupied.status, 0, 'runtime packaging must not replace an existing output directory');
  assert.match(occupied.stderr, /output-dir must not already exist/i);
  assert.equal(fs.readFileSync(occupiedMarker, 'utf8'), 'preserve\n', 'failed packaging must not remove another process output');

  console.log('PASS: worker runtime packaging copies only the selected Node executable, rejects payload links and identity drift, preserves occupied outputs, is deterministic, and verifies the immutable artifact.');
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
