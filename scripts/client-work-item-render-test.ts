import { strict as assert } from 'node:assert';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { registerHooks } from 'node:module';

const teamsJsTestModule = `
export const app = {
  getContext: async () => ({ app: { host: { clientType: 'web', name: 'Teams' } } }),
  initialize: async () => undefined,
  isInitialized: () => true,
};
export const authentication = { getAuthToken: async () => 'test-token' };
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

const workItemModule = await import('../src/client/WorkItemPanel.js');
const { WorkItemPanelError, WorkItemPanelResults } = workItemModule;
assert.equal(typeof WorkItemPanelResults, 'function');
assert.equal(typeof WorkItemPanelError, 'function');

const renderResults = (
  loading: boolean,
  hasItems: boolean,
  hasLoadError = false,
  children: React.ReactNode = null,
) => renderToStaticMarkup(
  React.createElement(WorkItemPanelResults, { loading, hasItems, hasLoadError, children }),
);

const loadingMarkup = renderResults(true, false);
assert.match(loadingMarkup, /class="work-item-status"/);
assert.match(loadingMarkup, /role="status"/);
assert.match(loadingMarkup, /aria-live="polite"/);
assert.match(loadingMarkup, /aria-atomic="true"/);
assert.match(loadingMarkup, /aria-busy="true"/);
assert.equal((loadingMarkup.match(/role="status"/g) ?? []).length, 1, 'loading has one status role without a nested status role');
assert.match(loadingMarkup, /업무 항목을 불러오는 중입니다/);

const emptyMarkup = renderResults(false, false);
assert.match(emptyMarkup, /class="work-item-status"/);
assert.match(emptyMarkup, /role="status"/);
assert.match(emptyMarkup, /aria-live="polite"/);
assert.match(emptyMarkup, /aria-atomic="true"/);
assert.match(emptyMarkup, /aria-busy="false"/);
assert.match(emptyMarkup, /표시할 업무 항목이 없습니다/);

const successMarkup = renderResults(false, true, false, React.createElement('article', { className: 'work-item-card' }, '성공 업무'));
assert.doesNotMatch(successMarkup, /aria-busy=/);
assert.doesNotMatch(successMarkup, /aria-live=/);
assert.doesNotMatch(successMarkup, /role="status"/);
assert.match(successMarkup, /class="work-item-card"/);
assert.match(successMarkup, /성공 업무/);

const errorMarkup = renderToStaticMarkup(React.createElement(WorkItemPanelError, { message: '업무 항목을 불러오지 못했습니다.' }));
assert.match(errorMarkup, /class="error" role="alert"/);
assert.match(errorMarkup, /업무 항목을 불러오지 못했습니다/);

const combinedFailureMarkup = renderToStaticMarkup(
  React.createElement(React.Fragment, null,
    React.createElement(WorkItemPanelError, { message: '업무 항목을 불러오지 못했습니다.' }),
    React.createElement(WorkItemPanelResults, { loading: false, hasItems: false, hasLoadError: true, children: null }),
  ),
);
assert.match(combinedFailureMarkup, /role="alert"/);
assert.doesNotMatch(combinedFailureMarkup, /role="status"/);
assert.doesNotMatch(combinedFailureMarkup, /표시할 업무 항목이 없습니다/);

console.log('Client work-item render tests passed');
