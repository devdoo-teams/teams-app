export type WeatherIcon = 'sun' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm';

export type WeatherResponse = {
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
    icon: WeatherIcon;
  };
};

export type WeatherFetch = typeof globalThis.fetch;

export type WeatherRequestOptions = {
  demo?: boolean;
  signal?: AbortSignal;
  /** Override the bounded provider timeout for tests or a trusted caller. */
  timeoutMs?: number;
  /** Injected clock used by deterministic tests; defaults to Date.now. */
  now?: () => number;
  /** Cache TTL in milliseconds. Set to 0 to disable caching for a call. */
  cacheTtlMs?: number;
  /** Maximum cached coordinate/parameter entries. Set to 0 to disable caching. */
  cacheMaxEntries?: number;
  /** Injected fetch implementation used by deterministic tests. */
  fetch?: WeatherFetch;
};

type OpenMeteoResponse = {
  timezone?: unknown;
  current?: {
    time?: unknown;
    temperature_2m?: unknown;
    relative_humidity_2m?: unknown;
    apparent_temperature?: unknown;
    precipitation?: unknown;
    weather_code?: unknown;
    is_day?: unknown;
    wind_speed_10m?: unknown;
  };
};

const DEMO_COORDINATES = { latitude: 37.5665, longitude: 126.978 };

export const WEATHER_REQUEST_TIMEOUT_MS = 8_000;
export const WEATHER_CACHE_TTL_MS = 30_000;
export const WEATHER_CACHE_MAX_ENTRIES = 32;
export const WEATHER_TIMEOUT_ERROR = '날씨 제공자 요청 시간이 초과되었습니다.';
export const WEATHER_ABORT_ERROR = '날씨 제공자 요청이 취소되었습니다.';

const MAX_WEATHER_REQUEST_TIMEOUT_MS = 30_000;
const MAX_WEATHER_CACHE_TTL_MS = 5 * 60_000;
const MAX_WEATHER_CACHE_ENTRIES = 128;
const CURRENT_FIELDS = 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,is_day,wind_speed_10m';

type WeatherCacheEntry = {
  value: WeatherResponse;
  expiresAt: number;
};

const weatherCache = new Map<string, WeatherCacheEntry>();

function cloneWeather(weather: WeatherResponse): WeatherResponse {
  return {
    ...weather,
    location: { ...weather.location },
    current: { ...weather.current },
  };
}

function readClock(now: (() => number) | undefined): number {
  const value = (now ?? Date.now)();
  if (!Number.isFinite(value)) throw new Error('날씨 캐시 시계 값이 올바르지 않습니다.');
  return value;
}

function boundedTimeout(value: number | undefined): number {
  const timeout = value ?? WEATHER_REQUEST_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > MAX_WEATHER_REQUEST_TIMEOUT_MS) {
    throw new Error(`날씨 요청 시간 제한은 1~${MAX_WEATHER_REQUEST_TIMEOUT_MS}ms 범위여야 합니다.`);
  }
  return timeout;
}

function boundedCacheTtl(value: number | undefined): number {
  const ttl = value ?? WEATHER_CACHE_TTL_MS;
  if (!Number.isFinite(ttl) || ttl < 0 || ttl > MAX_WEATHER_CACHE_TTL_MS) {
    throw new Error(`날씨 캐시 보관 시간은 0~${MAX_WEATHER_CACHE_TTL_MS}ms 범위여야 합니다.`);
  }
  return ttl;
}

function boundedCacheEntries(value: number | undefined): number {
  const entries = value ?? WEATHER_CACHE_MAX_ENTRIES;
  if (!Number.isInteger(entries) || entries < 0 || entries > MAX_WEATHER_CACHE_ENTRIES) {
    throw new Error(`날씨 캐시 항목 수는 0~${MAX_WEATHER_CACHE_ENTRIES} 범위의 정수여야 합니다.`);
  }
  return entries;
}

function removeExpiredWeatherCacheEntries(now: number): void {
  for (const [key, entry] of weatherCache) {
    if (entry.expiresAt <= now) weatherCache.delete(key);
  }
}

function getCachedWeather(key: string, now: number): WeatherResponse | undefined {
  const entry = weatherCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= now) {
    weatherCache.delete(key);
    return undefined;
  }

  // Keep the small map LRU-like so frequently used locations survive eviction.
  weatherCache.delete(key);
  weatherCache.set(key, entry);
  return cloneWeather(entry.value);
}

function setCachedWeather(key: string, value: WeatherResponse, now: number, ttl: number, maxEntries: number): void {
  if (ttl === 0 || maxEntries === 0) return;
  removeExpiredWeatherCacheEntries(now);
  weatherCache.delete(key);
  weatherCache.set(key, { value: cloneWeather(value), expiresAt: now + ttl });
  while (weatherCache.size > maxEntries) {
    const oldestKey = weatherCache.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    weatherCache.delete(oldestKey);
  }
}

/** Clear live weather cache entries; intended for process lifecycle and deterministic tests. */
export function clearWeatherCache(): void {
  weatherCache.clear();
}

function weatherCacheKey(latitude: number, longitude: number): string {
  // These are exactly the normalized coordinates sent to Open-Meteo. The rest
  // of the key captures every fixed query parameter that affects the payload.
  return [
    latitude.toFixed(4),
    longitude.toFixed(4),
    CURRENT_FIELDS,
    'temperature_unit=celsius',
    'wind_speed_unit=kmh',
    'timezone=auto',
  ].join('|');
}

async function fetchWithTimeout(
  url: URL,
  fetcher: WeatherFetch,
  timeoutMs: number,
  callerSignal?: AbortSignal,
): Promise<Response> {
  if (callerSignal?.aborted) throw new Error(WEATHER_ABORT_ERROR);

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let timedOut = false;

  return new Promise<Response>((resolve, reject) => {
    const cleanup = (): void => {
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    };

    const finishResolve = (response: Response): void => {
      if (settled) return;
      cleanup();
      resolve(response);
    };

    const finishReject = (error: unknown): void => {
      if (settled) return;
      cleanup();
      reject(error);
    };

    const onCallerAbort = (): void => {
      controller.abort();
      finishReject(new Error(WEATHER_ABORT_ERROR));
    };

    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      finishReject(new Error(WEATHER_TIMEOUT_ERROR));
    }, timeoutMs);

    // Promise.resolve().then() also converts a synchronous test-double throw
    // into the same rejection path as a real fetch implementation.
    void Promise.resolve()
      .then(() => fetcher(url, { headers: { accept: 'application/json' }, signal: controller.signal }))
      .then(finishResolve, (error: unknown) => {
        if (timedOut) {
          finishReject(new Error(WEATHER_TIMEOUT_ERROR));
        } else if (callerSignal?.aborted) {
          finishReject(new Error(WEATHER_ABORT_ERROR));
        } else {
          finishReject(error);
        }
      });
  });
}

function numberValue(value: unknown, field: string): number {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error(`날씨 응답의 ${field} 값이 올바르지 않습니다.`);
  return result;
}

export function validateCoordinates(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180;
}

export function weatherDescription(code: number): { condition: string; icon: WeatherIcon } {
  if (code === 0) return { condition: '맑음', icon: 'sun' };
  if (code <= 3) return { condition: '구름 조금', icon: 'cloud' };
  if (code <= 48) return { condition: '안개', icon: 'fog' };
  if (code <= 57) return { condition: '이슬비', icon: 'rain' };
  if (code <= 67 || (code >= 80 && code <= 82)) return { condition: '비', icon: 'rain' };
  if (code <= 77 || (code >= 85 && code <= 86)) return { condition: '눈', icon: 'snow' };
  return { condition: '뇌우', icon: 'storm' };
}

function createDemoWeather(latitude = DEMO_COORDINATES.latitude, longitude = DEMO_COORDINATES.longitude): WeatherResponse {
  const now = new Date().toISOString();
  return {
    source: 'demo',
    location: {
      name: '서울 · 데모 위치',
      latitude,
      longitude,
      timezone: 'Asia/Seoul',
    },
    current: {
      time: now,
      temperature: 22,
      apparentTemperature: 22.8,
      humidity: 58,
      precipitation: 0,
      weatherCode: 0,
      isDay: true,
      windSpeed: 9.4,
      condition: '맑음',
      icon: 'sun',
    },
  };
}

export async function getWeather(
  latitude: number,
  longitude: number,
  options: WeatherRequestOptions = {},
): Promise<WeatherResponse> {
  if (!validateCoordinates(latitude, longitude)) {
    throw new Error('날씨 요청 좌표가 올바르지 않습니다. 위도는 -90~90, 경도는 -180~180 범위여야 합니다.');
  }
  if (options.demo || process.env.WEATHER_MODE === 'demo') {
    return createDemoWeather(latitude, longitude);
  }

  const timeoutMs = boundedTimeout(options.timeoutMs);
  const cacheTtlMs = boundedCacheTtl(options.cacheTtlMs);
  const cacheMaxEntries = boundedCacheEntries(options.cacheMaxEntries);
  const now = readClock(options.now);
  const cacheKey = weatherCacheKey(latitude, longitude);
  if (cacheTtlMs > 0 && cacheMaxEntries > 0) {
    const cached = getCachedWeather(cacheKey, now);
    if (cached) return cached;
  }

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', latitude.toFixed(4));
  url.searchParams.set('longitude', longitude.toFixed(4));
  url.searchParams.set('current', CURRENT_FIELDS);
  url.searchParams.set('temperature_unit', 'celsius');
  url.searchParams.set('wind_speed_unit', 'kmh');
  url.searchParams.set('timezone', 'auto');

  const response = await fetchWithTimeout(url, options.fetch ?? globalThis.fetch.bind(globalThis), timeoutMs, options.signal);
  if (!response.ok) throw new Error(`날씨 제공자 응답 오류 (${response.status})`);

  const payload = (await response.json()) as OpenMeteoResponse;
  const current = payload.current;
  if (!current) throw new Error('날씨 제공자 응답에 현재 날씨가 없습니다.');

  const weatherCode = numberValue(current.weather_code, 'weather_code');
  const description = weatherDescription(weatherCode);
  const weather: WeatherResponse = {
    source: 'open-meteo',
    location: {
      name: '현재 위치',
      latitude,
      longitude,
      timezone: typeof payload.timezone === 'string' ? payload.timezone : 'auto',
    },
    current: {
      time: typeof current.time === 'string' ? current.time : new Date().toISOString(),
      temperature: numberValue(current.temperature_2m, 'temperature_2m'),
      apparentTemperature: numberValue(current.apparent_temperature, 'apparent_temperature'),
      humidity: numberValue(current.relative_humidity_2m, 'relative_humidity_2m'),
      precipitation: numberValue(current.precipitation, 'precipitation'),
      weatherCode,
      isDay: numberValue(current.is_day, 'is_day') === 1,
      windSpeed: numberValue(current.wind_speed_10m, 'wind_speed_10m'),
      condition: description.condition,
      icon: description.icon,
    },
  };
  setCachedWeather(cacheKey, weather, now, cacheTtlMs, cacheMaxEntries);
  return cloneWeather(weather);
}

export function formatWeatherMessage(weather: WeatherResponse, usesDemoLocation = false): string {
  const { current, location } = weather;
  const sourceHint = weather.source === 'demo'
    ? '\n\n탭에서 위치 권한을 허용하면 현재 위치의 실시간 날씨를 확인할 수 있습니다.'
    : '';
  const locationHint = usesDemoLocation ? ' (Bot 데모 위치)' : '';

  return [
    `날씨 위젯 · ${location.name}${locationHint}`,
    `${current.condition} · ${current.temperature.toFixed(1)}°C (체감 ${current.apparentTemperature.toFixed(1)}°C)`,
    `습도 ${Math.round(current.humidity)}% · 바람 ${current.windSpeed.toFixed(1)}km/h · 강수 ${current.precipitation.toFixed(1)}mm`,
    `좌표 ${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)} · ${location.timezone}`,
    `데이터: ${weather.source === 'demo' ? '데모' : 'Open-Meteo'}`,
    sourceHint,
  ].filter(Boolean).join('\n');
}

export { DEMO_COORDINATES };
