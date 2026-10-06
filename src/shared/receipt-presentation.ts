import type { CoreOrchestrationJob } from './core-orchestration.js';
import { isAgentTokenUsage } from './token-usage-validation.js';

export type ReceiptFact = Readonly<{ label: string; value: string }>;
type ReceiptInput = Pick<CoreOrchestrationJob, 'provider' | 'model' | 'reasoningEffort' | 'executionReceipt' | 'tokenUsage'>;
const count = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const unknownObservation = '확인되지 않음 (worker 관측 없음)';

/** Read-only evidence projection. Selection is never sent/response evidence. */
export function projectReceiptFacts(job: ReceiptInput): readonly ReceiptFact[] {
  if (job.provider !== 'codex') return [];
  const receipt = job.executionReceipt;
  const usage = isAgentTokenUsage(job.tokenUsage) ? job.tokenUsage : undefined;
  return [
    { label: '선택 모델', value: job.model ?? 'CLI 기본값' },
    { label: '실제 모델', value: receipt?.model ?? unknownObservation },
    { label: '선택 추론 수준', value: job.reasoningEffort ?? 'CLI 기본값' },
    { label: '실제 추론 수준', value: receipt?.reasoningEffort ?? unknownObservation },
    { label: '전송 모델', value: '수집되지 않음' },
    { label: '전송 추론 수준', value: '수집되지 않음' },
    { label: '응답 ID', value: '수집되지 않음' },
    { label: '관측 출처', value: receipt?.source ?? '제공되지 않음' },
    { label: '관측 시각', value: receipt?.observedAt ?? '제공되지 않음' },
    { label: '사용량 출처', value: usage?.source ?? '제공되지 않음' },
    { label: '사용 토큰', value: usage ? `${count(usage.inputTokens + usage.outputTokens)} (입력 ${count(usage.inputTokens)} / 출력 ${count(usage.outputTokens)})` : '제공되지 않음' },
    ...(usage ? [
      { label: '입력 토큰', value: count(usage.inputTokens) },
      { label: '캐시 입력', value: count(usage.cachedInputTokens) },
      ...(usage.cacheWriteInputTokens !== undefined ? [{ label: '캐시 쓰기', value: count(usage.cacheWriteInputTokens) }] : []),
      { label: '출력 토큰', value: count(usage.outputTokens) },
      { label: '추론 출력', value: count(usage.reasoningOutputTokens) },
    ] : [{ label: '토큰 사용량', value: '제공되지 않음' }]),
    { label: '계정 잔여량', value: '제공되지 않음' },
  ];
}
