import { createRoot } from 'react-dom/client';
import * as teamsSdk from '@microsoft/teams-js';
import { CopilotConversationWorkspace } from '../client/CopilotConversationWorkspace.js';
import { markTeamsHostReady, setAuthRequired } from '../client/auth.js';
import { parseRequestedJobId } from '../client/job-deep-link.js';
import '@copilotkit/react-core/v2/styles.css';
import '../client/styles.css';
import '../client/copilot-job-view.css';

type BootstrapState = { kind: 'loading' | 'ready' | 'blocked'; message?: string; retryAcknowledgement?: boolean };
type BootstrapResult = 'ready' | 'blocked' | 'stale';
type BootstrapOptions = {
  initialize: () => Promise<void>; requireAuth: () => void; markHostReady: () => void;
  notifySuccess: () => unknown; renderState: (state: BootstrapState) => void; timeoutMs?: number;
};

/** A rejected/timed-out handshake cannot silently start another Teams session. */
export function createOptionalTeamsBootstrap(options: BootstrapOptions): {
  start: () => Promise<BootstrapResult>; dispose: () => void;
} {
  let active: Promise<BootstrapResult> | undefined;
  let initialized = false;
  let initializationStarted = false;
  let initializationBlocked = false;
  let ready = false;
  let disposed = false;
  const start = (): Promise<BootstrapResult> => {
    if (disposed) return Promise.resolve('stale');
    if (ready) return Promise.resolve('ready');
    if (active) return active;
    if (initializationBlocked) return Promise.resolve('blocked');
    const attempt = async (): Promise<BootstrapResult> => {
      options.requireAuth();
      options.renderState({ kind: 'loading' });
      if (!initialized) {
        if (initializationStarted) return 'blocked';
        initializationStarted = true;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([options.initialize(), new Promise<never>((_, reject) => {
            timer = globalThis.setTimeout(() => reject(new Error('Teams initialization deadline')), options.timeoutMs ?? 65_000);
          })]);
        } catch {
          initializationBlocked = true;
          if (disposed) return 'stale';
          options.renderState({ kind: 'blocked', message: 'Teams 연결을 확인하지 못했습니다. 업무 허브 탭에서 다시 열어 주세요.' });
          return 'blocked';
        } finally {
          if (timer !== undefined) globalThis.clearTimeout(timer);
        }
        if (disposed) return 'stale';
        initialized = true;
        options.markHostReady();
      }
      if (disposed) return 'stale';
      try {
        await options.notifySuccess();
      } catch {
        if (disposed) return 'stale';
        options.renderState({ kind: 'blocked', retryAcknowledgement: true,
          message: 'Teams 연결 확인을 마치지 못했습니다. 연결 다시 확인을 눌러 주세요.' });
        return 'blocked';
      }
      if (disposed) return 'stale';
      ready = true;
      options.renderState({ kind: 'ready' });
      return 'ready';
    };
    active = attempt().finally(() => { active = undefined; });
    return active;
  };
  return { start, dispose: () => { disposed = true; } };
}

if (typeof document !== 'undefined') {
  const container = document.getElementById('root');
  if (!container) throw new Error('Teams optional UI root is missing');
  const root = createRoot(container);
  const jobId = parseRequestedJobId(window.location.search);
  const backLink = `/tabs/home/?view=core${jobId ? `&jobId=${encodeURIComponent(jobId)}` : ''}`;
  const controller = createOptionalTeamsBootstrap({
    initialize: () => teamsSdk.app.isInitialized() ? Promise.resolve() : teamsSdk.app.initialize(),
    requireAuth: () => setAuthRequired(true),
    markHostReady: () => { markTeamsHostReady(); document.documentElement.dataset.host = 'teams'; },
    notifySuccess: () => teamsSdk.app.notifySuccess(),
    renderState: state => {
      root.render(<main className="shell optional-execution-ui">
        <h1>업무 허브 · CopilotKit 대화</h1>
        {state.kind !== 'ready' ? <a href={backLink}>개인 작업으로 돌아가기</a> : null}
        {state.kind === 'loading' ? <p role="status" aria-live="polite">Teams 연결을 확인하고 있습니다.</p> : null}
        {state.kind === 'blocked' ? <section role="alert"><p>{state.message}</p>
          {state.retryAcknowledgement ? <button type="button" onClick={() => { void controller.start(); }}>연결 다시 확인</button> : null}
        </section> : null}
        {state.kind === 'ready' ? <CopilotConversationWorkspace initialJobId={jobId} /> : null}
      </main>);
    },
  });
  void controller.start();
}
