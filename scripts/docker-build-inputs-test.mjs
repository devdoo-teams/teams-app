import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoot = path.resolve(process.env.TEAMS_RUNTIME_DIST_DIR?.trim() || path.join(root, 'dist'));
const expectedCommit = process.env.TEAMS_SOURCE_COMMIT?.trim()
  || execFileSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], { cwd: root, encoding: 'utf8' }).trim();
const serverRoot = path.join(runtimeRoot, 'server');
const clientRoot = path.join(runtimeRoot, 'client');
const [entry, markerRaw, indexHtml] = await Promise.all([
  fs.readFile(path.join(serverRoot, 'index.js')),
  fs.readFile(path.join(serverRoot, '.teams-server-build-commit'), 'utf8'),
  fs.readFile(path.join(clientRoot, 'index.html'), 'utf8'),
]);

const marker = JSON.parse(markerRaw);
assert.equal(marker.schemaVersion, 3, 'server marker schema must be current');
assert.equal(marker.commit, expectedCommit, 'server bundle must be built from the exact release commit');
assert.equal(marker.mode, 'core', 'external container inputs must use the Core bundle');
assert.equal(marker.worktree, 'clean', 'external container inputs must come from a clean tracked tree');
assert.equal(
  marker.bundleSha256,
  crypto.createHash('sha256').update(entry).digest('hex'),
  'server marker digest must match the bytes copied into the image',
);
assert.match(indexHtml, /assets\/main\.js(?:\?v=[a-f0-9]+)?/, 'client index must contain the built main asset');

console.log(JSON.stringify({
  status: 'PASS',
  sourceCommit: expectedCommit,
  runtimeRoot,
  serverBundleSha256: marker.bundleSha256,
  clientIndexBytes: Buffer.byteLength(indexHtml),
}, null, 2));
