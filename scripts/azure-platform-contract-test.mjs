import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const azureRoot = path.join(root, 'infra', 'azure');
const mainBicepPath = path.join(azureRoot, 'main.bicep');
const canaryParametersPath = path.join(azureRoot, 'parameters', 'canary.bicepparam');
const pipelinePath = path.join(root, 'azure-pipelines.yml');
const publishWorkflowPath = path.join(root, '.github', 'workflows', 'publish-image.yml');

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function bicepFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return bicepFiles(entryPath);
    return entry.name.endsWith('.bicep') ? [entryPath] : [];
  });
}

function stripLineComments(text) {
  return text.split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
}

function declarationModel(files) {
  const resources = [];
  const outputs = [];
  const modules = [];
  for (const filePath of files) {
    const source = stripLineComments(readText(filePath));
    for (const match of source.matchAll(/\bresource\s+([A-Za-z_][\w-]*)\s+'([^']+)'\s*(?:existing\s*)?=/g)) {
      resources.push({ filePath, symbol: match[1], type: match[2].split('@')[0] });
    }
    for (const match of source.matchAll(/\boutput\s+([A-Za-z_][\w-]*)\s+([^\s=]+)\s*=/g)) {
      outputs.push({ filePath, name: match[1], type: match[2] });
    }
    for (const match of source.matchAll(/\bmodule\s+([A-Za-z_][\w-]*)\s+'([^']+)'\s*=/g)) {
      modules.push({ filePath, symbol: match[1], path: match[2] });
    }
  }
  return { resources, outputs, modules };
}

function compiledResourceTypes() {
  const bicepVersion = spawnSync('az', ['bicep', 'version'], { encoding: 'utf8' });
  if (bicepVersion.status !== 0) return null;
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'teamsapp-bicep-build-'));
  const outputPath = path.join(outputDirectory, 'main.json');
  try {
    execFileSync('az', ['bicep', 'build', '--file', mainBicepPath, '--outfile', outputPath], { cwd: root, stdio: 'pipe' });
    const compiled = JSON.parse(readText(outputPath));
    const types = [];
    const visit = (value) => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== 'object') return;
      if (typeof value.type === 'string') types.push(value.type);
      for (const child of Object.values(value)) visit(child);
    };
    visit(compiled);
    return types;
  } finally {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
  }
}

function yamlGraph(text) {
  const nodes = [];
  for (const rawLine of text.split('\n')) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith('#')) continue;
    const indent = rawLine.length - rawLine.trimStart().length;
    const line = rawLine.trim();
    const match = line.match(/^(?:-\s+)?([A-Za-z][\w-]*):\s*(.*)$/);
    if (match) nodes.push({ indent, key: match[1], value: match[2].replace(/^['"]|['"]$/g, '') });
  }
  return nodes;
}

function bicepTokens(text) {
  return stripLineComments(text).match(/'[^']*'|[A-Za-z_][\w-]*|\d+|[:{}\[\]]/g) ?? [];
}

function hasTokenSequence(tokens, sequence) {
  return sequence.some((token, index) => tokens[index] !== token) === false
    ? true
    : tokens.some((_, start) => sequence.every((token, index) => tokens[start + index] === token));
}

function yamlScriptBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^(\s*)(?:inlineScript|run):\s*\|\s*$/);
    if (!match) continue;
    const indent = match[1].length;
    const block = [];
    for (index += 1; index < lines.length; index += 1) {
      if (lines[index].trim() && lines[index].length - lines[index].trimStart().length <= indent) {
        index -= 1;
        break;
      }
      block.push(lines[index].trim());
    }
    blocks.push(block);
  }
  return blocks;
}

assert.ok(fs.existsSync(mainBicepPath), 'Azure platform contract must define infra/azure/main.bicep');
assert.ok(fs.existsSync(canaryParametersPath), 'Azure platform contract must define canary Bicep parameters');
assert.ok(fs.existsSync(pipelinePath), 'Azure deployment authority must define azure-pipelines.yml');
assert.ok(fs.existsSync(publishWorkflowPath), 'GitHub build handoff workflow must remain present');

const files = bicepFiles(azureRoot);
const fallback = declarationModel(files);
const expectedTypes = [
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
];
const compiledTypes = compiledResourceTypes();
const observedTypes = compiledTypes ?? fallback.resources.map((resource) => resource.type);
for (const type of expectedTypes) {
  assert.ok(observedTypes.includes(type), `platform graph must provision ${type}`);
}
assert.ok(
  fallback.modules.some((module) => module.path.includes('container-app.bicep')),
  'main Bicep composition must wire a Container App module into the platform graph',
);
assert.ok(
  fallback.modules.some((module) => module.path.includes('worker-vm.bicep')),
  'main Bicep composition must wire the Linux worker VM module into the platform graph',
);
assert.equal(
  fallback.outputs.filter((output) => /secret|connection|string|key/i.test(output.name)).length,
  0,
  'Bicep outputs must not expose secrets, connection strings, or keys',
);
const allBicepTokens = bicepTokens(files.map(readText).join('\n'));
const canaryParameterTokens = bicepTokens(readText(canaryParametersPath));
const containerAppTokens = bicepTokens(readText(path.join(azureRoot, 'modules', 'container-app.bicep')));
const workerVmTokens = bicepTokens(readText(path.join(azureRoot, 'modules', 'worker-vm.bicep')));
assert.ok(hasTokenSequence(containerAppTokens, ['activeRevisionsMode', ':', "'multiple'"]), 'Container App revisions must preserve a rollback target');
assert.ok(hasTokenSequence(containerAppTokens, ['minReplicas', ':', '0']), 'Container App must scale to zero');
assert.ok(containerAppTokens.includes('keyVaultUrl') && containerAppTokens.includes('secretRef'), 'Container App configuration must consume Key Vault secret references');
assert.ok(!containerAppTokens.includes('value'), 'Container App must not embed endpoint values or credentials in its configuration');
assert.ok(hasTokenSequence(workerVmTokens, ['vmSize', ':', "'Standard_B2ats_v2'"]), 'worker VM must use the required Standard_B2ats_v2 SKU');
assert.ok(hasTokenSequence(canaryParameterTokens, ['location', "'koreacentral'"]), 'canary parameters must pin the Korean Central region');
assert.ok(
  allBicepTokens.some((token) => token.includes('roleAssignments')) && allBicepTokens.some((token) => token.includes('sqlRoleAssignments')),
  'platform graph must grant managed-identity RBAC for control and Cosmos data planes',
);

const pipeline = yamlGraph(readText(pipelinePath));
const stageNames = pipeline.filter((node) => node.key === 'stage').map((node) => node.value);
assert.ok(stageNames.includes('ValidateHandoff'), 'Azure DevOps must validate the GitHub handoff before deployment');
assert.ok(stageNames.includes('DeployCanary'), 'Azure DevOps must own the canary deployment stage');
assert.ok(stageNames.includes('RollbackCanary'), 'Azure DevOps must provide a rollback stage');
assert.ok(
  pipeline.some((node) => node.key === 'environment' && node.value === 'teamsapp-canary'),
  'canary deployment and rollback must target an Azure DevOps environment approval gate',
);
assert.ok(
  pipeline.some((node) => node.key === 'task' && node.value === 'AzureCLI@2'),
  'deployment authority must use Azure DevOps AzureCLI tasks rather than GitHub deployment steps',
);
assert.ok(
  pipeline.some((node) => node.key === 'azureSubscriptionId' && node.value === '0e58c3cb-474d-4e70-978a-4939c586f867'),
  'Azure DevOps must verify the approved Azure subscription before mutation',
);
const pipelineScripts = yamlScriptBlocks(readText(pipelinePath)).flat();
assert.ok(pipelineScripts.some((line) => line.startsWith('node scripts/azure-release-input.mjs')), 'Azure DevOps must execute receipt validation before deployment');
assert.ok(pipelineScripts.some((line) => line.startsWith('az acr import')), 'Azure DevOps must import the immutable GitHub image digest into ACR');
assert.ok(pipelineScripts.some((line) => line.startsWith('az containerapp update')), 'Azure DevOps must deploy the immutable ACR image digest');
assert.ok(pipelineScripts.some((line) => line.startsWith('az containerapp revision activate')), 'Azure DevOps rollback must activate the previous revision');
assert.ok(pipelineScripts.some((line) => line.includes('/api/health')), 'Azure DevOps must verify the public runtime identity after revision readiness');

const publishWorkflow = yamlGraph(readText(publishWorkflowPath));
assert.ok(
  publishWorkflow.some((node) => node.key === 'name' && node.value === 'Upload immutable release identity'),
  'GitHub remains responsible for publishing the immutable release handoff artifact',
);
const githubScripts = yamlScriptBlocks(readText(publishWorkflowPath)).flat();
assert.ok(githubScripts.some((line) => line.includes('azure-release-receipt.json')), 'GitHub must publish the Azure handoff receipt alongside its immutable build artifact');
assert.ok(!githubScripts.some((line) => /\baz\s+containerapp\b|\baz\s+deployment\b/.test(line)), 'GitHub workflow must stop before Azure deployment authority');

console.log(`PASS: Azure platform contract (${compiledTypes ? 'compiled Bicep' : 'parsed Bicep fallback: az/bicep unavailable'}) and Azure DevOps deployment handoff graph are valid.`);
