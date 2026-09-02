import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { AzureAgentDispatchQueue } from '../src/server/queue/azure-agent-dispatch-queue.js';
import {
  AzureCodexWorker,
  preflightLinuxCodexWorker,
  type WorkerExecutionHandle,
} from '../src/worker/index.js';
import { fileURLToPath } from 'node:url';

import type { AgentDispatchRecord, AgentDispatchStatePort, AzureQueueClientPort } from '../src/server/queue/azure-agent-dispatch-queue.js';

async function testWorkerCompletionDuplicateAndError(): Promise<void> {
  const fixture = createFixture();
  await fixture.queue.enqueue(task('task-success'));
  let executions = 0;
  const worker = new AzureCodexWorker(fixture.queue, {
    start: async () => {
      executions += 1;
      return handle(Promise.resolve({ result: 'worker result', providerExecutionId: 'exec-success' }));
    },
  }, { visibilityTimeoutSeconds: 30, heartbeatIntervalMs: 5 });
  assert.equal(await worker.runOnce(), 'completed');
  assert.equal((await fixture.queue.observe('task-success'))?.receipt?.result, 'worker result');

  fixture.client.inject(fixture.client.sent[0]);
  assert.equal(await worker.runOnce(), 'duplicate');
  assert.equal(executions, 1, 'duplicate Azure delivery must not execute twice');

  await fixture.queue.enqueue(task('task-failure'));
  const failing = new AzureCodexWorker(fixture.queue, {
    start: async () => handle(Promise.reject(Object.assign(new Error('runner failed'), { code: 'RUNNER_FAILED' }))),
  }, { visibilityTimeoutSeconds: 30, heartbeatIntervalMs: 5 });
  assert.equal(await failing.runOnce(), 'failed');
  assert.equal((await fixture.queue.observe('task-failure'))?.error?.code, 'RUNNER_FAILED');
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
        await fixture.queue.requestCancellation('task-cancel', 'operator');
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
  assert.equal((await fixture.queue.observe('task-cancel'))?.status, 'cancelled');
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

function task(taskId: string) {
  return { schemaVersion: 1 as const, taskId, idempotencyKey: `idem:${taskId}`, tenantId: 'tenant', requesterId: 'user', conversationId: 'conversation', provider: 'codex', prompt: 'work', createdAt: new Date().toISOString() };
}
function handle(result: Promise<{ result: string; providerExecutionId: string }>): WorkerExecutionHandle {
  return { result, terminateProcessTree: async () => {}, cleanupProcessTree: async () => {} };
}
function createFixture() {
  const client = new MemoryQueueClient();
  const state = new MemoryState();
  return { client, queue: new AzureAgentDispatchQueue(client, state) };
}
class MemoryState implements AgentDispatchStatePort {
  records = new Map<string, AgentDispatchRecord>();
  async create(record: AgentDispatchRecord) { if (this.records.has(record.taskId)) return 'exists' as const; this.records.set(record.taskId, structuredClone(record)); return 'created' as const; }
  async get(id: string) { const value = this.records.get(id); return value && structuredClone(value); }
  async update(taskId: string, mutate: (current: AgentDispatchRecord) => AgentDispatchRecord) { const current = this.records.get(taskId); if (!current) throw new Error('missing state'); const next = mutate(structuredClone(current)); this.records.set(taskId, structuredClone(next)); return structuredClone(next); }
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
await testCancellationCleansProcessTree();
await testLinuxPreflightAndCloudInit();
console.log('azure-worker-contract-test: PASS');
