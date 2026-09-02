import assert from 'node:assert/strict';

import {
  createProviderRuntimeAdapter,
  hasProviderCompletionEvidence,
  resolveProviderRuntimeState,
  type ProviderRuntimeOperationInput,
  type ProviderRuntimeState,
} from '../src/server/provider-runtime-adapter.js';

const calls: string[] = [];
const adapter = createProviderRuntimeAdapter({
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
  async preflight(input) {
    calls.push(`preflight:${input.identities.provider.id}`);
    return { ready: true, capabilities: ['tasks'] };
  },
  async submit(input) {
    calls.push(`submit:${input.idempotencyKey}`);
    return { rawState: 'ACCEPTED', providerExecutionId: 'provider-execution-1' };
  },
  async get(input) {
    calls.push(`get:${input.receipt.providerExecutionId}`);
    return { rawState: 'DONE', result: 'provider result' };
  },
  async cancel(input) {
    calls.push(`cancel:${input.receipt.providerExecutionId}`);
    return { rawState: 'CANCELED' };
  },
});

assert.equal(adapter.providerId, 'provider-a');
assert.equal(resolveProviderRuntimeState(adapter, 'RUNNING'), 'working');
assert.equal(resolveProviderRuntimeState(adapter, 'NEW_PROVIDER_STATE'), 'unknown');
assert.equal(
  resolveProviderRuntimeState({ ...adapter, classifyState: () => 'not-a-state' as never }, 'RUNNING'),
  'unknown',
  'an invalid provider classifier result must fail closed as unknown',
);
assert.throws(
  () => createProviderRuntimeAdapter({ ...adapter, providerId: 'bad provider id' }),
  /providerId/,
);

assert.equal(hasProviderCompletionEvidence({ result: ' useful result ' }), true);
assert.equal(hasProviderCompletionEvidence({ result: '   ' }), false);
assert.equal(hasProviderCompletionEvidence({
  artifacts: [{
    artifactId: 'artifact-1',
    name: 'report.md',
    mediaType: 'text/markdown',
    text: '# Report',
  }],
}), true);
assert.equal(hasProviderCompletionEvidence({
  artifacts: [{
    artifactId: 'artifact-empty',
    name: 'empty.txt',
    mediaType: 'text/plain',
  }],
}), false, 'an artifact identity without content or a durable locator is not completion evidence');

const operationInput = {
  scope: {
    tenantId: 'tenant-a',
    requesterId: 'requester-a',
    conversationId: 'conversation-a',
  },
  idempotencyKey: 'request-a',
  requestHash: 'a'.repeat(64),
  payload: { prompt: 'Run.' },
  requestedCapabilities: ['tasks'],
  identities: {
    provider: { id: 'provider-a' },
    credential: { principalId: 'principal-a', reference: 'secret-ref-a' },
    execution: { id: 'execution-a' },
    context: { id: 'context-a' },
    runtime: { boundaryId: 'runtime-a' },
    audit: { id: 'audit-a' },
  },
  deadlineAtMs: Date.now() + 1_000,
  signal: new AbortController().signal,
} satisfies ProviderRuntimeOperationInput;

const preflight = await adapter.preflight(operationInput);
assert.equal(preflight.ready, true);
const accepted = await adapter.submit(operationInput);
assert.equal(accepted.providerExecutionId, 'provider-execution-1');
const receipt = {
  providerExecutionId: 'provider-execution-1',
  acceptedAt: new Date().toISOString(),
  rawState: 'ACCEPTED',
};
await adapter.get({ ...operationInput, receipt });
await adapter.cancel({ ...operationInput, receipt });
assert.deepEqual(calls, [
  'preflight:provider-a',
  'submit:request-a',
  'get:provider-execution-1',
  'cancel:provider-execution-1',
]);

console.log('provider-runtime-adapter-test: PASS');
