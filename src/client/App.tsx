import { app as teamsApp, geoLocation, location as teamsLocation } from '@microsoft/teams-js';
import { FormEvent, Suspense, lazy, useEffect, useRef, useState } from 'react';

import { apiFetch, getLastAuthError, setAuthRequired } from './auth.js';

const LazyCopilotWorkspaceRuntime = lazy(async () => {
  const module = await import('./CopilotWorkspaceAssistant.js');
  return { default: module.CopilotWorkspaceRuntime };
});

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

type LocationSource = 'browser' | 'teams-native' | 'demo';
type DeviceLocation = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  source: 'browser' | 'teams-native';
};
type TeamsLocationRuntime = {
  available: boolean;
  clientType: string;
  hostName: string;
  legacyLocationSupported: boolean;
  geoLocationSupported: boolean;
};

function createAbortError(): Error {
  const error = new Error('Weather request aborted');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw createAbortError();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function waitForAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(createAbortError());

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(createAbortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
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
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherError, setWeatherError] = useState('');
  const [locationSource, setLocationSource] = useState<LocationSource>('demo');
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [teamsHost, setTeamsHost] = useState(false);
  const [teamsClientType, setTeamsClientType] = useState('');
  const [teamsHostName, setTeamsHostName] = useState('');
  const [copilotReady, setCopilotReady] = useState(false);
  const teamsLocationReady = useRef<Promise<TeamsLocationRuntime> | null>(null);
  const deviceLocationRequest = useRef<Promise<DeviceLocation> | null>(null);
  const weatherRequestGeneration = useRef(0);
  const weatherAbortController = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);

  async function requestWeather(latitude: number, longitude: number, signal: AbortSignal) {
    const query = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
    });

    const response = await apiFetch(`/api/weather?${query.toString()}`, { signal });
    if (!response.ok) throw new Error('날씨 정보를 불러오지 못했습니다.');
    return (await response.json()) as WeatherResponse;
  }

  async function initializeTeamsLocation(): Promise<TeamsLocationRuntime> {
    if (!teamsLocationReady.current) {
      const initializationAttempt = (async (): Promise<TeamsLocationRuntime> => {
        try {
          if (!teamsApp.isInitialized()) {
            await Promise.race([
              teamsApp.initialize(),
              new Promise<never>((_, reject) => {
                window.setTimeout(() => reject(new Error('Teams 호스트 초기화 시간 초과')), 2_000);
              }),
            ]);
          }

          const context = await teamsApp.getContext();
          const clientType = context.app?.host?.clientType ?? '';
          const hostName = context.app?.host?.name ?? '';
          let legacyLocationSupported = false;
          let geoLocationSupported = false;

          try {
            legacyLocationSupported = teamsLocation.isSupported();
          } catch {
            // The SDK can still be initialized on hosts that do not expose this capability.
          }

          try {
            geoLocationSupported = geoLocation.isSupported();
          } catch {
            // geoLocation is preview and may not be exposed by the current host.
          }

          if (mountedRef.current) {
            setTeamsHost(true);
            setTeamsClientType(clientType);
            setTeamsHostName(hostName);
          }

          return {
            available: true,
            clientType,
            hostName,
            legacyLocationSupported,
            geoLocationSupported,
          };
        } catch {
          if (mountedRef.current) {
            setTeamsHost(false);
            setTeamsClientType('');
            setTeamsHostName('');
          }
          return {
            available: false,
            clientType: '',
            hostName: '',
            legacyLocationSupported: false,
            geoLocationSupported: false,
          };
        }
      })();

      const retryableInitialization = initializationAttempt.then((runtime) => {
        // A local preview or a transient host handshake failure must not poison
        // every later tap. Successful Teams capability discovery is cached;
        // unavailable results are retried on the next explicit user action.
        if (!runtime.available && teamsLocationReady.current === retryableInitialization) {
          teamsLocationReady.current = null;
        }
        return runtime;
      });
      teamsLocationReady.current = retryableInitialization;
    }

    return teamsLocationReady.current;
  }

  function getLegacyTeamsLocation(): Promise<DeviceLocation> {
    return new Promise((resolve, reject) => {
      teamsLocation.getLocation(
        { allowChooseLocation: false, showMap: false },
        (locationError, location) => {
          if (locationError) {
            reject(new Error(locationError.message || 'Teams 레거시 위치 API를 사용할 수 없습니다.'));
            return;
          }

          if (!Number.isFinite(location?.latitude) || !Number.isFinite(location?.longitude)) {
            reject(new Error('Teams가 유효한 위치를 반환하지 않았습니다.'));
            return;
          }

          resolve({
            latitude: location.latitude,
            longitude: location.longitude,
            accuracy: location.accuracy,
            source: 'teams-native',
          });
        },
      );
    });
  }

  function getBrowserLocation(): Promise<DeviceLocation> {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('이 환경에서는 HTML5 위치 정보를 지원하지 않습니다.'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (!Number.isFinite(position.coords.latitude) || !Number.isFinite(position.coords.longitude)) {
            reject(new Error('브라우저가 유효한 위치를 반환하지 않았습니다.'));
            return;
          }

          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            source: 'browser',
          });
        },
        (error) => {
          const message = error.code === 1
            ? '위치 권한이 거부되었습니다. Teams 탭의 앱 권한에서 위치를 허용하고, iPhone 설정의 개인정보 보호 및 보안 > 위치 서비스 > Teams도 “앱 사용 중”으로 설정한 뒤 다시 시도하세요.'
            : error.code === 3
              ? '위치 확인 시간이 초과되었습니다. 잠시 후 다시 시도하세요.'
              : '브라우저 위치를 확인하지 못했습니다. Teams 앱 권한과 iPhone 위치 서비스를 확인하세요.';
          reject(new Error(message));
        },
        { enableHighAccuracy: false, maximumAge: 300_000, timeout: 12_000 },
      );
    });
  }

  async function resolveCurrentDeviceLocation(): Promise<DeviceLocation> {
    const locationErrors: string[] = [];

    const runtime = await initializeTeamsLocation();
    const isAppleMobile = runtime.clientType === 'ios' || runtime.clientType === 'ipados';

    async function tryProvider(name: string, provider: () => Promise<DeviceLocation>): Promise<DeviceLocation | null> {
      try {
        return await provider();
      } catch (caught) {
        locationErrors.push(caught instanceof Error ? `${name}: ${caught.message}` : `${name}: 위치를 확인하지 못했습니다.`);
        return null;
      }
    }

    // The legacy Teams location API is deprecated, but it is the native path
    // still exposed by some iOS Teams hosts. Prefer it there, then fall back
    // to browser geolocation for New Teams and unsupported hosts.
    if (isAppleMobile && runtime.legacyLocationSupported) {
      const nativeLocation = await tryProvider('Teams iPhone 위치', getLegacyTeamsLocation);
      if (nativeLocation) return nativeLocation;
    }

    const browserLocation = await tryProvider('HTML5 위치', getBrowserLocation);
    if (browserLocation) return browserLocation;

    // geoLocation is a preview API. Use it only after the standards-based path
    // has failed and only when the host explicitly reports support.
    if (runtime.geoLocationSupported) {
      const geoLocationResult = await tryProvider('Teams geoLocation', async () => {
        const hasPermission = await geoLocation.hasPermission();
        if (!hasPermission && !(await geoLocation.requestPermission())) {
          throw new Error('Teams 위치 권한이 거부되었습니다.');
        }

        const location = await geoLocation.getCurrentLocation();
        if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
          throw new Error('Teams가 유효한 위치를 반환하지 않았습니다.');
        }

        return {
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy: location.accuracy,
          source: 'teams-native',
        };
      });
      if (geoLocationResult) return geoLocationResult;
    }

    if (runtime.legacyLocationSupported) {
      const nativeLocation = await tryProvider('Teams 위치', getLegacyTeamsLocation);
      if (nativeLocation) return nativeLocation;
    }

    throw new Error(
      `${locationErrors.join(' ')} Teams 앱 권한과 iPhone 위치 서비스를 확인한 뒤 다시 시도하세요.`,
    );
  }

  function getCurrentDeviceLocation(signal: AbortSignal): Promise<DeviceLocation> {
    throwIfAborted(signal);

    if (!deviceLocationRequest.current) {
      const request = resolveCurrentDeviceLocation();
      const trackedRequest = request.finally(() => {
        if (deviceLocationRequest.current === trackedRequest) deviceLocationRequest.current = null;
      });
      deviceLocationRequest.current = trackedRequest;
    }

    return waitForAbort(deviceLocationRequest.current, signal);
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
      const position = await getCurrentDeviceLocation(controller.signal);
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
      const authError = getLastAuthError();
      setError(
        authError
          ? `SSO 토큰 요청 실패: ${authError}`
          : caught instanceof Error
            ? caught.message
            : '알 수 없는 오류가 발생했습니다.',
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadHealth(): Promise<HealthResponse | null> {
    setHealthLoading(true);

    try {
      const response = await fetch('/api/health');
      if (!response.ok) throw new Error('health check failed');
      const data = (await response.json()) as HealthResponse;
      setHealth(data);
      setAuthRequired(data.userAuth === 'entra-sso');
      return data;
    } catch {
      setHealth(null);
      setAuthRequired(true);
      return null;
    } finally {
      setHealthLoading(false);
    }
  }

  async function refreshRuntime(): Promise<void> {
    await loadHealth();
    await loadItems();
  }

  useEffect(() => {
    mountedRef.current = true;
    void refreshRuntime().finally(() => {
      if (mountedRef.current) setCopilotReady(true);
    });
    void initializeTeamsLocation();
    void loadWeather(true);

    return () => {
      mountedRef.current = false;
      weatherRequestGeneration.current += 1;
      weatherAbortController.current?.abort();
      weatherAbortController.current = null;
    };
  }, []);

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
          <span>저장소</span>
          <strong>{health?.storage === 'file-json' ? '파일 JSON' : health?.storage || '-'}</strong>
        </div>
        <div>
          <span>마지막 확인</span>
          <strong>{health ? new Date(health.timestamp).toLocaleTimeString('ko-KR') : '-'}</strong>
        </div>
      </section>

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

      <footer>Teams SDK · TypeScript · React · Express · CopilotKit</footer>
    </main>
  );

  if (!copilotReady) return dashboard;

  return (
    <Suspense fallback={dashboard}>
      <LazyCopilotWorkspaceRuntime
        health={health ? { ok: health.ok, bot: health.bot, userAuth: health.userAuth, genAI: health.genAI } : null}
        items={items}
        summary={summary}
        teamsHostName={teamsHostName}
        weather={weather}
      >
        {dashboard}
      </LazyCopilotWorkspaceRuntime>
    </Suspense>
  );
}
