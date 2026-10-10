import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { CORE_JOB_STATUS_LABELS, type CoreOrchestrationJob } from '../shared/core-orchestration.js';
import { ExecutionPresentationJobIdSchema } from '../shared/execution-presentation.js';
import { createCoreOrchestrationClient, type CoreOrchestrationClient } from './core-orchestration-client.js';
import { ExecutionPresentationProvider, ExecutionPresentationDetailControls } from './ExecutionPresentationSettings.js';
import { CopilotJobView } from './CopilotJobView.js';
import * as teamsSdk from '@microsoft/teams-js';
import { CoreResultReview } from './CoreResultReview.js';

type ConversationDialogHost = {
  app: { initialize(): Promise<void>; getContext(): Promise<{ page: { frameContext: string }; app?: { appId?: string | { toString(): string } } }> };
  dialog: { url: { isSupported(): boolean; submit(result: { jobId: string }, appIds: string[]): void } };
};
async function conversationHostContext(sdk: ConversationDialogHost) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      sdk.app.initialize().then(() => sdk.app.getContext()),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Teams context unavailable')), 10_000); }),
    ]);
  } finally { clearTimeout(timer); }
}
/** A result requires the observed receiving app ID as well as the task frame.
 * https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/task-modules/task-modules-tabs#html-or-javascript-dialogs */
export async function closeConversationDialog(jobId: string, sdk: ConversationDialogHost = teamsSdk): Promise<boolean> {
  if (!ExecutionPresentationJobIdSchema.safeParse(jobId).success) return false;
  const context = await conversationHostContext(sdk);
  if (context.page?.frameContext !== 'task' || !sdk.dialog.url.isSupported()) return false;
  const observed = context.app?.appId;
  let appId: string | undefined;
  try {
    if (typeof observed === 'string') appId = observed;
    else if (observed && typeof observed === 'object' && observed.toString !== Object.prototype.toString) appId = observed.toString();
  } catch { return false; }
  // AppId is a TeamsJS validated string, including supported legacy named IDs.
  // Keep the installed validator's printable/length bounds; no manifest or query fallback.
  if (typeof appId !== 'string' || appId.trim() !== appId || appId.length <= 4 || appId.length >= 256
    || /[^\x20-\x7e]|[<>]/u.test(appId)) return false;
  sdk.dialog.url.submit({ jobId }, [appId]); return true;
}

export function CopilotConversationWorkspace({ initialJobId, client: suppliedClient, onReturnToPersonal }: {
  initialJobId?: string; client?: CoreOrchestrationClient; onReturnToPersonal?: (jobId?: string) => void;
}): ReactElement {
  const client = useMemo(() => suppliedClient ?? createCoreOrchestrationClient(), [suppliedClient]);
  const [jobs, setJobs] = useState<CoreOrchestrationJob[]>([]);
  const [selected, setSelected] = useState(initialJobId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirmedJob, setConfirmedJob] = useState<CoreOrchestrationJob>();
  const [resultError, setResultError] = useState('');
  const [resultRefresh, setResultRefresh] = useState(0);
  const [taskFrame, setTaskFrame] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState('');
  const closeRequest = useRef(false);
  const attempt = useRef(0);
  const request = useRef<AbortController | null>(null);
  const loadJobs = async () => {
    request.current?.abort(); const abort = new AbortController(); request.current = abort;
    const generation = ++attempt.current;
    const timer = setTimeout(() => abort.abort(), 20_000);
    setLoading(true); setError(''); setJobs([]);
    try {
      const result = await client.listJobs(abort.signal);
      if (abort.signal.aborted || generation !== attempt.current) return;
      const list = [...(result.pendingJobs ?? []), ...result.jobs];
      const unique = list.filter((job, index) => ExecutionPresentationJobIdSchema.safeParse(job.id).success && list.findIndex(value => value.id === job.id) === index);
      setJobs(unique);
    } catch { if (generation === attempt.current) { setSelected(undefined); setError('개인 작업 목록을 불러오지 못했습니다. 다시 인증하거나 목록을 다시 확인하세요.'); } }
    finally { clearTimeout(timer); if (generation === attempt.current) setLoading(false); }
  };
  useEffect(() => { void loadJobs(); return () => { attempt.current++; request.current?.abort(); }; }, [client]);
  useEffect(() => {
    const abort = new AbortController(); const timer = setTimeout(() => {
      abort.abort(); setConfirmedJob(undefined); setResultError('선택한 작업 결과 조회 시간이 초과됐습니다. 작업 목록을 다시 조회하세요.');
    }, 20_000);
    setConfirmedJob(undefined); setResultError('');
    if (selected && ExecutionPresentationJobIdSchema.safeParse(selected).success) void client.getJob(selected, abort.signal).then(job => {
      if (abort.signal.aborted) return;
      if (job.id !== selected) throw new Error('Selected result identity mismatch');
      setConfirmedJob(job);
    }).catch(() => { if (!abort.signal.aborted) { setConfirmedJob(undefined); setResultError('선택한 작업의 결과 접근 권한을 확인하지 못했습니다. 개인 작업을 다시 조회하세요.'); } })
      .finally(() => clearTimeout(timer));
    else clearTimeout(timer);
    return () => { abort.abort(); clearTimeout(timer); };
  }, [client, selected, resultRefresh]);
  useEffect(() => {
    let live = true;
    void conversationHostContext(teamsSdk).then(context => { if (live) setTaskFrame(context.page.frameContext === 'task' && teamsSdk.dialog.url.isSupported()); })
      .catch(() => { if (live) setTaskFrame(false); });
    return () => { live = false; };
  }, []);
  return <ExecutionPresentationProvider>
    <a href={`/tabs/home/?view=core${selected ? `&jobId=${encodeURIComponent(selected)}` : ''}`} onClick={onReturnToPersonal ? event => {
      event.preventDefault(); onReturnToPersonal(selected);
    } : undefined}>개인 작업으로 돌아가기</a>
    {taskFrame && selected ? <button className="secondary" type="button" disabled={closing} onClick={async () => {
      if (closeRequest.current) return; closeRequest.current = true; setClosing(true); setCloseError('');
      try { if (!await closeConversationDialog(selected)) setCloseError('현재 화면의 Dialog 컨텍스트를 확인하지 못했습니다. 개인 작업으로 돌아가세요.'); }
      catch { setCloseError('Dialog를 닫지 못했습니다. 개인 작업으로 돌아가세요.'); }
      finally { closeRequest.current = false; setClosing(false); }
    }}>Dialog 닫고 원래 작업으로 돌아가기</button> : null}
    {closeError ? <p role="alert">{closeError}</p> : null}
    <ExecutionPresentationDetailControls />
    <section className="presentation-workspace-selector" aria-label="CopilotKit 대화 작업 선택">
      <button className="secondary" type="button" disabled={loading} onClick={() => { setResultRefresh(value => value + 1); void loadJobs(); }}>개인 작업 목록 새로고침</button>
      {loading ? <p role="status">개인 작업을 불러오고 있습니다.</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {!loading && !error && !jobs.length ? <p>아직 개인 작업이 없습니다. 개인 작업 화면에서 첫 작업을 만든 뒤 여기서 대화를 이어갈 수 있습니다.</p> : null}
      <label>기존 대화 선택 <select aria-label="기존 대화 선택" disabled={loading || Boolean(error)} value={selected ?? ''}
        onChange={event => setSelected(event.currentTarget.value || undefined)}>
        <option value="">개인 작업을 선택하세요.</option>
        {selected && !jobs.some(job => job.id === selected) ? <option value={selected}>{selected}</option> : null}
        {jobs.map(job => <option value={job.id} key={job.id}>{job.id} · {CORE_JOB_STATUS_LABELS[job.status]}</option>)}
      </select></label>
      {!loading && !error && selected ? <CopilotJobView key={selected} jobId={selected} autoLoad={true} onJobChange={setSelected} /> : null}
      {!loading && !error && confirmedJob?.id === selected ? <CoreResultReview key={selected} job={confirmedJob} /> : null}
      {resultError ? <p role="alert">{resultError}</p> : null}
    </section>
  </ExecutionPresentationProvider>;
}
