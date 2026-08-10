import { strict as assert } from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  CollaborationPanel,
  createLatestCollaborationLoadController,
} from '../src/client/CollaborationPanel.js';

const collaborationModule = await import('../src/client/CollaborationPanel.js') as Record<string, unknown>;
assert.equal(
  typeof collaborationModule.loadCollaborationActivity,
  'function',
  'Activity exposes one loader for subscriptions, digest, and notifications',
);
assert.equal(
  typeof collaborationModule.CollaborationActivityState,
  'function',
  'Activity exposes deterministic loading, error, empty, and success rendering',
);

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

if (
  typeof collaborationModule.loadCollaborationActivity === 'function'
  && typeof collaborationModule.CollaborationActivityState === 'function'
) {
  type Notification = {
    id: string;
    target: { type: 'work-item'; id: string };
    title: string;
    body: string;
    occurredAt: string;
    deepLink: { href: string };
  };
  type ActivityData = {
    subscriptions: unknown[];
    bindings: unknown[];
    preferences: unknown[];
    digest: { period: string; totalCount: number; entries: unknown[] };
    notifications: Notification[];
  };
  type Loader = (
    fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
    signal: AbortSignal,
  ) => Promise<ActivityData>;
  type StateComponent = React.ComponentType<{
    data: ActivityData;
    error: string;
    loading: boolean;
    onRetry: () => void;
  }>;

  const loadCollaborationActivity = collaborationModule.loadCollaborationActivity as Loader;
  const CollaborationActivityState = collaborationModule.CollaborationActivityState as StateComponent;
  const requested: string[] = [];
  const notification: Notification = {
    id: 'notification-1',
    target: { type: 'work-item', id: 'work-1' },
    title: '업무 업데이트',
    body: '상태: done',
    occurredAt: '2026-08-10T01:00:00.000Z',
    deepLink: { href: '/tabs/home/?collaborationType=work-item&collaborationId=work-1' },
  };
  const payloads = new Map<string, unknown>([
    ['/api/collaboration/subscriptions', { subscriptions: [] }],
    ['/api/collaboration/digest?period=weekly', { digest: { period: 'weekly', totalCount: 0, entries: [] } }],
    ['/api/collaboration/notifications?limit=10', { notifications: [notification] }],
    ['/api/collaboration/bindings', { bindings: [] }],
    ['/api/collaboration/preferences', { preferences: [] }],
  ]);
  const data = await loadCollaborationActivity(async (input) => {
    const url = String(input);
    requested.push(url);
    return new Response(JSON.stringify(payloads.get(url)), {
      status: payloads.has(url) ? 200 : 404,
      headers: { 'content-type': 'application/json' },
    });
  }, new AbortController().signal);

  assert.deepEqual(requested, [
    '/api/collaboration/subscriptions',
    '/api/collaboration/digest?period=weekly',
    '/api/collaboration/notifications?limit=10',
    '/api/collaboration/bindings',
    '/api/collaboration/preferences',
  ]);
  assert.equal(data.notifications[0]?.deepLink.href, notification.deepLink.href);

  const emptyData: ActivityData = {
    subscriptions: [],
    bindings: [],
    preferences: [],
    digest: { period: 'weekly', totalCount: 0, entries: [] },
    notifications: [],
  };
  const renderState = (props: Omit<React.ComponentProps<StateComponent>, 'onRetry'>) => renderToStaticMarkup(
    React.createElement(CollaborationActivityState, { ...props, onRetry: () => undefined }),
  );
  assert.match(renderState({ data: emptyData, error: '', loading: true }), /협업 설정을 불러오는 중입니다/);
  const errorMarkup = renderState({ data: emptyData, error: '알림을 불러오지 못했습니다.', loading: false });
  assert.match(errorMarkup, /role="alert"/);
  assert.match(errorMarkup, /다시 시도/);
  const emptyMarkup = renderState({ data: emptyData, error: '', loading: false });
  assert.match(emptyMarkup, /최근 알림이 없습니다/);
  assert.match(emptyMarkup, /아직 업데이트 digest가 없습니다/);
  const populatedMarkup = renderState({ data, error: '', loading: false });
  assert.match(populatedMarkup, /업무 업데이트/);
  assert.match(populatedMarkup, /collaborationType=work-item&amp;collaborationId=work-1/);

  await assert.rejects(
    () => loadCollaborationActivity(async (input) => {
      const url = String(input);
      const notificationsOk = url !== '/api/collaboration/notifications?limit=10';
      return new Response(JSON.stringify(notificationsOk
        ? payloads.get(url)
        : { error: '알림 저장소를 읽지 못했습니다.' }), {
        status: notificationsOk ? 200 : 503,
        headers: { 'content-type': 'application/json' },
      });
    }, new AbortController().signal),
    /알림 저장소를 읽지 못했습니다/,
  );
}

console.log('Client collaboration panel tests passed');
