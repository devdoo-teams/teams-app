import assert from 'node:assert/strict';
import { spawn as spawnChild } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AzureAgentDispatchQueue } from '../src/server/azure-agent-dispatch-queue.js';
import {
  AzureCodexWorker,
  createProductionAzureCodexWorker,
  publishInstalledCodexModelCatalog,
  preflightLinuxCodexWorker,
  runAzureCodexWorkerLoop,
  type WorkerExecutionHandle,
  type WorkerExecutionResult,
} from '../src/worker/index.js';
import { fileURLToPath } from 'node:url';

import { CodexRunner } from '../src/server/codex-runner.js';
import { parseCodexModelCatalogPayload } from '../src/server/codex-model-catalog.js';
import type { AgentIsolationSpawnOptions } from '../src/server/agent-execution-policy.js';
import { createWorkerExecutor } from '../src/worker/executor.js';
import {
  applyAgentDispatchRecordMutation,
  type AgentDispatchRecord,
  type AgentDispatchStatePort,
  type AzureQueueClientPort,
} from '../src/server/azure-agent-dispatch-queue.js';
import type { AgentDispatchTaskReference } from '../src/server/queue/agent-dispatch-queue.js';

async function testWorkerCompletionDuplicateAndError(): Promise<void> {
  const fixture = createFixture();
  await fixture.queue.enqueue(task('task-success'));
  let executions = 0;
  const worker = new AzureCodexWorker(fixture.queue, {
    start: async () => {
      executions += 1;
      return handle(Promise.resolve({
        result: 'worker result',
        providerExecutionId: 'exec-success',
        tokenUsage: {
          source: 'codex.exec.jsonl.turn.completed.usage',
          inputTokens: 5,
          cachedInputTokens: 2,
          outputTokens: 3,
          reasoningOutputTokens: 1,
        },
      }));
    },
  }, { visibilityTimeoutSeconds: 30, heartbeatIntervalMs: 5 });
  assert.equal(await worker.runOnce(), 'completed');
  const completed = await fixture.queue.observe(reference(task('task-success')));
  assert.equal(completed?.receipt?.result, 'worker result');
  assert.equal(completed?.receipt?.tokenUsage?.inputTokens, 5, 'worker completion persists measured usage');

  fixture.client.inject(fixture.client.sent[0]);
  assert.equal(await worker.runOnce(), 'duplicate');
  assert.equal(executions, 1, 'duplicate Azure delivery must not execute twice');

  await fixture.queue.enqueue(task('task-failure'));
  const failing = new AzureCodexWorker(fixture.queue, {
    start: async () => handle(Promise.reject(Object.assign(new Error('runner failed'), { code: 'RUNNER_FAILED' }))),
  }, { visibilityTimeoutSeconds: 30, heartbeatIntervalMs: 5 });
  assert.equal(await failing.runOnce(), 'failed');
  assert.equal((await fixture.queue.observe(reference(task('task-failure'))))?.error?.code, 'RUNNER_FAILED');
}

async function testWorkerPersistsSafeToolObservations(): Promise<void> {
  const fixture = createFixture();
  const dispatched = task('task-tool-observation');
  await fixture.queue.enqueue(dispatched);
  const worker = new AzureCodexWorker(fixture.queue, {
    start: async (_task, context) => {
      await context.checkpoint('item.started', [{
        category: 'cli',
        name: 'git',
        observedAt: '2026-09-05T00:00:00.000Z',
      }]);
      return handle(Promise.resolve({ result: 'worker result', providerExecutionId: 'exec-tool' }));
    },
  }, { visibilityTimeoutSeconds: 30, heartbeatIntervalMs: 5 });

  assert.equal(await worker.runOnce(), 'completed');
  const completed = await fixture.queue.observe(reference(dispatched));
  assert.deepEqual(completed?.checkpoint?.tools, [{
    category: 'cli',
    name: 'git',
    observedAt: '2026-09-05T00:00:00.000Z',
  }], 'safe provider-reported tools survive the durable Azure worker boundary');
}

async function testCancellationCleansProcessTree(): Promise<void> {
  const fixture = createFixture();
  await fixture.queue.enqueue(task('task-cancel'));
  let terminated = 0;
  let cleaned = 0;
  let rejectExecution!: (error: Error) => void;
  const result = new Promise<never>((_resolve, reject) => { rejectExecution = reject; });
  const worker = new AzureCodexWorker(fixture.queue, {
    start: async (_task, context) => {
      setTimeout(async () => {
        await fixture.queue.requestCancellation(reference(task('task-cancel')), 'operator');
        await context.checkpoint('still-working');
      }, 2);
      return {
        result,
        terminateProcessTree: async () => { terminated += 1; rejectExecution(Object.assign(new Error('cancelled'), { code: 'CANCELLED' })); },
        cleanupProcessTree: async () => { cleaned += 1; },
      };
    },
  }, { visibilityTimeoutSeconds: 30, heartbeatIntervalMs: 5 });
  assert.equal(await worker.runOnce(), 'cancelled');
  assert.equal(terminated, 1);
  assert.equal(cleaned, 1);
  assert.equal((await fixture.queue.observe(reference(task('task-cancel'))))?.status, 'cancelled');
}

async function testLinuxPreflightAndCloudInit(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-azure-worker-'));
  try {
    const home = path.join(root, 'codex-home');
    const executable = path.join(root, 'codex');
    await fs.mkdir(home, { mode: 0o700 });
    await fs.writeFile(executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    const digest = crypto.createHash('sha256').update(await fs.readFile(executable)).digest('hex');
    await preflightLinuxCodexWorker({
      platform: 'linux',
      agentCodexHome: home,
      codexBin: executable,
      codexBinSha256: digest,
      managedIdentityClientId: '00000000-0000-4000-8000-000000000001',
    });
    await assert.rejects(preflightLinuxCodexWorker({
      platform: 'linux', agentCodexHome: home, codexBin: executable,
      codexBinSha256: '0'.repeat(64), managedIdentityClientId: '00000000-0000-4000-8000-000000000001',
    }), /sha-256/i);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
  const cloudInit = await fs.readFile(fileURLToPath(new URL('../infra/azure/cloud-init/codex-worker.yml', import.meta.url)), 'utf8');
  assert.match(cloudInit, /AZURE_CLIENT_ID/);
  assert.match(cloudInit, /AGENT_CODEX_HOME/);
  assert.match(cloudInit, /CODEX_BIN_SHA256/);
  assert.match(cloudInit, /auth material is provisioned out of band/i);
  assert.doesNotMatch(cloudInit, /(client_secret|account[_-]?key|bearer\s+|auth\.json\s*:)/i);
}

async function testProductionPreflightRunsBeforeExecutorAndFailsClosed(): Promise<void> {
  const fixture = createFixture();
  await fixture.queue.enqueue(task('task-preflight'));
  const order: string[] = [];
  const worker = new AzureCodexWorker(fixture.queue, {
    start: async () => {
      order.push('execute');
      return handle(Promise.resolve({ result: 'done', providerExecutionId: 'exec-preflight' }));
    },
  }, {
    preflight: async () => { order.push('preflight'); },
  });
  assert.equal(await worker.runOnce(), 'completed');
  assert.deepEqual(order, ['preflight', 'execute']);

  assert.throws(() => createProductionAzureCodexWorker({
    env: {},
    state: new MemoryState(),
    legacyMigration: { resolveExecution: async () => undefined },
    executor: { start: async () => handle(Promise.resolve({ result: 'x', providerExecutionId: 'y' })) },
    modelCatalog: { read: async () => undefined, publish: async (catalog) => catalog },
  }), /AZURE_STORAGE_QUEUE_ENDPOINT|production worker configuration/i);
}

async function testInstalledCatalogIsPublishedFromTheVerifiedWorkerBoundary(): Promise<void> {
  const catalog = parseCodexModelCatalogPayload({
    models: [{
      slug: 'gpt-5.6-sol',
      display_name: 'GPT-5.6-Sol',
      visibility: 'list',
      default_reasoning_level: 'high',
      supported_reasoning_levels: [{ effort: 'high' }],
    }],
  }, '2026-09-05T06:30:00.000Z');
  const published: unknown[] = [];
  const observed = await publishInstalledCodexModelCatalog({
    codexBin: '/opt/teamsapp/bin/codex',
    agentCodexHome: '/var/lib/teams-codex',
    modelCatalog: {
      read: async () => undefined,
      publish: async (value) => {
        published.push(value);
        return value;
      },
    },
    loadCatalog: async (options) => {
      assert.equal(options.executable, '/opt/teamsapp/bin/codex');
      assert.equal(options.codexHome, '/var/lib/teams-codex');
      return catalog;
    },
  });
  assert.deepEqual(observed, catalog);
  assert.deepEqual(published, [catalog], 'worker publication uses only its verified executable and private home');
}

async function testWorkerCompositionPreservesModeAndPrivateCodexHome(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-azure-worker-composition-'));
  const workspace = path.join(root, 'workspace');
  const agentCodexHome = path.join(root, 'codex-home');
  const executable = path.join(root, 'codex-fixture');
  const spawnCalls: Array<{ args: readonly string[]; options: AgentIsolationSpawnOptions }> = [];
  const previousCredential = process.env.UNRELATED_CREDENTIAL;
  try {
    await fs.mkdir(workspace, { mode: 0o700 });
    await fs.mkdir(agentCodexHome, { mode: 0o700 });
    await fs.writeFile(executable, [
      '#!/bin/sh',
      "printf '%s\\n' '{\"type\":\"thread.started\",\"thread_id\":\"11111111-1111-4111-8111-111111111111\"}'",
      "printf '%s\\n' '{\"type\":\"turn.started\"}'",
      "printf '%s\\n' '{\"type\":\"item.started\",\"item\":{\"type\":\"command_execution\",\"command\":\"/usr/bin/git status --token must-not-persist\"}}'",
      "printf '%s\\n' '{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"fixture result\"}}'",
      "printf '%s\\n' '{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":100,\"cached_input_tokens\":20,\"output_tokens\":30,\"reasoning_output_tokens\":10}}'",
    ].join('\n'), { mode: 0o700 });
    process.env.UNRELATED_CREDENTIAL = 'must-not-reach-child';
    const runner = new CodexRunner({
      command: { executable },
      spawn: (command, args, options) => {
        spawnCalls.push({ args: [...args], options: { ...options, env: { ...options.env } } });
        return spawnChild(command, [...args], options as never);
      },
    });
    const executor = createWorkerExecutor({
      env: {
        TEAMS_WORKER_WORKSPACE: workspace,
        AGENT_CODEX_HOME: agentCodexHome,
      },
      runner,
    });
    const checkpoints: Array<{ message: string; tools: unknown[] }> = [];
    const context = {
      signal: new AbortController().signal,
      checkpoint: async (message: string, tools: readonly unknown[] = []) => {
        checkpoints.push({ message, tools: structuredClone([...tools]) });
      },
    };
    const catalogRevision = 'a'.repeat(64);
    const selectedTask = {
      ...task('task-mode-write'),
      schemaVersion: 3 as const,
      modelSelection: {
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high' as const,
        catalogRevision,
      },
    };
    const writeHandle = await executor.start(selectedTask, context);
    const writeResult = await writeHandle.result;
    assert.equal(writeResult.result, 'fixture result');
    assert.deepEqual(
      (writeResult as unknown as { tokenUsage?: unknown }).tokenUsage,
      {
        source: 'codex.exec.jsonl.turn.completed.usage',
        inputTokens: 100,
        cachedInputTokens: 20,
        outputTokens: 30,
        reasoningOutputTokens: 10,
      },
      'measured Codex usage is returned to the durable completion boundary',
    );
    assert.equal(spawnCalls.length, 1);
    assert.ok(spawnCalls[0].args.includes('--sandbox'));
    assert.ok(spawnCalls[0].args.includes('workspace-write'));
    assert.deepEqual(
      spawnCalls[0].args.slice(spawnCalls[0].args.indexOf('--model'), spawnCalls[0].args.indexOf('--model') + 4),
      ['--model', 'gpt-5.6-sol', '--config', 'model_reasoning_effort="high"'],
      'the selected installed model and reasoning effort reach the final Codex argv boundary',
    );
    assert.equal(spawnCalls[0].options.env.CODEX_HOME, agentCodexHome);
    assert.equal(spawnCalls[0].options.env.UNRELATED_CREDENTIAL, undefined);
    assert.deepEqual(
      checkpoints.find((checkpoint) => checkpoint.tools.length > 0)?.tools,
      [{ category: 'cli', name: 'git', observedAt: checkpoints.find((checkpoint) => checkpoint.tools.length > 0)?.tools
        && (checkpoints.find((checkpoint) => checkpoint.tools.length > 0)?.tools[0] as { observedAt: string }).observedAt }],
      'the real worker executor projects the Codex command into an argument-free tool identifier',
    );
    assert.equal(JSON.stringify(checkpoints).includes('must-not-persist'), false);

    await assert.rejects(
      executor.start({
        ...task('task-mode-read'),
        execution: {
          mode: 'read-only',
          workspaceReference: 'teams-core-worker-workspace',
          isolationReference: 'linux-read-only-required',
        },
      }, context),
      /read-only.*isolation.*unavailable/i,
    );
    assert.equal(spawnCalls.length, 1, 'unsupported Linux read-only mode fails before any child spawn');
  } finally {
    if (previousCredential === undefined) delete process.env.UNRELATED_CREDENTIAL;
    else process.env.UNRELATED_CREDENTIAL = previousCredential;
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testUnsupportedReadOnlyPersistsExplicitFailureWithoutRunnerInvocation(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-azure-read-only-failure-'));
  try {
    const workspace = path.join(root, 'workspace');
    const agentCodexHome = path.join(root, 'codex-home');
    await fs.mkdir(workspace, { mode: 0o700 });
    await fs.mkdir(agentCodexHome, { mode: 0o700 });
    let runnerInvocations = 0;
    const executor = createWorkerExecutor({
      env: { TEAMS_WORKER_WORKSPACE: workspace, AGENT_CODEX_HOME: agentCodexHome },
      runner: {
        async run() {
          runnerInvocations += 1;
          throw new Error('read-only must never reach the runner');
        },
        cancel: () => false,
      },
    });
    const fixture = createFixture();
    const readOnlyTask = {
      ...task('task-read-only-unavailable'),
      execution: {
        mode: 'read-only' as const,
        workspaceReference: 'teams-core-worker-workspace' as const,
        isolationReference: 'linux-read-only-required' as const,
      },
    };
    await fixture.queue.enqueue(readOnlyTask);
    const worker = new AzureCodexWorker(fixture.queue, executor);
    assert.equal(await worker.runOnce(), 'failed');
    const failed = await fixture.queue.observe(reference(readOnlyTask));
    assert.equal(failed?.status, 'failed');
    assert.equal(failed?.error?.code, 'UNAVAILABLE');
    assert.match(failed?.error?.message ?? '', /read-only.*isolation.*unavailable/i);
    assert.equal(runnerInvocations, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testWorkerLoopPollsUntilAbort(): Promise<void> {
  let calls = 0;
  const abort = new AbortController();
  const worker = {
    runOnce: async () => {
      calls += 1;
      if (calls === 3) abort.abort();
      return 'idle' as const;
    },
  };
  await runAzureCodexWorkerLoop(worker, { signal: abort.signal, idleDelayMs: 1 });
  assert.equal(calls, 3);
}

function task(taskId: string) {
  return {
    schemaVersion: 2 as const,
    taskId,
    idempotencyKey: `idem:${taskId}`,
    tenantId: 'tenant',
    requesterId: 'user',
    conversationId: 'conversation',
    provider: 'codex',
    prompt: 'work',
    createdAt: new Date().toISOString(),
    execution: {
      mode: 'workspace-write' as const,
      workspaceReference: 'teams-core-worker-workspace' as const,
    },
  };
}
function handle(result: Promise<WorkerExecutionResult>): WorkerExecutionHandle {
  return { result, terminateProcessTree: async () => {}, cleanupProcessTree: async () => {} };
}
function reference(value: ReturnType<typeof task>): AgentDispatchTaskReference {
  return {
    taskId: value.taskId,
    tenantId: value.tenantId,
    requesterId: value.requesterId,
    conversationId: value.conversationId,
  };
}
function createFixture() {
  const client = new MemoryQueueClient();
  const state = new MemoryState();
  return { client, queue: new AzureAgentDispatchQueue(client, state) };
}
class MemoryState implements AgentDispatchStatePort {
  records = new Map<string, AgentDispatchRecord>();
  async create(record: AgentDispatchRecord) { const key = this.key(record.task); if (this.records.has(key)) return 'exists' as const; this.records.set(key, structuredClone(record)); return 'created' as const; }
  async get(taskReference: AgentDispatchTaskReference) { const value = this.records.get(this.key(taskReference)); return value && structuredClone(value); }
  async compareAndSwap(taskReference: AgentDispatchTaskReference, expected: { leaseOwner?: string; leaseGeneration: number }, mutate: (current: AgentDispatchRecord) => AgentDispatchRecord) { const key = this.key(taskReference); const current = this.records.get(key); if (!current) throw new Error('missing state'); if (current.leaseOwner !== expected.leaseOwner || current.leaseGeneration !== expected.leaseGeneration) return undefined; const next = applyAgentDispatchRecordMutation(current, mutate); this.records.set(key, structuredClone(next)); return structuredClone(next); }
  private key(taskReference: AgentDispatchTaskReference) { return JSON.stringify([taskReference.tenantId, taskReference.requesterId, taskReference.conversationId, taskReference.taskId]); }
}
class MemoryQueueClient implements AzureQueueClientPort {
  sent: string[] = []; messages: Array<{ id: string; text: string; receipt: string; count: number; visible: boolean }> = [];
  async sendMessage(text: string) { this.sent.push(text); const item = { id: `m-${this.messages.length}`, text, receipt: 'send', count: 0, visible: true }; this.messages.push(item); return { messageId: item.id }; }
  async receiveMessage() { const item = this.messages.find((x) => x.visible); if (!item) return undefined; item.visible = false; item.count++; item.receipt = `r-${item.count}`; return { messageId: item.id, popReceipt: item.receipt, messageText: item.text, dequeueCount: item.count }; }
  async updateMessage(id: string, receipt: string) { const item = this.required(id, receipt); item.receipt += '-u'; return { popReceipt: item.receipt }; }
  async deleteMessage(id: string, receipt: string) { const item = this.required(id, receipt); this.messages.splice(this.messages.indexOf(item), 1); }
  async sendPoisonMessage() {}
  inject(text: string) { this.messages.push({ id: `d-${this.messages.length}`, text, receipt: 'send', count: 0, visible: true }); }
  required(id: string, receipt: string) { const item = this.messages.find((x) => x.id === id && x.receipt === receipt); if (!item) throw new Error('bad receipt'); return item; }
}

await testWorkerCompletionDuplicateAndError();
await testWorkerPersistsSafeToolObservations();
await testCancellationCleansProcessTree();
await testLinuxPreflightAndCloudInit();
await testProductionPreflightRunsBeforeExecutorAndFailsClosed();
await testInstalledCatalogIsPublishedFromTheVerifiedWorkerBoundary();
await testWorkerCompositionPreservesModeAndPrivateCodexHome();
await testUnsupportedReadOnlyPersistsExplicitFailureWithoutRunnerInvocation();
await testWorkerLoopPollsUntilAbort();
console.log('azure-worker-contract-test: PASS');
