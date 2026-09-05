import {
  GENUI_SCHEMA_VERSION,
  GenUiEnvelopeV1Schema,
  type GenUiEnvelopeV1,
  type GenUiState,
} from '../../shared/genui.js';

export type ToolRenderStatus = 'inProgress' | 'executing' | 'complete';

export type TaskToolParameters = {
  items: Array<{
    id: number;
    title: string;
    status: 'open' | 'done';
  }>;
  total: number;
  open: number;
  done: number;
};

export type ApprovalToolParameters = {
  jobId: string;
  prompt: string;
  action: 'approve' | 'cancel';
};

export type GenAiRuntimeStatus = 'openai-configured' | 'grok-configured' | 'not-configured' | 'deterministic-test';

export function getGenAiBadgeLabel(genAI: GenAiRuntimeStatus | undefined): string {
  if (genAI === 'openai-configured') return 'OpenAI 연결됨';
  if (genAI === 'grok-configured') return 'Grok 연결됨';
  if (genAI === 'deterministic-test') return '테스트 모드';
  return '설정 필요';
}

type TaskToolItemInput = Partial<TaskToolParameters['items'][number]>;
type TaskToolParametersInput = {
  items?: TaskToolItemInput[];
  total?: number;
  open?: number;
  done?: number;
};
type ApprovalToolParametersInput = Partial<ApprovalToolParameters>;
type ApprovalResultParameters = Pick<ApprovalToolParameters, 'jobId' | 'prompt'>;

const MAX_SAFE_COUNT = Number.MAX_SAFE_INTEGER;

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function boundedText(value: string | undefined, maxLength: number): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const sliced = trimmed.slice(0, maxLength);
  const lastCodeUnit = sliced.charCodeAt(sliced.length - 1);
  return lastCodeUnit >= 0xD800 && lastCodeUnit <= 0xDBFF ? sliced.slice(0, -1) : sliced;
}

function boundedId(value: string | undefined, prefix: string): string {
  const normalized = value?.trim();
  if (!normalized) return prefix;
  if (normalized.length <= 200) return normalized;
  return `${prefix}-${stableHash(normalized)}`;
}

function finiteNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizedCount(value: number | undefined): number | undefined {
  const finite = finiteNumber(value);
  return finite === undefined ? undefined : Math.min(MAX_SAFE_COUNT, Math.max(0, Math.trunc(finite)));
}

function normalizedItemId(value: number | undefined, index: number, title: string): string | number {
  const finite = finiteNumber(value);
  if (finite === undefined) return `item-${index + 1}-${stableHash(title)}`;
  if (Number.isSafeInteger(finite)) return finite;
  return boundedText(String(finite), 120) ?? `item-${index + 1}-${stableHash(title)}`;
}

function isValidCount(value: number | undefined): boolean {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0;
}

function isValidTaskParameters(parameters: TaskToolParametersInput): boolean {
  if (!Array.isArray(parameters.items)
    || !isValidCount(parameters.total)
    || !isValidCount(parameters.open)
    || !isValidCount(parameters.done)) {
    return false;
  }

  return parameters.items.every((item) => Boolean(item)
    && typeof item.id === 'number'
    && Number.isSafeInteger(item.id)
    && Boolean(boundedText(item.title, 400))
    && (item.status === 'open' || item.status === 'done'));
}

function isValidApprovalParameters(parameters: ApprovalToolParametersInput): boolean {
  return Boolean(boundedText(parameters.jobId, 120))
    && Boolean(boundedText(parameters.prompt, 2_000))
    && (parameters.action === 'approve' || parameters.action === 'cancel');
}

function invalidToolResultEnvelope(toolName: string, reason: string): GenUiEnvelopeV1 {
  const detail = boundedText(reason, 500) ?? '필수 도구 결과가 없습니다.';
  const id = boundedId(`copilot-${toolName}-adapter-error`, 'copilot-adapter-error');
  return GenUiEnvelopeV1Schema.parse({
    schemaVersion: GENUI_SCHEMA_VERSION,
    kind: 'error',
    status: 'error',
    id,
    correlationId: id,
    title: '도구 결과 오류',
    summary: `${toolName} 도구 결과를 표시할 수 없습니다.`,
    sections: [{
      type: 'status',
      title: '도구 결과 검증',
      status: 'invalid_tool_result',
      tone: 'danger',
      description: detail,
    }],
    actions: [],
    citations: [],
    aiGenerated: false,
    fallbackText: '도구 결과를 안전하게 표시할 수 없습니다. 다시 시도하세요.',
    metadata: { source: 'copilotkit-tool', deterministic: true },
  });
}

function baseEnvelope(input: {
  kind: GenUiEnvelopeV1['kind'];
  status: GenUiState;
  id: string;
  title: string;
  summary: string;
  sections: Array<Record<string, unknown>>;
  fallbackText: string;
}): GenUiEnvelopeV1 {
  const parsed = GenUiEnvelopeV1Schema.safeParse({
    schemaVersion: GENUI_SCHEMA_VERSION,
    kind: input.kind,
    status: input.status,
    id: boundedId(input.id, 'copilot-card'),
    correlationId: boundedId(input.id, 'copilot-card'),
    title: boundedText(input.title, 240),
    summary: boundedText(input.summary, 2_000),
    sections: input.sections,
    actions: [],
    citations: [],
    aiGenerated: false,
    fallbackText: boundedText(input.fallbackText, 4_000) ?? '도구 결과를 표시할 수 없습니다.',
    metadata: { source: 'copilotkit-tool', deterministic: true },
  });
  if (parsed.success) return parsed.data;
  return invalidToolResultEnvelope('unknown', 'GenUI envelope schema validation failed.');
}

export function createTaskToolEnvelope(
  parameters: TaskToolParametersInput,
  status: ToolRenderStatus,
): GenUiEnvelopeV1 {
  if (status === 'complete' && !isValidTaskParameters(parameters)) {
    return invalidToolResultEnvelope('task-list', '업무 목록의 항목·카운트·상태가 올바르지 않습니다.');
  }

  const id = 'copilot-task-list';
  const items = Array.isArray(parameters.items) ? parameters.items : [];
  const openItems = items.filter((item) => item.status === 'open').slice(0, 8).map((item, index) => {
    const title = boundedText(item.title, 400) ?? `업무 ${index + 1}`;
    return {
      id: normalizedItemId(item.id, index, title),
      label: title,
      status: item.status,
    };
  });
  const total = normalizedCount(parameters.total);
  const open = normalizedCount(parameters.open);
  const done = normalizedCount(parameters.done);
  const effectiveStatus = status === 'complete' ? 'ready' : 'loading';
  const summary = effectiveStatus === 'ready'
    ? `${total}개 전체 · ${open}개 진행 중 · ${done}개 완료`
    : '업무 목록을 준비하고 있습니다.';

  return baseEnvelope({
    kind: 'task-list',
    status: effectiveStatus,
    id,
    title: '업무 현황',
    summary,
    sections: [{
      type: 'list',
      title: '진행 중인 업무',
      items: openItems,
    }, {
      type: 'stats',
      title: '요약',
      stats: [
        ...(total === undefined ? [] : [{ label: '전체', value: total }]),
        ...(open === undefined ? [] : [{ label: '진행 중', value: open }]),
        ...(done === undefined ? [] : [{ label: '완료', value: done }]),
      ],
    }],
    fallbackText: summary,
  });
}

export function createApprovalToolEnvelope(
  parameters: ApprovalToolParametersInput,
  status: ToolRenderStatus,
): GenUiEnvelopeV1 {
  if (status === 'complete' && !isValidApprovalParameters(parameters)) {
    return invalidToolResultEnvelope('approval', '승인 결과의 작업 ID·설명·작업 유형이 올바르지 않습니다.');
  }

  const rawJobId = parameters.jobId?.trim();
  const jobId = boundedText(rawJobId, 120) ?? 'copilot-approval';
  const prompt = boundedText(parameters.prompt, 2_000) ?? '승인 작업 정보를 준비하고 있습니다.';
  const isReady = status === 'complete';
  const summary = isReady
    ? `쓰기 작업 ${jobId}이 승인 대기 중입니다.`
    : '승인 카드를 준비하고 있습니다.';

  // Approval actions are intentionally kept out of this envelope. The CopilotKit
  // render path does not receive the server-issued action grants, so the host
  // adapter below calls the scoped REST endpoint with the active thread ID.
  return baseEnvelope({
    kind: 'approval',
    status: isReady ? 'approval' : 'loading',
    id: jobId,
    title: '쓰기 작업 승인 필요',
    summary,
    sections: [{
      type: 'status',
      title: '승인 경계',
      status: isReady ? 'awaiting_approval' : 'preparing',
      tone: isReady ? 'warning' : 'info',
      description: prompt,
    }],
    fallbackText: `${summary}\napprove ${jobId} 또는 cancel ${jobId}`,
  });
}

export function createApprovalResultEnvelope(
  parameters: ApprovalResultParameters,
  action: 'approve' | 'cancel',
  message: string,
): GenUiEnvelopeV1 {
  const jobId = boundedText(parameters.jobId, 120) ?? 'copilot-approval';
  const prompt = boundedText(parameters.prompt, 2_000) ?? '승인 작업 정보가 없습니다.';
  const title = action === 'approve' ? '쓰기 작업 승인 완료' : '작업 취소 완료';
  const summary = boundedText(message, 2_000) ?? `작업 ${jobId}의 ${action} 처리가 완료되었습니다.`;
  return baseEnvelope({
    kind: 'result',
    status: 'complete',
    id: boundedId(parameters.jobId, 'copilot-approval-result'),
    title,
    summary,
    sections: [{
      type: 'status',
      title: action === 'approve' ? '승인 결과' : '취소 결과',
      status: action === 'approve' ? 'approved' : 'cancelled',
      tone: 'success',
      description: prompt,
    }],
    fallbackText: summary,
  });
}
