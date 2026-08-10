import { useCallback, useEffect, useRef, useState } from 'react';

import { apiFetch } from './auth.js';
import { preserveBrowserPreview } from './hub-navigation.js';

type TargetType = 'project' | 'goal' | 'topic' | 'work-item';
type Subscription = { target: { type: TargetType; id: string }; delivery: 'personal' | 'channel'; channelId?: string; deepLink: { href: string } };
type ChannelBinding = { target: { type: TargetType; id: string }; channelId: string; active: boolean };
type NotificationPreference = { target: { type: TargetType; id: string }; level: string };
type Digest = { period: string; totalCount: number; entries: Array<{ target: { type: TargetType; id: string }; title: string; body: string; count: number; deepLink: { href: string } }> };
type Notification = { id: string; target: { type: TargetType; id: string }; title: string; body: string; occurredAt: string; deepLink: { href: string } };
export type CollaborationActivityData = { subscriptions: Subscription[]; bindings: ChannelBinding[]; preferences: NotificationPreference[]; digest: Digest; notifications: Notification[] };
export type CollaborationDeepLinkState =
  | { kind: 'none' }
  | { kind: 'invalid'; message: string }
  | { kind: 'valid'; targetType: TargetType; targetId: string };

const EMPTY_DIGEST: Digest = { period: 'weekly', totalCount: 0, entries: [] };
const EMPTY_ACTIVITY_DATA: CollaborationActivityData = { subscriptions: [], bindings: [], preferences: [], digest: EMPTY_DIGEST, notifications: [] };

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

export function parseCollaborationDeepLinkState(search: string | undefined): CollaborationDeepLinkState {
  if (!search) return { kind: 'none' };
  const params = new URLSearchParams(search);
  const rawTargetType = params.get('collaborationType')?.trim() ?? '';
  const targetId = params.get('collaborationId')?.trim() ?? '';
  if (!rawTargetType && !targetId) return { kind: 'none' };
  if (!rawTargetType || !targetId) {
    return { kind: 'invalid', message: '협업 딥링크에 대상 유형과 대상 ID가 모두 필요합니다.' };
  }
  const targetType = targetTypes.find(([value]) => value === rawTargetType)?.[0];
  if (!targetType) return { kind: 'invalid', message: '지원하지 않는 협업 대상 유형입니다.' };
  return { kind: 'valid', targetType, targetId };
}

function hasTarget(data: CollaborationActivityData, targetType: TargetType, targetId: string): boolean {
  const matches = (entry: { target: { type: TargetType; id: string } }) =>
    entry.target.type === targetType && entry.target.id === targetId;
  return data.subscriptions.some(matches)
    || data.notifications.some(matches)
    || data.digest.entries.some(matches);
}

export function collaborationDeepLinkNotice(
  state: CollaborationDeepLinkState,
  data: CollaborationActivityData,
): string {
  if (state.kind === 'invalid') return state.message;
  if (state.kind === 'valid' && !hasTarget(data, state.targetType, state.targetId)) {
    return '요청한 협업 대상을 현재 활동 데이터에서 찾을 수 없습니다.';
  }
  return '';
}

function key(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

type PendingMutation = { fingerprint: string; key: string };

async function collaborationFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('x-conversation-id', CONVERSATION_ID);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return apiFetch(input, { ...init, headers });
}

export async function loadCollaborationActivity(
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  signal: AbortSignal,
): Promise<CollaborationActivityData> {
  const [subResponse, digestResponse, notificationResponse, bindingResponse, preferenceResponse] = await Promise.all([
    fetcher('/api/collaboration/subscriptions', { signal }),
    fetcher('/api/collaboration/digest?period=weekly', { signal }),
    fetcher('/api/collaboration/notifications?limit=10', { signal }),
    fetcher('/api/collaboration/bindings', { signal }),
    fetcher('/api/collaboration/preferences', { signal }),
  ]);
  const [subBody, digestBody, notificationBody, bindingBody, preferenceBody] = await Promise.all([
    subResponse.json() as Promise<{ subscriptions?: Subscription[]; error?: string }>,
    digestResponse.json() as Promise<{ digest?: Digest; error?: string }>,
    notificationResponse.json() as Promise<{ notifications?: Notification[]; error?: string }>,
    bindingResponse.json() as Promise<{ bindings?: ChannelBinding[]; error?: string }>,
    preferenceResponse.json() as Promise<{ preferences?: NotificationPreference[]; error?: string }>,
  ]);
  if (!subResponse.ok) throw new Error(subBody.error || '구독을 불러오지 못했습니다.');
  if (!digestResponse.ok) throw new Error(digestBody.error || 'digest를 불러오지 못했습니다.');
  if (!notificationResponse.ok) throw new Error(notificationBody.error || '알림을 불러오지 못했습니다.');
  if (!bindingResponse.ok) throw new Error(bindingBody.error || '채널 연결을 불러오지 못했습니다.');
  if (!preferenceResponse.ok) throw new Error(preferenceBody.error || '알림 설정을 불러오지 못했습니다.');
  return {
    subscriptions: subBody.subscriptions ?? [],
    bindings: bindingBody.bindings ?? [],
    preferences: preferenceBody.preferences ?? [],
    digest: digestBody.digest ?? EMPTY_DIGEST,
    notifications: notificationBody.notifications ?? [],
  };
}

export function CollaborationActivityState({
  data,
  error,
  loading,
  notice = '',
  onRetry,
}: {
  data: CollaborationActivityData;
  error: string;
  loading: boolean;
  notice?: string;
  onRetry: () => void;
}) {
  if (loading) return <p className="empty" role="status">협업 설정을 불러오는 중입니다…</p>;
  if (error) {
    return <div className="today-summary-error" role="alert"><p>{error}</p><button className="secondary" onClick={onRetry} type="button">다시 시도</button></div>;
  }
  return (
    <>
      {notice && <p className="error" role="alert">{notice}</p>}
      <h3 className="collaboration-subheading">최근 알림</h3>
      {data.notifications.length > 0 ? <div className="collaboration-digest">{data.notifications.slice(0, 5).map((entry) => <a href={preserveBrowserPreview(entry.deepLink.href, typeof window === 'undefined' ? undefined : window.location.search)} key={entry.id}><b>{entry.title}</b><span>{entry.body}</span><small>{entry.occurredAt} · {entry.target.type}:{entry.target.id}</small></a>)}</div> : <p className="empty">최근 알림이 없습니다.</p>}
      <h3 className="collaboration-subheading">주간 digest</h3>
      {data.digest.entries.length > 0 ? <div className="collaboration-digest">{data.digest.entries.slice(0, 5).map((entry) => <a href={preserveBrowserPreview(entry.deepLink.href, typeof window === 'undefined' ? undefined : window.location.search)} key={`${entry.target.type}:${entry.target.id}:${entry.title}`}><b>{entry.title}</b><span>{entry.body}</span><small>{entry.count}건 · {entry.target.type}:{entry.target.id}</small></a>)}</div> : <p className="empty">아직 업데이트 digest가 없습니다.</p>}
    </>
  );
}

export function CollaborationPanel() {
  const [deepLinkState] = useState<CollaborationDeepLinkState>(() => (
    typeof window === 'undefined' ? { kind: 'none' } : parseCollaborationDeepLinkState(window.location.search)
  ));
  const [targetType, setTargetType] = useState<TargetType>(() => (
    deepLinkState.kind === 'valid' ? deepLinkState.targetType : 'project'
  ));
  const [targetId, setTargetId] = useState(() => (
    deepLinkState.kind === 'valid' ? deepLinkState.targetId : deepLinkState.kind === 'invalid' ? '' : 'demo-project'
  ));
  const [channelId, setChannelId] = useState('general');
  const [data, setData] = useState<CollaborationActivityData>(EMPTY_ACTIVITY_DATA);
  const [level, setLevel] = useState('digest');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const loadControllerRef = useRef(createLatestCollaborationLoadController());
  const pendingMutationsRef = useRef(new Map<string, PendingMutation>());
  const target = { type: targetType, id: targetId.trim() };

  const load = useCallback(async (): Promise<void> => {
    const request = loadControllerRef.current.begin();
    setLoading(true);
    setError('');
    try {
      const loaded = await loadCollaborationActivity(collaborationFetch, request.signal);
      request.commit(() => setData(loaded));
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

  async function mutate(path: string, body: Record<string, unknown>, slot: string): Promise<void> {
    if (!target.id) {
      setError('대상 ID를 입력하세요.');
      return;
    }
    setBusy(true);
    setError('');
    const fingerprint = path + '|' + JSON.stringify(body);
    const previous = pendingMutationsRef.current.get(slot);
    const mutationKey = previous?.fingerprint === fingerprint ? previous.key : key(slot);
    pendingMutationsRef.current.set(slot, { fingerprint, key: mutationKey });
    try {
      const response = await collaborationFetch(path, { method: 'POST', body: JSON.stringify({ ...body, mutationKey }) });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || '협업 설정을 변경하지 못했습니다.');
      pendingMutationsRef.current.delete(slot);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '협업 설정을 변경하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  const followed = data.subscriptions.some((entry) => entry.target.type === target.type && entry.target.id === target.id && entry.delivery === 'personal');
  const activeBindings = data.bindings.filter((entry) => entry.active);
  const deepLinkNotice = !loading && !error ? collaborationDeepLinkNotice(deepLinkState, data) : '';

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
        <button className="primary" disabled={busy || followed} onClick={() => void mutate('/api/collaboration/follow', { target, delivery: 'personal' }, 'follow')} type="button">{followed ? '팔로우 중' : '팔로우'}</button>
        <button className="secondary" disabled={busy || !followed} onClick={() => void mutate('/api/collaboration/unfollow', { target, delivery: 'personal' }, 'unfollow')} type="button">팔로우 해제</button>
        <button className="secondary" disabled={busy} onClick={() => void mutate('/api/collaboration/bindings', { target, channelId, metadata: { source: 'teams-tab' } }, 'bind')} type="button">채널에 연결</button>
        <button className="secondary" disabled={busy} onClick={() => void mutate('/api/collaboration/preferences', { target, delivery: 'personal', level, ...(level === 'digest' ? { digestPeriod: 'weekly' } : {}) }, 'preference')} type="button">알림 저장</button>
      </div>

      <label className="collaboration-level">알림 수준<select aria-label="알림 수준" onChange={(event) => setLevel(event.target.value)} value={level}><option value="all">모든 업데이트</option><option value="mentions">멘션만</option><option value="digest">주간 digest</option><option value="none">끄기</option></select></label>
      <div className="collaboration-summary">
        <strong>팔로우 중인 대상 {data.subscriptions.length}개</strong>
        <span>연결된 채널 {activeBindings.length}개</span>
        <span>알림 설정 {data.preferences.length}개</span>
        <span>새 알림 {data.notifications.length}건</span>
        <span>최근 digest {data.digest.totalCount}건</span>
      </div>
      <CollaborationActivityState data={data} error={error} loading={loading} notice={deepLinkNotice} onRetry={() => void load()} />
    </section>
  );
}
