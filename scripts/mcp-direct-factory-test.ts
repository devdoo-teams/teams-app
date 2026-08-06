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

async function mcpRequest(baseUrl: string, body: Record<string, unknown>, sessionId?: string) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
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
  app.use('/mcp', createMcpGenUiRouter(dependencies));
  const listener = await listen(app);
  try {
    await verifyProtocol('createMcpGenUiRouter', listener.baseUrl);
  } finally {
    await new Promise<void>((resolve) => listener.server.close(() => resolve()));
  }
}

await verifyDirectServerFactory();
await verifyDirectRouterFactory();
console.log('MCP direct-factory tests passed: server and router initialize, list tools, and call get_workspace_snapshot without index.ts.');
