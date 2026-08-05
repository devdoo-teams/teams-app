import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();

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

async function startServer({ production, dataFile }) {
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

async function runLocalFlow(dataFile) {
  const server = await startServer({ production: false, dataFile });

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

    const persisted = JSON.parse(await fs.readFile(dataFile, 'utf8'));
    assert(Array.isArray(persisted) && persisted.length === 2, 'isolated JSON store persists final state');
  } finally {
    await stopServer(server.child);
  }
}

async function runProductionAuthFlow(dataFile) {
  const server = await startServer({ production: true, dataFile });

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

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-sdk-runtime-'));
const localDataFile = path.join(tempDir, 'local-items.json');
const productionDataFile = path.join(tempDir, 'production-items.json');

try {
  console.log('Runtime verification: local authenticated-bypass flow');
  await runLocalFlow(localDataFile);
  console.log('Runtime verification: production authentication guard');
  await runProductionAuthFlow(productionDataFile);
  console.log('Runtime verification complete.');
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
