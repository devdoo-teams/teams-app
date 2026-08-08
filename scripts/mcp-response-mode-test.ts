import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';

import express from 'express';

import type { AgentJob } from '../src/server/agent-job-store.js';
import {
  createMcpGenUiRouter,
  MCP_GENUI_RESOURCE_MIME_TYPE,
  MCP_GENUI_RESOURCE_URI,
  type McpGenUiServerOptions,
} from '../src/server/mcp-genui.js';
import { GenUiEnvelopeV1Schema, type GenUiResponseMode } from '../src/shared/genui.js';

const publicResponseMode: GenUiResponseMode = {
  mode: 'deterministic',
  label: 'https://provider.invalid/secret-label',
  configured: true,
  availability: [
    { mode: 'deterministic', label: '결정형', configured: true, requiresServerConfiguration: false },
    { mode: 'openai', label: 'OpenAI', configured: false, requiresServerConfiguration: true },
    { mode: 'local', label: '로컬/사내 모델', configured: false, requiresServerConfiguration: true },
  ],
};

const credentialedJob = {
  id: 'job-mcp-secret',
  prompt: 'Bearer abcdefghijklmnop https://user:password@example.test/v1?api_key=url-secret 작업 결과를 확인해줘',
  mode: 'read-only',
  status: 'completed',
  scope: { requesterId: 'mcp-user', conversationId: 'mcp-thread', tenantId: 'mcp-tenant' },
  progress: ['Bearer abcdefghijklmnop 진행 기록'],
  result: 'sk-proj-mcpabcdefghijklmnop 결과가 포함된 것처럼 보이는 텍스트',
  createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:01.000Z',
  finishedAt: '2026-08-08T00:00:01.000Z',
} as AgentJob;

const dependencies: McpGenUiServerOptions = {
  itemStore: {
    list: () => [
      { id: 1, title: 'MCP 모드 계약 테스트', status: 'open' },
      { id: 2, title: '완료된 업무', status: 'done' },
    ],
    summary: () => ({ total: 2, open: 1, done: 1 }),
  },
  agentService: {
    getLocalOnly: () => credentialedJob,
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
      time: '2026-08-08T00:00:00.000Z',
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
  responseMode: publicResponseMode,
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
    // Streamable HTTP can return JSON-RPC messages as SSE data lines.
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
  assert(address && typeof address === 'object', 'MCP test server has a bound address');
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function mcpRequest(
  baseUrl: string,
  body: Record<string, unknown>,
  sessionId?: string,
  method = 'POST',
): Promise<{ response: Response; body: Record<string, any> | undefined; sessionId?: string }> {
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
  return {
    response,
    body: parseJsonOrSse(await response.text()) as Record<string, any> | undefined,
    sessionId: response.headers.get('mcp-session-id') ?? sessionId,
  };
}

async function initialize(baseUrl: string): Promise<string> {
  const initialized = await mcpRequest(baseUrl, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'mcp-response-mode-test', version: '1.0.0' },
    },
  });
  assert.equal(initialized.response.status, 200, 'initialize succeeds');
  assert.ok(initialized.sessionId, 'initialize returns an MCP session');

  const notification = await mcpRequest(baseUrl, {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  }, initialized.sessionId);
  assert.ok([200, 202].includes(notification.response.status), 'initialized notification is accepted');
  return initialized.sessionId!;
}

async function verifyToolsAndResource(baseUrl: string, sessionId: string): Promise<void> {
  const listed = await mcpRequest(baseUrl, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  }, sessionId);
  assert.equal(listed.response.status, 200, 'tools/list succeeds');
  const tools = listed.body?.result?.tools as Array<Record<string, any>>;
  assert.ok(Array.isArray(tools), 'tools/list returns tools');
  const renderTool = tools.find((tool) => tool.name === 'render_workspace_response');
  assert.equal(renderTool?._meta?.ui?.resourceUri, MCP_GENUI_RESOURCE_URI, 'render tool preserves the canonical resource URI');
  assert.equal(renderTool?.annotations?.readOnlyHint, true, 'render tool is read-only');
  assert.equal(renderTool?.annotations?.destructiveHint, false, 'render tool is non-destructive');
  assert.equal(renderTool?.outputSchema?.properties?.schemaVersion?.const, '1', 'tools expose the GenUiEnvelopeV1 output contract');
  assert.equal(renderTool?.outputSchema?.properties?.responseMode?.type, 'object', 'tools expose the optional public mode contract');

  const resources = await mcpRequest(baseUrl, {
    jsonrpc: '2.0',
    id: 3,
    method: 'resources/list',
    params: {},
  }, sessionId);
  assert.equal(resources.response.status, 200, 'resources/list succeeds');
  const resource = (resources.body?.result?.resources as Array<Record<string, any>>)
    .find((entry) => entry.uri === MCP_GENUI_RESOURCE_URI);
  assert.equal(resource?.uri, MCP_GENUI_RESOURCE_URI, 'resource list preserves the canonical URI');
  assert.equal(resource?.mimeType, MCP_GENUI_RESOURCE_MIME_TYPE, 'resource list exposes the MCP Apps MIME type');

  const resourceRead = await mcpRequest(baseUrl, {
    jsonrpc: '2.0',
    id: 4,
    method: 'resources/read',
    params: { uri: MCP_GENUI_RESOURCE_URI },
  }, sessionId);
  assert.equal(resourceRead.response.status, 200, 'resources/read succeeds');
  const content = resourceRead.body?.result?.contents?.[0];
  assert.equal(content?.uri, MCP_GENUI_RESOURCE_URI, 'resource content preserves the canonical URI');
  assert.equal(content?.mimeType, MCP_GENUI_RESOURCE_MIME_TYPE, 'resource content uses text/html;profile=mcp-app');
  assert.match(String(content?.text), /^<!doctype html>/i, 'resource content is HTML');
}

async function callTool(baseUrl: string, sessionId: string, id: number, name: string, args: Record<string, unknown>) {
  const result = await mcpRequest(baseUrl, {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args },
  }, sessionId);
  assert.equal(result.response.status, 200, `${name} returns a JSON-RPC response`);
  assert.equal(result.body?.error, undefined, `${name} does not return a JSON-RPC error`);
  return result.body?.result as Record<string, any>;
}

async function verifyStructuredResults(baseUrl: string, sessionId: string): Promise<void> {
  const first = await callTool(baseUrl, sessionId, 5, 'get_workspace_snapshot', { limit: 2 });
  const second = await callTool(baseUrl, sessionId, 6, 'get_workspace_snapshot', { limit: 2 });
  const firstEnvelope = GenUiEnvelopeV1Schema.parse(first.structuredContent);
  const secondEnvelope = GenUiEnvelopeV1Schema.parse(second.structuredContent);
  assert.equal(first.content?.[0]?.text, firstEnvelope.fallbackText, 'non-MCP host text equals structured fallback text');
  assert.deepEqual(
    { ...firstEnvelope, correlationId: undefined },
    { ...secondEnvelope, correlationId: undefined },
    'deterministic tool results are stable apart from correlation ids',
  );
  assert.equal(firstEnvelope.responseMode?.mode, 'deterministic', 'selected mode is carried only as safe structured content');
  assert.equal(firstEnvelope.responseMode?.label, '결정형', 'mode labels are canonicalized and never echo provider URLs');
  assert.equal(JSON.stringify(firstEnvelope).includes('provider.invalid'), false, 'provider URLs are absent from structured mode metadata');

  const weather = await callTool(baseUrl, sessionId, 7, 'get_weather', {
    latitude: 37.5665,
    longitude: 126.978,
    demo: true,
  });
  const weatherEnvelope = GenUiEnvelopeV1Schema.parse(weather.structuredContent);
  assert.equal(weather.content?.[0]?.text, weatherEnvelope.fallbackText, 'weather fallback text is identical to structured fallback text');

  const job = await callTool(baseUrl, sessionId, 8, 'get_job_status', { jobId: 'job-mcp-secret' });
  const jobEnvelope = GenUiEnvelopeV1Schema.parse(job.structuredContent);
  assert.equal(job.content?.[0]?.text, jobEnvelope.fallbackText, 'job fallback text is identical to structured fallback text');
  const jobJson = JSON.stringify(jobEnvelope);
  assert.doesNotMatch(jobJson, /abcdefghijklmnop|url-secret|user:password/);
  assert.match(jobJson, /\[REDACTED\]/);
}

async function verifyReadOnlyBoundary(baseUrl: string, sessionId: string): Promise<void> {
  const actionToken = 'mcp-approval-secret-token';
  const providerUrl = 'https://model.internal.example/v1';
  const rendered = await mcpRequest(baseUrl, {
    jsonrpc: '2.0',
    id: 9,
    method: 'tools/call',
    params: {
      name: 'render_workspace_response',
      arguments: {
        envelope: {
          schemaVersion: '1',
          kind: 'approval',
          status: 'approval',
          id: 'approval-boundary',
          correlationId: 'approval-correlation',
          sections: [{ type: 'status', status: 'approval', description: '승인 경계 테스트' }],
          actions: [{
            action: 'approve',
            label: '승인',
            entityId: 'job-1',
            correlationId: 'approval-correlation',
            actionToken,
          }],
          aiGenerated: false,
          fallbackText: '승인 경계 테스트',
          metadata: { source: 'test', apiKey: actionToken, providerUrl },
        },
      },
    },
  }, sessionId);
  assert.equal(rendered.response.status, 200, 'action-bearing render stays a JSON-RPC tool response');
  assert.equal(rendered.body?.result?.isError, true, 'read-only render rejects approval actions');
  const renderedJson = JSON.stringify(rendered.body);
  assert.equal(renderedJson.includes(actionToken), false, 'approval token never crosses the MCP response boundary');
  assert.equal(renderedJson.includes(providerUrl), false, 'provider URL never crosses the MCP response boundary');

  const widgetSource = await fs.readFile(new URL('../src/client/mcp/McpGenUiWidget.tsx', import.meta.url), 'utf8');
  assert.match(widgetSource, /interactive=\{false\}/, 'MCP widget renders the shared card as non-interactive');
  assert.doesNotMatch(widgetSource, /apiFetch|\/api\/response-mode|callTool|Action\.Submit/, 'generic MCP iframe has no Teams-only mode API or approval executor');
}

async function verifyNoModeByDefault(): Promise<void> {
  const app = express();
  const router = createMcpGenUiRouter({ ...dependencies, responseMode: undefined });
  app.use('/mcp', router);
  const listener = await listen(app);
  try {
    const sessionId = await initialize(listener.baseUrl);
    const result = await callTool(listener.baseUrl, sessionId, 10, 'get_workspace_snapshot', { limit: 1 });
    const envelope = GenUiEnvelopeV1Schema.parse(result.structuredContent);
    assert.equal('responseMode' in envelope, false, 'mode metadata is omitted when the MCP host does not supply it');
  } finally {
    await router.close();
    await new Promise<void>((resolve) => listener.server.close(() => resolve()));
  }
}

const app = express();
const router = createMcpGenUiRouter(dependencies);
app.use('/mcp', router);
const listener = await listen(app);
try {
  const sessionId = await initialize(listener.baseUrl);
  await verifyToolsAndResource(listener.baseUrl, sessionId);
  await verifyStructuredResults(listener.baseUrl, sessionId);
  await verifyReadOnlyBoundary(listener.baseUrl, sessionId);
} finally {
  await router.close();
  await new Promise<void>((resolve) => listener.server.close(() => resolve()));
}

await verifyNoModeByDefault();
console.log('MCP response-mode tests passed: canonical resource, public mode contract, deterministic fallback, redaction, and read-only boundary.');
