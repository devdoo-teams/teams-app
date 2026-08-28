import assert from 'node:assert/strict';

import {
  A2A_PROTOCOL_VERSION,
  CORE_AGENT_CAPABILITIES,
  CORE_INPUT_MODES,
  CORE_OUTPUT_MODES,
  A2AContractError,
  createCoreAgentCard,
  mapInternalTaskStatus,
  redactAndBoundText,
  serializeAgentCard,
  validateA2AVersion,
  validateAgentCard,
  validateArtifactRef,
  validateCursor,
  validateDeadline,
  validateGraphLimits,
  validateIdempotencyKey,
  validateMessage,
  validatePageLimit,
  validatePart,
  validateScope,
  validateSendRequest,
  validateTask,
  assertScopeMatchesServer,
  assertTaskTransition,
} from '../src/server/a2a-contract.js';

function throwsNamed(fn: () => unknown, name: string): A2AContractError {
  let didThrow = false;
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    didThrow = true;
    thrown = error;
  }
  assert.equal(didThrow, true, `expected ${name}`);
  assert.ok(thrown instanceof A2AContractError, `expected ${name}`);
  assert.equal(thrown.name, name);
  return thrown;
}

const scope = {
  tenantId: 'tenant-a',
  requesterId: 'requester-a',
  conversationId: '19:conversation-a@thread.v2',
} as const;

const artifact = {
  artifactId: 'artifact-1',
  taskId: 'task-1',
  sha256: 'a'.repeat(64),
  byteSize: 12,
  mediaType: 'text/plain',
  name: 'result.txt',
  scope,
  sourceTaskId: 'task-1',
} as const;
const childArtifact = {
  ...artifact,
  artifactId: 'artifact-child-1',
  sourceTaskId: 'child-task-1',
} as const;

const baseMessage = {
  messageId: 'message-1',
  role: 'user' as const,
  parts: [
    { text: 'Run the bounded Core task.', mediaType: 'text/plain' },
    { data: { mode: 'read-only', count: 1 }, mediaType: 'application/json' },
  ],
  contextId: 'context-1',
  taskId: 'task-1',
} as const;

// Agent Card: only the implemented, provider-independent polling contract is advertised.
const card = createCoreAgentCard({
  agentId: 'teams-core',
  name: 'Teams Core Agent',
  description: 'Deterministic HTTP+JSON task contract.',
  version: '1.0.44',
  endpoint: 'https://core.example.test',
});
validateAgentCard(card);
const serializedCard = serializeAgentCard(card);
const parsedCard = JSON.parse(serializedCard) as Record<string, unknown>;
assert.deepEqual(parsedCard.capabilities, CORE_AGENT_CAPABILITIES);
assert.deepEqual(parsedCard.defaultInputModes, CORE_INPUT_MODES);
assert.deepEqual(parsedCard.defaultOutputModes, CORE_OUTPUT_MODES);
assert.equal((parsedCard as { securitySchemes?: unknown }).securitySchemes, undefined);
assert.equal(serializedCard.includes('secret'), false);
assert.equal(serializedCard.includes('credential'), false);
assert.equal(serializedCard.includes('ready'), false);
assert.equal((parsedCard.supportedInterfaces as Array<Record<string, unknown>>)[0].protocolVersion, A2A_PROTOCOL_VERSION);

throwsNamed(
  () => validateAgentCard({ ...card, capabilities: { ...card.capabilities, streaming: true } }),
  'UnsupportedOperationError',
);
throwsNamed(
  () => validateAgentCard({ ...card, capabilities: { ...card.capabilities, pushNotifications: true } }),
  'PushNotificationNotSupportedError',
);
throwsNamed(
  () => validateAgentCard({ ...card, supportedInterfaces: [{ ...card.supportedInterfaces[0], url: 'http://core.example.test' }] }),
  'InvalidRequestError',
);
throwsNamed(
  () => validateAgentCard({ ...card, ...( { readiness: 'ready' } as Record<string, unknown>) }),
  'InvalidRequestError',
);
throwsNamed(() => validateA2AVersion('2.0'), 'VersionNotSupportedError');
assert.equal(validateA2AVersion('1.0'), A2A_PROTOCOL_VERSION);

// Scope is server-owned. A body scope can only be compared to it, never used to replace it.
assert.deepEqual(validateScope(scope), scope);
assert.doesNotThrow(() => assertScopeMatchesServer(scope, { tenantId: 'tenant-a' }));
throwsNamed(
  () => assertScopeMatchesServer(scope, { tenantId: 'tenant-b', requesterId: scope.requesterId }),
  'ScopeMismatchError',
);
throwsNamed(
  () => validateSendRequest({ message: baseMessage, idempotencyKey: 'idem-1', scope: { tenantId: 'tenant-b' } }, scope),
  'ScopeMismatchError',
);
throwsNamed(
  () => validateSendRequest({ message: baseMessage, idempotencyKey: 'idem-1', requesterId: 'requester-b' }, scope),
  'InvalidRequestError',
);

// Message/Part validation accepts bounded text and structured JSON only.
assert.doesNotThrow(() => validateMessage(baseMessage));
assert.doesNotThrow(() => validatePart({ data: { nested: ['bounded', 1, true] }, mediaType: 'application/json' }));
assert.doesNotThrow(() => validateMessage({
  ...baseMessage,
  metadata: { nested: { label: 'bounded', values: [1, true, null] } },
}));
throwsNamed(() => validateMessage({
  ...baseMessage,
  metadata: { nested: { credentials: { token: 'do-not-store' } } },
}), 'InvalidRequestError');
throwsNamed(() => validateMessage({
  ...baseMessage,
  metadata: { a: { b: { c: { d: { e: { f: 'too-deep' } } } } } },
}), 'InvalidRequestError');
const oversizedMetadata = Object.fromEntries(
  Array.from({ length: 32 }, (_, index) => [`field${index}`, 'x'.repeat(600)]),
);
throwsNamed(() => validateMessage({ ...baseMessage, metadata: oversizedMetadata }), 'InvalidRequestError');
throwsNamed(() => validatePart({ text: 'x', data: {} }), 'InvalidPartError');
throwsNamed(() => validatePart({ raw: 'AA==' }), 'ContentTypeNotSupportedError');
throwsNamed(() => validatePart({ url: 'https://example.test/result' }), 'ContentTypeNotSupportedError');
throwsNamed(() => validatePart({ text: 'x', extensions: ['unsupported'] }), 'ExtensionSupportRequiredError');
throwsNamed(() => validatePart({ text: 'bad\u0000text' }), 'InvalidPartError');
throwsNamed(() => validatePart({ text: 'x', mediaType: 'image/png' }), 'ContentTypeNotSupportedError');
throwsNamed(() => validateMessage({ ...baseMessage, parts: [] }), 'InvalidRequestError');
throwsNamed(() => validateMessage({ ...baseMessage, messageId: 'bad id' }), 'InvalidRequestError');
throwsNamed(() => validatePart({ text: 'x'.repeat(20_000) }), 'InvalidPartError');
throwsNamed(() => validatePart({ data: { value: 'x'.repeat(20_000) }, mediaType: 'application/json' }), 'InvalidPartError');
throwsNamed(() => validatePart({
  data: { toJSON: () => undefined },
  mediaType: 'application/json',
}), 'InvalidPartError');
assert.deepEqual(validateSendRequest({
  message: baseMessage,
  idempotencyKey: 'idem-1',
  inputMode: 'text/plain',
  outputMode: 'text/plain',
  deadline: '2026-08-18T12:00:00.000Z',
  depth: 0,
  fanOutIndex: 0,
}, scope, { nowMs: Date.parse('2026-08-18T11:00:00.000Z') }).idempotencyKey, 'idem-1');
throwsNamed(() => validateSendRequest({ message: baseMessage, idempotencyKey: 'idem-1', inputMode: 'image/png' }, scope), 'ContentTypeNotSupportedError');
throwsNamed(() => validateSendRequest({ message: baseMessage, idempotencyKey: 'idem-1', stream: true }, scope), 'UnsupportedOperationError');
throwsNamed(() => validateSendRequest({ message: baseMessage, idempotencyKey: 'idem-1', extension: 'x' }, scope), 'ExtensionSupportRequiredError');

// IDs, cursors, pages, deadlines, depth, fan-out, and artifacts are bounded and strict.
assert.equal(validateIdempotencyKey('idem-1'), 'idem-1');
throwsNamed(() => validateIdempotencyKey('x'.repeat(300)), 'InvalidRequestError');
assert.equal(validateCursor('opaque_cursor-1'), 'opaque_cursor-1');
throwsNamed(() => validateCursor('bad cursor'), 'InvalidRequestError');
assert.equal(validatePageLimit(25), 25);
throwsNamed(() => validatePageLimit(0), 'InvalidRequestError');
throwsNamed(() => validatePageLimit(101), 'InvalidRequestError');
assert.equal(validateDeadline('2026-08-18T12:00:00.000Z', { nowMs: Date.parse('2026-08-18T11:00:00.000Z') }), '2026-08-18T12:00:00.000Z');
throwsNamed(() => validateDeadline('not-a-date', { nowMs: Date.parse('2026-08-18T11:00:00.000Z') }), 'InvalidRequestError');
throwsNamed(() => validateDeadline('2026-08-20T12:00:00.000Z', { nowMs: Date.parse('2026-08-18T11:00:00.000Z') }), 'DeadlineExceededError');
assert.doesNotThrow(() => validateGraphLimits({ depth: 2, fanOutIndex: 1, maxDepth: 4, maxFanOut: 3 }));
throwsNamed(() => validateGraphLimits({ depth: 5, fanOutIndex: 0, maxDepth: 4, maxFanOut: 3 }), 'GraphLimitExceededError');
throwsNamed(() => validateGraphLimits({ depth: 0, fanOutIndex: 3, maxDepth: 4, maxFanOut: 3 }), 'GraphLimitExceededError');
assert.doesNotThrow(() => validateArtifactRef(artifact, scope));
throwsNamed(() => validateArtifactRef({ ...artifact, scope: { ...scope, tenantId: 'tenant-b' } }, scope), 'ScopeMismatchError');
throwsNamed(() => validateArtifactRef({ ...artifact, sha256: 'not-a-sha' }, scope), 'InvalidArtifactRefError');
throwsNamed(() => validateArtifactRef({ ...artifact, byteSize: 0 }, scope), 'InvalidArtifactRefError');
throwsNamed(() => validateArtifactRef({ ...artifact, name: '../secret.txt' }, scope), 'InvalidArtifactRefError');
throwsNamed(() => validateArtifactRef({ ...artifact, metadata: { apiKey: 'do-not-store' } }, scope), 'InvalidArtifactRefError');

// Internal job states map to the A2A wire vocabulary, while terminal states cannot change.
assert.equal(mapInternalTaskStatus('queued'), 'submitted');
assert.equal(mapInternalTaskStatus('awaiting_approval'), 'input-required');
assert.equal(mapInternalTaskStatus('running'), 'working');
assert.equal(mapInternalTaskStatus('completed'), 'completed');
assert.equal(mapInternalTaskStatus('failed'), 'failed');
assert.equal(mapInternalTaskStatus('cancelled'), 'canceled');
const completedTask = validateTask({
  id: 'task-1',
  contextId: 'context-1',
  status: 'completed',
  scope,
  artifacts: [artifact],
});
assert.equal(completedTask.status, 'completed');
const completedChildArtifactTask = validateTask({
  ...completedTask,
  artifacts: [childArtifact],
});
assert.equal(completedChildArtifactTask.artifacts[0]?.taskId, 'task-1');
assert.equal(completedChildArtifactTask.artifacts[0]?.sourceTaskId, 'child-task-1');
throwsNamed(() => validateTask({
  ...completedTask,
  artifacts: [{ ...childArtifact, taskId: 'task-other' }],
}), 'InvalidTaskError');
throwsNamed(() => validateTask({ ...completedTask, artifacts: [] }), 'InvalidTaskError');
throwsNamed(() => assertTaskTransition(completedTask, { ...completedTask, status: 'working' }), 'TerminalStateImmutableError');
throwsNamed(() => assertTaskTransition(completedTask, {
  ...completedTask,
  artifacts: [{ ...artifact, name: 'changed.txt' }],
}), 'TerminalStateImmutableError');
throwsNamed(() => assertTaskTransition(completedTask, {
  ...completedTask,
  error: 'late mutation',
}), 'TerminalStateImmutableError');
const reorderedTerminalTask = validateTask({
  ...completedTask,
  artifacts: [{ ...artifact, metadata: { result: { label: 'bounded', count: 1 } } }],
});
assert.doesNotThrow(() => assertTaskTransition(reorderedTerminalTask, {
  ...reorderedTerminalTask,
  artifacts: [{ ...reorderedTerminalTask.artifacts[0], metadata: { result: { count: 1, label: 'bounded' } } }],
}));
assert.doesNotThrow(() => assertTaskTransition(completedTask, completedTask));

// Redaction is deterministic, bounded, and applied before truncation.
const safe = redactAndBoundText('Authorization: Bearer very-secret-value\n' + 'x'.repeat(300), 120);
assert.equal(safe.includes('very-secret-value'), false);
assert.equal(safe.length <= 120, true);
const multiRedacted = redactAndBoundText(
  'Authorization: Bearer bearer-one Authorization: Bearer bearer-two '
  + 'token=token-one token=token-two secret:secret-one secret:secret-two '
  + 'password=password-one password=password-two',
);
for (const value of ['bearer-one', 'bearer-two', 'token-one', 'token-two', 'secret-one', 'secret-two', 'password-one', 'password-two']) {
  assert.equal(multiRedacted.includes(value), false, `secret leaked: ${value}`);
}
assert.ok((multiRedacted.match(/\[REDACTED\]/g)?.length ?? 0) >= 8);
assert.equal(redactAndBoundText('line\u0000break'), 'line�break');
let throwsNamedCallCount = 0;
throwsNamed(() => {
  throwsNamedCallCount += 1;
  throw new A2AContractError('InvalidRequestError', 'single invocation');
}, 'InvalidRequestError');
assert.equal(throwsNamedCallCount, 1);
const error = throwsNamed(() => validateA2AVersion('9.9'), 'VersionNotSupportedError');
assert.equal(JSON.stringify(error.toJSON()).includes('very-secret'), false);
assert.equal(error.toJSON().error.name, 'VersionNotSupportedError');
const detailedError = new A2AContractError('InvalidRequestError', 'safe', {
  details: { token: 'secret-token', safe: 'Authorization: Bearer secret-bearer' },
}).toJSON();
assert.equal(detailedError.error.details?.token, '[REDACTED]');
assert.equal(String(detailedError.error.details?.safe).includes('secret-bearer'), false);

console.log('a2a-core-contract-test: PASS');
