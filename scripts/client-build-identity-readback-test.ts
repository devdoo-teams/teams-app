import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readClientBuildIdentity } from '../src/server/client-build-identity.js';

const watchdog = setTimeout(() => {
  console.error('client-build-identity-readback-test: 20-second watchdog expired');
  process.exit(1);
}, 20_000);
watchdog.unref();
const root = mkdtempSync(path.join(os.tmpdir(), 'teams-client-identity-readback-'));
const version = '1.0.138';
const sourceCommit = 'a'.repeat(40);
const expected = { version, sourceCommit };
// This asset is read as bytes only. Importing it would fail this test.
const asset = Buffer.from('throw new Error("client identity readback must never execute the asset");\n// 합성 fixture\n');
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
let checks = 0;

function metadata(mode: 'core' | 'optional' = 'core'): Record<string, unknown> {
  const stamp = { schemaVersion: 1, version, sourceCommit, mode };
  return { ...stamp, buildFingerprint: sha256(JSON.stringify(stamp)), clientBundleSha256: sha256(asset) };
}
function fixture(name: string, options: {
  metadata?: unknown; rawMetadata?: string; omitMetadata?: boolean;
  asset?: Buffer; omitAsset?: boolean;
} = {}): string {
  const directory = path.join(root, name);
  mkdirSync(path.join(directory, 'client/assets'), { recursive: true });
  if (!options.omitMetadata) writeFileSync(path.join(directory, 'client/build-identity.json'),
    options.rawMetadata ?? JSON.stringify(options.metadata ?? metadata()));
  if (!options.omitAsset) writeFileSync(path.join(directory, 'client/assets/main.js'), options.asset ?? asset);
  return directory;
}
function unavailable(directory: string, message: string, expectedIdentity = expected): void {
  assert.equal(readClientBuildIdentity(directory, expectedIdentity), undefined, message);
  checks += 1;
}

try {
  for (const mode of ['core', 'optional'] as const) {
    const directory = fixture(`valid-${mode}`, { metadata: metadata(mode) });
    const observed = readClientBuildIdentity(directory, expected);
    assert.deepEqual(observed, metadata(mode), `${mode}: readback binds the actual bytes to the expected release`);
    assert.equal(observed?.clientBundleSha256, sha256(asset));
    checks += 1;
  }

  const valid = fixture('expected-mismatch');
  unavailable(valid, 'another release version is not an attested client', { ...expected, version: '1.0.132' });
  unavailable(valid, 'another source commit is not an attested client', { ...expected, sourceCommit: 'b'.repeat(40) });

  for (const [name, patch] of [
    ['schema', { schemaVersion: 2 }],
    ['version', { version: '1.0.132' }],
    ['commit', { sourceCommit: 'b'.repeat(40) }],
    ['short-commit', { sourceCommit: 'a2ca210' }],
    ['mode', { mode: 'unknown' }],
    ['fingerprint', { buildFingerprint: 'b'.repeat(64) }],
    ['short-fingerprint', { buildFingerprint: 'a'.repeat(12) }],
    ['bundle-hash', { clientBundleSha256: 'b'.repeat(64) }],
    ['short-bundle-hash', { clientBundleSha256: 'a'.repeat(12) }],
    ['missing-bundle-hash', { clientBundleSha256: undefined }],
  ] as const) {
    unavailable(fixture(`bad-${name}`, { metadata: { ...metadata(), ...patch } }), `${name} mismatch is unavailable`);
  }
  // A valid hash with a changed mode still needs that mode's own fingerprint.
  unavailable(fixture('mode-fingerprint-mismatch', { metadata: { ...metadata(), mode: 'optional' } }),
    'changing the build mode invalidates the original fingerprint');
  unavailable(fixture('tampered-asset', { asset: Buffer.concat([asset, Buffer.from('// changed bytes\n')]) }),
    'actual asset tampering invalidates otherwise valid metadata');
  unavailable(fixture('missing-asset', { omitAsset: true }), 'missing asset remains unavailable');
  unavailable(fixture('missing-metadata', { omitMetadata: true }), 'missing metadata remains unavailable');
  unavailable(fixture('invalid-json', { rawMetadata: '{"schemaVersion":' }), 'invalid metadata JSON remains unavailable');
  unavailable(fixture('null-metadata', { rawMetadata: 'null' }), 'null metadata remains unavailable');
  unavailable(fixture('array-metadata', { metadata: [] }), 'array metadata remains unavailable');
  unavailable(path.join(root, 'missing-root'), 'a missing output directory remains unavailable');
  console.log(`client-build-identity-readback-test: ${checks} fixture assertions passed`);
} finally {
  clearTimeout(watchdog);
  rmSync(root, { recursive: true, force: true });
}
