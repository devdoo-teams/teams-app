import crypto from 'node:crypto';
import { atomicWriteJson, readAtomicJsonStore } from './atomic-file.js';
import { redactSensitiveText } from './sensitive-text.js';
import { createCoreOrchestrationJobActivity, type CoreOrchestrationTeamsActivity } from './genui-response.js';
import type { AgentJobScope } from './agent-job-store.js';
import type { CoreOrchestrationJob } from '../shared/core-orchestration.js';
import type { GenUiEnvelopeV1 } from '../shared/genui.js';
import { isSafeGenUiUrl } from '../shared/genui.js';
import { withTeamsJobDeepLink } from './teams-tab-link.js';

const PAGES = ['summary', 'progress', 'conversation', 'result'] as const;
type Page = typeof PAGES[number];
type RecordState = { key: string; jobId: string; scope: AgentJobScope; activityId?: string; page: Page;
  cursor?: number; expiresAt: number; openTabUrl?: string; layout?: 'carousel' };
type Response = { statusCode: number; type: string; value: unknown };
type Options = { universalActions?: boolean; getJob: (jobId: string, scope: AgentJobScope) => CoreOrchestrationJob | undefined;
  update: (activityId: string, activity: CoreOrchestrationTeamsActivity, scope: AgentJobScope) => Promise<unknown> };
const text = (value: string, max = 800) => redactSensitiveText(value).slice(0, max);
const validText = (value: unknown, max = 512): value is string => typeof value === 'string' && value.trim().length > 0
  && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
const sameScope = (a: AgentJobScope, b: AgentJobScope) => ['tenantId', 'requesterId', 'conversationId'].every(key =>
  a[key as keyof AgentJobScope] === b[key as keyof AgentJobScope]);
const errorResponse = (): Response => ({ statusCode: 400, type: 'application/vnd.microsoft.error',
  value: { code: 'InvalidCardPage', message: '이 카드의 페이지를 확인할 수 없습니다. 업무 허브에서 작업을 다시 여세요.' } });

/** Private, single-process card UI state. It never owns or mutates execution/job state. */
export class CoreJobCardPages {
  private records: RecordState[] = [];
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string, private readonly options: Options) {}
  async initialize(): Promise<void> {
    let snapshot: { schemaVersion: number; records: RecordState[] };
    try { snapshot = JSON.parse(await readAtomicJsonStore(this.file)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.records) || snapshot.records.length > 4096
      || snapshot.records.some(record => !this.valid(record))
      || new Set(snapshot.records.map(record => record.key)).size !== snapshot.records.length) {
      throw new Error('CORE_CARD_PAGE_STORE_INVALID');
    }
    this.records = snapshot.records;
  }
  private valid(record: RecordState): boolean {
    return !!record && /^[a-f0-9]{64}$/u.test(record.key) && validText(record.jobId, 200)
      && !!record.scope && ['tenantId', 'requesterId', 'conversationId'].every(key => validText(record.scope[key as keyof AgentJobScope]))
      && PAGES.includes(record.page) && Number.isFinite(record.expiresAt)
      && (record.activityId === undefined || validText(record.activityId, 200))
      && (record.cursor === undefined || Number.isInteger(record.cursor) && record.cursor >= 0 && record.cursor < 20)
      && (record.openTabUrl === undefined || isSafeGenUiUrl(record.openTabUrl))
      && (record.layout === undefined || record.layout === 'carousel')
      && Object.keys(record).every(key => ['key', 'jobId', 'scope', 'activityId', 'page', 'cursor', 'expiresAt', 'openTabUrl', 'layout'].includes(key))
      && Object.keys(record.scope).every(key => ['tenantId', 'requesterId', 'conversationId'].includes(key));
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn); this.tail = next.catch(() => undefined); return next;
  }
  private async publish(records: RecordState[]): Promise<void> {
    await atomicWriteJson(this.file, { schemaVersion: 1, records }); this.records = records;
  }
  async create(jobId: string, scope: AgentJobScope, personal: boolean, openTabUrl?: string) {
    if (!personal || !this.options.getJob(jobId, scope)) return undefined;
    return this.serial(async () => {
      const records = this.records.filter(record => record.expiresAt > Date.now());
      if (records.length >= 4096) throw new Error('CORE_CARD_PAGE_CAPACITY');
      const record: RecordState = { key: crypto.randomBytes(32).toString('hex'), jobId, scope: { ...scope },
        page: 'summary', layout: 'carousel', expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        ...(openTabUrl && isSafeGenUiUrl(openTabUrl) ? { openTabUrl } : {}) };
      if (!this.valid(record)) throw new Error('CORE_CARD_PAGE_SCOPE_INVALID');
      const card = this.render(record);
      if (!card) return undefined;
      await this.publish([...records, record]);
      return { key: record.key, activity: card };
    });
  }
  async bind(key: string, scope: AgentJobScope, activityId: string): Promise<boolean> {
    return this.serial(async () => {
      const record = this.records.find(record => record.key === key && sameScope(record.scope, scope)
        && record.expiresAt > Date.now());
      if (!record || !validText(activityId, 200) || record.activityId && record.activityId !== activityId) return false;
      await this.publish(this.records.map(current => current === record ? { ...record, activityId } : current)); return true;
    });
  }
  /** Reuse only a server-bound existing card after a job mutation invoke. */
  existing(jobId: string, scope: AgentJobScope, activityId: string): CoreOrchestrationTeamsActivity | undefined {
    const record = this.records.find(record => record.jobId === jobId && record.activityId === activityId
      && sameScope(record.scope, scope) && record.expiresAt > Date.now());
    return record && this.render(record);
  }
  async act(payload: unknown, scope: AgentJobScope, personal: boolean, activityId: string,
    transport: 'invoke' | 'submit', update = this.options.update): Promise<Response> {
    return this.serial(async () => {
      if (!personal || !payload || typeof payload !== 'object' || Array.isArray(payload)) return errorResponse();
      const input = payload as Record<string, unknown>;
      if (input.schemaVersion !== '1' || input.action !== 'orchestration.page'
        || !validText(input.key) || !validText(input.jobId, 200)
        || typeof input.page !== 'string' || ![...PAGES, 'refresh'].some(page => page === input.page)
        || Object.keys(input).some(key => !['schemaVersion', 'action', 'key', 'jobId', 'page', 'cursor'].includes(key))
        || (input.cursor !== undefined && input.page !== 'conversation')
        || (input.cursor !== undefined && (!Number.isInteger(input.cursor) || (input.cursor as number) < 0 || (input.cursor as number) >= 20))) return errorResponse();
      const record = this.records.find(record => record.key === input.key && record.jobId === input.jobId
        && record.activityId === activityId && !!record.activityId && sameScope(record.scope, scope)
        && record.expiresAt > Date.now());
      if (!record || !this.options.getJob(record.jobId, scope)) return errorResponse();
      // New collections use Submit and update the entire activity. A single-card
      // universal-action response would collapse the collection in the host.
      if (record.layout === 'carousel' && transport === 'invoke') return errorResponse();
      const next = { ...record, page: input.page === 'refresh' ? record.page : input.page as Page,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor as number }) };
      const card = this.render(next);
      if (!card) return errorResponse();
      // Do not claim success if an older-client update fails; never fall back to a new message.
      if (transport === 'submit') {
        try { await update(activityId, card, scope); }
        catch { return { ...errorResponse(), statusCode: 500 }; }
      }
      await this.publish(this.records.map(current => current === record ? next : current));
      return { statusCode: 200, type: 'application/vnd.microsoft.card.adaptive', value: card.attachments[0].content };
    });
  }
  private render(record: RecordState): CoreOrchestrationTeamsActivity | undefined {
    const job = this.options.getJob(record.jobId, record.scope); if (!job) return undefined;
    const base = createCoreOrchestrationJobActivity(job, { openTabUrl: record.openTabUrl });
    if (record.layout !== 'carousel') return this.renderPage(record, job, base, record.page);
    const cards = PAGES.map(page => this.renderPage(record, job, base, page));
    if (cards.some(card => !card)) return undefined;
    return { type: 'message', attachmentLayout: 'carousel', attachments: [
      cards[0]!.attachments[0], ...cards.slice(1).map(card => card!.attachments[0]),
    ] };
  }
  private renderPage(record: RecordState, job: CoreOrchestrationJob, base: CoreOrchestrationTeamsActivity,
    page: Page): CoreOrchestrationTeamsActivity | undefined {
    const labels: Record<Page, string> = { summary: '요약', progress: '진행', conversation: '대화', result: '결과' };
    const block = (value: string) => ({ type: 'TextBlock', text: text(value), wrap: true });
    let body: Record<string, unknown>[];
    if (page === 'summary') body = [block(text(job.prompt, 400)),
      ...base.attachments[0].content.body.filter(element => element.type === 'FactSet'),
      { type: 'FactSet', facts: [{ title: '승인', value: job.status === 'awaiting_approval' ? '승인 필요' : '추가 승인 요청 없음' }] },
      block(job.progress.at(-1) ?? '진행 기록이 없습니다.')];
    else if (page === 'progress') body = job.progress.length ? job.progress.slice(-5).map(block) : [block('진행 기록이 없습니다.')];
    else if (page === 'result') body = [block(job.result ?? job.error ?? '아직 최종 결과가 없습니다.')];
    else {
      const turns: CoreOrchestrationJob[] = []; const seen = new Set<string>(); let current: CoreOrchestrationJob | undefined = job;
      let incomplete = false;
      while (current && turns.length < 20 && !seen.has(current.id)) {
        seen.add(current.id); turns.unshift(current);
        if (!current.parentJobId) { current = undefined; break; }
        const parent = this.options.getJob(current.parentJobId, record.scope);
        if (!parent || job.threadId && parent.threadId && job.threadId !== parent.threadId) { incomplete = true; break; }
        current = parent;
      }
      if (current) incomplete = true;
      const cursor = record.cursor ?? turns.length - 1;
      if (cursor >= turns.length) return undefined;
      const turn = turns[cursor];
      body = [block(`대화 ${cursor + 1}/${turns.length}`), block(`요청: ${text(turn.prompt, 600)}`),
        block(`답변: ${text(turn.result ?? turn.error ?? '최종 응답이 없습니다.', 600)}`),
        ...(incomplete ? [block('이전 대화 일부를 확인할 수 없습니다.')] : []),
        { type: 'ActionSet', actions: [
          ...(cursor > 0 ? [this.action(record, 'conversation', '이전 대화', cursor - 1)] : []),
          ...(cursor + 1 < turns.length ? [this.action(record, 'conversation', '다음 대화', cursor + 1)] : []),
        ] },
      ];
    }
    const actions = record.layout === 'carousel' ? [] : PAGES.map(target => this.action(record, target, `${page === target ? '✓ ' : ''}${labels[target]}`));
    actions.push(this.action(record, 'refresh', '새로고침'));
    // Only summary retains existing confirmation/mutation controls; each is still handled by its original owner gate.
    const controls = page === 'summary' ? base.attachments[0].content.actions ?? [] : [];
    const link = withTeamsJobDeepLink(record.openTabUrl, job.id);
    // Keep short carousel bodies tall enough that centered host arrows stay
    // clear of actions even when Teams adds its submit acknowledgment below.
    // Actual host clearance is a live gate; legacy single cards are unchanged.
    const contentBody = record.layout === 'carousel'
      ? [{ type: 'Container', style: 'emphasis', bleed: false, minHeight: '96px', items: body }]
      : body;
    return { ...base, attachments: [{ ...base.attachments[0], content: { ...base.attachments[0].content,
      body: [block(`Core 에이전트 작업 · ${labels[page]}`), ...contentBody],
      actions: [...actions, ...controls.filter(action => action.type !== 'Action.OpenUrl'),
        ...(link && isSafeGenUiUrl(link) ? [{ type: 'Action.OpenUrl', title: '상세 대화 열기', url: link }] : [])],
    } }] };
  }
  private action(record: RecordState, page: Page | 'refresh', title: string, cursor?: number) {
    const data = { schemaVersion: '1', action: 'orchestration.page', key: record.key, jobId: record.jobId, page,
      ...(cursor === undefined ? {} : { cursor }) };
    const submit = { type: 'Action.Submit', title, data, associatedInputs: 'none' };
    return this.options.universalActions && record.layout !== 'carousel'
      ? { type: 'Action.Execute', title, verb: 'orchestration.page', data, associatedInputs: 'none', fallback: submit }
      : submit;
  }
}

/** Bind page navigation only to a server-produced job card and connector-returned ID. */
export function wrapCoreJobCardSender<T extends { state: string; activityId?: string }>(
  pages: CoreJobCardPages, scope: AgentJobScope, personal: boolean,
  send: (text: string, envelope?: GenUiEnvelopeV1, activityOverride?: unknown) => Promise<T>,
  openTabUrl?: string, existingActivityId?: string,
): (text: string, envelope?: GenUiEnvelopeV1, activityOverride?: unknown) => Promise<T> {
  return async (message, envelope, override) => {
    const activity = override as CoreOrchestrationTeamsActivity | undefined;
    const content = activity?.attachments?.[0]?.content;
    if (!personal || content?.body?.[0]?.text !== 'Core 에이전트 작업') return send(message, envelope, override);
    const facts = content.body.find(element => element.type === 'FactSet')?.facts;
    const jobId = Array.isArray(facts) ? facts.find(fact => fact?.title === '작업 ID')?.value : undefined;
    if (!validText(jobId, 200)) return send(message, envelope, override);
    if (existingActivityId) {
      const card = pages.existing(jobId, scope, existingActivityId);
      return send(message, undefined, card ?? override);
    }
    const prepared = await pages.create(jobId, scope, personal, openTabUrl);
    const receipt = await send(message, undefined, prepared?.activity ?? override);
    if (prepared && receipt.state === 'connector-accepted' && receipt.activityId) {
      return preserveCoreCardDeliveryReceipt(pages, prepared.key, scope, receipt);
    }
    return receipt;
  };
}

/** A UI-state write failure cannot undo an already accepted Teams activity. */
export async function preserveCoreCardDeliveryReceipt<T extends { state: string; activityId?: string }>(
  pages: CoreJobCardPages, key: string, scope: AgentJobScope, receipt: T,
): Promise<T & { pageBinding: 'bound' | 'blocked' | 'unbound' }> {
  if (receipt.state !== 'connector-accepted' || !receipt.activityId) return { ...receipt, pageBinding: 'unbound' };
  try {
    const bound = await pages.bind(key, scope, receipt.activityId);
    if (!bound) console.warn('CORE_CARD_PAGE_BINDING_BLOCKED');
    return { ...receipt, pageBinding: bound ? 'bound' : 'blocked' };
  } catch {
    console.warn('CORE_CARD_PAGE_BINDING_BLOCKED');
    return { ...receipt, pageBinding: 'blocked' };
  }
}

/** Local outbound suppression also covers updates; read-only invoke never uses this port. */
export async function guardCoreCardPageUpdate<T>(skipOutbound: boolean, update: () => Promise<T>): Promise<T> {
  if (skipOutbound) throw new Error('CARD_PAGE_OUTBOUND_DISABLED');
  return update();
}
