import assert from 'node:assert/strict';

import {
  latestDurableWorkerHeartbeat,
  type AgentDispatchRecord,
} from '../src/server/azure-agent-dispatch-queue.js';

function record(input: {
  taskId: string;
  status: AgentDispatchRecord['status'];
  checkpoint?: AgentDispatchRecord['checkpoint'];
}): AgentDispatchRecord {
  return {
    taskId: input.taskId,
    idempotencyKey: `idem:${input.taskId}`,
    requestHash: `hash:${input.taskId}`,
    status: input.status,
    task: {
      schemaVersion: 2,
      taskId: input.taskId,
      idempotencyKey: `idem:${input.taskId}`,
      tenantId: 'tenant-a',
      requesterId: 'user-a',
      conversationId: 'conversation-a',
      provider: 'codex',
      prompt: 'bounded work',
      createdAt: '2026-09-02T23:00:00.000Z',
      execution: {
        mode: 'workspace-write',
        workspaceReference: 'teams-core-worker-workspace',
      },
    },
    enqueued: true,
    dequeueCount: 1,
    leaseGeneration: 1,
    updatedAt: input.checkpoint?.recordedAt ?? '2026-09-02T23:00:00.000Z',
    ...(input.checkpoint ? { checkpoint: input.checkpoint } : {}),
  };
}

const observed = latestDurableWorkerHeartbeat([
  record({
    taskId: 'task-provider-event',
    status: 'leased',
    checkpoint: { sequence: 2, message: 'agent_message', recordedAt: '2026-09-02T23:59:59.000Z' },
  }),
  record({
    taskId: 'task-heartbeat-old',
    status: 'completed',
    checkpoint: { sequence: 3, message: 'worker heartbeat', recordedAt: '2026-09-02T23:58:00.000Z' },
  }),
  record({
    taskId: 'task-heartbeat-new',
    status: 'leased',
    checkpoint: { sequence: 4, message: 'worker heartbeat', recordedAt: '2026-09-02T23:59:45.000Z' },
  }),
]);

assert.deepEqual(observed, {
  observedAt: '2026-09-02T23:59:45.000Z',
  source: 'durable-dispatch-lease-renewal',
});
assert.equal(
  latestDurableWorkerHeartbeat([
    record({
      taskId: 'task-not-heartbeat',
      status: 'leased',
      checkpoint: { sequence: 1, message: 'tool event', recordedAt: '2026-09-02T23:59:59.000Z' },
    }),
  ]),
  undefined,
  'arbitrary task checkpoints are not worker readiness evidence',
);
assert.equal(latestDurableWorkerHeartbeat([]), undefined, 'configuration without observations has no heartbeat');

console.log('azure-dispatch-heartbeat-observation-test: PASS');
