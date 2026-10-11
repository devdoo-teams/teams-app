import assert from 'node:assert/strict';
import { createExecutionPresentationActivity } from '../src/server/execution-presentation-activity.js';
import { buildTeamsPersonalTabDeepLink } from '../src/server/teams-tab-link.js';
import type { CoreOrchestrationJob } from '../src/shared/core-orchestration.js';
const job: CoreOrchestrationJob = { id: 'synthetic-native-contract', mode: 'read-only', status: 'completed',
  prompt: '합성 업무 검토', result: '합성 검토 결과', progress: [], createdAt: '2026-10-11T00:00:00.000Z' };
const openTabUrl = buildTeamsPersonalTabDeepLink({ catalogAppId: '9b20fd94-2ac9-4423-ac1f-ff528ab245c1', tabDomain: 'synthetic.example.com' });
const plain = createExecutionPresentationActivity(job, 'text', { richEnabled: true, openTabUrl });
assert.equal(typeof (plain as any).text, 'string', 'native text mode must use a real text message');
assert.equal((plain as any).attachments, undefined, 'completed text mode has no replacement card');
assert.match((plain as any).text, /합성 검토 결과/);
const rich = createExecutionPresentationActivity(job, 'rich', { richEnabled: true, openTabUrl, richSurface: 'dialog' } as any);
const action = (rich as any).attachments?.[0]?.content?.actions?.[0];
assert.equal(action.type, 'Action.Submit');
assert.equal(action.data.msteams.type, 'task/fetch');
assert.equal(action.data.dialog_id, 'core-job-detail');
assert.equal(action.data.jobId, job.id, 'native Dialog only navigates to the same owner-authorized job');
assert.equal(action.data.url, undefined, 'caller cannot choose a foreign Dialog URL');
const longResult = 'R'.repeat(1_800);
const summaryActivity = createExecutionPresentationActivity({ ...job,
  provider: 'codex',
  prompt: '긴 합성 요청을 상세에서 확인', result: longResult,
  tokenUsage: { source: 'codex.exec.jsonl.turn.completed.usage', inputTokens: 100,
    cachedInputTokens: 40, outputTokens: 80, reasoningOutputTokens: 20 },
}, 'summary', { richEnabled: false, details: ['steps', 'diagnostics'] });
const summaryCard = (summaryActivity as any).attachments?.[0]?.content;
assert.equal(summaryCard.version, '1.6', 'Core cards declare the Teams mobile-supported Adaptive Card contract');
const summaryText = summaryCard.body.filter((item: any) => item.type === 'TextBlock').map((item: any) => item.text).join('\n');
assert.ok(!summaryText.includes(longResult), 'the collapsed card starts with a compact summary');
const nested = summaryCard.actions.find((item: any) => item.type === 'Action.ShowCard')?.card;
assert.ok(nested, 'selected execution details use the supported ShowCard action');
const nestedText = nested.body.filter((item: any) => item.type === 'TextBlock').map((item: any) => item.text).join('\n');
assert.match(nestedText, /긴 합성 요청을 상세에서 확인/);
assert.ok(nestedText.includes(longResult), 'the expanded card contains the bounded full result');
const nestedFacts = nested.body.flatMap((item: any) => item.facts ?? []);
assert.ok(nestedFacts.some((fact: any) => fact.title === '입력 토큰'));
assert.ok(nestedFacts.some((fact: any) => fact.title === '비용 추정' && fact.value.includes('미연결')));
const allowedActions = new Set(['Action.Submit', 'Action.ShowCard', 'Action.OpenUrl']);
const visitActions = (node: any): void => {
  for (const item of node.actions ?? []) {
    assert.ok(allowedActions.has(item.type), `unsupported Teams action ${item.type} is not emitted`);
    assert.notEqual(item.style, 'positive');
    assert.notEqual(item.style, 'destructive');
    if (item.card) visitActions(item.card);
  }
  for (const item of node.body ?? []) if (item.card) visitActions(item.card);
};
visitActions(summaryCard);
for (const status of ['awaiting_approval', 'failed', 'cancelled'] as const) {
  const activity = createExecutionPresentationActivity({ ...job, status }, 'text', { richEnabled: true, openTabUrl });
  assert.match((activity as any).text, new RegExp(status));
}
console.log('PASS: real native text serializer and same-job Dialog launch contract');
