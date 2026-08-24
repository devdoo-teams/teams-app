import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  RELEASE_UPDATE_PHASES,
  RELEASE_UPDATE_BLOCKER_CODES,
  acquireStateLock,
  applyPhaseResult,
  assertResumableStatus,
  createReleaseFailurePayload,
  createUpdateState,
  hasVerifiedTeamsRegistration,
  nextAction,
  normalizeChildBlockerCode,
  parseReleaseUpdateArgs,
  redactReleaseError,
  summarizeBrowserHandoff,
  validateJiraReconciliation,
  validateBrowserAttestation,
} from './release-update.mjs';
import { splitBrowserEvidenceInput } from './release-loop.mjs';

assert.deepEqual(
  parseReleaseUpdateArgs(['--url', 'https://runtime.example.com', '--package', '/tmp/release.zip']),
  {
    command: 'run',
    url: 'https://runtime.example.com',
    packagePath: '/tmp/release.zip',
    surface: undefined,
    evidencePath: undefined,
    reason: undefined,
    statePath: undefined,
  },
  'release:update defaults to the resumable run command',
);

assert.deepEqual(
  parseReleaseUpdateArgs(['browser', '--surface', 'portal', '--evidence', '/tmp/portal.json']),
  {
    command: 'browser',
    url: undefined,
    packagePath: undefined,
    surface: 'portal',
    evidencePath: '/tmp/portal.json',
    reason: undefined,
    statePath: undefined,
  },
  'browser evidence is an explicit phase and surface',
);

assert.equal(
  parseReleaseUpdateArgs(['reconcile', '--evidence', '/tmp/jira-reconciliation.json']).command,
  'reconcile',
  'Jira reconciliation is an explicit final gate',
);

assert.deepEqual(RELEASE_UPDATE_PHASES, [
  'machine',
  'package',
  'public',
  'portal',
  'installed',
  'desktop',
  'mobile',
  'jira',
]);
assert.equal(RELEASE_UPDATE_BLOCKER_CODES.has('ESTALERELEASE'), true);
assert.equal(RELEASE_UPDATE_BLOCKER_CODES.has('EUNTRACKEDSTARTMUTATED'), true);
assert.equal(RELEASE_UPDATE_BLOCKER_CODES.has('EVERSIONNOTBUMPED'), true);
assert.equal(normalizeChildBlockerCode('EPACKAGEPATH', 'ELOOPPHASE'), 'EPACKAGEPATH');
assert.equal(normalizeChildBlockerCode(20, 'ELOOPPHASE'), 'ELOOPPHASE');

const initial = createUpdateState({
  runId: 'run-1',
  commit: '0123456789abcdef0123456789abcdef01234567',
  version: '1.0.57',
  packagePath: '/repo/appPackage/build/teams-sdk-mvp.zip',
  startedAt: '2026-08-19T00:00:00.000Z',
});
assert.equal(initial.schemaVersion, 1);
assert.equal(initial.releaseUpdate.statePath.endsWith('/.release/update-current.json'), true);
assert.equal(initial.status, 'INIT');
assert.equal(nextAction(initial), 'machine');

const failureReport = createReleaseFailurePayload(Object.assign(new Error('public probe failed'), {
  code: 'ELOOPPHASE',
  releasePhase: 'public',
}), {
  statePath: '/repo/.release/update-current.json',
  state: {
    ...initial,
    status: 'PACKAGE_READY',
    lastFailure: { phase: 'public', code: 'ELOOPPHASE', message: 'public probe failed' },
    releaseUpdate: {
      ...initial.releaseUpdate,
      attempts: { public: { count: 2, startedAt: '2026-08-19T00:30:00.000Z' } },
      lastActivity: '2026-08-19T00:31:00.000Z',
    },
  },
  phase: 'public',
});
assert.equal(failureReport.status, 'BLOCKED');
assert.equal(failureReport.runId, 'run-1');
assert.equal(failureReport.statePath, '/repo/.release/update-current.json');
assert.deepEqual(failureReport.missingGates, [
  'MACHINE_READY',
  'PACKAGE_READY',
  'PUBLIC_READY',
  'PORTAL_READY',
  'INSTALLED_READY',
  'DESKTOP_READY',
  'MOBILE_READY',
]);
assert.equal(failureReport.process.name, 'release:update');

const machineReady = applyPhaseResult(initial, 'machine', {
  status: 'READY',
  sourceCommit: initial.commit,
});
assert.equal(machineReady.status, 'MACHINE_READY');
assert.equal(nextAction(machineReady), 'package');

const packageReady = applyPhaseResult(machineReady, 'package', {
  status: 'READY',
  sourceCommit: initial.commit,
  version: initial.version,
  packagePath: initial.releaseUpdate.packagePath,
  sha256: 'a'.repeat(64),
  manifest: { appId: 'e915b402-eed4-4ee2-ba1f-c31d75c870a5' },
});
assert.equal(packageReady.status, 'PACKAGE_READY');
assert.equal(nextAction(packageReady), 'public');

const publicReady = applyPhaseResult(packageReady, 'public', {
  status: 'READY',
  sourceCommit: initial.commit,
  version: initial.version,
  packageSha256: packageReady.package.sha256,
  health: {
    environment: 'production',
    auth: 'teams-authenticated',
    serverBundleSha256: 'b'.repeat(64),
  },
  tab: { buildId: 'c'.repeat(12) },
  asset: {
    finalUrl: 'https://runtime.example.com/assets/main.js?v=cccccccccccc',
    buildId: 'c'.repeat(12),
    sha256: 'c'.repeat(64),
  },
  publicOrigin: 'https://runtime.example.com',
});
assert.equal(publicReady.status, 'PUBLIC_READY');
assert.equal(nextAction(publicReady), 'portal');
assert.equal(
  hasVerifiedTeamsRegistration(publicReady),
  false,
  'a release without a registered Teams package read-back must not be considered attested',
);
assert.equal(
  hasVerifiedTeamsRegistration({
    ...publicReady,
    releaseUpdate: {
      ...publicReady.releaseUpdate,
      registration: {
        status: 'VERIFIED',
        appId: publicReady.package.manifest.appId,
        version: publicReady.version,
        endpoint: 'https://runtime.example.com/api/messages',
        packageSha256: publicReady.package.sha256,
      },
    },
  }),
  true,
  'a matching registered Teams package read-back must be accepted',
);
assert.equal(
  nextAction({ ...publicReady, releaseUpdate: { ...publicReady.releaseUpdate, identity: null } }),
  'public',
  'a public phase without its outer release identity must retry public before portal or Jira handoff',
);
assert.deepEqual(publicReady.releaseUpdate.identity, {
  appId: 'e915b402-eed4-4ee2-ba1f-c31d75c870a5',
  sourceCommit: initial.commit,
  version: initial.version,
  packageSha256: packageReady.package.sha256,
  publicOrigin: 'https://runtime.example.com',
  serverBundleSha256: 'b'.repeat(64),
  assetSha256: 'c'.repeat(64),
});
assert.equal(summarizeBrowserHandoff(publicReady, 'portal').appId, 'e915b402-eed4-4ee2-ba1f-c31d75c870a5');

const browserHandoff = summarizeBrowserHandoff(publicReady, 'portal');
assert.equal(browserHandoff.surface, 'portal');
assert.equal(browserHandoff.version, initial.version);
assert.match(browserHandoff.instructions, /existing in-app browser tab/i);
assert.match(browserHandoff.instructions, /import/i);
assert.doesNotMatch(browserHandoff.instructions, /password|secret|token/i);

const portalAttestation = validateBrowserAttestation({
  runId: publicReady.runId,
  surface: 'portal',
  appId: publicReady.package.manifest.appId,
  version: publicReady.version,
  packageSha256: publicReady.package.sha256,
  observedAt: '2026-08-19T01:00:00.000Z',
  tabId: '3',
  tabIdBefore: '3',
  tabIdAfter: '3',
  urlBefore: 'https://dev.teams.microsoft.com/apps/example/publish-org',
  urlAfter: 'https://dev.teams.microsoft.com/apps/example/publish-org',
  titleBefore: 'Publish app',
  titleAfter: 'Publish app',
  observedAction: 'imported package and submitted update once',
  observedResult: '1.0.57 submitted and awaiting admin approval',
  submissionStatus: 'submitted_pending_admin',
  remoteOperationIdUnavailableReason: 'Developer Portal does not display an operation ID in this view',
}, publicReady, 'portal', new Date('2026-08-19T02:00:00.000Z'));
assert.equal(portalAttestation.submissionStatus, 'submitted_pending_admin');

const fullEvidenceFixture = {
  surface: 'portal',
  observedAt: '2026-08-19T01:00:00.000Z',
  commit: publicReady.commit,
  version: publicReady.version,
  packageSha256: publicReady.package.sha256,
  summary: '동일한 포털 탭에서 실제 게시 결과와 배포 identity를 확인함',
  screenshotBeforePath: '/tmp/portal-before.png',
  screenshotAfterPath: '/tmp/portal-after.png',
  accessibilityPath: '/tmp/portal-ax.txt',
  runtimeLogPath: '/tmp/portal-runtime.log',
  coverage: {
    scope: 'portal',
    matrixPath: '/tmp/portal-matrix.json',
    matrixSha256: 'd'.repeat(64),
    commit: publicReady.commit,
    version: publicReady.version,
    totalRows: 1,
    passedRows: 1,
    notApplicableRows: 0,
    blockedRows: 0,
    unverifiedRows: 0,
  },
};
const browserEvidenceBundle = splitBrowserEvidenceInput({
  attestation: portalAttestation,
  evidence: fullEvidenceFixture,
}, { requireFullEvidence: true });
assert.equal(browserEvidenceBundle.format, 'envelope');
assert.deepEqual(browserEvidenceBundle.attestation, portalAttestation);
assert.deepEqual(browserEvidenceBundle.evidence, fullEvidenceFixture);
assert.throws(
  () => splitBrowserEvidenceInput(portalAttestation, { requireFullEvidence: true }),
  /full release-loop evidence/i,
  'an attestation-only browser file must not reach release-loop as if it were full evidence',
);
assert.throws(
  () => splitBrowserEvidenceInput({ attestation: portalAttestation }, { requireFullEvidence: true }),
  /requires both.*attestation.*evidence/i,
  'an envelope must contain both the browser attestation and release-loop evidence payload',
);

assert.throws(
  () => validateBrowserAttestation({
    ...portalAttestation,
    tabId: '<existing-in-app-browser-tab-id>',
    tabIdBefore: '<existing-in-app-browser-tab-id>',
    tabIdAfter: '<existing-in-app-browser-tab-id>',
  }, publicReady, 'portal', new Date('2026-08-19T02:00:00.000Z')),
  /real existing in-app browser tab ID/,
);
assert.throws(
  () => validateBrowserAttestation({ ...portalAttestation, remoteOperationId: null, remoteOperationIdUnavailableReason: null }, publicReady, 'portal', new Date('2026-08-19T02:00:00.000Z')),
  /remoteOperationId or remoteOperationIdUnavailableReason/,
);

const desktopAttestation = validateBrowserAttestation({
  runId: publicReady.runId,
  surface: 'desktop',
  appId: publicReady.package.manifest.appId,
  version: publicReady.version,
  packageSha256: publicReady.package.sha256,
  observedAt: '2026-08-19T01:00:00.000Z',
  titleBefore: 'Teams 업무 허브',
  titleAfter: 'Teams 업무 허브',
  observedAction: 'Computer Use AX tree and screenshot verified the published app response',
  observedResult: 'status response and updated tab UI matched the release identity',
  verificationMode: 'computer-use',
  applicationId: 'com.microsoft.teams2',
}, publicReady, 'desktop', new Date('2026-08-19T02:00:00.000Z'));
assert.equal(desktopAttestation.verificationMode, 'computer-use');
assert.equal(desktopAttestation.applicationId, 'com.microsoft.teams2');
assert.equal('tabId' in desktopAttestation, false);

const mobileAttestation = validateBrowserAttestation({
  runId: publicReady.runId,
  surface: 'mobile',
  appId: publicReady.package.manifest.appId,
  version: publicReady.version,
  packageSha256: publicReady.package.sha256,
  observedAt: '2026-08-19T01:00:00.000Z',
  titleBefore: '업무 허브',
  titleAfter: '업무 허브',
  observedAction: 'User confirmed the current iOS Teams app response and screenshots',
  observedResult: 'mobile response matched the release identity',
  verificationMode: 'user-confirmed-mobile',
  userConfirmed: true,
}, publicReady, 'mobile', new Date('2026-08-19T02:00:00.000Z'));
assert.equal(mobileAttestation.verificationMode, 'user-confirmed-mobile');
assert.equal(mobileAttestation.userConfirmed, true);
assert.throws(
  () => validateBrowserAttestation({ ...mobileAttestation, verificationMode: 'computer-use' }, publicReady, 'mobile', new Date('2026-08-19T02:00:00.000Z')),
  /verificationMode must be user-confirmed-mobile/,
);

const jiraInput = {
  runId: publicReady.runId,
  identity: publicReady.releaseUpdate.identity,
  verifiedAt: '2026-08-19T01:10:00.000Z',
  remoteVerification: {
    provider: 'jira-cloud',
    readBack: true,
    verifiedAt: '2026-08-19T01:09:00.000Z',
    responses: [{ key: 'MP-128', url: 'https://devdoo.atlassian.net/browse/MP-128', status: 'Done', readBack: true }],
  },
  issues: [{
    key: 'MP-128',
    url: 'https://devdoo.atlassian.net/browse/MP-128',
    type: 'Bug',
    assignee: 'self',
    status: 'Done',
    idempotencyKey: 'teams-core:bug:production-client-jsx-runtime',
    discoveryEvidence: 'desktop and public runtime evidence',
    acceptanceEvidence: 'current release identity evidence',
    fixCommit: initial.commit,
    blocking: true,
    releaseDisposition: 'fixed',
  }],
  unresolvedBlockers: [],
  unmappedFindings: [],
};
const jiraReconciliation = validateJiraReconciliation(jiraInput, publicReady, new Date('2026-08-19T02:00:00.000Z'));
assert.equal(jiraReconciliation.status, 'VERIFIED');
assert.throws(
  () => validateJiraReconciliation({
    ...jiraInput,
    remoteVerification: {
      ...jiraInput.remoteVerification,
      responses: [...jiraInput.remoteVerification.responses, ...jiraInput.remoteVerification.responses],
    },
    issues: [...jiraInput.issues, ...jiraInput.issues],
  }, publicReady, new Date('2026-08-19T02:00:00.000Z')),
  /unique issue keys|duplicates issue key/,
);

assert.equal(
  redactReleaseError(new Error('Bearer abc password=hidden api_key=secret')).message,
  'Bearer [REDACTED] password=[REDACTED] api_key=[REDACTED]',
);

assert.equal(
  assertResumableStatus({
    status: 'BLOCKED',
    lastFailure: { phase: 'public', code: 'ELOOPPHASE', message: 'retryable phase failure' },
  }).status,
  'BLOCKED',
  'a phase-local failure remains retryable when the checkout is still valid',
);
assert.throws(
  () => assertResumableStatus({
    status: 'BLOCKED',
    blocker: {
      code: 'ESTALERELEASE',
      message: 'release run is stale',
      detail: 'recorded commit does not match current Git HEAD',
    },
  }),
  /release run is stale: recorded commit does not match current Git HEAD/,
  'a stale release must stop before reusing an old portal handoff',
);

assert.throws(
  () => applyPhaseResult(initial, 'package', { status: 'READY', sourceCommit: 'f'.repeat(40) }),
  /machine phase must be READY before package/,
);

assert.throws(
  () => applyPhaseResult(machineReady, 'package', {
    status: 'READY',
    sourceCommit: initial.commit,
    version: initial.version,
    packagePath: '/tmp/old-release.zip',
    sha256: 'a'.repeat(64),
  }),
  /package path does not match/,
);

const lockTestDir = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-release-update-lock-'));
const lockStatePath = path.join(lockTestDir, 'state.json');
const releaseLock = await acquireStateLock(lockStatePath);
const replacedLock = JSON.stringify({
  pid: process.pid,
  startedAt: new Date().toISOString(),
  token: 'new-owner-token',
});
await fs.writeFile(`${lockStatePath}.lock`, replacedLock);
await releaseLock();
assert.equal(
  await fs.readFile(`${lockStatePath}.lock`, 'utf8'),
  replacedLock,
  'lock cleanup must not unlink a lock that replaced this run\'s owned lock',
);
await fs.unlink(`${lockStatePath}.lock`);

const staleLockStatePath = path.join(lockTestDir, 'stale-state.json');
await fs.writeFile(`${staleLockStatePath}.lock`, JSON.stringify({
  pid: 2_147_483_647,
  startedAt: new Date(Date.now() - 120_000).toISOString(),
  token: 'stale-owner-token',
}));
const recoveredLock = await acquireStateLock(staleLockStatePath);
const recoveredOwner = JSON.parse(await fs.readFile(`${staleLockStatePath}.lock`, 'utf8'));
assert.equal(recoveredOwner.pid, process.pid, 'stale-lock recovery must acquire the lock after atomically quarantining the old owner');
await recoveredLock();

console.log('release-update-test: PASS');
