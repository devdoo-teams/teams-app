const zeroDigest = '0'.repeat(64);
const zeroCommit = '0'.repeat(40);

export const REQUIRED_AZURE_PROVIDERS = Object.freeze([
  'Microsoft.App',
  'Microsoft.Compute',
  'Microsoft.ContainerRegistry',
  'Microsoft.DocumentDB',
  'Microsoft.Insights',
  'Microsoft.KeyVault',
  'Microsoft.ManagedIdentity',
  'Microsoft.Network',
  'Microsoft.OperationalInsights',
  'Microsoft.Storage',
]);

const expectedResourceNamespaces = new Set([
  'microsoft.app',
  'microsoft.authorization',
  'microsoft.compute',
  'microsoft.containerregistry',
  'microsoft.documentdb',
  'microsoft.insights',
  'microsoft.keyvault',
  'microsoft.managedidentity',
  'microsoft.network',
  'microsoft.operationalinsights',
  'microsoft.resources',
  'microsoft.storage',
]);

function fail(message) {
  throw new Error(`Invalid Azure canary preflight: ${message}`);
}

function normalized(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function validateAzureAccount(payload, expected) {
  if (!payload || typeof payload !== 'object') fail('account response is malformed');
  if (normalized(payload.tenantId) !== normalized(expected.tenantId)) fail('tenant does not match the approved target');
  if (normalized(payload.id) !== normalized(expected.subscriptionId)) fail('subscription does not match the approved target');
  if (payload.state !== 'Enabled') fail(`subscription state must be Enabled, got ${String(payload.state)}`);
  if (normalized(payload.user?.name) !== normalized(expected.accountName)) fail('account does not match the approved operator');
  if (normalized(payload.user?.type) !== 'user') fail('account must be an authenticated user principal');
  return {
    tenantId: payload.tenantId,
    subscriptionId: payload.id,
    accountName: payload.user.name,
    accountType: payload.user.type,
    state: payload.state,
  };
}

export function validateAzureProviderRegistrations(payload) {
  if (!Array.isArray(payload)) fail('provider registration response is malformed');
  const states = new Map(payload.map((entry) => [normalized(entry?.namespace), entry?.registrationState]));
  const missing = REQUIRED_AZURE_PROVIDERS.filter((namespace) => states.get(normalized(namespace)) !== 'Registered');
  if (missing.length > 0) fail(`required providers are not Registered: ${missing.join(', ')}`);
  return [...REQUIRED_AZURE_PROVIDERS];
}

export function validateAzureResourceGroup(payload, expected) {
  if (!payload || typeof payload !== 'object') fail('resource group response is malformed');
  if (normalized(payload.name) !== normalized(expected.resourceGroup)) fail('resource group name does not match the approved target');
  if (normalized(payload.location) !== normalized(expected.location)) fail('resource group location does not match the approved target');
  if (payload.properties?.provisioningState !== 'Succeeded') fail('resource group provisioning state must be Succeeded');
  const expectedId = `/subscriptions/${expected.subscriptionId}/resourceGroups/${expected.resourceGroup}`;
  if (normalized(payload.id) !== normalized(expectedId)) fail('resource group scope does not match the approved subscription');
  return {
    id: payload.id,
    name: payload.name,
    location: payload.location,
    provisioningState: payload.properties.provisioningState,
  };
}

function assertIdentityValue(value, pattern, label) {
  if (!pattern.test(String(value ?? ''))) fail(`${label} is invalid`);
  return value;
}

export function buildAzureCanaryWhatIfArguments({
  subscriptionId,
  resourceGroup,
  location,
  commit,
  version,
  templateFile,
}) {
  assertIdentityValue(subscriptionId, /^[0-9a-f-]{36}$/i, 'subscription ID');
  assertIdentityValue(resourceGroup, /^[A-Za-z0-9._()\-]{1,90}$/, 'resource group');
  assertIdentityValue(location, /^[a-z0-9]+$/, 'location');
  assertIdentityValue(commit, /^[0-9a-f]{40}$/, 'source commit');
  assertIdentityValue(version, /^\d+\.\d+\.\d+$/, 'application version');
  if (typeof templateFile !== 'string' || templateFile.trim().length === 0) fail('template file is required');

  const imageDigest = `sha256:${zeroDigest}`;
  return [
    'deployment', 'group', 'what-if',
    '--subscription', subscriptionId,
    '--resource-group', resourceGroup,
    '--template-file', templateFile,
    '--mode', 'Incremental',
    '--result-format', 'ResourceIdOnly',
    '--no-pretty-print',
    '--only-show-errors',
    '--output', 'json',
    '--parameters',
    'workloadName=teamsapp',
    `location=${location}`,
    'enableCosmosFreeTier=true',
    'deployContainerApp=false',
    'deployWorkerVm=false',
    `containerImage=ghcr.io/devdoo-teams/teams-app@${imageDigest}`,
    'workerAdminSshPublicKey=ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAzureCanaryPreflightOnly teamsapp@azure-preflight',
    `releaseSourceCommit=${commit || zeroCommit}`,
    `releaseVersion=${version}`,
    `releaseImageDigest=${imageDigest}`,
    `releaseTeamsPackageSha256=${zeroDigest}`,
    `releaseClientBundleSha256=${zeroDigest}`,
    `releaseServerBundleSha256=${zeroDigest}`,
  ];
}

function isAllowlistedUnsupported(resourceId) {
  const id = normalized(resourceId);
  return id.includes('/providers/microsoft.authorization/roleassignments/')
    || id.includes('/providers/microsoft.authorization/roledefinitions/')
    || (
      id.includes('/providers/microsoft.documentdb/databaseaccounts/')
      && id.includes('/sqlroleassignments/')
    );
}

function resourceNamespace(resourceId) {
  const match = String(resourceId).match(/\/providers\/([^/]+)/i);
  return normalized(match?.[1]);
}

export function summarizeAzureWhatIf(payload, { subscriptionId, resourceGroup }) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.changes)) fail('what-if response is malformed');
  if (payload.status !== 'Succeeded') fail(`what-if status must be Succeeded, got ${String(payload.status)}`);
  if (payload.changes.length === 0) fail('what-if returned no resource changes');

  const expectedScope = normalized(`/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/`);
  const allowedChangeTypes = new Set(['Create', 'NoChange', 'Ignore', 'Unsupported']);
  const changeCounts = {};
  const unsupportedResources = [];

  for (const change of payload.changes) {
    const resourceId = String(change?.resourceId ?? '');
    const changeType = String(change?.changeType ?? '');
    if (!normalized(resourceId).startsWith(expectedScope)) fail(`resource is outside the approved scope: ${resourceId}`);
    const namespace = resourceNamespace(resourceId);
    if (!expectedResourceNamespaces.has(namespace)) fail(`resource namespace is outside the canary allowlist: ${namespace || resourceId}`);
    if (!allowedChangeTypes.has(changeType)) fail(`what-if contains disallowed ${changeType || 'unknown'} change for ${resourceId}`);
    if (changeType === 'Unsupported') {
      if (!isAllowlistedUnsupported(resourceId)) fail(`Unsupported resource is outside the manual-review allowlist: ${resourceId}`);
      unsupportedResources.push(resourceId);
    }
    changeCounts[changeType] = (changeCounts[changeType] ?? 0) + 1;
  }

  return {
    status: payload.status,
    changeCounts,
    unsupportedResources,
    manualReviewRequired: unsupportedResources.length > 0,
    destructiveChangeCount: 0,
  };
}

export function sanitizePreflightEnvironment(env = process.env) {
  const result = {};
  for (const [key, value] of Object.entries(env)) {
    if (/(token|secret|password|passwd|api[_-]?key|authorization|credential|(^|_)pat($|_))/i.test(key)) continue;
    result[key] = value;
  }
  return result;
}

function parseJsonOutput(result, label) {
  try {
    return JSON.parse(String(result?.stdout ?? ''));
  } catch {
    fail(`${label} did not return valid JSON`);
  }
}

function readSourceIdentity(rootCwd) {
  let packageJson;
  let manifest;
  try {
    packageJson = JSON.parse(fs.readFileSync(path.join(rootCwd, 'package.json'), 'utf8'));
    manifest = JSON.parse(fs.readFileSync(path.join(rootCwd, 'appPackage', 'manifest.json'), 'utf8'));
  } catch {
    fail('package or Teams manifest identity is unreadable');
  }
  if (!/^\d+\.\d+\.\d+$/.test(String(packageJson.version ?? ''))) fail('package version is invalid');
  if (manifest.version !== packageJson.version) fail('package and Teams manifest versions do not match');
  if (typeof manifest.id !== 'string' || manifest.id.trim().length === 0) fail('Teams manifest app ID is missing');
  return { version: packageJson.version, teamsAppId: manifest.id };
}

async function defaultCommandRunner(command, args, options) {
  return await runProcessWithTimeout(command, args, { ...options, spawnProcess: spawn });
}

function commandDigest(result) {
  return crypto.createHash('sha256')
    .update(String(result?.stdout ?? ''))
    .update('\0')
    .update(String(result?.stderr ?? ''))
    .digest('hex');
}

export async function runAzureCanaryPreflight({
  rootCwd = process.cwd(),
  config,
  commandRunner = defaultCommandRunner,
  env = process.env,
  now = () => new Date().toISOString(),
} = {}) {
  if (!config || typeof config !== 'object') fail('configuration is required');
  for (const name of ['tenantId', 'subscriptionId', 'accountName', 'resourceGroup', 'location']) {
    if (typeof config[name] !== 'string' || config[name].trim().length === 0) fail(`${name} is required`);
  }

  const canonicalRoot = fs.realpathSync(path.resolve(rootCwd));
  const childEnv = sanitizePreflightEnvironment(env);
  const gitBin = config.gitBin ?? 'git';
  const azureCli = config.azureCli ?? childEnv.AZURE_CLI_BIN ?? 'az';
  const npmBin = config.npmBin ?? 'npm';
  const run = (command, args, timeoutMs) => commandRunner(command, args, {
    cwd: canonicalRoot,
    env: childEnv,
    timeoutMs,
  });

  const topLevelResult = await run(gitBin, ['rev-parse', '--show-toplevel'], 30_000);
  const reportedTopLevel = fs.realpathSync(String(topLevelResult.stdout ?? '').trim());
  if (reportedTopLevel !== canonicalRoot) fail('rootCwd is not the canonical Git worktree root');

  const statusResult = await run(gitBin, ['status', '--porcelain=v1', '--untracked-files=no'], 30_000);
  if (String(statusResult.stdout ?? '').trim().length > 0) fail('tracked worktree must be clean before Azure preflight');

  const headResult = await run(gitBin, ['rev-parse', 'HEAD'], 30_000);
  const commit = String(headResult.stdout ?? '').trim();
  assertIdentityValue(commit, /^[0-9a-f]{40}$/, 'source commit');
  const sourceIdentity = readSourceIdentity(canonicalRoot);

  const accountResult = await run(azureCli, [
    'account', 'show',
    '--subscription', config.subscriptionId,
    '--only-show-errors',
    '--output', 'json',
  ], 30_000);
  const account = validateAzureAccount(parseJsonOutput(accountResult, 'account lookup'), config);

  const providerResult = await run(azureCli, [
    'provider', 'list',
    '--subscription', config.subscriptionId,
    '--query', '[].{namespace:namespace,registrationState:registrationState}',
    '--only-show-errors',
    '--output', 'json',
  ], 30_000);
  const providers = validateAzureProviderRegistrations(parseJsonOutput(providerResult, 'provider lookup'));

  const groupResult = await run(azureCli, [
    'group', 'show',
    '--subscription', config.subscriptionId,
    '--name', config.resourceGroup,
    '--only-show-errors',
    '--output', 'json',
  ], 30_000);
  const group = validateAzureResourceGroup(parseJsonOutput(groupResult, 'resource group lookup'), config);

  const azureCoreResult = await run(npmBin, ['run', 'test:azure-core'], 300_000);
  const postTestStatus = await run(gitBin, ['status', '--porcelain=v1', '--untracked-files=no'], 30_000);
  if (String(postTestStatus.stdout ?? '').trim().length > 0) {
    fail('tracked worktree changed during Azure preflight regression tests');
  }
  const postTestHead = String((await run(gitBin, ['rev-parse', 'HEAD'], 30_000)).stdout ?? '').trim();
  if (postTestHead !== commit) fail('source commit changed during Azure preflight regression tests');
  const whatIfArguments = buildAzureCanaryWhatIfArguments({
    subscriptionId: config.subscriptionId,
    resourceGroup: config.resourceGroup,
    location: config.location,
    commit,
    version: sourceIdentity.version,
    templateFile: path.join(canonicalRoot, 'infra', 'azure', 'main.bicep'),
  });
  const whatIfResult = await run(azureCli, whatIfArguments, 300_000);
  const whatIf = summarizeAzureWhatIf(parseJsonOutput(whatIfResult, 'ARM what-if'), config);

  return {
    schemaVersion: 1,
    kind: 'azure-canary-preflight',
    nonMutating: true,
    status: whatIf.manualReviewRequired ? 'REVIEW_REQUIRED' : 'READY',
    target: {
      tenantId: account.tenantId,
      subscriptionId: account.subscriptionId,
      accountName: account.accountName,
      resourceGroup: group.name,
      resourceGroupId: group.id,
      location: group.location,
    },
    source: {
      root: canonicalRoot,
      commit,
      version: sourceIdentity.version,
      teamsAppId: sourceIdentity.teamsAppId,
      trackedClean: true,
    },
    providers: { required: providers, allRegistered: true },
    azureCore: {
      passed: true,
      outputSha256: commandDigest(azureCoreResult),
    },
    whatIf,
    checkedAt: now(),
  };
}

function parseCliArguments(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith('--') || value === undefined) fail('CLI arguments must be --name value pairs');
    const name = flag.slice(2);
    if (name in values) fail(`duplicate CLI argument --${name}`);
    values[name] = value;
  }
  const allowed = new Set(['tenant-id', 'subscription-id', 'account-name', 'resource-group', 'location', 'root', 'output-file']);
  for (const name of Object.keys(values)) if (!allowed.has(name)) fail(`unknown CLI argument --${name}`);
  return values;
}

async function main() {
  const args = parseCliArguments(process.argv.slice(2));
  const receipt = await runAzureCanaryPreflight({
    rootCwd: args.root ?? process.cwd(),
    config: {
      tenantId: args['tenant-id'],
      subscriptionId: args['subscription-id'],
      accountName: args['account-name'],
      resourceGroup: args['resource-group'],
      location: args.location,
    },
  });
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (args['output-file']) {
    const outputPath = path.resolve(args['output-file']);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, { flag: 'wx', mode: 0o600 });
    console.log(`Azure canary preflight receipt written: ${outputPath} (${receipt.status})`);
    return;
  }
  process.stdout.write(serialized);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runProcessWithTimeout } from './core-test-runner.mjs';
