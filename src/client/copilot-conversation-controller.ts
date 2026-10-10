import { CORE_AGENT_PROMPT_MAX_LENGTH, type CoreOrchestrationJob } from '../shared/core-orchestration.js';
import { createExecutionPresentation, ExecutionPresentationJobIdSchema } from '../shared/execution-presentation.js';
import type { VisibleJobConversation } from '../shared/job-conversation.js';
import type { CoreOrchestrationClient } from './core-orchestration-client.js';
import { loadJobConversation, loadEarlierJobConversation, mergeVisibleJobConversation, refreshVisibleJobConversation, isConversationHistoryAccessFailure } from './job-conversation.js';
import { isApiAuthError } from './auth.js';

export type CoreConversationState = Readonly<{
  jobId: string; phase: 'idle' | 'loading' | 'ready' | 'sending' | 'stopping' | 'blocked';
  job?: CoreOrchestrationJob; conversation?: VisibleJobConversation; error?: string; uncertain: boolean; submittedPrompt?: string;
  stale?: boolean; stopUncertain?: boolean; loadingEarlier?: boolean; recovery?: 'network' | 'auth-expired' | 'forbidden' | 'conditions';
}>;
export function canContinueConversation(state: CoreConversationState): boolean {
  return state.phase === 'ready' && !state.uncertain && !state.stopUncertain && Boolean(state.job &&
    ['completed', 'failed', 'cancelled'].includes(state.job.status));
}
export function canStopConversation(state: CoreConversationState): boolean {
  return state.phase === 'ready' && !state.uncertain && !state.stopUncertain && Boolean(state.job &&
    ['queued', 'running'].includes(state.job.status));
}
type Result = 'succeeded' | 'failed' | 'busy' | 'invalid' | 'disposed';

export async function submitCoreConversation(controller: ReturnType<typeof createCoreConversationController>, prompt: string,
  ui: { setInput: (value: string) => void; setValidation: (value: string) => void; isCurrent: () => boolean }): Promise<void> {
  ui.setValidation('');
  if (!prompt.trim() || prompt.length > CORE_AGENT_PROMPT_MAX_LENGTH) {
    ui.setValidation(`요청은 1자 이상 ${CORE_AGENT_PROMPT_MAX_LENGTH}자 이하로 입력하세요.`);
    // The SDK clears the controlled input immediately after invoking submit.
    await Promise.resolve();
    if (ui.isCurrent()) ui.setInput(prompt);
    return;
  }
  const outcome = await controller.send(prompt);
  if (!ui.isCurrent()) return;
  if (outcome === 'invalid' || outcome === 'busy' || (outcome === 'failed' && !controller.getState().uncertain)) ui.setInput(prompt);
  if (outcome === 'invalid') ui.setValidation('현재 작업의 실행 조건을 확인하고 대화를 새로고침하세요.');
  if (outcome === 'busy') ui.setValidation('다른 요청을 처리 중입니다. 입력한 요청은 아직 보내지 않았습니다.');
}

/** Display reads and explicit user sends are different operations. No agent,
 * provider, owner, approval or execution policy is supplied by this controller. */
export function createCoreConversationController({ client, jobId, onChange, timeoutMs = 30_000 }: {
  client: Pick<CoreOrchestrationClient, 'getJob' | 'getJobConversation' | 'continueJob'> & Partial<Pick<CoreOrchestrationClient, 'cancelJob'>>;
  jobId: string; onChange: (state: CoreConversationState) => void; timeoutMs?: number;
}) {
  ExecutionPresentationJobIdSchema.parse(jobId);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid conversation timeout');
  let state: CoreConversationState = { jobId, phase: 'idle', uncertain: false };
  let disposed = false, busy = false;
  let active: AbortController | undefined;
  const publish = (next: CoreConversationState) => { if (!disposed) { state = next; onChange(next); } };
  const operation = async (kind: 'load' | 'send' | 'stop', work: (signal: AbortSignal) => Promise<void>): Promise<Result> => {
    if (disposed) return 'disposed';
    if (busy) return 'busy';
    busy = true;
    const abort = new AbortController(); active = abort;
    const timer = globalThis.setTimeout(() => abort.abort(), timeoutMs);
    let onAbort: (() => void) | undefined;
    try {
      await Promise.race([work(abort.signal), new Promise<never>((_, reject) => {
        onAbort = () => reject(new DOMException('Conversation operation ended', 'AbortError'));
        if (abort.signal.aborted) onAbort();
        else abort.signal.addEventListener('abort', onAbort, { once: true });
      })]);
      return disposed ? 'disposed' : 'succeeded';
    } catch (error) {
      if (disposed) return 'disposed';
      const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
      const auth = isApiAuthError(error) ? error.kind : status === 401 ? 'auth-expired'
        : status === 403 || (kind === 'load' && isConversationHistoryAccessFailure(error)) ? 'forbidden' : undefined;
      // SSO failures happen before the mutation or are definitive HTTP rejects.
      // A transport/server failure after a mutation may have lost its receipt.
      const ambiguous = !auth && (typeof status !== 'number' || status >= 500);
      const uncertain = state.uncertain || (kind === 'send' && ambiguous);
      const stopUncertain = state.stopUncertain || (kind === 'stop' && ambiguous);
      const keepConfirmed = !auth && kind !== 'send' && ambiguous;
      publish({ ...(keepConfirmed ? state : { jobId: state.jobId }), phase: 'blocked', uncertain, stopUncertain,
        loadingEarlier: false,
        stale: keepConfirmed && Boolean(state.conversation), recovery: auth ?? (ambiguous ? 'network' : 'conditions'),
        submittedPrompt: kind === 'send' || uncertain ? state.submittedPrompt : undefined,
        error: auth === 'forbidden' ? '현재 계정에는 이 작업을 볼 권한이 없습니다.'
          : auth === 'auth-expired' ? 'Teams 인증이 만료되었습니다. 개인 작업에서 다시 인증해 주세요.'
          : uncertain ? '전송 결과를 확인하지 못했습니다. 다시 보내지 말고 개인 작업 목록에서 새 작업을 확인하세요.'
          : stopUncertain ? '중지 결과를 확인하지 못했습니다. 중지를 다시 보내지 말고 상태를 새로고침하세요.'
          : kind === 'stop' ? '중지 요청을 처리하지 못했습니다. 상태를 새로고침해 실행 조건을 확인하세요.'
          : kind === 'send' ? '후속 요청을 처리하지 못했습니다. 개인 작업에서 실행 조건을 확인하세요.'
          : '대화를 불러오지 못했습니다. 대화 새로고침으로 다시 확인하세요.' });
      return 'failed';
    } finally {
      clearTimeout(timer); if (onAbort) abort.signal.removeEventListener('abort', onAbort);
      if (active === abort) active = undefined; busy = false;
    }
  };
  const assertCurrent = (signal: AbortSignal) => { signal.throwIfAborted(); if (disposed) throw new DOMException('Disposed', 'AbortError'); };
  const load = (): Promise<Result> => operation('load', async signal => {
    const id = state.jobId;
    const previousConversation = state.conversation;
    publish({ ...state, phase: 'loading', loadingEarlier: false, error: undefined, submittedPrompt: state.uncertain ? state.submittedPrompt : undefined });
    const loaded = client.getJobConversation ? await client.getJobConversation(id, signal)
      : await loadJobConversation(id, client.getJob, signal);
    assertCurrent(signal);
    if (loaded.job.id !== id || loaded.conversation.selectedJobId !== id) {
      publish({ jobId: id, phase: 'loading', uncertain: state.uncertain });
      throw new Error('Invalid owner-scoped conversation');
    }
    createExecutionPresentation(loaded.job);
    const stopUncertain = Boolean(state.stopUncertain && !['completed', 'failed', 'cancelled'].includes(loaded.job.status));
    publish({ ...loaded, conversation: previousConversation ? mergeVisibleJobConversation(previousConversation, loaded.conversation) : loaded.conversation,
      jobId: id, phase: 'ready', uncertain: state.uncertain, stopUncertain, stale: false, loadingEarlier: false,
      submittedPrompt: state.uncertain ? state.submittedPrompt : undefined });
  });
  const loadEarlier = (): Promise<Result> => {
    if (disposed) return Promise.resolve('disposed');
    if (busy) return Promise.resolve('busy');
    if (state.phase !== 'ready' || !state.conversation || state.conversation.complete
      || state.conversation.unavailableReason === 'invalid-chain') return Promise.resolve('invalid');
    const previousConversation = state.conversation;
    return operation('load', async signal => {
      publish({ ...state, phase: 'loading', loadingEarlier: true, error: undefined });
      const conversation = await loadEarlierJobConversation(previousConversation, client.getJob, signal);
      assertCurrent(signal);
      if (conversation.selectedJobId !== state.jobId) throw new Error('Invalid owner-scoped earlier conversation');
      publish({ ...state, conversation, phase: 'ready', loadingEarlier: false, stale: false, recovery: undefined });
    });
  };
  const send = (prompt: string): Promise<Result> => {
    if (disposed) return Promise.resolve('disposed');
    if (busy) return Promise.resolve('busy');
    if (!canContinueConversation(state) || !prompt.trim() || prompt.length > CORE_AGENT_PROMPT_MAX_LENGTH) return Promise.resolve('invalid');
    const previous = state.job!;
    return operation('send', async signal => {
      const previousConversation = state.conversation;
      publish({ ...state, phase: 'sending', error: undefined, submittedPrompt: prompt.trim() });
      const { job } = await client.continueJob(previous.id, prompt.trim(), signal);
      assertCurrent(signal);
      const ephemeral = (previous.provider ?? 'codex') === 'codex' && previous.mode === 'read-only';
      if (!ExecutionPresentationJobIdSchema.safeParse(job?.id).success || job.id === previous.id || job.parentJobId !== previous.id
        || (job.provider ?? 'codex') !== (previous.provider ?? 'codex') || job.mode !== previous.mode
        || (!ephemeral && previous.threadId && job.threadId && previous.threadId !== job.threadId)) throw new Error('Unconfirmed continuation response');
      createExecutionPresentation(job);
      const child = refreshVisibleJobConversation({ selectedJobId: job.id, complete: true, turns: [{ jobId: job.id,
        request: '', status: job.status, progress: [], tools: [], createdAt: job.createdAt, truncated: false }] }, job);
      publish({ jobId: job.id, job, conversation: { ...previousConversation, selectedJobId: job.id,
        complete: previousConversation?.complete ?? false, turns: [...(previousConversation?.turns ?? []), ...child.turns] },
        phase: 'ready', uncertain: false, stale: false, stopUncertain: false });
    });
  };
  const stop = (): Promise<Result> => {
    if (disposed) return Promise.resolve('disposed');
    if (busy) return Promise.resolve('busy');
    if (!canStopConversation(state) || !client.cancelJob) return Promise.resolve('invalid');
    const previous = state.job!;
    return operation('stop', async signal => {
      publish({ ...state, phase: 'stopping', error: undefined });
      const { job } = await client.cancelJob!(previous.id, signal);
      assertCurrent(signal);
      if (job?.id !== previous.id || (job.provider ?? 'codex') !== (previous.provider ?? 'codex') || job.mode !== previous.mode
        || (previous.threadId && job.threadId && previous.threadId !== job.threadId)
        || !['completed', 'failed', 'cancelled'].includes(job.status)) throw new Error('Unconfirmed cancellation response');
      createExecutionPresentation(job);
      publish({ ...state, job, conversation: state.conversation ? refreshVisibleJobConversation(state.conversation, job) : undefined,
        phase: 'ready', uncertain: false, stopUncertain: false, stale: false, recovery: undefined });
    });
  };
  return { load, loadEarlier, send, stop, getState: () => state, dispose() { if (disposed) return; disposed = true; active?.abort(); } };
}
