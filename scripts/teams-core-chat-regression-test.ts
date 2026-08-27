import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { resolveRuntimeDistRoot } from './runtime-dist.mjs';

const root = process.cwd();
const runtimeDistRoot = resolveRuntimeDistRoot(root);
const entry = path.join(runtimeDistRoot, 'server', 'index.js');
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-core-chat-regression-'));
const accessToken = crypto.randomBytes(32).toString('base64url');
const tenantId = 'runtime-tenant';
const requesterId = 'runtime-user';
const naturalConversationId = 'runtime-conversation-sdk-natural';
const naturalPrompt = '저장소의 현재 상태를 분석하고 핵심 리스크를 한 줄로 요약해줘';
const jobStorePath = path.join(temporaryRoot, 'agent-jobs.json');
const a2aOutboundStorePath = path.join(temporaryRoot, 'a2a-outbound.json');
const agentWorkspace = path.join(temporaryRoot, 'agent-workspace');
let child: ChildProcess | undefined;
let output = '';

try {
  const marker = JSON.parse(await fs.readFile(
    path.join(runtimeDistRoot, 'server', '.teams-server-build-commit'),
    'utf8',
  )) as { commit?: unknown; mode?: unknown; worktree?: unknown };
  assert.equal(marker.mode, 'core', 'Teams chat regression must use a Core server bundle');
  assert.equal(marker.worktree, 'clean', 'Teams chat regression must use a clean-worktree server bundle');
  const expectedCommit = process.env.TEAMS_SOURCE_COMMIT?.trim();
  if (expectedCommit) {
    assert.equal(
      marker.commit,
      expectedCommit,
      'Teams chat regression server bundle must match the Core runner pinned source commit',
    );
  }

  const isolatedNodePath = path.join(temporaryRoot, 'node');
  await fs.copyFile(process.execPath, isolatedNodePath);
  await fs.chmod(isolatedNodePath, 0o700);
  await fs.mkdir(path.join(agentWorkspace, 'scripts'), { recursive: true });
  await fs.copyFile(
    path.join(root, 'scripts', 'fake-codex.mjs'),
    path.join(agentWorkspace, 'scripts', 'fake-codex.mjs'),
  );

  const serverEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    TEAMS_USE_SDK: 'true',
    TEAMS_SKIP_AUTH: 'true',
    TEAMS_SKIP_OUTBOUND: 'true',
    TEAMS_LOCAL_DEV: 'true',
    TEAMS_LOCAL_ACCESS_TOKEN: accessToken,
    PUBLIC_BASE_URL: '',
    TAB_DOMAIN: '',
    BOT_DOMAIN: '',
    DEV_TUNNEL_ID: '',
    BOT_CLIENT_ID: '00000000-0000-4000-8000-000000000001',
    CLIENT_ID: '00000000-0000-4000-8000-000000000002',
    CLIENT_SECRET: 'teams-core-chat-fixture-secret',
    TENANT_ID: '00000000-0000-4000-8000-000000000003',
    ITEM_STORE_PATH: path.join(temporaryRoot, 'items.json'),
    WORK_ITEM_STORE_PATH: path.join(temporaryRoot, 'work-items.json'),
    COLLABORATION_STORE_PATH: path.join(temporaryRoot, 'collaboration.json'),
    AGENT_JOB_STORE_PATH: jobStorePath,
    A2A_STORE_PATH: path.join(temporaryRoot, 'a2a.json'),
    A2A_OUTBOUND_STORE_PATH: a2aOutboundStorePath,
    AGENT_ADMISSION_JOURNAL_PATH: path.join(temporaryRoot, 'agent-admission.json'),
    GENUI_ACTION_STORE_PATH: path.join(temporaryRoot, 'genui-actions.json'),
    RESPONSE_MODE_STORE_PATH: path.join(temporaryRoot, 'response-modes.json'),
    AGENT_WORKSPACE: agentWorkspace,
    TEAMS_TEST_PROCESS_ISOLATION: 'true',
    CODEX_BIN: isolatedNodePath,
    CODEX_SCRIPT: 'scripts/fake-codex.mjs',
    COPILOTKIT_DETERMINISTIC_MODE: 'true',
    WEATHER_MODE: 'demo',
    TEAMS_OPERATOR_REQUESTER_ALLOWLIST: `${tenantId}/${requesterId}`,
    MCP_PUBLIC_ENABLED: '',
    TEAMS_OPTIONAL_RUNTIME: '',
  };
  const startBuiltServer = async (): Promise<{ baseUrl: string; health: any }> => {
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const serverProcess = spawn(process.execPath, [entry], {
      cwd: root,
      env: { ...serverEnv, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child = serverProcess;
    serverProcess.stdout?.on('data', (chunk) => { output += chunk.toString(); });
    serverProcess.stderr?.on('data', (chunk) => { output += chunk.toString(); });
    const health = await waitForHealth(baseUrl, serverProcess, () => output);
    return { baseUrl, health };
  };

  let runtime = await startBuiltServer();
  let baseUrl = runtime.baseUrl;
  assert.equal(runtime.health.bot, 'teams-sdk', 'chat regression must exercise the registered Teams SDK bot');

  const naturalResponse = await request(baseUrl, '/api/messages', {
    method: 'POST',
    body: JSON.stringify(activity(baseUrl, naturalPrompt, 'natural', naturalConversationId)),
  });
  assert.ok(naturalResponse.response.ok, `registered Teams SDK handler rejected the Activity: ${naturalResponse.response.status} ${naturalResponse.text}`);

  const job = await waitForSingleJob(baseUrl, naturalConversationId, 4_000);
  assert.match(job.prompt, new RegExp(naturalPrompt));
  assert.match(job.prompt, /reviewer/i);
  assert.equal(job.provider, 'codex');
  assert.equal(job.mode, 'read-only');
  assert.equal(job.requesterId, requesterId);
  assert.equal(job.tenantId, tenantId);
  assert.equal(job.conversationId, naturalConversationId);

  const completed = await waitForCompletedJob(baseUrl, job.id, 10_000);
  assert.equal(
    completed.status,
    'completed',
    `natural-language Codex job failed: ${completed.error ?? 'no persisted error'}\n${output.slice(-4_000)}`,
  );
  assert.match(completed.result ?? '', /FAKE_CODEX_OK/);
  assert.equal(completed.threadId, '00000000-0000-4000-8000-0000000000aa');
  assert.ok(completed.finishedAt, 'completed job must persist finishedAt');

  const completionActivity = await waitForTerminalOutboxActivity(
    baseUrl,
    naturalConversationId,
    job.id,
    3_000,
  );
  assert.equal('text' in completionActivity, false, 'completion card activity must not duplicate content as top-level text');
  const completionCard = adaptiveCard(completionActivity)!;
  assert.equal(completionCard.type, 'AdaptiveCard');
  assert.equal(completionCard.version, '1.2');
  assert.match(JSON.stringify(completionCard), /Codex(?: CLI)? 작업 완료/);
  assert.match(JSON.stringify(completionCard), new RegExp(job.id));
  assert.match(JSON.stringify(completionCard), /completed/);

  const drainedCompletionOutbox = await requestJson(
    baseUrl,
    `/api/debug/agent-outbox/${naturalConversationId}`,
  );
  assert.equal(drainedCompletionOutbox.messages.length, 0, 'terminal completion must be drained before Status/List');
  assert.equal(drainedCompletionOutbox.activities.length, 0, 'terminal completion activities must be drained before Status/List');

  const cardContractFailures: string[] = [];
  for (const [command, suffix] of [[`Status ${job.id}`, 'status'], ['List', 'list']] as const) {
    const response = await request(baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity(baseUrl, command, suffix, naturalConversationId)),
    });
    assert.ok(response.response.ok, `${command} must remain accepted by the registered Teams SDK handler`);
    const outbox = await waitForOutboxActivity(baseUrl, naturalConversationId, 3_000);
    assert.equal(outbox.messages.length, 1, `${command} must produce exactly one logical response`);
    assert.equal(outbox.activities.length, 1, `${command} must produce exactly one card activity`);
    assert.equal('text' in outbox.activities[0], false, `${command} card must be attachment-only`);
    const card = adaptiveCard(outbox.activities[0]);
    assert.ok(card, `${command} must remain an Adaptive Card`);
    const serializedCard = JSON.stringify(card);
    if (!serializedCard.includes(job.id)) {
      cardContractFailures.push(`${command} card omitted job ${job.id}: ${serializedCard}`);
    }
    if (!serializedCard.includes('completed')) {
      cardContractFailures.push(`${command} card omitted completed status: ${serializedCard}`);
    }
  }

  const jobsAfterCoreCommands = await requestJson(baseUrl, '/api/debug/agent-jobs');
  assert.equal(jobsAfterCoreCommands.jobs.length, 1, 'Status/List must not create agent jobs');

  await stop(child);
  child = undefined;
  const persisted = JSON.parse(await fs.readFile(jobStorePath, 'utf8')) as Array<Record<string, unknown>>;
  const persistedJob = persisted.find((candidate) => candidate.id === job.id);
  assert.equal(persistedJob?.status, 'completed', 'completed Teams job must survive server shutdown in the physical store');
  assert.match(String(persistedJob?.result ?? ''), /FAKE_CODEX_OK/);

  const persistedText = JSON.stringify(persisted);
  assert.equal(persistedText.includes('teams-core-chat-fixture-secret'), false, 'Bot credentials must not enter the durable job store');
  assert.equal(persistedText.includes('AGENT_CODEX_AUTH_FILE'), false, 'deprecated raw auth staging must not enter the durable job store');

  runtime = await startBuiltServer();
  baseUrl = runtime.baseUrl;
  assert.equal(runtime.health.bot, 'teams-sdk', 'restarted chat regression must still exercise the registered Teams SDK bot');

  const jobsAfterRestart = await requestJson(baseUrl, '/api/debug/agent-jobs');
  const reloadedJob = jobsAfterRestart.jobs.find((candidate: any) => candidate.id === job.id);
  assert.equal(reloadedJob?.status, 'completed', 'the restarted server must reload the completed job from the same physical store');
  assert.match(String(reloadedJob?.result ?? ''), /FAKE_CODEX_OK/);

  const restartStatusResponse = await request(baseUrl, '/api/messages', {
    method: 'POST',
    body: JSON.stringify(activity(baseUrl, `Status ${job.id}`, 'restart-status', naturalConversationId)),
  });
  assert.ok(restartStatusResponse.response.ok, 'the completed job must remain queryable after server restart');
  const restartOutbox = await waitForOutboxActivity(baseUrl, naturalConversationId, 3_000);
  assert.equal(restartOutbox.activities.length, 1, 'restart Status must produce exactly one card activity');
  const restartCard = adaptiveCard(restartOutbox.activities[0]);
  assert.ok(restartCard, 'restart Status must return an Adaptive Card');
  const serializedRestartCard = JSON.stringify(restartCard);
  assert.ok(serializedRestartCard.includes(job.id), 'restart Status card must identify the persisted job');
  assert.ok(serializedRestartCard.includes('completed'), 'restart Status card must report the persisted completed status');

  await stop(child);
  child = undefined;

  assert.equal(
    cardContractFailures.length,
    0,
    `Status/List card contract failures:\n${cardContractFailures.join('\n')}`,
  );

  console.log('teams-core-chat-regression-test: PASS');
} finally {
  if (child) await stop(child);
  await fs.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}

function activity(baseUrl: string, text: string, suffix: string, conversationId: string) {
  return {
    type: 'message',
    id: `teams-core-chat-${suffix}`,
    timestamp: new Date().toISOString(),
    serviceUrl: baseUrl,
    channelId: 'msteams',
    from: { id: requesterId, aadObjectId: requesterId, name: 'Runtime Test User' },
    conversation: { id: conversationId, conversationType: 'personal', tenantId },
    channelData: { tenant: { id: tenantId } },
    recipient: { id: 'runtime-bot', name: 'Teams SDK MVP' },
    text,
  };
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function request(baseUrl: string, pathname: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('x-teams-local-access-token', accessToken);
  if (init.body) headers.set('content-type', 'application/json');
  const response = await fetch(`${baseUrl}${pathname}`, { ...init, headers });
  const text = await response.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* retain text diagnostics */ }
  return { response, text, body };
}

async function requestJson(baseUrl: string, pathname: string): Promise<any> {
  const result = await request(baseUrl, pathname);
  assert.ok(result.response.ok, `${pathname} failed: ${result.response.status} ${result.text}`);
  return result.body;
}

async function waitForHealth(baseUrl: string, process: ChildProcess, diagnostics: () => string): Promise<any> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`server exited before health: ${diagnostics().slice(-4_000)}`);
    try {
      const health = await request(baseUrl, '/api/health');
      if (health.response.ok) return health.body;
    } catch { /* startup in progress */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become healthy: ${diagnostics().slice(-4_000)}`);
}

async function waitForSingleJob(baseUrl: string, conversationId: string, timeoutMs: number): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const payload = await requestJson(baseUrl, '/api/debug/agent-jobs');
    const matches = payload.jobs.filter((job: any) => job.conversationId === conversationId);
    if (matches.length === 1) return matches[0];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const payload = await requestJson(baseUrl, '/api/debug/agent-jobs');
  const actual = payload.jobs.filter((job: any) => job.conversationId === conversationId).length;
  assert.fail(`registered Teams SDK natural prompt must persist exactly one scoped read-only job; actual ${actual}\n${output.slice(-4_000)}`);
}

async function waitForCompletedJob(baseUrl: string, id: string, timeoutMs: number): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const payload = await requestJson(baseUrl, '/api/debug/agent-jobs');
    const job = payload.jobs.find((candidate: any) => candidate.id === id);
    if (job && ['completed', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`job ${id} did not become terminal\n${output.slice(-4_000)}`);
}

async function waitForOutboxActivity(baseUrl: string, conversationId: string, timeoutMs: number): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const outbox = await requestJson(baseUrl, `/api/debug/agent-outbox/${conversationId}`);
    if (outbox.activities.length > 0) return outbox;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`conversation ${conversationId} did not receive a captured SDK activity`);
}

async function waitForTerminalOutboxActivity(
  baseUrl: string,
  conversationId: string,
  jobId: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  const observed: unknown[] = [];
  while (Date.now() < deadline) {
    const outbox = await requestJson(baseUrl, `/api/debug/agent-outbox/${conversationId}`);
    observed.push(...outbox.activities);
    const terminal = outbox.activities.find((value: unknown) => {
      const card = adaptiveCard(value);
      const serialized = card ? JSON.stringify(card) : '';
      return serialized.includes(jobId)
        && serialized.includes('completed')
        && /Codex(?: CLI)? 작업 완료/u.test(serialized);
    });
    if (terminal && typeof terminal === 'object') return terminal as Record<string, unknown>;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`conversation ${conversationId} did not receive the terminal card for ${jobId}: ${JSON.stringify(observed)}`);
}

function adaptiveCard(activityValue: unknown): Record<string, any> | undefined {
  if (!activityValue || typeof activityValue !== 'object') return undefined;
  const attachments = (activityValue as any).attachments;
  if (!Array.isArray(attachments)) return undefined;
  return attachments.find((attachment: any) => attachment?.contentType === 'application/vnd.microsoft.card.adaptive')?.content;
}

async function stop(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) return;
  process.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      process.kill('SIGKILL');
      resolve();
    }, 3_000);
    process.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
