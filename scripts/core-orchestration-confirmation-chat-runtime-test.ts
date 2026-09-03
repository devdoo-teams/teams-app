import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const token = 'mp269-local-token-0123456789abcdef';
const tenantId = 'mp269-tenant';
const requesterId = 'mp269-user';
const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mp269-confirmation-chat-'));
await fs.chmod(runtimeRoot, 0o700);
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

  const cancelJob = await createAwaitingJob(baseUrl, '취소 확인 흐름');
  const confirmCancel = { schemaVersion: '1', action: 'orchestration.confirm-cancel', jobId: cancelJob };
  const cancelConfirmationCard = assertConfirmationCard((await post(baseUrl, activity('', 'confirm-cancel', confirmCancel))).body, '작업 취소 확인');
  const cancelPayload = confirmationPayload(cancelConfirmationCard, 'orchestration.cancel');
  await assertStatus(baseUrl, cancelJob, 'awaiting_approval', 'first cancel click must not mutate');
  assertConfirmationCard((await post(baseUrl, activity('', 'confirm-cancel-replay', confirmCancel))).body, '작업 취소 확인');
  await assertStatus(baseUrl, cancelJob, 'awaiting_approval', 'duplicate first cancel click must not mutate');

  const dismissed = await post(baseUrl, activity('', 'dismiss-cancel', {
    schemaVersion: '1', action: 'orchestration.dismiss-confirmation', jobId: cancelJob,
  }));
  assertCard(dismissed.body, 'awaiting_approval');
  await assertStatus(baseUrl, cancelJob, 'awaiting_approval', 'dismiss must not mutate');

  const missingCancelToken = await post(baseUrl, activity('', 'cancel-without-token', {
    schemaVersion: '1', action: 'orchestration.cancel', jobId: cancelJob,
  }));
  assertCard(missingCancelToken.body, '유효하지 않은');
  await assertStatus(baseUrl, cancelJob, 'awaiting_approval', 'a forged cancel payload must not mutate');

  const cancelResults = await Promise.all([
    post(baseUrl, activity('', 'cancel-confirmed-1', cancelPayload)),
    post(baseUrl, activity('', 'cancel-confirmed-2', cancelPayload)),
  ]);
  assert.equal(cancelResults.filter((result) => JSON.stringify(result.body).includes('cancelled')).length, 1, 'one concurrent cancel confirmation mutates');
  assert.equal(cancelResults.filter((result) => JSON.stringify(result.body).includes('이미 처리된 카드 액션')).length, 1, 'the duplicate cancel confirmation is rejected');
  await assertStatus(baseUrl, cancelJob, 'cancelled', 'confirmed cancel must mutate');
  const cancelReplay = await post(baseUrl, activity('', 'cancel-confirmed-replay', cancelPayload));
  assertCard(cancelReplay.body, '이미 처리된 카드 액션');

  const approveJob = await createAwaitingJob(baseUrl, '승인 확인 흐름');
  const approveConfirmationCard = assertConfirmationCard(
    (await post(baseUrl, activity('', 'confirm-approve', {
      schemaVersion: '1', action: 'orchestration.confirm-approve', jobId: approveJob,
    }))).body,
    '작업 승인 확인',
  );
  const approvePayload = confirmationPayload(approveConfirmationCard, 'orchestration.approve');
  await assertStatus(baseUrl, approveJob, 'awaiting_approval', 'first approve click must not mutate');
  const missingApproveToken = await post(baseUrl, activity('', 'approve-without-token', {
    schemaVersion: '1', action: 'orchestration.approve', jobId: approveJob,
  }));
  assertCard(missingApproveToken.body, '유효하지 않은');
  await assertStatus(baseUrl, approveJob, 'awaiting_approval', 'a forged approve payload must not mutate');
  assertCard((await post(baseUrl, activity('', 'approve-confirmed', approvePayload))).body, approveJob);
  await assertNotStatus(baseUrl, approveJob, 'awaiting_approval', 'confirmed approve must mutate');
  const approveReplay = await post(baseUrl, activity('', 'approve-confirmed-replay', approvePayload));
  assertCard(approveReplay.body, '이미 처리된 카드 액션');
  await assertNotStatus(baseUrl, approveJob, 'awaiting_approval', 'replayed approve must not restart the mutation');

  const malformed = await post(baseUrl, activity('', 'malformed-confirm', {
    schemaVersion: '1', action: 'orchestration.confirm-cancel', jobId: approveJob, tenantId: 'attacker',
  }));
  assertCard(malformed.body, '유효하지 않은');

  console.log('core-orchestration-confirmation-chat-runtime-test: PASS');
} finally {
  if (child) await stop(child);
  await fs.rm(runtimeRoot, { recursive: true, force: true });
}

async function createAwaitingJob(baseUrl: string, prompt: string): Promise<string> {
  const response = await post(baseUrl, activity(`agent write ${prompt}`, `create-${prompt}`));
  const card = assertCard(response.body, 'awaiting_approval');
  const id = card.body?.find((item: any) => item.type === 'FactSet')?.facts
    ?.find((fact: any) => fact.title === '작업 ID')?.value;
  assert.equal(typeof id, 'string');
  return id;
}

function activity(text: string, id: string, value?: unknown) {
  return {
    type: 'message', id: `mp269-${id}`, timestamp: new Date().toISOString(), serviceUrl: 'http://localhost',
    channelId: 'msteams', from: { id: requesterId, aadObjectId: requesterId },
    conversation: { id: 'mp269-conversation', conversationType: 'personal', tenantId },
    channelData: { tenant: { id: tenantId } }, recipient: { id: 'bot' }, text, value,
  };
}

async function post(baseUrl: string, body: unknown) {
  const response = await fetch(`${baseUrl}/api/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-teams-local-access-token': token },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

function assertCard(body: any, expected: string): Record<string, any> {
  const message = body?.activities?.[0];
  assert.ok(message && !Object.hasOwn(message, 'text'), 'response must be attachment-only');
  const card = message.attachments?.[0]?.content;
  assert.equal(card?.type, 'AdaptiveCard');
  assert.equal(card?.version, '1.2');
  assert.match(JSON.stringify(card), new RegExp(expected, 'u'));
  return card;
}

function assertConfirmationCard(body: any, title: string): Record<string, any> {
  const card = assertCard(body, title);
  const actions = card.actions ?? [];
  assert.equal(actions.length, 2);
  assert.ok(actions.every((action: any) => action.type === 'Action.Submit'));
  assert.equal(actions[1]?.data?.action, 'orchestration.dismiss-confirmation');
  return card;
}

function confirmationPayload(card: Record<string, any>, action: string): Record<string, string> {
  const payload = card.actions?.find((candidate: any) => candidate.data?.action === action)?.data;
  assert.equal(payload?.schemaVersion, '1');
  assert.equal(payload?.action, action);
  assert.equal(typeof payload?.confirmationToken, 'string');
  assert.equal(typeof payload?.correlationId, 'string');
  return payload;
}

async function assertStatus(baseUrl: string, jobId: string, status: string, message: string): Promise<void> {
  const card = assertCard((await post(baseUrl, activity(`agent status ${jobId}`, `status-${jobId}-${status}`))).body, jobId);
  assert.match(JSON.stringify(card), new RegExp(status, 'u'), message);
}

async function assertNotStatus(baseUrl: string, jobId: string, status: string, message: string): Promise<void> {
  const card = assertCard((await post(baseUrl, activity(`agent status ${jobId}`, `status-${jobId}-changed`))).body, jobId);
  assert.doesNotMatch(JSON.stringify(card), new RegExp(status, 'u'), message);
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

async function stop(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) return;
  process.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { process.kill('SIGKILL'); resolve(); }, 2_000);
    process.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}
