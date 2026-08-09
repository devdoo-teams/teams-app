export type LocationSource = 'browser' | 'teams-native' | 'demo';

export type DeviceLocation = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  source: 'browser' | 'teams-native';
};

export type TeamsLocationRuntime = {
  available: boolean;
  clientType: string;
  hostName: string;
  legacyLocationSupported: boolean;
  geoLocationSupported: boolean;
};

type Coordinates = {
  latitude: number;
  longitude: number;
  accuracy?: number;
};

type LocationError = {
  code?: number;
  errorCode?: number;
  message?: string;
};

type LocationProvider = 'browser' | 'teams-native';

class LocationPermissionDeniedError extends Error {
  constructor() {
    super('Location permission denied');
    this.name = 'LocationPermissionDeniedError';
  }
}

class LocationTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocationTimeoutError';
  }
}

function isPermissionDenied(error: unknown): boolean {
  if (error instanceof LocationPermissionDeniedError) return true;
  if (!error || typeof error !== 'object') return false;
  const candidate = error as LocationError;
  return candidate.code === 1 || candidate.errorCode === 1_000;
}

function locationRecoveryGuidance(clientType: string, provider: LocationProvider): string {
  if (provider === 'browser') {
    return '브라우저 주소 표시줄의 사이트 설정에서 위치 권한을 허용하고 Teams 탭을 새로고침한 뒤 다시 시도하세요.';
  }
  if (clientType === 'ios' || clientType === 'ipados') {
    return 'Teams 앱 권한에서 위치를 허용하고, iPhone 또는 iPad 설정의 개인정보 보호 및 보안 > 위치 서비스 > Teams도 “앱 사용 중”으로 설정한 뒤 다시 시도하세요.';
  }
  if (clientType === 'android') {
    return 'Teams 앱 권한에서 위치를 허용하고, Android 설정 > 앱 > Teams > 권한 > 위치에서 “앱 사용 중에만 허용”으로 설정한 뒤 다시 시도하세요.';
  }
  return 'Teams 앱 권한에서 위치를 허용한 뒤 다시 시도하세요.';
}

function locationPermissionDeniedMessage(clientType: string, provider: LocationProvider): string {
  const providerLabel = provider === 'browser' ? '브라우저 사이트' : 'Teams 네이티브';
  return `${providerLabel} 위치 권한이 거부되었습니다. ${locationRecoveryGuidance(clientType, provider)}`;
}

function unresolvedLocationRecoveryMessage(clientType: string, provider: LocationProvider): string {
  const providerLabel = provider === 'browser' ? '브라우저' : 'Teams 네이티브';
  const reloadGuidance = provider === 'browser'
    ? '브라우저 사이트 위치 권한을 확인하고 Teams 탭을 새로고침한 뒤 다시 시도하세요.'
    : `Teams 탭을 새로고침하거나 Teams 앱을 다시 열어 요청을 복구한 뒤 다시 시도하세요. ${locationRecoveryGuidance(clientType, provider)}`;
  return `${providerLabel} 위치 요청이 아직 완료되지 않았습니다. 새 위치 요청을 시작하지 않았습니다. ${reloadGuidance}`;
}

type BrowserPosition = {
  coords: Coordinates;
};

export type ClientLocationDependencies = {
  teamsApp: {
    isInitialized(): boolean;
    initialize(): Promise<void>;
    getContext(): Promise<{ clientType: string; hostName: string }>;
  };
  legacyLocation: {
    isSupported(): boolean;
    getLocation(callback: (error: LocationError | null, location?: Coordinates) => void): void;
  };
  geoLocation: {
    isSupported(): boolean;
    hasPermission(): Promise<boolean>;
    requestPermission(): Promise<boolean>;
    getCurrentLocation(): Promise<Coordinates>;
  };
  browserGeolocation(): {
    getCurrentPosition(
      success: (position: BrowserPosition) => void,
      error: (error: LocationError) => void,
      options: { enableHighAccuracy: boolean; maximumAge: number; timeout: number },
    ): void;
  } | undefined;
};

export type ClientLocationServiceOptions = {
  initializeTimeoutMs?: number;
  operationTimeoutMs?: number;
  onRuntime?: (runtime: TeamsLocationRuntime) => void;
};

export function createAbortError(): Error {
  const error = new Error('Weather request aborted');
  error.name = 'AbortError';
  return error;
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw createAbortError();
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function waitForAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
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

function isLocationTimeoutError(error: unknown): boolean {
  return error instanceof LocationTimeoutError;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new LocationTimeoutError(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

type TrackedAttempt = {
  track<T>(promise: Promise<T>, provider?: LocationProvider): Promise<T>;
  finish(): void;
  abandon(): void;
  isSettled(): boolean;
  pendingProvider(): LocationProvider | null;
  settled: Promise<void>;
};

function createTrackedAttempt(): TrackedAttempt {
  let finished = false;
  let abandoned = false;
  let resolveSettled!: () => void;
  const pending = new Map<Promise<unknown>, LocationProvider | undefined>();
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });

  const checkSettled = () => {
    if (finished && pending.size === 0) resolveSettled();
  };

  return {
    track<T>(promise: Promise<T>, provider?: LocationProvider): Promise<T> {
      const tracked = Promise.resolve(promise);
      if (abandoned) {
        // A timed-out host call may never settle. Do not let a late call added by
        // cleanup keep the next user request permanently locked.
        void tracked.catch(() => undefined);
        return tracked;
      }
      pending.set(tracked, provider);
      tracked.then(
        () => {
          pending.delete(tracked);
          checkSettled();
        },
        () => {
          pending.delete(tracked);
          checkSettled();
        },
      );
      return tracked;
    },
    finish() {
      finished = true;
      checkSettled();
    },
    abandon() {
      abandoned = true;
      finished = true;
      pending.clear();
      resolveSettled();
    },
    isSettled() {
      return abandoned || (finished && pending.size === 0);
    },
    pendingProvider() {
      for (const provider of pending.values()) {
        if (provider) return provider;
      }
      return null;
    },
    settled,
  };
}

export type ClientLocationService = {
  getRuntime(): Promise<TeamsLocationRuntime>;
  getCurrentDeviceLocation(signal: AbortSignal): Promise<DeviceLocation>;
};

export function createClientLocationService(
  dependencies: ClientLocationDependencies,
  options: ClientLocationServiceOptions = {},
): ClientLocationService {
  const initializeTimeoutMs = options.initializeTimeoutMs ?? 2_000;
  const operationTimeoutMs = options.operationTimeoutMs ?? 12_000;
  type RuntimeAttempt = {
    result: Promise<TeamsLocationRuntime>;
    settled: Promise<void>;
  };
  type DeviceLocationRequest = {
    generation: number;
    result: Promise<DeviceLocation>;
    attempt: TrackedAttempt;
    runtime: TeamsLocationRuntime | null;
    status: 'pending' | 'fulfilled' | 'rejected';
  };

  let teamsLocationReady: RuntimeAttempt | null = null;
  let deviceLocationRequest: DeviceLocationRequest | null = null;
  let deviceLocationGeneration = 0;

  function createRuntimeAttempt(): RuntimeAttempt {
    const attempt = createTrackedAttempt();
    const initializationAttempt = (async (): Promise<TeamsLocationRuntime> => {
      try {
        if (!dependencies.teamsApp.isInitialized()) {
          await withTimeout(
            attempt.track(dependencies.teamsApp.initialize()),
            initializeTimeoutMs,
            'Teams 호스트 초기화 시간 초과',
          );
        }

        const context = await withTimeout(
          attempt.track(dependencies.teamsApp.getContext()),
          initializeTimeoutMs,
          'Teams 호스트 기능 확인 시간 초과',
        );
        let legacyLocationSupported = false;
        let geoLocationSupported = false;

        try {
          legacyLocationSupported = dependencies.legacyLocation.isSupported();
        } catch {
          // The SDK can still be initialized on hosts that do not expose this capability.
        }

        try {
          geoLocationSupported = dependencies.geoLocation.isSupported();
        } catch {
          // geoLocation is preview and may not be exposed by the current host.
        }

        const runtime = {
          available: true,
          clientType: context.clientType,
          hostName: context.hostName,
          legacyLocationSupported,
          geoLocationSupported,
        };
        options.onRuntime?.(runtime);
        return runtime;
      } catch {
        // `withTimeout` cannot cancel every Teams SDK promise. Release this
        // capability-discovery attempt explicitly so a later user action can
        // create a fresh runtime attempt instead of reusing a stale promise.
        attempt.abandon();
        const runtime = {
          available: false,
          clientType: '',
          hostName: '',
          legacyLocationSupported: false,
          geoLocationSupported: false,
        };
        options.onRuntime?.(runtime);
        return runtime;
      } finally {
        attempt.finish();
      }
    })();

    const runtimeAttempt = {
      result: initializationAttempt,
      settled: attempt.settled,
    };
    teamsLocationReady = runtimeAttempt;
    void initializationAttempt.then((runtime) => {
      if (!runtime.available) {
        void runtimeAttempt.settled.then(() => {
          if (teamsLocationReady === runtimeAttempt) teamsLocationReady = null;
        });
      }
    });
    return runtimeAttempt;
  }

  function getRuntimeAttempt(): RuntimeAttempt {
    return teamsLocationReady ?? createRuntimeAttempt();
  }

  async function initializeTeamsLocation(attempt?: TrackedAttempt): Promise<TeamsLocationRuntime> {
    const runtimeAttempt = getRuntimeAttempt();
    if (attempt) attempt.track(runtimeAttempt.settled, 'teams-native');
    return runtimeAttempt.result;
  }

  function getLegacyTeamsLocation(attempt: TrackedAttempt): Promise<DeviceLocation> {
    const operation = attempt.track(new Promise<DeviceLocation>((resolve, reject) => {
      dependencies.legacyLocation.getLocation((locationError, location) => {
        if (locationError) {
          if (isPermissionDenied(locationError)) {
            reject(new LocationPermissionDeniedError());
            return;
          }
          reject(new Error(locationError.message || 'Teams 레거시 위치 API를 사용할 수 없습니다.'));
          return;
        }

        if (!Number.isFinite(location?.latitude) || !Number.isFinite(location?.longitude)) {
          reject(new Error('Teams가 유효한 위치를 반환하지 않았습니다.'));
          return;
        }

        resolve({
          latitude: location!.latitude,
          longitude: location!.longitude,
          accuracy: location!.accuracy,
          source: 'teams-native',
        });
      });
    }), 'teams-native');

    return withTimeout(
      operation,
      operationTimeoutMs,
      'Teams 위치 확인 시간이 초과되었습니다.',
    );
  }

  function getBrowserLocation(attempt: TrackedAttempt): Promise<DeviceLocation> {
    const operation = attempt.track(new Promise<DeviceLocation>((resolve, reject) => {
      const browserGeolocation = dependencies.browserGeolocation();
      if (!browserGeolocation) {
        reject(new Error('이 환경에서는 HTML5 위치 정보를 지원하지 않습니다.'));
        return;
      }

      browserGeolocation.getCurrentPosition(
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
          if (isPermissionDenied(error)) {
            reject(new LocationPermissionDeniedError());
            return;
          }
          const message = error.code === 3
            ? '위치 확인 시간이 초과되었습니다. 잠시 후 다시 시도하세요.'
            : '브라우저 위치를 확인하지 못했습니다.';
          reject(new Error(message));
        },
        { enableHighAccuracy: false, maximumAge: 300_000, timeout: 12_000 },
      );
    }), 'browser');

    return withTimeout(operation, operationTimeoutMs, '브라우저 위치 확인 시간이 초과되었습니다.');
  }

  async function getTeamsGeoLocation(attempt: TrackedAttempt): Promise<DeviceLocation> {
    const hasPermission = await withTimeout(
      attempt.track(dependencies.geoLocation.hasPermission(), 'teams-native'),
      operationTimeoutMs,
      'Teams 위치 권한 확인 시간이 초과되었습니다.',
    );
    if (!hasPermission && !(await withTimeout(
      attempt.track(dependencies.geoLocation.requestPermission(), 'teams-native'),
      operationTimeoutMs,
      'Teams 위치 권한 요청 시간이 초과되었습니다.',
    ))) {
      throw new LocationPermissionDeniedError();
    }

    const location = await withTimeout(
      attempt.track(dependencies.geoLocation.getCurrentLocation(), 'teams-native'),
      operationTimeoutMs,
      'Teams 현재 위치 확인 시간이 초과되었습니다.',
    );
    if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
      throw new Error('Teams가 유효한 위치를 반환하지 않았습니다.');
    }

    return {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy,
      source: 'teams-native',
    };
  }

  async function resolveCurrentDeviceLocation(
    attempt: TrackedAttempt,
    onRuntime: (runtime: TeamsLocationRuntime) => void,
  ): Promise<DeviceLocation> {
    const locationErrors: string[] = [];
    const runtime = await initializeTeamsLocation(attempt);
    onRuntime(runtime);
    const isAppleMobile = runtime.clientType === 'ios' || runtime.clientType === 'ipados';
    const isAndroidMobile = runtime.clientType === 'android';
    let legacyAttempted = false;
    let lastProvider: LocationProvider = 'browser';

    async function tryProvider(
      name: string,
      provider: LocationProvider,
      operation: () => Promise<DeviceLocation>,
      allowPermissionDenied = false,
    ): Promise<DeviceLocation | null> {
      lastProvider = provider;
      try {
        return await operation();
      } catch (caught) {
        if (isPermissionDenied(caught)) {
          if (allowPermissionDenied) {
            locationErrors.push(`${name}: ${locationPermissionDeniedMessage(runtime.clientType, provider)}`);
            return null;
          }
          throw new Error(locationPermissionDeniedMessage(runtime.clientType, provider));
        }
        if (isLocationTimeoutError(caught)) {
          const pendingProvider = attempt.pendingProvider();
          if (pendingProvider) {
            const timeoutMessage = caught instanceof Error
              ? caught.message
              : '위치 확인 시간이 초과되었습니다.';
            throw new LocationTimeoutError(
              `${timeoutMessage} ${unresolvedLocationRecoveryMessage(runtime.clientType, pendingProvider)}`,
            );
          }
          throw caught;
        }
        locationErrors.push(caught instanceof Error ? `${name}: ${caught.message}` : `${name}: 위치를 확인하지 못했습니다.`);
        return null;
      }
    }

    if (isAppleMobile && runtime.legacyLocationSupported) {
      legacyAttempted = true;
      const nativeLocation = await tryProvider('Teams iPhone 위치', 'teams-native', () => getLegacyTeamsLocation(attempt));
      if (nativeLocation) return nativeLocation;
    }

    const browserLocation = await tryProvider(
      'HTML5 위치',
      'browser',
      () => getBrowserLocation(attempt),
      isAndroidMobile && (runtime.geoLocationSupported || runtime.legacyLocationSupported),
    );
    if (browserLocation) return browserLocation;

    if (runtime.geoLocationSupported) {
      const geoLocationResult = await tryProvider(
        'Teams geoLocation',
        'teams-native',
        () => getTeamsGeoLocation(attempt),
      );
      if (geoLocationResult) return geoLocationResult;
    }

    if (runtime.legacyLocationSupported && !legacyAttempted) {
      const nativeLocation = await tryProvider('Teams 위치', 'teams-native', () => getLegacyTeamsLocation(attempt));
      if (nativeLocation) return nativeLocation;
    }

    throw new Error(
      `${locationErrors.join(' ')} ${locationRecoveryGuidance(runtime.clientType, lastProvider)}`.trim(),
    );
  }

  function getCurrentDeviceLocation(signal: AbortSignal): Promise<DeviceLocation> {
    throwIfAborted(signal);

    if (deviceLocationRequest?.status === 'rejected' && deviceLocationRequest.attempt.isSettled()) {
      deviceLocationRequest = null;
    }

    if (!deviceLocationRequest) {
      const attempt = createTrackedAttempt();
      const request: DeviceLocationRequest = {
        generation: deviceLocationGeneration + 1,
        result: null as unknown as Promise<DeviceLocation>,
        attempt,
        runtime: null,
        status: 'pending',
      };
      request.result = resolveCurrentDeviceLocation(attempt, (runtime) => {
        request.runtime = runtime;
      });
      deviceLocationGeneration = request.generation;
      deviceLocationRequest = request;

      void request.result.then(
        () => {
          request.status = 'fulfilled';
          attempt.finish();
        },
        () => {
          request.status = 'rejected';
          attempt.finish();
        },
      );
      void attempt.settled.then(() => {
        if (deviceLocationRequest?.generation === request.generation) {
          deviceLocationRequest = null;
        }
      });
    }

    const request = deviceLocationRequest;
    if (request.status === 'rejected' && !request.attempt.isSettled()) {
      const pendingProvider = request.attempt.pendingProvider() ?? 'teams-native';
      return waitForAbort<DeviceLocation>(
        Promise.reject(new Error(unresolvedLocationRecoveryMessage(request.runtime?.clientType ?? '', pendingProvider))),
        signal,
      );
    }

    return waitForAbort(request.result, signal);
  }

  return {
    getRuntime: initializeTeamsLocation,
    getCurrentDeviceLocation,
  };
}
