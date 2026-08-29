import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  captureRuntimeClosure,
  createRuntimeDependencyStagingPlan,
  ensureFileProviderRuntimeDependencies,
  prepareRuntimeDependencyStaging,
  verifyRuntimeClosure,
} from './fileprovider-runtime-deps.mjs';

assert.equal(typeof ensureFileProviderRuntimeDependencies, 'function');
assert.equal(typeof createRuntimeDependencyStagingPlan, 'function');
assert.equal(typeof prepareRuntimeDependencyStaging, 'function');
assert.equal(typeof captureRuntimeClosure, 'function');
assert.equal(typeof verifyRuntimeClosure, 'function');

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-fileprovider-runtime-test-'));
try {
  const fakeBin = path.join(fixtureRoot, 'bin');
  const failingBin = path.join(fixtureRoot, 'failing-bin');
  const projectRoot = path.join(fixtureRoot, 'project');
  const cacheRoot = path.join(fixtureRoot, 'runtime-dependency-cache');
  const failingCacheRoot = path.join(fixtureRoot, 'failing-runtime-dependency-cache');
  const invocationPath = path.join(fixtureRoot, 'npm-invocation.json');
  const invocationCountPath = path.join(fixtureRoot, 'npm-invocation-count');
  const invocationLockPath = path.join(fixtureRoot, 'npm-package-lock.json');
  fs.mkdirSync(fakeBin);
  fs.mkdirSync(failingBin);
  fs.mkdirSync(projectRoot);
  fs.writeFileSync(path.join(projectRoot, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n');
  fs.writeFileSync(path.join(projectRoot, 'package-lock.json'), '{"name":"fixture","version":"1.0.0","lockfileVersion":3,"packages":{}}\n');
  fs.writeFileSync(path.join(fakeBin, 'npm'), `#!/bin/sh\ncount=0\nif [ -f "${invocationCountPath}" ]; then count=$(cat "${invocationCountPath}"); fi\ncount=$((count + 1))\nprintf '%s\\n' "$count" > "${invocationCountPath}"\nprintf '%s\\n' "$PWD" "$@" > "${invocationPath}"\ncp package-lock.json "${invocationLockPath}"\nmkdir -p node_modules/fixture\nprintf 'export default 1;\\n' > node_modules/fixture/index.js\n`);
  fs.chmodSync(path.join(fakeBin, 'npm'), 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${fakeBin}${path.delimiter}${previousPath}`;
  try {
    const nodeModulesRoot = await ensureFileProviderRuntimeDependencies(projectRoot, { cacheRoot });
    assert.equal(fs.statSync(nodeModulesRoot).isDirectory(), true);
    const reusedNodeModulesRoot = await ensureFileProviderRuntimeDependencies(projectRoot, { cacheRoot });
    assert.equal(reusedNodeModulesRoot, nodeModulesRoot, 'identical dependency inputs must reuse one stable cache root');
    assert.equal(fs.readFileSync(invocationCountPath, 'utf8').trim(), '1', 'reusing a complete cache must not rerun npm ci');
    assert.deepEqual(
      fs.readdirSync(cacheRoot).filter((name) => name.startsWith('.stage-')),
      [],
      'completed dependency staging must not leave transient stage directories',
    );
    const invocation = fs.readFileSync(invocationPath, 'utf8').trim().split('\n');
    assert.deepEqual(invocation.slice(1), [
      'ci',
      '--omit=dev',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ]);
    assert.equal(
      fs.readFileSync(invocationLockPath, 'utf8'),
      fs.readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8'),
    );
  } finally {
    process.env.PATH = previousPath;
  }

  fs.writeFileSync(path.join(failingBin, 'npm'), '#!/bin/sh\nexit 23\n');
  fs.chmodSync(path.join(failingBin, 'npm'), 0o755);
  process.env.PATH = `${failingBin}${path.delimiter}${previousPath}`;
  try {
    await assert.rejects(
      () => ensureFileProviderRuntimeDependencies(projectRoot, { cacheRoot: failingCacheRoot }),
      (error) => error?.status === 23,
    );
    assert.deepEqual(
      fs.readdirSync(failingCacheRoot).filter((name) => name.startsWith('.stage-')),
      [],
      'failed dependency staging must remove its transient stage directory',
    );
  } finally {
    process.env.PATH = previousPath;
  }
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('PASS: legacy FileProvider runtime dependencies keep their API and expose the pinned migration contract');
