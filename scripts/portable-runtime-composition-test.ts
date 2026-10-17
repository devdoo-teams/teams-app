import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import express from 'express';
import type { Server } from 'node:http';

const binding = {
  workerId: 'synthetic-mac',
  tenantId: '11111111-2222-4333-8444-555555555555',
  requesterId: '22222222-3333-4444-8555-666666666666',
  clientId: '33333333-4444-4555-8666-777777777777',
};

test('portable host is opt-in and requires one explicit durable root and verified worker binding', async () => {
  const runtime = await import('../src/server/portable-worker-runtime.js');
  assert.equal(typeof runtime.resolvePortableHostConfig, 'function', 'production composition is missing');
  assert.equal(runtime.resolvePortableHostConfig({}), undefined);
  assert.equal(runtime.resolvePortableHostConfig({ TEAMS_AGENT_DISPATCH_MODE: 'local' }), undefined);
  assert.throws(() => runtime.resolvePortableHostConfig({ TEAMS_AGENT_DISPATCH_MODE: 'pull-worker' }));
  const root = path.join(os.tmpdir(), 'synthetic-portable-config');
  const config = runtime.resolvePortableHostConfig({
    TEAMS_AGENT_DISPATCH_MODE: 'pull-worker', TEAMS_PULL_STATE_DIR: root,
    TEAMS_PULL_WORKER_BINDING: JSON.stringify(binding),
  });
  assert.ok(config);
  assert.deepEqual(config.binding, binding);
  assert.equal(config.stateDirectory, root);
  assert.equal(config.storePath('AGENT_JOB_STORE_PATH', 'agent-jobs.json'), path.join(root, 'agent-jobs.json'));
  assert.equal(config.storePath('ITEM_STORE_PATH', 'items.json'), path.join(root, 'items.json'));
});

test('portable state refuses broad roots, multiple writers and a different storage/provider contract', async () => {
  const { resolvePortableHostConfig } = await import('../src/server/portable-worker-runtime.js');
  const env = { TEAMS_AGENT_DISPATCH_MODE: 'pull-worker', TEAMS_PULL_STATE_DIR: path.join(os.tmpdir(), 'synthetic-portable-config'),
    TEAMS_PULL_WORKER_BINDING: JSON.stringify(binding) };
  for (const change of [{ TEAMS_PULL_STATE_DIR: path.parse(process.cwd()).root }, { TEAMS_PULL_STATE_DIR: process.cwd() },
    { WEB_CONCURRENCY: '2' }, { NODE_APP_INSTANCE: '1' }, { TEAMS_STORAGE_BACKEND: 'cosmos' }, { TEAMS_AGENT_CLI_PROVIDER: 'copilot' }]) {
    assert.throws(() => resolvePortableHostConfig({ ...env, ...change }), JSON.stringify(change));
  }
  const config = resolvePortableHostConfig(env)!;
  assert.throws(() => config.storePath('ITEM_STORE_PATH', '../outside.json'));
  const escaped = resolvePortableHostConfig({ ...env, ITEM_STORE_PATH: path.join(os.tmpdir(), 'outside.json') })!;
  assert.throws(() => escaped.storePath('ITEM_STORE_PATH', 'items.json'));
});

const sourceCommit = 'a'.repeat(40);
const audience = 'synthetic-portable-api';
const claims = { tid: binding.tenantId, oid: binding.requesterId, azp: binding.clientId, aud: audience, scp: 'access_as_user' };
const syntheticClaims: Readonly<Record<string, unknown>> = {
  'synthetic-worker': claims,
  'synthetic-other-tenant': { ...claims, tid: '44444444-5555-4666-8777-888888888888' },
  'synthetic-other-owner': { ...claims, oid: '44444444-5555-4666-8777-888888888888' },
  'synthetic-teams-client': { ...claims, azp: '55555555-6666-4777-8888-999999999999' },
  'synthetic-other-audience': { ...claims, aud: 'another-api' },
  'synthetic-no-scope': { ...claims, scp: '' },
};

test('mounted worker routes require verified tenant, owner and authorized client, never a body/header worker ID', async () => {
  const runtime = await import('../src/server/portable-worker-runtime.js');
  assert.equal(typeof runtime.createPortableHostRuntime, 'function', 'authenticated runtime composition is missing');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'portable-runtime-auth-'));
  const config = runtime.resolvePortableHostConfig({ TEAMS_AGENT_DISPATCH_MODE: 'pull-worker', TEAMS_PULL_STATE_DIR: directory,
    TEAMS_PULL_WORKER_BINDING: JSON.stringify(binding) })!;
  const host = await runtime.createPortableHostRuntime({ config, sourceCommit, acceptedAudiences: [audience],
    validator: { validateAccessToken: async token => syntheticClaims[token] ?? null }, logger: { warn() {} } });
  let server: Server | undefined;
  try {
    const app = express(); app.use('/api/pull-worker', host.router);
    server = await new Promise<Server>(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const endpoint = `http://127.0.0.1:${address.port}/api/pull-worker/claim`;
    for (const [token, expected] of [['', 401], ['forged', 401], ['synthetic-other-tenant', 401],
      ['synthetic-other-owner', 403], ['synthetic-teams-client', 403], ['synthetic-other-audience', 401],
      ['synthetic-no-scope', 401], ['synthetic-worker', 200]] as const) {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-worker-id': binding.workerId,
        'x-validated-user-id': binding.requesterId }, body: '{}' });
      assert.equal(response.status, expected, token || 'no credential');
      if (expected === 200) assert.deepEqual(await response.json(), { claim: null });
    }
    const injected = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json',
      authorization: 'Bearer synthetic-worker' }, body: JSON.stringify({ workerId: 'forged' }) });
    assert.equal(injected.status, 400);
  } finally {
    if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await host.close(); await fs.rm(directory, { recursive: true, force: true });
  }
});
