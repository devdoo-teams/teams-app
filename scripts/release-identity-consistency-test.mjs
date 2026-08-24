import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { parseServerBuildMarker } from './server-build-marker.mjs';

const execFileAsync = promisify(execFile);
const FULL_COMMIT = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const COMMAND_TIMEOUT_MS = 2_000;
const HTTP_TIMEOUT_MS = 1_000;

function fail(label, detail) {
  throw new Error(`release identity mismatch: ${label}${detail ? ` (${detail})` : ''}`);
}

export function assertReleaseIdentityConsistency({ marker, manifest, health, bundleBytes }) {
  if (!marker) fail('server marker is missing or invalid');
  if (marker.mode !== 'core') fail('server marker mode must be core');
  if (marker.worktree !== 'clean') fail('server marker worktree must be clean');
  if (!FULL_COMMIT.test(marker.sourceCommit)) fail('server marker commit must be a full Git OID');
  if (!SHA256.test(marker.bundleSha256)) fail('server marker bundle SHA-256 is invalid');

  const actualBundleSha256 = crypto.createHash('sha256').update(bundleBytes).digest('hex');
  if (marker.bundleSha256 !== actualBundleSha256) {
    fail('server marker bundleSha256 does not match server bundle bytes');
  }

  if (!SEMVER.test(String(manifest?.version ?? ''))) fail('package manifest version is invalid');
  if (health?.ok !== true) fail('health.ok must be true');
  if (health?.environment !== 'production') fail('health.environment must be production');
  if (!FULL_COMMIT.test(String(health?.sourceCommit ?? ''))) fail('health sourceCommit is invalid');
  if (!SEMVER.test(String(health?.version ?? ''))) fail('health version is invalid');
  if (!SHA256.test(String(health?.serverBundleSha256 ?? ''))) fail('health serverBundleSha256 is invalid');

  if (health.sourceCommit !== marker.sourceCommit) {
    fail(`health sourceCommit ${health.sourceCommit} != marker commit ${marker.sourceCommit}`);
  }
  if (health.version !== manifest.version) {
    fail(`health version ${health.version} != package manifest version ${manifest.version}`);
  }
  if (health.serverBundleSha256 !== marker.bundleSha256) {
    fail('health serverBundleSha256 does not match server marker bundleSha256');
  }

  return {
    sourceCommit: marker.sourceCommit,
    version: manifest.version,
    serverBundleSha256: marker.bundleSha256,
  };
}

async function readPackageManifest(packagePath) {
  const { stdout } = await execFileAsync('unzip', ['-p', packagePath, 'manifest.json'], {
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout);
}

async function fetchHealth(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return { status: response.status, body: await response.json() };
  } finally {
    clearTimeout(timer);
  }
}

async function inspectFixture({ serverDir, packagePath, healthUrl }) {
  const entryPath = path.join(serverDir, 'index.js');
  const markerPath = path.join(serverDir, '.teams-server-build-commit');
  const [bundleBytes, markerRaw, manifest, healthResult] = await Promise.all([
    readFile(entryPath),
    readFile(markerPath, 'utf8'),
    readPackageManifest(packagePath),
    fetchHealth(healthUrl),
  ]);
  assert.equal(healthResult.status, 200, 'fixture health endpoint must return HTTP 200');
  const marker = parseServerBuildMarker(markerRaw);
  return assertReleaseIdentityConsistency({ marker, manifest, health: healthResult.body, bundleBytes });
}

async function createFixture(root, { sourceCommit, version, healthOverrides = {} }) {
  const serverDir = path.join(root, 'server');
  const packageDir = path.join(root, 'package');
  await mkdir(serverDir, { recursive: true });
  await mkdir(packageDir, { recursive: true });

  const bundleBytes = Buffer.from('fixture server bundle for release identity consistency');
  const bundleSha256 = crypto.createHash('sha256').update(bundleBytes).digest('hex');
  await writeFile(path.join(serverDir, 'index.js'), bundleBytes);
  await writeFile(
    path.join(serverDir, '.teams-server-build-commit'),
    `${JSON.stringify({
      schemaVersion: 3,
      commit: sourceCommit,
      mode: 'core',
      worktree: 'clean',
      bundleSha256,
    })}\n`,
  );
  await writeFile(path.join(packageDir, 'manifest.json'), JSON.stringify({ version }, null, 2));

  const packagePath = path.join(root, 'teams-sdk-mvp.zip');
  await execFileAsync('zip', ['-X', '-q', packagePath, 'manifest.json'], {
    cwd: packageDir,
    timeout: COMMAND_TIMEOUT_MS,
  });

  const health = {
    ok: true,
    service: 'teams-sdk-mvp',
    environment: 'production',
    version,
    sourceCommit,
    serverBundleSha256: bundleSha256,
    ...healthOverrides,
  };

  const server = createServer((request, response) => {
    if (request.url !== '/api/health') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(health));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const healthUrl = `http://127.0.0.1:${address.port}/api/health`;
  return { serverDir, packagePath, healthUrl, server };
}

async function withFixture(options, callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'teams-release-identity-'));
  const fixture = await createFixture(root, options);
  try {
    return await callback(fixture);
  } finally {
    await new Promise((resolve) => fixture.server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
}

const sourceCommit = '0123456789abcdef0123456789abcdef01234567';

await withFixture({
  sourceCommit,
  version: '1.2.3',
  healthOverrides: { version: '1.2.4' },
}, async (fixture) => {
  await assert.rejects(
    inspectFixture(fixture),
    /health version .*package manifest version|release identity mismatch/i,
    'a package/health version mismatch must be rejected',
  );
});

await withFixture({
  sourceCommit,
  version: '1.2.3',
  healthOverrides: { sourceCommit: 'fedcba9876543210fedcba9876543210fedcba98' },
}, async (fixture) => {
  await assert.rejects(
    inspectFixture(fixture),
    /health sourceCommit .*marker commit|release identity mismatch/i,
    'a marker/health commit mismatch must be rejected',
  );
});

await withFixture({
  sourceCommit,
  version: '1.2.3',
  healthOverrides: { serverBundleSha256: 'b'.repeat(64) },
}, async (fixture) => {
  await assert.rejects(
    inspectFixture(fixture),
    /serverBundleSha256|bundle SHA-256|release identity mismatch/i,
    'a marker/health bundle digest mismatch must be rejected',
  );
});

await withFixture({ sourceCommit, version: '1.2.3' }, async (fixture) => {
  assert.deepEqual(await inspectFixture(fixture), {
    sourceCommit,
    version: '1.2.3',
    serverBundleSha256: '0df6d8609972ba0a9587e93650c93e2ce3a5f8907833daa133571e06b92561f8',
  }, 'aligned marker, package manifest, and health identities must pass');
});

console.log('PASS: release identity consistency fixtures detect commit/version/digest drift');
