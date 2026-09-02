import assert from 'node:assert/strict';

import type { A2AScope } from '../src/server/a2a-contract.js';
import {
  createProviderRuntimeAdapter,
  type ProviderRuntimeAdapter,
  type ProviderRuntimeIdentities,
  type ProviderRuntimeObservation,
  type ProviderRuntimeState,
} from '../src/server/provider-runtime-adapter.js';
import {
  ProviderLifecycleConflictError,
  ProviderLifecycleRunner,
  isProviderLifecycleTerminal,
  type ProviderLifecycleRecord,
  type ProviderLifecycleStore,
  type ProviderLifecycleSubmittingIntent,
} from '../src/server/provider-lifecycle-runner.js';

const scope: A2AScope = {
  tenantId: 'tenant-a',
  requesterId: 'requester-a',
  conversationId: 'conversation-a',
};
const identities: ProviderRuntimeIdentities = {
  provider: { id: 'provider-a' },
  credential: { principalId: 'credential-principal-a', reference: 'key-vault://provider-a' },
  execution: { id: 'server-execution-a' },
  context: { id: 'server-context-a' },
  runtime: { boundaryId: 'linux-worker-a' },
  audit: { id: 'audit-a' },
};

async function testPreflightFailsClosedBeforeIntentOrSubmit(): Promise<void> {
  const store = new MemoryLifecycleStore();
  let submits = 0;
  const runner = createRunner(store, {
    preflight: async () => ({ ready: false, reason: 'capability unavailable' }),
    submit: async () => {
      submits += 1;
      return accepted();
    },
  });

  await assert.rejects(() => runner.run(input('preflight')), /capability unavailable/);
  assert.equal(submits, 0);
  assert.equal(store.history.length, 0, 'failed preflight must not create a submitting intent');
}

async function testDurableIntentAndReceiptOrderingPreservesScopeAndIdentities(): Promise<void> {
  const store = new MemoryLifecycleStore();
  let runner!: ProviderLifecycleRunner;
  const providerCalls: string[] = [];
  const adapter = provider({
    async submit(operation) {
      providerCalls.push('submit');
      const persisted = await store.get(operation.scope, operation.idempotencyKey);
      assert.equal(persisted?.state, 'submitting', 'submitting intent must be durable before outbound submit');
      assert.deepEqual(persisted?.scope, scope);
      assert.deepEqual(persisted?.identities, identities);
      return accepted();
    },
    async get(operation) {
      providerCalls.push('get');
      const persisted = await store.get(operation.scope, operation.idempotencyKey);
      assert.equal(persisted?.state, 'accepted', 'accepted receipt must be durable before the first poll');
      assert.equal(persisted?.receipt?.providerExecutionId, 'provider-execution-a');
      return { rawState: 'DONE', result: 'durable provider result' };
    },
  });
  runner = new ProviderLifecycleRunner({ adapter, store, pollIntervalMs: 0 });

  const result = await runner.run(input('ordering'));

  assert.equal(result.state, 'completed');
  assert.equal(result.result, 'durable provider result');
  assert.deepEqual(providerCalls, ['submit', 'get']);
  assert.deepEqual(store.history.map((entry) => entry.state), ['submitting', 'accepted', 'completed']);
  assert.deepEqual(result.scope, scope, 'provider observations must not replace server-derived scope');
  assert.equal(result.identities.provider.id, 'provider-a');
  assert.equal(result.identities.credential.principalId, 'credential-principal-a');
  assert.equal(result.identities.execution.id, 'server-execution-a');
  assert.equal(result.identities.context.id, 'server-context-a');
  assert.equal(result.identities.runtime.boundaryId, 'linux-worker-a');
  assert.equal(result.identities.audit.id, 'audit-a');
}

async function testIdempotencyReconcilesSameHashAndRejectsDifferentHash(): Promise<void> {
  const store = new MemoryLifecycleStore();
  let submits = 0;
  const runner = createRunner(store, {
    submit: async () => {
      submits += 1;
      return { rawState: 'DONE', providerExecutionId: 'provider-idempotent', result: 'one result' };
    },
  });

  const first = await runner.run(input('idempotent'));
  const replay = await runner.run(input('idempotent'));
  assert.equal(first.state, 'completed');
  assert.deepEqual(replay, first);
  assert.equal(submits, 1, 'same idempotency key and request hash must not submit twice');

  await assert.rejects(
    () => runner.run({ ...input('idempotent'), requestHash: 'b'.repeat(64) }),
    ProviderLifecycleConflictError,
  );
  assert.equal(submits, 1, 'same idempotency key with a different hash must be rejected before submit');
}

async function testDeliveryUnknownAndUnknownProviderStateAreQuarantined(): Promise<void> {
  const deliveryStore = new MemoryLifecycleStore();
  const delivery = await createRunner(deliveryStore, {
    submit: async () => ({ rawState: 'DELIVERY_UNKNOWN' }),
  }).run(input('delivery-unknown'));
  assert.equal(delivery.state, 'quarantined');
  assert.equal(delivery.quarantine?.reason, 'delivery-unknown');
  assert.equal(delivery.rawProviderState, 'DELIVERY_UNKNOWN');

  const unknownStore = new MemoryLifecycleStore();
  const unknown = await createRunner(unknownStore, {
    submit: async () => ({
      rawState: 'PROVIDER_INVENTED_A_NEW_STATE',
      providerExecutionId: 'provider-unknown',
    }),
  }).run(input('unknown-state'));
  assert.equal(unknown.state, 'quarantined');
  assert.equal(unknown.quarantine?.reason, 'unknown-provider-state');
  assert.equal(unknown.rawProviderState, 'PROVIDER_INVENTED_A_NEW_STATE');
}

async function testInputAndAuthRequiredRemainRecoverable(): Promise<void> {
  for (const [rawState, expected] of [
    ['NEEDS_INPUT', 'input-required'],
    ['NEEDS_AUTH', 'auth-required'],
  ] as const) {
    const store = new MemoryLifecycleStore();
    let submits = 0;
    let polls = 0;
    const runner = createRunner(store, {
      submit: async () => {
        submits += 1;
        return { rawState, providerExecutionId: `provider-${expected}` };
      },
      get: async () => {
        polls += 1;
        return { rawState: 'DONE', result: `${expected} recovered result` };
      },
    });

    const interrupted = await runner.run(input(expected));
    assert.equal(interrupted.state, expected);
    assert.equal(isProviderLifecycleTerminal(interrupted.state), false);
    assert.equal(interrupted.terminalAt, undefined);
    assert.equal(polls, 0, `${expected} should return control without polling or canceling`);

    const recovered = await runner.run(input(expected));
    assert.equal(recovered.state, 'completed');
    assert.equal(recovered.result, `${expected} recovered result`);
    assert.equal(submits, 1, 'recovery must use the durable receipt instead of resubmitting');
    assert.equal(polls, 1);
  }
}

async function testCompletedRequiresNonemptyEvidence(): Promise<void> {
  for (const observation of [
    { rawState: 'DONE', providerExecutionId: 'provider-empty-result', result: '   ' },
    {
      rawState: 'DONE',
      providerExecutionId: 'provider-empty-artifact',
      artifacts: [{ artifactId: 'artifact-a', name: 'empty.txt', mediaType: 'text/plain' }],
    },
  ] satisfies ProviderRuntimeObservation[]) {
    const store = new MemoryLifecycleStore();
    const result = await createRunner(store, { submit: async () => observation }).run(input(observation.providerExecutionId!));
    assert.equal(result.state, 'quarantined');
    assert.equal(result.quarantine?.reason, 'invalid-completion-evidence');
  }

  const artifactStore = new MemoryLifecycleStore();
  const artifactResult = await createRunner(artifactStore, {
    submit: async () => ({
      rawState: 'DONE',
      providerExecutionId: 'provider-artifact',
      artifacts: [{
        artifactId: 'artifact-report',
        name: 'report.json',
        mediaType: 'application/json',
        uri: 'https://artifacts.example.test/report.json',
      }],
    }),
  }).run(input('artifact-completion'));
  assert.equal(artifactResult.state, 'completed');
  assert.equal(artifactResult.artifacts?.[0]?.artifactId, 'artifact-report');
}

async function testBoundedTimeoutPersistsCancellationBeforeProviderCancel(): Promise<void> {
  const store = new MemoryLifecycleStore();
  let cancelCalls = 0;
  const runner = createRunner(store, {
    submit: async () => accepted(),
    get: async ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
    cancel: async (operation) => {
      cancelCalls += 1;
      const persisted = await store.get(operation.scope, operation.idempotencyKey);
      assert.ok(persisted?.cancelRequestedAt, 'timeout cancellation intent must be durable before provider cancel');
      return { rawState: 'CANCELED' };
    },
  });

  const result = await runner.run({ ...input('timeout'), timeoutMs: 20 });
  assert.equal(result.state, 'canceled');
  assert.match(result.error ?? '', /deadline/i);
  assert.equal(cancelCalls, 1);
  assert.ok(result.cancelRequestedAt);
}

async function testExternalCancellationUsesTheSameDurablePath(): Promise<void> {
  const store = new MemoryLifecycleStore();
  const controller = new AbortController();
  let cancelCalls = 0;
  const runner = createRunner(store, {
    submit: async () => accepted(),
    get: async ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
    cancel: async (operation) => {
      cancelCalls += 1;
      assert.ok((await store.get(operation.scope, operation.idempotencyKey))?.cancelRequestedAt);
      return { rawState: 'CANCELED' };
    },
  });

  const running = runner.run({ ...input('external-cancel'), signal: controller.signal });
  setTimeout(() => controller.abort(new Error('user canceled')), 5);
  const result = await running;
  assert.equal(result.state, 'canceled');
  assert.match(result.error ?? '', /cancel/i);
  assert.equal(cancelCalls, 1);
}

function input(suffix: string) {
  return {
    scope,
    idempotencyKey: `idempotency-${suffix}`,
    requestHash: 'a'.repeat(64),
    payload: { prompt: `Run ${suffix}.` },
    requestedCapabilities: ['tasks'],
    identities,
    timeoutMs: 1_000,
  } as const;
}

function accepted(): ProviderRuntimeObservation {
  return { rawState: 'ACCEPTED', providerExecutionId: 'provider-execution-a' };
}

type AdapterOverrides = Partial<Pick<ProviderRuntimeAdapter, 'preflight' | 'submit' | 'get' | 'cancel'>>;

function provider(overrides: AdapterOverrides = {}): ProviderRuntimeAdapter {
  return createProviderRuntimeAdapter({
    providerId: 'provider-a',
    classifyState(rawState) {
      const states: Partial<Record<string, ProviderRuntimeState>> = {
        ACCEPTED: 'accepted',
        RUNNING: 'working',
        NEEDS_INPUT: 'input-required',
        NEEDS_AUTH: 'auth-required',
        DONE: 'completed',
        FAILED: 'failed',
        CANCELED: 'canceled',
        DELIVERY_UNKNOWN: 'delivery-unknown',
      };
      return states[rawState] ?? 'unknown';
    },
    preflight: async () => ({ ready: true, capabilities: ['tasks'] }),
    submit: async () => accepted(),
    get: async () => ({ rawState: 'DONE', result: 'default result' }),
    cancel: async () => ({ rawState: 'CANCELED' }),
    ...overrides,
  });
}

function createRunner(store: ProviderLifecycleStore, overrides: AdapterOverrides = {}): ProviderLifecycleRunner {
  return new ProviderLifecycleRunner({ adapter: provider(overrides), store, pollIntervalMs: 0 });
}

class MemoryLifecycleStore implements ProviderLifecycleStore {
  readonly history: ProviderLifecycleRecord[] = [];
  private readonly records = new Map<string, ProviderLifecycleRecord>();

  async get(recordScope: A2AScope, idempotencyKey: string): Promise<ProviderLifecycleRecord | undefined> {
    const record = this.records.get(key(recordScope, idempotencyKey));
    return record && clone(record);
  }

  async createOrGetSubmitting(
    intent: ProviderLifecycleSubmittingIntent,
  ): Promise<{ record: ProviderLifecycleRecord; created: boolean }> {
    const recordKey = key(intent.scope, intent.idempotencyKey);
    const existing = this.records.get(recordKey);
    if (existing) return { record: clone(existing), created: false };
    const record: ProviderLifecycleRecord = {
      ...clone(intent),
      state: 'submitting',
      revision: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.records.set(recordKey, clone(record));
    this.history.push(clone(record));
    return { record: clone(record), created: true };
  }

  async update(record: ProviderLifecycleRecord, expectedRevision: number): Promise<ProviderLifecycleRecord> {
    const recordKey = key(record.scope, record.idempotencyKey);
    const existing = this.records.get(recordKey);
    if (!existing || existing.revision !== expectedRevision) throw new Error('revision conflict');
    const updated = clone({
      ...record,
      revision: expectedRevision + 1,
      updatedAt: new Date().toISOString(),
    });
    this.records.set(recordKey, updated);
    this.history.push(clone(updated));
    return clone(updated);
  }
}

function key(recordScope: A2AScope, idempotencyKey: string): string {
  return `${recordScope.tenantId}\u0000${recordScope.requesterId}\u0000${recordScope.conversationId}\u0000${idempotencyKey}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

await testPreflightFailsClosedBeforeIntentOrSubmit();
await testDurableIntentAndReceiptOrderingPreservesScopeAndIdentities();
await testIdempotencyReconcilesSameHashAndRejectsDifferentHash();
await testDeliveryUnknownAndUnknownProviderStateAreQuarantined();
await testInputAndAuthRequiredRemainRecoverable();
await testCompletedRequiresNonemptyEvidence();
await testBoundedTimeoutPersistsCancellationBeforeProviderCancel();
await testExternalCancellationUsesTheSameDurablePath();

console.log('provider-lifecycle-runner-test: PASS');
