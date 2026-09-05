import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAzureReleaseInput } from './azure-release-input.mjs';

const sha256Pattern = /^[0-9a-f]{64}$/;
const imageDigestPattern = /^sha256:[0-9a-f]{64}$/;
const commitPattern = /^[0-9a-f]{40}$/;
const artifactDigestPattern = /^sha256:[0-9a-f]{64}$/;
const requiredOutputs = [
  'registryName',
  'registryLoginServer',
  'containerAppName',
  'containerAppFqdn',
  'containerAppRevisionName',
  'containerEnvironmentName',
  'appIdentityClientId',
];
const releaseEnvironmentFields = {
  RELEASE_SOURCE_COMMIT: 'commit',
  RELEASE_APP_VERSION: 'version',
  RELEASE_IMAGE_DIGEST: 'imageDigest',
  RELEASE_TEAMS_PACKAGE_SHA256: 'teamsPackageSha256',
  RELEASE_CLIENT_BUNDLE_SHA256: 'clientBundleSha256',
  RELEASE_SERVER_BUNDLE_SHA256: 'serverBundleSha256',
};
const publicReleaseIdentityFields = [
  'commit',
  'version',
  'imageDigest',
  'teamsPackageSha256',
  'clientBundleSha256',
  'serverBundleSha256',
];

function fail(message) {
  throw new Error(`Invalid Azure deployment contract: ${message}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

export function parseDeploymentOutputs(value, { requireContainerApp = true } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Bicep deployment outputs must be an object');
  const parsed = {};
  for (const name of requiredOutputs) {
    const output = value[name];
    const allowEmpty = !requireContainerApp && ['containerAppFqdn', 'containerAppRevisionName'].includes(name);
    if (!output || output.type?.toLowerCase() !== 'string' || typeof output.value !== 'string' || (!allowEmpty && output.value.length === 0)) {
      fail(`Bicep deployment output ${name} is missing or invalid`);
    }
    parsed[name] = output.value;
  }
  if (!/^[a-z0-9]{5,50}$/.test(parsed.registryName)) fail('registryName is invalid');
  if (parsed.registryLoginServer !== `${parsed.registryName}.azurecr.io`) fail('registryLoginServer does not match registryName');
  if (!/^[0-9a-f-]{36}$/i.test(parsed.appIdentityClientId)) fail('appIdentityClientId is invalid');
  return parsed;
}

export function selectRollbackRevisions(revisions) {
  if (!Array.isArray(revisions)) fail('revision list must be an array');
  const trafficServing = revisions.filter((revision) => (
    revision?.properties?.active === true
    && revision.properties.runningState === 'Running'
    && revision.properties.provisioningState === 'Succeeded'
    && Number(revision.properties.trafficWeight) === 100
  ));
  if (trafficServing.length !== 1) fail(`expected exactly one traffic-serving revision, found ${trafficServing.length}`);
  const current = trafficServing[0];
  const currentCreated = Date.parse(current.properties.createdTime);
  if (!Number.isFinite(currentCreated)) fail('traffic-serving revision lacks a valid createdTime');
  const predecessors = revisions
    .filter((revision) => revision?.name !== current.name && revision?.properties?.provisioningState === 'Succeeded')
    .map((revision) => ({ revision, created: Date.parse(revision.properties.createdTime) }))
    .filter(({ created }) => Number.isFinite(created) && created < currentCreated)
    .sort((left, right) => right.created - left.created);
  if (predecessors.length < 1) fail('no previous succeeded revision exists before the traffic-serving revision');
  return { currentRevision: current.name, previousRevision: predecessors[0].revision.name };
}

function releaseIdentityFromRevision(revision) {
  const containers = revision?.properties?.template?.containers;
  const container = Array.isArray(containers) ? containers.find((candidate) => candidate?.name === 'teams-core') : undefined;
  if (!container || typeof container.image !== 'string') fail('revision lacks the teams-core container image');
  const environment = new Map();
  for (const entry of container.env ?? []) {
    if (typeof entry?.name === 'string' && Object.hasOwn(releaseEnvironmentFields, entry.name)) {
      if (environment.has(entry.name) || typeof entry.value !== 'string') fail(`revision release field ${entry.name} is duplicated or not a plain value`);
      environment.set(entry.name, entry.value);
    }
  }
  const identity = { image: container.image };
  for (const [environmentName, receiptName] of Object.entries(releaseEnvironmentFields)) {
    if (!environment.has(environmentName)) fail(`revision lacks release identity field ${environmentName}`);
    identity[receiptName] = environment.get(environmentName);
  }
  if (!commitPattern.test(identity.commit)) fail('revision commit is invalid');
  if (!imageDigestPattern.test(identity.imageDigest)) fail('revision imageDigest is invalid');
  for (const field of ['teamsPackageSha256', 'clientBundleSha256', 'serverBundleSha256']) {
    if (!sha256Pattern.test(identity[field])) fail(`revision ${field} is invalid`);
  }
  return identity;
}

function validateProvenance(provenance, receipt) {
  if (
    provenance?.schemaVersion !== 1
    || provenance.attestationVerified !== true
    || provenance.commit !== receipt.commit
    || typeof provenance.repository !== 'string'
    || provenance.workflow !== `${provenance.repository}/.github/workflows/publish-image.yml`
    || !Number.isSafeInteger(provenance.artifactId)
    || !artifactDigestPattern.test(provenance.artifactDigest ?? '')
  ) fail('GitHub artifact attestation provenance is missing or does not match the release receipt');
}

export function validateReleaseDeployment({ receipt, provenance, revision, health, registryLoginServer, requireTraffic = true }) {
  validateProvenance(provenance, receipt);
  if (
    revision?.properties?.active !== true
    || revision.properties.provisioningState !== 'Succeeded'
    || revision.properties.runningState !== 'Running'
    || (requireTraffic && Number(revision.properties.trafficWeight) !== 100)
  ) fail('revision readiness or traffic state is not complete');
  const deployed = releaseIdentityFromRevision(revision);
  const expectedImage = `${registryLoginServer}/teamsapp@${receipt.imageDigest}`;
  if (deployed.image !== expectedImage) fail(`deployed image ${deployed.image} does not match ${expectedImage}`);
  for (const field of ['commit', 'version', 'imageDigest', 'teamsPackageSha256', 'clientBundleSha256', 'serverBundleSha256']) {
    if (deployed[field] !== receipt[field]) fail(`deployed revision ${field} does not match the attested receipt`);
  }
  if (
    health?.ok !== true
    || health.sourceCommit !== receipt.commit
    || health.version !== receipt.version
    || health.serverBundleSha256 !== receipt.serverBundleSha256
  ) fail('public health identity does not match commit, version, and serverBundleSha256 from the attested receipt');
  const publicIdentity = health?.azureReleaseIdentity;
  if (!publicIdentity || typeof publicIdentity !== 'object' || Array.isArray(publicIdentity)) {
    fail('public health azureReleaseIdentity is missing or invalid');
  }
  const publicIdentityKeys = Object.keys(publicIdentity);
  if (
    publicIdentityKeys.length !== publicReleaseIdentityFields.length
    || publicIdentityKeys.some((field) => !publicReleaseIdentityFields.includes(field))
  ) fail('public health azureReleaseIdentity contains an unexpected field');
  for (const field of publicReleaseIdentityFields) {
    if (publicIdentity[field] !== receipt[field]) {
      fail(`public health azureReleaseIdentity ${field} does not match the attested receipt`);
    }
  }
  return true;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'outputs' && (args.length === 1 || (args.length === 2 && args[1] === 'foundation'))) {
    print(parseDeploymentOutputs(readJson(args[0]), { requireContainerApp: args[1] !== 'foundation' }));
    return;
  }
  if (command === 'select-rollback' && args.length === 1) {
    print(selectRollbackRevisions(readJson(args[0])));
    return;
  }
  if (command === 'revision-identity' && args.length === 1) {
    print(releaseIdentityFromRevision(readJson(args[0])));
    return;
  }
  if (command === 'verify' && (args.length === 5 || (args.length === 6 && args[5] === 'pre-traffic'))) {
    const receipt = readAzureReleaseInput(args[0]);
    validateReleaseDeployment({
      receipt,
      provenance: readJson(args[1]),
      revision: readJson(args[2]),
      health: readJson(args[3]),
      registryLoginServer: args[4],
      requireTraffic: args[5] !== 'pre-traffic',
    });
    console.log(`Azure release deployment verified: ${receipt.commit}, ${receipt.version}, ${receipt.imageDigest}`);
    return;
  }
  throw new Error('Usage: azure-deployment-contract.mjs outputs <outputs.json> [foundation] | select-rollback <revisions.json> | revision-identity <revision.json> | verify <receipt.json> <provenance.json> <revision.json> <health.json> <registry-login-server> [pre-traffic]');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
