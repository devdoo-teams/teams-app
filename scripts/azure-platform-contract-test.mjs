import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const mainBicepPath = path.join(root, 'infra', 'azure', 'main.bicep');
const workerVmBicepPath = path.join(root, 'infra', 'azure', 'modules', 'worker-vm.bicep');
const canaryParametersPath = path.join(root, 'infra', 'azure', 'parameters', 'canary.bicepparam');
const pipelinePath = path.join(root, 'azure-pipelines.yml');
const rubyYamlSafeLoadProgram = 'puts JSON.generate(YAML.safe_load(File.read(ARGV[0]), permitted_classes: [], permitted_symbols: [], aliases: true))';

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
  for (const keyword of ['permitted_classes:', 'permitted_symbols:', 'aliases:']) {
    assert.ok(
      rubyYamlSafeLoadProgram.includes(keyword),
      `Azure pipeline YAML parsing must use the documented Psych ${keyword} keyword argument`,
    );
  }
  assert.doesNotMatch(
    rubyYamlSafeLoadProgram,
    /safe_load\(File\.read\(ARGV\[0\]\),\s*\[\]/,
    'Azure pipeline YAML parsing must reject the legacy positional Psych contract',
  );
  const ruby = ['-ryaml', '-rjson', '-e', rubyYamlSafeLoadProgram, filePath];
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

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function createWorkerBootstrapArchive(fixture, { unsafeType } = {}) {
  const payload = path.join(fixture, 'payload');
  fs.mkdirSync(payload, { recursive: true });
  const installer = path.join(payload, 'install-worker-runtime.sh');
  fs.writeFileSync(installer, `#!/usr/bin/env bash
set -euo pipefail
printf 'executed\n' > "$MP279_SENTINEL"
printf '%s\n' "$0" > "$MP279_INSTALLER_PATH_LOG"
printf '%s\n' "$TMPDIR" > "$MP279_TMPDIR_LOG"
stage_dir=$(dirname "$0")
if stat -c '%a' "$stage_dir" >/dev/null 2>&1; then
  stat -c '%a' "$stage_dir" > "$MP279_STAGE_MODE_LOG"
  stat -c '%a' "$0" > "$MP279_INSTALLER_MODE_LOG"
else
  stat -f '%Lp' "$stage_dir" > "$MP279_STAGE_MODE_LOG"
  stat -f '%Lp' "$0" > "$MP279_INSTALLER_MODE_LOG"
fi
find "$stage_dir" -maxdepth 1 -name '*.tmp' -print > "$MP279_TMP_FILE_LOG"
`, { mode: 0o500 });

  const commit = 'a'.repeat(40);
  const archive = path.join(fixture, `worker-runtime-${commit}.tar`);
  const result = unsafeType
    ? spawnSync('python3', ['-c', `
import io
import sys
import tarfile

archive_path, installer_path, unsafe_type = sys.argv[1:]
with tarfile.open(archive_path, mode='w') as archive:
    archive.add(installer_path, arcname='./install-worker-runtime.sh')
    if unsafe_type == 'symlink':
        member = tarfile.TarInfo('./unsafe-link')
        member.type = tarfile.SYMTYPE
        member.linkname = '/etc/passwd'
        archive.addfile(member)
    elif unsafe_type == 'hardlink':
        member = tarfile.TarInfo('./unsafe-hardlink')
        member.type = tarfile.LNKTYPE
        member.linkname = './install-worker-runtime.sh'
        archive.addfile(member)
    elif unsafe_type == 'fifo':
        member = tarfile.TarInfo('./unsafe-fifo')
        member.type = tarfile.FIFOTYPE
        archive.addfile(member)
    elif unsafe_type == 'traversal':
        payload = b'escape'
        member = tarfile.TarInfo('../escape')
        member.size = len(payload)
        archive.addfile(member, io.BytesIO(payload))
    elif unsafe_type == 'duplicate':
        archive.add(installer_path, arcname='install-worker-runtime.sh')
    else:
        raise SystemExit(f'unknown unsafe fixture type: {unsafe_type}')
`, archive, installer, unsafeType], { encoding: 'utf8', timeout: 10_000 })
    : spawnSync('tar', ['-cf', archive, '-C', payload, '.'], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, `worker bootstrap fixture archive must be created: ${result.stderr}`);
  return { archive, commit, digest: sha256(archive) };
}

function splitArmArguments(source) {
  const argumentsList = [];
  let current = '';
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "'") {
      current += character;
      if (quoted && source[index + 1] === "'") {
        current += source[index + 1];
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && character === '(') depth += 1;
    if (!quoted && character === ')') depth -= 1;
    if (!quoted && depth === 0 && character === ',') {
      argumentsList.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  assert.equal(quoted, false, 'compiled ARM command expression must contain balanced string literals');
  assert.equal(depth, 0, 'compiled ARM command expression must contain balanced function calls');
  argumentsList.push(current.trim());
  return argumentsList;
}

function evaluateArmScalar(expression, template, parameters) {
  const trimmed = expression.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  const call = trimmed.match(/^(base64|parameters|variables)\(([\s\S]*)\)$/);
  assert.ok(call, `unsupported compiled ARM command expression: ${trimmed}`);
  const [, functionName, inner] = call;
  if (functionName === 'base64') {
    return Buffer.from(String(evaluateArmScalar(inner, template, parameters)), 'utf8').toString('base64');
  }
  const name = evaluateArmScalar(inner, template, parameters);
  if (functionName === 'parameters') {
    assert.ok(Object.hasOwn(parameters, name), `missing compiled ARM parameter fixture: ${name}`);
    return parameters[name];
  }
  assert.ok(Object.hasOwn(template.variables ?? {}, name), `missing compiled ARM variable: ${name}`);
  return template.variables[name];
}

function renderCompiledCommand(template, expression, parameters) {
  assert.ok(expression.startsWith('[format(') && expression.endsWith(')]'), 'worker extension command must compile to one ARM format expression');
  const args = splitArmArguments(expression.slice('[format('.length, -2));
  const format = evaluateArmScalar(args[0], template, parameters);
  const values = args.slice(1).map((argument) => evaluateArmScalar(argument, template, parameters));
  return format.replace(/\{(\d+)\}/g, (_match, rawIndex) => {
    const index = Number(rawIndex);
    assert.ok(index < values.length, `compiled ARM format placeholder is out of range: ${rawIndex}`);
    return values[index];
  });
}

function runCompiledWorkerExtension(template, extension, fixture, { commit, digest }) {
  const bootstrapRoot = path.join(fixture, 'private-bootstrap');
  const commandToExecute = String(extension?.properties?.protectedSettings?.commandToExecute ?? '');
  const parameters = {
    releaseSourceCommit: commit,
    workerArtifactSha256: digest,
    codexBinSha256: 'b'.repeat(64),
    workerIdentityClientId: '11111111-1111-1111-1111-111111111111',
    agentDispatchQueueEndpoint: 'https://example.queue.core.windows.net/agent-dispatch',
    agentDispatchPoisonQueueEndpoint: 'https://example.queue.core.windows.net/agent-dispatch-poison',
    cosmosEndpoint: 'https://example.documents.azure.com/',
    cosmosDatabase: 'teamsapp',
    cosmosContainer: 'runtime-records',
  };
  let command = renderCompiledCommand(template, commandToExecute, parameters);
  const productionBootstrapRoot = Buffer.from('/var/lib/teamsapp/bootstrap', 'utf8').toString('base64');
  const productionBootstrapArgumentIndex = command.lastIndexOf(` ${productionBootstrapRoot}`);
  if (productionBootstrapArgumentIndex >= 0) {
    const encodedFixtureRoot = Buffer.from(bootstrapRoot, 'utf8').toString('base64');
    const rootStart = productionBootstrapArgumentIndex + 1;
    command = `${command.slice(0, rootStart)}${encodedFixtureRoot}${command.slice(rootStart + productionBootstrapRoot.length)}`;
  }
  const commandBin = path.join(fixture, 'command-bin');
  fs.mkdirSync(commandBin, { recursive: true });
  fs.writeFileSync(path.join(commandBin, 'cloud-init'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o500 });
  const logs = {
    sentinel: path.join(fixture, 'installer-executed'),
    installerPath: path.join(fixture, 'installer-path'),
    tmpdir: path.join(fixture, 'tmpdir'),
    stageMode: path.join(fixture, 'stage-mode'),
    installerMode: path.join(fixture, 'installer-mode'),
    tmpFiles: path.join(fixture, 'tmp-files'),
  };
  const legacyInstaller = '/tmp/install-worker-runtime.sh';
  const executesLegacyInstaller = command.includes(legacyInstaller);
  if (executesLegacyInstaller) {
    assert.equal(fs.existsSync(legacyInstaller), false, `unsafe regression test cannot overwrite existing ${legacyInstaller}`);
  }
  let result;
  try {
    result = spawnSync('bash', ['-c', command], {
      cwd: fixture,
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        PATH: `${commandBin}${path.delimiter}${process.env.PATH ?? ''}`,
        TMPDIR: fixture,
        MP279_SENTINEL: logs.sentinel,
        MP279_INSTALLER_PATH_LOG: logs.installerPath,
        MP279_TMPDIR_LOG: logs.tmpdir,
        MP279_STAGE_MODE_LOG: logs.stageMode,
        MP279_INSTALLER_MODE_LOG: logs.installerMode,
        MP279_TMP_FILE_LOG: logs.tmpFiles,
      },
    });
  } finally {
    if (executesLegacyInstaller && fs.existsSync(legacyInstaller)) fs.rmSync(legacyInstaller);
  }
  assert.equal(result.error, undefined, `compiled worker extension command must finish within its bounded test timeout: ${result.error?.message}`);
  return { bootstrapRoot, command, logs, result };
}

const bicep = resolveBicep();
const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'teamsapp-bicep-contract-'));
try {
  const compiled = compileBicep(bicep, mainBicepPath, path.join(outputDirectory, 'main.json'));
  const compiledWorkerVm = compileBicep(bicep, workerVmBicepPath, path.join(outputDirectory, 'worker-vm.json'));
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

  const containerEnvironment = findResource(resources, 'Microsoft.App/managedEnvironments');
  const appLogsConfiguration = containerEnvironment.properties?.appLogsConfiguration;
  assert.equal(
    appLogsConfiguration?.destination,
    'log-analytics',
    'a managed environment with logAnalyticsConfiguration must use the log-analytics destination',
  );
  assert.ok(
    appLogsConfiguration?.logAnalyticsConfiguration?.customerId,
    'the Log Analytics destination must bind the provisioned workspace customer ID',
  );
  assert.ok(
    appLogsConfiguration?.logAnalyticsConfiguration?.sharedKey,
    'the Log Analytics destination must bind the provisioned workspace shared key',
  );

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
    /base64\(variables\('workerArchiveBootstrapScript'\)\).*base64\(parameters\('workerArtifactSha256'\)\).*base64\(parameters\('codexBinSha256'\)\)/,
    'extension must execute the trusted bootstrap with encoded immutable digest inputs',
  );
  assert.match(
    String(workerExtension.properties?.protectedSettings?.commandToExecute),
    /bash -o pipefail -c/,
    'extension wrapper must fail closed if trusted bootstrap decoding fails',
  );

  const compiledWorkerResources = collectResources(compiledWorkerVm);
  const compiledWorkerExtension = findResource(compiledWorkerResources, 'Microsoft.Compute/virtualMachines/extensions');
  assert.equal(compiledWorkerVm.parameters?.codexBinSha256?.minLength, 64, 'worker module must require a complete Codex SHA-256 digest');
  assert.equal(compiledWorkerVm.parameters?.codexBinSha256?.maxLength, 64, 'worker module must reject truncated Codex SHA-256 digests');

  const mismatchFixture = fs.mkdtempSync(path.join(outputDirectory, 'mismatch-'));
  const mismatchArchive = createWorkerBootstrapArchive(mismatchFixture);
  const mismatch = runCompiledWorkerExtension(compiledWorkerVm, compiledWorkerExtension, mismatchFixture, {
    ...mismatchArchive,
    digest: 'f'.repeat(64),
  });
  assert.equal(fs.existsSync(mismatch.logs.sentinel), false, 'mismatched archive installer must never execute');
  assert.notEqual(mismatch.result.status, 0, 'compiled worker extension must reject mismatched archive bytes before installer execution');
  assert.match(mismatch.result.stderr, /archive SHA-256 mismatch/i);

  const trustedBootstrap = compiledWorkerVm.variables?.workerArchiveBootstrapScript;
  const currentBootstrap = typeof trustedBootstrap === 'string'
    ? trustedBootstrap
    : String(compiledWorkerExtension?.properties?.protectedSettings?.commandToExecute ?? '');
  const trustedDigestIndex = currentBootstrap.indexOf('sha256sum');
  const archiveExtractionIndex = currentBootstrap.search(/tar\s+[^\n]*(?:--extract|-x)/);
  assert.ok(
    trustedDigestIndex >= 0 && archiveExtractionIndex >= 0 && trustedDigestIndex < archiveExtractionIndex,
    `compiled VM extension must verify archive bytes before any extraction or archive-provided execution (sha256sum=${trustedDigestIndex}, extraction=${archiveExtractionIndex})`,
  );
  assert.equal(typeof trustedBootstrap, 'string', 'compiled VM extension must carry a trusted archive bootstrap script');
  assert.match(
    String(compiledWorkerExtension?.properties?.protectedSettings?.commandToExecute),
    /base64\(variables\('workerArchiveBootstrapScript'\)\)/,
    'Custom Script extension must execute the trusted compiled bootstrap rather than an archive-provided script directly',
  );

  for (const unsafeType of ['symlink', 'hardlink', 'fifo', 'traversal', 'duplicate']) {
    const unsafeFixture = fs.mkdtempSync(path.join(outputDirectory, `unsafe-${unsafeType}-`));
    const unsafeArchive = createWorkerBootstrapArchive(unsafeFixture, { unsafeType });
    const unsafe = runCompiledWorkerExtension(compiledWorkerVm, compiledWorkerExtension, unsafeFixture, unsafeArchive);
    assert.notEqual(unsafe.result.status, 0, `trusted bootstrap must reject unsafe ${unsafeType} archive entries`);
    assert.match(unsafe.result.stderr, /unsafe worker archive entry/i);
    assert.equal(fs.existsSync(unsafe.logs.sentinel), false, `unsafe ${unsafeType} archive installer must never execute`);
  }

  const validFixture = fs.mkdtempSync(path.join(outputDirectory, 'valid-'));
  const validArchive = createWorkerBootstrapArchive(validFixture);
  const valid = runCompiledWorkerExtension(compiledWorkerVm, compiledWorkerExtension, validFixture, validArchive);
  assert.equal(valid.result.status, 0, `trusted bootstrap must execute a verified safe installer:\n${valid.result.stderr}`);
  assert.ok(fs.existsSync(valid.logs.sentinel), 'verified safe installer must execute');
  const installerPath = fs.readFileSync(valid.logs.installerPath, 'utf8').trim();
  const installerTmpdir = fs.readFileSync(valid.logs.tmpdir, 'utf8').trim();
  assert.ok(installerPath.startsWith(`${valid.bootstrapRoot}${path.sep}`), 'installer must execute from the private bootstrap root');
  assert.equal(installerTmpdir, path.dirname(installerPath), 'installer extraction must remain inside its private staging directory');
  assert.equal(fs.readFileSync(valid.logs.stageMode, 'utf8').trim(), '700', 'private staging directory must be owner-only');
  assert.equal(fs.readFileSync(valid.logs.installerMode, 'utf8').trim(), '500', 'verified installer must be owner-executable only');
  assert.equal(fs.readFileSync(valid.logs.tmpFiles, 'utf8'), '', 'atomic promotion must leave no temporary file at execution time');
  assert.deepEqual(fs.readdirSync(valid.bootstrapRoot), [], 'private staging directory must be removed after execution');

  const roleAssignments = resources.filter((resource) => resource.type === 'Microsoft.Authorization/roleAssignments');
  const roleDefinitions = resources.filter((resource) => resource.type === 'Microsoft.Authorization/roleDefinitions');
  const appSenderRole = roleAssignments.find((resource) => (
    String(resource.properties?.roleDefinitionId).includes('storageQueueDataMessageSenderRoleDefinitionId')
    && String(resource.properties?.principalId).includes('appIdentityPrincipalId')
  ));
  const appQueueMetadataReaderRoleDefinition = roleDefinitions.find((resource) => (
    String(resource.properties?.roleName).includes('TeamsApp Core Queue Metadata Reader')
  ));
  const appQueueMetadataReaderRole = roleAssignments.find((resource) => (
    String(resource.properties?.roleDefinitionId).includes('teamsapp-core-queue-metadata-reader')
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
  assert.ok(appQueueMetadataReaderRoleDefinition, 'Container App must have a narrow non-mutating Queue metadata reader role');
  assert.deepEqual(
    appQueueMetadataReaderRoleDefinition.properties?.permissions?.[0]?.actions,
    ['Microsoft.Storage/storageAccounts/queueServices/queues/read'],
    'Queue readiness role must permit only the Get Queue Metadata queue read action',
  );
  assert.deepEqual(
    appQueueMetadataReaderRoleDefinition.properties?.permissions?.[0]?.dataActions,
    [],
    'Queue readiness role must not grant message read, receive, update, or delete data actions',
  );
  assert.ok(appQueueMetadataReaderRole, 'Container App identity must receive the narrow Queue metadata reader role');
  assert.ok(workerProcessorRole, 'worker identity must receive the custom queue lease role');
  assert.ok(workerPoisonSenderRole, 'worker identity must receive sender-only access to the poison queue');
  assert.match(String(appSenderRole.scope), /agent-dispatch/i, 'Container App sender role must be scoped to the dispatch queue');
  assert.match(String(appQueueMetadataReaderRole.scope), /agent-dispatch/i, 'Container App metadata reader must be scoped to the dispatch queue');
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

  const workerRoleAssignments = roleAssignments.filter((resource) => (
    String(resource.properties?.principalId).includes('workerIdentityPrincipalId')
  ));
  assert.ok(
    workerRoleAssignments.every((resource) => (
      !String(resource.properties?.roleDefinitionId).includes('storageFileDataContributorRoleDefinitionId')
      && !String(resource.properties?.roleDefinitionId).includes('0c867c2a-1d8c-454a-a3db-ab2ea1bdc8bb')
    )),
    'worker identity must not receive Azure Files contributor access when the worker runtime does not use Azure Files',
  );
  assert.ok(
    workerRoleAssignments.every((resource) => (
      !String(resource.properties?.roleDefinitionId).includes('keyVaultSecretsUserRoleDefinitionId')
      && !String(resource.properties?.roleDefinitionId).includes('4633458b-17de-408a-b874-0445c86b69e6')
    )),
    'worker identity must not receive Key Vault secret-content access when bootstrap receives no Key Vault reference',
  );

  const cosmosRoleAssignments = resources.filter((resource) => (
    resource.type === 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments'
  ));
  assert.equal(cosmosRoleAssignments.length, 2, 'both runtime identities must receive Cosmos data-plane access');
  for (const assignment of cosmosRoleAssignments) {
    assert.notEqual(assignment.properties?.scope, '/', 'Cosmos data-plane access must not cover the whole account');
    const cosmosScope = String(assignment.properties?.scope);
    assert.match(
      cosmosScope,
      /format\('\{0\}\/dbs\/\{1\}\/colls\/\{2\}'/,
      'Cosmos data-plane access must use a fully qualified account/database/container scope',
    );
    assert.match(
      cosmosScope,
      /resourceId\('Microsoft\.DocumentDB\/databaseAccounts'/,
      'Cosmos role-assignment scope must begin with the full ARM account resource ID',
    );
    assert.match(cosmosScope, /parameters\('databaseName'\)/);
    assert.match(cosmosScope, /parameters\('containerName'\)/);
  }

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
  assert.ok(parameterNames.has('codexPackageUrl'), 'pipeline must accept one pinned official Codex Linux package URL');
  assert.ok(parameterNames.has('codexPackageSha256'), 'pipeline must authenticate the Codex package archive independently');
  assert.ok(parameterNames.has('codexPackageVersion'), 'pipeline must bind the expected Codex package version');
  assert.equal(parameterNames.has('codexArtifactUrl'), false, 'legacy single-executable Codex input must be removed');
  assert.equal(parameterNames.has('codexArtifactSha256'), false, 'package and executable digests must not share one ambiguous input');

  const validateStage = findStage(pipeline, 'ValidateHandoff');
  const approvalStage = findStage(pipeline, 'ValidateApprovalConfiguration');
  const platformStage = findStage(pipeline, 'ValidateAzurePlatform');
  const deployStage = findStage(pipeline, 'DeployCanary');
  const rollbackStage = findStage(pipeline, 'RollbackCanary');
  assert.ok(validateStage && approvalStage && platformStage && deployStage && rollbackStage, 'pipeline must model handoff, approval configuration, Azure platform preflight, deploy, and rollback as separate stages');
  assert.deepEqual(deployStage.dependsOn, ['ValidateHandoff', 'ValidateApprovalConfiguration', 'ValidateAzurePlatform']);
  assert.deepEqual(rollbackStage.dependsOn, ['ValidateApprovalConfiguration']);

  const validateScripts = allSteps(validateStage).map((step) => step.bash).filter(Boolean);
  assert.ok(validateScripts.some((script) => script.includes('scripts/azure-github-handoff.mjs')), 'handoff stage must execute the authenticated GitHub artifact consumer');
  assert.ok(validateScripts.every((script) => !script.includes('GITHUB_RELEASE_RECEIPT_URL')), 'handoff stage must not download caller-selected raw JSON');

  const approvalScripts = allSteps(approvalStage).map((step) => step.bash).filter(Boolean);
  assert.ok(approvalScripts.some((script) => script.includes('scripts/azure-approval-check.mjs')), 'approval stage must query and receipt the external Azure DevOps check');

  const platformJob = platformStage?.jobs?.[0];
  assert.equal(platformJob?.pool?.vmImage, 'ubuntu-24.04', 'Azure platform tests must pin the same supported Linux runner used for deployment');
  const platformSteps = allSteps(platformStage);
  const platformScripts = platformSteps.map((step) => step.bash).filter(Boolean);
  const platformScript = platformScripts.find((script) => script.includes('npm run test:azure-core'));
  assert.ok(platformScript, 'Azure Core must run before the deployment environment approval is requested');
  assert.ok(platformScript?.includes('git checkout --detach "$commit"'), 'pre-approval Azure tests must use the exact attested source commit');
  assert.ok(platformScript?.includes('az bicep version'), 'pre-approval Azure tests must validate Azure CLI Bicep integration');
  assert.ok(platformScript?.includes('command -v bicep'), 'pre-approval Azure tests must resolve the hosted Bicep executable');
  assert.ok(platformScript?.includes('npm run build:worker'), 'pre-approval Azure tests must build the Linux worker');
  assert.ok(platformScript?.includes('scripts/azure-codex-package.mjs'), 'pre-approval must authenticate and prepare the official Codex package');
  assert.ok(platformScript?.includes('scripts/azure-worker-runtime-package.mjs build'), 'pre-approval must build the complete immutable worker archive');
  assert.ok(platformScript?.includes('scripts/azure-worker-runtime-package.mjs verify'), 'pre-approval must verify the complete worker archive before publishing it');
  assert.ok(
    platformScript?.includes([
      'pinned_node_bin="$(command -v node)"',
      'test -x "$pinned_node_bin"',
      'test "$("$pinned_node_bin" --version)" = \'v24.19.0\'',
    ].join('\n')),
    'pre-approval must capture and verify the UseNode-selected executable before another tool directory can shadow PATH',
  );
  assert.ok(
    (platformScript?.indexOf('pinned_node_bin="$(command -v node)"') ?? -1)
      < (platformScript?.indexOf('export PATH="$PATH:$(dirname "$BICEP_BIN")"') ?? -1),
    'the pinned Node executable must be captured before the Bicep directory is added to PATH',
  );
  assert.ok(
    platformScript?.includes('export PATH="$PATH:$(dirname "$BICEP_BIN")"'),
    'the Bicep directory must be available to Azure CLI children without shadowing UseNode',
  );
  assert.equal(
    platformScript?.includes('export PATH="$(dirname "$BICEP_BIN"):$PATH"'),
    false,
    'the Bicep directory must not shadow the pinned Node runtime',
  );
  assert.ok(
    platformScript?.includes('--node-bin "$pinned_node_bin"'),
    'worker packaging must use the verified absolute UseNode executable instead of resolving node from a mutated PATH',
  );
  assert.equal(
    platformScript?.includes('--node-bin "$(command -v node)"'),
    false,
    'worker packaging must not re-resolve Node after PATH mutations',
  );
  assert.ok(platformScript?.includes('--connect-timeout 15'), 'pre-approval package download must have a bounded connection timeout');
  assert.ok(platformScript?.includes('--max-time 300'), 'pre-approval package download must have a bounded total timeout');
  assert.equal(platformScript?.includes('cp -RL'), false, 'worker packaging must never recursively dereference the hosted Node toolcache');
  assert.ok(platformScript?.includes('validate-worker-runtime-manifest.mjs'), 'pre-approval worker package must retain the VM-side manifest validator');
  const platformRbacStep = platformSteps.find((step) => (
    step.task === 'AzureCLI@2' && step.inputs?.inlineScript?.includes('scripts/azure-deployment-rbac.mjs')
  ));
  assert.ok(platformRbacStep, 'caller-effective RBAC must be verified before the deployment environment approval');
  const platformWhatIfScript = platformRbacStep?.inputs?.inlineScript;
  assert.ok(platformWhatIfScript?.includes('az deployment group what-if'), 'foundation what-if must execute before environment approval');
  assert.ok(platformWhatIfScript?.includes('--subscription "$AZURE_SUBSCRIPTION_ID"'), 'pre-approval what-if must pin the subscription explicitly');
  assert.ok(platformWhatIfScript?.includes('--validation-level Provider'), 'pre-approval what-if must use provider validation');
  assert.ok(platformWhatIfScript?.includes('--result-format FullResourcePayloads'), 'pre-approval what-if must request property-level change classification');
  assert.equal(platformWhatIfScript?.includes('--result-format ResourceIdOnly'), false, 'pre-approval must not collapse existing resources into ambiguous Deploy rows');
  assert.ok(platformWhatIfScript?.includes('--no-pretty-print'), 'pre-approval what-if must emit machine-readable JSON');
  assert.ok(platformWhatIfScript?.includes('--no-prompt true'), 'pre-approval what-if must fail instead of prompting for missing parameters');
  assert.ok(platformWhatIfScript?.includes('scripts/azure-what-if-receipt.mjs create'), 'pre-approval what-if must produce a validated receipt');
  assert.ok(
    platformSteps.some((step) => step.task === 'PublishPipelineArtifact@1'
      && step.inputs?.artifact === 'azure-platform-preflight-receipt'),
    'pipeline must retain the successful pre-approval Azure platform receipt',
  );
  assert.ok(
    platformSteps.some((step) => step.task === 'PublishPipelineArtifact@1'
      && step.inputs?.artifact === 'azure-rbac-preflight-receipt'),
    'pipeline must retain the pre-approval caller-effective RBAC receipt',
  );
  assert.ok(
    platformSteps.some((step) => step.task === 'PublishPipelineArtifact@1'
      && step.inputs?.artifact === 'azure-worker-runtime-package'),
    'pipeline must retain the immutable worker runtime package before environment approval',
  );
  assert.ok(
    platformSteps.some((step) => step.task === 'PublishPipelineArtifact@1'
      && step.inputs?.artifact === 'azure-what-if-preflight-receipt'),
    'pipeline must retain the exact pre-approval what-if receipt',
  );

  const deploySteps = allSteps(deployStage);
  const azureCliSteps = deploySteps.filter((step) => step.task === 'AzureCLI@2');
  const deployStep = azureCliSteps.find((step) => step.inputs?.inlineScript?.includes('az deployment group create'));
  const deployScript = deployStep?.inputs?.inlineScript;
  assert.ok(
    platformRbacStep?.inputs?.inlineScript?.includes('/providers/Microsoft.Authorization/permissions?api-version=2022-04-01'),
    'pre-approval RBAC must use the official resource-group caller-permissions API',
  );
  assert.equal(
    azureCliSteps.some((step) => step.inputs?.inlineScript?.includes('scripts/azure-deployment-rbac.mjs')),
    false,
    'deployment must consume the pre-approval RBAC receipt instead of discovering permissions after approval',
  );
  assert.ok(
    deploySteps.some((step) => step.download === 'current' && step.artifact === 'azure-platform-preflight-receipt'),
    'deployment must consume the exact pre-approval platform receipt',
  );
  assert.ok(
    deploySteps.some((step) => step.download === 'current' && step.artifact === 'azure-rbac-preflight-receipt'),
    'deployment must consume the pre-approval RBAC receipt',
  );
  assert.ok(
    deploySteps.some((step) => step.download === 'current' && step.artifact === 'azure-worker-runtime-package'),
    'deployment must consume the exact current-run worker runtime package',
  );
  assert.ok(
    deploySteps.some((step) => step.download === 'current' && step.artifact === 'azure-what-if-preflight-receipt'),
    'deployment must consume the exact current-run foundation what-if receipt',
  );
  assert.ok(deployScript?.includes('az deployment group create'), 'deployment must provision with an Azure resource-group deployment');
  assert.ok(deployScript?.includes('--template-file infra/azure/main.bicep'), 'deployment must execute the compiled main.bicep contract');
  assert.ok(deployScript?.includes('scripts/azure-deployment-contract.mjs outputs'), 'deployment must consume validated Bicep outputs');
  assert.equal(deployScript?.includes('npm run test:azure-core'), false, 'the first Azure Core execution must not be deferred until after approval');
  assert.ok(deployScript?.includes('azure-platform-preflight-receipt.json'), 'deployment must bind the pre-approval receipt to the exact release commit');
  assert.equal(
    deployScript?.includes('az bicep install'),
    false,
    'Azure deployment must not blindly reinstall Bicep after Azure CLI already used it for deployment',
  );
  assert.ok(deployScript?.includes('az --version'), 'Azure deployment must retain the hosted Azure CLI version in the task log');
  assert.ok(deployScript?.includes('az bicep version'), 'Azure deployment must validate the official Azure CLI Bicep integration');
  assert.ok(deployScript?.includes('command -v bicep'), 'Azure deployment must prefer the CI PATH Bicep selected by Azure CLI');
  assert.ok(
    deployScript?.includes('bicep_config_dir="${AZURE_CONFIG_DIR:-$HOME/.azure}"'),
    'Azure deployment must fall back to the task-local Azure CLI managed Bicep path',
  );
  assert.ok(
    deployScript?.includes('export PATH="$PATH:$(dirname "$BICEP_BIN")"'),
    'Azure deployment must expose the verified Bicep directory to Azure CLI child processes without shadowing UseNode',
  );
  assert.equal(
    deployScript?.includes('export PATH="$(dirname "$BICEP_BIN"):$PATH"'),
    false,
    'Azure deployment must not shadow the pinned Node runtime with the Bicep directory',
  );
  assert.ok(deployScript?.includes('"$BICEP_BIN" --version'), 'Azure deployment must execute the resolved Bicep binary before the Azure Core gate');
  assert.equal(deployScript?.includes('npm run build:worker'), false, 'deployment must not rebuild a worker after environment approval');
  assert.equal(deployScript?.includes('git fetch'), false, 'deployment must not refetch different source after environment approval');
  assert.equal(deployScript?.includes('git checkout --detach "$commit"'), false, 'deployment must consume the pre-approved artifact instead of rebuilding it');
  assert.equal(deployScript?.includes('npm ci'), false, 'deployment must not repeat dependency restoration after environment approval');
  assert.ok(deployScript?.includes('version: 24.19.0') || JSON.stringify(deploySteps).includes('24.19.0'), 'worker archive must carry the pinned Node runtime');
  assert.ok(deployScript?.includes('CODEX_PACKAGE_URL'), 'deployment must require an approved Codex package reference');
  assert.ok(deployScript?.includes('CODEX_PACKAGE_SHA256'), 'deployment must require and verify the package archive digest');
  assert.ok(deployScript?.includes('CODEX_PACKAGE_VERSION'), 'deployment must bind the expected package version');
  assert.equal(deployScript?.includes('scripts/azure-codex-package.mjs'), false, 'deployment must not redownload or reprepare Codex after approval');
  assert.ok(deployScript?.includes('scripts/azure-worker-runtime-package.mjs verify'), 'deployment must verify the exact current-run worker package before any Azure mutation');
  assert.ok(
    deployScript.indexOf('scripts/azure-worker-runtime-package.mjs verify') < deployScript.indexOf('az deployment group create'),
    'worker package verification must occur before the first Azure resource mutation',
  );
  assert.ok(deployScript?.includes('scripts/azure-what-if-receipt.mjs verify'), 'deployment must verify the pre-approval what-if receipt');
  assert.ok(
    deployScript.indexOf('scripts/azure-what-if-receipt.mjs verify') < deployScript.indexOf('az deployment group create'),
    'foundation what-if receipt verification must occur before the first Azure resource mutation',
  );
  assert.equal(
    (deployScript?.match(/az deployment group create \\\n/g) ?? []).length,
    2,
    'canary deployment must retain exactly the foundation and workload create operations',
  );
  assert.ok(
    /az deployment group create \\\n\s+--name teamsapp-platform-foundation \\\n\s+--subscription "\$AZURE_SUBSCRIPTION_ID"/u.test(deployScript ?? ''),
    'foundation create must pin the subscription explicitly',
  );
  assert.ok(
    /az deployment group create \\\n\s+--name teamsapp-platform-current \\\n\s+--subscription "\$AZURE_SUBSCRIPTION_ID"/u.test(deployScript ?? ''),
    'workload create must pin the subscription explicitly',
  );
  const firstCreateIndex = deployScript.indexOf('az deployment group create');
  const workloadWhatIfIndex = deployScript.indexOf('az deployment group what-if', firstCreateIndex + 1);
  const secondCreateIndex = deployScript.indexOf('az deployment group create', firstCreateIndex + 1);
  assert.ok(workloadWhatIfIndex > firstCreateIndex, 'exact workload what-if must run after foundation outputs exist');
  assert.ok(workloadWhatIfIndex < secondCreateIndex, 'exact workload what-if must pass before the workload mutation');
  assert.ok(deployScript?.includes('--parameters "@${foundation_parameters}"'), 'foundation what-if verification and create must bind one parameter file');
  assert.ok(deployScript?.includes('--parameters "@${workload_parameters}"'), 'workload what-if and create must bind one parameter file');
  assert.ok(deployScript?.includes('--validation-level Provider'), 'deployment what-if must retain provider-level validation');
  assert.ok(deployScript?.includes('--result-format FullResourcePayloads'), 'deployment what-if must retain property-level change classification');
  assert.equal(deployScript?.includes('--result-format ResourceIdOnly'), false, 'deployment what-if must not use ambiguous ResourceIdOnly classification');
  assert.ok(deployScript?.includes('--no-pretty-print'), 'deployment what-if must emit machine-readable JSON');
  assert.ok(deployScript?.includes('--no-prompt true'), 'deployment what-if must not fall back to an interactive prompt');
  assert.ok(
    deploySteps.some((step) => step.task === 'PublishPipelineArtifact@1'
      && step.inputs?.artifact === 'azure-what-if-workload-receipt'),
    'pipeline must retain the exact workload what-if receipt',
  );
  assert.ok(deployScript?.includes("codex_bin_sha=\"$(jq -er '.codexBinSha256' \"$worker_receipt\")\""), 'deployment must read the executable digest from the pre-approval worker receipt');
  assert.ok(deployScript?.includes('codexPackageSha256'), 'worker provenance must retain the authenticated package archive digest');
  assert.ok(deployScript?.includes('--codex-bin-sha256 "$codex_bin_sha"'), 'Bicep parameters must receive the independently measured executable digest');
  assert.equal(deployScript?.includes('--codex-bin-sha256 "$CODEX_PACKAGE_SHA256"'), false, 'package archive SHA must never be reused as the extracted executable SHA');
  assert.equal(deployScript?.includes('CODEX_ARTIFACT_'), false, 'legacy single-executable environment names must be removed');
  assert.equal(deployScript?.includes('cp -RL'), false, 'deployment must never copy the hosted Node toolcache');
  assert.ok(deployScript?.includes('az storage blob upload'), 'deployment must stage the immutable worker archive in private Azure Blob storage');
  assert.ok(deployScript?.includes('--auth-mode login'), 'artifact staging must use Entra authentication rather than account keys or SAS');
  assert.ok(deployScript?.includes('metadata.sha256'), 'an existing immutable worker blob must be accepted only when its SHA-256 metadata matches');
  assert.ok(deployScript?.includes('--worker-artifact-sha256 "$worker_artifact_sha"'), 'deployment must bind the worker archive digest into Bicep parameters');
  assert.ok(deployScript?.includes('--codex-bin-sha256 "$codex_bin_sha"'), 'deployment must bind the measured Codex executable digest into Bicep parameters');
  assert.ok(!Object.hasOwn(pipeline.variables ?? {}, 'azureContainerApp'), 'pipeline must not substitute a hard-coded Container App name for Bicep outputs');
  assert.ok(!Object.hasOwn(pipeline.variables ?? {}, 'azureContainerRegistry'), 'pipeline must not substitute a hard-coded ACR name for Bicep outputs');

  const rollbackScript = allSteps(rollbackStage).find((step) => step.task === 'AzureCLI@2')?.inputs?.inlineScript;
  assert.ok(rollbackScript?.includes('scripts/azure-deployment-contract.mjs select-rollback'), 'rollback must select current/previous revisions by observed traffic history');
  assert.ok(rollbackScript?.includes('scripts/azure-deployment-contract.mjs verify'), 'rollback must verify target revision readiness and full release identity');

  console.log('PASS: official Bicep compilation, compiled ARM behavior, parsed Azure Pipeline schema, and executable deployment helpers satisfy the Azure platform contract.');
} finally {
  fs.rmSync(outputDirectory, { recursive: true, force: true });
}
