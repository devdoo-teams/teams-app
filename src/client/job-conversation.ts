import type { CoreOrchestrationJob } from '../shared/core-orchestration.js';
import type { VisibleJobConversation, VisibleJobTurn } from '../shared/job-conversation.js';

const MAX_TURNS = 20;
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
    jobId: job.id, request: visibleText(job.prompt), status: job.status,
    ...(job.result ? { response: visibleText(job.result) } : {}),
    ...(job.error ? { error: visibleText(job.error) } : {}),
    progress: job.progress.slice(-20).map(visibleText),
    tools: (job.tools ?? []).slice(-30).map(tool => ({ category: tool.category, name: visibleText(tool.name), observedAt: tool.observedAt })),
    createdAt: job.createdAt,
    truncated: text.some(value => value.length > MAX_TEXT) || job.progress.length > 20 || (job.tools?.length ?? 0) > 30,
  };
}

/** Refresh only the selected turn from an already authenticated job response. */
export function refreshVisibleJobConversation(conversation: VisibleJobConversation, job: CoreOrchestrationJob): VisibleJobConversation {
  if (conversation.selectedJobId !== job.id) return conversation;
  return { ...conversation, turns: conversation.turns.map(turn => turn.jobId === job.id ? visibleTurn(job) : turn) };
}

/** Each turn is fetched through the existing authenticated, owner-scoped API.
 * No raw CLI files, reasoning events, or caller-selected thread IDs are read. */
export async function loadJobConversation(
  selectedJobId: string,
  getJob: (id: string, signal?: AbortSignal) => Promise<CoreOrchestrationJob>,
  signal?: AbortSignal,
): Promise<{ job: CoreOrchestrationJob; conversation: VisibleJobConversation }> {
  const job = await getJob(selectedJobId, signal);
  const turns: VisibleJobTurn[] = [];
  const seen = new Set<string>();
  let current = job;
  let unavailableReason: VisibleJobConversation['unavailableReason'];
  while (true) {
    signal?.throwIfAborted();
    if (seen.has(current.id)) { unavailableReason = 'invalid-chain'; break; }
    seen.add(current.id);
    turns.unshift(visibleTurn(current));
    if (!current.parentJobId) break;
    if (turns.length >= MAX_TURNS) { unavailableReason = 'turn-limit'; break; }
    const expectedParent = current.parentJobId;
    try {
      const previous = await getJob(expectedParent, signal);
      if (previous.id !== expectedParent || (job.threadId && previous.threadId && job.threadId !== previous.threadId)) {
        unavailableReason = 'invalid-chain'; break;
      }
      current = previous;
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
        unavailableReason = 'previous-turn-unavailable'; break;
      }
      throw error;
    }
  }
  return { job, conversation: { selectedJobId, turns, complete: !unavailableReason, ...(unavailableReason ? { unavailableReason } : {}) } };
}
