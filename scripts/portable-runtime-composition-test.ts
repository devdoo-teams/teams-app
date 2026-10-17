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
    server = await new Promise<Server>((resolve, reject) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); listener.once('error', reject); });
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
    if (server?.listening) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    await host.close(); await fs.rm(directory, { recursive: true, force: true });
  }
});

test('worker authorization reuses an existing delegated credential with the exact API scope and rejects unusable receipts', async () => {
  const runtime = await import('../src/server/portable-worker-runtime.js');
  assert.equal(typeof runtime.createExistingDelegatedAuthorization, 'function', 'existing credential adapter is missing');
  const resource = `api://synthetic-worker.example/botid-${binding.clientId}`;
  const scopes: unknown[] = [];
  const authorization = runtime.createExistingDelegatedAuthorization({ resource,
    credential: { async getToken(scope) { scopes.push(scope); return { token: 'synthetic-delegated-token', expiresOnTimestamp: Date.now() + 60000 }; } } });
  assert.equal(await authorization(new AbortController().signal), 'Bearer synthetic-delegated-token');
  assert.deepEqual(scopes, [resource + '/.default']);
  for (const receipt of [null, { token: 'expired-synthetic', expiresOnTimestamp: Date.now() - 1000 },
    { token: 'synthetic\r\ninjection', expiresOnTimestamp: Date.now() + 60000 }]) {
    const invalid = runtime.createExistingDelegatedAuthorization({ resource, credential: { async getToken() { return receipt; } } });
    await assert.rejects(invalid(new AbortController().signal));
  }
  assert.throws(() => runtime.createExistingDelegatedAuthorization({ resource: 'https://unrelated.example/',
    credential: { async getToken() { return null; } } }));
});


test('outbound HTTP awaits the existing asynchronous authorization supplier', async () => {
  const { createAuthenticatedPullTransport } = await import('../src/server/portable-worker-runtime.js');
  const app = express(); app.post('/api/pull-worker/claim', (req, res) => {
    if (req.headers.authorization !== 'Bearer synthetic-async') { res.sendStatus(401); return; }
    res.json({ claim: null });
  });
  const server = await new Promise<Server>((resolve, reject) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); listener.once('error', reject); });
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const transport = createAuthenticatedPullTransport({ baseUrl: `http://127.0.0.1:${address.port}`, testLoopback: true,
      authorization: async () => 'Bearer synthetic-async' });
    assert.equal(await transport.claim(), undefined);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('authorization is included in the request deadline and a late credential cannot cause an HTTP call', async () => {
  const { createAuthenticatedPullTransport } = await import('../src/server/portable-worker-runtime.js');
  let requests = 0, resolveCredential!: (value: string) => void;
  const credential = new Promise<string>(resolve => { resolveCredential = resolve; });
  const app = express(); app.post('/api/pull-worker/claim', (_req, res) => { requests++; res.json({ claim: null }); });
  const server = await new Promise<Server>((resolve, reject) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); listener.once('error', reject); });
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const transport = createAuthenticatedPullTransport({ baseUrl: `http://127.0.0.1:${address.port}`, testLoopback: true,
      requestTimeoutMs: 100, authorization: () => credential });
    const started = Date.now();
    await assert.rejects(transport.claim());
    assert.ok(Date.now() - started >= 80, 'deadline must cover the pending credential');
    assert.ok(Date.now() - started < 1500, 'credential acquisition is bounded');
    assert.equal(requests, 0); resolveCredential('Bearer synthetic-late');
    await new Promise(resolve => setTimeout(resolve, 25)); assert.equal(requests, 0);
  } finally { resolveCredential('Bearer synthetic-teardown'); await new Promise<void>(resolve => server.close(() => resolve())); }
});


test('host requires a fresh authenticated worker observation; readiness is not configuration or a stored receipt', async () => {
  const runtime = await import('../src/server/portable-worker-runtime.js');
  const { teamsCliTestCatalog } = await import('./fixtures/teams-cli-agent-policy-fixture.js');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'portable-observation-'));
  const config = runtime.resolvePortableHostConfig({ TEAMS_AGENT_DISPATCH_MODE: 'pull-worker', TEAMS_PULL_STATE_DIR: directory,
    TEAMS_PULL_WORKER_BINDING: JSON.stringify(binding) })!;
  let now = Date.now();
  const create = () => runtime.createPortableHostRuntime({ config, sourceCommit, acceptedAudiences: [audience],
    validator: { validateAccessToken: async token => syntheticClaims[token] ?? null }, logger: { warn() {} }, now: () => now });
  let host = await create(); let server: Server | undefined;
  try {
    const app = express(); app.use('/api/pull-worker', host.router);
    server = await new Promise<Server>((resolve, reject) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); listener.once('error', reject); });
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const observation = { sourceCommit, catalog: teamsCliTestCatalog, providerFact: { provider: 'codex', availability: 'available',
      capabilities: ['submit', 'cancel'], observedAt: new Date(now).toISOString(), source: 'runtime-probe',
      readiness: { configured: 'configured', executable: 'present', authentication: 'authenticated', entitlement: 'allowed', probe: 'passed', reason: 'verified' } } };
    const report = (body: unknown, token = 'synthetic-worker') => fetch(`http://127.0.0.1:${address.port}/api/pull-worker/observe`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await report(observation, 'synthetic-teams-client')).status, 403);
    assert.equal((await report({ ...observation, sourceCommit: 'b'.repeat(40) })).status, 400);
    assert.equal((await report({ ...observation, catalog: { ...teamsCliTestCatalog, revision: '0'.repeat(64) } })).status, 400);
    assert.equal((await report({ ...observation, providerFact: { ...observation.providerFact, readiness: undefined } })).status, 400);
    assert.equal(host.modelCatalog(), undefined); assert.equal(host.providerFacts()[0].availability, 'unknown');
    assert.equal((await report(observation)).status, 200);
    assert.equal(host.modelCatalog()?.revision, teamsCliTestCatalog.revision);
    assert.deepEqual(host.providerFacts()[0].capabilities, ['submit', 'cancel']);
    now += 30001;
    assert.equal(host.modelCatalog(), undefined); assert.equal(host.providerFacts()[0].availability, 'unavailable');
    assert.equal((await report(observation)).status, 400, 'old probe cannot refresh readiness');
    await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined;
    await host.close(); host = await create();
    assert.equal(host.modelCatalog(), undefined); assert.equal(host.providerFacts()[0].availability, 'unknown');
  } finally {
    if (server?.listening) await new Promise<void>(resolve => server!.close(() => resolve()));
    await host.close(); await fs.rm(directory, { recursive: true, force: true });
  }
});


test('Mac startup is separately opt-in and requires the existing delegated provider and matching HTTPS API origin', async () => {
  const runtime = await import('../src/server/portable-worker-runtime.js');
  assert.equal(typeof runtime.resolvePortableMacConfig, 'function');
  assert.equal(runtime.resolvePortableMacConfig({}), undefined);
  assert.throws(() => runtime.resolvePortableMacConfig({ TEAMS_PULL_MAC_ENABLED: 'true' }));
  const origin = 'https://synthetic-worker.example';
  const env = { TEAMS_PULL_MAC_ENABLED: 'true', TEAMS_PULL_CREDENTIAL_PROVIDER: 'azure-cli', TEAMS_PULL_SERVER_ORIGIN: origin,
    TEAMS_PULL_RESOURCE_URI: `api://synthetic-worker.example/botid-${binding.clientId}`, TEAMS_PULL_WORKER_BINDING: JSON.stringify(binding) };
  const config = runtime.resolvePortableMacConfig(env)!;
  assert.equal(config.baseUrl, origin); assert.deepEqual(config.binding, binding);
  for (const override of [{ TEAMS_AGENT_DISPATCH_MODE: 'pull-worker' }, { TEAMS_AGENT_DISPATCH_MODE: 'azure-queue' },
    { TEAMS_PULL_CREDENTIAL_PROVIDER: 'default-chain' }, { TEAMS_PULL_SERVER_ORIGIN: 'http://127.0.0.1:9000' },
    { TEAMS_PULL_SERVER_ORIGIN: 'https://synthetic-worker.example/path' },
    { TEAMS_PULL_RESOURCE_URI: `api://other.example/botid-${binding.clientId}` },
    { TEAMS_AGENT_CLI_PROVIDER: 'copilot' }, { TEAMS_PULL_SERVER_ORIGIN: 'https://dxshc7dx-3978.jpe1.devtunnels.ms' }]) {
    assert.throws(() => runtime.resolvePortableMacConfig({ ...env, ...override }));
  }
});


async function boundaryHost(now?: () => number) {
  const runtime = await import('../src/server/portable-worker-runtime.js');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'portable-boundary-'));
  const config = runtime.resolvePortableHostConfig({ TEAMS_AGENT_DISPATCH_MODE: 'pull-worker', TEAMS_PULL_STATE_DIR: directory,
    TEAMS_PULL_WORKER_BINDING: JSON.stringify(binding) })!;
  const host = await runtime.createPortableHostRuntime({ config, sourceCommit, now, acceptedAudiences: [audience],
    validator: { validateAccessToken: async token => syntheticClaims[token] ?? null }, logger: { warn() {} } });
  const app = express(); app.use('/api/pull-worker', host.router);
  const server = await new Promise<Server>((resolve, reject) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); listener.once('error', reject); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return { host, origin: `http://127.0.0.1:${address.port}`,
    async close() { await new Promise<void>(resolve => server.close(() => resolve())); await host.close(); await fs.rm(directory, { recursive: true, force: true }); } };
}

test('actual index cached capability report expires 30 seconds after its original probe, and a new probe restores readiness', async () => {
  const { probeCliCapabilities, promoteVerifiedCodexCapability } = await import('../src/server/codex-capability.js');
  const { teamsCliTestCatalog, teamsCliTestSelection } = await import('./fixtures/teams-cli-agent-policy-fixture.js');
  // The index callback is not exported. Use it unchanged, with only CLI/catalog boundaries and the clock synthetic.
  const source = await fs.readFile(path.resolve('src/server/index.ts'), 'utf8');
  const start = source.indexOf('observe: async signal => {', source.indexOf('if (portableMacConfig) {'));
  assert.ok(start >= 0, 'production Mac observation callback must be exercised');
  const callback = source.slice(start + 'observe: '.length, source.indexOf('\n    } });', start) + 6);
  const readinessStart = source.indexOf('function cliProviderReadiness(');
  const bodyStart = source.indexOf('{', readinessStart);
  const readiness = new Function('capability', source.slice(bodyStart + 1, source.indexOf('\n}\n', bodyStart)));
  const RealDate = globalThis.Date; let now = RealDate.now(), probeCalls = 0; const original = now;
  class ClockDate extends RealDate { constructor(value?: string | number) { super(value === undefined ? now : value); } static now() { return now; } }
  const command = async () => { probeCalls++; return { outcome: 'success' as const, stdout: 'Logged in using ChatGPT' }; };
  const productionObserve = new Function('probeCliCapabilities', 'verifiedCoreCliCapabilities', 'observeCoreCodexModelCatalog',
    'serverBuildIdentity', 'providerRunners', 'agentService', 'cliProviderReadiness', `return (${callback});`)(
      (options: Parameters<typeof probeCliCapabilities>[0]) => probeCliCapabilities({ ...options,
        environment: { CODEX_BIN: 'synthetic-boundary-no-spawn' }, runCommand: command, now: () => now }),
      (capabilities: Awaited<ReturnType<typeof probeCliCapabilities>>) => ({ ...capabilities, codex: promoteVerifiedCodexCapability(capabilities.codex, true) }),
      async () => teamsCliTestCatalog, { sourceCommit }, { codex: {} }, { cancelStrict() {} }, readiness);
  const f = await boundaryHost(() => now);
  const report = (value: unknown) => fetch(`${f.origin}/api/pull-worker/observe`, { method: 'POST',
    headers: { authorization: 'Bearer synthetic-worker', 'content-type': 'application/json' }, body: JSON.stringify(value) });
  try {
    Object.defineProperty(globalThis, 'Date', { value: ClockDate, configurable: true, writable: true });
    const first = await productionObserve(new AbortController().signal); now = original + 14000;
    const cached = await productionObserve(new AbortController().signal); assert.equal(probeCalls, 1);
    assert.equal((await report(cached)).status, 200);
    now = original + 31000;
    assert.notEqual(f.host.providerFacts()[0].availability, 'available', 'cached reports must not extend the original probe lifetime');
    assert.equal(cached.providerFact.observedAt, first.providerFact.observedAt); assert.equal(f.host.modelCatalog(), undefined);
    await assert.rejects(f.host.dispatcher.dispatch({ id: 'stale-probe-job', ...binding, conversationId: 'boundary-session',
      prompt: 'Synthetic stale readiness', mode: 'read-only', provider: 'codex', status: 'queued', progress: [],
      createdAt: new Date().toISOString(), ...teamsCliTestSelection }), /fresh worker observation/);
    assert.equal((await report(cached)).status, 400);
    const fresh = await productionObserve(new AbortController().signal); assert.equal(probeCalls, 2);
    assert.equal(fresh.providerFact.observedAt, new Date(now).toISOString());
    assert.equal((await report(fresh)).status, 200); assert.equal(f.host.providerFacts()[0].availability, 'available');
  } finally { Object.defineProperty(globalThis, 'Date', { value: RealDate, configurable: true, writable: true }); await f.close(); }
});
