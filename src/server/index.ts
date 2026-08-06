import path from 'node:path';

import express from 'express';
import { CopilotRuntime } from '@copilotkit/runtime/v2';
import { createCopilotExpressHandler } from '@copilotkit/runtime/v2/express';

import { createUserAuthMiddleware } from './user-auth.js';
import { ItemStore } from './item-store.js';
import { AgentJobStore, type AgentJob } from './agent-job-store.js';
import { AgentService } from './agent-service.js';
import { CodexRunner } from './codex-runner.js';
import { GitService } from './git-service.js';
import { TeamsCodexAgent } from './copilot-agent.js';
import { formatWeatherMessage, getWeather } from './weather-service.js';
import { GenUiActionStore, type GenUiActionName } from './genui-action-store.js';
import { GenUiResponseFactory } from './genui-response.js';
import { createAdaptiveCardActivity, createTextFallbackActivity, renderGenUiCard } from './genui-teams.js';
import { createMcpGenUiRouter } from './mcp-genui.js';
import {
  GENUI_ACTION_PAYLOAD_KEYS,
  GENUI_SCHEMA_VERSION,
  GenUiEnvelopeV1Schema,
  type GenUiEnvelopeV1,
} from '../shared/genui.js';

const port = Number(process.env.PORT ?? 3978);
const skipAuth = process.env.TEAMS_SKIP_AUTH === 'true';
const skipOutbound = process.env.TEAMS_SKIP_OUTBOUND === 'true';
const mcpEnabled = skipAuth || process.env.MCP_PUBLIC_ENABLED === 'true';
const clientDist = path.resolve(process.cwd(), 'dist/client');
const itemStore = new ItemStore(
  process.env.ITEM_STORE_PATH ?? path.resolve(process.cwd(), 'data/items.json'),
);
const agentJobStore = new AgentJobStore(
  process.env.AGENT_JOB_STORE_PATH ?? path.resolve(process.cwd(), 'data/agent-jobs.json'),
);
const codexRunner = new CodexRunner();
const agentWorkspace = path.resolve(process.env.AGENT_WORKSPACE ?? process.cwd());
const gitService = new GitService(agentWorkspace);
const botClientId = process.env.BOT_CLIENT_ID ?? process.env.CLIENT_ID;
const botConfigured = Boolean(botClientId && process.env.CLIENT_SECRET && process.env.TENANT_ID);
const useTeamsSdk = process.env.TEAMS_USE_SDK !== 'false' && botConfigured;
const userAuthConfigured = Boolean(
  process.env.CLIENT_ID && process.env.TENANT_ID && process.env.APPLICATION_ID_URI,
);
const genUiMode = process.env.TEAMS_GENUI_MODE === 'legacy' || process.env.TEAMS_GENUI_MODE === 'channels-shadow'
  ? process.env.TEAMS_GENUI_MODE
  : 'hybrid';
const genUiActionStore = new GenUiActionStore(
  process.env.GENUI_ACTION_STORE_PATH ?? path.resolve(process.cwd(), 'data/genui-actions.json'),
);
const genUi = new GenUiResponseFactory(genUiActionStore);

if (process.env.NODE_ENV === 'production' && skipAuth) {
  throw new Error('TEAMS_SKIP_AUTH must not be enabled in production.');
}

await itemStore.initialize();
await genUiActionStore.initialize();

let http: any;
let teamsApp: any;
let userAuthValidator: any;
const localOutbox = new Map<string, string[]>();
const localOutboxActivities = new Map<string, unknown[]>();

type BotSend = (text: string, envelope?: GenUiEnvelopeV1) => Promise<void>;
type GenUiCardAction = Extract<GenUiActionName, 'approve' | 'cancel' | 'refresh' | 'feedback'>;
type GenUiActionPayload = {
  schemaVersion: typeof GENUI_SCHEMA_VERSION;
  action: GenUiCardAction;
  entityId: string;
  correlationId: string;
  actionToken: string;
};

const GENUI_CARD_ACTIONS = ['approve', 'cancel', 'refresh', 'feedback'] as const satisfies readonly GenUiCardAction[];
const inFlightGenUiActions = new Set<string>();

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function envelopeText(envelope: GenUiEnvelopeV1): string {
  return envelope.fallbackText ?? envelope.summary ?? envelope.title ?? '요청 결과를 카드로 확인하세요.';
}

function prepareMcpZodCompatibility(): void {
  // @modelcontextprotocol/sdk 1.x detects object schemas through `.shape`.
  // The shared GenUI contract is a ZodEffects schema because it contains
  // cross-field rules; expose its underlying object shape without weakening
  // the original parse/safeParse validation.
  const schema = GenUiEnvelopeV1Schema as any;
  if (schema.shape === undefined && schema._def?.schema?.shape) {
    Object.defineProperty(schema, 'shape', {
      configurable: true,
      enumerable: false,
      value: schema._def.schema.shape,
    });
  }
}

async function deliverGenUiActivity(
  deliver: ((activity: unknown) => Promise<unknown>) | undefined,
  text: string,
  envelope?: GenUiEnvelopeV1,
): Promise<void> {
  if (!deliver) return;

  const normalized = envelope ? GenUiEnvelopeV1Schema.parse(envelope) : undefined;
  const activity = normalized && genUiMode !== 'legacy'
    ? createAdaptiveCardActivity(normalized)
    : { type: 'message', text };

  try {
    await deliver(activity);
  } catch (error) {
    if (!normalized) throw error;
    await deliver(createTextFallbackActivity(normalized));
  }
}

function createBotSender(
  deliver?: (activity: unknown) => Promise<unknown>,
  messages?: string[],
  activities?: unknown[],
): BotSend {
  return async (text, envelope) => {
    const normalized = envelope ? GenUiEnvelopeV1Schema.parse(envelope) : undefined;
    const activity = normalized && genUiMode !== 'legacy'
      ? createAdaptiveCardActivity(normalized)
      : { type: 'message', text };

    if (messages) {
      messages.push(text);
      activities?.push(activity);
      return;
    }

    await deliverGenUiActivity(deliver, text, normalized);
  };
}

if (useTeamsSdk) {
  const teams = await import('@microsoft/teams.apps');
  http = new teams.ExpressAdapter();
  teamsApp = new teams.App({
    httpServerAdapter: http,
    clientId: botClientId,
    clientSecret: process.env.CLIENT_SECRET,
    tenantId: process.env.TENANT_ID,
    applicationIdUri: process.env.APPLICATION_ID_URI,
    dangerouslyAllowUnauthenticatedRequests: skipAuth,
  });

  // A Teams tab SSO token is issued for the Entra app declared in
  // webApplicationInfo, which is intentionally separate from the Bot app ID.
  // Build a second public SDK App instance only to reuse its Entra validator;
  // it is never started and does not handle HTTP traffic.
  const userAuthApp = new teams.App({
    clientId: process.env.CLIENT_ID,
    tenantId: process.env.TENANT_ID,
    applicationIdUri: process.env.APPLICATION_ID_URI,
  });
  userAuthValidator = userAuthApp.entraTokenValidator;
} else {
  // Local mode keeps the browser and API fully runnable even when the host machine
  // has an incompatible optional auth dependency. Production Teams traffic uses the SDK branch above.
  http = express();
}

http.use(express.json());

http.get('/api/health', (_request: any, response: any) => {
  response.json({
    ok: true,
    service: 'teams-sdk-mvp',
    version: '0.1.0',
    environment: process.env.NODE_ENV ?? 'development',
    auth: skipAuth ? 'local-bypass' : 'teams-authenticated',
    userAuth: skipAuth ? 'local-bypass' : userAuthConfigured ? 'entra-sso' : 'not-configured',
    bot: teamsApp ? 'teams-sdk' : 'local-handler',
    outbound: teamsApp ? (skipOutbound ? 'disabled' : 'teams-sdk') : 'local-outbox',
    agent: process.env.CODEX_BIN ?? 'codex-cli',
    agentWorkspace,
    storage: 'file-json',
    copilotKit: 'enabled',
    copilotKitRuntime: '/api/copilotkit',
    genAI: process.env.COPILOTKIT_DETERMINISTIC_MODE === 'true'
      ? 'deterministic-test'
      : process.env.OPENAI_API_KEY?.trim()
        ? 'openai-configured'
        : 'not-configured',
    genUiMode,
    genUi: 'adaptive-cards',
    mcpEnabled,
    mcp: mcpEnabled ? '/mcp' : 'disabled',
    timestamp: new Date().toISOString(),
  });
});

http.use(
  '/api/items',
  createUserAuthMiddleware({
    allowUnauthenticated: skipAuth,
    validator: userAuthValidator,
  }),
);

http.get('/api/items', (_request: any, response: any) => {
  response.json({ items: itemStore.list(), summary: itemStore.summary() });
});

http.get('/api/items/:id', (request: any, response: any) => {
  const id = Number(request.params.id);
  const item = itemStore.list().find((candidate) => candidate.id === id);

  if (!item) {
    response.status(404).json({ error: 'item not found' });
    return;
  }

  response.json({ item });
});

http.get('/api/weather', async (request: any, response: any) => {
  const latitude = Number(request.query?.latitude);
  const longitude = Number(request.query?.longitude);
  const demo = request.query?.mode === 'demo';

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    response.status(400).json({ error: 'latitude must be between -90 and 90' });
    return;
  }

  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    response.status(400).json({ error: 'longitude must be between -180 and 180' });
    return;
  }

  try {
    response.json(await getWeather(latitude, longitude, { demo }));
  } catch (error) {
    console.error('Weather lookup failed', error);
    response.status(502).json({ error: '날씨 정보를 가져오지 못했습니다.' });
  }
});

http.get('/privacy', (_request: any, response: any) => {
  response.type('html').send('<h1>Privacy</h1><p>Internal MVP privacy information.</p>');
});

http.get('/termsOfUse', (_request: any, response: any) => {
  response.type('html').send('<h1>Terms of Use</h1><p>Internal MVP terms of use.</p>');
});

http.post('/api/items', async (request: any, response: any) => {
  const title = typeof request.body?.title === 'string' ? request.body.title.trim() : '';

  if (!title) {
    response.status(400).json({ error: 'title is required' });
    return;
  }

  const item = await itemStore.add(title);
  response.status(201).json({ item });
});

http.put('/api/items/:id', async (request: any, response: any) => {
  const id = Number(request.params.id);
  const title = typeof request.body?.title === 'string' ? request.body.title.trim() : '';

  if (!title) {
    response.status(400).json({ error: 'title is required' });
    return;
  }

  const item = await itemStore.update(id, title);
  if (!item) {
    response.status(404).json({ error: 'item not found' });
    return;
  }

  response.json({ item });
});

http.patch('/api/items/:id', async (request: any, response: any) => {
  const id = Number(request.params.id);
  const item = await itemStore.toggle(id);

  if (!item) {
    response.status(404).json({ error: 'item not found' });
    return;
  }

  response.json({ item });
});

http.delete('/api/items/:id', async (request: any, response: any) => {
  const id = Number(request.params.id);
  const item = await itemStore.remove(id);

  if (!item) {
    response.status(404).json({ error: 'item not found' });
    return;
  }

  response.json({ item });
});

let agentService: AgentService;

const notifyConversation = async (conversationId: string, text: string): Promise<void> => {
  const cardSummary = text.length > 1_900
    ? `${text.slice(0, 1_900)}\n(카드에서 일부 생략됨)`
    : text;
  const envelope = genUiMode === 'legacy'
    ? undefined
    : genUi.answer(cardSummary, `notification-${Date.now().toString(36)}`);
  if (teamsApp && !skipOutbound) {
    await deliverGenUiActivity(
      (activity) => teamsApp.send(conversationId, activity),
      text,
      envelope,
    );
    return;
  }

  const messages = localOutbox.get(conversationId) ?? [];
  localOutbox.set(conversationId, messages);
  const activities = localOutboxActivities.get(conversationId) ?? [];
  localOutboxActivities.set(conversationId, activities);
  await createBotSender(undefined, messages, activities)(text, envelope);
};

agentService = new AgentService(
  agentJobStore,
  codexRunner,
  agentWorkspace,
  notifyConversation,
  gitService,
);
await agentService.initialize();

if (mcpEnabled) {
  prepareMcpZodCompatibility();
  const mcpRouter = createMcpGenUiRouter({
    itemStore,
    agentService,
    getWeather,
    sessionMode: process.env.MCP_SESSION_MODE === 'stateless' ? 'stateless' : 'stateful',
    enableJsonResponse: true,
    serverVersion: process.env.APP_VERSION ?? '1.0.0',
  });
  http.use('/mcp', mcpRouter);
}

const copilotRuntime = new CopilotRuntime({
  agents: {
    default: new TeamsCodexAgent(itemStore, agentService),
  },
});

http.use(
  '/api/copilotkit',
  createUserAuthMiddleware({
    allowUnauthenticated: skipAuth,
    validator: userAuthValidator,
  }),
);
http.use(createCopilotExpressHandler({
  runtime: copilotRuntime,
  basePath: '/api/copilotkit',
  cors: false,
}));

http.use(
  '/api/agent-jobs',
  createUserAuthMiddleware({
    allowUnauthenticated: skipAuth,
    validator: userAuthValidator,
  }),
);
http.post('/api/agent-jobs/:id/approve', async (request: any, response: any) => {
  const job = await agentService.approve(request.params.id);
  if (!job) {
    response.status(404).json({ error: 'approval target not found' });
    return;
  }

  response.json({ job });
});
http.post('/api/agent-jobs/:id/cancel', async (request: any, response: any) => {
  const job = await agentService.cancel(request.params.id);
  if (!job) {
    response.status(404).json({ error: 'cancellation target not found' });
    return;
  }

  response.json({ job });
});

function formatAgentJob(job: AgentJob): string {
  const lines = [
    `작업 ID: ${job.id}`,
    `상태: ${job.status}`,
    `권한: ${job.mode}`,
  ];

  if (job.threadId) lines.push(`Codex thread: ${job.threadId}`);
  if (job.commitHash) lines.push(`Git commit: ${job.commitHash}`);
  if (job.commitMessage && !job.commitHash) lines.push(`Git: ${job.commitMessage}`);
  if (job.progress.length > 0) lines.push(`최근 진행: ${job.progress[job.progress.length - 1]}`);
  if (job.error) lines.push(`오류: ${job.error}`);
  if (job.result) lines.push(`결과:\n${job.result.slice(0, 5000)}`);
  return lines.join('\n');
}

const genUiActionPayloadKeys = new Set<string>(GENUI_ACTION_PAYLOAD_KEYS);

function readGenUiActionPayload(activity: any): GenUiActionPayload | undefined {
  const value = asRecord(activity?.value);
  if (!value) return undefined;

  const nestedAction = asRecord(value.action);
  const payload = asRecord(nestedAction?.data) ?? value;
  const keys = Object.keys(payload);
  if (keys.length !== GENUI_ACTION_PAYLOAD_KEYS.length || keys.some((key) => !genUiActionPayloadKeys.has(key))) {
    return undefined;
  }

  const { schemaVersion, action, entityId, correlationId, actionToken } = payload;
  if (
    schemaVersion !== GENUI_SCHEMA_VERSION
    || typeof action !== 'string'
    || !GENUI_CARD_ACTIONS.includes(action as GenUiCardAction)
    || typeof entityId !== 'string'
    || entityId.length === 0
    || typeof correlationId !== 'string'
    || correlationId.length === 0
    || typeof actionToken !== 'string'
    || actionToken.length === 0
  ) {
    return undefined;
  }

  return {
    schemaVersion,
    action: action as GenUiCardAction,
    entityId,
    correlationId,
    actionToken,
  };
}

function hasGenUiActionValue(activity: any): boolean {
  if (activity?.type === 'invoke' && activity?.name === 'adaptiveCard/action') return true;
  const value = asRecord(activity?.value);
  return Boolean(
    value && (
      'schemaVersion' in value
      || 'actionToken' in value
      || asRecord(value.action)?.data
    ),
  );
}

function genUiInvokeResponse(envelope: GenUiEnvelopeV1): {
  status: 200;
  body: {
    statusCode: 200;
    type: 'application/vnd.microsoft.card.adaptive';
    value: ReturnType<typeof renderGenUiCard>;
  };
} {
  return {
    status: 200,
    body: {
      statusCode: 200,
      type: 'application/vnd.microsoft.card.adaptive',
      value: renderGenUiCard(envelope),
    },
  };
}

function actionRejectionMessage(reason: string): string {
  switch (reason) {
    case 'expired': return '이 카드 액션은 만료되었습니다. 최신 작업 상태를 다시 확인하세요.';
    case 'consumed': return '이미 처리된 카드 액션입니다.';
    case 'mismatch': return '카드 액션의 사용자·대화·작업 정보가 일치하지 않습니다.';
    default: return '유효하지 않은 카드 액션입니다.';
  }
}

async function resolveGenUiAction(activity: any): Promise<GenUiEnvelopeV1> {
  const payload = readGenUiActionPayload(activity);
  if (!payload) {
    return genUi.actionError('유효하지 않은 GenUI 카드 액션입니다.');
  }

  const conversationId = activity.conversation?.id ?? 'unknown-conversation';
  const requesterId = activity.from?.id ?? 'unknown-user';
  const actionKey = [
    requesterId,
    conversationId,
    payload.entityId,
    payload.correlationId,
    payload.action,
    payload.actionToken,
  ].join('|');

  if (inFlightGenUiActions.has(actionKey)) {
    const job = agentService.get(payload.entityId);
    if (payload.action === 'cancel' && job) return genUi.cancelled(job);
    if (payload.action === 'approve' && job) return genUi.approvalAccepted(job);
    return genUi.jobStatus(job);
  }

  inFlightGenUiActions.add(actionKey);
  try {
    const consumed = await genUiActionStore.consume({
      token: payload.actionToken,
      action: payload.action,
      entityId: payload.entityId,
      correlationId: payload.correlationId,
      conversationId,
      requesterId,
    });

    if (!consumed.ok) {
      if (consumed.reason === 'consumed') {
        const job = agentService.get(payload.entityId);
        if (payload.action === 'cancel' && job) return genUi.cancelled(job);
        if (payload.action === 'approve' && job) return genUi.approvalAccepted(job);
        return genUi.jobStatus(job);
      }
      return genUi.actionError(actionRejectionMessage(consumed.reason));
    }

    let envelope: GenUiEnvelopeV1;
    if (payload.action === 'approve') {
      const job = await agentService.approve(payload.entityId);
      envelope = job
        ? genUi.approvalAccepted(job)
        : genUi.error(`작업 ${payload.entityId}을 찾을 수 없습니다.`, `action-${payload.entityId}`);
    } else if (payload.action === 'cancel') {
      const job = await agentService.cancel(payload.entityId);
      envelope = job
        ? genUi.cancelled(job)
        : genUi.error(`작업 ${payload.entityId}을 찾을 수 없습니다.`, `action-${payload.entityId}`);
    } else if (payload.action === 'refresh') {
      const job = agentService.get(payload.entityId);
      if (job?.status === 'awaiting_approval') {
        envelope = await genUi.approval(job);
      } else {
        envelope = genUi.jobStatus(job);
      }
    } else {
      envelope = genUi.answer('피드백을 확인했습니다. 결정형 처리 결과를 기록했습니다.', `feedback-${payload.entityId}`);
    }

    return envelope;
  } catch (error) {
    console.error('GenUI action failed', error);
    return genUi.error('카드 액션을 처리하지 못했습니다. 잠시 후 다시 시도하세요.');
  } finally {
    inFlightGenUiActions.delete(actionKey);
  }
}

async function handleGenUiAction(activity: any): Promise<ReturnType<typeof genUiInvokeResponse>> {
  return genUiInvokeResponse(await resolveGenUiAction(activity));
}

async function handleGenUiSubmit(activity: any, send: BotSend): Promise<void> {
  const envelope = await resolveGenUiAction(activity);
  await send(envelopeText(envelope), envelope);
}

async function handleMessage(activity: any, send: BotSend): Promise<void> {
  const userText = activity.text?.replace(/<at>.*?<\/at>/gi, '').trim() || '';
  const normalizedText = userText.toLowerCase();
  const conversationId = activity.conversation?.id ?? 'unknown-conversation';
  const requesterId = activity.from?.id ?? 'unknown-user';

  if (normalizedText === 'help') {
    const responseText = '사용 가능한 명령: help, weather [위도 경도], status, list, run <작업>, continue <작업 ID> <추가 요청>, write <작업>, approve <작업 ID>, commit <작업 ID> [메시지], cancel <작업 ID>';
    const envelope = genUi.help();
    await send(responseText, envelope);
    return;
  }

  const weatherMatch = userText.match(/^(?:weather|날씨)(?:\s+([-+]?\d+(?:\.\d+)?)\s+([-+]?\d+(?:\.\d+)?))?$/i);
  if (weatherMatch) {
    const isExplicitLocation = Boolean(weatherMatch[1] && weatherMatch[2]);

    if (!isExplicitLocation) {
      const responseText = 'Bot 대화에는 현재 기기 위치가 자동으로 전달되지 않습니다. Teams 탭에서 “내 위치 사용”을 누르거나, weather 37.5665 126.978처럼 좌표를 함께 입력하세요.';
      const envelope = genUi.weatherUnavailable();
      await send(responseText, envelope);
      return;
    }

    const latitude = Number(weatherMatch[1]);
    const longitude = Number(weatherMatch[2]);

    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      const responseText = '위도는 -90~90, 경도는 -180~180 범위로 입력하세요. 예: weather 37.5665 126.978';
      const envelope = genUi.invalidCoordinates();
      await send(responseText, envelope);
      return;
    }

    try {
      const weather = await getWeather(latitude, longitude);
      const responseText = formatWeatherMessage(weather);
      await send(responseText, genUi.weather(weather));
    } catch {
      const responseText = '날씨 정보를 가져오지 못했습니다. 잠시 후 다시 시도하세요.';
      await send(responseText, genUi.error(responseText, 'weather-error'));
    }
    return;
  }

  if (normalizedText === 'status' || normalizedText.startsWith('status ')) {
    const jobId = userText.split(/\s+/)[1];
    if (jobId) {
      const job = agentService.get(jobId);
      const responseText = job ? formatAgentJob(job) : `작업 ${jobId}을 찾을 수 없습니다.`;
      await send(responseText, job ? genUi.jobStatus(job) : genUi.error(responseText, `status-${jobId}`));
      return;
    }

    const openCount = itemStore.countOpen();
    const responseText = `현재 진행 중인 업무는 ${openCount}개이며, 에이전트 활성 작업은 ${agentService.countActive()}개입니다.`;
    const envelope = genUi.status(openCount, agentService.countActive());
    await send(responseText, envelope);
    return;
  }

  if (normalizedText === 'list') {
    const openItems = itemStore.list().filter((item) => item.status === 'open').slice(0, 8);
    const jobs = agentService.list(5);
    const itemText = openItems.length === 0
      ? '진행 중인 업무가 없습니다.'
      : `진행 중인 업무:\n${openItems.map((item) => `- ${item.title}`).join('\n')}`;
    const jobText = jobs.length === 0
      ? '에이전트 작업이 없습니다.'
      : `최근 에이전트 작업:\n${jobs.map((job) => `- ${job.id}: ${job.status}`).join('\n')}`;
    const responseText = `${itemText}\n\n${jobText}`;
    await send(responseText, genUi.list(itemStore.list(), jobs));
    return;
  }

  const commandMatch = userText.match(/^(run|write)\s+([\s\S]+)$/i);
  if (commandMatch) {
    const mode = commandMatch[1].toLowerCase() === 'write' ? 'workspace-write' : 'read-only';
    const job = await agentService.submit({
      prompt: commandMatch[2].trim(),
      mode,
      conversationId,
      requesterId,
    });

    if (mode === 'workspace-write') {
      const responseText = `쓰기 작업 ${job.id}이 승인 대기 중입니다.\napprove ${job.id} 또는 cancel ${job.id}`;
      const envelope = await genUi.approval(job);
      await send(responseText, envelope);
    } else {
      const responseText = `읽기 전용 Codex 작업 ${job.id}을 시작했습니다.\nstatus ${job.id}로 진행 상태를 확인할 수 있습니다.`;
      const envelope = genUi.started(job);
      await send(responseText, envelope);
    }
    return;
  }

  const approveMatch = userText.match(/^approve\s+(task-[\w-]+)$/i);
  if (approveMatch) {
    const job = await agentService.approve(approveMatch[1]);
    if (job) {
      const responseText = `작업 ${job.id} 승인을 처리했습니다.\nstatus ${job.id}`;
      const envelope = genUi.approvalAccepted(job);
      await send(responseText, envelope);
    } else {
      const responseText = '승인할 작업을 찾을 수 없습니다.';
      await send(responseText, genUi.error(responseText, 'approve-missing'));
    }
    return;
  }

  const continueMatch = userText.match(/^continue\s+(task-[\w-]+)\s+([\s\S]+)$/i);
  if (continueMatch) {
    const job = await agentService.continue(continueMatch[1], continueMatch[2].trim());
    if (job) {
      const responseText = `작업 ${job.id}이 이전 Codex thread에서 이어집니다.\nstatus ${job.id}`;
      const envelope = genUi.continued(job);
      await send(responseText, envelope);
    } else {
      const responseText = '재개할 Codex thread가 있는 작업을 찾을 수 없습니다.';
      await send(responseText, genUi.error(responseText, 'continue-missing'));
    }
    return;
  }

  const commitMatch = userText.match(/^commit\s+(task-[\w-]+)(?:\s+([\s\S]+))?$/i);
  if (commitMatch) {
    const commitMessage = commitMatch[2]?.trim() || `feat: apply Teams task ${commitMatch[1]}`;
    const job = await agentService.commit(commitMatch[1], commitMessage);
    if (!job) {
      const responseText = '커밋할 작업을 찾을 수 없습니다.';
      await send(responseText, genUi.error(responseText, 'commit-missing'));
    } else if (job.status !== 'completed') {
      const responseText = `작업 ${job.id}은 아직 커밋할 수 없습니다. 현재 상태: ${job.status}`;
      await send(responseText, genUi.commitResult(job, true));
    } else {
      const responseText = job.commitMessage || '커밋할 변경이 없습니다.';
      const envelope = genUi.commitResult(job);
      await send(responseText, envelope);
    }
    return;
  }

  const cancelMatch = userText.match(/^cancel\s+(task-[\w-]+)$/i);
  if (cancelMatch) {
    const job = await agentService.cancel(cancelMatch[1]);
    if (job) {
      const responseText = `작업 ${job.id} 취소를 처리했습니다.\n상태: ${job.status}`;
      const envelope = genUi.cancelled(job);
      await send(responseText, envelope);
    } else {
      const responseText = '취소할 작업을 찾을 수 없습니다.';
      await send(responseText, genUi.error(responseText, 'cancel-missing'));
    }
    return;
  }

  if (userText) {
    const previous = agentService.latestCompletedForConversation(conversationId);
    if (previous) {
      const continued = await agentService.continue(previous.id, userText);
      if (continued) {
        const responseText = `이전 Codex 대화를 이어서 작업 ${continued.id}을 시작했습니다.\nstatus ${continued.id}`;
        const envelope = genUi.continued(continued);
        await send(responseText, envelope);
        return;
      }
    }

    const job = await agentService.submit({
      prompt: userText,
      mode: 'read-only',
      conversationId,
      requesterId,
    });
    const responseText = `자연어 작업 ${job.id}을 읽기 전용으로 시작했습니다.\nstatus ${job.id}`;
    const envelope = genUi.naturalLanguageStarted(job);
    await send(responseText, envelope);
    return;
  }

  const responseText = '내용이 없습니다. help를 입력해 사용 가능한 명령을 확인하세요.';
  await send(responseText, genUi.error(responseText, 'empty-message'));
}

async function handleInstall(activity: any, send: BotSend): Promise<void> {
  const conversationType = activity.conversation?.conversationType;
  const scopeHint = conversationType === 'channel' || conversationType === 'groupChat'
    ? '이 대화'
    : '개인 공간';

  const text = `업무 허브가 ${scopeHint}에 추가되었습니다. 탭에서 업무와 현재 위치 날씨를 확인하고, help·날씨·status·list 명령으로 기능을 사용할 수 있습니다.`;
  await send(text, genUi.install(scopeHint));
}

// The Bot Framework normally receives this outbound activity from Teams.
// In local mode, return the generated response directly so the full message loop is testable.
if (teamsApp) {
  teamsApp.tab('home', clientDist);
  teamsApp.on('install.add', async ({ activity, send }: any) => {
    const runtimeSend: BotSend = process.env.TEAMS_SKIP_OUTBOUND === 'true'
      ? async () => {}
      : createBotSender(send);
    await handleInstall(activity, runtimeSend);
  });
  teamsApp.on('message', async ({ activity, send }: any) => {
    if (activity?.type === 'message' && hasGenUiActionValue(activity)) {
      const runtimeSend: BotSend = process.env.TEAMS_SKIP_OUTBOUND === 'true'
        ? async () => {}
        : createBotSender(send);
      await handleGenUiSubmit(activity, runtimeSend);
      return;
    }

    if (activity?.type === 'invoke' && hasGenUiActionValue(activity)) {
      return handleGenUiAction(activity);
    }

    const runtimeSend: BotSend = process.env.TEAMS_SKIP_OUTBOUND === 'true'
      ? async () => {}
      : createBotSender(send);
    await handleMessage(activity, runtimeSend);
  });

  for (const action of GENUI_CARD_ACTIONS) {
    teamsApp.on(`card.action.${action}`, async ({ activity }: any) => handleGenUiAction(activity));
  }
} else {
  http.post('/api/messages', async (request: any, response: any) => {
    if (!skipAuth) {
      response.status(401).json({ error: 'Bot authentication is not configured' });
      return;
    }

    if (request.body?.type === 'message' && hasGenUiActionValue(request.body)) {
      const messages: string[] = [];
      const activities: unknown[] = [];
      const send = createBotSender(undefined, messages, activities);
      await handleGenUiSubmit(request.body, send);
      response.json({ messages, activities });
      return;
    }

    if (request.body?.type === 'invoke' && hasGenUiActionValue(request.body)) {
      const invokeResponse = await handleGenUiAction(request.body);
      response.status(invokeResponse.status).json(invokeResponse.body);
      return;
    }

    const messages: string[] = [];
    const activities: unknown[] = [];
    const send = createBotSender(undefined, messages, activities);

    if (request.body?.type === 'installationUpdate' && request.body?.action === 'add') {
      await handleInstall(request.body, send);
    } else {
      await handleMessage(request.body, send);
    }

    response.json({ messages, activities });
  });

  http.get('/tabs/home', (_request: any, response: any) => {
    response.sendFile(path.join(clientDist, 'index.html'));
  });
  http.use('/tabs/home', express.static(clientDist));
}

if (skipAuth) {
  http.get('/api/debug/agent-jobs', (_request: any, response: any) => {
    response.json({ jobs: agentService.list(50) });
  });

  http.get('/api/debug/agent-outbox/:conversationId', (request: any, response: any) => {
    const conversationId = request.params.conversationId;
    const messages = localOutbox.get(conversationId) ?? [];
    const activities = localOutboxActivities.get(conversationId) ?? [];
    localOutbox.delete(conversationId);
    localOutboxActivities.delete(conversationId);
    response.json({ conversationId, messages, activities });
  });
}

if (skipAuth) {
  http.post('/v3/conversations/:conversationId/activities', (_request: any, response: any) => {
    response.status(201).json({ id: 'local-outbound-activity' });
  });
}

if (teamsApp) {
  await teamsApp.start(port);
} else {
  await new Promise<void>((resolve) => {
    http.listen(port, () => resolve());
  });
}

console.log(`Tab URL: http://localhost:${port}/tabs/home`);
console.log(`Teams messages: http://localhost:${port}/api/messages`);
