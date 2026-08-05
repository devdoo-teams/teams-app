import { FormEvent, useEffect, useState } from 'react';

import { apiFetch } from './auth.js';

type Item = {
  id: number;
  title: string;
  status: 'open' | 'done';
};

type Filter = 'all' | 'open' | 'done';

type ItemsResponse = {
  items: Item[];
  summary: { total: number; open: number; done: number };
};

type HealthResponse = {
  ok: boolean;
  service: string;
  version: string;
  environment: string;
  auth: 'local-bypass' | 'teams-authenticated';
  userAuth: string;
  storage: string;
  timestamp: string;
};

export function App() {
  const [items, setItems] = useState<Item[]>([]);
  const [title, setTitle] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [summary, setSummary] = useState({ total: 0, open: 0, done: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  async function loadItems() {
    setLoading(true);
    setError('');

    try {
      const response = await apiFetch('/api/items');
      if (!response.ok) throw new Error('업무 목록을 불러오지 못했습니다.');
      const data = (await response.json()) as ItemsResponse;
      setItems(data.items);
      setSummary(data.summary);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadItems();
    void loadHealth();
  }, []);

  async function loadHealth() {
    setHealthLoading(true);

    try {
      const response = await fetch('/api/health');
      if (!response.ok) throw new Error('health check failed');
      setHealth((await response.json()) as HealthResponse);
    } catch {
      setHealth(null);
    } finally {
      setHealthLoading(false);
    }
  }

  const visibleItems = items.filter((item) => filter === 'all' || item.status === filter);

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    try {
      const response = await apiFetch('/api/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: trimmedTitle }),
      });

      if (!response.ok) throw new Error('add failed');

      await response.json();
      setTitle('');
      setError('');
      await loadItems();
    } catch {
      setError('업무를 추가하지 못했습니다.');
    }
  }

  async function toggleItem(item: Item) {
    try {
      const response = await apiFetch(`/api/items/${item.id}`, { method: 'PATCH' });
      if (!response.ok) throw new Error('toggle failed');

      await response.json();
      setError('');
      await loadItems();
    } catch {
      setError('업무 상태를 변경하지 못했습니다.');
    }
  }

  function startEditing(item: Item) {
    setEditingId(item.id);
    setEditingTitle(item.title);
    setError('');
  }

  async function saveEdit(item: Item) {
    const trimmedTitle = editingTitle.trim();
    if (!trimmedTitle) {
      setError('업무 제목을 입력하세요.');
      return;
    }

    try {
      const response = await apiFetch(`/api/items/${item.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: trimmedTitle }),
      });
      if (!response.ok) throw new Error('update failed');

      await response.json();
      setEditingId(null);
      setEditingTitle('');
      setError('');
      await loadItems();
    } catch {
      setError('업무 제목을 수정하지 못했습니다.');
    }
  }

  async function removeItem(item: Item) {
    if (!window.confirm(`“${item.title}” 업무를 삭제할까요?`)) return;

    try {
      const response = await apiFetch(`/api/items/${item.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('remove failed');

      await response.json();
      setError('');
      await loadItems();
    } catch {
      setError('업무를 삭제하지 못했습니다.');
    }
  }

  const runtimeBadge = healthLoading
    ? '상태 확인 중'
    : health?.auth === 'local-bypass'
      ? '로컬 런타임'
      : health
        ? 'Teams 인증'
        : '연결 확인 필요';

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">TEAMS SDK MVP</p>
          <h1>업무 허브</h1>
          <p className="subtitle">Teams 안에서 업무를 확인하고 빠르게 추가합니다.</p>
        </div>
        <span className={health ? 'badge' : 'badge warning'}>{runtimeBadge}</span>
      </header>

      <section className="runtime-panel" aria-label="런타임 상태">
        <div>
          <span>서비스</span>
          <strong>{health?.ok ? '정상' : '확인 필요'}</strong>
        </div>
        <div>
          <span>인증 모드</span>
          <strong>{health?.userAuth === 'entra-sso' ? 'Entra SSO' : '로컬 우회'}</strong>
        </div>
        <div>
          <span>저장소</span>
          <strong>{health?.storage === 'file-json' ? '파일 JSON' : health?.storage || '-'}</strong>
        </div>
        <div>
          <span>마지막 확인</span>
          <strong>{health ? new Date(health.timestamp).toLocaleTimeString('ko-KR') : '-'}</strong>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">MVP FLOW</p>
            <h2>업무 목록</h2>
          </div>
          <button
            className="secondary"
            onClick={() => {
              void loadItems();
              void loadHealth();
            }}
            type="button"
          >
            새로고침
          </button>
        </div>

        <form className="add-form" onSubmit={addItem}>
          <input
            aria-label="업무 제목"
            onChange={(event) => setTitle(event.target.value)}
            placeholder="새 업무 제목을 입력하세요"
            value={title}
          />
          <button className="primary" type="submit">
            추가
          </button>
        </form>

        <div className="summary-grid" aria-label="업무 요약">
          <div className="summary-card">
            <span>전체</span>
            <strong>{summary.total}</strong>
          </div>
          <div className="summary-card open-card">
            <span>진행 중</span>
            <strong>{summary.open}</strong>
          </div>
          <div className="summary-card done-card">
            <span>완료</span>
            <strong>{summary.done}</strong>
          </div>
        </div>

        <div className="filters" aria-label="업무 필터">
          {(
            [
              ['all', '전체'],
              ['open', '진행 중'],
              ['done', '완료'],
            ] as const
          ).map(([value, label]) => (
            <button
              aria-pressed={filter === value}
              className={filter === value ? 'filter active' : 'filter'}
              key={value}
              onClick={() => setFilter(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        {error && <p className="error">{error}</p>}
        {loading ? (
          <p className="empty">불러오는 중입니다…</p>
        ) : visibleItems.length === 0 ? (
          <p className="empty">선택한 상태의 업무가 없습니다.</p>
        ) : (
          <ul className="item-list">
            {visibleItems.map((item) => (
              <li className="item" key={item.id}>
                <span className={`status ${item.status}`} />
                {editingId === item.id ? (
                  <div className="edit-row">
                    <input
                      aria-label="업무 제목 수정"
                      autoFocus
                      onChange={(event) => setEditingTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void saveEdit(item);
                        if (event.key === 'Escape') setEditingId(null);
                      }}
                      value={editingTitle}
                    />
                    <button className="primary" onClick={() => void saveEdit(item)} type="button">
                      저장
                    </button>
                    <button className="secondary" onClick={() => setEditingId(null)} type="button">
                      취소
                    </button>
                  </div>
                ) : (
                  <>
                    <span>{item.title}</span>
                    <div className="item-actions">
                      <button className="toggle" onClick={() => startEditing(item)} type="button">
                        수정
                      </button>
                      <button className="toggle danger" onClick={() => void removeItem(item)} type="button">
                        삭제
                      </button>
                      <button
                        aria-label={`업무 ${item.status === 'done' ? '다시 열기' : '완료 처리'}: ${item.title}`}
                        className="toggle"
                        onClick={() => void toggleItem(item)}
                        type="button"
                      >
                        {item.status === 'done' ? '다시 열기' : '완료 처리'}
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer>Teams SDK · TypeScript · React · Express</footer>
    </main>
  );
}
