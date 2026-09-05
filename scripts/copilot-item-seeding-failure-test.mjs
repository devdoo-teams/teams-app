import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const tokenHeader = 'x-teams-local-access-token';

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

async function waitForHealth(baseUrl, token, child, output) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited before health:\n${output().slice(-4_000)}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`, { headers: { [tokenHeader]: token } });
      if (response.ok) return;
    } catch {
      // Continue until the bounded deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become healthy:\n${output().slice(-4_000)}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 3_000)),
  ]);
}

await execFileAsync(process.execPath, ['scripts/build-server.mjs'], { cwd: root });

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'teams-copilot-seed-failure-'));
const itemStorePath = path.join(tempRoot, 'items.json');
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const token = crypto.randomBytes(32).toString('base64url');
const child = spawn(process.execPath, [path.join(root, 'dist/server/index.js')], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(port),
    ITEM_STORE_PATH: itemStorePath,
    WORK_ITEM_STORE_PATH: path.join(tempRoot, 'work-items.json'),
    COLLABORATION_STORE_PATH: path.join(tempRoot, 'collaboration.json'),
    AGENT_JOB_STORE_PATH: path.join(tempRoot, 'agent-jobs.json'),
    GENUI_ACTION_STORE_PATH: path.join(tempRoot, 'genui-actions.json'),
    RESPONSE_MODE_STORE_PATH: path.join(tempRoot, 'response-modes.json'),
    AGENT_WORKSPACE: root,
    TEAMS_USE_SDK: 'false',
    TEAMS_OPTIONAL_RUNTIME: 'true',
    COPILOTKIT_DETERMINISTIC_MODE: 'true',
    TEAMS_SKIP_OUTBOUND: 'true',
    TEAMS_SKIP_AUTH: 'true',
    TEAMS_LOCAL_DEV: 'true',
    TEAMS_BIND_HOST: '127.0.0.1',
    TEAMS_LOCAL_ACCESS_TOKEN: token,
    PUBLIC_BASE_URL: '',
    TAB_DOMAIN: '',
    BOT_DOMAIN: '',
    DEV_TUNNEL_ID: '',
    MCP_PUBLIC_ENABLED: '',
    WEB_CONCURRENCY: '',
    NODE_APP_INSTANCE: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.on('data', (chunk) => { output += chunk.toString(); });
child.stderr.on('data', (chunk) => { output += chunk.toString(); });

try {
  await waitForHealth(baseUrl, token, child, () => output);
  await rm(itemStorePath);
  await mkdir(itemStorePath);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  let response;
  let requestError;
  try {
    response = await fetch(`${baseUrl}/api/copilotkit/agent/default/run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [tokenHeader]: token,
      },
      body: '{}',
      signal: controller.signal,
    });
  } catch (error) {
    requestError = error;
  } finally {
    clearTimeout(timeout);
  }

  assert.ifError(requestError);
  assert.equal(response?.status, 500, 'seed persistence failure reaches the Express error response');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(child.exitCode, null, `seed persistence failure does not crash the server:\n${output.slice(-4_000)}`);

  console.log('PASS: Copilot item seeding failure returns promptly through Express and keeps the server alive');
} finally {
  await stopServer(child);
  await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}
