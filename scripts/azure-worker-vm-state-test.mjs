import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveAzureWorkerVmState } from './azure-worker-vm-state.mjs';

const subscriptionId = '12345678-1234-4234-8234-123456789abc';
const expectedResourceId = `/subscriptions/${subscriptionId}/resourceGroups/rg-teamsapp-canary/providers/Microsoft.Compute/virtualMachines/teamsapp-worker-fixture`;

const absent = resolveAzureWorkerVmState([], expectedResourceId);
assert.deepEqual(absent, {
  schemaVersion: 1,
  kind: 'azure-worker-vm-state',
  expectedResourceId,
  observedResourceId: null,
  initializeWorkerVm: true,
});

const existing = resolveAzureWorkerVmState([{
  id: expectedResourceId.toUpperCase(),
  name: 'TEAMSAPP-WORKER-FIXTURE',
  type: 'microsoft.compute/virtualmachines',
}], expectedResourceId);
assert.equal(existing.initializeWorkerVm, false);
assert.equal(existing.observedResourceId, expectedResourceId.toUpperCase());

assert.throws(
  () => resolveAzureWorkerVmState([
    { id: expectedResourceId, name: 'teamsapp-worker-fixture', type: 'Microsoft.Compute/virtualMachines' },
    { id: expectedResourceId, name: 'teamsapp-worker-fixture', type: 'Microsoft.Compute/virtualMachines' },
  ], expectedResourceId),
  /exactly zero or one/i,
);
assert.throws(
  () => resolveAzureWorkerVmState([{
    id: expectedResourceId.replace('teamsapp-worker-fixture', 'unexpected-worker'),
    name: 'unexpected-worker',
    type: 'Microsoft.Compute/virtualMachines',
  }], expectedResourceId),
  /does not match/i,
);
assert.throws(
  () => resolveAzureWorkerVmState([{
    id: expectedResourceId,
    name: 'teamsapp-worker-fixture',
    type: 'Microsoft.Storage/storageAccounts',
  }], expectedResourceId),
  /resource type/i,
);
assert.throws(() => resolveAzureWorkerVmState({}, expectedResourceId), /array/i);
assert.throws(() => resolveAzureWorkerVmState([], '/not/an/azure/vm/id'), /resource ID/i);

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-azure-worker-vm-state-'));
try {
  const inventoryPath = path.join(temporaryDirectory, 'inventory.json');
  const outputPath = path.join(temporaryDirectory, 'state.json');
  fs.writeFileSync(inventoryPath, '[]\n', { mode: 0o600 });
  const args = [
    path.join(import.meta.dirname, 'azure-worker-vm-state.mjs'),
    '--inventory', inventoryPath,
    '--expected-resource-id', expectedResourceId,
    '--output', outputPath,
  ];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, 'utf8')), absent);
  assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);

  const overwrite = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.notEqual(overwrite.status, 0, 'VM state evidence must not overwrite an existing receipt');
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log('azure-worker-vm-state-test: PASS');
