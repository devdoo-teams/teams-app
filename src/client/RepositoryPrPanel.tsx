import { useCallback, useEffect, useRef, useState } from 'react';
import { REPOSITORY_PR_LABELS, type RepositoryCatalog, type RepositoryPrCategory, type RepositoryPrSnapshot } from '../shared/repository-pr.js';
import { isApiAuthError } from './auth.js';
import { createLatestDetailRequestController } from './latest-detail-request.js';
import { createRepositoryPrClient, createRepositoryQueryController, RepositoryPrClientError, type RepositoryPrClient } from './repository-pr-client.js';

const defaultClient = createRepositoryPrClient();
function message(error: unknown) {
  if (isApiAuthError(error)) return error.message;
  if (error instanceof RepositoryPrClientError) {
    if (error.code === 'AUTH_REQUIRED') return 'Teams 인증을 확인한 뒤 다시 조회하세요.';
    if (error.code === 'FORBIDDEN') return '저장소 읽기 권한을 확인할 수 없습니다. 목록을 다시 읽으세요.';
    if (error.code === 'STALE_CATALOG') return '계정 또는 저장소 권한이 변경되었습니다. 목록을 다시 읽으세요.';
    if (error.code === 'NOT_CONFIGURED') return '운영 연결 미완료: 승인된 사내 저장소 연결이 필요합니다.';
  }
  return '저장소 조회에 실패했습니다. 목록과 연결 상태를 확인한 뒤 다시 시도하세요.';
}
export function RepositoryPrPanel({ client = defaultClient }: { client?: RepositoryPrClient }) {
  const [open, setOpen] = useState(false);
  const [catalog, setCatalog] = useState<RepositoryCatalog | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [category, setCategory] = useState<RepositoryPrCategory>('mine');
  const [snapshot, setSnapshot] = useState<RepositoryPrSnapshot | null>(null);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false);
  const [starts, setStarts] = useState<Record<string, number>>({});
  const catalogRequest = useRef(createLatestDetailRequestController());
  const queries = useRef(createRepositoryQueryController(client));
  const invalidate = useCallback(() => { queries.current.reset(); setSnapshot(null); setBusy(false); setStarts({}); setError(''); }, []);
  const loadCatalog = useCallback(() => {
    invalidate(); setCatalog(null); setSelected([]); setLoading(true);
    return catalogRequest.current.request(signal => client.catalog(signal), { success: setCatalog,
      error: value => setError(message(value)), settled: () => setLoading(false) });
  }, [client, invalidate]);
  useEffect(() => {
    queries.current.reset(); queries.current = createRepositoryQueryController(client);
    if (open) void loadCatalog();
    return () => { catalogRequest.current.dispose(); queries.current.reset(); };
  }, [client, open, loadCatalog]);
  const run = (nextStarts = starts) => {
    if (!catalog || !selected.length) return;
    setSnapshot(null); setError(''); setBusy(true); setStarts(nextStarts);
    void queries.current.run(catalog, { repositoryIds: selected, category, catalogRevision: catalog.revision, starts: nextStarts }, {
      success: setSnapshot,
      error: value => {
        setSnapshot(null); setError(message(value));
        if (isApiAuthError(value) || value instanceof RepositoryPrClientError && ['AUTH_REQUIRED', 'FORBIDDEN', 'STALE_CATALOG'].includes(value.code)) {
          setCatalog(null); setSelected([]); setStarts({});
        }
      }, settled: () => setBusy(false),
    });
  };
  return <section className="repo-pr-panel" aria-labelledby="repository-pr-title">
    <div className="repo-pr-heading"><div><h2 id="repository-pr-title">저장소 · PR</h2><p>선택한 저장소의 PR을 읽기 전용으로 조회합니다.</p></div>
      <button type="button" aria-expanded={open} onClick={() => {
        invalidate(); catalogRequest.current.dispose(); setCatalog(null); setSelected([]); setLoading(false); setOpen(v => !v);
      }}>{open ? '저장소 PR 닫기' : '저장소 PR 열기'}</button></div>
    {open ? <div className="repo-pr-content">
      {loading ? <p role="status">저장소 권한을 확인하는 중입니다…</p> : null}
      {catalog?.connection === 'not-configured' ? <p className="repo-pr-notice" role="status">운영 연결 미완료 · 승인된 사내 저장소와 사용자 권한 연결이 필요합니다.</p> : null}
      {catalog?.connection === 'fixture' ? <p className="repo-pr-notice">합성 데이터 · 운영 연결 미완료</p> : null}
      {catalog?.connection === 'unverified' ? <p className="repo-pr-notice">운영 연결 미검증 · 실제 설치·권한 확인은 별도입니다.</p> : null}
      {catalog?.repositories.length ? <fieldset><legend>저장소 선택 · 최대 5개</legend><div className="repo-pr-selection">
        {catalog.repositories.map(repo => <label key={repo.id}><input type="checkbox" checked={selected.includes(repo.id)}
          disabled={!selected.includes(repo.id) && selected.length >= 5} onChange={() => { invalidate();
            setSelected(current => current.includes(repo.id) ? current.filter(id => id !== repo.id) : [...current, repo.id]);
          }} />{repo.label}</label>)}
      </div></fieldset> : catalog && catalog.connection !== 'not-configured' ? <p role="status">현재 계정에 조회 가능한 저장소가 없습니다.</p> : null}
      <div className="repo-pr-controls" role="group" aria-label="PR 목록 종류">
        {(Object.keys(REPOSITORY_PR_LABELS) as RepositoryPrCategory[]).map(value => <button key={value} type="button"
          aria-pressed={category === value} onClick={() => { invalidate(); setCategory(value); }}>{REPOSITORY_PR_LABELS[value]}</button>)}
        <button type="button" disabled={loading || busy || !selected.length} onClick={() => run()}>{busy ? '조회 중…' : 'PR 조회 / 새로고침'}</button>
        <button type="button" disabled={loading} onClick={() => void loadCatalog()}>저장소 목록 다시 읽기</button>
      </div>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {!snapshot && !busy && !error && selected.length ? <p role="status">선택한 저장소와 목록 종류를 확인하고 PR 조회를 누르세요.</p> : null}
      {busy ? <p role="status">{REPOSITORY_PR_LABELS[category]} 조회 중…</p> : null}
      {snapshot ? <div aria-live="polite"><p className="repo-pr-source">조회 페이지 기준 · {new Date(snapshot.observedAt).toLocaleString('ko-KR')} · 결과 {snapshot.revision.slice(0, 12)}</p>
        {snapshot.batches.map(batch => <section className="repo-pr-batch" key={batch.repository.id} aria-label={`${batch.repository.label} PR 결과`}>
          <h3>{batch.repository.label} · {REPOSITORY_PR_LABELS[snapshot.category]}</h3>
          {!batch.items.length ? <p>현재 조회 페이지에 해당 PR이 없습니다.</p> : null}
          <div className="repo-pr-items">{batch.items.map(item => <article className="core-job-card repo-pr-item" key={item.id}>
            <h4>#{item.id} {item.title}</h4><p>{item.state === 'MERGED' ? '병합됨' : '열림'} · PR v{item.version}</p>
            <a href={item.source.webUrl} target="_blank" rel="noopener noreferrer">검증된 PR 열기 ↗</a>
            <details><summary>revision · 출처 보기</summary><dl>
              <dt>source commit</dt><dd><code>{item.sourceCommit}</code></dd><dt>target commit</dt><dd><code>{item.targetCommit}</code></dd>
              <dt>조회 출처</dt><dd>{item.source.apiUrl}</dd><dt>확인 기준</dt><dd>API 저장소·PR identity 대조 · {item.source.observedAt}</dd>
            </dl></details>
          </article>)}</div>
          {batch.nextStart !== undefined ? <button type="button" disabled={busy} onClick={() => run({ ...starts, [batch.repository.id]: batch.nextStart! })}>{batch.repository.label} 다음 페이지</button> : null}
        </section>)}
        {Object.values(starts).some(v => v > 0) ? <button type="button" disabled={busy} onClick={() => run({})}>처음 페이지</button> : null}
      </div> : null}
    </div> : null}
  </section>;
}
