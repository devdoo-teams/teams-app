import assert from 'node:assert/strict';

import { ApiAuthError } from '../src/client/auth.js';
import { createPtyOutputAccessGroup } from '../src/client/pty-output-access.js';
import { AgentExecutionPolicy } from '../src/server/agent-execution-policy.js';
import { ownNodePtyProcess, type ManagedAgentPtyProcess } from '../src/server/agent-pty-process.js';
import { createServerDerivedCoreScope } from '../src/server/core-orchestration-service.js';
import { createPtyOutputReadAccess } from '../src/server/pty-output-access.js';
import { PtyReadSessionRegistry } from '../src/server/pty-read-session.js';
import { deriveServerOwnedRestConversationId } from '../src/server/rest-scope.js';
import { createUserAuthMiddleware } from '../src/server/user-auth.js';
import { PtyOutputAccessError } from '../src/shared/pty-read.js';
import { createCodexPtyLeaseContext } from './fixtures/codex-pty-lease-context.js';
import { createPtyReadTestContext } from './fixtures/pty-read-test-context.js';
import { SyntheticPtyReadSource } from './fixtures/synthetic-pty-read-source.js';

// Actual middleware/Core/policy/provider/lease/redaction/reader code; synthetic
// token validation, executable trust, permission preflight and process events.
// This fixture has no HTTP listener, credentials or native/CLI process.
const jobs = await createPtyReadTestContext();
const subject = { ...jobs.scope, jobId: jobs.jobId };
const source = new SyntheticPtyReadSource();
const launches: string[] = [];
let cleanupCalls = 0;
const provider = await createCodexPtyLeaseContext(subject, {
  preflight() {},
  spawn(command) {
    launches.push(command);
    return ownNodePtyProcess(source, {
      available: true, platform: 'posix', requestTermination() {},
      async cleanup() { cleanupCalls++; source.exit(0); },
    });
  },
});
let lease: Awaited<ReturnType<typeof provider.provider.acquire>> | undefined;
let resource: ManagedAgentPtyProcess | undefined;
const registry = new PtyReadSessionRegistry({ jobs: jobs.jobs });
let allowed = true;
const policy = new AgentExecutionPolicy(provider.source, {
  canReadScope: scope => allowed && scope.tenantId === jobs.scope.tenantId && scope.requesterId === jobs.scope.requesterId,
  isolationProvider: provider.provider,
});
const access = createPtyOutputReadAccess({ jobs: jobs.jobs, policy, sessions: registry });
let claims: Record<string, unknown> | null = {
  tid: jobs.scope.tenantId, oid: jobs.scope.requesterId, aud: 'api://synthetic-pty-fixture', scp: 'access_as_user',
};
const auth = createUserAuthMiddleware({
  allowUnauthenticated: false, validator: { validateAccessToken: async () => claims },
  configuredTenantId: jobs.scope.tenantId, acceptedAudiences: ['api://synthetic-pty-fixture'], logger: { warn() {} },
});
async function principal() {
  const locals: Record<string, any> = {}; let status = 200; let accepted = false;
  const response = { locals, status(value: number) { status = value; return this; }, json() { return this; } };
  await auth({ headers: { authorization: 'Bearer synthetic-fixture-not-a-token' }, method: 'GET', originalUrl: '/fixture-only' } as any,
    response as any, () => { accepted = true; });
  if (!accepted || status !== 200) throw new ApiAuthError('auth-expired');
  const { tid: tenantId, requesterId } = locals.user;
  return createServerDerivedCoreScope({ tenantId, requesterId, conversationId: deriveServerOwnedRestConversationId({ tenantId, requesterId }) });
}
let checks = 0;
const check = async (name: string, run: () => void | Promise<void>) => { await run(); checks++; console.log(`PASS ${name}`); };
const groups: ReturnType<typeof createPtyOutputAccessGroup>[] = [];
try {
  lease = await provider.provider.acquire(provider.acquireInput);
  resource = await lease.spawnPty!(subject, provider.executable, provider.args(), {
    cwd: lease.workspace, env: { ...lease.environmentOverrides }, cols: 80, rows: 24,
  });
  const identity = registry.register(jobs.scope, jobs.jobId, resource.readProcess);
  source.emit('token=synthetic-private\n한글😀\n');
  await check('validated middleware principal reaches current Core owner and existing execution policy', async () => {
    const scope = await principal();
    assert.notEqual(scope.conversationId, jobs.scope.conversationId);
    assert.deepEqual(access.describe(scope, jobs.jobId), identity);
    assert.match(access.read(scope, identity, 0).frames.map(frame => frame.text).join(''), /token=\[REDACTED\]/);
  });
  await check('describe, duplicate reads, reconnect and display resize do not invoke the provider launch factory again', async () => {
    const initialLaunches = launches.length; assert.equal(initialLaunches, 1);
    const requests: number[] = [];
    const group = createPtyOutputAccessGroup({ getAccessGeneration: () => 0, onAccessDenied() {} }); groups.push(group);
    const reader = group.open({ identity: access.describe(await principal(), jobs.jobId), transport: { async read(id, after, signal) {
      signal.throwIfAborted(); requests.push(after); return access.read(await principal(), id, after);
    } } });
    const read = reader.read(); assert.equal(reader.read(), read); await read;
    const cursor = reader.getSnapshot().cursor;
    reader.resize({ columns: 40, rows: 12 }); reader.resize({ columns: 120, rows: 30 });
    assert.equal(requests.length, 1, 'display resize performs no read');
    reader.disconnect(); source.emit('continued\n'); await reader.read();
    assert.deepEqual(requests, [0, cursor]); assert.deepEqual(reader.getSnapshot().identity, identity);
    assert.equal(reader.getSnapshot().frames.filter(frame => frame.text === 'continued\n').length, 1);
    reader.dispose(); group.dispose();
    assert.equal(launches.length, initialLaunches, 'measured provider launch count is unchanged');
    assert.equal(provider.pipeLaunches(), 0); assert.equal(cleanupCalls, 0); assert.equal(source.kills, 0);
    assert.deepEqual(Object.keys(access).sort(), ['describe', 'read'], 'the injected access port exposes no mutation/start capability');
  });
  await check('the actual existing execution policy is re-evaluated after permission withdrawal', async () => {
    const scope = await principal(); allowed = false;
    assert.throws(() => access.describe(scope, jobs.jobId), (e: unknown) => e instanceof PtyOutputAccessError && e.code === 'access-denied');
    assert.throws(() => access.read(scope, identity, 0), /access-denied/);
    allowed = true; assert.deepEqual(access.describe(scope, jobs.jobId), identity);
    assert.equal(launches.length, 1);
  });
  await check('middleware denial clears all injected views without changing process ownership', async () => {
    let notices = 0;
    const group = createPtyOutputAccessGroup({ getAccessGeneration: () => 0, onAccessDenied() { notices++; } }); groups.push(group);
    const transport = { async read(id: typeof identity, after: number) { return access.read(await principal(), id, after); } };
    const first = group.open({ identity, transport }); const second = group.open({ identity, transport });
    await first.read(); await second.read(); assert.ok(first.getSnapshot().frames.length && second.getSnapshot().frames.length);
    claims = null; await first.read();
    assert.equal(first.getSnapshot().frames.length + second.getSnapshot().frames.length, 0); assert.equal(notices, 1);
    assert.equal(launches.length, 1); assert.equal(cleanupCalls, 0); assert.equal(source.kills, 0);
  });
  await check('wrong tenant, audience, delegated scope and app-only claims fail at the existing middleware', async () => {
    for (const invalid of [
      { tid: 'other', oid: jobs.scope.requesterId, aud: 'api://synthetic-pty-fixture', scp: 'access_as_user' },
      { tid: jobs.scope.tenantId, oid: jobs.scope.requesterId, aud: 'api://other', scp: 'access_as_user' },
      { tid: jobs.scope.tenantId, oid: jobs.scope.requesterId, aud: 'api://synthetic-pty-fixture', scp: 'User.Read' },
      { tid: jobs.scope.tenantId, oid: jobs.scope.requesterId, aud: 'api://synthetic-pty-fixture', roles: ['access_as_user'] },
    ]) { claims = invalid; await assert.rejects(principal, ApiAuthError); }
    assert.equal(launches.length, 1);
  });
  console.log(`PTY output access integration: ${checks} checks PASS; measured provider-factory launches=1 before/after observations, pipeFallback=0. Synthetic executable/auth/process; not native Codex/Teams proof.`);
} finally {
  for (const group of groups) group.dispose();
  await resource?.terminate(); await lease?.dispose();
  registry.dispose(); await provider.cleanup(); await jobs.cleanup();
}
