import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';

import { createUserAuthMiddleware } from '../src/server/user-auth.js';
import { ResponseModeStore } from '../src/server/response-mode-store.js';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const ACCESS_TOKEN_HEADER = 'x-teams-local-access-token';

function assertPass(condition: unknown, message: string): asserts condition {
  assert.ok(condition, `FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function waitForHealth(
  baseUrl: string,
  token: string,
  diagnostics?: () => { exitCode: number | null; output: string },
): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const state = diagnostics?.();
    if (state?.exitCode !== null && state?.exitCode !== undefined) {
      throw new Error(
        `response-mode test server exited before health check (code ${state.exitCode}):\n${state.output.slice(-4_000)}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        headers: { [ACCESS_TOKEN_HEADER]: token },
      });
      if (response.ok) return;
    } catch {
      // The server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const state = diagnostics?.();
  throw new Error(
    `server did not become healthy: ${baseUrl}\n${state?.output?.slice(-4_000) ?? 'no child-process diagnostics'}`,
  );
}

async function request(
  baseUrl: string,
  pathname: string,
  token: string | undefined,
  init: RequestInit = {},
): Promise<{ response: Response; body: any }> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (token) headers.set(ACCESS_TOKEN_HEADER, token);
  const response = await fetch(`${baseUrl}${pathname}`, { ...init, headers });
  const text = await response.text();
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Keep non-JSON responses available for diagnostics.
  }
  return { response, body };
}

function activity(baseUrl: string, text: string, suffix: string, value?: unknown) {
  return {
    type: 'message',
    id: `response-mode-${suffix}`,
    timestamp: new Date().toISOString(),
    serviceUrl: baseUrl,
    channelId: 'msteams',
    from: {
      id: '29:response-mode-bot-framework-user',
      aadObjectId: 'response-mode-user',
      name: 'Response Mode Test User',
    },
    conversation: { id: `response-mode-conversation-${suffix}`, tenantId: 'response-mode-tenant' },
    channelData: { tenant: { id: 'response-mode-tenant' } },
    recipient: { id: 'runtime-bot', name: 'Teams SDK MVP' },
    text,
    ...(value === undefined ? {} : { value }),
  };
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
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

async function testProductionMiddlewareRejectsUnauthenticated(): Promise<void> {
  let nextCalled = false;
  let statusCode = 200;
  let responseBody: unknown;
  const middleware = createUserAuthMiddleware({
    allowUnauthenticated: false,
    validator: { validateAccessToken: async () => ({ oid: 'should-not-be-used', tid: 'should-not-be-used' }) },
  });
  await middleware(
    { headers: {}, method: 'GET', originalUrl: '/api/response-mode' } as any,
    {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(body: unknown) {
        responseBody = body;
        return this;
      },
    } as any,
    () => { nextCalled = true; },
  );
  assert.equal(statusCode, 401);
  assert.equal(nextCalled, false);
  assert.deepEqual(responseBody, { error: 'Bearer token is required' });
  console.log('PASS: production-style unauthenticated response-mode request is rejected');
}

async function main(): Promise<void> {
  await testProductionMiddlewareRejectsUnauthenticated();
  await execFileAsync(process.execPath, ['scripts/build-server.mjs'], { cwd: root });

  const dataRoot = await mkdtemp(join(tmpdir(), 'response-mode-api-test-'));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const token = 'response-mode-local-test-token-0123456789';
  const child = spawn(process.execPath, ['dist/server/index.js'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      ITEM_STORE_PATH: join(dataRoot, 'items.json'),
      AGENT_JOB_STORE_PATH: join(dataRoot, 'agent-jobs.json'),
      GENUI_ACTION_STORE_PATH: join(dataRoot, 'genui-actions.json'),
      RESPONSE_MODE_STORE_PATH: join(dataRoot, 'response-modes.json'),
      AGENT_WORKSPACE: root,
      CODEX_BIN: process.execPath,
      CODEX_SCRIPT: join(root, 'scripts/fake-codex.mjs'),
      WEATHER_MODE: 'demo',
      COPILOTKIT_DETERMINISTIC_MODE: 'true',
      OPENAI_API_KEY: '',
      OPENAI_MODEL: '',
      LOCAL_MODEL_BASE_URL: '',
      LOCAL_MODEL_NAME: '',
      TEAMS_USE_SDK: 'false',
      TEAMS_SKIP_OUTBOUND: 'true',
      TEAMS_SKIP_AUTH: 'true',
      TEAMS_LOCAL_DEV: 'true',
      TEAMS_BIND_HOST: '127.0.0.1',
      TEAMS_LOCAL_ACCESS_TOKEN: token,
      // The release gate loads .env.runtime before invoking npm test. Keep
      // public deployment hints out of this intentionally local test process;
      // the server must reject skip-auth when those hints are present.
      PUBLIC_BASE_URL: '',
      TAB_DOMAIN: '',
      BOT_DOMAIN: '',
      DEV_TUNNEL_ID: '',
      MCP_PUBLIC_ENABLED: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr?.on('data', (chunk) => { output += chunk.toString(); });

  try {
    await waitForHealth(baseUrl, token, () => ({ exitCode: child.exitCode, output }));

    const unauthenticated = await request(baseUrl, '/api/response-mode', undefined);
    assert.equal(unauthenticated.response.status, 401);
    assertPass(unauthenticated.response.status === 401, 'response-mode API rejects a missing local/auth access token');

    const initial = await request(baseUrl, '/api/response-mode', token);
    assert.equal(initial.response.status, 200, output);
    assert.equal(initial.body.mode, 'deterministic');
    assert.deepEqual(initial.body.availability.map((entry: any) => [entry.mode, entry.configured]), [
      ['deterministic', true],
      ['openai', false],
      ['local', false],
    ]);
    const publicJson = JSON.stringify(initial.body);
    assertPass(!publicJson.includes('OPENAI_API_KEY') && !publicJson.includes('LOCAL_MODEL_BASE_URL'), 'response-mode status has no secret or provider URL credential');
    assertPass(initial.body.mode === 'deterministic', 'new authenticated scope defaults to deterministic mode');

    const invalidBody = await request(baseUrl, '/api/response-mode', token, {
      method: 'POST',
      body: JSON.stringify({ mode: 'deterministic', tenantId: 'attacker-tenant' }),
    });
    assert.equal(invalidBody.response.status, 400);
    assertPass(invalidBody.response.status === 400, 'unknown response-mode request fields are rejected');

    const invalidMode = await request(baseUrl, '/api/response-mode', token, {
      method: 'POST',
      body: JSON.stringify({ mode: 'unknown' }),
    });
    assert.equal(invalidMode.response.status, 400);
    assertPass(invalidMode.response.status === 400, 'unknown response mode is rejected');

    const deterministic = await request(baseUrl, '/api/response-mode', token, {
      method: 'POST',
      body: JSON.stringify({ mode: 'deterministic' }),
    });
    assert.equal(deterministic.response.status, 200);
    assert.equal(deterministic.body.mode, 'deterministic');
    assertPass(deterministic.response.status === 200, 'valid deterministic selection is persisted');

    const unconfiguredOpenAi = await request(baseUrl, '/api/response-mode', token, {
      method: 'POST',
      body: JSON.stringify({ mode: 'openai' }),
    });
    assert.equal(unconfiguredOpenAi.response.status, 409);
    assert.match(String(unconfiguredOpenAi.body.error), /설정|구성|OPENAI_API_KEY/);
    assertPass(unconfiguredOpenAi.response.status === 409, 'unconfigured OpenAI selection returns an explicit setup error');
    assertPass(!JSON.stringify(unconfiguredOpenAi.body).includes(token), 'setup error does not disclose access credentials');

    const modeCard = await request(baseUrl, '/api/messages', token, {
      method: 'POST',
      body: JSON.stringify(activity(baseUrl, 'mode', 'card')),
    });
    assert.equal(modeCard.response.status, 200, JSON.stringify(modeCard.body));
    const card = modeCard.body.activities?.[0]?.attachments?.find(
      (attachment: any) => attachment.contentType === 'application/vnd.microsoft.card.adaptive',
    )?.content;
    assertPass(card?.type === 'AdaptiveCard' && card.actions?.length === 3, 'Teams mode command returns a three-option Adaptive Card');
    assertPass(card.actions.every((action: any) => action.type === 'Action.Submit' && typeof action.data?.mode === 'string'), 'mode card actions carry only validated mode choices');

    const cardSubmit = await request(baseUrl, '/api/messages', token, {
      method: 'POST',
      body: JSON.stringify(activity(baseUrl, '', 'submit', { action: 'response-mode.select', mode: 'deterministic' })),
    });
    assert.equal(cardSubmit.response.status, 200);
    assertPass(JSON.stringify(cardSubmit.body.activities).includes('결정형'), 'mode card submit returns a result card');

    const naturalLanguage = await request(baseUrl, '/api/messages', token, {
      method: 'POST',
      body: JSON.stringify(activity(baseUrl, '현재 업무 목록 보여줘', 'natural-language')),
    });
    assert.equal(naturalLanguage.response.status, 200, JSON.stringify(naturalLanguage.body));
    assertPass(
      JSON.stringify(naturalLanguage.body.activities).includes('업무 목록'),
      'Teams Bot natural-language messages use the persisted response-engine selection and return GenUI',
    );

    const storePath = join(dataRoot, 'cross-tenant.json');
    const store = new ResponseModeStore(storePath);
    const scopeA = { tenantId: 'tenant-a', requesterId: 'same-user' };
    const scopeB = { tenantId: 'tenant-b', requesterId: 'same-user' };
    await store.set(scopeA, 'openai');
    assert.equal(await store.get(scopeB), 'deterministic');
    assertPass(await store.get(scopeB) === 'deterministic', 'response mode preferences cannot leak across tenants');

    console.log('PASS: response-mode API, card selection, scoped persistence, and safe provider status');
  } finally {
    await stop(child);
    await rm(dataRoot, { recursive: true, force: true });
  }
}

await main();
