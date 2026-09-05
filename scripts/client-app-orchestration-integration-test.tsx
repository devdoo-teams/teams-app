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

for (const search of ['', '?view=orchestration', '?view=work', '?view=settings']) {
  const markup = renderAppAt(search);
  assert.match(markup, /<h1[^>]*>에이전트 허브<\/h1>/, 'every legacy deep link resolves to the one minimal agent hub');
  assert.match(markup, /<h2[^>]*>에이전트 작업<\/h2>/, 'the shipped tab renders the durable agent work surface');
  assert.doesNotMatch(markup, /<nav/, 'the single-purpose tab has no redundant section navigation');
  assert.doesNotMatch(markup, /현재 위치|날씨|weather/i, 'weather and device location are absent from the shipped tab');
  assert.doesNotMatch(markup, /오늘 업무|Atlassian parity|협업|응답 모드|CopilotKit/i, 'unrelated legacy surfaces are absent from the shipped tab');
}

hooks.deregister();
delete (globalThis as { window?: unknown }).window;

console.log('Client App orchestration integration tests passed');
