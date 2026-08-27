import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const imageRef = process.env.IMAGE_REF?.trim();
const expectedSourceCommit = process.env.EXPECTED_SOURCE_COMMIT?.trim() || process.env.GITHUB_SHA?.trim();
const hostPort = process.env.HOST_PORT?.trim() || '3978';
if (!imageRef) throw new Error('IMAGE_REF is required.');
if (!expectedSourceCommit || !/^[a-f0-9]{40}$/.test(expectedSourceCommit)) {
  throw new Error('EXPECTED_SOURCE_COMMIT must be a full lowercase Git commit OID.');
}
if (!/^\d+$/.test(hostPort) || Number(hostPort) < 1 || Number(hostPort) > 65535) {
  throw new Error('HOST_PORT must be a valid TCP port.');
}

const botClientId = '11111111-2222-4333-8444-555555555555';
const clientId = '66666666-7777-4888-8999-000000000000';
const tenantId = '99999999-aaaa-4bbb-8ccc-dddddddddddd';
const tabDomain = 'runtime-smoke.example.com';
const applicationIdUri = `api://${tabDomain}/botid-${botClientId}`;
let containerId = '';

function docker(args, options = {}) {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}

function cleanup() {
  if (!containerId) return;
  try {
    const logs = docker(['logs', containerId]);
    if (logs) process.stderr.write(`${logs}\n`);
  } catch {}
  try { docker(['rm', '--force', containerId]); } catch {}
}

async function fetchWithTimeout(url, timeoutMs = 5_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

docker(['pull', imageRef]);
containerId = docker([
  'run', '--detach',
  '--publish', `${hostPort}:3978`,
  '--env', 'NODE_ENV=production',
  '--env', 'PORT=3978',
  '--env', 'TEAMS_USE_SDK=true',
  '--env', 'TEAMS_SKIP_OUTBOUND=true',
  '--env', 'TEAMS_APP_ID=aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  '--env', 'TEAMS_CATALOG_APP_ID=bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
  '--env', `BOT_ID=${botClientId}`,
  '--env', `BOT_CLIENT_ID=${botClientId}`,
  '--env', `CLIENT_ID=${clientId}`,
  '--env', 'CLIENT_SECRET=core-runtime-smoke-secret',
  '--env', `TENANT_ID=${tenantId}`,
  '--env', `TAB_DOMAIN=${tabDomain}`,
  '--env', `APPLICATION_ID_URI=${applicationIdUri}`,
  '--env', `TEAMS_USER_AUTH_ACCEPTED_AUDIENCES=${applicationIdUri}`,
  imageRef,
]);

let health;
let lastError = '';
for (let attempt = 1; attempt <= 30; attempt += 1) {
  try {
    const response = await fetchWithTimeout(`http://127.0.0.1:${hostPort}/api/health`, 2_000);
    if (!response.ok) throw new Error(`health HTTP ${response.status}`);
    health = await response.json();
    break;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    if (attempt === 30) throw new Error(`container did not become healthy within 30 seconds: ${lastError}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

assert.equal(health?.ok, true, 'container health did not report ok=true');
assert.equal(health?.environment, 'production', 'container health is not production');
assert.equal(health?.sourceCommit, expectedSourceCommit, `container source identity mismatch: ${health?.sourceCommit}`);
assert.equal(health?.auth, 'teams-authenticated', 'container production auth contract mismatch');
assert.equal(health?.bot, 'teams-sdk', 'container production bot contract mismatch');

const tabResponse = await fetchWithTimeout(`http://127.0.0.1:${hostPort}/tabs/home/`);
assert.equal(tabResponse.status, 200, `container tab HTTP ${tabResponse.status}`);
const html = await tabResponse.text();
const assetPath = html.match(/src="([^\"]*assets\/main\.js[^\"]*)"/)?.[1];
assert.ok(assetPath, 'container tab did not expose a hashed main.js asset');
const assetResponse = await fetchWithTimeout(new URL(assetPath, `http://127.0.0.1:${hostPort}/tabs/home/`));
assert.equal(assetResponse.status, 200, `container asset HTTP ${assetResponse.status}`);
assert.ok((await assetResponse.text()).length > 0, 'container main.js asset is empty');

console.log(`PASS: published image runtime smoke (${imageRef}, source ${expectedSourceCommit})`);
