import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveRuntimeDistRoot } from './runtime-dist.mjs';

const root = process.cwd();
const runtimeDistRoot = resolveRuntimeDistRoot(root);
const runtimeEntry = path.join(runtimeDistRoot, 'server', 'index.js');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(url, childOutput) {
  const deadline = Date.now() + 5_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      const body = await response.text();
      if (response.status === 200) return JSON.parse(body);
      lastError = new Error(`health returned HTTP ${response.status}: ${body}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Core did not remain available after an invalid optional remote peer: ${lastError?.message ?? 'timeout'}\n${childOutput()}`);
}

const port = await getFreePort();
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'teams-a2a-remote-startup-'));
let output = '';
const child = spawn(process.execPath, [runtimeEntry], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(port),
    ITEM_STORE_PATH: path.join(temporaryRoot, 'items.json'),
    WORK_ITEM_STORE_PATH: path.join(temporaryRoot, 'work-items.json'),
    COLLABORATION_STORE_PATH: path.join(temporaryRoot, 'collaboration.json'),
    AGENT_JOB_STORE_PATH: path.join(temporaryRoot, 'agent-jobs.json'),
    AGENT_EVENT_STORE_PATH: path.join(temporaryRoot, 'agent-events.json'),
    GENUI_ACTION_STORE_PATH: path.join(temporaryRoot, 'genui-actions.json'),
    RESPONSE_MODE_STORE_PATH: path.join(temporaryRoot, 'response-modes.json'),
    AGENT_WORKSPACE: root,
    TEAMS_RUNTIME_DIST_DIR: runtimeDistRoot,
    TEAMS_CORE_BUILD: 'true',
    TEAMS_USE_SDK: 'false',
    TEAMS_SKIP_AUTH: 'true',
    TEAMS_SKIP_OUTBOUND: 'true',
    TEAMS_LOCAL_DEV: 'true',
    TEAMS_LOCAL_ACCESS_TOKEN: 'remote-startup-test-token',
    TEAMS_BIND_HOST: '127.0.0.1',
    PUBLIC_BASE_URL: '',
    TAB_DOMAIN: '',
    BOT_DOMAIN: '',
    DEV_TUNNEL_ID: '',
    MCP_PUBLIC_ENABLED: '',
    TEAMS_OPTIONAL_RUNTIME: '',
    TEAMS_A2A_REMOTE_AGENT_ENDPOINT: 'https://127.0.0.1',
    TEAMS_A2A_REMOTE_AGENT_BEARER_TOKEN: 'startup-isolation-test-token',
    TEAMS_A2A_REMOTE_AGENT_ID: 'remote-startup-test',
    TEAMS_A2A_REMOTE_PROVIDER_ID: 'remote-startup-provider',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk) => { output += chunk.toString(); });
child.stderr.on('data', (chunk) => { output += chunk.toString(); });

try {
  const health = await waitForHealth(`http://127.0.0.1:${port}/api/health`, () => output);
  assert.equal(health.ok, true);
  assert.ok(
    health.a2aRemoteFailures?.some(
      (failure) => failure.agentId === 'remote-startup-test' && failure.providerId === 'remote-startup-provider',
    ),
    `health must expose the isolated remote startup failure: ${JSON.stringify(health.a2aRemoteFailures)}`,
  );
  assert.equal(child.exitCode, null, 'Core must stay alive when an optional remote peer is unavailable');
  console.log('PASS: an unavailable legacy remote A2A peer is isolated without taking down Teams Core');
} finally {
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
  await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}
