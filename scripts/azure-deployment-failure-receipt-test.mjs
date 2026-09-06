import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const pipeline = fs.readFileSync(path.join(repositoryRoot, 'azure-pipelines.yml'), 'utf8');
const deployCanary = pipeline.slice(
  pipeline.indexOf('  - stage: DeployCanary'),
  pipeline.indexOf('  - stage: RollbackCanary'),
);

const receiptHelperSnapshotIndex = deployCanary.indexOf('failure_receipt_script=');
const releaseCheckoutIndex = deployCanary.indexOf('git checkout --detach "$commit"');
assert.notEqual(receiptHelperSnapshotIndex, -1, 'deploy must snapshot the CI receipt helper before release checkout');
assert.notEqual(releaseCheckoutIndex, -1, 'deploy must materialize the exact release source');
assert.ok(
  receiptHelperSnapshotIndex < releaseCheckoutIndex,
  'the CI receipt helper must be preserved before release checkout can replace the source tree',
);
assert.match(
  deployCanary,
  /cp\s+scripts\/azure-deployment-failure-receipt\.mjs\s+"\$failure_receipt_script"/u,
  'deploy must copy the CI receipt helper before release checkout',
);
assert.match(
  deployCanary,
  /node\s+"\$failure_receipt_script"/u,
  'deploy failure handling must execute the preserved CI receipt helper',
);
const validateHandoff = pipeline.slice(
  pipeline.indexOf('  - stage: ValidateHandoff'),
  pipeline.indexOf('  - stage: ValidateApprovalConfiguration'),
);

assert.notEqual(validateHandoff.indexOf('  - stage: ValidateHandoff'), -1, 'pipeline must retain a handoff validation stage');
assert.match(validateHandoff, /handoff_failure_dir=/u, 'handoff validation must allocate a failure receipt directory');
assert.match(validateHandoff, /handoff_boundary="bootstrap"/u, 'handoff validation must initialize a safe failure boundary');
assert.match(validateHandoff, /trap 'status=\$\?; write_failure_receipt "\$status"; exit "\$status"' ERR/u, 'handoff validation must retain failures at the exact failing boundary');
assert.match(validateHandoff, /artifact: github-handoff-failure-receipt/u, 'handoff validation must publish its failure receipt');

assert.match(pipeline, /failure_boundary="bootstrap"/u, 'deploy must initialize a safe failure boundary before any Azure command');
assert.match(pipeline, /azure-deployment-failure-receipt\.mjs/u, 'deploy must write the bounded failure receipt through a repository script');
assert.match(pipeline, /task\.logissue type=error;code=TEAMSAPP_AZURE_DEPLOYMENT_BOUNDARY/u, 'deploy must expose a safe failure boundary in the Azure DevOps log');
assert.match(pipeline, /artifact: azure-deployment-failure-receipt/u, 'deploy must retain a failure receipt artifact');
assert.match(pipeline, /condition: failed\(\)/u, 'failure receipt publication must run after a failed deployment task');
assert.match(pipeline, /--boundary "\$\{failure_boundary:-bootstrap\}"/u, 'receipt must record the last named boundary without assuming release variables exist');
assert.match(pipeline, /--exit-code "\$status"/u, 'receipt must record the failing command exit status');
assert.doesNotMatch(pipeline, /--error "\$\{[^}]*stderr/iu, 'raw stderr must not be copied into the durable receipt');

const { createAzureDeploymentFailureReceipt, writeAzureDeploymentFailureReceipt } = await import('./azure-deployment-failure-receipt.mjs');
const receipt = createAzureDeploymentFailureReceipt({
  boundary: 'workload-deployment',
  exitCode: 1,
  sourceCommit: 'a'.repeat(40),
  releaseVersion: '1.0.103',
  pipelineRunId: '30',
  checkedAt: '2026-09-06T00:00:00.000Z',
});
assert.equal(receipt.status, 'FAIL');
assert.equal(receipt.boundary, 'workload-deployment');
assert.equal(receipt.exitCode, 1);
assert.equal(receipt.diagnostics.rawErrorPersisted, false);
assert.doesNotMatch(JSON.stringify(receipt), /password|secret|token|authorization|bearer/iu);
assert.throws(() => createAzureDeploymentFailureReceipt({ boundary: 'workload-deployment', exitCode: 1, sourceCommit: 'not-a-commit' }), /source commit/i);
const handoffReceipt = createAzureDeploymentFailureReceipt({
  stage: 'ValidateHandoff',
  job: 'ValidateReleaseArtifact',
  boundary: 'release-artifact-handoff',
  exitCode: 1,
  sourceCommit: 'b'.repeat(40),
  pipelineRunId: '31',
});
assert.equal(handoffReceipt.stage, 'ValidateHandoff');
assert.equal(handoffReceipt.job, 'ValidateReleaseArtifact');
assert.equal(handoffReceipt.releaseVersion, 'unknown');
assert.equal(handoffReceipt.diagnostics.nextAction, 'Inspect the failed pipeline task stderr and the named boundary before retrying.');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-azure-deployment-failure-'));
try {
  const outputPath = path.join(temporaryDirectory, 'receipt.json');
  assert.equal(writeAzureDeploymentFailureReceipt(outputPath, { boundary: 'bootstrap', exitCode: 1 }), outputPath);
  assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
  assert.throws(() => writeAzureDeploymentFailureReceipt(outputPath, { boundary: 'bootstrap', exitCode: 1 }), /EEXIST|exists/i);
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log('azure-deployment-failure-receipt-test: PASS');
