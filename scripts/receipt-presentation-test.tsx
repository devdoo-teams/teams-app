import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrchestrationPanelView, type OrchestrationPanelViewProps } from '../src/client/OrchestrationPanel.js';
import { JobConversationView } from '../src/client/JobConversationView.js';
import { loadJobConversation, refreshVisibleJobConversation } from '../src/client/job-conversation.js';
import { createCoreOrchestrationJobActivity } from '../src/server/genui-response.js';
import type { CoreOrchestrationJob } from '../src/shared/core-orchestration.js';

const job: CoreOrchestrationJob = {
  id: 'synthetic-receipt', provider: 'codex', prompt: 'synthetic request', mode: 'read-only', status: 'completed',
  progress: [], result: 'synthetic result', createdAt: '2026-10-06T00:00:00.000Z', model: 'selected-A', reasoningEffort: 'high',
  executionReceipt: { source: 'worker-observation', observedAt: '2026-10-06T00:01:00.000Z', model: 'observed-C', platform: 'darwin' },
  tokenUsage: { source: 'codex.exec.jsonl.turn.completed.usage', inputTokens: 0, cachedInputTokens: 0, outputTokens: 24, reasoningOutputTokens: 24 },
};
const props = { phase: 'ready', jobs: [job], providers: [], selectedJob: job, prompt: '', providerId: '', mode: 'read-only',
  modelId: '', reasoningEffort: '', inputValue: '', busyAction: '', error: '', notice: '', validationError: '', lastUpdatedAt: '', mobile: false,
} as unknown as OrchestrationPanelViewProps;

async function surfaces(current: CoreOrchestrationJob) {
  const loaded = await loadJobConversation(current.id, async () => current);
  const tab = renderToStaticMarkup(<OrchestrationPanelView {...props} selectedJob={current} />);
  const conversation = renderToStaticMarkup(<JobConversationView conversation={loaded.conversation} />);
  const card = createCoreOrchestrationJobActivity(current).attachments![0].content as any;
  const facts = card.body.flatMap((element: any) => element.facts ?? []);
  return { tab, conversation, facts, loaded };
}
const rendered = await surfaces(job);
const expected = [
  ['선택 모델', 'selected-A'], ['실제 모델', 'observed-C'], ['선택 추론 수준', 'high'],
  ['실제 추론 수준', '확인되지 않음 (worker 관측 없음)'], ['전송 모델', '수집되지 않음'],
  ['전송 추론 수준', '수집되지 않음'], ['응답 ID', '수집되지 않음'], ['관측 출처', 'worker-observation'],
  ['관측 시각', '2026-10-06T00:01:00.000Z'], ['사용량 출처', 'codex.exec.jsonl.turn.completed.usage'],
  ['입력 토큰', '0'], ['추론 출력', '24'],
  ['계정 잔여량', 'Codex CLI에서 제공되지 않음'],
];
for (const [label, value] of expected) {
  assert.equal(rendered.facts.find((fact: any) => fact.title === label)?.value, value, `actual card fact ${label}`);
  for (const html of [rendered.tab, rendered.conversation]) {
    assert.ok(html.includes(`<strong>${label}:</strong> ${value}`), `same job associates ${label}=${value} on both React surfaces`);
  }
}
const missing = { ...job, executionReceipt: undefined, tokenUsage: undefined };
const unavailable = await surfaces(missing);
for (const html of [unavailable.tab, unavailable.conversation]) {
  assert.ok(html.includes('확인되지 않음 (worker 관측 없음)'));
  assert.ok(html.includes('사용량 출처') && html.includes('제공되지 않음'));
  assert.ok(!html.includes('observed-C'));
}
assert.equal(unavailable.facts.find((fact: any) => fact.title === '사용 토큰')?.value, '제공되지 않음');
const refreshed = refreshVisibleJobConversation(rendered.loaded.conversation, missing);
assert.ok(!renderToStaticMarkup(<JobConversationView conversation={refreshed} />).includes('observed-C'), 'refresh clears prior evidence');
assert.equal(job.executionReceipt?.reasoningEffort, undefined, 'reasoning tokens never manufacture observed effort');
assert.equal((job as any).sentModel, undefined, 'presentation does not mutate raw contract');
const parent = { ...job, id: 'synthetic-parent', model: 'parent-selection', executionReceipt: undefined };
const child = { ...job, parentJobId: parent.id };
const history = await loadJobConversation(child.id, async id => id === child.id ? child : parent);
const historyHtml = renderToStaticMarkup(<JobConversationView conversation={history.conversation} />);
assert.ok(historyHtml.includes('parent-selection') && historyHtml.includes('selected-A'), 'each attempt retains its own evidence');
const badUsage = await surfaces({ ...job, tokenUsage: { ...job.tokenUsage!, source: 'untrusted', outputTokens: undefined } as any });
assert.equal(badUsage.facts.find((fact: any) => fact.title === '사용 토큰')?.value, '제공되지 않음', 'invalid telemetry must not manufacture totals');
console.log('PASS: actual tab/card/conversation share selected vs observed evidence, true zero and explicit unavailable metadata');
