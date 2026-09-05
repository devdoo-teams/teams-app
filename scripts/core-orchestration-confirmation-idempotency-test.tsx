import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  createOrchestrationBusyController,
  createSubmissionIdempotencyController,
  OrchestrationPanelView,
} from '../src/client/OrchestrationPanel.js';
import {
  createCoreOrchestrationConfirmationActivity,
  createCoreOrchestrationJobActivity,
} from '../src/server/genui-response.js';
import type { CoreOrchestrationJob, CoreProviderFact } from '../src/shared/core-orchestration.js';

const request = {
  prompt: '배포 상태를 점검해줘',
  provider: 'codex' as const,
  mode: 'read-only' as const,
};
const issued: string[] = [];
const keys = createSubmissionIdempotencyController(() => {
  const key = `stable-key-${issued.length + 1}`;
  issued.push(key);
  return key;
});

const firstKey = keys.keyFor(request);
assert.equal(keys.keyFor(request), firstKey, 'an ambiguous response-loss retry reuses the same logical request key');
assert.equal(issued.length, 1, 'retry does not allocate a second key');

const changedKey = keys.keyFor({ ...request, prompt: '배포 상태와 로그를 점검해줘' });
assert.notEqual(changedKey, firstKey, 'a material prompt change rotates the logical request key');
assert.equal(keys.keyFor({ ...request, prompt: '  배포 상태와 로그를 점검해줘  ' }), changedKey, 'trim-only edits preserve the logical request key');

keys.complete({ ...request, prompt: '배포 상태와 로그를 점검해줘' }, changedKey);
assert.notEqual(keys.keyFor({ ...request, prompt: '배포 상태와 로그를 점검해줘' }), changedKey, 'a definitive outcome rotates the next submission key');

{
  const busy = createOrchestrationBusyController();
  let release!: () => void;
  let mutations = 0;
  const firstConfirmation = busy.run('approval:job-confirm-1', async () => {
    mutations += 1;
    await new Promise<void>((resolve) => { release = resolve; });
  });
  const duplicateConfirmation = await busy.run('approval:job-confirm-1', async () => {
    mutations += 1;
  });
  assert.equal(duplicateConfirmation, undefined, 'a duplicate second confirmation is ignored while the mutation is in flight');
  assert.equal(mutations, 1, 'only one confirmed mutation reaches the client boundary');
  release();
  await firstConfirmation;
}

const provider: CoreProviderFact = {
  provider: 'codex',
  availability: 'available',
  capabilities: ['submit', 'cancel', 'approve'],
  observedAt: '2026-09-03T00:00:00.000Z',
  source: 'runtime-probe',
};
const job = (status: CoreOrchestrationJob['status']): CoreOrchestrationJob => ({
  id: 'job-confirm-1',
  idempotencyKey: 'job-confirm-idem',
  prompt: '배포 상태를 점검해줘',
  provider: 'codex',
  mode: status === 'awaiting_approval' ? 'workspace-write' : 'read-only',
  status,
  progress: [],
  createdAt: '2026-09-03T00:00:00.000Z',
});
const noop = () => undefined;
const baseProps = {
  phase: 'ready' as const,
  providers: [provider],
  prompt: '',
  providerId: 'codex',
  mode: 'read-only' as const,
  inputValue: '',
  busyAction: '',
  error: '',
  notice: '',
  validationError: '',
  mobile: false,
  onPromptChange: noop,
  onProviderChange: noop,
  onModeChange: noop,
  onInputChange: noop,
  onSubmit: noop,
  onSelectTask: noop,
  onCancel: noop,
  onApprove: noop,
  onProvideInput: noop,
  onRetryTask: noop,
  onReload: noop,
  onRequestConfirmation: noop,
  onDismissConfirmation: noop,
};

const approvalConfirmation = renderToStaticMarkup(<OrchestrationPanelView
  {...baseProps}
  jobs={[job('awaiting_approval')]}
  pendingConfirmation={{ kind: 'approve', jobId: 'job-confirm-1' }}
  selectedJob={job('awaiting_approval')}
/>);
assert.match(approvalConfirmation, /승인 확인/);
assert.match(approvalConfirmation, /돌아가기/);
assert.match(approvalConfirmation, /실행하기 전에 승인 여부를 다시 확인합니다/);

const cancellationConfirmation = renderToStaticMarkup(<OrchestrationPanelView
  {...baseProps}
  jobs={[job('running')]}
  pendingConfirmation={{ kind: 'cancel', jobId: 'job-confirm-1' }}
  selectedJob={job('running')}
/>);
assert.match(cancellationConfirmation, /취소 확인/);
assert.match(cancellationConfirmation, /작업 취소 요청을 보내기 전에 다시 확인합니다/);

type Card = { actions?: Array<Record<string, unknown>>; attachments?: Array<{ content: Card }> };
const payloadActions = (activity: Card) => (activity.attachments?.[0]?.content.actions ?? [])
  .map((action) => action.data as Record<string, unknown> | undefined)
  .filter((value): value is Record<string, unknown> => Boolean(value));

assert.deepEqual(
  payloadActions(createCoreOrchestrationJobActivity(job('awaiting_approval'))),
  [
    { schemaVersion: '1', action: 'orchestration.confirm-approve', jobId: 'job-confirm-1' },
    { schemaVersion: '1', action: 'orchestration.confirm-cancel', jobId: 'job-confirm-1' },
  ],
  'the first chat click emits only confirmation requests, never mutations',
);

const confirmation = {
  confirmation: {
    action: 'approve' as const,
    token: 'opaque-confirmation-token',
    correlationId: 'confirmation-correlation-1',
  },
};
const approveCard = createCoreOrchestrationConfirmationActivity(job('awaiting_approval'), 'approve', confirmation);
assert.equal('text' in approveCard, false, 'confirmation remains attachment-only');
assert.equal(approveCard.attachments[0].content.version, '1.6');
assert.deepEqual(payloadActions(approveCard), [
  {
    schemaVersion: '1',
    action: 'orchestration.approve',
    jobId: 'job-confirm-1',
    confirmationToken: 'opaque-confirmation-token',
    correlationId: 'confirmation-correlation-1',
  },
  { schemaVersion: '1', action: 'orchestration.dismiss-confirmation', jobId: 'job-confirm-1' },
]);

const cancelCard = createCoreOrchestrationConfirmationActivity(job('running'), 'cancel', {
  confirmation: {
    action: 'cancel',
    token: 'opaque-cancel-token',
    correlationId: 'confirmation-correlation-2',
  },
});
assert.deepEqual(payloadActions(cancelCard), [
  {
    schemaVersion: '1',
    action: 'orchestration.cancel',
    jobId: 'job-confirm-1',
    confirmationToken: 'opaque-cancel-token',
    correlationId: 'confirmation-correlation-2',
  },
  { schemaVersion: '1', action: 'orchestration.dismiss-confirmation', jobId: 'job-confirm-1' },
]);

console.log('core-orchestration-confirmation-idempotency-test: PASS');
