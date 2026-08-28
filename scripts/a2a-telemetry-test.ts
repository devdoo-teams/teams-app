import assert from 'node:assert/strict';

import {
  A2A_TELEMETRY_LIMITS,
  A2ATelemetryCollector,
  type A2ATelemetryEventInput,
} from '../src/server/a2a-telemetry.js';

const BASE_TIME = 1_700_000_000_000;

function event(overrides: Partial<A2ATelemetryEventInput> = {}): A2ATelemetryEventInput {
  return {
    kind: 'task',
    phase: 'started',
    taskId: 'task-1',
    dispatchId: 'dispatch-1',
    providerId: 'codex-cli',
    latencyMs: 12,
    result: 'accepted',
    correlationId: 'correlation-1',
    ...overrides,
  };
}

function fixedClock(): () => number {
  return () => BASE_TIME;
}

function testRecordsTaskAndDispatchLifecycle(): void {
  const collector = new A2ATelemetryCollector({ now: fixedClock() });

  collector.record(event({ phase: 'accepted', result: 'accepted', latencyMs: 0 }));
  collector.record(event({
    kind: 'dispatch',
    phase: 'completed',
    result: 'success',
    providerId: 'ghcp-cli',
    latencyMs: 240,
    correlationId: 'correlation-2',
  }));

  const snapshot = collector.snapshot();
  assert.equal(snapshot.schemaVersion, 'a2a-core-telemetry.v1');
  assert.equal(snapshot.totalEvents, 2);
  assert.equal(snapshot.retainedEvents, 2);
  assert.equal(snapshot.droppedEvents, 0);
  assert.deepEqual(snapshot.events[0], {
    sequence: 1,
    timestampMs: BASE_TIME,
    kind: 'task',
    phase: 'accepted',
    taskId: 'task-1',
    dispatchId: 'dispatch-1',
    providerId: 'codex-cli',
    latencyMs: 0,
    result: 'accepted',
    correlationId: 'correlation-1',
  });
  assert.deepEqual(snapshot.metrics.byKind, [
    { kind: 'dispatch', count: 1 },
    { kind: 'task', count: 1 },
  ]);
  assert.deepEqual(snapshot.metrics.byResult, [
    { result: 'accepted', count: 1 },
    { result: 'success', count: 1 },
  ]);
  assert.deepEqual(snapshot.metrics.providers, [
    { providerId: 'codex-cli', count: 1, latencySamples: 1, totalLatencyMs: 0, maxLatencyMs: 0 },
    { providerId: 'ghcp-cli', count: 1, latencySamples: 1, totalLatencyMs: 240, maxLatencyMs: 240 },
  ]);
  assert.equal('prompt' in snapshot, false);
  assert.equal('artifacts' in snapshot, false);
}

function testRingBufferOverflowDropsOldestEvent(): void {
  const collector = new A2ATelemetryCollector({ now: fixedClock(), maxEvents: 2 });
  collector.record(event({ taskId: 'task-oldest', correlationId: 'correlation-oldest' }));
  collector.record(event({ taskId: 'task-middle', correlationId: 'correlation-middle' }));
  collector.record(event({ taskId: 'task-newest', correlationId: 'correlation-newest' }));

  const snapshot = collector.snapshot();
  assert.equal(snapshot.totalEvents, 3);
  assert.equal(snapshot.retainedEvents, 2);
  assert.equal(snapshot.droppedEvents, 1);
  assert.deepEqual(snapshot.events.map((entry) => entry.taskId), ['task-middle', 'task-newest']);
}

function testCredentialShapedMetadataIsRedactedBeforeStorage(): void {
  const secret = 'Bearer observability-secret-123456 client_secret=another-secret';
  const collector = new A2ATelemetryCollector({ now: fixedClock() });
  const recorded = collector.record(event({
    providerId: secret,
    correlationId: 'https://example.test/callback?access_token=access-secret-123456',
  }));

  const exported = collector.export();
  assert.equal(exported.includes(secret), false);
  assert.equal(exported.includes('observability-secret-123456'), false);
  assert.equal(exported.includes('another-secret'), false);
  assert.equal(exported.includes('access-secret-123456'), false);
  assert.match(recorded.providerId ?? '', /^redacted-[a-f0-9]{16}$/);
  assert.match(recorded.correlationId, /^redacted-[a-f0-9]{16}$/);
}

function testPromptAndArtifactFieldsAreRejected(): void {
  const collector = new A2ATelemetryCollector({ now: fixedClock() });
  const unsafe = {
    ...event(),
    prompt: 'do not retain this prompt',
    artifacts: [{ text: 'do not retain this artifact' }],
  } as unknown as A2ATelemetryEventInput;

  assert.throws(() => collector.record(unsafe), /unsupported field/i);
  assert.equal(collector.snapshot().totalEvents, 0);
}

function testExportIsBoundedAndDeterministic(): void {
  const options = { now: fixedClock(), maxExportBytes: 512 } as const;
  const first = new A2ATelemetryCollector(options);
  const second = new A2ATelemetryCollector(options);
  for (let index = 0; index < 12; index += 1) {
    const input = event({
      taskId: `task-${index}`,
      correlationId: `correlation-${index}`,
      phase: index % 2 === 0 ? 'completed' : 'failed',
      result: index % 2 === 0 ? 'success' : 'failure',
      latencyMs: index * 10,
    });
    first.record(input);
    second.record(input);
  }

  const firstExport = first.export();
  const secondExport = second.export();
  assert.equal(firstExport, secondExport);
  assert.ok(Buffer.byteLength(firstExport, 'utf8') <= 512);
  const parsed = JSON.parse(firstExport) as { omittedEvents: number; events: Array<{ taskId: string }> };
  assert.ok(parsed.omittedEvents > 0, 'export must report events omitted by the byte bound');
  assert.equal(parsed.events.at(-1)?.taskId, 'task-11');
  assert.equal(A2A_TELEMETRY_LIMITS.maxExportBytes >= 512, true);
}

testRecordsTaskAndDispatchLifecycle();
testRingBufferOverflowDropsOldestEvent();
testCredentialShapedMetadataIsRedactedBeforeStorage();
testPromptAndArtifactFieldsAreRejected();
testExportIsBoundedAndDeterministic();

console.log('a2a-telemetry-test: PASS');
