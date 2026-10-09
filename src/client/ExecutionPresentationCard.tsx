import type { ReactNode } from 'react';
import type { ExecutionPresentation } from '../shared/execution-presentation.js';

const toolLabels = { cli: 'CLI', skill: '스킬', plugin: '플러그인', mcp: 'MCP', builtin: '기본 도구' } as const;

/** Shared display only: this component never imports the optional SDK or sends requests. */
export function ExecutionPresentationCard({ presentation }: { presentation: ExecutionPresentation }): ReactNode {
  const receiptLabels = new Set(presentation.receiptFacts.map(fact => fact.label));
  const facts = presentation.facts.filter(fact => fact.label !== '상태' && !receiptLabels.has(fact.label));
  return (
    <article className="work-item-card execution-presentation-card" aria-label={`${presentation.title} 요약`} data-job-id={presentation.jobId}>
      <header className="work-item-card-heading">
        <h3>{presentation.title}</h3>
        <span className="badge">{presentation.statusLabel}</span>
      </header>
      {presentation.result?.trim() ? (
        <section aria-label="작업 결과">
          <h4>결과</h4>
          <pre className="execution-presentation-text">{presentation.result}</pre>
        </section>
      ) : <p>{presentation.summary}</p>}
      {presentation.error ? <p role="alert" className="execution-presentation-error">{presentation.error}</p> : null}
      <dl className="execution-presentation-facts">
        {facts.map((fact, index) => <div key={`${fact.label}-${index}`}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
      </dl>
      {presentation.receiptFacts.length ? (
        <details open className="execution-presentation-receipt">
          <summary>실행 영수증</summary>
          <dl className="execution-presentation-facts">
            {presentation.receiptFacts.map((fact, index) => <div key={`${fact.label}-${index}`}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
          </dl>
        </details>
      ) : null}
      <details className="execution-presentation-prompt">
        <summary>요청 보기</summary>
        <pre className="execution-presentation-text">{presentation.prompt || '요청이 기록되지 않았습니다.'}</pre>
      </details>
      {presentation.progress.length ? (
        <details className="execution-presentation-progress">
          <summary>최근 진행 {presentation.progress.length}개</summary>
          <ol>{presentation.progress.map((progress, index) => <li key={index}>{progress}</li>)}</ol>
        </details>
      ) : null}
      <section aria-label="관찰된 도구" className="execution-presentation-tools">
        <h4>관찰된 도구</h4>
        {presentation.tools.length ? <ul>{presentation.tools.map((tool, index) => (
          <li key={`${tool.category}-${tool.name}-${index}`}>
            <p><strong>{toolLabels[tool.category]} · {tool.name}</strong></p>
            {tool.outcome ? <pre className="execution-presentation-text">{tool.outcome}</pre> : <p>종료 결과가 관측되지 않았습니다.</p>}
            <p className="execution-presentation-observed"><time>{tool.observedAt}</time></p>
          </li>
        ))}</ul> : <p>보고된 도구 없음</p>}
      </section>
      {presentation.truncated ? <p className="execution-presentation-observed">표시 길이를 넘는 일부 내용은 생략되었습니다.</p> : null}
    </article>
  );
}
