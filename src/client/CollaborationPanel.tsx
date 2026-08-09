import { useCallback, useEffect, useRef, useState } from 'react';

import { apiFetch } from './auth.js';

type TargetType = 'project' | 'goal' | 'topic' | 'work-item';
type Subscription = { target: { type: TargetType; id: string }; delivery: 'personal' | 'channel'; channelId?: string; deepLink: { href: string } };
type Digest = { period: string; totalCount: number; entries: Array<{ target: { type: TargetType; id: string }; title: string; body: string; count: number; deepLink: { href: string } }> };

export type LatestCollaborationLoad = {
  signal: AbortSignal;
  commit: (callback: () => void) => boolean;
};

type ActiveCollaborationLoad = {
  controller: AbortController;
  request: LatestCollaborationLoad;
};

export function createLatestCollaborationLoadController(): {
  begin: () => LatestCollaborationLoad;
  dispose: () => void;
} {
  let active: ActiveCollaborationLoad | null = null;

  return {
    begin(): LatestCollaborationLoad {
      active?.controller.abort();
      const controller = new AbortController();
      const request: LatestCollaborationLoad = {
        signal: controller.signal,
        commit(callback): boolean {
          if (active?.request !== request || controller.signal.aborted) return false;
          callback();
          return true;
        },
      };
      active = { controller, request };
      return request;
    },
    dispose(): void {
      active?.controller.abort();
      active = null;
    },
  };
}

const CONVERSATION_ID = 'personal-tab';
const targetTypes: Array<[TargetType, string]> = [
  ['project', '프로젝트'],
  ['goal', '목표'],
  ['topic', '주제'],
  ['work-item', '업무'],
];

export function parseCollaborationDeepLink(
  search: string | undefined,
): { targetType: TargetType; targetId: string } | null {
  if (!search) return null;
  const params = new URLSearchParams(search);
  const rawTargetType = params.get('collaborationType')?.trim();
  const targetId = params.get('collaborationId')?.trim();
  const targetType = targetTypes.find(([value]) => value === rawTargetType)?.[0];
  if (!targetType || !targetId) return null;
  return { targetType, targetId };
}

function key(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function collaborationFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('x-conversation-id', CONVERSATION_ID);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return apiFetch(input, { ...init, headers });
}

export function CollaborationPanel() {
  const [targetType, setTargetType] = useState<TargetType>(() => (
    typeof window === 'undefined'
      ? 'project'
      : parseCollaborationDeepLink(window.location.search)?.targetType ?? 'project'
  ));
  const [targetId, setTargetId] = useState(() => (
    typeof window === 'undefined'
      ? 'demo-project'
      : parseCollaborationDeepLink(window.location.search)?.targetId ?? 'demo-project'
  ));
  const [channelId, setChannelId] = useState('general');
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [digest, setDigest] = useState<Digest | null>(null);
  const [level, setLevel] = useState('digest');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const loadControllerRef = useRef(createLatestCollaborationLoadController());
  const target = { type: targetType, id: targetId.trim() };

  const load = useCallback(async (): Promise<void> => {
    const request = loadControllerRef.current.begin();
    setLoading(true);
    setError('');
    try {
      const [subResponse, digestResponse] = await Promise.all([
        collaborationFetch('/api/collaboration/subscriptions', { signal: request.signal }),
        collaborationFetch('/api/collaboration/digest?period=weekly', { signal: request.signal }),
      ]);
      const subBody = (await subResponse.json()) as { subscriptions?: Subscription[]; error?: string };
      const digestBody = (await digestResponse.json()) as { digest?: Digest; error?: string };
      if (!subResponse.ok) throw new Error(subBody.error || '구독을 불러오지 못했습니다.');
      if (!digestResponse.ok) throw new Error(digestBody.error || 'digest를 불러오지 못했습니다.');
      request.commit(() => {
        setSubscriptions(subBody.subscriptions ?? []);
        setDigest(digestBody.digest ?? null);
      });
    } catch (caught) {
      request.commit(() => {
        setError(caught instanceof Error ? caught.message : '협업 설정을 불러오지 못했습니다.');
      });
    } finally {
      request.commit(() => setLoading(false));
    }
  }, []);

  useEffect(() => {
    void load();
    return () => loadControllerRef.current.dispose();
  }, [load]);

  async function mutate(path: string, body: Record<string, unknown>): Promise<void> {
    if (!target.id) {
      setError('대상 ID를 입력하세요.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await collaborationFetch(path, { method: 'POST', body: JSON.stringify(body) });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || '협업 설정을 변경하지 못했습니다.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '협업 설정을 변경하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  const followed = subscriptions.some((entry) => entry.target.type === target.type && entry.target.id === target.id && entry.delivery === 'personal');

  return (
    <section aria-busy={loading} className="panel collaboration-panel" aria-label="Atlassian Home parity 협업 설정">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ATLASSIAN HOME PARITY</p>
          <h2>팔로우 · 채널 · 알림</h2>
          <p className="panel-description">프로젝트·목표·주제를 Teams 탭에 연결하고 업데이트 digest를 확인합니다.</p>
        </div>
        <button className="secondary" disabled={loading || busy} onClick={() => void load()} type="button">{loading ? '불러오는 중…' : '새로고침'}</button>
      </div>

      <div className="collaboration-form">
        <label>대상 유형<select aria-label="협업 대상 유형" onChange={(event) => setTargetType(event.target.value as TargetType)} value={targetType}>{targetTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>대상 ID<input aria-label="협업 대상 ID" onChange={(event) => setTargetId(event.target.value)} value={targetId} /></label>
        <label>채널 ID<input aria-label="채널 ID" onChange={(event) => setChannelId(event.target.value)} value={channelId} /></label>
      </div>

      <div className="collaboration-actions">
        <button className="primary" disabled={busy || followed} onClick={() => void mutate('/api/collaboration/follow', { mutationKey: key('follow'), target, delivery: 'personal' })} type="button">{followed ? '팔로우 중' : '팔로우'}</button>
        <button className="secondary" disabled={busy || !followed} onClick={() => void mutate('/api/collaboration/unfollow', { mutationKey: key('unfollow'), target, delivery: 'personal' })} type="button">팔로우 해제</button>
        <button className="secondary" disabled={busy} onClick={() => void mutate('/api/collaboration/bindings', { mutationKey: key('bind'), target, channelId, metadata: { source: 'teams-tab' } })} type="button">채널에 연결</button>
        <button className="secondary" disabled={busy} onClick={() => void mutate('/api/collaboration/preferences', { mutationKey: key('preference'), target, delivery: 'personal', level, ...(level === 'digest' ? { digestPeriod: 'weekly' } : {}) })} type="button">알림 저장</button>
      </div>

      <label className="collaboration-level">알림 수준<select aria-label="알림 수준" onChange={(event) => setLevel(event.target.value)} value={level}><option value="all">모든 업데이트</option><option value="mentions">멘션만</option><option value="digest">주간 digest</option><option value="none">끄기</option></select></label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="collaboration-summary">
        <strong>팔로우 중인 대상 {subscriptions.length}개</strong>
        <span>최근 digest {digest?.totalCount ?? 0}건</span>
      </div>
      {loading ? <p className="empty" role="status">협업 설정을 불러오는 중입니다…</p> : digest && digest.entries.length > 0 ? <div className="collaboration-digest">{digest.entries.slice(0, 5).map((entry) => <a href={entry.deepLink.href} key={`${entry.target.type}:${entry.target.id}:${entry.title}`}><b>{entry.title}</b><span>{entry.body}</span><small>{entry.count}건 · {entry.target.type}:{entry.target.id}</small></a>)}</div> : <p className="empty">아직 업데이트 digest가 없습니다.</p>}
    </section>
  );
}
