import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { AgentService } from '../src/server/agent-service.js';
import { AgentJobStore, AgentJobIdempotentReplayError, type AgentJob } from '../src/server/agent-job-store.js';
import { AgentExecutionPolicy, AgentIsolationProvider, type AgentIsolationAcquireInput } from '../src/server/agent-execution-policy.js';
import { AgentAdmissionController } from '../src/server/agent-admission-controller.js';
import { CodexRunner, type CodexRunResult } from '../src/server/codex-runner.js';
import { GitService } from '../src/server/git-service.js';
import { createPullWorkerHost, type PullTask } from '../src/server/pull-worker.js';
import { MacPullWorker, createAgentServiceMacExecutor } from '../src/server/mac-pull-worker.js';
import { observeTeamsCliTestCatalog, teamsCliTestSelection as selection } from './fixtures/teams-cli-agent-policy-fixture.js';

const scope = { tenantId: 'service-fixture-tenant', requesterId: 'service-fixture-owner', conversationId: 'service-fixture-conversation' };
const worker = { id: 'service-fixture-mac', ...scope };
const commit = 'e'.repeat(40);
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean, label: string) {
  const deadline = Date.now() + 3000;
  while (!predicate()) { if (Date.now() >= deadline) throw new Error(`fixture wait expired: ${label}`); await delay(10); }
}
function gate() { let resolve!: () => void, reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function task(jobId = 'service-fixture-job'): PullTask { return { jobId, scope, provider: 'codex', mode: 'read-only',
  prompt: 'Synthetic service lifecycle request', selection, sourceCommit: commit, createdAt: '2026-10-17T00:00:00.000Z' }; }
function job(jobId = 'service-fixture-job'): AgentJob { const t = task(jobId); return { id: jobId, ...scope,
  ...selection, provider: t.provider, mode: t.mode, prompt: t.prompt, createdAt: t.createdAt, status: 'queued', progress: [] }; }
const submission = (key = 'fixture-key') => ({ scope, provider: 'codex' as const, mode: 'read-only' as const,
  prompt: 'Synthetic service lifecycle request', ...selection, idempotencyKey: key,
  requestHash: crypto.createHash('sha256').update(key).digest('hex'), notify: false });

async function fixture(dispose: () => Promise<void> = async () => undefined) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'portable-real-service-'));
  const source = path.join(dir, 'source'); await fs.mkdir(path.join(source, 'src'), { recursive: true });
  await fs.writeFile(path.join(source, 'src/fixture.txt'), 'Synthetic fixture only.');
  let cleanupEntered = false, cleanupFinished = false, projection = '';
  class Isolation extends AgentIsolationProvider {
    constructor() { super('synthetic-service-no-native-spawn'); }
    async acquire(input: AgentIsolationAcquireInput) {
      projection = input.workspace;
      return this.issueLease({ ...input, spawn() { throw new Error('NO NATIVE SPAWN'); }, async dispose() {
        cleanupEntered = true; await dispose(); cleanupFinished = true;
      } });
    }
  }
  class Runner extends CodexRunner {
    starts = 0;
    private input?: Parameters<CodexRunner['run']>[0];
    private finishRun?: (value: CodexRunResult) => void;
    private rejectRun?: (reason: Error) => void;
    override run(input: Parameters<CodexRunner['run']>[0]): Promise<CodexRunResult> { this.input = input; this.starts++; return new Promise((resolve, reject) => { this.finishRun = resolve; this.rejectRun = reject; }); }
    async observeThread() { await this.input?.onEvent?.({ type: 'thread.started', thread_id: 'synthetic-native-id' }); }
    finish() { this.finishRun?.({ finalMessage: 'Synthetic service completed result', threadId: 'synthetic-native-id', eventCount: 1 }); }
    override cancel(): boolean { this.rejectRun?.(new Error('Synthetic cancellation')); return true; }
  }
  const runner = new Runner();
  const admission = new AgentAdmissionController({ globalLimit: 4, perTenantLimit: 2, perRequesterLimit: 1 }, { journalPath: path.join(dir, 'private/admission.json') });
  const store = new AgentJobStore(path.join(dir, 'private/jobs.json'));
  const allowed = (s: typeof scope) => s.tenantId === scope.tenantId && s.requesterId === scope.requesterId;
  const service = new AgentService(store, runner, source, async () => undefined, new GitService(source), {
    admissionController: admission, observeCodexModelCatalog: observeTeamsCliTestCatalog,
    executionPolicy: new AgentExecutionPolicy(source, { canReadScope: allowed, canMutateScope: allowed, isolationProvider: new Isolation() }),
  });
  await service.initialize();
  const host = await createPullWorkerHost({ file: path.join(dir, 'host/handoff.json'), workerId: worker.id, sourceCommit: commit });
  const transport = { claim: () => host.claim(worker), begin: (lease: Parameters<typeof host.begin>[1]) => host.begin(worker, lease),
    heartbeat: (lease: Parameters<typeof host.heartbeat>[1]) => host.heartbeat(worker, lease),
    finish: (lease: Parameters<typeof host.finish>[1], result: Parameters<typeof host.finish>[2]) => host.finish(worker, lease, result) };
  return { runner, admission, store, service, host, transport, get projection() { return projection; },
    get cleanupEntered() { return cleanupEntered; }, get cleanupFinished() { return cleanupFinished; },
    async close() { runner.cancel(); await service.close().catch(() => undefined); await host.close(); await fs.rm(dir, { recursive: true, force: true }); } };
}

test('actual AgentService explicit result waits for isolation, projection and admission cleanup', async () => {
  const cleanup = gate(); const f = await fixture(() => cleanup.promise);
  try {
    const current = await f.service.submit(submission()); await until(() => f.runner.starts === 1, 'runner'); f.runner.finish();
    await until(() => f.cleanupEntered, 'cleanup entered'); assert.equal(f.service.get(current.id, scope)?.status, 'completed');
    assert.equal(typeof f.service.waitForExecutionSettlement, 'function', 'explicit lifecycle result API required');
    let settled = false; const result = f.service.waitForExecutionSettlement(current.id, scope).then(value => { settled = true; return value; });
    await delay(50); assert.equal(settled, false); assert.equal(f.admission.snapshot().global, 1); assert.ok((await fs.stat(f.projection)).isDirectory());
    const timedOut = await f.service.waitForExecutionSettlement(current.id, scope, 5);
    assert.equal(timedOut.execution, 'unverified'); assert.equal(timedOut.cleanup, 'unverified');
    cleanup.resolve(); const receipt = await result;
    assert.equal(receipt.execution, 'settled'); assert.equal(receipt.cleanup, 'verified'); assert.equal(receipt.job.status, 'completed');
    assert.equal(f.admission.snapshot().global, 0); await assert.rejects(fs.stat(f.projection), { code: 'ENOENT' });
    await assert.rejects(f.service.waitForExecutionSettlement(current.id, { ...scope, requesterId: 'other' }));
  } finally { cleanup.resolve(); await f.close(); }
});

test('actual cleanup failure produces explicit unverified result, never verified success', async () => {
  const cleanup = gate(); const f = await fixture(() => cleanup.promise);
  try {
    const current = await f.service.submit(submission()); await until(() => f.runner.starts === 1, 'runner'); f.runner.finish();
    await until(() => f.cleanupEntered, 'cleanup');
    assert.equal(typeof f.service.waitForExecutionSettlement, 'function');
    const result = f.service.waitForExecutionSettlement(current.id, scope); cleanup.reject(new Error('fixture delayed disposal failure'));
    const receipt = await result; assert.equal(receipt.cleanup, 'unverified'); assert.equal(f.admission.requiresReconciliation(current.id), true);
    assert.equal(f.admission.snapshot().global, 1); await assert.rejects(fs.stat(f.projection), { code: 'ENOENT' });
  } finally { cleanup.reject(new Error('fixture teardown')); await f.close(); }
});

test('actual service replay resolves the same running job before user-limit-one admission', async () => {
  const f = await fixture();
  try {
    const first = await f.service.submit(submission()); await until(() => f.runner.starts === 1, 'runner');
    await f.runner.observeThread(); assert.equal(f.service.get(first.id, scope)?.threadId, 'synthetic-native-id');
    let replay: unknown; try { await f.service.submit(submission()); } catch (error) { replay = error; }
    assert.ok(replay instanceof AgentJobIdempotentReplayError, 'running replay must reach scoped idempotency before capacity');
    assert.equal(replay.job.id, first.id); assert.equal(f.runner.starts, 1); assert.equal(f.admission.snapshot().global, 1);
    await assert.rejects(f.service.submit({ ...submission(), requestHash: 'f'.repeat(64) }), /conflict/);
    await assert.rejects(f.service.submit({ ...submission(), prompt: 'forged same hash' }), /conflict/);
    await assert.rejects(f.service.submit({ ...submission(), scope: { ...scope, requesterId: 'other' } }));
    f.runner.finish(); await f.service.waitForExecutionSettlement(first.id, scope); assert.equal(f.admission.snapshot().global, 0);
  } finally { await f.close(); }
});

test('concurrent identical actual service submissions reserve one slot and start once', async () => {
  const f = await fixture();
  try {
    const values = await Promise.allSettled([f.service.submit(submission()), f.service.submit(submission())]);
    const created = values.find(x => x.status === 'fulfilled'); const replay = values.find(x => x.status === 'rejected');
    assert.ok(created?.status === 'fulfilled'); assert.ok(replay?.status === 'rejected' && replay.reason instanceof AgentJobIdempotentReplayError);
    await until(() => f.runner.starts === 1, 'single start'); assert.equal(f.admission.snapshot().global, 1);
    f.runner.finish(); await f.service.waitForExecutionSettlement(created.value.id, scope);
  } finally { await f.close(); }
});

test('completed records without local lifecycle proof remain unverified', async () => {
  const f = await fixture();
  try {
    const created = await f.store.create(submission());
    await f.store.update(created.id, scope, { status: 'completed', result: 'old stored result', threadId: 'old-id' });
    assert.equal(typeof f.service.waitForExecutionSettlement, 'function');
    const result = await f.service.waitForExecutionSettlement(created.id, scope);
    assert.equal(result.cleanup, 'unverified'); assert.equal(result.execution, 'unverified'); assert.equal(f.runner.starts, 0);
  } finally { await f.close(); }
});

test('actual cancellation result waits until resource cleanup has finished', async () => {
  const cleanup = gate(); const f = await fixture(() => cleanup.promise);
  try {
    const current = await f.service.submit(submission()); await until(() => f.runner.starts === 1, 'runner');
    let stopped = false; const stop = f.service.cancelStrict(current.id, scope).then(value => { stopped = true; return value; });
    await until(() => f.cleanupEntered, 'cancel cleanup'); await delay(30); assert.equal(stopped, false);
    cleanup.resolve(); assert.equal((await stop)?.status, 'cancelled');
    const receipt = await f.service.waitForExecutionSettlement(current.id, scope); assert.equal(receipt.cleanup, 'verified'); assert.equal(f.admission.snapshot().global, 0);
  } finally { cleanup.resolve(); await f.close(); }
});

test('Mac remote success waits for actual service cleanup', { skip: process.platform !== 'darwin' }, async () => {
  const cleanup = gate(); const f = await fixture(() => cleanup.promise);
  const connector = new MacPullWorker({ transport: f.transport, executor: createAgentServiceMacExecutor(f.service), principal: scope, sourceCommit: commit });
  try {
    await f.host.dispatcher.dispatch(job()); await connector.step(); await until(() => f.runner.starts === 1, 'runner'); f.runner.finish();
    await until(() => f.cleanupEntered, 'cleanup'); await delay(230);
    assert.equal(await connector.step(), 'running'); assert.equal((await f.host.dispatcher.observe(job()))?.status, 'running');
    cleanup.resolve(); await f.service.waitForExecutionSettlement(f.service.listLocalOnly()[0].id, scope); await delay(10);
    assert.equal(await connector.step(), 'settled'); assert.equal((await f.host.dispatcher.observe(job()))?.status, 'completed');
  } finally { cleanup.resolve(); await connector.close(); await f.close(); }
});

test('actual failed Mac cleanup cannot permanently publish remote completed', { skip: process.platform !== 'darwin' }, async () => {
  const cleanup = gate(); const f = await fixture(() => cleanup.promise);
  const connector = new MacPullWorker({ transport: f.transport, executor: createAgentServiceMacExecutor(f.service), principal: scope, sourceCommit: commit });
  try {
    await f.host.dispatcher.dispatch(job()); await connector.step(); await until(() => f.runner.starts === 1, 'runner'); f.runner.finish();
    await until(() => f.cleanupEntered, 'cleanup'); await delay(230); await connector.step();
    cleanup.reject(new Error('fixture failed disposal'));
    const receipt = await f.service.waitForExecutionSettlement(f.service.listLocalOnly()[0].id, scope);
    assert.equal(receipt.cleanup, 'unverified'); await delay(10);
    assert.equal(await connector.step(), 'blocked'); assert.notEqual((await f.host.dispatcher.observe(job()))?.status, 'completed');
  } finally { cleanup.reject(new Error('fixture teardown')); await connector.close(); await f.close(); }
});

test('Mac adapter replay reattaches to one real active AgentService execution', { skip: process.platform !== 'darwin' }, async () => {
  const f = await fixture();
  try {
    const first = await createAgentServiceMacExecutor(f.service).start(task()); await until(() => f.runner.starts === 1, 'runner');
    await f.runner.observeThread();
    const replay = await createAgentServiceMacExecutor(f.service).start(task()); assert.equal(f.runner.starts, 1); assert.equal(f.admission.snapshot().global, 1);
    f.runner.finish(); assert.deepEqual(await first.result, await replay.result); assert.equal(f.admission.snapshot().global, 0);
  } finally { await f.close(); }
});

test('empty/whitespace completed receipts never mutate durable handoff and valid retry succeeds', async () => {
  const f = await fixture();
  try {
    for (const [i, invalid] of ['', '  \n\t ', '\u00a0'].entries()) {
      const current = job(`blank-${i}`); await f.host.dispatcher.dispatch(current); const claim = (await f.host.claim(worker))!; await f.host.begin(worker, claim);
      await assert.rejects(f.host.finish(worker, claim, { status: 'completed', result: invalid, providerExecutionId: 'fixture-id' }));
      assert.equal((await f.host.dispatcher.observe(current))?.status, 'running');
      await f.host.finish(worker, claim, { status: 'completed', result: ' valid result ', providerExecutionId: 'fixture-id' });
      assert.equal((await f.host.dispatcher.observe(current))?.result, ' valid result ');
    }
  } finally { await f.close(); }
});
