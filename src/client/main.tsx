import { StrictMode, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { app } from '@microsoft/teams-js';

import { App } from './App.js';
import { markTeamsHostReady } from './auth.js';
import './styles.css';

type BootstrapResult = 'ready' | 'preview' | 'recovery' | 'stale';
type BootstrapMode = 'teams' | 'preview';

// TeamsJS keeps app.initialize() pending for up to 60 seconds. Keep the
// controller timeout outside that window so a retry cannot reset a still-live
// SDK initialization promise and race its late host response.
export const DEFAULT_TEAMS_BOOTSTRAP_TIMEOUT_MS = 65_000;

type BootstrapOptions = {
  mode?: BootstrapMode;
  documentLifetime?: object;
  initialize: () => Promise<void>;
  markHostReady: () => void;
  setHost: () => void;
  renderLoading: () => void;
  renderRecovery: (retry: () => void) => void;
  renderNotifyRecovery?: (retry: () => void) => void;
  clearNotifyRecovery?: () => void;
  renderApp: () => void;
  notifySuccess?: () => Promise<unknown> | unknown;
  recoverFromTimedOutInitialization?: () => void;
  timeoutMs?: number;
};

type TeamsAppLifecycle = {
  initialize: () => Promise<void>;
  isInitialized: () => boolean;
  notifySuccess: () => Promise<unknown> | unknown;
};

type ReactRootRenderer = {
  render: (children: ReactNode) => void;
  unmount: () => void;
};

type MountTeamsApplicationOptions = {
  root: HTMLElement;
  mode: BootstrapMode;
  teamsApp: TeamsAppLifecycle;
  markHostReady: () => void;
  setHost: () => void;
  renderApplication: () => ReactNode;
  createRoot?: (container: HTMLElement) => ReactRootRenderer;
  reloadPage?: () => void;
  timeoutMs?: number;
};

type TeamsBootstrapController = {
  start: () => Promise<BootstrapResult>;
  dispose: () => void;
};

type DocumentInitializationLatch = {
  promise: Promise<void>;
  status: 'pending' | 'ready' | 'rejected' | 'timedOut';
  reject: (error: unknown) => void;
  timeout: () => void;
};

const documentInitializationLatchesKey = Symbol.for('teams-app.document-initialization-latches');
type TeamsBootstrapGlobal = typeof globalThis & {
  [key: symbol]: WeakMap<object, DocumentInitializationLatch> | undefined;
};
const teamsBootstrapGlobal = globalThis as TeamsBootstrapGlobal;
const existingDocumentInitializationLatches = teamsBootstrapGlobal[documentInitializationLatchesKey];
const documentInitializationLatches = existingDocumentInitializationLatches
  ?? new WeakMap<object, DocumentInitializationLatch>();
if (!existingDocumentInitializationLatches) {
  teamsBootstrapGlobal[documentInitializationLatchesKey] = documentInitializationLatches;
}

function getDocumentInitializationPromise(
  documentLifetime: object,
  initialize: () => Promise<void>,
): DocumentInitializationLatch {
  const existingLatch = documentInitializationLatches.get(documentLifetime);
  if (existingLatch) return existingLatch;

  let resolveInitialization!: () => void;
  let rejectInitialization!: (error: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolveInitialization = resolve;
    rejectInitialization = reject;
  });
  let latch!: DocumentInitializationLatch;
  const reject = (error: unknown): void => {
    if (latch.status !== 'pending') return;
    latch.status = 'rejected';
    rejectInitialization(error);
  };
  const timeout = (): void => {
    if (latch.status !== 'pending') return;
    latch.status = 'timedOut';
    rejectInitialization(new TeamsBootstrapTimeoutError());
  };
  latch = { promise, status: 'pending', reject, timeout };
  documentInitializationLatches.set(documentLifetime, latch);

  try {
    Promise.resolve(initialize()).then(
      () => {
        if (latch.status !== 'pending') return;
        latch.status = 'ready';
        resolveInitialization();
      },
      reject,
    );
  } catch (error) {
    reject(error);
  }

  return latch;
}

class TeamsBootstrapTimeoutError extends Error {
  constructor() {
    super('Teams 호스트 초기화 시간이 초과되었습니다.');
    this.name = 'TeamsBootstrapTimeoutError';
  }
}

function withBootstrapTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => reject(new TeamsBootstrapTimeoutError()), timeoutMs);
    promise.then(
      () => {
        globalThis.clearTimeout(timeout);
        resolve();
      },
      (error: unknown) => {
        globalThis.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function BootstrapLoading(): ReactNode {
  return (
    <main aria-live="polite" role="status">
      <p>Teams 앱 연결을 확인하고 있습니다.</p>
      <p>잠시만 기다려 주세요.</p>
    </main>
  );
}

const bootstrapRecoveryStatusStyle: CSSProperties = {
  boxSizing: 'border-box',
  display: 'grid',
  gap: '0.75rem',
  width: '100%',
  maxWidth: '42rem',
  minWidth: 0,
  margin: '1rem auto',
  padding: '1rem',
  border: '1px solid CanvasText',
  borderRadius: '0.5rem',
  background: 'Canvas',
  color: 'CanvasText',
  overflowWrap: 'anywhere',
};

const bootstrapRecoveryTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 'clamp(1.25rem, 6vw, 1.75rem)',
  lineHeight: 1.25,
  overflowWrap: 'anywhere',
};

const bootstrapRecoveryMessageStyle: CSSProperties = {
  margin: 0,
  overflowWrap: 'anywhere',
};

const bootstrapRecoveryRetryStyle: CSSProperties = {
  boxSizing: 'border-box',
  justifySelf: 'start',
  minWidth: 44,
  minHeight: 44,
  maxWidth: '100%',
  padding: '0.5rem 0.75rem',
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
};

function BootstrapRecovery({ retry }: { retry: () => void }): ReactNode {
  const retryButton = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    retryButton.current?.focus();
  }, [retry]);

  return (
    <section
      aria-atomic="true"
      aria-label="Teams 연결 복구"
      data-teams-bootstrap-recovery
      role="alert"
      style={bootstrapRecoveryStatusStyle}
    >
      <h1 style={bootstrapRecoveryTitleStyle}>Teams 연결을 확인하지 못했습니다.</h1>
      <p style={bootstrapRecoveryMessageStyle}>Teams 탭을 닫았다 다시 열거나 아래에서 다시 시도하세요.</p>
      <button
        ref={retryButton}
        autoFocus
        type="button"
        data-teams-bootstrap-retry
        onClick={retry}
        style={bootstrapRecoveryRetryStyle}
      >
        다시 시도
      </button>
    </section>
  );
}

function getDefaultDocumentLifetime(): object {
  if (typeof document !== 'undefined') return document;
  return {};
}

export function createTeamsBootstrapController(options: BootstrapOptions): TeamsBootstrapController {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TEAMS_BOOTSTRAP_TIMEOUT_MS;
  const documentLifetime = options.documentLifetime ?? getDefaultDocumentLifetime();
  let lifecycleGeneration = 0;
  let activeAttempt: Promise<BootstrapResult> | null = null;
  let initializationStarted = false;
  let initializationComplete = false;
  let initializationTimedOut = false;
  let initializationRejected = false;
  let applicationMounted = false;
  let notifyRecoveryVisible = false;
  let ready = false;
  let disposed = false;

  const isStale = (generation: number): boolean => (
    disposed || generation !== lifecycleGeneration
  );

  const start = (): Promise<BootstrapResult> => {
    if (disposed) return Promise.resolve('stale');
    if (activeAttempt) return activeAttempt;
    if (ready) return Promise.resolve('ready');
    if (initializationTimedOut) return Promise.resolve('recovery');
    if (initializationRejected) {
      return Promise.resolve(options.mode === 'preview' ? 'preview' : 'recovery');
    }

    const attemptGeneration = lifecycleGeneration;

    const attempt = (async (): Promise<BootstrapResult> => {
      if (!initializationComplete) {
        let initializationLatch: DocumentInitializationLatch | null = null;
        try {
          // Latch before invoking TeamsJS: rejection does not make initialize
          // safe to call again within the same document lifetime.
          if (initializationStarted) return 'recovery';
          initializationStarted = true;
          initializationLatch = getDocumentInitializationPromise(documentLifetime, options.initialize);
          await withBootstrapTimeout(initializationLatch.promise, timeoutMs);
        } catch (error) {
          if (isStale(attemptGeneration)) return 'stale';
          if (error instanceof TeamsBootstrapTimeoutError) {
            initializationLatch?.timeout();
            initializationTimedOut = true;
            options.renderRecovery(() => {
              if (disposed) return;
              options.recoverFromTimedOutInitialization?.();
            });
            return 'recovery';
          }

          if (options.mode === 'preview') {
            initializationRejected = true;
            options.renderApp();
            applicationMounted = true;
            return 'preview';
          }

          initializationRejected = true;
          options.renderRecovery(() => {
            if (disposed) return;
            options.recoverFromTimedOutInitialization?.();
          });
          return 'recovery';
        }
        if (isStale(attemptGeneration)) return 'stale';
        initializationComplete = true;
        options.markHostReady();
        options.setHost();
      }

      if (isStale(attemptGeneration)) return 'stale';
      if (!applicationMounted) {
        options.renderApp();
        applicationMounted = true;
      }

      if (options.mode !== 'teams') {
        ready = true;
        return 'ready';
      }

      try {
        await options.notifySuccess?.();
      } catch {
        if (isStale(attemptGeneration)) return 'stale';
        notifyRecoveryVisible = true;
        (options.renderNotifyRecovery ?? options.renderRecovery)(() => {
          void start();
        });
        return 'recovery';
      }

      if (isStale(attemptGeneration)) return 'stale';
      ready = true;
      if (notifyRecoveryVisible) {
        notifyRecoveryVisible = false;
        (options.clearNotifyRecovery ?? options.renderApp)();
      }
      return 'ready';
    })();

    let trackedAttempt!: Promise<BootstrapResult>;
    trackedAttempt = attempt.finally(() => {
      if (activeAttempt === trackedAttempt) activeAttempt = null;
    });
    activeAttempt = trackedAttempt;
    return trackedAttempt;
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    lifecycleGeneration += 1;
  };

  return { start, dispose };
}

export function mountTeamsApplication(options: MountTeamsApplicationOptions): TeamsBootstrapController {
  const reactRoot = (options.createRoot ?? createRoot)(options.root);
  const render = (children: ReactNode): void => {
    reactRoot.render(<StrictMode>{children}</StrictMode>);
  };
  const renderLoading = (): void => render(<BootstrapLoading />);
  let applicationNode: ReactNode = null;
  let applicationNodeCreated = false;
  const getApplicationNode = (): ReactNode => {
    if (!applicationNodeCreated) {
      applicationNode = options.renderApplication();
      applicationNodeCreated = true;
    }
    return applicationNode;
  };
  const renderApplicationShell = (retry?: () => void): void => {
    render(
      <>
        {getApplicationNode()}
        {retry ? <BootstrapRecovery retry={retry} /> : null}
      </>,
    );
  };
  const controller = createTeamsBootstrapController({
    mode: options.mode,
    documentLifetime: options.root.ownerDocument ?? options.root,
    initialize: () => options.teamsApp.isInitialized() ? Promise.resolve() : options.teamsApp.initialize(),
    markHostReady: options.markHostReady,
    setHost: options.setHost,
    renderLoading,
    renderRecovery: (retry) => render(<BootstrapRecovery retry={retry} />),
    renderNotifyRecovery: (retry) => renderApplicationShell(retry),
    clearNotifyRecovery: () => renderApplicationShell(),
    renderApp: () => renderApplicationShell(),
    notifySuccess: () => options.teamsApp.notifySuccess(),
    recoverFromTimedOutInitialization: options.reloadPage ?? (() => {
      if (typeof window !== 'undefined') window.location.reload();
    }),
    timeoutMs: options.timeoutMs,
  });
  renderLoading();
  let mountDisposed = false;
  return {
    start: controller.start,
    dispose: () => {
      if (mountDisposed) return;
      mountDisposed = true;
      controller.dispose();
      reactRoot.unmount();
    },
  };
}

export function isExplicitBrowserPreview(): boolean {
  if (typeof window === 'undefined') return false;
  const preview = new URLSearchParams(window.location.search).get('preview');
  return preview === '1' || preview === 'true';
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('root');
  if (!root) throw new Error('Teams app root element is missing');

  const controller = mountTeamsApplication({
    root,
    mode: isExplicitBrowserPreview() ? 'preview' : 'teams',
    teamsApp: app,
    markHostReady: markTeamsHostReady,
    setHost: () => {
      document.documentElement.dataset.host = 'teams';
    },
    renderApplication: () => <App />,
  });

  void controller.start();
}
