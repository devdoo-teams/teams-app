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
import type { AgentDispatchTaskReference } from '../src/server/queue/agent-dispatch-queue.js';
import { createRuntimeStoreAgentDispatchStatePort } from '../src/server/storage/agent-dispatch-state-port.js';
import {
  RuntimeStoreConflictError,
  type RuntimeRecord,
  type RuntimeScope,
  type RuntimeStore,
  type RuntimeWrite,
} from '../src/server/storage/runtime-store.js';

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
  assert.deepEqual(first.task.execution, {
    mode: 'workspace-write',
    workspaceReference: 'teams-core-worker-workspace',
  }, 'canonical dispatch state preserves the immutable execution contract');
  assert.deepEqual(JSON.parse(fixture.client.sent[0]).execution, first.task.execution,
    'Queue Storage receives the same validated execution contract');
  assert.deepEqual(duplicate, first);
  assert.equal(fixture.client.sent.length, 1, 'duplicate delivery must not enqueue twice');
  await assert.rejects(
    fixture.queue.enqueue({ ...input, prompt: 'different' }),
    DispatchConflictError,
  );
}

async function testSameTaskIdIsIsolatedByServerDerivedScope(): Promise<void> {
  const fixture = createFixture();
  const tenantA = task('shared-task-id');
  const tenantB = task('shared-task-id', { tenantId: 'tenant-b' });

  await fixture.queue.enqueue(tenantA);
  await fixture.queue.enqueue(tenantB);

  assert.equal(fixture.client.sent.length, 2, 'the same task ID in distinct tenant scopes is not a duplicate');
  assert.equal((await fixture.queue.observe(reference(tenantA)))?.task.tenantId, 'tenant-a');
  assert.equal((await fixture.queue.observe(reference(tenantB)))?.task.tenantId, 'tenant-b');
}

async function testRuntimeStateUsesTaskScopeForObserveCasAndHealth(): Promise<void> {
  const client = new MemoryQueueClient();
  const runtimeStore = new MemoryRuntimeStore();
  const queue = new AzureAgentDispatchQueue(
    client,
    createRuntimeStoreAgentDispatchStatePort(runtimeStore),
    { clock },
  );
  const tenantA = task('shared-runtime-id');
  const tenantB = task('shared-runtime-id', { tenantId: 'tenant-b' });
  await queue.enqueue(tenantA);
  await queue.enqueue(tenantB);

  let leaseA = await queue.lease({ visibilityTimeoutSeconds: 30 });
  const leaseB = await queue.lease({ visibilityTimeoutSeconds: 30 });
  assert.equal(leaseA?.task.tenantId, 'tenant-a');
  assert.equal(leaseB?.task.tenantId, 'tenant-b');
  leaseA = await queue.heartbeat(leaseA!, { sequence: 1, message: 'worker heartbeat' }, 30);
  await queue.complete(leaseB!, { result: 'tenant-b result', providerExecutionId: 'tenant-b-exec' });

  assert.equal((await queue.observe(reference(tenantA)))?.status, 'leased');
  assert.equal((await queue.observe(reference(tenantB)))?.receipt?.result, 'tenant-b result');
  const health = await queue.readHealth({
    taskReference: reference(tenantA),
    maximumHeartbeatAgeMs: 30_000,
  });
  assert.equal(health.dependencies.state.state, 'reachable');
  assert.equal(health.workerHeartbeat.state, 'observed');

  await assert.rejects(
    createRuntimeStoreAgentDispatchStatePort(runtimeStore).compareAndSwap(
      reference(tenantA),
      { leaseOwner: leaseA.leaseOwner, leaseGeneration: leaseA.leaseGeneration },
      (record) => ({ ...record, task: { ...record.task, tenantId: 'tenant-b' } }),
    ),
    /scope mismatch/i,
    'CAS cannot move a durable task into another tenant partition',
  );
  assert.equal(runtimeStore.scopes.some((scope) => scope.tenantId === 'teams-core-system'), false);
}

async function testReadOnlyExecutionRequiresExplicitIsolationReference(): Promise<void> {
  const fixture = createFixture();
  const readOnly = task('task-read-only', { mode: 'read-only' });
  const created = await fixture.queue.enqueue(readOnly);
  assert.deepEqual(created.task.execution, {
    mode: 'read-only',
    workspaceReference: 'teams-core-worker-workspace',
    isolationReference: 'linux-read-only-required',
  });
  await assert.rejects(
    fixture.queue.enqueue({
      ...task('task-read-only-invalid'),
      execution: {
        mode: 'read-only',
        workspaceReference: 'teams-core-worker-workspace',
      } as never,
    }),
    /isolation reference/i,
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
  assert.equal((await fixture.queue.observe(reference(task('task-lifecycle'))))?.checkpoint?.message, 'working');
  await assert.rejects(fixture.queue.complete(renewed, { result: '   ', providerExecutionId: 'exec-empty' }), /nonempty/i);
  await fixture.queue.complete(renewed, { result: 'done', providerExecutionId: 'exec-1' });
  assert.equal((await fixture.queue.observe(reference(task('task-lifecycle'))))?.status, 'completed');

  await fixture.queue.enqueue(task('task-error'));
  const failedLease = await fixture.queue.lease({ visibilityTimeoutSeconds: 5 });
  await fixture.queue.fail(failedLease!, { code: 'EXECUTION_FAILED', message: 'bounded failure' });
  assert.equal((await fixture.queue.observe(reference(task('task-error'))))?.status, 'failed');

  await fixture.queue.enqueue(task('task-cancel'));
  await fixture.queue.requestCancellation(reference(task('task-cancel')), 'user-request');
  const cancelled = await fixture.queue.observe(reference(task('task-cancel')));
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
  assert.equal((await fixture.queue.observe(reference(task('task-poison'))))?.status, 'quarantined');
}

async function testMismatchedMessageCannotQuarantineLegitimateRecord(): Promise<void> {
  const fixture = createFixture();
  await fixture.queue.enqueue(task('task-legitimate'));
  const lease = await fixture.queue.lease({ visibilityTimeoutSeconds: 30 });
  const before = await fixture.queue.observe(reference(task('task-legitimate')));

  fixture.client.inject(JSON.stringify({
    ...task('task-legitimate'),
    prompt: 'attacker-controlled mismatched payload',
  }));

  assert.equal(await fixture.queue.lease({ visibilityTimeoutSeconds: 30 }), undefined);
  assert.equal(fixture.client.poison.length, 1, 'the mismatched message is copied to the poison queue');
  assert.equal(fixture.client.messageCount, 1, 'only the legitimate leased message remains');
  assert.deepEqual(
    await fixture.queue.observe(reference(task('task-legitimate'))),
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
  const completed = fixture.state.peek(reference(task('task-redaction-complete')));
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
  const failed = fixture.state.peek(reference(task('task-redaction-failure')));
  assert.ok(failed, 'failed record is persisted');
  assert.equal(JSON.stringify(failed).includes(secret), false, 'persisted failure data redacts secret-like values');
  assert.equal(JSON.stringify(failed).includes('supersecretvalue'), false, 'persisted failure data redacts whitespace credentials');
  assert.ok(Buffer.byteLength(failed.error?.code ?? '', 'utf8') <= 128, 'error code is byte bounded');
  assert.ok(Buffer.byteLength(failed.error?.message ?? '', 'utf8') <= 1_024, 'error message is byte bounded');

  fixture.state.put({
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
  const observed = await fixture.queue.observe(reference(task('task-response-redaction')));
  assert.equal(JSON.stringify(observed).includes(secret), false, 'response boundary redacts legacy unsanitized diagnostics');
  assert.ok(Buffer.byteLength(observed?.error?.message ?? '', 'utf8') <= 1_024, 'response diagnostics are byte bounded');
}

async function testCanonicalTaskIdentityAcrossEveryOperation(): Promise<void> {
  const fixture = createFixture();
  const created = await fixture.queue.enqueue(task('  task-canonical  '));
  assert.equal(created.taskId, 'task-canonical');
  assert.equal(created.task.taskId, 'task-canonical');
  assert.equal(JSON.parse(fixture.client.sent[0]).taskId, 'task-canonical');
  assert.equal((await fixture.queue.observe(reference(task(' task-canonical '))))?.taskId, 'task-canonical');
  await fixture.queue.requestCancellation(reference(task(' task-canonical ')), 'operator');
  assert.equal((await fixture.queue.observe(reference(task('task-canonical'))))?.cancellationRequested, true);
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
  assert.equal((await fixture.queue.observe(reference(task('task-generation'))))?.receipt?.result, 'fresh');
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

function task(taskId: string, options: {
  tenantId?: string;
  requesterId?: string;
  conversationId?: string;
  mode?: 'read-only' | 'workspace-write';
} = {}) {
  const mode = options.mode ?? 'workspace-write';
  return {
    schemaVersion: 2 as const,
    taskId,
    idempotencyKey: `idem:${taskId}`,
    tenantId: options.tenantId ?? 'tenant-a',
    requesterId: options.requesterId ?? 'user-a',
    conversationId: options.conversationId ?? 'conversation-a',
    provider: 'codex',
    prompt: 'perform bounded work',
    createdAt: clock.now().toISOString(),
    execution: mode === 'read-only'
      ? {
          mode: 'read-only' as const,
          workspaceReference: 'teams-core-worker-workspace' as const,
          isolationReference: 'linux-read-only-required' as const,
        }
      : {
          mode: 'workspace-write' as const,
          workspaceReference: 'teams-core-worker-workspace' as const,
        },
  };
}

function reference(value: ReturnType<typeof task>): AgentDispatchTaskReference {
  return {
    taskId: value.taskId,
    tenantId: value.tenantId,
    requesterId: value.requesterId,
    conversationId: value.conversationId,
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
    const key = this.key(reference(record.task as ReturnType<typeof task>));
    if (this.records.has(key)) return 'exists';
    this.records.set(key, structuredClone(record));
    return 'created';
  }
  async get(taskReference: AgentDispatchTaskReference): Promise<AgentDispatchRecord | undefined> {
    const value = this.records.get(this.key(taskReference));
    return value && structuredClone(value);
  }
  async compareAndSwap(
    taskReference: AgentDispatchTaskReference,
    expected: { leaseOwner?: string; leaseGeneration: number },
    mutate: (current: AgentDispatchRecord) => AgentDispatchRecord,
  ): Promise<AgentDispatchRecord | undefined> {
    const key = this.key(taskReference);
    const current = this.records.get(key);
    if (!current) throw new Error(`missing state ${taskReference.taskId}`);
    if (current.leaseOwner !== expected.leaseOwner || current.leaseGeneration !== expected.leaseGeneration) return undefined;
    const next = mutate(structuredClone(current));
    this.records.set(key, structuredClone(next));
    return structuredClone(next);
  }
  peek(taskReference: AgentDispatchTaskReference): AgentDispatchRecord | undefined {
    return this.records.get(this.key(taskReference));
  }
  put(record: AgentDispatchRecord): void {
    this.records.set(this.key(reference(record.task as ReturnType<typeof task>)), record);
  }
  private key(taskReference: AgentDispatchTaskReference): string {
    return JSON.stringify([
      taskReference.tenantId,
      taskReference.requesterId,
      taskReference.conversationId,
      taskReference.taskId.trim(),
    ]);
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

class MemoryRuntimeStore implements RuntimeStore {
  readonly scopes: RuntimeScope[] = [];
  private readonly records = new Map<string, RuntimeRecord & { idempotencyKey: string }>();
  private revision = 0;

  async read<T>(scope: RuntimeScope, id: string): Promise<RuntimeRecord<T> | null> {
    this.scopes.push({ ...scope });
    const record = this.records.get(this.key(scope, id));
    return record ? structuredClone(record) as RuntimeRecord<T> : null;
  }

  async list<T>(scope: RuntimeScope): Promise<Array<RuntimeRecord<T>>> {
    this.scopes.push({ ...scope });
    const prefix = `${JSON.stringify(scope)}\0`;
    return [...this.records.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, record]) => structuredClone(record) as RuntimeRecord<T>);
  }

  async write<T>(scope: RuntimeScope, input: RuntimeWrite<T>): Promise<RuntimeRecord<T>> {
    this.scopes.push({ ...scope });
    const key = this.key(scope, input.id);
    const current = this.records.get(key);
    if (current && input.expectedEtag !== current.etag) throw new RuntimeStoreConflictError('stale ETag');
    if (!current && input.expectedEtag) throw new RuntimeStoreConflictError('missing record');
    if (current && !input.expectedEtag) throw new RuntimeStoreConflictError('record exists');
    const timestamp = clock.now().toISOString();
    const record = {
      id: input.id,
      value: structuredClone(input.value),
      etag: `etag-${++this.revision}`,
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp,
      idempotencyKey: input.idempotencyKey,
    };
    this.records.set(key, record);
    return structuredClone(record);
  }

  private key(scope: RuntimeScope, id: string): string {
    return `${JSON.stringify(scope)}\0${id}`;
  }
}

await testEnqueueIsStableAndIdempotent();
await testSameTaskIdIsIsolatedByServerDerivedScope();
await testRuntimeStateUsesTaskScopeForObserveCasAndHealth();
await testReadOnlyExecutionRequiresExplicitIsolationReference();
await testLeaseRenewCompleteErrorCancelAndRecovery();
await testPoisonAndUnknownAreQuarantined();
await testMismatchedMessageCannotQuarantineLegitimateRecord();
await testDiagnosticFieldsAreRedactedAndBoundedAtPersistenceAndResponseBoundaries();
await testCanonicalTaskIdentityAcrossEveryOperation();
await testDurableLeaseGenerationRejectsDuplicateAndStaleCompletion();
await testProductionQueueFactoryUsesManagedIdentityOnly();
console.log('azure-agent-dispatch-queue-test: PASS');
