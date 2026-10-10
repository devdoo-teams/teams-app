import { useEffect, useMemo, useRef, useState } from 'react';
import type { CoreOrchestrationJob } from '../shared/core-orchestration.js';
import { isApiAuthError } from './auth.js';
import { createCoreResultClient, type CoreResultClient, type CoreResultPublication, type CoreResultStatus } from './core-result-client.js';

const originLabels = { personal: '원래 개인 대화', groupChat: '원래 그룹 대화', channel: '원래 채널 대화' } as const;
function accessFailure(error: unknown): boolean {
  return isApiAuthError(error) || Boolean(error && typeof error === 'object' && 'status' in error && [401, 403, 404].includes(error.status as number));
}
function safeSource(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password
    && (!url.port || url.port === '443') && !/[\u0000-\u0020\\]/u.test(value)
    && !/^(?:\d{1,3}\.){3}\d{1,3}$|^\[|(?:^|\.)(?:localhost|local|internal|test|invalid)$/iu.test(url.hostname)
    && url.hostname.includes('.') && ![...url.searchParams.keys()].some(key => /^(?:token|access_token|api_key|apikey|secret|password|code|sig|signature|authorization)$/iu.test(key));
  } catch { return false; }
}
export function CoreResultReview({ job, client: suppliedClient }: { job: CoreOrchestrationJob; client?: CoreResultClient }) {
  const client = useMemo(() => suppliedClient ?? createCoreResultClient(), [suppliedClient]);
  const [status, setStatus] = useState<CoreResultStatus>();
  const [loadedJobId, setLoadedJobId] = useState<string>();
  const [preview, setPreview] = useState<{ publication: CoreResultPublication; text: string }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [unknown, setUnknown] = useState(false);
  const [notice, setNotice] = useState('');
  const request = useRef<AbortController | null>(null);
  const attempted = useRef(false);
  const downloadUrls = useRef(new Set<string>());
  const eligible = job.status === 'completed' && Boolean(job.result?.trim());
  const current = loadedJobId === job.id;

  async function operate(action: 'status' | 'preview' | 'confirm' | 'download') {
    if (request.current || !eligible) return;
    if (action === 'preview' && (!current || !status?.canPreview || attempted.current || unknown)) return;
    if (action === 'confirm' && (!current || !preview || preview.publication.state !== 'preview' || attempted.current || unknown)) return;
    const abort = new AbortController(); request.current = abort;
    const timer = setTimeout(() => abort.abort(), 20_000);
    setBusy(true); setError(''); setNotice('');
    if (action === 'confirm') attempted.current = true;
    try {
      if (action === 'download') {
        const blob = await client.download(job.id, abort.signal);
        if (request.current !== abort || abort.signal.aborted) return;
        if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') throw new Error('Download unavailable');
        const url = URL.createObjectURL(blob); downloadUrls.current.add(url);
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${job.id.replace(/[^A-Za-z0-9._-]/gu, '_')}-result.txt`;
        document.body.append(anchor); anchor.click(); anchor.remove();
        setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.current.delete(url); }, 1000);
        setNotice('결과 파일 다운로드를 요청했습니다. 브라우저의 다운로드 상태를 확인하세요.');
      } else if (action === 'status') {
        const next = await client.getStatus(job.id, abort.signal);
        if (request.current !== abort || abort.signal.aborted) return;
        setStatus(next); setLoadedJobId(job.id);
        if (next.publication?.state === 'connector-accepted' || next.publication?.state === 'failed') setUnknown(false);
        if (next.publication?.state !== 'preview') setPreview(undefined);
      } else if (action === 'preview') {
        const next = await client.preview(job.id, abort.signal);
        if (request.current !== abort || abort.signal.aborted) return;
        setPreview(next); setStatus(previous => ({ ...previous, canPreview: next.publication.state === 'preview', publication: next.publication }));
      } else {
        const next = await client.confirm(job.id, { operationId: preview!.publication.operationId, resultRevision: preview!.publication.resultRevision }, abort.signal);
        if (request.current !== abort || abort.signal.aborted) return;
        setPreview(undefined); setStatus(previous => ({ ...previous, canPreview: false, publication: next.publication }));
        if (next.publication.state === 'preview' || next.publication.state === 'ambiguous' || next.publication.state === 'sending') setUnknown(true);
      }
    } catch (caught) {
      if (request.current !== abort) return;
      if (action === 'confirm') { setUnknown(true); setPreview(undefined); }
      if (accessFailure(caught)) { setStatus(undefined); setLoadedJobId(undefined); setPreview(undefined);
        setError('작업 접근 권한을 확인할 수 없습니다. Teams 인증 상태와 개인 작업을 다시 확인하세요.');
      } else setError(action === 'confirm' ? '전송 결과를 확인할 수 없습니다. 다시 전송하지 말고 상태를 조회하세요.'
        : '결과 조회를 완료하지 못했습니다. 다시 조회하세요.');
    } finally { clearTimeout(timer); if (request.current === abort) { request.current = null; setBusy(false); } }
  }
  useEffect(() => {
    request.current?.abort(); request.current = null;
    setStatus(undefined); setLoadedJobId(undefined); setPreview(undefined); setUnknown(false); setError(''); setNotice(''); attempted.current = false;
    if (eligible) void operate('status');
    return () => { request.current?.abort(); request.current = null; for (const url of downloadUrls.current) URL.revokeObjectURL(url); downloadUrls.current.clear(); };
  }, [client, job.id, job.status, job.result]);

  if (!eligible) return null;
  const publication = current ? status?.publication : undefined;
  const mayPreview = current && status?.canPreview && !attempted.current && !unknown;
  const shownPreview = current ? preview : undefined;
  const ambiguous = unknown || publication?.state === 'ambiguous' || publication?.state === 'sending';
  const sources = current ? job.resources?.sources.filter(source => safeSource(source.url)) ?? [] : [];
  return <section aria-label="작업 결과 검토 및 공유" lang="ko" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
    <h4>결과 검토 및 공유</h4>
    <p>개인 미리보기에서 확인한 뒤 서버가 확인한 원래 대화로 전송할 수 있습니다.</p>
    {sources.length ? <><p>결과에 포함된 출처 링크입니다. 실제 조회 여부는 확인되지 않았습니다.</p>
      <ul>{sources.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">출처 직접 열기 · {source.host}</a></li>)}</ul></> : current ? <p>결과에 확인 가능한 출처 링크가 없습니다.</p> : null}
    {current && job.resources?.file.state === 'unsupported' ? <p>현재 앱은 Teams 파일 전송을 지원하지 않습니다. 인증된 결과 파일 다운로드를 이용하세요.</p> : null}
    <button type="button" disabled={busy || !current} onClick={() => operate('download')}>결과 파일 다운로드</button>
    <button type="button" disabled={busy} onClick={() => operate('status')}>전송 상태 조회</button>
    {mayPreview && !shownPreview ? <button type="button" disabled={busy} onClick={() => operate('preview')}>개인 미리보기</button> : null}
    {shownPreview ? <div aria-label="전송 전 개인 미리보기">
      <p>전송 위치: {originLabels[shownPreview.publication.origin.conversationType]}</p>
      <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{shownPreview.text}</p>
      {!ambiguous && !attempted.current && shownPreview.publication.state === 'preview' ? <>
        <button type="button" disabled={busy} onClick={() => operate('confirm')}>확인하고 전송</button>
        <button type="button" disabled={busy} onClick={() => setPreview(undefined)}>미리보기 닫기</button>
      </> : null}
    </div> : null}
    {busy ? <p role="status">결과 요청을 처리하고 있습니다.</p> : null}
    {ambiguous ? <p role="status">전송 결과가 불확실합니다. 중복 전송을 막기 위해 상태 조회만 제공하며 다시 전송하지 않습니다.</p>
      : publication?.state === 'connector-accepted' ? <p role="status">Teams 커넥터가 전송 요청을 수락했습니다. 실제 대화에서 메시지를 확인하세요.</p>
      : publication?.state === 'failed' ? <p role="status">Teams 커넥터가 전송 요청을 거부했습니다. 개인 결과는 계속 확인할 수 있습니다.</p>
      : current && !status?.canPreview ? <p role="note">서버에서 원래 대화 전송을 지원하는 상태를 확인하지 못했습니다.</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {current && status?.returnToConversation ? <a href={status.returnToConversation}>원래 대화로 돌아가기</a>
      : <p role="note">원래 대화로 돌아가기 링크가 제공되지 않았습니다. 개인 작업으로 돌아가거나 Dialog를 닫으세요.</p>}
  </section>;
}
