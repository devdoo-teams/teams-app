import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OrchestrationPanelView, type OrchestrationPanelViewProps } from '../src/client/OrchestrationPanel.js';
import { JobConversationView } from '../src/client/JobConversationView.js';
import { loadJobConversation, refreshVisibleJobConversation } from '../src/client/job-conversation.js';
import { createCoreOrchestrationJobActivity, GenUiResponseFactory } from '../src/server/genui-response.js';
import { GenUiActionStore } from '../src/server/genui-action-store.js';
import type { CoreOrchestrationJob } from '../src/shared/core-orchestration.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CoreJobCardPages } from '../src/server/core-job-card-pages.js';

const job: CoreOrchestrationJob = {
  id: 'synthetic-receipt', provider: 'codex', prompt: 'synthetic request', mode: 'read-only', status: 'completed',
  progress: [], result: 'synthetic result', createdAt: '2026-10-06T00:00:00.000Z', model: 'selected-A', reasoningEffort: 'high',
  cliInvocationReceipt: { source: 'worker-cli-invocation', observedAt: '2026-10-10T00:00:00.000Z', modelArgument: 'argument-B', reasoningEffortArgument: 'xhigh', cliVersionStatus: 'observed', cliVersion: 'codex-cli 99.0.0-fixture' },
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
  ['실행 인자 모델', 'argument-B'], ['실행 인자 추론 수준', 'xhigh'], ['CLI 버전', 'codex-cli 99.0.0-fixture'], ['실행 인자 관측 시각', '2026-10-10T00:00:00.000Z'],
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
const missing = { ...job, executionReceipt: undefined, cliInvocationReceipt: undefined, tokenUsage: undefined };
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
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'receipt-page-summary-')));
try {
  const scope = { tenantId: 'synthetic', requesterId: 'synthetic', conversationId: 'synthetic' };
  const actionStore = new GenUiActionStore(path.join(root, 'actions.json')); await actionStore.initialize();
  const factory = new GenUiResponseFactory(actionStore);
  const durableJob = { ...job, ...scope, requesterId: scope.requesterId, conversationId: scope.conversationId, tenantId: scope.tenantId, tools: [] };
  for (const envelope of [await factory.jobStatus(durableJob), await factory.approval(durableJob), factory.approvalAccepted(durableJob), factory.cancelled(durableJob), factory.continued(durableJob), factory.naturalLanguageStarted(durableJob), factory.commitResult(durableJob), factory.started(durableJob), factory.notification({ job: durableJob, kind: 'result', message: 'fixture' } as any)]) {
    const factSections = envelope.sections.filter(section => section.type === 'facts');
    assert.ok(factSections.every(section => (section.facts?.length ?? 0) <= 24), 'each section retains the existing bound');
    const allFacts = factSections.flatMap(section => section.facts ?? []);
    for (const [label, value] of expected) assert.equal(allFacts.find(fact => fact.label === label)?.value, value, `every job envelope retains ${label}`);
  }
  const pages = new CoreJobCardPages(path.join(root, 'pages.json'), {
    getJob: () => job, update: async () => { throw new Error('no outbound during local fixture'); },
  });
  await pages.initialize();
  const prepared = await pages.create(job.id, scope, true);
  assert.ok(prepared);
  const summary = prepared.activity.attachments[0].content as any;
  const summaryFacts = summary.body.flatMap((element: any) => element.type === 'Container' ? element.items ?? [] : [element])
    .flatMap((element: any) => element.facts ?? []);
  for (const [label, value] of expected) {
    assert.equal(summaryFacts.find((fact: any) => fact.title === label)?.value, value, `actual personal summary preserves ${label}`);
  }
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('PASS: actual tab/card/conversation share selected vs observed evidence, true zero and explicit unavailable metadata');
