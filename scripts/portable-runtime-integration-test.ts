import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import type { Server } from 'node:http';
import * as runtime from '../src/server/portable-worker-runtime.js';
import { AgentService } from '../src/server/agent-service.js';
import { AgentJobStore, AgentJobIdempotentReplayError } from '../src/server/agent-job-store.js';
import { AgentExecutionPolicy, AgentIsolationProvider, type AgentIsolationAcquireInput } from '../src/server/agent-execution-policy.js';
import { AgentAdmissionController } from '../src/server/agent-admission-controller.js';
import { CodexRunner, type CodexRunResult } from '../src/server/codex-runner.js';
import { GitService } from '../src/server/git-service.js';
import { observeTeamsCliTestCatalog, teamsCliTestCatalog, teamsCliTestSelection } from './fixtures/teams-cli-agent-policy-fixture.js';

const binding = { workerId: 'synthetic-runtime-mac', tenantId: '11111111-2222-4333-8444-555555555555',
  requesterId: '22222222-3333-4444-8555-666666666666', clientId: '33333333-4444-4555-8666-777777777777' };
const scope = { tenantId: binding.tenantId, requesterId: binding.requesterId, conversationId: 'synthetic-runtime-session' };
const sourceCommit = 'c'.repeat(40), audience = 'synthetic-portable-api';
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean, label: string) {
  const deadline = Date.now() + 4000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error(`synthetic wait expired: ${label}`); await wait(10); }
}
function gate() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
const submit = (key = 'synthetic-runtime-key') => ({ scope, provider: 'codex' as const, mode: 'read-only' as const,
  prompt: 'Synthetic end-to-end HTTP/Mac request', ...teamsCliTestSelection, idempotencyKey: key,
  requestHash: crypto.createHash('sha256').update(key).digest('hex'), notify: false });

async function fixture(dispose: () => Promise<void> = async () => undefined) {
  assert.equal(typeof runtime.createMacPullRuntime, 'function', 'existing-service Mac runtime composition is missing');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'portable-composed-services-'));
  const source = path.join(root, 'source'); await fs.mkdir(path.join(source, 'src'), { recursive: true });
  await fs.writeFile(path.join(source, 'src/synthetic.txt'), 'Synthetic data only.');
  let cleanupEntered = false;
  class Isolation extends AgentIsolationProvider {
    constructor() { super('synthetic-runtime-no-native-spawn'); }
    async acquire(input: AgentIsolationAcquireInput) { return this.issueLease({ ...input,
      spawn() { throw new Error('NO NATIVE SPAWN'); }, async dispose() { cleanupEntered = true; await dispose(); } }); }
  }
  class Runner extends CodexRunner {
    starts = 0; private finishRun?: (value: CodexRunResult) => void; private rejectRun?: (reason: Error) => void;
    override run(): Promise<CodexRunResult> { this.starts++; return new Promise((resolve, reject) => { this.finishRun = resolve; this.rejectRun = reject; }); }
    finish() { this.finishRun?.({ finalMessage: 'Synthetic composed result', threadId: 'synthetic-runtime-execution', eventCount: 1 }); }
    override cancel(): boolean { this.rejectRun?.(new Error('Synthetic cancellation')); return true; }
  }
  const runner = new Runner();
  const admission = new AgentAdmissionController({ globalLimit: 4, perTenantLimit: 2, perRequesterLimit: 1 }, { journalPath: path.join(root, 'mac/admission.json') });
  const allowed = (s: typeof scope) => s.tenantId === scope.tenantId && s.requesterId === scope.requesterId;
  const macService = new AgentService(new AgentJobStore(path.join(root, 'mac/jobs.json')), runner, source,
    async () => undefined, new GitService(source), { admissionController: admission,
      observeCodexModelCatalog: observeTeamsCliTestCatalog, executionPolicy: new AgentExecutionPolicy(source,
        { canReadScope: allowed, canMutateScope: allowed, isolationProvider: new Isolation() }) });
  await macService.initialize();
  const config = runtime.resolvePortableHostConfig({ TEAMS_AGENT_DISPATCH_MODE: 'pull-worker',
    TEAMS_PULL_STATE_DIR: path.join(root, 'cloud'), TEAMS_PULL_WORKER_BINDING: JSON.stringify(binding) })!;
  let host!: Awaited<ReturnType<typeof runtime.createPortableHostRuntime>>, cloud!: AgentService, server!: Server, port = 0;
  let dropFinish = false, validAuthorization = true;
  async function startCloud() {
    host = await runtime.createPortableHostRuntime({ config, sourceCommit, acceptedAudiences: [audience], logger: { warn() {} },
      validator: { validateAccessToken: async token => token === 'synthetic-runtime-token'
        ? { tid: binding.tenantId, oid: binding.requesterId, azp: binding.clientId, aud: audience, scp: 'access_as_user' } : null } });
    cloud = new AgentService(new AgentJobStore(config.storePath('AGENT_JOB_STORE_PATH', 'jobs.json')), undefined, source,
      async () => undefined, new GitService(source), { canReadScope: host.boundScope, canMutateScope: host.boundScope,
        observeCodexModelCatalog: async () => host.modelCatalog(), executionDispatcher: host.dispatcher,
        admissionController: new AgentAdmissionController({ globalLimit: 4, perTenantLimit: 2, perRequesterLimit: 1 },
          { journalPath: config.storePath('AGENT_ADMISSION_JOURNAL_PATH', 'admission.json') }),
        executionPolicy: new AgentExecutionPolicy(source, { canReadScope: host.boundScope, canMutateScope: host.boundScope }) });
    await cloud.initialize();
    const app = express();
    app.use('/api/pull-worker/finish', (_req, res, next) => {
      if (dropFinish) { dropFinish = false; res.json = (() => { res.socket?.destroy(); return res; }) as typeof res.json; } next();
    });
    app.use('/api/pull-worker', host.router);
    server = await new Promise<Server>((resolve, reject) => { const listener = app.listen(port, '127.0.0.1', () => resolve(listener)); listener.once('error', reject); });
    const address = server.address(); assert.ok(address && typeof address !== 'string'); port = address.port;
  }
  await startCloud();
  const mac = runtime.createMacPullRuntime({ baseUrl: `http://127.0.0.1:${port}`, testLoopback: true,
    sourceCommit, binding, service: macService, pollIntervalMs: 100, requestTimeoutMs: 1000,
    authorization: async () => validAuthorization ? 'Bearer synthetic-runtime-token' : 'Bearer synthetic-denied', observe: async () => ({ sourceCommit, catalog: teamsCliTestCatalog,
      providerFact: { provider: 'codex', availability: 'available', capabilities: ['submit', 'cancel'],
        source: 'runtime-probe', observedAt: new Date().toISOString(), readiness: { configured: 'configured', executable: 'present',
          authentication: 'authenticated', entitlement: 'allowed', probe: 'passed', reason: 'verified' } } }) });
  return { runner, admission, macService, mac, get cloud() { return cloud; }, get host() { return host; }, get port() { return port; },
    get cleanupEntered() { return cleanupEntered; }, setAuthorization(valid: boolean) { validAuthorization = valid; }, dropNextFinish() { dropFinish = true; },
    async restartCloud() { await cloud.close(); await new Promise<void>(resolve => server.close(() => resolve())); await startCloud(); },
    async close() { runner.cancel(); await mac.close(); await macService.close(); await cloud.close();
      await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(root, { recursive: true, force: true }); } };
}

test('real HTTP + both AgentServices preserve identity, deduplicate and recover queued/completed state across host restart', { skip: process.platform !== 'darwin' }, async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.cloud.submit(submit()), /catalog/i);
    assert.equal(await f.mac.step(), 'idle');
    const values = await Promise.allSettled([f.cloud.submit(submit()), f.cloud.submit(submit())]);
    const created = values.find(v => v.status === 'fulfilled'); const replay = values.find(v => v.status === 'rejected');
    assert.ok(created?.status === 'fulfilled'); assert.ok(replay?.status === 'rejected' && replay.reason instanceof AgentJobIdempotentReplayError);
    const id = created.value.id; assert.equal(replay.reason.job.id, id);
    assert.equal(f.cloud.get(id, { ...scope, conversationId: 'other-session' }), undefined);
    await assert.rejects(f.cloud.submit({ ...submit('foreign'), scope: { ...scope, tenantId: 'another-tenant' } }));
    await f.restartCloud(); assert.equal(f.host.providerFacts()[0].availability, 'unknown');
    assert.equal(f.cloud.get(id, scope)?.status, 'queued'); assert.equal(await f.mac.step(), 'running');
    await until(() => f.runner.starts === 1, 'one local start');
    const claim = await f.host.host.claim({ id: binding.workerId, ...scope }); assert.ok(claim);
    const badLease = await fetch(`http://127.0.0.1:${f.port}/api/pull-worker/finish`, { method: 'POST',
      headers: { authorization: 'Bearer synthetic-runtime-token', 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: 'another-session-job', leaseId: claim.leaseId, result: { status: 'cancelled' } }) });
    assert.equal(badLease.status, 403); assert.equal(f.runner.starts, 1);
    const replacedLease = await fetch(`http://127.0.0.1:${f.port}/api/pull-worker/finish`, { method: 'POST',
      headers: { authorization: 'Bearer synthetic-runtime-token', 'content-type': 'application/json' },
      body: JSON.stringify({ jobId: id, leaseId: crypto.randomUUID(), result: { status: 'cancelled' } }) });
    assert.equal(replacedLease.status, 409);
    f.runner.finish(); await f.macService.waitForExecutionSettlement(f.macService.listLocalOnly()[0].id, scope);
    await wait(10); assert.equal(await f.mac.step(), 'settled');
    await until(() => f.cloud.get(id, scope)?.status === 'completed', 'cloud durable result');
    assert.equal(f.cloud.get(id, scope)?.result, 'Synthetic composed result');
    await f.restartCloud(); assert.equal(f.cloud.get(id, scope)?.status, 'completed');
    assert.equal(await f.mac.step(), 'idle'); assert.equal(f.runner.starts, 1); assert.equal(f.admission.snapshot().global, 0);
  } finally { await f.close(); }
});

test('lost HTTP finish acknowledgement replays one durable result without another native execution', { skip: process.platform !== 'darwin' }, async () => {
  const f = await fixture();
  try {
    await f.mac.step(); const job = await f.cloud.submit(submit()); await f.mac.step();
    await until(() => f.runner.starts === 1, 'runner'); f.runner.finish();
    await f.macService.waitForExecutionSettlement(f.macService.listLocalOnly()[0].id, scope); await wait(10);
    f.dropNextFinish(); assert.equal(await f.mac.step(), 'blocked');
    assert.equal((await f.host.dispatcher.observe(job))?.status, 'completed');
    f.mac.reconnect(); assert.equal(await f.mac.step(), 'settled');
    assert.equal(f.runner.starts, 1); assert.equal(await f.mac.step(), 'idle');
  } finally { await f.close(); }
});

test('queued cancellation prevents execution and active cancellation waits for actual local cleanup', { skip: process.platform !== 'darwin' }, async () => {
  const cleanup = gate(); const f = await fixture(() => cleanup.promise);
  try {
    await f.mac.step(); const queued = await f.cloud.submit(submit('queued-cancel'));
    await f.cloud.cancelStrict(queued.id, scope, { notify: false }); assert.equal(await f.mac.step(), 'idle'); assert.equal(f.runner.starts, 0);
    const active = await f.cloud.submit(submit('active-cancel')); await f.mac.step(); await until(() => f.runner.starts === 1, 'runner');
    await f.cloud.cancelStrict(active.id, scope, { notify: false });
    let completed = false; const step = f.mac.step().then(value => { completed = true; return value; });
    await until(() => f.cleanupEntered, 'cleanup entered'); await wait(30); assert.equal(completed, false);
    assert.equal((await f.host.dispatcher.observe(active))?.status, 'running'); assert.equal(f.admission.snapshot().global, 1);
    cleanup.resolve(); assert.equal(await step, 'settled');
    await until(() => f.cloud.get(active.id, scope)?.status === 'cancelled', 'cloud cancellation receipt');
    assert.equal(f.admission.snapshot().global, 0);
  } finally { cleanup.resolve(); await f.close(); }
});


test('portable submission rejects writes and continuation before creating a job or acquiring admission', { skip: process.platform !== 'darwin' }, async () => {
  const f = await fixture();
  try {
    await f.mac.step();
    await assert.rejects(f.cloud.submit({ ...submit('unsupported-write'), mode: 'workspace-write' }), /fresh read-only/i);
    await assert.rejects(f.cloud.submit({ ...submit('unsupported-thread'), threadId: 'synthetic-old-thread' }), /fresh read-only/i);
    await assert.rejects(f.cloud.submit({ ...submit('unsupported-parent'), parentJobId: 'synthetic-old-job' }), /fresh read-only/i);
    assert.equal(f.cloud.listLocalOnly().length, 0); assert.equal(f.runner.starts, 0);
  } finally { await f.close(); }
});


test('authentication loss stops only the owned execution and requires explicit reconnect before replaying cleanup', { skip: process.platform !== 'darwin' }, async () => {
  const f = await fixture();
  try {
    await f.mac.step(); const job = await f.cloud.submit(submit()); await f.mac.step();
    await until(() => f.runner.starts === 1, 'runner'); f.setAuthorization(false);
    assert.equal(await f.mac.step(), 'blocked'); assert.equal(f.admission.snapshot().global, 0);
    assert.equal(f.macService.listLocalOnly()[0].status, 'cancelled');
    assert.equal((await f.host.dispatcher.observe(job))?.status, 'running', 'no remote cleanup receipt was forged through rejected authentication');
    f.setAuthorization(true); assert.equal(await f.mac.step(), 'blocked'); assert.equal(f.runner.starts, 1);
    f.mac.reconnect(); assert.equal(await f.mac.step(), 'settled');
    assert.equal((await f.host.dispatcher.observe(job))?.status, 'cancelled'); assert.equal(f.runner.starts, 1);
    assert.equal(await f.mac.close(), true); assert.ok(f.macService.get(f.macService.listLocalOnly()[0].id, scope));
  } finally { await f.close(); }
});

test('bounded scheduler drives the composed HTTP service and close cancels only its owned local work', { skip: process.platform !== 'darwin' }, async () => {
  const f = await fixture();
  try {
    f.mac.start(); f.mac.start();
    await until(() => f.host.providerFacts()[0].availability === 'available', 'scheduled observation');
    await f.cloud.submit(submit()); await until(() => f.runner.starts === 1, 'scheduled runner');
    assert.equal(await f.mac.close(), true); assert.equal(f.mac.status(), 'closed');
    assert.equal(f.macService.listLocalOnly()[0].status, 'cancelled'); assert.equal(f.admission.snapshot().global, 0);
    await wait(250); assert.equal(f.runner.starts, 1); assert.throws(() => f.mac.start());
  } finally { await f.close(); }
});
