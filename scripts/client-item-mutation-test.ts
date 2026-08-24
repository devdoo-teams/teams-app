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

const workItemModule = await import('../src/client/WorkItemPanel.js');
const { ApiAuthError } = await import('../src/client/auth.js');
const { applyStableMutationKey, getWorkItemAssigneeButtonState } = workItemModule;
const createWorkItemMutationOperation = (workItemModule as typeof workItemModule & {
  createWorkItemMutationOperation?: (options: {
    path: string;
    init: RequestInit;
    busyKey: string;
    pending: Map<string, { fingerprint: string; key: string }>;
    request: (path: string, init: RequestInit) => Promise<Response>;
    begin: () => void;
    setBusy: (busy: boolean) => void;
    onFailure: (caught: unknown, retry: () => Promise<void>) => void;
    onSuccess: () => void | Promise<void>;
    reload: () => Promise<void>;
    fallback: string;
  }) => () => Promise<boolean>;
}).createWorkItemMutationOperation;

assert.deepEqual(
  getWorkItemAssigneeButtonState(false),
  { label: '나에게 할당', disabled: false },
  'an item not assigned to the requester keeps the assign action enabled',
);
assert.deepEqual(
  getWorkItemAssigneeButtonState(true),
  { label: '나에게서 해제', disabled: false },
  'an item assigned to the requester exposes an enabled unassign action',
);

{
  const pending = new Map<string, { fingerprint: string; key: string }>();
  const first = applyStableMutationKey(
    '/api/work-items',
    { method: 'POST', body: JSON.stringify({ title: 'retry me' }) },
    'create',
    pending,
  );
  const retry = applyStableMutationKey(
    '/api/work-items',
    { method: 'POST', body: JSON.stringify({ title: 'retry me' }) },
    'create',
    pending,
  );
  assert.equal(retry.key, first.key, 'a retry with the same payload reuses the mutation key');
  assert.notEqual(
    applyStableMutationKey('/api/work-items', { method: 'POST', body: JSON.stringify({ title: 'new payload' }) }, 'create', pending).key,
    first.key,
    'a changed payload starts a new logical mutation instead of replaying the old one',
  );
}

{
  assert.equal(
    typeof createWorkItemMutationOperation,
    'function',
    'WorkItemPanel exposes the mutation operation used by its UI handlers',
  );
  const pending = new Map<string, { fingerprint: string; key: string }>();
  const mutationKeys: string[] = [];
  const busyStates: boolean[] = [];
  let requestAttempts = 0;
  const retryController = workItemModule.createUserDrivenAuthRetryController();
  let commentInput = '재시도할 댓글';
  let reloads = 0;
  let begins = 0;

  const operation = createWorkItemMutationOperation?.({
    path: '/api/work-items/item-1/comments',
    init: { method: 'POST', body: JSON.stringify({ body: commentInput }) },
    busyKey: 'comment:item-1',
    pending,
    request: async (_path, init) => {
      requestAttempts += 1;
      const body = JSON.parse(String(init.body)) as { mutationKey?: string };
      mutationKeys.push(body.mutationKey ?? '');
      if (requestAttempts === 1) throw new ApiAuthError('auth-expired');
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
    begin: () => {
      begins += 1;
    },
    setBusy: (busy) => {
      busyStates.push(busy);
    },
    onFailure: (caught, retry) => {
      workItemModule.captureWorkItemRequestFailure(
        retryController,
        'comment:item-1',
        caught,
        '댓글을 추가하지 못했습니다.',
        retry,
      );
    },
    onSuccess: () => {
      commentInput = '';
    },
    reload: async () => {
      reloads += 1;
    },
    fallback: '댓글을 추가하지 못했습니다.',
  });
  assert.ok(operation);

  assert.equal(await operation(), false, 'an auth failure preserves the whole comment operation for user retry');
  assert.equal(commentInput, '재시도할 댓글', 'failed comment input remains visible');
  assert.equal(retryController.hasPending('comment:item-1'), true);
  assert.equal(await retryController.retry('comment:item-1'), true);

  assert.equal(requestAttempts, 2);
  assert.equal(mutationKeys[0], mutationKeys[1], 'the user retry preserves the mutation idempotency key');
  assert.equal(commentInput, '', 'successful replay performs the comment UI cleanup');
  assert.equal(reloads, 1, 'successful replay refreshes the rendered work-item list');
  assert.equal(begins, 2, 'each attempt enters the real panel request lifecycle');
  assert.deepEqual(busyStates, [true, false, true, false]);
  assert.equal(pending.has('comment:item-1'), false, 'the mutation key is released only after full success');
}

{
  let renderedMessage = '';
  const operation = createWorkItemMutationOperation?.({
    path: '/api/work-items/item-1/comments',
    init: { method: 'POST', body: JSON.stringify({ body: '민감 오류 검증' }) },
    busyKey: 'comment:item-1',
    pending: new Map(),
    request: async () => new Response(
      JSON.stringify({ error: 'CANARY server bearer and stack detail' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    ),
    begin: () => undefined,
    setBusy: () => undefined,
    onFailure: (caught) => {
      renderedMessage = workItemModule.classifyWorkItemRequestError(
        caught,
        '댓글을 추가하지 못했습니다.',
      ).message;
    },
    onSuccess: () => undefined,
    reload: async () => undefined,
    fallback: '댓글을 추가하지 못했습니다.',
  });
  assert.equal(await operation?.(), false);
  assert.equal(renderedMessage, '댓글을 추가하지 못했습니다.');
  assert.doesNotMatch(renderedMessage, /CANARY|bearer|stack/i);
}

{
  const pending = new Map<string, { fingerprint: string; key: string }>();
  const mutationKeys: string[] = [];
  let requestAttempts = 0;
  let successCallbacks = 0;
  let reloadAttempts = 0;
  let retry: (() => Promise<void>) | undefined;

  const operation = createWorkItemMutationOperation?.({
    path: '/api/work-items/item-2/comments',
    init: { method: 'POST', body: JSON.stringify({ body: '단계 재개' }) },
    busyKey: 'comment:item-2',
    pending,
    request: async (_path, init) => {
      requestAttempts += 1;
      mutationKeys.push((JSON.parse(String(init.body)) as { mutationKey: string }).mutationKey);
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
    begin: () => undefined,
    setBusy: () => undefined,
    onFailure: (_caught, resume) => {
      retry = resume;
    },
    onSuccess: () => {
      successCallbacks += 1;
      throw new Error('synthetic callback failure after cleanup began');
    },
    reload: async () => {
      reloadAttempts += 1;
      if (reloadAttempts === 1) throw new Error('synthetic reload failure');
    },
    fallback: '댓글을 추가하지 못했습니다.',
  });
  assert.ok(operation);

  assert.equal(await operation(), false, 'a callback failure pauses the operation after server success');
  assert.ok(retry, 'the failed phase exposes one user-driven resume');
  await retry!();
  assert.ok(retry, 'a failed reload exposes a reload-only resume');
  await retry!();

  assert.equal(requestAttempts, 1, 'a confirmed server mutation is never replayed by later phase failures');
  assert.equal(successCallbacks, 1, 'input cleanup and success callbacks execute at most once');
  assert.equal(reloadAttempts, 2, 'only the failed reload phase is retried');
  assert.equal(new Set(mutationKeys).size, 1, 'the logical mutation retains one idempotency key');
  assert.equal(pending.has('comment:item-2'), false, 'the key is released only after reload succeeds');
}

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
