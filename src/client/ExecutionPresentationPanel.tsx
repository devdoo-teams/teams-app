import { ExecutionPresentationCard, ExecutionPresentationDetails, ExecutionPresentationResult } from './ExecutionPresentationCard.js';
import { JobConversationView } from './JobConversationView.js';
import { useExecutionPresentation } from './ExecutionPresentationSettings.js';
import type { VisibleJobConversation } from '../shared/job-conversation.js';
import { createExecutionPresentation } from '../shared/execution-presentation.js';
import type { CoreOrchestrationJob } from '../shared/core-orchestration.js';

/** Top-level owner settings control every job view; changing display never executes a job. */
export function ExecutionPresentationPanel({ job, conversation }: { job: CoreOrchestrationJob; conversation?: VisibleJobConversation }) {
  const { selection, available, openRich } = useExecutionPresentation();
  const presentation = createExecutionPresentation(job);
  return <section aria-label="작업 결과 표시 방식">
    {selection.mode === 'text' ? <section className="presentation-chat" aria-label="채팅 중심 작업 결과">
      <article className="presentation-user"><strong>내 요청</strong><p>{presentation.prompt}</p></article>
      <article className="presentation-assistant"><strong>업무 허브</strong><span className="badge">{presentation.statusLabel}</span>
        <ExecutionPresentationResult presentation={presentation} />
        {presentation.error ? <p role="alert" className="error">{presentation.error}</p> : null}
        <p className="presentation-progress-summary">기록된 진행 {presentation.progress.length}개</p>
        <details key={job.id}><summary>상세 펼치기 / 접기</summary>
          <ExecutionPresentationDetails presentation={presentation} details={selection.details} />
        </details>
      </article>
    </section> : selection.mode === 'summary'
      ? <ExecutionPresentationCard key={job.id} presentation={presentation} details={selection.details} />
      : <section className="presentation-workspace-entry"><h4>채팅 + 별도 상세 화면</h4>
        <span className="badge">{presentation.statusLabel}</span><ExecutionPresentationResult presentation={presentation} />
        {presentation.error ? <p role="alert" className="error">{presentation.error}</p> : null}
        <button type="button" disabled={!available.includes('rich')} onClick={() => openRich(job.id)}>같은 작업의 CopilotKit 대화 열기</button>
      </section>}
    {conversation && selection.mode !== 'text' ? <details><summary>원본 대화 기록 보기</summary>
      <JobConversationView conversation={conversation} details={selection.details} /></details> : null}
    {conversation && selection.mode === 'text' && conversation.turns.length > 1 ? <details><summary>이전 대화 보기</summary>
      <JobConversationView conversation={conversation} details={selection.details} /></details> : null}
  </section>;
}
