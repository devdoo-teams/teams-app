import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const execFileAsync = promisify(execFile);

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
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The process may still be starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Server did not become healthy: ${baseUrl}`);
}

async function request(baseUrl, pathname, init = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
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

function activity(text, baseUrl, suffix) {
  return {
    type: 'message',
    id: `runtime-${suffix}`,
    timestamp: new Date().toISOString(),
    serviceUrl: baseUrl,
    channelId: 'msteams',
    from: { id: 'runtime-user', name: 'Runtime Test User' },
    conversation: { id: `runtime-conversation-${suffix}` },
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
    conversation: { id: `runtime-conversation-${suffix}`, conversationType: 'personal' },
    recipient: { id: 'runtime-bot', name: 'Teams SDK MVP' },
  };
}

async function startServer({ production, dataFile, jobDataFile, teamsSdk = false, workspace = root }) {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
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
      AGENT_WORKSPACE: workspace,
      CODEX_BIN: process.execPath,
      CODEX_SCRIPT: path.join(root, 'scripts/fake-codex.mjs'),
      TEAMS_USE_SDK: teamsSdk ? 'true' : 'false',
      TEAMS_SKIP_OUTBOUND: teamsSdk ? 'true' : 'false',
      ...(teamsSdk
        ? {
            BOT_CLIENT_ID: '00000000-0000-4000-8000-000000000001',
            CLIENT_ID: '00000000-0000-4000-8000-000000000002',
            CLIENT_SECRET: 'runtime-test-secret',
            TENANT_ID: '00000000-0000-4000-8000-000000000003',
            APPLICATION_ID_URI: 'api://runtime.test/00000000-0000-4000-8000-000000000002',
          }
        : {}),
      ...(production ? { TEAMS_SKIP_AUTH: '' } : { TEAMS_SKIP_AUTH: 'true' }),
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
    return { child, baseUrl, getOutput: () => output };
  } catch (error) {
    child.kill('SIGTERM');
    throw new Error(`${error.message}\n${output}`);
  }
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
    assert(health.body.storage === 'file-json', 'local runtime reports file storage');

    const initial = await request(server.baseUrl, '/api/items');
    assert(initial.response.status === 200, 'local item list returns 200');
    assert(initial.body.summary.total === 2, 'seed data is available in the isolated store');

    const invalid = await request(server.baseUrl, '/api/items', {
      method: 'POST',
      body: JSON.stringify({ title: '   ' }),
    });
    assert(invalid.response.status === 400, 'empty item titles are rejected');

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

    const readOnlyOutbox = await request(server.baseUrl, '/api/debug/agent-outbox/runtime-conversation-agent-run');
    assert(
      readOnlyOutbox.body.messages.some((message) => message.includes(readOnlyJobId)),
      'completed Codex result is delivered to the conversation outbox',
    );
    assert(
      readOnlyOutbox.body.messages.some((message) => message.includes('분석을 시작했습니다')),
      'Codex progress is delivered before the final result',
    );

    const continued = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity(`continue ${readOnlyJobId} 같은 thread에서 한 줄로 이어서 확인해줘`, server.baseUrl, 'agent-continue')),
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
      body: JSON.stringify(activity(`cancel ${slowJobId}`, server.baseUrl, 'agent-cancel-command')),
    });
    assert(cancelled.body.messages[0].includes('취소'), 'running Codex job can be cancelled');
    const cancelledJob = await waitForAgentJob(server.baseUrl, slowJobId);
    assert(cancelledJob.status === 'cancelled', 'cancelled Codex job stays cancelled');

    const writeRequest = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity('write 테스트 파일 변경 계획을 검토해줘', server.baseUrl, 'agent-write')),
    });
    const writeJobId = writeRequest.body.messages[0].match(/task-[\w-]+/)?.[0];
    assert(writeRequest.body.messages[0].includes('승인 대기'), 'workspace-write request requires approval');

    const approved = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity(`approve ${writeJobId}`, server.baseUrl, 'agent-approve')),
    });
    assert(approved.body.messages[0].includes('승인'), 'workspace-write job can be approved from Teams');

    const completedWrite = await waitForAgentJob(server.baseUrl, writeJobId);
    assert(completedWrite.status === 'completed', 'approved workspace-write job completes');
    assert(completedWrite.mode === 'workspace-write', 'approved job preserves write mode');

    const persisted = JSON.parse(await fs.readFile(dataFile, 'utf8'));
    assert(Array.isArray(persisted) && persisted.length === 2, 'isolated JSON store persists final state');
  } finally {
    await stopServer(server.child);
  }
}

async function runProductionAuthFlow(dataFile, jobDataFile) {
  const server = await startServer({ production: true, dataFile, jobDataFile });

  try {
    const health = await request(server.baseUrl, '/api/health');
    assert(health.response.status === 200, 'production health endpoint returns 200');
    assert(health.body.auth === 'teams-authenticated', 'production does not use local auth bypass');

    const withoutToken = await request(server.baseUrl, '/api/items');
    assert(withoutToken.response.status === 401, 'production API rejects requests without a bearer token');

    const invalidToken = await request(server.baseUrl, '/api/items', {
      headers: { authorization: 'Bearer definitely-invalid' },
    });
    assert(invalidToken.response.status === 401, 'production API rejects invalid bearer tokens');
  } finally {
    await stopServer(server.child);
  }
}

async function runTeamsSdkFlow(dataFile, jobDataFile) {
  const server = await startServer({ production: false, dataFile, jobDataFile, teamsSdk: true });

  try {
    const health = await request(server.baseUrl, '/api/health');
    assert(health.body.bot === 'teams-sdk', 'Teams SDK runtime branch is active');

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
      body: JSON.stringify(activity(`approve ${jobId}`, server.baseUrl, 'git-approve')),
    });
    const completed = await waitForAgentJob(server.baseUrl, jobId);
    assert(completed.status === 'completed', 'approved write job completes in an isolated Git workspace');

    const commit = await request(server.baseUrl, '/api/messages', {
      method: 'POST',
      body: JSON.stringify(activity(`commit ${jobId} test: runtime agent change`, server.baseUrl, 'git-commit')),
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
    ]),
    'utf8',
  );

  const server = await startServer({ production: false, dataFile, jobDataFile });
  try {
    const result = await request(server.baseUrl, '/api/debug/agent-jobs');
    const recovered = result.body.jobs.find((job) => job.id === 'task-recovery-check');
    assert(recovered.status === 'failed', 'interrupted Codex jobs are marked failed after restart');
    assert(recovered.error.includes('재시작'), 'restart recovery keeps a useful failure reason');
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

try {
  console.log('Runtime verification: local authenticated-bypass flow');
  await runLocalFlow(localDataFile, localJobDataFile);
  console.log('Runtime verification: Teams SDK Activity flow');
  await runTeamsSdkFlow(sdkDataFile, sdkJobDataFile);
  console.log('Runtime verification: approved Git commit flow');
  await runGitCommitFlow(gitWorkspace, gitDataFile, gitJobDataFile);
  console.log('Runtime verification: interrupted job recovery');
  await runRecoveryFlow(recoveryDataFile, recoveryJobDataFile);
  console.log('Runtime verification: production authentication guard');
  await runProductionAuthFlow(productionDataFile, productionJobDataFile);
  console.log('Runtime verification complete.');
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
