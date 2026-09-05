import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  REQUIRED_AZURE_PROVIDERS,
  buildAzureCanaryWhatIfArguments,
  runAzureCanaryPreflight,
  sanitizePreflightEnvironment,
  summarizeAzureWhatIf,
  validateAzureAccount,
  validateAzureProviderRegistrations,
  validateAzureResourceGroup,
} from './azure-canary-preflight.mjs';

const tenantId = '32441482-5adf-4438-8a8f-0e15f33b77f1';
const subscriptionId = '0e58c3cb-474d-4e70-978a-4939c586f867';
const accountName = 'doosan.baek@devdoo.onmicrosoft.com';
const resourceGroup = 'rg-teamsapp-canary';
const location = 'koreacentral';
const commit = 'a'.repeat(40);
const version = '1.0.100';

assert.deepEqual(
  validateAzureAccount({
    tenantId,
    id: subscriptionId,
    state: 'Enabled',
    user: { name: accountName, type: 'user' },
  }, { tenantId, subscriptionId, accountName }),
  { tenantId, subscriptionId, accountName, accountType: 'user', state: 'Enabled' },
);
assert.throws(
  () => validateAzureAccount({ tenantId, id: 'wrong', state: 'Enabled', user: { name: accountName, type: 'user' } }, { tenantId, subscriptionId, accountName }),
  /subscription/i,
);
assert.throws(
  () => validateAzureAccount({ tenantId, id: subscriptionId, state: 'Enabled', user: { name: 'wrong@example.com', type: 'user' } }, { tenantId, subscriptionId, accountName }),
  /account/i,
);

const providerRows = REQUIRED_AZURE_PROVIDERS.map((namespace) => ({ namespace, registrationState: 'Registered' }));
assert.deepEqual(validateAzureProviderRegistrations(providerRows), REQUIRED_AZURE_PROVIDERS);
assert.throws(
  () => validateAzureProviderRegistrations(providerRows.map((row, index) => index === 0 ? { ...row, registrationState: 'Registering' } : row)),
  /not Registered/i,
);

assert.deepEqual(
  validateAzureResourceGroup({
    id: `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}`,
    name: resourceGroup,
    location,
    properties: { provisioningState: 'Succeeded' },
  }, { subscriptionId, resourceGroup, location }),
  {
    id: `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}`,
    name: resourceGroup,
    location,
    provisioningState: 'Succeeded',
  },
);
assert.throws(
  () => validateAzureResourceGroup({ name: resourceGroup, location: 'eastus', properties: { provisioningState: 'Succeeded' } }, { subscriptionId, resourceGroup, location }),
  /location/i,
);

const whatIfArgs = buildAzureCanaryWhatIfArguments({
  subscriptionId,
  resourceGroup,
  location,
  commit,
  version,
  templateFile: 'infra/azure/main.bicep',
});
assert.deepEqual(whatIfArgs.slice(0, 3), ['deployment', 'group', 'what-if']);
assert.ok(whatIfArgs.includes('--no-pretty-print'));
assert.ok(whatIfArgs.includes('FullResourcePayloads'));
assert.equal(whatIfArgs.includes('ResourceIdOnly'), false);
assert.ok(whatIfArgs.includes('deployContainerApp=false'));
assert.ok(whatIfArgs.includes('deployWorkerVm=false'));
assert.ok(whatIfArgs.includes(`releaseSourceCommit=${commit}`));
assert.ok(whatIfArgs.includes(`releaseVersion=${version}`));
assert.equal(whatIfArgs.some((arg) => /password|secret|token|connectionstring/i.test(arg)), false);
assert.equal(whatIfArgs.some((arg) => arg === 'create' || arg === 'register' || arg === 'delete'), false);

const scope = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}`;
const unresolvedRoleAssignment = `[extensionResourceId('${scope}/providers/Microsoft.ContainerRegistry/registries/teamsapp123', 'Microsoft.Authorization/roleAssignments', guid('${scope}/providers/Microsoft.ContainerRegistry/registries/teamsapp123', reference('${scope}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/teamsapp-app', '2023-01-31').principalId, '/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${'d'.repeat(36)}'))]`;
const unresolvedCosmosAssignment = `[resourceId('${subscriptionId}', '${resourceGroup}', 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments', filter(split(reference('${scope}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/teamsapp-worker', '2023-01-31').principalId, '/'), lambda('x', not(empty(lambdaVariables('x')))))[0])]`;
const whatIf = summarizeAzureWhatIf({
  status: 'Succeeded',
  changes: [
    { resourceId: `${scope}/providers/Microsoft.Storage/storageAccounts/teamsapp123`, changeType: 'Create' },
    { resourceId: `${scope}/providers/Microsoft.App/managedEnvironments/teamsapp-env-goictvxm`, changeType: 'NoChange' },
    { resourceId: `${scope}/providers/microsoft.insights/actiongroups/Application Insights Smart Detection`, changeType: 'Ignore' },
    {
      resourceId: `${scope}/providers/Microsoft.Authorization/roleAssignments/${'b'.repeat(32)}`,
      changeType: 'Unsupported',
      unsupportedReason: 'The resource type is not supported by What-If.',
    },
    { resourceId: `${scope}/providers/Microsoft.DocumentDB/databaseAccounts/teamsapp/sqlRoleAssignments/${'c'.repeat(32)}`, changeType: 'Unsupported' },
    { resourceId: unresolvedRoleAssignment, changeType: 'Unsupported' },
    { resourceId: unresolvedCosmosAssignment, changeType: 'Unsupported' },
  ],
}, { subscriptionId, resourceGroup });
assert.equal(whatIf.status, 'Succeeded');
assert.deepEqual(whatIf.changeCounts, { Create: 1, NoChange: 1, Ignore: 1, Unsupported: 4 });
assert.deepEqual(whatIf.unsupportedChanges, [
  {
    resourceId: `${scope}/providers/Microsoft.Authorization/roleAssignments/${'b'.repeat(32)}`,
    unsupportedReason: 'The resource type is not supported by What-If.',
  },
  {
    resourceId: `${scope}/providers/Microsoft.DocumentDB/databaseAccounts/teamsapp/sqlRoleAssignments/${'c'.repeat(32)}`,
    unsupportedReason: null,
  },
  { resourceId: unresolvedRoleAssignment, unsupportedReason: null },
  { resourceId: unresolvedCosmosAssignment, unsupportedReason: null },
]);
assert.equal(whatIf.missingUnsupportedReasonCount, 3);
assert.equal(whatIf.manualReviewRequired, true);
assert.equal(whatIf.destructiveChangeCount, 0);
assert.deepEqual(whatIf.approvedProviderNoise, [{
  resourceId: `${scope}/providers/microsoft.insights/actiongroups/Application Insights Smart Detection`,
  changeType: 'Ignore',
  rule: 'incremental-smart-detection-ignore',
  propertyChanges: [],
}]);

const managedEnvironmentId = `${scope}/providers/Microsoft.App/managedEnvironments/teamsapp-env-goictvxm`;
const cosmosAccountId = `${scope}/providers/Microsoft.DocumentDB/databaseAccounts/teamsapp-cosmos-goictvxm`;
const cosmosDatabaseId = `${cosmosAccountId}/sqlDatabases/teamsapp`;
const applicationInsightsId = `${scope}/providers/Microsoft.Insights/components/teamsapp-insights-goictvxm`;
const approvedProviderNoise = summarizeAzureWhatIf({
  status: 'Succeeded',
  changes: [{
    resourceId: managedEnvironmentId,
    changeType: 'Modify',
    delta: [{
      path: 'properties.appLogsConfiguration.logAnalyticsConfiguration.customerId',
      propertyChangeType: 'Modify',
    }],
  }, {
    resourceId: cosmosAccountId,
    changeType: 'Modify',
    delta: [{
      path: 'properties.sqlEndpoint',
      propertyChangeType: 'Delete',
    }],
  }, {
    resourceId: cosmosDatabaseId,
    changeType: 'Modify',
    delta: [{
      path: 'properties.options',
      propertyChangeType: 'Create',
    }],
  }, {
    resourceId: applicationInsightsId,
    changeType: 'Modify',
    delta: [{
      path: 'properties.Flow_Type',
      propertyChangeType: 'Create',
    }, {
      path: 'properties.Request_Source',
      propertyChangeType: 'Create',
    }],
  }],
}, { subscriptionId, resourceGroup });
assert.deepEqual(approvedProviderNoise.changeCounts, { Modify: 4 });
assert.equal(approvedProviderNoise.manualReviewRequired, false);
assert.equal(approvedProviderNoise.destructiveChangeCount, 0);
assert.deepEqual(approvedProviderNoise.approvedProviderNoise, [{
  resourceId: managedEnvironmentId,
  changeType: 'Modify',
  rule: 'managed-environment-customer-id-reference',
  propertyChanges: [{
    path: 'properties.appLogsConfiguration.logAnalyticsConfiguration.customerId',
    propertyChangeType: 'Modify',
  }],
}, {
  resourceId: cosmosAccountId,
  changeType: 'Modify',
  rule: 'cosmos-account-read-only-endpoint',
  propertyChanges: [{ path: 'properties.sqlEndpoint', propertyChangeType: 'Delete' }],
}, {
  resourceId: cosmosDatabaseId,
  changeType: 'Modify',
  rule: 'cosmos-database-request-options',
  propertyChanges: [{ path: 'properties.options', propertyChangeType: 'Create' }],
}, {
  resourceId: applicationInsightsId,
  changeType: 'Modify',
  rule: 'application-insights-rest-defaults',
  propertyChanges: [{
    path: 'properties.Flow_Type',
    propertyChangeType: 'Create',
  }, {
    path: 'properties.Request_Source',
    propertyChangeType: 'Create',
  }],
}]);

for (const unsafeNoise of [{
  resourceId: managedEnvironmentId,
  changeType: 'Modify',
  delta: [{
    path: 'properties.appLogsConfiguration.logAnalyticsConfiguration.sharedKey',
    propertyChangeType: 'Modify',
  }],
}, {
  resourceId: managedEnvironmentId,
  changeType: 'Modify',
  delta: [{
    path: 'properties.appLogsConfiguration.logAnalyticsConfiguration.customerId',
    propertyChangeType: 'Modify',
  }, {
    path: 'properties.peerTrafficConfiguration.encryption.enabled',
    propertyChangeType: 'Modify',
  }],
}, {
  resourceId: cosmosAccountId,
  changeType: 'Modify',
  delta: [{ path: 'properties.enableAutomaticFailover', propertyChangeType: 'Modify' }],
}, {
  resourceId: cosmosDatabaseId,
  changeType: 'Modify',
  delta: [{ path: 'properties.options', propertyChangeType: 'Modify' }],
}, {
  resourceId: applicationInsightsId,
  changeType: 'Modify',
  delta: [{ path: 'properties.Flow_Type', propertyChangeType: 'Create' }],
}, {
  resourceId: `${scope}/providers/Microsoft.Insights/actionGroups/not-the-smart-detection-group`,
  changeType: 'Ignore',
}]) {
  assert.throws(
    () => summarizeAzureWhatIf({ status: 'Succeeded', changes: [unsafeNoise] }, { subscriptionId, resourceGroup }),
    /disallowed (?:Modify|Ignore)|provider noise/i,
    'only an exact resource, property set, and change type may be classified as provider noise',
  );
}

for (const unsupportedReason of [{ message: 'not a string' }, 'x'.repeat(4097), 'unsafe\u001bterminal']) {
  assert.throws(
    () => summarizeAzureWhatIf({
      status: 'Succeeded',
      changes: [{
        resourceId: `${scope}/providers/Microsoft.Authorization/roleAssignments/${'b'.repeat(32)}`,
        changeType: 'Unsupported',
        unsupportedReason,
      }],
    }, { subscriptionId, resourceGroup }),
    /Unsupported reason.*(?:string|limit|control)/i,
  );
}

for (const unsafeExpression of [
  unresolvedRoleAssignment.replaceAll(subscriptionId, '11111111-1111-1111-1111-111111111111'),
  unresolvedRoleAssignment.replaceAll(resourceGroup, 'rg-not-approved'),
  unresolvedRoleAssignment.replace('Microsoft.Authorization/roleAssignments', 'Microsoft.Authorization/policyAssignments'),
  `[concat('${scope}/providers/Microsoft.Authorization/roleAssignments/', 'unsafe')]`,
]) {
  assert.throws(
    () => summarizeAzureWhatIf({
      status: 'Succeeded',
      changes: [{ resourceId: unsafeExpression, changeType: 'Unsupported' }],
    }, { subscriptionId, resourceGroup }),
    /scope|allowlist|expression/i,
  );
}

for (const changeType of ['Delete', 'Modify', 'Deploy']) {
  assert.throws(
    () => summarizeAzureWhatIf({
      status: 'Succeeded',
      changes: [{ resourceId: `${scope}/providers/Microsoft.Storage/storageAccounts/teamsapp123`, changeType }],
    }, { subscriptionId, resourceGroup }),
    new RegExp(changeType, 'i'),
  );
}
assert.throws(
  () => summarizeAzureWhatIf({
    status: 'Succeeded',
    changes: [{
      resourceId: `${scope}/providers/Microsoft.App/managedEnvironments/teamsapp-env-goictvxm`,
      changeType: 'Deploy',
    }],
  }, { subscriptionId, resourceGroup }),
  /Deploy/i,
  'ResourceIdOnly Deploy remains ambiguous and must never be silently accepted',
);
assert.throws(
  () => summarizeAzureWhatIf({
    status: 'Succeeded',
    changes: [{ resourceId: `${scope}/providers/Microsoft.Storage/storageAccounts/teamsapp123`, changeType: 'Unsupported' }],
  }, { subscriptionId, resourceGroup }),
  /Unsupported.*allowlist/i,
);
assert.throws(
  () => summarizeAzureWhatIf({
    status: 'Succeeded',
    changes: [{ resourceId: `/subscriptions/wrong/resourceGroups/${resourceGroup}/providers/Microsoft.Storage/storageAccounts/teamsapp123`, changeType: 'Create' }],
  }, { subscriptionId, resourceGroup }),
  /scope/i,
);

const safeEnv = sanitizePreflightEnvironment({
  PATH: '/usr/bin',
  HOME: '/tmp/home',
  AZURE_CONFIG_DIR: '/tmp/azure',
  GITHUB_TOKEN: 'secret',
  SYSTEM_ACCESSTOKEN: 'secret',
  XAI_API_KEY: 'secret',
  SOME_PASSWORD: 'secret',
  AZURE_DEVOPS_EXT_PAT: 'secret',
  NORMAL_VALUE: 'kept',
});
assert.equal(safeEnv.PATH, '/usr/bin');
assert.equal(safeEnv.AZURE_CONFIG_DIR, '/tmp/azure');
assert.equal(safeEnv.NORMAL_VALUE, 'kept');
assert.equal('GITHUB_TOKEN' in safeEnv, false);
assert.equal('SYSTEM_ACCESSTOKEN' in safeEnv, false);
assert.equal('XAI_API_KEY' in safeEnv, false);
assert.equal('SOME_PASSWORD' in safeEnv, false);
assert.equal('AZURE_DEVOPS_EXT_PAT' in safeEnv, false);

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'teamsapp-azure-preflight-test-'));
try {
  fs.mkdirSync(path.join(fixtureRoot, 'appPackage'), { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, 'infra', 'azure'), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, 'package.json'), JSON.stringify({ version }));
  fs.writeFileSync(path.join(fixtureRoot, 'appPackage', 'manifest.json'), JSON.stringify({ version, id: 'e915b402-eed4-4ee2-ba1f-c31d75c870a5' }));
  fs.writeFileSync(path.join(fixtureRoot, 'infra', 'azure', 'main.bicep'), "targetScope = 'resourceGroup'\n");

  const invocations = [];
  const runner = async (command, args, options) => {
    invocations.push({ command, args, options });
    assert.equal('GITHUB_TOKEN' in options.env, false, 'every child command must receive the sanitized environment');
    assert.match(options.env.PATH, /^\/opt\/bicep\/bin:/, 'BICEP_BIN directory must be available to Azure CLI what-if');
    if (command === 'git' && args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { stdout: `${fixtureRoot}\n`, stderr: '' };
    if (command === 'git' && args[0] === 'status') return { stdout: '', stderr: '' };
    if (command === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') return { stdout: `${commit}\n`, stderr: '' };
    if (command === 'az' && args[0] === 'account') return { stdout: JSON.stringify({ tenantId, id: subscriptionId, state: 'Enabled', user: { name: accountName, type: 'user' } }), stderr: '' };
    if (command === 'az' && args[0] === 'provider') return { stdout: JSON.stringify(providerRows), stderr: '' };
    if (command === 'az' && args[0] === 'group') return { stdout: JSON.stringify({ id: scope, name: resourceGroup, location, properties: { provisioningState: 'Succeeded' } }), stderr: '' };
    if (command === 'npm') return { stdout: 'PASS: Azure Core\n', stderr: '' };
    if (command === 'az' && args[0] === 'deployment') return {
      stdout: JSON.stringify({
        status: 'Succeeded',
        changes: [
          { resourceId: `${scope}/providers/Microsoft.Storage/storageAccounts/teamsapp123`, changeType: 'Create' },
          {
            resourceId: `${scope}/providers/Microsoft.Authorization/roleAssignments/${'b'.repeat(32)}`,
            changeType: 'Unsupported',
            unsupportedReason: 'The resource type is not supported by What-If.',
          },
        ],
      }),
      stderr: '',
    };
    throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
  };

  const receipt = await runAzureCanaryPreflight({
    rootCwd: fixtureRoot,
    config: { tenantId, subscriptionId, accountName, resourceGroup, location },
    commandRunner: runner,
    env: { PATH: '/usr/bin', BICEP_BIN: '/opt/bicep/bin/bicep', GITHUB_TOKEN: 'must-not-leak' },
    now: () => '2026-09-05T00:00:00.000Z',
  });
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.kind, 'azure-canary-preflight');
  assert.equal(receipt.nonMutating, true);
  assert.equal(receipt.status, 'REVIEW_REQUIRED');
  assert.equal(receipt.source.commit, commit);
  assert.equal(receipt.source.version, version);
  assert.equal(receipt.whatIf.changeCounts.Create, 1);
  assert.deepEqual(receipt.whatIf.unsupportedChanges, [{
    resourceId: `${scope}/providers/Microsoft.Authorization/roleAssignments/${'b'.repeat(32)}`,
    unsupportedReason: 'The resource type is not supported by What-If.',
  }]);
  assert.equal(receipt.whatIf.missingUnsupportedReasonCount, 0);
  assert.equal(receipt.whatIf.destructiveChangeCount, 0);
  assert.equal(receipt.checkedAt, '2026-09-05T00:00:00.000Z');
  assert.deepEqual(
    invocations.map(({ command, args }) => `${command} ${args.slice(0, 3).join(' ')}`),
    [
      'git rev-parse --show-toplevel',
      'git status --porcelain=v1 --untracked-files=no',
      'git rev-parse HEAD',
      'az account show --subscription',
      'az provider list --subscription',
      'az group show --subscription',
      'npm run test:azure-core',
      'git status --porcelain=v1 --untracked-files=no',
      'git rev-parse HEAD',
      'az deployment group what-if',
    ],
  );
  assert.equal(invocations.some(({ command, args }) => command === 'az' && args.some((arg) => ['create', 'register', 'delete'].includes(arg))), false);

  let azureReached = false;
  await assert.rejects(
    () => runAzureCanaryPreflight({
      rootCwd: fixtureRoot,
      config: { tenantId, subscriptionId, accountName, resourceGroup, location },
      commandRunner: async (command, args, options) => {
        if (command === 'git' && args[0] === 'rev-parse' && args[1] === '--show-toplevel') return { stdout: `${fixtureRoot}\n`, stderr: '' };
        if (command === 'git' && args[0] === 'status') return { stdout: ' M src/server/index.ts\n', stderr: '' };
        azureReached ||= command === 'az';
        return runner(command, args, options);
      },
      env: { PATH: '/usr/bin', BICEP_BIN: '/opt/bicep/bin/bicep' },
    }),
    /tracked worktree.*clean/i,
  );
  assert.equal(azureReached, false, 'dirty source must fail before any Azure command');

  let statusChecks = 0;
  let whatIfReached = false;
  await assert.rejects(
    () => runAzureCanaryPreflight({
      rootCwd: fixtureRoot,
      config: { tenantId, subscriptionId, accountName, resourceGroup, location },
      commandRunner: async (command, args, options) => {
        if (command === 'git' && args[0] === 'status') {
          statusChecks += 1;
          return { stdout: statusChecks === 1 ? '' : ' M infra/azure/main.bicep\n', stderr: '' };
        }
        whatIfReached ||= command === 'az' && args[0] === 'deployment';
        return runner(command, args, options);
      },
      env: { PATH: '/usr/bin', BICEP_BIN: '/opt/bicep/bin/bicep' },
    }),
    /tracked worktree.*changed during Azure preflight/i,
  );
  assert.equal(statusChecks, 2);
  assert.equal(whatIfReached, false, 'source mutation during regression tests must fail before ARM what-if');

  await assert.rejects(
    () => runAzureCanaryPreflight({
      rootCwd: fixtureRoot,
      config: { tenantId, subscriptionId, accountName, resourceGroup, location },
      commandRunner: async (command, args, options) => {
        if (command === 'az' && args[0] === 'account') {
          throw Object.assign(new Error('command failed'), { stderr: 'ERROR: official Azure CLI diagnostic' });
        }
        return runner(command, args, options);
      },
      env: { PATH: '/usr/bin', BICEP_BIN: '/opt/bicep/bin/bicep' },
    }),
    /official Azure CLI diagnostic/,
    'bounded child diagnostics must survive the wrapper so operators can fix the actual failure',
  );
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

console.log('PASS: Azure canary preflight is exact-target, non-mutating, fail-closed, and secret-sanitized.');
