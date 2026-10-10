import type { CoreOrchestrationJob } from '../shared/core-orchestration.js';

/** The caller resolves the job under authenticated principal/conversation authority first. */
export function coreJobDialogResponse(value: unknown, job: CoreOrchestrationJob | undefined,
  publicOrigin: string, available: boolean) {
  const denied = { task: { type: 'message' as const, value: '이 작업의 상세를 열 수 없습니다. 기존 개인 작업 화면에서 권한과 상태를 확인하세요.' } };
  if (!available || !job || !value || typeof value !== 'object' || Array.isArray(value)) return denied;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['dialog_id', 'jobId', 'msteams'].includes(key))
    || input.dialog_id !== 'core-job-detail' || input.jobId !== job.id
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(job.id)) return denied;
  let origin: URL;
  try { origin = new URL(publicOrigin); } catch { return denied; }
  if (origin.origin !== publicOrigin || origin.protocol !== 'https:' || origin.username || origin.password) return denied;
  const url = new URL('/tabs/copilot-ui/', origin);
  url.searchParams.set('jobId', job.id); url.searchParams.set('surface', 'dialog');
  const fallback = new URL('/tabs/home/', origin); fallback.searchParams.set('view', 'core'); fallback.searchParams.set('jobId', job.id);
  return { task: { type: 'continue' as const, value: { title: '업무 허브 · 같은 작업의 대화·상세',
    width: 'large' as const, height: 'large' as const, url: url.toString(), fallbackUrl: fallback.toString() } } };
}
