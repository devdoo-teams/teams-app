import { strict as assert } from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  CoreOrchestrationClientError,
  createCoreOrchestrationClient,
} from '../src/client/core-orchestration-client.js';
import {
  createOrchestrationBusyController,
  orchestrationMutationNotice,
  OrchestrationPanelView,
  validateOrchestrationSubmission,
} from '../src/client/OrchestrationPanel.js';
import type { CoreOrchestrationJob, CoreProviderFact } from '../src/shared/core-orchestration.js';

const provider: CoreProviderFact = {
  provider: 'codex',
  availability: 'available',
  capabilities: ['submit', 'cancel', 'input', 'approve', 'retry'],
  observedAt: '2026-09-03T00:59:00.000Z',
  source: 'runtime-probe',
};

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
const request = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
  const path = String(input);
  requests.push({
    path,
    method: init.method ?? 'GET',
    body: typeof init.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined,
  });
  const json = path === '/api/orchestration/jobs' && !init.method
    ? { jobs: [task('running')], providers: [provider] }
    : path === '/api/orchestration/jobs/task-1' && !init.method
      ? { job: task('input_required') }
      : { job: task('running'), replayed: path === '/api/orchestration/jobs', requestHash: 'a'.repeat(64) };
  return new Response(JSON.stringify(json), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const client = createCoreOrchestrationClient(request);
const listed = await client.listJobs();
assert.equal(listed.jobs[0]?.id, 'task-1', 'list returns the durable task identity');
assert.equal(listed.providers[0]?.availability, 'available', 'list returns measured provider availability');
assert.deepEqual(requests.at(-1), { path: '/api/orchestration/jobs', method: 'GET', body: undefined });

const detailed = await client.getJob('task-1');
assert.equal(detailed.status, 'input_required', 'detail preserves the input-required state');
assert.deepEqual(requests.at(-1), { path: '/api/orchestration/jobs/task-1', method: 'GET', body: undefined });

const submitted = await client.submitJob({
  provider: 'codex',
  mode: 'read-only',
  prompt: 'Prepare the deployment evidence.',
  idempotencyKey: 'tab-submit-1',
});
assert.equal(submitted.replayed, true, 'duplicate submission is represented without inventing a second task');
assert.deepEqual(requests.at(-1), {
  path: '/api/orchestration/jobs',
  method: 'POST',
  body: {
    provider: 'codex',
    mode: 'read-only',
    prompt: 'Prepare the deployment evidence.',
    idempotencyKey: 'tab-submit-1',
  },
}, 'submit sends no client-controlled tenant, requester, or conversation scope');

await client.cancelJob('task-1');
assert.deepEqual(requests.at(-1), {
  path: '/api/orchestration/jobs/task-1/cancel',
  method: 'POST',
  body: {},
});

await client.approveJob('task-1');
assert.deepEqual(requests.at(-1), {
  path: '/api/orchestration/jobs/task-1/approve',
  method: 'POST',
  body: {},
});

await client.provideInput('task-1', 'Use canary.');
assert.deepEqual(requests.at(-1), {
  path: '/api/orchestration/jobs/task-1/input',
  method: 'POST',
  body: { input: 'Use canary.' },
});

await client.retryJob('task-1');
assert.deepEqual(requests.at(-1), {
  path: '/api/orchestration/jobs/task-1/retry',
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
assert.equal(validateOrchestrationSubmission('Run it', 'codex', [provider]), '', 'valid input is accepted');
assert.equal(
  orchestrationMutationNotice({
    status: 'unsupported',
    job: task('input_required'),
    reason: 'agent-service-does-not-support-input',
  }, '추가 입력을 보냈습니다.'),
  '현재 제공자는 탭에서 추가 입력 재개를 지원하지 않습니다.',
  'an unsupported input response is never announced as success',
);
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
  inputValue: '',
  busyAction: '',
  notice: '',
  validationError: '',
  onPromptChange: noop,
  onProviderChange: noop,
  onModeChange: noop,
  onInputChange: noop,
  onSubmit: asyncNoop,
  onSelectTask: asyncNoop,
  onCancel: asyncNoop,
  onApprove: asyncNoop,
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
  selectedJob={null}
  error=""
  mobile={false}
/>);
assert.match(empty, /아직 실행한 작업이 없습니다/);
assert.match(empty, /작업 내용/);
assert.match(empty, /실행 제공자/);

const approval = renderToStaticMarkup(<OrchestrationPanelView
  {...baseProps}
  phase="ready"
  jobs={[task('awaiting_approval', { mode: 'workspace-write' })]}
  selectedJob={task('awaiting_approval', { mode: 'workspace-write' })}
  error=""
  mobile={false}
/>);
assert.match(approval, /승인 필요/);
assert.match(approval, />승인<\/button>/);
assert.match(approval, /계속하려면 승인이 필요합니다/);

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
  }]}
  jobs={[task('completed', { result: 'Evidence prepared.' })]}
  selectedJob={task('completed', { result: 'Evidence prepared.' })}
  error=""
  mobile
/>);
assert.match(unavailableAndMobile, /<option disabled="" value="hermes">hermes \(사용 불가\)<\/option>/);
assert.match(unavailableAndMobile, /hermes: 현재 사용할 수 없음/);
assert.match(unavailableAndMobile, /Evidence prepared/);
assert.match(unavailableAndMobile, /모바일에서 작업 제어가 원활하지 않으면 Teams 데스크톱 또는 웹 탭에서 계속하세요/);

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

console.log('Client orchestration panel tests passed');
