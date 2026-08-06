import assert from 'node:assert/strict';

import {
  clearWeatherCache,
  getWeather,
  WEATHER_ABORT_ERROR,
  WEATHER_TIMEOUT_ERROR,
  type WeatherFetch,
} from '../src/server/weather-service.js';

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    timezone: 'Asia/Seoul',
    current: {
      time: '2026-08-07T12:00',
      temperature_2m: 22,
      relative_humidity_2m: 58,
      apparent_temperature: 22.8,
      precipitation: 0,
      weather_code: 0,
      is_day: 1,
      wind_speed_10m: 9.4,
      ...overrides,
    },
  };
}

function response(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createFakeFetch(
  handler: (url: URL, init: RequestInit, call: number) => Response | Promise<Response>,
): { fetch: WeatherFetch; calls: () => number } {
  let callCount = 0;
  return {
    fetch: (async (input, init) => {
      callCount += 1;
      return handler(new URL(String(input)), init ?? {}, callCount);
    }) as WeatherFetch,
    calls: () => callCount,
  };
}

async function testCacheHitAndCoordinateNormalization(): Promise<void> {
  clearWeatherCache();
  let now = 0;
  const fake = createFakeFetch(() => response(payload()));
  const options = {
    fetch: fake.fetch,
    now: () => now,
    cacheTtlMs: 1_000,
    cacheMaxEntries: 4,
    timeoutMs: 100,
  };

  await getWeather(37.56654, 126.97804, options);
  const second = await getWeather(37.56651, 126.97801, options);
  assert.equal(fake.calls(), 1, 'coordinates normalized to the upstream four-decimal request key');
  assert.equal(second.current.temperature, 22);
}

async function testCacheExpiry(): Promise<void> {
  clearWeatherCache();
  let now = 10_000;
  const fake = createFakeFetch(() => response(payload({ temperature_2m: 23 })));
  const options = { fetch: fake.fetch, now: () => now, cacheTtlMs: 100, cacheMaxEntries: 4, timeoutMs: 100 };

  await getWeather(35.1, 129.1, options);
  now = 10_099;
  await getWeather(35.1, 129.1, options);
  assert.equal(fake.calls(), 1, 'entry is valid before TTL boundary');
  now = 10_100;
  await getWeather(35.1, 129.1, options);
  assert.equal(fake.calls(), 2, 'entry expires at the TTL boundary');
}

async function testCacheEvictionBound(): Promise<void> {
  clearWeatherCache();
  const fake = createFakeFetch(() => response(payload()));
  const options = { fetch: fake.fetch, now: () => 0, cacheTtlMs: 10_000, cacheMaxEntries: 2, timeoutMs: 100 };

  await getWeather(1, 1, options);
  await getWeather(2, 2, options);
  await getWeather(3, 3, options);
  assert.equal(fake.calls(), 3);
  await getWeather(3, 3, options);
  await getWeather(2, 2, options);
  assert.equal(fake.calls(), 3, 'recent entries are retained after an LRU cache hit');
  await getWeather(1, 1, options);
  assert.equal(fake.calls(), 4, 'evicted coordinate is fetched again');
}

async function testErrorsAreNotCached(): Promise<void> {
  clearWeatherCache();
  const fake = createFakeFetch((_url, _init, call) => call === 1
    ? response({ error: 'upstream unavailable' }, 503)
    : response(payload({ temperature_2m: 24 })));
  const options = { fetch: fake.fetch, now: () => 0, cacheTtlMs: 10_000, cacheMaxEntries: 4, timeoutMs: 100 };

  await assert.rejects(
    () => getWeather(37.5, 127, options),
    /날씨 제공자 응답 오류 \(503\)/,
  );
  const recovered = await getWeather(37.5, 127, options);
  assert.equal(recovered.current.temperature, 24);
  assert.equal(fake.calls(), 2, 'failed upstream response was not cached');
}

async function testTimeoutAbortsRequest(): Promise<void> {
  clearWeatherCache();
  let observedSignal: AbortSignal | undefined;
  const fake = createFakeFetch((_url, init) => {
    observedSignal = init.signal as AbortSignal;
    return new Promise<Response>(() => {});
  });

  await assert.rejects(
    () => getWeather(37.5, 127, {
      fetch: fake.fetch,
      timeoutMs: 20,
      cacheTtlMs: 100,
      now: () => 0,
    }),
    new RegExp(WEATHER_TIMEOUT_ERROR),
  );
  assert.equal(observedSignal?.aborted, true, 'timeout aborts the provider request');
}

async function testCallerAbortIsDeterministic(): Promise<void> {
  clearWeatherCache();
  const controller = new AbortController();
  let observedSignal: AbortSignal | undefined;
  const fake = createFakeFetch((_url, init) => {
    observedSignal = init.signal as AbortSignal;
    return new Promise<Response>(() => {});
  });
  const request = getWeather(37.5, 127, {
    fetch: fake.fetch,
    signal: controller.signal,
    timeoutMs: 1_000,
    cacheTtlMs: 100,
    now: () => 0,
  });
  controller.abort();
  await assert.rejects(request, new RegExp(WEATHER_ABORT_ERROR));
  assert.equal(observedSignal?.aborted, true, 'caller abort propagates to the provider request');
}

await testCacheHitAndCoordinateNormalization();
await testCacheExpiry();
await testCacheEvictionBound();
await testErrorsAreNotCached();
await testTimeoutAbortsRequest();
await testCallerAbortIsDeterministic();

console.log('PASS: weather service timeout, abort, TTL cache, eviction bound, and error non-caching verified');
