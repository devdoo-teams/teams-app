import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const TARGET = 'x86_64-unknown-linux-musl';
const REQUIRED_FILES = [
  'bin/codex',
  'bin/codex-code-mode-host',
  'codex-package.json',
  'codex-path/rg',
  'codex-resources/bwrap',
];
const ALLOWED_ROOTS = ['bin', 'codex-path', 'codex-resources'];
const MAX_ARCHIVE_MEMBERS = 10_000;
const SHA256 = /^[0-9a-f]{64}$/u;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/u;

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || value === undefined) fail('arguments must be --name value pairs');
    if (values.has(name)) fail(`duplicate argument: ${name}`);
    values.set(name, value);
  }

  const allowed = new Set(['--archive', '--archive-sha256', '--expected-version', '--output']);
  for (const name of values.keys()) {
    if (!allowed.has(name)) fail(`unknown argument: ${name}`);
  }
  for (const name of allowed) {
    if (!values.get(name)?.trim()) fail(`${name} is required`);
  }

  return {
    archive: path.resolve(values.get('--archive')),
    archiveSha256: values.get('--archive-sha256'),
    expectedVersion: values.get('--expected-version'),
    output: path.resolve(values.get('--output')),
  };
}

async function sha256(filePath) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) digest.update(chunk);
  return digest.digest('hex');
}

function normalizeMember(member) {
  if (member === '.' || member === './') return null;
  if ([...member].some((character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127)) {
    fail(`unsafe archive member: ${JSON.stringify(member)}`);
  }
  let normalized = member;
  while (normalized.startsWith('./')) normalized = normalized.slice(2);
  if (path.posix.isAbsolute(normalized)) fail(`unsafe archive member: ${member}`);
  const isDirectory = normalized.endsWith('/');
  normalized = normalized.replace(/\/+$/u, '');
  if (!normalized) return null;
  const segments = normalized.split('/');
  if (segments.includes('.') || segments.includes('..') || segments.includes('') || normalized.includes('\\')) {
    fail(`unsafe archive member: ${member}`);
  }
  return { relativePath: normalized, isDirectory };
}

function assertAllowedMember(relativePath, isDirectory) {
  if (relativePath === 'codex-package.json') {
    if (isDirectory) fail('Codex package manifest must be a regular file');
    return;
  }
  for (const root of ALLOWED_ROOTS) {
    if (relativePath === root) {
      if (!isDirectory) fail(`Codex package root must be a directory: ${root}`);
      return;
    }
    if (relativePath.startsWith(`${root}/`)) return;
  }
  fail(`unexpected Codex package member: ${relativePath}`);
}

function inspectArchive(archive) {
  const listed = spawnSync('tar', ['-tzf', archive], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000,
  });
  if (listed.error) fail(`could not inspect Codex package: ${listed.error.message}`);
  if (listed.status !== 0) fail(`could not inspect Codex package: ${(listed.stderr || '').trim()}`);

  const listedMembers = listed.stdout.split('\n').filter(Boolean);
  if (listedMembers.length > MAX_ARCHIVE_MEMBERS) fail(`Codex package exceeds ${MAX_ARCHIVE_MEMBERS} members`);
  const members = new Map();
  for (const member of listedMembers) {
    const normalized = normalizeMember(member);
    if (normalized === null) continue;
    assertAllowedMember(normalized.relativePath, normalized.isDirectory);
    if (members.has(normalized.relativePath)) fail(`duplicate Codex package member: ${normalized.relativePath}`);
    members.set(normalized.relativePath, { member, ...normalized });
  }

  for (const required of REQUIRED_FILES) {
    const match = members.get(required);
    if (!match || match.isDirectory) fail(`Codex package must contain exactly one ${required}`);
  }
  return [...members.values()]
    .filter(({ isDirectory }) => !isDirectory)
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'));
}

function extractMember(archive, member, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const output = fs.openSync(destination, 'wx', 0o400);
  let extracted;
  try {
    extracted = spawnSync('tar', ['-xOzf', archive, member], {
      encoding: 'utf8',
      stdio: ['ignore', output, 'pipe'],
      maxBuffer: 1024 * 1024,
      timeout: 120_000,
    });
  } finally {
    fs.closeSync(output);
  }
  if (extracted.error || extracted.status !== 0 || fs.statSync(destination).size === 0) {
    fs.rmSync(destination, { force: true });
    if (extracted.error) fail(`could not extract ${member}: ${extracted.error.message}`);
    if (extracted.status !== 0) fail(`could not extract ${member}: ${(extracted.stderr ?? '').trim()}`);
    fail(`Codex package member is empty: ${member}`);
  }
}

function readCodexVersion(codexPath, expectedVersion) {
  const checked = spawnSync(codexPath, ['--version'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
    timeout: 15_000,
  });
  if (checked.error) fail(`Codex version check failed: ${checked.error.message}`);
  if (checked.status !== 0) fail(`Codex version check failed: ${(checked.stderr || checked.stdout || '').trim()}`);
  const version = checked.stdout.trim().match(/([0-9][0-9A-Za-z.+-]*)$/u)?.[1];
  if (version !== expectedVersion) fail(`Codex version mismatch: expected ${expectedVersion}, received ${version ?? '<missing>'}`);
  return version;
}

function validatePackageManifest(manifestPath, expectedVersion) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail(`Codex package manifest is invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('Codex package manifest must be a JSON object');
  }

  const expected = {
    layoutVersion: 1,
    version: expectedVersion,
    target: TARGET,
    variant: 'codex',
    entrypoint: 'bin/codex',
    resourcesDir: 'codex-resources',
    pathDir: 'codex-path',
  };
  for (const [name, value] of Object.entries(expected)) {
    if (manifest[name] !== value) {
      fail(`Codex package manifest ${name} mismatch: expected ${value}, received ${String(manifest[name] ?? '<missing>')}`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!SHA256.test(options.archiveSha256)) fail('--archive-sha256 must be a lowercase SHA-256');
  if (!VERSION.test(options.expectedVersion)) fail('--expected-version is invalid');
  if (!fs.statSync(options.archive, { throwIfNoEntry: false })?.isFile()) fail('--archive must reference a regular file');
  if (fs.existsSync(options.output)) fail('--output must not already exist');

  const actualArchiveSha256 = await sha256(options.archive);
  if (actualArchiveSha256 !== options.archiveSha256) fail('Codex package archive SHA-256 mismatch');
  const members = inspectArchive(options.archive);

  const parent = path.dirname(options.output);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const stage = fs.mkdtempSync(path.join(parent, '.codex-package-'));
  let installed = false;
  try {
    for (const { relativePath, member } of members) {
      const destination = path.join(stage, relativePath);
      extractMember(options.archive, member, destination);
      fs.chmodSync(destination, relativePath === 'codex-package.json' ? 0o400 : 0o500);
    }

    validatePackageManifest(path.join(stage, 'codex-package.json'), options.expectedVersion);
    const codexPath = path.join(stage, 'bin', 'codex');
    const version = readCodexVersion(codexPath, options.expectedVersion);
    const codexBinSha256 = await sha256(codexPath);
    fs.renameSync(stage, options.output);
    installed = true;
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      target: TARGET,
      version,
      archiveSha256: actualArchiveSha256,
      codexBinSha256,
      files: members.map(({ relativePath }) => relativePath),
    })}\n`);
  } finally {
    if (!installed) fs.rmSync(stage, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
