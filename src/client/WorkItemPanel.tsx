import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { apiFetch } from './auth.js';

type WorkItemStatus = 'backlog' | 'todo' | 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
type WorkView = 'search' | 'recent' | 'assigned' | 'calendar';

type WorkItem = {
  id: string;
  title: string;
  description: string;
  status: WorkItemStatus;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assigneeId?: string;
  watcherIds: string[];
  watching: boolean;
  labels: string[];
  dueDate?: string;
  comments: Array<{ id: string; authorId: string; body: string; createdAt: string }>;
  deepLink: { href: string };
  updatedAt: string;
};

const WORK_CONVERSATION_ID = 'personal-tab';
const statuses: Array<[WorkItemStatus, string]> = [
  ['backlog', '백로그'],
  ['todo', '할 일'],
  ['open', '열림'],
  ['in_progress', '진행 중'],
  ['blocked', '차단됨'],
  ['done', '완료'],
  ['cancelled', '취소'],
];
const statusLabel = new Map(statuses);

function nextMutationKey(prefix: string): string {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
}

async function workFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('x-conversation-id', WORK_CONVERSATION_ID);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return apiFetch(input, { ...init, headers });
}

export function WorkItemPanel() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [view, setView] = useState<WorkView>('search');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<WorkItemStatus | ''>('');
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  async function loadItems(): Promise<void> {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ view });
    if (query.trim()) params.set('q', query.trim());
    if (status) params.set('status', status);
    try {
      const response = await workFetch('/api/work-items?' + params.toString());
      const body = (await response.json()) as { items?: WorkItem[]; error?: string };
      if (!response.ok) throw new Error(body.error || '업무 항목을 불러오지 못했습니다.');
      setItems(body.items ?? []);
      if (selectedId && !(body.items ?? []).some((item) => item.id === selectedId)) setSelectedId(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '업무 항목을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadItems();
  }, [view, status]);

  useEffect(() => {
    if (!selected) return;
    setEditTitle(selected.title);
    setEditDescription(selected.description);
  }, [selected]);

  async function createItem(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!title.trim()) {
      setError('업무 제목을 입력하세요.');
      return;
    }
    setBusy('create');
    try {
      const response = await workFetch('/api/work-items', {
        method: 'POST',
        body: JSON.stringify({
          mutationKey: nextMutationKey('create'),
          title: title.trim(),
          dueDate: dueDate || undefined,
          labels: ['teams'],
          priority: 'medium',
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || '업무 항목을 만들지 못했습니다.');
      setTitle('');
      setDueDate('');
      await loadItems();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '업무 항목을 만들지 못했습니다.');
    } finally {
      setBusy('');
    }
  }

  async function mutate(path: string, init: RequestInit, busyKey: string): Promise<void> {
    setBusy(busyKey);
    setError('');
    try {
      const response = await workFetch(path, init);
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || '업무 항목을 변경하지 못했습니다.');
      await loadItems();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '업무 항목을 변경하지 못했습니다.');
    } finally {
      setBusy('');
    }
  }

  async function saveSelected(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected) return;
    await mutate('/api/work-items/' + encodeURIComponent(selected.id), {
      method: 'PUT',
      body: JSON.stringify({
        mutationKey: nextMutationKey('edit'),
        patch: { title: editTitle.trim(), description: editDescription },
      }),
    }, 'edit:' + selected.id);
  }

  async function addComment(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || !comment.trim()) return;
    await mutate('/api/work-items/' + encodeURIComponent(selected.id) + '/comments', {
      method: 'POST',
      body: JSON.stringify({ mutationKey: nextMutationKey('comment'), body: comment.trim() }),
    }, 'comment:' + selected.id);
    setComment('');
  }

  return (
    <section className="panel work-item-panel" aria-label="Atlassian parity 업무 항목">
      <div className="section-heading">
        <div>
          <p className="eyebrow">JIRA · TRELLO · ATLASSIAN HOME PARITY</p>
          <h2>업무 항목</h2>
          <p className="panel-description">검색·할당·상태·댓글·watch·캘린더를 한 탭에서 처리합니다.</p>
        </div>
        <button className="secondary" onClick={() => void loadItems()} type="button">새로고침</button>
      </div>

      <div className="work-item-toolbar" aria-label="업무 항목 보기">
        {([
          ['search', '전체'],
          ['assigned', '내 할당'],
          ['recent', '최근'],
          ['calendar', '캘린더'],
        ] as const).map(([value, label]) => (
          <button
            aria-pressed={view === value}
            className={view === value ? 'filter active' : 'filter'}
            key={value}
            onClick={() => setView(value)}
            type="button"
          >{label}</button>
        ))}
        <input
          aria-label="업무 항목 검색"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void loadItems(); }}
          placeholder="제목·내용 검색"
          value={query}
        />
        <select aria-label="업무 상태 필터" onChange={(event) => setStatus(event.target.value as WorkItemStatus | '')} value={status}>
          <option value="">모든 상태</option>
          {statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      <form className="work-item-create" onSubmit={(event) => void createItem(event)}>
        <input aria-label="새 업무 항목 제목" onChange={(event) => setTitle(event.target.value)} placeholder="새 Jira/Trello 업무 제목" value={title} />
        <input aria-label="업무 마감일" onChange={(event) => setDueDate(event.target.value)} type="date" value={dueDate} />
        <button className="primary" disabled={busy === 'create'} type="submit">{busy === 'create' ? '추가 중…' : '추가'}</button>
      </form>

      {error && <p className="error" role="alert">{error}</p>}
      {loading ? <p className="empty">업무 항목을 불러오는 중입니다…</p> : items.length === 0 ? <p className="empty">표시할 업무 항목이 없습니다. 첫 항목을 추가해 보세요.</p> : (
        <div className="work-item-list">
          {items.map((item) => {
            const selectedItem = item.id === selectedId;
            const itemPath = '/api/work-items/' + encodeURIComponent(item.id);
            return (
              <article className={selectedItem ? 'work-item-card selected' : 'work-item-card'} key={item.id}>
                <div className="work-item-card-heading">
                  <button className="work-item-title" onClick={() => setSelectedId(selectedItem ? null : item.id)} type="button">{item.title}</button>
                  <span className={'work-item-priority priority-' + item.priority}>{item.priority}</span>
                </div>
                <div className="work-item-meta">
                  <span>{statusLabel.get(item.status)}</span>
                  {item.dueDate && <span>기한 {item.dueDate}</span>}
                  {item.assigneeId && <span>담당 {item.assigneeId}</span>}
                  {item.labels.map((label) => <span key={label}>#{label}</span>)}
                </div>
                <div className="work-item-actions" aria-label={item.title + ' 작업'}>
                  <select aria-label={item.title + ' 상태'} onChange={(event) => void mutate(itemPath + '/status', { method: 'PATCH', body: JSON.stringify({ mutationKey: nextMutationKey('status'), status: event.target.value }) }, 'status:' + item.id)} value={item.status}>
                    {statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <button className="toggle" disabled={busy === 'assign:' + item.id} onClick={() => void mutate(itemPath + '/assignee', { method: 'PATCH', body: JSON.stringify({ mutationKey: nextMutationKey('assign'), assigneeId: 'self' }) }, 'assign:' + item.id)} type="button">나에게 할당</button>
                  <button className="toggle" disabled={busy === 'watch:' + item.id} onClick={() => void mutate(itemPath + '/watch' + (item.watching ? '?mutationKey=' + encodeURIComponent(nextMutationKey('unwatch')) : ''), { method: item.watching ? 'DELETE' : 'POST', body: item.watching ? undefined : JSON.stringify({ mutationKey: nextMutationKey('watch') }) }, 'watch:' + item.id)} type="button">{item.watching ? 'watch 해제' : 'watch'}</button>
                  <a className="work-item-link" href={item.deepLink.href}>탭에서 열기</a>
                </div>
                {selectedItem && (
                  <div className="work-item-detail">
                    <form onSubmit={(event) => void saveSelected(event)}>
                      <label>제목<input aria-label="선택한 업무 제목" onChange={(event) => setEditTitle(event.target.value)} value={editTitle} /></label>
                      <label>설명<textarea aria-label="선택한 업무 설명" onChange={(event) => setEditDescription(event.target.value)} value={editDescription} /></label>
                      <button className="secondary" disabled={busy === 'edit:' + item.id} type="submit">저장</button>
                    </form>
                    <div className="work-item-comments">
                      <strong>댓글 {item.comments.length}</strong>
                      {item.comments.map((entry) => <p key={entry.id}><b>{entry.authorId}</b> {entry.body}</p>)}
                      <form onSubmit={(event) => void addComment(event)}>
                        <input aria-label="업무 댓글" onChange={(event) => setComment(event.target.value)} placeholder="댓글 추가" value={comment} />
                        <button className="secondary" disabled={busy === 'comment:' + item.id} type="submit">댓글</button>
                      </form>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
