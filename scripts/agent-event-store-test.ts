import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  AgentEventStore,
  AgentEventStoreConflictError,
  type AgentEventInput,
} from '../src/server/agent-event-store.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-agent-events-'));
const scope = {
  requesterId: 'user-a',
  conversationId: 'conversation-a',
  tenantId: 'tenant-a',
} as const;
const otherScope = { ...scope, tenantId: 'tenant-b' };

function input(overrides: Partial<AgentEventInput> = {}): AgentEventInput {
  return {
    jobId: 'task-1',
    scope,
    provider: 'codex',
    status: 'running',
    kind: 'progress',
    phase: 'analysis',
    correlationId: 'progress-analysis',
    message: '작업을 분석하고 있습니다.',
    ...overrides,
  };
}

const filePath = path.join(root, 'events.json');
const store = new AgentEventStore(filePath);
await store.initialize();

const first = await store.append(input({
  message: 'Authorization: Bearer abcdefghijklmnop; password=secret-value',
}));
assert.equal(first.sequence, 1);
assert.equal(first.status, 'running');
assert.match(first.message, /Authorization: \[REDACTED\]|Authorization: Bearer \[REDACTED\]/i);
assert.doesNotMatch(first.message, /secret-value|abcdefghijklmnop/);

const replay = await store.append(input({
  message: 'Authorization: Bearer abcdefghijklmnop; password=secret-value',
}));
assert.deepEqual(replay, first, 'the same correlation key is idempotent');
assert.equal(store.list(scope, 'task-1').length, 1);

await assert.rejects(
  () => store.append(input({ message: 'different event body' })),
  (error: unknown) => error instanceof AgentEventStoreConflictError,
  'a correlation key cannot be reused for a different event',
);

await store.append(input({
  correlationId: 'progress-tools',
  phase: 'tools',
  message: '도구를 실행하고 있습니다.',
}));
await store.append(input({
  correlationId: 'completed',
  kind: 'result',
  phase: 'completion',
  status: 'completed',
  message: '완료되었습니다.',
}));

assert.equal(store.list(scope, 'task-1').length, 3);
assert.equal(store.list(otherScope, 'task-1').length, 0, 'tenant scope isolates event history');
assert.equal(store.list(scope, 'task-other').length, 0, 'job scope isolates event history');

const restarted = new AgentEventStore(filePath);
await restarted.initialize();
assert.equal(restarted.list(scope, 'task-1').length, 3, 'events survive a process restart');
assert.deepEqual(
  restarted.list(scope, 'task-1').map((event) => event.sequence),
  [1, 2, 3],
  'global sequence remains monotonic after reload',
);

const boundedPath = path.join(root, 'bounded.json');
const bounded = new AgentEventStore(boundedPath, { maxEvents: 2 });
await bounded.initialize();
await bounded.append(input({ jobId: 'task-bounded', correlationId: 'one', message: 'one' }));
await bounded.append(input({ jobId: 'task-bounded', correlationId: 'two', message: 'two' }));
await bounded.append(input({ jobId: 'task-bounded', correlationId: 'three', message: 'three' }));
assert.deepEqual(
  bounded.list(scope, 'task-bounded').map((event) => event.message),
  ['two', 'three'],
  'bounded retention keeps the newest audit events',
);
assert.equal(bounded.snapshot().droppedEvents, 1);

const invalidPath = path.join(root, 'invalid.json');
const invalidBytes = Buffer.from(JSON.stringify({ schemaVersion: 'wrong', events: [] }));
await fs.writeFile(invalidPath, invalidBytes);
const invalid = new AgentEventStore(invalidPath);
await assert.rejects(() => invalid.initialize(), /Invalid agent event store/);
assert.deepEqual(await fs.readFile(invalidPath), invalidBytes, 'invalid persisted state is not overwritten');

const fileStat = await fs.stat(filePath);
const directoryStat = await fs.stat(path.dirname(filePath));
assert.equal(fileStat.mode & 0o777, 0o600);
assert.equal(directoryStat.mode & 0o777, 0o700);

console.log(JSON.stringify({
  status: 'PASS',
  eventCount: restarted.list(scope, 'task-1').length,
  droppedEvents: bounded.snapshot().droppedEvents,
}));
