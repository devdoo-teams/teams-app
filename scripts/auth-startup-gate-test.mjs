import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const botClientId = '00000000-0000-4000-8000-000000000001';
const clientId = '00000000-0000-4000-8000-000000000002';
const tenantId = '00000000-0000-4000-8000-000000000003';
const applicationIdUri = `api://runtime.test/botid-${botClientId}`;

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

async function expectStartupFailure(label, overrides, expectedOutput) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), `teams-auth-startup-${label}-`));
  const child = spawn(process.execPath, [path.join(root, 'dist/server/index.js')], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(await freePort()),
      ITEM_STORE_PATH: path.join(tempRoot, 'items.json'),
      WORK_ITEM_STORE_PATH: path.join(tempRoot, 'work-items.json'),
      COLLABORATION_STORE_PATH: path.join(tempRoot, 'collaboration.json'),
      AGENT_JOB_STORE_PATH: path.join(tempRoot, 'agent-jobs.json'),
      GENUI_ACTION_STORE_PATH: path.join(tempRoot, 'genui-actions.json'),
      RESPONSE_MODE_STORE_PATH: path.join(tempRoot, 'response-modes.json'),
      AGENT_WORKSPACE: root,
      CODEX_BIN: process.execPath,
      CODEX_SCRIPT: path.join(root, 'scripts/fake-codex.mjs'),
      WEATHER_MODE: 'live',
      TEAMS_USE_SDK: 'true',
      TEAMS_SKIP_AUTH: '',
      TEAMS_LOCAL_DEV: 'false',
      TEAMS_SKIP_OUTBOUND: 'true',
      TEAMS_BIND_HOST: '127.0.0.1',
      BOT_CLIENT_ID: botClientId,
      CLIENT_ID: clientId,
      CLIENT_SECRET: 'runtime-test-secret',
      TENANT_ID: tenantId,
      TAB_DOMAIN: 'runtime.test',
      APPLICATION_ID_URI: applicationIdUri,
      TEAMS_USER_AUTH_ACCEPTED_AUDIENCES: `${clientId},${applicationIdUri}`,
      TEAMS_OPERATOR_REQUESTER_ALLOWLIST: '',
      PUBLIC_BASE_URL: '',
      BOT_DOMAIN: '',
      DEV_TUNNEL_ID: '',
      MCP_PUBLIC_ENABLED: '',
      WEB_CONCURRENCY: '',
      NODE_APP_INSTANCE: '',
      ...overrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });

  try {
    const result = await Promise.race([
      new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal }))),
      new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 2_500)),
    ]);

    if (result.timeout) {
      child.kill('SIGTERM');
      await new Promise((resolve) => child.once('exit', resolve));
      assert.fail(`${label}: production startup remained alive with invalid authentication configuration`);
    }
    assert.notEqual(result.code, 0, `${label}: startup exits non-zero`);
    assert.match(output, expectedOutput, `${label}: startup error names the invalid configuration`);
  } finally {
    if (child.exitCode === null) child.kill('SIGTERM');
    await rm(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
}

await execFileAsync(process.execPath, ['scripts/build-server.mjs'], { cwd: root });

await expectStartupFailure(
  'missing-audiences',
  { TEAMS_USER_AUTH_ACCEPTED_AUDIENCES: '' },
  /TEAMS_USER_AUTH_ACCEPTED_AUDIENCES/,
);
await expectStartupFailure(
  'whitespace-client-id',
  { CLIENT_ID: '   ' },
  /CLIENT_ID.*(?:non-empty|UUID|GUID)|Production requires CLIENT_ID/i,
);
await expectStartupFailure(
  'malformed-tenant-id',
  { TENANT_ID: 'not-a-tenant-guid' },
  /TENANT_ID.*(?:UUID|GUID)/i,
);
await expectStartupFailure(
  'useless-audience',
  { TEAMS_USER_AUTH_ACCEPTED_AUDIENCES: 'api://unrelated-resource' },
  /TEAMS_USER_AUTH_ACCEPTED_AUDIENCES.*(?:CLIENT_ID|APPLICATION_ID_URI|registered)/i,
);

console.log('PASS: production startup rejects missing, whitespace, malformed, or unrelated authentication configuration');
