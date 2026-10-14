import React from 'react';

import type { PtyDisplayViewport, PtyOutputViewSnapshot } from './pty-output-reader.js';

const phaseLabels = {
  idle: '아직 출력을 조회하지 않았습니다.', loading: '마스킹된 출력을 조회 중입니다.', ready: '마지막 조회 출력',
  disconnected: '조회 연결이 끊겼습니다. 마지막 조회 출력입니다.', blocked: '출력 표시가 차단되었습니다.', closed: '출력 보기를 닫았습니다.',
};
const errorLabels = {
  'read-failed': '조회에 실패했습니다. 같은 세션으로 다시 조회할 수 있습니다.',
  'read-timeout': '조회 제한시간을 초과했습니다. 같은 세션으로 다시 조회할 수 있습니다.',
  'access-denied': '접근 권한이 없어 출력을 지웠습니다. 인증과 권한을 다시 확인하세요.',
  'session-unavailable': '기존 세션을 확인할 수 없어 출력을 지웠습니다. 새 프로세스를 시작하지 않습니다.',
  'invalid-snapshot': '출력의 세션 또는 안전한 줄 형식을 확인할 수 없어 출력을 지웠습니다.',
};

/** Text nodes only. No VT parser, linkifier, HTML injection, input or process control. */
export function PtyOutputView({ snapshot, onRead, onDisconnect, onResize, onClose }: Readonly<{
  snapshot: PtyOutputViewSnapshot;
  onRead(): void;
  onDisconnect(): void;
  onResize(size: PtyDisplayViewport): void;
  onClose(): void;
}>) {
  const hidden = snapshot.phase === 'blocked' || snapshot.phase === 'closed';
  const busy = snapshot.phase === 'loading';
  return <section aria-label="읽기 전용 PTY 출력 보기" aria-busy={busy}
    style={{ minWidth: 0, fontFamily: 'system-ui, sans-serif', color: '#182033', lineHeight: 1.5 }}>
    <h2>마스킹된 줄 보기</h2>
    <p>읽기 전용 출력입니다. 터미널 커서 이동·색상은 재현하지 않습니다.</p>
    <p role="status">{phaseLabels[snapshot.phase]}</p>
    {snapshot.phase === 'closed' ? null : <>
      {snapshot.error && <p role="alert">{errorLabels[snapshot.error]}</p>}
      <div role="group" aria-label="출력 조회 연결" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <button type="button" disabled={busy || hidden} onClick={onRead}>{snapshot.phase === 'disconnected' ? '같은 세션 재접속' : '출력 새로고침'}</button>
        <button type="button" disabled={hidden || snapshot.phase === 'disconnected'} onClick={onDisconnect}>조회 연결 끊기</button>
        <button type="button" onClick={onClose}>출력 보기 닫기</button>
      </div>
      {!hidden && <>
        <p><code>{snapshot.identity.jobId}</code> · 세대 {snapshot.identity.generation} · 조회 cursor {snapshot.cursor}</p>
        <p>{snapshot.sessionState === 'exited' ? `프로세스 종료 · 코드 ${snapshot.exit?.exitCode}${snapshot.exit?.signal === undefined ? '' : ` · 신호 ${snapshot.exit.signal}`}`
          : snapshot.sessionState === 'terminating' ? '프로세스 종료 요청 중'
          : snapshot.sessionState === 'termination_unverified' ? '프로세스 종료 미확인'
          : snapshot.sessionState === 'running' ? '마지막 관측 상태: 실행 중' : '프로세스 상태를 아직 조회하지 않았습니다.'}</p>
        <div role="group" aria-label="표시 영역 크기" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {[{ columns: 40, rows: 12 }, { columns: 80, rows: 24 }, { columns: 120, rows: 30 }].map(size =>
            <button type="button" key={size.columns} aria-pressed={snapshot.viewport.columns === size.columns && snapshot.viewport.rows === size.rows}
              onClick={() => onResize(size)}>{size.columns}×{size.rows}</button>)}
        </div>
        <p>표시 영역만 변경하며 PTY 크기는 바꾸지 않습니다.</p>
        {snapshot.historyTruncated && <p>이전 출력 일부가 보존되지 않았습니다.</p>}
        {snapshot.outputClipped && <p>긴 출력 줄 일부가 잘렸습니다.</p>}
        {snapshot.pendingOutput && <p>완성되지 않은 줄은 공개하지 않습니다.</p>}
        {snapshot.outputSuppressed && <p>출력 안전 경계가 손실되어 이후 출력을 숨겼습니다.</p>}
        <pre data-pty-output="true" data-columns={snapshot.viewport.columns} data-rows={snapshot.viewport.rows}
          role="region" aria-label="마스킹된 PTY 출력" aria-live="off" tabIndex={0}
          style={{ boxSizing: 'border-box', width: '100%', maxWidth: `${snapshot.viewport.columns}ch`, height: `${snapshot.viewport.rows * 1.5}em`,
            overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', tabSize: 4, direction: 'ltr', unicodeBidi: 'plaintext',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 14, lineHeight: 1.5,
            padding: 12, borderRadius: 8, border: '1px solid #47516b', background: '#141923', color: '#f0f3ff' }}>
          {snapshot.frames.length ? snapshot.frames.map(frame => frame.text).join('') : '아직 공개된 출력 줄이 없습니다.'}
        </pre>
      </>}
    </>}
  </section>;
}
