import { strict as assert } from 'node:assert';

import {
  createApprovalResultEnvelope,
  createApprovalToolEnvelope,
  createTaskToolEnvelope,
  createWeatherToolEnvelope,
  getGenAiBadgeLabel,
} from '../src/client/genui/tool-adapters.js';
import { GenUiEnvelopeV1Schema } from '../src/shared/genui.js';

const weatherParameters = {
  location: '서울',
  temperature: 22,
  apparentTemperature: 22.8,
  humidity: 58,
  windSpeed: 9.4,
  precipitation: 0,
  condition: '맑음',
  source: 'open-meteo',
};
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

const weatherLoading = createWeatherToolEnvelope(weatherParameters, 'inProgress');
assert.equal(weatherLoading.status, 'loading');
assert.equal(weatherLoading.kind, 'weather');
assert.deepEqual(weatherLoading.actions, []);
assert.equal(createWeatherToolEnvelope(weatherParameters, 'executing').status, 'loading');

const weatherComplete = createWeatherToolEnvelope(weatherParameters, 'complete', '도구 응답');
assert.equal(GenUiEnvelopeV1Schema.parse(weatherComplete).status, 'ready');
assert.equal(weatherComplete.sections.length, 2);
const malformedWeather = createWeatherToolEnvelope({ ...weatherParameters, temperature: Number.NaN }, 'complete');
assert.equal(malformedWeather.kind, 'error');
assert.equal(malformedWeather.status, 'error');
assert.equal(malformedWeather.sections[0]?.type, 'status');

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

const adversarialWeather = createWeatherToolEnvelope({
  location: '위'.repeat(10_000),
  temperature: Number.MAX_VALUE,
  apparentTemperature: Number.NEGATIVE_INFINITY,
  humidity: 1_000,
  windSpeed: -5,
  precipitation: -1,
  condition: '상태'.repeat(1_000),
  source: '출처'.repeat(1_000),
}, 'complete');
assert.equal(GenUiEnvelopeV1Schema.safeParse(adversarialWeather).success, true);
assert.equal(adversarialWeather.kind, 'error');
assert.equal(adversarialWeather.status, 'error');

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
assert.equal(getGenAiBadgeLabel('openai-configured'), 'GenAI 연결됨');
assert.equal(getGenAiBadgeLabel('not-configured'), '설정 필요');
assert.equal(getGenAiBadgeLabel(undefined), '설정 필요');

console.log('Client GenUI adapter tests passed');
