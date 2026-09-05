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
    teamsBearer: {
      httpAuthSecurityScheme: {
        description: 'Teams A2A bearer token.',
        scheme: 'Bearer',
        bearerFormat: 'JWT',
      },
    },
  },
  securityRequirements: [{ schemes: { teamsBearer: [] } }],
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
await testLegacyBearerCardCompatibility();
await testAdvertisedCapabilitiesDoNotBlockBaseRpc();
await testDirectMessageResponse();
await testMissingAuthenticationProvider();
await testAuthenticationFailureIsSafe();
await testInvalidCardSecurityMetadata();
await testPreferredInterfaceMayPrecedeOtherBindings();
await testFirstSupportedJsonRpcInterfaceIsSelected();
await testUnsupportedTrailingInterfaceDoesNotInvalidateSelectedInterface();
await testNoSupportedInterfaceFailsBeforeTokenResolution();
await testSelectedInterfaceTenantIsAppliedToEveryRequest();
await testOptionalCapabilitiesDefaultFalseAndInvalidTypesFail();
await testAgentCardModesAndSkillsFollowProtoJson();
await testUnsupportedProtocolAndSsrf();
await testIpv6LiteralAndRedirectSsrfAreBlockedBeforeFollow();
await testTimeout();
await testAbortSignalPropagatesToRpc();
await testJsonRpcResponseIdMustMatchRequest();
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

async function testLegacyBearerCardCompatibility(): Promise<void> {
  calls.length = 0;
  nextResponse = (url, init) => {
    if (url.pathname === '/.well-known/agent-card.json') {
      return jsonResponse({
        ...validCard,
        securitySchemes: { legacyBearer: { type: 'http', scheme: 'bearer' } },
        securityRequirements: [{ legacyBearer: [] }],
      });
    }
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer legacy-token');
    const request = JSON.parse(String(init.body)) as { id: string; method: string };
    assert.equal(request.method, 'GetTask');
    return jsonResponse({ jsonrpc: '2.0', id: request.id, result: completedTask });
  };

  const client = await createA2ARemoteClient('https://agent.example.test', {
    fetch: mockFetch,
    bearerTokenProvider: () => 'legacy-token',
  });
  assert.deepEqual(await client.getTask('task-1'), completedTask,
    'the explicitly supported legacy HTTP bearer shape must remain interoperable');
}

async function testAdvertisedCapabilitiesDoNotBlockBaseRpc(): Promise<void> {
  calls.length = 0;
  nextResponse = (url, init) => {
    if (url.pathname === '/.well-known/agent-card.json') {
      return jsonResponse({
        ...validCard,
        capabilities: {
          streaming: true,
          pushNotifications: true,
          extendedAgentCard: true,
        },
      });
    }
    const request = JSON.parse(String(init.body)) as { id: string; method: string };
    assert.equal(request.method, 'GetTask');
    return jsonResponse({
      jsonrpc: '2.0',
      id: request.id,
      result: completedTask,
    });
  };

  const client = await createA2ARemoteClient('https://agent.example.test', {
    fetch: mockFetch,
    bearerTokenProvider: () => 'test-token',
  });
  assert.deepEqual(client.card.capabilities, {
    streaming: true,
    pushNotifications: true,
    extendedAgentCard: true,
  });
  assert.deepEqual(await client.getTask('task-1'), completedTask);
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
    ? jsonResponse({ ...validCard, securityRequirements: [{ schemes: { missingScheme: [] } }] })
    : jsonResponse({});
  await expectRemoteError(
    () => createA2ARemoteClient('https://agent.example.test', { fetch: mockFetch }),
    'INVALID_AGENT_CARD',
  );

  nextResponse = (url) => url.pathname === '/.well-known/agent-card.json'
    ? jsonResponse({
      ...validCard,
      securitySchemes: { teamsBearer: { httpAuthSecurityScheme: { bearerFormat: 'JWT' } } },
    })
    : jsonResponse({});
  await expectRemoteError(
    () => createA2ARemoteClient('https://agent.example.test', { fetch: mockFetch }),
    'INVALID_AGENT_CARD',
  );
}

async function testPreferredInterfaceMayPrecedeOtherBindings(): Promise<void> {
  calls.length = 0;
  nextResponse = (url, init) => {
    if (url.pathname === '/.well-known/agent-card.json') {
      return jsonResponse({
        ...validCard,
        supportedInterfaces: [
          validCard.supportedInterfaces[0],
          {
            url: 'https://agent.example.test/a2a/http',
            protocolBinding: 'HTTP+JSON',
            protocolVersion: '1.0',
          },
        ],
      });
    }
    assert.equal(url.pathname, '/a2a/v1', 'RPC must use the preferred first interface');
    const request = JSON.parse(String(init.body)) as { id: string };
    return jsonResponse({ jsonrpc: '2.0', id: request.id, result: completedTask });
  };

  const client = await createA2ARemoteClient('https://agent.example.test', {
    fetch: mockFetch,
    bearerTokenProvider: () => 'test-token',
  });
  assert.deepEqual(await client.getTask('task-1'), completedTask);
}

async function testFirstSupportedJsonRpcInterfaceIsSelected(): Promise<void> {
  calls.length = 0;
  nextResponse = (url, init) => {
    if (url.pathname === '/.well-known/agent-card.json') {
      return jsonResponse({
        ...validCard,
        supportedInterfaces: [
          {
            url: 'https://agent.example.test/a2a/http',
            protocolBinding: 'HTTP+JSON',
            protocolVersion: '1.0',
            tenant: 'non-selected-tenant',
          },
          {
            ...validCard.supportedInterfaces[0],
            tenant: 'selected-tenant',
          },
        ],
      });
    }
    assert.equal(url.pathname, '/a2a/v1');
    assert.deepEqual(requestBody(init).params, {
      tenant: 'selected-tenant',
      id: 'task-1',
      historyLength: 0,
    });
    const request = JSON.parse(String(init.body)) as { id: string };
    return jsonResponse({ jsonrpc: '2.0', id: request.id, result: completedTask });
  };

  const client = await createA2ARemoteClient('https://agent.example.test', {
    fetch: mockFetch,
    bearerTokenProvider: () => 'test-token',
  });
  assert.equal(client.selectedInterface.url, 'https://agent.example.test/a2a/v1');
  assert.equal(client.selectedInterface.tenant, 'selected-tenant');
  assert.deepEqual(await client.getTask('task-1'), completedTask);
}

async function testUnsupportedTrailingInterfaceDoesNotInvalidateSelectedInterface(): Promise<void> {
  calls.length = 0;
  nextResponse = (url, init) => {
    if (url.pathname === '/.well-known/agent-card.json') {
      return jsonResponse({
        ...validCard,
        supportedInterfaces: [
          validCard.supportedInterfaces[0],
          {
            url: 'wss://agent.example.test/a2a/custom',
            protocolBinding: 'CUSTOM_WEBSOCKET',
            protocolVersion: '2026-09',
            officialExtension: { safelyIgnored: true },
          },
        ],
      });
    }
    assert.equal(url.pathname, '/a2a/v1');
    const request = JSON.parse(String(init.body)) as { id: string };
    return jsonResponse({ jsonrpc: '2.0', id: request.id, result: completedTask });
  };

  const client = await createA2ARemoteClient('https://agent.example.test', {
    fetch: mockFetch,
    bearerTokenProvider: () => 'test-token',
  });
  assert.equal(client.selectedInterface.url, 'https://agent.example.test/a2a/v1');
  assert.deepEqual(await client.getTask('task-1'), completedTask,
    'a later unsupported custom binding must not invalidate the first supported interface');
}

async function testNoSupportedInterfaceFailsBeforeTokenResolution(): Promise<void> {
  let tokenReads = 0;
  nextResponse = (url) => url.pathname === '/.well-known/agent-card.json'
    ? jsonResponse({
      ...validCard,
      supportedInterfaces: [
        {
          url: 'https://agent.example.test/a2a/http',
          protocolBinding: 'HTTP+JSON',
          protocolVersion: '1.0',
        },
        {
          url: 'https://agent.example.test/a2a/grpc',
          protocolBinding: 'GRPC',
          protocolVersion: '1.0',
        },
      ],
    })
    : jsonResponse({});

  await expectRemoteError(
    () => createA2ARemoteClient('https://agent.example.test', {
      fetch: mockFetch,
      bearerTokenProvider: () => {
        tokenReads += 1;
        return 'must-not-be-read';
      },
    }),
    'UNSUPPORTED_PROTOCOL',
  );
  assert.equal(tokenReads, 0, 'no supported interface must fail before bearer token resolution');
}

async function testSelectedInterfaceTenantIsAppliedToEveryRequest(): Promise<void> {
  calls.length = 0;
  const observed: Array<{ method: string; params: Record<string, unknown> }> = [];
  nextResponse = (url, init) => {
    if (url.pathname === '/.well-known/agent-card.json') {
      return jsonResponse({
        ...validCard,
        supportedInterfaces: [{ ...validCard.supportedInterfaces[0], tenant: 'tenant-selected' }],
      });
    }
    const request = JSON.parse(String(init.body)) as {
      id: string;
      method: string;
      params: Record<string, unknown>;
    };
    observed.push({ method: request.method, params: request.params });
    if (request.method === 'SendMessage') {
      return jsonResponse({ jsonrpc: '2.0', id: request.id, result: { task: completedTask } });
    }
    if (request.method === 'ListTasks') {
      return jsonResponse({ jsonrpc: '2.0', id: request.id, result: { tasks: [] } });
    }
    return jsonResponse({ jsonrpc: '2.0', id: request.id, result: completedTask });
  };
  const client = await createA2ARemoteClient('https://agent.example.test', {
    fetch: mockFetch,
    bearerTokenProvider: () => 'test-token',
  });
  await client.sendMessage({ messageId: 'message-tenant', parts: [{ text: 'tenant request' }] });
  await client.getTask('task-1');
  await client.listTasks();
  await client.cancelTask('task-1');
  assert.deepEqual(observed.map(({ method, params }) => [method, params.tenant]), [
    ['SendMessage', 'tenant-selected'],
    ['GetTask', 'tenant-selected'],
    ['ListTasks', 'tenant-selected'],
    ['CancelTask', 'tenant-selected'],
  ]);

  nextResponse = (url, init) => {
    if (url.pathname === '/.well-known/agent-card.json') return jsonResponse(validCard);
    assert.equal(Object.hasOwn(requestBody(init).params as Record<string, unknown>, 'tenant'), false,
      'tenant must be omitted when the selected interface does not declare it');
    const request = JSON.parse(String(init.body)) as { id: string };
    return jsonResponse({ jsonrpc: '2.0', id: request.id, result: completedTask });
  };
  const tenantless = await createA2ARemoteClient('https://agent.example.test', {
    fetch: mockFetch,
    bearerTokenProvider: () => 'test-token',
  });
  await tenantless.getTask('task-1');
}

async function testOptionalCapabilitiesDefaultFalseAndInvalidTypesFail(): Promise<void> {
  nextResponse = (url) => url.pathname === '/.well-known/agent-card.json'
    ? jsonResponse({ ...validCard, capabilities: {} })
    : jsonResponse({});
  const client = await createA2ARemoteClient('https://agent.example.test', { fetch: mockFetch });
  assert.deepEqual(client.card.capabilities, {
    streaming: false,
    pushNotifications: false,
    extendedAgentCard: false,
  });

  for (const capabilities of [
    { streaming: 'false' },
    { pushNotifications: 0 },
    { extendedAgentCard: null },
  ]) {
    nextResponse = (url) => url.pathname === '/.well-known/agent-card.json'
      ? jsonResponse({ ...validCard, capabilities })
      : jsonResponse({});
    await expectRemoteError(
      () => createA2ARemoteClient('https://agent.example.test', { fetch: mockFetch }),
      'INVALID_AGENT_CARD',
    );
  }
}

async function testAgentCardModesAndSkillsFollowProtoJson(): Promise<void> {
  const malformedCards = [
    { ...validCard, defaultInputModes: ['text/plain', 7] },
    { ...validCard, defaultOutputModes: [null] },
    { ...validCard, skills: [{ name: 'missing required fields' }] },
    { ...validCard, skills: [{ id: 7, name: 'n', description: 'd', tags: ['a'] }] },
    { ...validCard, skills: [{ id: 'id', name: '', description: 'd', tags: ['a'] }] },
    { ...validCard, skills: [{ id: 'id', name: 'n', description: 7, tags: ['a'] }] },
    { ...validCard, skills: [{ id: 'id', name: 'n', description: 'd', tags: ['a', 7] }] },
  ];
  for (const malformedCard of malformedCards) {
    nextResponse = (url) => url.pathname === '/.well-known/agent-card.json'
      ? jsonResponse(malformedCard)
      : jsonResponse({});
    await expectRemoteError(
      () => createA2ARemoteClient('https://agent.example.test', { fetch: mockFetch }),
      'INVALID_AGENT_CARD',
    );
  }

  nextResponse = (url) => url.pathname === '/.well-known/agent-card.json'
    ? jsonResponse({
      ...validCard,
      officialFutureField: { enabled: true },
      skills: [{
        ...validCard.skills[0],
        examples: ['A future official field must be accepted.'],
      }],
    })
    : jsonResponse({});
  const client = await createA2ARemoteClient('https://agent.example.test', { fetch: mockFetch });
  assert.equal(client.card.skills[0].id, 'teams-core-tasks');
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

async function testIpv6LiteralAndRedirectSsrfAreBlockedBeforeFollow(): Promise<void> {
  for (const origin of [
    'https://[::1]',
    'https://[fc00::1]',
    'https://[fd12:3456:789a::1]',
    'https://[fe80::1]',
  ]) {
    calls.length = 0;
    await expectRemoteError(
      () => createA2ARemoteClient(origin, { fetch: mockFetch }),
      'SSRF_BLOCKED',
    );
    assert.equal(calls.length, 0, `${origin} must be rejected before fetch`);
  }

  for (const location of [
    'https://127.0.0.1/agent-card.json',
    'https://[::1]/agent-card.json',
    'https://[fd00::1]/agent-card.json',
    'https://[fe80::1]/agent-card.json',
  ]) {
    calls.length = 0;
    nextResponse = () => new Response(null, {
      status: 302,
      headers: { location },
    });
    await expectRemoteError(
      () => createA2ARemoteClient('https://agent.example.test', { fetch: mockFetch }),
      'SSRF_BLOCKED',
    );
    assert.equal(calls.length, 1, `private redirect ${location} must be rejected before follow`);
  }
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

async function testAbortSignalPropagatesToRpc(): Promise<void> {
  calls.length = 0;
  let observedSignal: AbortSignal | null | undefined;
  let fetchAbortObserved = false;
  let fetchStartedResolve!: () => void;
  const fetchStarted = new Promise<void>((resolve) => { fetchStartedResolve = resolve; });
  nextResponse = (url, init) => {
    if (url.pathname === '/.well-known/agent-card.json') return jsonResponse(validCard);
    observedSignal = init.signal;
    fetchStartedResolve();
    return new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        fetchAbortObserved = true;
        reject(new Error('fetch aborted by parent'));
      }, { once: true });
    });
  };

  const client = await createA2ARemoteClient('https://agent.example.test', {
    fetch: mockFetch,
    bearerTokenProvider: () => 'test-token',
    requestTimeoutMs: 1_000,
  });
  const controller = new AbortController();
  const pending = client.sendMessage({
    messageId: 'message-abort',
    parts: [{ text: 'This request must be canceled.' }],
  }, { signal: controller.signal });
  await fetchStarted;
  assert.ok(observedSignal, 'the remote client must pass an abort-capable signal to the fetch boundary');
  assert.notEqual(observedSignal, controller.signal,
    'the fetch boundary may use a linked signal so its timeout remains independent');
  controller.abort(new Error('parent cancellation'));
  await assert.rejects(pending, /parent cancellation/);
  assert.equal(fetchAbortObserved, true,
    'aborting the parent signal must abort the in-flight remote request');
  assert.equal(observedSignal?.aborted, true,
    'the linked fetch signal must be aborted when the parent signal is canceled');
}

async function testJsonRpcResponseIdMustMatchRequest(): Promise<void> {
  nextResponse = (url, init) => {
    if (url.pathname === '/.well-known/agent-card.json') return jsonResponse(validCard);
    const request = JSON.parse(String(init.body)) as { id: string };
    return jsonResponse({
      jsonrpc: '2.0',
      id: `${request.id}-different`,
      result: completedTask,
    });
  };
  const client = await createA2ARemoteClient('https://agent.example.test', {
    fetch: mockFetch,
    bearerTokenProvider: () => 'test-token',
  });
  await expectRemoteError(() => client.getTask('task-1'), 'INVALID_RESPONSE');

  nextResponse = (url, init) => {
    if (url.pathname === '/.well-known/agent-card.json') return jsonResponse(validCard);
    const request = JSON.parse(String(init.body)) as { id: string };
    return jsonResponse({ jsonrpc: '2.0', id: 1, echoed: request.id, result: completedTask });
  };
  await expectRemoteError(() => client.getTask('task-1'), 'INVALID_RESPONSE');
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
