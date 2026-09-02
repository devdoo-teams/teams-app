import assert from 'node:assert/strict';

import {
  createGrokProviderRuntimeAdapter,
  GrokProviderTransportError,
  type GrokProviderExecutionPort,
  type GrokProviderPreflightPort,
} from '../src/server/providers/grok-provider-runtime-adapter.js';
import {
  validateProviderRuntimeObservation,
  type ProviderRuntimeOperationInput,
} from '../src/server/provider-runtime-adapter.js';

const preflight: GrokProviderPreflightPort = {
  async verify({ model, credentialReference }) {
    return {
      ready: model === 'grok-4.6' && credentialReference === 'key-vault://xai/runtime-key',
      modelId: model,
      reason: 'fixture model access',
    };
  },
};

const execution: GrokProviderExecutionPort = {
  async submit() {
    return { responseId: 'resp-1', status: 'failed', error: 'provider rejected the request', verified: false };
  },
  async retrieve() {
    return { responseId: 'resp-1', status: 'in_progress' };
  },
  async reconcile() {
    return undefined;
  },
};

const adapter = createGrokProviderRuntimeAdapter({
  model: 'grok-4.6',
  preflight,
  execution,
});

const input = {
  scope: { tenantId: 'tenant', requesterId: 'requester', conversationId: 'conversation' },
  idempotencyKey: 'grok-request-1',
  requestHash: 'a'.repeat(64),
  payload: { input: 'Investigate the incident.' },
  requestedCapabilities: ['responses'],
  identities: {
    provider: { id: 'grok-xai' },
    credential: { principalId: 'xai-team', reference: 'key-vault://xai/runtime-key' },
    execution: { id: 'execution-1' },
    context: { id: 'context-1' },
    runtime: { boundaryId: 'runtime-1' },
    audit: { id: 'audit-1' },
  },
  deadlineAtMs: Date.now() + 10_000,
  signal: new AbortController().signal,
} satisfies ProviderRuntimeOperationInput;

assert.deepEqual(await adapter.preflight(input), {
  ready: true,
  capabilities: ['responses'],
});

await assert.rejects(
  adapter.submit(input),
  /submission was not accepted/i,
  'a failed xAI response must never become an accepted receipt even when it has a response ID',
);

await assert.rejects(
  adapter.submit({ ...input, payload: { input: 'valid input', unexpected: true } }),
  /unsupported.*payload|payload.*unsupported/i,
  'the durable adapter must not forward unreviewed provider fields',
);

await assert.rejects(
  adapter.preflight({
    ...input,
    identities: {
      ...input.identities,
      credential: { ...input.identities.credential, reference: 'xai-raw-secret' },
    },
  }),
  /opaque/i,
);

const wrongModelAdapter = createGrokProviderRuntimeAdapter({
  model: 'grok-4.6',
  execution,
  preflight: {
    async verify() {
      return { ready: true, modelId: 'different-model', reason: 'wrong model' };
    },
  },
});
assert.deepEqual(await wrongModelAdapter.preflight(input), {
  ready: false,
  reason: 'Grok model and credential preflight was not verified.',
});

let pollCount = 0;
let reconcileCount = 0;
const durableExecution: GrokProviderExecutionPort = {
  async submit() {
    return { responseId: 'resp-durable', status: 'queued' };
  },
  async retrieve({ responseId }) {
    pollCount += 1;
    return pollCount === 1
      ? { responseId, status: 'in_progress' }
      : { responseId, status: 'completed', result: 'verified Grok result', verified: true };
  },
  async reconcile({ idempotencyKey, requestHash }) {
    reconcileCount += 1;
    assert.equal(idempotencyKey, input.idempotencyKey);
    assert.equal(requestHash, input.requestHash);
    return { responseId: 'resp-durable', status: 'in_progress' };
  },
};
const durableAdapter = createGrokProviderRuntimeAdapter({
  model: 'grok-4.6',
  preflight,
  execution: durableExecution,
});
const durableAccepted = await durableAdapter.submit(input);
const receipt = {
  providerExecutionId: durableAccepted.providerExecutionId!,
  providerContextId: durableAccepted.providerContextId,
  acceptedAt: '2026-09-03T00:00:00.000Z',
  rawState: durableAccepted.rawState,
};
const working = await durableAdapter.get({ ...input, receipt });
assert.equal(working.rawState, 'in_progress');
const completed = await durableAdapter.get({ ...input, receipt });
assert.equal(completed.rawState, 'completed');
assert.equal(completed.result, 'verified Grok result');
assert.equal(validateProviderRuntimeObservation(durableAdapter, completed, { phase: 'get', receipt }).state, 'completed');

assert.deepEqual(await durableAdapter.reconcile?.(input), {
  rawState: 'in_progress',
  providerExecutionId: 'resp-durable',
  providerContextId: 'context-1',
  providerCursor: 'resp-durable',
  auditRefs: ['xai-response:resp-durable'],
});
assert.equal(reconcileCount, 1, 'restart reconciliation must use the durable execution port');

const unverifiedCompletion = createGrokProviderRuntimeAdapter({
  model: 'grok-4.6',
  preflight,
  execution: {
    ...durableExecution,
    async retrieve({ responseId }) {
      return { responseId, status: 'completed', result: 'unverified HTTP body', verified: false };
    },
  },
});
assert.deepEqual(await unverifiedCompletion.get({ ...input, receipt }), {
  rawState: 'failed',
  providerExecutionId: 'resp-durable',
  providerContextId: 'context-1',
  providerCursor: 'resp-durable',
  error: 'Grok completed response did not include verified completion evidence.',
  auditRefs: ['xai-response:resp-durable'],
});

let retryCalls = 0;
const retryAdapter = createGrokProviderRuntimeAdapter({
  model: 'grok-4.6',
  preflight: {
    async verify() {
      retryCalls += 1;
      if (retryCalls < 3) {
        throw new GrokProviderTransportError(429, `Bearer ${'s'.repeat(96)}`, true);
      }
      return { ready: true, modelId: 'grok-4.6', reason: 'retry succeeded' };
    },
  },
  maxAttempts: 3,
  sleep: async () => undefined,
  execution: {
    ...durableExecution,
  },
});
assert.equal((await retryAdapter.preflight(input)).ready, true);
assert.equal(retryCalls, 3, 'retryable transport failures must stop at the configured bound');

let ambiguousSubmitCalls = 0;
const ambiguousSubmitAdapter = createGrokProviderRuntimeAdapter({
  model: 'grok-4.6',
  preflight,
  maxAttempts: 3,
  sleep: async () => undefined,
  execution: {
    ...durableExecution,
    async submit() {
      ambiguousSubmitCalls += 1;
      throw new GrokProviderTransportError(503, 'upstream timed out after accepting the request', true);
    },
  },
});
await assert.rejects(
  ambiguousSubmitAdapter.submit(input),
  /HTTP 503/,
  'an ambiguous xAI POST failure must be surfaced instead of retried without a documented idempotency contract',
);
assert.equal(ambiguousSubmitCalls, 1, 'ambiguous submit failures must not be retried');

let exhaustedCalls = 0;
const exhaustedAdapter = createGrokProviderRuntimeAdapter({
  model: 'grok-4.6',
  preflight,
  maxAttempts: 2,
  sleep: async () => undefined,
  execution: {
    ...durableExecution,
    async submit() {
      exhaustedCalls += 1;
      throw new GrokProviderTransportError(503, `api_key=${'k'.repeat(96)} xai-${'x'.repeat(96)}`, true);
    },
  },
});
await assert.rejects(exhaustedAdapter.submit(input), (error: unknown) => {
  assert.ok(error instanceof Error);
  assert.match(error.message, /HTTP 503/);
  assert.equal(error.message.includes('k'.repeat(32)), false, 'transport diagnostics must redact credentials');
  assert.equal(error.message.includes('xai-' + 'x'.repeat(32)), false, 'xAI credentials must be redacted from diagnostics');
  return true;
});
assert.equal(exhaustedCalls, 1, 'submit must not be retried after an ambiguous transport failure');

const cancelled = await durableAdapter.cancel({ ...input, receipt });
assert.deepEqual(cancelled, {
  rawState: 'unsupported',
  providerExecutionId: 'resp-durable',
  providerContextId: 'context-1',
  error: 'Local HTTP abort cannot cancel an xAI provider task; no official remote cancellation endpoint is documented.',
});

const aborted = new AbortController();
let observedSignal: AbortSignal | undefined;
const localAbortAdapter = createGrokProviderRuntimeAdapter({
  model: 'grok-4.6',
  preflight,
  execution: {
    ...durableExecution,
    async retrieve(request) {
      observedSignal = request.signal;
      aborted.abort(new Error('local HTTP request aborted'));
      throw request.signal.reason;
    },
  },
});
await assert.rejects(localAbortAdapter.get({ ...input, signal: aborted.signal, receipt }));
assert.equal(observedSignal?.aborted, true, 'local HTTP abort signal must be forwarded without claiming provider cancellation');

console.log('PASS: Grok runtime adapter enforces durable receipts, verified polling, restart reconciliation, bounded redacted retry, and unsupported remote cancellation');
