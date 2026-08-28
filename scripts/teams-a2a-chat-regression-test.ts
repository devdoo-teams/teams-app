import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { resolveRuntimeDistRoot } from './runtime-dist.mjs';
import { TeamsA2AOutboundStore } from '../src/server/teams-a2a-outbound-store.js';

type PersistedA2ATask = {
  id?: unknown;
  status?: unknown;
  scope?: {
    tenantId?: unknown;
    requesterId?: unknown;
    conversationId?: unknown;
  };
};

type PersistedDispatchChild = {
  role?: unknown;
  providerId?: unknown;
  status?: unknown;
  agentJobId?: unknown;
};

type PersistedDispatch = {
  parentTaskId?: unknown;
  scope?: PersistedA2ATask['scope'];
  status?: unknown;
  children?: unknown;
};

type PersistedA2AState = {
  schemaVersion?: unknown;
  tasks?: Record<string, PersistedA2ATask>;
  records?: Record<string, { scope?: PersistedA2ATask['scope']; taskId?: unknown }>;
  dispatchIntents?: Record<string, PersistedDispatch>;
};

type PersistedOutboundIntent = {
  parentTaskId?: unknown;
  scope?: PersistedA2ATask['scope'];
  kind?: unknown;
  status?: unknown;
  attempts?: unknown;
  activityId?: unknown;
};

type PersistedOutboundState = {
  schemaVersion?: unknown;
  intents?: Record<string, PersistedOutboundIntent>;
};

type PersistedAgentJob = {
  id?: unknown;
  provider?: unknown;
  status?: unknown;
  tenantId?: unknown;
  requesterId?: unknown;
  conversationId?: unknown;
};

type Observation = {
  a2a: PersistedA2AState;
  outbound: PersistedOutboundState;
  jobs: PersistedAgentJob[];
  activities: unknown[];
};

const root = process.cwd();
const runtimeDistRoot = resolveRuntimeDistRoot(root);
const entry = path.join(runtimeDistRoot, 'server', 'index.js');
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-chat-regression-'));
const accessToken = crypto.randomBytes(32).toString('base64url');
const tenantId = 'teams-a2a-chat-tenant';
const requesterId = 'teams-a2a-chat-requester';
const conversationId = 'teams-a2a-chat-conversation';
const testScope = { tenantId, requesterId, conversationId } as const;
const activityId = 'teams-a2a-chat-duplicate-activity';
const fakeCodexDelayMs = 1_500;
const inboundResponseDeadlineMs = 750;
const requestTimeoutMs = 5_000;
const prompt = `현재 저장소의 핵심 위험을 검토하고 한 문장으로 요약해줘 [FAKE_CODEX_DELAY_MS=${fakeCodexDelayMs}]`;
const a2aStorePath = path.join(temporaryRoot, 'a2a.json');
const a2aOutboundStorePath = path.join(temporaryRoot, 'a2a-outbound.json');
const agentJobStorePath = path.join(temporaryRoot, 'agent-jobs.json');
const agentWorkspace = path.join(temporaryRoot, 'agent-workspace');
let child: ChildProcess | undefined;
let serverOutput = '';

try {
  await assertRequestDeadline();

  const marker = JSON.parse(await fs.readFile(
    path.join(runtimeDistRoot, 'server', '.teams-server-build-commit'),
    'utf8',
  )) as { commit?: unknown; mode?: unknown; worktree?: unknown };
  assert.equal(marker.mode, 'core', 'Teams A2A chat regression must use a Core server bundle');
  assert.equal(marker.worktree, 'clean', 'Teams A2A chat regression must use a clean-worktree server bundle');
  const expectedCommit = process.env.TEAMS_SOURCE_COMMIT?.trim();
  if (expectedCommit) {
    assert.equal(
      marker.commit,
      expectedCommit,
      'Teams A2A chat regression server bundle must match the explicitly pinned source commit',
    );
  }

  const staleOutboundStore = new TeamsA2AOutboundStore(a2aOutboundStorePath);
  await staleOutboundStore.initialize();
  const staleOutbound = await staleOutboundStore.createOrGetCompletionIntent({
    parentTaskId: 'task-stale-same-scope',
    scope: testScope,
    payloadSha256: crypto.createHash('sha256').update('stale-same-scope-outbound', 'utf8').digest('hex'),
  });
  const staleLease = await staleOutboundStore.claim(
    staleOutbound.intent.id,
    testScope,
    'stale-fixture-worker',
    30_000,
  );
  assert.ok(staleLease, 'stale same-scope outbound fixture must be claimable');
  await staleOutboundStore.recordConnectorAccepted(
    staleLease.id,
    testScope,
    staleLease.leaseToken!,
    'stale-fixture-activity',
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
      BOT_CLIENT_ID: '00000000-0000-4000-8000-000000000011',
      CLIENT_ID: '00000000-0000-4000-8000-000000000012',
      CLIENT_SECRET: 'teams-a2a-chat-fixture-secret',
      TENANT_ID: '00000000-0000-4000-8000-000000000013',
      ITEM_STORE_PATH: path.join(temporaryRoot, 'items.json'),
      WORK_ITEM_STORE_PATH: path.join(temporaryRoot, 'work-items.json'),
      COLLABORATION_STORE_PATH: path.join(temporaryRoot, 'collaboration.json'),
      AGENT_JOB_STORE_PATH: agentJobStorePath,
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
      TEAMS_A2A_AGENT_PROVIDERS: 'codex,codex',
      TEAMS_AGENT_GLOBAL_LIMIT: '4',
      TEAMS_AGENT_TENANT_LIMIT: '4',
      COPILOTKIT_DETERMINISTIC_MODE: 'true',
      WEATHER_MODE: 'demo',
      TEAMS_OPERATOR_REQUESTER_ALLOWLIST: `${tenantId}/${requesterId}`,
      MCP_PUBLIC_ENABLED: '',
      TEAMS_OPTIONAL_RUNTIME: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => { serverOutput += chunk.toString(); });
  child.stderr?.on('data', (chunk) => { serverOutput += chunk.toString(); });

  const health = await waitForHealth(baseUrl, child);
  assert.equal(health.bot, 'teams-sdk', 'test setup must exercise the registered Teams SDK message handler');

  const duplicateActivity = activity(baseUrl);
  const inboundStartedAt = Date.now();
  const accepted = await Promise.all([
    request(baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(duplicateActivity),
    }),
    request(baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(duplicateActivity),
    }),
  ]);
  const inboundElapsedMs = Date.now() - inboundStartedAt;
  accepted.forEach((result, index) => {
    assert.ok(
      result.response.ok,
      `registered Teams SDK handler rejected duplicate Activity ${index + 1}: ${result.response.status} ${result.text}`,
    );
  });

  const observed = await observeContract(baseUrl, 8_000);
  const parents = Object.values(observed.a2a.tasks ?? {}).filter((task) => sameScope(task.scope));
  const parentIds = parents
    .map((candidate) => candidate.id)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const records = Object.values(observed.a2a.records ?? {}).filter((record) => sameScope(record.scope));
  const dispatches = Object.values(observed.a2a.dispatchIntents ?? {})
    .filter((dispatch) => sameScope(dispatch.scope));
  const allScopedOutboundIntents = Object.values(observed.outbound.intents ?? {})
    .filter((intent) => sameScope(intent.scope));
  const outboundIntents = allScopedOutboundIntents.filter((intent) => (
    typeof intent.parentTaskId === 'string' && parentIds.includes(intent.parentTaskId)
  ));
  const children = dispatches.flatMap((dispatch) => (
    Array.isArray(dispatch.children) ? dispatch.children as PersistedDispatchChild[] : []
  ));
  const scopedJobs = observed.jobs.filter((job) => (
    job.tenantId === tenantId
    && job.requesterId === requesterId
    && job.conversationId === conversationId
  ));
  const childJobIds = children
    .map((candidate) => candidate.agentJobId)
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const childJobs = scopedJobs.filter((job) => (
    typeof job.id === 'string' && childJobIds.includes(job.id)
  ));
  const cardActivities = observed.activities.filter((value) => adaptiveCard(value));
  const terminalCardActivities = cardActivities.filter((value) => {
    const serialized = JSON.stringify(adaptiveCard(value));
    return serialized.includes('completed') && /완료|completed/u.test(serialized);
  });
  const acceptedCardActivities = cardActivities.filter((value) => {
    const serialized = JSON.stringify(adaptiveCard(value));
    return serialized.includes('접수했습니다') && serialized.includes('백그라운드');
  });
  const failures: string[] = [];
  if (inboundElapsedMs >= inboundResponseDeadlineMs) {
    failures.push(
      `Teams inbound handler must return before delayed A2A completion; observed ${inboundElapsedMs}ms `
      + `(deadline ${inboundResponseDeadlineMs}ms, child delay ${fakeCodexDelayMs}ms)`,
    );
  }
  if (parents.length !== 1) {
    failures.push(`expected one durable A2A parent for the Teams conversation; observed ${parents.length}`);
  }
  if (records.length !== 1) {
    failures.push(`duplicate Activity must retain one A2A idempotency record; observed ${records.length}`);
  }
  if (dispatches.length !== 1) {
    failures.push(`expected one durable A2A dispatch intent; observed ${dispatches.length}`);
  }
  if (allScopedOutboundIntents.length !== 2) {
    failures.push(`stale same-scope outbound fixture must coexist with the current intent; observed ${allScopedOutboundIntents.length}`);
  }
  if (outboundIntents.length !== 1) {
    failures.push(`expected one durable Teams completion outbound intent; observed ${outboundIntents.length}`);
  } else {
    const outbound = outboundIntents[0];
    if (outbound.kind !== 'teams-completion') {
      failures.push(`expected Teams completion outbound kind; observed ${String(outbound.kind)}`);
    }
    if (outbound.status !== 'connector-accepted') {
      failures.push(`expected connector-accepted outbound state; observed ${String(outbound.status)}`);
    }
    if (outbound.attempts !== 1) {
      failures.push(`duplicate Activity must dispatch one outbound attempt; observed ${String(outbound.attempts)}`);
    }
  }
  if (children.length !== 2) {
    failures.push(`two independently registered Codex workers must create two specialist children; observed ${children.length}`);
  } else {
    const childRoles = children.map((child) => child.role).sort();
    if (JSON.stringify(childRoles) !== JSON.stringify(['release-auditor', 'reviewer'])) {
      failures.push(`expected release-auditor and reviewer children; observed ${JSON.stringify(childRoles)}`);
    }
    const childProviders = children.map((child) => child.providerId).sort();
    if (JSON.stringify(childProviders) !== JSON.stringify(['codex-cli', 'codex-cli-2'])) {
      failures.push(`expected two distinct Codex provider identities; observed ${JSON.stringify(childProviders)}`);
    }
    if (children.some((child) => child.status !== 'completed')) {
      failures.push(`expected both specialist children to complete; observed ${JSON.stringify(children)}`);
    }
  }
  if (parents.length === 1 && parents[0].status !== 'completed') {
    failures.push(`expected terminal completed A2A parent; observed ${String(parents[0].status)}`);
  }
  if (childJobs.length !== 2) {
    failures.push(`duplicate Activity must execute exactly two independently bound Codex AgentJobs; observed ${childJobs.length}`);
  } else if (childJobs.some((job) => job.provider !== 'codex' || job.status !== 'completed')) {
    failures.push(`expected two completed Codex AgentJobs; observed ${JSON.stringify(childJobs)}`);
  }
  if (terminalCardActivities.length !== 1) {
    failures.push(`expected exactly one terminal Teams completion card; observed ${terminalCardActivities.length}`);
  } else {
    const completionActivity = terminalCardActivities[0] as Record<string, unknown>;
    const serialized = JSON.stringify(adaptiveCard(completionActivity));
    if ('text' in completionActivity) {
      failures.push('terminal Teams completion card must be attachment-only without top-level text');
    }
    if (!parentIds.some((parentId) => serialized.includes(parentId))) {
      failures.push('terminal Teams completion card must identify the durable A2A parent');
    }
  }
  if (acceptedCardActivities.length !== 1) {
    failures.push(`duplicate Activity must emit one immediate accepted card; observed ${acceptedCardActivities.length}`);
  } else if ('text' in (acceptedCardActivities[0] as Record<string, unknown>)) {
    failures.push('immediate accepted card must be attachment-only without top-level text');
  }

  assert.equal(
    failures.length,
    0,
    [
      'Teams SDK explicit A2A collaboration bridge contract is missing:',
      ...failures.map((failure) => `- ${failure}`),
      `Observed scoped AgentJobs: ${scopedJobs.length}`,
      `Observed Adaptive Cards: ${cardActivities.length}`,
      `A2A schema: ${String(observed.a2a.schemaVersion ?? 'missing')}`,
      `A2A outbound schema: ${String(observed.outbound.schemaVersion ?? 'missing')}`,
      `Observed activity tail: ${JSON.stringify(observed.activities).slice(-2_000)}`,
      `Server tail: ${serverOutput.slice(-2_000)}`,
    ].join('\n'),
  );

  console.log('teams-a2a-chat-regression-test: PASS');
} finally {
  if (child) await stop(child);
  await fs.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}

function activity(baseUrl: string): Record<string, unknown> {
  return {
    type: 'message',
    id: activityId,
    timestamp: '2026-08-28T00:00:00.000Z',
    serviceUrl: baseUrl,
    channelId: 'msteams',
    from: { id: requesterId, aadObjectId: requesterId, name: 'A2A Chat Test User' },
    conversation: { id: conversationId, conversationType: 'personal', tenantId },
    channelData: { tenant: { id: tenantId } },
    recipient: { id: 'runtime-bot', name: 'Teams SDK MVP' },
    text: `a2a ${prompt}`,
  };
}

function sameScope(scope: PersistedA2ATask['scope']): boolean {
  return scope?.tenantId === tenantId
    && scope.requesterId === requesterId
    && scope.conversationId === conversationId;
}

async function observeContract(baseUrl: string, timeoutMs: number): Promise<Observation> {
  const deadline = Date.now() + timeoutMs;
  const activities: unknown[] = [];
  let a2a = await readJson<PersistedA2AState>(a2aStorePath, {});
  let outbound = await readJson<PersistedOutboundState>(a2aOutboundStorePath, {});
  let jobs = await readJson<PersistedAgentJob[]>(agentJobStorePath, []);
  let legacyTerminalObservedAt: number | undefined;

  while (Date.now() < deadline) {
    const outbox = await requestJson(baseUrl, `/api/debug/agent-outbox/${conversationId}`, deadline);
    if (Array.isArray(outbox.activities)) activities.push(...outbox.activities);
    a2a = await readJson<PersistedA2AState>(a2aStorePath, {});
    outbound = await readJson<PersistedOutboundState>(a2aOutboundStorePath, {});
    jobs = await readJson<PersistedAgentJob[]>(agentJobStorePath, []);

    const scopedParents = Object.values(a2a.tasks ?? {}).filter((task) => sameScope(task.scope));
    const scopedParentIds = scopedParents
      .map((candidate) => candidate.id)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    const scopedDispatches = Object.values(a2a.dispatchIntents ?? {}).filter((dispatch) => sameScope(dispatch.scope));
    const scopedChildren = scopedDispatches.flatMap((dispatch) => (
      Array.isArray(dispatch.children) ? dispatch.children as PersistedDispatchChild[] : []
    ));
    const scopedOutboundIntents = Object.values(outbound.intents ?? {})
      .filter((intent) => (
        sameScope(intent.scope)
        && typeof intent.parentTaskId === 'string'
        && scopedParentIds.includes(intent.parentTaskId)
      ));
    const terminalCards = activities.filter((value) => {
      const card = adaptiveCard(value);
      return card !== undefined && JSON.stringify(card).includes('completed');
    });
    if (
      scopedParents.length === 1
      && scopedParents[0].status === 'completed'
      && scopedChildren.length === 2
      && scopedChildren.every((child) => child.status === 'completed')
      && scopedOutboundIntents.length === 1
      && !['queued', 'dispatching'].includes(String(scopedOutboundIntents[0].status))
      && terminalCards.length >= 1
    ) {
      return { a2a, outbound, jobs, activities };
    }

    const scopedJobs = jobs.filter((job) => (
      job.tenantId === tenantId
      && job.requesterId === requesterId
      && job.conversationId === conversationId
    ));
    if (
      scopedParents.length === 0
      && scopedJobs.length >= 2
      && scopedJobs.every((job) => ['completed', 'failed', 'cancelled'].includes(String(job.status)))
    ) {
      legacyTerminalObservedAt ??= Date.now();
      if (Date.now() - legacyTerminalObservedAt >= 250) {
        const finalOutbox = await requestJson(baseUrl, `/api/debug/agent-outbox/${conversationId}`, deadline);
        if (Array.isArray(finalOutbox.activities)) activities.push(...finalOutbox.activities);
        return { a2a, outbound, jobs, activities };
      }
    }
    await delay(50);
  }

  return {
    a2a: await readJson<PersistedA2AState>(a2aStorePath, {}),
    outbound: await readJson<PersistedOutboundState>(a2aOutboundStorePath, {}),
    jobs: await readJson<PersistedAgentJob[]>(agentJobStorePath, []),
    activities,
  };
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
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

async function assertRequestDeadline(): Promise<void> {
  const sockets = new Set<import('node:net').Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('data', () => { /* intentionally never respond */ });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    await assert.rejects(
      () => request(`http://127.0.0.1:${address.port}`, '/stalled', {}, Date.now() + 100),
      (error: unknown) => error instanceof Error && /abort|timeout/iu.test(`${error.name} ${error.message}`),
      'stalled HTTP reads must abort at the absolute request deadline',
    );
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function request(
  baseUrl: string,
  pathname: string,
  init: RequestInit = {},
  deadlineAtMs = Date.now() + requestTimeoutMs,
) {
  const remainingMs = deadlineAtMs - Date.now();
  if (remainingMs <= 0) throw new Error(`${pathname} request deadline exceeded before dispatch`);
  const headers = new Headers(init.headers);
  headers.set('x-teams-local-access-token', accessToken);
  if (init.body) headers.set('content-type', 'application/json');
  const deadlineSignal = AbortSignal.timeout(Math.max(1, Math.ceil(remainingMs)));
  const signal = init.signal
    ? AbortSignal.any([init.signal, deadlineSignal])
    : deadlineSignal;
  const response = await fetch(`${baseUrl}${pathname}`, { ...init, headers, signal });
  const text = await response.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* retain text diagnostics */ }
  return { response, text, body };
}

async function requestJson(baseUrl: string, pathname: string, deadlineAtMs: number): Promise<any> {
  const result = await request(baseUrl, pathname, {}, deadlineAtMs);
  assert.ok(result.response.ok, `${pathname} failed: ${result.response.status} ${result.text}`);
  return result.body;
}

async function waitForHealth(baseUrl: string, process: ChildProcess): Promise<any> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) {
      throw new Error(`server exited before health: ${serverOutput.slice(-4_000)}`);
    }
    try {
      const health = await request(baseUrl, '/api/health', {}, deadline);
      if (health.response.ok) return health.body;
    } catch {
      // Startup is still in progress.
    }
    await delay(100);
  }
  throw new Error(`server did not become healthy: ${serverOutput.slice(-4_000)}`);
}

function adaptiveCard(activityValue: unknown): Record<string, unknown> | undefined {
  if (!activityValue || typeof activityValue !== 'object') return undefined;
  const attachments = (activityValue as { attachments?: unknown }).attachments;
  if (!Array.isArray(attachments)) return undefined;
  const attachment = attachments.find((candidate) => (
    candidate
    && typeof candidate === 'object'
    && (candidate as { contentType?: unknown }).contentType === 'application/vnd.microsoft.card.adaptive'
  )) as { content?: unknown } | undefined;
  return attachment?.content && typeof attachment.content === 'object'
    ? attachment.content as Record<string, unknown>
    : undefined;
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
