import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServerBuildMarker, isReusableServerBuild, parseServerBuildMarker } from './server-build-marker.mjs';

const root = process.cwd();
const commit = '0123456789abcdef0123456789abcdef01234567';
const coreMarker = createServerBuildMarker({ commit, coreBuild: true });
const optionalMarker = createServerBuildMarker({ commit, coreBuild: false });

assert.deepEqual(parseServerBuildMarker(coreMarker), { schemaVersion: 2, commit, mode: 'core', worktree: 'clean' });
assert.deepEqual(parseServerBuildMarker(optionalMarker), { schemaVersion: 2, commit, mode: 'optional', worktree: 'clean' });
assert.equal(isReusableServerBuild(coreMarker, { commit, coreBuild: true }), true);
assert.equal(isReusableServerBuild(coreMarker, { commit, coreBuild: false }), false);
assert.equal(isReusableServerBuild(optionalMarker, { commit, coreBuild: true }), false);
assert.equal(isReusableServerBuild('0123456789abcdef0123456789abcdef01234567', { commit, coreBuild: true }), false);
assert.equal(parseServerBuildMarker(JSON.stringify({ schemaVersion: 1, commit, mode: 'core' })), null, 'legacy markers cannot authorize reuse');
assert.equal(parseServerBuildMarker(JSON.stringify({ schemaVersion: 2, commit, mode: 'core', worktree: 'dirty' })), null, 'dirty markers cannot authorize reuse');

const buildScript = await fs.readFile(path.join(root, 'scripts', 'build-server.mjs'), 'utf8');
assert.match(buildScript, /isReusableServerBuild/, 'server reuse must validate the marker identity and mode');

console.log('Server build mode contract test passed');
