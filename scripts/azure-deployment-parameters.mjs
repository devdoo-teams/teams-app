import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  readAzureReleaseInput,
  validateAzureReleaseInput,
} from './azure-release-input.mjs';

const SHA256 = /^[0-9a-f]{64}$/u;
const WORKLOAD_NAME = /^[a-z][a-z0-9-]{2,13}$/u;
const LOCATION = /^[a-z0-9]+$/u;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SSH_PUBLIC_KEY = /^(?:ssh-(?:ed25519|rsa)|ecdsa-sha2-nistp(?:256|384|521)) [A-Za-z0-9+/=]+(?: [^\r\n]{1,128})?$/u;
const ACR_IMAGE = /^[a-z0-9][a-z0-9.-]*\.azurecr\.io\/teamsapp@sha256:[0-9a-f]{64}$/u;
const PHASES = new Set(['foundation', 'workload']);
const PARAMETER_SCHEMA = 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#';

function fail(message) {
  throw new Error(`Invalid Azure deployment parameters: ${message}`);
}

function validateWorkerArtifactUrl(value, commit) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail('worker artifact URL is invalid');
  }
  if (url.protocol !== 'https:'
    || !/^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]\.blob\.core\.windows\.net$/u.test(url.hostname)
    || url.username
    || url.password
    || url.search
    || url.hash
    || !url.pathname.endsWith(`/${commit}/worker-runtime-${commit}.tar`)) {
    fail('worker artifact URL must be the immutable Azure Blob path for the release commit');
  }
  return url.toString();
}

function parameter(value) {
  return { value };
}

export function buildAzureDeploymentParameters({
  phase,
  release: inputRelease,
  workloadName,
  location,
  deploymentPrincipalId,
  containerImage,
  workerAdminSshPublicKey,
  workerArtifactUrl,
  workerArtifactSha256,
  codexBinSha256,
  initializeWorkerVm,
}) {
  if (!PHASES.has(phase)) fail('phase must be foundation or workload');
  const release = validateAzureReleaseInput(inputRelease);
  if (!WORKLOAD_NAME.test(String(workloadName ?? ''))) fail('workload name is invalid');
  if (!LOCATION.test(String(location ?? ''))) fail('location is invalid');
  if (!GUID.test(String(deploymentPrincipalId ?? ''))) fail('deployment principal ID is invalid');
  if (!SSH_PUBLIC_KEY.test(String(workerAdminSshPublicKey ?? ''))) fail('worker admin SSH public key is invalid');

  if (phase === 'foundation') {
    const expectedImage = `${release.image}@${release.imageDigest}`;
    if (containerImage !== expectedImage) fail('foundation container image must match the GitHub release receipt');
    if ([workerArtifactUrl, workerArtifactSha256, codexBinSha256].some((value) => value !== undefined)) {
      fail('foundation parameters must not include workload-only worker artifact fields');
    }
    if (initializeWorkerVm !== undefined) fail('foundation parameters must not include initialize worker VM');
  } else {
    if (!ACR_IMAGE.test(String(containerImage ?? ''))) fail('workload container image must be an immutable Azure Container Registry digest');
    if (containerImage.slice(containerImage.indexOf('@') + 1) !== release.imageDigest) {
      fail('workload container image digest must match the GitHub release receipt');
    }
    if (!workerArtifactUrl || !workerArtifactSha256 || !codexBinSha256) {
      fail('workload worker artifact URL and SHA-256 values are required');
    }
    if (typeof initializeWorkerVm !== 'boolean') fail('workload initialize worker VM must be an explicit boolean');
    validateWorkerArtifactUrl(workerArtifactUrl, release.commit);
    if (!SHA256.test(workerArtifactSha256)) fail('worker artifact SHA-256 is invalid');
    if (!SHA256.test(codexBinSha256)) fail('Codex executable SHA-256 is invalid');
  }

  const parameters = {
    workloadName: parameter(workloadName),
    location: parameter(location),
    deploymentPrincipalId: parameter(deploymentPrincipalId.toLowerCase()),
    containerImage: parameter(containerImage),
    workerAdminSshPublicKey: parameter(workerAdminSshPublicKey),
    enableCosmosFreeTier: parameter(true),
    deployContainerApp: parameter(phase === 'workload'),
    deployWorkerVm: parameter(phase === 'workload'),
    initializeWorkerVm: parameter(phase === 'workload' ? initializeWorkerVm : false),
    releaseSourceCommit: parameter(release.commit),
    releaseVersion: parameter(release.version),
    releaseImageDigest: parameter(release.imageDigest),
    releaseTeamsPackageSha256: parameter(release.teamsPackageSha256),
    releaseClientBundleSha256: parameter(release.clientBundleSha256),
    releaseServerBundleSha256: parameter(release.serverBundleSha256),
  };
  if (phase === 'workload') {
    parameters.workerArtifactUrl = parameter(workerArtifactUrl);
    parameters.workerArtifactSha256 = parameter(workerArtifactSha256);
    parameters.codexBinSha256 = parameter(codexBinSha256);
  }

  return {
    $schema: PARAMETER_SCHEMA,
    contentVersion: '1.0.0.0',
    parameters,
  };
}

function parseArguments(args) {
  const allowed = new Set([
    '--phase',
    '--release-receipt',
    '--workload-name',
    '--location',
    '--container-image',
    '--deployment-principal-id',
    '--worker-admin-ssh-public-key',
    '--worker-artifact-url',
    '--worker-artifact-sha256',
    '--codex-bin-sha256',
    '--initialize-worker-vm',
    '--output',
  ]);
  const required = new Set([
    '--phase',
    '--release-receipt',
    '--workload-name',
    '--location',
    '--container-image',
    '--deployment-principal-id',
    '--worker-admin-ssh-public-key',
    '--output',
  ]);
  if (args.length % 2 !== 0) fail('arguments must be --name value pairs');
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name)) fail(`unknown argument: ${name ?? '<missing>'}`);
    if (values.has(name)) fail(`duplicate argument: ${name}`);
    if (!value?.trim()) fail(`${name} must not be empty`);
    values.set(name, value);
  }
  for (const name of required) {
    if (!values.has(name)) fail(`${name} is required`);
  }
  if (values.get('--phase') === 'workload' && !values.has('--initialize-worker-vm')) {
    fail('--initialize-worker-vm is required for workload');
  }
  if (values.get('--phase') === 'foundation' && values.has('--initialize-worker-vm')) {
    fail('--initialize-worker-vm is workload-only');
  }
  return values;
}

function parseBoolean(value, name) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  fail(`${name} must be true or false`);
}

function assertRegularReleaseReceipt(receiptPath) {
  const absolutePath = path.resolve(receiptPath);
  const stat = fs.lstatSync(absolutePath, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) fail('release receipt must be a regular file');
  return absolutePath;
}

function writeExclusive(outputPath, value) {
  const absolutePath = path.resolve(outputPath);
  const parent = path.dirname(absolutePath);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const parentStat = fs.lstatSync(parent);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) fail('output parent must be a real directory');
  fs.writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  const handle = fs.openSync(absolutePath, 'r');
  try {
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function runCli() {
  const values = parseArguments(process.argv.slice(2));
  const release = readAzureReleaseInput(assertRegularReleaseReceipt(values.get('--release-receipt')));
  const result = buildAzureDeploymentParameters({
    phase: values.get('--phase'),
    release,
    workloadName: values.get('--workload-name'),
    location: values.get('--location'),
    containerImage: values.get('--container-image'),
    deploymentPrincipalId: values.get('--deployment-principal-id'),
    workerAdminSshPublicKey: values.get('--worker-admin-ssh-public-key'),
    workerArtifactUrl: values.get('--worker-artifact-url'),
    workerArtifactSha256: values.get('--worker-artifact-sha256'),
    codexBinSha256: values.get('--codex-bin-sha256'),
    initializeWorkerVm: values.has('--initialize-worker-vm')
      ? parseBoolean(values.get('--initialize-worker-vm'), '--initialize-worker-vm')
      : undefined,
  });
  writeExclusive(values.get('--output'), result);
  process.stdout.write(`Azure ${values.get('--phase')} deployment parameters written\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
