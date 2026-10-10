import { CopilotChatView, CopilotChatConfigurationProvider } from '@copilotkit/react-core/v2';
import type { Message } from '@ag-ui/client';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { CORE_AGENT_PROMPT_MAX_LENGTH, CORE_JOB_STATUS_LABELS, type CoreOrchestrationJob } from '../shared/core-orchestration.js';
import type { VisibleJobConversation } from '../shared/job-conversation.js';
import { EXECUTION_PRESENTATION_AGENT_ID as COPILOT_PROJECTION_AGENT_ID } from '../shared/execution-presentation.js';
import { createCoreOrchestrationClient, type CoreOrchestrationClient } from './core-orchestration-client.js';
import { canContinueConversation, createCoreConversationController, submitCoreConversation, type CoreConversationState } from './copilot-conversation-controller.js';

export function projectCopilotConversationMessages(conversation?: VisibleJobConversation): Message[] {
  return (conversation?.turns ?? []).flatMap(turn => [
    { id: `${turn.jobId}-request`, role: 'user' as const, content: turn.request },
    { id: `${turn.jobId}-response`, role: 'assistant' as const, content:
      `${turn.response || '저장된 최종 응답이 아직 없습니다.'}\n\n상태: ${CORE_JOB_STATUS_LABELS[turn.status]}${turn.error ? `\n오류: ${turn.error}` : ''}` },
  ]);
}

const ConversationText = ({ content }: { content: string }) => <div className="copilot-conversation-text">{content}</div>;
const NoExecutionToolbar = () => null;

/** Actual SDK transcript and composer; explicit submit uses the Core owner API,
 * while the separately mounted tool projection remains a read-only agent. */
export function CopilotConversationTranscript({ state, input, setInput, send }: {
  state: CoreConversationState; input: string; setInput: (value: string) => void; send: (value: string) => void;
}): ReactElement {
  const enabled = canContinueConversation(state);
  return <section aria-label="CopilotKit 대화" aria-busy={state.phase === 'loading' || state.phase === 'sending'}>
    {state.error ? <p role="alert">{state.error}</p> : null}
    {state.phase === 'loading' ? <p role="status">기존 작업의 대화를 불러오고 있습니다.</p> : null}
    {state.phase === 'sending' ? <p role="status">후속 요청을 전송하고 있습니다. 다시 누르지 마세요.</p> : null}
    {state.submittedPrompt && (state.phase === 'sending' || state.uncertain) ? <section aria-label="제출한 후속 요청">
      <h4>{state.uncertain ? '전송 결과 확인이 필요한 요청' : '전송 중인 요청'}</h4>
      <pre className="copilot-conversation-text">{state.submittedPrompt}</pre>
    </section> : null}
    {!state.conversation?.complete && state.conversation ? <p role="note">이전 대화 일부가 없거나 최근 20개 대화만 표시됩니다.</p> : null}
    <CopilotChatConfigurationProvider agentId={COPILOT_PROJECTION_AGENT_ID} hasExplicitThreadId={true}>
      <CopilotChatView messages={projectCopilotConversationMessages(state.conversation)} welcomeScreen={false}
        messageView={{ assistantMessage: { markdownRenderer: ConversationText, toolbar: NoExecutionToolbar } }}
        autoScroll="none" isRunning={false} inputValue={input} onInputChange={setInput}
        onSubmitMessage={send} input={{ mode: 'input', isRunning: false,
          textArea: { disabled: !enabled, maxLength: CORE_AGENT_PROMPT_MAX_LENGTH, 'aria-label': '같은 대화의 후속 요청',
            placeholder: enabled ? '같은 대화에 요청을 이어서 보내세요.' : '작업이 끝난 뒤 요청을 이어서 보낼 수 있습니다.' },
          sendButton: { disabled: !enabled || !input.trim(), 'aria-label': '후속 요청 보내기' } }} />
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
    void next.load();
    return () => { mounted = false; next.dispose(); if (controller.current === next) controller.current = null; };
  }, [client, jobId, onJobChange, onStateChange]);
  useEffect(() => {
    if (state.phase !== 'ready' || !state.job || !['running', 'queued'].includes(state.job.status)) return;
    const timer = setTimeout(() => { void controller.current?.load(); }, 3000);
    return () => clearTimeout(timer);
  }, [state]);
  const send = async (value: string) => {
    const current = controller.current;
    if (current) await submitCoreConversation(current, value, { setInput, setValidation, isCurrent: () => controller.current === current });
  };
  return <>
    <button type="button" disabled={state.phase === 'loading' || state.phase === 'sending'}
      onClick={() => { setValidation(''); void controller.current?.load(); }}>대화 새로고침</button>
    {validation ? <p role="alert">{validation}</p> : null}
    <CopilotConversationTranscript state={state} input={input} setInput={setInput} send={value => { void send(value); }} />
  </>;
}
