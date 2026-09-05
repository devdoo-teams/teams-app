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
  assert.equal(foundation.parameters.containerImage.value, `${release.image}@${digest}`);
  assert.equal(foundation.parameters.deploymentPrincipalId.value, common.deploymentPrincipalId);
  assert.equal(foundation.parameters.releaseSourceCommit.value, commit);
  assert.equal(Object.hasOwn(foundation.parameters, 'workerArtifactUrl'), false);

  const workerArtifactUrl = `https://fixture.blob.core.windows.net/runtime/${commit}/worker-runtime-${commit}.tar`;
  const workload = buildAzureDeploymentParameters({
    ...common,
    phase: 'workload',
    containerImage: `teamsappfixture.azurecr.io/teamsapp@${digest}`,
    workerArtifactUrl,
    workerArtifactSha256: 'f'.repeat(64),
    codexBinSha256: '1'.repeat(64),
  });
  assert.equal(workload.parameters.deployContainerApp.value, true);
  assert.equal(workload.parameters.deployWorkerVm.value, true);
  assert.equal(workload.parameters.deploymentPrincipalId.value, common.deploymentPrincipalId);
  assert.equal(workload.parameters.workerArtifactUrl.value, workerArtifactUrl);
  assert.equal(workload.parameters.workerArtifactSha256.value, 'f'.repeat(64));
  assert.equal(workload.parameters.codexBinSha256.value, '1'.repeat(64));

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
    }),
    /worker artifact/i,
  );
  assert.throws(
    () => buildAzureDeploymentParameters({
      ...common,
      phase: 'workload',
      containerImage: `teamsappfixture.azurecr.io/teamsapp@sha256:${'0'.repeat(64)}`,
      workerArtifactUrl,
      workerArtifactSha256: 'f'.repeat(64),
      codexBinSha256: '1'.repeat(64),
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
    '--output', outputPath,
  ];
  const createResult = spawnSync(process.execPath, cliArgs, { encoding: 'utf8' });
  assert.equal(createResult.status, 0, createResult.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, 'utf8')), foundation);
  assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);

  const overwriteResult = spawnSync(process.execPath, cliArgs, { encoding: 'utf8' });
  assert.notEqual(overwriteResult.status, 0, 'parameter generation must not overwrite an existing file');

  console.log('azure-deployment-parameters-test: PASS');
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
