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

class LocationPermissionDeniedError extends Error {
  constructor() {
    super('Location permission denied');
    this.name = 'LocationPermissionDeniedError';
  }
}

function isPermissionDenied(error: unknown): boolean {
  if (error instanceof LocationPermissionDeniedError) return true;
  if (!error || typeof error !== 'object') return false;
  const candidate = error as LocationError;
  return candidate.code === 1 || candidate.errorCode === 1_000;
}

function locationRecoveryGuidance(clientType: string): string {
  if (clientType === 'ios' || clientType === 'ipados') {
    return 'Teams 앱 권한에서 위치를 허용하고, iPhone 또는 iPad 설정의 개인정보 보호 및 보안 > 위치 서비스 > Teams도 “앱 사용 중”으로 설정한 뒤 다시 시도하세요.';
  }
  if (clientType === 'android') {
    return 'Teams 앱 권한에서 위치를 허용하고, Android 설정 > 앱 > Teams > 권한 > 위치에서 “앱 사용 중에만 허용”으로 설정한 뒤 다시 시도하세요.';
  }
  return 'Teams 앱 권한에서 위치를 허용한 뒤 다시 시도하세요.';
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
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
  let teamsLocationReady: Promise<TeamsLocationRuntime> | null = null;
  let deviceLocationRequest: Promise<DeviceLocation> | null = null;

  async function initializeTeamsLocation(): Promise<TeamsLocationRuntime> {
    if (!teamsLocationReady) {
      const initializationAttempt = (async (): Promise<TeamsLocationRuntime> => {
        try {
          if (!dependencies.teamsApp.isInitialized()) {
            await withTimeout(
              dependencies.teamsApp.initialize(),
              initializeTimeoutMs,
              'Teams 호스트 초기화 시간 초과',
            );
          }

          const context = await withTimeout(
            dependencies.teamsApp.getContext(),
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
          const runtime = {
            available: false,
            clientType: '',
            hostName: '',
            legacyLocationSupported: false,
            geoLocationSupported: false,
          };
          options.onRuntime?.(runtime);
          return runtime;
        }
      })();

      const retryableInitialization = initializationAttempt.then((runtime) => {
        if (!runtime.available && teamsLocationReady === retryableInitialization) {
          teamsLocationReady = null;
        }
        return runtime;
      });
      teamsLocationReady = retryableInitialization;
    }

    return teamsLocationReady;
  }

  function getLegacyTeamsLocation(): Promise<DeviceLocation> {
    return withTimeout(
      new Promise((resolve, reject) => {
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
      }),
      operationTimeoutMs,
      'Teams 위치 확인 시간이 초과되었습니다.',
    );
  }

  function getBrowserLocation(): Promise<DeviceLocation> {
    return new Promise((resolve, reject) => {
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
    });
  }

  async function resolveCurrentDeviceLocation(): Promise<DeviceLocation> {
    const locationErrors: string[] = [];
    const runtime = await initializeTeamsLocation();
    const isAppleMobile = runtime.clientType === 'ios' || runtime.clientType === 'ipados';
    let legacyAttempted = false;

    async function tryProvider(name: string, provider: () => Promise<DeviceLocation>): Promise<DeviceLocation | null> {
      try {
        return await provider();
      } catch (caught) {
        if (isPermissionDenied(caught)) {
          throw new Error(`위치 권한이 거부되었습니다. ${locationRecoveryGuidance(runtime.clientType)}`);
        }
        locationErrors.push(caught instanceof Error ? `${name}: ${caught.message}` : `${name}: 위치를 확인하지 못했습니다.`);
        return null;
      }
    }

    if (isAppleMobile && runtime.legacyLocationSupported) {
      legacyAttempted = true;
      const nativeLocation = await tryProvider('Teams iPhone 위치', getLegacyTeamsLocation);
      if (nativeLocation) return nativeLocation;
    }

    const browserLocation = await tryProvider('HTML5 위치', getBrowserLocation);
    if (browserLocation) return browserLocation;

    if (runtime.geoLocationSupported) {
      const geoLocationResult = await tryProvider('Teams geoLocation', async () => {
        const hasPermission = await withTimeout(
          dependencies.geoLocation.hasPermission(),
          operationTimeoutMs,
          'Teams 위치 권한 확인 시간이 초과되었습니다.',
        );
        if (!hasPermission && !(await withTimeout(
          dependencies.geoLocation.requestPermission(),
          operationTimeoutMs,
          'Teams 위치 권한 요청 시간이 초과되었습니다.',
        ))) {
          throw new LocationPermissionDeniedError();
        }

        const location = await withTimeout(
          dependencies.geoLocation.getCurrentLocation(),
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
          source: 'teams-native' as const,
        };
      });
      if (geoLocationResult) return geoLocationResult;
    }

    if (runtime.legacyLocationSupported && !legacyAttempted) {
      const nativeLocation = await tryProvider('Teams 위치', getLegacyTeamsLocation);
      if (nativeLocation) return nativeLocation;
    }

    throw new Error(
      `${locationErrors.join(' ')} ${locationRecoveryGuidance(runtime.clientType)}`,
    );
  }

  function getCurrentDeviceLocation(signal: AbortSignal): Promise<DeviceLocation> {
    throwIfAborted(signal);

    if (!deviceLocationRequest) {
      const request = resolveCurrentDeviceLocation();
      const trackedRequest = request.finally(() => {
        if (deviceLocationRequest === trackedRequest) deviceLocationRequest = null;
      });
      deviceLocationRequest = trackedRequest;
    }

    return waitForAbort(deviceLocationRequest, signal);
  }

  return {
    getRuntime: initializeTeamsLocation,
    getCurrentDeviceLocation,
  };
}
