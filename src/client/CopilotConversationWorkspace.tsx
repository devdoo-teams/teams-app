import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { CORE_JOB_STATUS_LABELS, type CoreOrchestrationJob } from '../shared/core-orchestration.js';
import { ExecutionPresentationJobIdSchema } from '../shared/execution-presentation.js';
import { createCoreOrchestrationClient, type CoreOrchestrationClient } from './core-orchestration-client.js';
import { ExecutionPresentationProvider, ExecutionPresentationDetailControls } from './ExecutionPresentationSettings.js';
import { CopilotJobView } from './CopilotJobView.js';

export function CopilotConversationWorkspace({ initialJobId, client: suppliedClient }: {
  initialJobId?: string; client?: CoreOrchestrationClient;
}): ReactElement {
  const client = useMemo(() => suppliedClient ?? createCoreOrchestrationClient(), [suppliedClient]);
  const [jobs, setJobs] = useState<CoreOrchestrationJob[]>([]);
  const [selected, setSelected] = useState(initialJobId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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
  return <ExecutionPresentationProvider>
    <a href={`/tabs/home/?view=core${selected ? `&jobId=${encodeURIComponent(selected)}` : ''}`}>개인 작업으로 돌아가기</a>
    <ExecutionPresentationDetailControls />
    <section className="presentation-workspace-selector" aria-label="CopilotKit 대화 작업 선택">
      <button className="secondary" type="button" disabled={loading} onClick={() => { void loadJobs(); }}>개인 작업 목록 새로고침</button>
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
    </section>
  </ExecutionPresentationProvider>;
}
