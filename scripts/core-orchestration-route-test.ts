import assert from 'node:assert/strict';
import http from 'node:http';

import express from 'express';

import { AgentProviderUnavailableError } from '../src/server/agent-service.js';
import {
  createCoreOrchestrationRouter,
  type CoreOrchestrationRouteService,
} from '../src/server/core-orchestration-route.js';
import type { ServerDerivedCoreScope } from '../src/server/core-orchestration-service.js';
import {
  CoreOrchestrationIdempotencyConflictError,
  CoreOrchestrationValidationError,
  type CoreOrchestrationJob,
} from '../src/shared/core-orchestration.js';

type Snapshot = Readonly<{ status: number; body: string; headers: http.IncomingHttpHeaders }>;

const now = '2026-09-03T00:00:00.000Z';
const jobs = new Map<string, CoreOrchestrationJob>();
const idempotency = new Map<string, { hash: string; job: CoreOrchestrationJob }>();
let nextId = 1;

function scopeKey(scope: ServerDerivedCoreScope): string {
  return `${scope.tenantId}/${scope.requesterId}/${scope.conversationId}`;
}

function requestHash(request: { prompt: string; provider?: string; mode: string }): string {
  return JSON.stringify([request.prompt, request.provider ?? '', request.mode]);
}

function jobKey(scope: ServerDerivedCoreScope, id: string): string {
  return `${scopeKey(scope)}/${id}`;
}

const service: CoreOrchestrationRouteService = {
  async submit(scope, request) {
    if (request.prompt === 'provider unavailable') throw new AgentProviderUnavailableError('codex');
    if (request.prompt === 'internal secret') throw new Error('secret=must-not-leak');
    const hash = requestHash(request);
    const replayKey = `${scopeKey(scope)}/${request.idempotencyKey}`;
    const prior = idempotency.get(replayKey);
    if (prior) {
      if (prior.hash !== hash) throw new CoreOrchestrationIdempotencyConflictError(request.idempotencyKey);
      return { job: prior.job, replayed: true, requestHash: hash };
    }
    const job: CoreOrchestrationJob = {
      id: `job-${nextId++}`,
      idempotencyKey: request.idempotencyKey,
      prompt: request.prompt,
      provider: request.provider,
      mode: request.mode,
      status: request.mode === 'workspace-write' ? 'awaiting_approval' : 'queued',
      progress: [],
      createdAt: now,
    };
    jobs.set(jobKey(scope, job.id), job);
    idempotency.set(replayKey, { hash, job });
    return { job, replayed: false, requestHash: hash };
  },
  get(scope, request) {
    return jobs.get(jobKey(scope, request.jobId));
  },
  list(scope, request = {}) {
    return [...jobs.entries()]
      .filter(([key]) => key.startsWith(`${scopeKey(scope)}/`))
      .map(([, job]) => job)
      .slice(0, request.limit ?? 20);
  },
  async cancel(scope, request) {
    return update(scope, request.jobId, { status: 'cancelled', finishedAt: now });
  },
  async approve(scope, request) {
    return update(scope, request.jobId, { status: 'queued' });
  },
  async retry(scope, request) {
    const prior = jobs.get(jobKey(scope, request.jobId));
    if (!prior) return undefined;
    const retried = { ...prior, id: `job-${nextId++}`, parentJobId: prior.id, status: 'queued' as const };
    jobs.set(jobKey(scope, retried.id), retried);
    return retried;
  },
  async provideInput(scope, request) {
    const job = jobs.get(jobKey(scope, request.jobId));
    return job ? { status: 'unsupported', job, reason: 'agent-service-does-not-support-input' } : undefined;
  },
  listProviderFacts() {
    return [{
      provider: 'codex',
      availability: 'unknown',
      capabilities: ['submit'],
      observedAt: now,
      source: 'runtime-probe',
    }];
  },
};

function update(
  scope: ServerDerivedCoreScope,
  id: string,
  changes: Partial<CoreOrchestrationJob>,
): CoreOrchestrationJob | undefined {
  const key = jobKey(scope, id);
  const prior = jobs.get(key);
  if (!prior) return undefined;
  const updated = { ...prior, ...changes };
  jobs.set(key, updated);
  return updated;
}

const app = express();
app.use('/api/core-orchestration', createCoreOrchestrationRouter({
  service,
  authenticate(request, response, next) {
    if (request.header('x-test-auth') !== 'yes') {
      response.status(401).json({ error: { code: 'AUTH_REQUIRED', retryable: false } });
      return;
    }
    next();
  },
  resolveAuthenticatedScope(request) {
    if (request.header('x-test-auth') !== 'yes') return undefined;
    return {
      tenantId: 'tenant-a',
      requesterId: request.header('x-test-requester') === 'other' ? 'requester-b' : 'requester-a',
      conversationId: 'conversation-a',
    };
  },
}));

const server = http.createServer(app);
await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
assert(address && typeof address === 'object');
const baseUrl = `http://127.0.0.1:${address.port}/api/core-orchestration`;
const auth = { 'x-test-auth': 'yes' };

try {
  const unauthorizedMalformed = await requestRaw('POST', '/jobs', '{bad-json');
  assert.equal(unauthorizedMalformed.status, 401, 'authentication runs before JSON parsing');

  const submitted = await request('POST', '/jobs', {
    idempotencyKey: 'route-submit-1',
    prompt: 'inspect repository',
    provider: 'codex',
    mode: 'read-only',
  }, auth);
  assert.equal(submitted.status, 201);
  assert.equal(submitted.headers['cache-control'], 'no-store');
  const first = JSON.parse(submitted.body) as { job: CoreOrchestrationJob; replayed: boolean };
  assert.equal(first.replayed, false);

  const replayed = await request('POST', '/jobs', {
    idempotencyKey: 'route-submit-1',
    prompt: 'inspect repository',
    provider: 'codex',
    mode: 'read-only',
  }, auth);
  assert.equal(replayed.status, 200);
  assert.equal(JSON.parse(replayed.body).job.id, first.job.id);
  assert.equal(JSON.parse(replayed.body).replayed, true);

  const conflict = await request('POST', '/jobs', {
    idempotencyKey: 'route-submit-1',
    prompt: 'different request',
    provider: 'codex',
    mode: 'read-only',
  }, auth);
  assert.equal(conflict.status, 409);
  assert.equal(JSON.parse(conflict.body).error.code, 'CORE_ORCHESTRATION_IDEMPOTENCY_CONFLICT');

  for (const invalid of [
    null,
    [],
    {},
    { idempotencyKey: 'x', prompt: 'p', mode: 'read-only', extra: true },
    { idempotencyKey: 'x', prompt: 'p', mode: 'read-only', tenantId: 'attacker' },
    { idempotencyKey: 'x', prompt: 'p', mode: 'execute' },
  ]) {
    const result = await request('POST', '/jobs', invalid, auth);
    assert.equal(result.status, 400, `strict submit schema rejects ${JSON.stringify(invalid)}`);
  }

  const listed = await request('GET', '/jobs?limit=10', undefined, auth);
  assert.equal(listed.status, 200);
  assert.equal(JSON.parse(listed.body).jobs[0].id, first.job.id);
  assert.equal((await request('GET', '/jobs?limit=0', undefined, auth)).status, 400);
  assert.equal((await request('GET', '/jobs?limit=2&scope=attacker', undefined, auth)).status, 400);

  const fetched = await request('GET', `/jobs/${first.job.id}`, undefined, auth);
  assert.equal(fetched.status, 200);
  assert.equal(JSON.parse(fetched.body).job.id, first.job.id);
  assert.equal((await request('GET', `/jobs/${first.job.id}`, undefined, { ...auth, 'x-test-requester': 'other' })).status, 404);

  const write = await request('POST', '/jobs', {
    idempotencyKey: 'route-write-1', prompt: 'approved change', mode: 'workspace-write',
  }, auth);
  const writeId = JSON.parse(write.body).job.id as string;
  assert.equal((await request('POST', `/jobs/${writeId}/approve`, {}, auth)).status, 200);
  assert.equal((await request('POST', `/jobs/${writeId}/cancel`, {}, auth)).status, 200);
  const retried = await request('POST', `/jobs/${writeId}/retry`, {}, auth);
  assert.equal(retried.status, 200);
  assert.equal(JSON.parse(retried.body).job.parentJobId, writeId);
  assert.equal((await request('POST', `/jobs/${writeId}/approve`, { extra: true }, auth)).status, 400);
  assert.equal((await request('POST', '/jobs/missing/cancel', {}, auth)).status, 404);

  const input = await request('POST', `/jobs/${first.job.id}/input`, { input: { answer: 'yes' } }, auth);
  assert.equal(input.status, 501);
  assert.equal(JSON.parse(input.body).result.status, 'unsupported');
  assert.equal((await request('POST', `/jobs/${first.job.id}/input`, { input: 'x', scope: {} }, auth)).status, 400);

  const providers = await request('GET', '/providers', undefined, auth);
  assert.equal(providers.status, 200);
  assert.deepEqual(JSON.parse(providers.body).providers[0], {
    provider: 'codex', availability: 'unknown', capabilities: ['submit'], observedAt: now, source: 'runtime-probe',
  });

  const unavailable = await request('POST', '/jobs', {
    idempotencyKey: 'route-unavailable', prompt: 'provider unavailable', mode: 'read-only',
  }, auth);
  assert.equal(unavailable.status, 503);
  assert.equal(JSON.parse(unavailable.body).error.code, 'AGENT_PROVIDER_UNAVAILABLE');

  const invalidJson = await requestRaw('POST', '/jobs', '{bad-json', auth);
  assert.equal(invalidJson.status, 400);
  assert.equal(invalidJson.body.includes('bad-json'), false);

  const internal = await request('POST', '/jobs', {
    idempotencyKey: 'route-internal', prompt: 'internal secret', mode: 'read-only',
  }, auth);
  assert.equal(internal.status, 500);
  assert.equal(internal.body.includes('must-not-leak'), false);

  console.log('core-orchestration-route-test: PASS');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function request(
  method: string,
  route: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Snapshot> {
  return requestRaw(method, route, body === undefined ? undefined : JSON.stringify(body), {
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    ...headers,
  });
}

async function requestRaw(
  method: string,
  route: string,
  body?: string,
  headers: Record<string, string> = {},
): Promise<Snapshot> {
  const url = new URL(`${baseUrl}${route}`);
  return new Promise((resolve, reject) => {
    const outgoing = http.request(url, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-length': Buffer.byteLength(body) }),
        ...headers,
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString('utf8'),
        headers: response.headers,
      }));
    });
    outgoing.setTimeout(5_000, () => outgoing.destroy(new Error('request timeout')));
    outgoing.on('error', reject);
    if (body !== undefined) outgoing.write(body);
    outgoing.end();
  });
}
