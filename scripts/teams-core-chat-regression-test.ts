import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { resolveRuntimeDistRoot } from './runtime-dist.mjs';

const root = process.cwd();
const entry = path.join(resolveRuntimeDistRoot(root), 'server', 'index.js');
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-core-chat-regression-'));
const accessToken = crypto.randomBytes(32).toString('base64url');
const tenantId = 'runtime-tenant';
const requesterId = 'runtime-user';
const naturalConversationId = 'runtime-conversation-sdk-natural';
const naturalPrompt = '저장소의 현재 상태를 분석하고 핵심 리스크를 한 줄로 요약해줘';
const jobStorePath = path.join(temporaryRoot, 'agent-jobs.json');
let child: ChildProcess | undefined;
let output = '';

try {
  const profilePath = path.join(temporaryRoot, 'read-only.sb');
  const authPath = path.join(temporaryRoot, 'codex-auth.json');
  const isolatedNodePath = path.join(temporaryRoot, 'node');
  await fs.writeFile(profilePath, '(version 1)\n(allow default)\n', { mode: 0o600 });
  await fs.writeFile(authPath, '{"fixture":"teams-core-chat"}\n', { mode: 0o600 });
  await fs.copyFile(process.execPath, isolatedNodePath);
  await fs.chmod(isolatedNodePath, 0o700);

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [entry], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
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
      AGENT_ADMISSION_JOURNAL_PATH: path.join(temporaryRoot, 'agent-admission.json'),
      GENUI_ACTION_STORE_PATH: path.join(temporaryRoot, 'genui-actions.json'),
      RESPONSE_MODE_STORE_PATH: path.join(temporaryRoot, 'response-modes.json'),
      AGENT_WORKSPACE: root,
      AGENT_ISOLATION_PROFILE: profilePath,
      AGENT_SANDBOX_EXEC_PATH: '/usr/bin/sandbox-exec',
      AGENT_CODEX_AUTH_FILE: authPath,
      CODEX_BIN: isolatedNodePath,
      CODEX_SCRIPT: 'scripts/fake-codex-auth-required.mjs',
      COPILOTKIT_DETERMINISTIC_MODE: 'true',
      WEATHER_MODE: 'demo',
      TEAMS_OPERATOR_REQUESTER_ALLOWLIST: `${tenantId}/${requesterId}`,
      MCP_PUBLIC_ENABLED: '',
      TEAMS_OPTIONAL_RUNTIME: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr?.on('data', (chunk) => { output += chunk.toString(); });

  await waitForHealth(baseUrl, child, () => output);

  const naturalResponse = await request(baseUrl, '/api/messages', {
    method: 'POST',
    body: JSON.stringify(activity(baseUrl, naturalPrompt, 'natural', naturalConversationId)),
  });
  assert.ok(naturalResponse.response.ok, `registered Teams SDK handler rejected the Activity: ${naturalResponse.response.status} ${naturalResponse.text}`);

  const job = await waitForSingleJob(baseUrl, naturalConversationId, 4_000);
  assert.equal(job.prompt, naturalPrompt);
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
  assert.equal(completed.threadId, '00000000-0000-4000-8000-0000000000ac');
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

  for (const [command, suffix] of [['Status', 'status'], ['List', 'list']] as const) {
    const conversationId = `runtime-conversation-sdk-${suffix}`;
    const response = await request(baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity(baseUrl, command, suffix, conversationId)),
    });
    assert.ok(response.response.ok, `${command} must remain accepted by the registered Teams SDK handler`);
    const outbox = await waitForOutboxActivity(baseUrl, conversationId, 3_000);
    assert.equal(outbox.messages.length, 1, `${command} must produce exactly one logical response`);
    assert.equal(outbox.activities.length, 1, `${command} must produce exactly one card activity`);
    assert.equal('text' in outbox.activities[0], false, `${command} card must be attachment-only`);
    assert.ok(adaptiveCard(outbox.activities[0]), `${command} must remain an Adaptive Card`);
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
  assert.equal(persistedText.includes('"fixture":"teams-core-chat"'), false, 'Codex auth contents must not enter the durable job store');

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

async function waitForHealth(baseUrl: string, process: ChildProcess, diagnostics: () => string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`server exited before health: ${diagnostics().slice(-4_000)}`);
    try {
      const health = await request(baseUrl, '/api/health');
      if (health.response.ok) return;
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
