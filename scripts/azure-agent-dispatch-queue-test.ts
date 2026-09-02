import assert from 'node:assert/strict';

import {
  createProductionAzureQueueClient,
  DispatchConflictError,
  type AgentDispatchRecord,
  type AgentDispatchStatePort,
  type AzureQueueClientPort,
  AzureAgentDispatchQueue,
} from '../src/server/azure-agent-dispatch-queue.js';
import { AzureAgentDispatchQueue as LegacyPathAzureAgentDispatchQueue } from '../src/server/queue/azure-agent-dispatch-queue.js';
import { createAgentDispatchSubmissionPort } from '../src/server/queue/agent-dispatch-queue.js';

const clock = { now: () => new Date('2026-09-03T00:00:00.000Z') };

assert.equal(
  LegacyPathAzureAgentDispatchQueue,
  AzureAgentDispatchQueue,
  'the legacy queue module path re-exports the authoritative lease-generation implementation',
);

async function testEnqueueIsStableAndIdempotent(): Promise<void> {
  const fixture = createFixture();
  const input = task('task-stable');
  const first = await fixture.queue.enqueue(input);
  const submission = createAgentDispatchSubmissionPort(fixture.queue);
  assert.deepEqual(Object.keys(submission).sort(), ['enqueue', 'observe', 'requestCancellation']);
  const duplicate = await fixture.queue.enqueue({ ...input });
  assert.equal(first.taskId, 'task-stable');
  assert.deepEqual(duplicate, first);
  assert.equal(fixture.client.sent.length, 1, 'duplicate delivery must not enqueue twice');
  await assert.rejects(
    fixture.queue.enqueue({ ...input, prompt: 'different' }),
    DispatchConflictError,
  );
}

async function testLeaseRenewCompleteErrorCancelAndRecovery(): Promise<void> {
  const fixture = createFixture();
  await fixture.queue.enqueue(task('task-lifecycle'));
  const lease = await fixture.queue.lease({ visibilityTimeoutSeconds: 30 });
  assert.equal(lease?.task.taskId, 'task-lifecycle');
  assert.equal(lease?.dequeueCount, 1);
  const renewed = await fixture.queue.heartbeat(lease!, { sequence: 1, message: 'working' }, 45);
  assert.notEqual(renewed.popReceipt, lease?.popReceipt, 'renewal rotates the Azure pop receipt');
  assert.equal((await fixture.queue.observe('task-lifecycle'))?.checkpoint?.message, 'working');
  await assert.rejects(fixture.queue.complete(renewed, { result: '   ', providerExecutionId: 'exec-empty' }), /nonempty/i);
  await fixture.queue.complete(renewed, { result: 'done', providerExecutionId: 'exec-1' });
  assert.equal((await fixture.queue.observe('task-lifecycle'))?.status, 'completed');

  await fixture.queue.enqueue(task('task-error'));
  const failedLease = await fixture.queue.lease({ visibilityTimeoutSeconds: 5 });
  await fixture.queue.fail(failedLease!, { code: 'EXECUTION_FAILED', message: 'bounded failure' });
  assert.equal((await fixture.queue.observe('task-error'))?.status, 'failed');

  await fixture.queue.enqueue(task('task-cancel'));
  await fixture.queue.requestCancellation('task-cancel', 'user-request');
  const cancelled = await fixture.queue.observe('task-cancel');
  assert.equal(cancelled?.cancellationRequested, true);
  const cancelLease = await fixture.queue.lease({ visibilityTimeoutSeconds: 5 });
  await fixture.queue.cancel(cancelLease!, 'user-request');

  await fixture.queue.enqueue(task('task-recovery'));
  const abandoned = await fixture.queue.lease({ visibilityTimeoutSeconds: 1 });
  fixture.client.expire(abandoned!.messageId);
  const recovered = await fixture.queue.lease({ visibilityTimeoutSeconds: 1 });
  assert.equal(recovered?.task.taskId, 'task-recovery');
  assert.equal(recovered?.dequeueCount, 2, 'visibility timeout must permit recovery delivery');
}

async function testPoisonAndUnknownAreQuarantined(): Promise<void> {
  const fixture = createFixture();
  fixture.client.inject('{not-json');
  assert.equal(await fixture.queue.lease({ visibilityTimeoutSeconds: 1, maxDequeueCount: 3 }), undefined);
  assert.equal(fixture.client.poison.length, 1);

  fixture.client.inject(JSON.stringify({ schemaVersion: 999, taskId: 'unknown' }));
  assert.equal(await fixture.queue.lease({ visibilityTimeoutSeconds: 1, maxDequeueCount: 3 }), undefined);
  assert.equal(fixture.client.poison.length, 2);

  await fixture.queue.enqueue(task('task-poison'));
  const first = await fixture.queue.lease({ visibilityTimeoutSeconds: 1, maxDequeueCount: 1 });
  fixture.client.expire(first!.messageId);
  assert.equal(await fixture.queue.lease({ visibilityTimeoutSeconds: 1, maxDequeueCount: 1 }), undefined);
  assert.equal((await fixture.queue.observe('task-poison'))?.status, 'quarantined');
}

async function testMismatchedMessageCannotQuarantineLegitimateRecord(): Promise<void> {
  const fixture = createFixture();
  await fixture.queue.enqueue(task('task-legitimate'));
  const lease = await fixture.queue.lease({ visibilityTimeoutSeconds: 30 });
  const before = await fixture.queue.observe('task-legitimate');

  fixture.client.inject(JSON.stringify({
    ...task('task-legitimate'),
    prompt: 'attacker-controlled mismatched payload',
  }));

  assert.equal(await fixture.queue.lease({ visibilityTimeoutSeconds: 30 }), undefined);
  assert.equal(fixture.client.poison.length, 1, 'the mismatched message is copied to the poison queue');
  assert.equal(fixture.client.messageCount, 1, 'only the legitimate leased message remains');
  assert.deepEqual(
    await fixture.queue.observe('task-legitimate'),
    before,
    'a mismatched message must not mutate the legitimate durable record',
  );
  assert.equal(lease?.task.taskId, 'task-legitimate');
}

async function testDiagnosticFieldsAreRedactedAndBoundedAtPersistenceAndResponseBoundaries(): Promise<void> {
  const fixture = createFixture();
  const secret = 'sk-live-1234567890abcdefghijklmnop';
  const token = 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature';
  const reviewReproduction = [
    '/opt/teamsapp/bin/codex exec --api-key supersecretvalue',
    '/tmp/private.log',
    '/var/lib/private',
    'password supersecretvalue',
    'secret supersecretvalue',
    'token supersecretvalue',
  ].join(' ');
  const oversized = `prefix ${secret} ${token} ${reviewReproduction} ${'x'.repeat(12_000)}`;

  await fixture.queue.enqueue(task('task-redaction-complete'));
  let lease = await fixture.queue.lease({ visibilityTimeoutSeconds: 30 });
  lease = await fixture.queue.heartbeat(lease!, { sequence: 1, message: oversized }, 30);
  await fixture.queue.complete(lease, { result: oversized, providerExecutionId: oversized });
  const completed = fixture.state.records.get('task-redaction-complete');
  assert.ok(completed, 'completed record is persisted');
  assert.equal(JSON.stringify(completed).includes(secret), false, 'persisted completion data redacts secret-like values');
  assert.equal(JSON.stringify(completed).includes(token), false, 'persisted completion data redacts bearer tokens');
  for (const unsafeFragment of ['/opt/teamsapp', '/tmp/private.log', '/var/lib/private', 'supersecretvalue']) {
    assert.equal(JSON.stringify(completed).includes(unsafeFragment), false, `persisted completion data redacts ${unsafeFragment}`);
  }
  assert.ok(Buffer.byteLength(completed.receipt?.result ?? '', 'utf8') <= 4_096, 'completion result is byte bounded');
  assert.ok(Buffer.byteLength(completed.receipt?.providerExecutionId ?? '', 'utf8') <= 256, 'provider execution id is byte bounded');
  assert.ok(Buffer.byteLength(completed.checkpoint?.message ?? '', 'utf8') <= 1_024, 'checkpoint diagnostic is byte bounded');

  await fixture.queue.enqueue(task('task-redaction-failure'));
  const failedLease = await fixture.queue.lease({ visibilityTimeoutSeconds: 30 });
  await fixture.queue.fail(failedLease!, { code: oversized, message: oversized });
  const failed = fixture.state.records.get('task-redaction-failure');
  assert.ok(failed, 'failed record is persisted');
  assert.equal(JSON.stringify(failed).includes(secret), false, 'persisted failure data redacts secret-like values');
  assert.equal(JSON.stringify(failed).includes('supersecretvalue'), false, 'persisted failure data redacts whitespace credentials');
  assert.ok(Buffer.byteLength(failed.error?.code ?? '', 'utf8') <= 128, 'error code is byte bounded');
  assert.ok(Buffer.byteLength(failed.error?.message ?? '', 'utf8') <= 1_024, 'error message is byte bounded');

  fixture.state.records.set('task-response-redaction', {
    taskId: 'task-response-redaction',
    idempotencyKey: 'idem:task-response-redaction',
    requestHash: 'fixture-hash',
    status: 'failed',
    task: task('task-response-redaction'),
    enqueued: true,
    dequeueCount: 1,
    leaseGeneration: 0,
    updatedAt: clock.now().toISOString(),
    error: { code: oversized, message: oversized, failedAt: clock.now().toISOString() },
  });
  const observed = await fixture.queue.observe('task-response-redaction');
  assert.equal(JSON.stringify(observed).includes(secret), false, 'response boundary redacts legacy unsanitized diagnostics');
  assert.ok(Buffer.byteLength(observed?.error?.message ?? '', 'utf8') <= 1_024, 'response diagnostics are byte bounded');
}

async function testCanonicalTaskIdentityAcrossEveryOperation(): Promise<void> {
  const fixture = createFixture();
  const created = await fixture.queue.enqueue(task('  task-canonical  '));
  assert.equal(created.taskId, 'task-canonical');
  assert.equal(created.task.taskId, 'task-canonical');
  assert.equal(JSON.parse(fixture.client.sent[0]).taskId, 'task-canonical');
  assert.equal((await fixture.queue.observe(' task-canonical '))?.taskId, 'task-canonical');
  await fixture.queue.requestCancellation(' task-canonical ', 'operator');
  assert.equal((await fixture.queue.observe('task-canonical'))?.cancellationRequested, true);
}

async function testDurableLeaseGenerationRejectsDuplicateAndStaleCompletion(): Promise<void> {
  const fixture = createFixture();
  await fixture.queue.enqueue(task('task-generation'));
  const first = await fixture.queue.lease({ visibilityTimeoutSeconds: 1 });
  assert.ok(first?.leaseOwner);
  assert.equal(first?.leaseGeneration, 1);

  fixture.client.inject(fixture.client.sent[0]);
  assert.equal(
    await fixture.queue.lease({ visibilityTimeoutSeconds: 1 }),
    undefined,
    'a second queue message must not acquire an active task lease',
  );
  assert.equal(fixture.client.messageCount, 1, 'an active duplicate message must be deleted instead of poisoning the live lease');

  fixture.client.expire(first!.messageId);
  const recovered = await fixture.queue.lease({ visibilityTimeoutSeconds: 1 });
  assert.equal(recovered?.leaseGeneration, 2);
  assert.notEqual(recovered?.leaseOwner, first?.leaseOwner);
  await assert.rejects(
    fixture.queue.complete(first!, { result: 'stale', providerExecutionId: 'exec-stale' }),
    /lease owner|generation|stale/i,
  );
  await fixture.queue.complete(recovered!, { result: 'fresh', providerExecutionId: 'exec-fresh' });
  assert.equal((await fixture.queue.observe('task-generation'))?.receipt?.result, 'fresh');
}

async function testProductionQueueFactoryUsesManagedIdentityOnly(): Promise<void> {
  const constructed: Array<{ endpoint: string; credential: object }> = [];
  const sdkClient = {
    async sendMessage() { return { messageId: 'message-id' }; },
    async receiveMessages() { return { receivedMessageItems: [] }; },
    async updateMessage() { return { popReceipt: 'next-receipt' }; },
    async deleteMessage() {},
  };
  const credential = {};
  const client = createProductionAzureQueueClient({
    env: {
      AZURE_STORAGE_QUEUE_ENDPOINT: 'https://storage.queue.core.windows.net/agent-dispatch',
      AZURE_STORAGE_POISON_QUEUE_ENDPOINT: 'https://storage.queue.core.windows.net/agent-dispatch-poison',
      AZURE_CLIENT_ID: '00000000-0000-4000-8000-000000000001',
    },
    createDefaultAzureCredential: (options) => {
      assert.equal(options.managedIdentityClientId, '00000000-0000-4000-8000-000000000001');
      return credential as never;
    },
    createQueueClient: (endpoint, actualCredential) => {
      constructed.push({ endpoint, credential: actualCredential as object });
      return sdkClient as never;
    },
  });
  await client.sendMessage('payload');
  assert.deepEqual(constructed.map(({ endpoint }) => endpoint), [
    'https://storage.queue.core.windows.net/agent-dispatch',
    'https://storage.queue.core.windows.net/agent-dispatch-poison',
  ]);
  assert.ok(constructed.every(({ credential: value }) => value === credential));

  for (const env of [
    { AZURE_STORAGE_QUEUE_ENDPOINT: 'https://storage.queue.core.windows.net/q?sig=secret', AZURE_STORAGE_POISON_QUEUE_ENDPOINT: 'https://storage.queue.core.windows.net/p' },
    { AZURE_STORAGE_QUEUE_ENDPOINT: 'https://storage.queue.core.windows.net/q', AZURE_STORAGE_POISON_QUEUE_ENDPOINT: 'https://storage.queue.core.windows.net/p', AZURE_STORAGE_CONNECTION_STRING: 'secret' },
    { AZURE_STORAGE_QUEUE_ENDPOINT: 'https://storage.queue.core.windows.net/q', AZURE_STORAGE_POISON_QUEUE_ENDPOINT: 'https://storage.queue.core.windows.net/p', AZURE_STORAGE_ACCOUNT_KEY: 'secret' },
  ]) {
    assert.throws(() => createProductionAzureQueueClient({ env }), /credential|connection|string|key|sas/i);
  }
}

function task(taskId: string) {
  return {
    schemaVersion: 1 as const,
    taskId,
    idempotencyKey: `idem:${taskId}`,
    tenantId: 'tenant-a',
    requesterId: 'user-a',
    conversationId: 'conversation-a',
    provider: 'codex',
    prompt: 'perform bounded work',
    createdAt: clock.now().toISOString(),
  };
}

function createFixture(): { queue: AzureAgentDispatchQueue; client: MemoryQueueClient; state: MemoryState } {
  const client = new MemoryQueueClient();
  const state = new MemoryState();
  return {
    client,
    state,
    queue: new AzureAgentDispatchQueue(client, state, { clock }),
  };
}

class MemoryState implements AgentDispatchStatePort {
  readonly records = new Map<string, AgentDispatchRecord>();
  async create(record: AgentDispatchRecord): Promise<'created' | 'exists'> {
    if (this.records.has(record.taskId)) return 'exists';
    this.records.set(record.taskId, structuredClone(record));
    return 'created';
  }
  async get(taskId: string): Promise<AgentDispatchRecord | undefined> {
    const value = this.records.get(taskId);
    return value && structuredClone(value);
  }
  async compareAndSwap(
    taskId: string,
    expected: { leaseOwner?: string; leaseGeneration: number },
    mutate: (current: AgentDispatchRecord) => AgentDispatchRecord,
  ): Promise<AgentDispatchRecord | undefined> {
    const current = this.records.get(taskId);
    if (!current) throw new Error(`missing state ${taskId}`);
    if (current.leaseOwner !== expected.leaseOwner || current.leaseGeneration !== expected.leaseGeneration) return undefined;
    const next = mutate(structuredClone(current));
    this.records.set(taskId, structuredClone(next));
    return structuredClone(next);
  }
}

class MemoryQueueClient implements AzureQueueClientPort {
  readonly sent: string[] = [];
  readonly poison: string[] = [];
  private readonly messages: Array<{ id: string; text: string; receipt: string; count: number; visible: boolean }> = [];
  get messageCount(): number { return this.messages.length; }
  async sendMessage(text: string) {
    const item = { id: `message-${this.messages.length + 1}`, text, receipt: 'send', count: 0, visible: true };
    this.messages.push(item);
    this.sent.push(text);
    return { messageId: item.id };
  }
  async receiveMessage() {
    const item = this.messages.find((candidate) => candidate.visible);
    if (!item) return undefined;
    item.visible = false;
    item.count += 1;
    item.receipt = `receipt-${item.count}`;
    return { messageId: item.id, popReceipt: item.receipt, messageText: item.text, dequeueCount: item.count };
  }
  async updateMessage(messageId: string, popReceipt: string) {
    const item = this.required(messageId, popReceipt);
    item.receipt = `${popReceipt}-renewed`;
    return { popReceipt: item.receipt };
  }
  async deleteMessage(messageId: string, popReceipt: string) {
    const item = this.required(messageId, popReceipt);
    this.messages.splice(this.messages.indexOf(item), 1);
  }
  async sendPoisonMessage(text: string) { this.poison.push(text); }
  inject(text: string) { this.messages.push({ id: `raw-${this.messages.length}`, text, receipt: 'send', count: 0, visible: true }); }
  expire(messageId: string) { const item = this.messages.find((candidate) => candidate.id === messageId); if (item) item.visible = true; }
  private required(id: string, receipt: string) {
    const item = this.messages.find((candidate) => candidate.id === id && candidate.receipt === receipt);
    if (!item) throw new Error('invalid pop receipt');
    return item;
  }
}

await testEnqueueIsStableAndIdempotent();
await testLeaseRenewCompleteErrorCancelAndRecovery();
await testPoisonAndUnknownAreQuarantined();
await testMismatchedMessageCannotQuarantineLegitimateRecord();
await testDiagnosticFieldsAreRedactedAndBoundedAtPersistenceAndResponseBoundaries();
await testCanonicalTaskIdentityAcrossEveryOperation();
await testDurableLeaseGenerationRejectsDuplicateAndStaleCompletion();
await testProductionQueueFactoryUsesManagedIdentityOnly();
console.log('azure-agent-dispatch-queue-test: PASS');
