import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServerBuildMarker, isReusableServerBuild, parseServerBuildMarker } from './server-build-marker.mjs';

const root = process.cwd();
const commit = '0123456789abcdef0123456789abcdef01234567';
const bundleSha256 = 'a'.repeat(64);
const coreMarker = createServerBuildMarker({ sourceCommit: commit, coreBuild: true, bundleSha256 });
const optionalMarker = createServerBuildMarker({ sourceCommit: commit, coreBuild: false, bundleSha256 });

assert.deepEqual(parseServerBuildMarker(coreMarker), { schemaVersion: 3, sourceCommit: commit, commit, mode: 'core', worktree: 'clean', bundleSha256 });
assert.deepEqual(parseServerBuildMarker(optionalMarker), { schemaVersion: 3, sourceCommit: commit, commit, mode: 'optional', worktree: 'clean', bundleSha256 });
assert.equal(JSON.parse(coreMarker).commit, commit, 'runtime-compatible marker must serialize the pinned source OID');
assert.equal('sourceCommit' in JSON.parse(coreMarker), false, 'runtime schema 3 keeps its established serialized field name');
assert.equal(isReusableServerBuild(coreMarker, { sourceCommit: commit, coreBuild: true, bundleSha256 }), true);
assert.equal(isReusableServerBuild(coreMarker, { sourceCommit: commit, coreBuild: false, bundleSha256 }), false);
assert.equal(isReusableServerBuild(optionalMarker, { sourceCommit: commit, coreBuild: true, bundleSha256 }), false);
assert.equal(isReusableServerBuild(coreMarker, { sourceCommit: commit, coreBuild: true, bundleSha256: 'b'.repeat(64) }), false);
assert.equal(isReusableServerBuild('0123456789abcdef0123456789abcdef01234567', { sourceCommit: commit, coreBuild: true, bundleSha256 }), false);
assert.equal(parseServerBuildMarker(JSON.stringify({ schemaVersion: 1, commit, mode: 'core' })), null, 'legacy markers cannot authorize reuse');
assert.equal(parseServerBuildMarker(JSON.stringify({ schemaVersion: 2, commit, mode: 'core', worktree: 'dirty' })), null, 'dirty markers cannot authorize reuse');
assert.equal(parseServerBuildMarker(JSON.stringify({ schemaVersion: 2, commit, mode: 'core', worktree: 'clean', bundleSha256 })), null, 'legacy schema-2 markers cannot authorize reuse');
assert.equal(parseServerBuildMarker(JSON.stringify({ schemaVersion: 3, commit, mode: 'core', worktree: 'clean' })), null, 'markers without a bundle digest cannot authorize reuse');

const buildScript = await fs.readFile(path.join(root, 'scripts', 'build-server.mjs'), 'utf8');
assert.match(buildScript, /isReusableServerBuild/, 'server reuse must validate the marker identity and mode');
assert.match(
  buildScript,
  /absWorkingDir:\s*materializedSource\?\.sourceRoot \?\? root/,
  'FileProvider fallback must compile from a stable materialized root rather than a random absolute entry path',
);
assert.match(
  buildScript,
  /entryPoints:\s*\[materializedSource\?\.entryPointRelative \?\? 'src\/server\/index\.ts'\]/,
  'server entry points must be relative to absWorkingDir so bundle comments and chunk identities are repeatable',
);

console.log('Server build mode contract test passed');
