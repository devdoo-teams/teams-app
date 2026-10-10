import { CORE_AGENT_PROMPT_MAX_LENGTH, type CoreOrchestrationJob } from '../shared/core-orchestration.js';
import { createExecutionPresentation, ExecutionPresentationJobIdSchema } from '../shared/execution-presentation.js';
import type { VisibleJobConversation } from '../shared/job-conversation.js';
import type { CoreOrchestrationClient } from './core-orchestration-client.js';
import { loadJobConversation } from './job-conversation.js';
import { isApiAuthError } from './auth.js';

export type CoreConversationState = Readonly<{
  jobId: string; phase: 'idle' | 'loading' | 'ready' | 'sending' | 'blocked';
  job?: CoreOrchestrationJob; conversation?: VisibleJobConversation; error?: string; uncertain: boolean; submittedPrompt?: string;
}>;
export function canContinueConversation(state: CoreConversationState): boolean {
  return state.phase === 'ready' && !state.uncertain && Boolean(state.job &&
    ['completed', 'failed', 'cancelled'].includes(state.job.status));
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
  if (outcome === 'invalid' || (outcome === 'failed' && !controller.getState().uncertain)) ui.setInput(prompt);
  if (outcome === 'invalid') ui.setValidation('현재 작업의 실행 조건을 확인하고 대화를 새로고침하세요.');
}

/** Display reads and explicit user sends are different operations. No agent,
 * provider, owner, approval or execution policy is supplied by this controller. */
export function createCoreConversationController({ client, jobId, onChange, timeoutMs = 30_000 }: {
  client: Pick<CoreOrchestrationClient, 'getJob' | 'getJobConversation' | 'continueJob'>;
  jobId: string; onChange: (state: CoreConversationState) => void; timeoutMs?: number;
}) {
  ExecutionPresentationJobIdSchema.parse(jobId);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid conversation timeout');
  let state: CoreConversationState = { jobId, phase: 'idle', uncertain: false };
  let disposed = false, busy = false;
  let active: AbortController | undefined;
  const publish = (next: CoreConversationState) => { if (!disposed) { state = next; onChange(next); } };
  const operation = async (work: (signal: AbortSignal) => Promise<void>): Promise<Result> => {
    if (disposed) return 'disposed';
    if (busy) return 'busy';
    busy = true;
    const abort = new AbortController(); active = abort;
    const timer = globalThis.setTimeout(() => abort.abort(), timeoutMs);
    try {
      await Promise.race([work(abort.signal), new Promise<never>((_, reject) => {
        abort.signal.addEventListener('abort', () => reject(new DOMException('Conversation operation ended', 'AbortError')), { once: true });
      })]);
      return disposed ? 'disposed' : 'succeeded';
    } catch (error) {
      if (disposed) return 'disposed';
      const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
      const sending = state.phase === 'sending';
      const uncertain = state.uncertain || (sending && (typeof status !== 'number' || status >= 500));
      publish({ jobId: state.jobId, phase: 'blocked', uncertain, submittedPrompt: sending || uncertain ? state.submittedPrompt : undefined,
        error: status === 403 ? '현재 계정에는 이 작업을 볼 권한이 없습니다.'
          : status === 401 || isApiAuthError(error) ? 'Teams 인증이 만료되었습니다. 개인 작업에서 다시 인증해 주세요.'
          : uncertain ? '전송 결과를 확인하지 못했습니다. 다시 보내지 말고 개인 작업 목록에서 새 작업을 확인하세요.'
          : sending ? '후속 요청을 처리하지 못했습니다. 개인 작업에서 실행 조건을 확인하세요.'
          : '대화를 불러오지 못했습니다. 대화 새로고침으로 다시 확인하세요.' });
      return 'failed';
    } finally { clearTimeout(timer); if (active === abort) active = undefined; busy = false; }
  };
  const assertCurrent = (signal: AbortSignal) => { signal.throwIfAborted(); if (disposed) throw new DOMException('Disposed', 'AbortError'); };
  const load = (): Promise<Result> => operation(async signal => {
    const id = state.jobId;
    publish({ jobId: id, phase: 'loading', uncertain: state.uncertain, submittedPrompt: state.uncertain ? state.submittedPrompt : undefined });
    const loaded = client.getJobConversation ? await client.getJobConversation(id, signal)
      : await loadJobConversation(id, client.getJob, signal);
    assertCurrent(signal);
    if (loaded.job.id !== id || loaded.conversation.selectedJobId !== id) throw new Error('Invalid owner-scoped conversation');
    createExecutionPresentation(loaded.job);
    publish({ ...loaded, jobId: id, phase: 'ready', uncertain: state.uncertain, submittedPrompt: state.uncertain ? state.submittedPrompt : undefined });
  });
  const send = (prompt: string): Promise<Result> => {
    if (disposed) return Promise.resolve('disposed');
    if (busy) return Promise.resolve('busy');
    if (!canContinueConversation(state) || !prompt.trim() || prompt.length > CORE_AGENT_PROMPT_MAX_LENGTH) return Promise.resolve('invalid');
    const previous = state.job!;
    return operation(async signal => {
      publish({ ...state, phase: 'sending', error: undefined, submittedPrompt: prompt.trim() });
      const { job } = await client.continueJob(previous.id, prompt.trim(), signal);
      assertCurrent(signal);
      const ephemeral = (previous.provider ?? 'codex') === 'codex' && previous.mode === 'read-only';
      if (!ExecutionPresentationJobIdSchema.safeParse(job?.id).success || job.id === previous.id || job.parentJobId !== previous.id
        || (job.provider ?? 'codex') !== (previous.provider ?? 'codex') || job.mode !== previous.mode
        || (!ephemeral && previous.threadId && job.threadId && previous.threadId !== job.threadId)) throw new Error('Unconfirmed continuation response');
      createExecutionPresentation(job);
      publish({ jobId: job.id, job, phase: 'ready', uncertain: false });
    });
  };
  return { load, send, getState: () => state, dispose() { if (disposed) return; disposed = true; active?.abort(); } };
}
