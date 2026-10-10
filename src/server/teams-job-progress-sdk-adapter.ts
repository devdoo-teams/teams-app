import type { ActivityParams } from '@microsoft/teams.api';
import type { TeamsJobProgressBinding, TeamsJobProgressRequest, TeamsJobProgressReceipt } from './teams-job-progress.js';

/** Structural subset of the installed @microsoft/teams.api 2.0.15 Client. */
export interface TeamsJobProgressSdkClient {
  readonly serviceUrl: string;
  conversations: {
    createActivity(conversationId: string, activity: ActivityParams): Promise<unknown>;
    updateActivity(conversationId: string, activityId: string, activity: ActivityParams): Promise<unknown>;
  };
}

/**
 * https://learn.microsoft.com/en-us/microsoftteams/platform/bots/streaming-ux
 * https://learn.microsoft.com/en-us/microsoftteams/platform/bots/build-conversational-capability#update-messages
 *
 * The caller supplies its existing authenticated SDK client and configured bot
 * identity. clientFor must authorize the persisted authenticated-activity binding
 * and allowvalidate its Teams service URL before returning that client. This
 * wrapper does not create credentials, conversations, action grants or retries.
 */
export function createTeamsJobProgressSdkAdapter(options: {
  botId: string; clientFor(binding: TeamsJobProgressBinding): TeamsJobProgressSdkClient;
}) {
  if (!safeText(options.botId)) throw new Error('TEAMS_PROGRESS_BOT_ID_INVALID');
  return { send: async (request: TeamsJobProgressRequest): Promise<TeamsJobProgressReceipt> => {
    let client: TeamsJobProgressSdkClient;
    let payload: ActivityParams;
    try {
      assertRequest(request);
      client = options.clientFor(structuredClone(request.binding));
      if (client.serviceUrl !== request.binding.serviceUrl) throw new Error('TEAMS_PROGRESS_SERVICE_URL_MISMATCH');
      // ActivityParams accepts both message and typing inputs plus channel
      // extensions. The verified wire fields remain intact; from is bot-owned.
      payload = { ...structuredClone(request.activity), from: { id: options.botId, role: 'bot' } } as ActivityParams;
    } catch { return { state: 'rejected', reason: 'rejected' }; }

    try {
      const response = request.method === 'update'
        ? await client.conversations.updateActivity(request.binding.conversationId, request.activityId!, payload)
        : await client.conversations.createActivity(request.binding.conversationId, payload);
      if (object(response)?.error !== undefined) return { state: 'ambiguous' };
      const returnedId = object(response)?.id;
      if (returnedId !== undefined && !safeText(returnedId)) return { state: 'ambiguous' };
      if (request.activityId) {
        if (returnedId !== undefined && returnedId !== request.activityId) return { state: 'ambiguous' };
        return { state: 'accepted', activityId: request.activityId };
      }
      return safeText(returnedId) ? { state: 'accepted', activityId: returnedId } : { state: 'ambiguous' };
    } catch (error) { return classifyFailure(error); }
  } };
}

function assertRequest(request: TeamsJobProgressRequest): void {
  const binding = request.binding;
  if (!binding || !safeText(request.operationId) || ['jobId', 'tenantId', 'requesterId', 'conversationId', 'originActivityId', 'originThreadId', 'serviceUrl']
    .some(field => !safeText(binding[field as keyof TeamsJobProgressBinding]))) throw new Error('TEAMS_PROGRESS_REQUEST_INVALID');
  if (!['personal', 'groupChat', 'channel'].includes(binding.conversationType)) throw new Error('TEAMS_PROGRESS_REQUEST_INVALID');
  const url = new URL(binding.serviceUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('TEAMS_PROGRESS_REQUEST_INVALID');
  const activity = request.activity;
  if (!activity || activity.channelId !== 'msteams' || activity.replyToId !== binding.originThreadId
    || activity.conversation?.id !== binding.conversationId || activity.conversation.tenantId !== binding.tenantId
    || activity.conversation.conversationType !== binding.conversationType) throw new Error('TEAMS_PROGRESS_REQUEST_INVALID');
  const native = ['start-stream', 'stream-informative', 'stream-response', 'stream-final'].includes(request.kind);
  const initial = ['start-stream', 'create-activity'].includes(request.kind);
  if (!native && !['create-activity', 'update-activity'].includes(request.kind)) throw new Error('TEAMS_PROGRESS_REQUEST_INVALID');
  if (request.method !== (request.kind === 'update-activity' ? 'update' : 'create')) throw new Error('TEAMS_PROGRESS_REQUEST_INVALID');
  if (initial ? request.activityId !== undefined || activity.id !== undefined
    : !safeText(request.activityId) || activity.id !== request.activityId) throw new Error('TEAMS_PROGRESS_REQUEST_INVALID');
  const streams = (activity.entities ?? []).filter(entity => entity.type === 'streaminfo');
  if (!native) {
    if (activity.type !== 'message' || streams.length) throw new Error('TEAMS_PROGRESS_REQUEST_INVALID');
    return;
  }
  if (binding.conversationType !== 'personal' || streams.length !== 1) throw new Error('TEAMS_PROGRESS_REQUEST_INVALID');
  const stream = streams[0];
  if (initial ? stream.streamId !== undefined : stream.streamId !== request.activityId) throw new Error('TEAMS_PROGRESS_REQUEST_INVALID');
  if (request.kind === 'stream-final') {
    if (activity.type !== 'message' || stream.streamType !== 'final' || stream.streamSequence !== undefined) throw new Error('TEAMS_PROGRESS_REQUEST_INVALID');
  } else {
    if (activity.type !== 'typing' || activity.attachments?.length || !safeText(activity.text, 20_000)
      || !['informative', 'streaming'].includes(String(stream.streamType))
      || !Number.isSafeInteger(stream.streamSequence) || Number(stream.streamSequence) < 1
      || (initial && stream.streamSequence !== 1)
      || (request.kind === 'stream-informative' && stream.streamType !== 'informative')
      || (request.kind === 'stream-response' && stream.streamType !== 'streaming')) throw new Error('TEAMS_PROGRESS_REQUEST_INVALID');
    if (stream.streamType === 'informative' && (activity.text!.length > 1000 || Buffer.byteLength(activity.text!, 'utf8') > 1000)) {
      throw new Error('TEAMS_PROGRESS_REQUEST_INVALID');
    }
  }
}

function classifyFailure(error: unknown): TeamsJobProgressReceipt {
  const response = object(object(error)?.response);
  const status = response?.status;
  const bodyError = object(object(response?.data)?.error);
  // A network error, a 5xx, or exception text is not proof of rejection. In
  // particular, never infer the native Stop action from wording alone.
  if (typeof status !== 'number' || status < 400 || status >= 500 || !safeText(bodyError?.code)) return { state: 'ambiguous' };
  if (status === 403 && bodyError?.code === 'ContentStreamNotAllowed') {
    const message = typeof bodyError.message === 'string' ? bodyError.message.trim().replace(/\.$/u, '').toLowerCase() : '';
    if (message === 'content stream was canceled by user') return { state: 'rejected', reason: 'stopped' };
    if (message === 'content stream finished due to exceeded streaming time') return { state: 'rejected', reason: 'timeout' };
    if (message === 'content stream is not allowed') return { state: 'rejected', reason: 'unsupported' };
  }
  return { state: 'rejected', reason: 'rejected' };
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}
function safeText(value: unknown, limit = 4096): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= limit
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value);
}
