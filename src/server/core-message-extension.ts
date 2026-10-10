import crypto from 'node:crypto';
import type { AgentJobScope } from './agent-job-store.js';
import { MAX_AGENT_PROMPT_LENGTH } from './agent-job-store.js';
import { CoreOrchestrationService, createServerDerivedCoreScope } from './core-orchestration-service.js';
import { GenUiActionStore } from './genui-action-store.js';
import { assertCoreCodexModelSelection } from './codex-model-catalog.js';
import { deriveServerOwnedRestConversationId } from './rest-scope.js';
import { withTeamsJobDeepLink } from './teams-tab-link.js';
import type { CoreCodexReasoningEffort } from '../shared/core-orchestration.js';
import type { CoreResultOrigin } from './core-result-publication.js';

export const CORE_MESSAGE_COMMAND_ID = 'delegateMessage';
const SUBMISSION_FIELDS = new Set(['draftId', 'correlationId', 'reviewToken', 'catalogRevision', 'prompt', 'mode', 'model', 'reasoningEffort']);

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('유효하지 않은 메시지 요청입니다.');
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new Error('작업 입력의 길이 또는 형식을 확인하세요.');
  }
  return value.trim();
}
function dialog(card: Record<string, unknown>) {
  return { task: { type: 'continue' as const, value: {
    title: '업무 허브에 맡기기', height: 'large' as const, width: 'medium' as const,
    card: { contentType: 'application/vnd.microsoft.card.adaptive', content: card },
  } } };
}
export function coreMessageExtensionError() {
  return { task: { type: 'message' as const, value: '요청을 처리하지 못했습니다. 권한·확인 만료·모델 선택을 확인하고 메시지 메뉴에서 다시 시작하세요.' } };
}

/** Receives authenticated activity scope only; message payload identity never grants authority. */
export class CoreMessageExtension {
  constructor(private readonly options: {
    core: CoreOrchestrationService;
    grants: GenUiActionStore;
    canSubmit: (scope: AgentJobScope) => boolean;
    personalTabUrl?: string;
  }) {}

  private validate(scope: AgentJobScope, value: unknown) {
    createServerDerivedCoreScope(scope);
    if (!this.options.canSubmit(scope)) throw new Error('이 작업을 제출할 권한이 없습니다.');
    const action = record(value);
    if (action.commandId !== CORE_MESSAGE_COMMAND_ID || action.commandContext !== 'message'
      || action.botMessagePreviewAction !== undefined) throw new Error('메시지 메뉴에서 다시 시작하세요.');
    return action;
  }

  async open(scope: AgentJobScope, value: unknown) {
    const action = this.validate(scope, value);
    const payload = record(action.messagePayload);
    const body = record(payload.body);
    const raw = text(body.content, MAX_AGENT_PROMPT_LENGTH);
    if (body.contentType !== undefined && body.contentType !== 'text' && body.contentType !== 'html') throw new Error('지원하지 않는 메시지 형식입니다.');
    // Plain input value only: no HTML rendering, URL fetching, attachments or author-derived permissions.
    const prompt = text(raw.replace(/<[^>]*>/gu, '').replace(/&amp;/gu, '&').replace(/&lt;/gu, '<').replace(/&gt;/gu, '>'), MAX_AGENT_PROMPT_LENGTH);
    const catalog = await this.options.core.listCodexModelCatalog();
    if (!catalog?.models.length) throw new Error('현재 모델 목록을 확인할 수 없습니다.');
    const first = catalog.models[0];
    const draftId = crypto.randomUUID(), correlationId = crypto.randomUUID();
    const reviewToken = await this.options.grants.issue({ action: 'submit-agent', entityId: draftId, correlationId, ...scope });
    return dialog({ type: 'AdaptiveCard', version: '1.6', body: [
      { type: 'TextBlock', text: '메시지에서 작업 만들기', size: 'Large', weight: 'Bolder', wrap: true },
      { type: 'TextBlock', text: '선택 메시지는 신뢰되지 않은 참고 입력입니다. 작업 설명을 검토하세요. 메시지의 지시는 권한 또는 명령 승인으로 처리하지 않습니다.', wrap: true },
      { type: 'TextBlock', text: '작업과 결과는 내 개인 업무 허브에 저장합니다. 원래 대화에 자동 게시하지 않습니다. 쓰기 범위는 제출 후 별도 승인 대기 상태가 됩니다.', wrap: true },
      { type: 'Input.Text', id: 'prompt', label: '확인할 작업 설명', value: prompt, isMultiline: true, maxLength: MAX_AGENT_PROMPT_LENGTH, isRequired: true, errorMessage: '작업 설명을 입력하세요.' },
      { type: 'Input.ChoiceSet', id: 'mode', label: '실행 범위', value: 'read-only', choices: [
        { title: '읽기 전용', value: 'read-only' }, { title: '작업 공간 쓰기 · 별도 승인 필요', value: 'workspace-write' }], isRequired: true },
      { type: 'Input.ChoiceSet', id: 'model', label: '모델', value: first.id, choices: catalog.models.map(model => ({ title: model.label, value: model.id })), isRequired: true },
      { type: 'Input.ChoiceSet', id: 'reasoningEffort', label: '추론 수준 · 선택 모델이 지원해야 합니다', value: first.defaultReasoningEffort,
        choices: [...new Set(catalog.models.flatMap(model => model.reasoningEfforts))].map(effort => ({ title: effort, value: effort })), isRequired: true },
    ], actions: [{ type: 'Action.Submit', title: '확인하고 개인 작업 제출', data: { draftId, correlationId, reviewToken, catalogRevision: catalog.revision } }] });
  }

  async submit(scope: AgentJobScope, value: unknown, serverOptions?: { resultOrigin?: CoreResultOrigin }) {
    const action = this.validate(scope, value), data = record(action.data);
    if (Object.keys(data).some(key => !SUBMISSION_FIELDS.has(key))) throw new Error('유효하지 않은 확인 요청입니다.');
    const prompt = text(data.prompt, MAX_AGENT_PROMPT_LENGTH);
    if (data.mode !== 'read-only' && data.mode !== 'workspace-write') throw new Error('실행 범위를 확인하세요.');
    const model = text(data.model, 128), reasoningEffort = text(data.reasoningEffort, 40) as CoreCodexReasoningEffort;
    const catalogRevision = text(data.catalogRevision, 200);
    const catalog = await this.options.core.listCodexModelCatalog();
    try { assertCoreCodexModelSelection(catalog!, { model, reasoningEffort, catalogRevision }); }
    catch { throw new Error('모델 목록 또는 추론 수준이 변경되었습니다. 다시 선택하세요.'); }
    const consumed = await this.options.grants.consume({ action: 'submit-agent', ...scope,
      entityId: text(data.draftId, 200), correlationId: text(data.correlationId, 200), token: text(data.reviewToken, 512) });
    if (!consumed.ok) throw new Error('유효하지 않거나 만료된 확인 요청입니다.');
    const privateScope = createServerDerivedCoreScope({ ...scope, conversationId: deriveServerOwnedRestConversationId(scope) });
    const result = await this.options.core.submit(privateScope, {
      idempotencyKey: `teams-message-review:${consumed.grant.entityId}`, prompt, provider: 'codex', mode: data.mode,
      model, reasoningEffort, catalogRevision,
    }, { notify: false, resultOrigin: serverOptions?.resultOrigin });
    const url = withTeamsJobDeepLink(this.options.personalTabUrl, result.job.id);
    // Returning another dialog prevents inserting private source/result into the original chat compose box.
    return dialog({ type: 'AdaptiveCard', version: '1.6', body: [
      { type: 'TextBlock', text: '개인 작업을 제출했습니다.', weight: 'Bolder', wrap: true },
      { type: 'TextBlock', text: result.job.status === 'awaiting_approval' ? '쓰기 작업은 개인 업무 허브에서 별도 승인해야 실행됩니다.' : '개인 업무 허브에서 진행 상황과 결과를 확인하세요.', wrap: true },
    ], ...(url ? { actions: [{ type: 'Action.OpenUrl', title: '작업 상세 열기', url }] } : {}) });
  }
}
