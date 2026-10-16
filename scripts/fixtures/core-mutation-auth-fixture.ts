import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { AgentJobStore } from '../../src/server/agent-job-store.js';
import { CoreOrchestrationService, type CoreAgentServicePort } from '../../src/server/core-orchestration-service.js';
import { createCoreOrchestrationRouter } from '../../src/server/core-orchestration-route.js';
import { createUserAuthMiddleware } from '../../src/server/user-auth.js';
import { markTeamsHostReady, resetAuthStateForTest, setAuthRequired, setAuthTokenProviderForTest } from '../../src/client/auth.js';
import { observeTeamsCliTestCatalog } from './teams-cli-agent-policy-fixture.js';

export async function createCoreMutationAuthFixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-core-mutation-auth-'));
  const store = new AgentJobStore(path.join(directory, 'jobs.json')); await store.initialize();
  let creations = 0, token = 'synthetic-A1', signOut = false, stripScope = false;
  const scopes = new Map([
    ['synthetic-A1', { tenantId: 'synthetic-tenant', requesterId: 'A' }],
    ['synthetic-A2', { tenantId: 'synthetic-tenant', requesterId: 'A' }],
    ['synthetic-B', { tenantId: 'synthetic-tenant', requesterId: 'B' }],
    ['synthetic-other-tenant', { tenantId: 'other-synthetic-tenant', requesterId: 'A' }],
  ]);
  const agent: CoreAgentServicePort = {
    async submit(input) { creations++; return store.create({ ...input, provider: input.provider ?? 'codex' }); },
    get: (id, scope) => store.get(id, scope), list: (scope, limit) => store.list(scope, limit),
    continue: async () => undefined, cancelStrict: async () => undefined,
    approve: async () => undefined, retry: async () => undefined,
  };
  const service = new CoreOrchestrationService({ agentService: agent, jobStore: store, defaultProvider: 'codex',
    observeCodexModelCatalog: observeTeamsCliTestCatalog, observeProviderFacts: () => [{ provider: 'codex', availability: 'available',
      capabilities: ['submit'], observedAt: '2026-10-17T00:00:00.000Z', source: 'runtime-observation' }] });
  const app = express();
  app.use('/api/core-orchestration', createCoreOrchestrationRouter({ service,
    authenticate: createUserAuthMiddleware({ allowUnauthenticated: false, acceptedAudiences: ['api://synthetic-core'],
      validator: { async validateAccessToken(value) { const scope = scopes.get(value); return scope
        ? { aud: 'api://synthetic-core', scp: 'access_as_user', tid: scope.tenantId, oid: scope.requesterId } : null; } },
      logger: { warn() {} } }),
    resolveAuthenticatedScope: (_request, response) => {
      const user = response.locals.user;
      return user ? { tenantId: user.tid, requesterId: user.requesterId, conversationId: 'synthetic-core-personal' } : undefined;
    },
  }));
  const server = http.createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const originalFetch = globalThis.fetch;
  let next: { method: string; mode: 'hold' | 'loss' | 'invalid' | 'body' } | undefined;
  const held: Array<{ status: number; release(fail?: boolean): void }> = [];
  const requests: Array<{ method: string; path: string; key?: string; scope: string; redirect?: RequestRedirect }> = [];
  globalThis.fetch = async (input, init = {}) => {
    const parsed = new URL(String(input), 'https://synthetic.test');
    assert.ok(parsed.pathname.startsWith('/api/core-orchestration/'), 'fixture accepts only actual Core HTTP routes');
    const method = (init.method ?? 'GET').toUpperCase(); const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const credential = new Headers(init.headers).get('authorization')?.replace(/^Bearer /u, '') ?? '';
    requests.push({ method, path: parsed.pathname + parsed.search, key: body?.idempotencyKey, scope: scopes.get(credential)?.requesterId ?? 'unknown', redirect: init.redirect });
    let response = await originalFetch(`http://127.0.0.1:${port}${parsed.pathname}${parsed.search}`, init);
    if (stripScope) { const headers = new Headers(response.headers); headers.delete('X-Teams-Principal-Scope'); response = new Response(response.body, { status: response.status, headers }); }
    if (next?.method === method) {
      const mode = next.mode; next = undefined;
      if (mode === 'loss') { await response.arrayBuffer(); throw new TypeError('synthetic response lost after server receipt'); }
      if (mode === 'invalid') return new Response('{', { status: response.status, headers: response.headers });
      if (mode === 'body') {
        const value = await response.clone().json();
        response.json = () => new Promise((resolve, reject) => held.push({ status: response.status,
          release: fail => fail ? reject(new TypeError('synthetic response body lost')) : resolve(value) }));
      }
      if (mode === 'hold') return new Promise<Response>(resolve => held.push({ status: response.status, release: () => resolve(response) }));
    }
    return response;
  };
  resetAuthStateForTest(); markTeamsHostReady(); setAuthRequired(true);
  setAuthTokenProviderForTest(async () => { if (signOut) throw new Error('synthetic signed out'); return token; });
  return {
    store, held, requests, get creations() { return creations; },
    useToken(value: string) { assert.ok(scopes.has(value)); token = value; },
    signOut(value = true) { signOut = value; },
    stripScope(value = true) { stripScope = value; },
    nextResponse(method: string, mode: NonNullable<typeof next>['mode']) { next = { method, mode }; },
    async waitHeld() { const deadline = Date.now() + 2000; while (!held.length && Date.now() < deadline) await new Promise(r => setTimeout(r, 2)); assert.ok(held.length); },
    async close() { globalThis.fetch = originalFetch; resetAuthStateForTest(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(directory, { recursive: true, force: true }); },
  };
}
