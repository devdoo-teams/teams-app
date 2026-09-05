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
    private readonly heartbeatError?: Error,
  ) {}
  async create(_record: AgentDispatchRecord) { return 'created' as const; }
  async get(_reference: AgentDispatchTaskReference) { return undefined; }
  async compareAndSwap() { return undefined; }
  async probeDependency() {
    if (this.dependencyError) throw this.dependencyError;
    return { reachable: true as const };
  }
  async readWorkerHeartbeat() {
    if (this.heartbeatError) throw this.heartbeatError;
    return this.heartbeat;
  }
}

let queueMetadataProbes = 0;
const client: AzureQueueClientPort = {
  async sendMessage() { return { messageId: 'message' }; },
  async receiveMessage() { return undefined; },
  async updateMessage() { return { popReceipt: 'receipt' }; },
  async deleteMessage() {},
  async sendPoisonMessage() {},
  async probeDependency() {
    queueMetadataProbes += 1;
    return { reachable: true as const };
  },
};

const queue = new AzureAgentDispatchQueue(client, new ProbeState(), {
  clock: { now: () => new Date('2026-09-03T00:00:00.000Z') },
});

const emptySubmission = await queue.readHealth();
assert.equal(emptySubmission.dependencies.queue.state, 'reachable', 'empty queue metadata is observed without sending a probe message');
assert.equal(emptySubmission.dependencies.state.state, 'reachable', 'empty durable state is directly readable without a task reference');
assert.equal(emptySubmission.submissionReadiness.state, 'ready', 'empty durable state does not block the first safe enqueue');
assert.equal(emptySubmission.workerHeartbeat.state, 'not-observed', 'submission readiness does not fabricate worker liveness');
assert.equal(emptySubmission.readiness.state, 'unavailable', 'execution readiness remains unavailable without worker evidence');
assert.equal(queueMetadataProbes, 1, 'submission readiness calls the non-mutating Queue metadata probe');

const withoutHeartbeat = await queue.readHealth({ taskReference });
assert.equal(withoutHeartbeat.liveness.state, 'alive', 'health endpoint liveness is independent of dispatch readiness');
assert.equal(withoutHeartbeat.configuration.state, 'configured', 'constructed Azure queue mode reports configuration only');
assert.equal(withoutHeartbeat.dependencies.queue.state, 'reachable', 'Queue reachability comes from the direct metadata probe');
assert.equal(withoutHeartbeat.dependencies.state.state, 'reachable', 'durable state dependency evidence is observed non-mutatingly');
assert.equal(withoutHeartbeat.workerHeartbeat.state, 'not-observed', 'configuration never fabricates a worker heartbeat');
assert.equal(withoutHeartbeat.readiness.state, 'unavailable', 'dependencies alone cannot claim external worker readiness');
assert.equal(withoutHeartbeat.submissionReadiness.state, 'ready', 'reachable submission dependencies can accept queue work');
assert.equal(withoutHeartbeat.executionBoundary, 'external-linux-worker-unverified');

const unverifiedSubmission = new AzureAgentDispatchQueue({
  async sendMessage() { return { messageId: 'message' }; },
  async receiveMessage() { return undefined; },
  async updateMessage() { return { popReceipt: 'receipt' }; },
  async deleteMessage() {},
  async sendPoisonMessage() {},
}, {
  async create() { return 'created' as const; },
  async get() { return undefined; },
  async compareAndSwap() { return undefined; },
}, {
  clock: { now: () => new Date('2026-09-03T00:00:00.000Z') },
});
const unverified = await unverifiedSubmission.readHealth();
assert.equal(unverified.dependencies.queue.state, 'unverified');
assert.equal(unverified.dependencies.state.state, 'unverified');
assert.equal(unverified.submissionReadiness.state, 'unavailable', 'configuration and method presence alone never authorize submission');
assert.equal(unverified.readiness.state, 'unavailable');

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
assert.equal(withHeartbeat.dependencies.queue.state, 'reachable', 'Queue reachability remains a direct metadata observation');
assert.equal(withHeartbeat.dependencies.state.state, 'reachable', 'fresh heartbeat and read probe observe durable state');
assert.equal(withHeartbeat.readiness.state, 'ready');
assert.equal(withHeartbeat.submissionReadiness.state, 'ready');
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
assert.equal(staleHeartbeat.dependencies.queue.state, 'reachable', 'Queue dependency evidence is independent of worker heartbeat age');
assert.equal(staleHeartbeat.readiness.state, 'unavailable');
assert.equal(staleHeartbeat.submissionReadiness.state, 'ready', 'idle worker liveness does not block safe enqueue');
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
assert.equal(unavailableState.submissionReadiness.state, 'unavailable');

const heartbeatReadFailure = new AzureAgentDispatchQueue(client, new ProbeState(
  undefined,
  undefined,
  new Error('worker heartbeat read unavailable'),
), {
  clock: { now: () => new Date('2026-09-03T00:00:00.000Z') },
});
const heartbeatFailure = await heartbeatReadFailure.readHealth({ taskReference });
assert.equal(heartbeatFailure.dependencies.state.state, 'reachable');
assert.equal(heartbeatFailure.submissionReadiness.state, 'ready', 'worker-liveness observation failure does not rewrite measured submission readiness');
assert.equal(heartbeatFailure.workerHeartbeat.state, 'not-observed');
assert.equal(heartbeatFailure.readiness.state, 'unavailable', 'failed worker observation remains fail-closed for execution liveness');

const unavailableQueue = new AzureAgentDispatchQueue({
  ...client,
  async probeDependency() { throw new Error('Queue metadata unavailable'); },
}, new ProbeState(), {
  clock: { now: () => new Date('2026-09-03T00:00:00.000Z') },
});
const queueFailure = await unavailableQueue.readHealth();
assert.equal(queueFailure.dependencies.queue.state, 'unavailable');
assert.equal(queueFailure.dependencies.state.state, 'reachable');
assert.equal(queueFailure.submissionReadiness.state, 'unavailable', 'unreachable Queue Storage fails submission readiness closed');
assert.equal(queueFailure.readiness.state, 'unavailable');

console.log('azure-dispatch-health-test: PASS');
