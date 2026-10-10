import { z } from 'zod';
import { CORE_JOB_STATUS_LABELS, type CoreOrchestrationJob } from './core-orchestration.js';
import { projectReceiptFacts, type ReceiptFact } from './receipt-presentation.js';
import { agentToolOutcomeText } from './agent-tool-presentation.js';

/** Display preferences never select a model, provider or execution mode. */
export const EXECUTION_PRESENTATION_MODES = ['text', 'summary', 'rich'] as const;
export const ExecutionPresentationModeSchema = z.enum(EXECUTION_PRESENTATION_MODES);
export type ExecutionPresentationMode = z.infer<typeof ExecutionPresentationModeSchema>;
export const DEFAULT_EXECUTION_PRESENTATION_MODE: ExecutionPresentationMode = 'summary';
export const EXECUTION_PRESENTATION_AGENT_ID = 'execution-projection';
export const EXECUTION_PRESENTATION_TOOL_NAME = 'showExecutionPresentation';
const scopeId = z.string().max(256).refine(value => value.trim().length > 0)
  .refine(value => !/[\u0000-\u001f\u007f-\u009f]/u.test(value));
export const ExecutionPresentationScopeSchema = z.object({ tenantId: scopeId, requesterId: scopeId }).strict();
export type ExecutionPresentationScope = z.infer<typeof ExecutionPresentationScopeSchema>;
export const EXECUTION_PRESENTATION_DETAILS = ['tool', 'steps', 'diagnostics'] as const;
export const ExecutionPresentationDetailSchema = z.enum(EXECUTION_PRESENTATION_DETAILS);
export type ExecutionPresentationDetail = z.infer<typeof ExecutionPresentationDetailSchema>;
export const ExecutionPresentationSelectionSchema = z.object({
  mode: ExecutionPresentationModeSchema,
  details: z.array(ExecutionPresentationDetailSchema).max(3)
    .refine(values => new Set(values).size === values.length, 'Duplicate display detail').optional(),
  richSurface: z.enum(['tab', 'dialog']).optional(),
}).strict();
export type ExecutionPresentationSelection = z.infer<typeof ExecutionPresentationSelectionSchema>;
export type ExecutionPresentationPreferences = Required<ExecutionPresentationSelection>;
export function executionPresentationPreferences(selection: ExecutionPresentationSelection): ExecutionPresentationPreferences {
  return { mode: selection.mode, details: selection.details ?? [...EXECUTION_PRESENTATION_DETAILS], richSurface: selection.richSurface ?? 'tab' };
}
export const ExecutionPresentationJobIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u);

const factSchema = z.object({ label: z.string().max(100), value: z.string().max(1_000) }).strict();
const toolSchema = z.object({
  category: z.enum(['skill', 'plugin', 'mcp', 'cli', 'builtin']),
  name: z.string().max(100), observedAt: z.string().max(50), outcome: z.string().max(512),
}).strict();
export const ExecutionPresentationSchema = z.object({
  schemaVersion: z.literal('1'), jobId: ExecutionPresentationJobIdSchema,
  status: z.enum(['queued', 'awaiting_approval', 'input_required', 'running', 'completed', 'failed', 'cancelled']),
  statusLabel: z.string().max(100), title: z.string().max(240), summary: z.string().max(500),
  prompt: z.string().max(2_000), result: z.string().max(4_000).optional(), error: z.string().max(2_000).optional(),
  progress: z.array(z.string().max(300)).max(8), facts: z.array(factSchema).max(40),
  receiptFacts: z.array(factSchema).max(32), tools: z.array(toolSchema).max(16),
  executionEnvironment: z.enum(['local-macos', 'local-linux', 'local-windows', 'external-worker']).optional(),
  observedPlatform: z.enum(['darwin', 'linux', 'win32']).optional(),
  text: z.string().max(32_000), truncated: z.boolean(),
}).strict();
type ParsedPresentation = z.infer<typeof ExecutionPresentationSchema>;
export type ExecutionPresentation = Readonly<Omit<ParsedPresentation, 'progress' | 'facts' | 'receiptFacts' | 'tools'> & {
  progress: readonly string[];
  facts: readonly ReceiptFact[];
  receiptFacts: readonly ReceiptFact[];
  tools: readonly Readonly<z.infer<typeof toolSchema>>[];
}>;

/** One public read-only projection for text, summary cards and the SDK UI.
 * The caller supplies an already authorized Core job, whose tool output was
 * masked before persistence. No private job fields or action grants are copied.
 */
export function createExecutionPresentation(job: CoreOrchestrationJob): ExecutionPresentation {
  const jobId = ExecutionPresentationJobIdSchema.parse(job.id);
  let truncated = false;
  const bounded = (value: string, limit: number): string => {
    if (value.length <= limit) return value;
    truncated = true;
    const suffix = '… (일부 생략)';
    return `${value.slice(0, limit - suffix.length)}${suffix}`;
  };
  const statusLabel = CORE_JOB_STATUS_LABELS[job.status];
  const prompt = bounded(job.prompt, 2_000);
  const result = job.result === undefined ? undefined : bounded(job.result, 4_000);
  const error = job.error === undefined ? undefined : bounded(job.error, 2_000);
  if (job.progress.length > 8 || (job.tools?.length ?? 0) > 16) truncated = true;
  const progress = job.progress.slice(-8).map(value => bounded(value, 300));
  const receiptFacts = projectReceiptFacts(job).map(fact => ({
    label: bounded(fact.label, 100), value: bounded(fact.value, 1_000),
  }));
  const tools = (job.tools ?? []).slice(0, 16).map(tool => ({
    category: tool.category, name: bounded(tool.name, 100), observedAt: bounded(tool.observedAt, 50),
    outcome: bounded(agentToolOutcomeText(tool), 512),
  }));
  const facts: ReceiptFact[] = [
    { label: '상태', value: statusLabel }, { label: '작업 ID', value: jobId },
    { label: '제공자', value: job.provider ?? '제공되지 않음' },
    { label: '실행 경계', value: job.executionEnvironment ?? '제공되지 않음' },
    { label: '실제 환경', value: job.executionReceipt?.platform ?? '확인되지 않음 (worker 관측 없음)' },
    ...receiptFacts,
  ];
  const outcome = result?.trim() || error?.trim() || progress.at(-1) || '결과가 기록되지 않았습니다.';
  const summary = bounded(`${statusLabel} · ${outcome}`, 500);
  const text = bounded([
    `작업 ${jobId} · ${statusLabel}`, `요청: ${prompt || '제공되지 않음'}`,
    result?.trim() ? `결과:\n${result}` : '결과가 기록되지 않았습니다.',
    ...(error ? [`오류:\n${error}`] : []),
    facts.map(fact => `${fact.label}: ${fact.value}`).join('\n'),
    ...(progress.length ? [`최근 진행:\n${progress.join('\n')}`] : []),
    tools.length ? `관찰된 도구:\n${tools.map(tool => `${tool.category}: ${tool.name}${tool.outcome ? ` · ${tool.outcome}` : ''}`).join('\n')}` : '보고된 도구 없음',
  ].join('\n\n'), 32_000);
  return ExecutionPresentationSchema.parse({
    schemaVersion: '1', jobId, status: job.status, statusLabel, title: `작업 ${jobId}`, summary, prompt,
    ...(result === undefined ? {} : { result }), ...(error === undefined ? {} : { error }),
    progress, facts, receiptFacts, tools, text, truncated,
    ...(job.executionEnvironment === undefined ? {} : { executionEnvironment: job.executionEnvironment }),
    ...(job.executionReceipt?.platform === undefined ? {} : { observedPlatform: job.executionReceipt.platform }),
  });
}
