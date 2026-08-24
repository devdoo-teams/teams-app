import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { A2AScope } from '../src/server/a2a-contract.js';
import {
  createA2AProductionRuntime,
  type A2AProductionAgent,
} from '../src/server/a2a-production-runtime.js';
import { A2AStore } from '../src/server/a2a-store.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-deadline-cancellation-'));
const scope: A2AScope = {
  tenantId: 'tenant-deadline',
  requesterId: 'requester-deadline',
  conversationId: 'conversation-deadline',
};

try {
  await testDeadlineCancellationPersistsIntentBeforeFinalization();
  console.log('a2a-deadline-cancellation-test: PASS');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

async function testDeadlineCancellationPersistsIntentBeforeFinalization(): Promise<void> {
  const storePath = path.join(root, 'deadline-cancellation.json');
  const store = new A2AStore(storePath);
  await store.initialize();
  const parent = await store.createOrGetTask({
    scope,
    contextId: 'context-deadline-cancellation',
    idempotencyKey: 'parent-deadline-cancellation',
    fingerprint: 'parent-deadline-cancellation-fingerprint',
    message: {
      messageId: 'message-deadline-cancellation',
      role: 'user',
      parts: [{ text: 'Run the bounded child.' }],
    },
  });

  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const agents: readonly A2AProductionAgent[] = [{
    agentId: 'codex-deadline-agent',
    providerId: 'codex-deadline-provider',
    authorize: () => true,
    executeChild: async (input) => {
      await input.bindChild('job-deadline-cancellation');
      markStarted();
      return new Promise<never>(() => undefined);
    },
  }];
  const runtime = createA2AProductionRuntime({
    publicOrigin: 'https://runtime.example.test',
    appVersion: '1.0.67',
    store,
    authenticate: (_request, _response, next) => next(),
    resolveScope: () => scope,
    v026Execution: {
      submit: () => undefined,
      cancel: async ({ task }) => store.cancelTask(task.id, task.scope),
    },
    legacyOnTaskSubmitted: () => undefined,
    legacyOnTaskCancel: async ({ task }) => store.cancelTask(task.id, task.scope),
    coreA2A: { agents },
  });

  const dispatchPromise = runtime.dispatchChildren({
    parentTask: parent,
    scope,
    requests: [{
      key: 'review',
      role: 'reviewer',
      prompt: 'Review the bounded change.',
      agentId: 'codex-deadline-agent',
    }],
    deadlineMs: 50,
    parallelism: 1,
  });
  await started;

  const result = await dispatchPromise;
  assert.equal(result.canceledChildren, 1);

  const task = store.getTask(parent.id, scope);
  const dispatch = store.getDispatchIntent(parent.id, scope);
  assert.equal(task?.status, 'canceled', 'deadline cancellation must finalize the parent task');
  assert.equal(dispatch?.status, 'canceled', 'deadline cancellation must finalize the durable dispatch');
  assert.ok(dispatch?.cancelRequestedAt, 'deadline cancellation must persist cancellation intent');
  assert.ok(dispatch?.children[0]?.cancelAcknowledgedAt,
    'finalization must acknowledge the terminal canceled child after intent is durable');

  const reopened = new A2AStore(storePath);
  await reopened.initialize();
  assert.equal(reopened.getTask(parent.id, scope)?.status, 'canceled');
  assert.equal(reopened.getDispatchIntent(parent.id, scope)?.status, 'canceled');
  assert.ok(reopened.getDispatchIntent(parent.id, scope)?.cancelRequestedAt);
}
