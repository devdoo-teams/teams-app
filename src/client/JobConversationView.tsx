import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { VisibleJobConversation } from '../shared/job-conversation.js';
import { agentToolOutcomeText } from '../shared/agent-tool-presentation.js';
import { CORE_JOB_STATUS_LABELS, type CoreOrchestrationJob } from '../shared/core-orchestration.js';
import { EXECUTION_PRESENTATION_DETAILS, type ExecutionPresentationDetail } from '../shared/execution-presentation.js';
import { createCoreOrchestrationClient } from './core-orchestration-client.js';
import { createConversationHistoryViewCache, isConversationHistoryAccessFailure, loadEarlierJobConversation, mergeVisibleJobConversation } from './job-conversation.js';
import { PresentationContent } from './PresentationContent.js';
import { snapshotConversationReadingPosition, restoreConversationReadingPosition, type ConversationReadingPosition } from './conversation-reading-position.js';

type JobConversationViewProps = {
  conversation: VisibleJobConversation;
  details?: readonly ExecutionPresentationDetail[];
  getJob?: (id: string, signal?: AbortSignal) => Promise<CoreOrchestrationJob>;
};
const defaultGetJob = createCoreOrchestrationClient().getJob;
// Exact authorized prop-object scope, without persistent or owner-less storage.
// Mode switches reuse history; a new authenticated response starts a new scope.
const viewState = createConversationHistoryViewCache();

export function JobConversationView(props: JobConversationViewProps) {
  return <JobConversationHistory key={props.conversation.selectedJobId} {...props} />;
}

function JobConversationHistory({ conversation, details = EXECUTION_PRESENTATION_DETAILS, getJob = defaultGetJob }: JobConversationViewProps) {
  const cached = viewState.read(conversation);
  const [loaded, setLoaded] = useState<{ source: VisibleJobConversation; conversation: VisibleJobConversation } | undefined>(
    cached?.conversation ? { source: conversation, conversation: cached.conversation } : undefined);
  const shown = useMemo(() => loaded ? loaded.source === conversation ? loaded.conversation
    : mergeVisibleJobConversation(loaded.conversation, conversation) : conversation, [loaded, conversation]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [accessBlocked, setAccessBlocked] = useState(cached?.accessBlocked ?? false);
  const [notice, setNotice] = useState('');
  const region = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const reading = useRef<ConversationReadingPosition | undefined>(cached?.position);
  const statusId = useId();

  function readPosition(followEnd = true) {
    const element = region.current;
    if (!element || accessBlocked) return;
    const top = element.getBoundingClientRect().top;
    const anchor = Array.from(element.querySelectorAll<HTMLElement>('[data-conversation-turn]')).find(turn => turn.getBoundingClientRect().bottom > top);
    const position = snapshotConversationReadingPosition(element,
      anchor ? { jobId: anchor.dataset.conversationTurn!, offset: anchor.getBoundingClientRect().top - top } : undefined);
    if (position) {
      reading.current = followEnd ? position : { ...position, wasAtEnd: false };
      viewState.remember(conversation, { conversation: shown, position: reading.current });
    }
  }
  function restorePosition() {
    const element = region.current;
    if (!element || element.clientHeight <= 0 || !reading.current) return;
    const anchor = reading.current.anchor;
    const turn = anchor ? Array.from(element.querySelectorAll<HTMLElement>('[data-conversation-turn]')).find(item => item.dataset.conversationTurn === anchor.jobId) : undefined;
    const offset = turn ? turn.getBoundingClientRect().top - element.getBoundingClientRect().top : undefined;
    element.scrollTop = restoreConversationReadingPosition(reading.current, element, offset);
  }
  useLayoutEffect(() => {
    restorePosition(); readPosition();
    viewState.remember(conversation, { conversation: shown, position: reading.current });
  }, [shown, conversation, details]);
  useEffect(() => {
    const element = region.current, list = element?.firstElementChild;
    if (!element || !list || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { restorePosition(); readPosition(); });
    observer.observe(element); observer.observe(list);
    return () => observer.disconnect();
  }, [shown, conversation]);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
  useEffect(() => { setAccessBlocked(viewState.read(conversation)?.accessBlocked ?? false); }, [conversation]);

  async function loadEarlier() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const timer = setTimeout(() => controller.abort(), 30_000);
    readPosition(false); setLoading(true); setError('');
    try {
      const next = await loadEarlierJobConversation(shown, getJob, controller.signal);
      if (request.current !== controller) return;
      viewState.authorize(conversation, { conversation: next, position: reading.current });
      setLoaded({ source: conversation, conversation: next }); setAccessBlocked(false);
      setNotice(`이전 대화 ${next.turns.length - shown.turns.length}개를 불러왔습니다. 총 ${next.turns.length}개 대화입니다.`);
    } catch (caught) {
      if (request.current !== controller) return;
      if (isConversationHistoryAccessFailure(caught)) {
        viewState.block(conversation); setLoaded(undefined); setAccessBlocked(true);
        setError('대화 접근 권한을 확인할 수 없습니다. Teams 인증 상태를 확인한 후 다시 시도하세요.');
      } else setError(controller.signal.aborted ? '이전 대화 조회 시간이 초과됐습니다. 다시 시도하세요.' : '이전 대화를 불러오지 못했습니다. 읽던 대화는 유지됩니다. 다시 시도하세요.');
    } finally {
      clearTimeout(timer);
      if (request.current === controller) { request.current = null; setLoading(false); }
    }
  }
  const canLoadEarlier = !shown.complete && shown.unavailableReason !== 'invalid-chain' && shown.turns.length > 0;
  return <section className="job-conversation-history" aria-label="작업 대화 이력" lang="ko">
    <h4>선택한 작업까지의 대화</h4>
    <div className="job-conversation-controls">
      {canLoadEarlier ? <button type="button" onClick={() => void loadEarlier()} disabled={loading} aria-controls={`${statusId}-history`}>
        {loading ? '이전 대화 불러오는 중…' : shown.unavailableReason === 'previous-turn-unavailable' || error ? '이전 대화 다시 불러오기' : '이전 대화 불러오기'}
      </button> : null}
      {!accessBlocked && shown.turns.length > 1 ? <button type="button" onClick={() => {
        const element = region.current;
        if (element) { element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight); element.focus({ preventScroll: true }); readPosition(); }
      }}>최신 대화로 이동</button> : null}
    </div>
    <p id={statusId} role="status" aria-live="polite" aria-atomic="true">{loading ? '이전 대화를 조회하고 있습니다.' : notice || `불러온 대화 ${shown.turns.length}개`}</p>
    {!shown.complete ? <p role="note">
      {shown.unavailableReason === 'turn-limit' ? '이전 대화는 20개씩 추가로 불러올 수 있습니다.' : shown.unavailableReason === 'invalid-chain'
        ? '대화 연결 정보를 확인할 수 없어 이전 대화 조회를 중단했습니다.' : '이전 대화 일부를 불러올 수 없습니다. 다시 불러오기를 시도할 수 있습니다.'}
    </p> : null}
    {error ? <p className="error" role="alert">{error}</p> : null}
    <div id={`${statusId}-history`} ref={region} className="job-conversation-reader" role="region" aria-label="대화 기록 읽기" tabIndex={0}
      aria-describedby={statusId} aria-busy={loading} onScroll={() => readPosition()}
      style={{ maxHeight: 'min(70vh, 720px)', overflowY: 'auto', overflowAnchor: 'none', minWidth: 0, overflowWrap: 'anywhere' }}>
    <ol className="work-item-list">
      {(accessBlocked ? [] : shown.turns).map(turn => <li className="work-item-card" data-conversation-turn={turn.jobId} key={turn.jobId}>
        <p className="work-item-meta">{CORE_JOB_STATUS_LABELS[turn.status]} · <time dateTime={turn.createdAt}>{turn.createdAt}</time> · {turn.jobId}</p>
        {turn.pendingOperation ? <p>승인 대상: {turn.pendingOperation.jobId} · revision: {turn.pendingOperation.revision}</p> : null}
        <h5>내 요청</h5>
        <p className="job-conversation-text" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{turn.request}</p>
        {turn.response ? <><h5>에이전트 응답</h5><PresentationContent content={turn.response} /></> : null}
        {turn.error ? <p className="error" role="alert">{turn.error}</p> : null}
        {!turn.response && !turn.error ? <p>저장된 최종 응답이 아직 없습니다.</p> : null}
        {details.includes('steps') && turn.progress.length ? <details onToggle={() => { restorePosition(); readPosition(); }}><summary>진행 내역</summary><ul>{turn.progress.map((entry, index) => <li key={index}>{entry}</li>)}</ul></details> : null}
        {details.includes('tool') && turn.tools.length ? <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>관찰된 도구: {turn.tools.map(tool => `${tool.category}: ${tool.name}${agentToolOutcomeText(tool) ? ` · ${agentToolOutcomeText(tool)}` : ''}`).join('\n')}</p> : null}
        {details.includes('diagnostics') && turn.receiptFacts?.length ? <details onToggle={() => { restorePosition(); readPosition(); }}><summary>실행 영수증</summary>
          {turn.receiptFacts.map(fact => <p key={fact.label}><strong>{fact.label}:</strong> {fact.value}</p>)}
        </details> : null}
        {turn.truncated ? <p role="note">긴 내용 일부가 생략됐습니다.</p> : null}
      </li>)}
    </ol>
    </div>
    <p className="work-item-meta">원시 명령·도구 결과는 저장하지 않으며, 관측된 CLI 종료 정보와 마스킹한 출력 요약만 표시합니다.</p>
  </section>;
}
