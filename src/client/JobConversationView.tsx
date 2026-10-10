import type { VisibleJobConversation } from '../shared/job-conversation.js';
import { agentToolOutcomeText } from '../shared/agent-tool-presentation.js';
import { CORE_JOB_STATUS_LABELS } from '../shared/core-orchestration.js';
import { EXECUTION_PRESENTATION_DETAILS, type ExecutionPresentationDetail } from '../shared/execution-presentation.js';

export function JobConversationView({ conversation, details = [...EXECUTION_PRESENTATION_DETAILS] }: { conversation: VisibleJobConversation; details?: readonly ExecutionPresentationDetail[] }) {
  return <section aria-label="작업 대화 이력">
    <h4>선택한 작업까지의 대화</h4>
    {!conversation.complete ? <p role="status">
      {conversation.unavailableReason === 'turn-limit' ? '최근 20개 대화만 표시합니다.' : '이전 대화 일부를 불러올 수 없습니다.'}
    </p> : null}
    <ol className="work-item-list">
      {conversation.turns.map(turn => <li className="work-item-card" key={turn.jobId}>
        <p className="work-item-meta">{CORE_JOB_STATUS_LABELS[turn.status]} · {turn.createdAt} · {turn.jobId}</p>
        {turn.pendingOperation ? <p>승인 대상: {turn.pendingOperation.jobId} · revision: {turn.pendingOperation.revision}</p> : null}
        <h5>내 요청</h5>
        <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{turn.request}</p>
        {turn.response ? <><h5>에이전트 응답</h5><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{turn.response}</p></> : null}
        {turn.error ? <p className="error" role="alert">{turn.error}</p> : null}
        {!turn.response && !turn.error ? <p>저장된 최종 응답이 아직 없습니다.</p> : null}
        {details.includes('steps') && turn.progress.length ? <details><summary>진행 내역</summary><ul>{turn.progress.map((entry, index) => <li key={index}>{entry}</li>)}</ul></details> : null}
        {details.includes('tool') && turn.tools.length ? <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>관찰된 도구: {turn.tools.map(tool => `${tool.category}: ${tool.name}${agentToolOutcomeText(tool) ? ` · ${agentToolOutcomeText(tool)}` : ''}`).join('\n')}</p> : null}
        {details.includes('diagnostics') && turn.receiptFacts?.length ? <details><summary>실행 영수증</summary>
          {turn.receiptFacts.map(fact => <p key={fact.label}><strong>{fact.label}:</strong> {fact.value}</p>)}
        </details> : null}
        {turn.truncated ? <p role="note">긴 내용 일부가 생략됐습니다.</p> : null}
      </li>)}
    </ol>
    <p className="work-item-meta">원시 명령·도구 결과는 저장하지 않으며, 관측된 CLI 종료 정보와 마스킹한 출력 요약만 표시합니다.</p>
  </section>;
}
