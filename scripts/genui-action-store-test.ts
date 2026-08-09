import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { GenUiActionStore } from '../src/server/genui-action-store.js';
import { GenUiResponseFactory } from '../src/server/genui-response.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-genui-actions-'));
const dataFile = path.join(directory, 'actions.json');

try {
  const store = new GenUiActionStore(dataFile, 100);
  await store.initialize();
  const grant = {
    action: 'approve' as const,
    entityId: 'task-test-1',
    correlationId: 'correlation-1',
    conversationId: 'conversation-1',
    requesterId: 'user-1',
    tenantId: 'tenant-1',
  };
  const token = await store.issue(grant);
  assert.ok(token.length >= 32);
  assert.deepEqual(await store.consume({ ...grant, requesterId: 'other-user', token }), { ok: false, reason: 'mismatch' });
  assert.equal((await store.consume({ ...grant, token })).ok, true);
  assert.deepEqual(await store.consume({ ...grant, token }), { ok: false, reason: 'consumed' });

  const restarted = new GenUiActionStore(dataFile, 100);
  await restarted.initialize();
  assert.deepEqual(await restarted.consume({ ...grant, token }), { ok: false, reason: 'consumed' });

  const expiring = new GenUiActionStore(path.join(directory, 'expiring.json'), 5);
  await expiring.initialize();
  const expiringGrant = { ...grant, entityId: 'task-expiring' };
  const expiringToken = await expiring.issue(expiringGrant);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(await expiring.consume({ ...expiringGrant, token: expiringToken }), { ok: false, reason: 'expired' });

  const tenantScoped = new GenUiActionStore(path.join(directory, 'tenant-scoped.json'), 1000);
  await tenantScoped.initialize();
  const tenantGrant = { ...grant, entityId: 'task-tenant-scoped' };
  const tenantToken = await tenantScoped.issue(tenantGrant);
  assert.deepEqual(
    await tenantScoped.consume({ ...tenantGrant, tenantId: 'other-tenant', token: tenantToken }),
    { ok: false, reason: 'mismatch' },
  );
  assert.equal((await tenantScoped.consume({ ...tenantGrant, token: tenantToken })).ok, true);

  const legacyFile = path.join(directory, 'legacy.json');
  await fs.writeFile(legacyFile, `${JSON.stringify([{
    tokenHash: 'legacy-token-hash',
    action: 'approve',
    entityId: 'legacy-task',
    correlationId: 'legacy-correlation',
    conversationId: 'conversation-1',
    requesterId: 'user-1',
    expiresAt: new Date(Date.now() + 10_000).toISOString(),
  }])}\n`, 'utf8');
  const legacy = new GenUiActionStore(legacyFile, 1000);
  await legacy.initialize();
  assert.deepEqual(JSON.parse(await fs.readFile(legacyFile, 'utf8')), []);
  assert.deepEqual(
    await legacy.consume({
      token: 'legacy-token',
      action: 'approve',
      entityId: 'legacy-task',
      correlationId: 'legacy-correlation',
      conversationId: 'conversation-1',
      requesterId: 'user-1',
      tenantId: 'tenant-1',
    }),
    { ok: false, reason: 'invalid' },
  );

  const malformedFile = path.join(directory, 'malformed.json');
  await fs.writeFile(malformedFile, JSON.stringify([{ tokenHash: 'not-enough-fields', tenantId: 'tenant-1' }]), 'utf8');
  await assert.rejects(() => new GenUiActionStore(malformedFile).initialize(), /Invalid GenUI action store format/);

  const responseFactory = new GenUiResponseFactory(store);
  const invalidScopeCard = await responseFactory.approval({
    id: 'legacy-job',
    prompt: 'legacy',
    mode: 'workspace-write',
    status: 'awaiting_approval',
    conversationId: 'conversation-1',
    requesterId: 'user-1',
    progress: [],
    createdAt: new Date().toISOString(),
  });
  assert.equal(invalidScopeCard.kind, 'error');
  assert.equal(invalidScopeCard.id, 'approval-scope-invalid');
  assert.equal(invalidScopeCard.actions.length, 0, 'invalid scope must issue zero grants');

  const personalTabUrl = 'https://teams.microsoft.com/l/entity/9b20fd94-2ac9-4423-ac1f-ff528ab245c1/home?webUrl=https%3A%2F%2Fexample.com%2Ftabs%2Fhome&label=%EC%97%85%EB%AC%B4%20%ED%97%88%EB%B8%8C';
  const configuredFactory = new GenUiResponseFactory(store, { openTabUrl: personalTabUrl });
  const helpCard = configuredFactory.help();
  assert.equal(helpCard.actions.length, 7);
  assert.equal(helpCard.actions.at(-1)?.action, 'open-tab');
  assert.deepEqual(
    helpCard.actions.slice(0, -1).map((action) => action.action),
    ['command', 'command', 'command', 'command', 'command', 'command'],
    'help card exposes the six safe default commands',
  );
  assert.deepEqual(
    helpCard.actions.slice(0, -1).map((action) => action.entityId),
    ['help', 'weather', 'status', 'list', 'work', 'collaboration'],
  );
  assert.equal(helpCard.actions.at(-1)?.entityId, 'home');
  assert.equal(helpCard.metadata.openTabUrl, personalTabUrl);

  const jobStatusCard = configuredFactory.jobStatus({
    id: 'task-status-1',
    prompt: '실제 작업 상태',
    mode: 'read-only',
    status: 'running',
    conversationId: 'conversation-1',
    requesterId: 'user-1',
    tenantId: 'tenant-1',
    progress: [],
    createdAt: new Date().toISOString(),
  });
  assert.equal(jobStatusCard.actions.at(-1)?.action, 'open-tab', 'job status cards include the default tab action');
  assert.equal(jobStatusCard.prompt, '실제 작업 상태', 'job status cards carry a bounded prompt for mobile prompt view');

  const errorCard = configuredFactory.error('실패한 작업');
  assert.equal(errorCard.actions.at(-1)?.action, 'open-tab', 'error cards include the default tab action');

  console.log('PASS: GenUI action grants are scoped, single-use, persistent, and expiring');
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
