import assert from 'node:assert/strict';

import {
  type AgentDispatchRecord,
  type AgentDispatchStatePort,
  type AzureQueueClientPort,
  AzureAgentDispatchQueue,
} from '../src/server/azure-agent-dispatch-queue.js';

const now = '2026-09-03T00:00:00.000Z';
const taskId = 'task-adversarial-diagnostics';
const unsafeValues = [
  'OPENAI_API_KEY=ExactOpenAiEnvSecret123',
  'AZURE_CLIENT_SECRET=ExactAzureEnvSecret123',
  'GITHUB_TOKEN=ExactGithubEnvSecret123',
  '/run/secrets/app-token',
  '~/.ssh/id_rsa',
  String.raw`\\server\share\private.txt`,
  String.raw`C:\Program Files\Private App\secret.txt`,
  '/usr/local/bin/private-tool',
  '/mnt/private-volume/result.json',
  '/dev/shm/private-token',
] as const;
const unsafeDiagnostic = `${unsafeValues.join(' | ')} | ${'한'.repeat(5_000)}`;

const dispatchTask = {
  schemaVersion: 1 as const,
  taskId,
  idempotencyKey: `idem:${taskId}`,
  tenantId: 'tenant-safe-id',
  requesterId: 'requester-safe-id',
  conversationId: 'conversation-safe-id',
  provider: 'codex',
  prompt: 'safe prompt',
  createdAt: now,
};

class MemoryState implements AgentDispatchStatePort {
  readonly records = new Map<string, AgentDispatchRecord>();

  async create(record: AgentDispatchRecord): Promise<'created' | 'exists'> {
    if (this.records.has(record.taskId)) return 'exists';
    this.records.set(record.taskId, structuredClone(record));
    return 'created';
  }

  async get(id: string): Promise<AgentDispatchRecord | undefined> {
    const record = this.records.get(id);
    return record && structuredClone(record);
  }

  async compareAndSwap(
    id: string,
    expected: { leaseOwner?: string; leaseGeneration: number },
    mutate: (current: AgentDispatchRecord) => AgentDispatchRecord,
  ): Promise<AgentDispatchRecord | undefined> {
    const current = this.records.get(id);
    if (!current || current.leaseOwner !== expected.leaseOwner || current.leaseGeneration !== expected.leaseGeneration) {
      return undefined;
    }
    const next = mutate(structuredClone(current));
    this.records.set(id, structuredClone(next));
    return structuredClone(next);
  }
}

class MemoryQueue implements AzureQueueClientPort {
  private message: { messageId: string; popReceipt: string; messageText: string; dequeueCount: number } | undefined;

  async sendMessage(messageText: string) {
    this.message = { messageId: 'message-1', popReceipt: 'receipt-0', messageText, dequeueCount: 0 };
    return { messageId: 'message-1' };
  }

  async receiveMessage() {
    if (!this.message) return undefined;
    this.message.dequeueCount += 1;
    this.message.popReceipt = `receipt-${this.message.dequeueCount}`;
    return { ...this.message };
  }

  async updateMessage(_messageId: string, popReceipt: string) {
    return { popReceipt: `${popReceipt}-renewed` };
  }

  async deleteMessage() { this.message = undefined; }
  async sendPoisonMessage() {}
}

function assertNoUnsafeFragments(value: unknown, boundary: string): void {
  const serialized = JSON.stringify(value);
  for (const unsafe of unsafeValues) {
    assert.equal(serialized.includes(unsafe), false, `${boundary} must redact ${unsafe}`);
  }
  for (const fragment of [
    'ExactOpenAiEnvSecret123',
    'ExactAzureEnvSecret123',
    'ExactGithubEnvSecret123',
    'app-token',
    'id_rsa',
    'private.txt',
    'Private App',
    'private-tool',
    'private-volume',
    'private-token',
  ]) {
    assert.equal(serialized.includes(fragment), false, `${boundary} must not retain sensitive fragment ${fragment}`);
  }
}

function assertSafeIdentity(record: AgentDispatchRecord, boundary: string): void {
  assert.equal(record.taskId, taskId, `${boundary} preserves task ID`);
  assert.equal(record.idempotencyKey, `idem:${taskId}`, `${boundary} preserves idempotency key`);
  assert.equal(record.task.tenantId, 'tenant-safe-id', `${boundary} preserves tenant scope`);
  assert.equal(record.task.requesterId, 'requester-safe-id', `${boundary} preserves requester scope`);
  assert.equal(record.task.conversationId, 'conversation-safe-id', `${boundary} preserves conversation scope`);
  assert.ok(record.requestHash, `${boundary} preserves request hash`);
  assert.ok(record.leaseOwner, `${boundary} preserves lease owner`);
  assert.equal(record.leaseGeneration, 1, `${boundary} preserves lease generation`);
}

const state = new MemoryState();
const queueClient = new MemoryQueue();
const queue = new AzureAgentDispatchQueue(queueClient, state, { clock: { now: () => new Date(now) } });

await queue.enqueue(dispatchTask);
let lease = await queue.lease({ visibilityTimeoutSeconds: 30 });
assert.ok(lease);
lease = await queue.heartbeat(lease, { sequence: 1, message: unsafeDiagnostic }, 30);
await queue.complete(lease, { result: unsafeDiagnostic, providerExecutionId: unsafeDiagnostic });

const persisted = state.records.get(taskId);
assert.ok(persisted);
assertNoUnsafeFragments(persisted, 'persistence boundary');
assertSafeIdentity(persisted, 'persistence boundary');
assert.ok(Buffer.byteLength(persisted.checkpoint?.message ?? '', 'utf8') <= 1_024);
assert.ok(Buffer.byteLength(persisted.receipt?.result ?? '', 'utf8') <= 4_096);
assert.ok(Buffer.byteLength(persisted.receipt?.providerExecutionId ?? '', 'utf8') <= 256);

const failedTask = { ...dispatchTask, taskId: 'task-adversarial-failure', idempotencyKey: 'idem:task-adversarial-failure' };
await queue.enqueue(failedTask);
const failedLease = await queue.lease({ visibilityTimeoutSeconds: 30 });
assert.ok(failedLease);
await queue.fail(failedLease, { code: unsafeDiagnostic, message: unsafeDiagnostic });
const persistedFailure = state.records.get(failedTask.taskId);
assert.ok(persistedFailure);
assertNoUnsafeFragments(persistedFailure, 'failure persistence boundary');

const cancelledTask = { ...dispatchTask, taskId: 'task-adversarial-cancellation', idempotencyKey: 'idem:task-adversarial-cancellation' };
await queue.enqueue(cancelledTask);
await queue.requestCancellation(cancelledTask.taskId, unsafeDiagnostic);
const persistedCancellation = state.records.get(cancelledTask.taskId);
assert.ok(persistedCancellation);
assertNoUnsafeFragments(persistedCancellation, 'cancellation persistence boundary');

const legacy = structuredClone(persisted);
legacy.status = 'quarantined';
legacy.checkpoint = { sequence: 2, message: unsafeDiagnostic, recordedAt: now };
legacy.receipt = { result: unsafeDiagnostic, providerExecutionId: unsafeDiagnostic, completedAt: now };
legacy.error = { code: unsafeDiagnostic, message: unsafeDiagnostic, failedAt: now };
legacy.cancellationReason = unsafeDiagnostic;
legacy.quarantineReason = unsafeDiagnostic;
const legacyWithExtras = legacy as AgentDispatchRecord & {
  diagnosticDump?: string;
  checkpoint?: AgentDispatchRecord['checkpoint'] & { rawSecret?: string };
};
legacyWithExtras.diagnosticDump = 'ExactUnknownDiagnosticSecret123';
if (legacyWithExtras.checkpoint) legacyWithExtras.checkpoint.rawSecret = 'ExactNestedDiagnosticSecret123';
state.records.set(taskId, legacy);

const observed = await queue.observe(taskId);
assert.ok(observed);
assertNoUnsafeFragments(observed, 'old-record response boundary');
assert.equal(JSON.stringify(observed).includes('ExactUnknownDiagnosticSecret123'), false, 'response allowlist drops unknown top-level diagnostics');
assert.equal(JSON.stringify(observed).includes('ExactNestedDiagnosticSecret123'), false, 'response allowlist drops unknown nested diagnostics');
assertSafeIdentity(observed, 'old-record response boundary');
assert.deepEqual(legacy.checkpoint.message, unsafeDiagnostic, 'response projection must not mutate the stored legacy DTO');
assert.ok(Buffer.byteLength(observed.checkpoint?.message ?? '', 'utf8') <= 1_024);
assert.ok(Buffer.byteLength(observed.receipt?.result ?? '', 'utf8') <= 4_096);
assert.ok(Buffer.byteLength(observed.receipt?.providerExecutionId ?? '', 'utf8') <= 256);
assert.ok(Buffer.byteLength(observed.error?.code ?? '', 'utf8') <= 128);
assert.ok(Buffer.byteLength(observed.error?.message ?? '', 'utf8') <= 1_024);
assert.ok(Buffer.byteLength(observed.cancellationReason ?? '', 'utf8') <= 512);
assert.ok(Buffer.byteLength(observed.quarantineReason ?? '', 'utf8') <= 512);

console.log('azure-agent-dispatch-sanitizer-adversarial-test: PASS');
