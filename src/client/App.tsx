import { app as teamsApp, geoLocation, location as teamsLocation } from '@microsoft/teams-js';
import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';

import { apiFetch, getLastAuthError, setAuthRequired } from './auth.js';
import {
  createClientLocationService,
  isAbortError,
  type ClientLocationService,
  type LocationSource,
} from './location.js';
import {
  ResponseModeSelector,
  getPublicResponseMode,
  useResponseMode,
} from './ResponseModeSelector.js';
import { WorkItemPanel } from './WorkItemPanel.js';
import { CollaborationPanel } from './CollaborationPanel.js';

declare const __TEAMS_OPTIONAL_RUNTIME__: boolean | undefined;
const optionalRuntimeEnabled = typeof __TEAMS_OPTIONAL_RUNTIME__ === 'undefined'
  ? false
  : __TEAMS_OPTIONAL_RUNTIME__;

export type LatestRequest = {
  generation: number;
  signal: AbortSignal;
  isCurrent: () => boolean;
  commit: (update: () => void) => boolean;
};

type LatestRequestController = {
  begin: () => LatestRequest;
  invalidate: () => void;
};

export type ItemMutationLease = {
  key: string;
  generation: number;
  isCurrent: () => boolean;
  commit: (update: () => void) => boolean;
  release: () => boolean;
};

type ItemMutationController = {
  begin: (key: string) => ItemMutationLease | null;
  invalidate: () => void;
  isBusy: (key: string) => boolean;
};

export function createItemMutationController(): ItemMutationController {
  let generation = 0;
  const activeGenerations = new Map<string, number>();

  return {
    begin(key) {
      if (activeGenerations.has(key)) return null;

      const leaseGeneration = generation + 1;
      generation = leaseGeneration;
      activeGenerations.set(key, leaseGeneration);
      let released = false;

      const isCurrent = (): boolean => !released
        && activeGenerations.get(key) === leaseGeneration;

      return {
        key,
        generation: leaseGeneration,
        isCurrent,
        commit(update) {
          if (!isCurrent()) return false;
          update();
          return true;
        },
        release() {
          if (!isCurrent()) return false;
          released = true;
          activeGenerations.delete(key);
          return true;
        },
      };
    },
    invalidate() {
      generation += 1;
      activeGenerations.clear();
    },
    isBusy(key) {
      return activeGenerations.has(key);
    },
  };
}

export function createLatestRequestController(): LatestRequestController {
  let generation = 0;
  let activeController: AbortController | null = null;

  return {
    begin() {
      activeController?.abort();
      const controller = new AbortController();
      const requestGeneration = generation + 1;
      generation = requestGeneration;
      activeController = controller;

      const isCurrent = (): boolean => activeController === controller
        && generation === requestGeneration
        && !controller.signal.aborted;

      return {
        generation: requestGeneration,
        signal: controller.signal,
        isCurrent,
        commit(update) {
          if (!isCurrent()) return false;
          update();
          return true;
        },
      };
    },
    invalidate() {
      generation += 1;
      activeController?.abort();
      activeController = null;
    },
  };
}

export type LazyCopilotRuntimeErrorBoundaryProps = {
  children: ReactNode;
  onRetry: () => void;
  onReload: () => void;
};

export type LazyCopilotRuntimeErrorBoundaryState = {
  error: Error | null;
};

export function CopilotRuntimeRecovery({
  onRetry,
  onReload,
}: {
  onRetry: () => void;
  onReload: () => void;
}) {
  return (
    <main className="shell" role="alert" aria-live="polite">
      <section className="panel">
        <p className="eyebrow">COPILOTKIT</p>
        <h1>업무 도우미를 불러오지 못했습니다.</h1>
        <p>CopilotKit 화면 파일을 불러오지 못했습니다. 다시 시도하거나 탭을 새로고침하세요.</p>
        <div className="copilot-recovery-actions">
          <button className="primary" onClick={onRetry} type="button">다시 시도</button>
          <button className="secondary" onClick={onReload} type="button">새로고침</button>
        </div>
      </section>
    </main>
  );
}

export class LazyCopilotRuntimeErrorBoundary extends Component<
  LazyCopilotRuntimeErrorBoundaryProps,
  LazyCopilotRuntimeErrorBoundaryState
> {
  state: LazyCopilotRuntimeErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): LazyCopilotRuntimeErrorBoundaryState {
    return {
      error: error instanceof Error ? error : new Error('CopilotKit 화면 파일을 불러오지 못했습니다.'),
    };
  }

  private handleRetry = (): void => {
    this.props.onRetry();
  };

  private handleReload = (): void => {
    this.props.onReload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <CopilotRuntimeRecovery
        onReload={this.handleReload}
        onRetry={this.handleRetry}
      />
    );
  }
}

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
  bot: 'teams-sdk' | 'local-handler';
  storage: string;
  timestamp: string;
  copilotKit: 'enabled' | 'disabled';
  genAI: 'openai-configured' | 'not-configured' | 'deterministic-test';
};

type WeatherResponse = {
  source: 'open-meteo' | 'demo';
  location: {
    name: string;
    latitude: number;
    longitude: number;
    timezone: string;
  };
  current: {
    time: string;
    temperature: number;
    apparentTemperature: number;
    humidity: number;
    precipitation: number;
    weatherCode: number;
    isDay: boolean;
    windSpeed: number;
    condition: string;
    icon: 'sun' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm';
  };
};

export function createLazyCopilotRuntime() {
  return lazy(async () => {
    const module = await import('./CopilotWorkspaceAssistant.js');
    return { default: module.CopilotWorkspaceRuntime };
  });
}

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
  const [weather, setWeather] = useState<WeatherResponse | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState('');
  const [locationSource, setLocationSource] = useState<LocationSource>('demo');
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [teamsHost, setTeamsHost] = useState(false);
  const [teamsClientType, setTeamsClientType] = useState('');
  const [teamsHostName, setTeamsHostName] = useState('');
  const [copilotReady, setCopilotReady] = useState(false);
  const [copilotRuntimeAttempt, setCopilotRuntimeAttempt] = useState(0);
  const [itemMutationBusyKeys, setItemMutationBusyKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const responseMode = useResponseMode();
  const selectedResponseMode = getPublicResponseMode(responseMode.state);
  const locationServiceRef = useRef<ClientLocationService | null>(null);
  const weatherRequestGeneration = useRef(0);
  const weatherAbortController = useRef<AbortController | null>(null);
  const runtimeRefreshControllerRef = useRef<LatestRequestController | null>(null);
  const itemsRequestControllerRef = useRef<LatestRequestController | null>(null);
  const itemMutationControllerRef = useRef<ItemMutationController | null>(null);
  const copilotRuntimeRef = useRef<ReturnType<typeof createLazyCopilotRuntime> | null>(null);
  const mountedRef = useRef(false);
  const titleRef = useRef(title);
  const editingIdRef = useRef(editingId);

  titleRef.current = title;
  editingIdRef.current = editingId;

  if (!runtimeRefreshControllerRef.current) {
    runtimeRefreshControllerRef.current = createLatestRequestController();
  }
  if (!itemsRequestControllerRef.current) {
    itemsRequestControllerRef.current = createLatestRequestController();
  }
  if (!itemMutationControllerRef.current) {
    itemMutationControllerRef.current = createItemMutationController();
  }
  if (optionalRuntimeEnabled && !copilotRuntimeRef.current) {
    copilotRuntimeRef.current = createLazyCopilotRuntime();
  }
  const LazyCopilotWorkspaceRuntime = copilotRuntimeRef.current!;

  async function requestWeather(latitude: number, longitude: number, signal: AbortSignal) {
    const query = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
    });

    const response = await apiFetch(`/api/weather?${query.toString()}`, { signal });
    if (!response.ok) throw new Error('날씨 정보를 불러오지 못했습니다.');
    return (await response.json()) as WeatherResponse;
  }

  if (!locationServiceRef.current) {
    locationServiceRef.current = createClientLocationService({
      teamsApp: {
        isInitialized: () => teamsApp.isInitialized(),
        initialize: () => teamsApp.initialize(),
        getContext: async () => {
          const context = await teamsApp.getContext();
          return {
            clientType: context.app?.host?.clientType ?? '',
            hostName: context.app?.host?.name ?? '',
          };
        },
      },
      legacyLocation: {
        isSupported: () => teamsLocation.isSupported(),
        getLocation: (callback) => {
          teamsLocation.getLocation(
            { allowChooseLocation: false, showMap: false },
            (error, location) => callback(error, location),
          );
        },
      },
      geoLocation: {
        isSupported: () => geoLocation.isSupported(),
        hasPermission: () => geoLocation.hasPermission(),
        requestPermission: () => geoLocation.requestPermission(),
        getCurrentLocation: () => geoLocation.getCurrentLocation(),
      },
      browserGeolocation: () => navigator.geolocation,
    }, {
      onRuntime: (runtime) => {
        if (!mountedRef.current) return;
        setTeamsHost(runtime.available);
        setTeamsClientType(runtime.clientType);
        setTeamsHostName(runtime.hostName);
      },
    });
  }

  async function loadWeather(useCurrentLocation: boolean): Promise<void> {
    weatherAbortController.current?.abort();
    const controller = new AbortController();
    weatherAbortController.current = controller;
    const generation = weatherRequestGeneration.current + 1;
    weatherRequestGeneration.current = generation;
    const isCurrentRequest = () => mountedRef.current
      && !controller.signal.aborted
      && weatherRequestGeneration.current === generation;

    if (!mountedRef.current) return;
    setWeatherLoading(true);
    setWeatherError('');

    if (!useCurrentLocation) {
      if (!isCurrentRequest()) return;
      setWeather(null);
      setLocationSource('demo');
      setLocationAccuracy(null);
      setWeatherError('현재 위치 권한을 허용해야 날씨를 표시할 수 있습니다.');
      setWeatherLoading(false);
      return;
    }

    let latitude: number;
    let longitude: number;
    let resolvedLocationSource: LocationSource;
    let resolvedLocationAccuracy: number | null;

    try {
      const position = await locationServiceRef.current!.getCurrentDeviceLocation(controller.signal);
      if (!isCurrentRequest()) return;
      latitude = position.latitude;
      longitude = position.longitude;
      resolvedLocationSource = position.source;
      resolvedLocationAccuracy = position.accuracy ?? null;
    } catch (caught) {
      if (!isCurrentRequest() || isAbortError(caught)) return;
      setWeather(null);
      setLocationSource('demo');
      setLocationAccuracy(null);
      setWeatherError(caught instanceof Error
        ? caught.message
        : '현재 위치를 확인하지 못했습니다. 위치 권한을 허용한 뒤 다시 시도하세요.');
      setWeatherLoading(false);
      return;
    }

    try {
      const result = await requestWeather(latitude, longitude, controller.signal);
      if (!isCurrentRequest()) return;
      setWeather(result);
      setLocationSource(resolvedLocationSource);
      setLocationAccuracy(resolvedLocationAccuracy);
      setWeatherError('');
    } catch (caught) {
      if (!isCurrentRequest() || isAbortError(caught)) return;
      setWeather(null);
      setLocationSource('demo');
      setLocationAccuracy(null);
      setWeatherError(caught instanceof Error
        ? caught.message
        : '실시간 날씨를 불러오지 못했습니다.');
    } finally {
      if (isCurrentRequest()) {
        setWeatherLoading(false);
        if (weatherAbortController.current === controller) weatherAbortController.current = null;
      }
    }
  }

  async function loadItems(runtimeRequest?: LatestRequest): Promise<void> {
    const request = itemsRequestControllerRef.current!.begin();
    const isCurrentRequest = (): boolean => mountedRef.current
      && request.isCurrent()
      && (!runtimeRequest || runtimeRequest.isCurrent());
    const commit = (update: () => void): boolean => {
      let applied = false;
      request.commit(() => {
        if (!isCurrentRequest()) return;
        applied = true;
        update();
      });
      return applied;
    };

    commit(() => {
      setLoading(true);
      setError('');
    });

    try {
      const response = await apiFetch('/api/items', { signal: request.signal });
      if (!response.ok) throw new Error('업무 목록을 불러오지 못했습니다.');
      const data = (await response.json()) as ItemsResponse;
      commit(() => {
        setItems(data.items);
        setSummary(data.summary);
      });
    } catch (caught) {
      if (!isCurrentRequest() || isAbortError(caught)) return;
      commit(() => {
        const authError = getLastAuthError();
        setError(
          authError
            ? `SSO 토큰 요청 실패: ${authError}`
            : caught instanceof Error
              ? caught.message
              : '알 수 없는 오류가 발생했습니다.',
        );
      });
    } finally {
      commit(() => setLoading(false));
    }
  }

  async function loadHealth(request: LatestRequest): Promise<HealthResponse | null> {
    const isCurrentRequest = (): boolean => mountedRef.current && request.isCurrent();
    const commit = (update: () => void): boolean => {
      let applied = false;
      request.commit(() => {
        if (!isCurrentRequest()) return;
        applied = true;
        update();
      });
      return applied;
    };

    commit(() => setHealthLoading(true));

    try {
      const response = await apiFetch('/api/health', { signal: request.signal });
      if (!response.ok) throw new Error('health check failed');
      const data = (await response.json()) as HealthResponse;
      if (!commit(() => {
        setHealth(data);
        setAuthRequired(data.userAuth === 'entra-sso');
      })) return null;
      return data;
    } catch (caught) {
      if (!isCurrentRequest() || isAbortError(caught)) return null;
      commit(() => {
        setHealth(null);
        setAuthRequired(true);
      });
      return null;
    } finally {
      commit(() => setHealthLoading(false));
    }
  }

  async function refreshRuntime(): Promise<void> {
    const request = runtimeRefreshControllerRef.current!.begin();
    itemsRequestControllerRef.current!.invalidate();

    await loadHealth(request);
    if (!mountedRef.current || !request.isCurrent()) return;

    await loadItems(request);
    request.commit(() => {
      if (mountedRef.current && request.isCurrent()) setCopilotReady(optionalRuntimeEnabled);
    });
  }

  useEffect(() => {
    mountedRef.current = true;
    void refreshRuntime();

    return () => {
      mountedRef.current = false;
      runtimeRefreshControllerRef.current?.invalidate();
      itemsRequestControllerRef.current?.invalidate();
      itemMutationControllerRef.current?.invalidate();
      weatherRequestGeneration.current += 1;
      weatherAbortController.current?.abort();
      weatherAbortController.current = null;
    };
  }, []);

  const visibleItems = items.filter((item) => filter === 'all' || item.status === filter);

  function legacyItemMutationKey(itemId: number): string {
    return `item:${itemId}`;
  }

  function beginItemMutation(key: string): ItemMutationLease | null {
    const lease = itemMutationControllerRef.current!.begin(key);
    if (!lease) return null;

    setItemMutationBusyKeys((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
    return lease;
  }

  function commitItemMutation(lease: ItemMutationLease, update: () => void): boolean {
    if (!mountedRef.current) return false;
    return lease.commit(update);
  }

  function finishItemMutation(lease: ItemMutationLease): void {
    if (!lease.release() || !mountedRef.current) return;
    setItemMutationBusyKeys((current) => {
      if (!current.has(lease.key)) return current;
      const next = new Set(current);
      next.delete(lease.key);
      return next;
    });
  }

  async function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    const lease = beginItemMutation('create');
    if (!lease) return;

    try {
      const response = await apiFetch('/api/items', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: trimmedTitle }),
      });

      if (!response.ok) throw new Error('add failed');

      await response.json();
      if (!commitItemMutation(lease, () => {
        if (titleRef.current === trimmedTitle) setTitle('');
        setError('');
      })) return;
      await loadItems();
    } catch {
      commitItemMutation(lease, () => setError('업무를 추가하지 못했습니다.'));
    } finally {
      finishItemMutation(lease);
    }
  }

  async function toggleItem(item: Item) {
    const lease = beginItemMutation(legacyItemMutationKey(item.id));
    if (!lease) return;

    try {
      const response = await apiFetch(`/api/items/${item.id}`, { method: 'PATCH' });
      if (!response.ok) throw new Error('toggle failed');

      await response.json();
      if (!commitItemMutation(lease, () => setError(''))) return;
      await loadItems();
    } catch {
      commitItemMutation(lease, () => setError('업무 상태를 변경하지 못했습니다.'));
    } finally {
      finishItemMutation(lease);
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

    const lease = beginItemMutation(legacyItemMutationKey(item.id));
    if (!lease) return;

    try {
      const response = await apiFetch(`/api/items/${item.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: trimmedTitle }),
      });
      if (!response.ok) throw new Error('update failed');

      await response.json();
      if (!commitItemMutation(lease, () => {
        if (editingIdRef.current === item.id) {
          setEditingId(null);
          setEditingTitle('');
        }
        setError('');
      })) return;
      await loadItems();
    } catch {
      commitItemMutation(lease, () => setError('업무 제목을 수정하지 못했습니다.'));
    } finally {
      finishItemMutation(lease);
    }
  }

  async function removeItem(item: Item) {
    const mutationKey = legacyItemMutationKey(item.id);
    if (itemMutationBusyKeys.has(mutationKey)) return;
    if (!window.confirm(`“${item.title}” 업무를 삭제할까요?`)) return;

    const lease = beginItemMutation(mutationKey);
    if (!lease) return;

    try {
      const response = await apiFetch(`/api/items/${item.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('remove failed');

      await response.json();
      if (!commitItemMutation(lease, () => setError(''))) return;
      await loadItems();
    } catch {
      commitItemMutation(lease, () => setError('업무를 삭제하지 못했습니다.'));
    } finally {
      finishItemMutation(lease);
    }
  }

  function retryCopilotRuntime(): void {
    if (!optionalRuntimeEnabled) return;
    copilotRuntimeRef.current = createLazyCopilotRuntime();
    setCopilotRuntimeAttempt((attempt) => attempt + 1);
  }

  function reloadCopilotRuntime(): void {
    if (typeof window !== 'undefined') window.location.reload();
  }

  const runtimeBadge = healthLoading
    ? '상태 확인 중'
    : teamsHost
      ? 'Teams 탭 · 네이티브 위치'
      : health?.auth === 'local-bypass'
      ? '로컬 런타임'
      : health
        ? 'Teams 인증'
        : '연결 확인 필요';

  const dashboard = (
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
          <span>Bot 경로</span>
          <strong>{health?.bot === 'teams-sdk' ? 'Teams SDK' : '로컬 핸들러'}</strong>
        </div>
        <div>
          <span>GenAI</span>
          <strong>{health?.genAI === 'openai-configured' ? 'OpenAI 연결됨' : health?.genAI === 'deterministic-test' ? '테스트 모드' : '설정 필요'}</strong>
        </div>
        <div>
          <span>응답 모드</span>
          <strong>
            {responseMode.state.status === 'loading'
              ? '확인 중'
              : `${selectedResponseMode.label} · ${selectedResponseMode.configured ? '사용 가능' : '설정 필요'}`}
          </strong>
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

      <ResponseModeSelector
        onSelectMode={responseMode.selectMode}
        state={responseMode.state}
      />

      <section className="weather-widget" aria-label="현재 위치 날씨 위젯">
        <div className="weather-heading">
          <div>
            <p className="eyebrow">LOCATION WEATHER</p>
            <h2>현재 위치 날씨</h2>
            <p className="weather-location">
              {weather?.location.name ?? '위치를 확인하는 중입니다'}
            </p>
          </div>
          <button
            aria-label="내 위치 사용"
            className="secondary"
            disabled={weatherLoading}
            onClick={() => void loadWeather(true)}
            type="button"
          >
            {weatherLoading ? '위치 확인 중…' : '내 위치 사용'}
          </button>
        </div>

        <p className="weather-location-meta">
          {locationSource === 'browser'
            ? 'HTML5 위치 권한 사용 · Teams 앱 권한에서 위치를 허용해야 합니다.'
            : locationSource === 'teams-native'
            ? `Teams ${teamsClientType === 'android' || teamsClientType === 'ios' || teamsClientType === 'ipados' ? '모바일' : '호스트'} 네이티브 위치 권한 사용`
            : teamsHost
              ? `${teamsHostName || 'Teams'} 호스트 · 앱 권한에서 위치를 허용한 뒤 내 위치 사용을 누르세요.`
              : '위치 권한 필요 · Teams 모바일 탭에서 앱 권한을 허용한 뒤 내 위치 사용을 누르세요.'}
        </p>

        {weatherLoading ? (
          <p className="empty">현재 위치와 날씨를 확인하는 중입니다…</p>
        ) : weather ? (
          <>
            <div className="weather-main">
              <span className={`weather-icon ${weather.current.icon}`} aria-hidden="true">
                {weather.current.icon === 'sun'
                  ? '☀️'
                  : weather.current.icon === 'cloud'
                    ? '⛅'
                    : weather.current.icon === 'fog'
                      ? '🌫️'
                      : weather.current.icon === 'rain'
                        ? '🌧️'
                        : weather.current.icon === 'snow'
                          ? '❄️'
                          : '⛈️'}
              </span>
              <div>
                <strong>{weather.current.temperature.toFixed(1)}°</strong>
                <span>{weather.current.condition}</span>
              </div>
            </div>

            <div className="weather-stats" aria-label="현재 날씨 상세">
              <div><span>체감</span><strong>{weather.current.apparentTemperature.toFixed(1)}°C</strong></div>
              <div><span>습도</span><strong>{Math.round(weather.current.humidity)}%</strong></div>
              <div><span>바람</span><strong>{weather.current.windSpeed.toFixed(1)} km/h</strong></div>
              <div><span>강수</span><strong>{weather.current.precipitation.toFixed(1)} mm</strong></div>
            </div>

            <div className="weather-footer">
              <span>{weather.source === 'demo'
                ? '데모 데이터 · 현재 위치 아님'
                : locationSource === 'browser'
                  ? '실시간 HTML5 위치 데이터'
                  : '실시간 Teams 위치 데이터'}</span>
              <span>좌표 {weather.location.latitude.toFixed(4)}, {weather.location.longitude.toFixed(4)}</span>
              {locationAccuracy !== null && <span>정확도 ±{Math.round(locationAccuracy)}m</span>}
              <span>{weather.location.timezone}</span>
              <span>업데이트 {weather.current.time.replace('T', ' ').slice(0, 16)}</span>
            </div>
          </>
        ) : (
          <p className="empty">날씨 데이터를 표시할 수 없습니다.</p>
        )}

        {weatherError && <p className="weather-note">{weatherError}</p>}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">MVP FLOW</p>
            <h2>업무 목록</h2>
          </div>
          <button
            className="secondary"
            onClick={() => void refreshRuntime()}
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
          <button
            aria-busy={itemMutationBusyKeys.has('create')}
            className="primary"
            disabled={itemMutationBusyKeys.has('create')}
            type="submit"
          >
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
                      disabled={itemMutationBusyKeys.has(legacyItemMutationKey(item.id))}
                      onChange={(event) => setEditingTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void saveEdit(item);
                        if (event.key === 'Escape') setEditingId(null);
                      }}
                      value={editingTitle}
                    />
                    <button
                      aria-busy={itemMutationBusyKeys.has(legacyItemMutationKey(item.id))}
                      className="primary"
                      disabled={itemMutationBusyKeys.has(legacyItemMutationKey(item.id))}
                      onClick={() => void saveEdit(item)}
                      type="button"
                    >
                      저장
                    </button>
                    <button
                      className="secondary"
                      disabled={itemMutationBusyKeys.has(legacyItemMutationKey(item.id))}
                      onClick={() => setEditingId(null)}
                      type="button"
                    >
                      취소
                    </button>
                  </div>
                ) : (
                  <>
                    <span>{item.title}</span>
                    <div className="item-actions">
                      <button
                        className="toggle"
                        disabled={itemMutationBusyKeys.has(legacyItemMutationKey(item.id))}
                        onClick={() => startEditing(item)}
                        type="button"
                      >
                        수정
                      </button>
                      <button
                        className="toggle danger"
                        disabled={itemMutationBusyKeys.has(legacyItemMutationKey(item.id))}
                        onClick={() => void removeItem(item)}
                        type="button"
                      >
                        삭제
                      </button>
                      <button
                        aria-label={`업무 ${item.status === 'done' ? '다시 열기' : '완료 처리'}: ${item.title}`}
                        className="toggle"
                        disabled={itemMutationBusyKeys.has(legacyItemMutationKey(item.id))}
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

      <WorkItemPanel />
      <CollaborationPanel />

      <footer>Teams SDK · TypeScript · React · Express · Adaptive Cards</footer>
    </main>
  );

  if (!optionalRuntimeEnabled || !copilotReady || !LazyCopilotWorkspaceRuntime) return dashboard;

  return (
    <LazyCopilotRuntimeErrorBoundary
      key={copilotRuntimeAttempt}
      onReload={reloadCopilotRuntime}
      onRetry={retryCopilotRuntime}
    >
      <Suspense fallback={dashboard}>
        <LazyCopilotWorkspaceRuntime
          health={health ? { ok: health.ok, bot: health.bot, userAuth: health.userAuth, genAI: health.genAI } : null}
          items={items}
          responseMode={selectedResponseMode}
          summary={summary}
          teamsHostName={teamsHostName}
          weather={weather}
        >
          {dashboard}
        </LazyCopilotWorkspaceRuntime>
      </Suspense>
    </LazyCopilotRuntimeErrorBoundary>
  );
}
