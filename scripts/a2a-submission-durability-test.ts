import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import express from 'express';

import {
  createCoreAgentCard,
  type A2AScope,
  type A2ATask,
} from '../src/server/a2a-contract.js';
import { createA2AExecutionAdapter } from '../src/server/a2a-execution.js';
import { createA2ARouter } from '../src/server/a2a-route.js';
import { deriveA2AHttpScope } from '../src/server/a2a-http-scope.js';
import { A2AStore } from '../src/server/a2a-store.js';

type ResponseSnapshot = { status: number; body: string };
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-submission-durability-'));
const storePath = path.join(root, 'store.json');
const authenticatedScope: A2AScope = {
  tenantId: 'tenant-a',
  requesterId: 'requester-a',
  conversationId: 'teams-chat-a',
};
const taskScope = deriveA2AHttpScope(authenticatedScope, 'idem-durable');

class BindingGateStore extends A2AStore {
  readonly bindingEntered = deferred<void>();
  readonly allowBinding = deferred<void>();

  override async bindAgentJob(id: string, scope: A2AScope, agentJobId: string): Promise<A2ATask | undefined> {
    this.bindingEntered.resolve();
    await this.allowBinding.promise;
    return super.bindAgentJob(id, scope, agentJobId);
  }
}

const store = new BindingGateStore(storePath);
await store.initialize();
const terminalJob = deferred<{ id: string; status: 'completed'; result: string }>();
const agentService = {
  async runForCopilot(input: {
    onSubmitted?: (job: { id: string; status: string }) => Promise<void> | void;
  }) {
    await input.onSubmitted?.({ id: 'job-durable', status: 'running' });
    return terminalJob.promise;
  },
} as never;

const adapter = createA2AExecutionAdapter({
  store,
  agentService,
  timeoutMs: 5_000,
});
const app = express();
app.use(createA2ARouter({
  store,
  agentCard: createCoreAgentCard({
    agentId: 'teams-core',
    name: 'Teams Core Agent',
    description: 'Bounded authenticated Teams task execution.',
    version: '1.0.67',
    endpoint: 'https://core.example.test',
  }),
  resolveScope: () => authenticatedScope,
  onTaskSubmitted: (event) => adapter(event),
}));

const server = await new Promise<http.Server>((resolve) => {
  const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
});
const address = server.address();
assert.ok(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}`;
let acceptedPromise: Promise<ResponseSnapshot> | undefined;
let responseSettled = false;

try {
  acceptedPromise = request(baseUrl, 'POST', '/message:send', {
    idempotencyKey: 'idem-durable',
    message: {
      messageId: 'message-durable',
      role: 'user',
      contextId: 'context-durable',
      parts: [{ text: 'Run a durable submission test.', mediaType: 'text/plain' }],
    },
  }).then((response) => {
    responseSettled = true;
    return response;
  });

  await withTimeout(store.bindingEntered.promise, 1_000, 'binding callback was not reached');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(
    responseSettled,
    false,
    'the 202 response must remain pending until the agent-job binding is durable',
  );

  const beforeBinding = new A2AStore(storePath);
  await beforeBinding.initialize();
  assert.equal(
    beforeBinding.getAgentJobId((await taskId(store)), taskScope),
    undefined,
    'the gated binding must not be visible before its persistence step runs',
  );

  store.allowBinding.resolve();
  const accepted = await acceptedPromise;
  assert.equal(accepted.status, 202);

  const reopenedStore = new A2AStore(storePath);
  await reopenedStore.initialize();
  assert.equal(
    reopenedStore.getAgentJobId(JSON.parse(accepted.body).id, taskScope),
    'job-durable',
    'reopening the store after the 202 response must retain the agent-job binding',
  );

  terminalJob.resolve({ id: 'job-durable', status: 'completed', result: 'durable result' });
  console.log('a2a-submission-durability-test: PASS');
} finally {
  store.allowBinding.resolve();
  terminalJob.resolve({ id: 'job-durable', status: 'completed', result: 'cleanup result' });
  await acceptedPromise?.catch(() => undefined);
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await removeEventually(root);
}

async function taskId(currentStore: A2AStore): Promise<string> {
  const task = currentStore.listTasks(taskScope).tasks[0];
  assert.ok(task);
  return task.id;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
