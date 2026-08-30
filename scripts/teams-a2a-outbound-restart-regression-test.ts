import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { A2AStore } from '../src/server/a2a-store.js';
import { TeamsA2AOutboundStore } from '../src/server/teams-a2a-outbound-store.js';
import { resolveRuntimeDistRoot } from './runtime-dist.mjs';

const root = process.cwd();
const runtimeDistRoot = resolveRuntimeDistRoot(root);
const entry = path.join(runtimeDistRoot, 'server', 'index.js');
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-outbound-restart-'));
const accessToken = crypto.randomBytes(32).toString('base64url');
const scope = {
  tenantId: 'outbound-restart-tenant',
  requesterId: 'outbound-restart-requester',
  conversationId: 'outbound-restart-conversation',
};
const repairedScope = {
  ...scope,
  conversationId: 'outbound-restart-missing-intent-conversation',
};
const nonTeamsScope = {
  ...scope,
  conversationId: 'outbound-restart-non-teams-conversation',
};
const a2aStorePath = path.join(temporaryRoot, 'a2a.json');
const a2aOutboundStorePath = path.join(temporaryRoot, 'a2a-outbound.json');
const agentWorkspace = path.join(temporaryRoot, 'agent-workspace');
let child: ChildProcess | undefined;
let serverOutput = '';

try {
  const marker = JSON.parse(await fs.readFile(
    path.join(runtimeDistRoot, 'server', '.teams-server-build-commit'),
    'utf8',
  )) as { commit?: unknown; mode?: unknown; worktree?: unknown };
  assert.equal(marker.mode, 'core', 'restart regression must use a Core server bundle');
  assert.equal(marker.worktree, 'clean', 'restart regression must use a clean-worktree server bundle');
  const expectedCommit = process.env.TEAMS_SOURCE_COMMIT?.trim();
  if (expectedCommit) {
    assert.equal(marker.commit, expectedCommit, 'restart regression bundle must match the pinned source commit');
  }

  const a2aStore = new A2AStore(a2aStorePath);
  await a2aStore.initialize();
  const parent = await a2aStore.createOrGetTask({
    scope,
    contextId: 'outbound-restart-context',
    idempotencyKey: 'outbound-restart-idempotency',
    fingerprint: 'outbound-restart-fingerprint',
    message: {
      messageId: 'outbound-restart-message',
      role: 'user',
      parts: [{ text: 'Recover this completed A2A result after a server restart.' }],
    },
  });
  await a2aStore.transitionTask(parent.id, scope, 'working');
  const resultText = 'Recovered A2A completion after restart.';
  await a2aStore.transitionTask(parent.id, scope, {
    status: 'completed',
    error: undefined,
    artifacts: [{
      artifactId: 'outbound-restart-artifact',
      taskId: parent.id,
      sourceTaskId: parent.id,
      sha256: crypto.createHash('sha256').update(resultText, 'utf8').digest('hex'),
      byteSize: Buffer.byteLength(resultText, 'utf8'),
      mediaType: 'text/plain',
      name: 'result.txt',
      scope,
      content: { mediaType: 'text/plain', text: resultText },
    }],
  });

  const outboundStore = new TeamsA2AOutboundStore(a2aOutboundStorePath);
  await outboundStore.initialize();
  const outbound = await outboundStore.createOrGetCompletionIntent({
    parentTaskId: parent.id,
    scope,
    payloadSha256: completionIntentFingerprint(parent.id, scope),
  });
  assert.equal(outbound.intent.status, 'queued');
  const missingIntentParent = await createCompletedTask(
    a2aStore,
    repairedScope,
    'teams-activity-async-v1:outbound-restart-missing-intent',
    'Recovered a missing Teams completion intent after restart.',
  );
  await createCompletedTask(
    a2aStore,
    nonTeamsScope,
    'non-teams-outbound-restart-task',
    'This non-Teams A2A result must not be sent to a Teams conversation.',
  );

  const isolatedNodePath = path.join(temporaryRoot, 'node');
  await fs.copyFile(process.execPath, isolatedNodePath);
  await fs.chmod(isolatedNodePath, 0o700);
  await fs.mkdir(path.join(agentWorkspace, 'scripts'), { recursive: true });
  await fs.copyFile(
    path.join(root, 'scripts', 'fake-codex.mjs'),
    path.join(agentWorkspace, 'scripts', 'fake-codex.mjs'),
  );

  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [entry], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
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
      BOT_CLIENT_ID: '00000000-0000-4000-8000-000000000021',
      CLIENT_ID: '00000000-0000-4000-8000-000000000022',
      CLIENT_SECRET: 'teams-a2a-outbound-restart-secret',
      TENANT_ID: '00000000-0000-4000-8000-000000000023',
      ITEM_STORE_PATH: path.join(temporaryRoot, 'items.json'),
      WORK_ITEM_STORE_PATH: path.join(temporaryRoot, 'work-items.json'),
      COLLABORATION_STORE_PATH: path.join(temporaryRoot, 'collaboration.json'),
      AGENT_JOB_STORE_PATH: path.join(temporaryRoot, 'agent-jobs.json'),
      AGENT_EVENT_STORE_PATH: path.join(temporaryRoot, 'agent-events.json'),
      A2A_STORE_PATH: a2aStorePath,
      A2A_OUTBOUND_STORE_PATH: a2aOutboundStorePath,
      AGENT_ADMISSION_JOURNAL_PATH: path.join(temporaryRoot, 'agent-admission.json'),
      GENUI_ACTION_STORE_PATH: path.join(temporaryRoot, 'genui-actions.json'),
      RESPONSE_MODE_STORE_PATH: path.join(temporaryRoot, 'response-modes.json'),
      AGENT_WORKSPACE: agentWorkspace,
      TEAMS_TEST_PROCESS_ISOLATION: 'true',
      CODEX_BIN: isolatedNodePath,
      CODEX_SCRIPT: 'scripts/fake-codex.mjs',
      TEAMS_AGENT_CLI_PROVIDER: 'codex',
      TEAMS_A2A_AGENT_PROVIDERS: 'codex',
      TEAMS_AGENT_GLOBAL_LIMIT: '4',
      TEAMS_AGENT_TENANT_LIMIT: '4',
      COPILOTKIT_DETERMINISTIC_MODE: 'true',
      WEATHER_MODE: 'demo',
      TEAMS_OPERATOR_REQUESTER_ALLOWLIST: `${scope.tenantId}/${scope.requesterId}`,
      MCP_PUBLIC_ENABLED: '',
      TEAMS_OPTIONAL_RUNTIME: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => { serverOutput += chunk.toString(); });
  child.stderr?.on('data', (chunk) => { serverOutput += chunk.toString(); });

  await waitForHealth(baseUrl, child);
  const activities = await waitForRecoveredCompletion(baseUrl, scope.conversationId, 4_000);
  assert.equal(activities.length, 1, 'one queued completion intent must recover exactly once');
  const serialized = JSON.stringify(activities[0]);
  assert.match(serialized, /Recovered A2A completion after restart/u);
  assert.match(serialized, /completed/u);
  const repairedActivities = await waitForRecoveredCompletion(
    baseUrl,
    repairedScope.conversationId,
    4_000,
  );
  assert.equal(repairedActivities.length, 1, 'one missing Teams completion intent must be repaired exactly once');
  assert.match(
    JSON.stringify(repairedActivities[0]),
    /Recovered a missing Teams completion intent after restart/u,
  );

  const persisted = new TeamsA2AOutboundStore(a2aOutboundStorePath);
  await persisted.initialize();
  const recovered = persisted.getIntent(outbound.intent.id, scope);
  assert.equal(recovered?.status, 'connector-accepted');
  assert.equal(recovered?.attempts, 1);
  const repairedIntent = await persisted.createOrGetCompletionIntent({
    parentTaskId: missingIntentParent.id,
    scope: repairedScope,
    payloadSha256: completionIntentFingerprint(missingIntentParent.id, repairedScope),
  });
  assert.equal(repairedIntent.created, false, 'startup recovery must persist the repaired intent before delivery');
  assert.equal(repairedIntent.intent.status, 'connector-accepted');
  assert.equal(repairedIntent.intent.attempts, 1);

  await delay(250);
  const duplicate = await requestJson(baseUrl, `/api/debug/agent-outbox/${scope.conversationId}`);
  assert.deepEqual(duplicate.activities, [], 'startup recovery must not send a second completion activity');
  const repairedDuplicate = await requestJson(
    baseUrl,
    `/api/debug/agent-outbox/${repairedScope.conversationId}`,
  );
  assert.deepEqual(repairedDuplicate.activities, [], 'a repaired intent must not send a second completion activity');
  const nonTeamsOutbox = await requestJson(baseUrl, `/api/debug/agent-outbox/${nonTeamsScope.conversationId}`);
  assert.deepEqual(nonTeamsOutbox.activities, [], 'non-Teams A2A tasks must not create Teams outbound activity');

  console.log('teams-a2a-outbound-restart-regression-test: PASS');
} finally {
  if (child) await stop(child);
  await fs.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}

function completionIntentFingerprint(parentTaskId: string, intentScope: typeof scope): string {
  return crypto.createHash('sha256').update(JSON.stringify({
    schemaVersion: 'teams-a2a-completion-intent.v1',
    parentTaskId,
    scope: intentScope,
  }), 'utf8').digest('hex');
}

async function createCompletedTask(
  store: A2AStore,
  taskScope: typeof scope,
  idempotencyKey: string,
  resultText: string,
) {
  const suffix = crypto.createHash('sha256').update(idempotencyKey, 'utf8').digest('hex').slice(0, 16);
  const task = await store.createOrGetTask({
    scope: taskScope,
    contextId: `outbound-restart-${suffix}`,
    idempotencyKey,
    fingerprint: `outbound-restart-${suffix}`,
    message: {
      messageId: `outbound-restart-${suffix}`,
      role: 'user',
      parts: [{ text: resultText }],
    },
  });
  await store.transitionTask(task.id, taskScope, 'working');
  await store.transitionTask(task.id, taskScope, {
    status: 'completed',
    error: undefined,
    artifacts: [{
      artifactId: `outbound-restart-${suffix}`,
      taskId: task.id,
      sourceTaskId: task.id,
      sha256: crypto.createHash('sha256').update(resultText, 'utf8').digest('hex'),
      byteSize: Buffer.byteLength(resultText, 'utf8'),
      mediaType: 'text/plain',
      name: 'result.txt',
      scope: taskScope,
      content: { mediaType: 'text/plain', text: resultText },
    }],
  });
  return task;
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForHealth(baseUrl: string, process: ChildProcess): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`server exited before health: ${serverOutput.slice(-4_000)}`);
    try {
      const response = await request(baseUrl, '/api/health');
      if (response.ok) return;
    } catch { /* startup in progress */ }
    await delay(100);
  }
  assert.fail(`server did not become healthy: ${serverOutput.slice(-4_000)}`);
}

async function waitForRecoveredCompletion(
  baseUrl: string,
  conversationId: string,
  timeoutMs: number,
): Promise<unknown[]> {
  const deadline = Date.now() + timeoutMs;
  const observed: unknown[] = [];
  while (Date.now() < deadline) {
    const outbox = await requestJson(baseUrl, `/api/debug/agent-outbox/${conversationId}`);
    observed.push(...outbox.activities);
    if (observed.length > 0) return observed;
    await delay(50);
  }
  assert.fail(`completion for ${conversationId} was not recovered after restart: ${serverOutput.slice(-4_000)}`);
}

async function request(baseUrl: string, pathname: string): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    headers: { 'x-teams-local-access-token': accessToken },
  });
}

async function requestJson(baseUrl: string, pathname: string): Promise<any> {
  const response = await request(baseUrl, pathname);
  const text = await response.text();
  assert.ok(response.ok, `${pathname} failed: ${response.status} ${text}`);
  return JSON.parse(text);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
