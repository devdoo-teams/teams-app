import type { ReactNode } from 'react';
import { PresentationContent, presentationTextPreview } from './PresentationContent.js';
import { EXECUTION_PRESENTATION_DETAILS, type ExecutionPresentation, type ExecutionPresentationDetail } from '../shared/execution-presentation.js';

const toolLabels = { cli: 'CLI', skill: '스킬', plugin: '플러그인', mcp: 'MCP', builtin: '기본 도구' } as const;

/** Keep the ordinary view compact without discarding the stored result. */
export function ExecutionPresentationResult({ presentation }: { presentation: ExecutionPresentation }): ReactNode {
  const result = presentation.result || presentation.summary;
  return <>{result.length > 480 ? <pre className="execution-presentation-text">{presentationTextPreview(result)}</pre>
    : <PresentationContent content={result} />}
    {result.length > 480 ? <details><summary>전체 결과 보기</summary><PresentationContent content={result} /></details> : null}</>;
}

/** Shared display only: this component never imports the optional SDK or sends requests. */
export function ExecutionPresentationDetails({ presentation, details = [...EXECUTION_PRESENTATION_DETAILS] }: {
  presentation: ExecutionPresentation; details?: readonly ExecutionPresentationDetail[];
}): ReactNode {
  return <div className="presentation-selected-details">
    {details.includes('tool') ? <section aria-label="도구 결과"><h4>도구 결과</h4>
      {presentation.tools.length ? <ul>{presentation.tools.map((tool, index) => <li key={index}>
        <strong>{toolLabels[tool.category]} · {tool.name}</strong>
        <pre>{tool.outcome || '종료 결과가 관측되지 않았습니다.'}</pre><time>{tool.observedAt}</time>
      </li>)}</ul> : <p>보고된 도구 없음</p>}</section> : null}
    {details.includes('steps') ? <section aria-label="진행 단계"><h4>진행 단계</h4>
      {presentation.progress.length ? <ol>{presentation.progress.map((progress, index) => <li key={index}>{progress}</li>)}</ol> : <p>기록된 진행 단계가 없습니다.</p>}</section> : null}
    {details.includes('diagnostics') ? <section aria-label="진단 정보"><h4>진단 정보</h4>
      <details className="presentation-diagnostics"><summary>진단 정보 펼치기 / 접기</summary>
        {presentation.facts.map((fact, index) => <p key={index}><strong>{fact.label}:</strong> {fact.value}</p>)}
        <details><summary>요청 보기</summary><pre>{presentation.prompt || '요청이 기록되지 않았습니다.'}</pre></details>
      </details>
    </section> : null}
    {!details.length ? <p>선택된 상세 항목이 없습니다.</p> : null}
  </div>;
}

export function ExecutionPresentationCard({ presentation, details = [...EXECUTION_PRESENTATION_DETAILS] }: {
  presentation: ExecutionPresentation; details?: readonly ExecutionPresentationDetail[];
}): ReactNode {
  return (
    <article className="work-item-card execution-presentation-card" aria-label={`${presentation.title} 요약`} data-job-id={presentation.jobId}>
      <header className="work-item-card-heading">
        <h3>{presentation.title}</h3>
        <span className="badge" data-job-status={presentation.status}>{presentation.statusLabel}</span>
      </header>
      {presentation.result?.trim() ? (
        <section aria-label="작업 결과">
          <h4>결과</h4>
          <ExecutionPresentationResult presentation={presentation} />
        </section>
      ) : <p>{presentation.summary}</p>}
      {presentation.error ? <p role="alert" className="execution-presentation-error">{presentation.error}</p> : null}
      <details className="execution-presentation-detail-toggle"><summary>선택한 상세 보기</summary>
        <ExecutionPresentationDetails presentation={presentation} details={details} />
      </details>
      {presentation.truncated ? <p className="execution-presentation-observed">표시 길이를 넘는 일부 내용은 생략되었습니다.</p> : null}
    </article>
  );
}
