import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import express from 'express';

import {
  CORE_ORCHESTRATION_API_BASE_PATH as CLIENT_CORE_ORCHESTRATION_API_BASE_PATH,
} from '../src/client/core-orchestration-client.js';
import {
  CORE_ORCHESTRATION_API_BASE_PATH,
  mountCoreOrchestrationRoutes,
  type CoreOrchestrationRouteService,
} from '../src/server/core-orchestration-route.js';
import type { AgentJobScope } from '../src/server/agent-job-store.js';
import type { CoreOrchestrationJob } from '../src/shared/core-orchestration.js';

const root = path.resolve(import.meta.dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/server/index.ts'), 'utf8');

assert.equal(CORE_ORCHESTRATION_API_BASE_PATH, '/api/core-orchestration');
assert.equal(CLIENT_CORE_ORCHESTRATION_API_BASE_PATH, CORE_ORCHESTRATION_API_BASE_PATH);
assert.match(
  source,
  /mountCoreOrchestrationRoutes\(http,\s*\{/u,
  'production index must call the shared Express mount helper',
);
assert.doesNotMatch(
  source,
  /http\.use\(express\.json\(\)\)/u,
  'production index must not place an unguarded global JSON parser before Core authentication',
);
const parserGuard = source.indexOf('const globalJsonParser = express.json();');
const coreMount = source.indexOf('mountCoreOrchestrationRoutes(http,');
assert.ok(parserGuard >= 0 && parserGuard < coreMount, 'the Core parser guard must be installed before the Core route mount');
assert.match(
  source.slice(parserGuard, coreMount),
  /requestPath\.startsWith\('\/api\/core-orchestration\/'\)[\s\S]*?next\(\);/u,
  'Core requests must bypass the process-wide parser and reach router-local auth first',
);

const job: CoreOrchestrationJob = {
  id: 'mounted-job',
  prompt: 'verify mounted contract',
  provider: 'codex',
  mode: 'read-only',
  status: 'input_required',
  progress: [],
  createdAt: '2026-09-03T00:00:00.000Z',
};
let observedScope: AgentJobScope | undefined;
const service: CoreOrchestrationRouteService = {
  async submit() { throw new Error('not used'); },
  get() { return job; },
  list(scope) {
    observedScope = scope;
    return [job];
  },
  async cancel() { return job; },
  async approve() { return job; },
  async retry() { return job; },
  async provideInput() { return { status: 'accepted', job }; },
  listProviderFacts() {
    return [{
      provider: 'codex',
      availability: 'available',
      capabilities: ['submit', 'input'],
      observedAt: '2026-09-03T00:00:00.000Z',
      source: 'runtime-observation',
    }];
  },
};

const app = express();
mountCoreOrchestrationRoutes(app, {
  service,
  authenticate(request, response, next) {
    response.locals.user = { tid: 'tenant-server', requesterId: 'requester-server' };
    next();
  },
  resolveAuthenticatedScope(_request, response) {
    const user = response.locals.user as { tid?: string; requesterId?: string };
    return user.tid && user.requesterId
      ? { tenantId: user.tid, requesterId: user.requesterId, conversationId: 'server-owned-rest-scope' }
      : undefined;
  },
});

const server = http.createServer(app);
await new Promise<void>((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
assert(address && typeof address === 'object');
const origin = `http://127.0.0.1:${address.port}${CORE_ORCHESTRATION_API_BASE_PATH}`;

try {
  const listed = await fetch(`${origin}/jobs?tenantId=attacker`);
  assert.equal(listed.status, 400, 'client-controlled scope fields remain invalid');

  const validList = await fetch(`${origin}/jobs`);
  assert.equal(validList.status, 200, 'the canonical production mount resolves through Express');
  const listBody = await validList.json() as { jobs: CoreOrchestrationJob[]; providers: Array<{ provider: string }> };
  assert.equal(listBody.jobs[0]?.id, job.id);
  assert.equal(listBody.providers[0]?.provider, 'codex');
  assert.deepEqual(observedScope && {
    tenantId: observedScope.tenantId,
    requesterId: observedScope.requesterId,
    conversationId: observedScope.conversationId,
  }, {
    tenantId: 'tenant-server',
    requesterId: 'requester-server',
    conversationId: 'server-owned-rest-scope',
  }, 'scope comes only from authenticated server state');

  const input = await fetch(`${origin}/jobs/${job.id}/input`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: 'continue' }),
  });
  assert.equal(input.status, 200);
  assert.deepEqual(await input.json(), { status: 'accepted', job });
  console.log('core-orchestration-index-mount-test: PASS');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
