import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createExecutionPresentation } from '../src/shared/execution-presentation.js';
import type { CoreOrchestrationJob } from '../src/shared/core-orchestration.js';
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === '@microsoft/teams-js') return { format: 'module', shortCircuit: true,
    url: 'data:text/javascript,export const app={isInitialized:()=>false}; export const authentication={};' };
  return nextResolve(specifier, context);
} });
const module = await import('../src/client/WorkOutputMonitor.js').catch(() => ({} as Record<string, any>));
assert.equal(typeof module.WorkOutputMonitorView, 'function', 'the same read-only output view supports split and mobile layouts');
const monitor = await import('../src/client/work-output-monitor.js');
hooks.deregister();
const jobs: CoreOrchestrationJob[] = Array.from({ length: 4 }, (_, index) => ({
  id: `task-${index + 1}`, status: index ? 'completed' : 'running', prompt: '합성 요청 · 한글 줄바꿈과 긴 작업 이력',
  mode: 'read-only', provider: 'codex', progress: ['서버에 저장된 진행'], result: index ? '기록된 최종 응답' : undefined,
  createdAt: '2026-10-14T00:00:00Z', tools: [{ category: 'cli', name: 'CLI 실행', observedAt: '2026-10-14T00:00:01Z',
    execution: { source: 'codex.exec.jsonl.command_execution', itemId: 'item_1', status: 'completed', exitCode: 0,
      output: '합성 출력 [REDACTED]', outputTruncated: true } }],
}));
const props = { slots: jobs.map(job => job.id), layout: 4, activeSlot: 2, jobs,
  snapshot: { key: jobs.map(job => job.id).join('|'), phase: 'ready', entries: Object.fromEntries(jobs.map(job =>
    [job.id, { status: 'ready', presentation: createExecutionPresentation(job), checkedAt: '2026-10-14T00:00:02Z' }])) },
  onSlotsChange() {}, onLayoutChange() {}, onActiveSlotChange() {}, onOpenJob() {}, onClose() {}, onRefresh() {},
};
const render = (overrides: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(module.WorkOutputMonitorView, { ...props, ...overrides }));
const desktop = render();
assert.equal((desktop.match(/data-output-monitor-slot="/g) ?? []).length, 4);
assert.ok(desktop.includes('현재 출력 조회'), 'the UI labels polling rather than claiming a live terminal');
assert.ok(desktop.includes('PTY·실시간 스트림이 아닙니다'));
assert.ok(desktop.includes('3초')); assert.ok(desktop.includes('합성 출력 [REDACTED]'));
assert.ok(desktop.includes('task-3')); assert.ok(desktop.includes('같은 작업의 상세·대화'));
assert.equal((desktop.match(/<textarea/g) ?? []).length, 0, 'the monitor exposes no shell/composer input');
assert.equal(desktop.includes('작업 시작'), false);
assert.match(render({ snapshot: { ...props.snapshot, key: 'previous-selection' } }), /<button[^>]*disabled=""[^>]*>출력 새로고침/, 'refresh waits for the reader matching the current selection');
const two = render({ layout: 2 });
assert.equal((two.match(/data-output-monitor-slot="/g) ?? []).length, 2);
assert.equal((render({ mobile: true }).match(/data-output-monitor-slot="[0-9]+"[^>]* hidden=""/g) ?? []).length, 3);
assert.equal((render({ mobile: true }).match(/<button[^>]*role="tab"[^>]*tabindex="-1"/g) ?? []).length, 3, 'only the selected mobile tab is in the keyboard tab order');
const failed = render({ snapshot: { ...props.snapshot, entries: { 'task-1': { status: 'missing' }, 'task-2': { status: 'error' } } } });
assert.ok(failed.includes('찾을 수 없거나 접근 권한이 없는 작업'));
assert.ok(failed.includes('조회에 실패했습니다'));
assert.equal(failed.includes('합성 출력'), false, 'failed reads never display the previous output');
const blocked = render({ snapshot: { ...props.snapshot, phase: 'blocked', entries: {} } });
assert.equal(blocked.includes('합성 출력'), false); assert.ok(blocked.includes('다시 인증'));
assert.equal(blocked.includes('합성 요청'), false, 'access denial also removes private job labels from selectors');
const empty = render({ slots: [], snapshot: { key: '', phase: 'ready', entries: {} } });
assert.equal((empty.match(/조회할 기존 작업을 선택하세요/g) ?? []).length, 4);
assert.equal(empty.includes('output-monitor-output'), false, 'empty slots neither display old output nor start jobs');
const ptyObservation = React.createElement('section', { 'data-pty-slot-observation': true }, 'PTY 혼합 출력 FAKE_COMPLETE');
const combined = render({ ptyObservation });
assert.equal((combined.match(/data-pty-slot-observation="true"/g) ?? []).length, 1,
  'an injected PTY observation is rendered only inside the first Core slot');
assert.ok(combined.includes('FAKE_COMPLETE'));
assert.equal((combined.match(/data-job-status="running"/g) ?? []).length, 1,
  'observation text must not turn the Core running status into completion');
assert.equal(render({ ptyObservation, snapshot: { ...props.snapshot, phase: 'blocked', entries: {} } }).includes('FAKE_COMPLETE'), false);
assert.equal(render({ ptyObservation, snapshot: { ...props.snapshot, key: 'stale-selection' } }).includes('FAKE_COMPLETE'), false);
assert.equal(render({ ptyObservation, snapshot: { ...props.snapshot, entries: { 'task-1': { status: 'missing' } } } }).includes('FAKE_COMPLETE'), false);
const loading = render({ snapshot: { key: props.snapshot.key, phase: 'loading', entries: {} } });
assert.ok(loading.includes('aria-busy="true"')); assert.ok(loading.includes('저장된 출력을 조회 중'));

const commandOutput = '합성 저장 출력 '.repeat(35) + '끝까지-펼쳐보기';
const observedJob = { ...jobs[0], tools: [
  { category: 'cli', name: 'cat', observedAt: '2026-10-14T00:00:01Z', execution: {
    source: 'codex.exec.jsonl.command_execution', itemId: 'item_1', status: 'completed', exitCode: 0, output: commandOutput, outputTruncated: false,
  } },
  { category: 'cli', name: 'sleep', observedAt: '2026-10-14T00:00:02Z', execution: {
    source: 'codex.exec.jsonl.command_execution', itemId: 'item_2', status: 'in_progress',
  } },
] } as CoreOrchestrationJob;
const entries = { 'task-1': { status: 'ready', presentation: createExecutionPresentation(observedJob),
  commands: monitor.projectOutputMonitorCommands(observedJob), checkedAt: '2026-10-14T00:00:03Z' } };
const expanded = render({ snapshot: { ...props.snapshot, connection: 'connected', entries } });
assert.ok(expanded.includes('CLI 마스킹 출력 펼치기'), 'existing safe CLI excerpts can be inspected beyond the128-character summary');
assert.ok(expanded.includes('끝까지-펼쳐보기'));
assert.ok(expanded.includes('CLI 실행 중 · 종료 미관측'));
assert.ok(expanded.includes('CLI 종료 관측 · exit 0'));
assert.match(expanded, /data-job-status="running"/, 'a terminal command never completes the Core job');
assert.ok(expanded.includes('자동 조회 일시정지'));
const paused = render({ snapshot: { ...props.snapshot, connection: 'paused', entries } });
assert.ok(paused.includes('자동 조회 일시정지 중 · 마지막 조회 자료'));
assert.match(paused, /<button[^>]*disabled=""[^>]*>출력 새로고침/);
assert.ok(paused.includes('같은 작업 다시 조회'));
assert.ok(paused.includes('끝까지-펼쳐보기'), 'paused output remains clearly labeled as the last read');
const pausedEmpty = render({ snapshot: { ...props.snapshot, connection: 'paused', entries: {} } });
assert.ok(pausedEmpty.includes('조회가 일시정지되어 있습니다'));
assert.equal(pausedEmpty.includes('저장된 출력을 조회 중입니다'), false);
assert.equal(render({ snapshot: { ...props.snapshot, phase: 'blocked', entries } }).includes('끝까지-펼쳐보기'), false);
assert.equal(render({ snapshot: { ...props.snapshot, key: 'previous-selection', entries } }).includes('끝까지-펼쳐보기'), false);
const pausedFailure = render({ snapshot: { ...props.snapshot, connection: 'paused', entries: { 'task-1': { status: 'error' } } } });
assert.equal(pausedFailure.includes('3초 뒤 다시 조회'), false, 'a paused observer must not promise a scheduled retry');
assert.ok(pausedFailure.includes('같은 작업 다시 조회로 재시도'));
const escapedJob = { ...observedJob, tools: [{ ...observedJob.tools![0], execution: { ...observedJob.tools![0].execution!,
  output: '<script>window.privateFixture = true</script>',
} }] };
const escaped = render({ snapshot: { ...props.snapshot, entries: { 'task-1': { ...entries['task-1'], commands: monitor.projectOutputMonitorCommands(escapedJob) } } } });
assert.ok(escaped.includes('&lt;script&gt;'));
assert.equal(escaped.includes('<script>window.privateFixture'), false, 'saved output remains text nodes');
const style = await readFile(new URL('../src/client/work-output-monitor.css', import.meta.url), 'utf8').catch(() => '');
assert.match(style, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
assert.match(style, /max-width:\s*760px/);
assert.match(style, /data-mobile-active="false"/);
console.log('Work output monitor UI: PASS (2/4 panels, mobile selection, safe output, loading/missing/error/auth, same-job navigation)');
