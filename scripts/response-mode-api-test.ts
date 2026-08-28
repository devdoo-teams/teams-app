import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';

import { createUserAuthMiddleware } from '../src/server/user-auth.js';
import { ResponseModeStore } from '../src/server/response-mode-store.js';
import { resolveRuntimeDistRoot } from './runtime-dist.mjs';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const runtimeDistRoot = resolveRuntimeDistRoot(root);
const ACCESS_TOKEN_HEADER = 'x-teams-local-access-token';
const optionalRuntimeUnconfigured = process.argv.includes('--optional-runtime-unconfigured');

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
  const expectedCommit = process.env.TEAMS_SOURCE_COMMIT?.trim();
  if (expectedCommit) {
    const marker = JSON.parse(await readFile(
      join(runtimeDistRoot, 'server', '.teams-server-build-commit'),
      'utf8',
    )) as { commit?: unknown; mode?: unknown; worktree?: unknown };
    assert.equal(marker.commit, expectedCommit, 'response-mode runtime bundle matches the Core runner source commit');
    assert.equal(
      marker.mode,
      optionalRuntimeUnconfigured ? 'optional' : 'core',
      'response-mode runtime test uses the requested server bundle mode',
    );
    assert.equal(marker.worktree, 'clean', 'response-mode Core gate uses a clean-worktree server bundle');
  } else {
    await execFileAsync(
      process.execPath,
      ['scripts/build-server.mjs', ...(optionalRuntimeUnconfigured ? [] : ['--core'])],
      { cwd: root },
    );
  }

  const dataRoot = await mkdtemp(join(tmpdir(), 'response-mode-api-test-'));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const token = 'response-mode-local-test-token-0123456789';
  const serverEnv = {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      ITEM_STORE_PATH: join(dataRoot, 'items.json'),
      WORK_ITEM_STORE_PATH: join(dataRoot, 'work-items.json'),
      COLLABORATION_STORE_PATH: join(dataRoot, 'collaboration.json'),
      AGENT_JOB_STORE_PATH: join(dataRoot, 'agent-jobs.json'),
      A2A_STORE_PATH: join(dataRoot, 'a2a.json'),
      AGENT_ADMISSION_JOURNAL_PATH: join(dataRoot, 'agent-admission.json'),
      GENUI_ACTION_STORE_PATH: join(dataRoot, 'genui-actions.json'),
      RESPONSE_MODE_STORE_PATH: join(dataRoot, 'response-modes.json'),
      AGENT_WORKSPACE: root,
      CODEX_BIN: process.execPath,
      CODEX_SCRIPT: join(root, 'scripts/fake-codex.mjs'),
      WEATHER_MODE: 'demo',
      COPILOTKIT_DETERMINISTIC_MODE: '',
      OPENAI_API_KEY: '',
      OPENAI_MODEL: '',
      LOCAL_MODEL_BASE_URL: '',
      LOCAL_MODEL_NAME: '',
      TEAMS_OPTIONAL_RUNTIME: optionalRuntimeUnconfigured ? 'true' : '',
      TEAMS_USE_SDK: 'false',
      TEAMS_SKIP_OUTBOUND: 'true',
      TEAMS_SKIP_AUTH: 'true',
      TEAMS_LOCAL_DEV: 'true',
      TEAMS_BIND_HOST: '127.0.0.1',
      TEAMS_LOCAL_ACCESS_TOKEN: token,
      TEAMS_OPERATOR_REQUESTER_ALLOWLIST: 'response-mode-tenant/response-mode-user',
      // The release gate loads .env.runtime before invoking npm test. Keep
      // public deployment hints out of this intentionally local test process;
      // the server must reject skip-auth when those hints are present.
      PUBLIC_BASE_URL: '',
      TAB_DOMAIN: '',
      BOT_DOMAIN: '',
      DEV_TUNNEL_ID: '',
      MCP_PUBLIC_ENABLED: '',
  };
  let output = '';
  const startServer = (): ChildProcess => {
    const server = spawn(process.execPath, [join(runtimeDistRoot, 'server', 'index.js')], {
      cwd: root,
      env: serverEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout?.on('data', (chunk) => { output += chunk.toString(); });
    server.stderr?.on('data', (chunk) => { output += chunk.toString(); });
    return server;
  };
  let child = startServer();

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
      ['grok', false],
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
    const modeActivity = modeCard.body.activities?.[0];
    assertPass(!('text' in (modeActivity ?? {})) && modeActivity?.attachmentLayout === 'list', 'mode card activity is attachment-only with list layout');
    assertPass(card?.type === 'AdaptiveCard' && card.version === '1.2', 'Teams mode command returns an Adaptive Card 1.2 card');
    assertPass(card.actions?.length === 1, 'mode card exposes actions only for configured modes');
    assertPass(card.actions.every((action: any) => action.type === 'Action.Submit' && typeof action.data?.mode === 'string' && !('isEnabled' in action)), 'mode card actions carry only configured validated choices');
    const facts = card.body?.find((element: any) => element.type === 'FactSet')?.facts ?? [];
    assertPass(facts.some((fact: any) => fact.title === 'OpenAI') && facts.some((fact: any) => fact.title === '로컬/사내 모델'), 'unconfigured modes remain visible as facts');

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
    const naturalActivities = naturalLanguage.body.activities ?? [];
    assert.equal(naturalActivities.length, 1, JSON.stringify(naturalLanguage.body));
    const naturalActivity = naturalActivities[0];
    const naturalCard = naturalActivity?.attachments?.find(
      (attachment: any) => attachment.contentType === 'application/vnd.microsoft.card.adaptive',
    )?.content;
    const naturalCardJson = JSON.stringify(naturalCard ?? {});
    assertPass(
      !('text' in (naturalActivity ?? {}))
        && naturalCard?.type === 'AdaptiveCard'
        && naturalCard?.version === '1.2'
        && naturalCardJson.includes('업무 목록')
        && !/A2A|협업.*접수|신뢰된 격리/.test(naturalCardJson),
      `Teams Bot natural-language messages honor deterministic mode with one attachment-only task-list card: ${naturalCardJson}`,
    );
    const a2aState = JSON.parse(await readFile(join(dataRoot, 'a2a.json'), 'utf8')) as {
      tasks?: Record<string, unknown>;
    };
    assertPass(
      Object.keys(a2aState.tasks ?? {}).length === 0,
      'ordinary natural-language messages do not create A2A parent tasks',
    );

    const asyncSuffix = 'natural-agent-async';
    const naturalAgent = await request(baseUrl, '/api/messages', token, {
      method: 'POST',
      body: JSON.stringify(activity(baseUrl, '현재 구현 상태를 분석해줘', asyncSuffix)),
    });
    const immediatePayload = JSON.stringify(naturalAgent.body);
    assertPass(
      naturalAgent.response.status === 200
        && immediatePayload.includes('신뢰된 격리'),
      `Teams Bot fails closed when a natural Codex job has no trusted isolation provider: ${immediatePayload}`,
    );
    assertPass(!immediatePayload.includes('FAKE_CODEX_OK'), 'Teams Bot immediate acknowledgement does not wait for or embed the final Codex result');

    const storePath = join(dataRoot, 'cross-tenant.json');
    const store = new ResponseModeStore(storePath);
    const scopeA = { tenantId: 'tenant-a', requesterId: 'same-user' };
    const scopeB = { tenantId: 'tenant-b', requesterId: 'same-user' };
    await store.set(scopeA, 'openai');
    assert.equal(await store.get(scopeB), 'deterministic');
    assertPass(await store.get(scopeB) === 'deterministic', 'response mode preferences cannot leak across tenants');

    await stop(child);
    const persistedBotMode = new ResponseModeStore(join(dataRoot, 'response-modes.json'));
    await persistedBotMode.set({
      tenantId: 'response-mode-tenant',
      requesterId: 'response-mode-user',
    }, 'openai');
    output = '';
    child = startServer();
    await waitForHealth(baseUrl, token, () => ({ exitCode: child.exitCode, output }));

    const unavailablePersistedMode = await request(baseUrl, '/api/messages', token, {
      method: 'POST',
      body: JSON.stringify(activity(baseUrl, '현재 업무 목록 보여줘', 'persisted-unavailable-mode')),
    });
    assert.equal(unavailablePersistedMode.response.status, 200, JSON.stringify(unavailablePersistedMode.body));
    assert.equal(unavailablePersistedMode.body.activities?.length, 1);
    const unavailableModeActivity = unavailablePersistedMode.body.activities[0];
    const unavailableModeCard = unavailableModeActivity?.attachments?.find(
      (attachment: any) => attachment.contentType === 'application/vnd.microsoft.card.adaptive',
    )?.content;
    const unavailableModeJson = JSON.stringify(unavailableModeCard ?? {});
    const unavailableModeFacts = unavailableModeCard?.body?.find(
      (element: any) => element.type === 'FactSet',
    )?.facts ?? [];
    const unavailableOpenAiFact = unavailableModeFacts.find((fact: any) => fact.title === 'OpenAI');
    assertPass(
      !('text' in (unavailableModeActivity ?? {}))
        && unavailableModeCard?.type === 'AdaptiveCard'
        && unavailableModeJson.includes('응답 모드')
        && unavailableModeJson.includes('OpenAI')
        && unavailableModeJson.includes('서버')
        && unavailableModeCard.actions?.some((action: any) => action.data?.mode === 'deterministic')
        && !unavailableModeCard.actions?.some((action: any) => action.data?.mode === 'openai'),
      `a persisted unavailable provider returns an actionable attachment-only mode card without silent fallback: ${unavailableModeJson}`,
    );
    assertPass(
      unavailableOpenAiFact?.value === 'OpenAI: 서버 설정 필요 · 현재 선택',
      `an unavailable provider does not advertise a misleading model name: ${JSON.stringify(unavailableOpenAiFact)}`,
    );
    const unavailableModeA2a = JSON.parse(await readFile(join(dataRoot, 'a2a.json'), 'utf8')) as {
      tasks?: Record<string, unknown>;
    };
    assertPass(
      Object.keys(unavailableModeA2a.tasks ?? {}).length === 0,
      'an unavailable persisted response mode does not create an A2A parent task',
    );

    console.log('PASS: response-mode API, card selection, scoped persistence, and safe provider status');
  } finally {
    await stop(child);
    await rm(dataRoot, { recursive: true, force: true });
  }
}

await main();
