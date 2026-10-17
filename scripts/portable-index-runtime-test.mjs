import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createChildTestEnvironment } from './child-test-environment.mjs';
import { resolveRuntimeDistRoot } from './runtime-dist.mjs';

// This is an actual bundled SDK/HTTP startup with synthetic configuration.
// No live JWT, Teams message, provider login or Mac native execution occurs.
const root = process.cwd();
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'portable-index-runtime-'));
const state = path.join(temporary, 'state');
const binding = { workerId: 'synthetic-index-mac', tenantId: '11111111-2222-4333-8444-555555555555',
  requesterId: '22222222-3333-4444-8555-666666666666', clientId: '33333333-4444-4555-8666-777777777777' };
const domain = 'synthetic-portable.example', botId = '44444444-5555-4666-8777-888888888888';
const cliSpy = path.join(temporary, 'synthetic-cli-spy.sh'), invocation = path.join(temporary, 'unexpected-cli-use');
await fs.writeFile(cliSpy, `#!/bin/sh\nprintf unexpected > '${invocation}'\nexit 83\n`, { mode: 0o700 });
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => {
    const address = server.address(); server.close(error => error ? reject(error) : resolve(address.port));
  });
});
const port = await freePort(), origin = `http://127.0.0.1:${port}`;
let child, finished, output = '';
const env = createChildTestEnvironment(process.env, { overrides: {
  TEAMS_RUNTIME_DIST_DIR: resolveRuntimeDistRoot(root), NODE_ENV: 'production', PORT: String(port), TEAMS_BIND_HOST: '127.0.0.1',
  TEAMS_USE_SDK: 'true', TEAMS_SKIP_OUTBOUND: 'true', CLIENT_SECRET: 'synthetic-portable-runtime-secret',
  TEAMS_APP_ID: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', TEAMS_CATALOG_APP_ID: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
  BOT_ID: botId, BOT_CLIENT_ID: botId, CLIENT_ID: binding.clientId, TENANT_ID: binding.tenantId,
  TAB_DOMAIN: domain, APPLICATION_ID_URI: `api://${domain}/botid-${botId}`,
  TEAMS_USER_AUTH_ACCEPTED_AUDIENCES: binding.clientId,
  TEAMS_OPERATOR_REQUESTER_ALLOWLIST: `${binding.tenantId}/${binding.requesterId}`,
  TEAMS_AGENT_DISPATCH_MODE: 'pull-worker', TEAMS_PULL_STATE_DIR: state,
  TEAMS_PULL_WORKER_BINDING: JSON.stringify(binding), CODEX_BIN: cliSpy,
} });
async function start() {
  output = '';
  child = spawn(process.execPath, ['scripts/start-server.mjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  finished = new Promise(resolve => child.once('close', resolve));
  child.stdout.on('data', chunk => { output += String(chunk); }); child.stderr.on('data', chunk => { output += String(chunk); });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`synthetic portable index startup failed: ${output}`);
    if (/listening on port|Teams messages:/u.test(output)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`synthetic portable index readiness timeout: ${output}`);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  let timer;
  await Promise.race([finished, new Promise((_, reject) => { timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('synthetic server did not finish bounded shutdown')); }, 20000); })]).finally(() => clearTimeout(timer));
}
async function assertRuntime() {
  const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(3000) });
  const health = await response.json(); assert.equal(response.status, 200);
  assert.equal(health.dispatch.mode, 'pull-worker'); assert.equal(health.dispatch.localCli, false);
  assert.equal(health.dispatch.executionBoundary, 'portable-mac');
  assert.equal(health.dispatch.readiness.state, 'unverified');
  assert.equal(health.storage.horizontalSafe, false);
  assert.match(health.sourceCommit, /^[a-f0-9]{40}$/u); assert.match(health.serverBundleSha256, /^[a-f0-9]{64}$/u);
  const auth = await fetch(`${origin}/api/pull-worker/claim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(3000) });
  assert.equal(auth.status, 401, 'actual production index mounted authenticated worker routes');
  const malformed = await fetch(`${origin}/api/pull-worker/claim`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{', signal: AbortSignal.timeout(3000) });
  assert.equal(malformed.status, 401, 'worker authentication precedes body parsing');
  await assert.rejects(fs.stat(invocation), { code: 'ENOENT' });
  return health;
}
try {
  await start(); const first = await assertRuntime();
  await fs.writeFile(path.join(state, 'synthetic-preservation.json'), 'synthetic persistent fixture');
  await stop(); await start(); const second = await assertRuntime();
  assert.equal(second.sourceCommit, first.sourceCommit); assert.equal(second.serverBundleSha256, first.serverBundleSha256);
  assert.equal(await fs.readFile(path.join(state, 'synthetic-preservation.json'), 'utf8'), 'synthetic persistent fixture');
  for (const name of ['items.json', 'work-items.json', 'collaboration.json', 'agent-jobs.json', 'a2a.json', 'a2a-outbound.json',
    'genui-actions.json', 'response-modes.json', 'execution-presentation.json']) {
    const stat = await fs.stat(path.join(state, name)); assert.equal(stat.mode & 0o077, 0, `private state ${name}`);
  }
  // CoreJobCardPages keeps an unused empty store absent until the first card publication.
  // Its existing process lease still proves this configured path is privately reserved.
  await assert.rejects(fs.stat(path.join(state, 'core-job-card-pages.json')), { code: 'ENOENT' });
  const pageLease = await fs.stat(path.join(state, '.core-job-card-pages.json.teams-sdk-store-lease', 'owner.json'));
  assert.equal(pageLease.mode & 0o077, 0);
  console.log(JSON.stringify({ result: 'PASS', sourceCommit: first.sourceCommit, version: first.version,
    serverBundleSha256: first.serverBundleSha256, nativeExecution: 'NOT_RUN', liveAuthentication: 'NOT_RUN', restart: 'PASS' }));
} finally { await stop(); await fs.rm(temporary, { recursive: true, force: true }); }
