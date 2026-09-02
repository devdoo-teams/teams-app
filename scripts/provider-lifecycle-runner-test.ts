import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { A2AScope } from '../src/server/a2a-contract.js';
import { atomicWriteJson } from '../src/server/atomic-file.js';
import {
  createProviderRuntimeAdapter,
  type ProviderAcceptedReceipt,
  type ProviderRuntimeAdapter,
  type ProviderRuntimeIdentities,
  type ProviderRuntimeObservation,
  type ProviderRuntimeState,
} from '../src/server/provider-runtime-adapter.js';
import {
  FileProviderLifecycleStore,
  ProviderLifecycleConflictError,
  ProviderLifecycleRevisionConflictError,
  ProviderLifecycleRunner,
  isProviderLifecycleTerminal,
  type ProviderLifecycleRecord,
  type ProviderLifecycleLease,
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
        sha256: 'b'.repeat(64),
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

async function testAdapterCallsAreHardBoundedWhenAbortIsIgnored(): Promise<void> {
  const preflightStore = new MemoryLifecycleStore();
  let preflightSignal: AbortSignal | undefined;
  const preflightRunner = createRunner(preflightStore, {
    preflight: async (operation) => {
      preflightSignal = operation.signal;
      return await never();
    },
  });
  await assert.rejects(
    () => within(preflightRunner.run({ ...input('hard-preflight'), timeoutMs: 20 })),
    /deadline/i,
  );
  assert.equal(preflightSignal?.aborted, true);
  assert.equal(preflightStore.history.length, 0);

  const submitStore = new MemoryLifecycleStore();
  let submitSignal: AbortSignal | undefined;
  const submitResult = await within(createRunner(submitStore, {
    submit: async (operation) => {
      submitSignal = operation.signal;
      return await never();
    },
  }).run({ ...input('hard-submit'), timeoutMs: 20 }));
  assert.equal(submitSignal?.aborted, true);
  assert.equal(submitResult.state, 'quarantined');
  assert.equal(submitResult.quarantine?.reason, 'delivery-unknown');

  const getStore = new MemoryLifecycleStore();
  let getSignal: AbortSignal | undefined;
  const getResult = await within(createRunner(getStore, {
    get: async (operation) => {
      getSignal = operation.signal;
      return await never();
    },
  }).run({ ...input('hard-get'), timeoutMs: 20 }));
  assert.equal(getSignal?.aborted, true);
  assert.equal(getResult.state, 'canceled');

  const cancelStore = new MemoryLifecycleStore();
  let cancelSignal: AbortSignal | undefined;
  const cancelRunner = new ProviderLifecycleRunner({
    adapter: provider({
      submit: async () => ({ rawState: 'NEEDS_INPUT', providerExecutionId: 'provider-cancel-bounded' }),
      cancel: async (operation) => {
        cancelSignal = operation.signal;
        return await never();
      },
    }),
    store: cancelStore,
    pollIntervalMs: 0,
    cancellationTimeoutMs: 20,
  });
  await cancelRunner.run(input('hard-cancel'));
  const cancelResult = await within(cancelRunner.cancel({
    scope,
    idempotencyKey: input('hard-cancel').idempotencyKey,
    expectedProviderExecutionId: 'provider-cancel-bounded',
    reason: 'bounded cancel',
    timeoutMs: 20,
  }));
  assert.equal(cancelSignal?.aborted, true);
  assert.equal(cancelResult.state, 'canceling');
  assert.ok(cancelResult.cancelRequestedAt);
}

async function testReplayAndRestartRecoveryDoNotDependOnLivePreflight(): Promise<void> {
  const terminalStore = new MemoryLifecycleStore();
  let terminalPreflights = 0;
  const firstTerminalRunner = createRunner(terminalStore, {
    preflight: async () => {
      terminalPreflights += 1;
      return { ready: true, capabilities: ['tasks'] };
    },
    submit: async () => ({
      rawState: 'DONE',
      providerExecutionId: 'provider-terminal-replay',
      result: 'terminal result',
    }),
  });
  const terminal = await firstTerminalRunner.run(input('terminal-replay'));
  const terminalReplay = await createRunner(terminalStore, {
    preflight: async () => {
      terminalPreflights += 1;
      throw new Error('preflight unavailable during replay');
    },
  }).run(input('terminal-replay'));
  assert.deepEqual(terminalReplay, terminal);
  assert.equal(terminalPreflights, 1, 'terminal replay must not call live preflight');

  const receiptStore = new MemoryLifecycleStore();
  await createRunner(receiptStore, {
    submit: async () => ({ rawState: 'NEEDS_INPUT', providerExecutionId: 'provider-receipt-recovery' }),
  }).run(input('receipt-recovery'));
  let receiptPreflights = 0;
  const receiptRecovered = await createRunner(receiptStore, {
    preflight: async () => {
      receiptPreflights += 1;
      throw new Error('preflight unavailable during receipt recovery');
    },
    get: async () => ({ rawState: 'DONE', result: 'receipt recovery result' }),
  }).recover({
    scope,
    idempotencyKey: input('receipt-recovery').idempotencyKey,
    expectedProviderExecutionId: 'provider-receipt-recovery',
    timeoutMs: 100,
  });
  assert.equal(receiptRecovered.state, 'completed');
  assert.equal(receiptPreflights, 0, 'receipt-bearing recovery must not call live preflight');

  const receiptlessStore = new MemoryLifecycleStore();
  const deliveryUnknown = await createRunner(receiptlessStore, {
    submit: async () => {
      throw new Error('connection reset after delivery');
    },
  }).run(input('receiptless-recovery'));
  assert.equal(deliveryUnknown.quarantine?.reason, 'delivery-unknown');
  let reconciliations = 0;
  let receiptlessSubmits = 0;
  const reconcileRunner = createRunner(receiptlessStore, {
    preflight: async () => {
      throw new Error('recovery must not call preflight');
    },
    submit: async () => {
      receiptlessSubmits += 1;
      return accepted();
    },
    reconcile: async (operation) => {
      reconciliations += 1;
      assert.equal(operation.idempotencyKey, input('receiptless-recovery').idempotencyKey);
      return {
        rawState: 'DONE',
        providerExecutionId: 'provider-reconciled-by-idempotency',
        result: 'reconciled result',
      };
    },
  });
  const reconciled = await reconcileRunner.recover({
    scope,
    idempotencyKey: input('receiptless-recovery').idempotencyKey,
    timeoutMs: 100,
  });
  assert.equal(reconciled.state, 'completed');
  assert.equal(reconciliations, 1);
  assert.equal(receiptlessSubmits, 0, 'receiptless recovery must never resubmit');

  const unsupportedStore = new MemoryLifecycleStore();
  await createRunner(unsupportedStore, {
    submit: async () => {
      throw new Error('delivery status unknown');
    },
  }).run(input('unsupported-reconcile'));
  let unsupportedSubmits = 0;
  const unsupported = await createRunner(unsupportedStore, {
    preflight: async () => {
      throw new Error('recovery must not call preflight');
    },
    submit: async () => {
      unsupportedSubmits += 1;
      return accepted();
    },
  }).run(input('unsupported-reconcile'));
  assert.equal(unsupported.state, 'quarantined');
  assert.equal(unsupported.quarantine?.reason, 'delivery-unknown');
  assert.equal(unsupportedSubmits, 0, 'unsupported reconciliation must fail closed without resubmission');
}

async function testPersistedCancellationResumesCancelAfterRestart(): Promise<void> {
  const store = new MemoryLifecycleStore();
  const firstRunner = new ProviderLifecycleRunner({
    adapter: provider({
      submit: async () => ({ rawState: 'NEEDS_INPUT', providerExecutionId: 'provider-cancel-restart' }),
      cancel: async () => await never(),
    }),
    store,
    pollIntervalMs: 0,
    cancellationTimeoutMs: 20,
  });
  await firstRunner.run(input('cancel-restart'));
  const pending = await firstRunner.cancel({
    scope,
    idempotencyKey: input('cancel-restart').idempotencyKey,
    expectedProviderExecutionId: 'provider-cancel-restart',
    reason: 'restart cancellation',
    timeoutMs: 20,
  });
  assert.equal(pending.state, 'canceling');
  assert.ok(pending.cancelRequestedAt);

  let preflights = 0;
  let polls = 0;
  let cancels = 0;
  const restarted = createRunner(store, {
    preflight: async () => {
      preflights += 1;
      throw new Error('cancellation recovery must not call preflight');
    },
    get: async () => {
      polls += 1;
      return { rawState: 'DONE', result: 'must not complete through polling' };
    },
    cancel: async () => {
      cancels += 1;
      return { rawState: 'CANCELED' };
    },
  });
  const recovered = await restarted.run(input('cancel-restart'));
  assert.equal(recovered.state, 'canceled');
  assert.equal(preflights, 0);
  assert.equal(polls, 0, 'persisted cancellation must never resume ordinary polling');
  assert.equal(cancels, 1);
}

async function testCancelCasWinsOverLateCompletionAndReceiptQuarantineRecovers(): Promise<void> {
  const raceStore = new MemoryLifecycleStore();
  let releaseGet!: () => void;
  let markGetStarted!: () => void;
  const getStarted = new Promise<void>((resolve) => {
    markGetStarted = resolve;
  });
  const getGate = new Promise<void>((resolve) => {
    releaseGet = resolve;
  });
  const raceRunner = createRunner(raceStore, {
    get: async () => {
      markGetStarted();
      await getGate;
      return { rawState: 'DONE', result: 'late completion must lose to cancel' };
    },
    cancel: async () => ({ rawState: 'CANCELED' }),
  });
  const running = raceRunner.run(input('cancel-cas'));
  await getStarted;
  const canceled = await raceRunner.cancel({
    scope,
    idempotencyKey: input('cancel-cas').idempotencyKey,
    expectedProviderExecutionId: 'provider-execution-a',
    reason: 'cancel wins CAS',
  });
  releaseGet();
  const lateGet = await running;
  assert.equal(canceled.state, 'canceled');
  assert.equal(lateGet.state, 'canceled');
  assert.equal((await raceStore.get(scope, input('cancel-cas').idempotencyKey))?.state, 'canceled');

  const receiptStore = new MemoryLifecycleStore();
  const paused = await createRunner(receiptStore, {
    submit: async () => ({ rawState: 'NEEDS_INPUT', providerExecutionId: 'provider-quarantine-recover' }),
  }).run(input('receipt-quarantine-recover'));
  await receiptStore.update({
    ...paused,
    state: 'quarantined',
    rawProviderState: 'DELIVERY_UNKNOWN',
    quarantine: { reason: 'delivery-unknown' },
    terminalAt: new Date().toISOString(),
  }, paused.revision);
  let preflights = 0;
  const recovered = await createRunner(receiptStore, {
    preflight: async () => {
      preflights += 1;
      throw new Error('receipt recovery must not preflight');
    },
    get: async () => ({ rawState: 'DONE', result: 'receipt quarantine recovered' }),
  }).recover({
    scope,
    idempotencyKey: input('receipt-quarantine-recover').idempotencyKey,
    expectedProviderExecutionId: 'provider-quarantine-recover',
    timeoutMs: 100,
  });
  assert.equal(recovered.state, 'completed');
  assert.equal(preflights, 0);
}

async function testConcurrentSameRequestWaitsForLeaseAndReloads(): Promise<void> {
  const store = new MemoryLifecycleStore();
  let submitCalls = 0;
  let reconcileCalls = 0;
  let releaseSubmit!: () => void;
  let markSubmitStarted!: () => void;
  const submitStarted = new Promise<void>((resolve) => {
    markSubmitStarted = resolve;
  });
  const submitGate = new Promise<void>((resolve) => {
    releaseSubmit = resolve;
  });
  const adapter = provider({
    submit: async () => {
      submitCalls += 1;
      markSubmitStarted();
      await submitGate;
      return accepted();
    },
    get: async () => ({ rawState: 'DONE', result: 'one concurrent result' }),
    reconcile: async () => {
      reconcileCalls += 1;
      return { rawState: 'DELIVERY_UNKNOWN' };
    },
  });
  const firstRunner = new ProviderLifecycleRunner({ adapter, store, pollIntervalMs: 1 });
  const secondRunner = new ProviderLifecycleRunner({ adapter, store, pollIntervalMs: 1 });

  const firstPromise = firstRunner.run(input('concurrent-same'));
  await submitStarted;
  const secondPromise = secondRunner.run(input('concurrent-same'));
  await new Promise((resolve) => setTimeout(resolve, 10));
  releaseSubmit();
  const [first, second] = await within(Promise.all([firstPromise, secondPromise]));

  assert.equal(first.state, 'completed');
  assert.deepEqual(second, first);
  assert.equal(submitCalls, 1, 'same-key same-hash concurrency must submit once');
  assert.equal(reconcileCalls, 0, 'an active submit lease must be waited out, not reconciled concurrently');

  let releaseConflictingSubmit!: () => void;
  let markConflictingSubmitStarted!: () => void;
  const conflictingSubmitStarted = new Promise<void>((resolve) => {
    markConflictingSubmitStarted = resolve;
  });
  const conflictingSubmitGate = new Promise<void>((resolve) => {
    releaseConflictingSubmit = resolve;
  });
  const conflictStore = new MemoryLifecycleStore();
  const conflictRunner = new ProviderLifecycleRunner({
    adapter: provider({
      submit: async () => {
        markConflictingSubmitStarted();
        await conflictingSubmitGate;
        return { rawState: 'DONE', providerExecutionId: 'provider-conflict', result: 'original result' };
      },
    }),
    store: conflictStore,
    pollIntervalMs: 1,
  });
  const originalPromise = conflictRunner.run(input('concurrent-conflict'));
  await conflictingSubmitStarted;
  await assert.rejects(
    () => conflictRunner.run({ ...input('concurrent-conflict'), requestHash: 'b'.repeat(64) }),
    ProviderLifecycleConflictError,
  );
  releaseConflictingSubmit();
  assert.equal((await originalPromise).state, 'completed');
}

async function testAllObservationsAreValidatedAndDurableFieldsAreSanitized(): Promise<void> {
  const rawCredentialStore = new MemoryLifecycleStore();
  await assert.rejects(
    () => createRunner(rawCredentialStore).run({
      ...input('raw-credential-reference'),
      identities: {
        ...identities,
        credential: { principalId: 'credential-principal-a', reference: 'sk-raw-secret-value' },
      },
    }),
    /opaque.*credential reference/i,
  );
  assert.equal(rawCredentialStore.history.length, 0, 'raw credential references must never be persisted');

  const rawPayloadStore = new MemoryLifecycleStore();
  await assert.rejects(
    () => createRunner(rawPayloadStore).run({
      ...input('raw-payload-credential'),
      payload: { prompt: 'Run.', apiKey: 'raw-provider-secret' },
    }),
    /raw credential.*payload/i,
  );
  assert.equal(rawPayloadStore.history.length, 0, 'raw payload credentials must never be persisted');

  const redactionStore = new MemoryLifecycleStore();
  const providerSecret = 'r'.repeat(96);
  const auditSecret = 't'.repeat(96);
  const redacted = await createRunner(redactionStore, {
    submit: async () => ({
      rawState: 'DONE',
      providerExecutionId: 'provider-redacted-result',
      result: `Bearer ${providerSecret} completed`,
      error: `api_key=${'k'.repeat(96)}`,
      auditRefs: [`trace:run-1?token=${auditSecret}`],
    }),
  }).run(input('redacted-observation'));
  assert.equal(redacted.state, 'completed');
  const durableRedacted = JSON.stringify(redactionStore.history);
  assert.equal(durableRedacted.includes(providerSecret), false);
  assert.equal(durableRedacted.includes(auditSecret), false);
  assert.match(redacted.result ?? '', /REDACTED/);

  const credentialUrlStore = new MemoryLifecycleStore();
  const rawUrlSecret = 'url-secret-must-not-persist';
  const invalidUrl = await createRunner(credentialUrlStore, {
    submit: async () => ({
      rawState: 'DONE',
      providerExecutionId: 'provider-credential-url',
      artifacts: [{
        artifactId: 'artifact-credential-url',
        name: 'result.json',
        mediaType: 'application/json',
        uri: `https://artifacts.example.test/result.json?token=${rawUrlSecret}`,
        sha256: 'c'.repeat(64),
      }],
    }),
  }).run(input('credential-url'));
  assert.equal(invalidUrl.state, 'quarantined');
  assert.equal(invalidUrl.quarantine?.reason, 'invalid-provider-observation');
  assert.equal(JSON.stringify(credentialUrlStore.history).includes(rawUrlSecret), false);

  const continuityStore = new MemoryLifecycleStore();
  const continuity = await createRunner(continuityStore, {
    submit: async () => ({
      rawState: 'ACCEPTED',
      providerExecutionId: 'provider-continuity',
      providerSessionId: 'provider-session-a',
      providerContextId: 'provider-context-a',
    }),
    get: async () => ({
      rawState: 'DONE',
      providerExecutionId: 'provider-continuity',
      providerSessionId: 'provider-session-b',
      providerContextId: 'provider-context-a',
      result: 'must not complete',
    }),
  }).run(input('continuity'));
  assert.equal(continuity.state, 'quarantined');
  assert.equal(continuity.quarantine?.reason, 'invalid-provider-observation');

  const cancelStore = new MemoryLifecycleStore();
  const cancelRunner = createRunner(cancelStore, {
    submit: async () => ({ rawState: 'NEEDS_INPUT', providerExecutionId: 'provider-cancel-completed' }),
    cancel: async () => ({
      rawState: 'DONE',
      providerExecutionId: 'provider-cancel-completed',
      result: 'false completion from cancel',
    }),
  });
  await cancelRunner.run(input('cancel-completed'));
  const canceled = await cancelRunner.cancel({
    scope,
    idempotencyKey: input('cancel-completed').idempotencyKey,
    expectedProviderExecutionId: 'provider-cancel-completed',
    reason: 'cancel must not complete',
  });
  assert.equal(canceled.state, 'canceling');
  assert.notEqual(canceled.state, 'completed');
}

async function testFailedPollAndReconcileReleaseOwnedLease(): Promise<void> {
  const pollStore = new MemoryLifecycleStore();
  let pollFails = true;
  let pollCalls = 0;
  const pollRunner = createRunner(pollStore, {
    submit: async () => ({ rawState: 'ACCEPTED', providerExecutionId: 'provider-lease-poll' }),
    get: async () => {
      pollCalls += 1;
      if (pollFails) throw new Error('temporary poll failure');
      return {
        rawState: 'DONE',
        providerExecutionId: 'provider-lease-poll',
        result: 'poll recovered immediately',
      };
    },
  });
  await assert.rejects(() => pollRunner.run(input('poll-lease-release')), /temporary poll failure/);
  pollFails = false;
  const pollRecovered = await within(pollRunner.run({
    ...input('poll-lease-release'),
    timeoutMs: 100,
  }), 300);
  assert.equal(pollRecovered.state, 'completed');
  assert.equal(pollRecovered.result, 'poll recovered immediately');
  assert.equal(pollCalls, 2, 'retry must poll immediately instead of waiting for an abandoned lease');

  const reconcileStore = new MemoryLifecycleStore();
  let reconcileFails = true;
  let reconcileCalls = 0;
  const reconcileRunner = createRunner(reconcileStore, {
    submit: async () => {
      throw new Error('submit delivery unknown');
    },
    reconcile: async () => {
      reconcileCalls += 1;
      if (reconcileFails) throw new Error('temporary reconcile failure');
      return {
        rawState: 'DONE',
        providerExecutionId: 'provider-lease-reconcile',
        result: 'reconcile recovered immediately',
      };
    },
  });
  const unknown = await reconcileRunner.run(input('reconcile-lease-release'));
  assert.equal(unknown.state, 'quarantined');
  await reconcileRunner.recover({
    scope,
    idempotencyKey: input('reconcile-lease-release').idempotencyKey,
    timeoutMs: 100,
  });
  reconcileFails = false;
  const reconcileRecovered = await within(reconcileRunner.recover({
    scope,
    idempotencyKey: input('reconcile-lease-release').idempotencyKey,
    timeoutMs: 100,
  }), 300);
  assert.equal(reconcileRecovered.state, 'completed');
  assert.equal(reconcileRecovered.result, 'reconcile recovered immediately');
  assert.equal(reconcileCalls, 2, 'retry must reconcile immediately after a failed receiptless recovery');
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

type AdapterOverrides = Partial<Pick<ProviderRuntimeAdapter, 'preflight' | 'submit' | 'get' | 'cancel' | 'reconcile'>>;

function provider(overrides: AdapterOverrides = {}): ProviderRuntimeAdapter {
  const get = overrides.get;
  const cancel = overrides.cancel;
  const remaining = { ...overrides };
  delete remaining.get;
  delete remaining.cancel;
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
    get: async (operation) => withReceiptContinuity(
      await (get?.(operation) ?? Promise.resolve({ rawState: 'DONE', result: 'default result' })),
      operation.receipt,
    ),
    cancel: async (operation) => withReceiptContinuity(
      await (cancel?.(operation) ?? Promise.resolve({ rawState: 'CANCELED' })),
      operation.receipt,
    ),
    ...remaining,
  });
}

function withReceiptContinuity(
  observation: ProviderRuntimeObservation,
  receipt: ProviderAcceptedReceipt,
): ProviderRuntimeObservation {
  return {
    ...observation,
    providerExecutionId: observation.providerExecutionId ?? receipt.providerExecutionId,
    ...(observation.providerSessionId === undefined && receipt.providerSessionId !== undefined
      ? { providerSessionId: receipt.providerSessionId }
      : {}),
    ...(observation.providerContextId === undefined && receipt.providerContextId !== undefined
      ? { providerContextId: receipt.providerContextId }
      : {}),
  };
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
    lease?: ProviderLifecycleLease,
  ): Promise<{ record: ProviderLifecycleRecord; created: boolean }> {
    const recordKey = key(intent.scope, intent.idempotencyKey);
    const existing = this.records.get(recordKey);
    if (existing) return { record: clone(existing), created: false };
    const record: ProviderLifecycleRecord = {
      ...clone(intent),
      state: 'submitting',
      ...(lease ? { lease: clone(lease) } : {}),
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
    if (!existing || existing.revision !== expectedRevision) throw new ProviderLifecycleRevisionConflictError();
    const updated = clone({
      ...record,
      revision: expectedRevision + 1,
      updatedAt: new Date().toISOString(),
    });
    this.records.set(recordKey, updated);
    this.history.push(clone(updated));
    return clone(updated);
  }

  async scanRecoverable(): Promise<readonly ProviderLifecycleRecord[]> {
    return [...this.records.values()]
      .filter((record) => !isProviderLifecycleTerminal(record.state)
        && (record.state !== 'quarantined' || record.quarantine?.reason === 'delivery-unknown'))
      .map(clone);
  }
}

function key(recordScope: A2AScope, idempotencyKey: string): string {
  return `${recordScope.tenantId}\u0000${recordScope.requesterId}\u0000${recordScope.conversationId}\u0000${idempotencyKey}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

async function never<T>(): Promise<T> {
  return await new Promise<T>(() => undefined);
}

async function within<T>(operation: Promise<T>, timeoutMs = 500): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('test hard deadline exceeded')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function testAcceptedCallbackPrecedesPolling(): Promise<void> {
  const store = new MemoryLifecycleStore();
  let acceptedCallbackRan = false;
  const runner = createRunner(store, {
    submit: async () => accepted(),
    get: async () => {
      assert.equal(acceptedCallbackRan, true, 'accepted callback must complete before provider polling');
      assert.equal((await store.get(scope, 'idempotency-accepted-callback'))?.state, 'accepted');
      return { rawState: 'DONE', result: 'callback ordered result' };
    },
  });

  const result = await runner.run({
    ...input('accepted-callback'),
    onAccepted: async (receipt) => {
      assert.equal(receipt.providerExecutionId, 'provider-execution-a');
      acceptedCallbackRan = true;
    },
  });
  assert.equal(result.state, 'completed');
}

async function testAcceptedCallbackFailureIsBoundedAndReleasesOwnedLease(): Promise<void> {
  const throwingStore = new MemoryLifecycleStore();
  let throwingPolls = 0;
  const throwingRunner = createRunner(throwingStore, {
    get: async () => {
      throwingPolls += 1;
      return { rawState: 'DONE', result: 'throwing callback recovered' };
    },
  });
  await assert.rejects(
    () => within(throwingRunner.run({
      ...input('accepted-callback-throws'),
      onAccepted: () => {
        throw new Error('accepted callback failed');
      },
    })),
    /accepted callback failed/,
  );
  assert.equal(
    (await throwingStore.get(scope, input('accepted-callback-throws').idempotencyKey))?.lease,
    undefined,
    'a thrown accepted callback must release its owner lease',
  );
  const throwingRecovered = await within(throwingRunner.run({
    ...input('accepted-callback-throws'),
    timeoutMs: 100,
  }), 300);
  assert.equal(throwingRecovered.state, 'completed');
  assert.equal(throwingRecovered.result, 'throwing callback recovered');
  assert.equal(throwingPolls, 1);

  const hangingStore = new MemoryLifecycleStore();
  let hangingPolls = 0;
  let hangingCancels = 0;
  const hangingRunner = createRunner(hangingStore, {
    get: async () => {
      hangingPolls += 1;
      return { rawState: 'DONE', result: 'hanging callback recovered' };
    },
    cancel: async () => {
      hangingCancels += 1;
      return { rawState: 'CANCELED' };
    },
  });
  await assert.rejects(
    () => within(hangingRunner.run({
      ...input('accepted-callback-hangs'),
      timeoutMs: 20,
      onAccepted: async () => await never(),
    }), 200),
    /deadline/i,
  );
  assert.equal(hangingCancels, 0, 'callback timeout must not cancel an accepted provider execution');
  assert.equal(
    (await hangingStore.get(scope, input('accepted-callback-hangs').idempotencyKey))?.lease,
    undefined,
    'a timed-out accepted callback must release its owner lease',
  );
  const hangingRecovered = await within(hangingRunner.run({
    ...input('accepted-callback-hangs'),
    timeoutMs: 100,
  }), 300);
  assert.equal(hangingRecovered.state, 'completed');
  assert.equal(hangingRecovered.result, 'hanging callback recovered');
  assert.equal(hangingPolls, 1);

  const replacedLeaseStore = new MemoryLifecycleStore();
  const replacedLeaseRunner = createRunner(replacedLeaseStore);
  await assert.rejects(
    () => replacedLeaseRunner.run({
      ...input('accepted-callback-foreign-lease'),
      onAccepted: async () => {
        const persisted = await replacedLeaseStore.get(
          scope,
          input('accepted-callback-foreign-lease').idempotencyKey,
        );
        assert.ok(persisted);
        await replacedLeaseStore.update({
          ...persisted,
          lease: {
            ownerId: 'replacement-owner',
            expiresAt: new Date(Date.now() + 10_000).toISOString(),
          },
        }, persisted.revision);
        throw new Error('accepted callback failed after lease replacement');
      },
    }),
    /lease replacement/,
  );
  assert.equal(
    (await replacedLeaseStore.get(scope, input('accepted-callback-foreign-lease').idempotencyKey))?.lease?.ownerId,
    'replacement-owner',
    'callback failure must not release a lease now owned by another runner',
  );
}

async function testExplicitRecoveryAndCancellationUseDurableReceipt(): Promise<void> {
  const store = new MemoryLifecycleStore();
  let recoveryPolls = 0;
  let cancellations = 0;
  const runner = createRunner(store, {
    submit: async () => ({ rawState: 'NEEDS_INPUT', providerExecutionId: 'provider-recover-explicit' }),
    get: async (operation) => {
      recoveryPolls += 1;
      assert.equal(operation.receipt.providerExecutionId, 'provider-recover-explicit');
      return { rawState: 'RUNNING' };
    },
    cancel: async (operation) => {
      cancellations += 1;
      assert.equal(operation.receipt.providerExecutionId, 'provider-recover-explicit');
      assert.ok((await store.get(operation.scope, operation.idempotencyKey))?.cancelRequestedAt);
      return { rawState: 'CANCELED' };
    },
  });

  const paused = await runner.run(input('explicit-lifecycle'));
  assert.equal(paused.state, 'input-required');
  const recoveryController = new AbortController();
  setTimeout(() => recoveryController.abort(new Error('stop recovery')), 5);
  const recovered = await runner.recover({
    scope,
    idempotencyKey: input('explicit-lifecycle').idempotencyKey,
    expectedProviderExecutionId: 'provider-recover-explicit',
    timeoutMs: 1_000,
    signal: recoveryController.signal,
  });
  assert.equal(recovered.state, 'canceled');
  assert.equal(recoveryPolls >= 1, true);
  assert.equal(cancellations, 1);

  const canceledAgain = await runner.cancel({
    scope,
    idempotencyKey: input('explicit-lifecycle').idempotencyKey,
    expectedProviderExecutionId: 'provider-recover-explicit',
    reason: 'duplicate cancellation reconciliation',
  });
  assert.equal(canceledAgain.state, 'canceled');
  assert.equal(cancellations, 1, 'terminal cancellation replay must not call the provider again');
}

async function testFileStoreSurvivesRestartWithoutIdentityCollapse(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-lifecycle-store-'));
  const filePath = path.join(root, 'private', 'lifecycle.json');
  try {
    const first = new FileProviderLifecycleStore(filePath);
    await first.initialize();
    const { timeoutMs: _timeoutMs, ...intent } = input('file-restart');
    const created = await first.createOrGetSubmitting(intent);
    assert.equal(created.created, true);
    const acceptedRecord = await first.update({
      ...created.record,
      state: 'accepted',
      receipt: {
        providerExecutionId: 'provider-file-restart',
        providerContextId: 'provider-context-file',
        acceptedAt: '2026-09-03T00:00:00.000Z',
        rawState: 'ACCEPTED',
      },
    }, created.record.revision);

    const restarted = new FileProviderLifecycleStore(filePath);
    await restarted.initialize();
    const loaded = await restarted.get(scope, input('file-restart').idempotencyKey);
    assert.deepEqual(loaded, acceptedRecord);
    assert.equal(loaded?.identities.credential.principalId, 'credential-principal-a');
    assert.equal(loaded?.identities.execution.id, 'server-execution-a');
    assert.equal(loaded?.receipt?.providerExecutionId, 'provider-file-restart');
    assert.equal(loaded?.receipt?.providerContextId, 'provider-context-file');
    await first.close();
    await assert.rejects(
      () => first.get(scope, input('file-restart').idempotencyKey),
      /initialize/i,
    );
    await first.initialize();
    assert.deepEqual(await first.get(scope, input('file-restart').idempotencyKey), acceptedRecord);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testFileStoreRequiresValidPersistedReceiptExecutionId(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-lifecycle-store-receipt-'));
  const filePath = path.join(root, 'private', 'lifecycle.json');
  try {
    const store = new FileProviderLifecycleStore(filePath);
    await store.initialize();
    const { timeoutMs: _timeoutMs, ...intent } = input('file-receipt-validation');
    const created = await store.createOrGetSubmitting(intent);
    const acceptedRecord = await store.update({
      ...created.record,
      state: 'accepted',
      receipt: {
        providerExecutionId: 'provider-file-receipt',
        acceptedAt: '2026-09-03T00:00:00.000Z',
        rawState: 'ACCEPTED',
      },
    }, created.record.revision);
    const persisted = JSON.parse(await fs.readFile(filePath, 'utf8')) as {
      records: Record<string, ProviderLifecycleRecord>;
    };
    const recordKey = Object.keys(persisted.records)[0];
    assert.ok(recordKey);
    const { providerExecutionId: _removedExecutionId, ...receiptWithoutExecutionId } = acceptedRecord.receipt!;

    for (const receipt of [
      receiptWithoutExecutionId,
      { ...acceptedRecord.receipt!, providerExecutionId: 'invalid execution id' },
      null,
    ]) {
      await atomicWriteJson(filePath, {
        ...persisted,
        records: {
          ...persisted.records,
          [recordKey]: { ...acceptedRecord, receipt },
        },
      });
      await assert.rejects(
        () => new FileProviderLifecycleStore(filePath).initialize(),
        /receipt execution id/i,
      );
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testFileStoreRejectsCompletedRecordWithoutEvidenceOnReopen(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-lifecycle-store-completion-'));
  const filePath = path.join(root, 'private', 'lifecycle.json');
  try {
    const store = new FileProviderLifecycleStore(filePath);
    await store.initialize();
    const { timeoutMs: _timeoutMs, ...intent } = input('file-completion-validation');
    const created = await store.createOrGetSubmitting(intent);
    const completedRecord = await store.update({
      ...created.record,
      state: 'completed',
      receipt: {
        providerExecutionId: 'provider-file-completion',
        acceptedAt: '2026-09-03T00:00:00.000Z',
        rawState: 'DONE',
      },
      result: 'validated persisted result',
      terminalAt: '2026-09-03T00:00:01.000Z',
    }, created.record.revision);
    const persisted = JSON.parse(await fs.readFile(filePath, 'utf8')) as {
      records: Record<string, ProviderLifecycleRecord>;
    };
    const recordKey = Object.keys(persisted.records)[0];
    assert.ok(recordKey);
    const { result: _removedResult, artifacts: _removedArtifacts, ...withoutCompletionEvidence } = completedRecord;
    await atomicWriteJson(filePath, {
      ...persisted,
      records: {
        ...persisted.records,
        [recordKey]: withoutCompletionEvidence,
      },
    });

    await assert.rejects(
      () => new FileProviderLifecycleStore(filePath).initialize(),
      /completion evidence/i,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testFileStorePreservesNewlineExactContentAddressedArtifactText(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-lifecycle-store-artifact-text-'));
  const filePath = path.join(root, 'private', 'lifecycle.json');
  const artifactText = '\nfirst line\nsecond line\n\n';
  try {
    const store = new FileProviderLifecycleStore(filePath);
    await store.initialize();
    const { timeoutMs: _timeoutMs, ...intent } = input('file-artifact-text');
    const created = await store.createOrGetSubmitting(intent);
    const completed = await store.update({
      ...created.record,
      state: 'completed',
      receipt: {
        providerExecutionId: 'provider-file-artifact-text',
        acceptedAt: '2026-09-03T00:00:00.000Z',
        rawState: 'DONE',
      },
      artifacts: [{
        artifactId: 'artifact-file-text',
        name: 'result.txt',
        mediaType: 'text/plain',
        text: artifactText,
        sha256: crypto.createHash('sha256').update(artifactText).digest('hex'),
      }],
      terminalAt: '2026-09-03T00:00:01.000Z',
    }, created.record.revision);
    assert.equal(completed.artifacts?.[0]?.text, artifactText);

    const reopened = new FileProviderLifecycleStore(filePath);
    await reopened.initialize();
    const loaded = await reopened.get(scope, intent.idempotencyKey);
    assert.equal(loaded?.state, 'completed');
    assert.equal(loaded?.artifacts?.[0]?.text, artifactText);
    assert.equal(
      loaded?.artifacts?.[0]?.sha256,
      crypto.createHash('sha256').update(artifactText).digest('hex'),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testFileStoreSerializesWritersRollsBackAndScansRecovery(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-lifecycle-store-concurrency-'));
  const filePath = path.join(root, 'private', 'lifecycle.json');
  try {
    const first = new FileProviderLifecycleStore(filePath);
    const second = new FileProviderLifecycleStore(filePath);
    await Promise.all([first.initialize(), second.initialize()]);
    const { timeoutMs: _firstTimeout, ...firstIntent } = input('file-writer-a');
    const { timeoutMs: _secondTimeout, ...secondIntent } = input('file-writer-b');
    const [firstCreated, secondCreated] = await Promise.all([
      first.createOrGetSubmitting(firstIntent),
      second.createOrGetSubmitting(secondIntent),
    ]);
    assert.equal(firstCreated.created, true);
    assert.equal(secondCreated.created, true);

    const reopened = new FileProviderLifecycleStore(filePath);
    await reopened.initialize();
    assert.ok(await reopened.get(scope, firstIntent.idempotencyKey));
    assert.ok(await reopened.get(scope, secondIntent.idempotencyKey), 'concurrent writers must not overwrite each other');

    const acceptedBySecond = await second.update({
      ...firstCreated.record,
      state: 'accepted',
      receipt: {
        providerExecutionId: 'provider-file-cas',
        acceptedAt: '2026-09-03T00:00:00.000Z',
        rawState: 'ACCEPTED',
      },
    }, firstCreated.record.revision);
    await assert.rejects(
      () => first.update({ ...firstCreated.record, state: 'failed' }, firstCreated.record.revision),
      ProviderLifecycleRevisionConflictError,
    );
    assert.deepEqual(await first.get(scope, firstIntent.idempotencyKey), acceptedBySecond);
    await assert.rejects(
      () => second.update({
        ...acceptedBySecond,
        rawProviderState: 'https://user:password@example.test/state?token=raw-secret',
        receipt: {
          ...acceptedBySecond.receipt!,
          reconciliationRef: 'https://example.test/cursor?sig=raw-secret',
        },
      }, acceptedBySecond.revision),
      /unsafe/i,
    );
    assert.deepEqual(await second.get(scope, firstIntent.idempotencyKey), acceptedBySecond);

    const completed = await reopened.update({
      ...secondCreated.record,
      state: 'completed',
      result: 'complete',
      terminalAt: '2026-09-03T00:00:01.000Z',
    }, secondCreated.record.revision);
    assert.equal(completed.state, 'completed');
    const recoverable = await reopened.scanRecoverable();
    assert.deepEqual(recoverable.map((record) => record.idempotencyKey), [firstIntent.idempotencyKey]);

    const persisted = JSON.parse(await fs.readFile(filePath, 'utf8')) as { records: Record<string, unknown> };
    assert.equal(Object.keys(persisted.records).length, 2);
    assert.deepEqual((await fs.readdir(path.dirname(filePath))).filter((name) => name.endsWith('.tmp')), []);

    const poisonedKey = Object.keys(persisted.records)[0];
    const poisonedRecord = (persisted.records as Record<string, ProviderLifecycleRecord>)[poisonedKey!];
    assert.ok(poisonedRecord);
    for (const unsafePatch of [
      { rawProviderState: 'provider+task://runtime.example.test/state?code=raw-secret' },
      {
        receipt: poisonedRecord.receipt && {
          ...poisonedRecord.receipt,
          rawState: 'ftp://user:password@runtime.example.test/state',
        },
      },
      {
        receipt: poisonedRecord.receipt && {
          ...poisonedRecord.receipt,
          reconciliationRef: 'provider+task://runtime.example.test/cursor#access_token=raw-secret',
        },
      },
    ]) {
      await atomicWriteJson(filePath, {
        ...persisted,
        records: {
          ...persisted.records,
          [poisonedKey!]: { ...poisonedRecord, ...unsafePatch },
        },
      });
      await assert.rejects(
        () => new FileProviderLifecycleStore(filePath).initialize(),
        /unsafe/i,
      );
    }
    await atomicWriteJson(filePath, persisted);

    let failWrites = false;
    const rollbackPath = path.join(root, 'rollback', 'lifecycle.json');
    const rollbackStore = new FileProviderLifecycleStore(rollbackPath, {
      writeJson: async (target, value) => {
        if (failWrites) throw new Error('injected atomic write failure');
        await atomicWriteJson(target, value);
      },
    });
    await rollbackStore.initialize();
    failWrites = true;
    const { timeoutMs: _rollbackTimeout, ...rollbackIntent } = input('file-rollback');
    await assert.rejects(
      () => rollbackStore.createOrGetSubmitting(rollbackIntent),
      /injected atomic write failure/,
    );
    failWrites = false;
    assert.equal(await rollbackStore.get(scope, rollbackIntent.idempotencyKey), undefined);
    await rollbackStore.close();
    await rollbackStore.initialize();
    assert.equal(await rollbackStore.get(scope, rollbackIntent.idempotencyKey), undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

await testPreflightFailsClosedBeforeIntentOrSubmit();
await testDurableIntentAndReceiptOrderingPreservesScopeAndIdentities();
await testIdempotencyReconcilesSameHashAndRejectsDifferentHash();
await testDeliveryUnknownAndUnknownProviderStateAreQuarantined();
await testInputAndAuthRequiredRemainRecoverable();
await testCompletedRequiresNonemptyEvidence();
await testBoundedTimeoutPersistsCancellationBeforeProviderCancel();
await testExternalCancellationUsesTheSameDurablePath();
await testAdapterCallsAreHardBoundedWhenAbortIsIgnored();
await testReplayAndRestartRecoveryDoNotDependOnLivePreflight();
await testPersistedCancellationResumesCancelAfterRestart();
await testCancelCasWinsOverLateCompletionAndReceiptQuarantineRecovers();
await testConcurrentSameRequestWaitsForLeaseAndReloads();
await testAllObservationsAreValidatedAndDurableFieldsAreSanitized();
await testFailedPollAndReconcileReleaseOwnedLease();
await testAcceptedCallbackPrecedesPolling();
await testAcceptedCallbackFailureIsBoundedAndReleasesOwnedLease();
await testExplicitRecoveryAndCancellationUseDurableReceipt();
await testFileStoreSurvivesRestartWithoutIdentityCollapse();
await testFileStoreRequiresValidPersistedReceiptExecutionId();
await testFileStoreRejectsCompletedRecordWithoutEvidenceOnReopen();
await testFileStorePreservesNewlineExactContentAddressedArtifactText();
await testFileStoreSerializesWritersRollsBackAndScansRecovery();

console.log('provider-lifecycle-runner-test: PASS');
