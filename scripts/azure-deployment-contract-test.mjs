import assert from 'node:assert/strict';
import { parseDeploymentOutputs, selectRollbackRevisions, validateReleaseDeployment } from './azure-deployment-contract.mjs';

const commit = 'a'.repeat(40);
const receipt = {
  schemaVersion: 1,
  source: 'github-actions',
  commit,
  version: '1.0.100',
  image: 'ghcr.io/devdoo-teams/teams-app',
  imageDigest: `sha256:${'b'.repeat(64)}`,
  teamsPackageSha256: 'c'.repeat(64),
  clientBundleSha256: 'd'.repeat(64),
  serverBundleSha256: 'e'.repeat(64),
};
const provenance = {
  schemaVersion: 1,
  repository: 'devdoo-teams/teams-app',
  workflow: 'devdoo-teams/teams-app/.github/workflows/publish-image.yml',
  commit,
  artifactId: 42,
  artifactDigest: `sha256:${'f'.repeat(64)}`,
  attestationVerified: true,
};
const outputs = {
  registryName: { type: 'String', value: 'teamsappabc123' },
  registryLoginServer: { type: 'String', value: 'teamsappabc123.azurecr.io' },
  containerAppName: { type: 'String', value: 'teamsapp-canary-abc123' },
  containerAppFqdn: { type: 'String', value: 'teamsapp-canary.example.azurecontainerapps.io' },
  containerAppRevisionName: { type: 'String', value: 'teamsapp-canary-abc123--aaaaaaaaaa' },
  containerEnvironmentName: { type: 'String', value: 'teamsapp-env-abc123' },
  appIdentityClientId: { type: 'String', value: '11111111-2222-4333-8444-555555555555' },
};
assert.deepEqual(parseDeploymentOutputs(outputs), Object.fromEntries(Object.entries(outputs).map(([key, item]) => [key, item.value])));
assert.throws(() => parseDeploymentOutputs({ ...outputs, registryName: undefined }), /registryName/);

const currentName = 'teamsapp--current';
const previousName = 'teamsapp--previous';
const revisions = [
  { name: previousName, properties: { active: false, provisioningState: 'Succeeded', runningState: 'Stopped', createdTime: '2026-09-01T00:00:00Z', lastActiveTime: '2026-09-02T00:00:00Z', trafficWeight: 0 } },
  { name: currentName, properties: { active: true, provisioningState: 'Succeeded', runningState: 'Running', createdTime: '2026-09-02T00:00:00Z', trafficWeight: 100 } },
  { name: 'teamsapp--newer-no-traffic', properties: { active: true, provisioningState: 'Succeeded', runningState: 'Running', createdTime: '2026-09-03T00:00:00Z', trafficWeight: 0 } },
];
assert.deepEqual(selectRollbackRevisions(revisions), { currentRevision: currentName, previousRevision: previousName });
assert.throws(
  () => selectRollbackRevisions(revisions.map((revision) => ({ ...revision, properties: { ...revision.properties, trafficWeight: 0 } }))),
  /traffic-serving/i,
);

const releaseEnv = [
  ['RELEASE_SOURCE_COMMIT', receipt.commit],
  ['RELEASE_APP_VERSION', receipt.version],
  ['RELEASE_IMAGE_DIGEST', receipt.imageDigest],
  ['RELEASE_TEAMS_PACKAGE_SHA256', receipt.teamsPackageSha256],
  ['RELEASE_CLIENT_BUNDLE_SHA256', receipt.clientBundleSha256],
  ['RELEASE_SERVER_BUNDLE_SHA256', receipt.serverBundleSha256],
].map(([name, value]) => ({ name, value }));
const revision = {
  name: 'teamsapp-canary-abc123--aaaaaaaaaa',
  properties: {
    active: true,
    provisioningState: 'Succeeded',
    runningState: 'Running',
    trafficWeight: 100,
    template: { containers: [{ name: 'teams-core', image: `teamsappabc123.azurecr.io/teamsapp@${receipt.imageDigest}`, env: releaseEnv }] },
  },
};
const health = { ok: true, sourceCommit: receipt.commit, version: receipt.version, serverBundleSha256: receipt.serverBundleSha256 };

assert.equal(validateReleaseDeployment({ receipt, provenance, revision, health, registryLoginServer: 'teamsappabc123.azurecr.io' }), true);
assert.throws(
  () => validateReleaseDeployment({
    receipt,
    provenance,
    revision: {
      ...revision,
      properties: {
        ...revision.properties,
        template: { containers: [{ ...revision.properties.template.containers[0], env: releaseEnv.map((entry) => entry.name === 'RELEASE_CLIENT_BUNDLE_SHA256' ? { ...entry, value: '0'.repeat(64) } : entry) }] },
      },
    },
    health,
    registryLoginServer: 'teamsappabc123.azurecr.io',
  }),
  /clientBundleSha256/i,
);
assert.throws(() => validateReleaseDeployment({ receipt, provenance: { ...provenance, attestationVerified: false }, revision, health, registryLoginServer: 'teamsappabc123.azurecr.io' }), /attestation/i);
assert.throws(() => validateReleaseDeployment({ receipt, provenance, revision: { ...revision, properties: { ...revision.properties, runningState: 'Degraded' } }, health, registryLoginServer: 'teamsappabc123.azurecr.io' }), /readiness/i);

console.log('PASS: Bicep output consumption, traffic-aware rollback, revision readiness, provenance, and full release identity are behaviorally validated.');
