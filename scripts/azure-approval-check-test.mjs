import assert from 'node:assert/strict';
import { validateApprovalConfiguration } from './azure-approval-check.mjs';

const context = { environmentId: '17', environmentName: 'teamsapp-canary', project: 'TeamsApp' };
const valid = {
  count: 1,
  value: [{
    id: 81,
    isDisabled: false,
    type: { id: '8c6f20a7-a545-4486-9777-f762fafe0d4d', name: 'Approval' },
    resource: { type: 'environment', id: '17', name: 'teamsapp-canary' },
    settings: {
      approvers: [{ id: '11111111-2222-4333-8444-555555555555' }],
      executionOrder: 'anyOrder',
      minRequiredApprovers: 1,
    },
  }],
};

const receipt = validateApprovalConfiguration(valid, context);
assert.equal(receipt.approvalConfigured, true);
assert.equal(receipt.checkId, 81);
assert.equal(receipt.environmentId, '17');
assert.equal(receipt.approverCount, 1);

assert.throws(() => validateApprovalConfiguration({ count: 0, value: [] }, context), /approval check/i);
assert.throws(() => validateApprovalConfiguration({ ...valid, value: [{ ...valid.value[0], isDisabled: true }] }, context), /approval check/i);
assert.throws(() => validateApprovalConfiguration({ ...valid, value: [{ ...valid.value[0], settings: { approvers: [] } }] }, context), /approver/i);
assert.throws(
  () => validateApprovalConfiguration({ ...valid, value: [{ ...valid.value[0], resource: { type: 'environment', id: '99', name: 'other' } }] }, context),
  /approval check/i,
);

console.log('PASS: Azure DevOps approval preflight fails closed unless the exact environment has an enabled operator approval check.');
