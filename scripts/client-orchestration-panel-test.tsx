import { strict as assert } from 'node:assert';
import React from 'react';
import { teamsCliTestCatalog } from './fixtures/teams-cli-agent-policy-fixture.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiAuthError } from '../src/client/auth.js';
import type { VisibleJobConversation } from '../src/shared/job-conversation.js';

import {
  CoreOrchestrationClientError,
  createCoreOrchestrationClient,
} from '../src/client/core-orchestration-client.js';
import {
  createOrchestrationBusyController,
  decideSelectedOrchestrationApproval,
  getOrchestrationApprovalIdentity,
  orchestrationMutationNotice,
  OrchestrationPanel,
  OrchestrationPanelView,
  type OrchestrationPanelViewProps,
  validateOrchestrationSubmission,
} from '../src/client/OrchestrationPanel.js';
import * as orchestrationPanelModule from '../src/client/OrchestrationPanel.js';
import type {
  CoreCodexModelCatalog,
  CoreOrchestrationJob,
  CoreProviderFact,
} from '../src/shared/core-orchestration.js';

const provider: CoreProviderFact = {
  provider: 'codex',
  availability: 'available',
  capabilities: ['submit', 'cancel', 'input', 'approve', 'retry'],
  observedAt: '2026-09-03T00:59:00.000Z',
  source: 'runtime-probe',
};
const modelCatalog: CoreCodexModelCatalog = {
  revision: 'a'.repeat(64),
  observedAt: '2026-09-05T04:00:00.000Z',
  source: 'codex-debug-models',
  models: [{
    id: 'gpt-5.6-sol',
    label: 'GPT-5.6-Sol',
    defaultReasoningEffort: 'low',
    reasoningEfforts: ['low', 'high', 'ultra'],
  }],
};

const pollingFactory = (orchestrationPanelModule as Record<string, unknown>).createOrchestrationPollingController;
assert.equal(typeof pollingFactory, 'function', 'the agent hub exposes a bounded non-overlapping polling controller');

const settleRefreshNotice = (orchestrationPanelModule as Record<string, unknown>).settleOrchestrationRefreshNotice;
assert.equal(typeof settleRefreshNotice, 'function', 'a successful refresh recovers an earlier automatic-refresh failure');
{
  const settle = settleRefreshNotice as (notice: unknown, outcome: { status: string; message?: string }) => unknown;
  const failure = settle(null, { status: 'failed', message: 'synthetic offline' });
  assert.deepEqual(failure, { kind: 'refresh-error', message: '자동 업데이트 실패: synthetic offline' });
  assert.equal(settle(failure, { status: 'succeeded' }), null, 'failure followed by successful polling or manual refresh clears the stale error');
  assert.deepEqual(settle(failure, { status: 'aborted' }), failure, 'aborted or superseded requests cannot claim recovery');
  const mutation = { kind: 'mutation', message: '작업을 제출했습니다.' };
  assert.deepEqual(settle(mutation, { status: 'succeeded' }), mutation, 'refresh preserves a newer mutation receipt');
  assert.equal(settle(null, { status: 'succeeded' }), null);
}

{
  const scheduled: Array<{ callback: () => Promise<void> | void; delay: number; token: number }> = [];
  const cancelled: number[] = [];
  let resolveRefresh!: () => void;
  let refreshCalls = 0;
  const controller = (pollingFactory as (options: Record<string, unknown>) => {
    start: () => void;
    stop: () => void;
  })({
    intervalMs: 3_000,
    refresh: async () => {
      refreshCalls += 1;
      await new Promise<void>((resolve) => { resolveRefresh = resolve; });
    },
    schedule: (callback: () => Promise<void> | void, delay: number) => {
      const token = scheduled.length + 1;
      scheduled.push({ callback, delay, token });
      return token;
    },
    cancel: (token: number) => { cancelled.push(token); },
  });
  controller.start();
  assert.equal(scheduled.length, 1, 'start schedules one bounded refresh');
  assert.equal(scheduled[0]?.delay, 3_000);
  const firstTick = scheduled[0]!.callback();
  assert.equal(refreshCalls, 1);
  assert.equal(scheduled.length, 1, 'no second refresh is scheduled while the first one is unresolved');
  resolveRefresh();
  await firstTick;
  assert.equal(scheduled.length, 2, 'the next refresh is scheduled only after the previous request settles');
  controller.stop();
  assert.deepEqual(cancelled, [2], 'stop cancels the outstanding timer');
}

function task(
  status: CoreOrchestrationJob['status'],
  overrides: Partial<CoreOrchestrationJob> = {},
): CoreOrchestrationJob {
  return {
    id: 'task-1',
    provider: 'codex',
    prompt: 'Prepare the deployment evidence.',
    mode: 'read-only',
    status,
    progress: [],
    createdAt: '2026-09-03T01:00:00.000Z',
    ...overrides,
  };
}

const requests: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
const apiBasePath = '/api/core-orchestration';
const request = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
  const path = String(input);
  requests.push({
    path,
    method: init.method ?? 'GET',
    body: typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined,
  });
  const json = path === `${apiBasePath}/jobs` && !init.method
    ? { jobs: [task('running')], providers: [provider], modelCatalog }
    : path === `${apiBasePath}/jobs/task-1` && !init.method
      ? { job: task('input_required') }
      : path === `${apiBasePath}/jobs/task-1/input`
        ? { status: 'accepted', job: task('running') }
        : { job: task('running'), replayed: path === `${apiBasePath}/jobs`, requestHash: 'a'.repeat(64) };
  return new Response(JSON.stringify(json), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const client = createCoreOrchestrationClient(request);
const listed = await client.listJobs();
assert.equal(listed.jobs[0]?.id, 'task-1', 'list returns the durable task identity');
assert.equal(listed.providers[0]?.availability, 'available', 'list returns measured provider availability');
assert.equal(listed.modelCatalog?.models[0]?.id, 'gpt-5.6-sol');
assert.deepEqual(requests.at(-1), { path: `${apiBasePath}/jobs`, method: 'GET', body: undefined });

const detailed = await client.getJob('task-1');
assert.equal(detailed.status, 'input_required', 'detail preserves the input-required state');
assert.deepEqual(requests.at(-1), { path: `${apiBasePath}/jobs/task-1`, method: 'GET', body: undefined });

const continued = await client.continueJob('task-1', 'Continue the selected conversation.');
assert.equal(continued.job.id, 'task-1', 'explicit continuation returns the shared durable job DTO');
assert.deepEqual(requests.at(-1), {
  path: `${apiBasePath}/jobs/task-1/continue`,
  method: 'POST',
  body: { prompt: 'Continue the selected conversation.' },
}, 'continue sends only the selected job and prompt; scope remains server-derived');

const submitted = await client.submitJob({
  provider: 'codex',
  mode: 'read-only',
  prompt: 'Prepare the deployment evidence.',
  idempotencyKey: 'tab-submit-1',
  model: 'gpt-5.6-sol',
  reasoningEffort: 'high',
  catalogRevision: modelCatalog.revision,
});
assert.equal(submitted.replayed, true, 'duplicate submission is represented without inventing a second task');
assert.deepEqual(requests.at(-1), {
  path: `${apiBasePath}/jobs`,
  method: 'POST',
  body: {
    provider: 'codex',
    mode: 'read-only',
    prompt: 'Prepare the deployment evidence.',
    idempotencyKey: 'tab-submit-1',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'high',
    catalogRevision: modelCatalog.revision,
  },
}, 'submit sends no client-controlled tenant, requester, or conversation scope');

for (const notify of [false, true]) {
  await client.submitJob({
    provider: 'codex',
    mode: 'read-only',
    prompt: 'Synthetic notification preference check.',
    idempotencyKey: `tab-notify-${notify}`,
    notify,
  });
  assert.deepEqual(requests.at(-1), {
    path: `${apiBasePath}/jobs`,
    method: 'POST',
    body: {
      provider: 'codex',
      mode: 'read-only',
      prompt: 'Synthetic notification preference check.',
      idempotencyKey: `tab-notify-${notify}`,
      notify,
    },
  }, `submit preserves the user's explicit notification preference ${notify} in the actual JSON body`);
}

await client.cancelJob('task-1');
assert.deepEqual(requests.at(-1), {
  path: `${apiBasePath}/jobs/task-1/cancel`,
  method: 'POST',
  body: {},
});

const approvalIdentity = { approvalId: 'approval-12345678-1234-1234-1234-123456789abc', revision: 'b'.repeat(64) };
const beforeLegacyApproval = requests.length;
await assert.rejects(() => client.approveJob('task-1'),
  (caught: unknown) => caught instanceof CoreOrchestrationClientError && caught.code === 'ApprovalIdentityRequired');
assert.equal(requests.length, beforeLegacyApproval, 'legacy approval fails before HTTP rather than posting an empty payload');
for (const decision of ['accept', 'deny'] as const) {
  await client.decideApproval!('task-1', approvalIdentity, decision);
  assert.deepEqual(requests.at(-1), {
    path: `${apiBasePath}/jobs/task-1/${decision === 'accept' ? 'approve' : 'deny'}`,
    method: 'POST', body: approvalIdentity,
  }, 'both approval decisions send the exact observed identity without client scope');
}

const provided = await client.provideInput('task-1', 'Use canary.');
assert.equal(provided.status, 'accepted', 'provide-input consumes the shared result DTO directly');
assert.equal(provided.job.id, 'task-1');
assert.deepEqual(requests.at(-1), {
  path: `${apiBasePath}/jobs/task-1/input`,
  method: 'POST',
  body: { input: 'Use canary.' },
});

const unsupportedClient = createCoreOrchestrationClient(async () => new Response(JSON.stringify({
  status: 'unsupported',
  job: task('input_required'),
  reason: 'agent-service-does-not-support-input',
}), { status: 501, headers: { 'content-type': 'application/json' } }));
const unsupportedInput = await unsupportedClient.provideInput('task-1', 'continue');
assert.equal(unsupportedInput.status, 'unsupported', 'a typed unsupported result remains consumable across HTTP 501');
assert.equal(unsupportedInput.job.status, 'input_required');

await client.retryJob('task-1');
assert.deepEqual(requests.at(-1), {
  path: `${apiBasePath}/jobs/task-1/retry`,
  method: 'POST',
  body: {},
});

const failingClient = createCoreOrchestrationClient(async () => new Response(JSON.stringify({
  error: { code: 'ProviderUnavailable', message: 'The selected provider is unavailable.', retryable: false },
}), { status: 503, headers: { 'content-type': 'application/json' } }));
await assert.rejects(
  () => failingClient.listJobs(),
  (error: unknown) => error instanceof CoreOrchestrationClientError
    && error.code === 'ProviderUnavailable'
    && error.status === 503
    && error.retryable === false,
  'structured server failures retain safe code, status, and retryability',
);

assert.equal(
  validateOrchestrationSubmission('', 'codex', [provider]),
  '작업 내용을 입력하세요.',
  'blank input is rejected before a request',
);
assert.equal(
  validateOrchestrationSubmission('Run it', '', [provider]),
  '실행 제공자를 선택하세요.',
  'missing provider is rejected before a request',
);
assert.equal(
  validateOrchestrationSubmission('Run it', 'offline', [{
    provider: 'offline',
    availability: 'unavailable',
    capabilities: ['submit'],
    observedAt: '2026-09-03T00:59:00.000Z',
    source: 'runtime-probe',
  }]),
  '현재 사용할 수 없는 제공자입니다.',
  'an unavailable provider cannot be submitted as live',
);
assert.notEqual(validateOrchestrationSubmission('Run it', 'codex', [provider]), '', 'missing policy support cannot fall back to a default model');
assert.equal(validateOrchestrationSubmission('Run it', 'codex', [provider], 'gpt-6-luna', 'xhigh', teamsCliTestCatalog), '', 'policy-bound valid input is accepted');
assert.equal(validateOrchestrationSubmission('X'.repeat(2_000), 'codex', [provider], 'gpt-6-luna', 'xhigh', teamsCliTestCatalog), '', 'the server prompt boundary is accepted');
assert.equal(validateOrchestrationSubmission(`  ${'X'.repeat(2_000)}  `, 'codex', [provider], 'gpt-6-luna', 'xhigh', teamsCliTestCatalog), '', 'prompt length follows the trimmed submission contract');
assert.equal(
  validateOrchestrationSubmission('X'.repeat(2_001), 'codex', [provider]),
  '작업 내용은 2,000자 이내로 입력하세요.',
  'an over-limit prompt is rejected with actionable guidance before a provider request',
);
assert.equal(
  validateOrchestrationSubmission(
    'Run it',
    'codex',
    [provider],
    'gpt-5.6-sol',
    'minimal',
    modelCatalog,
  ),
  'Teams 에이전트는 gpt-6-luna · xhigh로 고정되어 있습니다.',
);
assert.equal(
  orchestrationMutationNotice({
    status: 'unsupported',
    job: task('input_required'),
    reason: 'agent-service-does-not-support-input',
  }, '추가 입력을 보냈습니다.'),
  '현재 제공자는 탭에서 추가 입력 재개를 지원하지 않습니다.',
  'an unsupported input response is never announced as success',
);
for (const reason of ['provider-input-unsupported', 'job-not-awaiting-input'] as const) {
  assert.notEqual(
    orchestrationMutationNotice({
      status: 'unsupported',
      job: task('input_required'),
      reason,
    }, '추가 입력을 보냈습니다.'),
    '추가 입력을 보냈습니다.',
    `${reason} is never announced as successful input delivery`,
  );
}
assert.equal(
  orchestrationMutationNotice({ job: task('running'), replayed: true }, '작업을 제출했습니다.'),
  '같은 요청의 기존 작업을 표시합니다.',
  'an idempotent replay is identified as the existing durable job',
);

{
  const busy = createOrchestrationBusyController();
  let resolveFirst!: () => void;
  let calls = 0;
  const first = busy.run('submit', async () => {
    calls += 1;
    await new Promise<void>((resolve) => { resolveFirst = resolve; });
    return 'first';
  });
  const duplicate = await busy.run('submit', async () => {
    calls += 1;
    return 'duplicate';
  });
  assert.equal(duplicate, undefined, 'a duplicate click does not start a concurrent submission');
  assert.equal(calls, 1, 'only the first in-flight operation executes');
  assert.equal(busy.isBusy('submit'), true, 'the controller exposes its pending state');
  resolveFirst();
  assert.equal(await first, 'first');
  assert.equal(busy.isBusy('submit'), false, 'the pending state is released after settlement');
}

const noop = () => undefined;
const asyncNoop = async () => undefined;
const baseProps = {
  providers: [provider],
  prompt: '',
  providerId: 'codex',
  mode: 'read-only' as const,
  modelCatalog: teamsCliTestCatalog,
  modelId: 'gpt-6-luna',
  reasoningEffort: 'xhigh' as const,
  inputValue: '',
  busyAction: '',
  notice: '',
  validationError: '',
  onPromptChange: noop,
  onProviderChange: noop,
  onModeChange: noop,
  onModelChange: noop,
  onReasoningEffortChange: noop,
  onInputChange: noop,
  onSubmit: asyncNoop,
  onSelectTask: asyncNoop,
  onCancel: asyncNoop,
  onApprove: asyncNoop,
  onDeny: asyncNoop,
  approvalDecisionSupported: true,
  onProvideInput: asyncNoop,
  onRetryTask: asyncNoop,
  onReload: asyncNoop,
};

const loading = renderToStaticMarkup(<OrchestrationPanelView
  {...baseProps}
  phase="loading"
  jobs={[]}
  selectedJob={null}
  error=""
  mobile={false}
/>);
assert.match(loading, /role="status"/);
assert.match(loading, /aria-busy="true"/);
assert.match(loading, /오케스트레이션 작업을 불러오는 중입니다/);

const empty = renderToStaticMarkup(<OrchestrationPanelView
  {...baseProps}
  phase="ready"
  jobs={[]}
  pendingJobs={[]}
  selectedJob={null}
  error=""
  mobile={false}
/>);
assert.match(empty, /아직 실행한 작업이 없습니다/);
assert.match(empty, /승인 대기 작업이 없습니다/);
assert.match(empty, /작업 내용/);
assert.match(empty, /실행 제공자/);
assert.match(empty, /Codex 모델/);
assert.match(empty, /추론 수준/);
assert.match(empty, /자동 새로고침 3초/, 'the hub tells the user that progress is refreshed automatically');

for (const phase of ['ready', 'loading'] as const) {
  const notification = renderToStaticMarkup(<OrchestrationPanelView
    {...baseProps} phase={phase} jobs={[]} selectedJob={null} error="" mobile={false}
    notifyPersonal={true} onNotifyPersonalChange={noop}
  />);
  const nativeLabel = notification.match(/<label[^>]*>(<input[^>]*type="checkbox"[^>]*>.*?)<\/label>/)?.[1];
  assert.ok(nativeLabel, 'notification checkbox remains inside its native label');
  assert.match(nativeLabel, /내 업무 허브 개인 채팅으로 진행·결과 알림 받기/);
  assert.match(nativeLabel, /checked=""/, 'controlled checked state is preserved');
  assert.equal(/disabled=""/.test(nativeLabel), phase === 'loading', 'loading disables notification changes');
}
assert.doesNotMatch(empty, /type="checkbox"/, 'notification option is absent without its callback');

const pendingApprovalJob = task('awaiting_approval', { mode: 'workspace-write',
  pendingOperation: { kind: 'job-approval', jobId: 'task-1', ...approvalIdentity,
    approverId: 'synthetic-owner', tenantId: 'synthetic-tenant', deadline: '2099-10-11T12:00:00.000Z' },
  approval: { schemaVersion: '1', ...approvalIdentity, approverId: 'synthetic-owner', tenantId: 'synthetic-tenant',
    deadline: '2099-10-11T12:00:00.000Z', state: 'pending' },
});
const approval = renderToStaticMarkup(<OrchestrationPanelView
  {...baseProps}
  phase="ready"
  jobs={[pendingApprovalJob]}
  pendingJobs={[pendingApprovalJob]}
  selectedJob={pendingApprovalJob}
  error=""
  mobile={false}
/>);
assert.match(approval, /승인 필요/);
assert.match(approval, /개인 승인 대기 목록/);
assert.equal(approval.split('b'.repeat(64)).length - 1, 2, 'inbox and selected detail show the same server revision');
assert.match(approval, />승인<\/button>/);
assert.match(approval, />거절<\/button>/);
assert.match(approval, /승인자:<\/dt><dd>synthetic-owner/);
assert.match(approval, /승인 기한:<\/dt><dd><time dateTime="2099-10-11T12:00:00.000Z"/);
assert.match(approval, /승인 상태:<\/dt><dd>승인 대기/);
assert.match(approval, /계속하려면 승인이 필요합니다/);

const invalidApprovals = [
  { name: 'legacy', job: { ...pendingApprovalJob, approval: undefined,
    pendingOperation: { kind: 'job-approval' as const, jobId: 'task-1', revision: approvalIdentity.revision } } },
  { name: 'missing identity', job: { ...pendingApprovalJob,
    pendingOperation: { ...pendingApprovalJob.pendingOperation!, approvalId: undefined } } },
  { name: 'expired', job: { ...pendingApprovalJob,
    approval: { ...pendingApprovalJob.approval!, deadline: '2000-01-01T00:00:00.000Z' },
    pendingOperation: { ...pendingApprovalJob.pendingOperation!, deadline: '2000-01-01T00:00:00.000Z' } } },
  { name: 'settled', job: { ...pendingApprovalJob, approval: { ...pendingApprovalJob.approval!, state: 'accepted' as const } } },
  { name: 'changed revision', job: { ...pendingApprovalJob,
    pendingOperation: { ...pendingApprovalJob.pendingOperation!, revision: 'c'.repeat(64) } } },
  { name: 'foreign job', job: { ...pendingApprovalJob,
    pendingOperation: { ...pendingApprovalJob.pendingOperation!, jobId: 'other-job' } } },
];
for (const { name, job } of invalidApprovals) {
  assert.equal(getOrchestrationApprovalIdentity(job), undefined, `${name} cannot supply executable identity`);
  const markup = renderToStaticMarkup(<OrchestrationPanelView {...baseProps} phase="ready" jobs={[job]}
    selectedJob={job} error="" mobile={false} />);
  assert.match(markup, /<button[^>]*disabled=""[^>]*>승인<\/button>/, `${name} disables approval`);
  assert.match(markup, /<button[^>]*disabled=""[^>]*>거절<\/button>/, `${name} disables denial`);
  assert.match(markup, /role="note"/, `${name} explains why the decision is unavailable`);
  const before = requests.length;
  for (const decision of ['accept', 'deny'] as const) {
    await assert.rejects(() => decideSelectedOrchestrationApproval(client, job,
      { kind: decision === 'accept' ? 'approve' : 'deny', jobId: job.id, approvalIdentity }, decision));
  }
  assert.equal(requests.length, before, `${name} never reaches HTTP through the actual panel decision helper`);
}

assert.deepEqual(getOrchestrationApprovalIdentity(pendingApprovalJob), approvalIdentity);
const expiresAt = Date.parse(pendingApprovalJob.approval!.deadline);
assert.equal(getOrchestrationApprovalIdentity(pendingApprovalJob, expiresAt), undefined, 'the deadline boundary is already expired');
assert.deepEqual(getOrchestrationApprovalIdentity(pendingApprovalJob, expiresAt - 1), approvalIdentity);
const beforeStaleConfirmation = requests.length;
const staleConfirmation = { kind: 'approve' as const, jobId: 'task-1', approvalIdentity: { ...approvalIdentity, revision: 'c'.repeat(64) } };
await assert.rejects(() => decideSelectedOrchestrationApproval(client, pendingApprovalJob, staleConfirmation, 'accept'));
assert.equal(requests.length, beforeStaleConfirmation, 'a stale first-click revision cannot silently approve the new operation');
const staleMarkup = renderToStaticMarkup(<OrchestrationPanelView {...baseProps} phase="ready" jobs={[pendingApprovalJob]}
  selectedJob={pendingApprovalJob} pendingConfirmation={staleConfirmation} error="" mobile={false} />);
assert.match(staleMarkup, /<button[^>]*disabled=""[^>]*>승인 확인<\/button>/);
assert.match(staleMarkup, /승인 정보가 변경되었습니다/);

function findButton(node: React.ReactNode, label: string): React.ReactElement<any> | undefined {
  if (!React.isValidElement(node)) return undefined;
  const element = node as React.ReactElement<any>;
  if (element.type === 'button' && element.props.children === label) return element;
  for (const child of React.Children.toArray(element.props.children)) {
    const found = findButton(child, label); if (found) return found;
  }
  return undefined;
}
for (const decision of ['accept', 'deny'] as const) {
  let confirmation: any;
  let submittedDecision: Promise<unknown> | undefined;
  const before = requests.length;
  const initial = OrchestrationPanelView({ ...baseProps, phase: 'ready', jobs: [pendingApprovalJob], selectedJob: pendingApprovalJob,
    error: '', mobile: false, onRequestConfirmation: (kind, jobId) => { confirmation = { kind, jobId, approvalIdentity }; } });
  const firstButton = findButton(initial, decision === 'accept' ? '승인' : '거절'); assert.ok(firstButton);
  assert.equal(firstButton.props.disabled, false); firstButton.props.onClick();
  assert.equal(requests.length, before, 'the first actual view click only opens in-app confirmation');
  const confirmed = OrchestrationPanelView({ ...baseProps, phase: 'ready', jobs: [pendingApprovalJob], selectedJob: pendingApprovalJob,
    error: '', mobile: false, pendingConfirmation: confirmation,
    onApprove: () => { submittedDecision = decideSelectedOrchestrationApproval(client, pendingApprovalJob, confirmation, 'accept'); },
    onDeny: () => { submittedDecision = decideSelectedOrchestrationApproval(client, pendingApprovalJob, confirmation, 'deny'); } });
  const confirmedButton = findButton(confirmed, decision === 'accept' ? '승인 확인' : '거절 확인'); assert.ok(confirmedButton);
  assert.equal(confirmedButton.props.disabled, false); confirmedButton.props.onClick(); await submittedDecision;
  assert.equal(requests.length, before + 1, 'the second actual view click calls the strict client once');
  assert.deepEqual(requests.at(-1)?.body, approvalIdentity);
  assert.equal(requests.at(-1)?.path, `${apiBasePath}/jobs/task-1/${decision === 'accept' ? 'approve' : 'deny'}`);
}
const unsupportedApproval = renderToStaticMarkup(<OrchestrationPanelView {...baseProps} phase="ready" jobs={[pendingApprovalJob]}
  selectedJob={pendingApprovalJob} approvalDecisionSupported={false} error="" mobile={false} />);
assert.match(unsupportedApproval, /<button[^>]*disabled=""[^>]*>승인<\/button>/);
assert.match(unsupportedApproval, /승인 결정을 지원하지 않습니다/);
const unavailableApproval = renderToStaticMarkup(<OrchestrationPanelView {...baseProps} phase="ready" jobs={[pendingApprovalJob]}
  selectedJob={pendingApprovalJob} providers={[{ ...provider, availability: 'unavailable' }]} error="" mobile={false} />);
assert.match(unavailableApproval, /<button[^>]*disabled=""[^>]*>승인<\/button>/);
assert.match(unavailableApproval, /<button class="secondary" type="button">거절<\/button>/,
  'denial remains available when provider execution is unavailable because it never dispatches');
const beforeUnsupportedApproval = requests.length;
await assert.rejects(() => decideSelectedOrchestrationApproval({ ...client, decideApproval: undefined }, pendingApprovalJob,
  { kind: 'approve', jobId: 'task-1', approvalIdentity }, 'accept'));
await assert.rejects(() => decideSelectedOrchestrationApproval(client, pendingApprovalJob,
  { kind: 'approve', jobId: 'task-1', approvalIdentity }, 'accept', expiresAt));
assert.equal(requests.length, beforeUnsupportedApproval, 'missing capability and confirmation-time expiry fail before HTTP');
{
  const decisionBusy = createOrchestrationBusyController();
  const before = requests.length;
  const accepted = decisionBusy.run('approval:task-1', () => decideSelectedOrchestrationApproval(client, pendingApprovalJob,
    { kind: 'approve', jobId: 'task-1', approvalIdentity }, 'accept'));
  const competingDenial = await decisionBusy.run('approval:task-1', () => decideSelectedOrchestrationApproval(client, pendingApprovalJob,
    { kind: 'deny', jobId: 'task-1', approvalIdentity }, 'deny'));
  assert.equal(competingDenial, undefined, 'approval and denial share one pending mutation slot');
  await accepted;
  assert.equal(requests.length, before + 1, 'rapid conflicting second clicks send one owner decision');
}

const inputRequired = renderToStaticMarkup(<OrchestrationPanelView
  {...baseProps}
  phase="ready"
  jobs={[task('input_required')]}
  selectedJob={task('input_required')}
  error=""
  mobile={false}
/>);
assert.match(inputRequired, /추가 입력이 필요합니다/);
assert.match(inputRequired, /aria-label="추가 입력"/);
assert.match(inputRequired, /입력 보내기/);

const failed = renderToStaticMarkup(<OrchestrationPanelView
  {...baseProps}
  phase="ready"
  jobs={[task('failed')]}
  selectedJob={task('failed', { error: 'No terminal receipt.' })}
  error=""
  mobile={false}
/>);
assert.match(failed, /role="alert"/);
assert.match(failed, /No terminal receipt/);
assert.match(failed, /작업 다시 시도/);

const unavailableAndMobile = renderToStaticMarkup(<OrchestrationPanelView
  {...baseProps}
  phase="ready"
  providers={[provider, {
    provider: 'hermes',
    availability: 'unavailable',
    capabilities: ['submit'],
    observedAt: '2026-09-03T00:59:00.000Z',
    source: 'runtime-observation',
    readiness: {
      configured: 'not-configured',
      executable: 'absent',
      authentication: 'unknown',
      entitlement: 'unknown',
      probe: 'not-run',
      reason: 'missing',
    },
  }]}
  jobs={[task('completed', { result: 'Evidence prepared.' })]}
  selectedJob={task('completed', { result: 'Evidence prepared.' })}
  error=""
  mobile
/>);
assert.match(unavailableAndMobile, /<option disabled="" value="hermes">hermes \(사용 불가\)<\/option>/);
assert.match(unavailableAndMobile, /hermes: 현재 사용할 수 없음/);
assert.match(unavailableAndMobile, /설정 not-configured · 실행파일 absent · 인증 unknown · 권한 unknown · probe not-run/);
assert.match(unavailableAndMobile, /Evidence prepared/);
assert.match(unavailableAndMobile, /모바일에서 작업 제어가 원활하지 않으면 Teams 데스크톱 또는 웹 탭에서 계속하세요/);

const promptAndTools = renderToStaticMarkup(<OrchestrationPanelView
  {...baseProps}
  phase="ready"
  jobs={[task('running')]}
  selectedJob={task('running', {
    prompt: '배포 상태를 공식 문서와 비교해줘',
    model: 'gpt-5.6-sol',
    reasoningEffort: 'high',
    catalogRevision: modelCatalog.revision,
    tokenUsage: {
      source: 'codex.exec.jsonl.turn.completed.usage',
      inputTokens: 1_200,
      cachedInputTokens: 1_000,
      outputTokens: 240,
      reasoningOutputTokens: 80,
    },
    tools: [
      { category: 'skill', name: 'systematic-debugging', observedAt: '2026-09-05T00:00:00.000Z' },
      { category: 'mcp', name: 'jira/search_issues', observedAt: '2026-09-05T00:00:01.000Z' },
    ],
  })}
  error=""
  mobile={false}
/>);
assert.match(promptAndTools, /요청 보기<\/summary><pre>배포 상태를 공식 문서와 비교해줘/);
assert.ok(promptAndTools.indexOf('선택한 대화') < promptAndTools.indexOf('aria-label="작업 내용"'), 'selected conversation appears before the new execution form');
assert.match(promptAndTools, /스킬 · systematic-debugging/);
assert.match(promptAndTools, /MCP · jira\/search_issues/);
assert.match(promptAndTools, /gpt-5.6-sol/);
assert.match(promptAndTools, /high/);
assert.match(promptAndTools, /입력 1,200/);
assert.match(promptAndTools.replace(/<[^>]+>/g, ''), /계정 잔여량: Codex CLI에서 제공되지 않음/, 'quota uses the existing card disclaimer regardless of label markup');

const copilotDetail = renderToStaticMarkup(<OrchestrationPanelView
  {...baseProps}
  phase="ready"
  jobs={[task('running', { provider: 'copilot' })]}
  selectedJob={task('running', { provider: 'copilot' })}
  error=""
  mobile={false}
/>);
assert.doesNotMatch(
  copilotDetail,
  /CLI 기본값|계정 잔여량|토큰 사용량/u,
  'non-Codex detail must not imply Codex model or token telemetry',
);

const error = renderToStaticMarkup(<OrchestrationPanelView
  {...baseProps}
  phase="error"
  jobs={[]}
  selectedJob={null}
  error="작업 목록을 불러오지 못했습니다."
  mobile={false}
/>);
assert.match(error, /role="alert"/);
assert.match(error, /작업 목록을 불러오지 못했습니다/);
assert.match(error, />다시 시도<\/button>/);
assert.doesNotMatch(error, /아직 실행한 작업이 없습니다/);

const mutationError = renderToStaticMarkup(<OrchestrationPanelView
  {...baseProps}
  phase="ready"
  jobs={[task('completed', { result: 'Existing result.' })]}
  selectedJob={null}
  error="합성 요청을 처리하지 못했습니다."
  mobile={false}
/>);
assert.match(mutationError, /role="alert"[^>]*>합성 요청을 처리하지 못했습니다\./, 'a failed mutation is visible while the already-loaded panel remains ready');
assert.match(mutationError, /Existing result\.|완료/, 'mutation failure preserves the loaded job list');
assert.equal((error.match(/작업 목록을 불러오지 못했습니다/g) ?? []).length, 1, 'list-load errors are displayed once');

// Exercise production hook handlers and the actual latest-detail controller.
// Host effects are held by this fixture so no Teams host, polling timer, or DOM is used.
function panelHookHost() {
  type Cell = { value: unknown; dependencies?: readonly unknown[] };
  const cells: Cell[] = [];
  let cursor = 0;
  function memo(factory: () => unknown, dependencies: readonly unknown[]): unknown {
    const index = cursor++;
    const cell = cells[index];
    if (!cell || cell.dependencies?.length !== dependencies.length
      || dependencies.some((value, n) => !Object.is(value, cell.dependencies?.[n]))) {
      cells[index] = { value: factory(), dependencies };
    }
    return cells[index]!.value;
  }
  const dispatcher = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!cells[index]) cells[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [cells[index]!.value, (value: unknown) => {
        cells[index]!.value = typeof value === 'function' ? value(cells[index]!.value) : value;
      }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!cells[index]) cells[index] = { value: { current: initial } };
      return cells[index]!.value;
    },
    useMemo: memo,
    useCallback: (callback: unknown, dependencies: readonly unknown[]) => memo(() => callback, dependencies),
    useEffect: () => { cursor++; },
  };
  return {
    render(panelClient: Parameters<typeof OrchestrationPanel>[0]['client']) {
      cursor = 0;
      const internals = (React as unknown as {
        __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: { H: unknown };
      }).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      const previous = internals.H; internals.H = dispatcher;
      try {
        return (OrchestrationPanel({ client: panelClient, mobile: false }) as React.ReactElement<OrchestrationPanelViewProps>).props;
      } finally { internals.H = previous; }
    },
  };
}

function privateConversation(job: CoreOrchestrationJob): VisibleJobConversation {
  return { selectedJobId: job.id, complete: true, turns: [{ jobId: job.id, request: job.prompt,
    response: job.result, status: job.status, createdAt: job.createdAt, progress: [], tools: [], truncated: false }] };
}

for (const denial of [401, 403, 404, 'auth-expired', 'forbidden'] as const) {
  const privateResult = task('completed', { id: `private-${denial}`, result: `SYNTHETIC_PRIVATE_RESULT_${denial}` });
  const lateResult = { ...privateResult, id: `late-${denial}`, result: `SYNTHETIC_LATE_PRIVATE_RESULT_${denial}` };
  let failure: typeof denial | undefined;
  let reads = 0;
  const protectedClient = createCoreOrchestrationClient(async (input) => {
    reads++;
    const list = String(input) === `${apiBasePath}/jobs`;
    if (failure && (failure !== 404 || !list)) {
      if (typeof failure === 'string') throw new ApiAuthError(failure);
      return Response.json({ error: 'SYNTHETIC_ACCESS_DENIED' }, { status: failure });
    }
    return Response.json(list ? { jobs: [privateResult, pendingApprovalJob], pendingJobs: [pendingApprovalJob],
      pendingHasMore: true, providers: [provider], modelCatalog: teamsCliTestCatalog } : { job: privateResult });
  });
  let releaseLate!: (detail: { job: CoreOrchestrationJob; conversation: VisibleJobConversation }) => void;
  let lateSignal: AbortSignal | undefined;
  protectedClient.getJobConversation = async (id, signal) => {
    if (id === lateResult.id) {
      lateSignal = signal;
      // Deliberately ignore abort to prove stale-success invalidation independently of transport cooperation.
      return new Promise(resolve => { releaseLate = resolve; });
    }
    const job = id === pendingApprovalJob.id ? pendingApprovalJob : privateResult;
    return { job, conversation: privateConversation(job) };
  };
  const host = panelHookHost();
  let props = host.render(protectedClient);
  const reload = (silent = false) => (props.onReload as (options?: { silent?: boolean }) => Promise<void>)({ silent });
  await reload(); props = host.render(protectedClient);
  await props.onSelectTask(pendingApprovalJob.id); props = host.render(protectedClient);
  props.onRequestConfirmation?.('approve', pendingApprovalJob.id); props = host.render(protectedClient);
  assert.equal(props.pendingConfirmation?.kind, 'approve');
  await props.onSelectTask(privateResult.id); props = host.render(protectedClient);
  assert.equal(props.selectedJob?.result, privateResult.result);
  assert.equal(props.conversation?.turns[0]?.response, privateResult.result);
  assert.match(renderToStaticMarkup(<OrchestrationPanelView {...props} />), new RegExp(privateResult.result!));

  function assertPrivateStateHidden(): void {
    assert.equal(props.selectedJob, null, `${denial} clears the retained selected private result`);
    assert.equal(props.conversation, undefined, `${denial} clears retained private conversation`);
    assert.deepEqual(props.jobs, [], `${denial} clears the private job list`);
    assert.deepEqual(props.pendingJobs, [], `${denial} clears the approval inbox`);
    assert.equal(props.pendingHasMore, false);
    assert.equal(props.pendingConfirmation, null, `${denial} clears retained approval confirmation`);
    assert.equal(props.phase, 'error', `${denial} exposes deliberate access recovery even after silent polling`);
    const hidden = renderToStaticMarkup(<OrchestrationPanelView {...props} />);
    assert.doesNotMatch(hidden, /SYNTHETIC_(?:LATE_)?PRIVATE_RESULT|작업 승인 확인|orchestration-job-detail/);
  }
  failure = denial;
  await reload(denial !== 404); props = host.render(protectedClient);
  assertPrivateStateHidden();

  failure = undefined;
  const beforeAutomatic = reads;
  await reload(true); props = host.render(protectedClient);
  assert.equal(reads, beforeAutomatic, 'automatic polling cannot unlock denied private state');
  assertPrivateStateHidden();
  await reload(); props = host.render(protectedClient);
  assert.equal(props.phase, 'ready', 'an explicit successful fresh load recovers after reauthentication');
  assert.equal(props.selectedJob, null, 'fresh list does not resurrect the old selected response');
  await props.onSelectTask(privateResult.id); props = host.render(protectedClient);
  const late = props.onSelectTask(lateResult.id);
  props = host.render(protectedClient);
  failure = denial;
  await reload(true); props = host.render(protectedClient);
  assertPrivateStateHidden();
  assert.equal(lateSignal?.aborted, true, 'access denial invalidates the current detail request');
  releaseLate({ job: lateResult, conversation: privateConversation(lateResult) });
  await late; props = host.render(protectedClient);
  assertPrivateStateHidden();
  failure = undefined;
  await reload(); props = host.render(protectedClient);
  await props.onSelectTask(privateResult.id); props = host.render(protectedClient);
  assert.equal(props.selectedJob?.result, privateResult.result, 'deliberate fresh authorized selection remains available');
}

{
  const cached = task('completed', { result: 'SYNTHETIC_NON_ACCESS_FAILURE_CACHE' });
  let offline = false;
  const existingClient = createCoreOrchestrationClient(async () => offline
    ? Response.json({}, { status: 503 })
    : Response.json({ jobs: [cached], providers: [provider] }));
  existingClient.getJobConversation = async () => ({ job: cached, conversation: privateConversation(cached) });
  const host = panelHookHost();
  let props = host.render(existingClient);
  await props.onReload(); props = host.render(existingClient);
  await props.onSelectTask(cached.id); props = host.render(existingClient);
  offline = true;
  await (props.onReload as (options: { silent: boolean }) => Promise<void>)({ silent: true });
  props = host.render(existingClient);
  assert.equal(props.selectedJob?.result, cached.result, 'a generic temporary service error preserves existing cached-result behavior');
  assert.equal(props.conversation?.turns[0]?.response, cached.result);
  assert.equal(props.phase, 'ready');
  assert.match(props.notice, /자동 업데이트 실패/);
}

console.log('Client orchestration panel tests passed');
