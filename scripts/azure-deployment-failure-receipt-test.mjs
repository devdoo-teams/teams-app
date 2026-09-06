import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const pipeline = fs.readFileSync(path.join(repositoryRoot, 'azure-pipelines.yml'), 'utf8');

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
