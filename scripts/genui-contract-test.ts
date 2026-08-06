import assert from 'node:assert/strict';

import {
  GENUI_ACTIONS,
  GENUI_ACTION_PAYLOAD_KEYS,
  GENUI_KINDS,
  GENUI_SCHEMA_VERSION,
  GenUiEnvelopeV1Schema,
} from '../src/shared/genui.js';
import {
  createAdaptiveCardActivity,
  createAdaptiveCardAttachment,
  createTextFallbackActivity,
  genUiTextFallback,
  renderGenUiCard,
} from '../src/server/genui-teams.js';

const baseAction = (action: (typeof GENUI_ACTIONS)[number], index: number) => ({
  id: `action-${index}`,
  action,
  label: action,
  entityId: 'entity-1',
  correlationId: 'correlation-1',
  actionToken: `token-${index}`,
});

const envelope = GenUiEnvelopeV1Schema.parse({
  schemaVersion: GENUI_SCHEMA_VERSION,
  kind: 'answer',
  id: 'answer-1',
  correlationId: 'correlation-1',
  title: '업무 허브',
  summary: '모바일 Teams에서 확인할 수 있는 응답입니다.',
  sections: [
    { type: 'facts', label: '상태', value: '정상' },
    {
      type: 'list',
      label: '업무',
      items: [{ label: 'GenUI 계약', value: '검증 중', status: '진행' }],
    },
    { type: 'progress', label: '진행률', progress: 0.5 },
  ],
  actions: GENUI_ACTIONS.map(baseAction),
  fallbackText: '업무 허브 응답입니다.',
});

assert.deepEqual(envelope.kind, 'answer');
assert.equal(envelope.aiGenerated, false);
assert.deepEqual(
  GenUiEnvelopeV1Schema.safeParse({ ...envelope, kind: 'not-a-kind' }).success,
  false,
);
assert.deepEqual(
  GenUiEnvelopeV1Schema.safeParse({ ...envelope, unexpected: true }).success,
  false,
);
assert.deepEqual(
  GenUiEnvelopeV1Schema.safeParse({ ...envelope, citations: [{ title: '출처', url: 'https://example.com' }] }).success,
  false,
);

for (const kind of GENUI_KINDS) {
  const parsed = GenUiEnvelopeV1Schema.parse({ ...envelope, kind });
  assert.equal(parsed.kind, kind);
}

const card = renderGenUiCard(envelope);
assert.equal(card.type, 'AdaptiveCard');
assert.equal(card.version, '1.5');
assert.equal(card.msteams.width, 'Full');
assert.ok(card.body.every((element) => element.type !== 'TextBlock' || element.wrap === true));
assert.equal(card.actions?.length, GENUI_ACTIONS.length);

for (const [index, action] of (card.actions ?? []).entries()) {
  assert.equal(action.type, 'Action.Execute');
  assert.equal((action.fallback as Record<string, unknown>).type, 'Action.Submit');
  const payload = action.data as Record<string, unknown>;
  const fallbackPayload = (action.fallback as Record<string, unknown>).data as Record<string, unknown>;
  assert.deepEqual(Object.keys(payload).sort(), [...GENUI_ACTION_PAYLOAD_KEYS].sort());
  assert.deepEqual(Object.keys(fallbackPayload).sort(), [...GENUI_ACTION_PAYLOAD_KEYS].sort());
  assert.equal(payload.action, GENUI_ACTIONS[index]);
  assert.equal(payload.schemaVersion, GENUI_SCHEMA_VERSION);
}

const aiEnvelope = GenUiEnvelopeV1Schema.parse({
  ...envelope,
  aiGenerated: true,
  citations: [{ title: 'Microsoft', url: 'https://learn.microsoft.com', snippet: 'Adaptive Cards' }],
});
const aiCard = renderGenUiCard(aiEnvelope);
assert.ok(JSON.stringify(aiCard).includes('AI 생성 콘텐츠'));
assert.ok(JSON.stringify(aiCard).includes('https://learn.microsoft.com'));
assert.ok(!JSON.stringify(card).includes('AI 생성 콘텐츠'));
assert.ok(!JSON.stringify(card).includes('https://learn.microsoft.com'));

const attachment = createAdaptiveCardAttachment(envelope);
assert.equal(attachment.contentType, 'application/vnd.microsoft.card.adaptive');
assert.equal(attachment.content.version, '1.5');
const activity = createAdaptiveCardActivity(envelope);
assert.equal(activity.type, 'message');
assert.equal(activity.attachments?.length, 1);
assert.equal(activity.attachmentLayout, 'list');
assert.equal(createTextFallbackActivity(envelope).text, '업무 허브 응답입니다.');
assert.equal(genUiTextFallback({ ...aiEnvelope, fallbackText: undefined }).includes('출처:'), true);

console.log(`GenUI contract/card tests passed: ${GENUI_KINDS.length} kinds, ${GENUI_ACTIONS.length} actions.`);
