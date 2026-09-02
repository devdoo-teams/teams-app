import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import {
  createProviderRuntimeAdapter,
  hasProviderCompletionEvidence,
  isOpaqueProviderCredentialReference,
  resolveProviderRuntimeState,
  validateProviderRuntimeObservation,
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
  async reconcile(input) {
    calls.push(`reconcile:${input.idempotencyKey}`);
    return { rawState: 'ACCEPTED', providerExecutionId: 'provider-execution-1' };
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
    sha256: crypto.createHash('sha256').update('# Report').digest('hex'),
  }],
}), true);
assert.equal(hasProviderCompletionEvidence({
  artifacts: [{
    artifactId: 'artifact-mutable-uri',
    name: 'report.md',
    mediaType: 'text/markdown',
    uri: 'https://artifacts.example.test/report.md',
  }],
}), false, 'a mutable locator without a content digest is not completion evidence');
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
await adapter.reconcile?.(operationInput);
assert.deepEqual(calls, [
  'preflight:provider-a',
  'submit:request-a',
  'get:provider-execution-1',
  'cancel:provider-execution-1',
  'reconcile:request-a',
]);

assert.equal(isOpaqueProviderCredentialReference('env://PROVIDER_A_TOKEN'), true);
assert.equal(isOpaqueProviderCredentialReference('key-vault://provider-a/credentials/runtime'), true);
assert.equal(isOpaqueProviderCredentialReference('sk-raw-secret-value'), false);
assert.equal(isOpaqueProviderCredentialReference('https://user:password@example.test/secret'), false);

const acceptedReceipt = {
  providerExecutionId: 'provider-execution-1',
  providerSessionId: 'provider-session-1',
  providerContextId: 'provider-context-1',
  acceptedAt: '2026-09-03T00:00:00.000Z',
  rawState: 'ACCEPTED',
};
const redacted = validateProviderRuntimeObservation(adapter, {
  rawState: 'DONE',
  providerExecutionId: 'provider-execution-1',
  providerSessionId: 'provider-session-1',
  providerContextId: 'provider-context-1',
  result: `Bearer ${'r'.repeat(96)} ${'x'.repeat(70_000)}`,
  error: `api_key=${'k'.repeat(96)}`,
  artifacts: [{
    artifactId: 'artifact-safe',
    name: 'result.txt',
    mediaType: 'text/plain',
    text: `password=${'p'.repeat(96)}`,
    sha256: crypto.createHash('sha256').update(`password=${'p'.repeat(96)}`).digest('hex'),
  }],
  auditRefs: [`trace:run-1?token=${'t'.repeat(96)}`],
}, { phase: 'get', receipt: acceptedReceipt });
assert.equal(redacted.state, 'completed');
assert.ok(redacted.result);
assert.equal(redacted.result.includes('r'.repeat(32)), false, 'provider result credentials must be redacted');
assert.equal(redacted.result.length <= 65_536, true, 'provider result must be bounded');
assert.equal(redacted.error?.includes('k'.repeat(32)), false, 'provider errors must be redacted');
assert.equal(redacted.artifacts?.[0]?.text?.includes('p'.repeat(32)), false, 'artifact text must be redacted');
assert.equal(redacted.auditRefs?.[0]?.includes('t'.repeat(32)), false, 'audit references must be redacted');

assert.throws(
  () => validateProviderRuntimeObservation(adapter, {
    rawState: 'DONE',
    providerExecutionId: 'provider-execution-1',
    providerSessionId: 'wrong-session',
    providerContextId: 'provider-context-1',
    result: 'result',
  }, { phase: 'get', receipt: acceptedReceipt }),
  /continuity/i,
);
for (const omittedIdentity of [
  {
    providerSessionId: 'provider-session-1',
    providerContextId: 'provider-context-1',
  },
  {
    providerExecutionId: 'provider-execution-1',
    providerContextId: 'provider-context-1',
  },
  {
    providerExecutionId: 'provider-execution-1',
    providerSessionId: 'provider-session-1',
  },
]) {
  assert.throws(
    () => validateProviderRuntimeObservation(adapter, {
      rawState: 'DONE',
      ...omittedIdentity,
      result: 'must not complete without receipt identity continuity',
    }, { phase: 'get', receipt: acceptedReceipt }),
    /continuity/i,
  );
}

const credentialUrlText = validateProviderRuntimeObservation(adapter, {
  rawState: 'DONE',
  providerExecutionId: 'provider-execution-1',
  providerSessionId: 'provider-session-1',
  providerContextId: 'provider-context-1',
  result: 'See https://user:password@example.test/result?token=raw-secret#credential for details.',
}, { phase: 'get', receipt: acceptedReceipt });
assert.equal(credentialUrlText.result?.includes('password'), false);
assert.equal(credentialUrlText.result?.includes('raw-secret'), false);
assert.throws(
  () => validateProviderRuntimeObservation(adapter, {
    rawState: 'DONE',
    providerExecutionId: 'provider-execution-1',
    artifacts: [{
      artifactId: 'artifact-credential-url',
      name: 'result.json',
      mediaType: 'application/json',
      uri: 'https://artifacts.example.test/result.json?token=raw-secret',
      sha256: 'b'.repeat(64),
    }],
  }, { phase: 'get', receipt }),
  /artifact uri/i,
);
assert.throws(
  () => validateProviderRuntimeObservation(adapter, {
    rawState: 'DONE',
    providerExecutionId: 'provider-execution-1',
    result: 'cancel endpoint claimed completion',
  }, { phase: 'cancel', receipt }),
  /cancel.*completed/i,
);

const whitespaceArtifactText = '\n  immutable report  \n';
const whitespaceArtifact = validateProviderRuntimeObservation(adapter, {
  rawState: 'DONE',
  providerExecutionId: 'provider-execution-1',
  artifacts: [{
    artifactId: 'artifact-whitespace',
    name: 'report.txt',
    mediaType: 'text/plain',
    text: whitespaceArtifactText,
    sha256: crypto.createHash('sha256').update(whitespaceArtifactText).digest('hex'),
  }],
}, { phase: 'get', receipt });
assert.equal(whitespaceArtifact.state, 'completed');
assert.equal(whitespaceArtifact.artifacts?.[0]?.text, whitespaceArtifactText);

console.log('provider-runtime-adapter-test: PASS');
