import assert from 'node:assert/strict';

import {
  GENUI_ACTIONS,
  GENUI_KINDS,
  GENUI_SCHEMA_VERSION,
  GENUI_SECTION_TYPES,
  GenUiEnvelopeV1Schema,
} from '../src/shared/genui.js';
import {
  CHANNELS_SHADOW_RENDERER,
  TEAMS_CARD_BUDGET_BYTES,
  envelopeToChannelsIR,
  renderChannelsShadow,
} from '../src/server/copilot-channels-shadow.js';

const baseAction = (action: (typeof GENUI_ACTIONS)[number], index: number) => ({
  id: `action-${index}`,
  action,
  label: action,
  entityId: 'entity-1',
  correlationId: 'correlation-1',
  actionToken: `token-${index}`,
  style: action === 'cancel' ? 'destructive' as const : action === 'approve' ? 'positive' as const : 'default' as const,
});

const allSections = [
  { type: 'text', title: '설명', text: '모바일 Teams 응답입니다.' },
  { type: 'facts', title: '사실', facts: [{ label: '환경', value: '테스트' }] },
  { type: 'stats', title: '통계', stats: [{ label: '활성', value: 2 }] },
  {
    type: 'weather',
    title: '현재 날씨',
    location: '서울',
    temperature: 22,
    apparentTemperature: 22.8,
    humidity: 58,
    windSpeed: 9.4,
    precipitation: 0,
    condition: '맑음',
    source: 'Open-Meteo',
  },
  { type: 'list', title: '업무', items: [{ label: 'GenUI 계약', value: '검증 중', status: '진행' }] },
  { type: 'progress', title: '진행률', progress: 50 },
  { type: 'status', title: '상태', status: 'running', description: '정상' },
];

const envelope = GenUiEnvelopeV1Schema.parse({
  schemaVersion: GENUI_SCHEMA_VERSION,
  kind: 'answer',
  status: 'ready',
  id: 'answer-1',
  correlationId: 'correlation-1',
  title: '업무 허브',
  summary: '모바일 Teams에서 확인할 수 있는 shadow 응답입니다.',
  sections: allSections,
  actions: GENUI_ACTIONS.map(baseAction),
  aiGenerated: true,
  citations: [{ title: 'Microsoft Teams', url: 'https://learn.microsoft.com/teams', snippet: 'Adaptive Cards' }],
  metadata: { openTabUrl: 'https://example.com/workspace' },
  fallbackText: '업무 허브 응답입니다.',
});

const ir = envelopeToChannelsIR(envelope);
assert.equal(ir[0]?.type, 'message');
assert.ok(JSON.stringify(ir).includes('message'));
assert.ok(JSON.stringify(ir).includes('fields'));
assert.ok(JSON.stringify(ir).includes('actions'));
assert.ok(JSON.stringify(ir).includes(CHANNELS_SHADOW_RENDERER));

for (const kind of GENUI_KINDS) {
  const result = renderChannelsShadow(GenUiEnvelopeV1Schema.parse({ ...envelope, kind }));
  assert.equal(result.card.type, 'AdaptiveCard');
  assert.equal(result.card.version, '1.5');
  assert.equal(result.diagnostics.actionCount, 6);
  assert.equal(result.diagnostics.withinTeamsBudget, true);
  assert.ok(result.payloadBytes <= TEAMS_CARD_BUDGET_BYTES);
  assert.ok(result.plainText.includes('업무 허브'));
}

assert.deepEqual(
  envelope.sections.map((section) => section.type),
  [...GENUI_SECTION_TYPES],
);

const result = renderChannelsShadow(envelope);
const actions = result.card.actions ?? [];
assert.equal(actions.length, 6);
assert.equal(actions[0]?.type, 'Action.Submit');
assert.deepEqual((actions[0]?.data as Record<string, unknown>).value, {
  shadow: true,
  renderer: CHANNELS_SHADOW_RENDERER,
  schemaVersion: GENUI_SCHEMA_VERSION,
  id: 'action-0',
  action: 'approve',
  entityId: 'entity-1',
  correlationId: 'correlation-1',
  actionToken: 'token-0',
  style: 'positive',
});
assert.equal(actions[1]?.style, 'destructive');
assert.equal(actions[4]?.type, 'Action.OpenUrl');
assert.equal((actions[4] as Record<string, unknown>).url, 'https://example.com/workspace');
assert.ok(!JSON.stringify(actions[4]).includes('token-4'));

const unsafeUrl = renderChannelsShadow(GenUiEnvelopeV1Schema.parse({
  ...envelope,
  metadata: { openTabUrl: 'javascript:alert(1)' },
}));
assert.equal(unsafeUrl.card.actions?.[4]?.type, 'Action.Submit');
assert.ok(!JSON.stringify(unsafeUrl.card).includes('javascript:alert(1)'));

const missingFields = renderChannelsShadow(GenUiEnvelopeV1Schema.parse({
  ...envelope,
  title: undefined,
  summary: undefined,
  actions: [],
}));
assert.equal(missingFields.diagnostics.missingTitle, true);
assert.equal(missingFields.diagnostics.missingSummary, true);
assert.ok(missingFields.card.body.length > 0);

const longText = '긴 텍스트 '.repeat(500);
const longEnvelope = GenUiEnvelopeV1Schema.parse({
  ...envelope,
  title: '긴 제목 '.repeat(30),
  summary: '긴 요약 '.repeat(300),
  sections: Array.from({ length: 32 }, (_, index) => ({
    type: 'text',
    title: `섹션 ${index}`,
    text: longText,
  })),
});
const longResult = renderChannelsShadow(longEnvelope);
assert.equal(longResult.diagnostics.withinTeamsBudget, true);
assert.ok(longResult.payloadBytes <= TEAMS_CARD_BUDGET_BYTES);

console.log(`Channels shadow tests passed: ${GENUI_KINDS.length} kinds, ${GENUI_SECTION_TYPES.length} sections, ${GENUI_ACTIONS.length} actions, ${result.payloadBytes} bytes.`);
