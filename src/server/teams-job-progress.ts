import { randomUUID } from 'node:crypto';

/**
 * Official contracts checked against @microsoft/teams.apps and teams.api 2.0.15:
 * https://learn.microsoft.com/en-us/microsoftteams/platform/bots/streaming-ux
 * https://learn.microsoft.com/en-us/microsoftteams/platform/bots/build-conversational-capability#update-messages
 * https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-reference#support-for-adaptive-cards
 *
 * This transport never authenticates, creates conversations, or mints action
 * grants. Bindings must come from an authenticated Teams activity. The adapter
 * must use that binding's validated service URL, bot identity and conversation;
 * stream activities use conversations.createActivity, plain updates use
 * conversations.updateActivity with the retained bot activity ID. Do not wrap
 * adapter sends in automatic retries: a lost response can follow acceptance.
 */
export type TeamsJobProgressBinding = {
  jobId: string; tenantId: string; requesterId: string; conversationId: string;
  conversationType: 'personal' | 'groupChat' | 'channel'; originActivityId: string;
  originThreadId: string; serviceUrl: string;
};
export type TeamsJobProgressStatus = 'queued' | 'awaiting_approval' | 'input_required' | 'running' | 'completed' | 'failed' | 'cancelled';
export type TeamsJobProgressMessage = {
  type: 'message'; text?: string; textFormat?: 'plain' | 'markdown' | 'xml';
  attachments?: ReadonlyArray<{ contentType: string; content: unknown }>;
  attachmentLayout?: 'list' | 'carousel'; entities?: ReadonlyArray<Record<string, unknown>>;
};
export type TeamsJobProgressSnapshot = {
  revision: number; status: TeamsJobProgressStatus; text: string;
  /** Cumulative response text, distinct from replaceable informative status. */
  responseText?: string;
  /** Canonical presentation and caller-issued Stop/approval grants. */
  message?: TeamsJobProgressMessage;
};
export type TeamsJobProgressActivity = Omit<TeamsJobProgressMessage, 'type'> & {
  type: 'typing' | 'message'; id?: string; channelId: 'msteams'; replyToId: string;
  conversation: { id: string; conversationType: TeamsJobProgressBinding['conversationType']; tenantId: string };
  channelData?: Record<string, unknown>;
};
export type TeamsJobProgressRequest = {
  operationId: string; binding: TeamsJobProgressBinding;
  kind: 'start-stream' | 'stream-informative' | 'stream-response' | 'stream-final' | 'create-activity' | 'update-activity';
  method: 'create' | 'update'; activityId?: string; activity: TeamsJobProgressActivity;
};
export type TeamsJobProgressReceipt =
  | { state: 'accepted'; activityId?: string }
  | { state: 'ambiguous' }
  // These require a definite connector rejection, never inferred network errors.
  | { state: 'rejected'; reason: 'stopped' | 'timeout' | 'unsupported' | 'rejected' };
export type TeamsJobProgressResult = {
  jobId: string; state: 'active' | 'pending' | 'ambiguous' | 'blocked' | 'stopped' | 'terminal';
  activityId?: string; operationId?: string; nextDueAt?: number;
};
type Pending = { request: TeamsJobProgressRequest; snapshot: TeamsJobProgressSnapshot; reservedAt: number };
export type TeamsJobProgressStopDispatch = {
  operationId: string; binding: TeamsJobProgressBinding;
  state: 'claimed' | 'settled' | 'ambiguous'; claimedAt: number; settledAt?: number;
};
export type TeamsJobProgressRecord = {
  binding: TeamsJobProgressBinding; latest: TeamsJobProgressSnapshot; sentRevision: number;
  mode: 'stream' | 'activity'; state: 'active' | 'in-flight' | 'ambiguous' | 'blocked' | 'stopped' | 'terminal';
  activityId?: string; streamStartedAt?: number; streamSequence: number; streamedText: string;
  lastAttemptAt?: number; pending?: Pending; stopDispatch?: TeamsJobProgressStopDispatch;
};
export type TeamsJobProgressLedger = {
  schema: 1; records: TeamsJobProgressRecord[];
  chats: Array<{ tenantId: string; conversationId: string; ownerJobId?: string; lastAttemptAt?: number }>;
};
/**
 * Required durable port. Serialize the entire transaction across all transport
 * instances/processes sharing this ledger, persist atomically before resolving,
 * and roll back if the callback or persistence fails. Never run network I/O in
 * this callback. An in-memory Map does not satisfy this production contract.
 */
export interface TeamsJobProgressStatePort { transact<T>(apply: (ledger: TeamsJobProgressLedger) => T): Promise<T> }
export function createTeamsJobProgressLedger(): TeamsJobProgressLedger { return { schema: 1, records: [], chats: [] }; }

const INTERVAL = 1000;
const CLOSE_AT = 119_000; // Leave a second for final delivery before the strict two-minute boundary.
const EXPIRES_AT = 120_000;
const statusLabels: Record<TeamsJobProgressStatus, string> = {
  queued: '대기', awaiting_approval: '승인 필요', input_required: '추가 입력 필요', running: '실행 중', completed: '완료', failed: '실패', cancelled: '중지됨',
};
const terminal = (status: TeamsJobProgressStatus) => ['completed', 'failed', 'cancelled'].includes(status);

/** Optional canonical renderer. Stop data is issued and authorized by the caller. */
export function renderTeamsJobProgressMessage(
  snapshot: TeamsJobProgressSnapshot, options: { stopActionData?: Record<string, unknown> } = {},
): TeamsJobProgressMessage {
  assertSnapshot(snapshot);
  return { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.6',
    body: [{ type: 'FactSet', facts: [{ title: '상태', value: statusLabels[snapshot.status] }] },
      { type: 'TextBlock', text: snapshot.text, wrap: true }],
    actions: !terminal(snapshot.status) && options.stopActionData
      ? [{ type: 'Action.Submit', title: '중지', data: structuredClone(options.stopActionData) }] : [],
  } }] };
}

export class TeamsJobProgressTransport {
  private readonly now: () => number;
  constructor(private readonly options: {
    state: TeamsJobProgressStatePort;
    adapter: { send(request: TeamsJobProgressRequest): Promise<TeamsJobProgressReceipt> };
    now?: () => number;
  }) { this.now = options.now ?? Date.now; }

  async publish(binding: TeamsJobProgressBinding, snapshot: TeamsJobProgressSnapshot): Promise<TeamsJobProgressResult> {
    assertBinding(binding); assertSnapshot(snapshot);
    await this.options.state.transact(ledger => {
      assertLedger(ledger);
      let record = ledger.records.find(candidate => candidate.binding.jobId === binding.jobId);
      if (record) {
        assertAuthority(record.binding, binding);
        if (terminal(record.latest.status) || snapshot.revision < record.latest.revision) return;
        if (snapshot.revision === record.latest.revision) {
          if (JSON.stringify(record.latest) !== JSON.stringify(snapshot)) throw new Error('TEAMS_PROGRESS_REVISION_CONFLICT');
          return;
        }
        const previous = record.latest.responseText ?? record.streamedText;
        if (snapshot.responseText !== undefined && !snapshot.responseText.startsWith(previous)) {
          throw new Error('TEAMS_PROGRESS_RESPONSE_NOT_CUMULATIVE');
        }
        record.latest = structuredClone(snapshot);
        return;
      }
      const chat = chatFor(ledger, binding);
      const streaming = binding.conversationType === 'personal' && !chat.ownerJobId && !terminal(snapshot.status)
        && !['awaiting_approval', 'input_required'].includes(snapshot.status);
      record = { binding: structuredClone(binding), latest: structuredClone(snapshot), sentRevision: -1,
        mode: streaming ? 'stream' : 'activity', state: 'active', streamSequence: 0, streamedText: '' };
      ledger.records.push(record);
      if (streaming) chat.ownerJobId = binding.jobId;
    });
    return this.flush(binding);
  }

  /** Invoke when nextDueAt arrives; publish coalesces progress and never sleeps. */
  async flush(binding: TeamsJobProgressBinding): Promise<TeamsJobProgressResult> {
    assertBinding(binding);
    const reserved = await this.options.state.transact(ledger => {
      assertLedger(ledger);
      const record = findRecord(ledger, binding);
      const now = this.time();
      if (record.state !== 'active') return { result: resultFor(record, now) };
      const chat = chatFor(ledger, binding);
      if (record.mode === 'stream' && chat.ownerJobId !== binding.jobId) throw new Error('TEAMS_PROGRESS_STREAM_AUTHORITY');
      const elapsed = record.streamStartedAt === undefined ? 0 : now - record.streamStartedAt;
      const closing = record.mode === 'stream' && record.activityId !== undefined
        && (terminal(record.latest.status) || ['awaiting_approval', 'input_required'].includes(record.latest.status) || elapsed >= CLOSE_AT);
      if (record.sentRevision >= record.latest.revision && !closing) return { result: resultFor(record, now) };
      const lastAttempt = record.mode === 'stream' ? chat.lastAttemptAt : record.lastAttemptAt;
      if (lastAttempt !== undefined && now - lastAttempt < INTERVAL) {
        return { result: { ...resultFor(record, now), state: 'pending' as const, nextDueAt: lastAttempt + INTERVAL } };
      }
      const snapshot = structuredClone(record.latest);
      let kind: TeamsJobProgressRequest['kind'];
      let activity: TeamsJobProgressActivity;
      if (record.mode === 'stream' && !closing) {
        // Once response streaming begins, informative updates have no effect.
        // Retain the accepted response and show changed status in the final card.
        if (record.streamedText && snapshot.responseText === undefined) {
          record.sentRevision = snapshot.revision;
          return { result: resultFor(record, now) };
        }
        const response = snapshot.responseText !== undefined;
        kind = !record.activityId ? 'start-stream' : response ? 'stream-response' : 'stream-informative';
        const sequence = record.streamSequence + 1;
        const streamType = response ? 'streaming' : 'informative';
        const streamInfo = { type: 'streaminfo', ...(record.activityId ? { streamId: record.activityId } : {}),
          streamType, streamSequence: sequence };
        activity = bindActivity(binding, { type: 'typing', text: response ? snapshot.responseText : informativeText(snapshot.text),
          entities: [streamInfo], channelData: { ...streamInfo, type: undefined } });
        if (record.streamStartedAt === undefined) record.streamStartedAt = now;
      } else {
        const message = snapshot.message ?? renderTeamsJobProgressMessage(snapshot);
        activity = bindActivity(binding, structuredClone(message));
        kind = record.activityId ? 'update-activity' : 'create-activity';
        if (closing && elapsed < EXPIRES_AT) {
          kind = 'stream-final';
          // Final text must contain every accepted response chunk. Informative
          // text is replaceable, so the card can carry the full state alone.
          const streamed = record.streamedText;
          const finalText = snapshot.responseText ?? (message.text?.startsWith(streamed) ? message.text : undefined)
            ?? (streamed || '작업 상태가 갱신되었습니다.');
          if (!finalText.startsWith(streamed)) throw new Error('TEAMS_PROGRESS_RESPONSE_NOT_CUMULATIVE');
          activity.text = finalText;
          activity.entities = [...(message.entities ?? []).filter(entity => entity.type !== 'streaminfo'),
            { type: 'streaminfo', streamId: record.activityId, streamType: 'final' }];
        }
      }
      if (record.activityId) activity.id = record.activityId;
      const request: TeamsJobProgressRequest = { operationId: randomUUID(), binding: structuredClone(binding), kind,
        method: kind === 'update-activity' ? 'update' : 'create',
        ...(record.activityId ? { activityId: record.activityId } : {}), activity };
      record.pending = { request: structuredClone(request), snapshot, reservedAt: now };
      record.state = 'in-flight'; record.lastAttemptAt = now;
      if (record.mode === 'stream') chat.lastAttemptAt = now;
      return { request };
    });
    if (!reserved.request) return reserved.result!;
    let receipt: TeamsJobProgressReceipt;
    try { receipt = await this.options.adapter.send(reserved.request); }
    catch { receipt = { state: 'ambiguous' }; }
    return this.acknowledge(binding, reserved.request.operationId, receipt);
  }

  /** Call once at startup, before accepting new publishes. Pending intent means
   * acceptance is unknown; it is never replayed. Known streams retain their ID,
   * sequence and deadline. This method also flushes known due final states. */
  async recover(): Promise<TeamsJobProgressResult[]> {
    const bindings = await this.options.state.transact(ledger => {
      assertLedger(ledger);
      for (const record of ledger.records) if (record.state === 'in-flight') record.state = 'ambiguous';
      return ledger.records.map(record => structuredClone(record.binding));
    });
    const results: TeamsJobProgressResult[] = [];
    for (const binding of bindings) results.push(await this.flush(binding));
    return results;
  }

  /** Only an exact, independently established connector receipt can unblock
   * ambiguous delivery. Never fabricate accepted/rejected from elapsed time. */
  async reconcile(binding: TeamsJobProgressBinding, operationId: string, receipt: TeamsJobProgressReceipt) {
    assertBinding(binding);
    return this.acknowledge(binding, operationId, receipt);
  }

  private async acknowledge(binding: TeamsJobProgressBinding, operationId: string, receipt: TeamsJobProgressReceipt) {
    return this.options.state.transact(ledger => {
      assertLedger(ledger);
      const record = findRecord(ledger, binding);
      if (!record.pending || record.pending.request.operationId !== operationId) throw new Error('TEAMS_PROGRESS_RECEIPT_MISMATCH');
      const pending = record.pending;
      const existingId = record.activityId;
      if (receipt.state === 'accepted') {
        const receivedId = receipt.activityId;
        if ((!existingId && !safeText(receivedId, 4096)) || (receivedId !== undefined && receivedId !== existingId && existingId)) {
          record.state = 'ambiguous';
          return resultFor(record, this.time());
        }
        record.activityId = existingId ?? receivedId;
        record.sentRevision = pending.snapshot.revision;
        if (['start-stream', 'stream-informative', 'stream-response'].includes(pending.request.kind)) {
          record.streamSequence += 1;
          if (pending.snapshot.responseText !== undefined) record.streamedText = pending.snapshot.responseText;
        } else {
          record.mode = 'activity'; releaseChat(ledger, record);
        }
        record.state = terminal(pending.snapshot.status) ? 'terminal' : 'active';
        record.pending = undefined;
      } else if (receipt.state === 'rejected' && receipt.reason === 'stopped') {
        record.state = 'stopped'; record.pending = undefined; releaseChat(ledger, record);
      } else if (receipt.state === 'rejected' && record.mode === 'stream'
        && ((receipt.reason === 'timeout' && existingId) || receipt.reason === 'unsupported')) {
        record.mode = 'activity'; record.state = 'active'; record.pending = undefined; releaseChat(ledger, record);
      } else if (receipt.state === 'rejected') {
        record.state = 'blocked'; record.pending = undefined;
      } else {
        record.state = 'ambiguous';
      }
      return resultFor(record, this.time());
    });
  }

  private time() {
    const now = this.now();
    if (!Number.isFinite(now) || now < 0) throw new Error('TEAMS_PROGRESS_CLOCK_INVALID');
    return now;
  }
}

function safeText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value.trim().length > 0
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value);
}
function assertBinding(binding: TeamsJobProgressBinding) {
  if (!binding || ['jobId', 'tenantId', 'requesterId', 'conversationId', 'originActivityId', 'originThreadId', 'serviceUrl']
    .some(field => !safeText(binding[field as keyof TeamsJobProgressBinding], 4096))) throw new Error('TEAMS_PROGRESS_AUTHORITY_INVALID');
  if (!['personal', 'groupChat', 'channel'].includes(binding.conversationType)) throw new Error('TEAMS_PROGRESS_AUTHORITY_INVALID');
  // The authenticated activity's service URL allowlist is the adapter's boundary.
  let serviceUrl: URL;
  try { serviceUrl = new URL(binding.serviceUrl); } catch { throw new Error('TEAMS_PROGRESS_AUTHORITY_INVALID'); }
  if (serviceUrl.protocol !== 'https:' || serviceUrl.username || serviceUrl.password || serviceUrl.search || serviceUrl.hash) {
    throw new Error('TEAMS_PROGRESS_AUTHORITY_INVALID');
  }
}
function assertSnapshot(snapshot: TeamsJobProgressSnapshot) {
  if (!snapshot || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) throw new Error('TEAMS_PROGRESS_REVISION_INVALID');
  if (!Object.hasOwn(statusLabels, snapshot.status)) throw new Error('TEAMS_PROGRESS_STATUS_INVALID');
  if (!safeText(snapshot.text, 20_000)) throw new Error('TEAMS_PROGRESS_TEXT_INVALID');
  if (snapshot.responseText !== undefined && !safeText(snapshot.responseText, 20_000)) throw new Error('TEAMS_PROGRESS_RESPONSE_TEXT_INVALID');
  if (snapshot.message !== undefined && snapshot.message.type !== 'message') throw new Error('TEAMS_PROGRESS_MESSAGE_INVALID');
}
function assertAuthority(stored: TeamsJobProgressBinding, received: TeamsJobProgressBinding) {
  if ((Object.keys(stored) as Array<keyof TeamsJobProgressBinding>).some(key => stored[key] !== received[key])) {
    throw new Error('TEAMS_PROGRESS_AUTHORITY_MISMATCH');
  }
}
function assertLedger(ledger: TeamsJobProgressLedger) {
  if (!ledger || ledger.schema !== 1 || !Array.isArray(ledger.records) || !Array.isArray(ledger.chats)) {
    throw new Error('TEAMS_PROGRESS_STATE_INVALID');
  }
  const ids = new Set<string>();
  for (const record of ledger.records) {
    assertBinding(record.binding); assertSnapshot(record.latest);
    if (ids.has(record.binding.jobId) || !Number.isSafeInteger(record.sentRevision) || record.sentRevision < -1
      || !Number.isSafeInteger(record.streamSequence) || record.streamSequence < 0
      || typeof record.streamedText !== 'string' || !['stream', 'activity'].includes(record.mode)
      || !['active', 'in-flight', 'ambiguous', 'blocked', 'stopped', 'terminal'].includes(record.state)
      || (['in-flight', 'ambiguous'].includes(record.state) && !record.pending)) throw new Error('TEAMS_PROGRESS_STATE_INVALID');
    if (record.pending) {
      assertAuthority(record.binding, record.pending.request.binding); assertSnapshot(record.pending.snapshot);
      if (!safeText(record.pending.request.operationId, 200)) throw new Error('TEAMS_PROGRESS_STATE_INVALID');
    }
    if (record.stopDispatch !== undefined) {
      const dispatch = record.stopDispatch;
      if (!dispatch || record.state !== 'stopped' || !safeText(dispatch.operationId, 200)
        || !['claimed', 'settled', 'ambiguous'].includes(dispatch.state)
        || !Number.isSafeInteger(dispatch.claimedAt) || dispatch.claimedAt < 0
        || (dispatch.state === 'claimed' ? dispatch.settledAt !== undefined
          : !Number.isSafeInteger(dispatch.settledAt) || dispatch.settledAt! < dispatch.claimedAt)) {
        throw new Error('TEAMS_PROGRESS_STOP_DISPATCH_INVALID');
      }
      assertBinding(dispatch.binding); assertAuthority(record.binding, dispatch.binding);
    }
    ids.add(record.binding.jobId);
  }
}
export { assertLedger as assertTeamsJobProgressLedger };
function findRecord(ledger: TeamsJobProgressLedger, binding: TeamsJobProgressBinding) {
  const record = ledger.records.find(candidate => candidate.binding.jobId === binding.jobId);
  if (!record) throw new Error('TEAMS_PROGRESS_JOB_MISSING');
  assertAuthority(record.binding, binding);
  return record;
}
function chatFor(ledger: TeamsJobProgressLedger, binding: TeamsJobProgressBinding) {
  let chat = ledger.chats.find(candidate => candidate.tenantId === binding.tenantId && candidate.conversationId === binding.conversationId);
  if (!chat) { chat = { tenantId: binding.tenantId, conversationId: binding.conversationId }; ledger.chats.push(chat); }
  return chat;
}
function releaseChat(ledger: TeamsJobProgressLedger, record: TeamsJobProgressRecord) {
  const chat = chatFor(ledger, record.binding);
  if (chat.ownerJobId === record.binding.jobId) chat.ownerJobId = undefined;
}
function resultFor(record: TeamsJobProgressRecord, now: number): TeamsJobProgressResult {
  const state = record.state === 'in-flight' ? 'pending' : record.state;
  let nextDueAt: number | undefined;
  if (record.state === 'active') {
    if (record.latest.revision > record.sentRevision) nextDueAt = Math.max(now, (record.lastAttemptAt ?? -INTERVAL) + INTERVAL);
    if (record.mode === 'stream' && record.streamStartedAt !== undefined) {
      const deadline = Math.max(now, record.streamStartedAt + CLOSE_AT);
      nextDueAt = nextDueAt === undefined ? deadline : Math.min(nextDueAt, deadline);
    }
  }
  return { jobId: record.binding.jobId, state, ...(record.activityId ? { activityId: record.activityId } : {}),
    ...(record.pending ? { operationId: record.pending.request.operationId } : {}), ...(nextDueAt === undefined ? {} : { nextDueAt }) };
}
function bindActivity(binding: TeamsJobProgressBinding, message: Omit<TeamsJobProgressActivity, 'channelId' | 'conversation' | 'replyToId'>): TeamsJobProgressActivity {
  return { ...message, channelId: 'msteams', replyToId: binding.originThreadId,
    conversation: { id: binding.conversationId, conversationType: binding.conversationType, tenantId: binding.tenantId } };
}
function informativeText(text: string) {
  let result = '';
  for (const character of text.trim()) {
    if (Buffer.byteLength(result + character, 'utf8') > 1000 || result.length + character.length > 1000) break;
    result += character;
  }
  return result;
}
