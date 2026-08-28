import assert from 'node:assert/strict';
import { lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';

import { resolveRuntimeDistRoot } from './runtime-dist.mjs';

const root = path.resolve(process.cwd());
const runtimeDistRoot = resolveRuntimeDistRoot(root);
const entry = path.join(runtimeDistRoot, 'server/index.js');
const currentUserId = process.getuid();

async function removeJustCreatedWorkspaceOwnedDataDir(directory) {
  try {
    const directoryStat = await lstat(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || directoryStat.uid !== currentUserId) {
      return 'retained';
    }
    if (await realpath(directory) !== directory) return 'retained';
    await rm(directory, { recursive: true, force: true });
    await assert.rejects(() => lstat(directory), { code: 'ENOENT' });
    return 'removed';
  } catch (error) {
    if (error?.code === 'ENOENT') return 'removed';
    return 'retained';
  }
}

async function createWorkspaceOwnedDataDir(workspaceRoot, onCreated) {
  const workspaceStat = await lstat(workspaceRoot);
  assert.equal(workspaceStat.isDirectory(), true, `Core smoke workspace must be a directory: ${workspaceRoot}`);
  assert.equal(workspaceStat.isSymbolicLink(), false, `Core smoke workspace must not be a symbolic link: ${workspaceRoot}`);
  assert.equal(await realpath(workspaceRoot), workspaceRoot, `Core smoke workspace must resolve to itself: ${workspaceRoot}`);

  const directory = await mkdtemp(path.join(workspaceRoot, '.teams-core-runtime-'));
  try {
    onCreated(directory);
    if (process.env.TEAMS_TEST_CORE_RUNTIME_SMOKE_FAIL_AFTER_MKDTEMP === 'true') {
      console.log(`SMOKE_SETUP_TEMP_DIR=${directory}`);
      throw new Error('Core smoke test hook failed after mkdtemp');
    }
    const directoryStat = await lstat(directory);
    assert.equal(directoryStat.isDirectory(), true, `Core smoke data directory must be a directory: ${directory}`);
    assert.equal(directoryStat.isSymbolicLink(), false, `Core smoke data directory must not be a symbolic link: ${directory}`);
    assert.equal(directoryStat.uid, workspaceStat.uid, `Core smoke data directory must be owned by the workspace owner: ${directory}`);
    assert.equal(directoryStat.uid, currentUserId, `Core smoke data directory must be owned by the current user: ${directory}`);
    assert.equal(await realpath(directory), directory, `Core smoke data directory must resolve to itself: ${directory}`);
    return directory;
  } catch (error) {
    console.log(`SMOKE_SETUP_CLEANUP=${await removeJustCreatedWorkspaceOwnedDataDir(directory)}`);
    throw error;
  }
}

async function removeWorkspaceOwnedDataDir(directory) {
  const directoryStat = await lstat(directory);
  assert.equal(directoryStat.isDirectory(), true, `Core smoke cleanup target must be a directory: ${directory}`);
  assert.equal(directoryStat.isSymbolicLink(), false, `Core smoke cleanup target must not be a symbolic link: ${directory}`);
  assert.equal(directoryStat.uid, currentUserId, `Core smoke cleanup target must be owned by the current user: ${directory}`);
  assert.equal(await realpath(directory), directory, `Core smoke cleanup target must resolve to itself: ${directory}`);
  await rm(directory, { recursive: true, force: true });
  await assert.rejects(() => lstat(directory), { code: 'ENOENT' });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForReady(child, output, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`core runtime exited before listen(): ${output.join('')}`);
    }
    if (/listening on port|Teams messages:/.test(output.join(''))) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill('SIGKILL');
  throw new Error(`core runtime did not reach listen() within ${timeoutMs}ms: ${output.join('')}`);
}

let dataDir;
let a2aStorePath;
let a2aOutboundStorePath;
let child;
let closePromise;
let primaryError;

try {
  const port = await freePort();
  dataDir = await createWorkspaceOwnedDataDir(root, (directory) => {
    dataDir = directory;
  });
  a2aStorePath = path.join(dataDir, 'a2a.json');
  a2aOutboundStorePath = path.join(dataDir, 'a2a-outbound.json');
  const tabDomain = 'runtime-smoke.example.com';
  const botClientId = '11111111-2222-4333-8444-555555555555';
  const env = {
    ...process.env,
    TEAMS_RUNTIME_DIST_DIR: runtimeDistRoot,
    NODE_ENV: 'production',
    PORT: String(port),
    TEAMS_USE_SDK: 'true',
    TEAMS_SKIP_OUTBOUND: 'true',
    TEAMS_APP_ID: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    TEAMS_CATALOG_APP_ID: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
    BOT_ID: botClientId,
    BOT_CLIENT_ID: botClientId,
    CLIENT_ID: '66666666-7777-4888-8999-000000000000',
    CLIENT_SECRET: 'core-runtime-smoke-secret',
    TENANT_ID: '99999999-aaaa-4bbb-8ccc-dddddddddddd',
    TAB_DOMAIN: tabDomain,
    APPLICATION_ID_URI: `api://${tabDomain}/botid-${botClientId}`,
    TEAMS_USER_AUTH_ACCEPTED_AUDIENCES: `api://${tabDomain}/botid-${botClientId}`,
    ITEM_STORE_PATH: path.join(dataDir, 'items.json'),
    WORK_ITEM_STORE_PATH: path.join(dataDir, 'work-items.json'),
    COLLABORATION_STORE_PATH: path.join(dataDir, 'collaboration.json'),
    AGENT_JOB_STORE_PATH: path.join(dataDir, 'agent-jobs.json'),
    AGENT_ADMISSION_JOURNAL_PATH: path.join(dataDir, 'agent-admission.json'),
    A2A_STORE_PATH: a2aStorePath,
    A2A_OUTBOUND_STORE_PATH: a2aOutboundStorePath,
    GENUI_ACTION_STORE_PATH: path.join(dataDir, 'genui-actions.json'),
    RESPONSE_MODE_STORE_PATH: path.join(dataDir, 'response-modes.json'),
  };

  const output = [];
  child = spawn(process.execPath, [entry], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  closePromise = new Promise((resolve) => child.once('close', resolve));
  child.stdout.on('data', (chunk) => output.push(String(chunk)));
  child.stderr.on('data', (chunk) => output.push(String(chunk)));

  await waitForReady(child, output);
  const baseUrl = `http://127.0.0.1:${port}`;
  const healthResponse = await fetch(`${baseUrl}/api/health`);
  const health = await healthResponse.json();
  assert.equal(healthResponse.status, 200);
  assert.equal(healthResponse.headers.get('x-powered-by'), null);
  assert.equal(healthResponse.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(healthResponse.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.match(healthResponse.headers.get('content-security-policy') ?? '', /frame-ancestors 'self'/);
  assert.match(healthResponse.headers.get('content-security-policy') ?? '', /https:\/\/teams\.microsoft\.com/);
  assert.equal(health.bot, 'teams-sdk');
  assert.equal(health.outbound, 'disabled');
  assert.equal(health.copilotKit, 'disabled');
  assert.equal(health.mcpEnabled, false);
  assert.equal(health.responseProviders.deterministic, true);
  assert.equal(health.responseProviders.openai, false);
  for (const provider of ['codex', 'ghcp']) {
    const capability = health.cliCapabilities?.[provider];
    assert.ok(capability, `${provider} capability dimensions are wired into health`);
    assert.ok(['present', 'absent', 'unknown'].includes(capability.executable), `${provider} executable state is bounded`);
    assert.ok(['passed', 'not-run', 'failed', 'unknown'].includes(capability.probe), `${provider} probe state is bounded`);
    assert.ok(['authenticated', 'not-authenticated', 'unknown'].includes(capability.authentication), `${provider} authentication state is bounded`);
    assert.ok(['allowed', 'blocked', 'unknown'].includes(capability.entitlement), `${provider} entitlement state is bounded`);
    assert.equal('steps' in capability, false, `${provider} health does not expose raw probe diagnostics`);
  }
  assert.match(health.sourceCommit, /^[a-f0-9]{40}$/);
  assert.match(health.serverBundleSha256, /^[a-f0-9]{64}$/);

  const agentCardResponse = await fetch(`${baseUrl}/a2a/.well-known/agent-card.json`);
  const agentCard = await agentCardResponse.json();
  assert.equal(agentCardResponse.status, 200);
  assert.equal(agentCard.supportedInterfaces[0].url, `https://${tabDomain}/a2a/message:send`);

  const officialAgentCardResponse = await fetch(`${baseUrl}/.well-known/agent-card.json`);
  const officialAgentCard = await officialAgentCardResponse.json();
  assert.equal(officialAgentCardResponse.status, 200);
  assert.equal(officialAgentCard.supportedInterfaces[0].url, `https://${tabDomain}/a2a/v1`);
  assert.equal(officialAgentCard.supportedInterfaces[0].protocolBinding, 'JSONRPC');
  assert.equal(officialAgentCard.supportedInterfaces[0].protocolVersion, '1.0');

  const tabResponse = await fetch(`${baseUrl}/tabs/home/`);
  const tabHtml = await tabResponse.text();
  assert.equal(tabResponse.status, 200);
  assert.equal(tabResponse.headers.get('x-powered-by'), null);
  assert.equal(tabResponse.headers.get('x-content-type-options'), 'nosniff');
  assert.match(tabHtml, /id="root"/);
  assert.match(tabHtml, /assets\/main\.js/);
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  if (child?.exitCode === null) child.kill('SIGTERM');
  if (closePromise) await closePromise;
  if (dataDir) {
    try {
      await removeWorkspaceOwnedDataDir(dataDir);
      console.log(`SMOKE_TEMP_DIR=${dataDir}`);
      console.log(`SMOKE_A2A_STORE_PATH=${a2aStorePath}`);
      console.log(`SMOKE_A2A_OUTBOUND_STORE_PATH=${a2aOutboundStorePath}`);
      console.log('SMOKE_CLEANUP=removed');
    } catch (cleanupError) {
      if (!primaryError) throw cleanupError;
    }
  }
}

console.log('PASS: packaged Teams SDK core runtime listens and serves health/tab without optional API providers');
