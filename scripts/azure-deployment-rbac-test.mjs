import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  REQUIRED_AZURE_DEPLOYMENT_ACTIONS,
  validateAzureDeploymentPermissions,
} from './azure-deployment-rbac.mjs';

const bothActions = {
  value: [{
    actions: ['Microsoft.Authorization/*'],
    notActions: [],
    dataActions: [],
    notDataActions: [],
  }],
};

const ready = validateAzureDeploymentPermissions(bothActions);
assert.equal(ready.status, 'READY');
assert.deepEqual(ready.requiredActions, [...REQUIRED_AZURE_DEPLOYMENT_ACTIONS]);
assert.deepEqual(ready.missingActions, []);
assert.equal(ready.permissionSetCount, 1);

const splitGrants = validateAzureDeploymentPermissions({
  value: [
    { actions: ['microsoft.authorization/roleassignments/write'], notActions: [] },
    { actions: ['MICROSOFT.AUTHORIZATION/ROLEDEFINITIONS/WRITE'], notActions: [] },
  ],
});
assert.equal(splitGrants.status, 'READY', 'effective permission union must be case-insensitive');

assert.throws(
  () => validateAzureDeploymentPermissions({
    value: [{
      actions: ['*'],
      notActions: ['Microsoft.Authorization/roleDefinitions/write'],
    }],
  }),
  /roleDefinitions\/write/,
  'an explicit notActions exclusion must override a wildcard grant in the same permission set',
);

assert.throws(
  () => validateAzureDeploymentPermissions({
    value: [{ actions: ['Microsoft.Authorization/roleAssignments/write'], notActions: [] }],
  }),
  /roleDefinitions\/write/,
  'both custom-role definition and role-assignment writes are required',
);

assert.throws(() => validateAzureDeploymentPermissions({ value: [] }), /permission.*empty/i);
assert.throws(() => validateAzureDeploymentPermissions({ value: [{}] }), /actions.*array/i);
assert.throws(
  () => validateAzureDeploymentPermissions({ ...bothActions, nextLink: 'https://management.azure.com/next' }),
  /nextLink|paginated/i,
  'an incomplete caller-permissions response must fail closed',
);

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'teamsapp-azure-rbac-'));
try {
  const inputPath = path.join(fixture, 'permissions.json');
  const receiptPath = path.join(fixture, 'receipt.json');
  fs.writeFileSync(inputPath, JSON.stringify(bothActions));
  const success = spawnSync(process.execPath, ['scripts/azure-deployment-rbac.mjs', inputPath, receiptPath], {
    cwd: path.resolve(import.meta.dirname, '..'),
    encoding: 'utf8',
  });
  assert.equal(success.status, 0, success.stderr || success.stdout);
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  assert.equal(receipt.status, 'READY');
  assert.deepEqual(receipt.missingActions, []);
  assert.equal(JSON.stringify(receipt).includes('token'), false, 'receipt must contain no credential material');

  fs.writeFileSync(inputPath, JSON.stringify({
    value: [{ actions: ['Microsoft.Authorization/roleAssignments/write'], notActions: [] }],
  }));
  const blocked = spawnSync(process.execPath, ['scripts/azure-deployment-rbac.mjs', inputPath, receiptPath], {
    cwd: path.resolve(import.meta.dirname, '..'),
    encoding: 'utf8',
  });
  assert.notEqual(blocked.status, 0);
  const blockedReceipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  assert.equal(blockedReceipt.status, 'BLOCKED');
  assert.deepEqual(blockedReceipt.missingActions, ['Microsoft.Authorization/roleDefinitions/write']);
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

console.log('PASS: Azure deployment RBAC preflight validates caller-effective permissions and retains a safe receipt.');
