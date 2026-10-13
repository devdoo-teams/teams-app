import * as teamsSdk from '@microsoft/teams-js';
const teamsApp = teamsSdk.app;
import { parseRequestedJobId, loadRequestedJob, includeRequestedJob } from './job-deep-link.js';
import { CORE_AGENT_PROMPT_MAX_LENGTH, CORE_JOB_STATUS_LABELS } from '../shared/core-orchestration.js';
import { TEAMS_CLI_AGENT_POLICY } from '../shared/teams-cli-agent-policy.js';
import type { VisibleJobConversation } from '../shared/job-conversation.js';
import { ExecutionPresentationPanel } from './ExecutionPresentationPanel.js';
import { CoreResultReview } from './CoreResultReview.js';
import { isConversationHistoryAccessFailure, loadJobConversation, refreshVisibleJobConversation } from './job-conversation.js';
import { isApiAuthError } from './auth.js';
import { createLatestDetailRequestController } from './latest-detail-request.js';
import { projectReceiptFacts } from '../shared/receipt-presentation.js';
export { createLatestDetailRequestController } from './latest-detail-request.js';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  addWorkHubProject,
  assignJobToProject,
  readWorkHubPreferences,
  summarizeWorkHubPrompt,
  togglePinnedJob,
  workHubNavigationJobIds,
  workHubStorageKey,
  writeWorkHubPreferences,
  type WorkHubNavigationSection,
  type WorkHubPreferences,
} from './work-hub-navigation.js';

import {
  CoreOrchestrationClientError,
  createCoreOrchestrationClient,
  isCoreApprovalIdentity,
  type CoreApprovalIdentity,
  type CoreOrchestrationClient,
} from './core-orchestration-client.js';
import type {
  CoreCodexModelCatalog,
  CoreCodexReasoningEffort,
  CoreOrchestrationJob,
  CoreOrchestrationMode,
  CoreOrchestrationProvider,
  CoreProviderFact,
  CoreOrchestrationJobStatus,
} from '../shared/core-orchestration.js';

type PanelPhase = 'loading' | 'ready' | 'error';

type PanelNotice = Readonly<{ kind: 'refresh-error' | 'mutation'; message: string }> | null;
export type OrchestrationConfirmation = Readonly<{
  kind: 'approve' | 'deny' | 'cancel'; jobId: string; approvalIdentity?: CoreApprovalIdentity;
}>;

/** The server-issued pending operation and durable record must still match.
 * Owner/tenant authorization remains the Core API's responsibility. */
export function getOrchestrationApprovalIdentity(job: CoreOrchestrationJob | null, now = Date.now()): CoreApprovalIdentity | undefined {
  const pending = job?.pendingOperation;
  const approval = job?.approval;
  if (!job || job.status !== 'awaiting_approval' || job.mode !== 'workspace-write'
    || !pending || pending.kind !== 'job-approval' || pending.jobId !== job.id
    || !approval || approval.schemaVersion !== '1' || approval.state !== 'pending' || approval.settledStatus
    || !approval.approverId?.trim() || pending.approverId !== approval.approverId || pending.deadline !== approval.deadline
    || !Number.isFinite(now) || !Number.isFinite(Date.parse(approval.deadline)) || Date.parse(approval.deadline) <= now
    || pending.approvalId !== approval.approvalId || pending.revision !== approval.revision) return undefined;
  const identity = { approvalId: pending.approvalId, revision: pending.revision };
  return isCoreApprovalIdentity(identity) ? identity : undefined;
}

function sameApprovalIdentity(first?: CoreApprovalIdentity, second?: CoreApprovalIdentity): boolean {
  return Boolean(first && second && first.approvalId === second.approvalId && first.revision === second.revision);
}

export function decideSelectedOrchestrationApproval(client: CoreOrchestrationClient, job: CoreOrchestrationJob | null,
  confirmation: OrchestrationConfirmation | null, decision: 'accept' | 'deny', now = Date.now(), signal?: AbortSignal) {
  const identity = getOrchestrationApprovalIdentity(job, now);
  if (!client.decideApproval || !job || !identity || !confirmation || confirmation.jobId !== job.id
    || confirmation.kind !== (decision === 'accept' ? 'approve' : 'deny')
    || !sameApprovalIdentity(identity, confirmation.approvalIdentity)) {
    return Promise.reject(new CoreOrchestrationClientError('실행 가능한 승인 정보가 변경되었거나 만료되었습니다. 새로고침하고 다시 검토하세요.', {
      code: 'ApprovalIdentityRequired', status: 409, retryable: false,
    }));
  }
  return client.decideApproval(job.id, identity, decision, signal);
}

function approvalUnavailableMessage(job: CoreOrchestrationJob, supported: boolean): string {
  if (!supported) return '현재 클라이언트는 승인 결정을 지원하지 않습니다. 새로고침하고 최신 앱을 확인하세요.';
  if (job.approval?.state === 'expired' || (job.approval?.deadline && Date.parse(job.approval.deadline) <= Date.now())) {
    return '승인 기한이 지났습니다. 새로고침해 최신 상태를 확인하세요.';
  }
  if (job.approval && job.approval.state !== 'pending') return '이 승인은 이미 처리되었습니다. 새로고침해 최신 상태를 확인하세요.';
  return '실행 가능한 승인 정보가 없습니다. 새로고침해 승인 ID와 기한을 확인하세요.';
}

function ApprovalDetails({ job }: { job: CoreOrchestrationJob }) {
  if (!job.approval && !job.pendingOperation) return null;
  const approval = job.approval;
  const deadline = approval?.deadline ?? job.pendingOperation?.deadline;
  const expired = Boolean(deadline && Number.isFinite(Date.parse(deadline)) && Date.parse(deadline) <= Date.now());
  const state = approval ? ({ pending: expired ? '기한 만료' : '승인 대기', accepted: '승인됨', denied: '거절됨', expired: '기한 만료' })[approval.state]
    : '실행 불가 · 이전 형식';
  return <dl aria-label="승인 정보">
    <dt>승인자:</dt><dd>{approval?.approverId ?? job.pendingOperation?.approverId ?? '확인되지 않음'}</dd>
    <dt>승인 기한:</dt><dd>{deadline && Number.isFinite(Date.parse(deadline))
      ? <time dateTime={deadline}>{new Date(deadline).toLocaleString('ko-KR', { timeZoneName: 'short' })}</time> : '확인되지 않음'}</dd>
    <dt>승인 상태:</dt><dd>{state}</dd>
  </dl>;
}

export function settleOrchestrationRefreshNotice(
  current: PanelNotice,
  outcome: Readonly<{ status: 'succeeded' | 'aborted' }> | Readonly<{ status: 'failed'; message: string }>,
): PanelNotice {
  if (outcome.status === 'aborted') return current;
  if (outcome.status === 'failed') return { kind: 'refresh-error', message: `자동 업데이트 실패: ${outcome.message}` };
  return current?.kind === 'refresh-error' ? null : current;
}

const DEFAULT_CLIENT = createCoreOrchestrationClient();
const ORCHESTRATION_POLL_INTERVAL_MS = 3_000;
const statusLabels = CORE_JOB_STATUS_LABELS;


function nextIdempotencyKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

type SubmissionIdentity = Readonly<{
  prompt: string;
  provider: CoreOrchestrationProvider;
  mode: CoreOrchestrationMode;
  model?: string;
  reasoningEffort?: CoreCodexReasoningEffort;
  catalogRevision?: string;
  notify?: boolean;
}>;

function submissionFingerprint(input: SubmissionIdentity): string {
  return JSON.stringify({
    prompt: input.prompt.trim(),
    provider: input.provider,
    mode: input.mode,
    ...(input.notify !== undefined ? { notify: input.notify } : {}),
    ...(input.model ? {
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      catalogRevision: input.catalogRevision,
    } : {}),
  });
}

export type SubmissionIdempotencyController = {
  keyFor: (input: SubmissionIdentity) => string;
  complete: (input: SubmissionIdentity, key: string) => void;
};

export function createSubmissionIdempotencyController(
  issueKey: () => string = () => nextIdempotencyKey('teams-tab-submit'),
): SubmissionIdempotencyController {
  let active: { fingerprint: string; key: string } | undefined;
  return {
    keyFor(input) {
      const fingerprint = submissionFingerprint(input);
      if (!active || active.fingerprint !== fingerprint) active = { fingerprint, key: issueKey() };
      return active.key;
    },
    complete(input, key) {
      if (active?.fingerprint === submissionFingerprint(input) && active.key === key) active = undefined;
    },
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof CoreOrchestrationClientError || error instanceof Error) return error.message;
  return '오케스트레이션 요청을 처리하지 못했습니다.';
}

function isAvailable(provider: CoreProviderFact | undefined): boolean {
  return provider?.availability === 'available';
}

function supports(provider: CoreProviderFact | undefined, capability: string): boolean {
  return isAvailable(provider) && provider!.capabilities.includes(capability);
}

function providerReadinessText(provider: CoreProviderFact): string {
  const readiness = provider.readiness;
  if (!readiness) return '';
  return ` · 설정 ${readiness.configured} · 실행파일 ${readiness.executable} · 인증 ${readiness.authentication} · 권한 ${readiness.entitlement} · probe ${readiness.probe}`;
}

export function validateOrchestrationSubmission(
  prompt: string,
  providerId: string,
  providers: readonly CoreProviderFact[],
  modelId = '',
  reasoningEffort = '',
  modelCatalog?: CoreCodexModelCatalog,
): string {
  if (!prompt.trim()) return '작업 내용을 입력하세요.';
  if (prompt.trim().length > CORE_AGENT_PROMPT_MAX_LENGTH) {
    return `작업 내용은 ${CORE_AGENT_PROMPT_MAX_LENGTH.toLocaleString('ko-KR')}자 이내로 입력하세요.`;
  }
  if (!providerId.trim()) return '실행 제공자를 선택하세요.';
  const provider = providers.find((candidate) => candidate.provider === providerId);
  if (!provider) return '등록되지 않은 제공자입니다.';
  if (!isAvailable(provider) || !provider.capabilities.includes('submit')) {
    return '현재 사용할 수 없는 제공자입니다.';
  }
  if (providerId !== 'codex' && providerId !== 'copilot') return '등록되지 않은 제공자입니다.';
  if (providerId !== 'codex') return '이 제공자의 고정 모델 지원이 확인되지 않아 실행을 차단합니다.';
  if (!modelCatalog) return '고정 모델 gpt-6-luna · xhigh의 지원을 확인할 수 없습니다.';
  if (modelId !== TEAMS_CLI_AGENT_POLICY.model || reasoningEffort !== TEAMS_CLI_AGENT_POLICY.reasoningEffort) {
    return 'Teams 에이전트는 gpt-6-luna · xhigh로 고정되어 있습니다.';
  }
  if (providerId === 'codex' && modelCatalog) {
    const model = modelCatalog.models.find((candidate) => candidate.id === modelId);
    if (!model) return 'Codex 모델을 선택하세요.';
    if (!model.reasoningEfforts.includes(reasoningEffort as CoreCodexReasoningEffort)) {
      return '선택한 모델이 해당 추론 수준을 지원하지 않습니다.';
    }
  }
  return '';
}

export type OrchestrationBusyController = {
  isBusy: (slot: string) => boolean;
  run: <T>(slot: string, operation: () => Promise<T>) => Promise<T | undefined>;
};

export function createOrchestrationBusyController(): OrchestrationBusyController {
  const pending = new Set<string>();
  return {
    isBusy: (slot) => pending.has(slot),
    async run(slot, operation) {
      if (pending.has(slot)) return undefined;
      pending.add(slot);
      try {
        return await operation();
      } finally {
        pending.delete(slot);
      }
    },
  };
}

export type OrchestrationPollingController = {
  start: () => void;
  stop: () => void;
};

export function createOrchestrationPollingController<TTimer = ReturnType<typeof setTimeout>>(options: {
  intervalMs?: number;
  refresh: () => Promise<void>;
  schedule?: (callback: () => Promise<void> | void, delay: number) => TTimer;
  cancel?: (timer: TTimer) => void;
}): OrchestrationPollingController {
  const intervalMs = options.intervalMs ?? ORCHESTRATION_POLL_INTERVAL_MS;
  const schedule = options.schedule
    ?? ((callback, delay) => globalThis.setTimeout(() => void callback(), delay) as TTimer);
  const cancel = options.cancel
    ?? ((timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>));
  let active = false;
  let timer: TTimer | undefined;

  const scheduleNext = (): void => {
    if (!active || timer !== undefined) return;
    timer = schedule(async () => {
      timer = undefined;
      if (!active) return;
      try {
        await options.refresh();
      } finally {
        scheduleNext();
      }
    }, intervalMs);
  };

  return {
    start() {
      if (active) return;
      active = true;
      scheduleNext();
    },
    stop() {
      active = false;
      if (timer === undefined) return;
      cancel(timer);
      timer = undefined;
    },
  };
}

export type OrchestrationPanelViewProps = {
  phase: PanelPhase;
  jobs: readonly CoreOrchestrationJob[];
  pendingJobs?: readonly CoreOrchestrationJob[] | null;
  pendingHasMore?: boolean;
  providers: readonly CoreProviderFact[];
  selectedJob: CoreOrchestrationJob | null;
  conversation?: VisibleJobConversation;
  notifyPersonal?: boolean;
  onNotifyPersonalChange?: (value: boolean) => void;
  prompt: string;
  providerId: string;
  mode: CoreOrchestrationMode;
  modelCatalog?: CoreCodexModelCatalog;
  modelId: string;
  reasoningEffort: CoreCodexReasoningEffort | '';
  inputValue: string;
  busyAction: string;
  error: string;
  notice: string;
  validationError: string;
  lastUpdatedAt?: string;
  mobile: boolean;
  listHasMore?: boolean;
  listLoadingMore?: boolean;
  listSearchDraft?: string;
  listStatus?: CoreOrchestrationJobStatus | 'all';
  listNavigation?: WorkHubNavigationSection;
  selectedProject?: string;
  listIsFiltered?: boolean;
  navigationPreferences?: WorkHubPreferences;
  navigationStorageAvailable?: boolean;
  navigationDrawerOpen?: boolean;
  projectDraft?: string;
  onListSearchDraftChange?: (value: string) => void;
  onListSearchSubmit?: () => void;
  onListStatusChange?: (value: CoreOrchestrationJobStatus | 'all') => void;
  onListNavigate?: (section: WorkHubNavigationSection, projectName?: string) => void;
  onTogglePin?: (jobId: string) => void;
  onCreateProject?: (name: string) => void;
  onAssignProject?: (jobId: string, projectName: string) => void;
  onNavigationDrawerOpenChange?: (open: boolean) => void;
  onProjectDraftChange?: (value: string) => void;
  onLoadMore?: () => void | Promise<void>;
  pendingConfirmation?: OrchestrationConfirmation | null;
  approvalDecisionSupported?: boolean;
  onPromptChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onModeChange: (value: CoreOrchestrationMode) => void;
  onModelChange: (value: string) => void;
  onReasoningEffortChange: (value: CoreCodexReasoningEffort) => void;
  onInputChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onSelectTask: (jobId: string) => void | Promise<void>;
  onCancel: (jobId: string) => void | Promise<void>;
  onApprove: (jobId: string) => void | Promise<void>;
  onDeny?: (jobId: string) => void | Promise<void>;
  onRequestConfirmation?: (kind: OrchestrationConfirmation['kind'], jobId: string) => void;
  onDismissConfirmation?: () => void;
  onProvideInput: (jobId: string) => void | Promise<void>;
  onRetryTask: (jobId: string) => void | Promise<void>;
  onReload: () => void | Promise<void>;
};

function actionLabel(idle: string, busy: string, active: boolean): string {
  return active ? busy : idle;
}

function UsageCostDisclosure({ job }: { job: CoreOrchestrationJob }) {
  const usageLabels = new Set(['사용량 출처', '사용 토큰', '입력 토큰', '캐시 입력', '캐시 쓰기', '출력 토큰', '추론 출력', '토큰 계산 참고', '비용 추정', '계정 잔여량']);
  const usageFacts = projectReceiptFacts(job).filter(fact => usageLabels.has(fact.label));
  return <details aria-label="사용량 및 비용" className="work-hub-usage-disclosure">
    <summary>사용량·비용</summary>
    {usageFacts.length ? <dl>{usageFacts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
      : <p>Core 사용량 관측이 제공되지 않았습니다.</p>}
  </details>;
}

export function orchestrationMutationNotice(
  result: { replayed?: boolean; status?: string; reason?: string },
  successMessage: string,
): string {
  if (result.status === 'unsupported') {
    if (result.reason === 'agent-service-does-not-support-input'
      || result.reason === 'provider-input-unsupported') {
      return '현재 제공자는 탭에서 추가 입력 재개를 지원하지 않습니다.';
    }
    if (result.reason === 'job-not-awaiting-input') {
      return '작업이 더 이상 추가 입력을 기다리지 않습니다. 최신 상태를 확인하세요.';
    }
    return '추가 입력을 처리하지 못했습니다. 최신 상태를 확인하세요.';
  }
  if (result.replayed) return '같은 요청의 기존 작업을 표시합니다.';
  return successMessage;
}

export function OrchestrationPanelView(props: OrchestrationPanelViewProps) {
  const drawerOpen = props.navigationDrawerOpen ?? true;
  const selectedProvider = props.providers.find((provider) => provider.provider === props.selectedJob?.provider);
  const selectedModel = props.modelCatalog?.models.find((model) => model.id === props.modelId);
  const navigationPreferences = props.navigationPreferences ?? { pinnedJobIds: [], projectNames: [], projectByJobId: {} };
  const currentSection = props.listNavigation ?? 'recent';
  const submitBusy = props.busyAction === 'submit';
  const selectedBusy = props.selectedJob ? props.busyAction.endsWith(`:${props.selectedJob.id}`) : false;
  const canCancel = props.selectedJob
    && ['queued', 'awaiting_approval', 'input_required', 'running'].includes(props.selectedJob.status)
    && supports(selectedProvider, 'cancel');
  const pendingConfirmation = props.selectedJob && props.pendingConfirmation?.jobId === props.selectedJob.id
    ? props.pendingConfirmation
    : null;
  const approvalIdentity = getOrchestrationApprovalIdentity(props.selectedJob);
  const approvalSupported = props.approvalDecisionSupported === true;
  const canDecideApproval = Boolean(approvalSupported && approvalIdentity);
  const canApprove = canDecideApproval && supports(selectedProvider, 'approve');
  const decisionConfirmation = pendingConfirmation && ['approve', 'deny'].includes(pendingConfirmation.kind) ? pendingConfirmation : null;
  const confirmedIdentity = !decisionConfirmation || sameApprovalIdentity(approvalIdentity, decisionConfirmation.approvalIdentity);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void props.onSubmit();
  };
  const sendInput = (event: FormEvent) => {
    event.preventDefault();
    if (props.selectedJob) void props.onProvideInput(props.selectedJob.id);
  };
  const selectTask = (jobId: string) => {
    if (props.selectedJob?.id === jobId) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 760px)').matches) {
      props.onNavigationDrawerOpenChange?.(false);
    }
    void props.onSelectTask(jobId);
  };
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    props.onListSearchSubmit?.();
  };
  const createProject = (event: FormEvent) => {
    event.preventDefault();
    const name = props.projectDraft?.trim() ?? '';
    if (!name) return;
    props.onCreateProject?.(name);
  };

  return (
    <section aria-labelledby="orchestration-heading" className="panel orchestration-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">TEAMS CORE</p>
          <h2 id="orchestration-heading">작업 현황</h2>
          <p className="panel-description">
            자동 새로고침 3초
            {props.lastUpdatedAt ? ` · 마지막 업데이트 ${new Date(props.lastUpdatedAt).toLocaleTimeString('ko-KR')}` : ''}
          </p>
        </div>
        <button className="secondary" disabled={props.phase === 'loading'} onClick={() => void props.onReload()} type="button">
          새로고침
        </button>
      </div>

      {props.mobile ? (
        <aside aria-label="모바일 대체 안내" className="panel-description" role="note">
          모바일에서 작업 제어가 원활하지 않으면 Teams 데스크톱 또는 웹 탭에서 계속하세요.
        </aside>
      ) : null}

      {props.phase === 'ready' ? <section aria-label="업무 허브 작업 목록" className="work-hub-workspace">
        <div className="work-hub-heading">
          <div><h3>내 작업</h3><p className="panel-description">최근 작업을 찾고, 선택한 작업의 진행과 사용량을 확인하세요.</p></div>
          <button aria-controls="work-hub-master-pane" aria-expanded={drawerOpen} aria-label="작업 목록 열기 또는 닫기"
            className="secondary" onClick={() => props.onNavigationDrawerOpenChange?.(!drawerOpen)} type="button">
            {drawerOpen ? '목록 닫기' : '목록 열기'}
          </button>
        </div>
        <div className={`work-hub-layout${drawerOpen ? '' : ' navigation-collapsed'}`}>
          <div aria-label="업무 허브 작업 목록" className="work-hub-master-pane" hidden={!drawerOpen} id="work-hub-master-pane">
          {drawerOpen ? <aside aria-label="업무 허브 탐색" className="work-hub-navigation">
            <button aria-pressed={currentSection === 'recent'} className="work-hub-nav-item"
              onClick={() => props.onListNavigate?.('recent')} type="button">최근 작업</button>
            <button aria-pressed={currentSection === 'pinned'} className="work-hub-nav-item"
              onClick={() => props.onListNavigate?.('pinned')} type="button">고정한 작업 <span>{navigationPreferences.pinnedJobIds.length}</span></button>
            <div className="work-hub-projects">
              <h4>프로젝트</h4>
              {navigationPreferences.projectNames.map(name => <button aria-pressed={currentSection === 'project' && props.selectedProject === name}
                className="work-hub-nav-item" key={name} onClick={() => props.onListNavigate?.('project', name)} type="button">{name}</button>)}
              <p className="panel-description">프로젝트 배정은 이 기기에 저장되며 최대 50개 작업까지 유지됩니다.</p>
            </div>
            <form className="work-hub-project-form" onSubmit={createProject}>
              <label htmlFor="work-hub-project-name">새 프로젝트</label>
              <input id="work-hub-project-name" maxLength={64} onChange={event => props.onProjectDraftChange?.(event.currentTarget.value)}
                placeholder="프로젝트 이름" value={props.projectDraft ?? ''} />
              <button className="secondary" disabled={!(props.projectDraft ?? '').trim()} type="submit">프로젝트 추가</button>
            </form>
            {!props.navigationStorageAvailable ? <p className="panel-description" role="note">Teams 계정 식별 정보를 사용할 수 없어 고정·프로젝트 설정은 이 탭에서만 유지됩니다.</p> : null}
          </aside> : null}
          <div className="work-hub-results">
            <form aria-label="작업 검색" className="work-hub-search" onSubmit={submitSearch}>
              <label className="work-hub-search-input"><span className="sr-only">작업 검색</span>
                <input maxLength={200} onChange={event => props.onListSearchDraftChange?.(event.currentTarget.value)}
                  placeholder="작업 검색" value={props.listSearchDraft ?? ''} />
              </label>
              <div aria-label="상태별 작업 필터" className="work-hub-status-chips" role="group">
                {([
                  ['all', '전체'], ['running', '실행 중'], ['completed', '완료'], ['failed', '오류'],
                ] as const).map(([status, label]) => (
                  <button aria-pressed={(props.listStatus ?? 'all') === status} className="work-hub-status-chip"
                    key={status} onClick={() => props.onListStatusChange?.(status)} type="button">{label}</button>
                ))}
                <label className="work-hub-extra-status">추가 상태
                  <select aria-label="추가 상태 필터" onChange={event => {
                    const value = event.currentTarget.value;
                    props.onListStatusChange?.(value ? value as CoreOrchestrationJobStatus : 'all');
                  }} value={['queued', 'awaiting_approval', 'input_required', 'cancelled'].includes(props.listStatus ?? '') ? props.listStatus : ''}>
                    <option value="">선택</option>
                    {(['queued', 'awaiting_approval', 'input_required', 'cancelled'] as const).map(status =>
                      <option key={status} value={status}>{statusLabels[status]}</option>)}
                  </select>
                </label>
              </div>
              <button className="primary" type="submit">검색</button>
            </form>
            <div aria-label="오케스트레이션 작업 목록" className="work-item-list" role="list">
              {props.jobs.map(job => {
                const summary = summarizeWorkHubPrompt(job.prompt);
                const pinned = navigationPreferences.pinnedJobIds.includes(job.id);
                return <article className={`work-item-card${props.selectedJob?.id === job.id ? ' selected' : ''}`} key={job.id} role="listitem">
                  <div className="work-item-card-heading">
                    <button aria-pressed={props.selectedJob?.id === job.id} className="work-item-title"
                      onClick={() => selectTask(job.id)} type="button">{summary.title}</button>
                    <span className="badge" data-job-status={job.status}>{statusLabels[job.status]}</span>
                  </div>
                  {summary.preview ? <p className="work-item-preview">{summary.preview}</p> : null}
                  <p className="work-item-meta">작업 ID: {job.id} · 제공자: {job.provider ?? 'codex'} · 모드: {job.mode}</p>
                  <div className="work-item-actions">
                    <button aria-label={pinned ? '고정 해제' : '작업 고정'} aria-pressed={pinned} className="secondary"
                      onClick={() => props.onTogglePin?.(job.id)} type="button">{pinned ? '고정됨' : '고정'}</button>
                    {navigationPreferences.projectNames.length > 0 ? <label className="work-item-project-assignment">프로젝트
                      <select aria-label={`${summary.title} 프로젝트`} value={navigationPreferences.projectByJobId[job.id] ?? ''}
                        onChange={event => props.onAssignProject?.(job.id, event.currentTarget.value)}>
                        <option value="">지정 안 함</option>
                        {navigationPreferences.projectNames.map(name => <option key={name} value={name}>{name}</option>)}
                      </select>
                    </label> : null}
                  </div>
                </article>;
              })}
              {props.jobs.length === 0 ? <p aria-live="polite" className="empty" role="status">
                {props.listIsFiltered || currentSection !== 'recent' ? '조건에 맞는 작업이 없습니다.' : '아직 실행한 작업이 없습니다.'}
              </p> : null}
            </div>
            {props.listHasMore ? <button className="secondary work-hub-load-more" disabled={props.listLoadingMore}
              onClick={() => void props.onLoadMore?.()} type="button">{props.listLoadingMore ? '불러오는 중…' : '다음 작업 불러오기'}</button> : null}
          </div>
          </div>
          <aside aria-label="선택한 작업 상세" className="work-hub-detail-pane">
            {props.selectedJob ? <>
              <UsageCostDisclosure job={props.selectedJob} />
      <label className="presentation-job-selector">표시할 개인 작업
        <select aria-label="표시할 개인 작업" disabled={selectedBusy} value={props.selectedJob?.id ?? ''}
          onChange={event => { if (event.currentTarget.value) selectTask(event.currentTarget.value); }}>
          <option value="">기존 작업을 선택하세요.</option>
          {includeRequestedJob(props.jobs, props.selectedJob ?? undefined).map(job => <option value={job.id} key={job.id}>{job.id} · {statusLabels[job.status]}</option>)}
        </select>
      </label>

      {props.selectedJob ? (
        <article aria-labelledby="orchestration-detail-heading" className="work-item-detail" id="orchestration-job-detail" tabIndex={-1}>
          <h3 id="orchestration-detail-heading">선택한 대화</h3>
          <ExecutionPresentationPanel job={props.selectedJob} conversation={props.conversation} />
          <CoreResultReview key={props.selectedJob.id} job={props.selectedJob} />
          {props.selectedJob.pendingOperation ? <p>승인 대상: {props.selectedJob.pendingOperation.jobId} · revision: {props.selectedJob.pendingOperation.revision}</p> : null}
          <ApprovalDetails job={props.selectedJob} />
          <p><strong>상태:</strong> {statusLabels[props.selectedJob.status]}</p>
          <p><strong>작업 ID:</strong> {props.selectedJob.id}</p>
          {props.selectedJob.notificationDelivery ? <p aria-label="개인 채팅 알림 상태">
            <strong>개인 채팅 알림:</strong> {({
              'waiting-personal-chat': '개인 채팅 연결 대기 — 업무 허브 개인 채팅에서 메시지를 보내세요.',
              pending: '전송 대기', sending: '전송 확인 중', accepted: 'Teams가 전송을 수락함 — 실제 수신 여부는 채팅에서 확인하세요.',
              rejected: 'Teams가 전송을 거부함 — 앱 설치·차단 상태를 확인하세요.', ambiguous: '전송 결과 미확인 — 중복 방지를 위해 자동 재전송하지 않습니다.',
            })[props.selectedJob.notificationDelivery.state]}
          </p> : null}

          {props.selectedJob.status === 'awaiting_approval' ? (
            <div>
              <p>이 작업을 계속하려면 승인이 필요합니다.</p>
              {!approvalSupported || !approvalIdentity ? <p role="note">{approvalUnavailableMessage(props.selectedJob, approvalSupported)}</p> : null}
              {canDecideApproval && !canApprove ? <p role="note">현재 제공자로 작업을 승인해 실행할 수 없습니다. 실행을 거절하거나 최신 상태를 확인하세요.</p> : null}
              {!confirmedIdentity ? <p role="note">승인 정보가 변경되었습니다. 돌아간 뒤 다시 검토하고 승인하거나 거절하세요.</p> : null}
              {decisionConfirmation ? (
                <div aria-label="작업 승인 확인" className="delete-confirmation" role="group">
                  <span>{decisionConfirmation.kind === 'approve' ? '실행하기 전에 승인 여부를 다시 확인합니다.' : '이 작업의 실행을 거절할까요?'}</span>
                  <button
                    className="primary"
                    disabled={selectedBusy || props.phase !== 'ready' || !canDecideApproval || !confirmedIdentity
                      || (decisionConfirmation.kind === 'approve' && !canApprove)
                      || (decisionConfirmation.kind === 'deny' && !props.onDeny)}
                    onClick={() => { if (decisionConfirmation.kind === 'approve') void props.onApprove(props.selectedJob!.id);
                      else void props.onDeny?.(props.selectedJob!.id); }}
                    type="button"
                  >
                    {actionLabel(decisionConfirmation.kind === 'approve' ? '승인 확인' : '거절 확인',
                      decisionConfirmation.kind === 'approve' ? '승인 중…' : '거절 중…', props.busyAction === `approval:${props.selectedJob.id}`)}
                  </button>
                  <button className="secondary" disabled={selectedBusy} onClick={() => props.onDismissConfirmation?.()} type="button">
                    돌아가기
                  </button>
                </div>
              ) : (
                <><button
                  className="primary"
                  disabled={selectedBusy || props.phase !== 'ready' || !canApprove}
                  onClick={() => props.onRequestConfirmation?.('approve', props.selectedJob!.id)}
                  type="button"
                >
                  승인
                </button>
                <button className="secondary" disabled={selectedBusy || props.phase !== 'ready' || !canDecideApproval || !props.onDeny}
                  onClick={() => props.onRequestConfirmation?.('deny', props.selectedJob!.id)} type="button">거절</button></>
              )}
            </div>
          ) : null}

          {props.selectedJob.status === 'input_required' ? (
            <form onSubmit={sendInput}>
              <label>
                추가 입력이 필요합니다.
                <textarea
                  aria-label="추가 입력"
                  disabled={selectedBusy || !supports(selectedProvider, 'input')}
                  onChange={(event) => props.onInputChange(event.currentTarget.value)}
                  required
                  value={props.inputValue}
                />
              </label>
              <button className="primary" disabled={selectedBusy || !supports(selectedProvider, 'input')} type="submit">
                {actionLabel('입력 보내기', '전송 중…', props.busyAction === `input:${props.selectedJob.id}`)}
              </button>
              {!supports(selectedProvider, 'input') ? (
                <p className="panel-description">이 제공자는 탭에서 추가 입력 재개를 지원하지 않습니다.</p>
              ) : null}
            </form>
          ) : null}

          <div className="work-item-actions">
            {canCancel ? (
              pendingConfirmation?.kind === 'cancel' ? (
                <div aria-label="작업 취소 확인" className="delete-confirmation" role="group">
                  <span>작업 취소 요청을 보내기 전에 다시 확인합니다.</span>
                  <button
                    className="secondary"
                    disabled={selectedBusy}
                    onClick={() => void props.onCancel(props.selectedJob!.id)}
                    type="button"
                  >
                    {actionLabel('취소 확인', '취소 중…', props.busyAction === `cancel:${props.selectedJob.id}`)}
                  </button>
                  <button className="secondary" disabled={selectedBusy} onClick={() => props.onDismissConfirmation?.()} type="button">
                    돌아가기
                  </button>
                </div>
              ) : (
                <button
                  className="secondary"
                  disabled={selectedBusy}
                  onClick={() => props.onRequestConfirmation?.('cancel', props.selectedJob!.id)}
                  type="button"
                >
                  작업 취소
                </button>
              )
            ) : null}
            {props.selectedJob.status === 'failed' && supports(selectedProvider, 'retry') ? (
              <button
                className="secondary"
                disabled={selectedBusy}
                onClick={() => void props.onRetryTask(props.selectedJob!.id)}
                type="button"
              >
                {actionLabel('작업 다시 시도', '재시도 중…', props.busyAction === `retry:${props.selectedJob.id}`)}
              </button>
            ) : null}
          </div>
        </article>
      ) : null}
            </> : <p className="work-hub-empty-detail" role="status">작업을 선택하면 진행 상황과 상세 정보가 여기에 표시됩니다.</p>}
          </aside>
        </div>
      </section> : null}

      <details className="work-hub-execution-details">
      <summary>새 작업 실행</summary>
      <form className="work-item-detail" onSubmit={submit}>
        <label>
          실행 제공자
          <select
            aria-label="실행 제공자"
            disabled={props.phase === 'loading' || submitBusy}
            onChange={(event) => props.onProviderChange(event.currentTarget.value)}
            value={props.providerId}
          >
            <option value="">제공자 선택</option>
            {props.providers.map((provider) => (
              <option
                disabled={!isAvailable(provider) || !provider.capabilities.includes('submit')}
                key={provider.provider}
                value={provider.provider}
              >
                {provider.provider}{isAvailable(provider) ? '' : ' (사용 불가)'}
              </option>
            ))}
          </select>
        </label>
        {props.providers.filter((provider) => !isAvailable(provider)).map((provider) => (
          <p className="panel-description" key={provider.provider}>
            {provider.provider}: {provider.availability === 'unknown' ? '가용성 확인 필요' : '현재 사용할 수 없음'}{providerReadinessText(provider)}
          </p>
        ))}
        {props.providerId === 'codex' ? props.modelCatalog ? (
          <>
            <label>
              Codex 모델
              <select
                aria-label="Codex 모델"
                disabled
                onChange={(event) => props.onModelChange(event.currentTarget.value)}
                value={props.modelId}
              >
                {props.modelCatalog.models.map((model) => (
                  <option key={model.id} value={model.id}>{model.label}</option>
                ))}
              </select>
            </label>
            <label>
              추론 수준
              <select
                aria-label="추론 수준"
                disabled
                onChange={(event) => props.onReasoningEffortChange(
                  event.currentTarget.value as CoreCodexReasoningEffort,
                )}
                value={props.reasoningEffort}
              >
                {(selectedModel?.reasoningEfforts ?? []).map((effort) => (
                  <option key={effort} value={effort}>{effort}</option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <p className="panel-description">고정 모델 gpt-6-luna · xhigh의 지원을 확인할 수 없어 새 실행을 차단합니다.</p>
        ) : null}
        <label>
          실행 모드
          <select
            aria-label="실행 모드"
            disabled={props.phase === 'loading' || submitBusy}
            onChange={(event) => props.onModeChange(event.currentTarget.value as CoreOrchestrationMode)}
            value={props.mode}
          >
            <option value="read-only">읽기 전용</option>
            <option value="workspace-write">작업공간 변경 (승인 필요)</option>
          </select>
        </label>
        <label>
          작업 내용
          <textarea
            aria-label="작업 내용"
            aria-describedby="agent-prompt-limit"
            disabled={props.phase === 'loading' || submitBusy}
            onChange={(event) => props.onPromptChange(event.currentTarget.value)}
            value={props.prompt}
          />
        </label>
        <p className="panel-description" id="agent-prompt-limit">
          작업 내용은 최대 {CORE_AGENT_PROMPT_MAX_LENGTH.toLocaleString('ko-KR')}자까지 입력할 수 있습니다.
        </p>
        <button className="primary" disabled={props.phase === 'loading' || submitBusy} type="submit">
          {actionLabel('작업 실행', '제출 중…', submitBusy)}
        </button>
        {props.onNotifyPersonalChange ? <label className="personal-notification-option">
          <input type="checkbox" checked={props.notifyPersonal === true} disabled={props.phase === 'loading' || submitBusy}
            onChange={event => props.onNotifyPersonalChange?.(event.currentTarget.checked)} />
          <span>내 업무 허브 개인 채팅으로 진행·결과 알림 받기</span>
        </label> : null}
      </form>
      </details>

      {props.validationError ? <p className="error" role="alert">{props.validationError}</p> : null}
      {props.error && props.phase !== 'error' ? <p className="error" role="alert">{props.error}</p> : null}
      {props.notice ? <p aria-live="polite" role="status">{props.notice}</p> : null}

      {props.phase === 'loading' ? (
        <div aria-atomic="true" aria-busy="true" aria-live="polite" role="status">
          <p className="empty">오케스트레이션 작업을 불러오는 중입니다.</p>
        </div>
      ) : null}

      {props.phase === 'error' ? (
        <div className="error" role="alert">
          <p>{props.error}</p>
          <button className="secondary" onClick={() => void props.onReload()} type="button">다시 시도</button>
        </div>
      ) : null}

      {props.phase === 'ready' ? <details className="work-hub-approval-details">
        <summary>승인 대기 ({(props.pendingJobs ?? props.jobs).filter(job => Boolean(job.pendingOperation)).length})</summary>
        <section aria-label="개인 승인 대기 목록">
        <h3>승인 대기</h3>
        <p>승인 대상 확인 후 기존 작업 상세에서 승인하거나 거절하세요. 확인 카드가 만료돼도 작업은 자동 승인되지 않습니다.</p>
        {props.pendingHasMore ? <p role="status">승인 대기 작업 중 최근 100개를 표시합니다. 나머지는 작업 ID로 조회하세요.</p> : null}
        {props.pendingJobs == null ? <p role="status">전체 승인함 조회가 확인되지 않았습니다. 아래는 최근 작업에 포함된 승인 대기 항목입니다.</p> : null}
        {(props.pendingJobs ?? props.jobs).some(job => job.pendingOperation) ? (props.pendingJobs ?? props.jobs).filter(job => job.pendingOperation).map(job => (
          <article key={job.id} className="work-item-card">
            <button type="button" onClick={() => selectTask(job.id)}>{job.prompt}</button>
            <p>승인 대상: {job.pendingOperation!.jobId} · revision: {job.pendingOperation!.revision}</p>
            <ApprovalDetails job={job} />
            {!getOrchestrationApprovalIdentity(job) ? <p role="note">{approvalUnavailableMessage(job, approvalSupported)}</p> : null}
          </article>
        )) : <p role="status">{props.pendingJobs == null ? '최근 작업에 승인 대기 항목이 없습니다.' : '승인 대기 작업이 없습니다.'}</p>}
        </section>
      </details> : null}


    </section>
  );
}

export type OrchestrationPanelProps = {
  client?: CoreOrchestrationClient;
  mobile?: boolean;
};

export function OrchestrationPanel({ client = DEFAULT_CLIENT, mobile }: OrchestrationPanelProps) {
  const [phase, setPhase] = useState<PanelPhase>('loading');
  const [requestedJobId, setRequestedJobId] = useState(() => parseRequestedJobId(typeof window === 'undefined' ? '' : window.location.search));
  useEffect(() => {
    if (!teamsApp.isInitialized()) return;
    let active = true;
    void teamsApp.getContext().then(context => {
      if (active) setRequestedJobId(parseRequestedJobId(window.location.search, context.page.subPageId));
    }).catch(() => { /* The URL hint remains subject to the same authenticated detail API. */ });
    return () => { active = false; };
  }, []);
  const [jobs, setJobs] = useState<CoreOrchestrationJob[]>([]);
  const [listHasMore, setListHasMore] = useState(false);
  const [listNextCursor, setListNextCursor] = useState<string | undefined>();
  const [listLoadingMore, setListLoadingMore] = useState(false);
  const [listSearchDraft, setListSearchDraft] = useState('');
  const [listSearch, setListSearch] = useState('');
  const [listStatus, setListStatus] = useState<CoreOrchestrationJobStatus | 'all'>('all');
  const [listNavigation, setListNavigation] = useState<WorkHubNavigationSection>('recent');
  const [selectedProject, setSelectedProject] = useState('');
  const [navigationDrawerOpen, setNavigationDrawerOpen] = useState(true);
  const [projectDraft, setProjectDraft] = useState('');
  const [navigationPreferences, setNavigationPreferences] = useState<WorkHubPreferences>({
    pinnedJobIds: [], projectNames: [], projectByJobId: {},
  });
  const [navigationPreferencesKey, setNavigationPreferencesKey] = useState<string | undefined>();
  const [navigationPreferencesHydrated, setNavigationPreferencesHydrated] = useState(false);
  const [pendingJobs, setPendingJobs] = useState<CoreOrchestrationJob[] | null | undefined>(undefined);
  const [pendingHasMore, setPendingHasMore] = useState(false);
  const [providers, setProviders] = useState<CoreProviderFact[]>([]);
  const [modelCatalog, setModelCatalog] = useState<CoreCodexModelCatalog | undefined>();
  const [selectedJob, setSelectedJob] = useState<CoreOrchestrationJob | null>(null);
  const [conversation, setConversation] = useState<VisibleJobConversation | undefined>();
  const detailRequests = useRef(createLatestDetailRequestController());
  const selectingJobs = useRef(new Set<string>());
  useEffect(() => () => detailRequests.current.dispose(), []);
  useEffect(() => {
    if (selectedJob) setConversation(current => current ? refreshVisibleJobConversation(current, selectedJob) : current);
  }, [selectedJob]);
  useEffect(() => {
    if (!conversation) return;
    const detail = document.getElementById('orchestration-job-detail');
    detail?.focus({ preventScroll: true });
    detail?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [conversation?.selectedJobId]);
  const [providerId, setProviderId] = useState('');
  const [modelId, setModelId] = useState('');
  const [reasoningEffort, setReasoningEffort] = useState<CoreCodexReasoningEffort | ''>('');
  const [mode, setMode] = useState<CoreOrchestrationMode>('read-only');
  const [prompt, setPrompt] = useState('');
  const [notifyPersonal, setNotifyPersonal] = useState(true);
  const [inputValue, setInputValue] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<PanelNotice>(null);
  const [validationError, setValidationError] = useState('');
  const [lastUpdatedAt, setLastUpdatedAt] = useState('');
  const [pendingConfirmation, setPendingConfirmation] = useState<OrchestrationConfirmation | null>(null);
  const busy = useMemo(() => createOrchestrationBusyController(), []);
  const submissionKeys = useRef(createSubmissionIdempotencyController());
  const loadController = useRef<AbortController | null>(null);
  const listPageController = useRef<AbortController | null>(null);
  const listPageLock = useRef(false);
  const privateAccessBlocked = useRef(false);
  const privateAccessGeneration = useRef(0);
  const currentJobs = useRef<CoreOrchestrationJob[]>([]);
  const selectedJobId = useRef<string | undefined>(undefined);
  const requestedJobHint = useRef(requestedJobId);
  requestedJobHint.current = requestedJobId;
  const publishJobs = useCallback((next: CoreOrchestrationJob[] | ((current: CoreOrchestrationJob[]) => CoreOrchestrationJob[])) => {
    currentJobs.current = typeof next === 'function' ? next(currentJobs.current) : next;
    setJobs(currentJobs.current);
  }, []);

  useEffect(() => {
    if (!teamsApp.isInitialized()) return;
    let active = true;
    void teamsApp.getContext().then(context => {
      if (!active) return;
      const key = workHubStorageKey(context.user?.tenant?.id, context.user?.id);
      let storage: Storage | undefined;
      try { storage = window.localStorage; } catch { /* Optional local preferences. */ }
      setNavigationPreferencesKey(key);
      setNavigationPreferences(readWorkHubPreferences(storage, key));
      setNavigationPreferencesHydrated(true);
    }).catch(() => { /* Navigation remains usable for this tab session. */ });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!navigationPreferencesHydrated || !navigationPreferencesKey || typeof window === 'undefined') return;
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* Optional local preferences. */ }
    writeWorkHubPreferences(storage, navigationPreferencesKey, navigationPreferences);
  }, [navigationPreferences, navigationPreferencesHydrated, navigationPreferencesKey]);

  const listJobIds = useMemo(() => workHubNavigationJobIds(
    navigationPreferences, listNavigation, selectedProject,
  ), [listNavigation, navigationPreferences, selectedProject]);
  const listQuery = useMemo(() => ({
    limit: 30,
    ...(listSearch ? { search: listSearch } : {}),
    ...(listStatus !== 'all' ? { status: listStatus } : {}),
    ...(listJobIds !== undefined ? { jobIds: listJobIds } : {}),
  }), [listJobIds, listSearch, listStatus]);

  const clearPrivateState = useCallback(() => {
    privateAccessBlocked.current = true;
    privateAccessGeneration.current += 1;
    loadController.current?.abort();
    listPageController.current?.abort();
    listPageController.current = null;
    listPageLock.current = false;
    detailRequests.current.dispose();
    publishJobs([]);
    setListHasMore(false);
    setListNextCursor(undefined);
    setListLoadingMore(false);
    setPendingJobs([]);
    setPendingHasMore(false);
    setSelectedJob(null);
    selectedJobId.current = undefined;
    setConversation(undefined);
    setPendingConfirmation(null);
    setRequestedJobId(undefined);
    requestedJobHint.current = undefined;
    setInputValue('');
    setBusyAction('');
    setProviders([]);
    setModelCatalog(undefined);
    setProviderId('');
    setModelId('');
    setReasoningEffort('');
    setLastUpdatedAt('');
    setNotice(null);
  }, [publishJobs]);

  const handlePrivateAccessFailure = useCallback((caught: unknown) => {
    if (!isApiAuthError(caught) && !isConversationHistoryAccessFailure(caught)) return false;
    clearPrivateState();
    setError(errorMessage(caught));
    setPhase('error');
    return true;
  }, [clearPrivateState]);

  const updateJob = useCallback((nextJob: CoreOrchestrationJob) => {
    publishJobs((current) => current.some((job) => job.id === nextJob.id)
      ? current.map((job) => job.id === nextJob.id ? nextJob : job)
      : [nextJob, ...current]);
    setSelectedJob(nextJob);
    selectedJobId.current = nextJob.id;
  }, [publishJobs]);

  const load = useCallback(async (options: { silent?: boolean } = {}) => {
    if (options.silent && privateAccessBlocked.current) return;
    if (options.silent && listPageLock.current) return;
    listPageController.current?.abort();
    listPageController.current = null;
    listPageLock.current = false;
    setListLoadingMore(false);
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    const generation = privateAccessGeneration.current;
    if (!options.silent) {
      setPhase('loading');
      setError('');
    }
    try {
      const result = await client.listJobs(controller.signal, listQuery);
      const observedId = selectedJobId.current;
      const hint = requestedJobHint.current;
      const selected = observedId ? await client.getJob(observedId, controller.signal) : undefined;
      const requestedJob = hint ? await loadRequestedJob(hint, client, controller.signal) : undefined;
      const retainedJobs: CoreOrchestrationJob[] = [];
      if (options.silent) {
        const ids = currentJobs.current.map(job => job.id);
        // Revalidate every deliberately loaded row through the same owner and
        // server filter. Batch within the Core API's 50-ID bound.
        for (let start = 0; start < ids.length; start += 50) {
          controller.signal.throwIfAborted();
          const page = await client.listJobs(controller.signal, { ...listQuery, limit: 50, jobIds: ids.slice(start, start + 50) });
          retainedJobs.push(...page.jobs);
        }
      }
      if (controller.signal.aborted || generation !== privateAccessGeneration.current) return;
      privateAccessBlocked.current = false;
      const refreshedJobs = includeRequestedJob(result.jobs, requestedJob);
      publishJobs(current => {
        if (!options.silent) return [...refreshedJobs];
        const refreshedById = new Map([...refreshedJobs, ...retainedJobs].map(job => [job.id, job]));
        const currentIds = new Set(current.map(job => job.id));
        return [
          ...refreshedJobs.filter(job => !currentIds.has(job.id)),
          ...current.map(job => refreshedById.get(job.id)).filter((job): job is CoreOrchestrationJob => Boolean(job)),
        ];
      });
      if (!options.silent || result.hasMore !== true) {
        setListHasMore(result.hasMore === true);
        setListNextCursor(result.nextCursor);
      }
      setPendingJobs(result.pendingJobs);
      setPendingHasMore(result.pendingHasMore === true);
      setProviders(result.providers);
      setModelCatalog(result.modelCatalog);
      setSelectedJob((current) => current ? selected?.id === current.id ? selected : result.jobs.find((job) => job.id === current.id) ?? (requestedJob?.id === current.id ? requestedJob : current) : requestedJob ?? null);
      if (!selectedJobId.current && requestedJob) selectedJobId.current = requestedJob.id;
      setProviderId((current) => {
        const retained = result.providers.find((provider) => provider.provider === current);
        if (supports(retained, 'submit')) return current;
        return result.providers.find((provider) => supports(provider, 'submit'))?.provider ?? '';
      });
      setLastUpdatedAt(new Date().toISOString());
      setPhase('ready');
      setNotice(current => settleOrchestrationRefreshNotice(current, { status: 'succeeded' }));
    } catch (caught) {
      if (controller.signal.aborted || generation !== privateAccessGeneration.current) return;
      if (handlePrivateAccessFailure(caught)) return;
      if (options.silent) {
        setNotice(current => settleOrchestrationRefreshNotice(current, { status: 'failed', message: errorMessage(caught) }));
      } else {
        setError(errorMessage(caught));
        setPhase('error');
      }
    }
  }, [client, handlePrivateAccessFailure, listQuery, publishJobs]);

  const loadMore = useCallback(async () => {
    if (!listHasMore || !listNextCursor || listPageLock.current || privateAccessBlocked.current) return;
    listPageLock.current = true;
    setListLoadingMore(true);
    const controller = new AbortController();
    listPageController.current = controller;
    const generation = privateAccessGeneration.current;
    try {
      const result = await client.listJobs(controller.signal, { ...listQuery, cursor: listNextCursor });
      if (controller.signal.aborted || generation !== privateAccessGeneration.current) return;
      publishJobs(current => {
        const existing = new Set(current.map(job => job.id));
        return [...current, ...result.jobs.filter(job => !existing.has(job.id))];
      });
      setListHasMore(result.hasMore === true);
      setListNextCursor(result.nextCursor);
    } catch (caught) {
      if (!controller.signal.aborted && generation === privateAccessGeneration.current
        && !handlePrivateAccessFailure(caught)) {
        setNotice({ kind: 'refresh-error', message: `다음 작업을 불러오지 못했습니다: ${errorMessage(caught)}` });
      }
    } finally {
      if (listPageController.current === controller) {
        listPageController.current = null;
        listPageLock.current = false;
        setListLoadingMore(false);
      }
    }
  }, [client, handlePrivateAccessFailure, listHasMore, listNextCursor, listQuery, publishJobs]);

  const navigateList = useCallback((section: WorkHubNavigationSection, projectName?: string) => {
    setListNavigation(section);
    setSelectedProject(section === 'project' ? projectName ?? '' : '');
  }, []);
  const togglePin = useCallback((jobId: string) => {
    setNavigationPreferences(current => togglePinnedJob(current, jobId));
  }, []);
  const createProject = useCallback((name: string) => {
    setNavigationPreferences(current => addWorkHubProject(current, name));
    setListNavigation('project');
    setSelectedProject(name.trim().replace(/\s+/gu, ' '));
    setProjectDraft('');
  }, []);
  const assignProject = useCallback((jobId: string, projectName: string) => {
    setNavigationPreferences(current => assignJobToProject(current, jobId, projectName));
  }, []);

  useEffect(() => {
    if (!privateAccessBlocked.current) void load();
    const polling = createOrchestrationPollingController({
      intervalMs: ORCHESTRATION_POLL_INTERVAL_MS,
      refresh: () => load({ silent: true }),
    });
    polling.start();
    return () => {
      polling.stop();
      loadController.current?.abort();
      listPageController.current?.abort();
    };
  }, [load]);

  useEffect(() => {
    setModelId((current) => {
      if (!modelCatalog) return '';
      return modelCatalog.models.some((model) => model.id === current)
        ? current
        : modelCatalog.models[0]?.id ?? '';
    });
  }, [modelCatalog]);

  useEffect(() => {
    const selected = modelCatalog?.models.find((model) => model.id === modelId);
    setReasoningEffort((current) => selected?.reasoningEfforts.includes(current as CoreCodexReasoningEffort)
      ? current
      : selected?.defaultReasoningEffort ?? '');
  }, [modelCatalog, modelId]);

  const runMutation = useCallback(async (
    slot: string,
    operation: () => Promise<{
      job: CoreOrchestrationJob;
      replayed?: boolean;
      status?: string;
      reason?: string;
    }>,
    successMessage: string,
  ): Promise<'success' | 'definitive-failure' | 'ambiguous-failure' | 'ignored'> => {
    if (privateAccessBlocked.current || busy.isBusy(slot)) return 'ignored';
    const generation = privateAccessGeneration.current;
    setBusyAction(slot);
    setError('');
    setNotice(null);
    try {
      const result = await busy.run(slot, operation);
      if (!result || generation !== privateAccessGeneration.current) return 'ignored';
      if (result.status === 'unsupported') {
        await load();
        if (generation !== privateAccessGeneration.current) return 'ignored';
        setError(orchestrationMutationNotice(result, '추가 입력을 처리했습니다.'));
        return 'definitive-failure';
      }
      updateJob(result.job);
      setNotice({ kind: 'mutation', message: orchestrationMutationNotice(result, successMessage) });
      return 'success';
    } catch (caught) {
      if (generation !== privateAccessGeneration.current) return 'ignored';
      if (handlePrivateAccessFailure(caught)) return 'definitive-failure';
      setError(errorMessage(caught));
      return caught instanceof CoreOrchestrationClientError && !caught.retryable
        ? 'definitive-failure'
        : 'ambiguous-failure';
    } finally {
      if (generation === privateAccessGeneration.current) setBusyAction((current) => current === slot ? '' : current);
    }
  }, [busy, handlePrivateAccessFailure, load, updateJob]);

  const submit = useCallback(async () => {
    const validation = validateOrchestrationSubmission(
      prompt,
      providerId,
      providers,
      modelId,
      reasoningEffort,
      modelCatalog,
    );
    setValidationError(validation);
    if (validation) return;
    const identity = {
      prompt: prompt.trim(),
      provider: providerId as CoreOrchestrationProvider,
      mode,
      notify: notifyPersonal,
      ...(providerId === 'codex' && modelCatalog && modelId && reasoningEffort ? {
        model: modelId,
        reasoningEffort,
        catalogRevision: modelCatalog.revision,
      } : {}),
    };
    const idempotencyKey = submissionKeys.current.keyFor(identity);
    const outcome = await runMutation('submit', () => client.submitJob({
      idempotencyKey,
      ...identity,
    }), '작업을 제출했습니다.');
    if (outcome === 'success' || outcome === 'definitive-failure') {
      submissionKeys.current.complete(identity, idempotencyKey);
    }
  }, [client, mode, modelCatalog, modelId, notifyPersonal, prompt, providerId, providers, reasoningEffort, runMutation]);

  const selectJob = useCallback(async (jobId: string) => {
    if (privateAccessBlocked.current || selectingJobs.current.has(jobId)) return;
    const generation = privateAccessGeneration.current;
    selectingJobs.current.add(jobId);
    setRequestedJobId(current => current === jobId ? current : undefined);
    const slot = `detail:${jobId}`;
    setBusyAction(slot);
    setError('');
    setConversation(undefined);
    try {
      await detailRequests.current.request(
        signal => client.getJobConversation?.(jobId, signal) ?? loadJobConversation(jobId, client.getJob, signal),
        { success: detail => {
          if (generation !== privateAccessGeneration.current) return;
          updateJob(detail.job);
          setConversation(detail.conversation);
          setInputValue('');
        }, error: caught => {
          if (generation === privateAccessGeneration.current && !handlePrivateAccessFailure(caught)) setError(errorMessage(caught));
        },
        settled: () => setBusyAction((current) => current === slot ? '' : current) },
      );
    } finally {
      selectingJobs.current.delete(jobId);
    }
  }, [client, handlePrivateAccessFailure, updateJob]);

  useEffect(() => {
    if (requestedJobId) void selectJob(requestedJobId);
  }, [requestedJobId, selectJob]);

  const cancel = useCallback(async (jobId: string) => {
    const outcome = await runMutation(`cancel:${jobId}`, () => client.cancelJob(jobId), '취소 요청을 보냈습니다.');
    if (outcome === 'success' || outcome === 'definitive-failure') setPendingConfirmation(null);
  }, [client, runMutation]);
  const decideApproval = useCallback(async (jobId: string, decision: 'accept' | 'deny') => {
    const job = selectedJob?.id === jobId ? selectedJob : null;
    const outcome = await runMutation(`approval:${jobId}`,
      () => decideSelectedOrchestrationApproval(client, job, pendingConfirmation, decision),
      decision === 'accept' ? '작업을 승인했습니다.' : '작업 실행을 거절했습니다.');
    if (outcome === 'success' || outcome === 'definitive-failure') setPendingConfirmation(null);
  }, [client, pendingConfirmation, runMutation, selectedJob]);
  const provideInput = useCallback(async (jobId: string) => {
    if (!inputValue.trim()) {
      setValidationError('추가 입력을 작성하세요.');
      return;
    }
    setValidationError('');
    await runMutation(`input:${jobId}`, () => client.provideInput(jobId, inputValue.trim()), '추가 입력을 보냈습니다.');
  }, [client, inputValue, runMutation]);
  const retryJob = useCallback(async (jobId: string) => {
    await runMutation(`retry:${jobId}`, () => client.retryJob(jobId), '작업을 다시 제출했습니다.');
  }, [client, runMutation]);

  const isMobile = mobile ?? (typeof navigator !== 'undefined' && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent));
  return <OrchestrationPanelView
    busyAction={busyAction}
    error={error}
    inputValue={inputValue}
    jobs={jobs}
    listHasMore={listHasMore}
    listLoadingMore={listLoadingMore}
    listSearchDraft={listSearchDraft}
    listStatus={listStatus}
    listNavigation={listNavigation}
    selectedProject={selectedProject}
    listIsFiltered={Boolean(listSearch || listStatus !== 'all')}
    navigationPreferences={navigationPreferences}
    navigationStorageAvailable={Boolean(navigationPreferencesKey)}
    navigationDrawerOpen={navigationDrawerOpen}
    projectDraft={projectDraft}
    onListSearchDraftChange={setListSearchDraft}
    onListSearchSubmit={() => setListSearch(listSearchDraft.trim())}
    onListStatusChange={setListStatus}
    onListNavigate={navigateList}
    onTogglePin={togglePin}
    onCreateProject={createProject}
    onAssignProject={assignProject}
    onNavigationDrawerOpenChange={setNavigationDrawerOpen}
    onProjectDraftChange={setProjectDraft}
    onLoadMore={loadMore}
    pendingJobs={pendingJobs}
    pendingHasMore={pendingHasMore}
    lastUpdatedAt={lastUpdatedAt}
    mobile={isMobile}
    mode={mode}
    modelCatalog={modelCatalog}
    modelId={modelId}
    notice={notice?.message ?? ''}
    pendingConfirmation={pendingConfirmation}
    onApprove={jobId => decideApproval(jobId, 'accept')}
    onDeny={jobId => decideApproval(jobId, 'deny')}
    approvalDecisionSupported={Boolean(client.decideApproval)}
    onCancel={cancel}
    onInputChange={(value) => { setInputValue(value); setValidationError(''); }}
    onModeChange={(value) => { setMode(value); setValidationError(''); }}
    onModelChange={(value) => {
      setModelId(value);
      const model = modelCatalog?.models.find((candidate) => candidate.id === value);
      setReasoningEffort(model?.defaultReasoningEffort ?? '');
      setValidationError('');
    }}
    onPromptChange={(value) => { setPrompt(value); setValidationError(''); }}
    onProvideInput={provideInput}
    onProviderChange={(value) => { setProviderId(value); setValidationError(''); }}
    onReasoningEffortChange={(value) => { setReasoningEffort(value); setValidationError(''); }}
    onRequestConfirmation={(kind, jobId) => {
      if (kind === 'cancel') { setPendingConfirmation({ kind, jobId }); return; }
      const identity = selectedJob?.id === jobId ? getOrchestrationApprovalIdentity(selectedJob) : undefined;
      if (!identity || !client.decideApproval) { setError('실행 가능한 승인 정보가 없습니다. 새로고침하고 다시 검토하세요.'); return; }
      setPendingConfirmation({ kind, jobId, approvalIdentity: identity });
    }}
    onDismissConfirmation={() => setPendingConfirmation(null)}
    onReload={load}
    onRetryTask={retryJob}
    onSelectTask={selectJob}
    onSubmit={submit}
    phase={phase}
    prompt={prompt}
    providerId={providerId}
    providers={providers}
    reasoningEffort={reasoningEffort}
    selectedJob={selectedJob}
    conversation={conversation?.selectedJobId === selectedJob?.id ? conversation : undefined}
    notifyPersonal={notifyPersonal}
    onNotifyPersonalChange={setNotifyPersonal}
    validationError={validationError}
  />;
}
