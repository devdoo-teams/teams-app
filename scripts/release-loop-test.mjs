import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  applyEvidence,
  completionMessage,
  createInitialState,
  deriveStatus,
  gatePhaseForLoop,
  missingGates,
  parseGatePayload,
  summarizePhase,
  validateEvidence,
} from './release-loop.mjs';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-release-loop-'));
const artifactPath = path.join(tempDir, 'desktop-proof.png');
const fakeArtifactPath = path.join(tempDir, 'fake-proof.png');
await fs.writeFile(artifactPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
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
    version: identity.version,
    sha256: 'a'.repeat(64),
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
    packageSha256: 'a'.repeat(64),
    summary: `Observed ${surface} release evidence in the deployed Teams app.`,
    artifactPaths: [artifactPath],
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

const portalEvidence = validateEvidence(evidence('portal'), machineReady, {
  fileExists: (candidate) => candidate === artifactPath,
  now: new Date('2026-08-09T00:05:00.000Z'),
});
assert.deepEqual(Object.keys(portalEvidence).sort(), [
  'artifactPaths',
  'commit',
  'observedAt',
  'packageSha256',
  'summary',
  'surface',
  'version',
]);
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
    /evidence artifact must be a real PNG, JPEG, or WebP image/,
  );
  const normalized = validateEvidence(evidence(surface, surfaceOverrides), completeState, {
    fileExists: () => true,
    now: new Date('2026-08-09T00:05:00.000Z'),
  });
  completeState = applyEvidence(completeState, normalized);
}
assert.equal(completeState.status, 'MOBILE_READY');
assert.deepEqual(missingGates(completeState), []);
const report = completionMessage(completeState);
assert.match(report, /1\.0\.15/);
assert.match(report, /0123456/);
assert.match(report, /a{64}/);
assert.doesNotMatch(report, /desktop-proof\.png/);
assert.doesNotMatch(report, /Bearer|sk-|client_secret|password/i);
assert.equal(gatePhaseForLoop('machine'), 'preflight');
assert.equal(gatePhaseForLoop('package'), 'package');
assert.equal(gatePhaseForLoop('public'), 'public');
const packageSummary = summarizePhase('package', {
  evidence: [
    { package: '/absolute/teams-sdk-mvp.zip', version: identity.version, sha256: 'a'.repeat(64) },
    { manifest: { version: identity.version, appId: 'app-id' } },
  ],
});
assert.equal(packageSummary.version, identity.version);
assert.equal(packageSummary.sha256, 'a'.repeat(64));
assert.deepEqual(parseGatePayload('', JSON.stringify({ status: 'BLOCKED', phase: 'public' })), {
  status: 'BLOCKED',
  phase: 'public',
});

const cliStatePath = path.join(tempDir, 'current.json');
const runCli = (args) => spawnSync(
  process.execPath,
  ['scripts/release-loop.mjs', ...args],
  {
    cwd: process.cwd(),
    env: { ...process.env, RELEASE_LOOP_STATE_PATH: cliStatePath },
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
