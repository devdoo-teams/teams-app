import type { CoreOrchestrationJob } from '../shared/core-orchestration.js';
import type { VisibleJobConversation, VisibleJobTurn } from '../shared/job-conversation.js';
import { projectReceiptFacts } from '../shared/receipt-presentation.js';
import type { ConversationReadingPosition } from './conversation-reading-position.js';

export const JOB_CONVERSATION_PAGE_SIZE = 20;

/** Older-parent 404 is consumed as recoverable missing history by the loader.
 * A thrown 404 comes from selected/boundary owner revalidation and clears cache. */
export function isConversationHistoryAccessFailure(error: unknown): boolean {
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
  return status === 401 || status === 403 || status === 404;
}

type ConversationHistoryViewState = Readonly<{
  conversation?: VisibleJobConversation;
  position?: ConversationReadingPosition;
  accessBlocked?: boolean;
}>;

/** In-memory exact-response identity scope. A denied scope cannot be revived by
 * layout callbacks or remount; only a subsequent authenticated success unlocks it. */
export function createConversationHistoryViewCache() {
  const states = new WeakMap<VisibleJobConversation, ConversationHistoryViewState>();
  return {
    read: (source: VisibleJobConversation) => states.get(source),
    remember(source: VisibleJobConversation, state: ConversationHistoryViewState) {
      if (!states.get(source)?.accessBlocked) states.set(source, state);
    },
    block(source: VisibleJobConversation) { states.set(source, { accessBlocked: true }); },
    authorize(source: VisibleJobConversation, state: ConversationHistoryViewState) { states.set(source, state); },
  };
}
const MAX_TEXT = 8192;
function visibleText(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(api[_-]?key|access[_-]?token|password|client[_-]?secret)\s*[:=]\s*["']?[^\s"',;]+/gi, '$1=[REDACTED]')
    .slice(0, MAX_TEXT);
}
function visibleTurn(job: CoreOrchestrationJob): VisibleJobTurn {
  const text = [job.prompt, job.result ?? '', job.error ?? '', ...job.progress];
  return {
    receiptFacts: projectReceiptFacts(job),
    ...(job.pendingOperation ? { pendingOperation: { ...job.pendingOperation } } : {}),
    jobId: job.id, request: visibleText(job.prompt), status: job.status,
    ...(job.result ? { response: visibleText(job.result) } : {}),
    ...(job.error ? { error: visibleText(job.error) } : {}),
    progress: job.progress.slice(-20).map(visibleText),
    tools: (job.tools ?? []).slice(-30).map(tool => ({ category: tool.category, name: visibleText(tool.name), observedAt: tool.observedAt, ...(tool.execution ? {execution:{...tool.execution}} : {}) })),
    createdAt: job.createdAt,
    truncated: text.some(value => value.length > MAX_TEXT) || job.progress.length > 20 || (job.tools?.length ?? 0) > 30,
  };
}

/** Refresh only the selected turn from an already authenticated job response. */
export function refreshVisibleJobConversation(conversation: VisibleJobConversation, job: CoreOrchestrationJob): VisibleJobConversation {
  if (conversation.selectedJobId !== job.id) return conversation;
  return { ...conversation, turns: conversation.turns.map(turn => turn.jobId === job.id ? visibleTurn(job) : turn) };
}

/** A fresh first page/poll updates existing turns without discarding deliberately loaded history. */
export function mergeVisibleJobConversation(loaded: VisibleJobConversation, latest: VisibleJobConversation): VisibleJobConversation {
  if (loaded.selectedJobId !== latest.selectedJobId || latest.unavailableReason === 'invalid-chain'
    || latest.unavailableReason === 'previous-turn-unavailable') return latest;
  const incoming = new Map(latest.turns.map(turn => [turn.jobId, turn]));
  const loadedIds = new Set(loaded.turns.map(turn => turn.jobId));
  if (latest.turns.some(turn => !loadedIds.has(turn.jobId))) return latest;
  return { ...loaded, turns: loaded.turns.map(turn => incoming.get(turn.jobId) ?? turn) };
}

type GetJob = (id: string, signal?: AbortSignal) => Promise<CoreOrchestrationJob>;

function relatedJob(reference: CoreOrchestrationJob, candidate: CoreOrchestrationJob): boolean {
  const provider = reference.provider ?? 'codex';
  if (provider !== (candidate.provider ?? 'codex') || reference.mode !== candidate.mode) return false;
  // AgentService deliberately starts a new native ephemeral session for read-only Codex
  // continuation. Logical ancestry remains server-owned parentJobId, not native threadId.
  if (provider === 'codex' && reference.mode === 'read-only') return true;
  return !reference.threadId || reference.threadId === candidate.threadId;
}

function pageResult(selectedJobId: string, turns: readonly VisibleJobTurn[], current: CoreOrchestrationJob,
  unavailableReason?: VisibleJobConversation['unavailableReason']): VisibleJobConversation {
  return { selectedJobId, turns, complete: !unavailableReason,
    ...(unavailableReason ? { unavailableReason } : {}),
    ...(unavailableReason && unavailableReason !== 'invalid-chain' && current.parentJobId
      ? { earlierBeforeJobId: current.id } : {}),
  };
}

async function readEarlierPage(selected: CoreOrchestrationJob, boundary: CoreOrchestrationJob,
  getJob: GetJob, existing: readonly VisibleJobTurn[], signal?: AbortSignal,
  pageSize = JOB_CONVERSATION_PAGE_SIZE): Promise<VisibleJobConversation> {
  const seen = new Set(existing.map(turn => turn.jobId));
  const page: VisibleJobTurn[] = [];
  let current = boundary;
  let unavailableReason: VisibleJobConversation['unavailableReason'];
  while (current.parentJobId) {
    signal?.throwIfAborted();
    if (seen.has(current.parentJobId)) { unavailableReason = 'invalid-chain'; break; }
    if (page.length >= pageSize) { unavailableReason = 'turn-limit'; break; }
    const expectedParent = current.parentJobId;
    try {
      const previous = await getJob(expectedParent, signal);
      signal?.throwIfAborted();
      if (previous.id !== expectedParent || !relatedJob(selected, previous) || !relatedJob(current, previous)) {
        unavailableReason = 'invalid-chain'; break;
      }
      seen.add(previous.id);
      page.unshift(visibleTurn(previous));
      current = previous;
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
        unavailableReason = 'previous-turn-unavailable'; break;
      }
      throw error;
    }
  }
  return pageResult(selected.id, [...page, ...existing], current, unavailableReason);
}

/** Deliberate bounded read through the existing authenticated owner API. Revalidate
 * selected/boundary ownership, then follow only the boundary's server-returned parent. */
export async function loadEarlierJobConversation(conversation: VisibleJobConversation, getJob: GetJob,
  signal?: AbortSignal): Promise<VisibleJobConversation> {
  signal?.throwIfAborted();
  if (conversation.complete || conversation.unavailableReason === 'invalid-chain') return conversation;
  const boundaryId = conversation.turns[0]?.jobId;
  const invalid = (): VisibleJobConversation => ({ selectedJobId: conversation.selectedJobId,
    turns: conversation.turns, complete: false, unavailableReason: 'invalid-chain' });
  if (!boundaryId || conversation.turns.at(-1)?.jobId !== conversation.selectedJobId
    || new Set(conversation.turns.map(turn => turn.jobId)).size !== conversation.turns.length
    || (conversation.earlierBeforeJobId && conversation.earlierBeforeJobId !== boundaryId)) return invalid();
  const selected = await getJob(conversation.selectedJobId, signal);
  signal?.throwIfAborted();
  if (selected.id !== conversation.selectedJobId) return invalid();
  const boundary = boundaryId === selected.id ? selected : await getJob(boundaryId, signal);
  signal?.throwIfAborted();
  if (boundary.id !== boundaryId || !relatedJob(selected, boundary)) return invalid();
  return readEarlierPage(selected, boundary, getJob, conversation.turns, signal);
}

/** Each turn is fetched through the existing authenticated, owner-scoped API.
 * No raw CLI files, reasoning events, or caller-selected thread IDs are read. */
export async function loadJobConversation(
  selectedJobId: string,
  getJob: GetJob,
  signal?: AbortSignal,
): Promise<{ job: CoreOrchestrationJob; conversation: VisibleJobConversation }> {
  signal?.throwIfAborted();
  const job = await getJob(selectedJobId, signal);
  signal?.throwIfAborted();
  if (job.id !== selectedJobId) throw new Error('선택한 작업의 대화 응답을 확인할 수 없습니다.');
  // One selected turn plus at most 19 parents; later explicit pages add at most 20.
  return { job, conversation: await readEarlierPage(job, job, getJob, [visibleTurn(job)], signal, JOB_CONVERSATION_PAGE_SIZE - 1) };
}
