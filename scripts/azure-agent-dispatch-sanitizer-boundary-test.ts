import assert from 'node:assert/strict';

import {
  type AgentDispatchRecord,
  type AgentDispatchStatePort,
  type AzureQueueClientPort,
  AzureAgentDispatchQueue,
} from '../src/server/azure-agent-dispatch-queue.js';
import type { AgentDispatchTaskReference } from '../src/server/queue/agent-dispatch-queue.js';

const safeIdentifiers = {
  taskId: 'task-safe-state-id',
  idempotencyKey: 'idem:task-safe-state-id',
  requestHash: 'sha256-safe-state-id',
  leaseOwner: 'worker-safe-state-id',
};
const unsafeDiagnostic = [
  '/opt/teamsapp/bin/codex exec --api-key supersecretvalue',
  '/tmp/private.log',
  '/var/lib/private',
  'password supersecretvalue',
  'secret supersecretvalue',
  'token supersecretvalue',
  'api_key=supersecretvalue',
  'Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
  'x'.repeat(12_000),
].join(' ');

const legacyRecord: AgentDispatchRecord = {
  ...safeIdentifiers,
  status: 'quarantined',
  task: {
    schemaVersion: 2,
    taskId: safeIdentifiers.taskId,
    idempotencyKey: safeIdentifiers.idempotencyKey,
    tenantId: 'tenant-safe-state-id',
    requesterId: 'requester-safe-state-id',
    conversationId: 'conversation-safe-state-id',
    provider: 'codex',
    prompt: 'safe prompt',
    createdAt: '2026-09-03T00:00:00.000Z',
    execution: {
      mode: 'workspace-write',
      workspaceReference: 'teams-core-worker-workspace',
    },
  },
  enqueued: true,
  dequeueCount: 1,
  updatedAt: '2026-09-03T00:00:00.000Z',
  leaseGeneration: 7,
  cancellationRequested: true,
  cancellationReason: unsafeDiagnostic,
  checkpoint: { sequence: 3, message: unsafeDiagnostic, recordedAt: '2026-09-03T00:00:00.000Z' },
  receipt: { result: unsafeDiagnostic, providerExecutionId: unsafeDiagnostic, completedAt: '2026-09-03T00:00:00.000Z' },
  error: { code: unsafeDiagnostic, message: unsafeDiagnostic, failedAt: '2026-09-03T00:00:00.000Z' },
  quarantineReason: unsafeDiagnostic,
};

const state: AgentDispatchStatePort = {
  async create() { return 'exists'; },
  async get(reference: AgentDispatchTaskReference) { return reference.taskId === safeIdentifiers.taskId ? structuredClone(legacyRecord) : undefined; },
  async compareAndSwap() { throw new Error('not used'); },
};
const client: AzureQueueClientPort = {
  async sendMessage() { throw new Error('not used'); },
  async receiveMessage() { return undefined; },
  async updateMessage() { throw new Error('not used'); },
  async deleteMessage() { throw new Error('not used'); },
  async sendPoisonMessage() { throw new Error('not used'); },
};

const observed = await new AzureAgentDispatchQueue(client, state).observe({
  taskId: safeIdentifiers.taskId,
  tenantId: legacyRecord.task.tenantId,
  requesterId: legacyRecord.task.requesterId,
  conversationId: legacyRecord.task.conversationId,
});
assert.ok(observed);

for (const unsafeFragment of [
  '/opt/teamsapp',
  '/tmp/private.log',
  '/var/lib/private',
  'supersecretvalue',
  'eyJhbGciOiJIUzI1NiJ9.payload.signature',
]) {
  assert.equal(JSON.stringify(observed).includes(unsafeFragment), false, `response redacts ${unsafeFragment}`);
}

assert.equal(observed.taskId, safeIdentifiers.taskId, 'safe task ID is not corrupted');
assert.equal(observed.idempotencyKey, safeIdentifiers.idempotencyKey, 'safe idempotency key is not corrupted');
assert.equal(observed.requestHash, safeIdentifiers.requestHash, 'safe request hash is not corrupted');
assert.equal(observed.leaseOwner, safeIdentifiers.leaseOwner, 'safe lease owner is not corrupted');
assert.equal(observed.task.tenantId, 'tenant-safe-state-id', 'safe scope IDs are not corrupted');

for (const [field, value, maximumBytes] of [
  ['checkpoint.message', observed.checkpoint?.message, 1_024],
  ['receipt.result', observed.receipt?.result, 4_096],
  ['receipt.providerExecutionId', observed.receipt?.providerExecutionId, 256],
  ['error.code', observed.error?.code, 128],
  ['error.message', observed.error?.message, 1_024],
  ['cancellationReason', observed.cancellationReason, 512],
  ['quarantineReason', observed.quarantineReason, 512],
] as const) {
  assert.ok(value, `${field} is present`);
  assert.ok(Buffer.byteLength(value, 'utf8') <= maximumBytes, `${field} is byte bounded`);
}

assert.deepEqual(legacyRecord.checkpoint?.message, unsafeDiagnostic, 'response projection does not mutate stored DTOs');
console.log('azure-agent-dispatch-sanitizer-boundary-test: PASS');
