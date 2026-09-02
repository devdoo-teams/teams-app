import assert from 'node:assert/strict';

import {
  AzureAgentDispatchQueue,
  type AgentDispatchRecord,
  type AgentDispatchStatePort,
  type AzureQueueClientPort,
} from '../src/server/azure-agent-dispatch-queue.js';

class ProbeState implements AgentDispatchStatePort {
  async create(_record: AgentDispatchRecord) { return 'created' as const; }
  async get(_taskId: string) { return undefined; }
  async compareAndSwap() { return undefined; }
  async probeDependency() { return { reachable: true as const }; }
}

const client: AzureQueueClientPort = {
  async sendMessage() { return { messageId: 'message' }; },
  async receiveMessage() { return undefined; },
  async updateMessage() { return { popReceipt: 'receipt' }; },
  async deleteMessage() {},
  async sendPoisonMessage() {},
  async probeDependency() { return { reachable: true as const }; },
};

const queue = new AzureAgentDispatchQueue(client, new ProbeState(), {
  clock: { now: () => new Date('2026-09-03T00:00:00.000Z') },
});

const withoutHeartbeat = await queue.readHealth();
assert.equal(withoutHeartbeat.liveness.state, 'alive', 'health endpoint liveness is independent of dispatch readiness');
assert.equal(withoutHeartbeat.configuration.state, 'configured', 'constructed Azure queue mode reports configuration only');
assert.equal(withoutHeartbeat.dependencies.queue.state, 'reachable', 'queue dependency evidence is observed non-mutatingly');
assert.equal(withoutHeartbeat.dependencies.state.state, 'reachable', 'durable state dependency evidence is observed non-mutatingly');
assert.equal(withoutHeartbeat.workerHeartbeat.state, 'not-observed', 'configuration never fabricates a worker heartbeat');
assert.equal(withoutHeartbeat.readiness.state, 'unavailable', 'dependencies alone cannot claim external worker readiness');
assert.equal(withoutHeartbeat.executionBoundary, 'external-linux-worker-unverified');

const withHeartbeat = await queue.readHealth({
  workerHeartbeat: { observedAt: '2026-09-02T23:59:45.000Z', source: 'durable-worker-heartbeat' },
  maximumHeartbeatAgeMs: 30_000,
});
assert.equal(withHeartbeat.workerHeartbeat.state, 'observed');
assert.equal(withHeartbeat.readiness.state, 'ready');
assert.equal(withHeartbeat.executionBoundary, 'external-linux-worker');

const staleHeartbeat = await queue.readHealth({
  workerHeartbeat: { observedAt: '2026-09-02T23:00:00.000Z', source: 'durable-worker-heartbeat' },
  maximumHeartbeatAgeMs: 30_000,
});
assert.equal(staleHeartbeat.workerHeartbeat.state, 'stale');
assert.equal(staleHeartbeat.readiness.state, 'unavailable');
assert.equal(staleHeartbeat.executionBoundary, 'external-linux-worker-unverified');

console.log('azure-dispatch-health-test: PASS');
