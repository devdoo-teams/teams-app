import { strict as assert } from 'node:assert';

import {
  createApprovalResultEnvelope,
  createApprovalToolEnvelope,
  createTaskToolEnvelope,
  createWeatherToolEnvelope,
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

const weatherComplete = createWeatherToolEnvelope(weatherParameters, 'complete', '도구 응답');
assert.equal(GenUiEnvelopeV1Schema.parse(weatherComplete).status, 'ready');
assert.equal(weatherComplete.sections.length, 2);

const taskComplete = createTaskToolEnvelope(taskParameters, 'complete');
assert.equal(taskComplete.kind, 'task-list');
assert.equal(taskComplete.sections[0]?.type, 'list');
assert.equal(GenUiEnvelopeV1Schema.parse(taskComplete).sections.length, 2);

const approvalLoading = createApprovalToolEnvelope(approvalParameters, 'executing');
assert.equal(approvalLoading.status, 'loading');
assert.deepEqual(approvalLoading.actions, []);

const approval = createApprovalToolEnvelope(approvalParameters, 'complete');
assert.equal(approval.status, 'approval');
assert.deepEqual(approval.actions, []);

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
const adversarialWeatherSection = adversarialWeather.sections[0];
assert.equal(adversarialWeatherSection?.type, 'weather');
if (adversarialWeatherSection?.type === 'weather') {
  assert.equal(adversarialWeatherSection.humidity, 100);
  assert.equal(adversarialWeatherSection.windSpeed, 0);
  assert.equal(adversarialWeatherSection.precipitation, 0);
  assert.equal(adversarialWeatherSection.apparentTemperature, undefined);
}

const adversarialTasks = createTaskToolEnvelope({
  items: [{ id: 1.5, title: '업무'.repeat(1_000), status: 'open' }],
  total: Number.MAX_VALUE,
  open: -123.75,
  done: Number.POSITIVE_INFINITY,
}, 'complete');
assert.equal(GenUiEnvelopeV1Schema.safeParse(adversarialTasks).success, true);
assert.equal(adversarialTasks.status, 'loading');
const adversarialTaskSection = adversarialTasks.sections[0];
if (adversarialTaskSection?.type === 'list') {
  assert.equal(typeof adversarialTaskSection.items[0]?.id, 'string');
  assert.equal(adversarialTaskSection.items[0]?.label.length, 400);
}

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

console.log('Client GenUI adapter tests passed');
