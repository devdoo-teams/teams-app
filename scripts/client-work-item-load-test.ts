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

const workItemModule = await import('../src/client/WorkItemPanel.js');
const authModule = await import('../src/client/auth.js');
const {
  classifyWorkItemRequestError,
  createLatestWorkItemLoadController,
  shouldClearWorkItemComment,
  validateWorkItemComment,
  validateEditableWorkItemTitle,
} = workItemModule;
const loadWorkItemsForPanel = (workItemModule as typeof workItemModule & {
  loadWorkItemsForPanel?: (options: {
    view: 'search' | 'recent' | 'assigned' | 'calendar';
    query: string;
    status: '' | 'backlog' | 'todo' | 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
    selectedId: string | null;
    signal: AbortSignal;
    request?: (path: string, init: RequestInit) => Promise<Response>;
  }) => Promise<{
    items: Array<{ id: string }>;
    selectedId: string | null;
    deepLinkNotice: string;
  }>;
}).loadWorkItemsForPanel;

function workItem(id: string, title: string) {
  return {
    id,
    tenantId: 'tenant-1',
    conversationId: 'personal-tab',
    createdBy: 'user-1',
    title,
    description: '',
    status: 'todo' as const,
    priority: 'medium' as const,
    watcherIds: [],
    labels: ['teams'],
    comments: [],
    deepLink: {
      kind: 'work-item' as const,
      itemId: id,
      path: `/tabs/home/?workItemId=${id}`,
      href: `/tabs/home/?workItemId=${id}`,
    },
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
    watching: false,
    assignedToRequester: false,
  };
}

const controller = createLatestWorkItemLoadController();
const first = controller.begin();
const second = controller.begin();
assert.equal(first.signal.aborted, true, 'a newer work-item load aborts the older request');
assert.equal(first.commit(() => undefined), false, 'a stale work-item response cannot commit state');
assert.equal(second.commit(() => undefined), true, 'the newest work-item response can commit state');

controller.dispose();
assert.equal(second.signal.aborted, true, 'disposing the panel aborts the active request');
assert.equal(second.commit(() => undefined), false, 'a disposed panel cannot commit a late response');

assert.equal(shouldClearWorkItemComment(true), true, 'confirmed comment mutation clears the input');
assert.equal(shouldClearWorkItemComment(false), false, 'failed comment mutation preserves the input for retry');
assert.equal(validateWorkItemComment('  \n\t'), '댓글 내용을 입력하세요.', 'blank comments are rejected with visible validation copy');
assert.equal(validateWorkItemComment('검증 가능한 댓글'), undefined, 'non-empty comments can be submitted');
assert.equal(validateEditableWorkItemTitle('  '), '업무 제목을 입력하세요.', 'empty edit titles are rejected before HTTP mutation');
assert.equal(validateEditableWorkItemTitle('유효한 제목'), undefined, 'non-empty edit titles can be submitted');

assert.equal(typeof loadWorkItemsForPanel, 'function', 'WorkItemPanel exposes its real load operation seam');
{
  const signal = new AbortController().signal;
  const requestedPaths: string[] = [];
  const listItem = workItem('item-1', '목록 업무');
  const linkedItem = workItem('item-2', '딥링크 업무');
  const result = await loadWorkItemsForPanel?.({
    view: 'assigned',
    query: '긴급 업무',
    status: 'todo',
    selectedId: 'item-2',
    signal,
    request: async (path, init) => {
      requestedPaths.push(path);
      assert.equal(init.signal, signal, 'list and detail requests share the panel load lease');
      return path.startsWith('/api/work-items?')
        ? new Response(JSON.stringify({ items: [listItem] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : new Response(JSON.stringify({ item: linkedItem }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
    },
  });
  assert.ok(result);
  assert.deepEqual(result.items.map((item) => item.id), ['item-2', 'item-1']);
  assert.equal(result.selectedId, 'item-2');
  assert.equal(result.deepLinkNotice, '');
  assert.match(requestedPaths[0] ?? '', /view=assigned/);
  assert.match(requestedPaths[0] ?? '', /q=%EA%B8%B4%EA%B8%89\+%EC%97%85%EB%AC%B4/);
  assert.match(requestedPaths[0] ?? '', /status=todo/);
  assert.equal(requestedPaths[1], '/api/work-items/item-2');
}

{
  let caught: unknown;
  try {
    await loadWorkItemsForPanel?.({
      view: 'search',
      query: '',
      status: '',
      selectedId: null,
      signal: new AbortController().signal,
      request: async () => new Response(
        JSON.stringify({ error: 'CANARY upstream bearer and stack detail' }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      ),
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, 'the real load seam rejects a failed server response');
  const problem = classifyWorkItemRequestError(caught, '업무 항목을 불러오지 못했습니다.');
  assert.deepEqual(problem, {
    kind: 'transient',
    message: '업무 항목을 불러오지 못했습니다.',
    canRetry: true,
  });
  assert.doesNotMatch(problem.message, /CANARY|bearer|stack/i);
}

{
  const problem = classifyWorkItemRequestError(
    Object.assign(new Error('bad request'), { status: 400 }),
    '업무 항목을 변경하지 못했습니다.',
  );
  assert.deepEqual(problem, {
    kind: 'generic',
    message: '업무 항목을 변경하지 못했습니다.',
    canRetry: false,
  }, 'client errors must not offer a blind retry');
}

{
  const problem = classifyWorkItemRequestError(
    new TypeError('Failed to fetch'),
    '업무 항목을 불러오지 못했습니다.',
  );
  assert.deepEqual(problem, {
    kind: 'transient',
    message: '업무 항목을 불러오지 못했습니다.',
    canRetry: true,
  }, 'network failures must offer a bounded user retry');
}

{
  const originalFetch = globalThis.fetch;
  authModule.resetAuthStateForTest();
  authModule.markTeamsHostReady();
  let tokenAttempts = 0;
  const requestSignals: AbortSignal[] = [];
  const requestedPaths: string[] = [];
  authModule.setAuthTokenProviderForTest(async () => {
    tokenAttempts += 1;
    return 'one-load-token';
  });
  globalThis.fetch = async (input, init) => {
    const path = String(input);
    requestedPaths.push(path);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer one-load-token');
    assert.ok(init?.signal, 'every load request receives the operation abort signal');
    requestSignals.push(init!.signal!);
    return path.startsWith('/api/work-items?')
      ? new Response(JSON.stringify({ items: [workItem('item-1', '목록 업무')] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      : new Response(JSON.stringify({ item: workItem('item-2', '딥링크 업무') }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
  };

  try {
    const result = await loadWorkItemsForPanel?.({
      view: 'assigned',
      query: '',
      status: '',
      selectedId: 'item-2',
      signal: new AbortController().signal,
    });
    assert.ok(result);
    assert.deepEqual(result.items.map((item) => item.id), ['item-2', 'item-1']);
    assert.equal(requestedPaths.length, 2, 'the selected deep link performs list and detail requests');
    assert.equal(tokenAttempts, 1, 'one logical load acquires one Teams token for list and detail');
    assert.equal(requestSignals[0], requestSignals[1], 'list and detail share one operation signal');
    assert.deepEqual(authModule.getCachedAuthHeaders(), {}, 'the load token is not cached after completion');
  } finally {
    globalThis.fetch = originalFetch;
    authModule.resetAuthStateForTest();
  }
}

console.log('Client work-item load tests passed');
