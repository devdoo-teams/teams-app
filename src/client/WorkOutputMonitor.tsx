import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { WorkOutputPtyObservation } from './WorkOutputPtyObservation.js';
import type { WorkOutputPtyCapability } from './work-output-pty.js';
import type { CoreOrchestrationClient } from './core-orchestration-client.js';
import type { CoreOrchestrationJob } from '../shared/core-orchestration.js';
import { createOutputMonitorReader, normalizeOutputMonitorSlots, outputMonitorKey,
  type OutputMonitorSlots, type OutputMonitorSnapshot } from './work-output-monitor.js';

type ViewProps = {
  slots: OutputMonitorSlots; layout: 2 | 4; activeSlot: number; jobs: readonly CoreOrchestrationJob[];
  snapshot: OutputMonitorSnapshot; mobile?: boolean;
  onSlotsChange: (slots: OutputMonitorSlots) => void; onLayoutChange: (layout: 2 | 4) => void;
  onActiveSlotChange: (slot: number) => void; onOpenJob: (id: string) => void;
  onClose: () => void; onRefresh: () => void;
  ptyObservation?: ReactNode;
};

export function WorkOutputMonitorView(props: ViewProps & { headingRef?: Ref<HTMLHeadingElement> }) {
  const slots = normalizeOutputMonitorSlots(props.slots);
  const activeSlot = Math.max(0, Math.min(props.activeSlot, props.layout - 1));
  const current = props.snapshot.key === outputMonitorKey(slots);
  const entries = current ? props.snapshot.entries : {};
  const blocked = props.snapshot.phase === 'blocked';
  if (blocked) return <section className="output-monitor" aria-label="읽기 전용 다중 작업 출력 모니터">
    <p role="alert">출력 접근이 중단되었습니다. Teams에서 다시 인증하고 작업 목록을 새로고침하세요.</p>
    <button className="secondary" type="button" onClick={props.onClose}>작업 목록으로</button>
  </section>;
  return <section aria-label="읽기 전용 다중 작업 출력 모니터" className={`output-monitor${props.mobile ? ' force-mobile' : ''}`}>
    <div className="output-monitor-heading">
      <div><h3 ref={props.headingRef} tabIndex={-1}>현재 출력 조회</h3><p className="panel-description">읽기 전용 · 3초마다 저장된 상태·마스킹한 출력 요약을 조회합니다. {props.ptyObservation ? '첫 패널의 PTY 관찰은 별도로 조회합니다.' : 'PTY·실시간 스트림이 아닙니다.'}</p></div>
      <div className="output-monitor-actions">
        <button className="secondary" onClick={props.onRefresh} type="button" disabled={blocked || !current || props.snapshot.phase === 'loading'}>출력 새로고침</button>
        <button className="secondary" onClick={props.onClose} type="button">작업 목록으로</button>
      </div>
    </div>
    <div aria-label="모니터 배치" className="output-monitor-actions" role="group">
      {([2, 4] as const).map(layout => <button key={layout} aria-pressed={props.layout === layout}
        className="secondary" type="button" onClick={() => props.onLayoutChange(layout)}>{layout}분할</button>)}
      <span className="panel-description">모바일에서는 선택한 패널 하나만 표시합니다. 패널 선택은 이 탭에서 유지됩니다.</span>
    </div>
    {blocked ? <p role="alert">출력 접근이 중단되었습니다. Teams에서 다시 인증하고 작업 목록을 새로고침하세요.</p> : null}
    <div aria-label="표시할 모니터 패널" className="output-monitor-mobile-tabs" role="tablist">
      {slots.slice(0, props.layout).map((id, index) => <button key={index} id={`output-monitor-tab-${index}`}
        aria-controls={`output-monitor-panel-${index}`} aria-selected={activeSlot === index} role="tab" className="secondary"
        tabIndex={activeSlot === index ? 0 : -1} onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (activeSlot + 1) % props.layout
            : event.key === 'ArrowLeft' ? (activeSlot + props.layout - 1) % props.layout
              : event.key === 'Home' ? 0 : event.key === 'End' ? props.layout - 1 : undefined;
          if (next === undefined) return;
          event.preventDefault(); props.onActiveSlotChange(next);
          event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}
        type="button" onClick={() => props.onActiveSlotChange(index)}>패널 {index + 1}{id ? ` · ${id}` : ''}</button>)}
    </div>
    <div className={`output-monitor-grid layout-${props.layout}`} aria-busy={!current || props.snapshot.phase === 'loading'}>
      {slots.slice(0, props.layout).map((id, index) => {
        const entry = id ? entries[id] : undefined;
        const presentation = blocked ? undefined : entry?.status === 'ready' ? entry.presentation : undefined;
        const known = new Set(props.jobs.map(job => job.id));
        return <article className="output-monitor-panel" key={index} id={`output-monitor-panel-${index}`}
          aria-label={`출력 패널 ${index + 1}`} data-output-monitor-slot={index} data-mobile-active={activeSlot === index}
          role="tabpanel" aria-labelledby={`output-monitor-tab-${index}`}
          hidden={Boolean(props.mobile && activeSlot !== index)}>
          <label>패널 {index + 1} 작업
            <select aria-label={`패널 ${index + 1} 작업`} value={id ?? ''} disabled={blocked} onChange={event => {
              const next = [...slots]; next[index] = event.currentTarget.value || undefined;
              props.onSlotsChange(normalizeOutputMonitorSlots(next));
            }}>
              <option value="">작업 선택</option>
              {id && !known.has(id) ? <option value={id}>{id} · 선택 유지</option> : null}
              {props.jobs.map(job => <option key={job.id} value={job.id} disabled={job.id !== id && slots.includes(job.id)}>
                {job.id} · {job.prompt.replace(/\s+/gu, ' ').slice(0, 60)}</option>)}
            </select>
          </label>
          {!id ? <p className="panel-description">조회할 기존 작업을 선택하세요. 새 실행은 시작하지 않습니다.</p>
            : blocked ? <p role="status">인증 확인 필요</p>
              : !entry ? <p role="status">저장된 출력을 조회 중입니다.</p>
                : entry.status === 'missing' ? <p role="status">찾을 수 없거나 접근 권한이 없는 작업입니다. 패널에서 다른 작업을 선택하세요.</p>
                  : entry.status === 'error' ? <p role="alert">조회에 실패했습니다. 3초 뒤 다시 조회하며, 출력 새로고침으로 재시도할 수 있습니다.</p> : null}
          {presentation ? <>
            <div className="output-monitor-status"><span className="badge" data-job-status={presentation.status}>{presentation.statusLabel}</span>
              <span>{presentation.jobId}</span>{presentation.truncated ? <span className="work-item-meta">일부 생략</span> : null}</div>
            <p className="output-monitor-prompt">{presentation.prompt}</p>
            {entry?.checkedAt ? <p className="work-item-meta">마지막 조회 <time dateTime={entry.checkedAt}>{new Date(entry.checkedAt).toLocaleTimeString('ko-KR')}</time></p> : null}
            <div className="output-monitor-output" tabIndex={0} aria-label={`패널 ${index + 1} 저장된 출력 요약`}>
              <h4>관찰된 CLI·도구 결과</h4>
              <pre>{presentation.tools.length ? presentation.tools.map(tool => `${tool.category}: ${tool.name}${tool.outcome ? `\n${tool.outcome}` : ''}`).join('\n\n') : '보고된 도구 결과가 없습니다.'}</pre>
              <h4>저장된 최종 응답</h4><pre>{presentation.result || '저장된 최종 응답이 아직 없습니다.'}</pre>
              {presentation.error ? <><h4>기록된 오류</h4><pre>{presentation.error}</pre></> : null}
              {presentation.progress.length ? <><h4>최근 진행 (최대 8개)</h4><pre>{presentation.progress.join('\n')}</pre></> : null}
            </div>
            <button className="secondary" type="button" onClick={() => props.onOpenJob(presentation.jobId)}>같은 작업의 상세·대화</button>
            {index === 0 ? props.ptyObservation : null}
          </> : null}
        </article>;
      })}
    </div>
  </section>;
}

export function WorkOutputMonitor(props: Omit<ViewProps, 'snapshot' | 'onRefresh' | 'ptyObservation'> & {
  client: Pick<CoreOrchestrationClient, 'getJob'>; onAccessDenied: (error: unknown) => void;
  createPolling: (options: { refresh: () => Promise<void> }) => { start: () => void; stop: () => void };
  ptyCapability?: WorkOutputPtyCapability;
}) {
  const key = outputMonitorKey(props.slots);
  const heading = useRef<HTMLHeadingElement>(null);
  const positioned = useRef(false);
  const [snapshot, setSnapshot] = useState<OutputMonitorSnapshot>({ key, phase: 'loading', entries: {} });
  const [reader, setReader] = useState<ReturnType<typeof createOutputMonitorReader>>();
  useEffect(() => {
    // Loading cells are shorter than real output. Position once after the
    // first read; later polling must preserve the user's reading position.
    if (snapshot.phase !== 'ready' || positioned.current) return;
    positioned.current = true;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: 'start' });
  }, [snapshot.phase]);
  useEffect(() => {
    let active = true;
    const current = createOutputMonitorReader({ client: props.client, onChange: setSnapshot, onAccessDenied: props.onAccessDenied });
    setReader(current);
    const slots = key ? key.split('|') : [];
    const polling = props.createPolling({ refresh: () => current.read(slots) });
    void current.read(slots).then(() => { if (active) polling.start(); });
    return () => { active = false; polling.stop(); current.dispose(); };
  }, [props.client, props.createPolling, props.onAccessDenied, key]);
  const firstJob = normalizeOutputMonitorSlots(props.slots)[0];
  const observeFirst = snapshot.key === key && snapshot.phase !== 'blocked' && firstJob
    && snapshot.entries[firstJob]?.status === 'ready' ? firstJob : undefined;
  return <WorkOutputMonitorView {...props} headingRef={heading} snapshot={snapshot} onRefresh={() => { void reader?.read(props.slots); }}
    ptyObservation={props.ptyCapability && observeFirst ? <WorkOutputPtyObservation key={observeFirst} jobId={observeFirst}
      capability={props.ptyCapability} onAccessDenied={props.onAccessDenied} /> : undefined} />;
}
