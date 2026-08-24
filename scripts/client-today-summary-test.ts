import { strict as assert } from 'node:assert';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ApiAuthError } from '../src/client/auth.js';

const todayModule = await import('../src/client/TodaySummary.js') as Record<string, unknown>;
const { summarizeTodayWorkItems } = todayModule as {
  summarizeTodayWorkItems: (
    items: Array<{ id: string; title: string; status: 'todo' | 'in_progress' | 'done' | 'cancelled'; priority: string; dueDate?: string }>,
    metrics?: { assigned: number; dueToday: number; overdue: number },
  ) => { assigned: number; dueToday: number; overdue: number; items: unknown[] };
};

const TodaySummaryState = todayModule.TodaySummaryState as React.ComponentType<{
  summary: {
    assigned: number;
    dueToday: number;
    overdue: number;
    items: Array<{ id: string; title: string; status: 'todo' | 'in_progress' | 'done' | 'cancelled'; priority: string; dueDate?: string }>;
  };
  loading: boolean;
  error: string;
  onOpenWork: () => void;
  onRetry: () => void;
}> | undefined;

const todaySummaryErrorMessage = todayModule.todaySummaryErrorMessage as ((error: unknown) => string) | undefined;

assert.equal(typeof TodaySummaryState, 'function', 'Today exposes one render boundary for state evidence');
assert.equal(typeof todaySummaryErrorMessage, 'function', 'Today exposes sanitized auth and permission error presentation');
assert.equal(
  typeof todayModule.buildTodayWorkItemsRequest,
  'function',
  'Today owns a deterministic request that separates five visible rows from full summary totals',
);
assert.equal(
  (todayModule.todayWorkItemStatusLabel as (status: 'in_progress') => string)('in_progress'),
  '진행 중',
  'Today uses localized status labels',
);

const summary = summarizeTodayWorkItems([
  { id: '1', title: '진행 중', status: 'in_progress', priority: 'high' },
  { id: '2', title: '완료', status: 'done', priority: 'medium' },
  { id: '3', title: '취소', status: 'cancelled', priority: 'low' },
]);

assert.deepEqual(
  { assigned: summary.assigned, dueToday: summary.dueToday, overdue: summary.overdue },
  { assigned: 3, dueToday: 0, overdue: 0 },
);
assert.equal(summarizeTodayWorkItems([]).assigned, 0);
assert.equal(summarizeTodayWorkItems(Array.from({ length: 8 }, (_, index) => ({
  id: String(index), title: String(index), status: 'todo' as const, priority: 'low',
}))).items.length, 5, 'the Today view remains bounded for mobile');

const serverBacked = summarizeTodayWorkItems(Array.from({ length: 5 }, (_, index) => ({
  id: String(index), title: String(index), status: 'todo' as const, priority: 'low',
})), { assigned: 42, dueToday: 3, overdue: 7 });
assert.deepEqual(
  { assigned: serverBacked.assigned, dueToday: serverBacked.dueToday, overdue: serverBacked.overdue },
  { assigned: 42, dueToday: 3, overdue: 7 },
  'the five visible rows never truncate server-owned assigned and due-date totals',
);

if (typeof todayModule.buildTodayWorkItemsRequest === 'function') {
  const buildTodayWorkItemsRequest = todayModule.buildTodayWorkItemsRequest as (today: string) => string;
  assert.equal(
    buildTodayWorkItemsRequest('2026-08-10'),
    '/api/work-items?view=assigned&limit=5&summary=today&today=2026-08-10',
  );
}

if (TodaySummaryState && todaySummaryErrorMessage) {
  const emptySummary = summarizeTodayWorkItems([]);
  const populatedSummary = summarizeTodayWorkItems([
    { id: 'today-1', title: '검증 가능한 업무', status: 'in_progress', priority: 'high' },
  ], { assigned: 3, dueToday: 1, overdue: 0 });
  const renderState = (props: React.ComponentProps<typeof TodaySummaryState>): string => renderToStaticMarkup(
    React.createElement(TodaySummaryState, {
      ...props,
      onOpenWork: () => undefined,
      onRetry: () => undefined,
    }),
  );

  const loadingMarkup = renderState({ summary: emptySummary, loading: true, error: '' });
  assert.match(loadingMarkup, /aria-busy="true"/);
  assert.match(loadingMarkup, /role="status"/);
  assert.match(loadingMarkup, /오늘 업무를 불러오는 중/);
  assert.doesNotMatch(loadingMarkup, /할당된 업무가 없습니다/);

  const emptyMarkup = renderState({ summary: emptySummary, loading: false, error: '' });
  assert.match(emptyMarkup, /할당된 업무가 없습니다/);
  assert.match(emptyMarkup, /내 업무 열기/);
  assert.doesNotMatch(emptyMarkup, /오늘 업무를 불러오는 중/);

  const successMarkup = renderState({ summary: populatedSummary, loading: false, error: '' });
  assert.match(successMarkup, /검증 가능한 업무/);
  assert.match(successMarkup, /내 할당.*3/s);
  assert.match(successMarkup, /오늘 기한.*1/s);
  assert.doesNotMatch(successMarkup, /role="alert"/);

  const errorMarkup = renderState({ summary: emptySummary, loading: false, error: '오늘 업무를 불러오지 못했습니다.' });
  assert.match(errorMarkup, /role="alert"/);
  assert.match(errorMarkup, /오늘 업무를 불러오지 못했습니다/);
  assert.match(errorMarkup, /다시 시도/);

  assert.equal(
    todaySummaryErrorMessage(new ApiAuthError('auth-expired')),
    'Teams 인증이 만료되었습니다. 다시 인증해 계속하세요.',
  );
  assert.equal(
    todaySummaryErrorMessage(new ApiAuthError('forbidden')),
    '현재 계정에는 이 작업을 수행할 권한이 없습니다.',
  );
  assert.equal(
    todaySummaryErrorMessage(new Error('오늘 업무를 불러오지 못했습니다.')),
    '오늘 업무를 불러오지 못했습니다.',
  );
  const unsafeError = todaySummaryErrorMessage(new Error('CANARY Bearer secret at https://upstream.example/stack'));
  assert.equal(
    unsafeError,
    '오늘 업무를 불러오지 못했습니다.',
    'Today error alerts must not expose upstream credentials, URLs, or stack details',
  );
  const unsafeErrorMarkup = renderState({ summary: emptySummary, loading: false, error: unsafeError });
  assert.doesNotMatch(unsafeErrorMarkup, /CANARY|Bearer|https:\/\//i);
}

console.log('Client Today summary tests passed');
