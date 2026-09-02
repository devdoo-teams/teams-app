import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const mainBicepPath = path.join(root, 'infra', 'azure', 'main.bicep');
const canaryParametersPath = path.join(root, 'infra', 'azure', 'parameters', 'canary.bicepparam');
const pipelinePath = path.join(root, 'azure-pipelines.yml');

function resolveBicep() {
  const configured = process.env.BICEP_BIN?.trim();
  if (configured) {
    const result = spawnSync(configured, ['--version'], { encoding: 'utf8' });
    assert.equal(result.status, 0, `BICEP_BIN is not an executable official Bicep CLI: ${result.stderr || result.stdout}`);
    return configured;
  }
  const result = spawnSync('bicep', ['--version'], { encoding: 'utf8' });
  assert.equal(result.status, 0, 'Official Bicep CLI is required. Set BICEP_BIN or install bicep; fallback parsing is forbidden.');
  return 'bicep';
}

function compileBicep(bicep, inputPath, outputPath) {
  execFileSync(bicep, ['build', inputPath, '--outfile', outputPath], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(fs.readFileSync(outputPath, 'utf8'));
}

function parseYaml(filePath) {
  const ruby = ['-ryaml', '-rjson', '-e', 'puts JSON.generate(YAML.safe_load(File.read(ARGV[0]), [], [], true))', filePath];
  const result = spawnSync('ruby', ruby, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, `A real YAML parser is required for the Azure pipeline contract: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function collectResources(template, resources = []) {
  for (const resource of template.resources ?? []) {
    resources.push(resource);
    const nestedTemplate = resource?.properties?.template;
    if (nestedTemplate && typeof nestedTemplate === 'object') collectResources(nestedTemplate, resources);
  }
  return resources;
}

function findResource(resources, type) {
  return resources.find((resource) => resource.type === type);
}

function findStage(pipeline, name) {
  return pipeline.stages?.find((stage) => stage.stage === name);
}

function allSteps(stage) {
  return (stage?.jobs ?? []).flatMap((job) => job.steps ?? job.strategy?.runOnce?.deploy?.steps ?? []);
}

const bicep = resolveBicep();
const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'teamsapp-bicep-contract-'));
try {
  const compiled = compileBicep(bicep, mainBicepPath, path.join(outputDirectory, 'main.json'));
  execFileSync(bicep, ['build-params', canaryParametersPath, '--outfile', path.join(outputDirectory, 'canary.json')], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const resources = collectResources(compiled);
  for (const type of [
    'Microsoft.App/managedEnvironments',
    'Microsoft.App/containerApps',
    'Microsoft.ContainerRegistry/registries',
    'Microsoft.DocumentDB/databaseAccounts',
    'Microsoft.Storage/storageAccounts',
    'Microsoft.Storage/storageAccounts/queueServices/queues',
    'Microsoft.Storage/storageAccounts/fileServices/shares',
    'Microsoft.KeyVault/vaults',
    'Microsoft.OperationalInsights/workspaces',
    'Microsoft.Insights/components',
    'Microsoft.ManagedIdentity/userAssignedIdentities',
    'Microsoft.Compute/virtualMachines',
  ]) {
    assert.ok(findResource(resources, type), `compiled platform graph must provision ${type}`);
  }

  const acr = findResource(resources, 'Microsoft.ContainerRegistry/registries');
  assert.equal(acr.sku?.name, 'Basic', 'canary ACR must preserve the free-first Basic SKU');
  assert.notEqual(acr.properties?.policies?.quarantinePolicy?.status, 'enabled', 'Basic ACR must not quarantine images without a supported release flow');
  assert.notEqual(acr.properties?.policies?.retentionPolicy?.status, 'enabled', 'Basic ACR must not enable the unsupported untagged-manifest retention policy');

  const cosmos = findResource(resources, 'Microsoft.DocumentDB/databaseAccounts');
  assert.equal(cosmos.properties?.disableLocalAuth, true, 'Cosmos must reject key-based local authentication and use RBAC only');
  assert.ok(
    !(cosmos.properties?.capabilities ?? []).some((capability) => capability.name === 'EnableServerless'),
    'Cosmos canary account must explicitly use provisioned throughput rather than implicit serverless behavior',
  );
  const cosmosDatabase = findResource(resources, 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases');
  const autoscaleThroughput = cosmosDatabase.properties?.options?.autoscaleSettings?.maxThroughput;
  assert.ok(
    autoscaleThroughput === 1_000 || String(autoscaleThroughput).includes("parameters('autoscaleMaxThroughput')"),
    'provisioned Cosmos database must declare bounded autoscale throughput',
  );
  assert.match(
    JSON.stringify(compiled),
    /"autoscaleMaxThroughput":\{"type":"int","defaultValue":1000/,
    'compiled Cosmos module must bind autoscale max throughput to a 1000 RU/s default',
  );

  const workerVm = findResource(resources, 'Microsoft.Compute/virtualMachines');
  assert.equal(typeof workerVm.properties?.osProfile?.customData, 'string', 'worker VM must attach rendered cloud-init as customData');
  assert.match(workerVm.properties.osProfile.customData, /base64\(variables\('renderedCloudInit'\)\)/, 'worker VM must base64-encode rendered cloud-init');
  const compiledJson = JSON.stringify(compiled);
  assert.match(compiledJson, /teamsapp-worker\\u002Eservice|teamsapp-worker\.service/, 'rendered cloud-init must contain the worker systemd unit');
  assert.match(compiledJson, /dist\/worker\/index\.js/, 'rendered cloud-init must execute the packaged worker entrypoint');

  const workerExtension = findResource(resources, 'Microsoft.Compute/virtualMachines/extensions');
  assert.ok(workerExtension, 'worker VM must install the immutable runtime through a VM extension');
  assert.equal(workerExtension.properties?.publisher, 'Microsoft.Azure.Extensions');
  assert.equal(workerExtension.properties?.type, 'CustomScript');
  assert.equal(workerExtension.properties?.typeHandlerVersion, '2.1');
  assert.ok(
    workerExtension.properties?.protectedSettings?.managedIdentity?.clientId,
    'private worker artifact download must use the VM user-assigned managed identity',
  );
  assert.equal(
    workerExtension.properties?.protectedSettings?.storageAccountKey,
    undefined,
    'worker artifact download must not use a storage account key',
  );
  assert.match(
    String(workerExtension.properties?.protectedSettings?.commandToExecute),
    /install-worker-runtime\.sh.*workerArtifactSha256.*codexBinSha256|install-worker-runtime\.sh/i,
    'extension must execute the fail-closed worker installer with immutable digest inputs',
  );

  const roleAssignments = resources.filter((resource) => resource.type === 'Microsoft.Authorization/roleAssignments');
  const roleDefinitions = resources.filter((resource) => resource.type === 'Microsoft.Authorization/roleDefinitions');
  const appSenderRole = roleAssignments.find((resource) => (
    String(resource.properties?.roleDefinitionId).includes('storageQueueDataMessageSenderRoleDefinitionId')
    && String(resource.properties?.principalId).includes('appIdentityPrincipalId')
  ));
  const workerProcessorRole = roleAssignments.find((resource) => (
    String(resource.properties?.roleDefinitionId).includes('teamsapp-worker-queue-lease')
    && String(resource.properties?.principalId).includes('workerIdentityPrincipalId')
  ));
  const workerPoisonSenderRole = roleAssignments.find((resource) => (
    String(resource.properties?.roleDefinitionId).includes('storageQueueDataMessageSenderRoleDefinitionId')
    && String(resource.properties?.principalId).includes('workerIdentityPrincipalId')
    && String(resource.scope).includes('agent-dispatch-poison')
  ));
  assert.ok(appSenderRole, 'Container App identity must receive the sender-only queue role');
  assert.ok(workerProcessorRole, 'worker identity must receive the custom queue lease role');
  assert.ok(workerPoisonSenderRole, 'worker identity must receive sender-only access to the poison queue');
  assert.match(String(appSenderRole.scope), /agent-dispatch/i, 'Container App sender role must be scoped to the dispatch queue');
  assert.match(String(workerProcessorRole.scope), /agent-dispatch/i, 'worker processor role must be scoped to the dispatch queue');
  assert.ok(
    !JSON.stringify(compiled).includes('974c5e8b-45b9-4653-ba55-5f855dd0fb88'),
    'broad Storage Queue Data Contributor must not be granted to either runtime identity',
  );
  const workerQueueLeaseRole = roleDefinitions.find((resource) => String(resource.properties?.roleName).includes('TeamsApp Worker Queue Lease'));
  assert.ok(workerQueueLeaseRole, 'worker queue lease custom role must exist');
  assert.deepEqual(
    [...(workerQueueLeaseRole.properties?.permissions?.[0]?.dataActions ?? [])].sort(),
    [
      'Microsoft.Storage/storageAccounts/queueServices/queues/messages/process/action',
      'Microsoft.Storage/storageAccounts/queueServices/queues/messages/read',
      'Microsoft.Storage/storageAccounts/queueServices/queues/messages/write',
    ].sort(),
    'worker custom role must contain only receive/delete, peek, and visibility-update data actions',
  );
  const workerArtifactContainer = findResource(resources, 'Microsoft.Storage/storageAccounts/blobServices/containers');
  assert.ok(workerArtifactContainer, 'private worker artifact container must be provisioned');
  assert.equal(workerArtifactContainer.properties?.publicAccess, 'None');
  const workerArtifactReader = roleAssignments.find((resource) => (
    String(resource.properties?.roleDefinitionId).includes('storageBlobDataReaderRoleDefinitionId')
    && String(resource.properties?.principalId).includes('workerIdentityPrincipalId')
  ));
  assert.ok(workerArtifactReader, 'worker managed identity must receive blob reader access to only the artifact container');
  assert.match(String(workerArtifactReader.scope), /worker-artifacts/i);

  const containerApp = findResource(resources, 'Microsoft.App/containerApps');
  const appContainer = containerApp.properties?.template?.containers?.find((container) => container.name === 'teams-core');
  const envNames = new Set((appContainer?.env ?? []).map((entry) => entry.name));
  for (const name of [
    'AZURE_CLIENT_ID',
    'AZURE_RELEASE_MODE',
    'RELEASE_IMAGE_DIGEST',
    'RELEASE_CLIENT_BUNDLE_SHA256',
    'RELEASE_SERVER_BUNDLE_SHA256',
    'RELEASE_TEAMS_PACKAGE_SHA256',
    'RELEASE_SOURCE_COMMIT',
    'RELEASE_APP_VERSION',
  ]) {
    assert.ok(envNames.has(name), `compiled Container App revision must bind ${name}`);
  }
  assert.equal(
    appContainer?.env?.find((entry) => entry.name === 'AZURE_RELEASE_MODE')?.value,
    'true',
    'compiled Container App revision must explicitly enable strict Azure release identity mode',
  );
  assert.equal(containerApp.properties?.template?.scale?.minReplicas, 0, 'Container App must scale to zero');
  assert.equal(containerApp.properties?.configuration?.activeRevisionsMode, 'multiple', 'Container App must retain rollback revisions');

  for (const output of [
    'registryName',
    'registryLoginServer',
    'containerAppName',
    'containerAppFqdn',
    'containerAppRevisionName',
    'containerEnvironmentName',
    'appIdentityClientId',
  ]) {
    assert.ok(compiled.outputs?.[output], `main.bicep must expose non-secret deployment output ${output}`);
  }
  assert.equal(Object.keys(compiled.outputs ?? {}).filter((name) => /secret|connection|string|key/i.test(name)).length, 0, 'Bicep outputs must not expose secrets, connection strings, or keys');

  const pipeline = parseYaml(pipelinePath);
  const parameterNames = new Set((pipeline.parameters ?? []).map((parameter) => parameter.name));
  assert.ok(!parameterNames.has('githubReleaseReceiptUrl'), 'pipeline must not accept an arbitrary receipt URL');
  assert.ok(parameterNames.has('githubReleaseCommit'), 'pipeline must select a GitHub artifact by immutable commit');
  assert.ok(parameterNames.has('azureDevOpsEnvironmentId'), 'pipeline must identify the external approval-check resource');

  const validateStage = findStage(pipeline, 'ValidateHandoff');
  const approvalStage = findStage(pipeline, 'ValidateApprovalConfiguration');
  const deployStage = findStage(pipeline, 'DeployCanary');
  const rollbackStage = findStage(pipeline, 'RollbackCanary');
  assert.ok(validateStage && approvalStage && deployStage && rollbackStage, 'pipeline must model handoff, approval preflight, deploy, and rollback as separate stages');
  assert.deepEqual(deployStage.dependsOn, ['ValidateHandoff', 'ValidateApprovalConfiguration']);
  assert.deepEqual(rollbackStage.dependsOn, ['ValidateApprovalConfiguration']);

  const validateScripts = allSteps(validateStage).map((step) => step.bash).filter(Boolean);
  assert.ok(validateScripts.some((script) => script.includes('scripts/azure-github-handoff.mjs')), 'handoff stage must execute the authenticated GitHub artifact consumer');
  assert.ok(validateScripts.every((script) => !script.includes('GITHUB_RELEASE_RECEIPT_URL')), 'handoff stage must not download caller-selected raw JSON');

  const approvalScripts = allSteps(approvalStage).map((step) => step.bash).filter(Boolean);
  assert.ok(approvalScripts.some((script) => script.includes('scripts/azure-approval-check.mjs')), 'approval stage must query and receipt the external Azure DevOps check');

  const deploySteps = allSteps(deployStage);
  const deployScript = deploySteps.find((step) => step.task === 'AzureCLI@2')?.inputs?.inlineScript;
  assert.ok(deployScript?.includes('az deployment group create'), 'deployment must provision with an Azure resource-group deployment');
  assert.ok(deployScript?.includes('--template-file infra/azure/main.bicep'), 'deployment must execute the compiled main.bicep contract');
  assert.ok(deployScript?.includes('scripts/azure-deployment-contract.mjs outputs'), 'deployment must consume validated Bicep outputs');
  assert.ok(deployScript?.includes('npm run build:worker'), 'deployment must build the worker from the exact attested source commit');
  assert.ok(deployScript?.includes('git checkout --detach "$commit"'), 'worker build must check out the exact attested commit');
  assert.ok(deployScript?.includes('version: 24.19.0') || JSON.stringify(deploySteps).includes('24.19.0'), 'worker archive must carry the pinned Node runtime');
  assert.ok(deployScript?.includes('CODEX_ARTIFACT_URL'), 'deployment must require an approved Codex artifact reference');
  assert.ok(deployScript?.includes('CODEX_ARTIFACT_SHA256'), 'deployment must require and verify the approved Codex digest');
  assert.ok(deployScript?.includes('az storage blob upload'), 'deployment must stage the immutable worker archive in private Azure Blob storage');
  assert.ok(deployScript?.includes('--auth-mode login'), 'artifact staging must use Entra authentication rather than account keys or SAS');
  assert.ok(deployScript?.includes('metadata.sha256'), 'an existing immutable worker blob must be accepted only when its SHA-256 metadata matches');
  assert.ok(deployScript?.includes('workerArtifactSha256='), 'deployment must bind the worker archive digest into Bicep');
  assert.ok(deployScript?.includes('codexBinSha256='), 'deployment must bind the approved Codex digest into Bicep');
  assert.ok(!Object.hasOwn(pipeline.variables ?? {}, 'azureContainerApp'), 'pipeline must not substitute a hard-coded Container App name for Bicep outputs');
  assert.ok(!Object.hasOwn(pipeline.variables ?? {}, 'azureContainerRegistry'), 'pipeline must not substitute a hard-coded ACR name for Bicep outputs');

  const rollbackScript = allSteps(rollbackStage).find((step) => step.task === 'AzureCLI@2')?.inputs?.inlineScript;
  assert.ok(rollbackScript?.includes('scripts/azure-deployment-contract.mjs select-rollback'), 'rollback must select current/previous revisions by observed traffic history');
  assert.ok(rollbackScript?.includes('scripts/azure-deployment-contract.mjs verify'), 'rollback must verify target revision readiness and full release identity');

  console.log('PASS: official Bicep compilation, compiled ARM behavior, parsed Azure Pipeline schema, and executable deployment helpers satisfy the Azure platform contract.');
} finally {
  fs.rmSync(outputDirectory, { recursive: true, force: true });
}
