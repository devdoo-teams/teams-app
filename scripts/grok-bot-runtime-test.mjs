import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { resolveRuntimeDistRoot } from './runtime-dist.mjs';

const root = process.cwd();
const runtimeDistRoot = resolveRuntimeDistRoot(root);
const accessToken = 'grok-runtime-test-token-0123456789';
const xaiKey = 'xai-runtime-test-key';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('test server did not expose a TCP address'));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function request(baseUrl, pathname, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.token) headers.set('x-teams-local-access-token', options.token);
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Keep the raw body in a failure message.
  }
  return { response, body };
}

function activity(baseUrl) {
  return {
    type: 'message',
    id: 'grok-runtime-message',
    timestamp: new Date().toISOString(),
    serviceUrl: baseUrl,
    channelId: 'msteams',
    from: {
      id: '29:grok-runtime-user',
      // Local skip-auth REST requests use the fixed server-owned principal;
      // use the same principal so the mode preference and Bot activity share
      // one scope in this route-level test.
      aadObjectId: 'local-user',
      name: 'Grok Runtime Test User',
    },
    conversation: { id: 'grok-runtime-conversation', tenantId: 'local-tenant' },
    channelData: { tenant: { id: 'local-tenant' } },
    recipient: { id: 'runtime-bot', name: 'Teams SDK MVP' },
    text: '짧게 답해줘',
  };
}

function waitForHealth(baseUrl, child, diagnostics) {
  const deadline = Date.now() + 20_000;
  return (async () => {
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`Teams test server exited: ${child.exitCode}\n${diagnostics()}`);
      }
      try {
        const result = await request(baseUrl, '/api/health', { token: accessToken });
        if (result.response.ok) return;
      } catch {
        // The server may still be starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Teams test server did not become healthy\n${diagnostics()}`);
  })();
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 3_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

const xaiRequests = [];
const xaiServer = http.createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/responses') {
    response.writeHead(404).end();
    return;
  }

  const body = await readBody(request);
  const parsed = JSON.parse(body);
  xaiRequests.push({ headers: request.headers, body: parsed });
  if (request.headers.authorization !== `Bearer ${xaiKey}`) {
    response.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }

  const output = {
    id: 'resp-grok-runtime',
    output: [{
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'Grok 라우트 답변입니다.' }],
    }],
  };
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(output));
});

const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'teams-grok-bot-runtime-'));
let child;
let diagnosticsText = '';
try {
  // The test is intentionally self-contained: it builds the optional server
  // bundle from this clean commit before starting the local Teams route.
  execFileSync(process.execPath, ['scripts/build-server.mjs'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  const xaiPort = await listen(xaiServer);
  const teamsPortServer = http.createServer();
  const teamsPort = await listen(teamsPortServer);
  await close(teamsPortServer);
  const baseUrl = `http://127.0.0.1:${teamsPort}`;
  const serverEnv = {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(teamsPort),
    ITEM_STORE_PATH: path.join(dataRoot, 'items.json'),
    WORK_ITEM_STORE_PATH: path.join(dataRoot, 'work-items.json'),
    COLLABORATION_STORE_PATH: path.join(dataRoot, 'collaboration.json'),
    AGENT_JOB_STORE_PATH: path.join(dataRoot, 'agent-jobs.json'),
    A2A_STORE_PATH: path.join(dataRoot, 'a2a.json'),
    A2A_OUTBOUND_STORE_PATH: path.join(dataRoot, 'a2a-outbound.json'),
    AGENT_ADMISSION_JOURNAL_PATH: path.join(dataRoot, 'agent-admission.json'),
    GENUI_ACTION_STORE_PATH: path.join(dataRoot, 'genui-actions.json'),
    RESPONSE_MODE_STORE_PATH: path.join(dataRoot, 'response-modes.json'),
    AGENT_WORKSPACE: root,
    CODEX_BIN: process.execPath,
    CODEX_SCRIPT: path.join(root, 'scripts/fake-codex.mjs'),
    WEATHER_MODE: 'demo',
    TEAMS_OPTIONAL_RUNTIME: 'true',
    XAI_API_KEY: xaiKey,
    XAI_MODEL: 'grok-runtime-model',
    XAI_BASE_URL: `http://127.0.0.1:${xaiPort}/v1`,
    OPENAI_API_KEY: '',
    LOCAL_MODEL_BASE_URL: '',
    TEAMS_USE_SDK: 'false',
    TEAMS_SKIP_OUTBOUND: 'true',
    TEAMS_SKIP_AUTH: 'true',
    TEAMS_LOCAL_DEV: 'true',
    TEAMS_BIND_HOST: '127.0.0.1',
    TEAMS_LOCAL_ACCESS_TOKEN: accessToken,
    TEAMS_OPERATOR_REQUESTER_ALLOWLIST: 'local-tenant/local-user',
    PUBLIC_BASE_URL: '',
    TAB_DOMAIN: '',
    BOT_DOMAIN: '',
    DEV_TUNNEL_ID: '',
    MCP_PUBLIC_ENABLED: '',
  };
  child = spawn(process.execPath, [path.join(runtimeDistRoot, 'server', 'index.js')], {
    cwd: root,
    env: serverEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => { diagnosticsText += chunk.toString(); });
  child.stderr?.on('data', (chunk) => { diagnosticsText += chunk.toString(); });

  await waitForHealth(baseUrl, child, () => diagnosticsText.slice(-4_000));
  const health = await request(baseUrl, '/api/health', { token: accessToken });
  assert.equal(health.body.genAI, 'grok-configured');
  assert.equal(health.body.genAIProvider?.provider, 'grok');
  assert.equal(health.body.responseProviders?.grok, true);
  assert.equal(health.body.genAIProvider?.model, 'grok-runtime-model');
  assert.doesNotMatch(JSON.stringify(health.body), /xai-runtime-test-key/);

  const mode = await request(baseUrl, '/api/response-mode', {
    method: 'POST',
    token: accessToken,
    body: { mode: 'grok' },
  });
  assert.equal(mode.response.status, 200, JSON.stringify(mode.body));
  assert.equal(mode.body.mode, 'grok');

  const message = await request(baseUrl, '/api/messages', {
    method: 'POST',
    token: accessToken,
    body: activity(baseUrl),
  });
  assert.equal(message.response.status, 200, JSON.stringify(message.body));
  const serializedMessage = JSON.stringify(message.body);
  assert.match(serializedMessage, /Grok 라우트 답변입니다\./);
  assert.match(serializedMessage, /application\/vnd\.microsoft\.card\.adaptive/);
  assert.doesNotMatch(serializedMessage, /xai-runtime-test-key/);
  assert.equal(xaiRequests.length, 1);
  assert.equal(xaiRequests[0].body.model, 'grok-runtime-model');
  assert.equal(xaiRequests[0].body.input.at(-1).role, 'user');
  assert.equal(xaiRequests[0].headers.authorization, `Bearer ${xaiKey}`);

  console.log('PASS: optional bundle selects Grok through the Teams Bot route and renders an attachment-only response');
} finally {
  await stop(child);
  await close(xaiServer);
  await rm(dataRoot, { recursive: true, force: true });
}
