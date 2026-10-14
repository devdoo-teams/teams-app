import { strict as assert } from 'node:assert';
import React from 'react';
import { teamsCliTestCatalog } from './fixtures/teams-cli-agent-policy-fixture.js';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiAuthError } from '../src/client/auth.js';
import { registerHooks } from 'node:module';
import type { VisibleJobConversation } from '../src/shared/job-conversation.js';

import type { OrchestrationPanelViewProps } from '../src/client/OrchestrationPanel.js';
const hostHooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@microsoft/teams-js') return { format: 'module', shortCircuit: true,
    url: 'data:text/javascript,export const app={isInitialized:()=>false}; export const authentication={};' };
  return nextResolve(specifier, context);
} });
const orchestrationPanelModule = await import('../src/client/OrchestrationPanel.js');
hostHooks.deregister();
import {
  CoreOrchestrationClientError,
  createCoreOrchestrationClient,
} from '../src/client/core-orchestration-client.js';
const {
  createOrchestrationBusyController,
  decideSelectedOrchestrationApproval,
  getOrchestrationApprovalIdentity,
  orchestrationMutationNotice,
  OrchestrationPanel,
  OrchestrationPanelView,
  validateOrchestrationSubmission,
} = orchestrationPanelModule;
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
  const routePath = new URL(path, 'http://core.test').pathname;
  const json = routePath === `${apiBasePath}/jobs` && !init.method
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
const pageClient = client as typeof client & { listJobs(signal?: AbortSignal, query?: Record<string, unknown>): Promise<unknown> };
await pageClient.listJobs(undefined, { limit: 30, search: 'design', status: 'failed', cursor: 'opaque_cursor-1', jobIds: ['task-1'] });
assert.match(requests.at(-1)!.path, /^\/api\/core-orchestration\/jobs\?/u, 'page query stays on the authenticated Core route');
assert.match(requests.at(-1)!.path, /limit=30/u);
assert.match(requests.at(-1)!.path, /search=design/u);
assert.match(requests.at(-1)!.path, /status=failed/u);
assert.match(requests.at(-1)!.path, /cursor=opaque_cursor-1/u);
assert.match(requests.at(-1)!.path, /jobIds=task-1/u, 'pinned/project lookup remains principal-scoped at the server');
await pageClient.listJobs(undefined, { limit: 30, jobIds: [] });
assert.match(requests.at(-1)!.path, /jobIds=$/u, 'an empty pin list is represented explicitly rather than falling back to every job');

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

{
  const pending = task('running', { cancellationRequestedAt: '2026-10-14T00:00:00Z' });
  const markup = renderToStaticMarkup(<OrchestrationPanelView {...baseProps} phase="ready" jobs={[pending]}
    selectedJob={pending} error="" mobile={false} />);
  assert.match(markup, /취소 요청이 접수되었습니다/);
  assert.match(markup, /실행 중단의 최종 상태/);
  assert.doesNotMatch(markup, /취소 확인|>작업 취소</);
}

const empty = renderToStaticMarkup(<OrchestrationPanelView
  {...baseProps}
  phase="ready"
  jobs={[]}
  pendingJobs={[]}
  selectedJob={null}
  error=""
  mobile={false}
  listHasMore={true}
  onLoadMore={asyncNoop}
/>);
assert.match(empty, /아직 실행한 작업이 없습니다/);
assert.match(empty, /승인 대기 작업이 없습니다/);
assert.match(empty, /작업 내용/);
assert.match(empty, /실행 제공자/);
assert.match(empty, /Codex 모델/);
assert.match(empty, /추론 수준/);
assert.match(empty, /자동 새로고침 3초/, 'the hub tells the user that progress is refreshed automatically');
assert.match(empty, /aria-label="업무 허브 탐색"/, 'the hub exposes Recent, Pinned, and project navigation');
assert.match(empty, /placeholder="작업 검색"/, 'the hub can search across server-paged task history');
assert.match(empty, /다음 작업 불러오기/, 'long histories expose an explicit server-page action');
const summarizedJob = task('running', { id: 'task-summary', prompt: `Quarterly review\n${'Long request detail. '.repeat(20)}` });
const workHubMarkup = renderToStaticMarkup(<OrchestrationPanelView {...baseProps} phase="ready" jobs={[summarizedJob]}
  pendingJobs={[]} selectedJob={null} error="" mobile={false}
  navigationPreferences={{ pinnedJobIds: [], projectNames: ['Quarterly'], projectByJobId: { 'task-summary': 'Quarterly' } }} />);
assert.match(workHubMarkup, /Quarterly review/);
assert.match(workHubMarkup, /Long request detail\./, 'a short preview retains useful context without making the full prompt the list title');
assert.match(workHubMarkup, /aria-label="작업 고정"/);
assert.match(workHubMarkup, /Quarterly review 프로젝트/);
assert.match(workHubMarkup, /class="work-hub-master-pane"/, 'task navigation, filters, and results live in one master pane');
assert.match(workHubMarkup, /class="work-hub-detail-pane"/, 'the hub reserves an adjacent detail pane for the selected task');
assert.match(workHubMarkup, /aria-label="상태별 작업 필터"/, 'the hub presents the main task states as accessible filter chips');
assert.match(workHubMarkup, /aria-label="작업 목록 열기 또는 닫기"/, 'the master pane has an accessible drawer control');
assert.match(workHubMarkup, /aria-controls="work-hub-master-pane"/, 'the drawer control points to the task master pane');

function findElement(node: React.ReactNode, predicate: (element: React.ReactElement<any>) => boolean): React.ReactElement<any> | undefined {
  for (const child of React.Children.toArray(node)) {
    if (!React.isValidElement(child)) continue;
    const element = child as React.ReactElement<any>;
    if (predicate(element)) return element;
    const nested = findElement(element.props.children, predicate);
    if (nested) return nested;
  }
  return undefined;
}

{
  let selectedStatus: string | undefined;
  const extraStatusFilter = findElement(OrchestrationPanelView({
    ...baseProps,
    phase: 'ready',
    jobs: [task('input_required')],
    pendingJobs: [],
    selectedJob: task('input_required'),
    error: '',
    mobile: false,
    listStatus: 'input_required',
    onListStatusChange: status => { selectedStatus = status; },
  }), element => element.type === 'select' && element.props['aria-label'] === '추가 상태 필터');
  assert.ok(extraStatusFilter, 'the additional status filter is rendered');
  assert.equal(extraStatusFilter.props.value, 'input_required');
  extraStatusFilter.props.onChange({ currentTarget: { value: '' } });
  assert.equal(selectedStatus, 'all', 'choosing the placeholder clears the additional status filter');
}

const selectedWorkHubMarkup = renderToStaticMarkup(<OrchestrationPanelView {...baseProps} phase="ready"
  jobs={[task('running', { id: 'task-selected', prompt: 'Refresh the approved work hub design.', tokenUsage: {
    source: 'codex.exec.jsonl.turn.completed.usage', inputTokens: 1_200, cachedInputTokens: 1_000,
    outputTokens: 240, reasoningOutputTokens: 80,
  } })]}
  pendingJobs={[]} selectedJob={task('running', { id: 'task-selected', prompt: 'Refresh the approved work hub design.', tokenUsage: {
    source: 'codex.exec.jsonl.turn.completed.usage', inputTokens: 1_200, cachedInputTokens: 1_000,
    outputTokens: 240, reasoningOutputTokens: 80,
  } })} error="" mobile={false} />);
assert.match(selectedWorkHubMarkup, /aria-label="선택한 작업 상세"/, 'selected task details are rendered inside the detail pane');
assert.match(selectedWorkHubMarkup, /<summary>사용량·비용<\/summary>/, 'usage and cost are disclosed on demand');
assert.match(selectedWorkHubMarkup, /입력 토큰/);
assert.match(selectedWorkHubMarkup, /비용 추정.*미연결/, 'cost remains explicitly unavailable without a verified price table');
assert.match(selectedWorkHubMarkup, /data-job-id="task-selected"/);

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
assert.match(promptAndTools.replace(/<[^>]+>/g, ''), /비용 추정: 미연결 \(검증된 요금표와 환율이 제공되지 않음\)/, 'the tab never invents cost without a verified price table');
assert.match(promptAndTools.replace(/<[^>]+>/g, ''), /계정 잔여량: 미연결 \(Codex CLI에서 계정 한도가 관측되지 않음\)/, 'quota remains explicit rather than inferred');

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
function panelHookHost({ effects = false } = {}) {
  type Cell = { value: unknown; dependencies?: readonly unknown[]; effect?: () => void | (() => void); pending?: boolean };
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
    useEffect(effect: () => void | (() => void), dependencies: readonly unknown[] = []) {
      const index = cursor++;
      if (!effects) return;
      const old = cells[index];
      if (!old || dependencies.length !== old.dependencies?.length
        || dependencies.some((value, n) => !Object.is(value, old.dependencies?.[n]))) {
        cells[index] = { value: old?.value, dependencies, effect, pending: true };
      }
    },
  };
  return {
    flushEffects() {
      for (const cell of cells) if (cell?.pending) {
        cell.pending = false;
        if (typeof cell.value === 'function') cell.value();
        cell.value = cell.effect?.();
      }
    },
    dispose() { for (const cell of cells) if (cell?.effect && typeof cell.value === 'function') cell.value(); },
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

{
  const calls: string[] = [];
  const rows = [task('running', { id: 'monitor-a' }), task('completed', { id: 'monitor-b' })];
  const client = createCoreOrchestrationClient(async (input, init) => {
    calls.push(`${init?.method ?? 'GET'} ${input}`);
    const url = new URL(String(input), 'http://core.test');
    return Response.json(url.pathname.endsWith('/jobs') ? { jobs: rows, providers: [provider] }
      : { job: rows.find(row => url.pathname.endsWith('/' + row.id)) });
  });
  const host = panelHookHost();
  let props = host.render(client);
  await props.onReload(); props = host.render(client);
  assert.equal(typeof props.onOpenOutputMonitor, 'function', 'the existing task view opens a read-only output monitor');
  props.onOpenOutputMonitor!(); props = host.render(client);
  assert.equal(props.outputMonitorOpen, true);
  const monitor = props.outputMonitor as React.ReactElement<{ slots: string[]; onOpenJob: (id: string) => void; onSlotsChange: (ids: string[]) => void; onClose: () => void }>;
  assert.deepEqual(monitor.props.slots.filter(Boolean), ['monitor-a', 'monitor-b']);
  monitor.props.onSlotsChange(['monitor-b', 'monitor-a']);
  monitor.props.onOpenJob('monitor-b');
  await new Promise(resolve => setImmediate(resolve)); props = host.render(client);
  assert.equal(props.outputMonitorOpen, false);
  assert.equal(props.selectedJob?.id, 'monitor-b', 'the monitor returns to the same existing job and conversation');
  props.onOpenOutputMonitor!(); props = host.render(client);
  assert.deepEqual((props.outputMonitor as typeof monitor).props.slots.filter(Boolean), ['monitor-b', 'monitor-a'], 'returning from the conversation preserves monitor selection');
  assert.equal(calls.some(call => !call.startsWith('GET ')), false, 'opening and leaving the monitor never executes or mutates a job');
  host.dispose();
}

{
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: () => null } });
  const rows = Array.from({ length: 65 }, (_, i) => task('running', { id: `paged-${i}` }));
  const calls: string[] = [];
  const client = createCoreOrchestrationClient(async input => {
    const url = new URL(String(input), 'http://core.test'); calls.push(url.pathname + url.search);
    if (url.pathname !== `${apiBasePath}/jobs`) return Response.json({ job: rows.find(row => url.pathname.endsWith('/' + row.id)) });
    const ids = url.searchParams.getAll('jobIds');
    const candidates = rows.filter(row => (!ids.length || ids.includes(row.id))
      && (!url.searchParams.has('status') || row.status === url.searchParams.get('status')));
    const start = url.searchParams.has('cursor') ? Number(url.searchParams.get('cursor')) : 0;
    const limit = Number(url.searchParams.get('limit') ?? 30);
    const jobs = candidates.slice(start, start + limit), hasMore = start + limit < candidates.length;
    return Response.json({ jobs, hasMore, ...(hasMore ? { nextCursor: String(start + limit) } : {}), providers: [provider] });
  });
  const host = panelHookHost({ effects: true });
  const settle = async () => {
    for (let i = 0; i < 4; i++) { await new Promise(resolve => setImmediate(resolve)); host.render(client); host.flushEffects(); }
    return host.render(client);
  };
  try {
    let props = host.render(client); host.flushEffects(); props = await settle();
    await props.onLoadMore?.(); props = host.render(client); host.flushEffects();
    const callsBeforeSelection = calls.length;
    await props.onSelectTask(rows[44].id); props = host.render(client); host.flushEffects(); props = await settle();
    assert.equal(props.jobs.length, 60, 'detail selection effects preserve all deliberately loaded pages');
    assert.equal(props.selectedJob?.id, rows[44].id);
    assert.equal(props.listHasMore, true);
    assert.equal(calls.slice(callsBeforeSelection).filter(call => call.startsWith(`${apiBasePath}/jobs?`)).length, 0,
      'detail selection never restarts the list query');
    rows[44] = { ...rows[44], status: 'completed' };
    await (props.onReload as (options?: { silent?: boolean }) => Promise<void>)({ silent: true });
    props = host.render(client);
    assert.equal(props.jobs.find(row => row.id === rows[44].id)?.status, 'completed', 'older loaded rows receive authoritative state updates');
    props.onListStatusChange?.('running'); props = host.render(client); host.flushEffects(); props = await settle();
    rows[0] = { ...rows[0], status: 'completed' };
    await (props.onReload as (options?: { silent?: boolean }) => Promise<void>)({ silent: true });
    props = host.render(client);
    assert.equal(props.jobs.some(row => row.id === rows[0].id), false, 'polling removes jobs that leave the active server status filter');
    assert.ok(props.jobs.every(row => row.status === 'running'));
  } finally {
    host.dispose();
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else Reflect.deleteProperty(globalThis, 'document');
  }
}

function privateConversation(job: CoreOrchestrationJob): VisibleJobConversation {
  return { selectedJobId: job.id, complete: true, turns: [{ jobId: job.id, request: job.prompt,
    response: job.result, status: job.status, createdAt: job.createdAt, progress: [], tools: [], truncated: false }] };
}

{
  const paths: string[] = [];
  const pagedClient = createCoreOrchestrationClient(async input => {
    const path = String(input);
    paths.push(path);
    const url = new URL(path, 'http://core.test');
    const hasCursor = url.searchParams.has('cursor');
    const emptySelection = url.searchParams.has('jobIds') && url.searchParams.get('jobIds') === '';
    return Response.json({
      jobs: emptySelection ? [] : url.searchParams.getAll('jobIds').length
        ? url.searchParams.getAll('jobIds').map(id => task('running', { id }))
        : [task('running', { id: hasCursor ? 'page-two' : 'page-one' })],
      hasMore: !hasCursor && !emptySelection,
      ...(hasCursor || emptySelection ? {} : { nextCursor: 'cursor-two' }),
      pendingJobs: [], pendingHasMore: false, providers: [provider], modelCatalog: teamsCliTestCatalog,
    });
  });
  const host = panelHookHost();
  let props = host.render(pagedClient);
  await (props.onReload as (options?: { silent?: boolean }) => Promise<void>)();
  props = host.render(pagedClient);
  assert.equal(props.listHasMore, true, 'the first authenticated page exposes its server continuation state');
  props.onListSearchDraftChange?.('quarterly review');
  props = host.render(pagedClient);
  props.onListSearchSubmit?.();
  props = host.render(pagedClient);
  await (props.onReload as (options?: { silent?: boolean }) => Promise<void>)();
  props = host.render(pagedClient);
  assert.match(paths.at(-1)!, /search=quarterly\+review/u, 'submitted search is sent to the principal-scoped list API');
  props.onListStatusChange?.('failed');
  props = host.render(pagedClient);
  await (props.onReload as (options?: { silent?: boolean }) => Promise<void>)();
  props = host.render(pagedClient);
  assert.match(paths.at(-1)!, /status=failed/u, 'status filtering is sent to the list API');
  await props.onLoadMore?.();
  assert.match(paths.at(-1)!, /cursor=cursor-two/u, 'load-more carries the opaque server cursor');
  props = host.render(pagedClient);
  assert.deepEqual(props.jobs.map(job => job.id), ['page-one', 'page-two'], 'loading the next page appends older history');
  await (props.onReload as (options?: { silent?: boolean }) => Promise<void>)({ silent: true });
  props = host.render(pagedClient);
  assert.deepEqual(props.jobs.map(job => job.id), ['page-one', 'page-two'], 'automatic polling preserves already loaded history pages');
  assert.equal(props.listHasMore, false, 'automatic polling preserves the continuation state at the loaded-history boundary');
  props.onListNavigate?.('pinned');
  props = host.render(pagedClient);
  await (props.onReload as (options?: { silent?: boolean }) => Promise<void>)();
  assert.match(paths.at(-1)!, /jobIds=$/u, 'an empty Pinned view remains an empty server-filtered result');
}

for (const denial of [401, 403, 404, 'auth-expired', 'forbidden'] as const) {
  const privateResult = task('completed', { id: `private-${denial}`, result: `SYNTHETIC_PRIVATE_RESULT_${denial}` });
  const lateResult = { ...privateResult, id: `late-${denial}`, result: `SYNTHETIC_LATE_PRIVATE_RESULT_${denial}` };
  let failure: typeof denial | undefined;
  let reads = 0;
  const protectedClient = createCoreOrchestrationClient(async (input) => {
    reads++;
    const list = new URL(String(input), 'http://core.test').pathname === `${apiBasePath}/jobs`;
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

for (const denial of [401, 403, 'auth-expired', 'forbidden'] as const) {
  for (const surface of ['page', 'detail', 'mutation'] as const) {
    const retained = task('completed', { id: `retained-${surface}`, result: 'SYNTHETIC_DENIED_PRIVATE_RESULT' });
    let denied = false;
    const protectedClient = createCoreOrchestrationClient(async input => {
      if (denied) {
        if (typeof denial === 'string') throw new ApiAuthError(denial);
        return Response.json({ error: 'SYNTHETIC_ACCESS_DENIED' }, { status: denial });
      }
      const list = new URL(String(input), 'http://core.test').pathname === `${apiBasePath}/jobs`;
      return Response.json(list ? { jobs: [retained], pendingJobs: [pendingApprovalJob],
        hasMore: true, nextCursor: 'next-private-page', providers: [provider] } : { job: retained });
    });
    const host = panelHookHost();
    let props = host.render(protectedClient);
    await props.onReload(); props = host.render(protectedClient);
    await props.onSelectTask(retained.id); props = host.render(protectedClient);
    denied = true;
    if (surface === 'page') await props.onLoadMore?.();
    else if (surface === 'detail') await props.onSelectTask('denied-detail');
    else await props.onCancel(retained.id);
    props = host.render(protectedClient);
    assert.deepEqual(props.jobs, [], `${surface}/${denial} clears the private list`);
    assert.equal(props.selectedJob, null, `${surface}/${denial} clears the private detail`);
    assert.equal(props.conversation, undefined, `${surface}/${denial} clears the conversation`);
    assert.deepEqual(props.pendingJobs, [], `${surface}/${denial} clears pending approvals`);
    assert.equal(props.phase, 'error', `${surface}/${denial} requires deliberate access recovery`);
    assert.doesNotMatch(renderToStaticMarkup(<OrchestrationPanelView {...props} />), /SYNTHETIC_DENIED_PRIVATE_RESULT/);
  }
}

for (const lateOutcome of ['success', 'denied'] as const) {
  const retained = task('running', { id: 'old-private-job', result: 'SYNTHETIC_OLD_ACCESS_RESULT' });
  const fresh = task('running', { id: 'new-authorized-job' });
  let denied = false;
  let recovered = false;
  let finishMutation!: () => void;
  const protectedClient = createCoreOrchestrationClient(async () => denied
    ? Response.json({ error: 'SYNTHETIC_ACCESS_DENIED' }, { status: 403 })
    : Response.json({ jobs: [recovered ? fresh : retained], providers: [provider] }));
  protectedClient.cancelJob = () => new Promise((resolve, reject) => {
    finishMutation = () => lateOutcome === 'success' ? resolve({ job: retained })
      : reject(new CoreOrchestrationClientError('old access denied', { code: 'Denied', status: 403, retryable: false }));
  });
  const host = panelHookHost();
  let props = host.render(protectedClient);
  await props.onReload(); props = host.render(protectedClient);
  const mutation = props.onCancel(retained.id);
  denied = true;
  await props.onReload(); props = host.render(protectedClient);
  assert.deepEqual(props.jobs, []);
  denied = false; recovered = true;
  await props.onReload(); props = host.render(protectedClient);
  finishMutation(); await mutation; props = host.render(protectedClient);
  assert.deepEqual(props.jobs.map(job => job.id), [fresh.id], `${lateOutcome} from a denied access generation cannot alter recovered state`);
  assert.equal(props.selectedJob, null);
  assert.equal(props.phase, 'ready');
  assert.equal(props.error, '');
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
