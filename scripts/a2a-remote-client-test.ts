import assert from 'node:assert/strict';

import {
  A2ARemoteClientError,
  createA2ARemoteClient,
  serializeA2ARemoteError,
  type A2ARemoteAgentCard,
  type A2ARemoteFetch,
} from '../src/server/a2a-remote-client.js';

type FetchCall = {
  url: URL;
  init: RequestInit;
};

const validCard: A2ARemoteAgentCard = {
  name: 'Remote Teams Core Agent',
  description: 'Bounded remote A2A agent.',
  version: '1.0.0',
  supportedInterfaces: [{
    url: 'https://agent.example.test/a2a/v1',
    protocolBinding: 'JSONRPC',
    protocolVersion: '1.0',
  }],
  capabilities: {
    streaming: false,
    pushNotifications: false,
    extendedAgentCard: false,
  },
  securitySchemes: {
    teamsOAuth: {
      oauth2SecurityScheme: {
        flows: {
          authorizationCode: {
            authorizationUrl: 'https://login.example.test/authorize',
            tokenUrl: 'https://login.example.test/token',
            scopes: { access_as_user: 'Delegated access.' },
          },
        },
      },
    },
  },
  securityRequirements: [{ teamsOAuth: ['access_as_user'] }],
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [{
    id: 'teams-core-tasks',
    name: 'Teams Core tasks',
    description: 'Bounded tasks.',
    tags: ['teams', 'a2a'],
  }],
};

const completedTask = {
  id: 'task-1',
  contextId: 'context-1',
  status: { state: 'TASK_STATE_COMPLETED' },
};

const calls: FetchCall[] = [];
let nextResponse: (url: URL, init: RequestInit) => Promise<Response> | Response;

const mockFetch: A2ARemoteFetch = async (input, init = {}) => {
  const url = new URL(String(input));
  calls.push({ url, init });
  return nextResponse(url, init);
};

await testHappyPath();
await testDirectMessageResponse();
await testMissingAuthenticationProvider();
await testAuthenticationFailureIsSafe();
await testInvalidCardSecurityMetadata();
await testUnsupportedProtocolAndSsrf();
await testTimeout();
await testJsonRpcErrorSerialization();

console.log('a2a-remote-client-test: PASS');

async function testHappyPath(): Promise<void> {
  calls.length = 0;
  nextResponse = (url, init) => {
    if (url.pathname === '/.well-known/agent-card.json') {
      return jsonResponse(validCard);
    }
    assert.equal(url.pathname, '/a2a/v1');
    assert.equal(init.method, 'POST');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('a2a-version'), '1.0');
    assert.equal(headers.get('authorization'), 'Bearer test-token');
    assert.equal(headers.get('content-type'), 'application/json');
    const request = JSON.parse(String(init.body)) as Record<string, unknown>;
    assert.equal(request.jsonrpc, '2.0');
    assert.equal(request.method, 'SendMessage');
    const params = request.params as Record<string, unknown>;
    const message = params.message as Record<string, unknown>;
    assert.deepEqual(Object.keys(params).sort(), ['message'],
      'SendMessage params must match the official request object and must not add a top-level idempotency extension');
    assert.equal(message.role, 'ROLE_USER');
    assert.deepEqual(message.parts, [{ text: 'Run the task.', mediaType: 'text/plain' }]);
    return jsonResponse({ jsonrpc: '2.0', id: request.id, result: { task: completedTask } });
  };

  const client = await createA2ARemoteClient('https://agent.example.test', {
    fetch: mockFetch,
    bearerTokenProvider: () => 'test-token',
    requestTimeoutMs: 100,
  });
  const sent = await client.sendMessage({
    messageId: 'message-1',
    parts: [{ text: 'Run the task.' }],
  });
  assert.deepEqual(sent, completedTask);
  assert.deepEqual(calls.map((call) => [call.url.pathname, call.init.method]), [
    ['/.well-known/agent-card.json', 'GET'],
    ['/a2a/v1', 'POST'],
  ]);

  nextResponse = (url, init) => {
    assert.equal(url.pathname, '/a2a/v1');
    const request = JSON.parse(String(init.body)) as { method: string; id: string };
    if (request.method === 'GetTask') {
      assert.deepEqual(requestBody(init).params, { id: 'task-1', historyLength: 0 });
      return jsonResponse({ jsonrpc: '2.0', id: request.id, result: completedTask });
    }
    if (request.method === 'ListTasks') {
      assert.deepEqual(requestBody(init).params, { pageSize: 10, historyLength: 0 });
      return jsonResponse({
        jsonrpc: '2.0',
        id: request.id,
        result: { tasks: [completedTask], pageSize: 10, nextPageToken: '' },
      });
    }
    assert.equal(request.method, 'CancelTask');
    assert.deepEqual(requestBody(init).params, { id: 'task-1' });
    return jsonResponse({ jsonrpc: '2.0', id: request.id, result: completedTask });
  };
  assert.deepEqual(await client.getTask('task-1'), completedTask);
  assert.deepEqual(await client.listTasks({ pageSize: 10 }), {
    tasks: [completedTask],
    pageSize: 10,
    nextPageToken: '',
  });
  assert.deepEqual(await client.cancelTask('task-1'), completedTask);
}

async function testMissingAuthenticationProvider(): Promise<void> {
  calls.length = 0;
  nextResponse = (url) => url.pathname === '/.well-known/agent-card.json'
    ? jsonResponse(validCard)
    : jsonResponse({ jsonrpc: '2.0', id: 1, result: { task: completedTask } });
  const client = await createA2ARemoteClient('https://agent.example.test', { fetch: mockFetch });
  const error = await expectRemoteError(() => client.getTask('task-1'), 'AUTHENTICATION_REQUIRED');
  assert.equal(calls.length, 1, 'missing operation credentials must not make an unauthenticated RPC request');
  assert.equal(error.toJSON().message.includes('token'), false);
}

async function testDirectMessageResponse(): Promise<void> {
  calls.length = 0;
  nextResponse = (url, init) => {
    if (url.pathname === '/.well-known/agent-card.json') return jsonResponse(validCard);
    const request = JSON.parse(String(init.body)) as { id: string; method: string };
    assert.equal(request.method, 'SendMessage');
    return jsonResponse({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        message: {
          messageId: 'response-message-1',
          role: 'ROLE_AGENT',
          contextId: 'context-1',
          parts: [{ text: 'direct response', mediaType: 'text/plain' }],
        },
      },
    });
  };

  const client = await createA2ARemoteClient('https://agent.example.test', {
    fetch: mockFetch,
    bearerTokenProvider: () => 'test-token',
  });
  const response = await client.sendMessage({
    messageId: 'message-direct',
    contextId: 'context-1',
    parts: [{ text: 'Respond directly.' }],
  });
  assert.deepEqual(response, {
    messageId: 'response-message-1',
    role: 'ROLE_AGENT',
    contextId: 'context-1',
    parts: [{ text: 'direct response', mediaType: 'text/plain' }],
  }, 'a valid A2A SendMessage direct response must be returned instead of rejected as an invalid task');
}

async function testAuthenticationFailureIsSafe(): Promise<void> {
  calls.length = 0;
  nextResponse = () => jsonResponse({ error: 'invalid token test-token' }, 401);
  await assert.rejects(
    () => createA2ARemoteClient('https://agent.example.test', {
      fetch: mockFetch,
      bearerTokenProvider: () => 'test-token',
    }),
    (error: unknown) => {
      assert.ok(error instanceof A2ARemoteClientError);
      assert.equal(error.code, 'AUTHENTICATION_FAILED');
      assert.equal(JSON.stringify(serializeA2ARemoteError(error)).includes('test-token'), false);
      return true;
    },
  );
}

async function testInvalidCardSecurityMetadata(): Promise<void> {
  nextResponse = (url) => url.pathname === '/.well-known/agent-card.json'
    ? jsonResponse({ ...validCard, securityRequirements: [{ missingScheme: [] }] })
    : jsonResponse({});
  await expectRemoteError(
    () => createA2ARemoteClient('https://agent.example.test', { fetch: mockFetch }),
    'INVALID_AGENT_CARD',
  );
}

async function testUnsupportedProtocolAndSsrf(): Promise<void> {
  await expectRemoteError(
    () => createA2ARemoteClient('http://agent.example.test', { fetch: mockFetch }),
    'UNSUPPORTED_PROTOCOL',
  );
  await expectRemoteError(
    () => createA2ARemoteClient('https://127.0.0.1', { fetch: mockFetch }),
    'SSRF_BLOCKED',
  );

  nextResponse = (url) => url.pathname === '/.well-known/agent-card.json'
    ? jsonResponse({
      ...validCard,
      supportedInterfaces: [{ ...validCard.supportedInterfaces[0], url: 'https://localhost/a2a/v1' }],
    })
    : jsonResponse({});
  await expectRemoteError(
    () => createA2ARemoteClient('https://agent.example.test', { fetch: mockFetch }),
    'SSRF_BLOCKED',
  );
}

async function testTimeout(): Promise<void> {
  nextResponse = (_url, init) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
  await expectRemoteError(
    () => createA2ARemoteClient('https://agent.example.test', {
      fetch: mockFetch,
      requestTimeoutMs: 5,
    }),
    'TIMEOUT',
  );
}

async function testJsonRpcErrorSerialization(): Promise<void> {
  nextResponse = (url, init) => {
    if (url.pathname === '/.well-known/agent-card.json') return jsonResponse(validCard);
    const request = JSON.parse(String(init.body)) as { id: string };
    return jsonResponse({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32001, message: 'token=test-token must not escape' },
    });
  };
  const client = await createA2ARemoteClient('https://agent.example.test', {
    fetch: mockFetch,
    bearerTokenProvider: () => 'test-token',
  });
  const error = await expectRemoteError(() => client.getTask('task-1'), 'JSON_RPC_ERROR');
  assert.equal(JSON.stringify(serializeA2ARemoteError(error)).includes('test-token'), false);
  assert.equal(JSON.stringify(serializeA2ARemoteError(error)).includes('must not escape'), false);
}

async function expectRemoteError(
  action: () => Promise<unknown>,
  code: A2ARemoteClientError['code'],
): Promise<A2ARemoteClientError> {
  try {
    await action();
  } catch (error) {
    assert.ok(error instanceof A2ARemoteClientError);
    assert.equal(error.code, code);
    return error;
  }
  assert.fail(`expected A2A remote error ${code}`);
}

function requestBody(init: RequestInit): Record<string, unknown> {
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
