import crypto from 'node:crypto';
import { REPOSITORY_PR_LABELS, RepositoryPrSnapshotSchema, repositoryPrSnapshotContent, type RepositoryPrSnapshot } from '../shared/repository-pr.js';

const nativeText = (value: string) => value.replace(/https?:\/\/\S+/giu, '[주소 생략]').replace(/[\\[\]()*_`<>]/gu, '\\$&');
/** Projection only. Caller must have just authorized the owner; never sends a card. */
export function repositoryPrCard(input: RepositoryPrSnapshot) {
  const snapshot = RepositoryPrSnapshotSchema.parse(input);
  if (crypto.createHash('sha256').update(repositoryPrSnapshotContent(snapshot)).digest('hex') !== snapshot.revision) throw new Error('Repository snapshot revision mismatch');
  const rows = snapshot.batches.flatMap(b => b.items.map(item => ({ repository: b.repository, item }))).slice(0, 3);
  return { type: 'AdaptiveCard' as const, version: '1.6',
    body: [
      { type: 'TextBlock', text: `${REPOSITORY_PR_LABELS[snapshot.category]} · 조회 시점 ${snapshot.observedAt}`, wrap: true },
      { type: 'TextBlock', text: snapshot.connection === 'fixture' ? '합성 데이터 · 운영 연결 미완료' : '운영 연결 미검증', wrap: true },
      ...rows.flatMap(({ repository, item }) => [
        { type: 'TextBlock', text: `${nativeText(repository.label)} · #${item.id} ${nativeText(item.title)}`, wrap: true },
        { type: 'TextBlock', text: `PR v${item.version} · head ${item.sourceCommit} · base ${item.targetCommit}`, wrap: true },
        ...(!item.source.webUrl ? [{ type: 'TextBlock', text: 'PR 웹주소 미검증', wrap: true }] : []),
      ]),
      ...(!rows.length ? [{ type: 'TextBlock', text: '현재 조회 페이지에 해당 PR이 없습니다.', wrap: true }] : []),
    ],
    actions: rows.flatMap(({ repository, item }) => item.source.webUrl && item.source.linkVerification === 'api-identity'
      ? [{ type: 'Action.OpenUrl', title: `${nativeText(repository.label).slice(0, 25)} #${item.id}`, url: item.source.webUrl }] : []),
  };
}
