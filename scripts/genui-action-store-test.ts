import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { GenUiActionStore } from '../src/server/genui-action-store.js';
import { GenUiResponseFactory } from '../src/server/genui-response.js';
import { renderGenUiCard } from '../src/server/genui-teams.js';

const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-genui-actions-'));
const dataFile = path.join(directory, 'actions.json');

try {
  const store = new GenUiActionStore(dataFile);
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

  const restarted = new GenUiActionStore(dataFile);
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
  assert.equal(helpCard.actions.length, 6);
  assert.equal(helpCard.actions.at(-1)?.action, 'open-tab');
  assert.deepEqual(
    helpCard.actions.slice(0, -1).map((action) => action.action),
    ['command', 'command', 'command', 'command', 'command'],
    'help card keeps five command buttons plus the default tab link within the Teams action budget',
  );
  assert.deepEqual(
    helpCard.actions.slice(0, -1).map((action) => action.entityId),
    ['help', 'weather', 'status', 'list', 'work'],
  );
  assert.equal(helpCard.actions.at(-1)?.entityId, 'home');
  assert.equal(helpCard.metadata.openTabUrl, personalTabUrl);

  const providerEnvelope = {
    ...configuredFactory.answer('응답 엔진 결과', 'response-engine-result'),
    actions: [],
    metadata: { provider: 'deterministic', deterministic: true },
  };
  const decoratedProviderEnvelope = configuredFactory.withTabAction(providerEnvelope);
  assert.equal(
    decoratedProviderEnvelope.actions.at(-1)?.action,
    'open-tab',
    'response-engine cards preserve the default Work Hub tab action',
  );
  assert.equal(
    decoratedProviderEnvelope.metadata.provider,
    'deterministic',
    'decorating a response-engine card preserves provider metadata',
  );
  assert.equal(providerEnvelope.actions.length, 0, 'decorating a response-engine card does not mutate the provider envelope');
  assert.equal(
    configuredFactory.withTabAction(decoratedProviderEnvelope).actions.filter((action) => action.action === 'open-tab').length,
    1,
    'decorating a response-engine card is idempotent',
  );

  const configuredTabAction = decoratedProviderEnvelope.actions[0];
  assert.ok(configuredTabAction);
  const staleProviderEnvelope = {
    ...decoratedProviderEnvelope,
    actions: [
      configuredTabAction,
      {
        ...configuredTabAction,
        id: 'provider-open-tab',
        actionToken: 'stale-provider-tab-token',
      },
    ],
    metadata: {
      ...decoratedProviderEnvelope.metadata,
      openTabUrl: 'https://stale.example/global',
      'openTabUrl.open-tab': 'https://stale.example/action',
      'openTabUrl.0': 'https://stale.example/index',
    },
  };
  const normalizedProviderEnvelope = configuredFactory.withTabAction(staleProviderEnvelope);
  assert.equal(
    normalizedProviderEnvelope.actions.filter((action) => action.action === 'open-tab').length,
    1,
    'decorating a provider card normalizes duplicate tab actions to one',
  );
  assert.equal(normalizedProviderEnvelope.metadata.openTabUrl, personalTabUrl);
  assert.equal(normalizedProviderEnvelope.metadata['openTabUrl.open-tab'], undefined);
  assert.equal(normalizedProviderEnvelope.metadata['openTabUrl.0'], undefined);
  assert.equal(normalizedProviderEnvelope.metadata.provider, 'deterministic');
  const renderedTabAction = renderGenUiCard(normalizedProviderEnvelope).actions?.find(
    (action) => action.type === 'Action.OpenUrl',
  );
  assert.equal(
    renderedTabAction?.url,
    personalTabUrl,
    'the surviving tab action renders the configured Work Hub deep link',
  );
  assert.equal(
    staleProviderEnvelope.metadata.openTabUrl,
    'https://stale.example/global',
    'normalizing a provider card does not mutate its metadata',
  );

  const jobStatusCard = await configuredFactory.jobStatus({
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

  const incompleteJobStatusCard = await configuredFactory.jobStatus({
    id: 'task-missing-result',
    prompt: '결과 없는 완료 상태',
    mode: 'read-only',
    status: 'completed',
    conversationId: 'conversation-1',
    requesterId: 'user-1',
    tenantId: 'tenant-1',
    progress: [],
    createdAt: new Date().toISOString(),
  });
  assert.equal(incompleteJobStatusCard.status, 'error', 'a completed job without a result renders an error card');

  const failedJobStatusCard = await configuredFactory.jobStatus({
    id: 'task-failed-1',
    prompt: '실패한 작업 재시도',
    mode: 'read-only',
    status: 'failed',
    conversationId: 'conversation-1',
    requesterId: 'user-1',
    tenantId: 'tenant-1',
    error: 'controlled failure',
    progress: [],
    createdAt: new Date().toISOString(),
  });
  assert.equal(failedJobStatusCard.actions.some((action) => action.action === 'retry'), true, 'failed job cards expose a persisted retry action');
  assert.equal(failedJobStatusCard.actions.at(-1)?.action, 'open-tab', 'retry action preserves the default tab link');

  const errorCard = configuredFactory.error('실패한 작업');
  assert.equal(errorCard.actions.at(-1)?.action, 'open-tab', 'error cards include the default tab action');

  const failedCommitCard = configuredFactory.commitResult({
    id: 'task-no-commit-1',
    prompt: '실제 커밋 요청',
    mode: 'workspace-write',
    status: 'completed',
    conversationId: 'conversation-1',
    requesterId: 'user-1',
    tenantId: 'tenant-1',
    commitMessage: '커밋할 변경이 없습니다.',
    result: '작업 결과는 있습니다.',
    progress: [],
    createdAt: new Date().toISOString(),
  });
  assert.equal(failedCommitCard.kind, 'error', 'a completed job without a Git hash is not a successful commit result');
  assert.equal(failedCommitCard.status, 'error', 'a non-committed Git outcome renders an error state');

  const successfulCommitCard = configuredFactory.commitResult({
    id: 'task-commit-1',
    prompt: '실제 커밋 요청',
    mode: 'workspace-write',
    status: 'completed',
    conversationId: 'conversation-1',
    requesterId: 'user-1',
    tenantId: 'tenant-1',
    commitHash: 'abc1234',
    commitMessage: '커밋을 생성했습니다: abc1234',
    result: '작업 결과는 있습니다.',
    progress: [],
    createdAt: new Date().toISOString(),
  });
  assert.equal(successfulCommitCard.kind, 'result');
  assert.equal(successfulCommitCard.status, 'complete');

  console.log('PASS: GenUI action grants are scoped, single-use, persistent, and expiring');
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
