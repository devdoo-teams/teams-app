import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import {
  CoreOrchestrationClientError,
  createCoreOrchestrationClient,
  type CoreOrchestrationClient,
} from './core-orchestration-client.js';
import type {
  CoreOrchestrationJob,
  CoreOrchestrationMode,
  CoreOrchestrationProvider,
  CoreProviderFact,
} from '../shared/core-orchestration.js';

type PanelPhase = 'loading' | 'ready' | 'error';

const DEFAULT_CLIENT = createCoreOrchestrationClient();
const ORCHESTRATION_POLL_INTERVAL_MS = 3_000;
const statusLabels: Record<CoreOrchestrationJob['status'], string> = {
  queued: '대기 중',
  awaiting_approval: '승인 필요',
  input_required: '입력 필요',
  running: '실행 중',
  completed: '완료',
  failed: '실패',
  cancelled: '취소됨',
};
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
}>;

function submissionFingerprint(input: SubmissionIdentity): string {
  return JSON.stringify({
    prompt: input.prompt.trim(),
    provider: input.provider,
    mode: input.mode,
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

export function validateOrchestrationSubmission(
  prompt: string,
  providerId: string,
  providers: readonly CoreProviderFact[],
): string {
  if (!prompt.trim()) return '작업 내용을 입력하세요.';
  if (!providerId.trim()) return '실행 제공자를 선택하세요.';
  const provider = providers.find((candidate) => candidate.provider === providerId);
  if (!provider) return '등록되지 않은 제공자입니다.';
  if (!isAvailable(provider) || !provider.capabilities.includes('submit')) {
    return '현재 사용할 수 없는 제공자입니다.';
  }
  if (providerId !== 'codex' && providerId !== 'copilot') return '등록되지 않은 제공자입니다.';
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
  providers: readonly CoreProviderFact[];
  selectedJob: CoreOrchestrationJob | null;
  prompt: string;
  providerId: string;
  mode: CoreOrchestrationMode;
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
            {provider.provider}: {provider.availability === 'unknown' ? '가용성 확인 필요' : '현재 사용할 수 없음'}
          </p>
        ))}
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
        <article aria-labelledby="orchestration-detail-heading" className="work-item-detail">
          <h3 id="orchestration-detail-heading">작업 상세</h3>
          <p><strong>상태:</strong> {statusLabels[props.selectedJob.status]}</p>
          <p><strong>작업 ID:</strong> {props.selectedJob.id}</p>
          <p><strong>프롬프트:</strong> {props.selectedJob.prompt}</p>
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
          {props.selectedJob.progress.length > 0 ? (
            <ul aria-label="작업 진행 기록">
              {props.selectedJob.progress.map((entry, index) => <li key={`${index}-${entry}`}>{entry}</li>)}
            </ul>
          ) : null}
          {props.selectedJob.result ? <p>{props.selectedJob.result}</p> : null}
          {props.selectedJob.error ? <p className="error" role="alert">{props.selectedJob.error}</p> : null}

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
  const [jobs, setJobs] = useState<CoreOrchestrationJob[]>([]);
  const [providers, setProviders] = useState<CoreProviderFact[]>([]);
  const [selectedJob, setSelectedJob] = useState<CoreOrchestrationJob | null>(null);
  const [providerId, setProviderId] = useState('');
  const [mode, setMode] = useState<CoreOrchestrationMode>('read-only');
  const [prompt, setPrompt] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
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
      if (controller.signal.aborted) return;
      setJobs(result.jobs);
      setProviders(result.providers);
      setSelectedJob((current) => current ? result.jobs.find((job) => job.id === current.id) ?? null : null);
      setProviderId((current) => {
        const retained = result.providers.find((provider) => provider.provider === current);
        if (supports(retained, 'submit')) return current;
        return result.providers.find((provider) => supports(provider, 'submit'))?.provider ?? '';
      });
      setLastUpdatedAt(new Date().toISOString());
      setPhase('ready');
    } catch (caught) {
      if (controller.signal.aborted) return;
      if (options.silent) {
        setNotice(`자동 업데이트 실패: ${errorMessage(caught)}`);
      } else {
        setError(errorMessage(caught));
        setPhase('error');
      }
    }
  }, [client]);

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
    setNotice('');
    try {
      const result = await busy.run(slot, operation);
      if (!result) return 'ignored';
      if (result.status === 'unsupported') {
        await load();
        setError(orchestrationMutationNotice(result, '추가 입력을 처리했습니다.'));
        return 'definitive-failure';
      }
      updateJob(result.job);
      setNotice(orchestrationMutationNotice(result, successMessage));
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
    const validation = validateOrchestrationSubmission(prompt, providerId, providers);
    setValidationError(validation);
    if (validation) return;
    const identity = {
      prompt: prompt.trim(),
      provider: providerId as CoreOrchestrationProvider,
      mode,
    };
    const idempotencyKey = submissionKeys.current.keyFor(identity);
    const outcome = await runMutation('submit', () => client.submitJob({
      idempotencyKey,
      ...identity,
    }), '작업을 제출했습니다.');
    if (outcome === 'success' || outcome === 'definitive-failure') {
      submissionKeys.current.complete(identity, idempotencyKey);
    }
  }, [client, mode, prompt, providerId, providers, runMutation]);

  const selectJob = useCallback(async (jobId: string) => {
    const slot = `detail:${jobId}`;
    if (busy.isBusy(slot)) return;
    setBusyAction(slot);
    setError('');
    try {
      const detail = await busy.run(slot, () => client.getJob(jobId));
      if (detail) {
        updateJob(detail);
        setInputValue('');
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyAction((current) => current === slot ? '' : current);
    }
  }, [busy, client, updateJob]);

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
    lastUpdatedAt={lastUpdatedAt}
    mobile={isMobile}
    mode={mode}
    notice={notice}
    pendingConfirmation={pendingConfirmation}
    onApprove={approve}
    onCancel={cancel}
    onInputChange={(value) => { setInputValue(value); setValidationError(''); }}
    onModeChange={(value) => { setMode(value); setValidationError(''); }}
    onPromptChange={(value) => { setPrompt(value); setValidationError(''); }}
    onProvideInput={provideInput}
    onProviderChange={(value) => { setProviderId(value); setValidationError(''); }}
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
    selectedJob={selectedJob}
    validationError={validationError}
  />;
}
