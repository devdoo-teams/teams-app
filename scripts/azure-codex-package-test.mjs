import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const preparer = path.join(root, 'scripts', 'azure-codex-package.mjs');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'teamsapp-codex-package-'));
const version = '0.153.4';
const packageManifest = {
  layoutVersion: 1,
  version,
  target: 'x86_64-unknown-linux-musl',
  variant: 'codex',
  entrypoint: 'bin/codex',
  resourcesDir: 'codex-resources',
  pathDir: 'codex-path',
};
const files = {
  'bin/codex': `#!/bin/sh\nprintf "codex-cli ${version}\\n"\n`,
  'bin/codex-code-mode-host': '#!/bin/sh\nexit 0\n',
  'codex-path/rg': '#!/bin/sh\nexit 0\n',
  'codex-resources/bwrap': '#!/bin/sh\nexit 0\n',
  'codex-resources/zsh/bin/zsh': '#!/bin/sh\nexit 0\n',
  'codex-package.json': `${JSON.stringify(packageManifest)}\n`,
};

function unsafeArchiveTransformArgs(versionOutput) {
  if (/\bGNU tar\b/u.test(versionOutput)) {
    return ['--absolute-names', '--transform=s,^escape$,../escape,'];
  }
  if (/\bbsdtar\b|\blibarchive\b/u.test(versionOutput)) {
    return ['-s', ',^escape$,../escape,'];
  }
  throw new Error(`unsupported tar implementation: ${versionOutput.split('\n', 1)[0] || '<empty>'}`);
}

assert.deepEqual(
  unsafeArchiveTransformArgs('tar (GNU tar) 1.35'),
  ['--absolute-names', '--transform=s,^escape$,../escape,'],
  'GNU tar must use its documented create-mode name transformation options',
);
assert.deepEqual(
  unsafeArchiveTransformArgs('bsdtar 3.5.3 - libarchive 3.7.4'),
  ['-s', ',^escape$,../escape,'],
  'bsdtar must use its documented -s substitution option',
);
assert.throws(
  () => unsafeArchiveTransformArgs('unknown tar 1.0'),
  /unsupported tar implementation/i,
  'unknown tar implementations must fail closed',
);

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function createArchive(name, { omit, overrides = {}, unsafeMember = false } = {}) {
  const payload = path.join(fixture, `payload-${name}`);
  const archive = path.join(fixture, `${name}.tar.gz`);
  for (const [relativePath, defaultContents] of Object.entries(files)) {
    if (relativePath === omit) continue;
    const contents = overrides[relativePath] ?? defaultContents;
    const absolutePath = path.join(payload, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, contents, { mode: relativePath.endsWith('.json') ? 0o600 : 0o755 });
  }

  let args = ['-czf', archive, '-C', payload, '.'];
  if (unsafeMember) {
    fs.writeFileSync(path.join(payload, 'escape'), 'must not escape\n');
    const versionResult = spawnSync('tar', ['--version'], { encoding: 'utf8' });
    assert.equal(versionResult.status, 0, versionResult.stderr || versionResult.stdout);
    args = [
      '-czf', archive,
      ...unsafeArchiveTransformArgs(`${versionResult.stdout}\n${versionResult.stderr}`),
      '-C', payload,
      'bin', 'codex-path', 'codex-resources', 'codex-package.json', 'escape',
    ];
  }
  const packed = spawnSync('tar', args, { encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr || packed.stdout);
  return { archive, archiveSha256: sha256(archive) };
}

function prepare({ archive, archiveSha256, expectedVersion = version, output }) {
  return spawnSync(process.execPath, [
    preparer,
    '--archive', archive,
    '--archive-sha256', archiveSha256,
    '--expected-version', expectedVersion,
    '--output', output,
  ], { cwd: root, encoding: 'utf8' });
}

function assertRejected(result, pattern, output) {
  assert.notEqual(result.status, 0, 'unsafe or inconsistent package input must fail closed');
  assert.match(result.stderr, pattern);
  assert.equal(fs.existsSync(output), false, 'failed preparation must not publish a partial output tree');
}

try {
  const valid = createArchive('valid');
  const output = path.join(fixture, 'prepared');
  const prepared = prepare({ ...valid, output });

  assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout);
  const receipt = JSON.parse(prepared.stdout);
  assert.deepEqual(receipt, {
    schemaVersion: 1,
    target: 'x86_64-unknown-linux-musl',
    version,
    archiveSha256: valid.archiveSha256,
    codexBinSha256: crypto.createHash('sha256').update(files['bin/codex']).digest('hex'),
    files: [
      'bin/codex',
      'bin/codex-code-mode-host',
      'codex-package.json',
      'codex-path/rg',
      'codex-resources/bwrap',
      'codex-resources/zsh/bin/zsh',
    ],
  });

  for (const relativePath of receipt.files) {
    assert.ok(fs.statSync(path.join(output, relativePath)).isFile(), `${relativePath} must be a regular file`);
    assert.equal(
      fs.statSync(path.join(output, relativePath)).mode & 0o777,
      relativePath === 'codex-package.json' ? 0o400 : 0o500,
      `${relativePath} must have a deterministic owner-only mode`,
    );
  }
  assert.equal(spawnSync(path.join(output, 'bin', 'codex'), ['--version'], { encoding: 'utf8' }).stdout.trim(), `codex-cli ${version}`);

  const wrongDigestOutput = path.join(fixture, 'wrong-digest');
  assertRejected(
    prepare({ ...valid, archiveSha256: 'f'.repeat(64), output: wrongDigestOutput }),
    /archive SHA-256 mismatch/i,
    wrongDigestOutput,
  );

  const missing = createArchive('missing-bwrap', { omit: 'codex-resources/bwrap' });
  const missingOutput = path.join(fixture, 'missing-output');
  assertRejected(
    prepare({ ...missing, output: missingOutput }),
    /exactly one codex-resources\/bwrap/i,
    missingOutput,
  );

  const wrongVersionOutput = path.join(fixture, 'wrong-version');
  assertRejected(
    prepare({ ...valid, expectedVersion: '0.153.5', output: wrongVersionOutput }),
    /version mismatch.*0\.153\.5.*0\.153\.4/i,
    wrongVersionOutput,
  );

  const wrongTarget = createArchive('wrong-target', {
    overrides: {
      'codex-package.json': `${JSON.stringify({
        ...packageManifest,
        target: 'aarch64-unknown-linux-musl',
      })}\n`,
    },
  });
  const wrongTargetOutput = path.join(fixture, 'wrong-target-output');
  assertRejected(
    prepare({ ...wrongTarget, output: wrongTargetOutput }),
    /package manifest.*target/i,
    wrongTargetOutput,
  );

  const unsafe = createArchive('unsafe-member', { unsafeMember: true });
  const unsafeOutput = path.join(fixture, 'unsafe-output');
  assertRejected(
    prepare({ ...unsafe, output: unsafeOutput }),
    /unsafe archive member.*\.\.\/escape/i,
    unsafeOutput,
  );

  const existingOutput = path.join(fixture, 'existing-output');
  fs.mkdirSync(existingOutput);
  const sentinel = path.join(existingOutput, 'preserve.txt');
  fs.writeFileSync(sentinel, 'preserve\n');
  const existing = prepare({ ...valid, output: existingOutput });
  assert.notEqual(existing.status, 0, 'existing output must not be overwritten');
  assert.match(existing.stderr, /output must not already exist/i);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserve\n');

  assert.deepEqual(
    fs.readdirSync(fixture).filter((entry) => entry.startsWith('.codex-package-')),
    [],
    'all private staging directories must be removed after success or failure',
  );

  console.log('PASS: Codex Linux package preparation verifies layout, version, independent digests, path safety, atomic cleanup, and no-clobber output.');
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
