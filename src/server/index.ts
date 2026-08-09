import path from 'node:path';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import crypto from 'node:crypto';

import express from 'express';
import { CopilotRuntime } from '@copilotkit/runtime/v2';
import { createCopilotExpressHandler } from '@copilotkit/runtime/v2/express';

import { createUserAuthMiddleware, parseAcceptedAudiences } from './user-auth.js';
import { ItemStore, MAX_ITEM_TITLE_LENGTH, type ItemScope } from './item-store.js';
import {
  AgentJobStore,
  MAX_AGENT_SCOPE_VALUE_LENGTH,
  type AgentJob,
  type AgentJobScope,
} from './agent-job-store.js';
import {
  AgentMutationAuthorizationError,
  AgentJobConflictError,
  AgentService,
  normalizeAgentPrompt,
  type AgentNotification,
} from './agent-service.js';
import { CodexRunner } from './codex-runner.js';
import { GitService } from './git-service.js';
import { TeamsCodexAgent } from './copilot-agent.js';
import { DeterministicResponseEngine } from './response-engine-deterministic.js';
import { LocalCompatibleResponseEngine } from './response-engine-local.js';
import { OpenAIResponseEngine } from './response-engine-openai.js';
import { ResponseEngineRouter, configureResponseEngineRouter } from './response-engine.js';
import { ResponseModeStore } from './response-mode-store.js';
import {
  createResponseModeCardActivity,
  isResponseModeCardAction,
  parseResponseModeCardAction,
  type PublicResponseModeAvailability,
} from './response-mode-card.js';
import { formatWeatherMessage, getWeather } from './weather-service.js';
import { GenUiActionStore, type GenUiActionName } from './genui-action-store.js';
import { GenUiResponseFactory } from './genui-response.js';
import {
  createAdaptiveCardActivity,
  createTextFallbackActivity,
  renderGenUiCard,
  renderGenUiCardDiagnostic,
} from './genui-teams.js';
import { createMcpGenUiRouter, type McpGenUiRouter } from './mcp-genui.js';
import { ChannelsShadowMonitor } from './channels-shadow-monitor.js';
import { renderChannelsShadow } from './copilot-channels-shadow.js';
import { acquireStoreProcessLease, type StoreProcessLease } from './process-lease.js';
import { buildTeamsPersonalTabDeepLink } from './teams-tab-link.js';
import { isLocalModelBaseUrlConfigured } from './local-model-url.js';
import {
  GENUI_ACTION_PAYLOAD_KEYS,
  GENUI_SCHEMA_VERSION,
  GenUiEnvelopeV1Schema,
  type GenUiEnvelopeV1,
} from '../shared/genui.js';
import {
  ResponseModeSelectionSchema,
  responseModeLabel,
  type ResponseMode,
} from '../shared/response-mode.js';
import { isValidPublicHostname } from '../shared/public-hostname.js';
import type { RunAgentInput } from '@ag-ui/core';

const port = Number(process.env.PORT ?? 3978);
const isProduction = process.env.NODE_ENV === 'production';
const skipAuth = process.env.TEAMS_SKIP_AUTH === 'true';
const skipOutbound = process.env.TEAMS_SKIP_OUTBOUND === 'true';
const localDev = process.env.TEAMS_LOCAL_DEV === 'true';
const publicHintNames = ['PUBLIC_BASE_URL', 'TAB_DOMAIN', 'BOT_DOMAIN', 'DEV_TUNNEL_ID'] as const;
const publicHints = publicHintNames.filter((name) => Boolean(process.env[name]?.trim()));
const safeLocal = skipAuth && localDev && !isProduction && publicHints.length === 0;
const LOCAL_ACCESS_TOKEN_HEADER = 'x-teams-local-access-token';
const MIN_LOCAL_ACCESS_TOKEN_LENGTH = 32;
const localAccessToken = process.env.TEAMS_LOCAL_ACCESS_TOKEN?.trim() ?? '';
const legacyPublicMcp = process.env.MCP_PUBLIC_ENABLED?.trim().toLowerCase() === 'true';
const fileJsonMultiWorker = numericEnvGreaterThan('WEB_CONCURRENCY', 1)
  || numericEnvGreaterThan('NODE_APP_INSTANCE', 0);
const clientDist = path.resolve(process.cwd(), 'dist/client');
const itemStorePath = process.env.ITEM_STORE_PATH ?? path.resolve(process.cwd(), 'data/items.json');
const agentJobStorePath = process.env.AGENT_JOB_STORE_PATH ?? path.resolve(process.cwd(), 'data/agent-jobs.json');
const genUiActionStorePath = process.env.GENUI_ACTION_STORE_PATH ?? path.resolve(process.cwd(), 'data/genui-actions.json');
const responseModeStorePath = process.env.RESPONSE_MODE_STORE_PATH ?? path.resolve(process.cwd(), 'data/response-modes.json');
const itemStore = new ItemStore(
  itemStorePath,
);
const agentJobStore = new AgentJobStore(
  agentJobStorePath,
);
const codexRunner = new CodexRunner();
const agentWorkspace = path.resolve(process.env.AGENT_WORKSPACE ?? process.cwd());
const gitService = new GitService(agentWorkspace);
const explicitBotClientId = process.env.BOT_CLIENT_ID?.trim() ?? '';
const configuredClientId = process.env.CLIENT_ID?.trim() ?? '';
const configuredTenantId = process.env.TENANT_ID?.trim() ?? '';
const configuredApplicationIdUri = process.env.APPLICATION_ID_URI?.trim() ?? '';
const botClientId = explicitBotClientId || (!isProduction ? configuredClientId : '');
const tabDomain = process.env.TAB_DOMAIN?.trim() ?? '';
const botConfigured = Boolean(botClientId && process.env.CLIENT_SECRET?.trim() && configuredTenantId);
const useTeamsSdk = process.env.TEAMS_USE_SDK !== 'false' && botConfigured;
const userAuthConfigured = Boolean(configuredClientId && configuredTenantId && configuredApplicationIdUri);
const acceptedUserAudiences = parseAcceptedAudiences(process.env.TEAMS_USER_AUTH_ACCEPTED_AUDIENCES);
const operatorAllowlist = parseOperatorAllowlist(
  process.env.TEAMS_OPERATOR_REQUESTER_ALLOWLIST,
  configuredTenantId,
);
const appVersion = (() => {
  const configured = process.env.APP_VERSION?.trim();
  if (configured) return configured;

  try {
    const manifest = JSON.parse(
      readFileSync(path.resolve(process.cwd(), 'appPackage/manifest.json'), 'utf8'),
    ) as { version?: unknown };
    return typeof manifest.version === 'string' && manifest.version.trim()
      ? manifest.version.trim()
      : 'unknown';
  } catch {
    return 'unknown';
  }
})();
const mcpEnabled = safeLocal;
const genUiMode = process.env.TEAMS_GENUI_MODE === 'legacy' || process.env.TEAMS_GENUI_MODE === 'channels-shadow'
  ? process.env.TEAMS_GENUI_MODE
  : 'hybrid';
const genUiActionStore = new GenUiActionStore(
  genUiActionStorePath,
);
const responseModeStore = new ResponseModeStore(responseModeStorePath);
const personalTabDeepLink = buildTeamsPersonalTabDeepLink({
  appId: process.env.TEAMS_APP_ID ?? '',
  tabDomain: process.env.TAB_DOMAIN ?? '',
  tenantId: configuredTenantId || undefined,
});
const genUi = new GenUiResponseFactory(genUiActionStore, {
  openTabUrl: personalTabDeepLink,
});
const channelsShadowMonitor = new ChannelsShadowMonitor();
const openAiConfigured = Boolean(process.env.OPENAI_API_KEY?.trim());
const openAiModel = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
const weatherMode = process.env.WEATHER_MODE === 'demo' ? 'demo' : 'live';
const responseProviders = {
  deterministic: true,
  openai: openAiConfigured,
  local: isLocalModelBaseUrlConfigured(process.env.LOCAL_MODEL_BASE_URL),
} as const;

if (legacyPublicMcp) {
  throw new Error('MCP_PUBLIC_ENABLED=true is no longer supported; MCP is local-only and requires the safe local gate.');
}

if (fileJsonMultiWorker) {
  throw new Error('file-json storage is single-process only; configure one worker or migrate to a transactional shared store.');
}

if (skipAuth && !safeLocal) {
  const reason = isProduction
    ? 'production mode'
    : !localDev
      ? 'TEAMS_LOCAL_DEV=true is required'
      : `public deployment hints are set: ${publicHints.join(', ')}`;
  throw new Error(`TEAMS_SKIP_AUTH=true is unsafe (${reason}).`);
}

if (safeLocal && localAccessToken.length < MIN_LOCAL_ACCESS_TOKEN_LENGTH) {
  throw new Error(`TEAMS_LOCAL_ACCESS_TOKEN must be at least ${MIN_LOCAL_ACCESS_TOKEN_LENGTH} characters in safe local mode.`);
}

if (isProduction && !explicitBotClientId) {
  throw new Error('Production requires BOT_CLIENT_ID to be explicitly configured.');
}

if (isProduction && (!botConfigured || !useTeamsSdk)) {
  throw new Error('Production requires BOT_CLIENT_ID, CLIENT_SECRET, TENANT_ID, and the Teams SDK runtime.');
}

if (isProduction && !userAuthConfigured) {
  throw new Error('Production requires CLIENT_ID, TENANT_ID, and APPLICATION_ID_URI for user SSO.');
}

if (isProduction && !isDeploymentGuid(explicitBotClientId)) {
  throw new Error('Production BOT_CLIENT_ID must be a UUID.');
}

if (isProduction && !isDeploymentGuid(configuredClientId)) {
  throw new Error('Production CLIENT_ID must be a UUID.');
}

if (isProduction && !isDeploymentGuid(configuredTenantId)) {
  throw new Error('Production TENANT_ID must be a UUID.');
}

if (isProduction && acceptedUserAudiences.length === 0) {
  throw new Error('Production requires TEAMS_USER_AUTH_ACCEPTED_AUDIENCES for delegated user-token audience validation.');
}

if (
  isProduction
  && acceptedUserAudiences.some(
    (audience) => audience !== configuredClientId && audience !== configuredApplicationIdUri,
  )
) {
  throw new Error('Production TEAMS_USER_AUTH_ACCEPTED_AUDIENCES entries must match CLIENT_ID or APPLICATION_ID_URI.');
}

if (isProduction && operatorAllowlist.invalidEntries.length > 0) {
  throw new Error('Production TEAMS_OPERATOR_REQUESTER_ALLOWLIST entries must use tenantId/requesterId or an unambiguous requesterId with TENANT_ID.');
}

if (isProduction && !tabDomain) {
  throw new Error('Production requires TAB_DOMAIN for the combined bot+tab SSO resource.');
}

if (isProduction && !isValidPublicHostname(process.env.TAB_DOMAIN)) {
  throw new Error('Production TAB_DOMAIN must be a public HTTPS hostname without a scheme, path, wildcard, or localhost.');
}

if (isProduction) {
  const expectedApplicationIdUri = `api://${tabDomain}/botid-${explicitBotClientId}`;
  if (configuredApplicationIdUri !== expectedApplicationIdUri) {
    throw new Error(`Production APPLICATION_ID_URI must match ${expectedApplicationIdUri}.`);
  }
}

if (isProduction && skipAuth) {
  throw new Error('TEAMS_SKIP_AUTH must not be enabled in production.');
}

if (isProduction && weatherMode === 'demo') {
  throw new Error('WEATHER_MODE=demo is forbidden in production.');
}

let storeProcessLease: StoreProcessLease | undefined;
storeProcessLease = await acquireStoreProcessLease([
  itemStorePath,
  agentJobStorePath,
  genUiActionStorePath,
  responseModeStorePath,
]);
process.once('exit', () => storeProcessLease?.releaseSync());

await itemStore.initialize();
await genUiActionStore.initialize();
await responseModeStore.initialize();

configureResponseEngineRouter({
  engines: [new LocalCompatibleResponseEngine()],
  resolveMode: async (input) => {
    // This environment flag is intentionally retained only for the existing
    // deterministic test harness. Production users are resolved from the
    // server-owned, tenant/requester-scoped preference store.
    if (process.env.COPILOTKIT_DETERMINISTIC_MODE === 'true') return 'deterministic';
    return responseModeStore.get({
      tenantId: input.scope.tenantId,
      requesterId: input.scope.requesterId,
    });
  },
});

// Bot messages and CopilotKit runs must use the same server-owned resolver.
// The router constructor also includes the globally configured local engine.
const botResponseEngineRouter = new ResponseEngineRouter([
  new DeterministicResponseEngine(),
  new OpenAIResponseEngine(),
]);

let http: any;
let teamsApp: any;
let userAuthValidator: any;
const localOutbox = new Map<string, string[]>();
const localOutboxActivities = new Map<string, unknown[]>();

type BotSend = (text: string, envelope?: GenUiEnvelopeV1, activityOverride?: unknown) => Promise<void>;
type GenUiCardAction = Extract<GenUiActionName, 'approve' | 'cancel' | 'refresh' | 'feedback'>;
type GenUiActionPayload = {
  schemaVersion: typeof GENUI_SCHEMA_VERSION;
  action: GenUiCardAction;
  entityId: string;
  correlationId: string;
  actionToken: string;
};

type UserClaims = Record<string, unknown>;

const GENUI_CARD_ACTIONS = ['approve', 'cancel', 'refresh', 'feedback'] as const satisfies readonly GenUiCardAction[];
const inFlightGenUiActions = new Set<string>();

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmptyString(value: unknown, maxLength = 512): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) return undefined;
  return normalized;
}

function validatePrompt(value: unknown): { value?: string; error?: string } {
  try {
    return { value: normalizeAgentPrompt(value) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : '작업 요청을 처리할 수 없습니다.' };
  }
}

function validateItemTitle(value: unknown): { value?: string; error?: string } {
  if (typeof value !== 'string') return { error: 'title is required' };
  const normalized = value.trim();
  if (!normalized) return { error: 'title is required' };
  if (normalized.length > MAX_ITEM_TITLE_LENGTH) {
    return { error: `title must be ${MAX_ITEM_TITLE_LENGTH} characters or fewer` };
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    return { error: 'title contains unsupported control characters' };
  }
  return { value: normalized };
}

function activityScope(activity: any): AgentJobScope | undefined {
  // Teams SDK activities expose the Entra object id as aadObjectId. Prefer it
  // so Bot and CopilotKit requests share the same server-owned preference scope;
  // the Bot Framework id remains a compatibility fallback for local fixtures.
  const requesterId = nonEmptyString(activity?.from?.aadObjectId)
    ?? nonEmptyString(activity?.from?.id);
  const conversationId = nonEmptyString(activity?.conversation?.id);
  const tenantId = nonEmptyString(activity?.conversation?.tenantId)
    ?? nonEmptyString(activity?.channelData?.tenant?.id);
  if (!requesterId || !conversationId || !tenantId) return undefined;
  return { requesterId, conversationId, tenantId };
}

function itemScopeFromAgentScope(scope: Pick<AgentJobScope, 'requesterId' | 'tenantId'>): ItemScope {
  return { requesterId: scope.requesterId, tenantId: scope.tenantId };
}

function localRestScope(): AgentJobScope {
  return { requesterId: 'local-user', conversationId: '', tenantId: 'local-tenant' };
}

function localItemScope(): ItemScope {
  return itemScopeFromAgentScope(localRestScope());
}

function restConversationId(request: any): { conversationId?: string; error?: string } {
  const bodyConversationId = nonEmptyString(request.body?.conversationId);
  const headerValue = Array.isArray(request.headers?.['x-conversation-id'])
    ? request.headers['x-conversation-id'][0]
    : request.headers?.['x-conversation-id'];
  const headerConversationId = nonEmptyString(headerValue);
  if (bodyConversationId && headerConversationId && bodyConversationId !== headerConversationId) {
    return { error: 'conversationId must match the x-conversation-id header' };
  }
  const conversationId = bodyConversationId ?? headerConversationId;
  return conversationId ? { conversationId } : { error: 'conversationId is required' };
}

function restScope(request: any, response: any): { scope?: AgentJobScope; status?: number; error?: string } {
  const claims = asRecord(response.locals?.user) as UserClaims | undefined;
  const requesterId = nonEmptyString(claims?.requesterId) ?? nonEmptyString(claims?.oid) ?? nonEmptyString(claims?.sub);
  const tenantId = nonEmptyString(claims?.tid);
  const conversation = restConversationId(request);
  if (conversation.error) return { status: 400, error: conversation.error };

  // Local deterministic tests have no token validator. Use a fixed server-side
  // principal; production always requires validated oid/sub and tid claims.
  if (skipAuth && !claims) {
    return { scope: { ...localRestScope(), conversationId: conversation.conversationId! } };
  }
  if (!requesterId || !tenantId) return { status: 401, error: 'validated user identity is required' };
  return { scope: { requesterId, tenantId, conversationId: conversation.conversationId! } };
}

function copilotIdentity(request: any, response: any): { requesterId: string; tenantId: string } | undefined {
  const claims = asRecord(response.locals?.user) as UserClaims | undefined;
  const requesterId = nonEmptyString(claims?.requesterId) ?? nonEmptyString(claims?.oid) ?? nonEmptyString(claims?.sub);
  const tenantId = nonEmptyString(claims?.tid);
  if (requesterId && tenantId) return { requesterId, tenantId };
  if (skipAuth && !claims) return { requesterId: 'local-user', tenantId: 'local-tenant' };
  return undefined;
}

function requestItemScope(_request: any, response: any): ItemScope | undefined {
  const identity = copilotIdentity(undefined, response);
  if (identity) return itemScopeFromAgentScope(identity);
  if (skipAuth && !response.locals?.user) return localItemScope();
  return undefined;
}

function isOperator(scope: Pick<AgentJobScope, 'requesterId' | 'tenantId'>): boolean {
  return operatorAllowlist.principalKeys.has(operatorPrincipalKey(scope.tenantId, scope.requesterId));
}

function mutationAuthorizationMessage(): string {
  return operatorAllowlist.principalKeys.size === 0
    ? '운영자 권한이 필요합니다. 관리자에게 TEAMS_OPERATOR_REQUESTER_ALLOWLIST 설정을 요청하세요.'
    : '운영자 권한이 필요합니다. 허용된 요청자 ID만 쓰기·승인·취소·커밋을 실행할 수 있습니다.';
}

function envelopeText(envelope: GenUiEnvelopeV1): string {
  return envelope.fallbackText ?? envelope.summary ?? envelope.title ?? '요청 결과를 카드로 확인하세요.';
}

function adaptiveCardFromActivity(activity: unknown): Record<string, unknown> | undefined {
  if (!activity || typeof activity !== 'object') return undefined;
  const attachments = (activity as { attachments?: unknown }).attachments;
  if (!Array.isArray(attachments)) return undefined;
  const attachment = attachments.find((candidate) => (
    candidate
    && typeof candidate === 'object'
    && (candidate as { contentType?: unknown }).contentType === 'application/vnd.microsoft.card.adaptive'
  ));
  if (!attachment || typeof attachment !== 'object') return undefined;
  const content = (attachment as { content?: unknown }).content;
  return content && typeof content === 'object' && !Array.isArray(content)
    ? content as Record<string, unknown>
    : undefined;
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function isDirectLoopbackRequest(request: any): boolean {
  const hostHeader = typeof request.headers?.host === 'string' ? request.headers.host.trim() : '';
  if (!isLoopbackHost(hostHeader)) return false;

  const forwardedHeader = Object.keys(request.headers ?? {}).some((name) => (
    name.toLowerCase() === 'forwarded' || name.toLowerCase().startsWith('x-forwarded-')
  ));
  if (forwardedHeader) return false;

  return isLoopbackAddress(request.socket?.remoteAddress);
}

function isUnprotectedLocalResource(request: any): boolean {
  if (!['GET', 'HEAD'].includes(String(request.method ?? '').toUpperCase())) return false;
  const pathname = typeof request.path === 'string' ? request.path : String(request.url ?? '').split('?')[0];
  return pathname === '/privacy'
    || pathname === '/termsOfUse'
    || pathname === '/tabs/home'
    || pathname.startsWith('/tabs/home/');
}

function hasValidLocalAccessToken(request: any): boolean {
  const candidate = request.headers?.[LOCAL_ACCESS_TOKEN_HEADER];
  if (typeof candidate !== 'string') return false;
  const candidateBuffer = Buffer.from(candidate.trim());
  const expectedBuffer = Buffer.from(localAccessToken);
  return candidateBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
}

function isLoopbackHost(value: string): boolean {
  if (!value || value.includes(',') || /\s/.test(value)) return false;
  if (value.startsWith('[')) {
    const closingBracket = value.indexOf(']');
    if (closingBracket === -1) return false;
    const address = value.slice(1, closingBracket);
    const port = value.slice(closingBracket + 1);
    return address === '::1' && (port === '' || /^:\d{1,5}$/.test(port));
  }

  const separator = value.lastIndexOf(':');
  const address = separator === -1 ? value : value.slice(0, separator);
  const port = separator === -1 ? '' : value.slice(separator + 1);
  if (address !== 'localhost' && address !== '127.0.0.1') return false;
  return port === '' || /^\d{1,5}$/.test(port);
}

function isLoopbackAddress(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = value.startsWith('::ffff:') ? value.slice('::ffff:'.length) : value;
  return normalized === '::1' || (isIP(normalized) === 4 && normalized === '127.0.0.1');
}

/** Render Channels only for comparison; the native card remains the delivered activity. */
function recordChannelsShadowComparison(envelope: GenUiEnvelopeV1, nativeActivity: unknown): void {
  if (genUiMode !== 'channels-shadow') return;

  try {
    const nativeCard = adaptiveCardFromActivity(nativeActivity);
    const nativeDiagnostic = renderGenUiCardDiagnostic(envelope);
    const shadow = renderChannelsShadow(envelope);
    const nativeActions = nativeCard?.actions;
    channelsShadowMonitor.record({
      nativeActionCount: Array.isArray(nativeActions) ? nativeActions.length : 0,
      nativeBytes: nativeCard ? jsonBytes(nativeCard) : 0,
      shadowActionCount: shadow.diagnostics.actionCount,
      shadowBytes: shadow.payloadBytes,
      shadowWithinBudget: shadow.diagnostics.withinTeamsBudget,
      nativeSignature: nativeDiagnostic.semanticSignature,
      shadowSignature: shadow.semanticSignature,
      deliveredCardMatchesNative: Boolean(nativeCard)
        && JSON.stringify(nativeCard) === JSON.stringify(nativeDiagnostic.card),
    });
  } catch {
    // Diagnostics must never affect delivery. Do not log payloads or identifiers.
    channelsShadowMonitor.recordFailure();
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

  if (normalized) recordChannelsShadowComparison(normalized, activity);

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
  return async (text, envelope, activityOverride) => {
    const normalized = envelope ? GenUiEnvelopeV1Schema.parse(envelope) : undefined;
    const activity = activityOverride ?? (normalized && genUiMode !== 'legacy'
      ? createAdaptiveCardActivity(normalized)
      : { type: 'message', text });

    if (messages) {
      if (normalized) recordChannelsShadowComparison(normalized, activity);
      messages.push(text);
      activities?.push(activity);
      return;
    }

    if (activityOverride) {
      if (!deliver) return;
      try {
        await deliver(activityOverride);
      } catch {
        await deliver({ type: 'message', text });
      }
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
    tenantId: configuredTenantId || undefined,
    applicationIdUri: configuredApplicationIdUri || undefined,
    dangerouslyAllowUnauthenticatedRequests: skipAuth,
  });

  // A Teams tab SSO token is issued for the Entra app declared in
  // webApplicationInfo, which is intentionally separate from the Bot app ID.
  // Build a second public SDK App instance only to reuse its Entra validator;
  // it is never started and does not handle HTTP traffic.
  const userAuthApp = new teams.App({
    clientId: configuredClientId || undefined,
    tenantId: configuredTenantId || undefined,
    applicationIdUri: configuredApplicationIdUri || undefined,
  });
  userAuthValidator = userAuthApp.entraTokenValidator;
} else {
  // Local mode keeps the browser and API fully runnable even when the host machine
  // has an incompatible optional auth dependency. Production Teams traffic uses the SDK branch above.
  http = express();
}

const loopbackOnly = safeLocal || process.env.TEAMS_BIND_HOST === '127.0.0.1';

if (teamsApp && loopbackOnly) {
  const adapter = http as any;
  const server = adapter.server;
  if (!server || typeof server.listen !== 'function') {
    throw new Error('Local Teams SDK mode cannot prove loopback binding; refusing to start.');
  }

  // The current Teams ExpressAdapter exposes no host argument. Keep local SDK
  // tests loopback-only until the adapter provides one; never fall back to a
  // potentially public bind for a local test process.
  adapter.start = async (listenPort: number | string) => new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, '127.0.0.1', () => resolve());
  });
}

if (safeLocal) {
  // Static tab assets and policy pages are intentionally public. Everything
  // else, including health, Bot, MCP, CopilotKit, data, weather, and debug
  // routes, requires both a direct loopback connection and the explicit local
  // access secret. The gate is before body parsing so rejected requests cannot
  // make the JSON parser process attacker-controlled bodies.
  http.use((request: any, response: any, next: any) => {
    if (isUnprotectedLocalResource(request)) {
      next();
      return;
    }
    if (!isDirectLoopbackRequest(request)) {
      response.status(403).json({ error: 'local development endpoints require a direct loopback request' });
      return;
    }
    if (!hasValidLocalAccessToken(request)) {
      response.status(401).json({ error: 'local development access token is required' });
      return;
    }
    next();
  });
}

http.use(express.json());

http.get('/api/health', (_request: any, response: any) => {
  response.json({
    ok: true,
    service: 'teams-sdk-mvp',
    version: appVersion,
    environment: process.env.NODE_ENV ?? 'development',
    auth: safeLocal ? 'local-bypass' : teamsApp ? 'teams-authenticated' : 'not-configured',
    userAuth: safeLocal ? 'local-bypass' : userAuthConfigured && userAuthValidator ? 'entra-sso' : 'not-configured',
    bot: teamsApp ? 'teams-sdk' : safeLocal ? 'local-handler' : 'not-configured',
    outbound: teamsApp ? (skipOutbound ? 'disabled' : 'teams-sdk') : safeLocal ? 'local-outbox' : 'not-configured',
    storage: 'file-json-single-process',
    copilotKit: 'enabled',
    copilotKitRuntime: '/api/copilotkit',
    genAI: process.env.COPILOTKIT_DETERMINISTIC_MODE === 'true'
      ? 'deterministic-test'
      : openAiConfigured
        ? 'openai-configured'
        : 'not-configured',
    genAIProvider: {
      provider: 'openai',
      configured: openAiConfigured,
      model: openAiModel.slice(0, 120),
    },
    responseProviders,
    weatherMode,
    genUiMode,
    genUi: 'adaptive-cards',
    channelsShadow: genUiMode === 'channels-shadow'
      ? channelsShadowMonitor.snapshot()
      : { enabled: false },
    mcpEnabled,
    mcp: mcpEnabled ? '/mcp' : 'disabled',
    timestamp: new Date().toISOString(),
  });
});

function publicModelLabel(value: string | undefined, fallback: string): string {
  const normalized = value?.trim() ?? '';
  if (!normalized || normalized.length > 120 || /[\u0000-\u001f\u007f]/.test(normalized) || /:\/\/|[?&#]/.test(normalized)) {
    return fallback;
  }
  return normalized;
}

function publicResponseModeAvailability(): PublicResponseModeAvailability[] {
  return responseModeStore.availability().map((entry) => ({
    ...entry,
    ...(entry.mode === 'openai'
      ? { model: publicModelLabel(process.env.OPENAI_MODEL, openAiModel) }
      : entry.mode === 'local'
        ? { model: publicModelLabel(process.env.LOCAL_MODEL_NAME, 'local-model') }
        : {}),
  }));
}

function responseModeScope(request: any, response: any): { tenantId: string; requesterId: string } | undefined {
  const identity = copilotIdentity(request, response);
  return identity ? { tenantId: identity.tenantId, requesterId: identity.requesterId } : undefined;
}

function responseModeActivityScope(activity: any): { tenantId: string; requesterId: string } | undefined {
  const scope = activityScope(activity);
  return scope ? { tenantId: scope.tenantId, requesterId: scope.requesterId } : undefined;
}

async function responseModeStatus(scope: { tenantId: string; requesterId: string }): Promise<{
  mode: ResponseMode;
  availability: PublicResponseModeAvailability[];
}> {
  return {
    mode: await responseModeStore.get(scope),
    availability: publicResponseModeAvailability(),
  };
}

http.use(
  '/api/response-mode',
  createUserAuthMiddleware({
    allowUnauthenticated: skipAuth,
    validator: userAuthValidator,
    configuredTenantId: configuredTenantId || undefined,
    acceptedAudiences: acceptedUserAudiences,
  }),
);

http.get('/api/response-mode', async (request: any, response: any) => {
  const scope = responseModeScope(request, response);
  if (!scope) {
    response.status(401).json({ error: 'validated user identity is required' });
    return;
  }

  try {
    response.json(await responseModeStatus(scope));
  } catch (error) {
    console.error('Response mode status failed', error);
    response.status(500).json({ error: '응답 모드 상태를 확인하지 못했습니다.' });
  }
});

http.post('/api/response-mode', async (request: any, response: any) => {
  const scope = responseModeScope(request, response);
  if (!scope) {
    response.status(401).json({ error: 'validated user identity is required' });
    return;
  }

  const selection = ResponseModeSelectionSchema.safeParse(request.body);
  if (!selection.success) {
    response.status(400).json({ error: 'body must contain only a valid mode' });
    return;
  }

  let currentMode: ResponseMode;
  try {
    currentMode = await responseModeStore.get(scope);
  } catch (error) {
    console.error('Response mode selection status failed', error);
    response.status(500).json({ error: '응답 모드 상태를 확인하지 못했습니다.' });
    return;
  }

  const availability = publicResponseModeAvailability();
  const selected = availability.find((entry) => entry.mode === selection.data.mode);
  if (!selected?.configured) {
    response.status(409).json({
      error: `${responseModeLabel(selection.data.mode)} 응답 모드가 서버에 설정되지 않았습니다. 다른 모드를 선택하거나 관리자에게 서버 설정을 요청하세요.`,
      code: 'response-mode-not-configured',
      mode: currentMode,
      availability,
    });
    return;
  }

  try {
    await responseModeStore.set(scope, selection.data.mode);
    response.json(await responseModeStatus(scope));
  } catch (error) {
    console.error('Response mode selection failed', error);
    response.status(500).json({ error: '응답 모드를 저장하지 못했습니다.' });
  }
});

http.use(
  '/api/items',
  createUserAuthMiddleware({
    allowUnauthenticated: skipAuth,
    validator: userAuthValidator,
    configuredTenantId: configuredTenantId || undefined,
    acceptedAudiences: acceptedUserAudiences,
  }),
);

http.use('/api/items', async (request: any, response: any, next: any) => {
  const scope = requestItemScope(request, response);
  if (!scope) {
    response.status(401).json({ error: 'validated user identity is required' });
    return;
  }
  await itemStore.runWithScope(scope, async () => {
    await itemStore.ensureScope();
    next();
  });
});

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

http.use(
  '/api/weather',
  createUserAuthMiddleware({
    allowUnauthenticated: skipAuth,
    validator: userAuthValidator,
    configuredTenantId: configuredTenantId || undefined,
    acceptedAudiences: acceptedUserAudiences,
  }),
);

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
  const titleResult = validateItemTitle(request.body?.title);

  if (titleResult.error) {
    response.status(400).json({ error: titleResult.error });
    return;
  }

  const item = await itemStore.add(titleResult.value!);
  response.status(201).json({ item });
});

http.put('/api/items/:id', async (request: any, response: any) => {
  const id = Number(request.params.id);
  const titleResult = validateItemTitle(request.body?.title);

  if (titleResult.error) {
    response.status(400).json({ error: titleResult.error });
    return;
  }

  const item = await itemStore.update(id, titleResult.value!);
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

const notifyConversation = async (notification: AgentNotification): Promise<void> => {
  const { conversationId, message } = notification;
  const envelope = genUiMode === 'legacy'
    ? undefined
    : genUi.notification(notification);
  if (teamsApp && !skipOutbound) {
    await deliverGenUiActivity(
      (activity) => teamsApp.send(conversationId, activity),
      message,
      envelope,
    );
    return;
  }

  const messages = localOutbox.get(conversationId) ?? [];
  localOutbox.set(conversationId, messages);
  const activities = localOutboxActivities.get(conversationId) ?? [];
  localOutboxActivities.set(conversationId, activities);
  await createBotSender(undefined, messages, activities)(message, envelope);
};

agentService = new AgentService(
  agentJobStore,
  codexRunner,
  agentWorkspace,
  notifyConversation,
  gitService,
  {
    canMutateScope: (scope) => isOperator(scope),
  },
);
await agentService.initialize();

let mcpRouter: McpGenUiRouter | undefined;
if (mcpEnabled) {
  mcpRouter = createMcpGenUiRouter({
    itemStore,
    agentService,
    getWeather,
    sessionMode: process.env.MCP_SESSION_MODE === 'stateless' ? 'stateless' : 'stateful',
    enableJsonResponse: true,
    serverVersion: appVersion,
  });
  http.use('/mcp', mcpRouter);
}

let shutdownPromise: Promise<void> | undefined;
const handleSignal = (signal: NodeJS.Signals): void => {
  if (shutdownPromise) return;
  shutdownPromise = (async () => {
    try {
      await mcpRouter?.close();
    } finally {
      await storeProcessLease?.release();
      // Removing both handlers before re-sending the signal restores Node's
      // default termination behavior after MCP cleanup and prevents signal
      // listeners from accumulating during repeated local restarts.
      process.removeListener('SIGINT', handleSigint);
      process.removeListener('SIGTERM', handleSigterm);
      process.exitCode = signal === 'SIGINT' ? 130 : 143;
      process.kill(process.pid, signal);
    }
  })();
};
const handleSigint = (): void => handleSignal('SIGINT');
const handleSigterm = (): void => handleSignal('SIGTERM');
process.once('SIGINT', handleSigint);
process.once('SIGTERM', handleSigterm);

const copilotRuntime = new CopilotRuntime({
  agents: ({ request }) => {
    const requesterId = request.headers.get('x-validated-user-id');
    const tenantId = request.headers.get('x-validated-tenant-id');
    if (!requesterId || !tenantId) throw new Error('validated Copilot identity is required');
    return {
      default: new TeamsCodexAgent(
        itemStore,
        agentService,
        { requesterId, tenantId },
        (job) => genUi.approval(job),
      ),
    };
  },
});

http.use(
  '/api/copilotkit',
  createUserAuthMiddleware({
    allowUnauthenticated: skipAuth,
    validator: userAuthValidator,
    configuredTenantId: configuredTenantId || undefined,
    acceptedAudiences: acceptedUserAudiences,
  }),
);
http.use('/api/copilotkit', async (request: any, response: any, next: any) => {
  const identity = copilotIdentity(request, response);
  if (!identity) {
    response.status(401).json({ error: 'validated user identity is required' });
    return;
  }
  // These headers are written only after the auth middleware and are consumed
  // by the request-scoped Copilot agent factory; client forwardedProps are not
  // an identity source.
  request.headers['x-validated-user-id'] = identity.requesterId;
  request.headers['x-validated-tenant-id'] = identity.tenantId;
  await itemStore.runWithScope(itemScopeFromAgentScope(identity), async () => {
    await itemStore.ensureScope();
    next();
  });
});
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
    configuredTenantId: configuredTenantId || undefined,
    acceptedAudiences: acceptedUserAudiences,
  }),
);
http.post('/api/agent-jobs/:id/approve', async (request: any, response: any) => {
  const resolved = restScope(request, response);
  if (!resolved.scope) {
    response.status(resolved.status ?? 400).json({ error: resolved.error ?? 'invalid job scope' });
    return;
  }
  try {
    const job = await agentService.approve(request.params.id, resolved.scope);
    if (!job) {
      response.status(404).json({ error: 'approval target not found' });
      return;
    }

    response.json({ job });
  } catch (error) {
    if (error instanceof AgentMutationAuthorizationError) {
      response.status(403).json({ error: error.message });
      return;
    }
    if (error instanceof AgentJobConflictError) {
      response.status(409).json({ error: error.message, job: error.job });
      return;
    }
    console.error('Agent approval failed', error);
    response.status(500).json({ error: 'approval could not be processed' });
  }
});
http.post('/api/agent-jobs/:id/cancel', async (request: any, response: any) => {
  const resolved = restScope(request, response);
  if (!resolved.scope) {
    response.status(resolved.status ?? 400).json({ error: resolved.error ?? 'invalid job scope' });
    return;
  }
  try {
    const job = await agentService.cancelStrict(request.params.id, resolved.scope);
    if (!job) {
      response.status(404).json({ error: 'cancellation target not found' });
      return;
    }

    response.json({ job });
  } catch (error) {
    if (error instanceof AgentMutationAuthorizationError) {
      response.status(403).json({ error: error.message });
      return;
    }
    if (error instanceof AgentJobConflictError) {
      response.status(409).json({ error: error.message, job: error.job });
      return;
    }
    console.error('Agent cancellation failed', error);
    response.status(500).json({ error: 'cancellation could not be processed' });
  }
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

function mutationConflictEnvelope(error: unknown, fallbackId = 'agent-mutation-error'): GenUiEnvelopeV1 {
  if (error instanceof AgentJobConflictError) {
    return genUi.error(error.message, `${error.action}-${error.job.id}-conflict`);
  }
  return genUi.error('작업 상태가 변경되어 요청을 처리하지 못했습니다. 최신 상태를 확인하세요.', fallbackId);
}

function replayedGenUiAction(action: GenUiCardAction, job: AgentJob | undefined): GenUiEnvelopeV1 {
  if (!job) return genUi.error('작업을 찾을 수 없습니다.');
  if (action === 'refresh') return genUi.jobStatus(job);
  if (action === 'feedback') return genUi.answer('피드백을 이미 확인했습니다.', `feedback-${job.id}`);
  if (action === 'approve' && ['queued', 'running', 'completed', 'failed'].includes(job.status)) {
    return genUi.jobStatus(job);
  }
  if (action === 'cancel' && job.status === 'cancelled') {
    return genUi.cancelled(job);
  }
  return mutationConflictEnvelope(
    new AgentJobConflictError(action === 'approve' ? 'approve' : 'cancel', job),
    `genui-${action}-replay-conflict`,
  );
}

async function resolveGenUiAction(activity: any): Promise<GenUiEnvelopeV1> {
  const payload = readGenUiActionPayload(activity);
  if (!payload) {
    return genUi.actionError('유효하지 않은 GenUI 카드 액션입니다.');
  }

  const scope = activityScope(activity);
  if (!scope) return genUi.actionError('카드 액션에 사용자·대화·테넌트 정보가 없습니다.');
  const { conversationId, requesterId, tenantId } = scope;
  const actionKey = [
    requesterId,
    conversationId,
    tenantId,
    payload.entityId,
    payload.correlationId,
    payload.action,
    payload.actionToken,
  ].join('|');

  if (payload.action === 'approve' || payload.action === 'cancel' || payload.action === 'refresh') {
    // Fail closed before consuming the idempotency grant. A mismatched user,
    // conversation, or tenant therefore cannot even mutate the action store.
    const scopedJob = agentService.get(payload.entityId, scope);
    if (!scopedJob) return genUi.error(`작업 ${payload.entityId}을 찾을 수 없습니다.`, `action-${payload.entityId}`);
  }

  if (inFlightGenUiActions.has(actionKey)) {
    const job = agentService.get(payload.entityId, scope);
    return job ? genUi.jobStatus(job) : genUi.error(`작업 ${payload.entityId}을 찾을 수 없습니다.`, `action-${payload.entityId}`);
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
      tenantId,
    });

    if (!consumed.ok) {
      if (consumed.reason === 'consumed') {
        const job = agentService.get(payload.entityId, scope);
        return replayedGenUiAction(payload.action, job);
      }
      return genUi.actionError(actionRejectionMessage(consumed.reason));
    }

    let envelope: GenUiEnvelopeV1;
    if (payload.action === 'approve') {
      const job = await agentService.approve(payload.entityId, scope);
      envelope = job
        ? genUi.approvalAccepted(job)
        : genUi.error(`작업 ${payload.entityId}을 찾을 수 없습니다.`, `action-${payload.entityId}`);
    } else if (payload.action === 'cancel') {
      const job = await agentService.cancelStrict(payload.entityId, scope);
      envelope = job
        ? genUi.cancelled(job)
        : genUi.error(`작업 ${payload.entityId}을 찾을 수 없습니다.`, `action-${payload.entityId}`);
    } else if (payload.action === 'refresh') {
      const job = agentService.get(payload.entityId, scope);
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
    if (error instanceof AgentMutationAuthorizationError) {
      return genUi.error(error.message, `action-${payload.entityId}-forbidden`);
    }
    if (error instanceof AgentJobConflictError) {
      return mutationConflictEnvelope(error);
    }
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

async function handleResponseModeCommand(activity: any, send: BotSend): Promise<void> {
  const scope = responseModeActivityScope(activity);
  if (!scope) {
    const text = '응답 모드에는 사용자·대화·테넌트 정보가 필요합니다.';
    await send(text, undefined, createResponseModeCardActivity('deterministic', publicResponseModeAvailability(), text));
    return;
  }

  const status = await responseModeStatus(scope);
  const text = `현재 응답 모드는 ${responseModeLabel(status.mode)}입니다.`;
  await send(text, undefined, createResponseModeCardActivity(status.mode, status.availability));
}

async function handleResponseModeSubmit(activity: any, send: BotSend): Promise<void> {
  const scope = responseModeActivityScope(activity);
  if (!scope) {
    const text = '응답 모드에는 사용자·대화·테넌트 정보가 필요합니다.';
    await send(text, undefined, createResponseModeCardActivity('deterministic', publicResponseModeAvailability(), text));
    return;
  }

  const current = await responseModeStore.get(scope);
  const parsed = parseResponseModeCardAction(activity.value);
  if (!parsed) {
    const text = '유효하지 않은 응답 모드 선택입니다.';
    await send(text, undefined, createResponseModeCardActivity(current, publicResponseModeAvailability(), text));
    return;
  }

  const availability = publicResponseModeAvailability();
  const selected = availability.find((entry) => entry.mode === parsed.mode);
  if (!selected?.configured) {
    const text = `${responseModeLabel(parsed.mode)} 응답 모드는 아직 서버에 설정되지 않았습니다. 결정형 또는 사용 가능한 모드를 선택하세요.`;
    await send(text, undefined, createResponseModeCardActivity(current, availability, text));
    return;
  }

  await responseModeStore.set(scope, parsed.mode);
  const text = `응답 모드를 ${responseModeLabel(parsed.mode)}으로 변경했습니다.`;
  await send(text, undefined, createResponseModeCardActivity(parsed.mode, publicResponseModeAvailability(), text));
}

function botResponseRequest(activity: any, prompt: string, scope: AgentJobScope): RunAgentInput {
  return {
    threadId: scope.conversationId,
    runId: `teams-bot-${crypto.randomUUID()}`,
    state: {},
    messages: [{ id: `teams-bot-message-${crypto.randomUUID()}`, role: 'user', content: prompt }],
    tools: [],
    context: [],
    forwardedProps: {
      channelId: nonEmptyString(activity?.channelId) ?? 'msteams',
      conversationType: nonEmptyString(activity?.conversation?.conversationType) ?? 'personal',
    },
  };
}

async function handleBotNaturalLanguage(activity: any, send: BotSend, scope: AgentJobScope, prompt: string): Promise<void> {
  try {
    await itemStore.ensureScope();
    const output = await botResponseEngineRouter.run({
      // The server-owned resolver replaces this fallback with the persisted
      // tenant/requester selection. The deterministic fallback is also the
      // safe behavior for local test mode.
      mode: 'deterministic',
      prompt,
      request: botResponseRequest(activity, prompt, scope),
      scope,
      itemStore,
      agentService,
      setActiveJobId: () => undefined,
      isCancelled: () => false,
      deferAgentCompletion: true,
      approvalEnvelope: (job) => genUi.approval(job),
    });
    await send(output.text, output.envelope);
  } catch (error) {
    if (error instanceof AgentMutationAuthorizationError) {
      await send(error.message, genUi.error(error.message, 'response-engine-forbidden'));
      return;
    }
    console.error('Teams Bot response engine failed', error);
    const text = '응답 엔진을 실행하지 못했습니다. mode에서 사용 가능한 모드를 선택한 뒤 다시 시도하세요.';
    await send(text, genUi.error(text, 'response-engine-error'));
  }
}

async function handleMessage(activity: any, send: BotSend): Promise<void> {
  const userText = typeof activity.text === 'string'
    ? activity.text.replace(/<at>.*?<\/at>/gi, '').trim()
    : '';
  const normalizedText = userText.toLowerCase();
  const scope = activityScope(activity);
  const execute = async (): Promise<void> => {
    if (normalizedText === 'mode' || normalizedText === 'response-mode' || normalizedText === '응답 모드') {
      await handleResponseModeCommand(activity, send);
      return;
    }

    if (normalizedText === 'help') {
      const responseText = '사용 가능한 명령: help, mode, weather [위도 경도], status, list, run <작업>, continue <작업 ID> <추가 요청>, write <작업>, approve <작업 ID>, commit <작업 ID> [메시지], cancel <작업 ID>';
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
      if (!scope) {
        await send('작업 명령에는 사용자·대화·테넌트 정보가 필요합니다.', genUi.error('작업 명령에는 사용자·대화·테넌트 정보가 필요합니다.', 'scope-missing'));
        return;
      }
      const jobId = userText.split(/\s+/)[1];
      if (jobId) {
        const job = agentService.get(jobId, scope);
        const responseText = job ? formatAgentJob(job) : `작업 ${jobId}을 찾을 수 없습니다.`;
        await send(responseText, job ? genUi.jobStatus(job) : genUi.error(responseText, `status-${jobId}`));
        return;
      }

      const openCount = itemStore.countOpen();
      const responseText = `현재 진행 중인 업무는 ${openCount}개이며, 에이전트 활성 작업은 ${agentService.countActive(scope)}개입니다.`;
      const envelope = genUi.status(openCount, agentService.countActive(scope));
      await send(responseText, envelope);
      return;
    }

    if (normalizedText === 'list') {
      if (!scope) {
        await send('작업 명령에는 사용자·대화·테넌트 정보가 필요합니다.', genUi.error('작업 명령에는 사용자·대화·테넌트 정보가 필요합니다.', 'scope-missing'));
        return;
      }
      const openItems = itemStore.list().filter((item) => item.status === 'open').slice(0, 8);
      const jobs = agentService.list(scope, 5);
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
      if (!scope) {
        await send('작업 명령에는 사용자·대화·테넌트 정보가 필요합니다.', genUi.error('작업 명령에는 사용자·대화·테넌트 정보가 필요합니다.', 'scope-missing'));
        return;
      }
      const mode = commandMatch[1].toLowerCase() === 'write' ? 'workspace-write' : 'read-only';
      const promptResult = validatePrompt(commandMatch[2]);
      if (promptResult.error) {
        await send(promptResult.error, genUi.error(promptResult.error, `${mode}-prompt-invalid`));
        return;
      }
      try {
        const job = await agentService.submit({
          prompt: promptResult.value!,
          mode,
          scope,
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
      } catch (error) {
        if (!(error instanceof AgentMutationAuthorizationError)) throw error;
        await send(error.message, genUi.error(error.message, `${mode}-forbidden`));
      }
      return;
    }

  const approveMatch = userText.match(/^approve\s+(task-[\w-]+)$/i);
  if (approveMatch) {
    if (!scope) {
      await send('작업 명령에는 사용자·대화·테넌트 정보가 필요합니다.', genUi.error('작업 명령에는 사용자·대화·테넌트 정보가 필요합니다.', 'scope-missing'));
      return;
    }
    try {
      const job = await agentService.approve(approveMatch[1], scope);
      if (job) {
        const responseText = `작업 ${job.id} 승인을 처리했습니다.\nstatus ${job.id}`;
        const envelope = genUi.approvalAccepted(job);
        await send(responseText, envelope);
      } else {
        const responseText = '승인할 작업을 찾을 수 없습니다.';
        await send(responseText, genUi.error(responseText, 'approve-missing'));
      }
    } catch (error) {
      if (error instanceof AgentMutationAuthorizationError) {
        await send(error.message, genUi.error(error.message, `approve-${approveMatch[1]}-forbidden`));
        return;
      }
      if (!(error instanceof AgentJobConflictError)) throw error;
      await send(error.message, mutationConflictEnvelope(error, `approve-${approveMatch[1]}-conflict`));
    }
    return;
  }

  const continueMatch = userText.match(/^continue\s+(task-[\w-]+)\s+([\s\S]+)$/i);
  if (continueMatch) {
    if (!scope) {
      await send('작업 명령에는 사용자·대화·테넌트 정보가 필요합니다.', genUi.error('작업 명령에는 사용자·대화·테넌트 정보가 필요합니다.', 'scope-missing'));
      return;
    }
    const promptResult = validatePrompt(continueMatch[2]);
    if (promptResult.error) {
      await send(promptResult.error, genUi.error(promptResult.error, 'continue-prompt-invalid'));
      return;
    }
    try {
      const job = await agentService.continue(continueMatch[1], promptResult.value!, scope);
      if (job) {
        const responseText = `작업 ${job.id}이 이전 Codex thread에서 이어집니다.\nstatus ${job.id}`;
        const envelope = genUi.continued(job);
        await send(responseText, envelope);
      } else {
        const responseText = '재개할 Codex thread가 있는 작업을 찾을 수 없습니다.';
        await send(responseText, genUi.error(responseText, 'continue-missing'));
      }
    } catch (error) {
      if (!(error instanceof AgentMutationAuthorizationError)) throw error;
      await send(error.message, genUi.error(error.message, `continue-${continueMatch[1]}-forbidden`));
    }
    return;
  }

  const commitMatch = userText.match(/^commit\s+(task-[\w-]+)(?:\s+([\s\S]+))?$/i);
  if (commitMatch) {
    if (!scope) {
      await send('작업 명령에는 사용자·대화·테넌트 정보가 필요합니다.', genUi.error('작업 명령에는 사용자·대화·테넌트 정보가 필요합니다.', 'scope-missing'));
      return;
    }
    const commitMessage = commitMatch[2]?.trim() || `feat: apply Teams task ${commitMatch[1]}`;
    try {
      const job = await agentService.commit(commitMatch[1], commitMessage, scope);
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
    } catch (error) {
      if (!(error instanceof AgentMutationAuthorizationError)) throw error;
      await send(error.message, genUi.error(error.message, `commit-${commitMatch[1]}-forbidden`));
    }
    return;
  }

  const cancelMatch = userText.match(/^cancel\s+(task-[\w-]+)$/i);
  if (cancelMatch) {
    if (!scope) {
      await send('작업 명령에는 사용자·대화·테넌트 정보가 필요합니다.', genUi.error('작업 명령에는 사용자·대화·테넌트 정보가 필요합니다.', 'scope-missing'));
      return;
    }
    try {
      const job = await agentService.cancelStrict(cancelMatch[1], scope);
      if (job) {
        const responseText = `작업 ${job.id} 취소를 처리했습니다.\n상태: ${job.status}`;
        const envelope = genUi.cancelled(job);
        await send(responseText, envelope);
      } else {
        const responseText = '취소할 작업을 찾을 수 없습니다.';
        await send(responseText, genUi.error(responseText, 'cancel-missing'));
      }
    } catch (error) {
      if (error instanceof AgentMutationAuthorizationError) {
        await send(error.message, genUi.error(error.message, `cancel-${cancelMatch[1]}-forbidden`));
        return;
      }
      if (!(error instanceof AgentJobConflictError)) throw error;
      await send(error.message, mutationConflictEnvelope(error, `cancel-${cancelMatch[1]}-conflict`));
    }
    return;
  }

  if (userText) {
    if (!scope) {
      await send('작업 명령에는 사용자·대화·테넌트 정보가 필요합니다.', genUi.error('작업 명령에는 사용자·대화·테넌트 정보가 필요합니다.', 'scope-missing'));
      return;
    }
    const promptResult = validatePrompt(userText);
    if (promptResult.error) {
      await send(promptResult.error, genUi.error(promptResult.error, 'natural-language-prompt-invalid'));
      return;
    }
    await handleBotNaturalLanguage(activity, send, scope, promptResult.value!);
    return;
  }

  const responseText = '내용이 없습니다. help를 입력해 사용 가능한 명령을 확인하세요.';
  await send(responseText, genUi.error(responseText, 'empty-message'));
  };

  if (!scope) {
    await execute();
    return;
  }

  await itemStore.runWithScope(itemScopeFromAgentScope(scope), async () => {
    await itemStore.ensureScope();
    await execute();
  });
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
    if (activity?.type === 'message' && isResponseModeCardAction(activity.value)) {
      const runtimeSend: BotSend = process.env.TEAMS_SKIP_OUTBOUND === 'true'
        ? async () => {}
        : createBotSender(send);
      await handleResponseModeSubmit(activity, runtimeSend);
      return;
    }

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

    if (request.body?.type === 'message' && isResponseModeCardAction(request.body.value)) {
      const messages: string[] = [];
      const activities: unknown[] = [];
      const send = createBotSender(undefined, messages, activities);
      await handleResponseModeSubmit(request.body, send);
      response.json({ messages, activities });
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
    response.json({ jobs: agentService.listLocalOnly(50) });
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
    if (loopbackOnly) {
      http.listen(port, '127.0.0.1', () => resolve());
      return;
    }
    http.listen(port, () => resolve());
  });
}

console.log(`Tab URL: http://localhost:${port}/tabs/home`);
console.log(`Teams messages: http://localhost:${port}/api/messages`);

function isDeploymentGuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseOperatorAllowlist(
  rawValue: string | undefined,
  configuredTenant: string,
): { principalKeys: Set<string>; invalidEntries: string[] } {
  const principalKeys = new Set<string>();
  const invalidEntries: string[] = [];

  for (const rawEntry of (rawValue ?? '').split(',')) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    const segments = entry.split('/');

    if (segments.length === 1) {
      if (isOperatorIdentifier(configuredTenant) && isOperatorIdentifier(entry)) {
        principalKeys.add(operatorPrincipalKey(configuredTenant, entry));
      } else {
        invalidEntries.push(entry);
      }
      continue;
    }

    if (
      segments.length === 2
      && isOperatorIdentifier(segments[0])
      && isOperatorIdentifier(segments[1])
    ) {
      principalKeys.add(operatorPrincipalKey(segments[0], segments[1]));
    } else {
      invalidEntries.push(entry);
    }
  }

  return { principalKeys, invalidEntries };
}

function isOperatorIdentifier(value: string): boolean {
  return value.length > 0
    && value.length <= MAX_AGENT_SCOPE_VALUE_LENGTH
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function operatorPrincipalKey(tenantId: string, requesterId: string): string {
  return JSON.stringify([tenantId, requesterId]);
}

function numericEnvGreaterThan(name: string, threshold: number): boolean {
  const raw = process.env[name]?.trim();
  if (!raw) return false;
  const value = Number(raw);
  return Number.isFinite(value) && value > threshold;
}
