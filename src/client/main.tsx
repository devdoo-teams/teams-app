import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { app } from '@microsoft/teams-js';

import { App } from './App.js';
import { markTeamsHostReady } from './auth.js';
import './styles.css';

type BootstrapResult = 'ready' | 'preview' | 'recovery' | 'stale';
type BootstrapMode = 'teams' | 'preview';

export const DEFAULT_TEAMS_BOOTSTRAP_TIMEOUT_MS = 10_000;

type BootstrapOptions = {
  mode?: BootstrapMode;
  initialize: () => Promise<void>;
  resetInitialization?: () => void;
  markHostReady: () => void;
  setHost: () => void;
  renderApp: () => void;
  root: HTMLElement;
  timeoutMs?: number;
};

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

export function mountBootstrapLoading(root: HTMLElement): void {
  root.innerHTML = `
    <main aria-live="polite" role="status">
      <p>Teams 앱 연결을 확인하고 있습니다.</p>
      <p>잠시만 기다려 주세요.</p>
    </main>
  `;
}

export function mountBootstrapRecovery(root: HTMLElement, retry: () => void): void {
  root.innerHTML = `
    <main aria-live="polite" role="alert">
      <h1>Teams 연결을 확인하지 못했습니다.</h1>
      <p>Teams 탭을 닫았다 다시 열거나 아래에서 다시 시도하세요.</p>
      <button type="button" data-teams-bootstrap-retry>다시 시도</button>
    </main>
  `;
  root.querySelector('[data-teams-bootstrap-retry]')?.addEventListener('click', () => {
    retry();
  });
}

export function createTeamsBootstrapController(options: BootstrapOptions): { start(): Promise<BootstrapResult> } {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TEAMS_BOOTSTRAP_TIMEOUT_MS;
  let generation = 0;
  let activeAttempt: Promise<BootstrapResult> | null = null;
  let ready = false;

  const start = (): Promise<BootstrapResult> => {
    if (activeAttempt) return activeAttempt;
    if (ready) return Promise.resolve('ready');

    const attemptGeneration = generation + 1;
    generation = attemptGeneration;
    if (attemptGeneration > 1) {
      options.resetInitialization?.();
      mountBootstrapLoading(options.root);
    }
    const initialization = Promise.resolve().then(options.initialize);
    const attempt = (async (): Promise<BootstrapResult> => {
      try {
        await withBootstrapTimeout(initialization, timeoutMs);
        if (attemptGeneration !== generation) return 'stale';
        options.markHostReady();
        options.setHost();
        options.renderApp();
        ready = true;
        return 'ready';
      } catch (error) {
        if (attemptGeneration !== generation) return 'stale';
        if (error instanceof TeamsBootstrapTimeoutError) {
          mountBootstrapRecovery(options.root, () => {
            void start();
          });
          return 'recovery';
        }

        if (options.mode === 'preview') {
          options.renderApp();
          return 'preview';
        }

        mountBootstrapRecovery(options.root, () => {
          void start();
        });
        return 'recovery';
      }
    })();

    let trackedAttempt!: Promise<BootstrapResult>;
    trackedAttempt = attempt.finally(() => {
      if (activeAttempt === trackedAttempt) activeAttempt = null;
    });
    activeAttempt = trackedAttempt;
    return trackedAttempt;
  };

  return { start };
}

export function isExplicitBrowserPreview(): boolean {
  if (typeof window === 'undefined') return false;
  const preview = new URLSearchParams(window.location.search).get('preview');
  return preview === '1' || preview === 'true';
}

function renderApp(root: HTMLElement): void {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('root');
  if (!root) throw new Error('Teams app root element is missing');

  const controller = createTeamsBootstrapController({
    mode: isExplicitBrowserPreview() ? 'preview' : 'teams',
    initialize: () => app.isInitialized() ? Promise.resolve() : app.initialize(),
    resetInitialization: () => {
      if (!app.isInitialized()) app._uninitialize();
    },
    markHostReady: markTeamsHostReady,
    setHost: () => {
      document.documentElement.dataset.host = 'teams';
    },
    renderApp: () => renderApp(root),
    root,
  });

  void controller.start();
}
