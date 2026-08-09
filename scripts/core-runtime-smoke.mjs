import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';

const root = process.cwd();
const entry = path.join(root, 'dist/server/index.js');

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

const port = await freePort();
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'teams-core-runtime-'));
const tabDomain = 'runtime-smoke.example.com';
const botClientId = '11111111-2222-4333-8444-555555555555';
const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: String(port),
  TEAMS_USE_SDK: 'true',
  TEAMS_SKIP_OUTBOUND: 'true',
  TEAMS_APP_ID: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
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
  GENUI_ACTION_STORE_PATH: path.join(dataDir, 'genui-actions.json'),
  RESPONSE_MODE_STORE_PATH: path.join(dataDir, 'response-modes.json'),
};

const output = [];
const child = spawn(process.execPath, [entry], {
  cwd: root,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const closePromise = new Promise((resolve) => child.once('close', resolve));
child.stdout.on('data', (chunk) => output.push(String(chunk)));
child.stderr.on('data', (chunk) => output.push(String(chunk)));

try {
  await waitForReady(child, output);
  const baseUrl = `http://127.0.0.1:${port}`;
  const healthResponse = await fetch(`${baseUrl}/api/health`);
  const health = await healthResponse.json();
  assert.equal(healthResponse.status, 200);
  assert.equal(health.bot, 'teams-sdk');
  assert.equal(health.outbound, 'disabled');
  assert.equal(health.copilotKit, 'disabled');
  assert.equal(health.mcpEnabled, false);
  assert.equal(health.responseProviders.deterministic, true);
  assert.equal(health.responseProviders.openai, false);

  const tabResponse = await fetch(`${baseUrl}/tabs/home/`);
  const tabHtml = await tabResponse.text();
  assert.equal(tabResponse.status, 200);
  assert.match(tabHtml, /id="root"/);
  assert.match(tabHtml, /assets\/main\.js/);
} finally {
  if (child.exitCode === null) child.kill('SIGTERM');
  await closePromise;
  await rm(dataDir, { recursive: true, force: true });
}

console.log('PASS: packaged Teams SDK core runtime listens and serves health/tab without optional API providers');
