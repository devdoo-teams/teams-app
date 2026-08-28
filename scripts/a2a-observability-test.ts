import assert from 'node:assert/strict';

import type { AgentJobScope } from '../src/server/agent-job-store.js';
import { createCoreA2AOrchestrator } from '../src/server/a2a-orchestrator.js';
import {
  A2A_DISPATCH_AUDIT_SCHEMA_VERSION,
  MAX_A2A_AUDIT_ENTRIES,
  createA2ADispatchAudit,
  serializeA2ADispatchAudit,
} from '../src/server/a2a-observability.js';

const scope: AgentJobScope = {
  tenantId: 'tenant-a',
  requesterId: 'requester-a',
  conversationId: 'conversation-a',
};

function auditChild(index: number, status: 'completed' | 'failed' | 'canceled' = 'completed') {
  return {
    childKey: `child-${index}`,
    childIdempotencyKey: `child-idempotency-${index}`,
    agentId: 'teams-core',
    providerId: 'core-default',
    role: index % 2 === 0 ? 'reviewer' : 'test-runner',
    requestSha256: `${String(index).repeat(64)}`.slice(0, 64),
    status,
    duplicated: index === 1,
  } as const;
}

function testAuditBounds(): void {
  const audit = createA2ADispatchAudit({
    parentTaskId: 'parent-task',
    children: Array.from({ length: MAX_A2A_AUDIT_ENTRIES + 4 }, (_, index) => auditChild(index)),
  });

  assert.equal(audit.totalChildren, MAX_A2A_AUDIT_ENTRIES + 4);
  assert.equal(audit.entries.length, MAX_A2A_AUDIT_ENTRIES);
  assert.equal(audit.omittedChildren, 4);
  assert.equal(audit.uniqueChildren, MAX_A2A_AUDIT_ENTRIES + 3);
  assert.equal(audit.duplicateChildren, 1);
  assert.equal(audit.statusCounts.find((entry) => entry.status === 'completed')?.count, MAX_A2A_AUDIT_ENTRIES + 4);
  assert.ok(Object.isFrozen(audit));
  assert.ok(Object.isFrozen(audit.entries));
}

function testDeterministicSerialization(): void {
  const first = createA2ADispatchAudit({
    parentTaskId: 'parent-task',
    children: [auditChild(0), auditChild(1, 'failed')],
  });
  const second = createA2ADispatchAudit({
    children: [auditChild(0), auditChild(1, 'failed')],
    parentTaskId: 'parent-task',
  });

  assert.equal(serializeA2ADispatchAudit(first), serializeA2ADispatchAudit(second));
  assert.match(serializeA2ADispatchAudit(first), new RegExp(`"schemaVersion":"${A2A_DISPATCH_AUDIT_SCHEMA_VERSION}"`));
}

function testRoleCounterCanonicalization(): void {
  const audit = createA2ADispatchAudit({
    parentTaskId: 'parent-task',
    children: [auditChild(0), auditChild(1, 'failed')],
  });
  const reordered = {
    ...audit,
    roleCounts: [...audit.roleCounts].reverse(),
  };

  const canonical = JSON.parse(serializeA2ADispatchAudit(reordered)) as typeof audit;
  assert.deepEqual(canonical.roleCounts, audit.roleCounts);

  const duplicateRoleCounters = {
    ...createA2ADispatchAudit({
      parentTaskId: 'parent-task-duplicate-counter',
      children: [auditChild(0), auditChild(2)],
    }),
    roleCounts: [
      { role: 'reviewer', count: 1 },
      { role: 'reviewer', count: 1 },
    ],
  };
  assert.throws(
    () => serializeA2ADispatchAudit(duplicateRoleCounters),
    /duplicate|role counter/i,
  );
}

async function testFailureAuditIsBoundedAndRedacted(): Promise<void> {
  const secret = 'Authorization: Bearer observability-secret client_secret=another-secret';
  const orchestrator = createCoreA2AOrchestrator();
  const result = await orchestrator.run({
    scope,
    parentTaskId: 'parent-failure-audit',
    requests: [
      { key: 'review', role: 'reviewer', capabilities: ['source.read'], prompt: 'Review the change.' },
      { key: 'tests', role: 'test-runner', capabilities: ['tests.run'], prompt: 'Run the tests.' },
      { key: 'release', role: 'release-auditor', capabilities: ['release.audit'], prompt: 'Audit the release.' },
    ],
    deadlineMs: 1_000,
    parallelism: 2,
    executeChild: async ({ childKey }) => {
      if (childKey === 'review') {
        return { taskId: 'task-review', status: 'failed', error: secret };
      }
      if (childKey === 'tests') {
        return { taskId: 'task-tests', status: 'canceled', error: secret };
      }
      return { taskId: 'task-release', status: 'completed', result: 'release evidence recorded' };
    },
  });

  assert.equal(result.audit.totalChildren, 3);
  assert.equal(result.audit.uniqueChildren, 3);
  assert.deepEqual(
    result.audit.statusCounts,
    [
      { status: 'completed', count: 1 },
      { status: 'failed', count: 1 },
      { status: 'canceled', count: 1 },
    ],
  );
  assert.deepEqual(
    result.audit.roleCounts,
    [
      { role: 'release-auditor', count: 1 },
      { role: 'reviewer', count: 1 },
      { role: 'test-runner', count: 1 },
    ],
  );
  const serialized = serializeA2ADispatchAudit(result.audit);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes('observability-secret'), false);
  assert.equal(serialized.includes('another-secret'), false);
  assert.equal('prompt' in result.audit, false);
  assert.equal('error' in result.audit, false);
}

function testSerializerRejectsUnboundedOrRawFields(): void {
  const audit = createA2ADispatchAudit({ parentTaskId: 'parent-task', children: [auditChild(0)] });
  assert.throws(() => serializeA2ADispatchAudit({ ...audit, prompt: 'should not be accepted' }), /unsupported field/i);
  assert.throws(() => serializeA2ADispatchAudit({
    ...audit,
    entries: Array.from({ length: MAX_A2A_AUDIT_ENTRIES + 1 }, (_, index) => auditChild(index)),
  }), /bounded|maximum|entries/i);
}

testAuditBounds();
testDeterministicSerialization();
testRoleCounterCanonicalization();
testSerializerRejectsUnboundedOrRawFields();
await testFailureAuditIsBoundedAndRedacted();

console.log('a2a-observability-test: PASS');
