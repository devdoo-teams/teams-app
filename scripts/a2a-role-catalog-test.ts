import assert from 'node:assert/strict';

import { A2AContractError } from '../src/server/a2a-contract.js';
import {
  A2A_ROLE_CATALOG,
  A2A_ROLE_IDS,
  createA2ADispatchPlan,
  getA2ARoleDefinition,
  serializeA2ADispatchPlan,
} from '../src/server/a2a-role-catalog.js';

function throwsNamed(fn: () => unknown, name: string): A2AContractError {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof A2AContractError, `expected ${name}`);
  assert.equal(thrown.name, name);
  return thrown;
}

assert.deepEqual(A2A_ROLE_IDS, ['provider-adapter', 'release-auditor', 'reviewer', 'test-runner']);
assert.deepEqual(
  A2A_ROLE_CATALOG.map((role) => role.id),
  [...A2A_ROLE_IDS].sort(),
);

const reviewer = getA2ARoleDefinition('reviewer');
assert.equal(reviewer.id, 'reviewer');
assert.equal(reviewer.mode, 'read-only');
assert.ok(reviewer.capabilities.length > 0);
assert.deepEqual([...reviewer.capabilities], [...reviewer.capabilities].sort());

throwsNamed(() => getA2ARoleDefinition('unknown-role'), 'InvalidRequestError');

throwsNamed(
  () => createA2ADispatchPlan({
    roleId: 'reviewer',
    requestedCapabilities: ['unknown.capability'],
  }),
  'InvalidRequestError',
);
throwsNamed(
  () => createA2ADispatchPlan({
    roleId: 'reviewer',
    requestedCapabilities: ['provider.adapter.write'],
  }),
  'UnsupportedOperationError',
);

const firstPlan = createA2ADispatchPlan({
  roleId: 'reviewer',
  requestedCapabilities: ['review.report', 'source.read'],
  parentTaskId: 'parent-task',
  childKey: 'review-child',
  prompt: 'Review the bounded Teams Core changes.',
});
const secondPlan = createA2ADispatchPlan({
  childKey: 'review-child',
  prompt: 'Review the bounded Teams Core changes.',
  requestedCapabilities: ['source.read', 'review.report'],
  parentTaskId: 'parent-task',
  roleId: 'reviewer',
});
assert.deepEqual(firstPlan, secondPlan);
assert.equal(serializeA2ADispatchPlan(firstPlan), serializeA2ADispatchPlan(secondPlan));
assert.deepEqual(firstPlan.capabilities, ['review.report', 'source.read']);

const secretPrompt = 'Authorization: Bearer bearer-one token=token-one password=password-one';
const safePlan = createA2ADispatchPlan({
  roleId: 'reviewer',
  requestedCapabilities: ['source.read'],
  prompt: secretPrompt,
});
const serializedPlan = serializeA2ADispatchPlan(safePlan);
assert.equal(JSON.stringify(safePlan).includes(secretPrompt), false);
assert.equal(serializedPlan.includes('bearer-one'), false);
assert.equal(serializedPlan.includes('token-one'), false);
assert.equal(serializedPlan.includes('password-one'), false);
assert.match(serializedPlan, /"promptSha256":"[a-f0-9]{64}"/);

const secondSecretPlan = createA2ADispatchPlan({
  roleId: 'reviewer',
  requestedCapabilities: ['source.read'],
  prompt: 'Authorization: Bearer bearer-two token=token-two password=password-two',
});
assert.equal(safePlan.promptSha256, secondSecretPlan.promptSha256);

console.log('a2a-role-catalog-test: PASS');
