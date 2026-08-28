import assert from 'node:assert/strict';

import express from 'express';

import { createA2AV1JsonRpcRouter } from '../src/server/a2a-jsonrpc-route.js';

const app = express();
const router = createA2AV1JsonRpcRouter({
  store: {} as never,
  authenticate: (_request, _response, next) => next(),
  resolveScope: () => ({
    tenantId: 'teams-tenant',
    requesterId: 'teams-requester',
    conversationId: 'teams-conversation',
  }),
  execution: {
    submit: async () => {
      throw new Error('streaming-unsupported test must not submit a task');
    },
    cancel: async () => {
      throw new Error('streaming-unsupported test must not cancel a task');
    },
  },
});
app.use('/a2a', router);

const server = app.listen(0, '127.0.0.1');
try {
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  for (const [index, method] of ['SendStreamingMessage', 'SubscribeToTask'].entries()) {
    const response = await fetch(`http://127.0.0.1:${address.port}/a2a`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'a2a-version': '1.0',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: index + 1, method, params: {} }),
    });
    const body = await response.json() as { error?: { code?: number; message?: string } };
    assert.equal(response.status, 200, `${method} must use a JSON-RPC error response`);
    assert.deepEqual(body.error, {
      code: -32004,
      message: 'This operation is not supported',
    }, `${method} must serialize UnsupportedOperationError`);
  }

  console.log('a2a-streaming-unsupported-test: PASS');
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
