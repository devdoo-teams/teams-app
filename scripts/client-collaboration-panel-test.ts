import { strict as assert } from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  CollaborationPanel,
  createLatestCollaborationLoadController,
} from '../src/client/CollaborationPanel.js';

{
  const controller = createLatestCollaborationLoadController();
  const first = controller.begin();
  const second = controller.begin();

  assert.equal(first.signal.aborted, true, 'starting a newer collaboration load aborts the older request');
  assert.equal(
    first.commit(() => undefined),
    false,
    'a stale collaboration response cannot commit state',
  );
  assert.equal(
    second.commit(() => undefined),
    true,
    'the latest collaboration response can commit state',
  );

  const currentState = { error: '현재 요청 오류', subscriptions: ['latest'] };
  first.commit(() => {
    currentState.error = '';
    currentState.subscriptions = ['stale'];
  });
  assert.deepEqual(
    currentState,
    { error: '현재 요청 오류', subscriptions: ['latest'] },
    'a stale success or error cannot clear the latest collaboration state',
  );
}

{
  const markup = renderToStaticMarkup(React.createElement(CollaborationPanel));
  assert.match(markup, /불러오는 중/);
  assert.match(markup, /aria-busy="true"/);
  assert.match(markup, /협업 설정을 불러오는 중입니다/);
  assert.match(markup, /협업 대상 ID/);
}

console.log('Client collaboration panel tests passed');
