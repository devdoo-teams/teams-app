import { useCallback, useEffect, useRef, useState } from 'react';

import { apiFetch } from './auth.js';

type TodayWorkItemStatus = 'backlog' | 'todo' | 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';

export type TodayWorkItem = {
  id: string;
  title: string;
  status: TodayWorkItemStatus;
  priority: string;
  dueDate?: string;
};

export type TodayWorkSummary = {
  assigned: number;
  dueToday: number;
  overdue: number;
  items: TodayWorkItem[];
};

type TodaySummaryMetrics = Pick<TodayWorkSummary, 'assigned' | 'dueToday' | 'overdue'>;

const todayStatusLabels: Record<TodayWorkItemStatus, string> = {
  backlog: '백로그',
  todo: '할 일',
  open: '열림',
  in_progress: '진행 중',
  blocked: '차단됨',
  done: '완료',
  cancelled: '취소',
};

export function todayWorkItemStatusLabel(status: TodayWorkItemStatus): string {
  return todayStatusLabels[status];
}

export function summarizeTodayWorkItems(items: TodayWorkItem[], metrics?: TodaySummaryMetrics): TodayWorkSummary {
  const visibleItems = items.filter(Boolean);
  return {
    assigned: metrics?.assigned ?? visibleItems.length,
    dueToday: metrics?.dueToday ?? 0,
    overdue: metrics?.overdue ?? 0,
    items: visibleItems.slice(0, 5),
  };
}

export function buildTodayWorkItemsRequest(today: string): string {
  const params = new URLSearchParams({ view: 'assigned', limit: '5', summary: 'today', today });
  return `/api/work-items?${params.toString()}`;
}

function localDateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function fetchTodayWorkItems(signal: AbortSignal): Promise<TodayWorkSummary> {
  const headers = new Headers({ 'x-conversation-id': 'personal-tab' });
  const response = await apiFetch(buildTodayWorkItemsRequest(localDateKey(new Date())), { headers, signal });
  const body = (await response.json()) as { items?: TodayWorkItem[]; summary?: TodaySummaryMetrics; error?: string };
  if (!response.ok) throw new Error(body.error || '오늘 업무를 불러오지 못했습니다.');
  return summarizeTodayWorkItems(body.items ?? [], body.summary);
}

export function TodaySummary({ onOpenWork }: { onOpenWork: () => void }) {
  const [summary, setSummary] = useState<TodayWorkSummary>(() => summarizeTodayWorkItems([]));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const activeControllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async (): Promise<void> => {
    activeControllerRef.current?.abort();
    const controller = new AbortController();
    activeControllerRef.current = controller;
    setLoading(true);
    setError('');
    try {
      setSummary(await fetchTodayWorkItems(controller.signal));
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : '오늘 업무를 불러오지 못했습니다.');
    } finally {
      if (activeControllerRef.current === controller && !controller.signal.aborted) {
        setLoading(false);
        activeControllerRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    void load();
    return () => activeControllerRef.current?.abort();
  }, [load]);

  return (
    <section className="panel today-summary-panel" aria-busy={loading} aria-label="오늘 업무 요약">
      <div className="section-heading">
        <div>
          <p className="eyebrow">TODAY AT A GLANCE</p>
          <h2>오늘 업무</h2>
          <p className="panel-description">내 업무 API에서 실제 진행 상태를 확인합니다.</p>
        </div>
        <button className="secondary" disabled={loading} onClick={() => void load()} type="button">
          {loading ? '불러오는 중…' : '새로고침'}
        </button>
      </div>

      {error && (
        <div className="today-summary-error" role="alert">
          <p>{error}</p>
          <button className="secondary" onClick={() => void load()} type="button">다시 시도</button>
        </div>
      )}

      <div className="today-summary-stats" aria-label="오늘 업무 통계">
        <div><span>내 할당</span><strong>{summary.assigned}</strong></div>
        <div><span>오늘 기한</span><strong>{summary.dueToday}</strong></div>
        <div><span>기한 지남</span><strong>{summary.overdue}</strong></div>
      </div>

      {!loading && !error && summary.items.length === 0 ? (
        <p className="empty">할당된 업무가 없습니다.</p>
      ) : !loading && !error ? (
        <ul className="today-summary-list">
          {summary.items.map((item) => (
            <li key={item.id}>
              <span className={`status ${item.status === 'done' || item.status === 'cancelled' ? 'done' : ''}`} />
              <span>{item.title}</span>
              <small>{todayWorkItemStatusLabel(item.status)}</small>
            </li>
          ))}
        </ul>
      ) : null}

      <button className="primary today-summary-open" onClick={onOpenWork} type="button">내 업무 열기</button>
    </section>
  );
}
