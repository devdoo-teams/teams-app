import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  A2AStore,
  A2AStoreConflictError,
} from '../src/server/a2a-store.js';
import type { A2AScope } from '../src/server/a2a-contract.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-store-test-'));
const storePath = path.join(root, 'store.json');
const scope: A2AScope = {
  tenantId: 'tenant-a',
  requesterId: 'requester-a',
  conversationId: 'conversation-a',
};
const otherScope: A2AScope = { ...scope, requesterId: 'requester-b' };
const message = {
  messageId: 'message-a',
  role: 'user' as const,
  parts: [{ text: 'Run a bounded Core task.', mediaType: 'text/plain' as const }],
};

try {
  const store = new A2AStore(storePath);
  await store.initialize();
  const first = await store.createOrGetTask({
    scope,
    contextId: 'context-a',
    message,
    idempotencyKey: 'idem-a',
    fingerprint: 'fingerprint-a',
  });
  assert.equal(first.status, 'submitted');

  const duplicate = await store.createOrGetTask({
    scope,
    contextId: 'context-a',
    message,
    idempotencyKey: 'idem-a',
    fingerprint: 'fingerprint-a',
  });
  assert.equal(duplicate.id, first.id);
  await assert.rejects(
    store.createOrGetTask({
      scope,
      contextId: 'context-a',
      message,
      idempotencyKey: 'idem-a',
      fingerprint: 'fingerprint-b',
    }),
    (error: unknown) => error instanceof A2AStoreConflictError,
  );

  assert.deepEqual(store.getTask(first.id, scope)?.scope, scope);
  assert.equal(store.getTask(first.id, otherScope), undefined);
  assert.deepEqual(store.getMessageByIdempotency(scope, 'idem-a'), {
    messageId: 'message-a',
    role: 'user',
    partCount: 1,
    contextId: 'context-a',
    taskId: first.id,
  });

  await store.bindAgentJob(first.id, scope, 'provider-job-a');
  await store.bindAgentJob(first.id, scope, 'provider-job-a');
  assert.equal(store.getAgentJobId(first.id, scope), 'provider-job-a');
  await assert.rejects(
    store.bindAgentJob(first.id, scope, 'provider-job-b'),
    (error: unknown) => error instanceof A2AStoreConflictError
      && error.message === 'The A2A task is already bound to a different agent job.'
      && error.taskId === first.id,
  );
  assert.equal(store.getAgentJobId(first.id, scope), 'provider-job-a');

  const concurrent = await Promise.all(Array.from({ length: 8 }, () => store.createOrGetTask({
    scope,
    contextId: 'context-concurrent',
    message: { ...message, messageId: 'message-concurrent' },
    idempotencyKey: 'idem-concurrent',
    fingerprint: 'fingerprint-concurrent',
  })));
  assert.equal(new Set(concurrent.map((task) => task.id)).size, 1);

  for (const [index, key] of ['idem-b', 'idem-c', 'idem-d'].entries()) {
    await store.createOrGetTask({
      scope,
      contextId: `context-${index + 2}`,
      message: { ...message, messageId: `message-${index + 2}` },
      idempotencyKey: key,
      fingerprint: `fingerprint-${index + 2}`,
    });
  }
  const pageOne = store.listTasks(scope, 2);
  assert.equal(pageOne.tasks.length, 2);
  assert.ok(pageOne.nextCursor);
  const pageTwo = store.listTasks(scope, 2, pageOne.nextCursor);
  assert.ok(pageTwo.tasks.length > 0);
  assert.equal(new Set([...pageOne.tasks, ...pageTwo.tasks].map((task) => task.id)).size, pageOne.tasks.length + pageTwo.tasks.length);

  const working = await store.transitionTask(first.id, scope, 'working');
  assert.equal(working?.status, 'working');
  const canceled = await store.cancelTask(first.id, scope);
  assert.equal(canceled?.status, 'canceled');
  await assert.rejects(
    store.transitionTask(first.id, scope, { status: 'canceled', artifacts: [], error: 'late mutation' }),
    /terminal|immutable/i,
  );
  assert.equal(store.getTask(first.id, scope)?.error, undefined);

  const reloaded = new A2AStore(storePath);
  await reloaded.initialize();
  assert.deepEqual(
    reloaded.listTasks(scope, 100).tasks.map((task) => task.id),
    store.listTasks(scope, 100).tasks.map((task) => task.id),
  );
  assert.equal(reloaded.getAgentJobId(first.id, scope), 'provider-job-a');

  const rollbackPath = path.join(root, 'rollback.json');
  const rollbackStore = new A2AStore(rollbackPath);
  await rollbackStore.initialize();
  const rollbackTask = await rollbackStore.createOrGetTask({
    scope,
    contextId: 'context-rollback',
    message: { ...message, messageId: 'message-rollback' },
    idempotencyKey: 'idem-rollback',
    fingerprint: 'fingerprint-rollback',
  });
  const backupPath = `${rollbackPath}.backup`;
  await fs.rename(rollbackPath, backupPath);
  await fs.mkdir(rollbackPath);
  await assert.rejects(rollbackStore.transitionTask(rollbackTask.id, scope, 'working'));
  assert.equal(rollbackStore.getTask(rollbackTask.id, scope)?.status, 'submitted');
  await fs.rm(rollbackPath, { recursive: true, force: true });
  await fs.rename(backupPath, rollbackPath);

  const malformedPath = path.join(root, 'malformed.json');
  await fs.writeFile(malformedPath, '{not-json', 'utf8');
  await assert.rejects(new A2AStore(malformedPath).initialize());

  console.log('a2a-store-test: PASS');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
