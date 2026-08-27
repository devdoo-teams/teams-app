import assert from 'node:assert/strict';

import {
  A2A_CAPABILITIES,
  A2A_ROLE_CATALOG,
  A2A_ROLE_IDS,
} from '../src/server/a2a-role-catalog.js';
import {
  MAX_CHILD_PROMPT_LENGTH,
  MAX_NORMALIZED_PROMPT_LENGTH,
  createA2ACollaborationPlan,
  summarizeA2ACollaborationResults,
  type A2ACollaborationChildResult,
  type A2ACollaborationWorker,
} from '../src/server/a2a-collaboration-plan.js';

function capabilitiesFor(roleId: string): string[] {
  const role = A2A_ROLE_CATALOG.find((candidate) => candidate.id === roleId);
  assert.ok(role, `expected role ${roleId} in the Core catalog`);
  return [...role.capabilities];
}

const releaseCapabilities = capabilitiesFor('release-auditor');
const reviewCapabilities = capabilitiesFor('reviewer');

const workers: readonly A2ACollaborationWorker[] = [
  {
    agentId: 'codex-release-auditor',
    providerId: 'codex-cli',
    executionIdentity: 'codex-release-profile',
    executionBoundaryId: 'codex-release-boundary',
    roles: ['release-auditor'],
    capabilities: releaseCapabilities,
  },
  {
    agentId: 'codex-reviewer',
    providerId: 'codex-cli',
    executionIdentity: 'codex-review-profile',
    executionBoundaryId: 'codex-review-boundary',
    roles: ['reviewer'],
    capabilities: reviewCapabilities,
  },
];

const prompt = '조정된 Core 릴리스의 출처와 회귀 위험을 독립적으로 검토해줘';

const plan = createA2ACollaborationPlan({
  prompt,
  requestedRoles: ['reviewer', 'release-auditor'],
  workers,
});

assert.equal(plan.blockedReason, undefined);
assert.equal(plan.strategy, 'parallel-specialists');
assert.deepEqual(
  plan.requests.map((request) => request.role),
  ['release-auditor', 'reviewer'],
  'plans use the finite Core role IDs in deterministic order',
);
assert.equal(plan.requests.length, 2);
assert.equal(new Set(plan.requests.map((request) => request.key)).size, 2);
assert.equal(new Set(plan.requests.map((request) => request.childIdempotencyKey)).size, 2);
assert.ok(plan.requests.every((request) => request.prompt.includes(prompt)));
assert.ok(plan.requests.every((request) => request.prompt.length <= MAX_CHILD_PROMPT_LENGTH));
assert.ok(plan.requests.every((request) => request.executionIdentity));
assert.ok(plan.requests.every((request) => request.executionBoundaryId));
assert.ok(plan.requests.every((request) => request.capabilities.every((capability) => (
  (A2A_CAPABILITIES as readonly string[]).includes(capability)
))));

const reorderedPlan = createA2ACollaborationPlan({
  prompt: `  ${prompt.replaceAll(' ', '\n')}  `,
  requestedRoles: ['release-auditor', 'reviewer'],
  workers: workers
    .map((worker) => ({
      ...worker,
      roles: [...worker.roles].reverse(),
      capabilities: [...worker.capabilities].reverse(),
    }))
    .reverse(),
});
assert.equal(reorderedPlan.planFingerprint, plan.planFingerprint);
assert.deepEqual(reorderedPlan.requests, plan.requests);

const boundedPromptPlan = createA2ACollaborationPlan({
  prompt: `${'x'.repeat(MAX_NORMALIZED_PROMPT_LENGTH - 20)} trailing text`,
  requestedRoles: ['reviewer'],
  workers: [workers[1]],
});
assert.equal(boundedPromptPlan.blockedReason, undefined);
assert.ok(boundedPromptPlan.requests[0]?.prompt.length <= MAX_CHILD_PROMPT_LENGTH);
assert.ok(!boundedPromptPlan.requests[0]?.prompt.includes('trailing text'));

const overLimit = createA2ACollaborationPlan({
  prompt: 'x'.repeat(MAX_NORMALIZED_PROMPT_LENGTH + 1),
  requestedRoles: ['reviewer'],
  workers: [workers[1]],
});
assert.equal(overLimit.strategy, 'blocked');
assert.equal(overLimit.requests.length, 0);
assert.match(overLimit.blockedReason ?? '', /exceeds/i);

const unknownRole = createA2ACollaborationPlan({
  prompt,
  requestedRoles: ['researcher'],
  workers,
});
assert.equal(unknownRole.requests.length, 0);
assert.match(unknownRole.blockedReason ?? '', /role|catalog|unsupported/i);

const unknownCapability = createA2ACollaborationPlan({
  prompt,
  requestedRoles: ['reviewer'],
  workers: [{
    ...workers[1],
    capabilities: [...workers[1].capabilities, 'not-a-core-capability'],
  }],
});
assert.equal(unknownCapability.requests.length, 0);
assert.match(unknownCapability.blockedReason ?? '', /capabilit|unknown/i);

const capabilityOutsideRole = createA2ACollaborationPlan({
  prompt,
  requestedRoles: ['reviewer'],
  workers: [{
    ...workers[1],
    capabilities: [...workers[1].capabilities, 'tests.run'],
  }],
});
assert.equal(capabilityOutsideRole.requests.length, 0);
assert.match(capabilityOutsideRole.blockedReason ?? '', /role|capabilit|allow/i);

const missingBoundary = createA2ACollaborationPlan({
  prompt,
  requestedRoles: ['reviewer'],
  workers: [{ ...workers[1], executionBoundaryId: '' }],
});
assert.equal(missingBoundary.requests.length, 0);
assert.match(missingBoundary.blockedReason ?? '', /boundary/i);

const sharedIdentity = createA2ACollaborationPlan({
  prompt,
  requestedRoles: ['release-auditor', 'reviewer'],
  workers: workers.map((worker) => ({ ...worker, executionIdentity: 'shared-profile' })),
});
assert.equal(sharedIdentity.requests.length, 0);
assert.match(sharedIdentity.blockedReason ?? '', /executionIdentity|independent|distinct/i);

const sharedBoundary = createA2ACollaborationPlan({
  prompt,
  requestedRoles: ['release-auditor', 'reviewer'],
  workers: workers.map((worker) => ({ ...worker, executionBoundaryId: 'shared-boundary' })),
});
assert.equal(sharedBoundary.requests.length, 0);
assert.match(sharedBoundary.blockedReason ?? '', /boundary|independent|distinct/i);

const oneWorkerForTwoRoles = createA2ACollaborationPlan({
  prompt,
  requestedRoles: ['release-auditor', 'reviewer'],
  workers: [{
    agentId: 'one-worker',
    providerId: 'codex-cli',
    executionIdentity: 'one-profile',
    executionBoundaryId: 'one-boundary',
    roles: ['release-auditor', 'reviewer'],
    capabilities: [...new Set([...releaseCapabilities, ...reviewCapabilities])],
  }],
});
assert.equal(oneWorkerForTwoRoles.requests.length, 0);
assert.match(oneWorkerForTwoRoles.blockedReason ?? '', /two|independent|reuse|worker/i);

const flexibleWorkerAssignment = createA2ACollaborationPlan({
  prompt: '역할에 맞는 격리된 실행자를 배정해줘',
  requestedRoles: ['reviewer', 'release-auditor'],
  workers: [
    {
      agentId: 'flexible-worker',
      providerId: 'codex-cli',
      executionIdentity: 'flexible-profile',
      executionBoundaryId: 'flexible-boundary',
      roles: ['reviewer', 'release-auditor'],
      capabilities: [...new Set([...releaseCapabilities, ...reviewCapabilities])],
    },
    {
      agentId: 'release-only-worker',
      providerId: 'codex-cli',
      executionIdentity: 'release-only-profile',
      executionBoundaryId: 'release-only-boundary',
      roles: ['release-auditor'],
      capabilities: releaseCapabilities,
    },
  ],
});
assert.equal(flexibleWorkerAssignment.blockedReason, undefined);
assert.deepEqual(
  flexibleWorkerAssignment.requests.map((request) => [request.role, request.agentId]),
  [
    ['release-auditor', 'release-only-worker'],
    ['reviewer', 'flexible-worker'],
  ],
);

const completedAndFailed: readonly A2ACollaborationChildResult[] = [
  {
    key: 'review',
    role: 'reviewer',
    agentId: 'codex-reviewer',
    providerId: 'codex-cli',
    executionIdentity: 'codex-review-profile',
    executionBoundaryId: 'codex-review-boundary',
    status: 'completed',
    result: '검토 완료. Authorization: Bearer super-secret-value 는 보이면 안 된다.',
  },
  {
    key: 'audit',
    role: 'release-auditor',
    agentId: 'codex-release-auditor',
    providerId: 'codex-cli',
    executionIdentity: 'codex-release-profile',
    executionBoundaryId: 'codex-release-boundary',
    status: 'failed',
    error: 'release audit failed: token=secret-value',
  },
];
const summary = summarizeA2ACollaborationResults(completedAndFailed);
const reversedSummary = summarizeA2ACollaborationResults([...completedAndFailed].reverse());
assert.equal(summary.status, 'partial');
assert.equal(summary.completed, 1);
assert.equal(summary.failed, 1);
assert.equal(summary.canceled, 0);
assert.deepEqual(summary, reversedSummary);
assert.ok(summary.text.includes('release-auditor'));
assert.ok(summary.text.includes('[REDACTED]'));
assert.ok(!summary.text.includes('super-secret-value'));
assert.ok(!summary.text.includes('secret-value'));
assert.ok(summary.text.length <= 6_000);

const workingSummary = summarizeA2ACollaborationResults([{
  key: 'working',
  role: 'test-runner',
  agentId: 'codex-test-runner',
  providerId: 'codex-cli',
  executionIdentity: 'codex-test-profile',
  executionBoundaryId: 'codex-test-boundary',
  status: 'working',
}]);
assert.equal(workingSummary.status, 'working');

console.log('a2a-collaboration-plan-test: PASS');
