import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import http from 'node:http';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const execFileAsync = promisify(execFile);
const LOCAL_ACCESS_TOKEN_HEADER = 'x-teams-local-access-token';
const localAccessTokens = new Map();

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        headers: localAccessTokens.has(baseUrl)
          ? { [LOCAL_ACCESS_TOKEN_HEADER]: localAccessTokens.get(baseUrl) }
          : undefined,
      });
      if (response.ok) return;
    } catch {
      // The process may still be starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Server did not become healthy: ${baseUrl}`);
}

async function request(baseUrl, pathname, init = {}) {
  const { localAccessToken = localAccessTokens.get(baseUrl), ...fetchInit } = init;
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...fetchInit,
    headers: {
      ...(fetchInit.body ? { 'content-type': 'application/json' } : {}),
      ...(fetchInit.headers ?? {}),
      ...(localAccessToken ? { [LOCAL_ACCESS_TOKEN_HEADER]: localAccessToken } : {}),
    },
  });
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Keep non-JSON error bodies readable.
  }
  return { response, body };
}

async function rawRequest(baseUrl, pathname, headers = {}, localAccessToken = localAccessTokens.get(baseUrl)) {
  const target = new URL(`${baseUrl}${pathname}`);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: target.hostname,
      port: Number(target.port),
      path: `${target.pathname}${target.search}`,
      method: 'GET',
      headers: {
        ...(localAccessToken ? { [LOCAL_ACCESS_TOKEN_HEADER]: localAccessToken } : {}),
        ...headers,
      },
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => {
        let body = text;
        try {
          body = JSON.parse(text);
        } catch {
          // Keep non-JSON error bodies readable.
        }
        resolve({ response, body });
      });
    });
    request.once('error', reject);
    request.end();
  });
}

function parseJsonOrSse(text) {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  try {
    return JSON.parse(trimmed);
  } catch {
    // Streamable HTTP may return an SSE response even when JSON responses are
    // enabled. Decode the last JSON-RPC data event for the assertion.
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

async function mcpRequest(baseUrl, body, { sessionId, protocolVersion = '2025-11-25', localAccessToken = localAccessTokens.get(baseUrl) } = {}) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': protocolVersion,
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  if (localAccessToken) headers[LOCAL_ACCESS_TOKEN_HEADER] = localAccessToken;

  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return {
    response,
    body: parseJsonOrSse(text),
    raw: text,
    sessionId: response.headers.get('mcp-session-id') ?? sessionId,
  };
}

function adaptiveCardFromActivity(activityValue) {
  return activityValue?.attachments?.find(
    (attachment) => attachment.contentType === 'application/vnd.microsoft.card.adaptive',
  )?.content;
}

function assertAdaptiveCardActivity(activityValue, label) {
  assert(!('text' in (activityValue ?? {})), `${label} does not duplicate card content in a top-level text bubble`);
  const card = adaptiveCardFromActivity(activityValue);
  assert(card?.type === 'AdaptiveCard', `${label} returns an Adaptive Card activity`);
  assert(card?.version === '1.5', `${label} uses Adaptive Card 1.5`);
  assert(!JSON.stringify(card).includes('AI 생성 콘텐츠'), `${label} does not show an AI-generated label`);
  assert(!('aiGenerated' in (card ?? {})), `${label} does not expose aiGenerated metadata`);
  return card;
}

function assertCancelledCard(card, label) {
  assert(card?.type === 'AdaptiveCard', `${label} returns an Adaptive Card`);
  const serialized = JSON.stringify(card);
  assert(serialized.includes('취소') || serialized.includes('cancelled'), `${label} returns a cancelled-state card`);
}

function actionPayloadFromCard(action) {
  return action?.data ?? action?.fallback?.data;
}

function assertExactGenUiActionPayload(payload, label) {
  const keys = Object.keys(payload ?? {}).sort();
  assert(
    JSON.stringify(keys) === JSON.stringify(['action', 'actionToken', 'correlationId', 'entityId', 'schemaVersion']),
    `${label} has exactly the five GenUI action payload keys`,
  );
  assert(Object.values(payload ?? {}).every((value) => typeof value === 'string' && value.length > 0), `${label} payload values are non-empty strings`);
}

function genUiInvokeActivity(baseUrl, payload, suffix, conversationId, identity = {}) {
  return {
    ...activity('', baseUrl, suffix, conversationId, identity),
    type: 'invoke',
    name: 'adaptiveCard/action',
    value: {
      action: {
        type: 'Action.Execute',
        verb: `genui.${payload.action}`,
        data: payload,
      },
    },
  };
}

function genUiSubmitActivity(baseUrl, payload, suffix, conversationId, identity = {}) {
  return {
    ...activity('', baseUrl, suffix, conversationId, identity),
    type: 'message',
    value: payload,
  };
}

async function copilotRun(baseUrl, prompt, threadId, context = []) {
  const result = await request(baseUrl, '/api/copilotkit/agent/default/run', {
    method: 'POST',
    body: JSON.stringify({
      threadId,
      runId: `${threadId}-run`,
      messages: [{ id: `${threadId}-user`, role: 'user', content: prompt }],
      tools: [],
      context,
      state: {},
    }),
  });

  const events = typeof result.body === 'string'
    ? result.body
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice('data: '.length)))
    : [];

  return { ...result, events };
}

function activity(text, baseUrl, suffix, conversationId = `runtime-conversation-${suffix}`, identity = {}) {
  const userId = identity.userId ?? 'runtime-user';
  const tenantId = identity.tenantId ?? 'runtime-tenant';
  return {
    type: 'message',
    id: `runtime-${suffix}`,
    timestamp: new Date().toISOString(),
    serviceUrl: baseUrl,
    channelId: 'msteams',
    from: { id: userId, name: 'Runtime Test User' },
    conversation: { id: conversationId, tenantId },
    channelData: { tenant: { id: tenantId } },
    recipient: { id: 'runtime-bot', name: 'Teams SDK MVP' },
    text,
  };
}

function installActivity(baseUrl, suffix) {
  return {
    type: 'installationUpdate',
    action: 'add',
    id: `runtime-install-${suffix}`,
    timestamp: new Date().toISOString(),
    serviceUrl: baseUrl,
    channelId: 'msteams',
    from: { id: 'runtime-user', name: 'Runtime Test User' },
    conversation: { id: `runtime-conversation-${suffix}`, conversationType: 'personal', tenantId: 'runtime-tenant' },
    channelData: { tenant: { id: 'runtime-tenant' } },
    recipient: { id: 'runtime-bot', name: 'Teams SDK MVP' },
  };
}

async function startServer({ production, dataFile, jobDataFile, teamsSdk = false, workspace = root, codexTimeoutMs, extraEnv = {} }) {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const localAccessToken = production ? '' : crypto.randomBytes(32).toString('base64url');
  if (!production) localAccessTokens.set(baseUrl, localAccessToken);
  const command = process.execPath;
  const entry = path.join(root, 'dist/server/index.js');
  const child = spawn(command, [entry], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: production ? 'production' : 'development',
      PORT: String(port),
      ITEM_STORE_PATH: dataFile,
      AGENT_JOB_STORE_PATH: jobDataFile,
      GENUI_ACTION_STORE_PATH: `${jobDataFile}.genui-actions.json`,
      RESPONSE_MODE_STORE_PATH: `${jobDataFile}.response-modes.json`,
      AGENT_WORKSPACE: workspace,
      CODEX_BIN: process.execPath,
      CODEX_SCRIPT: path.join(root, 'scripts/fake-codex.mjs'),
      WEATHER_MODE: 'demo',
      COPILOTKIT_DETERMINISTIC_MODE: production ? '' : 'true',
      TEAMS_USE_SDK: teamsSdk ? 'true' : 'false',
      TEAMS_SKIP_OUTBOUND: teamsSdk ? 'true' : 'false',
      TEAMS_LOCAL_DEV: production ? 'false' : 'true',
      TEAMS_BIND_HOST: '127.0.0.1',
      TEAMS_LOCAL_ACCESS_TOKEN: localAccessToken,
      // Keep isolated runtime fixtures independent from the release gate's
      // public .env.runtime values. Individual cases can opt back in through
      // extraEnv when they explicitly test a deployment hint.
      PUBLIC_BASE_URL: '',
      TAB_DOMAIN: production ? 'runtime.test' : '',
      BOT_DOMAIN: '',
      DEV_TUNNEL_ID: '',
      MCP_PUBLIC_ENABLED: '',
      ...(teamsSdk
        ? {
            BOT_CLIENT_ID: '00000000-0000-4000-8000-000000000001',
            CLIENT_ID: '00000000-0000-4000-8000-000000000002',
            CLIENT_SECRET: 'runtime-test-secret',
            TENANT_ID: '00000000-0000-4000-8000-000000000003',
            APPLICATION_ID_URI: 'api://runtime.test/botid-00000000-0000-4000-8000-000000000001',
          }
        : {}),
      ...(production ? { TEAMS_SKIP_AUTH: '' } : { TEAMS_SKIP_AUTH: 'true' }),
      ...(codexTimeoutMs ? { CODEX_TIMEOUT_MS: String(codexTimeoutMs) } : {}),
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });

  try {
    await waitForHealth(baseUrl);
    return { child, baseUrl, localAccessToken, getOutput: () => output };
  } catch (error) {
    child.kill('SIGTERM');
    localAccessTokens.delete(baseUrl);
    throw new Error(`${error.message}\n${output}`);
  }
}

async function expectStartupFailure(label, extraEnv, expectedMessage) {
  const port = await getFreePort();
  const child = spawn(process.execPath, [path.join(root, 'dist/server/index.js')], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      TEAMS_USE_SDK: 'false',
      TEAMS_SKIP_AUTH: '',
      TEAMS_LOCAL_DEV: 'false',
      TEAMS_BIND_HOST: '127.0.0.1',
      // The release gate intentionally loads .env.runtime. Startup-failure
      // cases must start from a clean local environment so a real deployment
      // hint or local token cannot mask the failure being asserted.
      PUBLIC_BASE_URL: '',
      TAB_DOMAIN: '',
      BOT_DOMAIN: '',
      DEV_TUNNEL_ID: '',
      TEAMS_LOCAL_ACCESS_TOKEN: '',
      MCP_PUBLIC_ENABLED: '',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  const result = await Promise.race([
    new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal }))),
    new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 5_000)),
  ]);

  if (result.timeout) {
    child.kill('SIGTERM');
    assert(false, `${label} exits instead of starting`);
    return;
  }

  assert(result.code !== 0, `${label} exits with a startup failure`);
  assert(output.includes(expectedMessage), `${label} reports ${expectedMessage}`);
}

async function expectStoreLeaseConflict(dataFile, jobDataFile) {
  const port = await getFreePort();
  const localAccessToken = crypto.randomBytes(32).toString('base64url');
  const child = spawn(process.execPath, [path.join(root, 'dist/server/index.js')], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      ITEM_STORE_PATH: dataFile,
      AGENT_JOB_STORE_PATH: jobDataFile,
      GENUI_ACTION_STORE_PATH: `${jobDataFile}.genui-actions.json`,
      AGENT_WORKSPACE: root,
      CODEX_BIN: process.execPath,
      CODEX_SCRIPT: path.join(root, 'scripts/fake-codex.mjs'),
      WEATHER_MODE: 'demo',
      COPILOTKIT_DETERMINISTIC_MODE: 'true',
      TEAMS_USE_SDK: 'false',
      TEAMS_SKIP_OUTBOUND: 'true',
      TEAMS_SKIP_AUTH: 'true',
      TEAMS_LOCAL_DEV: 'true',
      TEAMS_BIND_HOST: '127.0.0.1',
      TEAMS_LOCAL_ACCESS_TOKEN: localAccessToken,
      // The release gate loads the real deployment environment before this
      // child is spawned. Keep the lease-conflict assertion focused on the
      // store lock instead of letting a public-hint startup guard win first.
      PUBLIC_BASE_URL: '',
      TAB_DOMAIN: '',
      BOT_DOMAIN: '',
      DEV_TUNNEL_ID: '',
      MCP_PUBLIC_ENABLED: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const result = await Promise.race([
    new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal }))),
    new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 5_000)),
  ]);

  if (result.timeout) {
    child.kill('SIGTERM');
    assert(false, 'second server using the same stores exits instead of waiting for the lease');
    return;
  }

  assert(result.code !== 0, 'second server using the same stores is rejected');
  assert(output.includes('file-json store is already leased'), 'store lease conflict is deterministic and credential-free');
}

async function runStoreLeaseFlow(dataFile, jobDataFile) {
  const first = await startServer({ production: false, dataFile, jobDataFile });
  try {
    await expectStoreLeaseConflict(dataFile, jobDataFile);
  } finally {
    await stopServer(first.child);
  }

  const afterGracefulRelease = await startServer({ production: false, dataFile, jobDataFile });
  await stopServer(afterGracefulRelease.child);

  const crashed = await startServer({ production: false, dataFile, jobDataFile });
  crashed.child.kill('SIGKILL');
  await new Promise((resolve) => crashed.child.once('exit', resolve));

  const afterStaleReclaim = await startServer({ production: false, dataFile, jobDataFile });
  try {
    const health = await request(afterStaleReclaim.baseUrl, '/api/health');
    assert(health.response.status === 200, 'a restarted server reclaims only the dead process lease');
  } finally {
    await stopServer(afterStaleReclaim.child);
  }
}

async function runStartupGateFlow() {
  const productionSsoEnv = (label, overrides = {}) => ({
    NODE_ENV: 'production',
    TAB_DOMAIN: 'runtime.test',
    WEATHER_MODE: 'live',
    TEAMS_USE_SDK: 'true',
    BOT_CLIENT_ID: '00000000-0000-4000-8000-000000000001',
    CLIENT_ID: '00000000-0000-4000-8000-000000000002',
    CLIENT_SECRET: 'runtime-test-secret',
    TENANT_ID: '00000000-0000-4000-8000-000000000003',
    APPLICATION_ID_URI: 'api://runtime.test/botid-00000000-0000-4000-8000-000000000001',
    ITEM_STORE_PATH: path.join(tempDir, `${label}-items.json`),
    AGENT_JOB_STORE_PATH: path.join(tempDir, `${label}-agent-jobs.json`),
    GENUI_ACTION_STORE_PATH: path.join(tempDir, `${label}-genui-actions.json`),
    RESPONSE_MODE_STORE_PATH: path.join(tempDir, `${label}-response-modes.json`),
    ...overrides,
  });

  await expectStartupFailure(
    'legacy public MCP configuration',
    { MCP_PUBLIC_ENABLED: 'true' },
    'MCP_PUBLIC_ENABLED=true',
  );
  await expectStartupFailure(
    'auth bypass without local development gate',
    { TEAMS_SKIP_AUTH: 'true', TEAMS_LOCAL_DEV: '' },
    'TEAMS_LOCAL_DEV=true',
  );
  await expectStartupFailure(
    'auth bypass with a public deployment hint',
    { TEAMS_SKIP_AUTH: 'true', TEAMS_LOCAL_DEV: 'true', PUBLIC_BASE_URL: 'https://example.test' },
    'public deployment hints',
  );
  await expectStartupFailure(
    'safe local mode without an explicit access token',
    { TEAMS_SKIP_AUTH: 'true', TEAMS_LOCAL_DEV: 'true', TEAMS_LOCAL_ACCESS_TOKEN: '' },
    'TEAMS_LOCAL_ACCESS_TOKEN',
  );
  await expectStartupFailure(
    'file-json multi-worker configuration',
    { WEB_CONCURRENCY: '2' },
    'file-json storage is single-process only',
  );
  await expectStartupFailure(
    'file-json clustered instance configuration',
    { NODE_APP_INSTANCE: '1' },
    'file-json storage is single-process only',
  );
  await expectStartupFailure(
    'production without Teams bot credentials',
    {
      NODE_ENV: 'production',
      TEAMS_USE_SDK: 'false',
      BOT_CLIENT_ID: '',
      CLIENT_ID: '',
      CLIENT_SECRET: '',
      TENANT_ID: '',
      APPLICATION_ID_URI: '',
    },
    'Production requires BOT_CLIENT_ID',
  );
  await expectStartupFailure(
    'production with a mismatched combined SSO resource',
    productionSsoEnv('mismatched-sso', {
      APPLICATION_ID_URI: 'api://runtime.test/botid-00000000-0000-4000-8000-000000000002',
    }),
    'APPLICATION_ID_URI must match api://runtime.test/botid-00000000-0000-4000-8000-000000000001',
  );
  await expectStartupFailure(
    'production without TAB_DOMAIN',
    productionSsoEnv('missing-tab-domain', {
      TAB_DOMAIN: '',
      APPLICATION_ID_URI: 'api:///botid-00000000-0000-4000-8000-000000000001',
    }),
    'Production requires TAB_DOMAIN',
  );
  await expectStartupFailure(
    'production without BOT_CLIENT_ID',
    productionSsoEnv('missing-bot-client-id', {
      BOT_CLIENT_ID: undefined,
      APPLICATION_ID_URI: 'api://runtime.test/botid-',
    }),
    'Production requires BOT_CLIENT_ID',
  );
  await expectStartupFailure(
    'production with a malformed TAB_DOMAIN and matching URI',
    productionSsoEnv('malformed-tab-domain', {
      TAB_DOMAIN: 'runtime.test:3978',
      APPLICATION_ID_URI: 'api://runtime.test:3978/botid-00000000-0000-4000-8000-000000000001',
    }),
    'Production TAB_DOMAIN must be a public HTTPS hostname',
  );
  await expectStartupFailure(
    'production with demo weather mode',
    {
      NODE_ENV: 'production',
      TAB_DOMAIN: 'runtime.test',
      WEATHER_MODE: 'demo',
      TEAMS_USE_SDK: 'true',
      BOT_CLIENT_ID: '00000000-0000-4000-8000-000000000001',
      CLIENT_ID: '00000000-0000-4000-8000-000000000002',
      CLIENT_SECRET: 'runtime-test-secret',
      TENANT_ID: '00000000-0000-4000-8000-000000000003',
      APPLICATION_ID_URI: 'api://runtime.test/botid-00000000-0000-4000-8000-000000000001',
      ITEM_STORE_PATH: path.join(tempDir, 'demo-weather-items.json'),
      AGENT_JOB_STORE_PATH: path.join(tempDir, 'demo-weather-agent-jobs.json'),
      GENUI_ACTION_STORE_PATH: path.join(tempDir, 'demo-weather-genui-actions.json'),
      RESPONSE_MODE_STORE_PATH: path.join(tempDir, 'demo-weather-response-modes.json'),
    },
    'WEATHER_MODE=demo',
  );
  await expectStartupFailure(
    'production without user SSO configuration',
    {
      NODE_ENV: 'production',
      TEAMS_USE_SDK: 'true',
      BOT_CLIENT_ID: '00000000-0000-4000-8000-000000000001',
      CLIENT_ID: '',
      CLIENT_SECRET: 'runtime-test-secret',
      TENANT_ID: '00000000-0000-4000-8000-000000000003',
      APPLICATION_ID_URI: '',
    },
    'Production requires CLIENT_ID',
  );
}

async function waitForAgentJob(baseUrl, jobId) {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    const result = await request(baseUrl, '/api/debug/agent-jobs');
    const job = result.body.jobs.find((candidate) => candidate.id === jobId);
    if (job && ['completed', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Agent job did not finish: ${jobId}`);
}

async function waitForAgentStatus(baseUrl, jobId, expectedStatus) {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    const result = await request(baseUrl, '/api/debug/agent-jobs');
    const job = result.body.jobs.find((candidate) => candidate.id === jobId);
    if (job?.status === expectedStatus) return job;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Agent job did not reach ${expectedStatus}: ${jobId}`);
}

async function waitForOutboxMessage(baseUrl, conversationId, needle) {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    const result = await request(baseUrl, `/api/debug/agent-outbox/${conversationId}`);
    if (result.body.messages.some((message) => message.includes(needle))) return result.body;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Outbox message did not arrive: ${conversationId}`);
}

async function waitForOutboxMessages(baseUrl, conversationId, needles) {
  const messages = [];
  const activities = [];
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    const result = await request(baseUrl, `/api/debug/agent-outbox/${conversationId}`);
    messages.push(...(result.body.messages ?? []));
    activities.push(...(result.body.activities ?? []));
    if (needles.every((needle) => messages.some((message) => message.includes(needle)))) {
      return { body: { conversationId, messages, activities } };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Outbox messages did not arrive: ${conversationId} (${needles.join(', ')})`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 3_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function runLocalFlow(dataFile, jobDataFile) {
  const server = await startServer({ production: false, dataFile, jobDataFile });

  try {
    const health = await request(server.baseUrl, '/api/health');
    assert(health.response.status === 200, 'local health endpoint returns 200');
    assert(health.body.auth === 'local-bypass', 'local runtime uses explicit auth bypass');
    assert(health.body.userAuth === 'local-bypass', 'local health reports the user auth bypass truthfully');
    assert(health.body.bot === 'local-handler', 'local health reports the local Bot handler truthfully');
    assert(health.body.outbound === 'local-outbox', 'local health reports the local outbox truthfully');
    assert(health.body.version === '1.0.15', 'health version comes from the Teams manifest');
    assert(!('agent' in health.body) && !('agentWorkspace' in health.body), 'health does not expose agent binary or workspace paths');
    assert(health.body.storage === 'file-json-single-process', 'local runtime reports single-process file storage');
    assert(health.body.copilotKit === 'enabled', 'CopilotKit runtime is enabled');
    assert(health.body.genAI === 'deterministic-test', 'local runtime reports explicit deterministic test mode');
    assert(health.body.genAIProvider?.provider === 'openai', 'health identifies the optional OpenAI provider without exposing credentials');
    assert(health.body.genAIProvider?.configured === false, 'no-key local health reports the OpenAI provider as unavailable');
    assert(health.body.weatherMode === 'demo', 'local health reports demo weather mode');
    assert(health.body.responseProviders?.deterministic === true, 'local health reports deterministic response provider availability');
    assert(health.body.responseProviders?.openai === false, 'local health reports OpenAI response provider configuration');
    assert(health.body.responseProviders?.local === false, 'local health reports local response provider configuration');
    assert(health.body.genUiMode === 'hybrid', 'health reports the hybrid GenUI mode');
    assert(health.body.genUi === 'adaptive-cards', 'health reports Adaptive Cards as the GenUI renderer');
    assert(health.body.channelsShadow?.enabled === false, 'hybrid health disables Channels shadow diagnostics');
    assert(health.body.mcp === '/mcp' && health.body.mcpEnabled === true, 'local health exposes only the explicitly gated local MCP route');
    const healthSerialized = JSON.stringify(health.body);
    assert(!healthSerialized.includes(server.localAccessToken), 'local access token is absent from health output');
    assert(!healthSerialized.includes('OPENAI_API_KEY') && !healthSerialized.includes('LOCAL_MODEL_BASE_URL'), 'health omits provider secrets and endpoint URLs');

    const responseModeUnauthenticated = await request(server.baseUrl, '/api/response-mode', { localAccessToken: null });
    assert(responseModeUnauthenticated.response.status === 401, 'response-mode status requires the authenticated local boundary');
    const responseMode = await request(server.baseUrl, '/api/response-mode');
    assert(responseMode.response.status === 200, 'response-mode status is available to the authenticated user');
    assert(responseMode.body.mode === 'deterministic', 'no-key users default to the deterministic response engine');
    assert(JSON.stringify(responseMode.body.availability?.map((entry) => [entry.mode, entry.configured])) === JSON.stringify([
      ['deterministic', true],
      ['openai', false],
      ['local', false],
    ]), 'response-mode availability exposes deterministic as the only configured engine without keys');
    assert(!JSON.stringify(responseMode.body).includes('OPENAI_API_KEY') && !JSON.stringify(responseMode.body).includes('LOCAL_MODEL_BASE_URL'), 'response-mode status omits provider secrets and endpoint URLs');
    const unavailableOpenAi = await request(server.baseUrl, '/api/response-mode', {
      method: 'POST',
      body: JSON.stringify({ mode: 'openai' }),
    });
    assert(unavailableOpenAi.response.status === 409, 'unconfigured OpenAI mode cannot be selected at runtime');
    assert(unavailableOpenAi.body.mode === 'deterministic', 'failed mode selection preserves the deterministic mode');

    const responseModeActivity = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity('mode', server.baseUrl, 'response-mode-command')),
    });
    assert(responseModeActivity.response.status === 200, 'response-mode Bot command returns 200');
    assertAdaptiveCardActivity(responseModeActivity.body.activities?.[0], 'response-mode Bot command');

    const staticTab = await rawRequest(server.baseUrl, '/tabs/home', {}, null);
    assert(staticTab.response.statusCode === 200, 'static tab entry loads without the local access token');
    assert(!String(staticTab.body).includes(server.localAccessToken), 'static tab entry does not contain the local access token');

    const missingToken = await rawRequest(server.baseUrl, '/api/health', {}, null);
    assert(missingToken.response.statusCode === 401, 'local API denies a missing access token');
    assert(!String(missingToken.body).includes(server.localAccessToken), 'missing-token error does not contain the local access token');
    const wrongToken = await rawRequest(server.baseUrl, '/api/health', {}, 'wrong-local-access-token');
    assert(wrongToken.response.statusCode === 401, 'local API denies a wrong access token');
    assert(!String(wrongToken.body).includes(server.localAccessToken), 'wrong-token error does not contain the local access token');

    const publicHost = await rawRequest(server.baseUrl, '/api/health', { host: 'public.example.test' });
    assert(publicHost.response.statusCode === 403, 'safe local mode rejects a public Host header');
    const forwarded = await rawRequest(server.baseUrl, '/api/health', { 'x-forwarded-host': 'public.example.test' });
    assert(forwarded.response.statusCode === 403, 'safe local mode rejects forwarded proxy headers');
    const rewrittenLocalHost = await rawRequest(server.baseUrl, '/api/health', { host: '127.0.0.1' }, null);
    assert(rewrittenLocalHost.response.statusCode === 401, 'a rewritten local Host without a token is still denied');

    const initialize = await mcpRequest(server.baseUrl, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'teams-genui-runtime-test', version: '1.0.0' },
      },
    });
    assert(initialize.response.status === 200, 'MCP initialize returns 200');
    assert(Boolean(initialize.sessionId), 'MCP initialize returns mcp-session-id');
    assert(initialize.body?.result?.protocolVersion, 'MCP initialize negotiates a protocol version');
    const mcpProtocolVersion = initialize.body.result.protocolVersion;

    const initialized = await mcpRequest(server.baseUrl, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    }, { sessionId: initialize.sessionId, protocolVersion: mcpProtocolVersion });
    assert([200, 202].includes(initialized.response.status), 'MCP notifications/initialized follows the session flow');

    const toolsList = await mcpRequest(server.baseUrl, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }, { sessionId: initialize.sessionId, protocolVersion: mcpProtocolVersion });
    assert(toolsList.response.status === 200, 'MCP tools/list returns 200 with the session id');
    assert(toolsList.body?.result?.tools?.some((tool) => tool.name === 'get_workspace_snapshot'), 'MCP tools/list exposes get_workspace_snapshot');

    const workspaceSnapshot = await mcpRequest(server.baseUrl, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'get_workspace_snapshot', arguments: { limit: 8 } },
    }, { sessionId: initialize.sessionId, protocolVersion: mcpProtocolVersion });
    assert(workspaceSnapshot.response.status === 200, 'MCP get_workspace_snapshot returns 200');
    assert(workspaceSnapshot.body?.result?.structuredContent?.kind === 'task-list', 'MCP structuredContent returns the task-list GenUI envelope');
    assert(workspaceSnapshot.body?.result?.structuredContent?.schemaVersion === '1', 'MCP structuredContent uses GenUiEnvelopeV1');
    assert(workspaceSnapshot.body?.result?.content?.[0]?.text === workspaceSnapshot.body?.result?.structuredContent?.fallbackText, 'MCP text fallback matches the shared GenUI envelope');

    const copilotInfo = await request(server.baseUrl, '/api/copilotkit/info');
    assert(copilotInfo.response.status === 200, 'CopilotKit info endpoint returns 200');
    assert(copilotInfo.body.agents.default.description.includes('Teams 업무 허브'), 'CopilotKit discovers the Teams agent');

    const copilotTasks = await copilotRun(server.baseUrl, '현재 업무 목록 보여줘', 'runtime-copilot-tasks');
    assert(copilotTasks.response.status === 200, 'CopilotKit task request returns 200');
    assert(copilotTasks.events.some((event) => event.type === 'TOOL_CALL_START' && event.toolCallName === 'showTaskCard'), 'CopilotKit renders the task card tool');
    assert(copilotTasks.events.some((event) => event.type === 'RUN_FINISHED' && event.outcome?.type === 'success'), 'CopilotKit task request finishes successfully');

    const copilotWeather = await copilotRun(
      server.baseUrl,
      '현재 위치 날씨 보여줘',
      'runtime-copilot-weather',
      [{
        description: '현재 Teams 업무 허브 날씨 위젯 상태',
        value: JSON.stringify({
          source: 'open-meteo',
          location: { name: '테스트 위치', latitude: 35, longitude: 128, timezone: 'Asia/Seoul' },
          current: {
            temperature: 19.5,
            apparentTemperature: 20.1,
            humidity: 48,
            precipitation: 0,
            windSpeed: 4.2,
            condition: '맑음',
            icon: 'sun',
          },
        }),
      }],
    );
    const weatherArgs = copilotWeather.events.find((event) => event.type === 'TOOL_CALL_ARGS');
    assert(weatherArgs?.delta.includes('19.5'), 'CopilotKit weather tool uses the live tab context');

    const copilotCodex = await copilotRun(server.baseUrl, '저장소의 현재 구현 상태를 분석해줘', 'runtime-copilot-codex');
    assert(copilotCodex.events.some((event) => event.type === 'TEXT_MESSAGE_CONTENT' && event.delta.includes('Codex')), 'CopilotKit streams Codex progress messages');
    assert(copilotCodex.events.some((event) => event.type === 'RUN_FINISHED'), 'CopilotKit Codex request finishes');

    const copilotWrite = await copilotRun(server.baseUrl, 'write 테스트 파일 변경 계획을 검토해줘', 'runtime-copilot-write');
    const approvalArgs = copilotWrite.events.find((event) => event.type === 'TOOL_CALL_ARGS' && event.delta.includes('jobId'));
    const approvalJobId = approvalArgs ? JSON.parse(approvalArgs.delta).jobId : '';
    assert(Boolean(approvalJobId), 'CopilotKit write request returns an approval job id');
    const awaitingApproval = await waitForAgentStatus(server.baseUrl, approvalJobId, 'awaiting_approval');
    assert(awaitingApproval.mode === 'workspace-write', 'CopilotKit write request preserves approval boundary');
    const cancelledApproval = await request(server.baseUrl, `/api/agent-jobs/${approvalJobId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ conversationId: 'runtime-copilot-write' }),
    });
    assert(cancelledApproval.response.status === 200 && cancelledApproval.body.job.status === 'cancelled', 'CopilotKit approval card can cancel a write job');
    const staleCopilotCancel = await request(server.baseUrl, `/api/agent-jobs/${approvalJobId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ conversationId: 'runtime-copilot-write' }),
    });
    assert(staleCopilotCancel.response.status === 409, 'REST returns 409 for a stale cancellation');
    assert(staleCopilotCancel.body.job?.status === 'cancelled', 'stale REST cancellation returns the current scoped job state');

    const restRaceRequest = await copilotRun(server.baseUrl, 'write REST approval race', 'runtime-rest-approval-race');
    const restRaceArgs = restRaceRequest.events.find((event) => event.type === 'TOOL_CALL_ARGS' && event.delta.includes('jobId'));
    const restRaceJobId = restRaceArgs ? JSON.parse(restRaceArgs.delta).jobId : '';
    assert(Boolean(restRaceJobId), 'REST approval race has a scoped approval job');
    const firstRestApproval = await request(server.baseUrl, `/api/agent-jobs/${restRaceJobId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ conversationId: 'runtime-rest-approval-race' }),
    });
    assert(firstRestApproval.response.status === 200, 'REST approval performs the single valid transition');
    const staleRestApproval = await request(server.baseUrl, `/api/agent-jobs/${restRaceJobId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ conversationId: 'runtime-rest-approval-race' }),
    });
    assert(staleRestApproval.response.status === 409, 'REST returns 409 for a stale approval');

    const initial = await request(server.baseUrl, '/api/items');
    assert(initial.response.status === 200, 'local item list returns 200');
    assert(initial.body.summary.total === 2, 'seed data is available in the isolated store');

    const weather = await request(server.baseUrl, '/api/weather?latitude=37.5665&longitude=126.978&mode=demo');
    assert(weather.response.status === 200, 'weather widget endpoint returns 200');
    assert(weather.body.source === 'demo' && weather.body.current.condition === '맑음', 'weather widget returns demo conditions');

    const weatherCommand = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity('날씨', server.baseUrl, 'weather')),
    });
    assert(weatherCommand.response.status === 200, 'Bot weather command completes locally');
    assert(weatherCommand.body.messages[0].includes('현재 기기 위치가 자동으로 전달되지 않습니다'), 'Bot weather command does not guess a location');
    assertAdaptiveCardActivity(weatherCommand.body.activities[0], 'help/location weather fallback');

    const explicitWeatherCommand = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity('날씨 35.1796 129.0756', server.baseUrl, 'weather-explicit')),
    });
    assert(explicitWeatherCommand.response.status === 200, 'Bot explicit weather command completes locally');
    assert(explicitWeatherCommand.body.messages[0].includes('날씨 위젯'), 'Bot explicit weather command returns widget summary');
    assertAdaptiveCardActivity(explicitWeatherCommand.body.activities[0], 'explicit coordinate weather');

    const invalid = await request(server.baseUrl, '/api/items', {
      method: 'POST',
      body: JSON.stringify({ title: '   ' }),
    });
    assert(invalid.response.status === 400, 'empty item titles are rejected');

    const oversizedItem = await request(server.baseUrl, '/api/items', {
      method: 'POST',
      body: JSON.stringify({ title: 'x'.repeat(5_000) }),
    });
    assert(oversizedItem.response.status === 400, 'oversized REST item titles return a deterministic 4xx');
    assert(oversizedItem.body.error.includes('400'), 'oversized REST item titles report the useful bound');

    for (const [label, command] of [
      ['write', `write ${'x'.repeat(3_000)}`],
      ['run', `run ${'x'.repeat(3_000)}`],
      ['continue', `continue task-missing ${'x'.repeat(3_000)}`],
      ['natural', 'x'.repeat(3_000)],
    ]) {
      const oversizedPrompt = await request(server.baseUrl, '/api/messages', {
        method: 'POST',
        body: JSON.stringify(activity(command, server.baseUrl, `oversized-${label}`)),
      });
      assert(oversizedPrompt.response.status === 200, `${label} oversized prompt returns a Bot response instead of HTTP 500`);
      assert(oversizedPrompt.body.messages[0].includes('2000'), `${label} oversized prompt reports the useful bound`);
      assertAdaptiveCardActivity(oversizedPrompt.body.activities[0], `${label} oversized prompt error`);
    }

    const created = await request(server.baseUrl, '/api/items', {
      method: 'POST',
      body: JSON.stringify({ title: '런타임 검증 업무' }),
    });
    assert(created.response.status === 201, 'item creation returns 201');
    const createdId = created.body.item.id;

    const fetched = await request(server.baseUrl, `/api/items/${createdId}`);
    assert(fetched.response.status === 200 && fetched.body.item.id === createdId, 'single item lookup works');

    const updated = await request(server.baseUrl, `/api/items/${createdId}`, {
      method: 'PUT',
      body: JSON.stringify({ title: '수정된 런타임 검증 업무' }),
    });
    assert(updated.response.status === 200 && updated.body.item.title === '수정된 런타임 검증 업무', 'item update works');

    const completed = await request(server.baseUrl, `/api/items/${createdId}`, { method: 'PATCH' });
    assert(completed.response.status === 200 && completed.body.item.status === 'done', 'item status toggle works');

    const missing = await request(server.baseUrl, '/api/items/999999', { method: 'DELETE' });
    assert(missing.response.status === 404, 'missing item deletion returns 404');

    const removed = await request(server.baseUrl, `/api/items/${createdId}`, { method: 'DELETE' });
    assert(removed.response.status === 200 && removed.body.item.id === createdId, 'item deletion works');

    const help = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity('help', server.baseUrl, 'help')),
    });
    assert(help.response.status === 200, 'Bot help activity completes locally');
    assertAdaptiveCardActivity(help.body.activities[0], 'help');

    const status = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity('<at>runtime-bot</at> status', server.baseUrl, 'status')),
    });
    assert(status.response.status === 200, 'Bot status activity handles Teams mentions');

    const list = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity('list', server.baseUrl, 'list')),
    });
    assert(list.response.status === 200, 'Bot list activity completes locally');
    assertAdaptiveCardActivity(list.body.activities[0], 'list');

    const install = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(installActivity(server.baseUrl, 'install')),
    });
    assert(
      install.response.status === 200 && install.body.messages[0].includes('help'),
      'Bot installation activity returns a useful welcome message',
    );

    const agentRun = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity('run 저장소의 현재 상태를 안전하게 요약해줘', server.baseUrl, 'agent-run')),
    });
    assert(agentRun.response.status === 200, 'Bot accepts a remote Codex run request');
    const readOnlyJobId = agentRun.body.messages[0].match(/task-[\w-]+/)?.[0];
    assert(Boolean(readOnlyJobId), 'remote Codex request returns a task id');

    const completedReadOnly = await waitForAgentJob(server.baseUrl, readOnlyJobId);
    assert(completedReadOnly.status === 'completed', 'read-only Codex job completes');
    assert(completedReadOnly.result.includes('FAKE_CODEX_OK'), 'Codex JSONL result is persisted');
    assert(completedReadOnly.result.includes('REMOTE TEAMS CODEX OPERATING RULES'), 'remote Codex receives troubleshooting guidance');

    const readOnlyOutbox = await waitForOutboxMessages(
      server.baseUrl,
      'runtime-conversation-agent-run',
      [readOnlyJobId, '분석을 시작했습니다', '완료되었습니다', '중간 분석 업데이트'],
    );
    assert(
      readOnlyOutbox.body.messages.some((message) => message.includes(readOnlyJobId)),
      'completed Codex result is delivered to the conversation outbox',
    );
    assert(
      readOnlyOutbox.body.messages.some((message) => message.includes('분석을 시작했습니다')),
      'Codex progress is delivered before the final result',
    );
    assert(
      readOnlyOutbox.body.messages.some((message) => message.includes('완료되었습니다')),
      'Codex completion notification is delivered to the conversation',
    );
    assert(
      readOnlyOutbox.body.messages.some((message) => message.includes('중간 분석 업데이트')),
      'Codex intermediate agent updates are delivered to the conversation',
    );
    assert(
      readOnlyOutbox.body.messages.filter((message) => message.includes('필요한 도구를 실행하고 있습니다')).length === 1,
      'repeated tool events are deduplicated into one Teams progress notification',
    );
    assert(
      readOnlyOutbox.body.activities.some((activityValue) => Boolean(adaptiveCardFromActivity(activityValue))),
      'proactive outbox notifications include an Adaptive Card activity',
    );
    const proactiveCards = readOnlyOutbox.body.activities
      .map((activityValue) => adaptiveCardFromActivity(activityValue))
      .filter(Boolean);
    assert(
      proactiveCards.some((card) => JSON.stringify(card).includes('Codex 작업 진행'))
        && proactiveCards.some((card) => JSON.stringify(card).includes('상태: running')),
      'proactive progress uses a job-status/loading card with the running job state',
    );
    assert(
      proactiveCards.some((card) => JSON.stringify(card).includes('Codex 작업 완료'))
        && proactiveCards.some((card) => JSON.stringify(card).includes('상태: completed')),
      'proactive completion uses a result/complete card with the completed job state',
    );

    const naturalFollowUp = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity('같은 대화에서 한 줄로 이어서 확인해줘', server.baseUrl, 'agent-follow-up', 'runtime-conversation-agent-run')),
    });
    const naturalFollowUpJobId = naturalFollowUp.body.messages[0].match(/task-[\w-]+/)?.[0];
    assert(naturalFollowUp.body.messages[0].includes('이전 Codex 대화'), 'Natural Teams replies continue the latest Codex thread');
    const completedNaturalFollowUp = await waitForAgentJob(server.baseUrl, naturalFollowUpJobId);
    assert(completedNaturalFollowUp.status === 'completed', 'Natural Codex follow-up completes');
    assert(completedNaturalFollowUp.parentJobId === readOnlyJobId, 'Natural follow-up keeps the parent task link');
    assert(completedNaturalFollowUp.threadId === completedReadOnly.threadId, 'Natural follow-up reuses the Codex thread');

    const continued = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity(`continue ${readOnlyJobId} 같은 thread에서 한 줄로 이어서 확인해줘`, server.baseUrl, 'agent-continue', 'runtime-conversation-agent-run')),
    });
    const continuedJobId = continued.body.messages[0].match(/task-[\w-]+/)?.[0];
    assert(continued.body.messages[0].includes('이전 Codex thread'), 'Teams can continue a previous Codex thread');
    const completedContinuation = await waitForAgentJob(server.baseUrl, continuedJobId);
    assert(completedContinuation.status === 'completed', 'continued Codex job completes');
    assert(completedContinuation.parentJobId === readOnlyJobId, 'continued job keeps its parent task link');

    const slowRun = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity('run SLOW 취소 가능한 작업', server.baseUrl, 'agent-cancel')),
    });
    const slowJobId = slowRun.body.messages[0].match(/task-[\w-]+/)?.[0];
    await waitForAgentStatus(server.baseUrl, slowJobId, 'running');
    const cancelled = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity(`cancel ${slowJobId}`, server.baseUrl, 'agent-cancel-command', 'runtime-conversation-agent-cancel')),
    });
    assert(cancelled.body.messages[0].includes('취소'), 'running Codex job can be cancelled');
    const cancelledJob = await waitForAgentJob(server.baseUrl, slowJobId);
    assert(cancelledJob.status === 'cancelled', 'cancelled Codex job stays cancelled');

    const genUiCancelRequest = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity('write GenUI 취소 액션을 검증해줘', server.baseUrl, 'genui-cancel')),
    });
    const genUiCancelCard = assertAdaptiveCardActivity(genUiCancelRequest.body.activities[0], 'write approval');
    const approveAction = genUiCancelCard.actions?.find((action) => action.verb === 'genui.approve');
    const cancelAction = genUiCancelCard.actions?.find((action) => action.verb === 'genui.cancel');
    const approvePayload = actionPayloadFromCard(approveAction);
    const cancelPayload = actionPayloadFromCard(cancelAction);
    assertExactGenUiActionPayload(approvePayload, 'approve');
    assertExactGenUiActionPayload(cancelPayload, 'cancel');
    assert(cancelPayload.action === 'cancel', 'cancel payload identifies the cancel action');
    const genUiCancelJobId = cancelPayload.entityId;

    const cancelInvoke = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(genUiInvokeActivity(
        server.baseUrl,
        cancelPayload,
        'genui-cancel-invoke',
        'runtime-conversation-genui-cancel',
      )),
    });
    assert(cancelInvoke.response.status === 200 && cancelInvoke.body.statusCode === 200, 'cancel Action.Execute invoke returns the existing invoke response');
    assertCancelledCard(cancelInvoke.body.value, 'cancel Action.Execute invoke');
    const genUiCancelledJob = await waitForAgentJob(server.baseUrl, genUiCancelJobId);
    assert(genUiCancelledJob.status === 'cancelled', 'cancel Action.Execute transitions the job to cancelled');

    const duplicateCancelInvoke = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(genUiInvokeActivity(
        server.baseUrl,
        cancelPayload,
        'genui-cancel-duplicate',
        'runtime-conversation-genui-cancel',
      )),
    });
    assert(duplicateCancelInvoke.response.status === 200, 'replayed cancel Action.Execute is accepted as an idempotent replay');
    assertCancelledCard(duplicateCancelInvoke.body.value, 'replayed cancel Action.Execute');
    const replayedJob = (await request(server.baseUrl, '/api/debug/agent-jobs')).body.jobs.find((job) => job.id === genUiCancelJobId);
    assert(replayedJob?.status === 'cancelled', 'replayed cancel does not execute the job again');

    const conflictingApproveInvoke = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(genUiInvokeActivity(
        server.baseUrl,
        approvePayload,
        'genui-conflicting-approve',
        'runtime-conversation-genui-cancel',
      )),
    });
    assert(conflictingApproveInvoke.response.status === 200, 'conflicting GenUI approval returns a safe invoke response');
    assert(JSON.stringify(conflictingApproveInvoke.body.value).includes('업무 허브 오류'), 'conflicting GenUI approval renders an error card');
    assert(JSON.stringify(conflictingApproveInvoke.body.value).includes('현재 상태'), 'conflicting GenUI approval explains the current state');

    const conflictingNaturalApprove = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity(`approve ${genUiCancelJobId}`, server.baseUrl, 'genui-conflicting-natural-approve', 'runtime-conversation-genui-cancel')),
    });
    assert(conflictingNaturalApprove.response.status === 200, 'conflicting natural approval returns a Bot response');
    assert(JSON.stringify(conflictingNaturalApprove.body.activities[0]).includes('업무 허브 오류'), 'conflicting natural approval renders a GenUI error');
    assert(conflictingNaturalApprove.body.messages[0].includes('현재 상태'), 'conflicting natural approval does not claim success');

    const genUiSubmitRequest = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity('write GenUI Submit 전송을 검증해줘', server.baseUrl, 'genui-submit')),
    });
    const genUiSubmitCard = assertAdaptiveCardActivity(genUiSubmitRequest.body.activities[0], 'Action.Submit approval');
    const submitApprovePayload = actionPayloadFromCard(
      genUiSubmitCard.actions?.find((action) => action.verb === 'genui.approve'),
    );
    assertExactGenUiActionPayload(submitApprovePayload, 'Action.Submit approve');
    const submitResult = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(genUiSubmitActivity(
        server.baseUrl,
        submitApprovePayload,
        'genui-submit-approve',
        'runtime-conversation-genui-submit',
      )),
    });
    assert(submitResult.response.status === 200, 'Action.Submit message/value returns 200');
    assertAdaptiveCardActivity(submitResult.body.activities[0], 'Action.Submit message/value');
    const genUiSubmitJob = await waitForAgentJob(server.baseUrl, submitApprovePayload.entityId);
    assert(genUiSubmitJob.status === 'completed', 'Action.Submit approval starts and completes the Codex job');

    const writeRequest = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity('write 테스트 파일 변경 계획을 검토해줘', server.baseUrl, 'agent-write')),
    });
    const naturalApprovalCard = assertAdaptiveCardActivity(writeRequest.body.activities[0], 'natural-language workspace-write approval');
    assert(naturalApprovalCard.actions?.some((action) => action.verb === 'genui.approve'), 'natural-language approval card includes an approve action');
    assert(naturalApprovalCard.actions?.some((action) => action.verb === 'genui.cancel'), 'natural-language approval card includes a cancel action');
    const writeJobId = writeRequest.body.messages[0].match(/task-[\w-]+/)?.[0];
    assert(writeRequest.body.messages[0].includes('승인 대기'), 'workspace-write request requires approval');

    const approved = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity(`approve ${writeJobId}`, server.baseUrl, 'agent-approve', 'runtime-conversation-agent-write')),
    });
    assert(approved.body.messages[0].includes('승인'), 'workspace-write job can be approved from Teams');

    const completedWrite = await waitForAgentJob(server.baseUrl, writeJobId);
    assert(completedWrite.status === 'completed', 'approved workspace-write job completes');
    assert(completedWrite.mode === 'workspace-write', 'approved job preserves write mode');

    // Scope regression: every externally reachable job operation must behave
    // like not-found outside requester + conversation + tenant. The debug
    // endpoint below is local-only evidence and is never used as an app API.
    const scopeConversationId = 'runtime-scope-conversation';
    const scopeOwner = { userId: 'scope-owner', tenantId: 'scope-tenant' };
    const scopedWriteRequest = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity('write scope regression approval', server.baseUrl, 'scope-owner-write', scopeConversationId, scopeOwner)),
    });
    const scopedWriteJobId = scopedWriteRequest.body.messages[0].match(/task-[\w-]+/)?.[0];
    assert(Boolean(scopedWriteJobId), 'scope regression creates a scoped approval job');
    const scopedWriteBefore = await waitForAgentStatus(server.baseUrl, scopedWriteJobId, 'awaiting_approval');
    assert(scopedWriteBefore.tenantId === 'scope-tenant', 'new jobs persist tenantId');

    const unauthorizedScopes = [
      { label: 'second user', conversationId: scopeConversationId, identity: { userId: 'scope-other-user', tenantId: 'scope-tenant' } },
      { label: 'second conversation', conversationId: 'runtime-scope-other-conversation', identity: scopeOwner },
      { label: 'wrong tenant', conversationId: scopeConversationId, identity: { userId: 'scope-owner', tenantId: 'scope-other-tenant' } },
    ];
    for (const unauthorized of unauthorizedScopes) {
      const statusResult = await request(server.baseUrl, '/api/messages', {
        method: 'POST',
        body: JSON.stringify(activity(`status ${scopedWriteJobId}`, server.baseUrl, `scope-${unauthorized.label}-status`, unauthorized.conversationId, unauthorized.identity)),
      });
      const listResult = await request(server.baseUrl, '/api/messages', {
        method: 'POST',
        body: JSON.stringify(activity('list', server.baseUrl, `scope-${unauthorized.label}-list`, unauthorized.conversationId, unauthorized.identity)),
      });
      assert(JSON.stringify(statusResult.body).includes('찾을 수 없습니다'), `${unauthorized.label} gets not-found for job status`);
      assert(!JSON.stringify(listResult.body).includes(scopedWriteJobId), `${unauthorized.label} cannot list the job`);

      for (const [command, label] of [
        [`approve ${scopedWriteJobId}`, 'approve'],
        [`cancel ${scopedWriteJobId}`, 'cancel'],
        [`continue ${scopedWriteJobId} unauthorized continuation`, 'continue'],
        [`commit ${scopedWriteJobId} unauthorized commit`, 'commit'],
      ]) {
        const mutation = await request(server.baseUrl, '/api/messages', {
          method: 'POST',
          body: JSON.stringify(activity(command, server.baseUrl, `scope-${unauthorized.label}-${label}`, unauthorized.conversationId, unauthorized.identity)),
        });
        assert(!JSON.stringify(mutation.body).includes(scopedWriteJobId), `${unauthorized.label} cannot ${label} the job`);
      }
    }

    const rightfulStatus = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity(`status ${scopedWriteJobId}`, server.baseUrl, 'scope-owner-status', scopeConversationId, scopeOwner)),
    });
    assert(JSON.stringify(rightfulStatus.body).includes(scopedWriteJobId), 'rightful scope can read job status');
    const rightfulList = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity('list', server.baseUrl, 'scope-owner-list', scopeConversationId, scopeOwner)),
    });
    assert(JSON.stringify(rightfulList.body).includes(scopedWriteJobId), 'rightful scope can list its job');
    const rightfulCancel = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity(`cancel ${scopedWriteJobId}`, server.baseUrl, 'scope-owner-cancel', scopeConversationId, scopeOwner)),
    });
    assert(rightfulCancel.body.messages[0].includes('취소'), 'rightful scope can cancel its job');
    assert((await waitForAgentStatus(server.baseUrl, scopedWriteJobId, 'cancelled')).status === 'cancelled', 'unauthorized mutations did not change the job before rightful cancel');

    const missingConversationRest = await request(server.baseUrl, `/api/agent-jobs/${scopedWriteJobId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ requesterId: 'scope-owner' }),
    });
    assert(missingConversationRest.response.status === 400, 'REST job mutation rejects missing conversationId');
    const forgedRequesterRest = await request(server.baseUrl, `/api/agent-jobs/${scopedWriteJobId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ conversationId: scopeConversationId, requesterId: 'scope-owner' }),
    });
    assert(forgedRequesterRest.response.status === 404, 'REST ignores caller-supplied requesterId and returns not-found');

    const cardConversationId = 'runtime-scope-card-conversation';
    const cardOwner = { userId: 'scope-card-owner', tenantId: 'scope-card-tenant' };
    const cardCreate = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity('write scoped card approval', server.baseUrl, 'scope-card-create', cardConversationId, cardOwner)),
    });
    const card = assertAdaptiveCardActivity(cardCreate.body.activities[0], 'scoped card approval');
    const cardApprovePayload = actionPayloadFromCard(card.actions?.find((action) => action.verb === 'genui.approve'));
    assertExactGenUiActionPayload(cardApprovePayload, 'scoped card approve');
    const cardAttack = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(genUiInvokeActivity(
        server.baseUrl,
        cardApprovePayload,
        'scope-card-attack',
        cardConversationId,
        { userId: 'scope-card-other-user', tenantId: 'scope-card-tenant' },
      )),
    });
    assert(JSON.stringify(cardAttack.body.value).includes('찾을 수 없습니다'), 'card action from another user is not-found');
    assert((await waitForAgentStatus(server.baseUrl, cardApprovePayload.entityId, 'awaiting_approval')).status === 'awaiting_approval', 'unauthorized card action does not mutate the job');
    const cardTenantAttack = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(genUiInvokeActivity(
        server.baseUrl,
        cardApprovePayload,
        'scope-card-tenant-attack',
        cardConversationId,
        { userId: 'scope-card-owner', tenantId: 'scope-card-other-tenant' },
      )),
    });
    assert(JSON.stringify(cardTenantAttack.body.value).includes('찾을 수 없습니다'), 'card action from another tenant is not-found');
    const cardApproved = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(genUiInvokeActivity(server.baseUrl, cardApprovePayload, 'scope-card-owner-approve', cardConversationId, cardOwner)),
    });
    assert(cardApproved.response.status === 200, 'rightful card action remains usable');
    assert((await waitForAgentJob(server.baseUrl, cardApprovePayload.entityId)).status === 'completed', 'rightful card approval completes the job');

    const persisted = JSON.parse(await fs.readFile(dataFile, 'utf8'));
    assert(Array.isArray(persisted) && persisted.length === 2, 'isolated JSON store persists final state');
  } finally {
    await stopServer(server.child);
  }
}

async function runChannelsShadowFlow(dataFile, jobDataFile) {
  const server = await startServer({
    production: false,
    dataFile,
    jobDataFile,
    extraEnv: { TEAMS_GENUI_MODE: 'channels-shadow' },
  });

  try {
    const initialHealth = await request(server.baseUrl, '/api/health');
    assert(initialHealth.response.status === 200, 'Channels shadow health endpoint returns 200');
    assert(initialHealth.body.genUiMode === 'channels-shadow', 'runtime selects the Channels shadow mode');
    assert(initialHealth.body.channelsShadow?.enabled === true, 'Channels shadow diagnostics are enabled only in shadow mode');
    assert(initialHealth.body.channelsShadow.renderCount === 0, 'Channels shadow diagnostics start empty');

    const help = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity('help', server.baseUrl, 'channels-shadow-help')),
    });
    const helpCard = assertAdaptiveCardActivity(help.body.activities[0], 'Channels shadow help');
    const helpSerialized = JSON.stringify(help.body.activities[0]);
    assert(!helpSerialized.includes('copilotkit-channels-shadow'), 'delivered help activity omits the shadow renderer marker');
    assert(!helpSerialized.includes('"shadow":true'), 'delivered help activity omits shadow-only action data');
    assert((helpCard.actions?.length ?? 0) === 0, 'help keeps the native card action set unchanged');

    const approval = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity('write Channels shadow approval', server.baseUrl, 'channels-shadow-approval')),
    });
    const approvalCard = assertAdaptiveCardActivity(approval.body.activities[0], 'Channels shadow approval');
    const approvalSerialized = JSON.stringify(approval.body.activities[0]);
    assert(!approvalSerialized.includes('copilotkit-channels-shadow'), 'delivered approval activity omits the shadow renderer marker');
    assert(!approvalSerialized.includes('"shadow":true'), 'delivered approval activity omits shadow-only action data');
    const approvalPayload = actionPayloadFromCard(
      approvalCard.actions?.find((action) => action.verb === 'genui.approve'),
    );
    assertExactGenUiActionPayload(approvalPayload, 'Channels shadow native approval');

    const shadowPayload = {
      ...approvalPayload,
      shadow: true,
      renderer: 'copilotkit-channels-shadow',
    };
    const shadowAction = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify({
        ...genUiSubmitActivity(
          server.baseUrl,
          shadowPayload,
          'channels-shadow-action',
          'runtime-conversation-channels-shadow-approval',
        ),
      }),
    });
    assert(shadowAction.response.status === 200, 'shadow action payload is handled without crashing delivery');
    assert(JSON.stringify(shadowAction.body).includes('유효하지 않은 GenUI 카드 액션'), 'shadow action payload is rejected');
    const approvalJobId = approvalPayload.entityId;
    const approvalJob = (await request(server.baseUrl, '/api/debug/agent-jobs')).body.jobs.find((job) => job.id === approvalJobId);
    assert(approvalJob?.status === 'awaiting_approval', 'rejected shadow action payload does not mutate the approval job');

    const health = await request(server.baseUrl, '/api/health');
    const diagnostics = health.body.channelsShadow;
    assert(diagnostics.renderCount >= 2, 'native help and approval deliveries increment shadow render count');
    assert(diagnostics.failureCount === 0, 'successful shadow comparisons have no render failures');
    assert(diagnostics.budgetFailures === 0, 'native and shadow cards stay within the Teams budget');
    assert(diagnostics.actionCountMismatches === 0, 'native and shadow action counts match');
    assert(diagnostics.kindMismatches === 0, 'native and shadow kinds match');
    assert(diagnostics.statusMismatches === 0, 'native and shadow statuses match');
    assert(diagnostics.orderedSectionTypeMismatches === 0, 'native and shadow ordered section types match');
    assert(diagnostics.deliveredCardMismatches === 0, 'delivered native cards match diagnostic native renders');
    assert(typeof diagnostics.lastNativeBytes === 'number' && typeof diagnostics.lastShadowBytes === 'number', 'health exposes only native/shadow byte aggregates');
    assert(diagnostics.lastWithinBudget === true, 'health reports the last comparison within budget');
    assert(diagnostics.lastKindMatch === true, 'health reports the last kind comparison');
    assert(diagnostics.lastStatusMatch === true, 'health reports the last status comparison');
    assert(diagnostics.lastOrderedSectionTypesMatch === true, 'health reports the last ordered section comparison');
    assert(diagnostics.lastDeliveredCardMatch === true, 'health reports the last delivered-card comparison');
    const healthSerialized = JSON.stringify(diagnostics);
    assert(!healthSerialized.includes('task-') && !healthSerialized.includes('token') && !healthSerialized.includes('conversation'), 'shadow health metrics expose no IDs, tokens, or conversation data');
  } finally {
    await stopServer(server.child);
  }
}

async function runAgentTimeoutFlow(dataFile, jobDataFile) {
  const server = await startServer({ production: false, dataFile, jobDataFile, codexTimeoutMs: 300 });

  try {
    const response = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity('run SLOW 시간 제한 검증', server.baseUrl, 'agent-timeout')),
    });
    const jobId = response.body.messages[0].match(/task-[\w-]+/)?.[0];
    const failed = await waitForAgentJob(server.baseUrl, jobId);
    assert(failed.status === 'failed', 'Codex job fails cleanly after timeout');
    assert(failed.error.includes('시간 제한'), 'timeout failure explains the reason');

    const timeoutOutbox = await waitForOutboxMessage(
      server.baseUrl,
      'runtime-conversation-agent-timeout',
      '시간 제한',
    );
    assert(true, 'timeout failure is delivered to Teams');
    const timeoutCards = timeoutOutbox.activities
      .map((activityValue) => adaptiveCardFromActivity(activityValue))
      .filter(Boolean);
    assert(
      timeoutCards.some((card) => JSON.stringify(card).includes('Codex 작업 오류'))
        && timeoutCards.some((card) => JSON.stringify(card).includes('상태: failed')),
      'proactive timeout failure uses an error/error card with the failed job state',
    );
  } finally {
    await stopServer(server.child);
  }
}

async function runProductionAuthFlow(dataFile, jobDataFile) {
  const server = await startServer({
    production: true,
    teamsSdk: true,
    dataFile,
    jobDataFile,
    extraEnv: { WEATHER_MODE: 'live' },
  });

  try {
    const health = await request(server.baseUrl, '/api/health');
    assert(health.response.status === 200, 'production health endpoint returns 200');
    assert(health.body.auth === 'teams-authenticated', 'production does not use local auth bypass');
    assert(health.body.userAuth === 'entra-sso', 'production health reports Entra SSO only when configured');
    assert(health.body.bot === 'teams-sdk', 'production health reports the Teams SDK Bot');
    assert(health.body.version === '1.0.15', 'production health reports the Teams manifest version');
    assert(health.body.genAI === 'not-configured', 'no-key production health does not pretend that OpenAI is configured');
    assert(health.body.genAIProvider?.provider === 'openai' && health.body.genAIProvider?.configured === false, 'no-key production health keeps the optional provider unavailable and healthy');
    assert(health.body.weatherMode === 'live', 'production health reports live weather mode');
    assert(health.body.responseProviders?.deterministic === true, 'production health reports deterministic response provider availability');
    assert(health.body.responseProviders?.openai === false, 'production health reports OpenAI response provider configuration');
    assert(health.body.responseProviders?.local === false, 'production health reports local response provider configuration');
    assert(!JSON.stringify(health.body).includes('OPENAI_API_KEY') && !JSON.stringify(health.body).includes('LOCAL_MODEL_BASE_URL'), 'production health omits provider secrets and endpoint URLs');
    assert(health.body.mcp === 'disabled' && health.body.mcpEnabled === false, 'production disables MCP unless explicitly opted in');

    const disabledMcp = await request(server.baseUrl, '/mcp');
    assert(disabledMcp.response.status === 404, 'disabled production MCP route is not mounted');

    const withoutToken = await request(server.baseUrl, '/api/items');
    assert(withoutToken.response.status === 401, 'production API rejects requests without a bearer token');

    const weatherWithoutToken = await request(server.baseUrl, '/api/weather?latitude=37.5665&longitude=126.978&mode=demo');
    assert(weatherWithoutToken.response.status === 401, 'production weather API rejects requests without a bearer token');

    const invalidToken = await request(server.baseUrl, '/api/items', {
      headers: { authorization: 'Bearer definitely-invalid' },
    });
    assert(invalidToken.response.status === 401, 'production API rejects invalid bearer tokens');
  } finally {
    await stopServer(server.child);
  }
}

async function runTeamsSdkFlow(dataFile, jobDataFile) {
  const server = await startServer({
    production: false,
    dataFile,
    jobDataFile,
    teamsSdk: true,
    extraEnv: { COPILOTKIT_DETERMINISTIC_MODE: '' },
  });

  try {
    const health = await request(server.baseUrl, '/api/health');
    assert(health.body.bot === 'teams-sdk', 'Teams SDK runtime branch is active');
    assert(health.body.genAIProvider?.configured === false, 'Teams SDK runtime has no OpenAI key');

    const modeStatus = await request(server.baseUrl, '/api/response-mode');
    assert(modeStatus.body.mode === 'deterministic', 'Teams Bot defaults to the persisted deterministic mode without a key');

    const response = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity('run SDK 라우트에서 Codex 작업을 확인해줘', server.baseUrl, 'sdk-agent')),
    });
    assert(
      response.response.status >= 200 && response.response.status < 300,
      `Teams SDK accepts a Bot Framework Activity (${response.response.status}) ${JSON.stringify(response.body)}`,
    );

    const jobsDeadline = Date.now() + 10_000;
    let jobs = [];
    while (Date.now() < jobsDeadline) {
      const result = await request(server.baseUrl, '/api/debug/agent-jobs');
      jobs = result.body.jobs;
      if (jobs.some((job) => job.status === 'completed')) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const sdkJob = jobs.find((job) => job.id.includes('task-') && job.status === 'completed');
    assert(Boolean(sdkJob), 'Teams SDK Activity reaches and completes a Codex job');

    const outbox = await request(server.baseUrl, '/api/debug/agent-outbox/runtime-conversation-sdk-agent');
    assert(outbox.body.messages.some((message) => message.includes(sdkJob.id)), 'Teams SDK completion is queued for outbound delivery');
  } finally {
    await stopServer(server.child);
  }
}

async function runGitCommitFlow(workspace, dataFile, jobDataFile) {
  await execFileAsync('git', ['init'], { cwd: workspace });
  await execFileAsync('git', ['config', 'user.name', 'Runtime Test'], { cwd: workspace });
  await execFileAsync('git', ['config', 'user.email', 'runtime@example.test'], { cwd: workspace });
  await fs.writeFile(path.join(workspace, 'README.md'), 'runtime workspace\n', 'utf8');
  await execFileAsync('git', ['add', 'README.md'], { cwd: workspace });
  await execFileAsync('git', ['commit', '-m', 'test: seed runtime workspace'], { cwd: workspace });

  const server = await startServer({ production: false, dataFile, jobDataFile, workspace });

  try {
    const writeRequest = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity('write MUTATE 런타임 변경을 생성해줘', server.baseUrl, 'git-write')),
    });
    const jobId = writeRequest.body.messages[0].match(/task-[\w-]+/)?.[0];
    await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity(`approve ${jobId}`, server.baseUrl, 'git-approve', 'runtime-conversation-git-write')),
    });
    const completed = await waitForAgentJob(server.baseUrl, jobId);
    assert(completed.status === 'completed', 'approved write job completes in an isolated Git workspace');

    const commit = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity(`commit ${jobId} test: runtime agent change`, server.baseUrl, 'git-commit', 'runtime-conversation-git-write')),
    });
    assert(commit.body.messages[0].includes('커밋'), 'Teams commit command creates a Git commit');
    const committed = (await execFileAsync('git', ['log', '-1', '--format=%s'], { cwd: workspace })).stdout.trim();
    assert(committed === 'test: runtime agent change', 'Git commit message is preserved');
  } finally {
    await stopServer(server.child);
  }
}

async function runRecoveryFlow(dataFile, jobDataFile) {
  await fs.writeFile(
    dataFile,
    JSON.stringify([
      { id: 77, title: 'legacy item '.repeat(500), status: 'open' },
    ]),
    'utf8',
  );
  await fs.writeFile(
    jobDataFile,
    JSON.stringify([
      {
        id: 'task-recovery-check',
        prompt: 'interrupted task',
        mode: 'read-only',
        status: 'running',
        conversationId: 'recovery-conversation',
        requesterId: 'recovery-user',
        progress: ['Codex 작업을 시작했습니다.'],
        createdAt: new Date().toISOString(),
      },
      {
        id: 'task-legacy-long',
        prompt: 'legacy prompt '.repeat(250),
        mode: 'read-only',
        status: 'completed',
        conversationId: 'recovery-conversation',
        requesterId: 'recovery-user',
        progress: ['legacy progress '.repeat(400)],
        result: 'legacy result '.repeat(400),
        createdAt: new Date().toISOString(),
      },
    ]),
    'utf8',
  );

  const server = await startServer({ production: false, dataFile, jobDataFile });
  try {
    const result = await request(server.baseUrl, '/api/debug/agent-jobs');
    const recovered = result.body.jobs.find((job) => job.id === 'task-recovery-check');
    assert(recovered.status === 'failed', 'interrupted Codex jobs are marked failed after restart');
    assert(recovered.error.includes('재시작'), 'restart recovery keeps a useful failure reason');
    const legacyList = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity('list', server.baseUrl, 'legacy-long-list', 'recovery-conversation', {
        userId: 'recovery-user',
        tenantId: 'runtime-tenant',
      })),
    });
    assert(legacyList.response.status === 200, 'legacy oversized item/job data still renders a GenUI list');
    assertAdaptiveCardActivity(legacyList.body.activities[0], 'legacy oversized item/job list');
    const legacyLongStatus = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity('status task-legacy-long', server.baseUrl, 'legacy-long-status', 'recovery-conversation', {
        userId: 'recovery-user',
        tenantId: 'runtime-tenant',
      })),
    });
    assert(legacyLongStatus.response.status === 200, 'legacy oversized job data still renders a GenUI status card');
    assertAdaptiveCardActivity(legacyLongStatus.body.activities[0], 'legacy oversized job status');
    const legacyStatus = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity('status task-recovery-check', server.baseUrl, 'legacy-status')),
    });
    assert(JSON.stringify(legacyStatus.body).includes('찾을 수 없습니다'), 'legacy jobs without tenantId are not readable through scoped commands');
    const legacyCancel = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity('cancel task-recovery-check', server.baseUrl, 'legacy-cancel')),
    });
    assert(!JSON.stringify(legacyCancel.body).includes('task-recovery-check'), 'legacy jobs without tenantId cannot be mutated through scoped commands');
    const afterLegacyAttempt = (await request(server.baseUrl, '/api/debug/agent-jobs')).body.jobs.find((job) => job.id === 'task-recovery-check');
    assert(afterLegacyAttempt.status === 'failed', 'legacy mutation attempt leaves recovered job unchanged');
  } finally {
    await stopServer(server.child);
  }
}

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-sdk-runtime-'));
const localDataFile = path.join(tempDir, 'local-items.json');
const productionDataFile = path.join(tempDir, 'production-items.json');
const localJobDataFile = path.join(tempDir, 'local-agent-jobs.json');
const productionJobDataFile = path.join(tempDir, 'production-agent-jobs.json');
const sdkDataFile = path.join(tempDir, 'sdk-items.json');
const sdkJobDataFile = path.join(tempDir, 'sdk-agent-jobs.json');
const gitWorkspace = await fs.mkdtemp(path.join(tempDir, 'git-workspace-'));
const gitDataFile = path.join(tempDir, 'git-items.json');
const gitJobDataFile = path.join(tempDir, 'git-agent-jobs.json');
const recoveryDataFile = path.join(tempDir, 'recovery-items.json');
const recoveryJobDataFile = path.join(tempDir, 'recovery-agent-jobs.json');
const timeoutDataFile = path.join(tempDir, 'timeout-items.json');
const timeoutJobDataFile = path.join(tempDir, 'timeout-agent-jobs.json');
const channelsShadowDataFile = path.join(tempDir, 'channels-shadow-items.json');
const channelsShadowJobDataFile = path.join(tempDir, 'channels-shadow-agent-jobs.json');
const leaseDataFile = path.join(tempDir, 'lease-items.json');
const leaseJobDataFile = path.join(tempDir, 'lease-agent-jobs.json');

try {
  console.log('Runtime verification: local-auth and public-MCP startup gates');
  await runStartupGateFlow();
  console.log('Runtime verification: local authenticated-bypass flow');
  await runLocalFlow(localDataFile, localJobDataFile);
  console.log('Runtime verification: file store process lease flow');
  await runStoreLeaseFlow(leaseDataFile, leaseJobDataFile);
  console.log('Runtime verification: Channels shadow comparison flow');
  await runChannelsShadowFlow(channelsShadowDataFile, channelsShadowJobDataFile);
  console.log('Runtime verification: Teams SDK Activity flow');
  await runTeamsSdkFlow(sdkDataFile, sdkJobDataFile);
  console.log('Runtime verification: approved Git commit flow');
  await runGitCommitFlow(gitWorkspace, gitDataFile, gitJobDataFile);
  console.log('Runtime verification: interrupted job recovery');
  await runRecoveryFlow(recoveryDataFile, recoveryJobDataFile);
  console.log('Runtime verification: Codex timeout flow');
  await runAgentTimeoutFlow(timeoutDataFile, timeoutJobDataFile);
  console.log('Runtime verification: production authentication guard');
  await runProductionAuthFlow(productionDataFile, productionJobDataFile);
  console.log('Runtime verification complete.');
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
