import { useCallback, useEffect, useRef, useState } from 'react';

import { apiFetch, setAuthRequired } from './auth.js';
import { OrchestrationPanel } from './OrchestrationPanel.js';
import { ExecutionPresentationProvider, ExecutionPresentationToolbar } from './ExecutionPresentationSettings.js';
import * as teamsSdk from '@microsoft/teams-js';
const teamsApp = teamsSdk.app;
import { parseRequestedCopilotJobId } from './job-deep-link.js';
import { assessClientRuntimeIdentity, parseClientBuildStamp, type ClientBuildIdentity, type ClientBuildStamp } from '../shared/independent-release-identity.js';

declare const __TEAMS_CLIENT_BUILD_IDENTITY__: unknown;
// This constant belongs to the loaded JS bundle. Health never supplies it.
const compiledClientStamp = parseClientBuildStamp(typeof __TEAMS_CLIENT_BUILD_IDENTITY__ === 'undefined'
  ? undefined : __TEAMS_CLIENT_BUILD_IDENTITY__);

export type HealthResponse = {
  ok: boolean;
  service: string;
  version: string;
  sourceCommit?: string;
  serverBundleSha256?: string;
  clientBuildIdentity?: ClientBuildIdentity;
  environment: string;
  auth: 'local-bypass' | 'teams-authenticated' | 'not-configured';
  userAuth: 'local-bypass' | 'entra-sso' | 'not-configured';
  bot: 'teams-sdk' | 'local-handler' | 'not-configured';
  storage?: 'file-json-single-process' | Readonly<{ backend?: string }>;
  genAI?: 'openai-configured' | 'grok-configured' | 'not-configured' | 'deterministic-test';
  timestamp: string;
  a2aExecution?: Readonly<{
    state?: 'configured' | 'ready' | 'unavailable' | 'unknown';
    reason?: string;
  }>;
};

export function healthAuthLabel(value: HealthResponse['auth'] | undefined): string {
  if (value === 'teams-authenticated') return 'Teams 인증';
  if (value === 'local-bypass') return '로컬 런타임';
  if (value === 'not-configured') return '인증 설정 필요';
  return '연결 확인 필요';
}

export function healthUserAuthLabel(value: HealthResponse['userAuth'] | undefined): string {
  if (value === 'entra-sso') return 'Entra SSO';
  if (value === 'local-bypass') return '로컬 우회';
  if (value === 'not-configured') return '인증 설정 필요';
  return '-';
}

export function healthBotLabel(value: HealthResponse['bot'] | undefined): string {
  if (value === 'teams-sdk') return 'Teams SDK';
  if (value === 'local-handler') return '로컬 핸들러';
  if (value === 'not-configured') return 'Bot 설정 필요';
  return '-';
}

export function healthStorageLabel(value: HealthResponse['storage'] | undefined): string {
  const backend = typeof value === 'object' ? value.backend : value;
  if (backend === 'file-json-single-process') {
    return '파일 JSON (단일 프로세스)';
  }
  if (backend === 'cosmos-configured') return 'Azure Cosmos DB';
  return '-';
}

export function genAiLabel(value: HealthResponse['genAI'] | undefined): string {
  if (value === 'grok-configured') return 'Grok (xAI) 선택형';
  if (value === 'openai-configured') return 'OpenAI (선택형)';
  if (value === 'deterministic-test') return '결정형 테스트';
  return '미사용 · 결정형 기본';
}

export function releaseIdentityLabel(
  value: Pick<HealthResponse, 'version' | 'sourceCommit'> | null | undefined,
): string {
  const version = value?.version?.trim();
  if (!version) return '릴리스 identity 확인 필요';
  const sourceCommit = value?.sourceCommit?.trim();
  const shortCommit = sourceCommit && /^[0-9a-f]{7,40}$/u.test(sourceCommit)
    ? sourceCommit.slice(0, 7)
    : '소스 확인 필요';
  return `${version} · ${shortCommit}`;
}

export function ClientBuildIdentityPanel({ stamp, health }: { stamp?: ClientBuildStamp; health?: unknown }) {
  const assessment = assessClientRuntimeIdentity(stamp, health);
  return <>
    <div><span>로드된 화면 빌드</span><strong data-client-build-version={stamp?.version}
      data-client-build-commit={stamp?.sourceCommit} data-client-build-mode={stamp?.mode}
      data-client-build-fingerprint={stamp?.buildFingerprint}>
      {stamp ? `${stamp.version} · ${stamp.sourceCommit.slice(0, 7)} · ${stamp.mode} · ${stamp.buildFingerprint.slice(0, 12)}` : '확인되지 않음 (컴파일 identity 없음)'}
    </strong></div>
    <div><span>화면·서버 빌드 대조</span><strong data-client-runtime-identity={assessment.status}>
      {assessment.status === 'PASS' ? '일치 (설치·About 검증은 별도)' : assessment.status === 'FAIL' ? '불일치 — 릴리스 확인 필요' : '확인되지 않음'}
    </strong></div>
  </>;
}

export function agentExecutionLabel(value: HealthResponse['a2aExecution'] | undefined): string {
  if (value?.state === 'ready' || value?.state === 'configured') return '실행 준비됨';
  if (value?.state === 'unavailable') return '실행 차단됨';
  return '확인 필요';
}

export function runtimeBadgeLabel(input: {
  healthLoading: boolean;
  auth: HealthResponse['auth'] | undefined;
  teamsHost?: boolean;
  bot?: HealthResponse['bot'];
  agentExecution?: HealthResponse['a2aExecution'];
}): string {
  if (input.healthLoading) return '상태 확인 중';
  if (input.auth !== 'teams-authenticated' || input.bot !== 'teams-sdk') return healthAuthLabel(input.auth);
  return agentExecutionLabel(input.agentExecution);
}

function healthErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return '공개 런타임 상태를 확인하지 못했습니다.';
}

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let current = true;
    const navigate = (subPageId?: unknown) => {
      if (!current) return;
      const jobId = parseRequestedCopilotJobId(window.location.search, subPageId);
      if (jobId) window.location.replace(`/tabs/copilot-ui/?jobId=${encodeURIComponent(jobId)}`);
    };
    void teamsApp.getContext().then(context => navigate(context.page.subPageId)).catch(() => navigate());
    return () => { current = false; };
  }, []);

  const loadHealth = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setHealthLoading(true);
    setHealthError('');
    try {
      const response = await apiFetch('/api/health', { signal: controller.signal });
      if (!response.ok) throw new Error(`런타임 상태 요청 실패 (${response.status})`);
      const next = await response.json() as HealthResponse;
      if (controller.signal.aborted) return;
      setHealth(next);
      setAuthRequired(next.userAuth === 'entra-sso');
    } catch (error) {
      if (controller.signal.aborted) return;
      setHealth(null);
      setAuthRequired(true);
      setHealthError(healthErrorMessage(error));
    } finally {
      if (!controller.signal.aborted) setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHealth();
    return () => request.current?.abort();
  }, [loadHealth]);

  const runtimeBadge = runtimeBadgeLabel({
    healthLoading,
    auth: health?.auth,
    bot: health?.bot,
    agentExecution: health?.a2aExecution,
  });

  return (
    <ExecutionPresentationProvider><main className="shell agent-hub-shell">
      <header className="hero agent-hub-hero">
        <div>
          <p className="eyebrow">TEAMS AGENT CORE</p>
          <h1>에이전트 허브</h1>
          <p className="subtitle">에이전트 작업을 실행하고 진행 상황과 이력을 한곳에서 확인합니다.</p>
        </div>
        <span className={health?.a2aExecution?.state === 'ready' || health?.a2aExecution?.state === 'configured' ? 'badge' : 'badge warning'}>
          {runtimeBadge}
        </span>
      </header>

      <ExecutionPresentationToolbar />
      <details className="presentation-runtime-details"><summary>실행 환경 상세</summary>
      <section className="runtime-panel agent-runtime-panel" aria-label="에이전트 런타임 상태">
        <div className="runtime-panel-heading">
          <span>실행 상태</span>
          <button
            aria-busy={healthLoading}
            aria-label="에이전트 런타임 상태 새로고침"
            className="secondary"
            disabled={healthLoading}
            onClick={() => void loadHealth()}
            type="button"
          >
            {healthLoading ? '확인 중…' : '새로고침'}
          </button>
        </div>
        <div><span>릴리스</span><strong data-release-identity>{releaseIdentityLabel(health)}</strong></div>
        <ClientBuildIdentityPanel stamp={compiledClientStamp} health={health} />
        <div><span>Bot</span><strong>{healthBotLabel(health?.bot)}</strong></div>
        <div><span>사용자 인증</span><strong>{healthUserAuthLabel(health?.userAuth)}</strong></div>
        <div><span>에이전트</span><strong>{agentExecutionLabel(health?.a2aExecution)}</strong></div>
        <div><span>마지막 확인</span><strong>{health ? new Date(health.timestamp).toLocaleTimeString('ko-KR') : '-'}</strong></div>
      </section>
      </details>

      {healthError ? <p className="error" role="alert">{healthError}</p> : null}
      {health?.a2aExecution?.state === 'unavailable' ? (
        <p className="error" role="status">
          에이전트 실행 경계가 준비되지 않았습니다. 작업 이력은 계속 조회할 수 있지만 새 실행은 차단됩니다.
        </p>
      ) : null}

      <OrchestrationPanel />
      <footer>Teams SDK · Agent execution · Durable history</footer>
    </main></ExecutionPresentationProvider>
  );
}
