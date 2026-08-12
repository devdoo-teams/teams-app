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
  classifyGitStatus,
  deriveStatus,
  gatePhaseForLoop,
  missingGates,
  parseGatePayload,
  parseArgs,
  probePublicTabRoutes,
  rasterDimensions,
  resetAfterPhaseFailure,
  requestedSourceIoMode,
  reverifyEvidenceArtifacts,
  runGatePhase,
  summarizePhase,
  validateEvidence,
} from './release-loop.mjs';
import { REQUIRED_COVERAGE_KEYS } from './teams-ui-matrix-validate.mjs';

assert.deepEqual(
  parseArgs(['public', '--url', 'https://runtime.example.com']),
  { command: 'public', file: undefined, reason: undefined, url: 'https://runtime.example.com' },
  'release loop public phase accepts an explicit URL for reproducible probes',
);
assert.equal(
  requestedSourceIoMode({ TEAMS_FILEPROVIDER_SERVER_REUSE: '1' }),
  'index-tree-fileprovider-fallback',
  'an explicit FileProvider fallback must be recorded in the release identity',
);
assert.equal(
  requestedSourceIoMode({}),
  'normal',
  'a release without an explicit fallback request starts in normal source-I/O mode',
);

let machineGateOptions;
await runGatePhase('machine', {
  runGate: async (_command, _args, options) => {
    machineGateOptions = options;
    return {
      code: 0,
      stdout: JSON.stringify({ status: 'READY', evidence: [] }),
      stderr: '',
    };
  },
});
assert.ok(
  machineGateOptions.timeoutMs >= 690_000,
  'the outer machine gate must cover the sum of all sequential inner preflight timeouts',
);

const routeProbeRequests = [];
const routeProbe = await probePublicTabRoutes({
  baseUrl: 'https://runtime.example.com',
  query: 'preview=1',
  timeoutMs: 25,
  fetchResource: async (url, timeoutMs, options) => {
    routeProbeRequests.push({ url, timeoutMs, redirect: options.redirect });
    if (url === 'https://runtime.example.com/tabs/home?preview=1') {
      return {
        response: {
          status: 308,
          url,
          headers: { get: (name) => name === 'location' ? '/tabs/home/?preview=1' : null },
        },
      };
    }
    return {
      response: {
        status: 200,
        url,
        headers: { get: () => null },
      },
    };
  },
});
assert.deepEqual(routeProbeRequests, [
  {
    url: 'https://runtime.example.com/tabs/home?preview=1',
    timeoutMs: 25,
    redirect: 'manual',
  },
  {
    url: 'https://runtime.example.com/tabs/home/?preview=1',
    timeoutMs: 25,
    redirect: 'manual',
  },
], 'the public route probe must make independent bounded requests for both tab paths');
assert.deepEqual(routeProbe, {
  redirect: {
    requestUrl: 'https://runtime.example.com/tabs/home?preview=1',
    status: 308,
    location: 'https://runtime.example.com/tabs/home/?preview=1',
  },
  canonical: {
    requestUrl: 'https://runtime.example.com/tabs/home/?preview=1',
    status: 200,
    finalUrl: 'https://runtime.example.com/tabs/home/?preview=1',
  },
});
const gateRouteProbeCalls = [];
const augmentedPublicPayload = await runGatePhase('public', {
  url: 'https://runtime.example.com',
  runGate: async () => ({
    code: 0,
    stdout: JSON.stringify({ status: 'READY', evidence: [] }),
    stderr: '',
  }),
  probeRoutes: async (options) => {
    gateRouteProbeCalls.push(options);
    return routeProbe;
  },
});
assert.equal(gateRouteProbeCalls.length, 1, 'the public release phase must invoke the independent route probe');
assert.equal(gateRouteProbeCalls[0].baseUrl, 'https://runtime.example.com');
assert.equal(gateRouteProbeCalls[0].timeoutMs > 0, true);
assert.deepEqual(augmentedPublicPayload.evidence, [{ tabRoutes: routeProbe }]);
await assert.rejects(
  probePublicTabRoutes({
    baseUrl: 'https://runtime.example.com',
    query: 'preview=1',
    timeoutMs: 25,
    fetchResource: async (url) => ({
      response: {
        status: url.endsWith('/tabs/home?preview=1') ? 308 : 503,
        url,
        headers: { get: (name) => name === 'location' ? '/tabs/home/?preview=1' : null },
      },
    }),
  }),
  /canonical.*200|trailing.*200/i,
  'a healthy redirect must not hide a broken canonical trailing-slash route',
);
await assert.rejects(
  probePublicTabRoutes({
    baseUrl: 'https://runtime.example.com',
    query: 'preview=1',
    timeoutMs: 25,
    fetchResource: async (url) => ({
      response: {
        status: 200,
        url,
        headers: { get: (name) => name === 'location' ? '/tabs/home/?preview=1' : null },
      },
    }),
  }),
  /no-slash.*308/i,
  'a canonical 200 must not hide a broken no-slash redirect contract',
);

assert.deepEqual(
  classifyGitStatus('?? "user-owned artifact 2"\n'),
  {
    trackedDirty: false,
    untracked: ['?? "user-owned artifact 2"'],
  },
  'untracked user artifacts must be recorded without blocking a clean tracked release start',
);
assert.deepEqual(
  classifyGitStatus(' M scripts/release-loop.mjs\n?? "user-owned artifact 2"\n'),
  {
    trackedDirty: true,
    untracked: ['?? "user-owned artifact 2"'],
  },
  'tracked modifications must still block a release start even when untracked artifacts exist',
);

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-release-loop-'));
const artifactPath = path.join(tempDir, 'desktop-proof.png');
const surfaceArtifactPaths = {
  portal: artifactPath,
  installed: path.join(tempDir, 'installed-proof.png'),
  desktop: path.join(tempDir, 'teams-desktop-proof.png'),
  mobile: path.join(tempDir, 'mobile-proof.png'),
};
const surfaceBeforePaths = Object.fromEntries(
  Object.keys(surfaceArtifactPaths).map((surface) => [surface, path.join(tempDir, `${surface}-before.png`)]),
);
const surfaceAfterPaths = Object.fromEntries(
  Object.keys(surfaceArtifactPaths).map((surface) => [surface, surfaceArtifactPaths[surface]]),
);
const surfaceAccessibilityPaths = Object.fromEntries(
  Object.keys(surfaceArtifactPaths).map((surface) => [surface, path.join(tempDir, `${surface}-accessibility.txt`)]),
);
const surfaceRuntimePaths = Object.fromEntries(
  Object.keys(surfaceArtifactPaths).map((surface) => [surface, path.join(tempDir, `${surface}-runtime.log`)]),
);
const surfaceCoveragePaths = Object.fromEntries(
  Object.keys(surfaceArtifactPaths).map((surface) => [surface, path.join(tempDir, `${surface}-coverage.md`)]),
);
const rowEvidencePaths = Object.fromEntries(
  Object.keys(surfaceArtifactPaths).map((surface) => [surface, Array.from({ length: 4 }, (_, index) => ({
    screenshotBefore: path.join(tempDir, `${surface}-row-${index}-before.png`),
    screenshotAfter: path.join(tempDir, `${surface}-row-${index}-after.png`),
    accessibilityBefore: path.join(tempDir, `${surface}-row-${index}-accessibility-before.txt`),
    accessibilityAfter: path.join(tempDir, `${surface}-row-${index}-accessibility-after.txt`),
    runtime: path.join(tempDir, `${surface}-row-${index}-runtime.log`),
  }))]),
);
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
const publicTabRoutes = {
  redirect: {
    requestUrl: 'https://runtime.example.com/tabs/home?release-loop-probe=1',
    status: 308,
    location: 'https://runtime.example.com/tabs/home/?release-loop-probe=1',
  },
  canonical: {
    requestUrl: 'https://runtime.example.com/tabs/home/?release-loop-probe=1',
    status: 200,
    finalUrl: 'https://runtime.example.com/tabs/home/?release-loop-probe=1',
  },
};
const surfaceArtifactBytes = Object.fromEntries(
  Object.keys(surfaceArtifactPaths).map((surface) => [surface, pngFixture(surface)]),
);
const surfaceBeforeBytes = Object.fromEntries(
  Object.keys(surfaceArtifactPaths).map((surface) => [surface, pngFixture(`${surface}-before`)]),
);
for (const surface of Object.keys(surfaceArtifactPaths)) {
  await fs.writeFile(surfaceArtifactPaths[surface], surfaceArtifactBytes[surface]);
  await fs.writeFile(surfaceBeforePaths[surface], surfaceBeforeBytes[surface]);
  await fs.writeFile(surfaceAccessibilityPaths[surface], `AX evidence for ${surface}\nrole=button\n`);
  await fs.writeFile(surfaceRuntimePaths[surface], `Runtime evidence for ${surface}\nstatus=pass\n`);
  await fs.writeFile(surfaceCoveragePaths[surface], `coverage-${surface}-fixture\n`);
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

function coverageMatrixBytes(surface, { mutateRow, evidenceScope, sourceCommit = identity.commit } = {}) {
  const matrixEvidence = (evidencePath, reason) => ({
    fresh: true,
    state: 'captured',
    path: evidencePath,
    capturedAt: '2026-08-09T00:04:00.000Z',
    reason,
    releaseIdentity: {
      appVersion: identity.version,
      sourceCommit,
      packageSha256,
      installedVersion: null,
    },
  });
  const rows = Array.from({ length: 4 }, (_, index) => {
    const rowPaths = rowEvidencePaths[surface]?.[index] ?? rowEvidencePaths.portal[index];
    const row = {
      id: `${surface}-row-${index}`,
      feature: `fixture feature ${index}`,
      surface: 'personal-tab',
      location: `fixture location ${index}`,
      branch: `fixture branch ${index}`,
      precondition: `fixture precondition ${index}`,
      action: {
        userGesture: 'click the fixture control',
        input: `fixture input ${index}`,
        operation: `fixture operation ${index}`,
      },
      visibleControl: {
        role: 'button',
        label: `Fixture control ${index}`,
        presenceAssertion: 'the fixture control is visible in the current AX tree',
        freshAxAssertion: 'the fixture control is present in the fresh AX capture',
        separateFromServerResult: true,
      },
      serverAction: {
        transport: 'HTTP fixture request',
        trigger: 'the visible fixture control sends the request',
        handler: `fixture handler ${index}`,
        request: `fixture request ${index}`,
        resultProof: `fixture response proof ${index}`,
        notVisibleOnly: true,
      },
      expected: {
        before: `fixture before state ${index}`,
        after: `fixture after state ${index}`,
        server: `fixture server state ${index}`,
        failure: `fixture failure state ${index}`,
      },
      screenshotBefore: matrixEvidence(rowPaths.screenshotBefore, 'fixture before screenshot captured'),
      screenshotAfter: matrixEvidence(rowPaths.screenshotAfter, 'fixture after screenshot captured'),
      accessibilityEvidence: {
        schema: 'paired-before-after-v1',
        before: matrixEvidence(rowPaths.accessibilityBefore, 'fixture accessibility before evidence captured'),
        after: matrixEvidence(rowPaths.accessibilityAfter, 'fixture accessibility after evidence captured'),
      },
      runtimeEvidence: matrixEvidence(rowPaths.runtime, 'fixture runtime evidence captured'),
      result: {
        status: 'PASS',
        reason: 'fixture row passed with fresh evidence',
        visibleControl: 'the fixture control was visible',
        serverAction: 'the fixture server action returned its result',
        nextAction: 'continue to the next fixture row',
      },
      coverage: REQUIRED_COVERAGE_KEYS.filter((_, keyIndex) => keyIndex % 4 === index),
    };
    return mutateRow ? mutateRow(row, index) : row;
  });
  return Buffer.from(JSON.stringify({
    schemaVersion: 1,
    matrixId: `fixture-${surface}`,
    ...(evidenceScope ? { evidenceScope } : {}),
    releaseIdentity: {
      appVersion: identity.version,
      sourceCommit,
      packageSha256,
      installedVersion: null,
    },
    evidencePolicy: { fixture: 'fresh evidence is required for every PASS row' },
    coverage: {
      count: rows.length,
      requiredKeys: [...REQUIRED_COVERAGE_KEYS],
    },
    rows,
  }) + '\n');
}

for (const surface of Object.keys(surfaceCoveragePaths)) {
  await fs.writeFile(surfaceCoveragePaths[surface], coverageMatrixBytes(surface));
  for (const [index, rowPaths] of rowEvidencePaths[surface].entries()) {
    await fs.writeFile(rowPaths.screenshotBefore, pngFixture(`${surface}-row-${index}-before`));
    await fs.writeFile(rowPaths.screenshotAfter, pngFixture(`${surface}-row-${index}-after`));
    await fs.writeFile(rowPaths.accessibilityBefore, `AX before evidence for ${surface} row ${index}\nrole=button\n`);
    await fs.writeFile(rowPaths.accessibilityAfter, `AX after evidence for ${surface} row ${index}\nrole=button\n`);
    await fs.writeFile(rowPaths.runtime, `Runtime evidence for ${surface} row ${index}\nstatus=pass\n`);
  }
}

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
    tabRoutes: structuredClone(publicTabRoutes),
    asset: { ...publicAsset },
    completedAt: '2026-08-09T00:03:00.000Z',
  };
  return state;
}

function evidence(surface, overrides = {}) {
  const coverageBytes = coverageMatrixBytes(surface);
  return {
    surface,
    observedAt: '2026-08-09T00:04:00.000Z',
    commit: identity.commit,
    version: identity.version,
    packageSha256,
    summary: `Observed ${surface} release evidence in the deployed Teams app.`,
    screenshotBeforePath: surfaceBeforePaths[surface],
    screenshotAfterPath: surfaceAfterPaths[surface],
    accessibilityPath: surfaceAccessibilityPaths[surface],
    runtimeLogPath: surfaceRuntimePaths[surface],
    coverage: {
      matrixPath: surfaceCoveragePaths[surface],
      matrixSha256: crypto.createHash('sha256').update(coverageBytes).digest('hex'),
      commit: identity.commit,
      version: identity.version,
      totalRows: 4,
      passedRows: 4,
      notApplicableRows: 0,
      blockedRows: 0,
      unverifiedRows: 0,
    },
    ...(surface === 'mobile' ? { userConfirmed: true } : {}),
    artifactPaths: [surfaceArtifactPaths[surface]],
    ...overrides,
  };
}

function isEvidenceFile(surface, candidate) {
  return new Set([
    surfaceBeforePaths[surface],
    surfaceAfterPaths[surface],
    surfaceAccessibilityPaths[surface],
    surfaceRuntimePaths[surface],
    surfaceCoveragePaths[surface],
  ]).has(candidate);
}

const invalidRowCoveragePath = path.join(tempDir, 'portal-row-invalid-coverage.md');
const invalidRowCoverageBytes = coverageMatrixBytes('portal', {
  mutateRow: (row, index) => index === 0
    ? { ...row, visibleControl: { ...row.visibleControl, separateFromServerResult: false } }
    : row,
});
await fs.writeFile(invalidRowCoveragePath, invalidRowCoverageBytes);
const validPortalEvidence = evidence('portal');
assert.throws(
  () => validateEvidence({
    ...validPortalEvidence,
    coverage: {
      ...validPortalEvidence.coverage,
      matrixPath: invalidRowCoveragePath,
      matrixSha256: crypto.createHash('sha256').update(invalidRowCoverageBytes).digest('hex'),
    },
  }, machineReadyState(), {
    fileExists: () => true,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /row validation|separateFromServerResult|portal-row-0/i,
  'a row-level UI matrix defect must fail even when aggregate row counts remain unchanged',
);

const mismatchedSourceCommitPath = path.join(tempDir, 'portal-source-commit-mismatch.md');
const mismatchedSourceCommitBytes = coverageMatrixBytes('portal', { sourceCommit: 'f'.repeat(40) });
await fs.writeFile(mismatchedSourceCommitPath, mismatchedSourceCommitBytes);
assert.throws(
  () => validateEvidence({
    ...validPortalEvidence,
    coverage: {
      ...validPortalEvidence.coverage,
      matrixPath: mismatchedSourceCommitPath,
      matrixSha256: crypto.createHash('sha256').update(mismatchedSourceCommitBytes).digest('hex'),
    },
  }, machineReadyState(), {
    fileExists: () => true,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /sourceCommit|release identity|release run.*commit/i,
  'coverage matrix sourceCommit must equal the release identity commit',
);

for (const [artifactLabel, mutateRow] of [
  ['screenshot', (row, index) => index === 1
    ? { ...row, screenshotBefore: { ...row.screenshotBefore, path: rowEvidencePaths.portal[0].screenshotBefore } }
    : row],
  ['accessibility', (row, index) => index === 1
    ? {
      ...row,
      accessibilityEvidence: {
        ...row.accessibilityEvidence,
        before: { ...row.accessibilityEvidence.before, path: rowEvidencePaths.portal[0].accessibilityBefore },
      },
    }
    : row],
  ['runtime', (row, index) => index === 1
    ? { ...row, runtimeEvidence: { ...row.runtimeEvidence, path: rowEvidencePaths.portal[0].runtime } }
    : row],
]) {
  const duplicateRowCoveragePath = path.join(tempDir, `portal-duplicate-${artifactLabel}.md`);
  const duplicateRowCoverageBytes = coverageMatrixBytes('portal', { mutateRow });
  await fs.writeFile(duplicateRowCoveragePath, duplicateRowCoverageBytes);
  assert.throws(
    () => validateEvidence({
      ...validPortalEvidence,
      coverage: {
        ...validPortalEvidence.coverage,
        matrixPath: duplicateRowCoveragePath,
        matrixSha256: crypto.createHash('sha256').update(duplicateRowCoverageBytes).digest('hex'),
      },
    }, machineReadyState(), {
      fileExists: () => true,
      now: new Date('2026-08-09T00:05:00.000Z'),
    }),
    /duplicate|reus|same.*(?:path|artifact)|artifact.*(?:path|row)/i,
    `a ${artifactLabel} artifact cannot be reused across matrix rows`,
  );
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
    fileExists: (candidate) => isEvidenceFile('portal', candidate),
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
  fileExists: (candidate) => isEvidenceFile('portal', candidate),
  now: new Date('2026-08-09T00:05:00.000Z'),
});
assert.throws(
  () => validateEvidence(evidence('portal', { screenshotBeforePath: undefined }), machineReady, {
    fileExists: (candidate) => isEvidenceFile('portal', candidate),
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /screenshotBefore|before.*after/i,
  'a legacy single-image proof cannot satisfy the release evidence contract',
);
assert.throws(
  () => validateEvidence(evidence('portal', { coverage: { ...evidence('portal').coverage, blockedRows: 1, passedRows: 3 } }), machineReady, {
    fileExists: (candidate) => isEvidenceFile('portal', candidate),
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /coverage|blocked|passed/i,
  'a matrix with blocked rows cannot satisfy the release evidence contract',
);
assert.throws(
  () => validateEvidence(evidence('portal', { observedAt: '2026-08-09T00:02:59.999Z' }), machineReady, {
    fileExists: (candidate) => isEvidenceFile('portal', candidate),
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /portal.*public|public.*portal|prerequisite.*time/i,
  'portal evidence must be observed after the public gate completes',
);
assert.deepEqual(Object.keys(portalEvidence).sort(), [
  'accessibilityPath',
  'artifactPaths',
  'artifacts',
  'commit',
  'coverage',
  'observedAt',
  'packageSha256',
  'runtimeLogPath',
  'screenshotAfterPath',
  'screenshotBeforePath',
  'summary',
  'supportingArtifacts',
  'surface',
  'version',
]);
assert.deepEqual(portalEvidence.artifacts.map(({ path: artifactPathValue, role, width, height }) => ({
  path: artifactPathValue,
  role,
  width,
  height,
})), [
  { path: surfaceBeforePaths.portal, role: 'screenshot-before', width: 1, height: 1 },
  { path: artifactPath, role: 'screenshot-after', width: 1, height: 1 },
]);
assert.equal(applyEvidence(machineReady, portalEvidence).status, 'PORTAL_READY');
const portalReady = applyEvidence(machineReady, portalEvidence);
const scopedPortalCoveragePath = path.join(tempDir, 'portal-scoped-coverage.md');
const scopedPortalCoverageBytes = coverageMatrixBytes('portal', { evidenceScope: 'portal' });
await fs.writeFile(scopedPortalCoveragePath, scopedPortalCoverageBytes);
assert.throws(
  () => validateEvidence(evidence('portal', {
    coverage: {
      ...evidence('portal').coverage,
      scope: 'portal',
      matrixPath: scopedPortalCoveragePath,
      matrixSha256: crypto.createHash('sha256').update(scopedPortalCoverageBytes).digest('hex'),
    },
  }), machineReady, {
    fileExists: () => true,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /full.*coverage|coverage.*full|scope/i,
  'surface-scoped evidence cannot bypass the full UI matrix contract',
);
const scopedPortalState = applyEvidence(machineReady, {
  ...portalEvidence,
  coverage: { ...portalEvidence.coverage, scope: 'portal' },
});
assert.equal(scopedPortalState.status, 'PUBLIC_READY');
assert.ok(missingGates(scopedPortalState).includes('PORTAL_READY'));
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
      fileExists: (candidate) => candidate === fakeArtifactPath || isEvidenceFile(surface, candidate),
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
assert.throws(
  () => validateEvidence(evidence('mobile', {
    userConfirmed: true,
    coverage: { ...evidence('mobile').coverage, scope: 'mobile' },
  }), completeState, {
    fileExists: () => true,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /mobile.*full|full.*coverage/i,
  'mobile evidence cannot finish the release with a surface-only matrix',
);
const terminalCompleteState = { ...completeState, status: 'COMPLETE' };
assert.equal(deriveStatus(terminalCompleteState), 'COMPLETE', 'a completed release remains complete in status views');
assert.equal(deriveStatus({ ...completeState, status: 'SUPERSEDED' }), 'SUPERSEDED', 'a superseded release remains terminal');
const replacementPortalEvidence = validateEvidence(evidence('portal', {
  observedAt: '2026-08-09T00:05:00.000Z',
}), completeState, {
  fileExists: (candidate) => isEvidenceFile('portal', candidate),
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
  tabRoutes: structuredClone(publicTabRoutes),
  asset: { ...publicAsset },
}));
assert.throws(
  () => assertPublicProbeMatches(completeState, {
    version: identity.version,
    packageSha256,
    tab: { finalUrl: 'https://wrong.example.com/tabs/home' },
    tabRoutes: structuredClone(publicTabRoutes),
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
    tabRoutes: structuredClone(publicTabRoutes),
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
    tabRoutes: structuredClone(publicTabRoutes),
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
      tabRoutes: structuredClone(publicTabRoutes),
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
      tabRoutes: structuredClone(publicTabRoutes),
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
    { tabRoutes: structuredClone(publicTabRoutes) },
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
assert.deepEqual(publicSummary.tabRoutes, publicTabRoutes);
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
const statusPayload = JSON.parse(statusResult.stdout);
assert.equal(statusPayload.status, 'IN_PROGRESS');
assert.deepEqual(statusPayload.missingGates, [
  'PORTAL_READY',
  'INSTALLED_READY',
  'DESKTOP_READY',
  'MOBILE_READY',
]);
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
const supersedeResult = runCli(['supersede', '--reason', 'source commit changed after the previous run']);
assert.equal(supersedeResult.status, 0);
assert.match(supersedeResult.stdout, /SUPERSEDED/);
const supersededStatus = runCli(['status']);
assert.equal(supersededStatus.status, 0);
assert.match(supersededStatus.stdout, /SUPERSEDED/);
const restartedResult = runCli(['start']);
assert.equal(restartedResult.status, 0);
assert.match(restartedResult.stdout, /MACHINE_READY/);

await fs.rm(tempDir, { recursive: true, force: true });
console.log('Release loop contract tests passed.');
