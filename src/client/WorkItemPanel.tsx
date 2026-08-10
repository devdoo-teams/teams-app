import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { apiFetch } from './auth.js';
import type { WorkItemPresentation } from '../shared/work-item.js';

type WorkItemStatus = 'backlog' | 'todo' | 'open' | 'in_progress' | 'blocked' | 'done' | 'cancelled';
type WorkView = 'search' | 'recent' | 'assigned' | 'calendar';

export type WorkItem = WorkItemPresentation;

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

type PendingMutation = { fingerprint: string; key: string };

function mutationFingerprint(path: string, init: RequestInit): string {
  const body = typeof init.body === 'string' ? init.body : '';
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') {
      const { mutationKey: _mutationKey, ...payload } = parsed;
      return path + '|' + JSON.stringify(payload);
    }
  } catch {
    // A non-JSON body is still safe to fingerprint as its literal value.
  }
  return path + '|' + body;
}

export function applyStableMutationKey(
  path: string,
  init: RequestInit,
  busyKey: string,
  pending: Map<string, PendingMutation>,
): { path: string; init: RequestInit; key: string } {
  const fingerprint = mutationFingerprint(path, init);
  const existing = pending.get(busyKey);
  const key = existing?.fingerprint === fingerprint ? existing.key : nextMutationKey(busyKey);
  pending.set(busyKey, { fingerprint, key });
  const nextInit = { ...init };
  if (typeof init.body === 'string') {
    try {
      const parsed = JSON.parse(init.body) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') {
        nextInit.body = JSON.stringify({ ...parsed, mutationKey: key });
        return { path, init: nextInit, key };
      }
    } catch {
      // Fall through to the query-string form used by DELETE watch.
    }
  }
  const url = new URL(path, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  url.searchParams.set('mutationKey', key);
  const nextPath = url.origin === 'http://localhost' && !/^https?:\/\//.test(path)
    ? url.pathname + url.search
    : url.toString();
  return { path: nextPath, init: nextInit, key };
}

export function parseWorkItemDeepLinkId(search: string | undefined): string | null {
  if (!search) return null;
  const itemId = new URLSearchParams(search).get('workItemId')?.trim();
  return itemId || null;
}

export function mergeDeepLinkedWorkItem(
  items: WorkItem[],
  selectedId: string | null,
  linkedItem: WorkItem | null,
): WorkItem[] {
  if (!selectedId || items.some((item) => item.id === selectedId) || linkedItem?.id !== selectedId) return items;
  return [linkedItem, ...items];
}

export type LatestWorkItemLoad = {
  signal: AbortSignal;
  commit: (callback: () => void) => boolean;
};

export function createLatestWorkItemLoadController(): {
  begin: () => LatestWorkItemLoad;
  dispose: () => void;
} {
  let active: { controller: AbortController; request: LatestWorkItemLoad } | null = null;

  return {
    begin() {
      active?.controller.abort();
      const controller = new AbortController();
      const request: LatestWorkItemLoad = {
        signal: controller.signal,
        commit(callback) {
          if (active?.request !== request || controller.signal.aborted) return false;
          callback();
          return true;
        },
      };
      active = { controller, request };
      return request;
    },
    dispose() {
      active?.controller.abort();
      active = null;
    },
  };
}

/** Keep failed comment input available for a retry; only a confirmed mutation clears it. */
export function shouldClearWorkItemComment(mutationSucceeded: boolean): boolean {
  return mutationSucceeded;
}

export function getWorkItemAssigneeButtonState(assignedToRequester: boolean): {
  label: string;
  disabled: boolean;
} {
  return assignedToRequester
    ? { label: '나에게서 해제', disabled: false }
    : { label: '나에게 할당', disabled: false };
}

export function validateEditableWorkItemTitle(value: string): string | undefined {
  return value.trim() ? undefined : '업무 제목을 입력하세요.';
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
  const [selectedId, setSelectedId] = useState<string | null>(() => (
    typeof window === 'undefined' ? null : parseWorkItemDeepLinkId(window.location.search)
  ));
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [deepLinkNotice, setDeepLinkNotice] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const pendingMutationsRef = useRef(new Map<string, PendingMutation>());
  const selectedIdRef = useRef(selectedId);
  const queryRef = useRef(query);
  const loadControllerRef = useRef(createLatestWorkItemLoadController());
  selectedIdRef.current = selectedId;
  queryRef.current = query;

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  const loadItems = useCallback(async (): Promise<void> => {
    const request = loadControllerRef.current.begin();
    setLoading(true);
    setError('');
    setDeepLinkNotice('');
    const params = new URLSearchParams({ view });
    if (queryRef.current.trim()) params.set('q', queryRef.current.trim());
    if (status) params.set('status', status);
    try {
      const response = await workFetch('/api/work-items?' + params.toString(), { signal: request.signal });
      const body = (await response.json()) as { items?: WorkItem[]; error?: string };
      if (!response.ok) throw new Error(body.error || '업무 항목을 불러오지 못했습니다.');
      const currentSelectedId = selectedIdRef.current;
      const loadedItems = body.items ?? [];
      let linkedItem: WorkItem | null = null;
      let linkedItemMissing = false;
      if (currentSelectedId && !loadedItems.some((item) => item.id === currentSelectedId)) {
        const detailResponse = await workFetch('/api/work-items/' + encodeURIComponent(currentSelectedId), { signal: request.signal });
        if (detailResponse.ok) {
          const detailBody = (await detailResponse.json()) as { item?: WorkItem; error?: string };
          linkedItem = detailBody.item ?? null;
        } else if (detailResponse.status !== 404) {
          const detailBody = (await detailResponse.json()) as { error?: string };
          throw new Error(detailBody.error || '딥링크 업무를 불러오지 못했습니다.');
        } else {
          linkedItemMissing = true;
        }
      }
      request.commit(() => {
        const nextItems = mergeDeepLinkedWorkItem(loadedItems, currentSelectedId, linkedItem);
        setItems(nextItems);
        setDeepLinkNotice(linkedItemMissing
          ? '요청한 업무를 찾을 수 없거나 현재 계정에서 볼 수 없습니다. 목록을 새로고침해 다시 확인하세요.'
          : '');
        if (currentSelectedId && !nextItems.some((item) => item.id === currentSelectedId)) setSelectedId(null);
      });
    } catch (caught) {
      request.commit(() => setError(caught instanceof Error ? caught.message : '업무 항목을 불러오지 못했습니다.'));
    } finally {
      request.commit(() => setLoading(false));
    }
  }, [status, view]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => () => loadControllerRef.current.dispose(), []);

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
    const createInit: RequestInit = {
      method: 'POST',
      body: JSON.stringify({
        title: title.trim(),
        dueDate: dueDate || undefined,
        labels: ['teams'],
        priority: 'medium',
      }),
    };
    const stable = applyStableMutationKey('/api/work-items', createInit, 'create', pendingMutationsRef.current);
    setBusy('create');
    try {
      const response = await workFetch(stable.path, stable.init);
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || '업무 항목을 만들지 못했습니다.');
      pendingMutationsRef.current.delete('create');
      setTitle('');
      setDueDate('');
      await loadItems();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '업무 항목을 만들지 못했습니다.');
    } finally {
      setBusy('');
    }
  }

  async function mutate(path: string, init: RequestInit, busyKey: string): Promise<boolean> {
    const stable = applyStableMutationKey(path, init, busyKey, pendingMutationsRef.current);
    setBusy(busyKey);
    setError('');
    try {
      const response = await workFetch(stable.path, stable.init);
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || '업무 항목을 변경하지 못했습니다.');
      pendingMutationsRef.current.delete(busyKey);
      await loadItems();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '업무 항목을 변경하지 못했습니다.');
      return false;
    } finally {
      setBusy('');
    }
  }

  async function saveSelected(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected) return;
    const titleError = validateEditableWorkItemTitle(editTitle);
    if (titleError) {
      setError(titleError);
      return;
    }
    await mutate('/api/work-items/' + encodeURIComponent(selected.id), {
      method: 'PUT',
      body: JSON.stringify({
        patch: { title: editTitle.trim(), description: editDescription },
      }),
    }, 'edit:' + selected.id);
  }

  async function addComment(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected || !comment.trim()) return;
    const succeeded = await mutate('/api/work-items/' + encodeURIComponent(selected.id) + '/comments', {
      method: 'POST',
      body: JSON.stringify({ body: comment.trim() }),
    }, 'comment:' + selected.id);
    if (shouldClearWorkItemComment(succeeded)) setComment('');
  }

  async function deleteItem(itemId: string): Promise<void> {
    const succeeded = await mutate('/api/work-items/' + encodeURIComponent(itemId), {
      method: 'DELETE',
      body: JSON.stringify({}),
    }, 'delete:' + itemId);
    if (succeeded) {
      setPendingDeleteId(null);
      if (selectedIdRef.current === itemId) setSelectedId(null);
    }
  }

  function requestDelete(itemId: string): void {
    if (pendingDeleteId === itemId) {
      void deleteItem(itemId);
      return;
    }
    setPendingDeleteId(itemId);
  }

  return (
    <section className="panel work-item-panel" aria-label="Atlassian parity 업무 항목">
      <div className="section-heading">
        <div>
          <p className="eyebrow">JIRA · TRELLO · ATLASSIAN HOME PARITY</p>
          <h2>업무 항목</h2>
          <p className="panel-description">검색·할당·상태·댓글·watch·캘린더를 한 탭에서 처리합니다.</p>
        </div>
        <button className="secondary" disabled={Boolean(busy)} onClick={() => void loadItems()} type="button">새로고침</button>
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
        <select aria-label="업무 상태 필터" disabled={Boolean(busy)} onChange={(event) => setStatus(event.target.value as WorkItemStatus | '')} value={status}>
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
      {deepLinkNotice && <p className="error" role="alert">{deepLinkNotice}</p>}
      {loading ? <p className="empty">업무 항목을 불러오는 중입니다…</p> : items.length === 0 ? <p className="empty">표시할 업무 항목이 없습니다. 첫 항목을 추가해 보세요.</p> : (
        <div className="work-item-list">
          {items.map((item) => {
            const selectedItem = item.id === selectedId;
            const itemPath = '/api/work-items/' + encodeURIComponent(item.id);
            const assigneeButton = getWorkItemAssigneeButtonState(item.assignedToRequester);
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
                  <select aria-label={item.title + ' 상태'} disabled={Boolean(busy)} onChange={(event) => void mutate(itemPath + '/status', { method: 'PATCH', body: JSON.stringify({ status: event.target.value }) }, 'status:' + item.id)} value={item.status}>
                    {statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <button
                    className="toggle"
                    disabled={Boolean(busy)}
                    onClick={() => void mutate(
                      itemPath + '/assignee',
                      { method: 'PATCH', body: JSON.stringify({ assigneeId: item.assignedToRequester ? null : 'self' }) },
                      'assign:' + item.id,
                    )}
                    type="button"
                  >{assigneeButton.label}</button>
                  <button className="toggle" disabled={Boolean(busy)} onClick={() => void mutate(itemPath + '/watch', { method: item.watching ? 'DELETE' : 'POST', body: item.watching ? undefined : JSON.stringify({}) }, 'watch:' + item.id)} type="button">{item.watching ? 'watch 해제' : 'watch'}</button>
                  {pendingDeleteId === item.id ? (
                    <span aria-label={item.title + ' 삭제 확인'} className="delete-confirmation">
                      <span>삭제할까요?</span>
                      <button
                        className="toggle danger"
                        disabled={Boolean(busy)}
                        onClick={() => void requestDelete(item.id)}
                        type="button"
                      >삭제 확인</button>
                      <button
                        className="toggle"
                        disabled={Boolean(busy)}
                        onClick={() => setPendingDeleteId(null)}
                        type="button"
                      >취소</button>
                    </span>
                  ) : (
                    <button className="toggle danger" disabled={Boolean(busy)} onClick={() => requestDelete(item.id)} type="button">삭제</button>
                  )}
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
