import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import express from 'express';
import type { A2AScope } from '../src/server/a2a-contract.js';
import { A2A_ROLE_CATALOG } from '../src/server/a2a-role-catalog.js';
import {
  createA2AProductionRuntime,
  type A2AProductionAgent,
} from '../src/server/a2a-production-runtime.js';
import { A2AStore, A2AStoreConflictError } from '../src/server/a2a-store.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-a2a-production-collaboration-'));
const scope: A2AScope = {
  tenantId: 'tenant-collaboration',
  requesterId: 'operator-collaboration',
  conversationId: 'conversation-collaboration',
};

const releaseCapabilities = roleCapabilities('release-auditor');
const reviewCapabilities = roleCapabilities('reviewer');
const started: string[] = [];
let active = 0;
let peak = 0;
let releaseBoth!: () => void;
const bothStarted = new Promise<void>((resolve) => { releaseBoth = resolve; });
const fallbackRelease = setTimeout(releaseBoth, 1_000);

function roleCapabilities(roleId: string): string[] {
  const role = A2A_ROLE_CATALOG.find((candidate) => candidate.id === roleId);
  assert.ok(role, `role ${roleId} must be in the Core catalog`);
  return [...role.capabilities];
}

function createAgent(
  agentId: string,
  role: 'release-auditor' | 'reviewer',
  capabilities: readonly string[],
): A2AProductionAgent {
  return {
    agentId,
    providerId: 'codex-cli',
    executionIdentity: `${agentId}-profile`,
    executionBoundaryId: `${agentId}-boundary`,
    roles: [role],
    capabilities,
    authorize: (input) => input.scope.requesterId === scope.requesterId && input.role === role,
    executeChild: async (input) => {
      active += 1;
      peak = Math.max(peak, active);
      started.push(input.agentId);
      if (started.length === 2) releaseBoth();
      await bothStarted;
      const taskId = `${input.agentId}-job`;
      await input.bindChild(taskId);
      active -= 1;
      return { taskId, status: 'completed', result: `${input.role} completed by ${input.agentId}` };
    },
  };
}

try {
  const storePath = path.join(root, 'a2a.json');
  const store = new A2AStore(storePath);
  await store.initialize();
  const runtime = createA2AProductionRuntime({
    publicOrigin: 'https://runtime.example.test',
    appVersion: '1.0.89',
    store,
    authenticate: (_request, _response, next) => next(),
    resolveScope: () => scope,
    v026Execution: { submit: () => undefined, cancel: ({ task }) => store.cancelTask(task.id, task.scope) },
    legacyOnTaskSubmitted: () => undefined,
    legacyOnTaskCancel: ({ task }) => store.cancelTask(task.id, task.scope),
    coreA2A: {
      agents: [
        createAgent('codex-release-auditor', 'release-auditor', releaseCapabilities),
        createAgent('codex-reviewer', 'reviewer', reviewCapabilities),
      ],
    },
  });

  const request = {
    scope,
    prompt: '독립된 release audit와 reviewer를 병렬로 실행하고 결과를 합쳐줘.',
    requestedRoles: ['reviewer', 'release-auditor'],
    idempotencyKey: 'production-collaboration-test',
    deadlineMs: 5_000,
    parallelism: 2,
  } as const;
  const result = await runtime.collaborate(request);
  clearTimeout(fallbackRelease);
  assert.equal(result.status, 'complete');
  assert.equal(result.summary?.completed, 2);
  assert.equal(peak, 2, 'independent registered agents must overlap when parallelism allows');
  assert.deepEqual([...new Set(started)].sort(), ['codex-release-auditor', 'codex-reviewer']);
  assert.deepEqual(
    result.plan.requests.map((child) => [child.role, child.executionIdentity, child.executionBoundaryId]),
    [
      ['release-auditor', 'codex-release-auditor-profile', 'codex-release-auditor-boundary'],
      ['reviewer', 'codex-reviewer-profile', 'codex-reviewer-boundary'],
    ],
  );
  assert.equal(result.parentTask?.status, 'completed');

  const persisted = store.getDispatchIntent(result.parentTask!.id, scope);
  assert.equal(persisted?.status, 'completed');
  assert.deepEqual(
    persisted?.children.map((child) => [child.agentId, child.executionIdentity, child.executionBoundaryId, child.status]).sort(),
    [
      ['codex-release-auditor', 'codex-release-auditor-profile', 'codex-release-auditor-boundary', 'completed'],
      ['codex-reviewer', 'codex-reviewer-profile', 'codex-reviewer-boundary', 'completed'],
    ],
  );

  const repeated = await runtime.collaborate(request);
  assert.equal(repeated.status, 'complete');
  assert.equal(repeated.parentTask?.id, result.parentTask?.id);
  assert.equal(started.length, 2, 'idempotent collaboration must not dispatch duplicate children');

  const app = express();
  runtime.mount(app);
  const server = await listen(app);
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const routeRequest = {
      prompt: request.prompt,
      requestedRoles: request.requestedRoles,
      idempotencyKey: request.idempotencyKey,
      deadlineMs: request.deadlineMs,
      parallelism: request.parallelism,
    };
    const response = await fetch(`http://127.0.0.1:${address.port}/a2a/collaborate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(routeRequest),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.status, 'complete');
    assert.equal(body.parentTask.id, result.parentTask?.id);
    assert.equal(body.summary.completed, 2);
    assert.equal(body.plan.requests.length, 2);
  } finally {
    await close(server);
  }

  await assert.rejects(
    () => runtime.collaborate({ ...request, prompt: 'different prompt' }),
    (error: unknown) => error instanceof A2AStoreConflictError,
  );

  const blocked = await runtime.collaborate({
    ...request,
    idempotencyKey: 'blocked-collaboration-test',
    requestedRoles: ['researcher'],
  });
  assert.equal(blocked.status, 'blocked', 'an unknown role must be rejected by the Core planner');
  assert.equal(blocked.plan.requests.length, 0);
  assert.equal(blocked.parentTask, undefined);

  console.log('a2a-production-collaboration-test: PASS');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

async function listen(app: express.Express): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
}

async function close(server: http.Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
