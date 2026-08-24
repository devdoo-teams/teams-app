import assert from 'node:assert/strict';
import http from 'node:http';

import express from 'express';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  createMcpGenUiRouter,
  type McpGenUiServerOptions,
} from '../src/server/mcp-genui.js';

const dependencies: McpGenUiServerOptions = {
  itemStore: {
    list: () => [{ id: 1, title: '격리 테스트 업무', status: 'open' }],
    summary: () => ({ total: 1, open: 1, done: 0 }),
  },
  agentService: {
    getLocalOnly: () => undefined,
    listLocalOnly: () => [],
    countActiveLocalOnly: () => 0,
  },
  getWeather: async () => ({
    source: 'demo',
    location: { name: '테스트 위치', latitude: 37.5, longitude: 126.9, timezone: 'Asia/Seoul' },
    current: {
      time: new Date().toISOString(),
      temperature: 20,
      apparentTemperature: 20,
      humidity: 50,
      precipitation: 0,
      weatherCode: 0,
      isDay: true,
      windSpeed: 1,
      condition: '맑음',
      icon: 'sun',
    },
  }),
  widgetHtml: '<!doctype html><html><body>test</body></html>',
  sessionMode: 'stateful',
  enableJsonResponse: true,
};

function parseJsonOrSse(text: string): Record<string, any> | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as Record<string, any>;
  } catch {
    const lines = trimmed
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())
      .filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(lines[index]) as Record<string, any>;
      } catch {
        // Continue until a valid JSON-RPC event is found.
      }
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

async function request(
  baseUrl: string,
  body: Record<string, unknown>,
  principal: string | undefined,
  sessionId?: string,
) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'MCP-Protocol-Version': '2025-11-25',
      ...(principal ? { 'x-test-principal': principal } : {}),
      ...(sessionId ? { 'MCP-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
  return {
    response,
    body: parseJsonOrSse(await response.text()),
    sessionId: response.headers.get('mcp-session-id') ?? sessionId,
  };
}

function initializeBody(id: string): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: `authenticated-router-${id}`, version: '1.0.0' },
    },
  };
}

function identityProviderTools(principal: { tenantId: string; requesterId: string }) {
  return {
    register(server: McpServer): void {
      registerAppTool(
        server,
        'provider_identity_probe',
        {
          title: 'Provider identity probe',
          description: `bound principal ${principal.tenantId}/${principal.requesterId}`,
          inputSchema: {},
          annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
          _meta: { ui: { visibility: ['model'] } },
        },
        async () => ({
          content: [{ type: 'text', text: `${principal.tenantId}/${principal.requesterId}` }],
        }),
      );
    },
  };
}

const app = express();
const router = createMcpGenUiRouter({
  ...dependencies,
  includeWorkspaceTools: false,
  resolvePrincipal: (_request, response) => response.locals.testPrincipal,
  providerToolsForPrincipal: identityProviderTools,
});
app.use('/mcp', (request, response, next) => {
  const raw = request.header('x-test-principal');
  if (raw) response.locals.testPrincipal = { tenantId: 'tenant-a', requesterId: raw };
  next();
});
app.use('/mcp', router);

const listener = await listen(app);
try {
  const unauthenticated = await request(listener.baseUrl, initializeBody('unauthenticated'), undefined);
  assert.equal(unauthenticated.response.status, 401, 'MCP route rejects a request without a validated principal');

  const first = await request(listener.baseUrl, initializeBody('first'), 'requester-a');
  assert.equal(first.response.status, 200, `first principal can initialize an MCP session: ${JSON.stringify(first.body)}`);
  assert.ok(first.sessionId, 'first principal receives a session id');
  await request(listener.baseUrl, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, 'requester-a', first.sessionId);

  const second = await request(listener.baseUrl, initializeBody('second'), 'requester-b');
  assert.equal(second.response.status, 200, 'second principal can initialize an independent MCP session');
  assert.ok(second.sessionId, 'second principal receives a session id');
  await request(listener.baseUrl, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, 'requester-b', second.sessionId);

  const firstTools = await request(listener.baseUrl, { jsonrpc: '2.0', id: 'first-tools', method: 'tools/list', params: {} }, 'requester-a', first.sessionId);
  assert.equal(firstTools.response.status, 200, 'first principal can list tools');
  const firstTool = firstTools.body?.result?.tools?.find((tool: any) => tool.name === 'provider_identity_probe');
  assert.match(firstTool?.description ?? '', /tenant-a\/requester-a/, 'first session binds provider tools to requester-a');
  assert.equal(firstTools.body?.result?.tools?.some((tool: any) => tool.name === 'get_workspace_snapshot'), false, 'authenticated provider session does not expose workspace reader');
  assert.equal(firstTools.body?.result?.tools?.some((tool: any) => tool.name === 'get_job_status'), false, 'authenticated provider session does not expose local job reader');

  const secondTools = await request(listener.baseUrl, { jsonrpc: '2.0', id: 'second-tools', method: 'tools/list', params: {} }, 'requester-b', second.sessionId);
  const secondTool = secondTools.body?.result?.tools?.find((tool: any) => tool.name === 'provider_identity_probe');
  assert.match(secondTool?.description ?? '', /tenant-a\/requester-b/, 'second session binds provider tools to requester-b');

  const crossed = await request(listener.baseUrl, { jsonrpc: '2.0', id: 'crossed', method: 'tools/list', params: {} }, 'requester-b', first.sessionId);
  assert.equal(crossed.response.status, 403, 'a session cannot be reused by a different validated principal');
} finally {
  await router.close();
  await new Promise<void>((resolve) => listener.server.close(() => resolve()));
}

console.log('MCP authenticated router test passed: principal binding, session isolation, and workspace-reader exclusion.');
