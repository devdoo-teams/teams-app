import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExecutionPresentationCard, ExecutionPresentationResult } from '../src/client/ExecutionPresentationCard.js';
import { createExecutionPresentation } from '../src/shared/execution-presentation.js';

const job = { id: 'synthetic-image-result', provider: 'codex' as const, mode: 'read-only' as const,
  status: 'failed' as const, prompt: '합성 이미지 확인', result: '설명\n![가로 합성 이미지](/assets/wide.png)\n끝',
  error: 'SYNTHETIC_FAILURE', progress: [], createdAt: '2026-10-10T00:00:00Z' };
const render = (result: string) => renderToStaticMarkup(<ExecutionPresentationResult presentation={createExecutionPresentation({ ...job, result })} />);
const image = render(job.result);
assert.match(image, /<img[^>]+src="\/assets\/wide.png"/);
assert.match(image, /alt="가로 합성 이미지"/);
assert.match(image, /<figure/);
assert.ok(image.indexOf('설명') < image.indexOf('<figure') && image.indexOf('<figure') < image.indexOf('끝'));
for (const url of ['https://external.example/image.png', '//external.example/x.png', 'javascript:alert(1)',
  'data:image/png;base64,AAA', '/assets/../secret.png', '/assets/%2e%2e/secret.png', '/assets/a.png?token=secret',
  '/assets/a.svg', '/assets/a.png#fragment', '/assets/a\\b.png']) {
  const html = render(`![합성 대체 설명](${url})`);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /합성 대체 설명/);
}
assert.doesNotMatch(render('<img src=x onerror=alert(1)>'), /<img/);
const many = render(Array.from({ length: 9 }, (_, i) => `![이미지 ${i}](/assets/image-${i}.png)`).join('\n'));
assert.equal((many.match(/<img/g) ?? []).length, 4, 'bound automatic image loads');
const longText = '긴 한국어와 English '.repeat(80);
const long = render(longText);
assert.match(long, /전체 결과 보기/);
assert.ok(long.includes(longText), 'disclosure retains the entire stored text');
// Compact long content must not cut an image token into misleading text.
assert.equal((render(`${'가'.repeat(450)}\n![합성 이미지](/assets/wide.png)\n${'나'.repeat(600)}`).match(/<img/g) ?? []).length, 1);
const card = renderToStaticMarkup(<ExecutionPresentationCard presentation={createExecutionPresentation(job)} />);
assert.match(card, /SYNTHETIC_FAILURE/);
assert.match(card, /<details class="presentation-diagnostics"><summary>진단 정보 펼치기 \/ 접기/);
console.log('PASS: shared result renders bounded same-origin raster image rows, escapes HTML, rejects remote/unsafe paths, and retains full text and mandatory failure outside collapsed diagnostics');
