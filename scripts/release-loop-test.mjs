import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

import {
  applyEvidence,
  applyPhaseSuccess,
  assertReleaseUpdateCompletionContract,
  assertCurrentReleaseArtifacts,
  assertPackageIntegrity,
  assertPublicProbeMatches,
  completionMessage,
  completeRun,
  completeReleaseState,
  createGitSnapshot,
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
  assertReleaseVersionAdvanced,
  readPreviousSourceVersion,
  readSourceVersion,
  splitBrowserEvidenceInput,
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

assert.doesNotThrow(
  () => assertReleaseVersionAdvanced('1.0.62', '1.0.61'),
  'a release version must advance from the immediately previous source version',
);
assert.throws(
  () => assertReleaseVersionAdvanced('1.0.61', '1.0.61'),
  (error) => error?.code === 'EVERSIONNOTBUMPED' && /1\.0\.61.*1\.0\.61/.test(error.message),
  'a same-version source commit must be rejected before any package or portal work',
);
assert.throws(
  () => assertReleaseVersionAdvanced('1.0.60', '1.0.61'),
  (error) => error?.code === 'EVERSIONNOTBUMPED',
  'a release version cannot move backwards',
);

{
  const sourceCommit = '0123456789abcdef0123456789abcdef01234567';
  const gitCalls = [];
  const snapshot = createGitSnapshot({
    rootDir: '/repo',
    env: { TEAMS_SOURCE_COMMIT: sourceCommit },
    verifySource(rootDir, options) {
      assert.equal(rootDir, '/repo');
      assert.equal(options.commitOid, sourceCommit);
      return { verificationMode: 'worktree-index-commit', commitOid: sourceCommit };
    },
    runGit(args) {
      gitCalls.push(args);
      if (args[0] === 'ls-files') return 'user artifact.txt\0';
      throw new Error(`unexpected Git call: ${args.join(' ')}`);
    },
  });
  assert.equal(snapshot.commit, sourceCommit);
  assert.equal(snapshot.shortCommit, sourceCommit.slice(0, 7));
  assert.deepEqual(snapshot.untracked, ['?? user artifact.txt']);
  assert.equal(snapshot.dirty, false);
  assert.deepEqual(gitCalls, [['ls-files', '--others', '--exclude-standard', '-z', '--']]);

  const versionCalls = [];
  assert.equal(readSourceVersion(sourceCommit, {
    rootDir: '/repo',
    runGit(args) {
      versionCalls.push(args);
      return JSON.stringify({ version: '1.2.3' });
    },
  }), '1.2.3');
  assert.deepEqual(versionCalls, [['show', `${sourceCommit}:appPackage/manifest.json`]]);

  const previousVersionCalls = [];
  assert.deepEqual(readPreviousSourceVersion(sourceCommit, {
    rootDir: '/repo',
    runGit(args) {
      previousVersionCalls.push(args);
      if (args[0] === 'rev-parse') return 'fedcba9876543210fedcba9876543210fedcba98\n';
      if (args[0] === 'show') return JSON.stringify({ version: '1.2.2' });
      throw new Error(`unexpected Git call: ${args.join(' ')}`);
    },
  }), {
    commit: 'fedcba9876543210fedcba9876543210fedcba98',
    version: '1.2.2',
  });
  assert.deepEqual(previousVersionCalls, [
    ['rev-parse', `${sourceCommit}^`],
    ['show', 'fedcba9876543210fedcba9876543210fedcba98:appPackage/manifest.json'],
  ]);
}

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
await assert.rejects(
  () => runGatePhase('package', {
    runGate: async () => ({
      code: 1,
      stdout: JSON.stringify({ status: 'BLOCKED', blocker: { code: 'EPROCESSREAPTIMEOUT' } }),
      stderr: '',
    }),
  }),
  (error) => error?.code === 'EPROCESSREAPTIMEOUT',
  'the outer release loop must preserve a bounded child failure code for retry/reporting',
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
const fullRowEvidencePaths = Object.fromEntries(
  Object.keys(surfaceArtifactPaths).map((surface) => [surface, Array.from({ length: 4 }, (_, index) => ({
    screenshotBefore: path.join(tempDir, `full-${surface}-row-${index}-before.png`),
    screenshotAfter: path.join(tempDir, `full-${surface}-row-${index}-after.png`),
    accessibilityBefore: path.join(tempDir, `full-${surface}-row-${index}-accessibility-before.txt`),
    accessibilityAfter: path.join(tempDir, `full-${surface}-row-${index}-accessibility-after.txt`),
    runtime: path.join(tempDir, `full-${surface}-row-${index}-runtime.log`),
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

const scopedRequiredCoverageKeys = {
  portal: ['deep-link.trailing-slash', 'deep-link.static-tab'],
  installed: ['chat.install', 'deep-link.open-tab-action', 'chat.card.tab-link'],
  desktop: [
    'chat.card.no-top-level-duplicate',
    'chat.commands.status.summary',
    'personal.home.hero',
    'personal.home.runtime-panel',
  ],
  mobile: [
    'personal.mobile.narrow-home',
    'personal.mobile.narrow-card',
    'personal.auth.expired',
    'personal.auth.retry',
  ],
};

function rowEvidenceFixtureBytes(surface, index, namespace = surface) {
  return {
    screenshotBefore: pngFixture(`${namespace}-row-${index}-before`),
    screenshotAfter: pngFixture(`${namespace}-row-${index}-after`),
    accessibilityBefore: Buffer.from(`AX before evidence for ${namespace} row ${index}\nrole=button\n`),
    accessibilityAfter: Buffer.from(`AX after evidence for ${namespace} row ${index}\nrole=button\n`),
    runtime: Buffer.from(`Runtime evidence for ${namespace} row ${index}\nstatus=pass\n`),
  };
}

function coverageMatrixBytes(surface, {
  mutateRow,
  mutateMatrix,
  evidenceScope,
  sourceCommit = identity.commit,
} = {}) {
  const matrixEvidence = (evidencePath, reason, source) => ({
    fresh: true,
    state: 'captured',
    path: evidencePath,
    sha256: crypto.createHash('sha256').update(source).digest('hex'),
    bytes: source.length,
    capturedAt: '2026-08-09T00:04:00.000Z',
    reason,
    releaseIdentity: {
      appVersion: identity.version,
      sourceCommit,
      packageSha256,
      installedVersion: null,
    },
  });
  const effectiveScope = evidenceScope ?? surface;
  const matrixSurfaces = effectiveScope === 'full'
    ? ['portal', 'installed', 'desktop', 'mobile']
    : [surface];
  const rows = matrixSurfaces.flatMap((rowSurface) => Array.from({ length: 4 }, (_, index) => {
    const fullScope = effectiveScope === 'full';
    const rowPaths = (fullScope ? fullRowEvidencePaths : rowEvidencePaths)[rowSurface][index];
    const rowBytes = rowEvidenceFixtureBytes(rowSurface, index, fullScope ? `full-${rowSurface}` : rowSurface);
    const row = {
      id: `${rowSurface}-row-${index}`,
      feature: `fixture feature ${index}`,
      evidenceSurface: rowSurface,
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
      screenshotBefore: matrixEvidence(
        rowPaths.screenshotBefore,
        'fixture before screenshot captured',
        rowBytes.screenshotBefore,
      ),
      screenshotAfter: matrixEvidence(
        rowPaths.screenshotAfter,
        'fixture after screenshot captured',
        rowBytes.screenshotAfter,
      ),
      accessibilityEvidence: {
        schema: 'paired-before-after-v1',
        before: matrixEvidence(
          rowPaths.accessibilityBefore,
          'fixture accessibility before evidence captured',
          rowBytes.accessibilityBefore,
        ),
        after: matrixEvidence(
          rowPaths.accessibilityAfter,
          'fixture accessibility after evidence captured',
          rowBytes.accessibilityAfter,
        ),
      },
      runtimeEvidence: matrixEvidence(
        rowPaths.runtime,
        'fixture runtime evidence captured',
        rowBytes.runtime,
      ),
      result: {
        status: 'PASS',
        reason: 'fixture row passed with fresh evidence',
        visibleControl: 'the fixture control was visible',
        serverAction: 'the fixture server action returned its result',
        nextAction: 'continue to the next fixture row',
      },
      coverage: [],
    };
    return row;
  }));

  for (const rowSurface of matrixSurfaces) {
    for (const [index, key] of scopedRequiredCoverageKeys[rowSurface].entries()) {
      rows.find((row) => row.evidenceSurface === rowSurface && row.id.endsWith(`-${index}`)).coverage.push(key);
    }
  }
  const requiredKeys = effectiveScope === 'full'
    ? [...REQUIRED_COVERAGE_KEYS]
    : [...scopedRequiredCoverageKeys[surface]];
  for (const [keyIndex, key] of requiredKeys.entries()) {
    if (rows.some((row) => row.coverage.includes(key))) continue;
    rows[keyIndex % rows.length].coverage.push(key);
  }
  for (const row of rows) {
    if (row.coverage.length === 0) row.coverage.push(requiredKeys[0]);
  }
  const mutatedRows = rows.map((row, index) => mutateRow ? mutateRow(row, index) : row);
  const matrix = {
    schemaVersion: 2,
    matrixId: `fixture-${surface}`,
    evidenceScope: effectiveScope,
    releaseIdentity: {
      appVersion: identity.version,
      sourceCommit,
      packageSha256,
      installedVersion: null,
    },
    evidencePolicy: { fixture: 'fresh evidence is required for every PASS row' },
    coverage: {
      count: mutatedRows.length,
      requiredKeys,
    },
    rows: mutatedRows,
  };
  return Buffer.from(JSON.stringify(mutateMatrix ? mutateMatrix(structuredClone(matrix)) : matrix) + '\n');
}

for (const surface of Object.keys(surfaceCoveragePaths)) {
  for (const [index, rowPaths] of rowEvidencePaths[surface].entries()) {
    const rowBytes = rowEvidenceFixtureBytes(surface, index);
    await fs.writeFile(rowPaths.screenshotBefore, rowBytes.screenshotBefore);
    await fs.writeFile(rowPaths.screenshotAfter, rowBytes.screenshotAfter);
    await fs.writeFile(rowPaths.accessibilityBefore, rowBytes.accessibilityBefore);
    await fs.writeFile(rowPaths.accessibilityAfter, rowBytes.accessibilityAfter);
    await fs.writeFile(rowPaths.runtime, rowBytes.runtime);
  }
  for (const [index, rowPaths] of fullRowEvidencePaths[surface].entries()) {
    const rowBytes = rowEvidenceFixtureBytes(surface, index, `full-${surface}`);
    await fs.writeFile(rowPaths.screenshotBefore, rowBytes.screenshotBefore);
    await fs.writeFile(rowPaths.screenshotAfter, rowBytes.screenshotAfter);
    await fs.writeFile(rowPaths.accessibilityBefore, rowBytes.accessibilityBefore);
    await fs.writeFile(rowPaths.accessibilityAfter, rowBytes.accessibilityAfter);
    await fs.writeFile(rowPaths.runtime, rowBytes.runtime);
  }
  await fs.writeFile(
    surfaceCoveragePaths[surface],
    coverageMatrixBytes(surface, { evidenceScope: surface === 'mobile' ? 'full' : surface }),
  );
}

function machineReadyState() {
  const state = createInitialState(identity);
  state.machine = { status: 'READY', sourceCommit: identity.commit, completedAt: '2026-08-09T00:01:00.000Z' };
  state.package = {
    status: 'READY',
    sourceCommit: identity.commit,
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
    sourceCommit: identity.commit,
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
  const scope = surface === 'mobile' ? 'full' : surface;
  const coverageBytes = coverageMatrixBytes(surface, { evidenceScope: scope });
  const coverageMatrix = JSON.parse(coverageBytes.toString('utf8'));
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
      scope,
      matrixPath: surfaceCoveragePaths[surface],
      matrixSha256: crypto.createHash('sha256').update(coverageBytes).digest('hex'),
      commit: identity.commit,
      version: identity.version,
      totalRows: coverageMatrix.rows.length,
      passedRows: coverageMatrix.rows.length,
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
    ...rowEvidencePaths[surface].flatMap((rowPaths) => Object.values(rowPaths)),
    ...fullRowEvidencePaths[surface].flatMap((rowPaths) => Object.values(rowPaths)),
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
const reviewGuardFailures = [];
function expectReleaseGuard(label, operation, expectedError) {
  try {
    operation();
    reviewGuardFailures.push(`${label}: invalid evidence was accepted`);
  } catch (error) {
    if (!expectedError.test(String(error?.message ?? error))) {
      reviewGuardFailures.push(`${label}: wrong failure: ${String(error?.message ?? error)}`);
    }
  }
}

const topLevelCopyPath = path.join(tempDir, 'portal-top-level-copy.png');
await fs.writeFile(topLevelCopyPath, surfaceBeforeBytes.portal);
expectReleaseGuard(
  'MP-4 top-level content copy before identity deduplication',
  () => validateEvidence({
    ...validPortalEvidence,
    artifactPaths: [topLevelCopyPath],
  }, machineReadyState(), {
    fileExists: () => true,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /reus|identical|content.*hash|SHA-256/i,
);

expectReleaseGuard(
  'MP-4 top-level artifact cannot reuse a nested matrix artifact',
  () => validateEvidence({
    ...validPortalEvidence,
    artifactPaths: [rowEvidencePaths.portal[0].screenshotBefore],
  }, machineReadyState(), {
    fileExists: () => true,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /reus|nested|matrix|same.*artifact/i,
);

const tooManyTopLevelArtifactPaths = Array.from(
  { length: 65 },
  (_, index) => path.join(tempDir, `top-level-count-${index}.png`),
);
let countBoundReads = 0;
expectReleaseGuard(
  'MP-4 top-level artifact count preflight',
  () => validateEvidence({
    ...validPortalEvidence,
    artifactPaths: tooManyTopLevelArtifactPaths,
  }, machineReadyState(), {
    fileExists: () => true,
    statArtifact: () => ({ size: surfaceArtifactBytes.portal.length, dev: 1, ino: 100, isFile: () => true }),
    readArtifact: () => {
      countBoundReads += 1;
      return surfaceArtifactBytes.portal;
    },
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /top-level.*count|artifact.*count|count.*limit/i,
);
if (countBoundReads > 0) reviewGuardFailures.push('MP-4 top-level count preflight read an artifact before rejecting');

const oversizedTopLevelPath = path.join(tempDir, 'top-level-oversized.png');
await fs.writeFile(oversizedTopLevelPath, surfaceArtifactBytes.portal);
let oversizedTopLevelReads = 0;
expectReleaseGuard(
  'MP-4 top-level per-file size preflight',
  () => validateEvidence({
    ...validPortalEvidence,
    artifactPaths: [oversizedTopLevelPath],
  }, machineReadyState(), {
    fileExists: () => true,
    statArtifact: (candidate) => candidate === oversizedTopLevelPath
      ? { size: 20 * 1024 * 1024 + 1, dev: 1, ino: 200, isFile: () => true }
      : fsSync.statSync(candidate),
    readArtifact: (candidate) => {
      if (candidate === oversizedTopLevelPath) oversizedTopLevelReads += 1;
      return fsSync.readFileSync(candidate);
    },
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /top-level|file size|20 MiB|size limit/i,
);
if (oversizedTopLevelReads > 0) reviewGuardFailures.push('MP-4 top-level per-file preflight read an oversized artifact');

const aggregateTopLevelPaths = [
  path.join(tempDir, 'top-level-aggregate-1.png'),
  path.join(tempDir, 'top-level-aggregate-2.png'),
];
for (const aggregatePath of aggregateTopLevelPaths) await fs.writeFile(aggregatePath, surfaceArtifactBytes.portal);
let aggregateTopLevelReads = 0;
const aggregateTopLevelSet = new Set([
  ...aggregateTopLevelPaths,
  surfaceBeforePaths.portal,
  surfaceAfterPaths.portal,
]);
expectReleaseGuard(
  'MP-4 top-level aggregate byte preflight',
  () => validateEvidence({
    ...validPortalEvidence,
    artifactPaths: aggregateTopLevelPaths,
  }, machineReadyState(), {
    fileExists: () => true,
    statArtifact: (candidate) => aggregateTopLevelSet.has(candidate)
      ? { size: 20 * 1024 * 1024, dev: 3, ino: aggregateTopLevelSet.has(candidate) ? [...aggregateTopLevelSet].indexOf(candidate) + 1 : 1, isFile: () => true }
      : fsSync.statSync(candidate),
    readArtifact: (candidate) => {
      if (aggregateTopLevelSet.has(candidate)) aggregateTopLevelReads += 1;
      return fsSync.readFileSync(candidate);
    },
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /aggregate|byte budget|total evidence.*size|64 MiB/i,
);
if (aggregateTopLevelReads > 0) reviewGuardFailures.push('MP-4 top-level aggregate preflight read artifacts before rejecting');

const portalOnlyFullCoveragePath = path.join(tempDir, 'full-scope-portal-only.md');
const portalOnlyFullCoverageBytes = coverageMatrixBytes('portal', {
  evidenceScope: 'full',
  mutateMatrix: (matrix) => ({
    ...matrix,
    rows: matrix.rows.map((row) => ({ ...row, evidenceSurface: 'portal' })),
  }),
});
await fs.writeFile(portalOnlyFullCoveragePath, portalOnlyFullCoverageBytes);
expectReleaseGuard(
  'MP-4 full scope surface completeness',
  () => validateEvidence({
    ...validPortalEvidence,
    coverage: {
      ...validPortalEvidence.coverage,
      scope: 'full',
      matrixPath: portalOnlyFullCoveragePath,
      matrixSha256: crypto.createHash('sha256').update(portalOnlyFullCoverageBytes).digest('hex'),
    },
  }, machineReadyState(), {
    fileExists: () => true,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /full.*(?:surface|portal|installed|desktop|mobile)|missing.*surface/i,
);

const duplicateContentPath = path.join(tempDir, 'portal-row-duplicate-content.png');
const duplicateContentBytes = await fs.readFile(rowEvidencePaths.portal[0].screenshotBefore);
await fs.writeFile(duplicateContentPath, duplicateContentBytes);
const duplicateContentCoveragePath = path.join(tempDir, 'portal-duplicate-content.md');
const duplicateContentCoverageBytes = coverageMatrixBytes('portal', {
  mutateRow: (row, index) => index === 1
    ? {
      ...row,
      screenshotBefore: {
        ...row.screenshotBefore,
        path: duplicateContentPath,
        sha256: crypto.createHash('sha256').update(duplicateContentBytes).digest('hex'),
      },
    }
    : row,
});
await fs.writeFile(duplicateContentCoveragePath, duplicateContentCoverageBytes);
expectReleaseGuard(
  'MP-4 identical nested bytes under different paths',
  () => validateEvidence({
    ...validPortalEvidence,
    coverage: {
      ...validPortalEvidence.coverage,
      matrixPath: duplicateContentCoveragePath,
      matrixSha256: crypto.createHash('sha256').update(duplicateContentCoverageBytes).digest('hex'),
    },
  }, machineReadyState(), {
    fileExists: () => true,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /duplicate|reus|identical|content.*hash|SHA-256.*reus/i,
);

for (const [aliasKind, createAlias] of [
  ['symlink', async (aliasPath, targetPath) => fs.symlink(targetPath, aliasPath)],
  ['hardlink', async (aliasPath, targetPath) => fs.link(targetPath, aliasPath)],
]) {
  const aliasPath = path.join(tempDir, `portal-row-${aliasKind}-alias.png`);
  const aliasTarget = rowEvidencePaths.portal[0].screenshotBefore;
  const aliasBytes = await fs.readFile(aliasTarget);
  await createAlias(aliasPath, aliasTarget);
  const aliasCoveragePath = path.join(tempDir, `portal-${aliasKind}-alias.md`);
  const aliasCoverageBytes = coverageMatrixBytes('portal', {
    mutateRow: (row, index) => index === 1
      ? {
        ...row,
        screenshotBefore: {
          ...row.screenshotBefore,
          path: aliasPath,
          sha256: 'e'.repeat(64),
          bytes: aliasBytes.length,
        },
      }
      : row,
  });
  await fs.writeFile(aliasCoveragePath, aliasCoverageBytes);
  expectReleaseGuard(
    `MP-4 ${aliasKind} canonical artifact alias`,
    () => validateEvidence({
      ...validPortalEvidence,
      coverage: {
        ...validPortalEvidence.coverage,
        matrixPath: aliasCoveragePath,
        matrixSha256: crypto.createHash('sha256').update(aliasCoverageBytes).digest('hex'),
      },
    }, machineReadyState(), {
      fileExists: () => true,
      now: new Date('2026-08-09T00:05:00.000Z'),
    }),
    /reus|canonical|inode|same.*artifact/i,
  );
}

const escapedEvidenceDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-release-loop-outside-'));
const escapedEvidenceTarget = path.join(escapedEvidenceDirectory, 'outside.png');
const escapedEvidenceLink = path.join(tempDir, 'escaped-row-evidence.png');
const escapedEvidenceBytes = pngFixture('outside-evidence-root');
await fs.writeFile(escapedEvidenceTarget, escapedEvidenceBytes);
await fs.symlink(escapedEvidenceTarget, escapedEvidenceLink);
const escapedCoveragePath = path.join(tempDir, 'portal-symlink-escape.md');
const escapedCoverageBytes = coverageMatrixBytes('portal', {
  mutateRow: (row, index) => index === 1
    ? {
      ...row,
      screenshotBefore: {
        ...row.screenshotBefore,
        path: escapedEvidenceLink,
        sha256: crypto.createHash('sha256').update(escapedEvidenceBytes).digest('hex'),
      },
    }
    : row,
});
await fs.writeFile(escapedCoveragePath, escapedCoverageBytes);
expectReleaseGuard(
  'MP-4 symlink evidence-root escape',
  () => validateEvidence({
    ...validPortalEvidence,
    coverage: {
      ...validPortalEvidence.coverage,
      matrixPath: escapedCoveragePath,
      matrixSha256: crypto.createHash('sha256').update(escapedCoverageBytes).digest('hex'),
    },
  }, machineReadyState(), {
    fileExists: () => true,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /evidence root|outside.*root|symlink.*escape|path.*escape/i,
);

const traversalCoveragePath = path.join(tempDir, 'portal-path-traversal.md');
const traversalCoverageBytes = coverageMatrixBytes('portal', {
  mutateRow: (row, index) => index === 2
    ? {
      ...row,
      screenshotBefore: {
        ...row.screenshotBefore,
        path: path.relative(tempDir, escapedEvidenceTarget),
        sha256: crypto.createHash('sha256').update(escapedEvidenceBytes).digest('hex'),
      },
    }
    : row,
});
await fs.writeFile(traversalCoveragePath, traversalCoverageBytes);
expectReleaseGuard(
  'MP-4 relative path traversal outside evidence root',
  () => validateEvidence({
    ...validPortalEvidence,
    coverage: {
      ...validPortalEvidence.coverage,
      matrixPath: traversalCoveragePath,
      matrixSha256: crypto.createHash('sha256').update(traversalCoverageBytes).digest('hex'),
    },
  }, machineReadyState(), {
    fileExists: () => true,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /evidence root|outside.*root|path traversal|path.*escape/i,
);

let oversizedArtifactRead = false;
expectReleaseGuard(
  'MP-4 file-size preflight before nested read',
  () => validateEvidence(validPortalEvidence, machineReadyState(), {
    fileExists: () => true,
    statArtifact: (candidate) => candidate === rowEvidencePaths.portal[0].screenshotBefore
      ? { size: 20 * 1024 * 1024 + 1, dev: 1, ino: 999, isFile: () => true }
      : fsSync.statSync(candidate),
    readArtifact: (candidate) => {
      if (candidate === rowEvidencePaths.portal[0].screenshotBefore) oversizedArtifactRead = true;
      return fsSync.readFileSync(candidate);
    },
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /preflight|file size|20 MiB|size limit/i,
);
if (oversizedArtifactRead) {
  reviewGuardFailures.push('MP-4 file-size preflight before nested read: oversized artifact was read');
}
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

const abbreviatedSourceCommitPath = path.join(tempDir, 'portal-source-commit-abbreviated.md');
const abbreviatedSourceCommitBytes = coverageMatrixBytes('portal', { sourceCommit: identity.shortCommit });
await fs.writeFile(abbreviatedSourceCommitPath, abbreviatedSourceCommitBytes);
const abbreviatedSourceState = machineReadyState();
abbreviatedSourceState.commit = identity.shortCommit;
abbreviatedSourceState.shortCommit = identity.shortCommit;
abbreviatedSourceState.machine.sourceCommit = identity.shortCommit;
abbreviatedSourceState.package.sourceCommit = identity.shortCommit;
abbreviatedSourceState.public.sourceCommit = identity.shortCommit;
assert.throws(
  () => validateEvidence({
    ...validPortalEvidence,
    commit: identity.shortCommit,
    coverage: {
      ...validPortalEvidence.coverage,
      matrixPath: abbreviatedSourceCommitPath,
      matrixSha256: crypto.createHash('sha256').update(abbreviatedSourceCommitBytes).digest('hex'),
      commit: identity.shortCommit,
    },
  }, abbreviatedSourceState, {
    fileExists: () => true,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /sourceCommit|full Git OID|release identity/i,
  'coverage matrix sourceCommit must reject abbreviated Git OIDs even when the release state repeats them',
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

for (const [artifactLabel, artifactPath, tamperedBytes] of [
  ['screenshot', rowEvidencePaths.portal[0].screenshotBefore, pngFixture('tampered-row-screenshot')],
  ['accessibility', rowEvidencePaths.portal[0].accessibilityBefore, Buffer.from('tampered AX evidence\n')],
  ['runtime', rowEvidencePaths.portal[0].runtime, Buffer.from('tampered runtime evidence\n')],
]) {
  const originalBytes = await fs.readFile(artifactPath);
  await fs.writeFile(artifactPath, tamperedBytes);
  try {
    assert.throws(
      () => validateEvidence(validPortalEvidence, machineReadyState(), {
        fileExists: () => true,
        now: new Date('2026-08-09T00:05:00.000Z'),
      }),
      /row.*(?:artifact|evidence).*(?:SHA-256|hash|byte)|(?:SHA-256|hash|byte).*row/i,
      `tampered row-level ${artifactLabel} evidence must fail content-integrity verification`,
    );
  } finally {
    await fs.writeFile(artifactPath, originalBytes);
  }
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
const browserEvidenceEnvelope = splitBrowserEvidenceInput({
  attestation: {
    surface: 'portal',
    runId: identity.runId,
    appId: 'e915b402-eed4-4ee2-ba1f-c31d75c870a5',
    version: identity.version,
    packageSha256,
    observedAt: '2026-08-09T00:04:00.000Z',
    titleBefore: 'Teams Admin Center',
    titleAfter: 'Teams Admin Center',
    observedAction: 'uploaded the verified package',
    observedResult: 'the published version was read back',
    tabIdBefore: 'release-loop-test-tab',
    tabIdAfter: 'release-loop-test-tab',
    urlBefore: 'https://admin.teams.microsoft.com/apps/example',
    urlAfter: 'https://admin.teams.microsoft.com/apps/example',
    submissionStatus: 'read-back-confirmed',
    remoteOperationIdUnavailableReason: 'fixture does not expose an operation ID',
  },
  evidence: evidence('portal'),
}, { requireFullEvidence: true });
assert.equal(browserEvidenceEnvelope.format, 'envelope');
assert.deepEqual(browserEvidenceEnvelope.evidence, evidence('portal'));
assert.deepEqual(
  validateEvidence(browserEvidenceEnvelope.evidence, machineReady, {
    fileExists: (candidate) => isEvidenceFile('portal', candidate),
    now: new Date('2026-08-09T00:05:00.000Z'),
  }).surface,
  'portal',
  'the release-loop child contract must validate the evidence member of a browser envelope, not the attestation member',
);
if (!Array.isArray(portalEvidence.matrixArtifacts) || portalEvidence.matrixArtifacts.length !== 20) {
  reviewGuardFailures.push('MP-4 nested artifact metadata persistence: expected 20 row artifacts');
} else if (portalEvidence.matrixArtifacts.some((artifact) => (
  typeof artifact.realPath !== 'string'
  || !Number.isSafeInteger(artifact.bytes)
  || !Number.isSafeInteger(artifact.device)
  || !Number.isSafeInteger(artifact.inode)
  || typeof artifact.rowId !== 'string'
  || artifact.evidenceSurface !== 'portal'
))) {
  reviewGuardFailures.push('MP-4 nested artifact metadata persistence: canonical identity fields are incomplete');
}
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
  'matrixArtifacts',
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
assert.equal(
  applyEvidence(machineReady, portalEvidence).evidence.portal.status,
  'READY',
  'applied surface evidence must retain READY so the resumable release updater can advance the phase',
);
const portalReady = applyEvidence(machineReady, portalEvidence);
const crossSurfaceNestedCopyPath = path.join(tempDir, 'installed-row-copy-of-portal.png');
const crossSurfaceNestedCopyBytes = await fs.readFile(rowEvidencePaths.portal[0].screenshotBefore);
await fs.writeFile(crossSurfaceNestedCopyPath, crossSurfaceNestedCopyBytes);
const crossSurfaceNestedCoveragePath = path.join(tempDir, 'installed-cross-surface-row-reuse.md');
const crossSurfaceNestedCoverageBytes = coverageMatrixBytes('installed', {
  mutateRow: (row, index) => index === 1
    ? {
      ...row,
      screenshotBefore: {
        ...row.screenshotBefore,
        path: crossSurfaceNestedCopyPath,
        sha256: crypto.createHash('sha256').update(crossSurfaceNestedCopyBytes).digest('hex'),
        bytes: crossSurfaceNestedCopyBytes.length,
      },
    }
    : row,
});
await fs.writeFile(crossSurfaceNestedCoveragePath, crossSurfaceNestedCoverageBytes);
expectReleaseGuard(
  'MP-4 nested artifact reuse across prior surfaces',
  () => validateEvidence(evidence('installed', {
    installedVersion: identity.version,
    coverage: {
      ...evidence('installed').coverage,
      matrixPath: crossSurfaceNestedCoveragePath,
      matrixSha256: crypto.createHash('sha256').update(crossSurfaceNestedCoverageBytes).digest('hex'),
    },
  }), portalReady, {
    fileExists: () => true,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /cross-surface|already used|reus|identical.*prior/i,
);
const scopedPortalCoveragePath = path.join(tempDir, 'portal-scoped-coverage.md');
const scopedPortalCoverageBytes = coverageMatrixBytes('portal', { evidenceScope: 'portal' });
await fs.writeFile(scopedPortalCoveragePath, scopedPortalCoverageBytes);
const scopedPortalEvidence = validateEvidence(evidence('portal', {
  coverage: {
    ...evidence('portal').coverage,
    scope: 'portal',
    matrixPath: scopedPortalCoveragePath,
    matrixSha256: crypto.createHash('sha256').update(scopedPortalCoverageBytes).digest('hex'),
  },
}), machineReady, {
  fileExists: () => true,
  now: new Date('2026-08-09T00:05:00.000Z'),
});
const scopedPortalState = applyEvidence(machineReady, scopedPortalEvidence);
assert.equal(scopedPortalState.status, 'PORTAL_READY');
assert.ok(!missingGates(scopedPortalState).includes('PORTAL_READY'));
const crossSurfacePortalCoveragePath = path.join(tempDir, 'portal-scoped-cross-surface-coverage.md');
const crossSurfacePortalCoverageBytes = coverageMatrixBytes('portal', {
  evidenceScope: 'portal',
  mutateRow: (row, index) => index === 0 ? { ...row, evidenceSurface: 'desktop' } : row,
});
await fs.writeFile(crossSurfacePortalCoveragePath, crossSurfacePortalCoverageBytes);
assert.throws(
  () => validateEvidence(evidence('portal', {
    coverage: {
      ...evidence('portal').coverage,
      scope: 'portal',
      matrixPath: crossSurfacePortalCoveragePath,
      matrixSha256: crypto.createHash('sha256').update(crossSurfacePortalCoverageBytes).digest('hex'),
    },
  }), machineReady, {
    fileExists: () => true,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /row.*(?:evidence )?surface|surface.*row|scope.*row/i,
  'a surface-scoped coverage matrix cannot contain a row captured for another evidence surface',
);
assert.throws(
  () => validateEvidence(evidence('portal', {
    coverage: {
      ...evidence('portal').coverage,
      scope: undefined,
      matrixPath: scopedPortalCoveragePath,
      matrixSha256: crypto.createHash('sha256').update(scopedPortalCoverageBytes).digest('hex'),
    },
  }), machineReady, {
    fileExists: () => true,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /scope/i,
  'omitting coverage.scope must not promote a surface-scoped matrix to full coverage',
);
assert.throws(
  () => validateEvidence(evidence('portal', {
    coverage: {
      ...evidence('portal').coverage,
      scope: 'desktop',
    },
  }), machineReady, {
    fileExists: () => true,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /scope.*does not match surface|surface.*scope/i,
  'surface-scoped evidence must match the evidence surface',
);
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
  () => validateEvidence({ ...evidence('portal'), surface: 'unknown' }, machineReady, {
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
      fileExists: (candidate) => candidate === fakeArtifactPath
        || Object.keys(surfaceArtifactPaths).some((candidateSurface) => isEvidenceFile(candidateSurface, candidate)),
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
  () => assertReleaseUpdateCompletionContract(completeState),
  /package\/public identity|Jira reconciliation|browser attestations/i,
  'raw completion must not bypass the resumable release:update contract',
);

const missingSupportingRoleState = structuredClone(completeState);
missingSupportingRoleState.evidence.portal.supportingArtifacts = missingSupportingRoleState.evidence.portal.supportingArtifacts
  .filter((artifact) => artifact.role !== 'accessibility');
expectReleaseGuard(
  'MP-4 completion requires the exact supporting artifact role set',
  () => reverifyEvidenceArtifacts(missingSupportingRoleState),
  /exact|supporting.*(?:role|artifact)|accessibility/i,
);

const wrongSupportingPathState = structuredClone(completeState);
const wrongSupportingPath = wrongSupportingPathState.evidence.portal.supportingArtifacts
  .find((artifact) => artifact.role === 'accessibility');
wrongSupportingPath.path = wrongSupportingPathState.evidence.portal.runtimeLogPath;
expectReleaseGuard(
  'MP-4 completion requires supporting artifact roles to use their declared paths',
  () => reverifyEvidenceArtifacts(wrongSupportingPathState),
  /exact|supporting.*path|accessibility/i,
);

for (const [surface, requiredKeys] of Object.entries(scopedRequiredCoverageKeys)) {
  if (surface === 'mobile') continue;
  const missingKey = requiredKeys.at(-1);
  const missingRequiredPath = path.join(tempDir, `${surface}-missing-required-row.md`);
  const missingRequiredBytes = coverageMatrixBytes(surface, {
    evidenceScope: surface,
    mutateRow: (row) => ({ ...row, coverage: row.coverage.filter((key) => key !== missingKey) }),
  });
  await fs.writeFile(missingRequiredPath, missingRequiredBytes);
  expectReleaseGuard(
    `MP-3 ${surface} scoped missing required coverage`,
    () => validateEvidence(evidence(surface, {
      ...(surface === 'installed' ? { installedVersion: identity.version } : {}),
      coverage: {
        ...evidence(surface).coverage,
        scope: surface,
        matrixPath: missingRequiredPath,
        matrixSha256: crypto.createHash('sha256').update(missingRequiredBytes).digest('hex'),
      },
    }), completeState, {
      fileExists: () => true,
      now: new Date('2026-08-09T00:05:00.000Z'),
    }),
    new RegExp(`missing.*${missingKey.replaceAll('.', '\\.') }|${surface}.*required coverage`, 'i'),
  );

  const singleRowPath = path.join(tempDir, `${surface}-single-self-declared-row.md`);
  const singleRowBytes = coverageMatrixBytes(surface, {
    evidenceScope: surface,
    mutateMatrix: (matrix) => ({
      ...matrix,
      coverage: {
        ...matrix.coverage,
        count: 1,
        requiredKeys: [...matrix.rows[0].coverage],
      },
      rows: [matrix.rows[0]],
    }),
  });
  await fs.writeFile(singleRowPath, singleRowBytes);
  expectReleaseGuard(
    `MP-3 ${surface} scoped single self-declared row`,
    () => validateEvidence(evidence(surface, {
      ...(surface === 'installed' ? { installedVersion: identity.version } : {}),
      coverage: {
        ...evidence(surface).coverage,
        scope: surface,
        matrixPath: singleRowPath,
        matrixSha256: crypto.createHash('sha256').update(singleRowBytes).digest('hex'),
        totalRows: 1,
        passedRows: 1,
      },
    }), completeState, {
      fileExists: () => true,
      now: new Date('2026-08-09T00:05:00.000Z'),
    }),
    new RegExp(`${surface}.*required coverage|missing coverage`, 'i'),
  );
}

const tooManyRowsCoveragePath = path.join(tempDir, 'portal-too-many-rows.md');
const tooManyRowsCoverageBytes = coverageMatrixBytes('portal', {
  mutateMatrix: (matrix) => {
    const rows = Array.from({ length: 513 }, (_, index) => ({
      ...structuredClone(matrix.rows[index % matrix.rows.length]),
      id: `portal-overflow-row-${index}`,
    }));
    return { ...matrix, coverage: { ...matrix.coverage, count: rows.length }, rows };
  },
});
await fs.writeFile(tooManyRowsCoveragePath, tooManyRowsCoverageBytes);
expectReleaseGuard(
  'MP-4 matrix row-count preflight',
  () => validateEvidence({
    ...validPortalEvidence,
    coverage: {
      ...validPortalEvidence.coverage,
      matrixPath: tooManyRowsCoveragePath,
      matrixSha256: crypto.createHash('sha256').update(tooManyRowsCoverageBytes).digest('hex'),
      totalRows: 513,
      passedRows: 513,
    },
  }, machineReadyState(), {
    fileExists: () => true,
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /row count|rows.*512|too many rows|row limit/i,
);

let aggregateNestedReads = 0;
const aggregateCoveragePath = path.join(tempDir, 'portal-aggregate-byte-budget.md');
const aggregateCoverageBytes = coverageMatrixBytes('portal', {
  mutateRow: (row) => ({
    ...row,
    screenshotBefore: { ...row.screenshotBefore, bytes: 4 * 1024 * 1024 },
    screenshotAfter: { ...row.screenshotAfter, bytes: 4 * 1024 * 1024 },
    accessibilityEvidence: {
      ...row.accessibilityEvidence,
      before: { ...row.accessibilityEvidence.before, bytes: 4 * 1024 * 1024 },
      after: { ...row.accessibilityEvidence.after, bytes: 4 * 1024 * 1024 },
    },
    runtimeEvidence: { ...row.runtimeEvidence, bytes: 4 * 1024 * 1024 },
  }),
});
await fs.writeFile(aggregateCoveragePath, aggregateCoverageBytes);
const aggregateNestedPaths = rowEvidencePaths.portal.flatMap((rowPaths) => Object.values(rowPaths));
expectReleaseGuard(
  'MP-4 aggregate nested byte preflight',
  () => validateEvidence({
    ...validPortalEvidence,
    coverage: {
      ...validPortalEvidence.coverage,
      matrixPath: aggregateCoveragePath,
      matrixSha256: crypto.createHash('sha256').update(aggregateCoverageBytes).digest('hex'),
    },
  }, machineReadyState(), {
    fileExists: () => true,
    statArtifact: (candidate) => aggregateNestedPaths.includes(candidate)
      ? { size: 4 * 1024 * 1024, dev: 2, ino: aggregateNestedPaths.indexOf(candidate) + 1, isFile: () => true }
      : fsSync.statSync(candidate),
    readArtifact: (candidate) => {
      if (aggregateNestedPaths.includes(candidate)) {
        aggregateNestedReads += 1;
      }
      return fsSync.readFileSync(candidate);
    },
    now: new Date('2026-08-09T00:05:00.000Z'),
  }),
  /aggregate|byte budget|total evidence.*size|64 MiB/i,
);
if (aggregateNestedReads > 0) {
  reviewGuardFailures.push('MP-4 aggregate nested byte preflight: nested files were read before aggregate rejection');
}
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
for (const [role, artifactPathValue, tamperedBytes] of [
  ['screenshot', rowEvidencePaths.portal[0].screenshotBefore, pngFixture('completion-tampered-row-screenshot')],
  ['accessibility', rowEvidencePaths.portal[0].accessibilityBefore, Buffer.from('completion tampered AX evidence\n')],
  ['runtime', rowEvidencePaths.portal[0].runtime, Buffer.from('completion tampered runtime evidence\n')],
]) {
  const originalBytes = await fs.readFile(artifactPathValue);
  await fs.writeFile(artifactPathValue, tamperedBytes);
  assert.throws(
    () => reverifyEvidenceArtifacts(completeState),
    /row.*(?:artifact|evidence).*(?:SHA-256|hash|byte)|(?:SHA-256|hash|byte).*row|supporting evidence artifact.*invalid/i,
    `persisted release evidence must reverify row-level ${role} content before completion`,
  );
  await fs.writeFile(artifactPathValue, originalBytes);
}
await fs.writeFile(packagePath, Buffer.from('replacement package'));
assert.throws(() => assertPackageIntegrity(completeState), /package.*sha|sha.*package|changed/i);
await fs.writeFile(packagePath, packageBytes);
assert.doesNotThrow(() => assertPublicProbeMatches(completeState, {
  version: identity.version,
  sourceCommit: identity.commit,
  packageSha256,
  tab: { finalUrl: 'https://runtime.example.com/tabs/home' },
  tabRoutes: structuredClone(publicTabRoutes),
  asset: { ...publicAsset },
}));
assert.throws(
  () => assertPublicProbeMatches(completeState, {
    version: identity.version,
    sourceCommit: identity.commit,
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
    sourceCommit: identity.commit,
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
    sourceCommit: identity.commit,
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
      sourceCommit: identity.commit,
      packageSha256,
      tab: { finalUrl: 'https://runtime.example.com/tabs/home' },
      tabRoutes: structuredClone(publicTabRoutes),
      asset: { ...publicAsset },
    };
  },
});
assert.equal(publicProbeCount, 1);
assert.equal(completedAgain.status, 'COMPLETE');
let completionCoverageReopens = 0;
const completedWithExplicitCoverageReopen = await completeReleaseState(completeState, {
  verifyEvidence: () => {},
  readArtifact: (candidate) => {
    if (Object.values(surfaceCoveragePaths).includes(candidate)) completionCoverageReopens += 1;
    return fsSync.readFileSync(candidate);
  },
  probePublic: async () => ({
    version: identity.version,
    sourceCommit: identity.commit,
    packageSha256,
    tab: { finalUrl: 'https://runtime.example.com/tabs/home' },
    tabRoutes: structuredClone(publicTabRoutes),
    asset: { ...publicAsset },
  }),
});
assert.equal(completedWithExplicitCoverageReopen.status, 'COMPLETE');
assert.equal(completionCoverageReopens, 4, 'completion must reopen every persisted coverage.matrixPath');
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
  /evidence artifact (?:hash|bytes) changed|evidence artifact is invalid/i,
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
      sourceCommit: identity.commit,
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
    { package: '/absolute/teams-sdk-mvp.zip', version: identity.version, sha256: packageSha256, sourceCommit: identity.commit },
    { manifest: { version: identity.version, appId: 'app-id' } },
  ],
});
assert.equal(packageSummary.version, identity.version);
assert.equal(packageSummary.sha256, packageSha256);
assert.equal(packageSummary.sourceCommit, identity.commit);
const publicPayloadWithoutAsset = {
  evidence: [
    { package: packagePath, version: identity.version, sha256: packageSha256, sourceCommit: identity.commit },
    { health: { version: identity.version, sourceCommit: identity.commit, environment: 'production' } },
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
assert.equal(publicSummary.sourceCommit, identity.commit);
assert.deepEqual(parseGatePayload('', JSON.stringify({ status: 'BLOCKED', phase: 'public' })), {
  status: 'BLOCKED',
  phase: 'public',
});

const cliStatePath = path.join(tempDir, 'current.json');
const cleanGitPath = path.join(tempDir, 'git');
const versionGuardStatePath = path.join(tempDir, 'version-guard.json');
const currentCommit = spawnSync('git', ['rev-parse', 'HEAD'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  timeout: 5_000,
  killSignal: 'SIGKILL',
}).stdout.trim();
const parentCommit = 'fedcba9876543210fedcba9876543210fedcba98';
const currentShortCommit = spawnSync('git', ['rev-parse', '--short=7', 'HEAD'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  timeout: 5_000,
  killSignal: 'SIGKILL',
}).stdout.trim();
await fs.writeFile(cleanGitPath, `#!/bin/sh
case "$1" in
  rev-parse)
    if [ "$2" = '${currentCommit}^' ]; then
      if [ "\${FAKE_GIT_PARENT:-0}" = '1' ]; then printf '%s\\n' '${parentCommit}'; exit 0; fi
      exit 128
    fi
    printf '%s\\n' '${currentCommit}'
    ;;
  diff-index)
    if [ "\${FAKE_GIT_TRACKED_DIRTY:-0}" = '1' ]; then exit 1; fi
    if [ "$4" = '${currentCommit}' ]; then exit 0; fi
    exit 1
    ;;
  diff-files)
    exit 0
    ;;
  ls-files)
    exit 0
    ;;
  show)
    if [ "$2" = '${currentCommit}:appPackage/manifest.json' ]; then
      printf '%s\\n' '{"version":"${identity.version}"}'
      exit 0
    fi
    if [ "$2" = '${parentCommit}:appPackage/manifest.json' ]; then
      printf '%s\\n' '{"version":"${identity.version}"}'
      exit 0
    fi
    exit 128
    ;;
  *)
    exec /usr/bin/git "$@"
    ;;
esac
`);
await fs.chmod(cleanGitPath, 0o755);
const runCli = (args, extraEnv = {}) => spawnSync(
  process.execPath,
  ['scripts/release-loop.mjs', ...args],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...extraEnv,
      PATH: `${tempDir}:${process.env.PATH}`,
      RELEASE_UPDATE_DRIVER: '1',
      RELEASE_LOOP_STATE_PATH: extraEnv.RELEASE_LOOP_STATE_PATH ?? cliStatePath,
    },
    encoding: 'utf8',
    timeout: 5_000,
    killSignal: 'SIGKILL',
  },
);
const directEntryPointResult = spawnSync(
  process.execPath,
  ['scripts/release-loop.mjs', 'status'],
  {
    cwd: process.cwd(),
    env: Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !['RELEASE_LOOP_STATE_PATH', 'RELEASE_UPDATE_DRIVER'].includes(key)),
    ),
    encoding: 'utf8',
    timeout: 5_000,
    killSignal: 'SIGKILL',
  },
);
assert.notEqual(directEntryPointResult.status, 0);
assert.match(
  `${directEntryPointResult.stdout}\n${directEntryPointResult.stderr}`,
  /ERELEASEENTRYPOINT|release:update/,
  'the low-level release loop must reject direct use so it cannot create a second state file',
);
const currentState = machineReadyState();
currentState.commit = currentCommit;
currentState.shortCommit = currentShortCommit;
currentState.machine.sourceCommit = currentCommit;
currentState.package.sourceCommit = currentCommit;
currentState.public.sourceCommit = currentCommit;
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
const trackedDirtyStatus = runCli(['status'], { FAKE_GIT_TRACKED_DIRTY: '1' });
assert.notEqual(trackedDirtyStatus.status, 0);
assert.match(
  `${trackedDirtyStatus.stdout}\n${trackedDirtyStatus.stderr}`,
  /EWORKTREEDIRTY|clean.*worktree|tracked/i,
  'tracked changes must remain a release blocker even when the run commit is current',
);
const blockedComplete = runCli(['complete']);
assert.notEqual(blockedComplete.status, 0);
assert.match(`${blockedComplete.stdout}\n${blockedComplete.stderr}`, /BLOCKED/);
assert.match(`${blockedComplete.stdout}\n${blockedComplete.stderr}`, /PORTAL_READY|identity|Jira/i);

const staleState = machineReadyState();
await fs.writeFile(cliStatePath, JSON.stringify(staleState, null, 2));
const staleEvidencePath = path.join(tempDir, 'stale-evidence.json');
await fs.writeFile(staleEvidencePath, JSON.stringify(evidence('portal'), null, 2));
for (const args of [['status'], ['evidence', '--file', staleEvidencePath], ['complete']]) {
  const staleResult = runCli(args);
  assert.notEqual(staleResult.status, 0);
  assert.match(
    `${staleResult.stdout}\n${staleResult.stderr}`,
    /ESTALERELEASE|stale.*release|release.*(?:stale|commit).*HEAD|supersede/i,
    'a release run pinned to an older commit must report a stale run/commit mismatch before clean-worktree inspection',
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

const sameVersionStart = runCli(['start'], {
  FAKE_GIT_PARENT: '1',
  RELEASE_LOOP_STATE_PATH: versionGuardStatePath,
});
assert.notEqual(sameVersionStart.status, 0);
assert.match(
  `${sameVersionStart.stdout}\n${sameVersionStart.stderr}`,
  /EVERSIONNOTBUMPED|must be greater than the previous source version/i,
  'the canonical start command must reject a same-version source commit before creating a release identity',
);

await fs.rm(tempDir, { recursive: true, force: true });
await fs.rm(escapedEvidenceDirectory, { recursive: true, force: true });
assert.deepEqual(
  reviewGuardFailures,
  [],
  `independent MP-3/MP-4 review guards are still missing:\n${reviewGuardFailures.join('\n')}`,
);
console.log('Release loop contract tests passed.');
