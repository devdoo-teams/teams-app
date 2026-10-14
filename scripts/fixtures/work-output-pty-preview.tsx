import React, { useLayoutEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkOutputMonitor } from '../../src/client/WorkOutputMonitor.js';
import { createPtyOutputAccessGroup } from '../../src/client/pty-output-access.js';
import { PtyOutputAccessError } from '../../src/shared/pty-read.js';
import type { WorkOutputPtyCapability } from '../../src/client/work-output-pty.js';
import type { CoreOrchestrationJob } from '../../src/shared/core-orchestration.js';

const data = JSON.parse(document.getElementById('captured-native')!.textContent!);
const jobs: CoreOrchestrationJob[] = data.jobs;
const audit = { descriptions: [] as string[], reads: [] as Array<{ jobId: string; after: number }>, coreReads: [] as string[],
  sourceExecutions: 0, mutations: 0, metadataAborts: 0, coreBefore: JSON.stringify(jobs),
  portEvents: [] as Array<{ version: number; kind: 'describe' | 'read' }>,
  beforeEffects: [] as Array<{ version: number; outputText: string; observerControls: number; openDisabled: boolean }> };
let generation = 0; let stage = 0; let metadata: 'normal' | 'pending' | 'denied' = 'normal';
let finishLate: (() => void) | undefined;
Object.assign(window, { __hubPtyAudit: audit });

function Preview() {
  const [slots, setSlots] = useState<readonly (string | undefined)[]>([jobs[0]!.id, undefined]);
  const [layout, setLayout] = useState<2 | 4>(2); const [activeSlot, setActiveSlot] = useState(0);
  const [open, setOpen] = useState(true); const [denied, setDenied] = useState(false);
  const [clientVersion, setClientVersion] = useState(0);
  const deniedAccess = () => { generation++; group.invalidate(); setDenied(true); setOpen(false); };
  const [group] = useState(() => createPtyOutputAccessGroup({ getAccessGeneration: () => generation, onAccessDenied: () => deniedAccess() }));
  const capability = useMemo<WorkOutputPtyCapability>(() => ({
    getAccessGroup: () => group, getAccessGeneration: () => generation,
    client: {
      async describe(jobId, signal) {
        audit.portEvents.push({ version: clientVersion, kind: 'describe' });
        audit.descriptions.push(jobId);
        if (metadata === 'denied') throw new PtyOutputAccessError('access-denied');
        if (metadata === 'pending') await new Promise<void>(resolve => { finishLate = resolve; signal.addEventListener('abort', () => { audit.metadataAborts++; }, { once: true }); });
        if (jobId !== jobs[0]!.id) throw new PtyOutputAccessError('session-unavailable');
        const { jobId: existingJobId, sessionId, generation: sessionGeneration } = data.snapshots[0];
        return { jobId: existingJobId, sessionId, generation: sessionGeneration };
      },
      async read(identity, after, signal) {
        audit.portEvents.push({ version: clientVersion, kind: 'read' });
        signal.throwIfAborted(); audit.reads.push({ jobId: identity.jobId, after });
        const captured = data.snapshots[stage];
        return { ...captured, frames: captured.frames.filter((frame: { sequence: number }) => frame.sequence > after), truncated: after < captured.firstAvailableSequence - 1 };
      },
    },
  }), [group, clientVersion]);
  // Observe the actual React DOM commit before child passive cleanup/setup.
  useLayoutEffect(() => {
    if (!clientVersion) return;
    const root = document.querySelector('[aria-label="첫 패널 PTY 관찰"]');
    const open = [...(root?.querySelectorAll('button') ?? [])].find(button => button.textContent === '기존 PTY 관찰 보기');
    audit.beforeEffects.push({ version: clientVersion, outputText: root?.querySelector('[data-pty-output]')?.textContent ?? '',
      observerControls: root?.querySelectorAll('[aria-label="출력 조회 연결"] button').length ?? 0, openDisabled: open?.disabled === true });
  }, [capability]);
  const client = useMemo(() => ({ async getJob(jobId: string) {
    audit.coreReads.push(jobId); const job = jobs.find(row => row.id === jobId); if (!job) throw new Error('Synthetic job missing.');
    return structuredClone(job);
  } }), []);
  const onAccessDenied = useMemo(() => () => deniedAccess(), [group]);
  const createPolling = useMemo(() => () => ({ start() {}, stop() {} }), []);
  return <main style={{ maxWidth: 1260, margin: '0 auto', padding: 16 }}>
    <h1>업무 허브 · 첫 슬롯 로컬 통합 시험</h1>
    <p>Core 합성 기록과 기존 native PTY 저장 프레임을 읽기만 합니다. 새 실행·인증·네트워크 연결은 없습니다.</p>
    <p>소스 기준 <code>{data.sourceCommit.slice(0, 12)}</code>
      {data.sourceState === 'modified-worktree' ? <> · 미커밋 수정 <code>{data.sourcePatchSha256.slice(0, 12)}</code></> : null}
      {' · '}native 자료 원본 <code>{data.nativeSourceCommit.slice(0, 12)}</code></p>
    <div className="output-monitor-actions" aria-label="격리 시험 제어">
      <button onClick={() => { stage = Math.min(stage + 1, 2); }}>다음 저장 프레임</button>
      <button onClick={() => { metadata = 'pending'; }}>메타데이터 지연</button>
      <button onClick={() => { finishLate?.(); }}>늦은 응답 전달</button>
      <button onClick={() => { metadata = 'denied'; }}>메타데이터 권한 거부</button>
      <button onClick={() => { metadata = 'normal'; setClientVersion(value => value + 1); }}>같은 작업 client 교체</button>
      <button onClick={() => deniedAccess()}>인증 세대 변경</button>
    </div>
    {denied ? <p role="alert">합성 접근 권한이 철회되어 Core와 PTY 출력을 지웠습니다.</p> : null}
    {!denied && (open ? <WorkOutputMonitor client={client} slots={slots} layout={layout} activeSlot={activeSlot} jobs={jobs}
      createPolling={createPolling} onAccessDenied={onAccessDenied} onSlotsChange={setSlots}
      onLayoutChange={setLayout} onActiveSlotChange={setActiveSlot} onClose={() => setOpen(false)} onOpenJob={() => setOpen(false)} ptyCapability={capability} />
      : <button onClick={() => setOpen(true)}>같은 모니터 다시 보기</button>)}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
