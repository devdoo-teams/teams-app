import { strict as assert } from 'node:assert';

const todayModule = await import('../src/client/TodaySummary.js') as Record<string, unknown>;
const { summarizeTodayWorkItems } = todayModule as {
  summarizeTodayWorkItems: (
    items: Array<{ id: string; title: string; status: 'todo' | 'in_progress' | 'done' | 'cancelled'; priority: string; dueDate?: string }>,
    metrics?: { assigned: number; dueToday: number; overdue: number },
  ) => { assigned: number; dueToday: number; overdue: number; items: unknown[] };
};
assert.equal(
  typeof todayModule.buildTodayWorkItemsRequest,
  'function',
  'Today owns a deterministic request that separates five visible rows from full summary totals',
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

console.log('Client Today summary tests passed');
