import assert from 'node:assert/strict';

import {
  AzureAgentDispatchQueue,
  type AgentDispatchRecord,
  type AgentDispatchStatePort,
  type AzureQueueClientPort,
} from '../src/server/azure-agent-dispatch-queue.js';
import type { AgentDispatchTaskReference } from '../src/server/queue/agent-dispatch-queue.js';

const taskReference: AgentDispatchTaskReference = {
  taskId: 'task-health',
  tenantId: 'tenant-health',
  requesterId: 'requester-health',
  conversationId: 'conversation-health',
};

class ProbeState implements AgentDispatchStatePort {
  constructor(
    private readonly heartbeat?: { observedAt: string; source: string },
    private readonly dependencyError?: Error,
  ) {}
  async create(_record: AgentDispatchRecord) { return 'created' as const; }
  async get(_reference: AgentDispatchTaskReference) { return undefined; }
  async compareAndSwap() { return undefined; }
  async probeDependency() {
    if (this.dependencyError) throw this.dependencyError;
    return { reachable: true as const };
  }
  async readWorkerHeartbeat() { return this.heartbeat; }
}

let forbiddenQueueMetadataProbes = 0;
const client: AzureQueueClientPort = {
  async sendMessage() { return { messageId: 'message' }; },
  async receiveMessage() { return undefined; },
  async updateMessage() { return { popReceipt: 'receipt' }; },
  async deleteMessage() {},
  async sendPoisonMessage() {},
  async probeDependency() {
    forbiddenQueueMetadataProbes += 1;
    throw new Error('sender-only ACA identity cannot read Queue metadata');
  },
};

const queue = new AzureAgentDispatchQueue(client, new ProbeState(), {
  clock: { now: () => new Date('2026-09-03T00:00:00.000Z') },
});

const withoutHeartbeat = await queue.readHealth({ taskReference });
assert.equal(withoutHeartbeat.liveness.state, 'alive', 'health endpoint liveness is independent of dispatch readiness');
assert.equal(withoutHeartbeat.configuration.state, 'configured', 'constructed Azure queue mode reports configuration only');
assert.equal(withoutHeartbeat.dependencies.queue.state, 'unverified', 'configuration alone never claims Queue reachability');
assert.equal(withoutHeartbeat.dependencies.state.state, 'reachable', 'durable state dependency evidence is observed non-mutatingly');
assert.equal(withoutHeartbeat.workerHeartbeat.state, 'not-observed', 'configuration never fabricates a worker heartbeat');
assert.equal(withoutHeartbeat.readiness.state, 'unavailable', 'dependencies alone cannot claim external worker readiness');
assert.equal(withoutHeartbeat.executionBoundary, 'external-linux-worker-unverified');
assert.equal(forbiddenQueueMetadataProbes, 0, 'ACA health never calls Queue metadata APIs outside sender-only RBAC');

const queueWithHeartbeat = new AzureAgentDispatchQueue(client, new ProbeState({
  observedAt: '2026-09-02T23:59:45.000Z',
  source: 'durable-dispatch-lease-renewal',
}), {
  clock: { now: () => new Date('2026-09-03T00:00:00.000Z') },
});
const withHeartbeat = await queueWithHeartbeat.readHealth({
  taskReference,
  maximumHeartbeatAgeMs: 30_000,
});
assert.equal(withHeartbeat.workerHeartbeat.state, 'observed');
assert.equal(withHeartbeat.dependencies.queue.state, 'reachable', 'fresh durable lease renewal observes Queue write access');
assert.equal(withHeartbeat.dependencies.state.state, 'reachable', 'fresh heartbeat and read probe observe durable state');
assert.equal(withHeartbeat.readiness.state, 'ready');
assert.equal(withHeartbeat.executionBoundary, 'external-linux-worker');

const queueWithStaleHeartbeat = new AzureAgentDispatchQueue(client, new ProbeState({
  observedAt: '2026-09-02T23:00:00.000Z',
  source: 'durable-dispatch-lease-renewal',
}), {
  clock: { now: () => new Date('2026-09-03T00:00:00.000Z') },
});
const staleHeartbeat = await queueWithStaleHeartbeat.readHealth({
  taskReference,
  maximumHeartbeatAgeMs: 30_000,
});
assert.equal(staleHeartbeat.workerHeartbeat.state, 'stale');
assert.equal(staleHeartbeat.dependencies.queue.state, 'unverified', 'stale heartbeat is not current Queue evidence');
assert.equal(staleHeartbeat.readiness.state, 'unavailable');
assert.equal(staleHeartbeat.executionBoundary, 'external-linux-worker-unverified');

const queueWithUnavailableState = new AzureAgentDispatchQueue(client, new ProbeState({
  observedAt: '2026-09-02T23:59:45.000Z',
  source: 'durable-dispatch-lease-renewal',
}, new Error('Cosmos unavailable')), {
  clock: { now: () => new Date('2026-09-03T00:00:00.000Z') },
});
const unavailableState = await queueWithUnavailableState.readHealth({ taskReference, maximumHeartbeatAgeMs: 30_000 });
assert.equal(unavailableState.dependencies.state.state, 'unavailable');
assert.equal(unavailableState.readiness.state, 'unavailable', 'fresh historical heartbeat cannot mask current state failure');
assert.equal(forbiddenQueueMetadataProbes, 0, 'no health branch calls Queue metadata APIs');

console.log('azure-dispatch-health-test: PASS');
