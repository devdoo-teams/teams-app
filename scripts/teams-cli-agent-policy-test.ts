import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCodexExecArguments, CodexRunner } from '../src/server/codex-runner.js';
import { CliAgentRunner } from '../src/server/cli-agent-runner.js';
import { parseCodexModelCatalogPayload } from '../src/server/codex-model-catalog.js';
import { CoreOrchestrationService, createServerDerivedCoreScope } from '../src/server/core-orchestration-service.js';
import { AgentJobStore } from '../src/server/agent-job-store.js';
import { AgentService } from '../src/server/agent-service.js';
import { GitService } from '../src/server/git-service.js';
import { createWorkerExecutor } from '../src/worker/executor.js';
import { CoreOrchestrationValidationError } from '../src/shared/core-orchestration.js';
import { AGENT_DISPATCH_WORKSPACE_REFERENCE } from '../src/server/queue/agent-dispatch-queue.js';

// Catch missing final arguments and policy validation before any job, mutation or spawn.
const failures: string[] = [];
async function check(name: string, run: () => unknown | Promise<unknown>) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${String(error)}`); }
}
const catalog = parseCodexModelCatalogPayload([
  { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1-Sol', visibility: 'list', default_reasoning_level: 'low', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'xhigh' }] },
  { slug: 'gpt-6-luna', display_name: 'GPT-6-Luna', visibility: 'list', default_reasoning_level: 'medium', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }, { effort: 'xhigh' }, { effort: 'max' }] },
], '2026-10-09T09:00:00.000Z');
const argsInput = { prefixArgs: [], mode: 'workspace-write' as const, workspace: '/tmp/synthetic-teams-policy', enrichedPrompt: 'synthetic fixture only' };
await check('omitted selection emits the fixed model, effort and provider', () => {
  const args = buildCodexExecArguments(argsInput);
  assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 6), [
    '--model', 'gpt-6-luna', '--config', 'model_reasoning_effort="xhigh"', '--config', 'model_provider="openai"',
  ]);
});
for (const selection of [
  { model: 'gpt-6.1-sol', reasoningEffort: 'xhigh' as const, catalogRevision: catalog.revision },
  { model: 'gpt-6-luna', reasoningEffort: 'low' as const, catalogRevision: catalog.revision },
]) await check(`conflicting argv selection ${selection.model}/${selection.reasoningEffort} is refused`, () => {
  assert.throws(() => buildCodexExecArguments({ ...argsInput, selection }), /policy|고정|Luna|luna/i);
});
for (const prefixArgs of [['--model', 'gpt-6.1-sol'], ['-c', 'model="gpt-6.1-sol"'], ['--profile', 'different']]) {
  await check(`prefix override ${prefixArgs[0]} is refused`, () => assert.throws(() => buildCodexExecArguments({ ...argsInput, prefixArgs }), /policy|override|고정/i));
}
for (const environmentOverrides of [
  { CODEX_MODEL: 'gpt-6.1-sol' }, { CODEX_REASONING_EFFORT: 'low' }, { CODEX_MODEL_PROVIDER: 'different' },
  { CODEX_PROFILE: 'different-profile' }, { CODEX_CONFIG_OVERRIDES: 'model="gpt-6.1-sol"' }, { CODEX_SCRIPT: '/tmp/alternate-model-wrapper.js' },
]) await check(`per-run environment ${Object.keys(environmentOverrides)[0]} is refused before spawn`, async () => {
  let spawns = 0;
  const runner = new CodexRunner({ spawn: () => { spawns += 1; throw new Error('SPAWN_REACHED'); } });
  await assert.rejects(runner.run({ jobId: 'synthetic-env', prompt: 'synthetic', workspace: '/tmp', mode: 'workspace-write', environmentOverrides }), /policy|고정|override/i);
  assert.equal(spawns, 0);
});
await check('unverified Copilot policy never resolves or spawns a default model', async () => {
  let resolutions = 0;
  const runner = new CliAgentRunner({ resolveGhcpExecutable: async () => { resolutions += 1; return { state: 'missing', command: 'synthetic' }; } });
  await assert.rejects(runner.run({ provider: 'copilot', jobId: 'synthetic-copilot', prompt: 'synthetic', workspace: '/tmp', mode: 'workspace-write' }), /policy|고정|Luna|luna/i);
  assert.equal(resolutions, 0);
});

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-cli-policy-'));
const scope = createServerDerivedCoreScope({ tenantId: 'synthetic-tenant', requesterId: 'synthetic-owner', conversationId: 'synthetic-chat' });
const store = new AgentJobStore(path.join(root, 'jobs.json'));
await store.initialize();
let dispatches = 0;
const agents = new AgentService(store, undefined, root, async () => undefined, new GitService(root), {
  canReadScope: () => true, canMutateScope: () => true,
  observeCodexModelCatalog: async () => catalog,
  executionDispatcher: { kind: 'azure-queue', dispatch: async () => { dispatches += 1; }, observe: async () => undefined, cancel: async () => undefined },
} as ConstructorParameters<typeof AgentService>[5]);
await agents.initialize();
const core = new CoreOrchestrationService({ agentService: agents, jobStore: store, observeCodexModelCatalog: async () => catalog,
  observeProviderFacts: () => [{ provider: 'codex', availability: 'available', capabilities: ['submit', 'retry', 'approve'], observedAt: '2026-10-09T09:00:00.000Z', source: 'runtime-observation' }] });
try {
  await check('operational catalog exposes only fixed Luna/xhigh', async () => {
    const actual = await core.listCodexModelCatalog();
    assert.deepEqual(actual?.models, [{ id: 'gpt-6-luna', label: 'GPT-6-Luna', defaultReasoningEffort: 'xhigh', reasoningEfforts: ['xhigh'] }]);
  });
  await check('omitted Core and direct service selections are persisted as policy', async () => {
    const submitted = await core.submit(scope, { idempotencyKey: 'synthetic-core-policy', prompt: 'synthetic', mode: 'workspace-write' });
    try {
      assert.equal(submitted.job.model, 'gpt-6-luna'); assert.equal(submitted.job.reasoningEffort, 'xhigh');
      assert.equal(submitted.job.executionReceipt, undefined, 'selection is never manufactured as an observed receipt');
    } finally { await agents.cancel(submitted.job.id, scope); }
    const direct = await agents.submit({ scope, mode: 'workspace-write', prompt: 'synthetic direct' });
    try { assert.equal(direct.model, 'gpt-6-luna'); assert.equal(direct.reasoningEffort, 'xhigh'); }
    finally { await agents.cancel(direct.id, scope); }
  });
  await check('different supported model is rejected before persistence', async () => {
    const count = store.listLocalOnly(100).length;
    try {
      await assert.rejects(core.submit(scope, { idempotencyKey: 'synthetic-conflict', prompt: 'synthetic', mode: 'workspace-write', model: 'gpt-6.1-sol', reasoningEffort: 'xhigh', catalogRevision: catalog.revision }), /policy|고정|Luna|luna/i);
      assert.equal(store.listLocalOnly(100).length, count);
    } finally { for (const job of store.list(scope, 100)) if (job.status === 'awaiting_approval' || job.status === 'queued') await agents.cancel(job.id, scope); }
  });
  await check('Core Copilot submission is unavailable without a provider fallback', async () => {
    const count = store.listLocalOnly(100).length;
    await assert.rejects(core.submit(scope, { idempotencyKey: 'synthetic-core-copilot', prompt: 'synthetic', mode: 'workspace-write', provider: 'copilot' }), /policy|gpt-6-luna/i);
    assert.equal(store.listLocalOnly(100).length, count);
  });
  for (const raw of [undefined, parseCodexModelCatalogPayload([{ slug: 'gpt-6.1-sol', display_name: 'SOL', visibility: 'list', default_reasoning_level: 'xhigh', supported_reasoning_levels: [{ effort: 'xhigh' }] }], catalog.observedAt), parseCodexModelCatalogPayload([{ slug: 'gpt-6-luna', display_name: 'Luna', visibility: 'list', default_reasoning_level: 'medium', supported_reasoning_levels: [{ effort: 'medium' }] }], catalog.observedAt)]) {
    await check(`missing catalog/model/xhigh ${raw?.models[0]?.id ?? 'none'} fails closed`, async () => {
      const unavailable = new CoreOrchestrationService({ agentService: agents, jobStore: store, observeCodexModelCatalog: async () => raw, observeProviderFacts: () => core.listProviderFacts() });
      await assert.rejects(unavailable.submit(scope, { idempotencyKey: `synthetic-missing-${raw?.revision ?? 'none'}`, prompt: 'synthetic', mode: 'workspace-write' }), /catalog|policy|Luna|luna|xhigh|고정/i);
    });
  }
  for (const action of ['approve', 'retry', 'continue'] as const) {
    await check(`historical incompatible ${action} leaves the job unchanged`, async () => {
      const historicalStore = new AgentJobStore(path.join(root, `${action}-historical.json`)); await historicalStore.initialize();
      const historical = await historicalStore.create({ scope, mode: 'workspace-write', prompt: 'historical synthetic', provider: 'codex', model: 'gpt-6.1-sol', reasoningEffort: 'xhigh', catalogRevision: catalog.revision, threadId: '12345678-1234-4234-9234-123456789abc' });
      await historicalStore.update(historical.id, scope, { status: action === 'approve' ? 'awaiting_approval' : action === 'retry' ? 'failed' : 'completed', ...(action === 'continue' ? { result: 'historical synthetic result' } : {}) });
      const historicalAgents = new AgentService(historicalStore, undefined, root, async () => undefined, new GitService(root), {
        canReadScope: () => true, canMutateScope: () => true, observeCodexModelCatalog: async () => catalog,
        executionDispatcher: { kind: 'azure-queue', dispatch: async () => { dispatches += 1; }, observe: async () => undefined, cancel: async () => undefined },
      } as ConstructorParameters<typeof AgentService>[5]); await historicalAgents.initialize();
      const before = JSON.stringify(historicalStore.get(historical.id, scope)); const dispatchedBefore = dispatches;
      const historicalCore = new CoreOrchestrationService({ agentService: historicalAgents, jobStore: historicalStore,
        observeCodexModelCatalog: async () => catalog, observeProviderFacts: () => core.listProviderFacts() });
      try {
        await assert.rejects(action === 'continue' ? historicalAgents.continue(historical.id, 'synthetic follow-up', scope) : historicalAgents[action](historical.id, scope), /policy|고정|Luna|luna/i);
        await assert.rejects(action === 'continue'
          ? historicalCore.continue(scope, { jobId: historical.id, prompt: 'synthetic follow-up' })
          : historicalCore[action](scope, { jobId: historical.id }),
          error => error instanceof CoreOrchestrationValidationError && /Teams CLI policy/u.test(error.message),
          'Core history rejection must reach the stable validation response instead of generic 500');
        assert.equal(JSON.stringify(historicalStore.get(historical.id, scope)), before); assert.equal(dispatches, dispatchedBefore);
      } finally { await historicalAgents.close(); }
    });
  }
  await check('worker rejects a conflicting queue selection before invoking the runner', async () => {
    let runs = 0;
    const executor = createWorkerExecutor({ env: { TEAMS_WORKER_WORKSPACE: root, AGENT_CODEX_HOME: root }, observeCodexModelCatalog: async () => catalog,
      runner: { run: async () => { runs += 1; return { threadId: 'synthetic-worker', finalMessage: 'synthetic', eventCount: 0 }; }, cancel() {} } } as Parameters<typeof createWorkerExecutor>[0]);
    await assert.rejects(executor.start({ schemaVersion: 3, provider: 'codex', execution: { workspaceReference: AGENT_DISPATCH_WORKSPACE_REFERENCE, mode: 'workspace-write' }, modelSelection: { model: 'gpt-6.1-sol', reasoningEffort: 'xhigh', catalogRevision: catalog.revision } } as any, { signal: new AbortController().signal, checkpoint: async () => undefined } as any), /policy|고정|Luna|luna/i);
    assert.equal(runs, 0);
  });
  await check('worker omitted selection receives the fixed policy with unknown observed model', async () => {
    let model: string | undefined, effort: string | undefined;
    const executor = createWorkerExecutor({ env: { TEAMS_WORKER_WORKSPACE: root, AGENT_CODEX_HOME: root }, observeCodexModelCatalog: async () => catalog,
      runner: { run: async options => { model = options.selection?.model; effort = options.selection?.reasoningEffort; return { threadId: 'synthetic-worker', finalMessage: 'synthetic', eventCount: 0,
        executionReceipt: { source: 'worker-observation', observedAt: '2026-10-09T09:00:00.000Z', platform: 'linux' } }; }, cancel() {} } });
    const handle = await executor.start({ schemaVersion: 3, provider: 'codex', execution: { workspaceReference: AGENT_DISPATCH_WORKSPACE_REFERENCE, mode: 'workspace-write' } } as any,
      { signal: new AbortController().signal, checkpoint: async () => undefined } as any);
    const result = await handle.result;
    assert.equal(model, 'gpt-6-luna'); assert.equal(effort, 'xhigh');
    assert.equal(result.executionReceipt?.model, undefined); assert.equal(result.executionReceipt?.reasoningEffort, undefined);
  });
} finally { await agents.close(); await fs.rm(root, { recursive: true, force: true }); }
assert.deepEqual(failures, [], `Teams CLI policy failures: ${failures.join('; ')}`);
console.log('teams-cli-agent-policy-test: PASS');
