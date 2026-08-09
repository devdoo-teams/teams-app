import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

import {
  applyEvidence,
  applyPhaseSuccess,
  assertCurrentReleaseArtifacts,
  assertPackageIntegrity,
  assertPublicProbeMatches,
  completionMessage,
  completeRun,
  completeReleaseState,
  createInitialState,
  deriveStatus,
  gatePhaseForLoop,
  missingGates,
  parseGatePayload,
  rasterDimensions,
  resetAfterPhaseFailure,
  reverifyEvidenceArtifacts,
  summarizePhase,
  validateEvidence,
} from './release-loop.mjs';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-release-loop-'));
const artifactPath = path.join(tempDir, 'desktop-proof.png');
const surfaceArtifactPaths = {
  portal: artifactPath,
  installed: path.join(tempDir, 'installed-proof.png'),
  desktop: path.join(tempDir, 'teams-desktop-proof.png'),
  mobile: path.join(tempDir, 'mobile-proof.png'),
};
const fakeArtifactPath = path.join(tempDir, 'fake-proof.png');
const packagePath = path.join(tempDir, 'teams-sdk-mvp.zip');
const artifactBytes = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x14,
  0x08, 0x06, 0x00, 0x00, 0x00,
]);
assert.throws(
  () => rasterDimensions(artifactBytes),
  /valid|complete|decode|truncated|PNG/i,
  'a PNG header without image data, CRCs, and IEND is not visual evidence',
);
const validArtifactBase = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const validJpegArtifact = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=',
  'base64',
);
assert.deepEqual(rasterDimensions(validJpegArtifact), { width: 1, height: 1 });
assert.throws(
  () => rasterDimensions(validJpegArtifact.subarray(0, 177)),
  /valid|complete|decode|truncated|JPEG|EOI|scan/i,
  'JPEG evidence must contain complete scan data through EOI',
);
const validWebpArtifact = Buffer.from(
  'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA',
  'base64',
);
assert.deepEqual(rasterDimensions(validWebpArtifact), { width: 1, height: 1 });
assert.throws(
  () => rasterDimensions(validWebpArtifact.subarray(0, 30)),
  /valid|complete|decode|truncated|WebP|RIFF|chunk/i,
  'WebP evidence must contain the complete RIFF and image chunk payload',
);
function fixtureCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(typeName, data) {
  const type = Buffer.from(typeName);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(fixtureCrc32(Buffer.concat([type, data])), 8 + data.length);
  return chunk;
}
function pngFixture(label) {
  const data = Buffer.from(`release-proof\0${label}`);
  const chunk = pngChunk('tEXt', data);
  return Buffer.concat([validArtifactBase.subarray(0, -12), chunk, validArtifactBase.subarray(-12)]);
}
function rgbaPngFixture(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc(height * (1 + width * 4));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(rows)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
assert.throws(
  () => rasterDimensions(rgbaPngFixture(16_385, 1)),
  /dimension|pixel|bound|limit|oversized/i,
  'evidence dimensions are bounded even when the image is otherwise decodable',
);
const oversizedArtifact = Buffer.concat([validJpegArtifact, Buffer.alloc(20 * 1024 * 1024)]);
assert.throws(
  () => rasterDimensions(oversizedArtifact),
  /byte|file.*size|size.*limit|oversized/i,
  'evidence file bytes are bounded before format decoding',
);
const packageBytes = Buffer.from('zip fixture for release-loop integrity tests');
const packageSha256 = crypto.createHash('sha256').update(packageBytes).digest('hex');
const publicAssetSha256 = crypto.createHash('sha256').update('public release bundle').digest('hex');
const publicBuildId = publicAssetSha256.slice(0, 12);
const publicAsset = {
  finalUrl: `https://runtime.example.com/tabs/assets/main.js?v=${publicBuildId}`,
  sha256: publicAssetSha256,
  buildId: publicBuildId,
};
const surfaceArtifactBytes = Object.fromEntries(
  Object.keys(surfaceArtifactPaths).map((surface) => [surface, pngFixture(surface)]),
);
for (const surface of Object.keys(surfaceArtifactPaths)) {
  await fs.writeFile(surfaceArtifactPaths[surface], surfaceArtifactBytes[surface]);
}
await fs.writeFile(packagePath, packageBytes);
await fs.writeFile(fakeArtifactPath, 'proof');

const identity = {
  runId: 'run-test-001',
  commit: '0123456789abcdef0123456789abcdef01234567',
  shortCommit: '0123456',
  version: '1.0.15',
  startedAt: '2026-08-09T00:00:00.000Z',
};

function machineReadyState() {
  const state = createInitialState(identity);
  state.machine = { status: 'READY', completedAt: '2026-08-09T00:01:00.000Z' };
  state.package = {
    status: 'READY',
    packagePath,
    version: identity.version,
    sha256: packageSha256,
    manifest: {
      version: identity.version,
      contentUrl: 'https://runtime.example.com/tabs/home',
    },
    completedAt: '2026-08-09T00:02:00.000Z',
  };
  state.public = {
    status: 'READY',
    version: identity.version,
    health: {
      auth: 'teams-authenticated',
      userAuth: 'entra-sso',
      bot: 'teams-sdk',
      outbound: 'teams-sdk',
      environment: 'production',
    },
    packageSha256,
    tab: {
      status: 200,
      finalUrl: 'https://runtime.example.com/tabs/home',
      buildId: publicBuildId,
    },
    asset: { ...publicAsset },
    completedAt: '2026-08-09T00:03:00.000Z',
  };
  return state;
}

function evidence(surface, overrides = {}) {
  return {
    surface,
    observedAt: '2026-08-09T00:04:00.000Z',
    commit: identity.commit,
    version: identity.version,
    packageSha256,
    summary: `Observed ${surface} release evidence in the deployed Teams app.`,
    artifactPaths: [surfaceArtifactPaths[surface]],
    ...overrides,
  };
}

const initial = createInitialState(identity);
assert.equal(initial.status, 'INIT');
assert.deepEqual(missingGates(initial), [
  'MACHINE_READY',
  'PACKAGE_READY',
  'PUBLIC_READY',
  'PORTAL_READY',
  'INSTALLED_READY',
  'DESKTOP_READY',
  'MOBILE_READY',
]);

const machineReady = machineReadyState();
assert.equal(deriveStatus(machineReady), 'PUBLIC_READY');
assert.deepEqual(missingGates(machineReady), [
  'PORTAL_READY',
  'INSTALLED_READY',
  'DESKTOP_READY',
  'MOBILE_READY',
]);
const mismatchedPublicPackage = machineReadyState();
mismatchedPublicPackage.public.packageSha256 = 'f'.repeat(64);
assert.equal(deriveStatus(mismatchedPublicPackage), 'PACKAGE_READY');
assert.ok(missingGates(mismatchedPublicPackage).includes('PUBLIC_READY'));
assert.throws(
  () => validateEvidence(evidence('portal'), mismatchedPublicPackage, {
    fileExists: (candidate) => candidate === artifactPath,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /portal.*(?:prerequisite|public)|public.*(?:current|package|prerequisite)/i,
  'portal evidence requires a public phase bound to the current package',
);
const missingPublicAsset = machineReadyState();
delete missingPublicAsset.public.asset;
assert.equal(deriveStatus(missingPublicAsset), 'PACKAGE_READY');
assert.ok(missingGates(missingPublicAsset).includes('PUBLIC_READY'));

const portalEvidence = validateEvidence(evidence('portal'), machineReady, {
  fileExists: (candidate) => candidate === artifactPath,
  now: new Date('2026-08-09T00:05:00.000Z'),
});
assert.throws(
  () => validateEvidence(evidence('portal', { observedAt: '2026-08-09T00:02:59.999Z' }), machineReady, {
    fileExists: (candidate) => candidate === artifactPath,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /portal.*public|public.*portal|prerequisite.*time/i,
  'portal evidence must be observed after the public gate completes',
);
assert.deepEqual(Object.keys(portalEvidence).sort(), [
  'artifactPaths',
  'artifacts',
  'commit',
  'observedAt',
  'packageSha256',
  'summary',
  'surface',
  'version',
]);
assert.deepEqual(portalEvidence.artifacts, [{
  path: artifactPath,
  sha256: crypto.createHash('sha256').update(surfaceArtifactBytes.portal).digest('hex'),
  width: 1,
  height: 1,
}]);
assert.equal(applyEvidence(machineReady, portalEvidence).status, 'PORTAL_READY');
const portalReady = applyEvidence(machineReady, portalEvidence);
assert.throws(
  () => validateEvidence(evidence('installed'), portalReady, {
    fileExists: () => true,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /installed.*version|version.*installed/i,
);
const installedEvidence = validateEvidence(evidence('installed', { installedVersion: identity.version }), portalReady, {
  fileExists: () => true,
  now: new Date('2026-08-09T00:05:00.000Z'),
});
assert.equal(installedEvidence.installedVersion, identity.version);
assert.throws(
  () => validateEvidence(evidence('installed', {
    installedVersion: identity.version,
    artifactPaths: [artifactPath],
  }), portalReady, {
    fileExists: () => true,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /artifact.*(?:path|hash|reuse)|(?:path|hash).*artifact.*reuse/i,
  'one visual artifact cannot prove two different UI surfaces',
);
assert.throws(
  () => validateEvidence(evidence('installed', {
    installedVersion: identity.version,
    observedAt: '2026-08-09T00:03:59.999Z',
  }), portalReady, {
    fileExists: () => true,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /installed.*portal|portal.*installed|prerequisite.*time/i,
  'installed evidence must not predate its portal prerequisite',
);

assert.throws(
  () => validateEvidence(evidence('portal', { commit: 'f'.repeat(40) }), machineReady, {
    fileExists: () => true,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /commit/i,
);
assert.throws(
  () => validateEvidence(evidence('portal', { version: '9.9.9' }), machineReady, {
    fileExists: () => true,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /version/i,
);
assert.throws(
  () => validateEvidence(evidence('portal', { packageSha256: 'b'.repeat(64) }), machineReady, {
    fileExists: () => true,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /sha/i,
);
assert.throws(
  () => validateEvidence(evidence('portal', { artifactPaths: [path.join(tempDir, 'missing.png')] }), machineReady, {
    fileExists: () => false,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /artifact/i,
);
assert.throws(
  () => validateEvidence(evidence('unknown'), machineReady, {
    fileExists: () => true,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /surface/i,
);
assert.throws(
  () => validateEvidence(evidence('portal', { observedAt: '2026-08-09T00:06:00.000Z' }), machineReady, {
    fileExists: () => true,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /future|time/i,
);
assert.throws(
  () => validateEvidence(evidence('portal', { summary: 'Bearer secret-token' }), machineReady, {
    fileExists: () => true,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /secret|credential|sensitive/i,
);
assert.throws(
  () => applyEvidence(machineReady, evidence('desktop')),
  /order|installed|portal/i,
);

let completeState = machineReady;
for (const surface of ['portal', 'installed', 'desktop', 'mobile']) {
  const surfaceOverrides = surface === 'installed' ? { installedVersion: identity.version } : {};
  assert.throws(
    () => validateEvidence(evidence(surface, { ...surfaceOverrides, artifactPaths: [fakeArtifactPath] }), completeState, {
      fileExists: (candidate) => candidate === fakeArtifactPath,
      now: new Date('2026-08-09T00:05:00.000Z'),
    }),
    /evidence artifact must be .*PNG, JPEG, or WebP .* image/,
  );
  const normalized = validateEvidence(evidence(surface, surfaceOverrides), completeState, {
    fileExists: () => true,
    now: new Date('2026-08-09T00:05:00.000Z'),
  });
  completeState = applyEvidence(completeState, normalized);
}
assert.equal(completeState.status, 'MOBILE_READY');
assert.deepEqual(missingGates(completeState), []);
const replacementPortalEvidence = validateEvidence(evidence('portal', {
  observedAt: '2026-08-09T00:05:00.000Z',
}), completeState, {
  fileExists: (candidate) => candidate === artifactPath,
  now: new Date('2026-08-09T00:05:00.000Z'),
});
const portalReplaced = applyEvidence(completeState, replacementPortalEvidence);
assert.equal(portalReplaced.status, 'PORTAL_READY');
assert.equal(portalReplaced.evidence.portal.observedAt, replacementPortalEvidence.observedAt);
assert.equal(portalReplaced.evidence.installed, null);
assert.equal(portalReplaced.evidence.desktop, null);
assert.equal(portalReplaced.evidence.mobile, null);
const machineRerun = applyPhaseSuccess(
  completeState,
  'machine',
  { status: 'READY', completedAt: '2026-08-09T00:06:00.000Z' },
  new Date('2026-08-09T00:06:00.000Z'),
);
assert.equal(machineRerun.status, 'MACHINE_READY');
assert.equal(machineRerun.package, null);
assert.equal(machineRerun.public, null);
assert.deepEqual(machineRerun.evidence, { portal: null, installed: null, desktop: null, mobile: null });
const packageRerun = applyPhaseSuccess(
  completeState,
  'package',
  { ...completeState.package, completedAt: '2026-08-09T00:06:00.000Z' },
  new Date('2026-08-09T00:06:00.000Z'),
);
assert.equal(packageRerun.status, 'PACKAGE_READY');
assert.equal(packageRerun.public, null);
assert.deepEqual(packageRerun.evidence, { portal: null, installed: null, desktop: null, mobile: null });
const publicRerun = applyPhaseSuccess(
  completeState,
  'public',
  { ...completeState.public, completedAt: '2026-08-09T00:06:00.000Z' },
  new Date('2026-08-09T00:06:00.000Z'),
);
assert.equal(publicRerun.status, 'PUBLIC_READY');
assert.deepEqual(publicRerun.evidence, { portal: null, installed: null, desktop: null, mobile: null });
assert.throws(
  () => completionMessage({ ...completeState, lastFailure: { phase: 'public', code: 'ELOOPPHASE', message: 'failed' } }),
  /last failure|retry/i,
);
const failedPackage = resetAfterPhaseFailure({ ...completeState, lastFailure: null }, 'package', new Error('package gate failed'));
assert.equal(failedPackage.machine.status, 'READY');
assert.equal(failedPackage.package, null);
assert.equal(failedPackage.public, null);
assert.deepEqual(failedPackage.evidence, {
  portal: null,
  installed: null,
  desktop: null,
  mobile: null,
});
assert.equal(failedPackage.lastFailure.phase, 'package');
assert.throws(() => completionMessage(failedPackage), /last failure|retry|missing/i);
await assert.rejects(completeReleaseState(failedPackage, { probePublic: async () => { throw new Error('probe must not run'); } }), /last phase failure|last failure|retry/i);
assert.doesNotThrow(() => assertPackageIntegrity(completeState));
assert.doesNotThrow(() => reverifyEvidenceArtifacts(completeState));
assert.doesNotThrow(() => assertCurrentReleaseArtifacts(completeState));
await fs.writeFile(artifactPath, Buffer.from(`${surfaceArtifactBytes.portal.toString('binary')}tampered`, 'binary'));
assert.throws(() => reverifyEvidenceArtifacts(completeState), /hash|sha|changed|trailing|invalid|decode/i);
await fs.writeFile(artifactPath, surfaceArtifactBytes.portal);
await fs.writeFile(packagePath, Buffer.from('replacement package'));
assert.throws(() => assertPackageIntegrity(completeState), /package.*sha|sha.*package|changed/i);
await fs.writeFile(packagePath, packageBytes);
assert.doesNotThrow(() => assertPublicProbeMatches(completeState, {
  version: identity.version,
  packageSha256,
  tab: { finalUrl: 'https://runtime.example.com/tabs/home' },
  asset: { ...publicAsset },
}));
assert.throws(
  () => assertPublicProbeMatches(completeState, {
    version: identity.version,
    packageSha256,
    tab: { finalUrl: 'https://wrong.example.com/tabs/home' },
    asset: { ...publicAsset },
  }),
  /origin|host|packaged/i,
);
const staleRecordedPublic = structuredClone(completeState);
staleRecordedPublic.package.sha256 = 'c'.repeat(64);
assert.throws(
  () => assertPublicProbeMatches(staleRecordedPublic, {
    version: identity.version,
    packageSha256: staleRecordedPublic.package.sha256,
    tab: { finalUrl: 'https://runtime.example.com/tabs/home' },
    asset: { ...publicAsset },
  }),
  /recorded.*public.*(?:package|SHA)|public.*(?:package|SHA).*recorded/i,
  'a current probe cannot rehabilitate a public phase recorded for a different package',
);
assert.throws(
  () => assertPublicProbeMatches(completeState, {
    version: identity.version,
    packageSha256,
    tab: { finalUrl: 'https://runtime.example.com/tabs/home' },
    asset: { ...publicAsset, buildId: 'f'.repeat(12), sha256: 'f'.repeat(64) },
  }),
  /asset|build|deployed.*identity/i,
  'completion must observe the same deployed build that preceded UI evidence',
);
let publicProbeCount = 0;
const completedAgain = await completeReleaseState(completeState, {
  probePublic: async () => {
    publicProbeCount += 1;
    return {
      version: identity.version,
      packageSha256,
      tab: { finalUrl: 'https://runtime.example.com/tabs/home' },
      asset: { ...publicAsset },
    };
  },
});
assert.equal(publicProbeCount, 1);
assert.equal(completedAgain.status, 'COMPLETE');
const completionFailureStatePath = path.join(tempDir, 'completion-failure.json');
await fs.writeFile(completionFailureStatePath, JSON.stringify(completeState, null, 2));
const publicProbeFailure = Object.assign(new Error('fresh public probe failed'), { code: 'ELOOPPHASE' });
await assert.rejects(
  completeRun(completionFailureStatePath, {
    assertGit: () => true,
    completeState: async () => { throw publicProbeFailure; },
    log: () => {},
  }),
  /fresh public probe failed/,
);
const persistedCompletionFailure = JSON.parse(await fs.readFile(completionFailureStatePath, 'utf8'));
assert.equal(persistedCompletionFailure.status, 'PACKAGE_READY');
assert.equal(persistedCompletionFailure.public, null);
assert.deepEqual(persistedCompletionFailure.evidence, {
  portal: null,
  installed: null,
  desktop: null,
  mobile: null,
});
assert.equal(persistedCompletionFailure.lastFailure.phase, 'public');
const packageTamperStatePath = path.join(tempDir, 'package-tamper-completion.json');
await fs.writeFile(packageTamperStatePath, JSON.stringify(completeState, null, 2));
await fs.writeFile(packagePath, Buffer.from('tampered before completion'));
await assert.rejects(
  completeRun(packageTamperStatePath, {
    assertGit: () => true,
    log: () => {},
  }),
  /package.*SHA|SHA.*package|changed/i,
);
const persistedPackageTamper = JSON.parse(await fs.readFile(packageTamperStatePath, 'utf8'));
assert.equal(persistedPackageTamper.status, 'MACHINE_READY');
assert.equal(persistedPackageTamper.package, null);
assert.equal(persistedPackageTamper.public, null);
assert.deepEqual(persistedPackageTamper.evidence, {
  portal: null,
  installed: null,
  desktop: null,
  mobile: null,
});
assert.equal(persistedPackageTamper.lastFailure.phase, 'package');
await fs.writeFile(packagePath, packageBytes);
const mobileTamperStatePath = path.join(tempDir, 'mobile-tamper-completion.json');
await fs.writeFile(mobileTamperStatePath, JSON.stringify(completeState, null, 2));
await fs.writeFile(surfaceArtifactPaths.mobile, pngFixture('mobile-tampered'));
await assert.rejects(
  completeRun(mobileTamperStatePath, {
    assertGit: () => true,
    log: () => {},
  }),
  /evidence artifact hash changed/i,
);
const persistedMobileTamper = JSON.parse(await fs.readFile(mobileTamperStatePath, 'utf8'));
assert.equal(persistedMobileTamper.status, 'DESKTOP_READY');
assert.notEqual(persistedMobileTamper.public, null);
assert.notEqual(persistedMobileTamper.evidence.portal, null);
assert.notEqual(persistedMobileTamper.evidence.installed, null);
assert.notEqual(persistedMobileTamper.evidence.desktop, null);
assert.equal(persistedMobileTamper.evidence.mobile, null);
assert.equal(persistedMobileTamper.lastFailure.phase, 'mobile');
await fs.writeFile(surfaceArtifactPaths.mobile, surfaceArtifactBytes.mobile);
await assert.rejects(
  completeReleaseState(completeState, {
    probePublic: async () => ({
      version: identity.version,
      packageSha256,
      tab: { finalUrl: 'https://wrong.example.com/tabs/home' },
      asset: { ...publicAsset },
    }),
  }),
  /origin|host|packaged/i,
);
const report = completionMessage(completeState);
assert.match(report, /1\.0\.15/);
assert.match(report, /0123456/);
assert.match(report, new RegExp(packageSha256));
assert.doesNotMatch(report, /desktop-proof\.png/);
assert.doesNotMatch(report, /Bearer|sk-|client_secret|password/i);
assert.equal(gatePhaseForLoop('machine'), 'preflight');
assert.equal(gatePhaseForLoop('package'), 'package');
assert.equal(gatePhaseForLoop('public'), 'public');
const packageSummary = summarizePhase('package', {
  evidence: [
    { package: '/absolute/teams-sdk-mvp.zip', version: identity.version, sha256: packageSha256 },
    { manifest: { version: identity.version, appId: 'app-id' } },
  ],
});
assert.equal(packageSummary.version, identity.version);
assert.equal(packageSummary.sha256, packageSha256);
const publicPayloadWithoutAsset = {
  evidence: [
    { package: packagePath, version: identity.version, sha256: packageSha256 },
    { health: { version: identity.version, environment: 'production' } },
    { tab: { status: 200, finalUrl: 'https://runtime.example.com/tabs/home', buildId: publicBuildId } },
  ],
};
assert.throws(
  () => summarizePhase('public', publicPayloadWithoutAsset),
  /asset|build.*evidence/i,
  'public phase summaries require deployed asset hash evidence',
);
const publicSummary = summarizePhase('public', {
  evidence: [...publicPayloadWithoutAsset.evidence, { asset: { ...publicAsset } }],
});
assert.deepEqual(publicSummary.asset, publicAsset);
assert.deepEqual(parseGatePayload('', JSON.stringify({ status: 'BLOCKED', phase: 'public' })), {
  status: 'BLOCKED',
  phase: 'public',
});

const cliStatePath = path.join(tempDir, 'current.json');
const cleanGitPath = path.join(tempDir, 'git');
await fs.writeFile(cleanGitPath, '#!/bin/sh\nif [ "$1" = "status" ]; then exit 0; fi\nexec /usr/bin/git "$@"\n');
await fs.chmod(cleanGitPath, 0o755);
const runCli = (args) => spawnSync(
  process.execPath,
  ['scripts/release-loop.mjs', ...args],
  {
    cwd: process.cwd(),
    env: { ...process.env, PATH: `${tempDir}:${process.env.PATH}`, RELEASE_LOOP_STATE_PATH: cliStatePath },
    encoding: 'utf8',
  },
);

const currentCommit = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: process.cwd(),
  encoding: 'utf8',
}).stdout.trim();
const currentShortCommit = spawnSync('git', ['rev-parse', '--short=7', 'HEAD'], {
  cwd: process.cwd(),
  encoding: 'utf8',
}).stdout.trim();
const currentState = machineReadyState();
currentState.commit = currentCommit;
currentState.shortCommit = currentShortCommit;
await fs.writeFile(cliStatePath, JSON.stringify(currentState, null, 2));
const statusResult = runCli(['status']);
assert.equal(statusResult.status, 0);
assert.match(statusResult.stdout, /PUBLIC_READY/);
const blockedComplete = runCli(['complete']);
assert.notEqual(blockedComplete.status, 0);
assert.match(`${blockedComplete.stdout}\n${blockedComplete.stderr}`, /BLOCKED/);
assert.match(`${blockedComplete.stdout}\n${blockedComplete.stderr}`, /PORTAL_READY/);

const staleState = machineReadyState();
await fs.writeFile(cliStatePath, JSON.stringify(staleState, null, 2));
const staleEvidencePath = path.join(tempDir, 'stale-evidence.json');
await fs.writeFile(staleEvidencePath, JSON.stringify(evidence('portal'), null, 2));
for (const args of [['status'], ['evidence', '--file', staleEvidencePath], ['complete']]) {
  const staleResult = runCli(args);
  assert.notEqual(staleResult.status, 0);
  assert.match(
    `${staleResult.stdout}\n${staleResult.stderr}`,
    /current Git commit does not match the release run/,
  );
}

await fs.rm(tempDir, { recursive: true, force: true });
console.log('Release loop contract tests passed.');
