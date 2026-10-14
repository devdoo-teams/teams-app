import { useEffect, useState } from 'react';
import type { ApiAuthError } from './auth.js';
import { PtyOutputView } from './PtyOutputView.js';
import { createWorkOutputPtyObserver, type WorkOutputPtyCapability, type WorkOutputPtySnapshot } from './work-output-pty.js';

type ObservationProps = Readonly<{
  jobId: string; capability: WorkOutputPtyCapability; onAccessDenied(error: ApiAuthError): void;
}>;
type ObservationBinding = ObservationProps & Readonly<{
  generation: number;
  observer: ReturnType<typeof createWorkOutputPtyObserver>;
  snapshot: WorkOutputPtySnapshot;
}>;

/** Optional local composition only; its capability can observe an existing session. */
export function WorkOutputPtyObservation({ jobId, capability, onAccessDenied }: ObservationProps) {
  const [binding, setBinding] = useState<ObservationBinding>();
  const generation = accessGeneration(capability);
  useEffect(() => {
    if (generation === undefined) return;
    let active = true;
    const current = createWorkOutputPtyObserver({ jobId, capability, onAccessDenied,
      onChange(snapshot) {
        if (active) setBinding({ jobId, capability, generation, onAccessDenied, observer: current, snapshot });
      },
    });
    setBinding({ jobId, capability, generation, onAccessDenied, observer: current, snapshot: current.getSnapshot() });
    return () => { active = false; current.dispose(); };
  }, [jobId, capability, onAccessDenied, generation]);
  // Bind text and controls together before passive cleanup, including a client
  // or auth-generation replacement which deliberately keeps the same Core job.
  const owned = binding?.jobId === jobId && binding.capability === capability
    && binding.generation === generation && binding.onAccessDenied === onAccessDenied ? binding : undefined;
  const visible = owned?.snapshot ?? { jobId, phase: 'idle' as const };
  const observer = owned?.observer;
  return <aside className="output-monitor-pty" aria-label="첫 패널 PTY 관찰">
    <h4>PTY 관찰 · 표시 전용</h4>
    <p>stdout·stderr가 섞인 관찰 출력입니다. 작업 상태·결과·사용량은 저장된 Core 기록을 따릅니다.</p>
    {visible.view ? <PtyOutputView snapshot={visible.view} onRead={() => { void observer?.read(); }}
      onDisconnect={() => observer?.disconnect()} onResize={size => observer?.resize(size)} onClose={() => observer?.close()} /> : <>
      {visible.phase === 'unavailable' ? <p role="status">기존 PTY 세션을 확인할 수 없습니다. 새 실행은 시작하지 않습니다.</p>
        : visible.phase === 'failed' ? <p role="alert">관찰 조회에 실패했습니다. 다시 선택해 조회할 수 있습니다.</p>
          : visible.phase === 'blocked' ? <p role="alert">접근이 중단되어 관찰 출력을 지웠습니다.</p>
            : visible.phase === 'closed' ? <p role="status">관찰 보기를 닫았습니다. 작업은 계속됩니다.</p> : null}
      <button className="secondary" type="button" disabled={!observer || visible.phase === 'discovering' || visible.phase === 'blocked'}
        onClick={() => { void observer?.open(); }}>{visible.phase === 'discovering' ? '기존 세션 조회 중' : '기존 PTY 관찰 보기'}</button>
    </>}
  </aside>;
}

function accessGeneration(capability: WorkOutputPtyCapability): number | undefined {
  try {
    const generation = capability.getAccessGeneration();
    return Number.isSafeInteger(generation) && generation >= 0 ? generation : undefined;
  } catch { return undefined; }
}
