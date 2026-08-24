import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import express from 'express';

import {
  createCoreAgentCard,
  type A2AScope,
} from '../src/server/a2a-contract.js';
import { createA2AExecutionAdapter } from '../src/server/a2a-execution.js';
import { createA2ARouter } from '../src/server/a2a-route.js';
import { A2AStore } from '../src/server/a2a-store.js';
import { deriveA2AHttpScope } from '../src/server/a2a-http-scope.js';

type ResponseSnapshot = { status: number; body: string };
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-parent-lifecycle-test-'));
const storePath = path.join(root, 'store.json');
const authenticatedScope: A2AScope = {
  tenantId: 'tenant-a',
  requesterId: 'requester-a',
  conversationId: 'teams-chat-a',
};
const otherScope: A2AScope = {
  tenantId: 'tenant-a',
  requesterId: 'requester-b',
  conversationId: 'teams-chat-b',
};
const card = createCoreAgentCard({
  agentId: 'teams-core',
  name: 'Teams Core Agent',
  description: 'Deterministic HTTP+JSON task contract.',
  version: '1.0.44',
  endpoint: 'https://core.example.test',
});

const executionStore = new A2AStore(storePath);
await executionStore.initialize();

const terminalJob = deferred<{ id: string; status: 'completed'; result: string }>();
const notifyValues: boolean[] = [];
const cancelCalls: Array<{ id: string; notify?: boolean }> = [];
const jobs = new Map<string, { id: string; status: string; result?: string; error?: string }>();

const agentService = {
  async runForCopilot(input: {
    notify?: boolean;
    onSubmitted?: (job: { id: string; status: string }) => Promise<void> | void;
  }) {
    notifyValues.push(input.notify ?? true);
    const job = { id: 'job-a', status: 'running' as const };
    jobs.set(job.id, job);
    await input.onSubmitted?.(job);
    const result = await terminalJob.promise;
    jobs.set(result.id, result);
    return result;
  },
  async cancelStrict(id: string, _scope: A2AScope, options?: { notify?: boolean }) {
    cancelCalls.push({ id, notify: options?.notify });
    const job = jobs.get(id) ?? { id, status: 'cancelled' };
    const cancelled = { ...job, status: 'cancelled' as const };
    jobs.set(id, cancelled);
    return cancelled;
  },
  get(id: string) {
    return jobs.get(id);
  },
} as const;

const executionAdapter = createA2AExecutionAdapter({
  store: executionStore,
  agentService: agentService as never,
  timeoutMs: 5_000,
});

const app = express();
app.use(createA2ARouter({
  store: executionStore,
  agentCard: card,
  resolveScope: () => authenticatedScope,
  onTaskSubmitted: (event) => executionAdapter(event),
  onTaskCancel: ({ task }) => executionAdapter.cancel({ taskId: task.id, scope: task.scope }),
}));

const server = await new Promise<http.Server>((resolve) => {
  const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
});
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;

try {
  const created = await request(baseUrl, 'POST', '/message:send', {
    idempotencyKey: 'idem-a',
    message: {
      messageId: 'message-a',
      role: 'user',
      contextId: 'context-a',
      parts: [{ text: 'Run a bounded Core task.', mediaType: 'text/plain' }],
    },
  });
  assert.equal(created.status, 202);
  const createdTask = JSON.parse(created.body) as { id: string; scope: A2AScope };
  assert.equal(Object.hasOwn(JSON.parse(created.body) as object, 'agentJobId'), false);
  const taskScope = deriveA2AHttpScope(authenticatedScope, 'idem-a');
  assert.deepEqual(createdTask.scope, taskScope);

  await waitFor(async () => executionStore.getAgentJobId(createdTask.id, taskScope) === 'job-a');
  assert.deepEqual(notifyValues, [false]);

  const reopenedStore = new A2AStore(storePath);
  await reopenedStore.initialize();
  assert.equal(reopenedStore.getAgentJobId(createdTask.id, taskScope), 'job-a');
  assert.equal(reopenedStore.getAgentJobId(createdTask.id, otherScope), undefined);

  const cancelled = await request(baseUrl, 'POST', `/tasks/${createdTask.id}:cancel`, {});
  assert.equal(cancelled.status, 200);
  assert.equal(JSON.parse(cancelled.body).status, 'canceled');
  assert.deepEqual(cancelCalls, [{ id: 'job-a', notify: false }]);

  terminalJob.resolve({ id: 'job-a', status: 'completed', result: 'late result' });
  await waitFor(async () => executionStore.getTask(createdTask.id, taskScope)?.status === 'canceled');
  const cancelledTask = executionStore.getTask(createdTask.id, taskScope);
  assert.equal(cancelledTask?.status, 'canceled');
  assert.equal(cancelledTask?.artifacts.length, 0);

  const cancelledAgain = await request(baseUrl, 'POST', `/tasks/${createdTask.id}:cancel`, {});
  assert.equal(cancelledAgain.status, 200);
  assert.deepEqual(cancelCalls, [{ id: 'job-a', notify: false }]);

  const reconcileStore = new A2AStore(path.join(root, 'reconcile.json'));
  await reconcileStore.initialize();
  const missingScope = deriveA2AHttpScope(authenticatedScope, 'idem-missing');
  const missingTask = await reconcileStore.createOrGetTask({
    scope: missingScope,
    contextId: 'context-missing',
    message: {
      messageId: 'message-missing',
      role: 'user',
      contextId: 'context-missing',
      parts: [{ text: 'Missing child', mediaType: 'text/plain' }],
    },
    idempotencyKey: 'idem-missing',
    fingerprint: 'fingerprint-missing',
  });
  await reconcileStore.transitionTask(missingTask.id, missingScope, 'working');
  await reconcileStore.bindAgentJob(missingTask.id, missingScope, 'job-missing');

  const cancelledScope = deriveA2AHttpScope(authenticatedScope, 'idem-cancelled');
  const cancelledParent = await reconcileStore.createOrGetTask({
    scope: cancelledScope,
    contextId: 'context-cancelled',
    message: {
      messageId: 'message-cancelled',
      role: 'user',
      contextId: 'context-cancelled',
      parts: [{ text: 'Cancelled child', mediaType: 'text/plain' }],
    },
    idempotencyKey: 'idem-cancelled',
    fingerprint: 'fingerprint-cancelled',
  });
  await reconcileStore.transitionTask(cancelledParent.id, cancelledScope, 'working');
  await reconcileStore.bindAgentJob(cancelledParent.id, cancelledScope, 'job-cancelled');

  const reconcileAdapter = createA2AExecutionAdapter({
    store: reconcileStore,
    agentService: {
      get(id: string) {
        if (id === 'job-cancelled') return { id, status: 'cancelled' };
        return undefined;
      },
      async runForCopilot() {
        throw new Error('not expected');
      },
      async cancelStrict() {
        throw new Error('not expected');
      },
    } as never,
    timeoutMs: 5_000,
  });
  await reconcileAdapter.initialize();

  assert.equal(reconcileStore.getTask(missingTask.id, missingScope)?.status, 'failed');
  assert.equal(reconcileStore.getTask(cancelledParent.id, cancelledScope)?.status, 'canceled');

  console.log('a2a-parent-lifecycle-test: PASS');
} finally {
  terminalJob.resolve({ id: 'job-a', status: 'completed', result: 'cleanup result' });
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await removeEventually(root);
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('condition not met before timeout');
}

async function removeEventually(target: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (true) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOTEMPTY' || Date.now() >= deadline) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

async function request(
  baseUrl: string,
  method: string,
  route: string,
  body?: unknown,
): Promise<ResponseSnapshot> {
  const url = new URL(route, baseUrl);
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method,
      headers: payload === undefined
        ? {}
        : {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload),
          },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.setTimeout(5_000, () => request.destroy(new Error('request timeout')));
    request.on('error', reject);
    if (payload !== undefined) request.write(payload);
    request.end();
  });
}
