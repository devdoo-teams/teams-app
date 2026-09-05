import { randomUUID } from 'node:crypto';

import type { AgentJob } from './agent-job-store.js';
import { redactSensitiveText, redactSensitiveValue } from './sensitive-text.js';
import {
  GENUI_SCHEMA_VERSION,
  GenUiEnvelopeV1Schema,
  type GenUiEnvelopeV1,
} from '../shared/genui.js';
import type {
  ResponseEngine,
  ResponseEngineInput,
  ResponseEngineOutput,
  ResponseToolEvent,
} from './response-engine.js';

type TaskToolArgs = {
  items: Array<{ id: number; title: string; status: 'open' | 'done' }>;
  total: number;
  open: number;
  done: number;
};

type ApprovalToolArgs = {
  jobId: string;
  prompt: string;
  action: 'approve' | 'cancel';
};

export type CoreOrchestrationChatCommand =
  | Readonly<{ kind: 'submit'; mode: 'read-only' | 'workspace-write'; prompt: string }>
  | Readonly<{ kind: 'status' | 'cancel' | 'approve' | 'retry'; jobId: string }>
  | Readonly<{ kind: 'list' }>
  | Readonly<{ kind: 'provide-input'; jobId: string; input: string }>;

const CORE_ORCHESTRATION_JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/**
 * Parse the explicit Teams chat namespace used by the Core orchestration
 * facade. The caller must derive tenant/requester/conversation scope from the
 * authenticated Teams activity; no client-controlled scope is accepted here.
 */
export function parseCoreOrchestrationChatCommand(input: string): CoreOrchestrationChatCommand | undefined {
  const match = /^(?:agent|에이전트)\s+(run|write|status|list|cancel|approve|retry|input)(?:\s+([\s\S]+))?$/i.exec(input.trim());
  if (!match) return undefined;
  const operation = match[1]!.toLowerCase();
  const argument = match[2]?.trim() ?? '';

  if (operation === 'list') return argument ? undefined : { kind: 'list' };
  if (operation === 'run' || operation === 'write') {
    if (!argument || argument.length > 2_000) return undefined;
    return {
      kind: 'submit',
      mode: operation === 'write' ? 'workspace-write' : 'read-only',
      prompt: safeText(argument, 2_000),
    };
  }

  const separator = argument.indexOf(' ');
  const jobId = (separator === -1 ? argument : argument.slice(0, separator)).trim();
  if (!CORE_ORCHESTRATION_JOB_ID.test(jobId)) return undefined;
  if (operation === 'input') {
    const providedInput = separator === -1 ? '' : argument.slice(separator + 1).trim();
    if (!providedInput || providedInput.length > 2_000) return undefined;
    return { kind: 'provide-input', jobId, input: safeText(providedInput, 2_000) };
  }
  if (separator !== -1) return undefined;
  return { kind: operation as 'status' | 'cancel' | 'approve' | 'retry', jobId };
}

export function coreOrchestrationCommandHelp(): string {
  return [
    'agent run <작업>',
    'agent write <쓰기 작업>',
    'agent status <작업 ID>',
    'agent list',
    'agent cancel <작업 ID>',
    'agent approve <작업 ID>',
    'agent retry <작업 ID>',
    'agent input <작업 ID> <입력>',
  ].join('\n');
}

function contextValue(input: ResponseEngineInput, keyword: string): unknown {
  const context = input.request.context.find((entry) => entry.description.toLowerCase().includes(keyword));
  if (!context) return undefined;
  try {
    return JSON.parse(context.value) as unknown;
  } catch {
    return undefined;
  }
}

function compactTasks(input: ResponseEngineInput): TaskToolArgs {
  const items = input.itemStore.list();
  return { items, ...input.itemStore.summary() };
}

function formatTasks(tasks: TaskToolArgs): string {
  const openItems = tasks.items.filter((item) => item.status === 'open');
  const body = openItems.length === 0
    ? '진행 중인 업무가 없습니다.'
    : openItems.slice(0, 8).map((item) => `- ${item.title}`).join('\n');
  return `현재 업무 ${tasks.total}개 · 진행 중 ${tasks.open}개 · 완료 ${tasks.done}개\n\n${body}`;
}

function formatJobs(input: ResponseEngineInput): string {
  const jobs = input.agentService.list(input.scope, 5);
  if (jobs.length === 0) return 'Codex 작업이 없습니다.';
  return jobs.map((job) => `- ${job.id}: ${job.status}`).join('\n');
}

function isCodexHistoryRequest(normalized: string): boolean {
  const namesCodex = /(codex|코덱스)/i.test(normalized);
  const asksForHistory = /(?:이력|기록|히스토리|history)/i.test(normalized)
    || /(?:최근|지난).*(?:내용|작업|결과|이력|기록)/i.test(normalized)
    || /\b(?:show|list)\b.*\b(?:recent|latest|jobs?|activity|work|results)\b/i.test(normalized)
    || /\bwhat did\b.*\b(?:recently|lately)\b/i.test(normalized);
  return namesCodex && asksForHistory;
}

function formatJobHistory(input: ResponseEngineInput): string {
  const jobs = input.agentService.list(input.scope, 5);
  if (jobs.length === 0) return 'Codex 작업 이력이 없습니다.';

  const history = jobs.map((job) => {
    const detail = job.result?.trim() || job.error?.trim() || job.progress.at(-1)?.trim() || '아직 결과가 기록되지 않았습니다.';
    return [
      `- ${job.id} · ${job.status}`,
      `요청: ${safeText(job.prompt, 600)}`,
      `내용: ${safeText(detail, 1_000)}`,
    ].join('\n');
  }).join('\n\n');
  // GenUI section descriptions are schema-limited to 2,000 characters. Keep
  // the history response below that limit before the envelope is parsed so a
  // busy workspace cannot turn a read-only lookup into a server error.
  return safeText(history, 1_900);
}

function safeText(value: string, maxLength = 4_000): string {
  return redactSensitiveText(value).slice(0, maxLength);
}

function safeSections(sections: GenUiEnvelopeV1['sections']): GenUiEnvelopeV1['sections'] {
  return redactSensitiveValue(sections) as GenUiEnvelopeV1['sections'];
}

function envelope(input: {
  kind: GenUiEnvelopeV1['kind'];
  id: string;
  title: string;
  text: string;
  status?: GenUiEnvelopeV1['status'];
  sections?: GenUiEnvelopeV1['sections'];
}): GenUiEnvelopeV1 {
  const bounded = safeText(input.text);
  return GenUiEnvelopeV1Schema.parse({
    schemaVersion: GENUI_SCHEMA_VERSION,
    kind: input.kind,
    status: input.status ?? 'ready',
    id: input.id,
    correlationId: randomUUID(),
    title: input.title,
    summary: bounded.slice(0, 2_000),
    sections: input.sections ? safeSections(input.sections) : [{ type: 'text', text: bounded }],
    actions: [],
    citations: [],
    aiGenerated: false,
    fallbackText: bounded,
    metadata: { source: 'teams-core', deterministic: true },
  });
}

function output(value: ResponseEngineOutput): ResponseEngineOutput {
  return { ...value, text: safeText(value.text) };
}

function envelopeStatusForJob(job: AgentJob): GenUiEnvelopeV1['status'] {
  if (job.status === 'awaiting_approval') return 'approval';
  if (job.status === 'completed') return hasTerminalResult(job) ? 'complete' : 'error';
  if (job.status === 'failed') return 'error';
  if (job.status === 'queued' || job.status === 'running') return 'loading';
  return 'ready';
}

function hasTerminalResult(job: AgentJob): boolean {
  return typeof job.result === 'string' && job.result.trim().length > 0;
}

function jobEnvelope(job: AgentJob, text: string, status = envelopeStatusForJob(job)): GenUiEnvelopeV1 {
  return envelope({
    kind: 'job-status',
    id: job.id,
    title: 'Codex 작업 상태',
    text,
    status,
    sections: [{
      type: 'status',
      title: '작업 상태',
      status: job.status,
      description: [job.error, job.result, job.progress.at(-1)].filter(Boolean).join('\n').slice(0, 2_000),
    }],
  });
}

export class DeterministicResponseEngine implements ResponseEngine {
  readonly mode = 'deterministic' as const;

  async run(input: ResponseEngineInput): Promise<ResponseEngineOutput> {
    const prompt = input.prompt.trim();
    const toolCalls: ResponseToolEvent[] = [];
    const emitTool = (tool: ResponseToolEvent): void => {
      toolCalls.push(tool);
      input.onTool?.(tool);
    };
    const cancelled = (): boolean => input.isCancelled?.() === true;

    if (!prompt) {
      const text = '요청 내용을 입력해 주세요.';
      return output({ text, envelope: envelope({ kind: 'answer', id: 'empty-request', title: '업무 허브', text }), toolCalls });
    }

    const normalized = prompt.toLowerCase();
    if (/^(help|도움|사용법|명령)/i.test(normalized)) {
      const text = `에이전트 업무 허브 명령\n\n${coreOrchestrationCommandHelp()}\n\n읽기 작업은 agent run, 변경 작업은 승인 후 실행되는 agent write를 사용하세요.`;
      return output({ text, envelope: envelope({ kind: 'answer', id: 'help', title: '업무 허브 명령 안내', text }), toolCalls });
    }

    if (/(업무|할 일|task).*(목록|리스트|보여|확인)|^(list|업무 목록)$/i.test(normalized)) {
      const tasks = compactTasks(input);
      const text = formatTasks(tasks);
      emitTool({ name: 'showTaskCard', args: tasks as unknown as Record<string, unknown>, result: text });
      return output({
        text,
        envelope: envelope({
          kind: 'task-list', id: 'workspace-list', title: '업무 목록', text,
          sections: [{ type: 'list', title: '업무', items: tasks.items.map((item) => ({ id: item.id, label: item.title, status: item.status })) }],
        }),
        toolCalls,
      });
    }

    if (/^(?:status|상태|진행 상태)/i.test(normalized)
      || /^(?:codex|코덱스)\s+(?:작업\s+)?(?:상태|진행 상태)/i.test(normalized)) {
      const text = `활성 Codex 작업 ${input.agentService.countActive(input.scope)}개\n\n${formatJobs(input)}`;
      return output({
        text,
        envelope: envelope({ kind: 'job-status', id: 'workspace-status', title: '업무 허브 상태', text, sections: [{ type: 'status', status: 'ready', description: text }] }),
        toolCalls,
      });
    }

    if (/^(write|파일|수정|변경|작성|생성)/i.test(normalized)) {
      const requestedPrompt = safeText(prompt.replace(/^(write|파일(?:을|이)?\s*(?:변경|수정)?|수정|변경|작성|생성)\s*/i, '').trim() || '요청한 변경 작업', 2_000);
      const job = await input.agentService.submit({ prompt: requestedPrompt, mode: 'workspace-write', scope: input.scope });
      const args: ApprovalToolArgs = { jobId: job.id, prompt: requestedPrompt, action: 'approve' };
      const text = `쓰기 작업 ${job.id}이 승인 대기 중입니다.\n\nTeams Bot에서 “approve ${job.id}”를 보내거나 아래 승인 흐름을 사용하세요.`;
      const approvalEnvelope = input.approvalEnvelope ? await input.approvalEnvelope(job) : undefined;
      emitTool({ name: 'workspaceApproval', args, result: `승인 대기 중인 작업 ${job.id}` });
      return output({
        text,
        envelope: approvalEnvelope ?? envelope({ kind: 'approval', id: job.id, title: '쓰기 작업 승인 필요', text, status: 'approval', sections: [{ type: 'status', title: '승인 경계', status: 'awaiting_approval', description: requestedPrompt }] }),
        toolCalls,
      });
    }

    if (isCodexHistoryRequest(normalized)) {
      const text = formatJobHistory(input);
      return output({
        text,
        envelope: envelope({
          kind: 'job-status',
          id: 'workspace-history',
          title: 'Codex 작업 이력',
          text,
          sections: [{ type: 'status', title: '최근 Codex 작업', status: 'ready', description: text }],
        }),
        toolCalls,
      });
    }

    const previous = input.agentService.latestCompletedForConversation(input.scope);
    // Teams Bot calls omit onText and must receive the loading card immediately.
    // CopilotKit supplies onText so it can stream the terminal result through its
    // AG-UI response; preserve that stream while keeping Bot delivery proactive.
    const streamToCaller = input.deferAgentCompletion !== true && typeof input.onText === 'function';
    const onProgress = async (message: string): Promise<void> => {
      if (!cancelled()) input.onText?.(`⏳ ${message}`);
    };
    const job = previous
      ? await input.agentService.continue(previous.id, prompt, input.scope, { notify: true, onProgress })
      : await input.agentService.submit({ prompt, mode: 'read-only', scope: input.scope, notify: true, onProgress });
    if (!job) throw new Error('Codex 작업을 생성하지 못했습니다.');
    input.setActiveJobId?.(job.id);
    const text = previous
      ? `이전 Codex 대화를 이어서 작업 ${job.id}을 시작했습니다. 진행 상황과 완료 결과를 이 채팅으로 보내드립니다.`
      : `작업 ${job.id}을 시작했습니다. 진행 상황과 완료 결과를 이 채팅으로 보내드립니다.`;
    if (streamToCaller) {
      const completed = await input.agentService.waitForTerminal(job.id, input.scope);
      const resultText = completed.status === 'completed' && hasTerminalResult(completed)
        ? completed.result!
        : completed.status === 'completed'
          ? `작업 ${completed.id}은 완료 상태지만 결과가 없어 성공으로 처리하지 않았습니다. 추가 확인이 필요합니다.`
        : `작업 ${completed.id}이 ${completed.status} 상태입니다.\n\n${completed.error || completed.progress.at(-1) || '추가 확인이 필요합니다.'}`;
      const streamedText = previous
        ? `이전 Codex 대화를 이어서 작업 ${completed.id}이 완료되었습니다.\n\n${resultText}`
        : resultText;
      return output({ text: streamedText, envelope: jobEnvelope(completed, streamedText), toolCalls });
    }
    return output({ text, envelope: jobEnvelope(job, text, 'loading'), toolCalls });
  }
}
