import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createPtyOutputReader, type PtyOutputViewSnapshot } from '../src/client/pty-output-reader.js';

const implementation = await import('../src/client/PtyOutputView.js').catch(() => ({} as Record<string, any>));
assert.equal(typeof implementation.PtyOutputView, 'function', 'masked PTY frames need a text-only view with explicit reconnect and viewport controls');
const initial = createPtyOutputReader({ identity: { jobId: 'task-synthetic', sessionId: 'synthetic-session', generation: 1 },
  transport: { read: async () => { throw new Error('Static rendering must never read or spawn.'); } } }).getSnapshot();
const ready: PtyOutputViewSnapshot = { ...initial, phase: 'ready', sessionState: 'running', cursor: 1,
  frames: [{ sequence: 1, text: '한글 😀 token=[REDACTED]\n<img src=x onerror=alert(1)>\n<a href="https://example.invalid">literal</a>\n' }] };
const noop = () => {};
const render = (snapshot: PtyOutputViewSnapshot) => renderToStaticMarkup(React.createElement(implementation.PtyOutputView,
  { snapshot, onRead: noop, onDisconnect: noop, onResize: noop, onClose: noop }));
let checks = 0;
function check(name: string, fn: () => void) { fn(); checks++; console.log(`PASS ${name}`); }
check('text-only view escapes HTML, preserves Korean and emoji, and creates no links or inputs', () => {
  const html = render(ready);
  assert.match(html, /한글 😀 token=\[REDACTED\]/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<(?:img|a|iframe|input|textarea|script)\b|contentEditable=/i);
  assert.match(html, /마스킹된 줄 보기/); assert.match(html, /커서 이동·색상은 재현하지 않습니다/);
});
check('initial, loading and empty states do not claim a live terminal stream', () => {
  assert.match(render(initial), /아직 출력을 조회하지 않았습니다/);
  assert.match(render({ ...initial, phase: 'loading' }), /aria-busy="true"/);
  assert.match(render({ ...ready, frames: [], cursor: 0 }), /아직 공개된 출력 줄이 없습니다/);
  assert.doesNotMatch(render(ready), /실시간 스트리밍 중|명령 입력/);
});
check('disconnected safe text is labelled stale and reconnect targets the same session', () => {
  const html = render({ ...ready, phase: 'disconnected', error: 'read-timeout' });
  assert.match(html, /마지막 조회 출력/); assert.match(html, /같은 세션 재접속/);
  assert.match(html, /조회 제한시간/); assert.match(html, /한글 😀/);
});
check('blocked and closed surfaces hide private output and identity', () => {
  for (const phase of ['blocked', 'closed'] as const) {
    const html = render({ ...ready, phase, error: phase === 'blocked' ? 'access-denied' : undefined });
    assert.doesNotMatch(html, /한글 😀|task-synthetic|synthetic-session|onerror/);
    assert.doesNotMatch(html, /data-pty-output="true"/);
  }
});
check('loading disables duplicate read controls; blocked sessions cannot reconnect implicitly', () => {
  assert.match(render({ ...ready, phase: 'loading' }), /<button[^>]*disabled=""[^>]*>출력 새로고침/);
  assert.match(render({ ...ready, phase: 'blocked', frames: [] }), /<button[^>]*disabled=""[^>]*>출력 새로고침/);
});
check('history gaps, clipping, pending lines and output suppression are explicit', () => {
  const html = render({ ...ready, historyTruncated: true, outputClipped: true, pendingOutput: true, outputSuppressed: true });
  for (const label of ['이전 출력 일부가 보존되지 않았습니다', '긴 출력 줄 일부가 잘렸습니다', '완성되지 않은 줄은 공개하지 않습니다', '출력 안전 경계가 손실되어 이후 출력을 숨겼습니다']) {
    assert.ok(html.includes(label), label);
  }
});
check('native exit and uncertain termination remain independent of read connection state', () => {
  assert.match(render({ ...ready, sessionState: 'exited', exit: { exitCode: 7, signal: 15 } }), /프로세스 종료 · 코드 7 · 신호 15/);
  assert.match(render({ ...ready, sessionState: 'terminating' }), /프로세스 종료 요청 중/);
  assert.match(render({ ...ready, sessionState: 'termination_unverified' }), /프로세스 종료 미확인/);
});
check('viewport controls change display size and state the lack of PTY resize', () => {
  const html = render({ ...ready, viewport: { columns: 40, rows: 12 } });
  assert.match(html, /data-columns="40"/); assert.match(html, /data-rows="12"/);
  assert.match(html, /max-width:40ch/); assert.match(html, /height:18em/);
  assert.match(html, /표시 영역만 변경하며 PTY 크기는 바꾸지 않습니다/);
  assert.match(html, /aria-label="마스킹된 PTY 출력"/); assert.match(html, /aria-live="off"/);
});
check('closing provides a bounded empty end state without output controls', () => {
  const html = render({ ...ready, phase: 'closed' });
  assert.match(html, /출력 보기를 닫았습니다/); assert.doesNotMatch(html, /<button/);
});
console.log(`PTY output view markup: ${checks} checks PASS (React static markup; actual browser pixels/foreground Teams are separate).`);
