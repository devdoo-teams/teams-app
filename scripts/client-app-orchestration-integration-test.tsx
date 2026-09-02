import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const teamsJsTestModule = `
export const app = {
  getContext: async () => ({ app: { host: { clientType: 'web', name: 'Teams', sessionId: 'test' } } }),
  initialize: async () => undefined,
  isInitialized: () => true,
};
export const authentication = { getAuthToken: async () => 'test-token' };
export const geoLocation = {
  getCurrentLocation: async () => ({ latitude: 37.5, longitude: 127 }),
  hasPermission: async () => true,
  isSupported: () => false,
  requestPermission: async () => true,
};
export const location = {
  getLocation: () => undefined,
  isSupported: () => false,
};
`;

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@microsoft/teams-js') {
      return {
        format: 'module',
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(teamsJsTestModule)}`,
      };
    }
    return nextResolve(specifier, context);
  },
});

type TestWindow = {
  location: { search: string };
  history: { replaceState: (state: unknown, unused: string, url?: string | URL | null) => void };
  addEventListener: () => void;
  removeEventListener: () => void;
};

function renderAppAt(search: string): string {
  const testWindow: TestWindow = {
    location: { search },
    history: { replaceState: () => undefined },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: testWindow });
  return renderToStaticMarkup(React.createElement(App));
}

const { App } = await import('../src/client/App.js');

const orchestrationMarkup = renderAppAt('?view=orchestration');
assert.match(orchestrationMarkup, /<nav[^>]*aria-label="업무 허브 메뉴"/, 'the Core surface stays in the existing accessible hub navigation');
assert.match(orchestrationMarkup, /aria-current="page"[^>]*>에이전트</, 'the orchestration destination is discoverable and active');
assert.match(orchestrationMarkup, /<h2[^>]*>에이전트 오케스트레이션<\/h2>/, 'the orchestration route renders the committed Core panel');
assert.doesNotMatch(orchestrationMarkup, /현재 위치 날씨 위젯/, 'the orchestration route does not accidentally render the Today surface');

for (const label of ['오늘', '내 업무', '활동', '설정']) {
  assert.match(orchestrationMarkup, new RegExp(`>${label}<`), `existing ${label} navigation remains available`);
}

const todayMarkup = renderAppAt('');
assert.match(todayMarkup, /aria-current="page"[^>]*>오늘</, 'Today remains the default active destination');
assert.match(todayMarkup, /aria-label="현재 위치 날씨 위젯"/, 'the existing weather surface remains rendered on Today');
assert.match(todayMarkup, /오늘 업무/, 'the existing work summary remains rendered on Today');
assert.doesNotMatch(todayMarkup, /<h2[^>]*>에이전트 오케스트레이션<\/h2>/, 'the Core panel does not crowd the existing Today surface');

const workMarkup = renderAppAt('?view=work');
assert.match(workMarkup, /aria-current="page"[^>]*>내 업무</, 'the existing Work destination remains active and addressable');
assert.match(workMarkup, /aria-label="Atlassian parity 업무 항목"/, 'the existing Work panel remains rendered');

const activityMarkup = renderAppAt('?view=activity');
assert.match(activityMarkup, /aria-current="page"[^>]*>활동</, 'the existing Activity destination remains active and addressable');
assert.match(activityMarkup, /협업/, 'the existing collaboration surface remains rendered');

const settingsMarkup = renderAppAt('?view=settings');
assert.match(settingsMarkup, /aria-current="page"[^>]*>설정</, 'the existing Settings destination remains active and addressable');
assert.match(settingsMarkup, /응답 모드/, 'the existing response-mode settings remain rendered');

hooks.deregister();
delete (globalThis as { window?: unknown }).window;

console.log('Client App orchestration integration tests passed');
