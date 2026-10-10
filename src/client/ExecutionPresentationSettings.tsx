import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import * as teamsSdk from '@microsoft/teams-js';
import { apiFetch } from './auth.js';
import {
  EXECUTION_PRESENTATION_DETAILS, ExecutionPresentationModeSchema, ExecutionPresentationSelectionSchema,
  executionPresentationPreferences, type ExecutionPresentationDetail, type ExecutionPresentationPreferences,
} from '../shared/execution-presentation.js';

export const presentationLabels = { text: '① 채팅 중심', summary: '② 요약 카드', rich: '③ 채팅 + 별도 상세' } as const;
const detailLabels = { tool: '도구 결과', steps: '진행 단계', diagnostics: '진단 정보' } as const;
type Settings = {
  selection: ExecutionPresentationPreferences; available: string[]; loaded: boolean; busy: boolean; error: string;
  select: (selection: ExecutionPresentationPreferences) => Promise<void>; openRich: (jobId?: string) => void;
};
const defaults = executionPresentationPreferences({ mode: 'summary' });
const Context = createContext<Settings>({ selection: defaults, available: ['text', 'summary'], loaded: false, busy: false,
  error: '', select: async () => {}, openRich: () => {} });
export const useExecutionPresentation = () => useContext(Context);

export function openCopilotConversation(surface: 'tab' | 'dialog', jobId?: string): void {
  const url = new URL('/tabs/copilot-ui/', window.location.origin);
  if (jobId) url.searchParams.set('jobId', jobId);
  if (surface === 'tab') { window.location.assign(url.toString()); return; }
  if (!teamsSdk.dialog.url.isSupported()) throw new Error('현재 호스트는 Dialog를 지원하지 않습니다. 상세 위치를 Tab으로 선택하세요.');
  teamsSdk.dialog.url.open({ title: '업무 허브 · CopilotKit 대화', url: url.toString(), size: { width: 800, height: 650 } });
}

export function ExecutionPresentationProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState(defaults);
  const [available, setAvailable] = useState<string[]>(['text', 'summary']);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const operation = useRef<'load' | 'save' | null>(null);
  const active = useRef<AbortController | null>(null);
  const loadAttempt = useRef(0);
  const load = async (signal?: AbortSignal) => {
    if (operation.current) return;
    operation.current = 'load';
    const abort = new AbortController(); active.current = abort;
    const cancel = () => abort.abort(); signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, 20_000);
    const attempt = ++loadAttempt.current;
    setLoaded(false); setBusy(true); setError('');
    try {
      const response = await apiFetch('/api/execution-presentation', { signal: abort.signal });
      if (!response.ok) throw new Error('표시 설정을 불러오지 못했습니다.');
      const value = await response.json();
      const selected = ExecutionPresentationSelectionSchema.parse({ mode: value.mode, details: value.details, richSurface: value.richSurface });
      const modes = Array.isArray(value.availableModes) ? value.availableModes.map((item: unknown) => ExecutionPresentationModeSchema.parse(item)) : [];
      if (abort.signal.aborted || attempt !== loadAttempt.current) throw new Error('Display read expired');
      setSelection(executionPresentationPreferences(selected)); setAvailable(modes); setLoaded(true);
    } catch { if (!signal?.aborted && attempt === loadAttempt.current) setError('표시 설정을 불러오지 못했습니다. 설정 다시 불러오기를 선택하세요.'); }
    finally {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      if (attempt === loadAttempt.current) { operation.current = null; active.current = null; setBusy(false); }
    }
  };
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => {
    controller.abort(); active.current?.abort(); loadAttempt.current++; operation.current = null;
  }; }, []);
  const select = async (next: ExecutionPresentationPreferences) => {
    if (!loaded || operation.current || !available.includes(next.mode)) return;
    operation.current = 'save';
    const attempt = ++loadAttempt.current;
    const abort = new AbortController(); active.current = abort;
    const timer = setTimeout(() => abort.abort(), 20_000);
    setBusy(true); setError('');
    try {
      const response = await apiFetch('/api/execution-presentation', {
        method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next),
      });
      if (!response.ok) throw new Error('Display persistence failed');
      const value = await response.json();
      if (abort.signal.aborted || attempt !== loadAttempt.current) throw new Error('Display save expired');
      setSelection(executionPresentationPreferences(ExecutionPresentationSelectionSchema.parse({ mode: value.mode, details: value.details, richSurface: value.richSurface })));
    } catch { if (attempt === loadAttempt.current) setError('표시 설정을 저장하지 못했습니다. 설정 다시 불러오기로 저장 결과를 확인하세요.'); }
    finally {
      clearTimeout(timer);
      if (attempt === loadAttempt.current) { operation.current = null; active.current = null; setBusy(false); }
    }
  };
  const openRich = (jobId?: string) => {
    try { openCopilotConversation(selection.richSurface, jobId); }
    catch (value) { setError(value instanceof Error ? value.message : 'CopilotKit 대화를 열지 못했습니다.'); }
  };
  return <Context.Provider value={{ selection, available, loaded, busy, error, select, openRich }}>
    {children}
    {error ? <div className="presentation-settings-error" role="alert"><p>{error}</p>
      <button className="secondary" type="button" disabled={busy} onClick={() => void load()}>설정 다시 불러오기</button></div> : null}
  </Context.Provider>;
}

export function ExecutionPresentationDetailControls() {
  const state = useExecutionPresentation();
  const { selection } = state;
  const disabled = !state.loaded || state.busy;
  const toggle = (detail: ExecutionPresentationDetail, checked: boolean) => {
    const chosen = new Set(selection.details);
    if (checked) chosen.add(detail); else chosen.delete(detail);
    void state.select({ ...selection, details: EXECUTION_PRESENTATION_DETAILS.filter(value => chosen.has(value)) });
  };
  return <div className="presentation-detail-controls">
    <fieldset disabled={disabled}><legend>선택할 상세</legend>
      {EXECUTION_PRESENTATION_DETAILS.map(detail => <label key={detail}><input type="checkbox"
        checked={selection.details.includes(detail)} onChange={event => toggle(detail, event.currentTarget.checked)} />{detailLabels[detail]}</label>)}
    </fieldset>
    <label>상세 위치 <select aria-label="상세 위치" disabled={disabled} value={selection.richSurface}
      onChange={event => void state.select({ ...selection, richSurface: event.currentTarget.value === 'dialog' ? 'dialog' : 'tab' })}>
      <option value="tab">Tab</option><option value="dialog">Dialog</option></select></label>
  </div>;
}

export function ExecutionPresentationToolbar() {
  const state = useExecutionPresentation();
  const disabled = !state.loaded || state.busy;
  return <section className="presentation-toolbar" aria-label="화면 조합과 상세 설정" aria-busy={state.busy}>
    <div className="presentation-mode-buttons" role="group" aria-label="화면 조합">
      {(['text', 'summary', 'rich'] as const).map(mode => <button type="button" key={mode}
        aria-pressed={state.selection.mode === mode} disabled={disabled || !state.available.includes(mode)}
        onClick={() => void state.select({ ...state.selection, mode })}>{presentationLabels[mode]}</button>)}
    </div>
    <ExecutionPresentationDetailControls />
    <button className="secondary" type="button" disabled={disabled || !state.available.includes('rich')} onClick={() => state.openRich()}>CopilotKit 대화 열기</button>
    {!state.loaded ? <p role="status">표시 설정을 불러오는 중입니다.</p> : !state.available.includes('rich') ? <p>현재 CopilotKit 대화는 준비되지 않았습니다. 채팅·요약 카드는 사용할 수 있습니다.</p> : null}
    <p className="presentation-mandatory-note">실패·승인 필요·취소 상태는 상세를 꺼도 표시합니다.</p>
  </section>;
}
