import assert from 'node:assert/strict';
import { validateBrowserAttestation } from './release-update.mjs';

const appId = 'e915b402-eed4-4ee2-ba1f-c31d75c870a5';
const sourceCommit = 'a'.repeat(40);
const packageSha256 = 'b'.repeat(64);
const clientBundleSha256 = 'c'.repeat(64);
const serverBundleSha256 = 'd'.repeat(64);
const state = {
  runId: 'independent-identity-fixture', commit: sourceCommit, version: '1.0.138',
  package: { sha256: packageSha256, manifest: { appId } },
  public: { asset: { sha256: clientBundleSha256 }, health: { serverBundleSha256 } },
};
const attestation = {
  surface: 'installed', runId: state.runId, appId, version: state.version, packageSha256,
  observedAt: '2026-10-10T12:00:00.000Z', installedVersion: state.version,
  titleBefore: 'Synthetic Teams', titleAfter: 'Synthetic Teams',
  observedAction: 'Read independent release identities', observedResult: 'Synthetic identity observations',
  tabIdBefore: 'synthetic-existing-tab', tabIdAfter: 'synthetic-existing-tab',
  urlBefore: 'https://teams.microsoft.com/', urlAfter: 'https://teams.microsoft.com/',
  independentIdentity: { schemaVersion: 1, installedDefinitionVersion: '1.0.138', aboutVersion: '1.0.132' },
};
// Regression: a catalog/install version must not hide an independently observed old About version.
assert.throws(() => validateBrowserAttestation(attestation, state, 'installed', new Date('2026-10-11T00:00:00Z')),
  /INDEPENDENT_IDENTITY_FAIL.*aboutVersion/u,
  'strict installed 138/About 132 observations must fail instead of accepting installedVersion alone');

const { assessIndependentReleaseIdentity, assessClientRuntimeIdentity, parseClientBuildStamp } =
  await import('../src/shared/independent-release-identity.js');
const { createClientBuildStamp, finalizeClientBuildIdentity } = await import('./client-build-identity.mjs');
const stamp = createClientBuildStamp({ version: state.version, sourceCommit, mode: 'core' });
const clientIdentity = finalizeClientBuildIdentity(stamp, Buffer.from('synthetic client bundle'));
const expected = {
  version: state.version, sourceCommit, packageSha256, clientBundleSha256: clientIdentity.clientBundleSha256,
  serverBundleSha256, clientBuildFingerprint: stamp.buildFingerprint, clientBuildMode: stamp.mode,
};
const observation = {
  schemaVersion: 1, installedDefinitionVersion: state.version, aboutVersion: state.version, installedPackageSha256: packageSha256,
  loadedClient: { ...stamp, assetSha256: clientIdentity.clientBundleSha256 },
  runtime: { version: state.version, sourceCommit, serverBundleSha256,
    clientBundleSha256: clientIdentity.clientBundleSha256, teamsPackageSha256: packageSha256 },
};
assert.equal(assessIndependentReleaseIdentity(expected, observation).status, 'PASS');
assert.equal(assessIndependentReleaseIdentity(expected, { ...observation, aboutVersion: '1.0.132' }).status, 'FAIL');
assert.deepEqual(assessIndependentReleaseIdentity(expected, { ...observation, aboutVersion: undefined }).missing, ['aboutVersion']);
assert.equal(assessIndependentReleaseIdentity(expected, { ...observation, loadedClient: undefined }).status, 'UNVERIFIED');
assert.equal(assessIndependentReleaseIdentity(expected, { ...observation, runtime: undefined }).status, 'UNVERIFIED');
assert.equal(assessIndependentReleaseIdentity({ ...expected, clientBundleSha256: undefined }, observation).status, 'UNVERIFIED');
assert.equal(assessIndependentReleaseIdentity(expected, { ...observation, installedPackageSha256: 'e'.repeat(64) }).status, 'FAIL');
assert.equal(assessIndependentReleaseIdentity(expected, { ...observation, loadedClient: { ...observation.loadedClient, sourceCommit: 'e'.repeat(40) } }).status, 'FAIL');
assert.equal(assessIndependentReleaseIdentity(expected, { ...observation, loadedClient: { ...observation.loadedClient, assetSha256: 'e'.repeat(64) } }).status, 'FAIL');
assert.equal(assessIndependentReleaseIdentity(expected, { ...observation, runtime: { ...observation.runtime, sourceCommit: 'e'.repeat(40) } }).status, 'FAIL');
assert.equal(assessIndependentReleaseIdentity(expected, { ...observation, schemaVersion: 2 }).status, 'FAIL');
assert.equal(assessIndependentReleaseIdentity(expected, { ...observation, guessedCacheCause: 'stale cache' }).status, 'FAIL');
assert.equal(assessIndependentReleaseIdentity(expected, { ...observation, loadedClient: { ...observation.loadedClient, assetSha256: 'malformed' } }).status, 'FAIL');
assert.equal(assessIndependentReleaseIdentity(expected, { schemaVersion: 1, aboutVersion: '1.0.132' }).status, 'FAIL', 'observed failure takes precedence over missing observations');

const strictState = { ...state, public: {
  asset: { sha256: clientIdentity.clientBundleSha256 },
  health: { serverBundleSha256, clientBuildIdentity: clientIdentity },
} };
const accepted = validateBrowserAttestation({ ...attestation, independentIdentity: observation }, strictState, 'installed', new Date('2026-10-11T00:00:00Z'));
assert.equal(accepted.independentIdentityResult.status, 'PASS');
assert.deepEqual(accepted.independentIdentity, observation);
assert.throws(() => validateBrowserAttestation({ ...attestation, independentIdentity: { ...observation, aboutVersion: undefined } }, strictState, 'installed', new Date('2026-10-11T00:00:00Z')), /INDEPENDENT_IDENTITY_UNVERIFIED/u);
const legacy = { ...attestation }; delete legacy.independentIdentity;
assert.equal(validateBrowserAttestation(legacy, state, 'installed', new Date('2026-10-11T00:00:00Z')).installedVersion, '1.0.138', 'legacy attestation remains backward compatible without claiming independent verification');

assert.notEqual(createClientBuildStamp({ ...stamp, version: '1.0.139' }).buildFingerprint, stamp.buildFingerprint);
assert.notEqual(createClientBuildStamp({ ...stamp, sourceCommit: 'e'.repeat(40) }).buildFingerprint, stamp.buildFingerprint);
assert.notEqual(createClientBuildStamp({ ...stamp, mode: 'optional' }).buildFingerprint, stamp.buildFingerprint);
assert.throws(() => createClientBuildStamp({ version: '1.0.138', sourceCommit: 'short', mode: 'core' }), /INVALID_CLIENT_BUILD_IDENTITY/u);
assert.equal(parseClientBuildStamp({ ...stamp, sourceCommit: 'short' }), undefined);
assert.equal(assessClientRuntimeIdentity(stamp, undefined).status, 'UNVERIFIED');
assert.equal(assessClientRuntimeIdentity(stamp, { version: '1.0.132', sourceCommit, clientBuildIdentity: clientIdentity }).status, 'FAIL');
assert.equal(assessClientRuntimeIdentity(stamp, { version: state.version, sourceCommit, clientBuildIdentity: clientIdentity }).status, 'PASS');
assert.equal(assessClientRuntimeIdentity(undefined, { version: state.version, sourceCommit, clientBuildIdentity: clientIdentity }).status, 'UNVERIFIED', 'health cannot supply the loaded client identity');

console.log('PASS: independent installed/About/client/runtime identity, missing evidence, digest drift, compiled stamp and legacy compatibility.');
