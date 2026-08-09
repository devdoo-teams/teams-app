import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = process.cwd();

await execFileAsync(process.execPath, ['scripts/build-server.mjs'], { cwd: root });

const tempRoot = await mkdtemp(path.join(tmpdir(), 'teams-auth-startup-gate-'));
const port = '43978';
const child = spawn(process.execPath, [path.join(root, 'dist/server/index.js')], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: port,
    ITEM_STORE_PATH: path.join(tempRoot, 'items.json'),
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
    BOT_CLIENT_ID: '00000000-0000-4000-8000-000000000001',
    CLIENT_ID: '00000000-0000-4000-8000-000000000002',
    CLIENT_SECRET: 'runtime-test-secret',
    TENANT_ID: '00000000-0000-4000-8000-000000000003',
    TAB_DOMAIN: 'runtime.test',
    APPLICATION_ID_URI: 'api://runtime.test/botid-00000000-0000-4000-8000-000000000001',
    TEAMS_USER_AUTH_ACCEPTED_AUDIENCES: '',
    PUBLIC_BASE_URL: '',
    BOT_DOMAIN: '',
    DEV_TUNNEL_ID: '',
    MCP_PUBLIC_ENABLED: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.on('data', (chunk) => { output += chunk.toString(); });
child.stderr.on('data', (chunk) => { output += chunk.toString(); });

const result = await Promise.race([
  new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal }))),
  new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 7_000)),
]);

try {
  if (result.timeout) {
    child.kill('SIGTERM');
    assert.fail('production startup should fail closed when accepted audiences are missing');
  }

  assert.notEqual(result.code, 0, 'startup exits non-zero when accepted audiences are missing');
  assert.match(output, /TEAMS_USER_AUTH_ACCEPTED_AUDIENCES/, 'startup error names the explicit audience allowlist environment variable');
  console.log('PASS: production startup fails closed when TEAMS_USER_AUTH_ACCEPTED_AUDIENCES is not configured');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
