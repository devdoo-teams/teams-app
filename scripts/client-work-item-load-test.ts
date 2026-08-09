import { strict as assert } from 'node:assert';
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

const { createLatestWorkItemLoadController } = await import('../src/client/WorkItemPanel.js');

const controller = createLatestWorkItemLoadController();
const first = controller.begin();
const second = controller.begin();
assert.equal(first.signal.aborted, true, 'a newer work-item load aborts the older request');
assert.equal(first.commit(() => undefined), false, 'a stale work-item response cannot commit state');
assert.equal(second.commit(() => undefined), true, 'the newest work-item response can commit state');

controller.dispose();
assert.equal(second.signal.aborted, true, 'disposing the panel aborts the active request');
assert.equal(second.commit(() => undefined), false, 'a disposed panel cannot commit a late response');

console.log('Client work-item load tests passed');
