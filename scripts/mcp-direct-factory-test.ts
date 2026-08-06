import assert from 'node:assert/strict';
import http from 'node:http';

import express from 'express';

import {
  createMcpGenUiRouter,
  createMcpGenUiServer,
  type McpGenUiServerOptions,
} from '../src/server/mcp-genui.js';

const dependencies: McpGenUiServerOptions = {
  itemStore: {
    list: () => [{ id: 1, title: '직접 팩토리 테스트 업무', status: 'open' }],
    summary: () => ({ total: 1, open: 1, done: 0 }),
  },
  agentService: {
    getLocalOnly: () => undefined,
    listLocalOnly: () => [],
    countActiveLocalOnly: () => 0,
  },
  getWeather: async () => ({
    source: 'demo',
    location: {
      name: '테스트 위치',
      latitude: 37.5665,
      longitude: 126.978,
      timezone: 'Asia/Seoul',
    },
    current: {
      time: new Date().toISOString(),
      temperature: 22,
      apparentTemperature: 22.8,
      humidity: 58,
      precipitation: 0,
      weatherCode: 0,
      isDay: true,
      windSpeed: 9.4,
      condition: '맑음',
      icon: 'sun',
    },
  }),
  widgetHtml: '<!doctype html><html><body>GenUI test widget</body></html>',
  sessionMode: 'stateful',
  enableJsonResponse: true,
};

function parseJsonOrSse(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  try {
    return JSON.parse(trimmed);
  } catch {
    // Streamable HTTP may return an SSE response for JSON-RPC messages.
  }

  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .filter(Boolean);
  for (let index = dataLines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(dataLines[index]);
    } catch {
      // Continue until a valid JSON-RPC event is found.
    }
  }

  return undefined;
}

async function listen(app: express.Express): Promise<{ server: http.Server; baseUrl: string }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address === 'object', 'test server has a bound address');
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function mcpRequest(
  baseUrl: string,
  body: Record<string, unknown>,
  sessionId?: string,
  method = 'POST',
) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method,
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'MCP-Protocol-Version': '2025-11-25',
      ...(sessionId ? { 'MCP-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    response,
    body: parseJsonOrSse(text) as Record<string, any> | undefined,
    sessionId: response.headers.get('mcp-session-id') ?? sessionId,
  };
}

async function verifyProtocol(label: string, baseUrl: string): Promise<void> {
  const initialize = await mcpRequest(baseUrl, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: `mcp-direct-factory-${label}`, version: '1.0.0' },
    },
  });
  assert.equal(initialize.response.status, 200, `${label}: initialize returns 200`);
  assert.ok(initialize.sessionId, `${label}: initialize returns mcp-session-id`);
  assert.ok(initialize.body?.result?.protocolVersion, `${label}: initialize negotiates a protocol version`);

  const initialized = await mcpRequest(baseUrl, {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  }, initialize.sessionId);
  assert.ok([200, 202].includes(initialized.response.status), `${label}: initialized notification is accepted`);

  const toolsList = await mcpRequest(baseUrl, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  }, initialize.sessionId);
  assert.equal(toolsList.response.status, 200, `${label}: tools/list returns 200`);
  assert.ok(
    toolsList.body?.result?.tools?.some((tool: { name?: string }) => tool.name === 'get_workspace_snapshot'),
    `${label}: tools/list exposes get_workspace_snapshot`,
  );

  const snapshot = await mcpRequest(baseUrl, {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'get_workspace_snapshot', arguments: { limit: 1 } },
  }, initialize.sessionId);
  assert.equal(snapshot.response.status, 200, `${label}: get_workspace_snapshot returns 200`);
  assert.equal(
    snapshot.body?.result?.structuredContent?.kind,
    'task-list',
    `${label}: get_workspace_snapshot returns a GenUI envelope`,
  );
}

async function verifyDirectServerFactory(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  const instance = createMcpGenUiServer(dependencies);
  await instance.ready;
  app.post('/mcp', async (request, response) => {
    try {
      await instance.transport.handleRequest(request, response, request.body);
    } catch (error) {
      if (!response.headersSent) response.status(500).json({ error: String(error) });
    }
  });

  const listener = await listen(app);
  try {
    await verifyProtocol('createMcpGenUiServer', listener.baseUrl);
  } finally {
    await instance.close();
    await new Promise<void>((resolve) => listener.server.close(() => resolve()));
  }
}

async function verifyDirectRouterFactory(): Promise<void> {
  const app = express();
  let initializedCount = 0;
  let closedCount = 0;
  const router = createMcpGenUiRouter({
    ...dependencies,
    onSessionInitialized: () => {
      initializedCount += 1;
    },
    onSessionClosed: () => {
      closedCount += 1;
    },
  });
  app.use('/mcp', router);
  const listener = await listen(app);
  try {
    const missingSession = await mcpRequest(listener.baseUrl, {
      jsonrpc: '2.0',
      id: 'no-session',
      method: 'tools/list',
      params: {},
    });
    assert.equal(missingSession.response.status, 400, 'stateful non-initialize request without a session is rejected');
    assert.equal(initializedCount, 0, 'rejected non-initialize request does not initialize a session');

    const unknownSession = await mcpRequest(listener.baseUrl, {
      jsonrpc: '2.0',
      id: 'unknown-session',
      method: 'tools/list',
      params: {},
    }, 'missing-session');
    assert.equal(unknownSession.response.status, 404, 'unknown session is rejected without creating a server');

    await verifyProtocol('createMcpGenUiRouter', listener.baseUrl);
    assert.equal(initializedCount, 1, 'normal initialize creates exactly one mapped session');

    await Promise.all([router.close(), router.close()]);
    assert.equal(closedCount, 1, 'router.close is idempotent and closes the mapped session once');
  } finally {
    await router.close();
    await new Promise<void>((resolve) => listener.server.close(() => resolve()));
  }
}

async function verifySessionLimit(): Promise<void> {
  const app = express();
  let closedCount = 0;
  const router = createMcpGenUiRouter({
    ...dependencies,
    maxSessions: 1,
    onSessionClosed: () => {
      closedCount += 1;
    },
  });
  app.use('/mcp', router);
  const listener = await listen(app);
  try {
    const first = await mcpRequest(listener.baseUrl, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'mcp-session-limit-one', version: '1.0.0' },
      },
    });
    assert.equal(first.response.status, 200, 'first session fits under maxSessions');
    assert.ok(first.sessionId, 'first session has an id');

    const second = await mcpRequest(listener.baseUrl, {
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'mcp-session-limit-two', version: '1.0.0' },
      },
    });
    assert.equal(second.response.status, 503, 'maxSessions rejects another initialize without evicting the first');

    await router.close();
    assert.equal(closedCount, 1, 'maxSessions router cleanup closes the retained session');
  } finally {
    await router.close();
    await new Promise<void>((resolve) => listener.server.close(() => resolve()));
  }
}

async function verifyDeleteLifecycle(): Promise<void> {
  const app = express();
  let closedCount = 0;
  const router = createMcpGenUiRouter({
    ...dependencies,
    onSessionClosed: () => {
      closedCount += 1;
    },
  });
  app.use('/mcp', router);
  const listener = await listen(app);
  try {
    const initialized = await mcpRequest(listener.baseUrl, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'mcp-delete-lifecycle', version: '1.0.0' },
      },
    });
    assert.ok(initialized.sessionId, 'DELETE lifecycle session has an id');

    const deleted = await mcpRequest(listener.baseUrl, {
      jsonrpc: '2.0',
      id: 'delete',
      method: 'notifications/initialized',
      params: {},
    }, initialized.sessionId, 'DELETE');
    assert.equal(deleted.response.status, 200, 'DELETE closes a known session');
    assert.equal(closedCount, 1, 'onsessionclosed removes and closes the session once');

    const afterDelete = await mcpRequest(listener.baseUrl, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }, initialized.sessionId);
    assert.equal(afterDelete.response.status, 404, 'deleted session cannot be reused');
  } finally {
    await router.close();
    await new Promise<void>((resolve) => listener.server.close(() => resolve()));
  }
}

async function verifySessionTtl(): Promise<void> {
  const app = express();
  let closedCount = 0;
  const router = createMcpGenUiRouter({
    ...dependencies,
    sessionTtlMs: 40,
    sessionSweepIntervalMs: 10,
    onSessionClosed: () => {
      closedCount += 1;
    },
  });
  app.use('/mcp', router);
  const listener = await listen(app);
  try {
    const initialized = await mcpRequest(listener.baseUrl, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'mcp-session-ttl', version: '1.0.0' },
      },
    });
    assert.equal(initialized.response.status, 200, 'short TTL session initializes');
    assert.ok(initialized.sessionId, 'short TTL session has an id');

    await new Promise((resolve) => setTimeout(resolve, 100));
    const expired = await mcpRequest(listener.baseUrl, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }, initialized.sessionId);
    assert.equal(expired.response.status, 404, 'idle session expires after the configured TTL');
    assert.equal(closedCount, 1, 'TTL expiry closes the idle session once');
  } finally {
    await router.close();
    await new Promise<void>((resolve) => listener.server.close(() => resolve()));
  }
}

async function verifyStatelessFactory(): Promise<void> {
  const app = express();
  const router = createMcpGenUiRouter({ ...dependencies, sessionMode: 'stateless' });
  app.use('/mcp', router);
  const listener = await listen(app);
  try {
    const initialize = await mcpRequest(listener.baseUrl, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'mcp-stateless', version: '1.0.0' },
      },
    });
    assert.equal(initialize.response.status, 200, 'stateless initialize remains valid');
    assert.equal(initialize.sessionId, undefined, 'stateless mode does not accumulate a session id');
  } finally {
    await router.close();
    await new Promise<void>((resolve) => listener.server.close(() => resolve()));
  }
}

await verifyDirectServerFactory();
await verifyDirectRouterFactory();
await verifySessionLimit();
await verifyDeleteLifecycle();
await verifySessionTtl();
await verifyStatelessFactory();
console.log('MCP direct-factory tests passed: stateful gates, lifecycle limits, TTL cleanup, stateless mode, and direct factories.');
