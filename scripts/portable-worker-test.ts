import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { Server } from 'node:http';
import type { AgentJob } from '../src/server/agent-job-store.js';
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
    for (const change of [{ mode: 'workspace-write' }, { provider: 'copilot' }, { model: 'changed-model' }, { threadId: 'fixture-thread' }]) {
      await assert.rejects(f.host.dispatcher.dispatch(job(change as Partial<AgentJob>)));
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
