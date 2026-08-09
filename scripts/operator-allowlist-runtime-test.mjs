import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import net from 'node:net';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const LOCAL_ACCESS_TOKEN_HEADER = 'x-teams-local-access-token';

async function freePort() {
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

function activity(text, baseUrl, suffix, userId = 'runtime-user', tenantId = 'runtime-tenant', conversationId = `runtime-${suffix}`) {
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

function adaptiveCardFromActivity(activityValue) {
  return activityValue?.attachments?.find(
    (attachment) => attachment.contentType === 'application/vnd.microsoft.card.adaptive',
  )?.content;
}

async function request(baseUrl, token, pathname, init = {}) {
  const headers = {
    ...(init.body ? { 'content-type': 'application/json' } : {}),
    [LOCAL_ACCESS_TOKEN_HEADER]: token,
    ...(init.headers ?? {}),
  };
  const response = await fetch(`${baseUrl}${pathname}`, { ...init, headers });
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep raw diagnostics
  }
  return { response, body };
}

async function waitForHealth(baseUrl, token, diagnostics) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const state = diagnostics();
    if (state.exitCode !== null) {
      throw new Error(`operator allowlist test server exited early:\n${state.output.slice(-4_000)}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        headers: { [LOCAL_ACCESS_TOKEN_HEADER]: token },
      });
      if (response.ok) return;
    } catch {
      // continue until ready
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`operator allowlist test server did not become healthy: ${baseUrl}`);
}

async function startServer(extraEnv = {}, options = {}) {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const token = crypto.randomBytes(32).toString('base64url');
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'teams-operator-allowlist-'));
  const itemStorePath = path.join(tempRoot, 'items.json');
  const agentJobStorePath = path.join(tempRoot, 'agent-jobs.json');
  if (options.initialItems) {
    await writeFile(itemStorePath, JSON.stringify(options.initialItems), 'utf8');
  }
  if (options.initialAgentJobs) {
    await writeFile(agentJobStorePath, JSON.stringify(options.initialAgentJobs), 'utf8');
  }
  const child = spawn(process.execPath, [path.join(root, 'dist/server/index.js')], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      ITEM_STORE_PATH: itemStorePath,
      AGENT_JOB_STORE_PATH: agentJobStorePath,
      GENUI_ACTION_STORE_PATH: path.join(tempRoot, 'genui-actions.json'),
      RESPONSE_MODE_STORE_PATH: path.join(tempRoot, 'response-modes.json'),
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
      TEAMS_LOCAL_ACCESS_TOKEN: token,
      TEAMS_OPERATOR_REQUESTER_ALLOWLIST: '',
      PUBLIC_BASE_URL: '',
      TAB_DOMAIN: '',
      BOT_DOMAIN: '',
      DEV_TUNNEL_ID: '',
      MCP_PUBLIC_ENABLED: '',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  await waitForHealth(baseUrl, token, () => ({ exitCode: child.exitCode, output }));
  return {
    baseUrl,
    token,
    tempRoot,
    child,
    output: () => output,
  };
}

async function stopServer(server) {
  if (server.child.exitCode === null) {
    server.child.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        server.child.kill('SIGKILL');
        resolve();
      }, 3_000);
      server.child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  await rm(server.tempRoot, { recursive: true, force: true });
}

await execFileAsync(process.execPath, ['scripts/build-server.mjs'], { cwd: root });

const emptyAllowlist = await startServer();
try {
  const readOnly = await request(emptyAllowlist.baseUrl, emptyAllowlist.token, '/api/messages', {
    method: 'POST',
    body: JSON.stringify(activity('run read only inspection', emptyAllowlist.baseUrl, 'run-open')),
  });
  assert.equal(readOnly.response.status, 200, 'read-only bot command remains available to authenticated users');
  assert.match(readOnly.body.messages?.[0] ?? '', /읽기 전용|status/, 'read-only run still starts normally');

  const list = await request(emptyAllowlist.baseUrl, emptyAllowlist.token, '/api/messages', {
    method: 'POST',
    body: JSON.stringify(activity('list', emptyAllowlist.baseUrl, 'list-open')),
  });
  assert.equal(list.response.status, 200, 'read-only list remains available to authenticated users');

  const blockedWrite = await request(emptyAllowlist.baseUrl, emptyAllowlist.token, '/api/messages', {
    method: 'POST',
    body: JSON.stringify(activity('write blocked mutation', emptyAllowlist.baseUrl, 'write-blocked')),
  });
  assert.equal(blockedWrite.response.status, 200, 'blocked mutation still returns a safe bot response');
  assert.match(JSON.stringify(blockedWrite.body), /운영자|권한|허용/, 'empty operator allowlist fails closed with a clear message');
  assert.equal(adaptiveCardFromActivity(blockedWrite.body.activities?.[0])?.type, 'AdaptiveCard', 'blocked mutation returns a clear error card');
} finally {
  await stopServer(emptyAllowlist);
}

const emptyAllowlistMutations = await startServer({}, {
  initialAgentJobs: [
    {
      id: 'task-empty-allowlist-approval',
      prompt: 'preloaded approval',
      mode: 'workspace-write',
      status: 'awaiting_approval',
      conversationId: 'runtime-preloaded-approval',
      requesterId: 'runtime-user',
      tenantId: 'runtime-tenant',
      progress: [],
      createdAt: '2026-08-09T00:00:00.000Z',
    },
    {
      id: 'task-empty-allowlist-commit',
      prompt: 'preloaded commit',
      mode: 'workspace-write',
      status: 'completed',
      conversationId: 'runtime-preloaded-commit',
      requesterId: 'runtime-user',
      tenantId: 'runtime-tenant',
      progress: [],
      result: 'completed write job without recorded paths',
      createdAt: '2026-08-09T00:00:00.000Z',
      finishedAt: '2026-08-09T00:01:00.000Z',
    },
  ],
});
try {
  for (const [command, suffix, conversationId] of [
    ['approve task-empty-allowlist-approval', 'empty-allowlist-approve', 'runtime-preloaded-approval'],
    ['cancel task-empty-allowlist-approval', 'empty-allowlist-cancel', 'runtime-preloaded-approval'],
    ['commit task-empty-allowlist-commit test: blocked commit', 'empty-allowlist-commit', 'runtime-preloaded-commit'],
  ]) {
    const blocked = await request(emptyAllowlistMutations.baseUrl, emptyAllowlistMutations.token, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity(command, emptyAllowlistMutations.baseUrl, suffix, 'runtime-user', 'runtime-tenant', conversationId)),
    });
    assert.equal(blocked.response.status, 200, `${suffix} returns a safe bot response`);
    assert.match(JSON.stringify(blocked.body), /운영자|권한|허용/, `${suffix} explains the operator restriction`);
    assert.equal(adaptiveCardFromActivity(blocked.body.activities?.[0])?.type, 'AdaptiveCard', `${suffix} returns an error card`);
  }
} finally {
  await stopServer(emptyAllowlistMutations);
}

const operatorScoped = await startServer({
  TEAMS_OPERATOR_REQUESTER_ALLOWLIST: 'runtime-tenant/allowed-user',
});
try {
  const writeRequest = await request(operatorScoped.baseUrl, operatorScoped.token, '/api/messages', {
    method: 'POST',
    body: JSON.stringify(activity('write operator-owned change', operatorScoped.baseUrl, 'write-allowed', 'allowed-user')),
  });
  const jobId = writeRequest.body.messages?.[0]?.match(/task-[\w-]+/)?.[0];
  assert.ok(jobId, 'allowed operator can create a workspace-write job');

  const crossTenant = await request(operatorScoped.baseUrl, operatorScoped.token, '/api/messages', {
    method: 'POST',
    body: JSON.stringify(activity(
      'write cross-tenant mutation',
      operatorScoped.baseUrl,
      'write-cross-tenant',
      'allowed-user',
      'other-tenant',
    )),
  });
  assert.match(
    JSON.stringify(crossTenant.body),
    /운영자|권한|허용/,
    'an identical requester identifier in another tenant is not an operator',
  );

  for (const [command, suffix] of [
    [`approve ${jobId}`, 'approve-blocked'],
    [`cancel ${jobId}`, 'cancel-blocked'],
    [`commit ${jobId} test: blocked commit`, 'commit-blocked'],
  ]) {
    const blocked = await request(operatorScoped.baseUrl, operatorScoped.token, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity(command, operatorScoped.baseUrl, suffix, 'blocked-user')),
    });
    assert.equal(blocked.response.status, 200, `${suffix} returns a safe bot response`);
    assert.match(JSON.stringify(blocked.body), /찾을 수 없습니다/, `${suffix} remains requester-scoped for other users`);
    assert.equal(adaptiveCardFromActivity(blocked.body.activities?.[0])?.type, 'AdaptiveCard', `${suffix} returns an error card`);
  }

  const status = await request(operatorScoped.baseUrl, operatorScoped.token, '/api/debug/agent-jobs');
  const job = status.body.jobs.find((candidate) => candidate.id === jobId);
  assert.equal(job?.status, 'awaiting_approval', 'unauthorized operator attempts do not mutate the pending job');
} finally {
  await stopServer(operatorScoped);
}

const legacySameTenant = await startServer({
  TENANT_ID: 'runtime-tenant',
  TEAMS_OPERATOR_REQUESTER_ALLOWLIST: 'legacy-allowed-user',
});
try {
  const sameTenant = await request(legacySameTenant.baseUrl, legacySameTenant.token, '/api/messages', {
    method: 'POST',
    body: JSON.stringify(activity(
      'write migrated same-tenant operator change',
      legacySameTenant.baseUrl,
      'legacy-same-tenant',
      'legacy-allowed-user',
      'runtime-tenant',
    )),
  });
  assert.match(
    sameTenant.body.messages?.[0] ?? '',
    /task-[\w-]+/,
    'a legacy requester-only entry maps to the one explicitly configured tenant',
  );

  const otherTenant = await request(legacySameTenant.baseUrl, legacySameTenant.token, '/api/messages', {
    method: 'POST',
    body: JSON.stringify(activity(
      'write migrated cross-tenant change',
      legacySameTenant.baseUrl,
      'legacy-other-tenant',
      'legacy-allowed-user',
      'other-tenant',
    )),
  });
  assert.match(
    JSON.stringify(otherTenant.body),
    /운영자|권한|허용/,
    'legacy requester-only migration never authorizes a different tenant',
  );
} finally {
  await stopServer(legacySameTenant);
}

console.log('PASS: bot mutations require a tenant-bound operator while safe same-tenant legacy configuration remains supported');
