import { CopilotChatView, CopilotChatConfigurationProvider, CopilotChatUserMessage, CopilotChatAssistantMessage } from '@copilotkit/react-core/v2';
import type { Message } from '@ag-ui/client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ComponentProps } from 'react';
import { CORE_AGENT_PROMPT_MAX_LENGTH, CORE_JOB_STATUS_LABELS, type CoreOrchestrationJob } from '../shared/core-orchestration.js';
import type { VisibleJobConversation } from '../shared/job-conversation.js';
import { EXECUTION_PRESENTATION_AGENT_ID as COPILOT_PROJECTION_AGENT_ID } from '../shared/execution-presentation.js';
import { createCoreOrchestrationClient, type CoreOrchestrationClient } from './core-orchestration-client.js';
import { canContinueConversation, canStopConversation, createCoreConversationController, submitCoreConversation, type CoreConversationState } from './copilot-conversation-controller.js';
import { PresentationContent } from './PresentationContent.js';
import { snapshotConversationReadingPosition, restoreConversationReadingPosition, type ConversationReadingPosition } from './conversation-reading-position.js';

export function projectCopilotConversationMessages(conversation?: VisibleJobConversation): Message[] {
  return (conversation?.turns ?? []).flatMap(turn => [
    { id: `${turn.jobId}-request`, role: 'user' as const, content: turn.request },
    { id: `${turn.jobId}-response`, role: 'assistant' as const, content:
      `${turn.response || '저장된 최종 응답이 아직 없습니다.'}\n\n상태: ${CORE_JOB_STATUS_LABELS[turn.status]}${turn.error ? `\n오류: ${turn.error}` : ''}` },
  ]);
}

const ConversationText = ({ content }: { content: string }) => <div className="copilot-conversation-text"><PresentationContent content={content} /></div>;
const NoExecutionToolbar = () => null;
const ConversationUserMessage = (props: ComponentProps<typeof CopilotChatUserMessage>) => <div data-conversation-turn={props.message.id}>
  <CopilotChatUserMessage {...props} />
</div>;
const ConversationAssistantMessage = (props: ComponentProps<typeof CopilotChatAssistantMessage>) => <div data-conversation-turn={props.message.id}>
  <CopilotChatAssistantMessage {...props} markdownRenderer={ConversationText} toolbar={NoExecutionToolbar} />
</div>;
// Installed 1.66.2's default virtualizer scrolls to the last row when the first
// message changes, including an earlier-page prepend with autoScroll="none".
// The public render-prop retains SDK messages and skips that virtualizer branch.
const ChronologicalSdkMessages = ({ messageElements }: { messageElements: ReactElement[] }) =>
  <div className="copilotKitMessages" role="log" aria-label="대화 이력" aria-live="off">{messageElements}</div>;

/** Actual SDK transcript and composer; explicit submit uses the Core owner API,
 * while the separately mounted tool projection remains a read-only agent. */
export function CopilotConversationTranscript({ state, input, setInput, send, stop, confirmingStop = false, confirmStop, dismissStop, loadEarlier }: {
  state: CoreConversationState; input: string; setInput: (value: string) => void; send: (value: string) => void;
  stop?: () => void; confirmingStop?: boolean; confirmStop?: () => void; dismissStop?: () => void;
  loadEarlier?: () => void;
}): ReactElement {
  const transcript = useRef<HTMLElement>(null);
  const readingPosition = useRef<ConversationReadingPosition | undefined>(undefined);
  const captureReadingPosition = (prepend = false) => {
    const element = transcript.current?.querySelector<HTMLElement>('.copilot-conversation-scroll');
    if (!element) return;
    const top = element.getBoundingClientRect().top;
    const anchor = Array.from(element.querySelectorAll<HTMLElement>('[data-conversation-turn]'))
      .find(turn => turn.getBoundingClientRect().bottom > top);
    const position = snapshotConversationReadingPosition(element,
      anchor?.dataset.conversationTurn ? { jobId: anchor.dataset.conversationTurn, offset: anchor.getBoundingClientRect().top - top } : undefined);
    readingPosition.current = position && prepend ? { ...position, wasAtEnd: false } : position;
  };
  useLayoutEffect(() => {
    const element = transcript.current?.querySelector<HTMLElement>('.copilot-conversation-scroll');
    if (!element) return;
    const position = readingPosition.current;
    const anchor = position?.anchor ? Array.from(element.querySelectorAll<HTMLElement>('[data-conversation-turn]'))
      .find(turn => turn.dataset.conversationTurn === position.anchor!.jobId) : undefined;
    element.scrollTop = restoreConversationReadingPosition(position, element,
      anchor ? anchor.getBoundingClientRect().top - element.getBoundingClientRect().top : undefined);
    captureReadingPosition();
  }, [state.conversation]);
  const enabled = canContinueConversation(state);
  const activeJob = Boolean(state.job && ['queued', 'running'].includes(state.job.status));
  const stoppable = canStopConversation(state) && !confirmingStop && Boolean(stop);
  return <section ref={transcript} aria-label="CopilotKit 대화" aria-busy={['loading', 'sending', 'stopping'].includes(state.phase)}>
    {state.error ? <p role="alert">{state.error}</p> : null}
    {state.phase === 'loading' ? <p role="status">{state.loadingEarlier ? '이전 대화를 불러오고 있습니다.' : '기존 작업의 대화를 불러오고 있습니다.'}</p> : null}
    {state.phase === 'sending' ? <p role="status">후속 요청을 전송하고 있습니다. 다시 누르지 마세요.</p> : null}
    {state.phase === 'stopping' ? <p role="status">중지 요청을 처리하고 있습니다. 서버에서 확인한 뒤 최종 상태를 표시합니다.</p> : null}
    {state.job ? <p role="status" aria-live="polite">현재 작업: {CORE_JOB_STATUS_LABELS[state.job.status]}
      {state.job.status === 'awaiting_approval' ? ' · 개인 작업에서 내용을 검토하고 승인하거나 취소하세요.' : ''}
      {state.job.status === 'input_required' ? ' · 개인 작업에서 필요한 입력을 확인하세요.' : ''}
      {state.job.status === 'failed' ? ' · 실패 원인을 확인한 뒤 새 후속 요청을 보낼 수 있습니다.' : ''}
      {state.job.status === 'cancelled' ? ' · 서버에서 취소 상태를 확인했습니다.' : ''}</p> : null}
    {state.stale ? <p role="note">마지막으로 확인한 대화입니다. 연결을 복구하고 상태를 다시 확인하세요.</p> : null}
    {state.uncertain ? <p role="alert">후속 요청의 전송 결과가 아직 불확실합니다. 다시 보내지 말고 개인 작업 목록에서 새 작업을 확인하세요.</p> : null}
    {state.stopUncertain ? <p role="alert">중지 결과가 아직 불확실합니다. 중지를 다시 보내지 말고 상태를 새로고침하세요.</p> : null}
    {state.submittedPrompt && (state.phase === 'sending' || state.uncertain) ? <section aria-label="제출한 후속 요청">
      <h4>{state.uncertain ? '전송 결과 확인이 필요한 요청' : '전송 중인 요청'}</h4>
      <pre className="copilot-conversation-text">{state.submittedPrompt}</pre>
    </section> : null}
    {!state.conversation?.complete && state.conversation ? <p role="note">{state.conversation.unavailableReason === 'turn-limit'
      ? '이전 대화가 더 있습니다. 필요한 이력을 20개씩 불러올 수 있습니다.' : '이전 대화 일부를 확인하지 못했습니다.'}</p> : null}
    {state.conversation && !state.conversation.complete && state.conversation.unavailableReason !== 'invalid-chain' && loadEarlier ?
      <button className="secondary" type="button" disabled={state.phase !== 'ready'} onClick={() => { captureReadingPosition(true); loadEarlier(); }}>
        {state.conversation.unavailableReason === 'previous-turn-unavailable' ? '이전 대화 다시 확인' : '이전 대화 더 보기'}</button> : null}
    {confirmingStop && canStopConversation(state) ? <section aria-label="작업 중지 확인">
      <p>현재 작업을 중지할까요? 이미 처리한 결과는 되돌리지 않습니다.</p>
      <button type="button" onClick={confirmStop}>중지 확인</button>
      <button className="secondary" type="button" onClick={dismissStop}>계속 실행</button>
    </section> : null}
    <CopilotChatConfigurationProvider agentId={COPILOT_PROJECTION_AGENT_ID} hasExplicitThreadId={true}>
      <CopilotChatView className="presentation-sdk-chat" messages={projectCopilotConversationMessages(state.conversation)} welcomeScreen={false}
        messageView={{ children: ChronologicalSdkMessages, userMessage: ConversationUserMessage, assistantMessage: ConversationAssistantMessage }}
        scrollView={{ className: 'copilot-conversation-scroll', onScroll: () => captureReadingPosition() }}
        autoScroll="none" isRunning={activeJob} inputValue={input} onInputChange={setInput}
        onSubmitMessage={send} onStop={stoppable ? stop : undefined} input={{ mode: 'input', isRunning: activeJob,
          textArea: { disabled: !enabled, maxLength: CORE_AGENT_PROMPT_MAX_LENGTH, 'aria-label': '같은 대화의 후속 요청',
            placeholder: enabled ? '같은 대화에 요청을 이어서 보내세요.' : '작업이 끝난 뒤 요청을 이어서 보낼 수 있습니다.' },
          sendButton: { className: 'presentation-send-button', disabled: activeJob ? !stoppable : !enabled || !input.trim(),
            'aria-label': activeJob ? '작업 중지' : '후속 요청 보내기' } }} />
    </CopilotChatConfigurationProvider>
    <p className="presentation-mandatory-note">최대 {CORE_AGENT_PROMPT_MAX_LENGTH}자. 전송하면 같은 대화의 후속 작업을 실행합니다. 표시 변경·새로고침은 작업을 실행하지 않습니다.</p>
  </section>;
}

export function ConnectedCoreConversation({ jobId, onJobChange, onStateChange }: {
  jobId: string; onJobChange: (id: string) => void; onStateChange?: (state: CoreConversationState) => void;
}): ReactElement {
  const client = useMemo(() => createCoreOrchestrationClient(), []);
  const [state, setState] = useState<CoreConversationState>({ jobId, phase: 'idle', uncertain: false });
  const [input, setInput] = useState('');
  const [validation, setValidation] = useState('');
  const [confirmingStop, setConfirmingStop] = useState(false);
  const controller = useRef<ReturnType<typeof createCoreConversationController> | null>(null);
  useEffect(() => {
    let mounted = true;
    const next = createCoreConversationController({ client, jobId, onChange: value => {
      if (!mounted) return;
      setState(value);
      onStateChange?.(value);
      if (value.jobId !== jobId) { setInput(''); onJobChange(value.jobId); }
    } });
    controller.current = next;
    setConfirmingStop(false);
    void next.load();
    return () => { mounted = false; next.dispose(); if (controller.current === next) controller.current = null; };
  }, [client, jobId, onJobChange, onStateChange]);
  useEffect(() => {
    if (state.phase !== 'ready' || !state.job || !['running', 'queued'].includes(state.job.status)) return;
    const timer = setTimeout(() => { void controller.current?.load(); }, 3000);
    return () => clearTimeout(timer);
  }, [state]);
  useEffect(() => {
    // Returning to the WebView or regaining connectivity replays only owner
    // reads. A lost send/cancel receipt is never replayed as a mutation.
    const reconnect = () => {
      if (document.visibilityState === 'hidden') return;
      const current = controller.current;
      if (!current) return;
      const snapshot = current.getState();
      if (snapshot.phase === 'ready' || (snapshot.phase === 'blocked' && snapshot.recovery === 'network')) void current.load();
    };
    window.addEventListener('online', reconnect);
    document.addEventListener('visibilitychange', reconnect);
    return () => {
      window.removeEventListener('online', reconnect);
      document.removeEventListener('visibilitychange', reconnect);
    };
  }, []);
  const send = async (value: string) => {
    const current = controller.current;
    if (current) await submitCoreConversation(current, value, { setInput, setValidation, isCurrent: () => controller.current === current });
  };
  return <>
    <button className="secondary" type="button" disabled={['loading', 'sending', 'stopping'].includes(state.phase)}
      onClick={() => { setValidation(''); setConfirmingStop(false); void controller.current?.load(); }}>
      {state.recovery === 'network' || state.stopUncertain ? '연결 복구 · 상태 다시 확인' : '대화 새로고침'}</button>
    {validation ? <p role="alert">{validation}</p> : null}
    <CopilotConversationTranscript state={state} input={input} setInput={setInput} send={value => { void send(value); }}
      stop={() => setConfirmingStop(true)} confirmingStop={confirmingStop}
      loadEarlier={() => { setConfirmingStop(false); void controller.current?.loadEarlier(); }}
      dismissStop={() => setConfirmingStop(false)} confirmStop={() => { setConfirmingStop(false); void controller.current?.stop(); }} />
  </>;
}
