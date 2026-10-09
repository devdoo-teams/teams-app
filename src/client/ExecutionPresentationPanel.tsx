import { useEffect, useRef, useState } from 'react';
import * as teamsSdk from '@microsoft/teams-js';
const dialog = teamsSdk.dialog;
import { apiFetch } from './auth.js';
import { ExecutionPresentationCard } from './ExecutionPresentationCard.js';
import { JobConversationView } from './JobConversationView.js';
import type { VisibleJobConversation } from '../shared/job-conversation.js';
import { createExecutionPresentation, ExecutionPresentationModeSchema, type ExecutionPresentationMode } from '../shared/execution-presentation.js';
import type { CoreOrchestrationJob } from '../shared/core-orchestration.js';

const labels = { text: '텍스트', summary: '요약 카드', rich: 'CopilotKit 화면' } as const;

/** Display-only controls; submitting, approving and cancelling stay in Core. */
export function ExecutionPresentationPanel({ job, conversation }: { job: CoreOrchestrationJob; conversation?: VisibleJobConversation }) {
  const [mode, setMode] = useState<ExecutionPresentationMode>('summary');
  const [available, setAvailable] = useState<ExecutionPresentationMode[]>(['text', 'summary']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const saving = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch('/api/execution-presentation', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error('표시 설정을 불러오지 못했습니다.');
      const value = await response.json();
      const selected = ExecutionPresentationModeSchema.parse(value.mode);
      const modes = Array.isArray(value.availableModes)
        ? value.availableModes.map((item: unknown) => ExecutionPresentationModeSchema.parse(item)) : [];
      if (controller.signal.aborted) return;
      setMode(selected); setAvailable(modes); setLoaded(true);
    }).catch(() => { if (!controller.signal.aborted) setError('표시 설정을 불러오지 못했습니다. 새로고침으로 다시 시도하세요.'); });
    return () => controller.abort();
  }, []);
  async function select(next: ExecutionPresentationMode) {
    if (saving.current || !loaded || !available.includes(next)) return;
    saving.current = true;
    setBusy(true); setError('');
    try {
      const response = await apiFetch('/api/execution-presentation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: next }),
      });
      if (!response.ok) throw new Error('표시 설정을 저장하지 못했습니다.');
      const value = await response.json();
      setMode(ExecutionPresentationModeSchema.parse(value.mode));
    } catch { setError('표시 설정을 저장하지 못했습니다. 다시 선택하세요.'); }
    finally { saving.current = false; setBusy(false); }
  }
  function openRich() {
    try {
      if (!dialog.url.isSupported()) throw new Error('unsupported');
      const url = new URL('/tabs/copilot-ui/', window.location.origin);
      url.searchParams.set('jobId', job.id);
      dialog.url.open({ title: '업무 허브 · CopilotKit', url: url.toString(), size: { width: 800, height: 650 } });
    } catch { setError('이 Teams 호스트에서는 CopilotKit 창을 열 수 없습니다. Teams 데스크톱 또는 웹 탭에서 다시 시도하세요.'); }
  }
  const presentation = createExecutionPresentation(job);
  return <section aria-label="작업 결과 표시 방식">
    <label>결과 표시 방식
      <select aria-label="결과 표시 방식" value={mode} disabled={busy || !loaded}
        onChange={event => void select(ExecutionPresentationModeSchema.parse(event.currentTarget.value))}>
        {(['text', 'summary', 'rich'] as const).map(value =>
          <option key={value} value={value} disabled={!available.includes(value)}>{labels[value]}</option>)}
      </select>
    </label>
    {busy ? <p role="status">표시 설정 저장 중…</p> : null}
    {error ? <p role="alert" className="error">{error}</p> : null}
    {mode === 'text' ? <pre className="execution-presentation-text">{presentation.text}</pre>
      : mode === 'summary' ? <ExecutionPresentationCard presentation={presentation} />
      : <><p>같은 작업의 결과와 실행 영수증을 CopilotKit 화면에서 확인합니다.</p>
        <button type="button" disabled={!available.includes('rich')} onClick={openRich}>CopilotKit 화면 열기</button></>}
    {conversation ? <details><summary>원본 대화 기록 보기</summary><JobConversationView conversation={conversation} /></details> : null}
  </section>;
}
