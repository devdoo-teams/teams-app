import { strict as assert } from 'node:assert';
import { registerHooks } from 'node:module';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const teamsJsTestModule = `
export const app = {
  getContext: async () => ({ app: { host: { clientType: 'web', name: 'Teams' } } }),
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

registerHooks({
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

const {
  LazyCopilotRuntimeErrorBoundary,
  createLatestRequestController,
} = await import('../src/client/App.js');

{
  const controller = createLatestRequestController();
  const first = controller.begin();
  const visibleState = {
    items: 'newer response',
    auth: 'newer account',
    loading: true,
  };

  const second = controller.begin();

  assert.equal(first.signal.aborted, true, 'starting a newer request aborts the older request');
  assert.equal(
    first.commit(() => {
      visibleState.items = 'stale response';
      visibleState.auth = 'stale account';
    }),
    false,
    'a stale response cannot commit item or auth state',
  );
  assert.equal(
    first.commit(() => {
      visibleState.loading = false;
    }),
    false,
    'a stale finally block cannot clear loading for the newer request',
  );
  assert.deepEqual(visibleState, {
    items: 'newer response',
    auth: 'newer account',
    loading: true,
  });

  assert.equal(second.commit(() => {
    visibleState.loading = false;
  }), true, 'the current request can commit its final loading state');
  assert.equal(visibleState.loading, false);
}

{
  let retries = 0;
  let reloads = 0;
  const boundary = new LazyCopilotRuntimeErrorBoundary({
    children: React.createElement('p', null, 'copilot runtime'),
    onRetry: () => {
      retries += 1;
    },
    onReload: () => {
      reloads += 1;
    },
  });

  const importError = new Error('Loading chunk failed');
  boundary.state = {
    ...boundary.state,
    ...LazyCopilotRuntimeErrorBoundary.getDerivedStateFromError(importError),
  };

  const fallback = boundary.render();
  assert.ok(React.isValidElement(fallback), 'a rejected lazy import renders a boundary fallback');
  const fallbackMarkup = renderToStaticMarkup(fallback);
  assert.match(fallbackMarkup, /role="alert"/);
  assert.match(fallbackMarkup, /업무 도우미를 불러오지 못했습니다/);
  assert.match(fallbackMarkup, /다시 시도/);
  assert.match(fallbackMarkup, /새로고침/);

  const fallbackProps = fallback.props as { onRetry: () => void; onReload: () => void };
  fallbackProps.onRetry();
  fallbackProps.onReload();
  assert.equal(retries, 1, 'the fallback exposes a retry action for the rejected chunk');
  assert.equal(reloads, 1, 'the fallback exposes a full reload action for the rejected chunk');
}

console.log('Client refresh and lazy recovery tests passed');
