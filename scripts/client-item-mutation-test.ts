import { strict as assert } from 'node:assert';

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

import { registerHooks } from 'node:module';

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

const { createDeleteConfirmationController, createItemMutationController } = await import('../src/client/App.js');

{
  const confirmation = createDeleteConfirmationController();

  assert.equal(confirmation.request(42), null, 'the first delete gesture does not delete immediately');
  assert.equal(confirmation.pendingId(), 42, 'the requested item is rendered as pending confirmation');
  assert.equal(confirmation.request(42), 42, 'the second gesture confirms the same item without a browser dialog');
  assert.equal(confirmation.pendingId(), null, 'confirmed deletion clears the pending item');
  assert.equal(confirmation.cancel(), null, 'cancelling an already settled deletion is harmless');

  confirmation.request(7);
  assert.equal(confirmation.cancel(), 7, 'the inline cancel action clears the pending item');
  assert.equal(confirmation.pendingId(), null, 'cancelled deletion does not remain pending');
}

{
  const controller = createItemMutationController();
  const first = controller.begin('toggle:1');

  assert.ok(first, 'the first gesture acquires the item mutation lease');
  assert.equal(controller.begin('toggle:1'), null, 'a duplicate gesture is rejected while the request is in flight');
  assert.equal(controller.isBusy('toggle:1'), true, 'the duplicate gesture keeps the control busy');

  let commits = 0;
  assert.equal(first.commit(() => { commits += 1; }), true, 'the active mutation can commit its response');
  assert.equal(commits, 1);
  assert.equal(first.release(), true, 'the active mutation releases its lease once');
  assert.equal(controller.isBusy('toggle:1'), false, 'the control becomes available after the request settles');
  assert.equal(first.commit(() => { commits += 1; }), false, 'a settled response cannot commit again');
  assert.equal(commits, 1);
}

{
  const controller = createItemMutationController();
  const stale = controller.begin('save:7');
  assert.ok(stale);

  controller.invalidate();
  const current = controller.begin('save:7');
  assert.ok(current, 'a new lifecycle can acquire the same mutation key');

  let staleCommits = 0;
  let currentCommits = 0;
  assert.equal(stale.release(), false, 'an invalidated mutation cannot release the current lifecycle');
  assert.equal(stale.commit(() => { staleCommits += 1; }), false, 'a stale response cannot update the UI');
  assert.equal(controller.isBusy('save:7'), true, 'a stale response cannot re-enable the current control');
  assert.equal(current.commit(() => { currentCommits += 1; }), true, 'the current response can update the UI');
  assert.equal(current.release(), true);
  assert.equal(staleCommits, 0);
  assert.equal(currentCommits, 1);
}

console.log('Client item mutation tests passed');
