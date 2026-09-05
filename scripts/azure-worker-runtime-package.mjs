import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SHA256 = /^[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/u;
const TARGET = 'x86_64-unknown-linux-musl';
const RECEIPT_FILE = 'worker-runtime-receipt.json';
const MAX_RECEIPT_BYTES = 64 * 1024;
const TAR_BLOCK_BYTES = 512;

function fail(message) {
  throw new Error(message);
}

function parsePairs(argv, allowed, required = allowed) {
  if (argv.length % 2 !== 0) fail('arguments must be --name value pairs');
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(name)) fail(`unknown argument: ${name ?? '<missing>'}`);
    if (values.has(name)) fail(`duplicate argument: ${name}`);
    if (!value?.trim()) fail(`${name} must not be empty`);
    values.set(name, value);
  }
  for (const name of required) {
    if (!values.has(name)) fail(`${name} is required`);
  }
  return values;
}

function assertIdentity({ commit, codexPackageSha256, codexVersion, expectedNodeVersion }) {
  if (!COMMIT.test(commit)) fail('--commit must be a full lowercase Git commit OID');
  if (!SHA256.test(codexPackageSha256)) fail('--codex-package-sha256 must be a lowercase SHA-256');
  if (!VERSION.test(codexVersion)) fail('--codex-version is invalid');
  if (!VERSION.test(expectedNodeVersion)) fail('--expected-node-version is invalid');
}

function lstatRegular(filePath, label) {
  const stat = fs.lstatSync(filePath, { throwIfNoEntry: false });
  if (!stat) fail(`${label} is missing`);
  if (stat.isSymbolicLink()) fail(`${label} must not be a symbolic link`);
  if (!stat.isFile()) fail(`${label} must be a regular file`);
  return stat;
}

function readJsonObject(filePath, label) {
  const stat = lstatRegular(filePath, label);
  if (stat.size === 0 || stat.size > MAX_RECEIPT_BYTES) {
    fail(`${label} must be a non-empty JSON file smaller than 64 KiB`);
  }
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(`${label} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a JSON object`);
  return value;
}

async function sha256(filePath) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) digest.update(chunk);
  return digest.digest('hex');
}

function runVersion(executable, label) {
  const result = spawnSync(executable, ['--version'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
    timeout: 15_000,
  });
  if (result.error) fail(`${label} version check failed: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} version check failed: ${(result.stderr || result.stdout || '').trim()}`);
  return result.stdout.trim();
}

function ensureDirectory(directory, label) {
  const stat = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (!stat) fail(`${label} is missing`);
  if (stat.isSymbolicLink()) fail(`${label} must not be a symbolic link`);
  if (!stat.isDirectory()) fail(`${label} must be a directory`);
}

function collectRegularFiles(rootDirectory, label) {
  ensureDirectory(rootDirectory, label);
  const files = [];
  const visit = (directory, relativeDirectory = '') => {
    const names = fs.readdirSync(directory).sort((left, right) => left.localeCompare(right, 'en'));
    for (const name of names) {
      if (name === '.' || name === '..' || name.includes('/') || name.includes('\\')) fail(`${label} contains an unsafe path`);
      const source = path.join(directory, name);
      const relative = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      const stat = fs.lstatSync(source);
      if (stat.isSymbolicLink()) fail(`${label} contains a symbolic link: ${relative}`);
      if (stat.isDirectory()) {
        visit(source, relative);
        continue;
      }
      if (!stat.isFile()) fail(`${label} contains a non-regular entry: ${relative}`);
      files.push(relative);
    }
  };
  visit(rootDirectory);
  return files.sort((left, right) => left.localeCompare(right, 'en'));
}

function copyFile(source, destination, mode, label) {
  lstatRegular(source, label);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(destination, mode);
}

function copyTree(sourceRoot, destinationRoot, label, modeForPath) {
  const files = collectRegularFiles(sourceRoot, label);
  for (const relative of files) {
    copyFile(
      path.join(sourceRoot, ...relative.split('/')),
      path.join(destinationRoot, ...relative.split('/')),
      modeForPath(relative),
      `${label}/${relative}`,
    );
  }
  return files;
}

function writeField(header, offset, length, value, label) {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > length) fail(`${label} exceeds the ustar field limit`);
  bytes.copy(header, offset);
}

function writeOctal(header, offset, length, value, label) {
  const digits = value.toString(8);
  if (digits.length > length - 1) fail(`${label} exceeds the ustar numeric field limit`);
  writeField(header, offset, length, `${digits.padStart(length - 1, '0')}\0`, label);
}

function splitUstarPath(archivePath) {
  if (Buffer.byteLength(archivePath) <= 100) return { name: archivePath, prefix: '' };
  for (let index = archivePath.lastIndexOf('/'); index > 0; index = archivePath.lastIndexOf('/', index - 1)) {
    const prefix = archivePath.slice(0, index);
    const name = archivePath.slice(index + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
  }
  fail(`archive path exceeds the portable ustar limit: ${archivePath}`);
}

function createUstarHeader({ archivePath, mode, size, directory }) {
  const header = Buffer.alloc(TAR_BLOCK_BYTES);
  const { name, prefix } = splitUstarPath(archivePath);
  writeField(header, 0, 100, name, 'archive path name');
  writeOctal(header, 100, 8, mode, 'archive mode');
  writeOctal(header, 108, 8, 0, 'archive uid');
  writeOctal(header, 116, 8, 0, 'archive gid');
  writeOctal(header, 124, 12, directory ? 0 : size, 'archive size');
  writeOctal(header, 136, 12, 0, 'archive mtime');
  header.fill(0x20, 148, 156);
  header[156] = directory ? 0x35 : 0x30;
  writeField(header, 257, 6, 'ustar\0', 'archive magic');
  writeField(header, 263, 2, '00', 'archive version');
  writeOctal(header, 329, 8, 0, 'archive device major');
  writeOctal(header, 337, 8, 0, 'archive device minor');
  writeField(header, 345, 155, prefix, 'archive path prefix');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const checksumDigits = checksum.toString(8);
  if (checksumDigits.length > 6) fail('archive checksum exceeds the ustar field limit');
  writeField(header, 148, 8, `${checksumDigits.padStart(6, '0')}\0 `, 'archive checksum');
  return header;
}

function collectArchiveEntries(payload) {
  const entries = [];
  const visit = (directory, relativeDirectory = '') => {
    const names = fs.readdirSync(directory).sort((left, right) => left.localeCompare(right, 'en'));
    for (const name of names) {
      const source = path.join(directory, name);
      const relative = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      const stat = fs.lstatSync(source);
      if (stat.isSymbolicLink()) fail(`worker payload contains a symbolic link: ${relative}`);
      if (stat.isDirectory()) {
        entries.push({ source, relative, stat, directory: true });
        visit(source, relative);
        continue;
      }
      if (!stat.isFile()) fail(`worker payload contains a non-regular entry: ${relative}`);
      entries.push({ source, relative, stat, directory: false });
    }
  };
  visit(payload);
  return entries.sort((left, right) => left.relative.localeCompare(right.relative, 'en'));
}

function writeAll(handle, buffer, offset = 0, length = buffer.length - offset) {
  let totalWritten = 0;
  while (totalWritten < length) {
    const written = fs.writeSync(handle, buffer, offset + totalWritten, length - totalWritten);
    if (written === 0) fail('worker archive write made no forward progress');
    totalWritten += written;
  }
}

function writeDeterministicTar(payload, output) {
  const entries = collectArchiveEntries(payload);
  const outputHandle = fs.openSync(output, 'wx', 0o600);
  const copyBuffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (const entry of entries) {
      const archivePath = `./${entry.relative}${entry.directory ? '/' : ''}`;
      const mode = entry.directory ? 0o755 : entry.stat.mode & 0o777;
      writeAll(outputHandle, createUstarHeader({
        archivePath,
        mode,
        size: entry.stat.size,
        directory: entry.directory,
      }));
      if (entry.directory) continue;
      const inputHandle = fs.openSync(entry.source, 'r');
      let written = 0;
      try {
        while (written < entry.stat.size) {
          const bytesRead = fs.readSync(inputHandle, copyBuffer, 0, Math.min(copyBuffer.length, entry.stat.size - written), null);
          if (bytesRead === 0) fail(`worker payload changed while archiving: ${entry.relative}`);
          writeAll(outputHandle, copyBuffer, 0, bytesRead);
          written += bytesRead;
        }
      } finally {
        fs.closeSync(inputHandle);
      }
      const padding = (TAR_BLOCK_BYTES - (entry.stat.size % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES;
      if (padding > 0) writeAll(outputHandle, Buffer.alloc(padding));
    }
    writeAll(outputHandle, Buffer.alloc(TAR_BLOCK_BYTES * 2));
    fs.fsyncSync(outputHandle);
  } finally {
    fs.closeSync(outputHandle);
  }
  return entries.filter(({ directory }) => !directory).length;
}

function validateCodexReceipt(receipt, options, codexRuntime) {
  if (receipt.schemaVersion !== 1 || receipt.target !== TARGET) fail('Codex package receipt schema or target is invalid');
  if (receipt.version !== options.codexVersion) fail('Codex package receipt version mismatch');
  if (receipt.archiveSha256 !== options.codexPackageSha256) fail('Codex package receipt archive SHA-256 mismatch');
  if (!SHA256.test(receipt.codexBinSha256)) fail('Codex package receipt executable SHA-256 is invalid');
  if (!Array.isArray(receipt.files) || receipt.files.length === 0 || receipt.files.some((item) => typeof item !== 'string')) {
    fail('Codex package receipt files are invalid');
  }
  const actualFiles = collectRegularFiles(codexRuntime, 'Codex runtime');
  const expectedFiles = [...receipt.files].sort((left, right) => left.localeCompare(right, 'en'));
  if (new Set(expectedFiles).size !== expectedFiles.length || JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    fail('Codex runtime files do not match the authenticated package receipt');
  }
}

async function build(options) {
  assertIdentity(options);
  ensureDirectory(options.workerDist, 'worker dist');
  ensureDirectory(options.codexRuntime, 'Codex runtime');
  lstatRegular(options.nodeBin, 'Node executable');
  lstatRegular(options.installer, 'worker installer');
  lstatRegular(options.validator, 'worker manifest validator');
  if (fs.existsSync(options.outputDir)) fail('--output-dir must not already exist');

  const codexReceipt = readJsonObject(options.codexReceipt, 'Codex package receipt');
  validateCodexReceipt(codexReceipt, options, options.codexRuntime);
  const parent = path.dirname(options.outputDir);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporaryRoot = fs.mkdtempSync(path.join(parent, `.${path.basename(options.outputDir)}-`));
  const payload = path.join(temporaryRoot, 'payload');
  const resultDirectory = path.join(temporaryRoot, 'result');
  try {
    fs.mkdirSync(payload, { recursive: true, mode: 0o755 });
    fs.mkdirSync(resultDirectory, { mode: 0o700 });
    const workerFiles = copyTree(options.workerDist, path.join(payload, 'dist', 'worker'), 'worker dist', () => 0o400);
    for (const required of ['index.js', 'composition.js']) {
      if (!workerFiles.includes(required)) fail(`worker dist is missing ${required}`);
    }
    copyFile(options.nodeBin, path.join(payload, 'node', 'bin', 'node'), 0o555, 'Node executable');
    const stagedNode = path.join(payload, 'node', 'bin', 'node');
    const observedNodeVersion = runVersion(stagedNode, 'Node executable');
    if (observedNodeVersion !== `v${options.expectedNodeVersion}`) {
      fail(`Node version mismatch: expected v${options.expectedNodeVersion}, received ${observedNodeVersion || '<missing>'}`);
    }
    const nodeBinSha256 = await sha256(stagedNode);

    copyTree(options.codexRuntime, path.join(payload, 'codex-runtime'), 'Codex runtime', (relative) => (
      relative === 'codex-package.json' ? 0o400 : 0o500
    ));
    const stagedCodex = path.join(payload, 'codex-runtime', 'bin', 'codex');
    const codexBinSha256 = await sha256(stagedCodex);
    if (codexBinSha256 !== codexReceipt.codexBinSha256) fail('Codex executable SHA-256 mismatch after staging');
    const observedCodexVersion = runVersion(stagedCodex, 'Codex executable');
    if (observedCodexVersion !== `codex-cli ${options.codexVersion}`) {
      fail(`Codex version mismatch: expected codex-cli ${options.codexVersion}, received ${observedCodexVersion || '<missing>'}`);
    }

    copyFile(options.installer, path.join(payload, 'install-worker-runtime.sh'), 0o500, 'worker installer');
    copyFile(options.validator, path.join(payload, 'validate-worker-runtime-manifest.mjs'), 0o400, 'worker manifest validator');
    fs.writeFileSync(path.join(payload, 'manifest.json'), `${JSON.stringify({
      schemaVersion: 2,
      commit: options.commit,
      codexPackageVersion: options.codexVersion,
      codexPackageSha256: options.codexPackageSha256,
      codexBinSha256,
    })}\n`, { mode: 0o400, flag: 'wx' });

    const archiveFile = `worker-runtime-${options.commit}.tar`;
    const archive = path.join(resultDirectory, archiveFile);
    const fileCount = writeDeterministicTar(payload, archive);
    const archiveSha256 = await sha256(archive);
    const receipt = {
      schemaVersion: 1,
      kind: 'azure-worker-runtime-package',
      sourceCommit: options.commit,
      nodeVersion: observedNodeVersion,
      nodeBinSha256,
      codexPackageVersion: options.codexVersion,
      codexPackageSha256: options.codexPackageSha256,
      codexBinSha256,
      archiveFile,
      archiveSha256,
      fileCount,
    };
    fs.writeFileSync(path.join(resultDirectory, RECEIPT_FILE), `${JSON.stringify(receipt)}\n`, { mode: 0o400, flag: 'wx' });
    fs.renameSync(resultDirectory, options.outputDir);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

async function verify(options) {
  assertIdentity(options);
  lstatRegular(options.archive, 'worker runtime archive');
  const receipt = readJsonObject(options.receipt, 'worker runtime receipt');
  if (receipt.schemaVersion !== 1 || receipt.kind !== 'azure-worker-runtime-package') fail('worker runtime receipt schema is invalid');
  if (receipt.sourceCommit !== options.commit) fail('worker runtime receipt commit mismatch');
  if (receipt.nodeVersion !== `v${options.expectedNodeVersion}`) fail('worker runtime receipt Node version mismatch');
  if (!SHA256.test(receipt.nodeBinSha256)) fail('worker runtime receipt Node digest is invalid');
  if (receipt.codexPackageVersion !== options.codexVersion) fail('worker runtime receipt Codex version mismatch');
  if (receipt.codexPackageSha256 !== options.codexPackageSha256) fail('worker runtime receipt Codex package digest mismatch');
  if (!SHA256.test(receipt.codexBinSha256)) fail('worker runtime receipt Codex executable digest is invalid');
  const expectedArchiveFile = `worker-runtime-${options.commit}.tar`;
  if (receipt.archiveFile !== expectedArchiveFile || path.basename(options.archive) !== expectedArchiveFile) {
    fail('worker runtime receipt archive filename mismatch');
  }
  if (!SHA256.test(receipt.archiveSha256)) fail('worker runtime receipt archive digest is invalid');
  if (!Number.isSafeInteger(receipt.fileCount) || receipt.fileCount < 1) fail('worker runtime receipt file count is invalid');
  if (await sha256(options.archive) !== receipt.archiveSha256) fail('worker runtime archive SHA-256 mismatch');
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

function buildOptions(argv) {
  const allowed = new Set([
    '--worker-dist', '--node-bin', '--codex-runtime', '--codex-receipt', '--codex-package-sha256',
    '--codex-version', '--commit', '--installer', '--validator', '--expected-node-version', '--output-dir',
  ]);
  const values = parsePairs(argv, allowed);
  return {
    workerDist: path.resolve(values.get('--worker-dist')),
    nodeBin: path.resolve(values.get('--node-bin')),
    codexRuntime: path.resolve(values.get('--codex-runtime')),
    codexReceipt: path.resolve(values.get('--codex-receipt')),
    codexPackageSha256: values.get('--codex-package-sha256'),
    codexVersion: values.get('--codex-version'),
    commit: values.get('--commit'),
    installer: path.resolve(values.get('--installer')),
    validator: path.resolve(values.get('--validator')),
    expectedNodeVersion: values.get('--expected-node-version'),
    outputDir: path.resolve(values.get('--output-dir')),
  };
}

function verifyOptions(argv) {
  const allowed = new Set([
    '--archive', '--receipt', '--commit', '--codex-package-sha256', '--codex-version', '--expected-node-version',
  ]);
  const values = parsePairs(argv, allowed);
  return {
    archive: path.resolve(values.get('--archive')),
    receipt: path.resolve(values.get('--receipt')),
    commit: values.get('--commit'),
    codexPackageSha256: values.get('--codex-package-sha256'),
    codexVersion: values.get('--codex-version'),
    expectedNodeVersion: values.get('--expected-node-version'),
  };
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (command === 'build') return build(buildOptions(argv));
  if (command === 'verify') return verify(verifyOptions(argv));
  fail('usage: azure-worker-runtime-package.mjs <build|verify> [--name value ...]');
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
