import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { PtyOutputView } from '../../src/client/PtyOutputView.js';
import { createPtyOutputReader, PtyOutputReadError, type PtyOutputViewSnapshot } from '../../src/client/pty-output-reader.js';
import type { PtyReadSnapshot } from '../../src/shared/pty-read.js';

const fixture: { sourceCommit: string; worktree: string; snapshots: PtyReadSnapshot[] } = JSON.parse(document.getElementById('synthetic-fixture')!.textContent!);
const audit = { reads: [] as Array<{ after: number; sessionId: string; generation: number }>, spawn: 0, input: 0, nativeResize: 0, terminate: 0 };
Object.assign(window, { __ptyFixtureAudit: audit });
let selected = 0;
let failure: 'none' | 'network' | 'denied' | 'raw-vt' = 'none';

function Preview() {
  const [snapshot, setSnapshot] = useState<PtyOutputViewSnapshot>();
  const [controls, setControls] = useState(0);
  const [reader] = useState(() => createPtyOutputReader({
    identity: fixture.snapshots[0]!, onChange: setSnapshot,
    transport: { read: async (identity, after, signal) => {
      audit.reads.push({ after, sessionId: identity.sessionId, generation: identity.generation });
      await new Promise(resolve => setTimeout(resolve, 60));
      if (signal.aborted) throw new Error('Synthetic read detached.');
      if (failure === 'denied') throw new PtyOutputReadError('access-denied');
      if (failure === 'network') throw new Error('Synthetic disconnected transport.');
      const current = fixture.snapshots[selected]!;
      return { ...current, frames: current.frames.filter(frame => frame.sequence > after),
        truncated: after < current.firstAvailableSequence - 1,
        outputMode: failure === 'raw-vt' ? 'raw-vt' : current.outputMode };
    } },
  }));
  useEffect(() => () => reader.dispose(), [reader]);
  return <main style={{ maxWidth: 1100, margin: '0 auto', padding: 20 }}>
    <h1>격리된 합성 PTY 출력 시험</h1>
    <p>운영 서버·인증정보·작업과 연결되지 않은 고정 합성 출력입니다.</p>
    <p>기준 소스: <code data-preview-commit>{fixture.sourceCommit}</code> · {fixture.worktree}</p>
    <details><summary>합성 시험 상태 전환</summary>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '12px 0' }}>
        <button onClick={() => { selected = Math.min(selected + 1, fixture.snapshots.length - 1); setControls(value => value + 1); }}>합성 출력 추가</button>
        {(['none', 'network', 'denied', 'raw-vt'] as const).map(mode => <button key={mode}
          onClick={() => { failure = mode; setControls(value => value + 1); }}>{({ none: '정상 조회', network: '연결 오류 시험', denied: '권한 차단 시험', 'raw-vt': '원시 VT 거부 시험' })[mode]}</button>)}
      </div>
      <output data-fixture-selection>{selected} / {failure} / {controls}</output>
    </details>
    <PtyOutputView snapshot={snapshot ?? reader.getSnapshot()} onRead={() => { void reader.read(); }}
      onDisconnect={() => reader.disconnect()} onResize={size => reader.resize(size)} onClose={() => reader.dispose()} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
