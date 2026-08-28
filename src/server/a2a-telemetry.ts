import crypto from 'node:crypto';

import { redactSensitiveText } from './sensitive-text.js';

export const A2A_TELEMETRY_LIMITS = Object.freeze({
  maxEvents: 1_024,
  maxExportBytes: 64 * 1024,
  maxIdLength: 200,
  maxLabelLength: 200,
  maxLatencyMs: 86_400_000,
});

const EVENT_KINDS = ['task', 'dispatch'] as const;
const EVENT_PHASES = ['started', 'accepted', 'completed', 'failed', 'canceled'] as const;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const ALLOWED_KEYS = new Set([
  'kind',
  'phase',
  'taskId',
  'dispatchId',
  'providerId',
  'latencyMs',
  'result',
  'correlationId',
]);

export type A2ATelemetryEventInput = Readonly<{
  kind: typeof EVENT_KINDS[number];
  phase: typeof EVENT_PHASES[number];
  taskId?: string;
  dispatchId?: string;
  providerId?: string;
  latencyMs?: number;
  result: string;
  correlationId: string;
}>;

export type A2ATelemetryEvent = Readonly<A2ATelemetryEventInput & {
  sequence: number;
  timestampMs: number;
}>;

export type A2ATelemetrySnapshot = Readonly<{
  schemaVersion: 'a2a-core-telemetry.v1';
  totalEvents: number;
  retainedEvents: number;
  droppedEvents: number;
  events: readonly A2ATelemetryEvent[];
  metrics: Readonly<{
    byKind: readonly Readonly<{ kind: string; count: number }>[];
    byResult: readonly Readonly<{ result: string; count: number }>[];
    providers: readonly Readonly<{
      providerId: string;
      count: number;
      latencySamples: number;
      totalLatencyMs: number;
      maxLatencyMs: number;
    }>[];
  }>;
}>;

type TelemetryOptions = Readonly<{
  now?: () => number;
  maxEvents?: number;
  maxExportBytes?: number;
}>;

const SCHEMA_VERSION = 'a2a-core-telemetry.v1' as const;

function boundedLabel(value: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > A2A_TELEMETRY_LIMITS.maxLabelLength) {
    throw new TypeError(`A2A telemetry ${field} is outside the allowed bounds.`);
  }
  const redacted = redactSensitiveText(value);
  if (redacted !== value || !SAFE_ID.test(value)) {
    return `redacted-${crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16)}`;
  }
  return value;
}

function boundedOptionalId(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0 || value.length > A2A_TELEMETRY_LIMITS.maxIdLength || !SAFE_ID.test(value)) {
    throw new TypeError(`A2A telemetry ${field} is outside the allowed bounds.`);
  }
  return value;
}

function validateInput(value: A2ATelemetryEventInput): void {
  if (!value || typeof value !== 'object') throw new TypeError('A2A telemetry event must be an object.');
  const keys = Object.keys(value);
  if (keys.some((key) => !ALLOWED_KEYS.has(key))) {
    throw new TypeError('A2A telemetry event contains an unsupported field.');
  }
  if (!EVENT_KINDS.includes(value.kind) || !EVENT_PHASES.includes(value.phase)) {
    throw new TypeError('A2A telemetry event kind or phase is invalid.');
  }
  if (typeof value.result !== 'string' || value.result.length === 0 || value.result.length > A2A_TELEMETRY_LIMITS.maxLabelLength) {
    throw new TypeError('A2A telemetry result is outside the allowed bounds.');
  }
  if (typeof value.correlationId !== 'string' || value.correlationId.length === 0) {
    throw new TypeError('A2A telemetry correlationId is required.');
  }
  if (value.latencyMs !== undefined && (!Number.isSafeInteger(value.latencyMs) || value.latencyMs < 0 || value.latencyMs > A2A_TELEMETRY_LIMITS.maxLatencyMs)) {
    throw new TypeError('A2A telemetry latencyMs is outside the allowed bounds.');
  }
}

function freezeEvent(input: A2ATelemetryEvent): A2ATelemetryEvent {
  return Object.freeze({ ...input });
}

export class A2ATelemetryCollector {
  private readonly now: () => number;
  private readonly maxEvents: number;
  private readonly maxExportBytes: number;
  private readonly events: A2ATelemetryEvent[] = [];
  private totalEvents = 0;
  private droppedEvents = 0;

  constructor(options: TelemetryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxEvents = Math.min(Math.max(options.maxEvents ?? A2A_TELEMETRY_LIMITS.maxEvents, 1), A2A_TELEMETRY_LIMITS.maxEvents);
    this.maxExportBytes = Math.min(Math.max(options.maxExportBytes ?? A2A_TELEMETRY_LIMITS.maxExportBytes, 256), A2A_TELEMETRY_LIMITS.maxExportBytes);
  }

  record(input: A2ATelemetryEventInput): A2ATelemetryEvent {
    validateInput(input);
    const now = this.now();
    const event = freezeEvent({
      sequence: ++this.totalEvents,
      timestampMs: Number.isFinite(now) ? Math.max(0, Math.trunc(now)) : 0,
      kind: input.kind,
      phase: input.phase,
      ...(boundedOptionalId(input.taskId, 'taskId') ? { taskId: input.taskId } : {}),
      ...(boundedOptionalId(input.dispatchId, 'dispatchId') ? { dispatchId: input.dispatchId } : {}),
      ...(input.providerId === undefined ? {} : { providerId: boundedLabel(input.providerId, 'providerId') }),
      ...(input.latencyMs === undefined ? {} : { latencyMs: input.latencyMs }),
      result: boundedLabel(input.result, 'result'),
      correlationId: boundedLabel(input.correlationId, 'correlationId'),
    });
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
      this.droppedEvents += 1;
    }
    return event;
  }

  snapshot(): A2ATelemetrySnapshot {
    const byKind = new Map<string, number>();
    const byResult = new Map<string, number>();
    const providers = new Map<string, { count: number; latencySamples: number; totalLatencyMs: number; maxLatencyMs: number }>();
    for (const entry of this.events) {
      byKind.set(entry.kind, (byKind.get(entry.kind) ?? 0) + 1);
      byResult.set(entry.result, (byResult.get(entry.result) ?? 0) + 1);
      if (entry.providerId) {
        const current = providers.get(entry.providerId) ?? { count: 0, latencySamples: 0, totalLatencyMs: 0, maxLatencyMs: 0 };
        current.count += 1;
        if (entry.latencyMs !== undefined) {
          current.latencySamples += 1;
          current.totalLatencyMs += entry.latencyMs;
          current.maxLatencyMs = Math.max(current.maxLatencyMs, entry.latencyMs);
        }
        providers.set(entry.providerId, current);
      }
    }
    return Object.freeze({
      schemaVersion: SCHEMA_VERSION,
      totalEvents: this.totalEvents,
      retainedEvents: this.events.length,
      droppedEvents: this.droppedEvents,
      events: Object.freeze([...this.events]),
      metrics: Object.freeze({
        byKind: Object.freeze([...byKind.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([kind, count]) => ({ kind, count }))),
        byResult: Object.freeze([...byResult.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([result, count]) => ({ result, count }))),
        providers: Object.freeze([...providers.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([providerId, stats]) => ({ providerId, ...stats }))),
      }),
    });
  }

  export(): string {
    const snapshot = this.snapshot();
    let start = 0;
    while (start < snapshot.events.length) {
      const payload = {
        schemaVersion: snapshot.schemaVersion,
        totalEvents: snapshot.totalEvents,
        retainedEvents: snapshot.retainedEvents,
        droppedEvents: snapshot.droppedEvents,
        omittedEvents: snapshot.droppedEvents + start,
        events: snapshot.events.slice(start),
        metrics: snapshot.metrics,
      };
      const serialized = JSON.stringify(payload);
      if (Buffer.byteLength(serialized, 'utf8') <= this.maxExportBytes) return serialized;
      start += 1;
    }
    const newest = snapshot.events.at(-1);
    return JSON.stringify({
      schemaVersion: snapshot.schemaVersion,
      omittedEvents: Math.max(0, snapshot.totalEvents - (newest ? 1 : 0)),
      events: newest ? [newest] : [],
    });
  }
}
