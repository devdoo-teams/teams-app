import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { App } from '../src/client/App.js';
import { ExecutionPresentationSelectionSchema } from '../src/shared/execution-presentation.js';
const html = renderToStaticMarkup(<App />);
for (const label of ['① 채팅 중심', '② 요약 카드', '③ 채팅 + 별도 상세', '도구 결과', '진행 단계', '진단 정보', '상세 위치', 'CopilotKit 대화 열기']) {
  assert.ok(html.includes(label), `normal app entry must expose demo control: ${label}`);
}
const choice = ExecutionPresentationSelectionSchema.safeParse({ mode: 'text', details: ['tool'], richSurface: 'tab' });
assert.ok(choice.success, 'owner display selection must accept demo detail and surface settings without changing execution');
assert.equal(ExecutionPresentationSelectionSchema.safeParse({mode:'summary',details:['unknown']}).success,false);
assert.equal(ExecutionPresentationSelectionSchema.safeParse({mode:'summary',details:['tool','tool']}).success,false);
assert.equal(ExecutionPresentationSelectionSchema.safeParse({mode:'summary',requesterId:'foreign'}).success,false);
console.log('PASS: original demo controls are discoverable at ordinary app entry; strict display settings stay separate from execution');
