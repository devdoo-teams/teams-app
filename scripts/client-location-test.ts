import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  createClientLocationService,
  type ClientLocationDependencies,
} from '../src/client/location.js';

const teamsJsTestModule = `
export const app = {
  getContext: async () => ({ app: { host: { clientType: 'web', name: 'Teams', sessionId: 'test' } } }),
  initialize: async () => undefined,
  isInitialized: () => true,
};
export const authentication = { getAuthToken: async () => 'test-token' };
export const geoLocation = {
  getCurrentLocation: async () => ({ latitude: 37.5, longitude: 127 }),
  hasPermission: async () => true,
  isSupported: () => false,
  requestPermission: async () => true,
};
export const location = {
  getLocation: () => undefined,
  isSupported: () => false,
};
`;

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@microsoft/teams-js') {
      return {
        format: 'module',
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(teamsJsTestModule)}`,
      };
    }
    return nextResolve(specifier, context);
  },
});

const { App, WeatherErrorNotice, runtimeBadgeLabel, weatherLocationMeta } = await import('../src/client/App.js');

const initialDocument = await readFile('src/client/index.html', 'utf8');
const rootFallback = initialDocument.match(/<div id="root">([\s\S]*?)<\/div>/)?.[1]
  ?.replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

assert.match(rootFallback ?? '', /Teams/, 'initial document gives a visible recovery message while Teams initialization is pending');
assert.match(rootFallback ?? '', /다시/, 'initial document tells the user how to recover from a hung Teams initialization');

const initialMarkup = renderToStaticMarkup(React.createElement(App));
const locationButton = initialMarkup.match(/<button[^>]*aria-label="내 위치 사용"[^>]*>.*?<\/button>/)?.[0];

assert.ok(locationButton, 'initial weather UI renders the explicit location action');
assert.doesNotMatch(locationButton, /disabled/, 'initial location action is enabled before the user requests OS or Teams location');
assert.match(locationButton, />내 위치 사용<\/button>$/, 'initial weather UI waits for the user instead of starting a location request');

const weatherErrorMarkup = renderToStaticMarkup(
  React.createElement(WeatherErrorNotice, { message: '위치 권한을 허용한 뒤 다시 시도하세요.' }),
);
assert.match(weatherErrorMarkup, /role="alert"/, 'weather errors are exposed as an alert');
assert.match(weatherErrorMarkup, /aria-live="assertive"/, 'weather errors are announced to assistive technology');
assert.match(weatherErrorMarkup, /aria-atomic="true"/, 'weather error updates are announced as one message');
assert.match(weatherErrorMarkup, /위치 권한을 허용한 뒤 다시 시도하세요/, 'weather error keeps actionable recovery guidance');
assert.match(weatherLocationMeta({
  source: 'browser',
  teamsHost: true,
  teamsClientType: 'web',
  teamsHostName: 'Teams',
}), /브라우저.*HTML5|Teams 호스트 위치와 분리/, 'browser location is visibly distinguished from Teams host location');
assert.match(weatherLocationMeta({
  source: 'teams-native',
  teamsHost: true,
  teamsClientType: 'android',
  teamsHostName: 'Teams',
}), /Teams 모바일/, 'mobile Teams location is visibly identified as native host location');
assert.equal(
  runtimeBadgeLabel({ healthLoading: false, teamsHost: true, auth: 'teams-authenticated' }),
  'Teams 탭 · 기기 위치 권한',
  'the Teams runtime badge does not claim HTML5 geolocation is Teams native location',
);

async function testTeamsCapabilityDiscoveryIsBounded(): Promise<void> {
  const dependencies = {
    teamsApp: {
      isInitialized: () => true,
      initialize: async () => undefined,
      getContext: () => new Promise<never>(() => {}),
    },
    legacyLocation: {
      isSupported: () => false,
      getLocation: () => undefined,
    },
    geoLocation: {
      isSupported: () => false,
      hasPermission: async () => false,
      requestPermission: async () => false,
      getCurrentLocation: async () => ({ latitude: 37.5, longitude: 127 }),
    },
    browserGeolocation: () => undefined,
  } satisfies ClientLocationDependencies;
  const service = createClientLocationService(dependencies, { initializeTimeoutMs: 10 });

  const result = await Promise.race([
    service.getRuntime(),
    new Promise<'test-watchdog'>((resolve) => setTimeout(() => resolve('test-watchdog'), 50)),
  ]);

  assert.notEqual(result, 'test-watchdog', 'Teams context/capability discovery returns before the UI watchdog');
  assert.equal(typeof result === 'object' ? result.available : true, false, 'timed-out Teams capability discovery remains retryable');
}

async function testTeamsInitializationIsBounded(): Promise<void> {
  const dependencies = {
    teamsApp: {
      isInitialized: () => false,
      initialize: () => new Promise<never>(() => {}),
      getContext: async () => ({ clientType: 'android', hostName: 'Teams' }),
    },
    legacyLocation: {
      isSupported: () => false,
      getLocation: () => undefined,
    },
    geoLocation: {
      isSupported: () => false,
      hasPermission: async () => false,
      requestPermission: async () => false,
      getCurrentLocation: async () => ({ latitude: 37.5, longitude: 127 }),
    },
    browserGeolocation: () => undefined,
  } satisfies ClientLocationDependencies;
  const service = createClientLocationService(dependencies, { initializeTimeoutMs: 10 });

  const runtime = await service.getRuntime();

  assert.equal(runtime.available, false, 'hung Teams initialization returns an unavailable runtime after its deadline');
}

async function testTimedOutTeamsContextRequiresFreshHostBeforeBrowserLocation(): Promise<void> {
  let contextCalls = 0;
  let browserCalls = 0;
  const dependencies = {
    teamsApp: {
      isInitialized: () => true,
      initialize: async () => undefined,
      getContext: () => {
        contextCalls += 1;
        return contextCalls === 1
          ? new Promise<never>(() => {})
          : Promise.resolve({ clientType: 'web', hostName: 'Teams' });
      },
    },
    legacyLocation: {
      isSupported: () => false,
      getLocation: () => undefined,
    },
    geoLocation: {
      isSupported: () => false,
      hasPermission: async () => false,
      requestPermission: async () => false,
      getCurrentLocation: async () => ({ latitude: 37.5, longitude: 127 }),
    },
    browserGeolocation: () => ({
      getCurrentPosition: (success) => {
        browserCalls += 1;
        success({ coords: { latitude: 37.5665, longitude: 126.978, accuracy: 8 } });
      },
    }),
  } satisfies ClientLocationDependencies;
  const service = createClientLocationService(dependencies, { initializeTimeoutMs: 10, operationTimeoutMs: 20 });

  const first = await service.getCurrentDeviceLocation(new AbortController().signal)
    .catch((caught: unknown) => caught);
  const browserCallsAfterFirst = browserCalls;
  const second = await service.getCurrentDeviceLocation(new AbortController().signal);

  assert.match(first instanceof Error ? first.message : '', /Teams 호스트|브라우저.*사용하지 않|PC/, 'a timed-out Teams context does not use browser location');
  assert.equal(browserCallsAfterFirst, 0, 'the timed-out Teams context does not start a browser/desktop location request');
  assert.equal(second.source, 'browser', 'a later request can use browser location after a fresh web Teams context succeeds');
  assert.equal(contextCalls, 2, 'a timed-out Teams context is not reused forever');
  assert.equal(browserCalls, 1, 'the fresh web Teams request performs one explicit browser location request');
}

async function testAndroidMobileUsesFreshBrowserLocation(): Promise<void> {
  let browserCalls = 0;
  let observedOptions: { enableHighAccuracy: boolean; maximumAge: number; timeout: number } | undefined;
  const dependencies = {
    teamsApp: {
      isInitialized: () => true,
      initialize: async () => undefined,
      getContext: async () => ({ clientType: 'android', hostName: 'Teams' }),
    },
    legacyLocation: {
      isSupported: () => false,
      getLocation: () => undefined,
    },
    geoLocation: {
      isSupported: () => true,
      hasPermission: async () => true,
      requestPermission: async () => true,
      getCurrentLocation: async () => ({ latitude: 35.1796, longitude: 129.0756, accuracy: 6 }),
    },
    browserGeolocation: () => ({
      getCurrentPosition: (success, _error, options) => {
        browserCalls += 1;
        observedOptions = options;
        success({ coords: { latitude: 35.1796, longitude: 129.0756, accuracy: 6 } });
      },
    }),
  } satisfies ClientLocationDependencies;
  const service = createClientLocationService(dependencies, { operationTimeoutMs: 10 });

  const result = await service.getCurrentDeviceLocation(new AbortController().signal);

  assert.deepEqual(result, {
    latitude: 35.1796,
    longitude: 129.0756,
    accuracy: 6,
    source: 'browser',
  }, 'Android Teams uses the fresh mobile WebView/device location contract');
  assert.equal(browserCalls, 1, 'Android Teams starts one explicit browser geolocation request');
  assert.deepEqual(observedOptions, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 10,
  }, 'Android Teams disables cached desktop coordinates and requests a fresh high-accuracy fix');
}

async function testDefaultTeamsLocationUsesHtml5OnNewMobileHosts(): Promise<void> {
  let browserCalls = 0;
  let nativeCalls = 0;
  const dependencies = {
    teamsApp: {
      isInitialized: () => true,
      initialize: async () => undefined,
      getContext: async () => ({ clientType: 'ios', hostName: 'Teams' }),
    },
    legacyLocation: {
      isSupported: () => true,
      getLocation: (callback) => {
        nativeCalls += 1;
        callback(null, { latitude: 37.5665, longitude: 126.978, accuracy: 900 });
      },
    },
    geoLocation: {
      isSupported: () => true,
      hasPermission: async () => true,
      requestPermission: async () => true,
      getCurrentLocation: async () => {
        nativeCalls += 1;
        return { latitude: 37.5665, longitude: 126.978, accuracy: 900 };
      },
    },
    browserGeolocation: () => ({
      getCurrentPosition: (success, _error, options) => {
        browserCalls += 1;
        assert.equal(options.maximumAge, 0, 'new mobile Teams asks HTML5 geolocation for a fresh device fix');
        success({ coords: { latitude: 35.1796, longitude: 129.0756, accuracy: 6 } });
      },
    }),
  } satisfies ClientLocationDependencies;
  const service = createClientLocationService(dependencies, { operationTimeoutMs: 10 });

  const result = await service.getCurrentDeviceLocation(new AbortController().signal);

  assert.deepEqual(result, {
    latitude: 35.1796,
    longitude: 129.0756,
    accuracy: 6,
    source: 'browser',
  }, 'new Teams mobile uses the device WebView location rather than a native Teams location API');
  assert.equal(browserCalls, 1, 'new Teams mobile starts one HTML5 location request');
  assert.equal(nativeCalls, 0, 'new Teams mobile does not fall back to deprecated or preview Teams location APIs');
}

async function testUnavailableTeamsContextDoesNotUseBrowserLocation(): Promise<void> {
  let browserCalls = 0;
  const dependencies = {
    teamsApp: {
      isInitialized: () => true,
      initialize: async () => undefined,
      getContext: () => new Promise<never>(() => {}),
    },
    legacyLocation: {
      isSupported: () => false,
      getLocation: () => undefined,
    },
    geoLocation: {
      isSupported: () => false,
      hasPermission: async () => false,
      requestPermission: async () => false,
      getCurrentLocation: async () => ({ latitude: 35.1796, longitude: 129.0756 }),
    },
    browserGeolocation: () => ({
      getCurrentPosition: (success) => {
        browserCalls += 1;
        success({ coords: { latitude: 37.5665, longitude: 126.978, accuracy: 900 } });
      },
    }),
  } satisfies ClientLocationDependencies;
  const service = createClientLocationService(dependencies, { initializeTimeoutMs: 10, operationTimeoutMs: 10 });

  const error = await service.getCurrentDeviceLocation(new AbortController().signal)
    .catch((caught: unknown) => caught);

  assert.equal(browserCalls, 0, 'a missing Teams host context never falls back to browser/desktop location');
  assert.match(error instanceof Error ? error.message : '', /Teams 호스트|브라우저.*사용하지 않|PC/, 'missing Teams context is explicit and actionable');
}

async function testAndroidMobileBrowserPermissionDeniedIsExplicit(): Promise<void> {
  let browserCalls = 0;
  const dependencies = {
    teamsApp: {
      isInitialized: () => true,
      initialize: async () => undefined,
      getContext: async () => ({ clientType: 'android', hostName: 'Teams' }),
    },
    legacyLocation: {
      isSupported: () => false,
      getLocation: () => undefined,
    },
    geoLocation: {
      isSupported: () => true,
      hasPermission: async () => false,
      requestPermission: async () => false,
      getCurrentLocation: async () => ({ latitude: 35.1796, longitude: 129.0756 }),
    },
    browserGeolocation: () => ({
      getCurrentPosition: (_success, error) => {
        browserCalls += 1;
        error({ code: 1, message: 'permission denied' });
      },
    }),
  } satisfies ClientLocationDependencies;
  const service = createClientLocationService(dependencies, { operationTimeoutMs: 10, allowTeamsNativeFallback: false });

  const error = await service.getCurrentDeviceLocation(new AbortController().signal)
    .catch((caught: unknown) => caught);

  assert.equal(browserCalls, 1, 'mobile permission denial comes from the explicit device WebView request');
  assert.match(error instanceof Error ? error.message : '', /Android|권한이 거부/, 'mobile permission denial is explicit');
  assert.match(error instanceof Error ? error.message : '', /앱 권한.*새로고침/, 'browser permission recovery names Teams App permissions and tab reload');
}

async function testAndroidMobileBrowserTimeoutIsExplicit(): Promise<void> {
  let browserCalls = 0;
  const dependencies = {
    teamsApp: {
      isInitialized: () => true,
      initialize: async () => undefined,
      getContext: async () => ({ clientType: 'android', hostName: 'Teams' }),
    },
    legacyLocation: {
      isSupported: () => false,
      getLocation: () => undefined,
    },
    geoLocation: {
      isSupported: () => true,
      hasPermission: async () => true,
      requestPermission: async () => true,
      getCurrentLocation: () => new Promise<never>(() => {}),
    },
    browserGeolocation: () => ({
      getCurrentPosition: (_success, error) => {
        browserCalls += 1;
        error({ code: 3, message: 'position timeout' });
      },
    }),
  } satisfies ClientLocationDependencies;
  const service = createClientLocationService(dependencies, { operationTimeoutMs: 10, allowTeamsNativeFallback: false });

  const error = await service.getCurrentDeviceLocation(new AbortController().signal)
    .catch((caught: unknown) => caught);

  assert.equal(browserCalls, 1, 'mobile timeout is reported from the explicit device WebView request');
  assert.match(error instanceof Error ? error.message : '', /시간(?:이)? 초과/, 'mobile timeout is explicitly rendered as a timeout');
  assert.match(error instanceof Error ? error.message : '', /Teams|새로고침|다시 열/, 'mobile timeout contains Teams recovery guidance');
}

async function testBrowserLocationTimeoutStartsFreshRequestAndIgnoresLateCallback(): Promise<void> {
  let browserCalls = 0;
  let firstSuccess!: (position: { coords: { latitude: number; longitude: number; accuracy?: number } }) => void;
  let freshSuccess!: (position: { coords: { latitude: number; longitude: number; accuracy?: number } }) => void;
  let resolveFreshStarted!: () => void;
  const freshStarted = new Promise<void>((resolve) => {
    resolveFreshStarted = resolve;
  });
  const dependencies = {
    teamsApp: {
      isInitialized: () => true,
      initialize: async () => undefined,
      getContext: async () => ({ clientType: 'web', hostName: 'Teams' }),
    },
    legacyLocation: {
      isSupported: () => false,
      getLocation: () => undefined,
    },
    geoLocation: {
      isSupported: () => false,
      hasPermission: async () => false,
      requestPermission: async () => false,
      getCurrentLocation: async () => ({ latitude: 37.5, longitude: 127 }),
    },
    browserGeolocation: () => ({
      getCurrentPosition: (success) => {
        browserCalls += 1;
        if (browserCalls === 1) {
          firstSuccess = success;
          return;
        }
        freshSuccess = success;
        resolveFreshStarted();
      },
    }),
  } satisfies ClientLocationDependencies;
  const service = createClientLocationService(dependencies, { operationTimeoutMs: 10 });

  const first = await service.getCurrentDeviceLocation(new AbortController().signal)
    .catch((caught: unknown) => caught);
  const second = service.getCurrentDeviceLocation(new AbortController().signal);
  const secondOutcome = second.then(() => 'settled' as const, () => 'rejected' as const);

  assert.match(first instanceof Error ? first.message : '', /시간(?:이)? 초과/, 'browser operation timeout is returned to the first caller');
  assert.match(
    first instanceof Error ? first.message : '',
    /새 위치 요청을 시작하지 않았습니다/,
    'browser timeout preserves guidance about the unresolved stale request before releasing it',
  );
  const freshStart = await Promise.race([
    freshStarted.then(() => 'started' as const),
    new Promise<'test-watchdog'>((resolve) => setTimeout(() => resolve('test-watchdog'), 60)),
  ]);
  assert.equal(freshStart, 'started', 'a retry after a browser operation timeout starts a fresh request');
  assert.equal(browserCalls, 2, 'the browser retry invokes HTML5 geolocation again');

  firstSuccess({ coords: { latitude: 35.1, longitude: 128.1, accuracy: 30 } });
  const staleCallbackOutcome = await Promise.race([
    secondOutcome,
    new Promise<'still-pending'>((resolve) => setTimeout(() => resolve('still-pending'), 0)),
  ]);
  assert.equal(staleCallbackOutcome, 'still-pending', 'a late callback from the stale request cannot settle the fresh request');

  freshSuccess({ coords: { latitude: 37.5665, longitude: 126.978, accuracy: 8 } });
  assert.deepEqual(await second, {
    latitude: 37.5665,
    longitude: 126.978,
    accuracy: 8,
    source: 'browser',
  }, 'the fresh browser request resolves with its own callback');
}

async function testLegacyLocationTimeoutBlocksOverlappingRetry(): Promise<void> {
  let legacyCalls = 0;
  let firstCallback!: (error: null, location: { latitude: number; longitude: number; accuracy?: number }) => void;
  const dependencies = {
    teamsApp: {
      isInitialized: () => true,
      initialize: async () => undefined,
      getContext: async () => ({ clientType: 'ios', hostName: 'Teams' }),
    },
    legacyLocation: {
      isSupported: () => true,
      getLocation: (callback) => {
        legacyCalls += 1;
        if (legacyCalls === 1) {
          firstCallback = callback as typeof firstCallback;
          return;
        }
        callback(null, { latitude: 37.5665, longitude: 126.978, accuracy: 12 });
      },
    },
    geoLocation: {
      isSupported: () => false,
      hasPermission: async () => false,
      requestPermission: async () => false,
      getCurrentLocation: async () => ({ latitude: 37.5, longitude: 127 }),
    },
    browserGeolocation: () => undefined,
  } satisfies ClientLocationDependencies;
  const serviceOptions = { initializeTimeoutMs: 10, operationTimeoutMs: 10, allowTeamsNativeFallback: true };
  const service = createClientLocationService(dependencies, serviceOptions);

  const firstResult = await Promise.race([
    service.getCurrentDeviceLocation(new AbortController().signal).catch((error: unknown) => error),
    new Promise<'test-watchdog'>((resolve) => setTimeout(() => resolve('test-watchdog'), 60)),
  ]);

  assert.notEqual(firstResult, 'test-watchdog', 'legacy Teams location returns before the UI watchdog');
  assert.match(firstResult instanceof Error ? firstResult.message : '', /시간(?:이)? 초과/, 'legacy Teams location reports its bounded timeout');
  assert.equal(legacyCalls, 1, 'one user request invokes the iOS legacy provider at most once');

  const blockedRetry = await service.getCurrentDeviceLocation(new AbortController().signal)
    .catch((error: unknown) => error);
  assert.notEqual(
    blockedRetry,
    firstResult,
    'a retry does not reuse the permanently rejected timeout promise while the native prompt is unresolved',
  );
  assert.match(
    blockedRetry instanceof Error ? blockedRetry.message : '',
    /새로고침|다시 열|아직 완료되지 않았습니다/,
    'a retry during an unresolved native request returns actionable reload or recovery guidance',
  );
  assert.equal(legacyCalls, 1, 'a retry does not create an overlapping native location prompt');

  firstCallback(null, { latitude: 37.5, longitude: 127, accuracy: 8 });
  await new Promise<void>((resolve) => setImmediate(resolve));

  const retryResult = await service.getCurrentDeviceLocation(new AbortController().signal);
  assert.deepEqual(retryResult, {
    latitude: 37.5665,
    longitude: 126.978,
    accuracy: 12,
    source: 'teams-native',
  }, 'a later user action retries after the timed-out SDK request has actually settled');
  assert.equal(legacyCalls, 2, 'retry starts one fresh legacy location request');
}

async function testPreviewLocationStagesAreBounded(): Promise<void> {
  const stages = ['hasPermission', 'requestPermission', 'getCurrentLocation'] as const;

  for (const stage of stages) {
    const never = () => new Promise<never>(() => {});
    const dependencies = {
      teamsApp: {
        isInitialized: () => true,
        initialize: async () => undefined,
        getContext: async () => ({ clientType: 'android', hostName: 'Teams' }),
      },
      legacyLocation: {
        isSupported: () => false,
        getLocation: () => undefined,
      },
      geoLocation: {
        isSupported: () => true,
        hasPermission: stage === 'hasPermission' ? never : async () => stage === 'getCurrentLocation',
        requestPermission: stage === 'requestPermission' ? never : async () => true,
        getCurrentLocation: stage === 'getCurrentLocation'
          ? never
          : async () => ({ latitude: 37.5, longitude: 127 }),
      },
      browserGeolocation: () => ({
        getCurrentPosition: (_success, error) => error({ code: 2, message: 'position unavailable' }),
      }),
    } satisfies ClientLocationDependencies;
    const serviceOptions = { initializeTimeoutMs: 10, operationTimeoutMs: 10, allowTeamsNativeFallback: true };
    const service = createClientLocationService(dependencies, serviceOptions);

    const result = await Promise.race([
      service.getCurrentDeviceLocation(new AbortController().signal).catch((error: unknown) => error),
      new Promise<'test-watchdog'>((resolve) => setTimeout(() => resolve('test-watchdog'), 60)),
    ]);

    assert.notEqual(result, 'test-watchdog', `${stage} returns before the UI watchdog`);
    assert.match(result instanceof Error ? result.message : '', /시간(?:이)? 초과/, `${stage} reports a bounded timeout`);
  }
}

async function testUnresolvedNativePromiseDoesNotReuseRejectedRequest(): Promise<void> {
  let nativeCalls = 0;
  let resolveNativeLocation!: (location: { latitude: number; longitude: number; accuracy?: number }) => void;
  const unresolvedLocation = new Promise<{ latitude: number; longitude: number; accuracy?: number }>((resolve) => {
    resolveNativeLocation = resolve;
  });
  const dependencies = {
    teamsApp: {
      isInitialized: () => true,
      initialize: async () => undefined,
      getContext: async () => ({ clientType: 'android', hostName: 'Teams' }),
    },
    legacyLocation: {
      isSupported: () => false,
      getLocation: () => undefined,
    },
    geoLocation: {
      isSupported: () => true,
      hasPermission: async () => true,
      requestPermission: async () => true,
      getCurrentLocation: () => {
        nativeCalls += 1;
        return unresolvedLocation;
      },
    },
    browserGeolocation: () => undefined,
  } satisfies ClientLocationDependencies;
  const service = createClientLocationService(dependencies, { operationTimeoutMs: 10, allowTeamsNativeFallback: true });

  const firstResult = await service.getCurrentDeviceLocation(new AbortController().signal)
    .catch((error: unknown) => error);
  const blockedRetry = await service.getCurrentDeviceLocation(new AbortController().signal)
    .catch((error: unknown) => error);

  assert.match(firstResult instanceof Error ? firstResult.message : '', /시간(?:이)? 초과/, 'a hanging native promise still has a bounded first failure');
  assert.notEqual(blockedRetry, firstResult, 'a retry receives a fresh recovery error instead of the rejected native promise');
  assert.match(blockedRetry instanceof Error ? blockedRetry.message : '', /새로고침|다시 열|아직 완료되지 않았습니다/, 'native promise recovery explains how to recover the stuck request');
  assert.match(blockedRetry instanceof Error ? blockedRetry.message : '', /Android/, 'native promise recovery includes Android guidance');
  assert.equal(nativeCalls, 1, 'the unresolved native promise keeps a strict prompt lock');

  resolveNativeLocation({ latitude: 37.5, longitude: 127, accuracy: 7 });
  await new Promise<void>((resolve) => setImmediate(resolve));

  const retryResult = await service.getCurrentDeviceLocation(new AbortController().signal);
  assert.deepEqual(retryResult, {
    latitude: 37.5,
    longitude: 127,
    accuracy: 7,
    source: 'teams-native',
  }, 'a fresh native request is allowed after the original promise settles');
  assert.equal(nativeCalls, 2, 'the settled native promise releases the prompt lock');
}

async function testIosLegacyDenialStopsFallbacks(): Promise<void> {
  let browserCalls = 0;
  let previewCalls = 0;
  const dependencies = {
    teamsApp: {
      isInitialized: () => true,
      initialize: async () => undefined,
      getContext: async () => ({ clientType: 'ios', hostName: 'Teams' }),
    },
    legacyLocation: {
      isSupported: () => true,
      getLocation: (callback) => callback({ errorCode: 1_000, message: 'permission denied' }),
    },
    geoLocation: {
      isSupported: () => true,
      hasPermission: async () => {
        previewCalls += 1;
        return true;
      },
      requestPermission: async () => true,
      getCurrentLocation: async () => ({ latitude: 37.5, longitude: 127 }),
    },
    browserGeolocation: () => ({
      getCurrentPosition: (_success, error) => {
        browserCalls += 1;
        error({ code: 2, message: 'position unavailable' });
      },
    }),
  } satisfies ClientLocationDependencies;
  const service = createClientLocationService(dependencies, { operationTimeoutMs: 10, allowTeamsNativeFallback: true });

  const error = await service.getCurrentDeviceLocation(new AbortController().signal).catch((caught: unknown) => caught);

  assert.equal(browserCalls, 0, 'iOS legacy permission denial does not start browser geolocation');
  assert.equal(previewCalls, 0, 'iOS legacy permission denial does not start preview geolocation');
  assert.match(error instanceof Error ? error.message : '', /iPhone|iPad/, 'iOS denial provides Apple recovery guidance');
  assert.doesNotMatch(error instanceof Error ? error.message : '', /Android/, 'iOS denial does not provide Android guidance');
}

async function testAndroidBrowserDenialFallsBackToTeamsGeoLocation(): Promise<void> {
  let legacyCalls = 0;
  let previewCalls = 0;
  const dependencies = {
    teamsApp: {
      isInitialized: () => true,
      initialize: async () => undefined,
      getContext: async () => ({ clientType: 'android', hostName: 'Teams' }),
    },
    legacyLocation: {
      isSupported: () => true,
      getLocation: () => {
        legacyCalls += 1;
      },
    },
    geoLocation: {
      isSupported: () => true,
      hasPermission: async () => {
        previewCalls += 1;
        return true;
      },
      requestPermission: async () => true,
      getCurrentLocation: async () => ({ latitude: 37.5, longitude: 127, accuracy: 9 }),
    },
    browserGeolocation: () => ({
      getCurrentPosition: (_success, error) => error({ code: 1, message: 'permission denied' }),
    }),
  } satisfies ClientLocationDependencies;
  const service = createClientLocationService(dependencies, { operationTimeoutMs: 10, allowTeamsNativeFallback: true });

  const result = await service.getCurrentDeviceLocation(new AbortController().signal);

  assert.deepEqual(result, {
    latitude: 37.5,
    longitude: 127,
    accuracy: 9,
    source: 'teams-native',
  }, 'Android browser permission denial falls back to the supported Teams native location');
  assert.equal(previewCalls, 1, 'Android browser permission denial starts one Teams native permission check');
  assert.equal(legacyCalls, 0, 'Android browser permission denial does not start legacy geolocation');
}

async function testAndroidBrowserDenialFallsBackToLegacyWhenGeoLocationUnsupported(): Promise<void> {
  let legacyCalls = 0;
  const dependencies = {
    teamsApp: {
      isInitialized: () => true,
      initialize: async () => undefined,
      getContext: async () => ({ clientType: 'android', hostName: 'Teams' }),
    },
    legacyLocation: {
      isSupported: () => true,
      getLocation: (callback) => {
        legacyCalls += 1;
        callback(null, { latitude: 37.5665, longitude: 126.978, accuracy: 11 });
      },
    },
    geoLocation: {
      isSupported: () => false,
      hasPermission: async () => false,
      requestPermission: async () => false,
      getCurrentLocation: async () => ({ latitude: 37.5, longitude: 127 }),
    },
    browserGeolocation: () => ({
      getCurrentPosition: (_success, error) => error({ code: 1, message: 'permission denied' }),
    }),
  } satisfies ClientLocationDependencies;
  const service = createClientLocationService(dependencies, { operationTimeoutMs: 10, allowTeamsNativeFallback: true });

  const result = await service.getCurrentDeviceLocation(new AbortController().signal);

  assert.deepEqual(result, {
    latitude: 37.5665,
    longitude: 126.978,
    accuracy: 11,
    source: 'teams-native',
  }, 'Android browser permission denial falls back to legacy Teams location when geoLocation is unsupported');
  assert.equal(legacyCalls, 1, 'Android legacy fallback opens one native location request');
}

async function testBrowserDenialProvidesSiteRecoveryGuidance(): Promise<void> {
  const dependencies = {
    teamsApp: {
      isInitialized: () => true,
      initialize: async () => undefined,
      getContext: async () => ({ clientType: 'web', hostName: 'Teams' }),
    },
    legacyLocation: {
      isSupported: () => false,
      getLocation: () => undefined,
    },
    geoLocation: {
      isSupported: () => false,
      hasPermission: async () => false,
      requestPermission: async () => false,
      getCurrentLocation: async () => ({ latitude: 37.5, longitude: 127 }),
    },
    browserGeolocation: () => ({
      getCurrentPosition: (_success, error) => error({ code: 1, message: 'permission denied' }),
    }),
  } satisfies ClientLocationDependencies;
  const service = createClientLocationService(dependencies, { operationTimeoutMs: 10 });

  const error = await service.getCurrentDeviceLocation(new AbortController().signal)
    .catch((caught: unknown) => caught);

  assert.match(error instanceof Error ? error.message : '', /브라우저|사이트/, 'browser denial explains the browser site permission recovery path');
  assert.doesNotMatch(error instanceof Error ? error.message : '', /Teams 앱 권한/, 'browser denial does not claim the Teams-native permission path');
}

async function testAndroidTeamsNativeDenialStopsFurtherFallbacks(): Promise<void> {
  let browserCalls = 0;
  let legacyCalls = 0;
  let nativePermissionChecks = 0;
  const dependencies = {
    teamsApp: {
      isInitialized: () => true,
      initialize: async () => undefined,
      getContext: async () => ({ clientType: 'android', hostName: 'Teams' }),
    },
    legacyLocation: {
      isSupported: () => true,
      getLocation: () => {
        legacyCalls += 1;
      },
    },
    geoLocation: {
      isSupported: () => true,
      hasPermission: async () => {
        nativePermissionChecks += 1;
        return false;
      },
      requestPermission: async () => false,
      getCurrentLocation: async () => ({ latitude: 37.5, longitude: 127 }),
    },
    browserGeolocation: () => ({
      getCurrentPosition: (_success, error) => {
        browserCalls += 1;
        error({ code: 1, message: 'permission denied' });
      },
    }),
  } satisfies ClientLocationDependencies;
  const service = createClientLocationService(dependencies, { operationTimeoutMs: 10, allowTeamsNativeFallback: true });

  const error = await service.getCurrentDeviceLocation(new AbortController().signal)
    .catch((caught: unknown) => caught);

  assert.equal(browserCalls, 1, 'compatibility fallback observes the browser permission denial before native APIs');
  assert.equal(nativePermissionChecks, 1, 'Teams native permission is checked once');
  assert.equal(legacyCalls, 0, 'Teams native denial does not cascade into legacy location');
  assert.match(error instanceof Error ? error.message : '', /Android/, 'Teams native denial provides Android recovery guidance');
  assert.doesNotMatch(error instanceof Error ? error.message : '', /iPhone|iPad/, 'Android native denial does not provide Apple guidance');
}

async function testPreviewDenialStopsLegacyFallbackWithNeutralGuidance(): Promise<void> {
  let legacyCalls = 0;
  const dependencies = {
    teamsApp: {
      isInitialized: () => true,
      initialize: async () => undefined,
      getContext: async () => ({ clientType: 'web', hostName: 'Teams' }),
    },
    legacyLocation: {
      isSupported: () => true,
      getLocation: () => {
        legacyCalls += 1;
      },
    },
    geoLocation: {
      isSupported: () => true,
      hasPermission: async () => false,
      requestPermission: async () => false,
      getCurrentLocation: async () => ({ latitude: 37.5, longitude: 127 }),
    },
    browserGeolocation: () => ({
      getCurrentPosition: (_success, error) => error({ code: 2, message: 'position unavailable' }),
    }),
  } satisfies ClientLocationDependencies;
  const service = createClientLocationService(dependencies, { operationTimeoutMs: 10, allowTeamsNativeFallback: true });

  const error = await service.getCurrentDeviceLocation(new AbortController().signal).catch((caught: unknown) => caught);

  assert.equal(legacyCalls, 0, 'preview permission denial does not cascade into legacy geolocation');
  assert.match(error instanceof Error ? error.message : '', /Teams 앱 권한/, 'neutral denial explains the Teams permission recovery path');
  assert.doesNotMatch(error instanceof Error ? error.message : '', /iPhone|iPad|Android/, 'neutral denial does not guess a mobile platform');
}

async function testConcurrentRequestsRemainDeduplicatedAndAbortIndependent(): Promise<void> {
  let browserCalls = 0;
  let resolveBrowserStarted!: () => void;
  let completeBrowser!: (position: { coords: { latitude: number; longitude: number; accuracy?: number } }) => void;
  const browserStarted = new Promise<void>((resolve) => {
    resolveBrowserStarted = resolve;
  });
  const dependencies = {
    teamsApp: {
      isInitialized: () => true,
      initialize: async () => undefined,
      getContext: async () => ({ clientType: 'web', hostName: 'Teams' }),
    },
    legacyLocation: {
      isSupported: () => false,
      getLocation: () => undefined,
    },
    geoLocation: {
      isSupported: () => false,
      hasPermission: async () => false,
      requestPermission: async () => false,
      getCurrentLocation: async () => ({ latitude: 37.5, longitude: 127 }),
    },
    browserGeolocation: () => ({
      getCurrentPosition: (success) => {
        browserCalls += 1;
        completeBrowser = success;
        resolveBrowserStarted();
      },
    }),
  } satisfies ClientLocationDependencies;
  const service = createClientLocationService(dependencies, { operationTimeoutMs: 50 });
  const firstController = new AbortController();
  const secondController = new AbortController();

  const first = service.getCurrentDeviceLocation(firstController.signal);
  const second = service.getCurrentDeviceLocation(secondController.signal);
  await browserStarted;
  assert.equal(browserCalls, 1, 'concurrent callers share one underlying browser location request');

  firstController.abort();
  await assert.rejects(first, (error: unknown) => error instanceof Error && error.name === 'AbortError');
  completeBrowser({ coords: { latitude: 37.5665, longitude: 126.978, accuracy: 8 } });
  assert.deepEqual(await second, {
    latitude: 37.5665,
    longitude: 126.978,
    accuracy: 8,
    source: 'browser',
  }, 'one caller aborting does not cancel the shared request for another caller');
}

for (const [name, test] of [
  ['capability', testTeamsCapabilityDiscoveryIsBounded],
  ['initialization', testTeamsInitializationIsBounded],
  ['runtime-retry', testTimedOutTeamsContextRequiresFreshHostBeforeBrowserLocation],
  ['android-mobile-fresh-browser', testAndroidMobileUsesFreshBrowserLocation],
  ['new-teams-mobile-default-provider', testDefaultTeamsLocationUsesHtml5OnNewMobileHosts],
  ['teams-context-required', testUnavailableTeamsContextDoesNotUseBrowserLocation],
  ['android-mobile-permission', testAndroidMobileBrowserPermissionDeniedIsExplicit],
  ['android-mobile-timeout', testAndroidMobileBrowserTimeoutIsExplicit],
  ['browser-timeout-retry', testBrowserLocationTimeoutStartsFreshRequestAndIgnoresLateCallback],
  ['legacy-timeout', testLegacyLocationTimeoutBlocksOverlappingRetry],
  ['preview-stages', testPreviewLocationStagesAreBounded],
  ['native-timeout', testUnresolvedNativePromiseDoesNotReuseRejectedRequest],
  ['ios-denial', testIosLegacyDenialStopsFallbacks],
  ['android-geo', testAndroidBrowserDenialFallsBackToTeamsGeoLocation],
  ['android-legacy', testAndroidBrowserDenialFallsBackToLegacyWhenGeoLocationUnsupported],
  ['android-denial', testAndroidTeamsNativeDenialStopsFurtherFallbacks],
  ['preview-denial', testPreviewDenialStopsLegacyFallbackWithNeutralGuidance],
  ['browser-denial', testBrowserDenialProvidesSiteRecoveryGuidance],
  ['concurrent', testConcurrentRequestsRemainDeduplicatedAndAbortIndependent],
] as const) {
  await test();
}

hooks.deregister();
console.log('PASS: client location idle state, timeouts, retry, and permission-denial boundaries');
