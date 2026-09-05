import { strict as assert } from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import * as toolAdapters from '../src/client/genui/tool-adapters.js';
import {
  createApprovalResultEnvelope,
  createApprovalToolEnvelope,
  createTaskToolEnvelope,
  getGenAiBadgeLabel,
} from '../src/client/genui/tool-adapters.js';
import { GenUiEnvelopeV1Schema } from '../src/shared/genui.js';
import { GenUiCard } from '../src/client/genui/GenUiCard.js';

assert.equal(
  'createWeatherToolEnvelope' in toolAdapters,
  false,
  'optional client adapters do not expose removed weather functionality',
);

const taskParameters = {
  items: [
    { id: 1, title: '첫 업무', status: 'open' as const },
    { id: 2, title: '완료 업무', status: 'done' as const },
  ],
  total: 2,
  open: 1,
  done: 1,
};
const approvalParameters = {
  jobId: 'job-ui-test',
  prompt: '테스트 승인 경계',
  action: 'approve' as const,
};

const duplicateSectionIds = GenUiEnvelopeV1Schema.parse({
  schemaVersion: '1',
  kind: 'answer',
  status: 'ready',
  id: 'duplicate-section-ids',
  correlationId: 'duplicate-section-ids',
  title: '중복 섹션 ID 카드',
  sections: [
    { type: 'text', id: 'same-section', title: '첫 번째 섹션', text: '첫 번째 내용' },
    { type: 'text', id: 'same-section', title: '두 번째 섹션', text: '두 번째 내용' },
  ],
  actions: [],
  citations: [],
  aiGenerated: false,
  fallbackText: '중복 섹션 ID 카드',
});
const duplicateSectionMarkup = renderToStaticMarkup(React.createElement(React.Fragment, null,
  React.createElement(GenUiCard, { envelope: duplicateSectionIds }),
  React.createElement(GenUiCard, { envelope: duplicateSectionIds }),
));
const labelledByIds = [...duplicateSectionMarkup.matchAll(/aria-labelledby="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(labelledByIds).size, labelledByIds.length, 'each rendered card and section has a unique accessible label target');
for (const labelledById of labelledByIds) {
  assert.match(
    duplicateSectionMarkup,
    new RegExp(`id="${labelledById}"`),
    `aria-labelledby target ${labelledById} exists in the rendered card`,
  );
}

const loadingGenUiMarkup = renderToStaticMarkup(React.createElement(GenUiCard, { envelope: null }));
assert.match(loadingGenUiMarkup, /role="status"/);
assert.match(loadingGenUiMarkup, /aria-live="polite"/);
assert.match(loadingGenUiMarkup, /aria-atomic="true"/);

const errorWithRetry = GenUiEnvelopeV1Schema.parse({
  schemaVersion: '1',
  kind: 'error',
  status: 'error',
  id: 'error-retry',
  correlationId: 'error-retry',
  summary: '재시도할 수 있는 오류',
  sections: [],
  actions: [{
    id: 'retry',
    action: 'retry',
    label: '다시 시도',
    entityId: 'error-retry',
    correlationId: 'error-retry',
    actionToken: 'retry-token',
  }],
  citations: [],
  aiGenerated: false,
  fallbackText: '재시도할 수 있는 오류',
});
const errorMarkup = renderToStaticMarkup(React.createElement(GenUiCard, {
  envelope: errorWithRetry,
  onAction: () => undefined,
}));
assert.match(errorMarkup, /다시 시도/, 'error cards keep an actionable retry button');

assert.equal(createTaskToolEnvelope(taskParameters, 'inProgress').status, 'loading');
assert.equal(createTaskToolEnvelope(taskParameters, 'executing').status, 'loading');
const taskComplete = createTaskToolEnvelope(taskParameters, 'complete');
assert.equal(taskComplete.kind, 'task-list');
assert.equal(taskComplete.sections[0]?.type, 'list');
assert.equal(GenUiEnvelopeV1Schema.parse(taskComplete).sections.length, 2);
const malformedTask = createTaskToolEnvelope({ ...taskParameters, done: 1.5 }, 'complete');
assert.equal(malformedTask.kind, 'error');
assert.equal(malformedTask.status, 'error');

const approvalLoading = createApprovalToolEnvelope(approvalParameters, 'executing');
assert.equal(approvalLoading.status, 'loading');
assert.deepEqual(approvalLoading.actions, []);
assert.equal(createApprovalToolEnvelope(approvalParameters, 'inProgress').status, 'loading');

const approval = createApprovalToolEnvelope(approvalParameters, 'complete');
assert.equal(approval.status, 'approval');
assert.deepEqual(approval.actions, []);
const malformedApproval = createApprovalToolEnvelope({ ...approvalParameters, jobId: '' }, 'complete');
assert.equal(malformedApproval.kind, 'error');
assert.equal(malformedApproval.status, 'error');

const approvalResult = createApprovalResultEnvelope(approvalParameters, 'approve', '작업 상태: running');
assert.equal(approvalResult.kind, 'result');
assert.equal(approvalResult.status, 'complete');
assert.equal(approvalResult.actions.length, 0);
assert.equal(GenUiEnvelopeV1Schema.parse(approvalResult).kind, 'result');

const adversarialTasks = createTaskToolEnvelope({
  items: [{ id: 1.5, title: '업무'.repeat(1_000), status: 'open' }],
  total: Number.MAX_VALUE,
  open: -123.75,
  done: Number.POSITIVE_INFINITY,
}, 'complete');
assert.equal(GenUiEnvelopeV1Schema.safeParse(adversarialTasks).success, true);
assert.equal(adversarialTasks.status, 'error');

const adversarialApproval = createApprovalToolEnvelope({
  jobId: 'job'.repeat(1_000),
  prompt: '승인'.repeat(2_000),
  action: 'approve',
}, 'complete');
assert.equal(GenUiEnvelopeV1Schema.safeParse(adversarialApproval).success, true);

const clickedCancelResult = createApprovalResultEnvelope(
  { jobId: approvalParameters.jobId, prompt: approvalParameters.prompt },
  'cancel',
  '작업 상태: cancelled',
);
assert.equal(clickedCancelResult.title, '작업 취소 완료');
const clickedCancelStatus = clickedCancelResult.sections[0];
assert.equal(clickedCancelStatus?.type === 'status' ? clickedCancelStatus.status : undefined, 'cancelled');

assert.equal(getGenAiBadgeLabel('deterministic-test'), '테스트 모드');
assert.equal(getGenAiBadgeLabel('openai-configured'), 'OpenAI 연결됨');
assert.equal(getGenAiBadgeLabel('grok-configured'), 'Grok 연결됨');
assert.equal(getGenAiBadgeLabel('not-configured'), '설정 필요');
assert.equal(getGenAiBadgeLabel(undefined), '설정 필요');

console.log('Client GenUI adapter tests passed');
