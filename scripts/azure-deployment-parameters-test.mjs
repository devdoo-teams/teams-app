import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildAzureDeploymentParameters } from './azure-deployment-parameters.mjs';

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-azure-deployment-parameters-'));

try {
  const commit = 'a'.repeat(40);
  const digest = `sha256:${'b'.repeat(64)}`;
  const release = {
    schemaVersion: 1,
    source: 'github-actions',
    commit,
    version: '1.0.102',
    image: 'ghcr.io/devdoo-teams/teams-app',
    imageDigest: digest,
    teamsPackageSha256: 'c'.repeat(64),
    clientBundleSha256: 'd'.repeat(64),
    serverBundleSha256: 'e'.repeat(64),
  };
  const common = {
    release,
    workloadName: 'teamsapp',
    location: 'koreacentral',
    deploymentPrincipalId: '12345678-1234-1234-1234-123456789abc',
    workerAdminSshPublicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixture fixture@example.invalid',
    productionRuntimeConfig: {
      TEAMS_APP_ID: '00000000-0000-4000-8000-000000000001',
      TEAMS_CATALOG_APP_ID: '00000000-0000-4000-8000-000000000002',
      BOT_ID: '00000000-0000-4000-8000-000000000003',
      TAB_DOMAIN: 'teamsapp.example.com',
      CLIENT_ID: '00000000-0000-4000-8000-000000000004',
      BOT_CLIENT_ID: '00000000-0000-4000-8000-000000000005',
      TENANT_ID: '00000000-0000-4000-8000-000000000006',
      APPLICATION_ID_URI: 'api://teamsapp.example.com/botid-00000000-0000-4000-8000-000000000005',
      TEAMS_USER_AUTH_ACCEPTED_AUDIENCES: '00000000-0000-4000-8000-000000000004',
      TEAMS_BOT_CLIENT_SECRET_KEY_VAULT_SECRET_NAME: 'teams-bot-client-secret',
      TEAMS_OPERATOR_ALLOWLIST_KEY_VAULT_SECRET_NAME: 'teams-operator-allowlist',
    },
  };

  const foundation = buildAzureDeploymentParameters({
    ...common,
    phase: 'foundation',
    containerImage: `${release.image}@${digest}`,
  });
  assert.equal(foundation.$schema, 'https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#');
  assert.equal(foundation.contentVersion, '1.0.0.0');
  assert.equal(foundation.parameters.deployContainerApp.value, false);
  assert.equal(foundation.parameters.deployWorkerVm.value, false);
  assert.equal(foundation.parameters.initializeWorkerVm.value, false);
  assert.equal(foundation.parameters.containerImage.value, `${release.image}@${digest}`);
  assert.equal(foundation.parameters.deploymentPrincipalId.value, common.deploymentPrincipalId);
  assert.equal(foundation.parameters.releaseSourceCommit.value, commit);
  assert.equal(foundation.parameters.botClientId.value, common.productionRuntimeConfig.BOT_CLIENT_ID);
  assert.equal(foundation.parameters.applicationIdUri.value, common.productionRuntimeConfig.APPLICATION_ID_URI);
  assert.equal(
    foundation.parameters.botClientSecretKeyVaultSecretName.value,
    common.productionRuntimeConfig.TEAMS_BOT_CLIENT_SECRET_KEY_VAULT_SECRET_NAME,
  );
  assert.equal(Object.hasOwn(foundation.parameters, 'workerArtifactUrl'), false);

  const workerArtifactUrl = `https://fixture.blob.core.windows.net/runtime/${commit}/worker-runtime-${commit}.tar`;
  const workload = buildAzureDeploymentParameters({
    ...common,
    phase: 'workload',
    containerImage: `teamsappfixture.azurecr.io/teamsapp@${digest}`,
    workerArtifactUrl,
    workerArtifactSha256: 'f'.repeat(64),
    codexBinSha256: '1'.repeat(64),
    initializeWorkerVm: false,
  });
  assert.equal(workload.parameters.deployContainerApp.value, true);
  assert.equal(workload.parameters.deployWorkerVm.value, true);
  assert.equal(workload.parameters.initializeWorkerVm.value, false);
  assert.equal(workload.parameters.deploymentPrincipalId.value, common.deploymentPrincipalId);
  assert.equal(workload.parameters.workerArtifactUrl.value, workerArtifactUrl);
  assert.equal(workload.parameters.workerArtifactSha256.value, 'f'.repeat(64));
  assert.equal(workload.parameters.codexBinSha256.value, '1'.repeat(64));

  const firstDeployment = buildAzureDeploymentParameters({
    ...common,
    phase: 'workload',
    containerImage: `teamsappfixture.azurecr.io/teamsapp@${digest}`,
    workerArtifactUrl,
    workerArtifactSha256: 'f'.repeat(64),
    codexBinSha256: '1'.repeat(64),
    initializeWorkerVm: true,
  });
  assert.equal(firstDeployment.parameters.initializeWorkerVm.value, true);

  assert.throws(
    () => buildAzureDeploymentParameters({
      ...common,
      deploymentPrincipalId: 'not-an-object-id',
      phase: 'foundation',
      containerImage: `${release.image}@${digest}`,
    }),
    /deployment principal/i,
  );
  assert.throws(
    () => buildAzureDeploymentParameters({
      ...common,
      phase: 'foundation',
      containerImage: `ghcr.io/devdoo-teams/teams-app@sha256:${'0'.repeat(64)}`,
    }),
    /foundation.*image/i,
  );
  assert.throws(
    () => buildAzureDeploymentParameters({
      ...common,
      phase: 'workload',
      containerImage: `teamsappfixture.azurecr.io/teamsapp@${digest}`,
      workerArtifactUrl,
      workerArtifactSha256: 'f'.repeat(64),
      codexBinSha256: '1'.repeat(64),
    }),
    /initialize worker VM/i,
  );
  assert.throws(
    () => buildAzureDeploymentParameters({
      ...common,
      phase: 'workload',
      containerImage: `teamsappfixture.azurecr.io/teamsapp@sha256:${'0'.repeat(64)}`,
      workerArtifactUrl,
      workerArtifactSha256: 'f'.repeat(64),
      codexBinSha256: '1'.repeat(64),
      initializeWorkerVm: false,
    }),
    /digest/i,
  );

  const releasePath = path.join(temporaryDirectory, 'release.json');
  const outputPath = path.join(temporaryDirectory, 'foundation.parameters.json');
  fs.writeFileSync(releasePath, `${JSON.stringify(release)}\n`, { mode: 0o600 });
  const cliArgs = [
    path.join(import.meta.dirname, 'azure-deployment-parameters.mjs'),
    '--phase', 'foundation',
    '--release-receipt', releasePath,
    '--workload-name', common.workloadName,
    '--location', common.location,
    '--container-image', `${release.image}@${digest}`,
    '--deployment-principal-id', common.deploymentPrincipalId,
    '--worker-admin-ssh-public-key', common.workerAdminSshPublicKey,
    '--teams-app-id', common.productionRuntimeConfig.TEAMS_APP_ID,
    '--teams-catalog-app-id', common.productionRuntimeConfig.TEAMS_CATALOG_APP_ID,
    '--bot-id', common.productionRuntimeConfig.BOT_ID,
    '--tab-domain', common.productionRuntimeConfig.TAB_DOMAIN,
    '--client-id', common.productionRuntimeConfig.CLIENT_ID,
    '--bot-client-id', common.productionRuntimeConfig.BOT_CLIENT_ID,
    '--tenant-id', common.productionRuntimeConfig.TENANT_ID,
    '--application-id-uri', common.productionRuntimeConfig.APPLICATION_ID_URI,
    '--teams-user-auth-accepted-audiences', common.productionRuntimeConfig.TEAMS_USER_AUTH_ACCEPTED_AUDIENCES,
    '--bot-client-secret-key-vault-secret-name', common.productionRuntimeConfig.TEAMS_BOT_CLIENT_SECRET_KEY_VAULT_SECRET_NAME,
    '--operator-allowlist-key-vault-secret-name', common.productionRuntimeConfig.TEAMS_OPERATOR_ALLOWLIST_KEY_VAULT_SECRET_NAME,
    '--output', outputPath,
  ];
  const createResult = spawnSync(process.execPath, cliArgs, { encoding: 'utf8' });
  assert.equal(createResult.status, 0, createResult.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, 'utf8')), foundation);
  assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);

  const overwriteResult = spawnSync(process.execPath, cliArgs, { encoding: 'utf8' });
  assert.notEqual(overwriteResult.status, 0, 'parameter generation must not overwrite an existing file');

  const workloadOutputPath = path.join(temporaryDirectory, 'workload.parameters.json');
  const workloadCliArgs = [
    path.join(import.meta.dirname, 'azure-deployment-parameters.mjs'),
    '--phase', 'workload',
    '--release-receipt', releasePath,
    '--workload-name', common.workloadName,
    '--location', common.location,
    '--container-image', `teamsappfixture.azurecr.io/teamsapp@${digest}`,
    '--deployment-principal-id', common.deploymentPrincipalId,
    '--worker-admin-ssh-public-key', common.workerAdminSshPublicKey,
    '--teams-app-id', common.productionRuntimeConfig.TEAMS_APP_ID,
    '--teams-catalog-app-id', common.productionRuntimeConfig.TEAMS_CATALOG_APP_ID,
    '--bot-id', common.productionRuntimeConfig.BOT_ID,
    '--tab-domain', common.productionRuntimeConfig.TAB_DOMAIN,
    '--client-id', common.productionRuntimeConfig.CLIENT_ID,
    '--bot-client-id', common.productionRuntimeConfig.BOT_CLIENT_ID,
    '--tenant-id', common.productionRuntimeConfig.TENANT_ID,
    '--application-id-uri', common.productionRuntimeConfig.APPLICATION_ID_URI,
    '--teams-user-auth-accepted-audiences', common.productionRuntimeConfig.TEAMS_USER_AUTH_ACCEPTED_AUDIENCES,
    '--bot-client-secret-key-vault-secret-name', common.productionRuntimeConfig.TEAMS_BOT_CLIENT_SECRET_KEY_VAULT_SECRET_NAME,
    '--operator-allowlist-key-vault-secret-name', common.productionRuntimeConfig.TEAMS_OPERATOR_ALLOWLIST_KEY_VAULT_SECRET_NAME,
    '--worker-artifact-url', workerArtifactUrl,
    '--worker-artifact-sha256', 'f'.repeat(64),
    '--codex-bin-sha256', '1'.repeat(64),
    '--initialize-worker-vm', 'false',
    '--output', workloadOutputPath,
  ];
  const workloadCliResult = spawnSync(process.execPath, workloadCliArgs, { encoding: 'utf8' });
  assert.equal(workloadCliResult.status, 0, workloadCliResult.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(workloadOutputPath, 'utf8')), workload);

  console.log('azure-deployment-parameters-test: PASS');
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
