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
  const projectRoot = path.join(fixtureRoot, 'project');
  const invocationPath = path.join(fixtureRoot, 'npm-invocation.json');
  fs.mkdirSync(fakeBin);
  fs.mkdirSync(projectRoot);
  fs.writeFileSync(path.join(projectRoot, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n');
  fs.writeFileSync(path.join(projectRoot, 'package-lock.json'), '{"name":"fixture","version":"1.0.0","lockfileVersion":3,"packages":{}}\n');
  fs.writeFileSync(path.join(fakeBin, 'npm'), `#!/bin/sh\nprintf '%s\\n' "$PWD" "$@" > "${invocationPath}"\nmkdir -p node_modules/fixture\nprintf 'export default 1;\\n' > node_modules/fixture/index.js\n`);
  fs.chmodSync(path.join(fakeBin, 'npm'), 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${fakeBin}${path.delimiter}${previousPath}`;
  try {
    const nodeModulesRoot = await ensureFileProviderRuntimeDependencies(projectRoot);
    assert.equal(fs.statSync(nodeModulesRoot).isDirectory(), true);
    const invocation = fs.readFileSync(invocationPath, 'utf8').trim().split('\n');
    assert.deepEqual(invocation.slice(1), [
      'ci',
      '--omit=dev',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ]);
    assert.equal(
      fs.readFileSync(path.join(invocation[0], 'package-lock.json'), 'utf8'),
      fs.readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8'),
    );
  } finally {
    process.env.PATH = previousPath;
  }
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('PASS: legacy FileProvider runtime dependencies keep their API and expose the pinned migration contract');
