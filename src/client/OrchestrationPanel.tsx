import * as teamsSdk from '@microsoft/teams-js';
const teamsApp = teamsSdk.app;
import { parseRequestedJobId, loadRequestedJob, includeRequestedJob } from './job-deep-link.js';
import { CORE_JOB_STATUS_LABELS } from '../shared/core-orchestration.js';
import { projectReceiptFacts } from '../shared/receipt-presentation.js';
import type { VisibleJobConversation } from '../shared/job-conversation.js';
import { JobConversationView } from './JobConversationView.js';
import { loadJobConversation, refreshVisibleJobConversation } from './job-conversation.js';
import { createLatestDetailRequestController } from './latest-detail-request.js';
export { createLatestDetailRequestController } from './latest-detail-request.js';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import {
  CoreOrchestrationClientError,
  createCoreOrchestrationClient,
  type CoreOrchestrationClient,
} from './core-orchestration-client.js';
import type {
  CoreCodexModelCatalog,
  CoreCodexReasoningEffort,
  CoreOrchestrationJob,
  CoreOrchestrationMode,
  CoreOrchestrationProvider,
  CoreProviderFact,
} from '../shared/core-orchestration.js';

type PanelPhase = 'loading' | 'ready' | 'error';

type PanelNotice = Readonly<{ kind: 'refresh-error' | 'mutation'; message: string }> | null;

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
const toolCategoryLabels = {
  skill: '스킬',
  plugin: '플러그인',
  mcp: 'MCP',
  cli: 'CLI',
  builtin: '기본 도구',
} as const;

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
  if (!providerId.trim()) return '실행 제공자를 선택하세요.';
  const provider = providers.find((candidate) => candidate.provider === providerId);
  if (!provider) return '등록되지 않은 제공자입니다.';
  if (!isAvailable(provider) || !provider.capabilities.includes('submit')) {
    return '현재 사용할 수 없는 제공자입니다.';
  }
  if (providerId !== 'codex' && providerId !== 'copilot') return '등록되지 않은 제공자입니다.';
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
  pendingConfirmation?: Readonly<{ kind: 'approve' | 'cancel'; jobId: string }> | null;
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
  onRequestConfirmation?: (kind: 'approve' | 'cancel', jobId: string) => void;
  onDismissConfirmation?: () => void;
  onProvideInput: (jobId: string) => void | Promise<void>;
  onRetryTask: (jobId: string) => void | Promise<void>;
  onReload: () => void | Promise<void>;
};

function actionLabel(idle: string, busy: string, active: boolean): string {
  return active ? busy : idle;
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
  const selectedProvider = props.providers.find((provider) => provider.provider === props.selectedJob?.provider);
  const selectedModel = props.modelCatalog?.models.find((model) => model.id === props.modelId);
  const submitBusy = props.busyAction === 'submit';
  const selectedBusy = props.selectedJob ? props.busyAction.endsWith(`:${props.selectedJob.id}`) : false;
  const canCancel = props.selectedJob
    && ['queued', 'awaiting_approval', 'input_required', 'running'].includes(props.selectedJob.status)
    && supports(selectedProvider, 'cancel');
  const pendingConfirmation = props.selectedJob && props.pendingConfirmation?.jobId === props.selectedJob.id
    ? props.pendingConfirmation
    : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void props.onSubmit();
  };
  const sendInput = (event: FormEvent) => {
    event.preventDefault();
    if (props.selectedJob) void props.onProvideInput(props.selectedJob.id);
  };

  return (
    <section aria-labelledby="orchestration-heading" className="panel orchestration-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">TEAMS CORE</p>
          <h2 id="orchestration-heading">에이전트 작업</h2>
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
                disabled={props.phase === 'loading' || submitBusy}
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
                disabled={props.phase === 'loading' || submitBusy || !selectedModel}
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
          <p className="panel-description">Codex 모델 카탈로그를 확인할 수 없어 CLI 기본값을 사용합니다.</p>
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
            disabled={props.phase === 'loading' || submitBusy}
            onChange={(event) => props.onPromptChange(event.currentTarget.value)}
            value={props.prompt}
          />
        </label>
        <button className="primary" disabled={props.phase === 'loading' || submitBusy} type="submit">
          {actionLabel('작업 실행', '제출 중…', submitBusy)}
        </button>
        {props.onNotifyPersonalChange ? <label>
          <input type="checkbox" checked={props.notifyPersonal === true} disabled={props.phase === 'loading' || submitBusy}
            onChange={event => props.onNotifyPersonalChange?.(event.currentTarget.checked)} />
          내 업무 허브 개인 채팅으로 진행·결과 알림 받기
        </label> : null}
      </form>

      {props.validationError ? <p className="error" role="alert">{props.validationError}</p> : null}
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

      {props.phase === 'ready' && props.jobs.length === 0 ? (
        <p aria-live="polite" className="empty" role="status">아직 실행한 작업이 없습니다.</p>
      ) : null}

      {props.phase === 'ready' ? <section aria-label="개인 승인 대기 목록">
        <h3>승인 대기</h3>
        <p>승인 대상 확인 후 기존 작업 상세에서 승인하거나 취소하세요. 확인 카드가 만료돼도 작업은 자동 승인되지 않습니다.</p>
        {props.pendingHasMore ? <p role="status">승인 대기 작업 중 최근 100개를 표시합니다. 나머지는 작업 ID로 조회하세요.</p> : null}
        {props.pendingJobs == null ? <p role="status">전체 승인함 조회가 확인되지 않았습니다. 아래는 최근 작업에 포함된 승인 대기 항목입니다.</p> : null}
        {(props.pendingJobs ?? props.jobs).some(job => job.pendingOperation) ? (props.pendingJobs ?? props.jobs).filter(job => job.pendingOperation).map(job => (
          <article key={job.id} className="work-item-card">
            <button type="button" onClick={() => void props.onSelectTask(job.id)}>{job.prompt}</button>
            <p>승인 대상: {job.pendingOperation!.jobId} · revision: {job.pendingOperation!.revision}</p>
          </article>
        )) : <p role="status">{props.pendingJobs == null ? '최근 작업에 승인 대기 항목이 없습니다.' : '승인 대기 작업이 없습니다.'}</p>}
      </section> : null}
      {props.phase === 'ready' && props.jobs.length > 0 ? (
        <div aria-label="오케스트레이션 작업 목록" className="work-item-list" role="list">
          {props.jobs.map((job) => (
            <article className={`work-item-card${props.selectedJob?.id === job.id ? ' selected' : ''}`} key={job.id} role="listitem">
              <div className="work-item-card-heading">
                <button className="work-item-title" onClick={() => void props.onSelectTask(job.id)} type="button">
                  {job.prompt}
                </button>
                <span className={`badge${job.status === 'failed' ? ' warning' : ''}`}>{statusLabels[job.status]}</span>
              </div>
              <p className="work-item-meta">작업 ID: {job.id} · 제공자: {job.provider ?? 'codex'} · 모드: {job.mode}</p>
            </article>
          ))}
        </div>
      ) : null}

      {props.selectedJob ? (
        <article aria-labelledby="orchestration-detail-heading" className="work-item-detail" id="orchestration-job-detail" tabIndex={-1}>
          <h3 id="orchestration-detail-heading">작업 상세</h3>
          {props.selectedJob.pendingOperation ? <p>승인 대상: {props.selectedJob.pendingOperation.jobId} · revision: {props.selectedJob.pendingOperation.revision}</p> : null}
          <p><strong>상태:</strong> {statusLabels[props.selectedJob.status]}</p>
          <p><strong>작업 ID:</strong> {props.selectedJob.id}</p>
          {props.selectedJob.notificationDelivery ? <p aria-label="개인 채팅 알림 상태">
            <strong>개인 채팅 알림:</strong> {({
              'waiting-personal-chat': '개인 채팅 연결 대기 — 업무 허브 개인 채팅에서 메시지를 보내세요.',
              pending: '전송 대기', sending: '전송 확인 중', accepted: 'Teams가 전송을 수락함 — 실제 수신 여부는 채팅에서 확인하세요.',
              rejected: 'Teams가 전송을 거부함 — 앱 설치·차단 상태를 확인하세요.', ambiguous: '전송 결과 미확인 — 중복 방지를 위해 자동 재전송하지 않습니다.',
            })[props.selectedJob.notificationDelivery.state]}
          </p> : null}
          <p><strong>제출 실행경계:</strong> {props.selectedJob.executionEnvironment ?? '확인되지 않음'}</p>
          <p><strong>실제 실행환경:</strong> {props.selectedJob.executionReceipt?.platform ?? '확인되지 않음'}</p>
          <p><strong>작업 마지막 갱신:</strong> {props.selectedJob.updatedAt ?? '제공되지 않음'}</p>
          {!props.conversation ? <p><strong>프롬프트:</strong> {props.selectedJob.prompt}</p> : null}
          {projectReceiptFacts(props.selectedJob).map(fact => <p key={fact.label}><strong>{fact.label}:</strong> {fact.value}</p>)}
          <div>
            <strong>제공자가 보고한 도구:</strong>
            {(props.selectedJob.tools?.length ?? 0) > 0 ? (
              <ul aria-label="관찰된 도구">
                {props.selectedJob.tools?.map((usage) => (
                  <li key={`${usage.category}:${usage.name}`}>{toolCategoryLabels[usage.category]} · {usage.name}</li>
                ))}
              </ul>
            ) : <span> 없음 (스킬·플러그인은 제공자가 식별자를 보고한 경우에만 표시)</span>}
          </div>
          {props.conversation ? <JobConversationView conversation={props.conversation} /> : null}
          {!props.conversation && props.selectedJob.progress.length > 0 ? (
            <ul aria-label="작업 진행 기록">
              {props.selectedJob.progress.map((entry, index) => <li key={`${index}-${entry}`}>{entry}</li>)}
            </ul>
          ) : null}
          {!props.conversation && props.selectedJob.result ? <p>{props.selectedJob.result}</p> : null}
          {!props.conversation && props.selectedJob.error ? <p className="error" role="alert">{props.selectedJob.error}</p> : null}

          {props.selectedJob.status === 'awaiting_approval' ? (
            <div>
              <p>이 작업을 계속하려면 승인이 필요합니다.</p>
              {pendingConfirmation?.kind === 'approve' ? (
                <div aria-label="작업 승인 확인" className="delete-confirmation" role="group">
                  <span>실행하기 전에 승인 여부를 다시 확인합니다.</span>
                  <button
                    className="primary"
                    disabled={selectedBusy || !supports(selectedProvider, 'approve')}
                    onClick={() => void props.onApprove(props.selectedJob!.id)}
                    type="button"
                  >
                    {actionLabel('승인 확인', '승인 중…', props.busyAction === `approval:${props.selectedJob.id}`)}
                  </button>
                  <button className="secondary" disabled={selectedBusy} onClick={() => props.onDismissConfirmation?.()} type="button">
                    돌아가기
                  </button>
                </div>
              ) : (
                <button
                  className="primary"
                  disabled={selectedBusy || !supports(selectedProvider, 'approve')}
                  onClick={() => props.onRequestConfirmation?.('approve', props.selectedJob!.id)}
                  type="button"
                >
                  승인
                </button>
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
  const [pendingJobs, setPendingJobs] = useState<CoreOrchestrationJob[] | null | undefined>(undefined);
  const [pendingHasMore, setPendingHasMore] = useState(false);
  const [providers, setProviders] = useState<CoreProviderFact[]>([]);
  const [modelCatalog, setModelCatalog] = useState<CoreCodexModelCatalog | undefined>();
  const [selectedJob, setSelectedJob] = useState<CoreOrchestrationJob | null>(null);
  const [conversation, setConversation] = useState<VisibleJobConversation | undefined>();
  const detailRequests = useRef(createLatestDetailRequestController());
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
  const [pendingConfirmation, setPendingConfirmation] = useState<Readonly<{ kind: 'approve' | 'cancel'; jobId: string }> | null>(null);
  const busy = useMemo(() => createOrchestrationBusyController(), []);
  const submissionKeys = useRef(createSubmissionIdempotencyController());
  const loadController = useRef<AbortController | null>(null);

  const updateJob = useCallback((nextJob: CoreOrchestrationJob) => {
    setJobs((current) => current.some((job) => job.id === nextJob.id)
      ? current.map((job) => job.id === nextJob.id ? nextJob : job)
      : [nextJob, ...current]);
    setSelectedJob(nextJob);
  }, []);

  const load = useCallback(async (options: { silent?: boolean } = {}) => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    if (!options.silent) {
      setPhase('loading');
      setError('');
    }
    try {
      const result = await client.listJobs(controller.signal);
      const selected = selectedJob ? await client.getJob(selectedJob.id, controller.signal) : undefined;
      const requestedJob = requestedJobId ? await loadRequestedJob(requestedJobId, client, controller.signal) : undefined;
      if (controller.signal.aborted) return;
      setJobs([...includeRequestedJob(result.jobs, requestedJob)]);
      setPendingJobs(result.pendingJobs);
      setPendingHasMore(result.pendingHasMore === true);
      setProviders(result.providers);
      setModelCatalog(result.modelCatalog);
      setSelectedJob((current) => current ? selected?.id === current.id ? selected : result.jobs.find((job) => job.id === current.id) ?? (requestedJob?.id === current.id ? requestedJob : current) : requestedJob ?? null);
      setProviderId((current) => {
        const retained = result.providers.find((provider) => provider.provider === current);
        if (supports(retained, 'submit')) return current;
        return result.providers.find((provider) => supports(provider, 'submit'))?.provider ?? '';
      });
      setLastUpdatedAt(new Date().toISOString());
      setPhase('ready');
      setNotice(current => settleOrchestrationRefreshNotice(current, { status: 'succeeded' }));
    } catch (caught) {
      if (controller.signal.aborted) return;
      if (options.silent) {
        setNotice(current => settleOrchestrationRefreshNotice(current, { status: 'failed', message: errorMessage(caught) }));
      } else {
        setError(errorMessage(caught));
        setPhase('error');
      }
    }
  }, [client, requestedJobId, selectedJob?.id]);

  useEffect(() => {
    void load();
    const polling = createOrchestrationPollingController({
      intervalMs: ORCHESTRATION_POLL_INTERVAL_MS,
      refresh: () => load({ silent: true }),
    });
    polling.start();
    return () => {
      polling.stop();
      loadController.current?.abort();
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
    if (busy.isBusy(slot)) return 'ignored';
    setBusyAction(slot);
    setError('');
    setNotice(null);
    try {
      const result = await busy.run(slot, operation);
      if (!result) return 'ignored';
      if (result.status === 'unsupported') {
        await load();
        setError(orchestrationMutationNotice(result, '추가 입력을 처리했습니다.'));
        return 'definitive-failure';
      }
      updateJob(result.job);
      setNotice({ kind: 'mutation', message: orchestrationMutationNotice(result, successMessage) });
      return 'success';
    } catch (caught) {
      setError(errorMessage(caught));
      return caught instanceof CoreOrchestrationClientError && !caught.retryable
        ? 'definitive-failure'
        : 'ambiguous-failure';
    } finally {
      setBusyAction((current) => current === slot ? '' : current);
    }
  }, [busy, load, updateJob]);

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
    setRequestedJobId(current => current === jobId ? current : undefined);
    const slot = `detail:${jobId}`;
    setBusyAction(slot);
    setError('');
    setConversation(undefined);
    await detailRequests.current.request(
      signal => client.getJobConversation?.(jobId, signal) ?? loadJobConversation(jobId, client.getJob, signal),
      { success: detail => {
        updateJob(detail.job);
        setConversation(detail.conversation);
        setInputValue('');
      }, error: caught => setError(errorMessage(caught)),
      settled: () => setBusyAction((current) => current === slot ? '' : current) },
    );
  }, [client, updateJob]);

  useEffect(() => {
    if (requestedJobId) void selectJob(requestedJobId);
  }, [requestedJobId, selectJob]);

  const cancel = useCallback(async (jobId: string) => {
    const outcome = await runMutation(`cancel:${jobId}`, () => client.cancelJob(jobId), '취소 요청을 보냈습니다.');
    if (outcome === 'success' || outcome === 'definitive-failure') setPendingConfirmation(null);
  }, [client, runMutation]);
  const approve = useCallback(async (jobId: string) => {
    const outcome = await runMutation(`approval:${jobId}`, () => client.approveJob(jobId), '작업을 승인했습니다.');
    if (outcome === 'success' || outcome === 'definitive-failure') setPendingConfirmation(null);
  }, [client, runMutation]);
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
    pendingJobs={pendingJobs}
    pendingHasMore={pendingHasMore}
    lastUpdatedAt={lastUpdatedAt}
    mobile={isMobile}
    mode={mode}
    modelCatalog={modelCatalog}
    modelId={modelId}
    notice={notice?.message ?? ''}
    pendingConfirmation={pendingConfirmation}
    onApprove={approve}
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
    onRequestConfirmation={(kind, jobId) => setPendingConfirmation({ kind, jobId })}
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
