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

const [{ parseWorkItemDeepLinkId }, { parseCollaborationDeepLink }] = await Promise.all([
  import('../src/client/WorkItemPanel.js'),
  import('../src/client/CollaborationPanel.js'),
]);

assert.equal(parseWorkItemDeepLinkId('?workItemId=work-123'), 'work-123');
assert.equal(parseWorkItemDeepLinkId('?workItemId=%20work-123%20'), 'work-123');
assert.equal(parseWorkItemDeepLinkId('?workItemId='), null);
assert.equal(parseWorkItemDeepLinkId('?other=value'), null);
assert.equal(parseWorkItemDeepLinkId(undefined), null);

assert.deepEqual(parseCollaborationDeepLink('?collaborationType=goal&collaborationId=goal-7'), {
  targetType: 'goal',
  targetId: 'goal-7',
});
assert.deepEqual(parseCollaborationDeepLink('?collaborationType=work-item&collaborationId=%20item-8%20'), {
  targetType: 'work-item',
  targetId: 'item-8',
});
assert.equal(parseCollaborationDeepLink('?collaborationType=unknown&collaborationId=x'), null);
assert.equal(parseCollaborationDeepLink('?collaborationType=project'), null);
assert.equal(parseCollaborationDeepLink(undefined), null);

console.log('Client deep-link parsing tests passed');
