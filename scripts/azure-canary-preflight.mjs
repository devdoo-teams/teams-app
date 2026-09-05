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
    '--result-format', 'FullResourcePayloads',
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

const allowedWhatIfExpressionFunctions = new Set([
  'empty',
  'extensionresourceid',
  'filter',
  'format',
  'guid',
  'lambda',
  'lambdavariables',
  'not',
  'reference',
  'resourceid',
  'split',
]);

function validateExpressionReferences(expression, { subscriptionId, resourceGroup }) {
  if (expression.includes('\n') || !expression.endsWith(')]')) fail('what-if resource expression is malformed');
  const functions = [...expression.matchAll(/\b([A-Za-z][A-Za-z0-9]*)\s*\(/g)]
    .map((match) => normalized(match[1]));
  if (functions.length === 0 || functions.some((name) => !allowedWhatIfExpressionFunctions.has(name))) {
    fail('what-if resource expression contains a function outside the allowlist');
  }
  if (!functions.includes('reference')) {
    fail('what-if resource expression is not an unresolved reference expression');
  }

  const subscriptions = [...expression.matchAll(/\/subscriptions\/([^/'",)\]\s]+)/gi)]
    .map((match) => normalized(match[1]));
  if (subscriptions.length === 0 || subscriptions.some((value) => value !== normalized(subscriptionId))) {
    fail('what-if resource expression is outside the approved subscription scope');
  }
  const resourceGroups = [...expression.matchAll(/\/resourceGroups\/([^/'",)\]\s]+)/gi)]
    .map((match) => normalized(match[1]));
  if (resourceGroups.length === 0 || resourceGroups.some((value) => value !== normalized(resourceGroup))) {
    fail('what-if resource expression is outside the approved resource-group scope');
  }
}

function unsupportedExpressionNamespace(resourceId, expected) {
  const expression = String(resourceId).trim();
  validateExpressionReferences(expression, expected);
  const expectedScope = normalized(`/subscriptions/${expected.subscriptionId}/resourceGroups/${expected.resourceGroup}/`);

  const extensionMatch = expression.match(/^\[extensionResourceId\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,/i);
  if (extensionMatch) {
    const baseResourceId = normalized(extensionMatch[1]);
    const extensionType = normalized(extensionMatch[2]);
    if (!baseResourceId.startsWith(expectedScope)) fail('what-if extension resource expression is outside the approved scope');
    const baseNamespace = resourceNamespace(baseResourceId);
    if (!expectedResourceNamespaces.has(baseNamespace)) fail('what-if extension base namespace is outside the canary allowlist');
    if (extensionType !== 'microsoft.authorization/roleassignments') {
      fail('what-if extension resource expression type is outside the allowlist');
    }
    return 'microsoft.authorization';
  }

  const resourceMatch = expression.match(/^\[resourceId\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,/i);
  if (resourceMatch) {
    const [, expressionSubscription, expressionResourceGroup, resourceType] = resourceMatch;
    if (normalized(expressionSubscription) !== normalized(expected.subscriptionId)
      || normalized(expressionResourceGroup) !== normalized(expected.resourceGroup)) {
      fail('what-if resource expression is outside the approved scope');
    }
    if (normalized(resourceType) !== 'microsoft.documentdb/databaseaccounts/sqlroleassignments') {
      fail('what-if resource expression type is outside the allowlist');
    }
    return 'microsoft.documentdb';
  }

  fail('what-if Unsupported resource expression shape is outside the allowlist');
}

function validatedUnsupportedReason(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') fail('Unsupported reason must be a string when provided');
  const reason = value.trim();
  if (reason.length === 0) return null;
  if (Buffer.byteLength(reason, 'utf8') > 4096) fail('Unsupported reason exceeds the 4 KiB limit');
  const containsForbiddenControl = [...reason].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 8
      || codePoint === 11
      || codePoint === 12
      || (codePoint >= 14 && codePoint <= 31)
      || (codePoint >= 127 && codePoint <= 159);
  });
  if (containsForbiddenControl) {
    fail('Unsupported reason contains a forbidden control character');
  }
  return reason;
}

const knownResourceChangeTypes = new Set([
  'Create',
  'Delete',
  'Ignore',
  'Deploy',
  'NoChange',
  'Modify',
  'Unsupported',
]);
const knownPropertyChangeTypes = new Set(['Create', 'Delete', 'Modify', 'Array', 'NoEffect']);
const MAX_DIAGNOSTIC_CHANGES = 512;
const MAX_DIAGNOSTIC_PROPERTY_CHANGES = 4096;
const MAX_DIAGNOSTIC_DEPTH = 32;

function validatedPropertyPath(value) {
  if (typeof value !== 'string' || value.length === 0) fail('what-if property-change path is invalid');
  if (Buffer.byteLength(value, 'utf8') > 2048) fail('what-if property-change path exceeds the 2 KiB limit');
  const containsForbiddenControl = [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
  });
  if (containsForbiddenControl) fail('what-if property-change path contains a forbidden control character');
  return value;
}

function collectPropertyChanges(entries, result, depth = 0) {
  if (entries === undefined || entries === null) return false;
  if (!Array.isArray(entries)) fail('what-if property-change delta must be an array');
  if (depth > MAX_DIAGNOSTIC_DEPTH) fail('what-if property-change nesting exceeds the supported depth');
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('what-if property change is malformed');
    const path = validatedPropertyPath(entry.path);
    const propertyChangeType = String(entry.propertyChangeType ?? '');
    if (!knownPropertyChangeTypes.has(propertyChangeType)) {
      fail(`what-if property change has an unknown type: ${propertyChangeType || '<missing>'}`);
    }
    result.push({ path, propertyChangeType });
    if (result.length > MAX_DIAGNOSTIC_PROPERTY_CHANGES) {
      fail(`what-if property changes exceed the ${MAX_DIAGNOSTIC_PROPERTY_CHANGES} entry limit`);
    }
    collectPropertyChanges(entry.children, result, depth + 1);
  }
  return true;
}

const providerNoiseRules = Object.freeze([
  Object.freeze({
    rule: 'managed-environment-customer-id-reference',
    changeType: 'Modify',
    resource: /^providers\/microsoft\.app\/managedenvironments\/teamsapp-env-[a-z0-9]{8}$/u,
    propertyChanges: Object.freeze([
      Object.freeze({
        path: 'properties.appLogsConfiguration.logAnalyticsConfiguration.customerId',
        propertyChangeType: 'Modify',
      }),
    ]),
  }),
  Object.freeze({
    rule: 'cosmos-account-read-only-endpoint',
    changeType: 'Modify',
    resource: /^providers\/microsoft\.documentdb\/databaseaccounts\/teamsapp-cosmos-[a-z0-9]{8}$/u,
    propertyChanges: Object.freeze([
      Object.freeze({ path: 'properties.sqlEndpoint', propertyChangeType: 'Delete' }),
    ]),
  }),
  Object.freeze({
    rule: 'cosmos-database-request-options',
    changeType: 'Modify',
    resource: /^providers\/microsoft\.documentdb\/databaseaccounts\/teamsapp-cosmos-[a-z0-9]{8}\/sqldatabases\/teamsapp$/u,
    propertyChanges: Object.freeze([
      Object.freeze({ path: 'properties.options', propertyChangeType: 'Create' }),
    ]),
  }),
  Object.freeze({
    rule: 'application-insights-rest-defaults',
    changeType: 'Modify',
    resource: /^providers\/microsoft\.insights\/components\/teamsapp-insights-[a-z0-9]{8}$/u,
    propertyChanges: Object.freeze([
      Object.freeze({ path: 'properties.Flow_Type', propertyChangeType: 'Create' }),
      Object.freeze({ path: 'properties.Request_Source', propertyChangeType: 'Create' }),
    ]),
  }),
  Object.freeze({
    rule: 'incremental-smart-detection-ignore',
    changeType: 'Ignore',
    resource: /^providers\/microsoft\.insights\/actiongroups\/application insights smart detection$/u,
    propertyChanges: Object.freeze([]),
  }),
  Object.freeze({
    rule: 'foundation-omitted-container-app',
    phase: 'foundation',
    changeType: 'Ignore',
    resource: /^providers\/microsoft\.app\/containerapps\/teamsapp-canary-[a-z0-9]{8}$/u,
    propertyChanges: Object.freeze([]),
  }),
  Object.freeze({
    rule: 'foundation-omitted-worker-os-disk',
    phase: 'foundation',
    changeType: 'Ignore',
    resource: /^providers\/microsoft\.compute\/disks\/teamsapp-worker-[a-z0-9]{8}_disk1_[0-9a-f]{32}$/u,
    propertyChanges: Object.freeze([]),
  }),
  Object.freeze({
    rule: 'foundation-omitted-worker-vm',
    phase: 'foundation',
    changeType: 'Ignore',
    resource: /^providers\/microsoft\.compute\/virtualmachines\/teamsapp-worker-[a-z0-9]{8}$/u,
    propertyChanges: Object.freeze([]),
  }),
  Object.freeze({
    rule: 'foundation-omitted-worker-runtime-extension',
    phase: 'foundation',
    changeType: 'Ignore',
    resource: /^providers\/microsoft\.compute\/virtualmachines\/teamsapp-worker-[a-z0-9]{8}\/extensions\/teamsapp-worker-runtime$/u,
    propertyChanges: Object.freeze([]),
  }),
  Object.freeze({
    rule: 'foundation-omitted-worker-nic',
    phase: 'foundation',
    changeType: 'Ignore',
    resource: /^providers\/microsoft\.network\/networkinterfaces\/teamsapp-worker-[a-z0-9]{8}-nic$/u,
    propertyChanges: Object.freeze([]),
  }),
  Object.freeze({
    rule: 'foundation-omitted-worker-vnet',
    phase: 'foundation',
    changeType: 'Ignore',
    resource: /^providers\/microsoft\.network\/virtualnetworks\/teamsapp-worker-[a-z0-9]{8}-network$/u,
    propertyChanges: Object.freeze([]),
  }),
  Object.freeze({
    rule: 'workload-worker-nic-rest-defaults',
    phase: 'workload',
    changeType: 'Modify',
    resource: /^providers\/microsoft\.network\/networkinterfaces\/teamsapp-worker-[a-z0-9]{8}-nic$/u,
    propertyChanges: Object.freeze([
      Object.freeze({ path: '0', propertyChangeType: 'Modify' }),
      Object.freeze({ path: 'kind', propertyChangeType: 'Delete' }),
      Object.freeze({ path: 'properties.allowPort25Out', propertyChangeType: 'Delete' }),
      Object.freeze({ path: 'properties.auxiliaryMode', propertyChangeType: 'Delete' }),
      Object.freeze({ path: 'properties.auxiliarySku', propertyChangeType: 'Delete' }),
      Object.freeze({ path: 'properties.disableTcpStateTracking', propertyChangeType: 'Delete' }),
      Object.freeze({ path: 'properties.ipConfigurations', propertyChangeType: 'Array' }),
      Object.freeze({ path: 'properties.privateIPAddress', propertyChangeType: 'Delete' }),
      Object.freeze({ path: 'properties.privateIPAddressVersion', propertyChangeType: 'Delete' }),
    ]),
  }),
  Object.freeze({
    rule: 'workload-managed-worker-os-disk',
    phase: 'workload',
    changeType: 'Ignore',
    resource: /^providers\/microsoft\.compute\/disks\/teamsapp-worker-[a-z0-9]{8}_disk1_[0-9a-f]{32}$/u,
    propertyChanges: Object.freeze([]),
  }),
]);

const workloadContainerAppReleaseUpdatePropertyChanges = Object.freeze([
  Object.freeze({ path: '0', propertyChangeType: 'Modify' }),
  Object.freeze({ path: '0', propertyChangeType: 'Modify' }),
  Object.freeze({ path: '0', propertyChangeType: 'Modify' }),
  Object.freeze({ path: '0', propertyChangeType: 'Modify' }),
  Object.freeze({ path: '1', propertyChangeType: 'Modify' }),
  Object.freeze({ path: '10', propertyChangeType: 'Modify' }),
  Object.freeze({ path: '12', propertyChangeType: 'Modify' }),
  Object.freeze({ path: '2', propertyChangeType: 'Modify' }),
  Object.freeze({ path: '2', propertyChangeType: 'Modify' }),
  Object.freeze({ path: '6', propertyChangeType: 'Modify' }),
  Object.freeze({ path: '7', propertyChangeType: 'Modify' }),
  Object.freeze({ path: 'env', propertyChangeType: 'Array' }),
  Object.freeze({ path: 'image', propertyChangeType: 'Modify' }),
  Object.freeze({ path: 'keyVaultUrl', propertyChangeType: 'Modify' }),
  Object.freeze({ path: 'keyVaultUrl', propertyChangeType: 'Modify' }),
  Object.freeze({ path: 'keyVaultUrl', propertyChangeType: 'Modify' }),
  Object.freeze({ path: 'properties.configuration.ingress.exposedPort', propertyChangeType: 'Delete' }),
  Object.freeze({ path: 'properties.configuration.maxInactiveRevisions', propertyChangeType: 'Delete' }),
  Object.freeze({ path: 'properties.configuration.registries', propertyChangeType: 'Array' }),
  Object.freeze({ path: 'properties.configuration.secrets', propertyChangeType: 'Array' }),
  Object.freeze({ path: 'properties.runningStatus', propertyChangeType: 'Delete' }),
  Object.freeze({ path: 'properties.template.containers', propertyChangeType: 'Array' }),
  Object.freeze({ path: 'properties.template.revisionSuffix', propertyChangeType: 'Modify' }),
  Object.freeze({ path: 'properties.workloadProfileName', propertyChangeType: 'Delete' }),
  Object.freeze({ path: 'server', propertyChangeType: 'Modify' }),
  Object.freeze({ path: 'value', propertyChangeType: 'Modify' }),
  Object.freeze({ path: 'value', propertyChangeType: 'Modify' }),
  Object.freeze({ path: 'value', propertyChangeType: 'Modify' }),
  Object.freeze({ path: 'value', propertyChangeType: 'Modify' }),
  Object.freeze({ path: 'value', propertyChangeType: 'Modify' }),
  Object.freeze({ path: 'value', propertyChangeType: 'Modify' }),
]);

const workloadContainerAppReleaseUpdateVariants = Object.freeze([
  workloadContainerAppReleaseUpdatePropertyChanges,
  // ARM what-if can omit this service-defaulted Delete noise; keep both complete observed multisets exact.
  Object.freeze(workloadContainerAppReleaseUpdatePropertyChanges.filter(
    ({ path: propertyPath }) => propertyPath !== 'properties.configuration.maxInactiveRevisions',
  )),
]);

const plannedChangeRules = Object.freeze([
  ...workloadContainerAppReleaseUpdateVariants.map((propertyChanges) => Object.freeze({
    rule: 'workload-container-app-release-update',
    phase: 'workload',
    changeType: 'Modify',
    resource: /^providers\/microsoft\.app\/containerapps\/teamsapp-canary-[a-z0-9]{8}$/u,
    propertyChanges,
  })),
  Object.freeze({
    rule: 'workload-worker-runtime-extension-update',
    phase: 'workload',
    changeType: 'Modify',
    resource: /^providers\/microsoft\.compute\/virtualmachines\/teamsapp-worker-[a-z0-9]{8}\/extensions\/teamsapp-worker-runtime$/u,
    propertyChanges: Object.freeze([
      Object.freeze({ path: 'properties.forceUpdateTag', propertyChangeType: 'Modify' }),
    ]),
  }),
]);

function sortedPropertyChanges(propertyChanges) {
  return [...propertyChanges]
    .map(({ path, propertyChangeType }) => ({
      path: validatedPropertyPath(path),
      propertyChangeType: String(propertyChangeType ?? ''),
    }))
    .sort((left, right) => `${left.path}\u0000${left.propertyChangeType}`
      .localeCompare(`${right.path}\u0000${right.propertyChangeType}`));
}

function equalPropertyChanges(left, right) {
  return JSON.stringify(sortedPropertyChanges(left)) === JSON.stringify(sortedPropertyChanges(right));
}

function classifyAzureWhatIfRule(change, { subscriptionId, resourceGroup, phase }, rules) {
  if (!change || typeof change !== 'object' || Array.isArray(change)) return null;
  const resourceId = String(change.resourceId ?? '');
  const changeType = String(change.changeType ?? '');
  const expectedScope = normalized(`/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/`);
  const normalizedResourceId = normalized(resourceId);
  if (!normalizedResourceId.startsWith(expectedScope)) return null;

  let propertyChanges;
  if (Array.isArray(change.propertyChanges)) {
    propertyChanges = sortedPropertyChanges(change.propertyChanges);
  } else {
    const collected = [];
    const detailsAvailable = collectPropertyChanges(change.delta, collected);
    if (changeType === 'Modify' && !detailsAvailable) return null;
    propertyChanges = sortedPropertyChanges(collected);
  }

  const scopedResource = normalizedResourceId.slice(expectedScope.length);
  const matchingRule = rules.find((candidate) => (
    candidate.changeType === changeType
    && (candidate.phase === undefined || candidate.phase === phase)
    && candidate.resource.test(scopedResource)
    && equalPropertyChanges(candidate.propertyChanges, propertyChanges)
  ));
  if (!matchingRule) return null;

  return {
    resourceId,
    changeType,
    rule: matchingRule.rule,
    propertyChanges,
  };
}

export function classifyAzureWhatIfProviderNoise(change, context) {
  return classifyAzureWhatIfRule(change, context, providerNoiseRules);
}

export function classifyAzureWhatIfPlannedChange(change, context) {
  return classifyAzureWhatIfRule(change, context, plannedChangeRules);
}

export function diagnoseAzureWhatIf(payload, { subscriptionId, resourceGroup }) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.changes)) fail('what-if response is malformed');
  if (payload.status !== 'Succeeded') fail(`what-if status must be Succeeded, got ${String(payload.status)}`);
  if (payload.changes.length === 0) fail('what-if returned no resource changes');
  if (payload.changes.length > MAX_DIAGNOSTIC_CHANGES) {
    fail(`what-if resource changes exceed the ${MAX_DIAGNOSTIC_CHANGES} entry limit`);
  }

  const expectedScope = normalized(`/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/`);
  const changeCounts = {};
  const changes = payload.changes.map((change) => {
    const resourceId = String(change?.resourceId ?? '');
    const changeType = String(change?.changeType ?? '');
    if (!knownResourceChangeTypes.has(changeType)) {
      fail(`what-if contains unknown change type ${changeType || '<missing>'} for ${resourceId || '<missing>'}`);
    }
    const unresolvedExpression = resourceId.trim().startsWith('[');
    if (unresolvedExpression && changeType !== 'Unsupported') {
      fail(`what-if resource expressions are only accepted for Unsupported changes: ${resourceId}`);
    }
    if (!unresolvedExpression && !normalized(resourceId).startsWith(expectedScope)) {
      fail(`resource is outside the approved scope: ${resourceId}`);
    }
    const namespace = unresolvedExpression
      ? unsupportedExpressionNamespace(resourceId, { subscriptionId, resourceGroup })
      : resourceNamespace(resourceId);
    if (!expectedResourceNamespaces.has(namespace)) {
      fail(`resource namespace is outside the canary allowlist: ${namespace || resourceId}`);
    }
    if (changeType === 'Unsupported'
      && !unresolvedExpression
      && !isAllowlistedUnsupported(resourceId)) {
      fail(`Unsupported resource is outside the manual-review allowlist: ${resourceId}`);
    }

    const propertyChanges = [];
    const propertyChangeDetailsAvailable = collectPropertyChanges(change.delta, propertyChanges);
    changeCounts[changeType] = (changeCounts[changeType] ?? 0) + 1;
    return {
      resourceId,
      changeType,
      propertyChangeDetailsAvailable,
      propertyChanges,
    };
  });

  return { status: payload.status, changeCounts, changes };
}

export function summarizeAzureWhatIf(payload, { subscriptionId, resourceGroup, phase }) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.changes)) fail('what-if response is malformed');
  if (payload.status !== 'Succeeded') fail(`what-if status must be Succeeded, got ${String(payload.status)}`);
  if (payload.changes.length === 0) fail('what-if returned no resource changes');

  const expectedScope = normalized(`/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/`);
  const allowedChangeTypes = new Set(['Create', 'NoChange', 'Unsupported']);
  const changeCounts = {};
  const unsupportedResources = [];
  const unsupportedChanges = [];
  const approvedProviderNoise = [];
  const approvedPlannedChanges = [];

  for (const change of payload.changes) {
    const resourceId = String(change?.resourceId ?? '');
    const changeType = String(change?.changeType ?? '');
    const unresolvedExpression = resourceId.trim().startsWith('[');
    if (unresolvedExpression && changeType !== 'Unsupported') {
      fail(`what-if resource expressions are only accepted for Unsupported changes: ${resourceId}`);
    }
    if (!unresolvedExpression && !normalized(resourceId).startsWith(expectedScope)) {
      fail(`resource is outside the approved scope: ${resourceId}`);
    }
    const namespace = unresolvedExpression
      ? unsupportedExpressionNamespace(resourceId, { subscriptionId, resourceGroup })
      : resourceNamespace(resourceId);
    if (!expectedResourceNamespaces.has(namespace)) fail(`resource namespace is outside the canary allowlist: ${namespace || resourceId}`);
    const providerNoise = classifyAzureWhatIfProviderNoise(change, { subscriptionId, resourceGroup, phase });
    const plannedChange = classifyAzureWhatIfPlannedChange(change, { subscriptionId, resourceGroup, phase });
    if (!allowedChangeTypes.has(changeType) && !providerNoise && !plannedChange) {
      fail(`what-if contains disallowed ${changeType || 'unknown'} change for ${resourceId}`);
    }
    if (providerNoise) approvedProviderNoise.push(providerNoise);
    if (plannedChange) approvedPlannedChanges.push(plannedChange);
    if (changeType === 'Unsupported') {
      if (!unresolvedExpression && !isAllowlistedUnsupported(resourceId)) fail(`Unsupported resource is outside the manual-review allowlist: ${resourceId}`);
      unsupportedResources.push(resourceId);
      unsupportedChanges.push({
        resourceId,
        unsupportedReason: validatedUnsupportedReason(change?.unsupportedReason),
      });
    }
    changeCounts[changeType] = (changeCounts[changeType] ?? 0) + 1;
  }

  return {
    status: payload.status,
    changeCounts,
    unsupportedResources,
    unsupportedChanges,
    approvedProviderNoise,
    approvedPlannedChanges,
    missingUnsupportedReasonCount: unsupportedChanges.filter(({ unsupportedReason }) => unsupportedReason === null).length,
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

function preparePreflightEnvironment(env) {
  const result = sanitizePreflightEnvironment(env);
  if (result.BICEP_BIN) {
    if (!path.isAbsolute(result.BICEP_BIN)) fail('BICEP_BIN must be an absolute path');
    const bicepDirectory = path.dirname(result.BICEP_BIN);
    const pathEntries = String(result.PATH ?? '').split(path.delimiter).filter(Boolean);
    result.PATH = [bicepDirectory, ...pathEntries.filter((entry) => entry !== bicepDirectory)].join(path.delimiter);
  }
  return result;
}

function boundedDiagnostic(error) {
  const raw = String(error?.stderr ?? error?.stdout ?? '').trim();
  if (!raw) return '';
  return raw
    .slice(0, 4_000)
    .replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/((?:token|secret|password|passwd|api[_-]?key|pat)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
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
  const childEnv = preparePreflightEnvironment(env);
  const gitBin = config.gitBin ?? 'git';
  const azureCli = config.azureCli ?? childEnv.AZURE_CLI_BIN ?? 'az';
  const npmBin = config.npmBin ?? 'npm';
  const run = async (command, args, timeoutMs) => {
    try {
      return await commandRunner(command, args, {
        cwd: canonicalRoot,
        env: childEnv,
        timeoutMs,
      });
    } catch (error) {
      const diagnostic = boundedDiagnostic(error);
      const label = `${command} ${args.slice(0, 3).join(' ')}`.trim();
      throw new Error(
        `Azure canary preflight command failed: ${label}${diagnostic ? `: ${diagnostic}` : ''}`,
        { cause: error },
      );
    }
  };

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
  const whatIf = summarizeAzureWhatIf(parseJsonOutput(whatIfResult, 'ARM what-if'), {
    ...config,
    phase: 'foundation',
  });

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
