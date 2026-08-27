import path from 'node:path';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import express from 'express';

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
import { AgentExecutionUnavailableError } from './agent-execution-policy.js';
import { createProductionAgentExecutionPolicy } from './production-agent-isolation.js';
import { ProviderNeutralAgentRunner } from './provider-neutral-agent-runner.js';
import type { CliAgentProvider } from './cli-agent-runner.js';
import {
  AGENT_ADMISSION_LIMIT_MAXIMA,
  AgentAdmissionController,
  AgentCapacityError,
  publicAgentCapacityError as mapAgentCapacityError,
  agentCapacityText as mapAgentCapacityText,
} from './agent-admission-controller.js';
import { probeCliCapabilities, unknownCliCapabilities, type CliCapabilities } from './codex-capability.js';
import { GitService } from './git-service.js';
import { DeterministicResponseEngine } from './response-engine-deterministic.js';
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
import { createA2AProviderFacts, type A2AProviderFact } from './a2a-provider-facts.js';
import {
  createAdaptiveCardActivity,
  createAdaptiveCardCarouselActivity,
  createTextFallbackActivity,
  renderGenUiCard,
  renderGenUiCardDiagnostic,
} from './genui-teams.js';
import type { McpGenUiRouter } from './mcp-genui.js';
import { ChannelsShadowMonitor } from './channels-shadow-monitor.js';
import { acquireStoreProcessLease, type StoreProcessLease } from './process-lease.js';
import { buildTeamsPersonalTabDeepLink } from './teams-tab-link.js';
import {
  GENUI_ACTION_PAYLOAD_KEYS,
  GENUI_COMMANDS,
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
import {
  WorkItemForbiddenError,
  WorkItemNotFoundError,
  presentWorkItem,
  type WorkItemChange,
  WorkItemService,
  WorkItemValidationError,
} from './work-item-service.js';
import { WorkItemStore } from './work-item-store.js';
import {
  WORK_ITEM_STATUSES,
  type WorkItemScope,
} from '../shared/work-item.js';
import {
  CollaborationForbiddenError,
  CollaborationNotFoundError,
  CollaborationService,
  CollaborationValidationError,
} from './collaboration-service.js';
import { CollaborationStore } from './collaboration-store.js';
import type { CollaborationScope } from '../shared/collaboration.js';
import type { RunAgentInput } from '@ag-ui/core';
import { A2AStore } from './a2a-store.js';
import { createA2AExecutionAdapter } from './a2a-execution.js';
import { serializeA2ADispatchAudit } from './a2a-observability.js';
import { createA2AAgentAuthorizationPolicy } from './a2a-agent-authorization.js';
import { A2ATelemetryCollector } from './a2a-telemetry.js';
import {
  createConfiguredA2ARemoteAgent,
  createConfiguredA2ARemoteAgents,
  type A2AConfiguredRemoteAgentFailure,
} from './a2a-remote-agent-adapter.js';
import {
  parseA2ARemotePeerRoster,
  resolveA2ARemotePeerCredentials,
  type A2ARemotePeerCredential,
} from './a2a-remote-roster.js';
import { A2A_CAPABILITIES, A2A_ROLE_CATALOG } from './a2a-role-catalog.js';
import {
  mountA2AProductionRuntime,
  type A2AProductionChildCancellationInput,
  type A2AProductionChildExecutionInput,
} from './a2a-production-runtime.js';
import { deriveServerOwnedRestConversationId } from './rest-scope.js';
import { buildSecurityHeaders } from './security-headers.js';
import {
  resolveMcpAuthConfig,
  type McpAuthConfig,
} from './mcp-auth-config.js';
import { mountMcpAuthenticatedBoundary } from './mcp-authenticated-route.js';

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
const authenticatedMcpRequested = process.env.TEAMS_MCP_AUTHENTICATED_ENABLED?.trim().toLowerCase() === 'true';
const fileJsonMultiWorker = numericEnvGreaterThan('WEB_CONCURRENCY', 1)
  || numericEnvGreaterThan('NODE_APP_INSTANCE', 0);
const runtimeDistRoot = process.env.TEAMS_RUNTIME_DIST_DIR?.trim()
  ? path.resolve(process.env.TEAMS_RUNTIME_DIST_DIR)
  : path.resolve(process.cwd(), 'dist');
const clientDist = path.join(runtimeDistRoot, 'client');
const itemStorePath = process.env.ITEM_STORE_PATH ?? path.resolve(process.cwd(), 'data/items.json');
const workItemStorePath = process.env.WORK_ITEM_STORE_PATH ?? path.resolve(process.cwd(), 'data/work-items.json');
const collaborationStorePath = process.env.COLLABORATION_STORE_PATH ?? path.resolve(process.cwd(), 'data/collaboration.json');
const agentJobStorePath = process.env.AGENT_JOB_STORE_PATH ?? path.resolve(process.cwd(), 'data/agent-jobs.json');
const a2aStorePath = process.env.A2A_STORE_PATH ?? path.resolve(process.cwd(), 'data/a2a.json');
const agentAdmissionJournalPath = process.env.AGENT_ADMISSION_JOURNAL_PATH ?? path.resolve(process.cwd(), 'data/agent-admission.json');
const genUiActionStorePath = process.env.GENUI_ACTION_STORE_PATH ?? path.resolve(process.cwd(), 'data/genui-actions.json');
const responseModeStorePath = process.env.RESPONSE_MODE_STORE_PATH ?? path.resolve(process.cwd(), 'data/response-modes.json');
const providerMutationReplayStorePath = process.env.PROVIDER_MUTATION_REPLAY_STORE_PATH ?? path.resolve(process.cwd(), 'data/provider-mutation-replay.json');
const configuredAgentProvider = process.env.TEAMS_AGENT_CLI_PROVIDER?.trim() || 'codex';
if (configuredAgentProvider !== 'codex' && configuredAgentProvider !== 'copilot') {
  throw new Error('TEAMS_AGENT_CLI_PROVIDER must be either codex or copilot.');
}
const agentProvider = configuredAgentProvider;
const agentLabel = agentProvider === 'copilot' ? 'GitHub Copilot CLI' : 'Codex CLI';
const itemStore = new ItemStore(
  itemStorePath,
);
const collaborationService = new CollaborationService(new CollaborationStore(collaborationStorePath));
const publishWorkItemChange = async (change: WorkItemChange): Promise<void> => {
  const scope = change.scope satisfies CollaborationScope;
  const target = { type: 'work-item' as const, id: change.item.id };
  const followKey = `work-item-follow:${change.mutationKey}`;

  try {
    if (change.operation === 'create' || change.operation === 'watch') {
      await collaborationService.follow(scope, {
        mutationKey: followKey,
        target,
        delivery: 'personal',
      });
    } else if (change.operation === 'unwatch') {
      try {
        await collaborationService.unfollow(scope, {
          mutationKey: followKey,
          target,
          delivery: 'personal',
        });
      } catch (error) {
        if (!(error instanceof CollaborationNotFoundError)) throw error;
      }
    }

    const details = [
      `작업: ${change.operation}`,
      `상태: ${change.item.status}`,
      ...(change.item.assigneeId ? [`담당: ${change.item.assigneeId}`] : []),
    ].join(' · ');
    await collaborationService.recordUpdate(scope, {
      mutationKey: `work-item-notification:${change.mutationKey}`,
      target,
      title: `업무 업데이트 · ${change.item.title}`,
      body: details,
      mentionUserIds: change.item.assigneeId ? [change.item.assigneeId] : [],
      occurredAt: change.item.updatedAt,
    });
  } catch (error) {
    // A notification failure must not roll back an already durable work-item mutation.
    console.error('Work item notification publication failed', error);
  }
};
const workItemService = new WorkItemService(new WorkItemStore(workItemStorePath), {
  onChanged: publishWorkItemChange,
});
const agentJobStore = new AgentJobStore(
  agentJobStorePath,
  { legacyProvider: agentProvider },
);
const a2aStore = new A2AStore(a2aStorePath);
const codexRunner = new ProviderNeutralAgentRunner({ provider: agentProvider });
const a2aAgentProviders = parseAgentProviders(
  process.env.TEAMS_A2A_AGENT_PROVIDERS,
  agentProvider,
);
const providerRunners: Partial<Record<CliAgentProvider, ProviderNeutralAgentRunner>> = {
  [agentProvider]: codexRunner,
};
for (const provider of a2aAgentProviders) {
  if (!providerRunners[provider]) {
    providerRunners[provider] = new ProviderNeutralAgentRunner({ provider });
  }
}
const agentWorkspace = path.resolve(process.env.AGENT_WORKSPACE ?? process.cwd());
const gitService = new GitService(agentWorkspace);
const agentAdmissionController = new AgentAdmissionController({
  globalLimit: boundedAgentLimitEnv('TEAMS_AGENT_GLOBAL_LIMIT', 4, AGENT_ADMISSION_LIMIT_MAXIMA.global),
  perTenantLimit: boundedAgentLimitEnv('TEAMS_AGENT_TENANT_LIMIT', 2, AGENT_ADMISSION_LIMIT_MAXIMA.tenant),
  perRequesterLimit: boundedAgentLimitEnv('TEAMS_AGENT_REQUESTER_LIMIT', 2, AGENT_ADMISSION_LIMIT_MAXIMA.requester),
}, { journalPath: agentAdmissionJournalPath, retryLeaseMs: 60_000 });
const explicitBotClientId = process.env.BOT_CLIENT_ID?.trim() ?? '';
const configuredClientId = process.env.CLIENT_ID?.trim() ?? '';
const configuredTenantId = process.env.TENANT_ID?.trim() ?? '';
const configuredApplicationIdUri = process.env.APPLICATION_ID_URI?.trim() ?? '';
const configuredCatalogAppId = process.env.TEAMS_CATALOG_APP_ID?.trim() ?? '';
const mcpAuthClientId = process.env.TEAMS_MCP_AUTH_CLIENT_ID?.trim() ?? '';
const mcpAuthApplicationIdUri = process.env.TEAMS_MCP_AUTH_APPLICATION_ID_URI?.trim() ?? '';
const mcpAuthAcceptedAudiences = parseAcceptedAudiences(process.env.TEAMS_MCP_AUTH_ACCEPTED_AUDIENCES);
const mcpAuthRequiredScope = process.env.TEAMS_MCP_AUTH_REQUIRED_SCOPE?.trim() ?? '';
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
const agentExecutionPolicy = createProductionAgentExecutionPolicy({
  sourceWorkspace: agentWorkspace,
  // Safe-local mode is loopback-only and still requires every explicit
  // production isolation input below. Enabling the same provider here lets
  // the registered Teams SDK path be exercised end-to-end without weakening
  // the factory's fail-closed behavior for ordinary development runtimes.
  isProduction: isProduction || safeLocal,
  codexHome: agentProvider === 'codex' && isProduction ? process.env.AGENT_CODEX_HOME : undefined,
  codexExecutable: agentProvider === 'codex' && isProduction ? process.env.CODEX_BIN : undefined,
  codexExecutableSha256: agentProvider === 'codex' && isProduction ? process.env.CODEX_BIN_SHA256 : undefined,
  allowLegacySeatbeltTestProvider: safeLocal,
  profilePath: safeLocal ? process.env.AGENT_ISOLATION_PROFILE : undefined,
  sandboxExecPath: safeLocal ? process.env.AGENT_SANDBOX_EXEC_PATH : undefined,
  canMutateScope: (scope) => isOperator(scope),
  canReadScope: (scope) => isOperator(scope),
});
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
const serverBuildIdentity = (() => {
  const unavailable = { sourceCommit: 'unavailable', serverBundleSha256: 'unavailable' };
  try {
    const entryPath = fileURLToPath(import.meta.url);
    const markerPath = path.join(path.dirname(entryPath), '.teams-server-build-commit');
    const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as {
      schemaVersion?: unknown;
      commit?: unknown;
      mode?: unknown;
      worktree?: unknown;
      bundleSha256?: unknown;
    };
    if (
      marker.schemaVersion !== 3
      || typeof marker.commit !== 'string'
      || !/^[a-f0-9]{40}$/.test(marker.commit)
      || (marker.mode !== 'core' && marker.mode !== 'optional')
      || marker.worktree !== 'clean'
      || typeof marker.bundleSha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(marker.bundleSha256)
    ) return unavailable;
    const actualBundleSha256 = crypto.createHash('sha256').update(readFileSync(entryPath)).digest('hex');
    if (actualBundleSha256 !== marker.bundleSha256) return unavailable;
    return {
      sourceCommit: marker.commit,
      serverBundleSha256: actualBundleSha256,
    };
  } catch {
    return unavailable;
  }
})();
// The core artifact must not carry optional MCP/CopilotKit runtime graphs. A
// normal source/optional build keeps MCP behind either the loopback-only local
// gate or an explicit authenticated-provider contract; the `--core` bundle
// replaces this constant at build time with `true`.
const coreBuild = process.env.TEAMS_CORE_BUILD === 'true';
// Optional CopilotKit/LLM runtime is explicitly opt-in in every environment.
// The deterministic Teams Bot and tab must start without an OpenAI/API key and
// must not load an optional provider graph merely because the process is local.
const optionalRuntimeEnabled = process.env.TEAMS_CORE_BUILD !== 'true'
  && process.env.TEAMS_OPTIONAL_RUNTIME === 'true';
const genUiMode = process.env.TEAMS_GENUI_MODE === 'legacy' || process.env.TEAMS_GENUI_MODE === 'channels-shadow'
  ? process.env.TEAMS_GENUI_MODE
  : 'hybrid';
let optionalResponseEngines: Array<import('./response-engine.js').ResponseEngine> = [];
let localModelConfigured = false;
if (process.env.TEAMS_CORE_BUILD !== 'true' && optionalRuntimeEnabled) {
  const [{ LocalCompatibleResponseEngine }, { OpenAIResponseEngine }, { isLocalModelBaseUrlConfigured }] = await Promise.all([
    import('./response-engine-local.js'),
    import('./response-engine-openai.js'),
    import('./local-model-url.js'),
  ]);
  localModelConfigured = isLocalModelBaseUrlConfigured(process.env.LOCAL_MODEL_BASE_URL);
  optionalResponseEngines = [
    new LocalCompatibleResponseEngine(),
    new OpenAIResponseEngine(),
  ];
}
type ChannelsShadowRenderer = typeof import('./copilot-channels-shadow.js')['renderChannelsShadow'];
let renderChannelsShadow: ChannelsShadowRenderer | undefined;
if (process.env.TEAMS_CORE_BUILD !== 'true' && optionalRuntimeEnabled && genUiMode === 'channels-shadow') {
  ({ renderChannelsShadow } = await import('./copilot-channels-shadow.js'));
}
const genUiActionStore = new GenUiActionStore(
  genUiActionStorePath,
);
const personalTabDeepLink = buildTeamsPersonalTabDeepLink({
  catalogAppId: configuredCatalogAppId,
  tabDomain: process.env.TAB_DOMAIN ?? '',
  tenantId: configuredTenantId || undefined,
});
const genUi = new GenUiResponseFactory(genUiActionStore, {
  openTabUrl: personalTabDeepLink,
  agentLabel,
});
const channelsShadowMonitor = new ChannelsShadowMonitor();
const openAiConfigured = process.env.TEAMS_CORE_BUILD !== 'true'
  && optionalRuntimeEnabled
  && Boolean(process.env.OPENAI_API_KEY?.trim());
const openAiModel = process.env.TEAMS_CORE_BUILD === 'true'
  ? 'deterministic'
  : process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
const localModelName = process.env.TEAMS_CORE_BUILD === 'true'
  ? 'local-model'
  : process.env.LOCAL_MODEL_NAME?.trim() || 'local-model';
const weatherMode = process.env.WEATHER_MODE === 'demo' ? 'demo' : 'live';
const responseProviders = {
  deterministic: true,
  openai: optionalRuntimeEnabled && openAiConfigured,
  local: optionalRuntimeEnabled && localModelConfigured,
} as const;
const responseModeStore = new ResponseModeStore(responseModeStorePath, {
  providers: {
    openai: openAiConfigured,
    local: localModelConfigured,
  },
});

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

if (isProduction && !isDeploymentGuid(configuredCatalogAppId)) {
  throw new Error('Production TEAMS_CATALOG_APP_ID must be an observed Teams org catalog UUID.');
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
  workItemStorePath,
  collaborationStorePath,
  agentJobStorePath,
  a2aStorePath,
  agentAdmissionJournalPath,
  genUiActionStorePath,
  responseModeStorePath,
]);
process.once('exit', () => storeProcessLease?.releaseSync());

await itemStore.initialize();
await workItemService.initialize();
await collaborationService.initialize();
await a2aStore.initialize();
await genUiActionStore.initialize();
await responseModeStore.initialize();

configureResponseEngineRouter({
  engines: optionalResponseEngines,
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
  ...optionalResponseEngines,
]);

let http: any;
let teamsApp: any;
let userAuthValidator: any;
let mcpAuthValidator: any;
let a2aExecutionAdapter: ReturnType<typeof createA2AExecutionAdapter> | undefined;
const localOutbox = new Map<string, string[]>();
const localOutboxActivities = new Map<string, unknown[]>();

type BotSend = (text: string, envelope?: GenUiEnvelopeV1, activityOverride?: unknown) => Promise<void>;
type GenUiCardAction = Extract<GenUiActionName, 'approve' | 'cancel' | 'refresh' | 'retry' | 'feedback'> | 'command';
type GenUiActionPayload = {
  schemaVersion: typeof GENUI_SCHEMA_VERSION;
  action: GenUiCardAction;
  entityId: string;
  correlationId: string;
  actionToken: string;
};

type UserClaims = Record<string, unknown>;

const GENUI_CARD_ACTIONS = ['approve', 'cancel', 'refresh', 'retry', 'feedback', 'command'] as const satisfies readonly GenUiCardAction[];
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

  // Local deterministic tests have no token validator. Use a fixed server-side
  // principal; production always requires validated oid/sub and tid claims.
  if (skipAuth && !claims) {
    if (conversation.error) return { status: 400, error: conversation.error };
    return { scope: { ...localRestScope(), conversationId: conversation.conversationId! } };
  }
  if (!requesterId || !tenantId) return { status: 401, error: 'validated user identity is required' };
  // A tab/browser request has no authenticated Teams conversation reference.
  // Never let its body or headers select the conversation used by outbound
  // notifications; use an opaque principal-owned REST scope instead.
  return {
    scope: {
      requesterId,
      tenantId,
      conversationId: deriveServerOwnedRestConversationId({ tenantId, requesterId }),
    },
  };
}

function restPrincipal(request: any, response: any): { principal?: { requesterId: string; tenantId: string }; status?: number; error?: string } {
  const claims = asRecord(response.locals?.user) as UserClaims | undefined;
  const requesterId = nonEmptyString(claims?.requesterId) ?? nonEmptyString(claims?.oid) ?? nonEmptyString(claims?.sub);
  const tenantId = nonEmptyString(claims?.tid);
  if (skipAuth && !claims) return { principal: { requesterId: 'local-user', tenantId: 'local-tenant' } };
  if (!requesterId || !tenantId) return { status: 401, error: 'validated user identity is required' };
  return { principal: { requesterId, tenantId } };
}

function a2aScopeFromRequest(request: any): AgentJobScope | undefined {
  const claims = asRecord(request.res?.locals?.user) as UserClaims | undefined;
  const requesterId = nonEmptyString(claims?.requesterId)
    ?? nonEmptyString(claims?.oid)
    ?? nonEmptyString(claims?.sub);
  const tenantId = nonEmptyString(claims?.tid);
  if (skipAuth && !claims) {
    return { requesterId: 'local-user', tenantId: 'local-tenant', conversationId: 'a2a-http' };
  }
  if (!requesterId || !tenantId) return undefined;
  return { requesterId, tenantId, conversationId: 'a2a-http' };
}

function workItemRestScope(request: any, response: any): { scope?: WorkItemScope; status?: number; error?: string } {
  const resolved = restScope(request, response);
  if (!resolved.scope) return resolved;
  return {
    scope: {
      tenantId: resolved.scope.tenantId,
      requesterId: resolved.scope.requesterId,
      conversationId: resolved.scope.conversationId,
    },
  };
}

function collaborationRestScope(request: any, response: any): { scope?: CollaborationScope; status?: number; error?: string } {
  const resolved = restScope(request, response);
  if (!resolved.scope) return resolved;
  return {
    scope: {
      tenantId: resolved.scope.tenantId,
      requesterId: resolved.scope.requesterId,
      conversationId: resolved.scope.conversationId,
    },
  };
}

function sendWorkItemError(response: any, error: unknown): void {
  if (error instanceof WorkItemValidationError) {
    response.status(400).json({ error: error.message, code: error.code });
    return;
  }
  if (error instanceof WorkItemNotFoundError) {
    response.status(404).json({ error: error.message, code: error.code, itemId: error.itemId });
    return;
  }
  if (error instanceof WorkItemForbiddenError) {
    response.status(403).json({ error: error.message, code: error.code, itemId: error.itemId });
    return;
  }
  if (error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'WORK_ITEM_IDEMPOTENCY_CONFLICT') {
    response.status(409).json({ error: error instanceof Error ? error.message : 'mutation key conflict', code: 'WORK_ITEM_IDEMPOTENCY_CONFLICT' });
    return;
  }
  console.error('Work item request failed', error);
  response.status(500).json({ error: '업무 항목 요청을 처리하지 못했습니다.' });
}

function sendCollaborationError(response: any, error: unknown): void {
  if (error instanceof CollaborationValidationError) {
    response.status(400).json({ error: error.message, code: error.code });
    return;
  }
  if (error instanceof CollaborationNotFoundError) {
    response.status(404).json({ error: error.message, code: error.code, resource: error.resource });
    return;
  }
  if (error instanceof CollaborationForbiddenError) {
    response.status(403).json({ error: error.message, code: error.code, resource: error.resource });
    return;
  }
  if (error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'COLLABORATION_IDEMPOTENCY_CONFLICT') {
    response.status(409).json({ error: error instanceof Error ? error.message : 'mutation key conflict', code: 'COLLABORATION_IDEMPOTENCY_CONFLICT' });
    return;
  }
  console.error('Collaboration request failed', error);
  response.status(500).json({ error: '협업 요청을 처리하지 못했습니다.' });
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

async function buildStatusEnvelope(): Promise<GenUiEnvelopeV1> {
  const capabilities = await probeCliCapabilities();
  return genUi.status({
    teamsSdk: Boolean(teamsApp),
    environment: isProduction ? 'production' : 'local',
    authMode: safeLocal ? 'local-bypass' : teamsApp ? 'teams-authenticated' : 'not-configured',
    storage: 'file-json-single-process',
    agentProvider,
    deterministic: true,
    codex: capabilities.codex,
    ghcp: capabilities.ghcp,
    a2aProviders: a2aProviderFacts(),
  });
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
  // Channels shadow is an optional comparison renderer. It is intentionally
  // absent from the deterministic production bundle unless the optional
  // runtime is enabled, so a Teams-only deployment never imports CopilotKit.
  if (genUiMode !== 'channels-shadow' || !renderChannelsShadow) return;

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

type AdaptiveCardDeliveryErrorClassification = 'confirmed-rejection' | 'ambiguous-transport' | 'unknown';

const AMBIGUOUS_ADAPTIVE_CARD_DELIVERY_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTDOWN',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/**
 * The Teams SDK sender is Axios-backed. Only its rejected `response.status`
 * (or the same response nested under `cause`) proves that the provider
 * returned an HTTP rejection. Top-level status fields and response-body
 * statusCode metadata are deliberately not treated as delivery provenance.
 */
type AdaptiveCardDeliveryHttpResponseError = {
  response?: { status?: unknown };
  cause?: { response?: { status?: unknown } };
};

function adaptiveCardDeliveryHttpResponseStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as AdaptiveCardDeliveryHttpResponseError;
  const possibleStatuses = [candidate.response?.status, candidate.cause?.response?.status];

  for (const value of possibleStatuses) {
    const status = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isInteger(status) && status >= 400 && status <= 599) return status;
  }
  return undefined;
}

function adaptiveCardDeliveryErrorClassification(error: unknown): AdaptiveCardDeliveryErrorClassification {
  if (!error || typeof error !== 'object') return 'unknown';

  // A known transport signal wins over any status metadata, because the
  // provider may have accepted the card before the sender lost the response.
  const candidates = [
    error,
    (error as { cause?: unknown }).cause,
  ];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const transportError = candidate as { code?: unknown; name?: unknown };
    if (
      (typeof transportError.code === 'string'
        && AMBIGUOUS_ADAPTIVE_CARD_DELIVERY_CODES.has(transportError.code))
      || transportError.name === 'AbortError'
      || transportError.name === 'TimeoutError'
    ) {
      return 'ambiguous-transport';
    }
  }

  if (adaptiveCardDeliveryHttpResponseStatus(error) !== undefined) return 'confirmed-rejection';
  return 'unknown';
}

async function deliverAdaptiveCardWithFallback(
  deliver: (activity: unknown) => Promise<unknown>,
  activity: unknown,
  fallback: unknown,
): Promise<void> {
  try {
    await deliver(activity);
  } catch (error) {
    // A timeout/reset leaves delivery ambiguous: the remote service may have
    // accepted the card before the transport failed. Only an explicit HTTP
    // rejection is safe to follow with one user-visible text fallback.
    if (adaptiveCardDeliveryErrorClassification(error) !== 'confirmed-rejection') return;
    await deliver(fallback);
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
  if (!normalized) {
    await deliver(activity);
    return;
  }
  await deliverAdaptiveCardWithFallback(deliver, activity, createTextFallbackActivity(normalized));
}

function createBotSender(
  deliver?: (activity: unknown) => Promise<unknown>,
  messages?: string[],
  activities?: unknown[],
): BotSend {
  return async (text, envelope, activityOverride) => {
    const normalized = envelope ? GenUiEnvelopeV1Schema.parse(envelope) : undefined;
    const effectiveOverride = activityOverride && genUiMode !== 'legacy' ? activityOverride : undefined;
    const activity = effectiveOverride ?? (normalized && genUiMode !== 'legacy'
      ? createAdaptiveCardActivity(normalized)
      : { type: 'message', text });

    if (messages) {
      if (normalized) recordChannelsShadowComparison(normalized, activity);
      messages.push(text);
      activities?.push(activity);
      return;
    }

    if (effectiveOverride) {
      if (!deliver) return;
      await deliverAdaptiveCardWithFallback(deliver, effectiveOverride, { type: 'message', text });
      return;
    }

    await deliverGenUiActivity(deliver, text, normalized);
  };
}

function createRuntimeBotSender(
  activity: any,
  deliver?: (activity: unknown) => Promise<unknown>,
): BotSend {
  if (!skipOutbound) return createBotSender(deliver);
  if (!safeLocal) return async () => {};

  const conversationId = typeof activity?.conversation?.id === 'string'
    ? activity.conversation.id.trim()
    : '';
  if (!conversationId) return async () => {};

  const messages = localOutbox.get(conversationId) ?? [];
  localOutbox.set(conversationId, messages);
  const activities = localOutboxActivities.get(conversationId) ?? [];
  localOutboxActivities.set(conversationId, activities);
  return createBotSender(undefined, messages, activities);
}

if (useTeamsSdk) {
  // The Teams SDK package is CommonJS today. The core server bundle exposes
  // that module through a default namespace, while a direct Node import can
  // expose named properties. Normalize both shapes before constructing the
  // adapter so the packaged runtime is deterministic.
  const loadedTeams = await import('@microsoft/teams.apps');
  const teams = (loadedTeams as any).default ?? loadedTeams;
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
  if (authenticatedMcpRequested && mcpAuthClientId && mcpAuthApplicationIdUri) {
    const loadedMcpTeams = await import('@microsoft/teams.apps');
    const mcpTeams = (loadedMcpTeams as any).default ?? loadedMcpTeams;
    const mcpAuthApp = new mcpTeams.App({
      clientId: mcpAuthClientId,
      tenantId: configuredTenantId || undefined,
      applicationIdUri: mcpAuthApplicationIdUri,
    });
    mcpAuthValidator = mcpAuthApp.entraTokenValidator;
  }
} else {
  // Local mode keeps the browser and API fully runnable even when the host machine
  // has an incompatible optional auth dependency. Production Teams traffic uses the SDK branch above.
  http = express();
}

const mcpResourceOrigin = process.env.MCP_RESOURCE_ORIGIN?.trim()
  || (tabDomain ? `https://${tabDomain}` : process.env.PUBLIC_BASE_URL?.trim());
const authenticatedMcpConfig: McpAuthConfig = resolveMcpAuthConfig({
  requested: authenticatedMcpRequested,
  coreBuild,
  isProduction,
  userAuthConfigured: Boolean(configuredTenantId && mcpAuthClientId && mcpAuthApplicationIdUri),
  userAuthValidatorConfigured: Boolean(mcpAuthValidator),
  acceptedAudiences: mcpAuthAcceptedAudiences,
  resourceOrigin: mcpResourceOrigin,
  authorizationServerUrl: process.env.MCP_AUTHORIZATION_SERVER_URL?.trim(),
  requiredScope: mcpAuthRequiredScope,
  providerToolsEnabled: process.env.TEAMS_MCP_PROVIDER_TOOLS === 'true',
  providerEndpointConfigured: Boolean(process.env.ATLASSIAN_SITE_URL?.trim()),
  providerCredentialConfigured: Boolean(
    process.env.ATLASSIAN_ACCESS_TOKEN?.trim() || process.env.BITBUCKET_ACCESS_TOKEN?.trim(),
  ),
});
if (authenticatedMcpRequested && !coreBuild && !authenticatedMcpConfig.enabled) {
  throw new Error(`TEAMS_MCP_AUTHENTICATED_ENABLED=true cannot start: ${authenticatedMcpConfig.reason}`);
}
const mcpEnabled = !coreBuild && (safeLocal || authenticatedMcpConfig.enabled);

// Keep the tab embeddable in Teams while applying response-level security
// headers. The SDK adapter wraps an Express application and exposes the
// middleware surface, but its wrapped app is intentionally not public in the
// type definition; use the runtime property only for Express fingerprint
// hardening.
const httpApplication = (http as any).express ?? http;
if (typeof httpApplication.disable === 'function') {
  httpApplication.disable('x-powered-by');
}
const securityHeaders = buildSecurityHeaders();
http.use((_request: any, response: any, next: any) => {
  for (const [name, value] of Object.entries(securityHeaders)) {
    response.setHeader(name, value);
  }
  next();
});

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

const a2aPublicOrigin = (() => {
  if (tabDomain) return `https://${tabDomain}`;
  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (parsed.protocol === 'https:') return parsed.origin;
    } catch {
      // Local Core discovery uses the explicit loopback placeholder below.
    }
  }
  return 'https://localhost';
})();
const a2aAuthenticate = createUserAuthMiddleware({
  allowUnauthenticated: skipAuth,
  validator: userAuthValidator,
  configuredTenantId: configuredTenantId || undefined,
  acceptedAudiences: acceptedUserAudiences,
});
let a2aProductionRuntime: ReturnType<typeof mountA2AProductionRuntime> | undefined;
const a2aTelemetry = new A2ATelemetryCollector();
const remoteA2AEndpoint = process.env.TEAMS_A2A_REMOTE_AGENT_ENDPOINT?.trim();
const remoteA2ABearerToken = process.env.TEAMS_A2A_REMOTE_AGENT_BEARER_TOKEN?.trim();
if (Boolean(remoteA2AEndpoint) !== Boolean(remoteA2ABearerToken)) {
  throw new Error('TEAMS_A2A_REMOTE_AGENT_ENDPOINT and TEAMS_A2A_REMOTE_AGENT_BEARER_TOKEN must be configured together.');
}
const remoteA2ARoster = parseA2ARemotePeerRoster(process.env.TEAMS_A2A_REMOTE_AGENTS);
if ((remoteA2AEndpoint || remoteA2ABearerToken) && remoteA2ARoster.length > 0) {
  throw new Error('Use either the legacy single A2A remote configuration or TEAMS_A2A_REMOTE_AGENTS, not both.');
}
const remoteA2AAgentId = process.env.TEAMS_A2A_REMOTE_AGENT_ID?.trim() || 'teams-core-remote';
const remoteA2AProviderId = process.env.TEAMS_A2A_REMOTE_PROVIDER_ID?.trim() || 'remote-a2a';
const configuredRemoteA2AAgent = remoteA2AEndpoint && remoteA2ABearerToken
  ? await createConfiguredA2ARemoteAgent({
    endpoint: remoteA2AEndpoint,
    bearerToken: remoteA2ABearerToken,
    agentId: remoteA2AAgentId,
    providerId: remoteA2AProviderId,
    authorizationPolicy: createA2ARemoteAuthorizationPolicy(remoteA2AAgentId),
    telemetry: a2aTelemetry,
  })
  : undefined;
const remoteA2ARosterCredentials: A2ARemotePeerCredential[] = [];
const remoteA2ARosterFailures: A2AConfiguredRemoteAgentFailure[] = [];
for (const peer of remoteA2ARoster) {
  try {
    const credential = resolveA2ARemotePeerCredentials([peer], process.env)[0];
    if (!credential) throw new Error('A2A remote peer credential was not resolved.');
    remoteA2ARosterCredentials.push(credential);
  } catch {
    // Keep startup available for healthy peers and expose only safe labels in health.
    remoteA2ARosterFailures.push({
      agentId: peer.agentId,
      providerId: peer.providerId,
      kind: peer.kind,
      code: 'CONFIGURATION_ERROR',
    });
  }
}
const configuredRemoteA2ABatch = await createConfiguredA2ARemoteAgents(
  remoteA2ARosterCredentials.map((peer) => ({
    endpoint: peer.endpoint,
    bearerToken: peer.bearerToken,
    agentId: peer.agentId,
    providerId: peer.providerId,
    kind: peer.kind,
    executionIdentity: peer.executionIdentity,
    executionBoundaryId: peer.executionBoundaryId,
    roles: peer.roles,
    capabilities: peer.capabilities,
    authorizationPolicy: createA2ARemoteAuthorizationPolicy(peer.agentId),
    telemetry: a2aTelemetry,
  })),
);
const a2aRemoteInitializationFailures: readonly A2AConfiguredRemoteAgentFailure[] = Object.freeze([
  ...remoteA2ARosterFailures,
  ...configuredRemoteA2ABatch.failures,
]);
const coreA2ARoles = Object.freeze(A2A_ROLE_CATALOG.map((role) => role.id));

function a2aProviderFacts(): A2AProviderFact[] {
  const facts = createA2AProviderFacts(
    a2aAgentProviders.map((provider) => ({
      provider,
      agentId: a2aAgentId(provider),
      providerId: a2aProviderId(provider),
      configured: Boolean(providerRunners[provider]),
    })),
    configuredRemoteA2AAgent ? {
      provider: 'remote',
      agentId: configuredRemoteA2AAgent.agentId,
      providerId: configuredRemoteA2AAgent.providerId,
    } : undefined,
  );
  facts.push(...configuredRemoteA2ABatch.agents.map((agent) => ({
    provider: 'remote',
    agentId: agent.agentId,
    providerId: agent.providerId,
    configured: true,
  })));
  return facts;
}

const a2aAgents = [
  ...a2aAgentProviders.map((provider) => {
  const agentId = a2aAgentId(provider);
  return {
    agentId,
    providerId: a2aProviderId(provider),
    kind: 'cli',
    executionIdentity: `teams-core-${provider}`,
    executionBoundaryId: `teams-core-${provider}-runner`,
    roles: coreA2ARoles,
    capabilities: A2A_CAPABILITIES,
    authorize: ({ scope }: { scope: AgentJobScope }) => isOperator(scope),
    authorizationPolicy: createA2AAgentAuthorizationPolicy({
      authorize: (input) => (
        input.agentId === agentId
        && Boolean(input.scope.tenantId && input.scope.requesterId && input.scope.conversationId)
        && (!configuredTenantId || input.scope.tenantId === configuredTenantId)
        && isOperator(input.scope)
        && Boolean(input.role && input.capabilities?.length)
      ),
    }),
    executeChild: (input: A2AProductionChildExecutionInput) => executeA2AProviderChild(provider, input),
    cancelChild: (input: A2AProductionChildCancellationInput) => cancelA2AProviderChild(provider, input),
  };
  }),
  ...(configuredRemoteA2AAgent ? [configuredRemoteA2AAgent] : []),
  ...configuredRemoteA2ABatch.agents,
];
a2aProductionRuntime = mountA2AProductionRuntime(http, {
  publicOrigin: a2aPublicOrigin,
  appVersion,
  configuredApplicationIdUri: configuredApplicationIdUri || undefined,
  configuredTenantId: configuredTenantId || undefined,
  store: a2aStore,
  authenticate: a2aAuthenticate,
  resolveScope: a2aScopeFromRequest,
  v026Execution: {
    submit: async (event) => {
      if (!a2aExecutionAdapter) throw new Error('A2A execution adapter is not ready.');
      await a2aExecutionAdapter(event);
    },
    cancel: async ({ task }) => {
      if (!a2aExecutionAdapter) throw new Error('A2A execution adapter is not ready.');
      return a2aExecutionAdapter.cancel({ taskId: task.id, scope: task.scope });
    },
  },
  legacyOnTaskSubmitted: async (event) => {
    if (!a2aExecutionAdapter) throw new Error('A2A execution adapter is not ready.');
    await a2aExecutionAdapter(event);
  },
  legacyOnTaskCancel: async ({ task, authenticatedScope }) => {
    const cancelledDispatch = await a2aProductionRuntime?.cancelDispatch({
      task,
      authenticatedScope,
    });
    if (cancelledDispatch) return cancelledDispatch;
    if (!a2aExecutionAdapter) throw new Error('A2A execution adapter is not ready.');
    return a2aExecutionAdapter.cancel({ taskId: task.id, scope: task.scope });
  },
  coreA2A: {
    agents: a2aAgents,
    defaultAgentId: a2aAgents[0]?.agentId,
    onDispatchAudit: (audit) => {
      console.info('A2A orchestration audit', serializeA2ADispatchAudit(audit));
    },
  },
  requireScopedAgentAuthorization: !skipAuth,
  telemetry: a2aTelemetry,
});

http.use(express.json());

http.get('/api/health', async (_request: any, response: any) => {
  let cliCapabilities: CliCapabilities;
  try {
    cliCapabilities = await probeCliCapabilities();
  } catch {
    // A capability probe is diagnostic only. If the runner itself fails, keep
    // health available and report the dimensions as unknown rather than
    // turning health into an implicit login or provider-availability claim.
    cliCapabilities = unknownCliCapabilities();
  }

  response.json({
    ok: true,
    service: 'teams-sdk-mvp',
    version: appVersion,
    sourceCommit: serverBuildIdentity.sourceCommit,
    serverBundleSha256: serverBuildIdentity.serverBundleSha256,
    environment: process.env.NODE_ENV ?? 'development',
    auth: safeLocal ? 'local-bypass' : teamsApp ? 'teams-authenticated' : 'not-configured',
    userAuth: safeLocal ? 'local-bypass' : userAuthConfigured && userAuthValidator ? 'entra-sso' : 'not-configured',
    bot: teamsApp ? 'teams-sdk' : safeLocal ? 'local-handler' : 'not-configured',
    outbound: teamsApp ? (skipOutbound ? 'disabled' : 'teams-sdk') : safeLocal ? 'local-outbox' : 'not-configured',
    cliCapabilities,
    storage: 'file-json-single-process',
    copilotKit: optionalRuntimeEnabled ? 'enabled' : 'disabled',
    copilotKitRuntime: optionalRuntimeEnabled ? '/api/copilotkit' : 'disabled',
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
    mcpMode: authenticatedMcpConfig.enabled
      ? 'authenticated-provider'
      : safeLocal
        ? 'local'
        : 'disabled',
    mcpAuth: authenticatedMcpConfig.enabled
      ? {
        enabled: true,
        resource: authenticatedMcpConfig.resourceUrl,
        metadata: authenticatedMcpConfig.metadataUrl,
        authorizationServer: authenticatedMcpConfig.authorizationServerUrl,
        requiredScope: authenticatedMcpConfig.requiredScope,
      }
      : { enabled: false, reason: authenticatedMcpConfig.reason },
    a2aProviders: a2aProviderFacts(),
    a2aRemoteFailures: a2aRemoteInitializationFailures,
    a2aTelemetry: (() => {
      const snapshot = a2aTelemetry.snapshot();
      return {
        schemaVersion: snapshot.schemaVersion,
        totalEvents: snapshot.totalEvents,
        retainedEvents: snapshot.retainedEvents,
        droppedEvents: snapshot.droppedEvents,
      };
    })(),
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
      ? { model: publicModelLabel(openAiModel, openAiModel) }
      : entry.mode === 'local'
        ? { model: publicModelLabel(localModelName, 'local-model') }
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

  if (demo && isProduction) {
    response.status(400).json({ error: 'demo weather is disabled in production' });
    return;
  }

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

// The manifest uses the origin root as its developer/static-tab website URL.
// Keep that URL functional while preserving one canonical tab surface.
http.get('/', (request: any, response: any) => {
  const requestUrl = new URL(String(request.url ?? '/'), 'http://localhost');
  response.redirect(308, `/tabs/home/${requestUrl.search}`);
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

http.use(
  '/api/work-items',
  createUserAuthMiddleware({
    allowUnauthenticated: skipAuth,
    validator: userAuthValidator,
    configuredTenantId: configuredTenantId || undefined,
    acceptedAudiences: acceptedUserAudiences,
  }),
);

http.get('/api/work-items', async (request: any, response: any) => {
  const resolved = workItemRestScope(request, response);
  if (!resolved.scope) {
    response.status(resolved.status ?? 400).json({ error: resolved.error ?? 'invalid work item scope' });
    return;
  }

  try {
    const view = nonEmptyString(request.query?.view, 32) ?? 'search';
    const limit = request.query?.limit === undefined ? undefined : Number(request.query.limit);
    const text = nonEmptyString(request.query?.q, 400);
    const status = nonEmptyString(request.query?.status, 200);
    const statuses = status
      ? status.split(',').map((value) => value.trim()).filter((value): value is typeof WORK_ITEM_STATUSES[number] => (WORK_ITEM_STATUSES as readonly string[]).includes(value))
      : undefined;
    if (status && (!statuses || statuses.length !== status.split(',').filter((value: string) => value.trim()).length)) {
      response.status(400).json({ error: 'status contains an unsupported work item status' });
      return;
    }

    const items = view === 'assigned'
      ? workItemService.assigned(resolved.scope, limit)
      : view === 'recent'
        ? workItemService.recent(resolved.scope, limit)
        : view === 'calendar'
          ? workItemService.calendar(resolved.scope, {
            from: nonEmptyString(request.query?.from, 10),
            to: nonEmptyString(request.query?.to, 10),
            limit,
          })
          : workItemService.search(resolved.scope, {
            text,
            status: statuses,
            dueDateFrom: nonEmptyString(request.query?.from, 10),
            dueDateTo: nonEmptyString(request.query?.to, 10),
            limit,
          });
    const summaryMode = nonEmptyString(request.query?.summary, 20);
    if (summaryMode && summaryMode !== 'today') {
      response.status(400).json({ error: 'summary contains an unsupported work item summary mode' });
      return;
    }
    if (summaryMode === 'today' && view !== 'assigned') {
      response.status(400).json({ error: 'today summary requires the assigned work item view' });
      return;
    }
    const today = nonEmptyString(request.query?.today, 10) ?? new Date().toISOString().slice(0, 10);
    response.json({
      items: items.map((item) => presentWorkItem(item, resolved.scope!)),
      view,
      ...(summaryMode === 'today' ? { summary: workItemService.assignedSummary(resolved.scope, today) } : {}),
    });
  } catch (error) {
    sendWorkItemError(response, error);
  }
});

http.get('/api/work-items/:id', async (request: any, response: any) => {
  const resolved = workItemRestScope(request, response);
  if (!resolved.scope) {
    response.status(resolved.status ?? 400).json({ error: resolved.error ?? 'invalid work item scope' });
    return;
  }
  try {
    const item = workItemService.get(resolved.scope, request.params.id);
    if (!item) {
      response.status(404).json({ error: 'work item not found', code: 'WORK_ITEM_NOT_FOUND' });
      return;
    }
    response.json({ item: presentWorkItem(item, resolved.scope) });
  } catch (error) {
    sendWorkItemError(response, error);
  }
});

http.post('/api/work-items', async (request: any, response: any) => {
  const resolved = workItemRestScope(request, response);
  if (!resolved.scope) {
    response.status(resolved.status ?? 400).json({ error: resolved.error ?? 'invalid work item scope' });
    return;
  }
  try {
    const item = await workItemService.create(resolved.scope, request.body ?? {});
    response.status(201).json({ item: presentWorkItem(item, resolved.scope) });
  } catch (error) {
    sendWorkItemError(response, error);
  }
});

http.put('/api/work-items/:id', async (request: any, response: any) => {
  const resolved = workItemRestScope(request, response);
  if (!resolved.scope) {
    response.status(resolved.status ?? 400).json({ error: resolved.error ?? 'invalid work item scope' });
    return;
  }
  try {
    const item = await workItemService.edit(resolved.scope, {
      itemId: request.params.id,
      mutationKey: request.body?.mutationKey,
      patch: request.body?.patch ?? request.body,
    });
    response.json({ item: presentWorkItem(item, resolved.scope) });
  } catch (error) {
    sendWorkItemError(response, error);
  }
});

http.patch('/api/work-items/:id/status', async (request: any, response: any) => {
  const resolved = workItemRestScope(request, response);
  if (!resolved.scope) {
    response.status(resolved.status ?? 400).json({ error: resolved.error ?? 'invalid work item scope' });
    return;
  }
  try {
    const item = await workItemService.transition(resolved.scope, {
      itemId: request.params.id,
      status: request.body?.status,
      mutationKey: request.body?.mutationKey,
    });
    response.json({ item: presentWorkItem(item, resolved.scope) });
  } catch (error) {
    sendWorkItemError(response, error);
  }
});

http.patch('/api/work-items/:id/assignee', async (request: any, response: any) => {
  const resolved = workItemRestScope(request, response);
  if (!resolved.scope) {
    response.status(resolved.status ?? 400).json({ error: resolved.error ?? 'invalid work item scope' });
    return;
  }
  try {
    const requestedAssignee = request.body?.assigneeId === 'self'
      ? resolved.scope.requesterId
      : request.body?.assigneeId ?? null;
    const item = await workItemService.assign(resolved.scope, {
      itemId: request.params.id,
      assigneeId: requestedAssignee,
      mutationKey: request.body?.mutationKey,
    });
    response.json({ item: presentWorkItem(item, resolved.scope) });
  } catch (error) {
    sendWorkItemError(response, error);
  }
});

http.post('/api/work-items/:id/comments', async (request: any, response: any) => {
  const resolved = workItemRestScope(request, response);
  if (!resolved.scope) {
    response.status(resolved.status ?? 400).json({ error: resolved.error ?? 'invalid work item scope' });
    return;
  }
  try {
    const item = await workItemService.comment(resolved.scope, {
      itemId: request.params.id,
      body: request.body?.body,
      mutationKey: request.body?.mutationKey,
    });
    response.json({ item: presentWorkItem(item, resolved.scope) });
  } catch (error) {
    sendWorkItemError(response, error);
  }
});

http.post('/api/work-items/:id/watch', async (request: any, response: any) => {
  const resolved = workItemRestScope(request, response);
  if (!resolved.scope) {
    response.status(resolved.status ?? 400).json({ error: resolved.error ?? 'invalid work item scope' });
    return;
  }
  try {
    const item = await workItemService.watch(resolved.scope, {
      itemId: request.params.id,
      mutationKey: request.body?.mutationKey,
    });
    response.json({ item: presentWorkItem(item, resolved.scope) });
  } catch (error) {
    sendWorkItemError(response, error);
  }
});

http.delete('/api/work-items/:id/watch', async (request: any, response: any) => {
  const resolved = workItemRestScope(request, response);
  if (!resolved.scope) {
    response.status(resolved.status ?? 400).json({ error: resolved.error ?? 'invalid work item scope' });
    return;
  }
  const mutationKey = nonEmptyString(request.query?.mutationKey, 200);
  if (!mutationKey) {
    response.status(400).json({ error: 'mutationKey is required for retry-safe mutations' });
    return;
  }
  try {
    const item = await workItemService.unwatch(resolved.scope, {
      itemId: request.params.id,
      mutationKey,
    });
    response.json({ item: presentWorkItem(item, resolved.scope) });
  } catch (error) {
    sendWorkItemError(response, error);
  }
});

http.delete('/api/work-items/:id', async (request: any, response: any) => {
  const resolved = workItemRestScope(request, response);
  if (!resolved.scope) {
    response.status(resolved.status ?? 400).json({ error: resolved.error ?? 'invalid work item scope' });
    return;
  }
  const mutationKey = nonEmptyString(request.body?.mutationKey, 200)
    ?? nonEmptyString(request.query?.mutationKey, 200);
  if (!mutationKey) {
    response.status(400).json({ error: 'mutationKey is required for retry-safe mutations' });
    return;
  }
  try {
    const item = await workItemService.delete(resolved.scope, {
      itemId: request.params.id,
      mutationKey,
    });
    response.json({ item: presentWorkItem(item, resolved.scope) });
  } catch (error) {
    sendWorkItemError(response, error);
  }
});

http.use(
  '/api/collaboration',
  createUserAuthMiddleware({
    allowUnauthenticated: skipAuth,
    validator: userAuthValidator,
    configuredTenantId: configuredTenantId || undefined,
    acceptedAudiences: acceptedUserAudiences,
  }),
);

http.get('/api/collaboration/subscriptions', async (request: any, response: any) => {
  const resolved = collaborationRestScope(request, response);
  if (!resolved.scope) {
    response.status(resolved.status ?? 400).json({ error: resolved.error ?? 'invalid collaboration scope' });
    return;
  }
  try {
    const type = nonEmptyString(request.query?.targetType, 32);
    const id = nonEmptyString(request.query?.targetId, 200);
    const subscriptions = type && id
      ? (() => {
        const subscription = collaborationService.getSubscription(resolved.scope!, {
          target: { type: type as any, id },
          delivery: nonEmptyString(request.query?.delivery, 16) as any,
          channelId: nonEmptyString(request.query?.channelId, 256),
        });
        return subscription ? [subscription] : [];
      })()
      : collaborationService.listSubscriptions(resolved.scope);
    response.json({ subscriptions });
  } catch (error) {
    sendCollaborationError(response, error);
  }
});

http.get('/api/collaboration/bindings', async (request: any, response: any) => {
  const resolved = collaborationRestScope(request, response);
  if (!resolved.scope) {
    response.status(resolved.status ?? 400).json({ error: resolved.error ?? 'invalid collaboration scope' });
    return;
  }
  try {
    response.json({ bindings: collaborationService.listChannelBindings(resolved.scope) });
  } catch (error) {
    sendCollaborationError(response, error);
  }
});

http.get('/api/collaboration/preferences', async (request: any, response: any) => {
  const resolved = collaborationRestScope(request, response);
  if (!resolved.scope) {
    response.status(resolved.status ?? 400).json({ error: resolved.error ?? 'invalid collaboration scope' });
    return;
  }
  try {
    response.json({ preferences: collaborationService.listNotificationPreferences(resolved.scope) });
  } catch (error) {
    sendCollaborationError(response, error);
  }
});

http.get('/api/collaboration/notifications', async (request: any, response: any) => {
  const resolved = collaborationRestScope(request, response);
  if (!resolved.scope) {
    response.status(resolved.status ?? 400).json({ error: resolved.error ?? 'invalid collaboration scope' });
    return;
  }
  try {
    response.json({ notifications: collaborationService.notifications(resolved.scope, {
      from: nonEmptyString(request.query?.from, 40),
      to: nonEmptyString(request.query?.to, 40),
      limit: request.query?.limit === undefined ? undefined : Number(request.query.limit),
    }) });
  } catch (error) {
    sendCollaborationError(response, error);
  }
});

http.get('/api/collaboration/digest', async (request: any, response: any) => {
  const resolved = collaborationRestScope(request, response);
  if (!resolved.scope) {
    response.status(resolved.status ?? 400).json({ error: resolved.error ?? 'invalid collaboration scope' });
    return;
  }
  try {
    response.json({ digest: collaborationService.digest(resolved.scope, {
      period: request.query?.period,
      at: nonEmptyString(request.query?.at, 40),
    }) });
  } catch (error) {
    sendCollaborationError(response, error);
  }
});

http.post('/api/collaboration/follow', async (request: any, response: any) => {
  const resolved = collaborationRestScope(request, response);
  if (!resolved.scope) {
    response.status(resolved.status ?? 400).json({ error: resolved.error ?? 'invalid collaboration scope' });
    return;
  }
  try {
    response.status(201).json({ subscription: await collaborationService.follow(resolved.scope, request.body ?? {}) });
  } catch (error) {
    sendCollaborationError(response, error);
  }
});

http.post('/api/collaboration/unfollow', async (request: any, response: any) => {
  const resolved = collaborationRestScope(request, response);
  if (!resolved.scope) {
    response.status(resolved.status ?? 400).json({ error: resolved.error ?? 'invalid collaboration scope' });
    return;
  }
  try {
    response.json({ subscription: await collaborationService.unfollow(resolved.scope, request.body ?? {}) });
  } catch (error) {
    sendCollaborationError(response, error);
  }
});

http.post('/api/collaboration/bindings', async (request: any, response: any) => {
  const resolved = collaborationRestScope(request, response);
  if (!resolved.scope) {
    response.status(resolved.status ?? 400).json({ error: resolved.error ?? 'invalid collaboration scope' });
    return;
  }
  try {
    response.status(201).json({ binding: await collaborationService.bindChannel(resolved.scope, request.body ?? {}) });
  } catch (error) {
    sendCollaborationError(response, error);
  }
});

http.delete('/api/collaboration/bindings', async (request: any, response: any) => {
  const resolved = collaborationRestScope(request, response);
  if (!resolved.scope) {
    response.status(resolved.status ?? 400).json({ error: resolved.error ?? 'invalid collaboration scope' });
    return;
  }
  try {
    response.json({ binding: await collaborationService.unbindChannel(resolved.scope, {
      target: { type: request.query?.targetType, id: request.query?.targetId },
      channelId: request.query?.channelId,
      mutationKey: nonEmptyString(request.query?.mutationKey, 200) ?? `unbind-${Date.now()}`,
    }) });
  } catch (error) {
    sendCollaborationError(response, error);
  }
});

http.post('/api/collaboration/preferences', async (request: any, response: any) => {
  const resolved = collaborationRestScope(request, response);
  if (!resolved.scope) {
    response.status(resolved.status ?? 400).json({ error: resolved.error ?? 'invalid collaboration scope' });
    return;
  }
  try {
    response.json({ preference: await collaborationService.setNotificationPreference(resolved.scope, request.body ?? {}) });
  } catch (error) {
    sendCollaborationError(response, error);
  }
});

http.post('/api/collaboration/notifications', async (request: any, response: any) => {
  const resolved = collaborationRestScope(request, response);
  if (!resolved.scope) {
    response.status(resolved.status ?? 400).json({ error: resolved.error ?? 'invalid collaboration scope' });
    return;
  }
  try {
    const input = request.body ?? {};
    const notification = input.kind === 'reminder'
      ? await collaborationService.recordReminder(resolved.scope, input)
      : await collaborationService.recordUpdate(resolved.scope, input);
    response.status(201).json({ notification });
  } catch (error) {
    sendCollaborationError(response, error);
  }
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
    canReadScope: (scope) => isOperator(scope),
    executionPolicy: agentExecutionPolicy,
    admissionController: agentAdmissionController,
    agentLabel,
    defaultProvider: agentProvider,
    providerRunners,
  },
);
await agentService.initialize();

a2aExecutionAdapter = createA2AExecutionAdapter({
  store: a2aStore,
  agentService,
  resolveProviderForRecovery: cliProviderFromA2AProviderId,
  recoverChildForReconciliation: (input) => a2aProductionRuntime?.recoverChild(input) ?? Promise.resolve(undefined),
  onDispatchAudit: (audit) => {
    console.info('A2A dispatch audit', serializeA2ADispatchAudit(audit));
  },
});
await a2aExecutionAdapter.initialize();

let mcpRouter: McpGenUiRouter | undefined;
if (mcpEnabled) {
  const { createMcpGenUiRouter } = await import('./mcp-genui.js');
  let providerTools: import('./mcp-provider-tools.js').McpProviderToolRegistry | undefined;
  let providerToolsForPrincipal: ((principal: import('./mcp-genui.js').McpPrincipal) => import('./mcp-provider-tools.js').McpProviderToolRegistry) | undefined;
  if (process.env.TEAMS_MCP_PROVIDER_TOOLS === 'true') {
    const { createMcpProviderToolRegistry } = await import('./mcp-provider-tools.js');
    const { createPrincipalScopedProviderHttpBroker } = await import('./mcp-provider-http-broker.js');
    const { ProviderMutationReplayStore } = await import('./provider-mutation-replay-store.js');
    const atlassianSiteUrl = process.env.ATLASSIAN_SITE_URL?.trim();
    if (!atlassianSiteUrl) {
      throw new Error('TEAMS_MCP_PROVIDER_TOOLS=true requires ATLASSIAN_SITE_URL.');
    }
    const bitbucketBaseUrl = process.env.BITBUCKET_API_BASE_URL?.trim() || 'https://api.bitbucket.org/2.0/';
    const atlassianOrigin = new URL(atlassianSiteUrl).origin;
    const bitbucketOrigin = new URL(bitbucketBaseUrl).origin;
    const mutationReplayStore = new ProviderMutationReplayStore(providerMutationReplayStorePath);
    await mutationReplayStore.initialize();
    const createProviderTools = (principal: import('./mcp-genui.js').McpPrincipal) => {
      const providerBroker = createPrincipalScopedProviderHttpBroker({
        principal,
        resolveCredential: (provider) => provider === 'atlassian'
          ? process.env.ATLASSIAN_ACCESS_TOKEN?.trim()
          : process.env.BITBUCKET_ACCESS_TOKEN?.trim(),
        allowedOrigins: {
          atlassian: [atlassianOrigin],
          bitbucket: [bitbucketOrigin],
        },
      });
      return createMcpProviderToolRegistry({
        principal,
        ...(authenticatedMcpConfig.enabled ? { allowMutations: isOperator } : {}),
        atlassianSiteUrl,
        ...(process.env.BITBUCKET_API_BASE_URL?.trim()
          ? { bitbucketBaseUrl }
        : {}),
        providerBroker,
        mutationReplayStore,
      });
    };

    if (authenticatedMcpConfig.enabled) {
      providerToolsForPrincipal = createProviderTools;
    } else {
      const tenantId = process.env.TEAMS_MCP_PROVIDER_TENANT_ID?.trim();
      const requesterId = process.env.TEAMS_MCP_PROVIDER_REQUESTER_ID?.trim();
      if (!tenantId || !requesterId) {
        throw new Error('TEAMS_MCP_PROVIDER_TOOLS=true in local mode requires TEAMS_MCP_PROVIDER_TENANT_ID and TEAMS_MCP_PROVIDER_REQUESTER_ID.');
      }
      providerTools = createProviderTools({ tenantId, requesterId });
    }
  }
  mcpRouter = createMcpGenUiRouter({
    itemStore,
    agentService,
    getWeather,
    ...(providerTools ? { providerTools } : {}),
    ...(providerToolsForPrincipal ? { providerToolsForPrincipal } : {}),
    ...(authenticatedMcpConfig.enabled
      ? {
        includeWorkspaceTools: false,
        resolvePrincipal: (_request: import('express').Request, response: import('express').Response) => copilotIdentity(undefined, response),
      }
      : {}),
    sessionMode: process.env.MCP_SESSION_MODE === 'stateless' ? 'stateless' : 'stateful',
    enableJsonResponse: true,
    serverVersion: appVersion,
  });

  if (authenticatedMcpConfig.enabled) {
    const authenticateMcp = createUserAuthMiddleware({
      allowUnauthenticated: false,
      validator: mcpAuthValidator,
      configuredTenantId: configuredTenantId || undefined,
      acceptedAudiences: mcpAuthAcceptedAudiences,
      requiredDelegatedScope: authenticatedMcpConfig.requiredScope,
    });
    mountMcpAuthenticatedBoundary(http, authenticatedMcpConfig, authenticateMcp);
  }
  http.use('/mcp', mcpRouter);
}

let shutdownPromise: Promise<void> | undefined;
const handleSignal = (signal: NodeJS.Signals): void => {
  if (shutdownPromise) return;
  shutdownPromise = (async () => {
    try {
      await agentService.close();
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

if (process.env.TEAMS_CORE_BUILD !== 'true' && optionalRuntimeEnabled) {
  // Keep the optional provider graph out of the production deterministic path.
  // In particular, this prevents an OpenAI/CopilotKit import or constructor
  // from delaying the Teams SDK listener when no provider is configured.
  const [{ CopilotRuntime }, { createCopilotExpressHandler }, { TeamsCodexAgent }] = await Promise.all([
    import('@copilotkit/runtime/v2'),
    import('@copilotkit/runtime/v2/express'),
    import('./copilot-agent.js'),
  ]);
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
}

http.use(
  '/api/agent-jobs',
  createUserAuthMiddleware({
    allowUnauthenticated: skipAuth,
    validator: userAuthValidator,
    configuredTenantId: configuredTenantId || undefined,
    acceptedAudiences: acceptedUserAudiences,
  }),
);
http.post('/api/agent-jobs', async (request: any, response: any) => {
  const resolved = restScope(request, response);
  if (!resolved.scope) {
    response.status(resolved.status ?? 400).json({ error: { code: 'INVALID_SCOPE', retryable: false } });
    return;
  }
  const mode = request.body?.mode === 'workspace-write' ? 'workspace-write' : 'read-only';
  try {
    const job = await agentService.submit({
      prompt: normalizeAgentPrompt(request.body?.prompt),
      mode,
      scope: resolved.scope,
    });
    response.status(201).json({ job });
  } catch (error) {
    if (error instanceof AgentCapacityError) {
      response.set('Cache-Control', 'no-store');
      response.status(429).json(publicAgentCapacityError(error));
      return;
    }
    if (error instanceof AgentExecutionUnavailableError) {
      response.status(503).json({ error: publicAgentUnavailableError(error) });
      return;
    }
    if (error instanceof AgentMutationAuthorizationError) {
      response.status(403).json({ error: { code: error.code, retryable: false } });
      return;
    }
    if (error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'INVALID_AGENT_PROMPT') {
      response.status(400).json({ error: { code: 'INVALID_AGENT_PROMPT', retryable: false } });
      return;
    }
    console.error('Agent submission failed', error);
    response.status(500).json({ error: { code: 'AGENT_SUBMISSION_FAILED', retryable: false } });
  }
});
http.post('/api/agent-jobs/:id/approve', async (request: any, response: any) => {
  const resolved = restPrincipal(request, response);
  if (!resolved.principal) {
    response.status(resolved.status ?? 400).json({ error: resolved.error ?? 'invalid job principal' });
    return;
  }
  try {
    const owned = agentJobStore.getForPrincipal(request.params.id, resolved.principal);
    if (!owned || typeof owned.tenantId !== 'string') {
      response.status(404).json({ error: 'approval target not found' });
      return;
    }
    const job = await agentService.approve(request.params.id, {
      requesterId: owned.requesterId,
      tenantId: owned.tenantId,
      conversationId: owned.conversationId,
    });
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
  const resolved = restPrincipal(request, response);
  if (!resolved.principal) {
    response.status(resolved.status ?? 400).json({ error: resolved.error ?? 'invalid job principal' });
    return;
  }
  try {
    const owned = agentJobStore.getForPrincipal(request.params.id, resolved.principal);
    if (!owned || typeof owned.tenantId !== 'string') {
      response.status(404).json({ error: 'cancellation target not found' });
      return;
    }
    const job = await agentService.cancelStrict(request.params.id, {
      requesterId: owned.requesterId,
      tenantId: owned.tenantId,
      conversationId: owned.conversationId,
    });
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

  if (job.threadId) lines.push(`${agentLabel} thread: ${job.threadId}`);
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

type GenUiCommand = (typeof GENUI_COMMANDS)[number];

function isGenUiCommand(value: string): value is GenUiCommand {
  return GENUI_COMMANDS.includes(value as GenUiCommand);
}

async function resolveGenUiCommand(activity: any, command: GenUiCommand): Promise<GenUiEnvelopeV1> {
  if (command === 'help') return genUi.help();
  if (command === 'weather') return genUi.weatherUnavailable();

  const scope = activityScope(activity);
  if (!scope) return genUi.error('작업 명령에는 사용자·대화·테넌트 정보가 필요합니다.', 'command-scope-missing');

  return itemStore.runWithScope(itemScopeFromAgentScope(scope), async () => {
    await itemStore.ensureScope();
    if (command === 'status') {
      return buildStatusEnvelope();
    }
    if (command === 'work') {
      const items = workItemService.recent({
        tenantId: scope.tenantId,
        requesterId: scope.requesterId,
        conversationId: scope.conversationId,
      }, 8);
      const text = items.length === 0
        ? '탭 업무가 없습니다. 업무 허브 탭에서 첫 업무를 추가하세요.'
        : `탭 업무 ${items.length}개\n\n${items.map((item) => `- ${item.title} · ${item.status}${item.dueDate ? ` · 기한 ${item.dueDate}` : ''}`).join('\n')}`;
      return genUi.answer(text, 'work-items-command');
    }
    if (command === 'collaboration') {
      const collaborationScope = {
        tenantId: scope.tenantId,
        requesterId: scope.requesterId,
        conversationId: scope.conversationId,
      };
      const subscriptions = collaborationService.listSubscriptions(collaborationScope);
      const digest = collaborationService.weeklyDigest(collaborationScope);
      const text = `팔로우 ${subscriptions.length}개 · 이번 주 업데이트 ${digest.totalCount}건\n\n${digest.entries.slice(0, 5).map((entry) => `- ${entry.title} · ${entry.count}건`).join('\n') || '새 업데이트가 없습니다.'}`;
      return genUi.answer(text, 'collaboration-digest-command');
    }
    const jobs = agentService.list(scope, 5);
    return genUi.list(itemStore.list(), jobs);
  });
}

function mutationConflictEnvelope(error: unknown, fallbackId = 'agent-mutation-error'): GenUiEnvelopeV1 {
  if (error instanceof AgentJobConflictError) {
    return genUi.error(error.message, `${error.action}-${error.job.id}-conflict`);
  }
  return genUi.error('작업 상태가 변경되어 요청을 처리하지 못했습니다. 최신 상태를 확인하세요.', fallbackId);
}

function publicAgentCapacityError(error: AgentCapacityError): {
  code: string;
  dimension: string;
  limit: number;
  retryable: boolean;
} {
  return mapAgentCapacityError(error);
}

function publicAgentUnavailableError(error: AgentExecutionUnavailableError): {
  code: string;
  reason: string;
  retryable: boolean;
} {
  return { code: error.code, reason: error.reason, retryable: false };
}

function agentCapacityText(error: AgentCapacityError): string {
  return mapAgentCapacityText(error);
}

function agentUnavailableText(): string {
  return `읽기 전용 ${agentLabel}는 신뢰된 격리 경계가 준비된 경우에만 사용할 수 있습니다. 결정형 Core 기능은 계속 사용할 수 있습니다.`;
}

function agentCapacityEnvelope(error: AgentCapacityError, id: string): GenUiEnvelopeV1 {
  const details = publicAgentCapacityError(error);
  const envelope = genUi.error(agentCapacityText(error), id);
  return {
    ...envelope,
    metadata: {
      ...envelope.metadata,
      code: details.code,
      dimension: details.dimension,
      limit: details.limit,
      retryable: details.retryable,
    },
  };
}

function agentUnavailableEnvelope(id: string): GenUiEnvelopeV1 {
  const envelope = genUi.error(agentUnavailableText(), id);
  return {
    ...envelope,
    metadata: { ...envelope.metadata, code: 'UNAVAILABLE', reason: 'trusted-isolation-required', retryable: false },
  };
}

async function replayedGenUiAction(action: GenUiCardAction, job: AgentJob | undefined): Promise<GenUiEnvelopeV1> {
  if (!job) return genUi.error('작업을 찾을 수 없습니다.');
  if (action === 'refresh' || action === 'retry') return genUi.jobStatus(job);
  if (action === 'feedback') return genUi.answer('피드백을 이미 확인했습니다.', `feedback-${job.id}`);
  if (action === 'approve' && ['queued', 'running', 'completed', 'failed'].includes(job.status)) {
    return genUi.jobStatus(job);
  }
  if (action === 'cancel' && job.status === 'cancelled') {
    return genUi.cancelled(job);
  }
  return mutationConflictEnvelope(
    new AgentJobConflictError(action === 'approve' ? 'approve' : action === 'cancel' ? 'cancel' : 'retry', job),
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

  if (payload.action === 'approve' || payload.action === 'cancel' || payload.action === 'refresh' || payload.action === 'retry') {
    // Fail closed before consuming the idempotency grant. A mismatched user,
    // conversation, or tenant therefore cannot even mutate the action store.
    const scopedJob = agentService.get(payload.entityId, scope);
    if (!scopedJob) return genUi.error(`작업 ${payload.entityId}을 찾을 수 없습니다.`, `action-${payload.entityId}`);
  }

  if (inFlightGenUiActions.has(actionKey)) {
    const job = agentService.get(payload.entityId, scope);
    return job ? genUi.jobStatus(job) : genUi.error(`작업 ${payload.entityId}을 찾을 수 없습니다.`, `action-${payload.entityId}`);
  }

  if (payload.action === 'command') {
    if (!isGenUiCommand(payload.entityId)) return genUi.actionError('지원하지 않는 기본 명령입니다.');
    return resolveGenUiCommand(activity, payload.entityId);
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
        envelope = await genUi.jobStatus(job);
      }
    } else if (payload.action === 'retry') {
      const job = await agentService.retry(payload.entityId, scope, { notify: true });
      envelope = job
        ? genUi.started(job)
        : genUi.error(`작업 ${payload.entityId}을 찾을 수 없습니다.`, `action-${payload.entityId}`);
    } else {
      envelope = genUi.answer('피드백을 확인했습니다. 결정형 처리 결과를 기록했습니다.', `feedback-${payload.entityId}`);
    }

    return envelope;
  } catch (error) {
    if (error instanceof AgentMutationAuthorizationError) {
      return genUi.error(error.message, `action-${payload.entityId}-forbidden`);
    }
    if (error instanceof AgentCapacityError) {
      return agentCapacityEnvelope(error, `action-${payload.entityId}-capacity`);
    }
    if (error instanceof AgentExecutionUnavailableError) {
      return agentUnavailableEnvelope(`action-${payload.entityId}-unavailable`);
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
    await send(text, undefined, createResponseModeCardActivity('deterministic', publicResponseModeAvailability(), text, personalTabDeepLink));
    return;
  }

  const status = await responseModeStatus(scope);
  const text = `현재 응답 모드는 ${responseModeLabel(status.mode)}입니다.`;
  await send(text, undefined, createResponseModeCardActivity(status.mode, status.availability, undefined, personalTabDeepLink));
}

async function handleResponseModeSubmit(activity: any, send: BotSend): Promise<void> {
  const scope = responseModeActivityScope(activity);
  if (!scope) {
    const text = '응답 모드에는 사용자·대화·테넌트 정보가 필요합니다.';
    await send(text, undefined, createResponseModeCardActivity('deterministic', publicResponseModeAvailability(), text, personalTabDeepLink));
    return;
  }

  const current = await responseModeStore.get(scope);
  const parsed = parseResponseModeCardAction(activity.value);
  if (!parsed) {
    const text = '유효하지 않은 응답 모드 선택입니다.';
    await send(text, undefined, createResponseModeCardActivity(current, publicResponseModeAvailability(), text, personalTabDeepLink));
    return;
  }

  const availability = publicResponseModeAvailability();
  const selected = availability.find((entry) => entry.mode === parsed.mode);
  if (!selected?.configured) {
    const text = `${responseModeLabel(parsed.mode)} 응답 모드는 아직 서버에 설정되지 않았습니다. 결정형 또는 사용 가능한 모드를 선택하세요.`;
    await send(text, undefined, createResponseModeCardActivity(current, availability, text, personalTabDeepLink));
    return;
  }

  await responseModeStore.set(scope, parsed.mode);
  const text = `응답 모드를 ${responseModeLabel(parsed.mode)}으로 변경했습니다.`;
  await send(text, undefined, createResponseModeCardActivity(parsed.mode, publicResponseModeAvailability(), text, personalTabDeepLink));
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
    if (error instanceof AgentCapacityError) {
      await send(agentCapacityText(error), agentCapacityEnvelope(error, 'response-engine-capacity'));
      return;
    }
    if (error instanceof AgentExecutionUnavailableError) {
      await send(agentUnavailableText(), agentUnavailableEnvelope('response-engine-unavailable'));
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
      const responseText = '사용 가능한 명령: help, mode, carousel, weather [위도 경도], status, list, work, collaboration, run <작업>, continue <작업 ID> <추가 요청>, write <작업>, approve <작업 ID>, commit <작업 ID> [메시지], cancel <작업 ID>';
      const envelope = genUi.help();
      await send(responseText, envelope);
      return;
    }

    if (normalizedText === 'carousel' || normalizedText === 'gallery') {
      const responseText = '카드 갤러리를 보냅니다. Teams 메시지에서 카드를 좌우로 넘기고 카드 내부 이미지를 확인하세요.';
      const carouselActivity = genUiMode === 'legacy' ? undefined : createAdaptiveCardCarouselActivity(genUi.carousel());
      await send(responseText, undefined, carouselActivity);
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
        await send(responseText, job ? await genUi.jobStatus(job) : genUi.error(responseText, `status-${jobId}`));
        return;
      }

      const envelope = await buildStatusEnvelope();
      await send(envelopeText(envelope), envelope);
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
          const responseText = `읽기 전용 ${agentLabel} 작업 ${job.id}을 시작했습니다.\nstatus ${job.id}로 진행 상태를 확인할 수 있습니다.`;
          const envelope = genUi.started(job);
          await send(responseText, envelope);
        }
      } catch (error) {
        if (error instanceof AgentCapacityError) {
          await send(agentCapacityText(error), agentCapacityEnvelope(error, `${mode}-capacity`));
          return;
        }
        if (error instanceof AgentExecutionUnavailableError) {
          await send(agentUnavailableText(), agentUnavailableEnvelope(`${mode}-unavailable`));
          return;
        }
        if (error instanceof AgentMutationAuthorizationError) {
          await send(error.message, genUi.error(error.message, `${mode}-forbidden`));
          return;
        }
        throw error;
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
        const responseText = `작업 ${job.id}이 이전 ${agentLabel} thread에서 이어집니다.\nstatus ${job.id}`;
        const envelope = genUi.continued(job);
        await send(responseText, envelope);
      } else {
        const responseText = `재개할 ${agentLabel} thread가 있는 작업을 찾을 수 없습니다.`;
        await send(responseText, genUi.error(responseText, 'continue-missing'));
      }
    } catch (error) {
      if (error instanceof AgentCapacityError) {
        await send(agentCapacityText(error), agentCapacityEnvelope(error, `continue-${continueMatch[1]}-capacity`));
        return;
      }
      if (error instanceof AgentExecutionUnavailableError) {
        await send(agentUnavailableText(), agentUnavailableEnvelope(`continue-${continueMatch[1]}-unavailable`));
        return;
      }
      if (error instanceof AgentMutationAuthorizationError) {
        await send(error.message, genUi.error(error.message, `continue-${continueMatch[1]}-forbidden`));
        return;
      }
      throw error;
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
// Register the explicit no-slash redirect before Teams SDK's `tab()` helper.
// ExpressAdapter's static tab route normalizes `/tabs/home` with a 301 when
// it is registered first. Teams manifests point directly at `/tabs/home/`,
// but preserving a 308 here keeps preview/deep-link clients from changing
// the request method or silently dropping query parameters.
http.get('/tabs/home', (request: any, response: any, next: any) => {
  const requestUrl = new URL(String(request.url ?? '/tabs/home'), 'http://localhost');
  if (requestUrl.pathname === '/tabs/home') {
    response.redirect(308, `/tabs/home/${requestUrl.search}`);
    return;
  }
  // Express route matching is not strict by default, so this handler also
  // matches `/tabs/home/`. Let the SDK/static-tab middleware serve the
  // canonical trailing-slash URL; calling sendFile here bypassed that route
  // and produced a false 404 in the packaged Teams runtime.
  next();
});

if (teamsApp) {
  teamsApp.tab('home', clientDist);
  teamsApp.on('install.add', async ({ activity, send }: any) => {
    const runtimeSend = createRuntimeBotSender(activity, send);
    await handleInstall(activity, runtimeSend);
  });
  teamsApp.on('message', async ({ activity, send }: any) => {
    if (activity?.type === 'message' && isResponseModeCardAction(activity.value)) {
      const runtimeSend = createRuntimeBotSender(activity, send);
      await handleResponseModeSubmit(activity, runtimeSend);
      return;
    }

    if (activity?.type === 'message' && hasGenUiActionValue(activity)) {
      const runtimeSend = createRuntimeBotSender(activity, send);
      await handleGenUiSubmit(activity, runtimeSend);
      return;
    }

    if (activity?.type === 'invoke' && hasGenUiActionValue(activity)) {
      return handleGenUiAction(activity);
    }

    const runtimeSend = createRuntimeBotSender(activity, send);
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

}

// The Teams SDK owns bot/event registration, but it does not replace the
// HTTP origin that hosts a personal tab. Serve the canonical tab in every
// runtime mode, including production when `teamsApp` is configured.
http.use('/tabs/home', express.static(clientDist));

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

  if (process.env.TEAMS_ADAPTIVE_CARD_DELIVERY_TEST === 'true') {
    http.post('/api/debug/adaptive-card-delivery', async (request: any, response: any) => {
      const scenario = request.body?.scenario;
      const path = request.body?.path ?? 'envelope';
      const validScenarios = new Set([
        'success',
        'ambiguous',
        'confirmed',
        'bare-status',
        'bare-status-code',
        'status-timeout',
        'status-abort',
        'unknown',
        'reset',
        'socket',
        'confirmed-response',
        'nested-confirmed-response',
      ]);
      if (!validScenarios.has(scenario) || (path !== 'envelope' && path !== 'override')) {
        response.status(400).json({ error: 'invalid Adaptive Card delivery test scenario' });
        return;
      }

      const attempts: unknown[] = [];
      const deliver = async (activity: unknown): Promise<void> => {
        attempts.push(activity);
        if (attempts.length !== 1) return;
        if (scenario === 'success') return;
        const errors: Record<string, Error> = {
          ambiguous: Object.assign(new Error('test transport timeout'), { code: 'ETIMEDOUT' }),
          confirmed: Object.assign(new Error('test card rejection'), { response: { status: 400 } }),
          'bare-status': Object.assign(new Error('test status metadata'), { status: 500 }),
          'bare-status-code': Object.assign(new Error('test statusCode metadata'), { statusCode: 500 }),
          'status-timeout': Object.assign(new Error('test ambiguous timeout metadata'), { status: 500, code: 'ETIMEDOUT' }),
          'status-abort': Object.assign(new Error('test ambiguous abort metadata'), { statusCode: 500, name: 'AbortError' }),
          unknown: new Error('test unknown delivery failure'),
          reset: Object.assign(new Error('test connection reset'), { code: 'ECONNRESET' }),
          socket: Object.assign(new Error('test socket failure'), { code: 'UND_ERR_SOCKET' }),
          'confirmed-response': Object.assign(new Error('test provider rejection'), { response: { status: 400 } }),
          'nested-confirmed-response': Object.assign(new Error('test nested provider rejection'), { cause: { response: { status: 422 } } }),
        };
        throw errors[scenario];
      };

      const envelope = genUi.answer('Adaptive Card delivery fallback test', 'adaptive-card-delivery-test');
      const activityOverride = createAdaptiveCardActivity(envelope);
      await createBotSender(deliver)(
        'Adaptive Card delivery fallback test',
        envelope,
        path === 'override' ? activityOverride : undefined,
      );
      response.json({ scenario, attempts });
    });
  }
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

function parseAgentProviders(rawValue: string | undefined, defaultProvider: CliAgentProvider): readonly CliAgentProvider[] {
  const values = new Set<CliAgentProvider>([defaultProvider]);
  const raw = rawValue?.trim();
  if (raw) {
    for (const entry of raw.split(',')) {
      const provider = entry.trim();
      if (provider !== 'codex' && provider !== 'copilot') {
        throw new Error('TEAMS_A2A_AGENT_PROVIDERS may contain only codex and copilot.');
      }
      values.add(provider);
    }
  }
  return [...values];
}

function a2aAgentId(provider: CliAgentProvider): string {
  return provider === 'copilot' ? 'teams-core-copilot' : 'teams-core-codex';
}

function a2aProviderId(provider: CliAgentProvider): string {
  return provider === 'copilot' ? 'official-copilot-cli' : 'codex-cli';
}

function createA2ARemoteAuthorizationPolicy(agentId: string) {
  return createA2AAgentAuthorizationPolicy({
    authorize: (input) => (
      input.agentId === agentId
      && Boolean(input.scope.tenantId && input.scope.requesterId && input.scope.conversationId)
      && (!configuredTenantId || input.scope.tenantId === configuredTenantId)
      && isOperator(input.scope)
      && Boolean(input.role && input.capabilities?.length)
    ),
  });
}

function cliProviderFromA2AProviderId(providerId: string): CliAgentProvider | undefined {
  if (providerId === 'codex-cli') return 'codex';
  if (providerId === 'official-copilot-cli') return 'copilot';
  return undefined;
}

async function executeA2AProviderChild(
  provider: CliAgentProvider,
  input: A2AProductionChildExecutionInput,
) {
  let agentJobId: string | undefined;
  const cancelChild = (): void => {
    if (!agentJobId) return;
    void agentService.cancelStrict(agentJobId, input.scope, {
      notify: false,
      provider,
    }).catch(() => undefined);
  };
  input.signal.addEventListener('abort', cancelChild, { once: true });
  try {
    const job = await agentService.runForCopilot({
      provider,
      prompt: input.prompt,
      scope: input.scope,
      notify: false,
      timeoutMs: Math.max(1, input.deadlineAtMs - Date.now()),
      onSubmitted: async (submitted) => {
        agentJobId = submitted.id;
        await input.bindChild(submitted.id);
        if (input.signal.aborted) cancelChild();
      },
    });
    if (job.status === 'completed') return { taskId: job.id, status: 'completed' as const, result: job.result };
    if (job.status === 'cancelled') return { taskId: job.id, status: 'canceled' as const, error: job.error };
    return { taskId: job.id, status: 'failed' as const, error: job.error ?? `${provider} agent execution failed.` };
  } finally {
    input.signal.removeEventListener('abort', cancelChild);
  }
}

async function cancelA2AProviderChild(
  provider: CliAgentProvider,
  input: A2AProductionChildCancellationInput,
): Promise<void> {
  await agentService.cancelStrict(input.agentJobId, input.scope, {
    notify: false,
    provider,
  });
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

function boundedAgentLimitEnv(name: string, fallback: number, maximum: number): number {
  const configured = process.env[name];
  if (configured === undefined) return fallback;
  const raw = configured.trim();
  if (!raw) throw new Error(`${name} must be a finite positive safe integer <= ${maximum}`);
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${name} must be a finite positive safe integer <= ${maximum}`);
  }
  return value;
}
