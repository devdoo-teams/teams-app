import { strict as assert } from 'node:assert';
import { registerHooks } from 'node:module';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

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

const authModule = await import('../src/client/auth.js');
const workItemModule = await import('../src/client/WorkItemPanel.js');

type AuthFailure = Error & { kind?: string };
type WorkItemProblem = {
  kind: 'auth-expired' | 'forbidden' | 'transient' | 'generic';
  message: string;
  canRetry: boolean;
};
type RetryController = {
  set(operation: () => Promise<void>): void;
  set(operationId: string, operation: () => Promise<void>): void;
  clear(operationId?: string): void;
  clearAll(): void;
  retry(operationId?: string): Promise<boolean>;
  hasPending(operationId?: string): boolean;
};

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
const capturedWarnings: unknown[][] = [];

console.warn = (...values: unknown[]) => {
  capturedWarnings.push(values);
};

function resetAuth(): void {
  authModule.resetAuthStateForTest();
  authModule.markTeamsHostReady();
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  authModule.resetAuthStateForTest();
  capturedWarnings.length = 0;
});

test.after(() => {
  console.warn = originalWarn;
});

test('a Teams token acquisition failure never sends an unauthenticated protected request', async () => {
  resetAuth();
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response('{}', { status: 200 });
  };
  authModule.setAuthTokenProviderForTest(async () => {
    throw new Error('CANARY private token-provider detail');
  });

  let failure: AuthFailure | undefined;
  try {
    await authModule.apiFetch('/api/work-items', {
      headers: { Authorization: 'Bearer stale-account-token' },
    });
  } catch (caught) {
    failure = caught as AuthFailure;
  }

  assert.ok(failure, 'the protected call fails before reaching fetch');
  assert.equal(failure.kind, 'auth-expired');
  assert.equal(requests, 0, 'no unauthenticated fallback request reaches the protected API');
  assert.deepEqual(authModule.getCachedAuthHeaders(), {}, 'the stale account token is discarded');
  assert.doesNotMatch(failure.message, /CANARY|stale-account-token/);
  assert.doesNotMatch(authModule.getLastAuthError(), /CANARY|stale-account-token/);
  assert.deepEqual(capturedWarnings, [['Teams SSO token request failed']]);
});

test('a protected API 401 is classified as expired authentication without retaining auth', async () => {
  resetAuth();
  authModule.setAuthTokenProviderForTest(async () => 'fresh-token');
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: 'CANARY server authentication detail' }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  );

  let failure: AuthFailure | undefined;
  try {
    await authModule.apiFetch('/api/work-items');
  } catch (caught) {
    failure = caught as AuthFailure;
  }

  assert.ok(failure, '401 becomes a typed client auth failure');
  assert.equal(failure.kind, 'auth-expired');
  assert.deepEqual(authModule.getCachedAuthHeaders(), {}, 'the rejected operation retains no Teams token');
  assert.doesNotMatch(failure.message, /CANARY|fresh-token/);
});

test('a protected API 403 is distinguished from expired and generic failures', async () => {
  resetAuth();
  authModule.setAuthTokenProviderForTest(async () => 'valid-but-forbidden-token');
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: 'CANARY forbidden detail' }),
    { status: 403, headers: { 'content-type': 'application/json' } },
  );

  let failure: AuthFailure | undefined;
  try {
    await authModule.apiFetch('/api/work-items');
  } catch (caught) {
    failure = caught as AuthFailure;
  }

  assert.ok(failure, '403 becomes a typed client auth failure');
  assert.equal(failure.kind, 'forbidden');
  assert.doesNotMatch(failure.message, /CANARY|valid-but-forbidden-token/);

  const classify = (workItemModule as unknown as {
    classifyWorkItemRequestError?: (caught: unknown, fallback: string) => WorkItemProblem;
  }).classifyWorkItemRequestError;
  assert.equal(typeof classify, 'function', 'the work-item UI exposes a real error-classification boundary');

  const forbidden = classify?.(failure, '업무 항목을 변경하지 못했습니다.');
  const generic = classify?.(
    new Error('CANARY bearer secret from an upstream server'),
    '업무 항목을 변경하지 못했습니다.',
  );
  assert.deepEqual(forbidden, {
    kind: 'forbidden',
    message: '현재 계정에는 이 업무를 수행할 권한이 없습니다.',
    canRetry: false,
  });
  assert.deepEqual(generic, {
    kind: 'generic',
    message: '업무 항목을 변경하지 못했습니다.',
    canRetry: false,
  });
  assert.doesNotMatch(generic?.message ?? '', /CANARY|bearer|upstream/i);
});

test('one user retry reacquires a token once and resumes the original operation once', async () => {
  resetAuth();
  let tokenAttempts = 0;
  let requests = 0;
  let operationAttempts = 0;
  authModule.setAuthTokenProviderForTest(async () => {
    tokenAttempts += 1;
    if (tokenAttempts === 1) throw new Error('interactive auth needed');
    return 'reacquired-token';
  });
  globalThis.fetch = async (_input, init) => {
    requests += 1;
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer reacquired-token');
    return new Response('{}', { status: 200 });
  };

  const createRetryController = (workItemModule as unknown as {
    createUserDrivenAuthRetryController?: () => RetryController;
  }).createUserDrivenAuthRetryController;
  const captureFailure = (workItemModule as unknown as {
    captureWorkItemRequestFailure?: (
      controller: RetryController,
      operationId: string,
      caught: unknown,
      fallback: string,
      retry: () => Promise<void>,
    ) => WorkItemProblem;
  }).captureWorkItemRequestFailure;
  assert.equal(typeof createRetryController, 'function', 'a bounded user-driven retry controller exists');
  assert.equal(typeof captureFailure, 'function', 'the same recovery boundary used by the panel captures the original operation');
  const controller = createRetryController?.();
  assert.ok(controller);

  const originalOperation = async (): Promise<void> => {
    operationAttempts += 1;
    await authModule.apiFetch('/api/work-items');
  };

  let initialFailure: unknown;
  try {
    await originalOperation();
  } catch (caught) {
    initialFailure = caught;
  }
  assert.equal((initialFailure as AuthFailure | undefined)?.kind, 'auth-expired');
  const problem = captureFailure?.(
    controller,
    'load',
    initialFailure,
    '업무 항목을 불러오지 못했습니다.',
    originalOperation,
  );
  assert.deepEqual(problem, {
    kind: 'auth-expired',
    message: 'Teams 인증이 만료되었습니다. 다시 인증해 계속하세요.',
    canRetry: true,
  });
  assert.equal(operationAttempts, 1, 'capturing recovery does not retry automatically');
  assert.equal(requests, 0);

  assert.equal(controller.hasPending('load'), true, 'the load seam owns its retry lease');
  const retryResults = await Promise.all([controller.retry('load'), controller.retry('load')]);
  assert.deepEqual(retryResults.sort(), [false, true], 'one user gesture can own only one retry lease');
  assert.equal(tokenAttempts, 2, 'the user retry reacquires Teams auth exactly once');
  assert.equal(operationAttempts, 2, 'the original operation resumes exactly once');
  assert.equal(requests, 1);
  assert.equal(controller.hasPending('load'), false, 'a successful retry cannot replay without a new failure');
  assert.equal(await controller.retry('load'), false, 'retry never loops automatically or replays a settled operation');
});

test('independent auth retry leases cannot overwrite each other', async () => {
  const createRetryController = (workItemModule as unknown as {
    createUserDrivenAuthRetryController?: () => RetryController;
  }).createUserDrivenAuthRetryController;
  const controller = createRetryController?.();
  assert.ok(controller);

  const resumed: string[] = [];
  controller.set('load', async () => {
    resumed.push('load');
  });
  controller.set('comment:item-1', async () => {
    resumed.push('comment:item-1');
  });

  assert.equal(controller.hasPending('load'), true);
  assert.equal(controller.hasPending('comment:item-1'), true);
  const results = await Promise.all([
    controller.retry('load'),
    controller.retry('comment:item-1'),
  ]);
  assert.deepEqual(results, [true, true]);
  assert.deepEqual(resumed.sort(), ['comment:item-1', 'load']);
  assert.equal(controller.hasPending('load'), false);
  assert.equal(controller.hasPending('comment:item-1'), false);
});

test('a timed-out auth retry releases its operation lease for the next user retry', async () => {
  resetAuth();
  const setAuthTokenTimeoutForTest = (authModule as typeof authModule & {
    setAuthTokenTimeoutForTest?: (timeoutMs: number | null) => void;
  }).setAuthTokenTimeoutForTest;
  assert.equal(typeof setAuthTokenTimeoutForTest, 'function');
  setAuthTokenTimeoutForTest?.(10);

  let tokenShouldHang = true;
  let operationAttempts = 0;
  let requests = 0;
  authModule.setAuthTokenProviderForTest((signal) => {
    if (!tokenShouldHang) return Promise.resolve('recovered-token');
    return new Promise<string>((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  });
  globalThis.fetch = async (_input, init) => {
    requests += 1;
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer recovered-token');
    return new Response('{}', { status: 200 });
  };

  const createRetryController = (workItemModule as unknown as {
    createUserDrivenAuthRetryController?: () => RetryController;
  }).createUserDrivenAuthRetryController;
  const captureFailure = (workItemModule as unknown as {
    captureWorkItemRequestFailure?: (
      controller: RetryController,
      operationId: string,
      caught: unknown,
      fallback: string,
      retry: () => Promise<void>,
    ) => WorkItemProblem;
  }).captureWorkItemRequestFailure;
  const controller = createRetryController?.();
  assert.ok(controller);

  const operation = async (): Promise<void> => {
    operationAttempts += 1;
    try {
      await authModule.apiFetch('/api/work-items');
    } catch (caught) {
      captureFailure?.(
        controller,
        'load',
        caught,
        '업무 항목을 불러오지 못했습니다.',
        operation,
      );
      throw caught;
    }
  };
  controller.set('load', operation);

  await assert.rejects(
    controller.retry('load'),
    (caught: unknown) => (
      caught instanceof Error
      && (caught as AuthFailure).kind === 'auth-expired'
    ),
  );
  assert.equal(controller.hasPending('load'), true, 'the failed operation is available after timeout release');

  tokenShouldHang = false;
  assert.equal(await controller.retry('load'), true);
  assert.equal(operationAttempts, 2);
  assert.equal(requests, 1);
  assert.equal(controller.hasPending('load'), false);
});

test('the work-item auth notice renders retry only for expired authentication', () => {
  const Notice = (workItemModule as unknown as {
    WorkItemAuthRecoveryNotice?: React.ComponentType<{
      operationId: string;
      problem: WorkItemProblem;
      retrying: boolean;
      onRetry: () => void;
    }>;
  }).WorkItemAuthRecoveryNotice;
  assert.equal(typeof Notice, 'function', 'the work-item panel exposes its real auth recovery notice');

  const expiredMarkup = renderToStaticMarkup(React.createElement(Notice!, {
    operationId: 'load',
    problem: {
      kind: 'auth-expired',
      message: 'Teams 인증이 만료되었습니다. 다시 인증해 계속하세요.',
      canRetry: true,
    },
    retrying: false,
    onRetry: () => undefined,
  }));
  assert.match(expiredMarkup, /role="alert"/);
  assert.match(expiredMarkup, /Teams 인증이 만료되었습니다/);
  assert.match(expiredMarkup, /업무 목록 다시 인증/);

  const transientMarkup = renderToStaticMarkup(React.createElement(Notice!, {
    operationId: 'load',
    problem: {
      kind: 'transient',
      message: '업무 항목을 불러오지 못했습니다.',
      canRetry: true,
    },
    retrying: false,
    onRetry: () => undefined,
  }));
  assert.match(transientMarkup, /업무 항목을 불러오지 못했습니다/);
  assert.match(transientMarkup, /업무 목록 다시 시도/);
  assert.doesNotMatch(transientMarkup, /다시 인증/);

  const forbiddenMarkup = renderToStaticMarkup(React.createElement(Notice!, {
    operationId: 'load',
    problem: {
      kind: 'forbidden',
      message: '현재 계정에는 이 업무를 수행할 권한이 없습니다.',
      canRetry: false,
    },
    retrying: false,
    onRetry: () => undefined,
  }));
  assert.match(forbiddenMarkup, /현재 계정에는 이 업무를 수행할 권한이 없습니다/);
  assert.doesNotMatch(forbiddenMarkup, /<button/);
});

test('the WorkItemPanel recovery surface renders every operation-scoped failure', () => {
  const Notices = (workItemModule as unknown as {
    WorkItemAuthRecoveryNotices?: React.ComponentType<{
      problems: Array<{ operationId: string; problem: WorkItemProblem }>;
      retrying: ReadonlySet<string>;
      onRetry: (operationId: string) => void;
    }>;
  }).WorkItemAuthRecoveryNotices;
  assert.equal(typeof Notices, 'function', 'the panel exposes its operation-scoped recovery surface');

  const markup = renderToStaticMarkup(React.createElement(Notices!, {
    problems: [
      {
        operationId: 'load',
        problem: {
          kind: 'auth-expired',
          message: '목록 인증을 다시 확인하세요.',
          canRetry: true,
        },
      },
      {
        operationId: 'comment:item-1',
        problem: {
          kind: 'auth-expired',
          message: '댓글 인증을 다시 확인하세요.',
          canRetry: true,
        },
      },
    ],
    retrying: new Set<string>(),
    onRetry: () => undefined,
  }));

  assert.match(markup, /data-auth-operation="load"/);
  assert.match(markup, /data-auth-operation="comment:item-1"/);
  assert.match(markup, /목록 인증을 다시 확인하세요/);
  assert.match(markup, /댓글 인증을 다시 확인하세요/);
  assert.equal((markup.match(/<button/g) ?? []).length, 2, 'each failed operation keeps its own retry control');
  assert.match(markup, />업무 목록 다시 인증<\/button>/, 'the load retry has a visible operation-specific name');
  assert.match(markup, />업무 댓글 추가 \(item-1\) 다시 인증<\/button>/, 'the comment retry has a distinct visible name');
  assert.equal((markup.match(/aria-describedby=/g) ?? []).length, 2, 'each retry names its own visible description');
  assert.equal((markup.match(/autofocus=""/g) ?? []).length, 1, 'only the deterministic first recovery receives focus');
  const commentNotice = markup.indexOf('data-auth-operation="comment:item-1"');
  const loadNotice = markup.indexOf('data-auth-operation="load"');
  const focusedControl = markup.indexOf('autofocus=""');
  assert.ok(
    commentNotice >= 0 && focusedControl > commentNotice && focusedControl < loadNotice,
    'code-point ordering deterministically focuses the comment recovery before load',
  );
});

test('work-item auth recovery names status, assignee, and watch retries explicitly', () => {
  const Notice = (workItemModule as unknown as {
    WorkItemAuthRecoveryNotice?: React.ComponentType<{
      operationId: string;
      problem: WorkItemProblem;
      retrying: boolean;
      onRetry: () => void;
    }>;
  }).WorkItemAuthRecoveryNotice;
  assert.equal(typeof Notice, 'function');

  const statusMarkup = renderToStaticMarkup(React.createElement(Notice!, {
    operationId: 'status:item-1',
    problem: {
      kind: 'auth-expired',
      message: '상태 변경 전에 인증을 다시 확인하세요.',
      canRetry: true,
    },
    retrying: false,
    onRetry: () => undefined,
  }));
  assert.match(statusMarkup, />업무 상태 변경 \(item-1\) 다시 인증<\/button>/);

  const assigneeMarkup = renderToStaticMarkup(React.createElement(Notice!, {
    operationId: 'assign:item-1',
    problem: {
      kind: 'auth-expired',
      message: '할당 변경 전에 인증을 다시 확인하세요.',
      canRetry: true,
    },
    retrying: false,
    onRetry: () => undefined,
  }));
  assert.match(assigneeMarkup, />업무 할당 변경 \(item-1\) 다시 인증<\/button>/);

  const watchMarkup = renderToStaticMarkup(React.createElement(Notice!, {
    operationId: 'watch:item-1',
    problem: {
      kind: 'auth-expired',
      message: 'watch 변경 전에 인증을 다시 확인하세요.',
      canRetry: true,
    },
    retrying: false,
    onRetry: () => undefined,
  }));
  assert.match(watchMarkup, />업무 watch 변경 \(item-1\) 다시 인증<\/button>/);
  assert.doesNotMatch(watchMarkup, /업무 작업 \(watch:item-1\)/);
});
