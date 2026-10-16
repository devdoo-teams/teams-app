import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\u0000-\u001f\u007f]+$/u);
const id = text(64).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u).refine(v => !['constructor', 'prototype'].includes(v));
const segment = text(128).regex(/^[a-zA-Z0-9_~.-]+$/u).refine(v => v !== '.' && v !== '..');
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const commit = z.string().regex(/^[a-f0-9]{40}$/u);
const date = z.string().datetime();
export const REPOSITORY_PR_LABELS = { mine: '내 PR', review: '검토할 PR', merged: '최근 병합' } as const;
export const RepositoryPrCategorySchema = z.enum(['mine', 'review', 'merged']);
export type RepositoryPrCategory = z.infer<typeof RepositoryPrCategorySchema>;
export const RepositoryPrincipalSchema = z.object({ tenantId: text(256), requesterId: text(256) }).strict();
export type RepositoryPrincipal = z.infer<typeof RepositoryPrincipalSchema>;
export const RepositoryBaseUrlSchema = text(1024).refine(value => {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash
      && u.href.replace(/\/$/u, '') === value && !['bitbucket.org', 'api.bitbucket.org'].includes(u.hostname)
      && u.pathname.split('/').every(s => s === '' || /^[a-zA-Z0-9_~.-]+$/u.test(s) && s !== '.' && s !== '..');
  } catch { return false; }
});
export const RepositoryDescriptorSchema = z.object({ id, label: text(80), provider: z.literal('bitbucket-dc'),
  baseUrl: RepositoryBaseUrlSchema, projectKey: segment, slug: segment, remoteId: z.number().int().positive() }).strict();
export type RepositoryDescriptor = z.infer<typeof RepositoryDescriptorSchema>;
export const RepositoryGrantSchema = RepositoryPrincipalSchema.extend({ repositoryId: id, revision: text(256),
  user: z.object({ id: z.number().int().positive(), name: text(128) }).strict() }).strict();
export type RepositoryGrant = z.infer<typeof RepositoryGrantSchema>;
export const RepositoryCatalogSchema = z.object({ scopeKey: digest, revision: digest,
  connection: z.enum(['not-configured', 'fixture', 'unverified']),
  repositories: z.array(RepositoryDescriptorSchema).max(20) }).strict();
export type RepositoryCatalog = z.infer<typeof RepositoryCatalogSchema>;
export const RepositoryPrRequestSchema = z.object({ repositoryIds: z.array(id).min(1).max(5),
  category: RepositoryPrCategorySchema, catalogRevision: digest,
  starts: z.record(id, z.number().int().min(0).max(1_000_000)).optional() }).strict().superRefine((v, ctx) => {
  if (new Set(v.repositoryIds).size !== v.repositoryIds.length || Object.keys(v.starts ?? {}).some(k => !v.repositoryIds.includes(k))) {
    ctx.addIssue({ code: 'custom', message: 'Invalid repository selection or page scope' });
  }
});
export type RepositoryPrRequest = z.infer<typeof RepositoryPrRequestSchema>;
export function repositoryPrUrls(repo: RepositoryDescriptor, prId: number) {
  const suffix = `/projects/${encodeURIComponent(repo.projectKey)}/repos/${encodeURIComponent(repo.slug)}/pull-requests/${prId}`;
  return { apiUrl: `${repo.baseUrl}/rest/api/latest${suffix}`, webUrl: `${repo.baseUrl}${suffix}/overview` };
}
/** Accept only a provider-supplied self link for this exact approved origin/repo/PR. */
export function verifiedRepositoryPrWebUrl(repo: RepositoryDescriptor, prId: number, value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const expected = repositoryPrUrls(repo, prId).webUrl;
  return value === expected || value === expected.replace(/\/overview$/u, '') ? value : undefined;
}
export const RepositoryPrItemSchema = z.object({ repositoryId: id, id: z.number().int().positive(), version: z.number().int().nonnegative(),
  title: text(300), state: z.enum(['OPEN', 'MERGED']), sourceCommit: commit, targetCommit: commit, updatedAt: date, closedAt: date.optional(),
  source: z.object({ apiUrl: text(2048), webUrl: text(2048).optional(), linkVerification: z.enum(['api-identity', 'unverified']),
    contract: z.literal('bitbucket-dc-rest-10.5'), observedAt: date }).strict() }).strict();
export type RepositoryPrItem = z.infer<typeof RepositoryPrItemSchema>;
export const RepositoryPrBatchSchema = z.object({ repository: RepositoryDescriptorSchema, items: z.array(RepositoryPrItemSchema).max(20),
  start: z.number().int().min(0).max(1_000_000), nextStart: z.number().int().min(1).max(1_000_000).optional() }).strict().superRefine((v, ctx) => {
  if (v.nextStart !== undefined && v.nextStart <= v.start || new Set(v.items.map(i => i.id)).size !== v.items.length
    || v.items.some(i => i.repositoryId !== v.repository.id || repositoryPrUrls(v.repository, i.id).apiUrl !== i.source.apiUrl
      || (i.source.linkVerification === 'api-identity'
        ? !i.source.webUrl || verifiedRepositoryPrWebUrl(v.repository, i.id, i.source.webUrl) !== i.source.webUrl
        : i.source.webUrl !== undefined))) {
    ctx.addIssue({ code: 'custom', message: 'Repository source identity mismatch' });
  }
});
export type RepositoryPrBatch = z.infer<typeof RepositoryPrBatchSchema>;
export const RepositoryPrSnapshotSchema = z.object({ scopeKey: digest, catalogRevision: digest, revision: digest,
  connection: z.enum(['fixture', 'unverified']), category: RepositoryPrCategorySchema, repositoryIds: z.array(id).min(1).max(5),
  batches: z.array(RepositoryPrBatchSchema).min(1).max(5), observedAt: date }).strict().superRefine((v, ctx) => {
  if (new Set(v.repositoryIds).size !== v.repositoryIds.length || v.batches.length !== v.repositoryIds.length
    || v.batches.some((b, i) => b.repository.id !== v.repositoryIds[i])) ctx.addIssue({ code: 'custom', message: 'Snapshot selection mismatch' });
});
export type RepositoryPrSnapshot = z.infer<typeof RepositoryPrSnapshotSchema>;
export function repositoryPrSnapshotContent(input: RepositoryPrSnapshot): string {
  const { revision: _revision, ...content } = RepositoryPrSnapshotSchema.parse(input);
  return JSON.stringify(content);
}
