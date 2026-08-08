import assert from 'node:assert/strict';

import {
  GENUI_ACTIONS,
  GENUI_ACTION_PAYLOAD_KEYS,
  GENUI_KINDS,
  GENUI_SCHEMA_VERSION,
  GENUI_SECTION_TYPES,
  GenUiEnvelopeV1Schema,
} from '../src/shared/genui.js';
import {
  createAdaptiveCardActivity,
  createAdaptiveCardAttachment,
  createTextFallbackActivity,
  genUiTextFallback,
  renderGenUiCard,
} from '../src/server/genui-teams.js';
import { createResponseModeCardActivity } from '../src/server/response-mode-card.js';

const baseAction = (action: (typeof GENUI_ACTIONS)[number], index: number) => ({
  id: `action-${index}`,
  action,
  label: action,
  entityId: 'entity-1',
  correlationId: 'correlation-1',
  actionToken: `token-${index}`,
});

const allSections = [
  { type: 'text', label: '설명', text: '모바일 Teams 응답입니다.' },
  { type: 'facts', label: '사실', facts: [{ label: '환경', value: '테스트' }] },
  { type: 'stats', title: '통계', stats: [{ label: '활성', value: 2 }] },
  {
    type: 'weather',
    location: '서울',
    temperature: 22,
    apparentTemperature: 22.8,
    humidity: 58,
    windSpeed: 9.4,
    precipitation: 0,
    condition: '맑음',
    icon: 'sun',
  },
  { type: 'list', label: '업무', items: [{ label: 'GenUI 계약', value: '검증 중', status: '진행' }] },
  { type: 'progress', label: '진행률', progress: 50 },
  { type: 'status', label: '상태', status: 'ready', description: '정상' },
];

const envelope = GenUiEnvelopeV1Schema.parse({
  schemaVersion: GENUI_SCHEMA_VERSION,
  kind: 'answer',
  status: 'ready',
  id: 'answer-1',
  correlationId: 'correlation-1',
  title: '업무 허브',
  summary: '모바일 Teams에서 확인할 수 있는 응답입니다.',
  sections: allSections,
  actions: GENUI_ACTIONS.map(baseAction),
  aiGenerated: true,
  citations: [{ title: 'Microsoft', url: 'https://learn.microsoft.com', snippet: 'Adaptive Cards' }],
  fallbackText: '업무 허브 응답입니다.',
});

assert.equal(envelope.schemaVersion, GENUI_SCHEMA_VERSION);
assert.equal(envelope.status, 'ready');
assert.deepEqual(GenUiEnvelopeV1Schema.safeParse({ ...envelope, schemaVersion: '2' }).success, false);
assert.deepEqual(GenUiEnvelopeV1Schema.safeParse({ ...envelope, kind: 'not-a-kind' }).success, false);
assert.deepEqual(GenUiEnvelopeV1Schema.safeParse({ ...envelope, progress: 101 }).success, false);
assert.deepEqual(
  GenUiEnvelopeV1Schema.safeParse({ ...envelope, sections: [{ type: 'progress', progress: 101 }] }).success,
  false,
);
assert.deepEqual(
  GenUiEnvelopeV1Schema.safeParse({ ...envelope, citations: [{ title: '출처', url: 'javascript:alert(1)' }] }).success,
  false,
);
assert.deepEqual(
  GenUiEnvelopeV1Schema.safeParse({ ...envelope, aiGenerated: false, citations: [] }).success,
  false,
);
assert.deepEqual(
  GenUiEnvelopeV1Schema.safeParse({
    ...envelope,
    aiGenerated: false,
    citations: [],
    actions: [baseAction('feedback', 0)],
  }).success,
  false,
);

for (const kind of GENUI_KINDS) {
  const parsed = GenUiEnvelopeV1Schema.parse({ ...envelope, kind });
  assert.equal(parsed.kind, kind);
}
assert.deepEqual(
  envelope.sections.map((section) => section.type),
  [...GENUI_SECTION_TYPES],
);

const nonAiEnvelope = GenUiEnvelopeV1Schema.parse({
  ...envelope,
  aiGenerated: false,
  citations: [],
  actions: GENUI_ACTIONS.filter((action) => action !== 'feedback').map(baseAction),
});
const card = renderGenUiCard(nonAiEnvelope);
assert.equal(card.type, 'AdaptiveCard');
assert.equal(card.version, '1.5');
assert.equal(card.msteams.width, 'Full');
assert.ok(card.body.every((element) => element.type !== 'TextBlock' || element.wrap === true));
const statusLabels: Record<string, string> = {
  loading: '로딩 중',
  ready: '준비 완료',
  empty: '데이터 없음',
  error: '오류',
  approval: '승인 필요',
  complete: '완료',
};
for (const [status, label] of Object.entries(statusLabels)) {
  const statusEnvelope = GenUiEnvelopeV1Schema.parse({
    ...nonAiEnvelope,
    id: `status-${status}`,
    status,
    sections: [{ type: 'status', label: '상태', status, description: '상태 접근성 계약' }],
    actions: [],
  });
  const statusCard = renderGenUiCard(statusEnvelope);
  const serializedStatusCard = JSON.stringify(statusCard);
  assert.ok(serializedStatusCard.includes(`상태 · ${label}`), `${status}: native card renders canonical status badge`);
  assert.equal(statusCard.speak, `상태: ${label}`, `${status}: card has accessible spoken status`);
  assert.equal(serializedStatusCard.includes(`세부 상태: ${status}`), false, `${status}: matching status section is not duplicated`);
}
assert.equal(card.actions?.length, GENUI_ACTIONS.length - 1);
assert.ok(!JSON.stringify(card).includes('AI 생성 콘텐츠'));
assert.ok(!JSON.stringify(card).includes('https://learn.microsoft.com'));

for (const [index, action] of (card.actions ?? []).entries()) {
  assert.equal(action.type, 'Action.Execute');
  assert.equal((action.fallback as Record<string, unknown>).type, 'Action.Submit');
  const payload = action.data as Record<string, unknown>;
  const fallbackPayload = (action.fallback as Record<string, unknown>).data as Record<string, unknown>;
  assert.deepEqual(Object.keys(payload).sort(), [...GENUI_ACTION_PAYLOAD_KEYS].sort());
  assert.deepEqual(Object.keys(fallbackPayload).sort(), [...GENUI_ACTION_PAYLOAD_KEYS].sort());
  assert.equal(payload.action, GENUI_ACTIONS.filter((entry) => entry !== 'feedback')[index]);
  assert.equal(payload.schemaVersion, GENUI_SCHEMA_VERSION);
}

const aiCard = renderGenUiCard(envelope);
assert.ok(JSON.stringify(aiCard).includes('AI 생성 콘텐츠'));
assert.ok(JSON.stringify(aiCard).includes('https://learn.microsoft.com'));
assert.equal(aiCard.actions?.length, GENUI_ACTIONS.length);

const attachment = createAdaptiveCardAttachment(nonAiEnvelope);
assert.equal(attachment.contentType, 'application/vnd.microsoft.card.adaptive');
assert.equal(attachment.content.version, '1.5');
const activity = createAdaptiveCardActivity(nonAiEnvelope);
assert.equal(activity.type, 'message');
assert.equal('text' in activity, false);
assert.equal(activity.attachments?.length, 1);
assert.equal(activity.attachmentLayout, 'list');
const responseModeActivity = createResponseModeCardActivity('deterministic', [
  { mode: 'deterministic', label: '결정형', configured: true },
  { mode: 'openai', label: 'OpenAI', configured: false },
]);
assert.equal(responseModeActivity.type, 'message');
assert.equal('text' in responseModeActivity, false);
assert.equal(responseModeActivity.attachments?.length, 1);
assert.equal(responseModeActivity.attachmentLayout, 'list');
const textFallback = createTextFallbackActivity(nonAiEnvelope);
assert.equal(textFallback.text, '업무 허브 응답입니다.');
assert.equal(textFallback.attachments, undefined);
assert.equal(textFallback.attachmentLayout, undefined);
assert.equal(genUiTextFallback({ ...envelope, fallbackText: undefined }).includes('출처:'), true);

console.log(`GenUI contract/card tests passed: ${GENUI_KINDS.length} kinds, ${GENUI_SECTION_TYPES.length} sections, ${GENUI_ACTIONS.length} actions.`);
