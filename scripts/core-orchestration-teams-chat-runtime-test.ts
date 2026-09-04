import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const token = 'mp258-local-token-0123456789abcdef';
const tenantId = 'mp258-tenant';
const requesterId = 'mp258-user';
const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mp258-chat-runtime-'));
await fs.chmod(runtimeRoot, 0o700);
const copilotFixture = path.join(runtimeRoot, 'copilot-fixture');
await createMeasuredCopilotFixture(copilotFixture);
let child: ChildProcess | undefined;
let output = '';

try {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(root, 'dist/server/index.js')], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'test', PORT: String(port), TEAMS_USE_SDK: 'false',
      TEAMS_AGENT_CLI_PROVIDER: 'copilot',
      GHCP_BIN: copilotFixture,
      TEAMS_GHCP_CAPABILITY_PROBE: 'true',
      TEAMS_SKIP_AUTH: 'true', TEAMS_SKIP_OUTBOUND: 'true', TEAMS_LOCAL_DEV: 'true',
      TEAMS_LOCAL_ACCESS_TOKEN: token,
      BOT_CLIENT_ID: '00000000-0000-4000-8000-000000000001',
      CLIENT_ID: '00000000-0000-4000-8000-000000000002',
      CLIENT_SECRET: 'fixture-only-secret', TENANT_ID: '00000000-0000-4000-8000-000000000003',
      ITEM_STORE_PATH: path.join(runtimeRoot, 'items.json'),
      WORK_ITEM_STORE_PATH: path.join(runtimeRoot, 'work-items.json'),
      COLLABORATION_STORE_PATH: path.join(runtimeRoot, 'collaboration.json'),
      AGENT_JOB_STORE_PATH: path.join(runtimeRoot, 'agent-jobs.json'),
      A2A_STORE_PATH: path.join(runtimeRoot, 'a2a.json'),
      A2A_OUTBOUND_STORE_PATH: path.join(runtimeRoot, 'a2a-outbound.json'),
      AGENT_ADMISSION_JOURNAL_PATH: path.join(runtimeRoot, 'admission.json'),
      GENUI_ACTION_STORE_PATH: path.join(runtimeRoot, 'genui-actions.json'),
      RESPONSE_MODE_STORE_PATH: path.join(runtimeRoot, 'response-modes.json'),
      AGENT_WORKSPACE: path.join(runtimeRoot, 'workspace'),
      TEAMS_OPERATOR_REQUESTER_ALLOWLIST: `${tenantId}/${requesterId}`,
      MCP_PUBLIC_ENABLED: '', TEAMS_OPTIONAL_RUNTIME: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr?.on('data', (chunk) => { output += chunk.toString(); });
  await waitForHealth(baseUrl, child);
  await assertMeasuredProvider(baseUrl);

  assert.equal((await post(baseUrl, activity(baseUrl, 'agent list', 'unauth'), false)).status, 401);
  const invalid = await post(baseUrl, activity(baseUrl, 'agent nonsense', 'invalid'));
  assertCard(invalid.body, '형식이 잘못');

  const created = await post(baseUrl, activity(baseUrl, 'agent write README를 점검해줘', 'create'));
  const createdCard = assertCard(created.body, 'awaiting_approval');
  const jobId = jobIdFrom(createdCard);

  assertCard((await post(baseUrl, activity(baseUrl, `agent status ${jobId}`, 'status'))).body, jobId);
  assertCard((await post(baseUrl, activity(baseUrl, 'agent list', 'list'))).body, jobId);
  const foreign = await post(baseUrl, activity(baseUrl, `agent status ${jobId}`, 'foreign', undefined, 'other-user'));
  assertCard(foreign.body, '찾을 수 없습니다');
  assert.doesNotMatch(JSON.stringify(foreign.body), /awaiting_approval/u);

  assertCard((await post(baseUrl, activity(baseUrl, `agent input ${jobId} 추가 입력`, 'input'))).body, '지원하지');
  assertCard((await post(baseUrl, activity(baseUrl, `agent retry ${jobId}`, 'retry'))).body, '처리하지 못');
  const forgedApprove = await post(baseUrl, activity(baseUrl, '', 'approve', {
    schemaVersion: '1', action: 'orchestration.approve', jobId,
  }));
  assertCard(forgedApprove.body, '유효하지 않은');
  assertCard((await post(baseUrl, activity(baseUrl, `agent status ${jobId}`, 'approve-status'))).body, 'awaiting_approval');
  const textApproveCard = assertCard((await post(baseUrl, activity(baseUrl, `agent approve ${jobId}`, 'text-approve'))).body, '작업 승인 확인');
  const textApprovePayload = confirmationPayload(textApproveCard, 'orchestration.approve');
  assertCard((await post(baseUrl, activity(baseUrl, '', 'text-approve-confirmed', textApprovePayload))).body, jobId);
  assertCard((await post(baseUrl, activity(baseUrl, `agent status ${jobId}`, 'text-approve-status'))).body, 'queued');

  const cancellable = await post(baseUrl, activity(baseUrl, 'agent write 취소할 작업', 'cancel-create'));
  const cancelId = jobIdFrom(assertCard(cancellable.body, 'awaiting_approval'));
  const forgedCancel = await post(baseUrl, activity(baseUrl, '', 'cancel', {
    schemaVersion: '1', action: 'orchestration.cancel', jobId: cancelId,
  }));
  assertCard(forgedCancel.body, '유효하지 않은');
  assertCard((await post(baseUrl, activity(baseUrl, `agent status ${cancelId}`, 'cancel-status'))).body, 'awaiting_approval');
  assertCard((await post(baseUrl, activity(baseUrl, '', 'bad-card', {
    schemaVersion: '1', action: 'orchestration.cancel', jobId: cancelId, tenantId: 'attacker',
  }))).body, '유효하지 않');

  console.log('core-orchestration-teams-chat-runtime-test: PASS');
} finally {
  if (child) await stop(child);
  await fs.rm(runtimeRoot, { recursive: true, force: true });
}

function activity(baseUrl: string, text: string, id: string, value?: unknown, from = requesterId) {
  return {
    type: 'message', id: `mp258-${id}`, timestamp: new Date().toISOString(), serviceUrl: baseUrl,
    channelId: 'msteams', from: { id: from, aadObjectId: from },
    conversation: { id: 'mp258-conversation', conversationType: 'personal', tenantId },
    channelData: { tenant: { id: tenantId } }, recipient: { id: 'bot' }, text, value,
  };
}

async function post(baseUrl: string, body: unknown, authenticated = true) {
  const response = await fetch(`${baseUrl}/api/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(authenticated ? { 'x-teams-local-access-token': token } : {}) },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

function assertCard(body: any, expected: string): Record<string, any> {
  const activityValue = body?.activities?.[0];
  assert.ok(activityValue && !Object.hasOwn(activityValue, 'text'), 'response must be attachment-only');
  const card = activityValue.attachments?.[0]?.content;
  assert.equal(card?.type, 'AdaptiveCard');
  assert.equal(card?.version, '1.2');
  assert.match(JSON.stringify(card), new RegExp(expected, 'u'));
  return card;
}

function jobIdFrom(card: Record<string, any>): string {
  const id = card.body?.find((item: any) => item.type === 'FactSet')?.facts
    ?.find((fact: any) => fact.title === '작업 ID')?.value;
  assert.equal(typeof id, 'string');
  return id;
}

async function assertMeasuredProvider(baseUrl: string): Promise<void> {
  const response = await fetch(`${baseUrl}/api/core-orchestration/providers`, {
    headers: { 'x-teams-local-access-token': token },
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { providers?: Array<{ provider?: string; availability?: string; capabilities?: string[] }> };
  const provider = body.providers?.find((candidate) => candidate.provider === 'copilot');
  assert.equal(provider?.availability, 'available', 'fixture must use measured Copilot readiness');
  assert.deepEqual(
    provider?.capabilities,
    ['approve', 'cancel', 'retry', 'submit'],
    'fixture must advertise only measured orchestration capabilities',
  );
}

function confirmationPayload(card: Record<string, any>, action: string): Record<string, string> {
  const payload = card.actions?.find((candidate: any) => candidate.data?.action === action)?.data;
  assert.equal(payload?.schemaVersion, '1');
  assert.equal(payload?.action, action);
  assert.equal(typeof payload?.confirmationToken, 'string');
  assert.equal(typeof payload?.correlationId, 'string');
  return payload;
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', (error?: Error) => error ? reject(error) : resolve()));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function waitForHealth(baseUrl: string, process: ChildProcess): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) assert.fail(`server exited early: ${output.slice(-2_000)}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`, { headers: { 'x-teams-local-access-token': token } });
      if (response.ok) return;
    } catch { /* startup */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`server health timeout: ${output.slice(-2_000)}`);
}

async function createMeasuredCopilotFixture(executable: string): Promise<void> {
  await fs.writeFile(executable, `#!/bin/sh
if [ "$1" = "--help" ]; then
  printf '%s\\n' 'GitHub Copilot CLI help'
  exit 0
fi
printf '%s\\n' \\
  '{"type":"session.start","data":{"sessionId":"019fd700-51cd-7862-a4ef-74ccae0f2b4e"}}' \\
  '{"type":"assistant.turn_start","data":{"turnId":"turn-1"}}' \\
  '{"type":"assistant.message","data":{"content":"GHCP_CAPABILITY_OK"}}' \\
  '{"type":"assistant.turn_end","data":{"turnId":"turn-1"}}'
`, { mode: 0o700 });
}

async function stop(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) return;
  process.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { process.kill('SIGKILL'); resolve(); }, 2_000);
    process.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}
