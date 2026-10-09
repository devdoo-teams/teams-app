import type { CoreAgentToolUsage } from './core-orchestration.js';

/** Output has already been masked by the server before persistence/projection. */
export function agentToolOutcomeText(usage: CoreAgentToolUsage): string {
  if (usage.category !== 'cli') return '';
  const execution = usage.execution;
  if (!execution || execution.source !== 'codex.exec.jsonl.command_execution' || execution.status === 'in_progress') return '종료 미관측';
  const outcome = execution.status === 'declined' ? 'CLI 거부 관측'
    : execution.status === 'failed' ? 'CLI 종료 관측 · 실패' : 'CLI 종료 관측';
  const exit = typeof execution.exitCode === 'number' && Number.isInteger(execution.exitCode) ? `exit ${execution.exitCode}` : 'exit 미관측';
  const excerpt = execution.output?.split('\n').slice(0,3).join('\n').slice(0,128).trimEnd();
  return `${outcome} · ${exit}${excerpt ? `\n출력 요약: ${excerpt}${execution.outputTruncated || execution.output!.trimEnd() !== excerpt ? ' (일부 생략)' : ''}` : ''}`;
}
