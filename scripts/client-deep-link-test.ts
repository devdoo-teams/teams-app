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

const [{ mergeDeepLinkedWorkItem, parseWorkItemDeepLinkId }, collaborationModule] = await Promise.all([
  import('../src/client/WorkItemPanel.js'),
  import('../src/client/CollaborationPanel.js'),
]);
const { parseCollaborationDeepLink } = collaborationModule;
const collaborationExports = collaborationModule as Record<string, unknown>;
assert.equal(
  typeof collaborationExports.parseCollaborationDeepLinkState,
  'function',
  'partial collaboration links expose an explicit invalid state instead of silently using demo data',
);
assert.equal(
  typeof collaborationExports.collaborationDeepLinkNotice,
  'function',
  'a valid deep-link target missing from Activity data produces a visible notice',
);

assert.equal(parseWorkItemDeepLinkId('?workItemId=work-123'), 'work-123');
assert.equal(parseWorkItemDeepLinkId('?workItemId=%20work-123%20'), 'work-123');
assert.equal(parseWorkItemDeepLinkId('?workItemId='), null);
assert.equal(parseWorkItemDeepLinkId('?other=value'), null);
assert.equal(parseWorkItemDeepLinkId(undefined), null);

const linkedItem = {
  id: 'work-123',
  title: '오래된 링크 업무',
  description: '',
  status: 'open' as const,
  priority: 'medium' as const,
  watcherIds: [],
  watching: false,
  labels: [],
  comments: [],
  deepLink: { href: '/tabs/home/?workItemId=work-123' },
  updatedAt: '2026-08-10T00:00:00.000Z',
};
const merged = mergeDeepLinkedWorkItem([], 'work-123', linkedItem);
assert.deepEqual(merged, [linkedItem], 'a deep-linked item outside the first page is retained for selection');
assert.deepEqual(
  mergeDeepLinkedWorkItem([linkedItem], 'work-123', linkedItem),
  [linkedItem],
  'a deep-linked item already in the list is not duplicated',
);
assert.deepEqual(
  mergeDeepLinkedWorkItem([], 'missing', null),
  [],
  'a missing deep link remains absent instead of inserting an unrelated item',
);

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

if (typeof collaborationExports.parseCollaborationDeepLinkState === 'function') {
  const parseCollaborationDeepLinkState = collaborationExports.parseCollaborationDeepLinkState as (search?: string) => unknown;
  assert.deepEqual(parseCollaborationDeepLinkState('?collaborationType=goal&collaborationId=goal-7'), {
    kind: 'valid',
    targetType: 'goal',
    targetId: 'goal-7',
  });
  assert.deepEqual(parseCollaborationDeepLinkState('?collaborationType=project'), {
    kind: 'invalid',
    message: '협업 딥링크에 대상 유형과 대상 ID가 모두 필요합니다.',
  });
  assert.deepEqual(parseCollaborationDeepLinkState('?collaborationId=project-9'), {
    kind: 'invalid',
    message: '협업 딥링크에 대상 유형과 대상 ID가 모두 필요합니다.',
  });
  assert.deepEqual(parseCollaborationDeepLinkState('?collaborationType=unknown&collaborationId=x'), {
    kind: 'invalid',
    message: '지원하지 않는 협업 대상 유형입니다.',
  });
  assert.deepEqual(parseCollaborationDeepLinkState('?view=activity'), { kind: 'none' });

  if (typeof collaborationExports.collaborationDeepLinkNotice === 'function') {
    const collaborationDeepLinkNotice = collaborationExports.collaborationDeepLinkNotice as (
      state: unknown,
      data: { subscriptions: unknown[]; notifications: unknown[]; digest: { entries: unknown[] } },
    ) => string;
    const valid = parseCollaborationDeepLinkState('?collaborationType=goal&collaborationId=goal-7');
    assert.equal(
      collaborationDeepLinkNotice(valid, { subscriptions: [], notifications: [], digest: { entries: [] } }),
      '요청한 협업 대상을 현재 활동 데이터에서 찾을 수 없습니다.',
    );
    assert.equal(
      collaborationDeepLinkNotice(valid, {
        subscriptions: [{ target: { type: 'goal', id: 'goal-7' } }],
        notifications: [],
        digest: { entries: [] },
      }),
      '',
    );
  }
}

console.log('Client deep-link parsing tests passed');
