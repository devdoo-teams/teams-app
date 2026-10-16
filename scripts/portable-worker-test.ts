import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { Server } from 'node:http';
import type { AgentJob } from '../src/server/agent-job-store.js';
import type { AgentJobScope } from '../src/server/agent-job-store.js';
import type { AgentService } from '../src/server/agent-service.js';
import type { PullTransport } from '../src/server/pull-worker-http.js';
import { TEAMS_CLI_AGENT_POLICY } from '../src/shared/teams-cli-agent-policy.js';

const scope = { tenantId: 'fixture-tenant', requesterId: 'fixture-owner', conversationId: 'fixture-conversation' };
const worker = { id: 'fixture-mac', ...scope };
const commit = 'a'.repeat(40);
const selection = { model: TEAMS_CLI_AGENT_POLICY.model, reasoningEffort: TEAMS_CLI_AGENT_POLICY.reasoningEffort, catalogRevision: 'b'.repeat(64) };
function job(overrides: Partial<AgentJob> = {}): AgentJob {
  return { id: 'fixture-job', prompt: 'Synthetic read-only request', mode: 'read-only', provider: 'codex',
    status: 'queued', progress: [], createdAt: '2026-10-17T00:00:00.000Z', ...scope, ...selection, ...overrides };
}
async function fixture() {
  const { createPullWorkerHost } = await import('../src/server/pull-worker.js');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'portable-worker-fixture-'));
  let now = Date.parse('2026-10-17T00:00:00Z');
  const options = { file: path.join(dir, 'private', 'handoff.json'), workerId: worker.id, sourceCommit: commit, leaseMs: 1000, now: () => now };
  const host = await createPullWorkerHost(options);
  return { host, options, advance: (ms: number) => { now += ms; }, close: async () => { await host.close(); await fs.rm(dir, { recursive: true, force: true }); } };
}

test('portable handoff exports an opt-in durable host', async () => {
  const module = await import('../src/server/pull-worker.js').catch(() => undefined);
  assert.equal(typeof module?.createPullWorkerHost, 'function', 'durable handoff implementation is missing');
});

test('dispatch and claim replay preserve exact task owner and model; conflicting replays fail', async () => {
  const f = await fixture();
  try {
    await Promise.all([f.host.dispatcher.dispatch(job()), f.host.dispatcher.dispatch(job())]);
    const first = await f.host.claim(worker);
    assert.ok(first); assert.deepEqual(first.task.scope, scope); assert.deepEqual(first.task.selection, selection);
    assert.deepEqual(await f.host.claim(worker), first);
    await assert.rejects(f.host.dispatcher.dispatch(job({ prompt: 'changed' })), /conflict/);
    await assert.rejects(f.host.dispatcher.observe(job({ requesterId: 'other-owner' })), /owner|conflict/);
  } finally { await f.close(); }
});

test('unapproved writes, provider changes, model changes and continuation are refused', async () => {
  const f = await fixture();
  try {
    const changes: Partial<AgentJob>[] = [{ mode: 'workspace-write' }, { provider: 'copilot' }, { model: 'changed-model' }, { threadId: 'fixture-thread' }];
    for (const change of changes) {
      await assert.rejects(f.host.dispatcher.dispatch(job(change)));
    }
    assert.equal(await f.host.claim(worker), undefined);
  } finally { await f.close(); }
});

test('another worker or owner cannot claim or mutate a lease', async () => {
  const f = await fixture();
  try {
    await f.host.dispatcher.dispatch(job());
    assert.equal(await f.host.claim({ ...worker, requesterId: 'other' }), undefined);
    assert.equal(await f.host.claim({ ...worker, id: 'other' }), undefined);
    const claim = (await f.host.claim(worker))!;
    await assert.rejects(f.host.begin({ ...worker, requesterId: 'other' }, claim), /owner/);
    await assert.rejects(f.host.begin(worker, { ...claim, leaseId: 'forged' }), /lease/);
  } finally { await f.close(); }
});

test('only an unstarted lease may be reissued; started expired work is quarantined', async () => {
  const f = await fixture();
  try {
    await f.host.dispatcher.dispatch(job()); const first = (await f.host.claim(worker))!;
    f.advance(1001); const second = (await f.host.claim(worker))!;
    assert.notEqual(second.leaseId, first.leaseId);
    await assert.rejects(f.host.begin(worker, first), /lease/);
    await f.host.begin(worker, second); await f.host.begin(worker, second);
    f.advance(1001);
    assert.equal((await f.host.dispatcher.observe(job()))?.status, 'quarantined');
    assert.equal(await f.host.claim(worker), undefined);
  } finally { await f.close(); }
});

test('completion is durable and idempotent across host restart; conflicting completion fails', async () => {
  const f = await fixture();
  try {
    await f.host.dispatcher.dispatch(job()); const claim = (await f.host.claim(worker))!;
    await f.host.begin(worker, claim);
    const result = { status: 'completed' as const, result: 'Synthetic result', providerExecutionId: 'fixture-execution' };
    await f.host.finish(worker, claim, result); await f.host.finish(worker, claim, result);
    await assert.rejects(f.host.finish(worker, claim, { ...result, result: 'changed' }), /conflict/);
    await f.host.close();
    const { createPullWorkerHost } = await import('../src/server/pull-worker.js');
    const reopened = await createPullWorkerHost(f.options);
    try { assert.deepEqual(await reopened.dispatcher.observe(job()), result); assert.equal(await reopened.claim(worker), undefined); }
    finally { await reopened.close(); }
  } finally { await f.close(); }
});

test('cancellation before begin prevents execution; active cancellation waits for cleanup receipt', async () => {
  const f = await fixture();
  try {
    await f.host.dispatcher.dispatch(job()); const claim = (await f.host.claim(worker))!;
    await f.host.dispatcher.cancel(job(), 'cancel');
    await assert.rejects(f.host.begin(worker, claim), /cancelled/);
    await f.host.dispatcher.dispatch(job({ id: 'active' })); const active = (await f.host.claim(worker))!;
    await f.host.begin(worker, active); await f.host.dispatcher.cancel(job({ id: 'active' }), 'cancel');
    assert.equal((await f.host.dispatcher.observe(job({ id: 'active' })))?.status, 'running');
    assert.equal((await f.host.heartbeat(worker, active)).cancellationRequested, true);
    await assert.rejects(f.host.finish(worker, active, { status: 'completed', result: 'too late' }), /cancel/);
    await f.host.finish(worker, active, { status: 'cancelled' });
    assert.equal((await f.host.dispatcher.observe(job({ id: 'active' })))?.status, 'cancelled');
  } finally { await f.close(); }
});

test('authenticated loopback HTTP preserves dispatch/begin/result and rejects body identity injection', async () => {
  const { createPullWorkerRouter, createAuthenticatedPullTransport } = await import('../src/server/pull-worker-http.js');
  const f = await fixture(); let server: Server | undefined;
  try {
    const app = express();
    app.use('/api/pull-worker', createPullWorkerRouter({ host: f.host,
      authenticate: (req, res, next) => { if (req.header('authorization') !== 'fixture-only') { res.sendStatus(401); return; } next(); },
      resolveWorker: () => worker,
    }));
    server = await new Promise<Server>((resolve, reject) => {
      const s = app.listen(0, '127.0.0.1', (error?: Error) => error ? reject(error) : resolve(s)); s.once('error', reject);
    });
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    assert.throws(() => createAuthenticatedPullTransport({ baseUrl, authorization: () => 'fixture-only' }), /HTTPS/);
    assert.throws(() => createAuthenticatedPullTransport({ baseUrl: 'https://dxshc7dx-3978.jpe1.devtunnels.ms', authorization: () => 'fixture-only' }), /DevTunnel/);
    const transport = createAuthenticatedPullTransport({ baseUrl, authorization: () => 'fixture-only', testLoopback: true });
    assert.equal((await fetch(`${baseUrl}/api/pull-worker/claim`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${baseUrl}/api/pull-worker/claim`, { method: 'POST', headers: { authorization: 'fixture-only', 'content-type': 'application/json' }, body: JSON.stringify({ requesterId: 'forged' }) })).status, 400);
    await f.host.dispatcher.dispatch(job()); const claim = (await transport.claim())!;
    assert.deepEqual((await transport.begin(claim)).task.selection, selection);
    await transport.finish(claim, { status: 'completed', result: 'synthetic HTTP result', providerExecutionId: 'fixture-native-id' });
    assert.equal((await f.host.dispatcher.observe(job()))?.result, 'synthetic HTTP result');
  } finally { await new Promise<void>(resolve => server ? server.close(() => resolve()) : resolve()); await f.close(); }
});

function controlledExecutor() {
  let starts = 0, cancels = 0;
  let resolve: ((value: import('../src/server/pull-worker.js').PullResult) => void) | undefined;
  return {
    get starts() { return starts; }, get cancels() { return cancels; },
    complete() { resolve!({ status: 'completed', result: 'fixture execution result', providerExecutionId: 'fixture-execution' }); },
    async start() { starts++; return {
      result: new Promise<import('../src/server/pull-worker.js').PullResult>(r => { resolve = r; }),
      async cancel() { cancels++; resolve!({ status: 'cancelled' }); },
    }; },
  };
}
function localTransport(host: Awaited<ReturnType<typeof fixture>>['host']): PullTransport {
  return { claim: () => host.claim(worker), begin: lease => host.begin(worker, lease),
    heartbeat: lease => host.heartbeat(worker, lease), finish: (lease, result) => host.finish(worker, lease, result) };
}

test('Mac connector preserves identity and starts once after repeated polling and a lost result reply', async () => {
  const { MacPullWorker } = await import('../src/server/mac-pull-worker.js');
  const f = await fixture(); const executor = controlledExecutor(); const transport = localTransport(f.host);
  let loseReply = true;
  const connector = new MacPullWorker({ transport: { ...transport, async finish(lease, result) {
    await transport.finish(lease, result); if (loseReply) { loseReply = false; throw new Error('fixture lost reply'); }
  } }, executor, principal: scope, sourceCommit: commit });
  try {
    await f.host.dispatcher.dispatch(job());
    await Promise.all([connector.step(), connector.step()]); assert.equal(executor.starts, 1);
    executor.complete(); await Promise.resolve(); await connector.step();
    connector.reconnect(); await connector.step();
    assert.equal(executor.starts, 1);
    assert.equal((await f.host.dispatcher.observe(job()))?.status, 'completed');
  } finally { await connector.close(); await f.close(); }
});

test('lost begin reply does not execute before an acknowledged same-lease retry', async () => {
  const { MacPullWorker } = await import('../src/server/mac-pull-worker.js');
  const f = await fixture(); const executor = controlledExecutor(); const transport = localTransport(f.host); let loseReply = true;
  const connector = new MacPullWorker({ transport: { ...transport, async begin(lease) {
    const claim = await transport.begin(lease); if (loseReply) { loseReply = false; throw new Error('fixture lost begin'); } return claim;
  } }, executor, principal: scope, sourceCommit: commit });
  try {
    await f.host.dispatcher.dispatch(job()); assert.equal(await connector.step(), 'blocked'); assert.equal(executor.starts, 0);
    connector.reconnect(); await connector.step(); assert.equal(executor.starts, 1);
  } finally { await connector.close(); await f.close(); }
});

test('disconnect cancels owned execution, blocks new work and acknowledges cleanup on reconnect', async () => {
  const { MacPullWorker } = await import('../src/server/mac-pull-worker.js');
  const f = await fixture(); const executor = controlledExecutor(); const transport = localTransport(f.host); let offline = false;
  const connector = new MacPullWorker({ transport: { ...transport, async heartbeat(lease) {
    if (offline) throw new Error('fixture disconnected'); return transport.heartbeat(lease);
  } }, executor, principal: scope, sourceCommit: commit });
  try {
    await f.host.dispatcher.dispatch(job()); await connector.step(); offline = true;
    assert.equal(await connector.step(), 'blocked'); assert.equal(executor.cancels, 1);
    assert.equal(await connector.step(), 'blocked'); assert.equal(executor.starts, 1);
    f.advance(1001); assert.equal((await f.host.dispatcher.observe(job()))?.status, 'quarantined');
    offline = false; connector.reconnect(); await connector.step();
    assert.equal((await f.host.dispatcher.observe(job()))?.status, 'cancelled');
  } finally { await connector.close(); await f.close(); }
});

test('Mac connector rejects a changed owner/source/model before calling execution', async () => {
  const { MacPullWorker } = await import('../src/server/mac-pull-worker.js');
  const f = await fixture(); const executor = controlledExecutor();
  try {
    await f.host.dispatcher.dispatch(job());
    for (const variant of ['owner', 'source', 'model'] as const) {
      const transport = localTransport(f.host);
      const connector = new MacPullWorker({ transport: variant === 'model' ? { ...transport,
        async begin(lease) { const claim = await transport.begin(lease); return { ...claim, task: { ...claim.task, selection: { ...claim.task.selection, model: 'changed' as typeof selection.model } } }; },
      } : transport, executor, principal: variant === 'owner' ? { ...scope, requesterId: 'different' } : scope,
        sourceCommit: variant === 'source' ? 'c'.repeat(40) : commit });
      assert.equal(await connector.step(), 'blocked'); assert.equal(executor.starts, 0); await connector.close();
    }
  } finally { await f.close(); }
});

test('real AgentService isolation and model checks remain authoritative at the Mac adapter', async () => {
  const { createAgentServiceMacExecutor } = await import('../src/server/mac-pull-worker.js');
  const { AgentService } = await import('../src/server/agent-service.js');
  const { AgentJobStore } = await import('../src/server/agent-job-store.js');
  const { CodexRunner } = await import('../src/server/codex-runner.js');
  const { GitService } = await import('../src/server/git-service.js');
  const { AgentExecutionPolicy } = await import('../src/server/agent-execution-policy.js');
  const { observeTeamsCliTestCatalog } = await import('./fixtures/teams-cli-agent-policy-fixture.js');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'portable-policy-fixture-'));
  let spawned = 0;
  class NeverRunner extends CodexRunner { override async run(): Promise<never> { spawned++; throw new Error('fixture must not spawn'); } }
  const service = new AgentService(new AgentJobStore(path.join(dir, 'private', 'jobs.json')), new NeverRunner(), dir,
    async () => undefined, new GitService(dir), { observeCodexModelCatalog: observeTeamsCliTestCatalog,
      executionPolicy: new AgentExecutionPolicy(dir, { canReadScope: () => true, canMutateScope: () => true }) });
  await service.initialize();
  try {
    const executor = createAgentServiceMacExecutor(service);
    const catalog = await observeTeamsCliTestCatalog();
    const task = { jobId: 'policy-job', scope, provider: 'codex' as const, mode: 'read-only' as const,
      prompt: 'synthetic policy test', createdAt: job().createdAt, sourceCommit: commit,
      selection: { ...selection, catalogRevision: catalog.revision } };
    await assert.rejects(executor.start(task), /격리|isolation/);
    await assert.rejects(executor.start({ ...task, selection: { ...task.selection, model: 'changed' } }));
    assert.equal(spawned, 0);
  } finally { await service.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('local durable AgentJobStore replay attaches to one synthetic execution across adapter instances', async () => {
  const { createAgentServiceMacExecutor } = await import('../src/server/mac-pull-worker.js');
  const { AgentJobStore } = await import('../src/server/agent-job-store.js');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'portable-idempotency-fixture-'));
  const store = new AgentJobStore(path.join(dir, 'private', 'jobs.json')); await store.initialize(); let starts = 0;
  const service = {
    async submit(input: Parameters<AgentService['submit']>[0]) {
      const created = await store.create({ ...input, executionEnvironment: 'local-macos' }); starts++;
      return (await store.update(created.id, input.scope, { status: 'completed', result: 'fixture', threadId: 'fixture-id' }))!;
    },
    async waitForTerminal(id: string, requestScope: AgentJobScope) { return store.get(id, requestScope)!; },
    async cancelStrict(id: string, requestScope: AgentJobScope) { return (await store.update(id, requestScope, { status: 'cancelled' }))!; },
  };
  try {
    const task = { jobId: 'durable-job', scope, provider: 'codex' as const, mode: 'read-only' as const,
      prompt: 'fixture request', selection, sourceCommit: commit, createdAt: job().createdAt };
    const first = await createAgentServiceMacExecutor(service).start(task);
    const replay = await createAgentServiceMacExecutor(service).start(task);
    assert.deepEqual(await first.result, await replay.result); assert.equal(starts, 1);
    await assert.rejects(createAgentServiceMacExecutor(service).start({ ...task, prompt: 'changed' }), /conflict/);
    assert.equal(starts, 1);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('active cloud cancellation waits for owned Mac cleanup before terminal acknowledgement', async () => {
  const { MacPullWorker } = await import('../src/server/mac-pull-worker.js');
  const f = await fixture(); const executor = controlledExecutor();
  const connector = new MacPullWorker({ transport: localTransport(f.host), executor, principal: scope, sourceCommit: commit });
  try {
    await f.host.dispatcher.dispatch(job()); await connector.step(); await f.host.dispatcher.cancel(job(), 'fixture');
    assert.equal(await connector.step(), 'settled'); assert.equal(executor.cancels, 1);
    assert.equal((await f.host.dispatcher.observe(job()))?.status, 'cancelled');
  } finally { await connector.close(); await f.close(); }
});

test('failed native cleanup keeps the connector blocked and prevents reassignment', async () => {
  const { MacPullWorker } = await import('../src/server/mac-pull-worker.js');
  const f = await fixture(); const transport = localTransport(f.host); let offline = false, starts = 0;
  const connector = new MacPullWorker({ principal: scope, sourceCommit: commit,
    transport: { ...transport, async heartbeat(lease) { if (offline) throw new Error('fixture disconnect'); return transport.heartbeat(lease); } },
    executor: { async start() { starts++; return { result: new Promise(() => undefined), async cancel() { throw new Error('fixture cleanup failed'); } }; } },
  });
  try {
    await f.host.dispatcher.dispatch(job()); await connector.step(); offline = true;
    assert.equal(await connector.step(), 'blocked'); assert.throws(() => connector.reconnect(), /reconciliation/);
    f.advance(1001); assert.equal(await f.host.claim(worker), undefined); assert.equal(starts, 1);
    assert.equal(await connector.close(), false);
  } finally { await connector.close(); await f.close(); }
});
