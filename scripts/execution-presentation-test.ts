import assert from 'node:assert/strict';
import type { CoreOrchestrationJob } from '../src/shared/core-orchestration.js';

const implementation = await import('../src/shared/execution-presentation.js').catch(error => {
  assert.fail(`The approved three-mode execution presentation is missing: ${error.message}`);
});
const { createExecutionPresentation, ExecutionPresentationSchema, ExecutionPresentationModeSchema,
  EXECUTION_PRESENTATION_MODES, DEFAULT_EXECUTION_PRESENTATION_MODE } = implementation;

const job: CoreOrchestrationJob = {
  id: 'synthetic-job-1', prompt: 'Read the existing synthetic fixture.', provider: 'codex',
  mode: 'read-only', status: 'completed', result: '17 + 25 = 42', progress: ['Read completed.'],
  model: 'selected-model', reasoningEffort: 'xhigh', executionEnvironment: 'local-macos',
  executionReceipt: { source: 'worker-observation', observedAt: '2026-10-09T09:00:00.000Z', platform: 'darwin' },
  createdAt: '2026-10-09T08:59:00.000Z', updatedAt: '2026-10-09T09:00:00.000Z',
  tools: [{ category: 'cli', name: 'cat', observedAt: '2026-10-09T08:59:30.000Z', execution: {
    source: 'codex.exec.jsonl.command_execution', itemId: 'item-1', status: 'completed',
    exitCode: 0, output: 'values:17,25\nexpected sum:42', outputTruncated: false,
  } }],
};

assert.deepEqual(EXECUTION_PRESENTATION_MODES, ['text', 'summary', 'rich']);
assert.equal(DEFAULT_EXECUTION_PRESENTATION_MODE, 'summary');
for (const mode of EXECUTION_PRESENTATION_MODES) assert.equal(ExecutionPresentationModeSchema.safeParse(mode).success, true);
for (const mode of ['openai', 'local', 'grok', 'deterministic', '', null]) {
  assert.equal(ExecutionPresentationModeSchema.safeParse(mode).success, false, 'display choice must not become provider choice');
}
const before = structuredClone(job);
const presentation = createExecutionPresentation(job);
assert.equal(ExecutionPresentationSchema.safeParse(presentation).success, true);
assert.equal(presentation.jobId, job.id);
assert.equal(presentation.result, job.result);
assert.equal(presentation.observedPlatform, 'darwin');
assert.equal(presentation.executionEnvironment, 'local-macos');
assert.equal(presentation.facts.find(fact => fact.label === '작업 ID')?.value, job.id);
assert.equal(presentation.facts.find(fact => fact.label === '실제 환경')?.value, 'darwin');
assert.match(presentation.text, /17 \+ 25 = 42/);
assert.match(presentation.text, /expected sum:42/);
assert.match(presentation.tools[0].outcome, /exit 0/);
assert.equal(presentation.receiptFacts.find(fact => fact.label === '선택 모델')?.value, 'selected-model');
assert.equal(presentation.receiptFacts.find(fact => fact.label === '실제 모델')?.value, '확인되지 않음 (worker 관측 없음)');
assert.equal(presentation.receiptFacts.find(fact => fact.label === '실제 추론 수준')?.value, '확인되지 않음 (worker 관측 없음)');
assert.equal(presentation.receiptFacts.find(fact => fact.label === '관측 출처')?.value, 'worker-observation');
assert.deepEqual(job, before, 'projection must not change selection, result, job state or tool evidence');
assert.deepEqual(createExecutionPresentation(job), presentation, 'all three consumers can use the same deterministic projection');

const legacy = createExecutionPresentation({ ...job, model: undefined, reasoningEffort: undefined,
  executionReceipt: undefined, executionEnvironment: undefined, tools: undefined, result: undefined });
assert.equal(legacy.observedPlatform, undefined, 'configured Mac boundary is not an actual platform observation');
assert.equal(legacy.result, undefined, 'completed state without result must not invent a result');
assert.deepEqual(legacy.tools, []);
assert.match(legacy.text, /결과가 기록되지 않았습니다/);
assert.equal(legacy.receiptFacts.find(fact => fact.label === '사용 토큰')?.value, '제공되지 않음');

const withZeroUsage = createExecutionPresentation({ ...job, tokenUsage: {
  source: 'codex.exec.jsonl.turn.completed.usage', inputTokens: 0, cachedInputTokens: 0,
  outputTokens: 0, reasoningOutputTokens: 0,
} });
assert.match(withZeroUsage.receiptFacts.find(fact => fact.label === '사용 토큰')!.value, /^0 /);
const copilot = createExecutionPresentation({ ...job, provider: 'copilot', executionReceipt: undefined });
assert.deepEqual(copilot.receiptFacts, [], 'Codex metadata must not be fabricated for another provider');
assert.equal(copilot.observedPlatform, undefined);

const extended = { ...job, authToken: 'fixture-private-token', tenantId: 'fixture-private-tenant',
  tools: [{ ...job.tools![0], command: 'fixture-private-command', args: ['fixture-private-args'] }] };
const serialized = JSON.stringify(createExecutionPresentation(extended));
assert.doesNotMatch(serialized, /fixture-private-(?:token|tenant|command|args)/, 'only the public display projection may leave the job');
const bounded = createExecutionPresentation({ ...job, result: 'x'.repeat(200_000),
  progress: Array.from({ length: 100 }, () => 'p'.repeat(10_000)) });
assert.equal(ExecutionPresentationSchema.safeParse(bounded).success, true, 'large existing jobs must remain a bounded valid projection');
assert.equal(bounded.truncated, true);
assert.match(bounded.result!, /일부 생략/);
assert.throws(() => createExecutionPresentation({ ...job, id: '../foreign-job' }), /job|작업|Invalid/i);

console.log('PASS: three display modes share one bounded job/result/receipt/tool projection without changing execution evidence');
