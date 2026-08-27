import crypto from 'node:crypto';

import express, {
  type Application,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';

import {
  createCoreAgentCard,
  createCoreOfficialAgentCard,
  A2AContractError,
  redactAndBoundText,
  type A2AAgentCard,
  type A2AOfficialAgentCard,
  type A2AScope,
  type A2ATask,
} from './a2a-contract.js';
import {
  createCoreA2AOrchestrator,
  LEGACY_A2A_AGENT_ID,
  LEGACY_A2A_PROVIDER_ID,
  type A2AOrchestrationResult,
  type A2AOrchestratorAgentSelectionInput,
  type A2AOrchestratorChildExecutionInput,
  type A2AOrchestratorChildExecutionResult,
  type A2AOrchestratorChildRequest,
  type A2AOrchestratorPreparedDispatch,
} from './a2a-orchestrator.js';
import {
  createA2ARouter,
  type A2ARouteOptions,
} from './a2a-route.js';
import {
  createA2AV026AgentCard,
  createA2AV026JsonRpcRouter,
  createA2AV1JsonRpcRouter,
  type A2AV026Artifact,
  type A2AV026JsonRpcExecutionHooks,
} from './a2a-jsonrpc-route.js';
import {
  A2AStore,
  type A2ADispatchCancellationFailure,
  type A2ADispatchCancellationFailureHandler,
  type A2ADispatchChildOutcome,
  type A2ADispatchChildCancellationInput,
  type A2ADispatchIntent,
} from './a2a-store.js';
import {
  evaluateA2AAgentAuthorization,
  type A2AAgentAuthorizationPolicy,
} from './a2a-agent-authorization.js';
import { A2ATelemetryCollector } from './a2a-telemetry.js';

type LegacySubmit = NonNullable<A2ARouteOptions['onTaskSubmitted']>;
type LegacyCancel = NonNullable<A2ARouteOptions['onTaskCancel']>;
export type A2AProductionChildExecutionInput = A2AOrchestratorChildExecutionInput & Readonly<{
  bindChild: (agentJobId: string) => Promise<void>;
}>;

export type A2AProductionChildCancellationInput = Readonly<{
  scope: A2AScope;
  parentTaskId: string;
  childKey: string;
  childIdempotencyKey: string;
  agentId: string;
  providerId: string;
  executionIdentity?: string;
  executionBoundaryId?: string;
  agentJobId: string;
  cancelRequestedAt: string;
}>;

export type A2AProductionChildRecoveryInput = Readonly<{
  scope: A2AScope;
  parentTaskId: string;
  childKey: string;
  childIdempotencyKey?: string;
  agentId: string;
  providerId: string;
  executionIdentity?: string;
  executionBoundaryId?: string;
  agentJobId: string;
  deadlineAtMs: number;
  signal: AbortSignal;
}>;

type CoreChildExecutor = (
  input: A2AProductionChildExecutionInput,
) => Promise<A2AOrchestratorChildExecutionResult>;

export type A2AProductionAgentAuthorizationInput = Pick<
  A2AOrchestratorAgentSelectionInput,
  'scope' | 'role' | 'capabilities'
>;

export type A2AProductionAgent = Readonly<{
  agentId: string;
  providerId: string;
  /** Stable identity of the provider session owned by this registered agent. */
  executionIdentity?: string;
  /** Stable execution boundary (workspace/config/runner) owned by this agent. */
  executionBoundaryId?: string;
  /** Every independently registered agent must declare its scope policy. */
  authorize: (input: A2AProductionAgentAuthorizationInput) => boolean;
  /** Explicit tenant/requester/conversation/capability policy for production agents. */
  authorizationPolicy?: A2AAgentAuthorizationPolicy;
  executeChild: CoreChildExecutor;
  cancelChild?: (input: A2AProductionChildCancellationInput) => Promise<void>;
  recoverChild?: (input: A2AProductionChildRecoveryInput) => Promise<A2AOrchestratorChildExecutionResult>;
}>;

type A2AProductionCoreA2A =
  | Readonly<{
    agents: readonly A2AProductionAgent[];
    defaultAgentId?: string;
    executeChild?: never;
    onDispatchAudit?: (audit: A2AOrchestrationResult['audit']) => Promise<void> | void;
  }>
  | Readonly<{
    executeChild: CoreChildExecutor;
    cancelChild?: (input: A2AProductionChildCancellationInput) => Promise<void>;
    agents?: never;
    defaultAgentId?: never;
    onDispatchAudit?: (audit: A2AOrchestrationResult['audit']) => Promise<void> | void;
  }>;

type A2AOrchestrationRouteRequest = Readonly<{
  parentTaskId: string;
  requests: readonly A2AOrchestratorChildRequest[];
  deadlineMs: number;
  parallelism: number;
  depth?: number;
  fanOutIndex?: number;
}>;

const DEFAULT_CANCELLATION_TIMEOUT_MS = 5_000;
const MAX_CANCELLATION_TIMEOUT_MS = 60_000;

export type A2AProductionChildDispatch = Readonly<{
  parentTask: A2ATask;
  scope: A2AScope;
  requests: readonly A2AOrchestratorChildRequest[];
  deadlineMs: number;
  parallelism: number;
  depth?: number;
  fanOutIndex?: number;
}>;

export type A2AProductionRuntimeOptions = Readonly<{
  publicOrigin: string;
  appVersion: string;
  configuredApplicationIdUri?: string;
  configuredTenantId?: string;
  store: A2AStore;
  authenticate: RequestHandler;
  resolveScope: (request: Request) => A2AScope | undefined;
  v026Execution: A2AV026JsonRpcExecutionHooks;
  legacyOnTaskSubmitted: LegacySubmit;
  legacyOnTaskCancel: LegacyCancel;
  /** Explicit production seam; no protocol or provider is implied by Core. */
  coreA2A: A2AProductionCoreA2A;
  cancellationTimeoutMs?: number;
  onDispatchCancellationFailure?: A2ADispatchCancellationFailureHandler;
  /** Production startup can fail closed when any independently registered agent lacks a scoped policy. */
  requireScopedAgentAuthorization?: boolean;
  telemetry?: A2ATelemetryCollector;
}>;

export type A2AProductionRuntime = Readonly<{
  agentCard: A2AAgentCard;
  v026AgentCard: Record<string, unknown>;
  officialAgentCard: A2AOfficialAgentCard;
  telemetry?: A2ATelemetryCollector;
  dispatchChildren: (input: A2AProductionChildDispatch) => Promise<A2AOrchestrationResult>;
  cancelDispatch: (input: { task: A2ATask; authenticatedScope: A2AScope }) => Promise<A2ATask | undefined>;
  recoverChild: (input: A2AProductionChildRecoveryInput) => Promise<A2AOrchestratorChildExecutionResult | undefined>;
  mount: (http: Pick<Application, 'get' | 'use'>) => void;
}>;

function httpsOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('A2A public origin must be an absolute HTTPS URL.');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error('A2A public origin must be an HTTPS origin without credentials or a path.');
  }
  return parsed.origin;
}

function delegatedScope(configuredApplicationIdUri: string | undefined): string {
  const resource = configuredApplicationIdUri?.trim();
  return resource ? `${resource}/access_as_user` : 'access_as_user';
}

function createAgentRegistry(coreA2A: A2AProductionCoreA2A): Readonly<{
  agents: ReadonlyMap<string, A2AProductionAgent>;
  defaultAgentId?: string;
}> {
  if (!('agents' in coreA2A)) {
    return {
      agents: new Map([[
        LEGACY_A2A_AGENT_ID,
        {
          agentId: LEGACY_A2A_AGENT_ID,
          providerId: LEGACY_A2A_PROVIDER_ID,
          authorize: () => true,
          executeChild: coreA2A.executeChild,
          ...(coreA2A.cancelChild ? { cancelChild: coreA2A.cancelChild } : {}),
        },
      ]]),
      defaultAgentId: LEGACY_A2A_AGENT_ID,
    };
  }

  const agents = new Map<string, A2AProductionAgent>();
  const executionIdentities = new Set<string>();
  const executionBoundaries = new Set<string>();
  for (const agent of coreA2A.agents) {
    if (agents.has(agent.agentId)) {
      throw new A2AContractError('InvalidRequestError', 'A2A trusted agent registry contains duplicate agent IDs.');
    }
    if ((agent.executionIdentity === undefined) !== (agent.executionBoundaryId === undefined)) {
      throw new A2AContractError(
        'InvalidRequestError',
        'A2A trusted agents must provide executionIdentity and executionBoundaryId together.',
      );
    }
    if (agent.executionIdentity !== undefined) {
      if (!agent.executionIdentity.trim() || executionIdentities.has(agent.executionIdentity)) {
        throw new A2AContractError('InvalidRequestError', 'A2A trusted agent execution identities must be unique.');
      }
      if (!agent.executionBoundaryId!.trim() || executionBoundaries.has(agent.executionBoundaryId!)) {
        throw new A2AContractError('InvalidRequestError', 'A2A trusted agent execution boundaries must be unique.');
      }
      executionIdentities.add(agent.executionIdentity);
      executionBoundaries.add(agent.executionBoundaryId!);
    }
    agents.set(agent.agentId, agent);
  }
  return { agents, defaultAgentId: coreA2A.defaultAgentId };
}

export function createA2AProductionRuntime(options: A2AProductionRuntimeOptions): A2AProductionRuntime {
  const origin = httpsOrigin(options.publicOrigin);
  const scope = delegatedScope(options.configuredApplicationIdUri);
  const tenant = options.configuredTenantId?.trim() || 'common';
  const orchestrator = createCoreA2AOrchestrator();
  const agentRegistry = createAgentRegistry(options.coreA2A);
  if (options.requireScopedAgentAuthorization && 'agents' in options.coreA2A) {
    for (const agent of options.coreA2A.agents) {
      if (!agent.authorizationPolicy) {
        throw new A2AContractError(
          'UnsupportedOperationError',
          'A2A production agents must declare a scoped authorization policy.',
        );
      }
    }
  }
  const cancellationTimeoutMs = Math.min(
    Math.max(options.cancellationTimeoutMs ?? DEFAULT_CANCELLATION_TIMEOUT_MS, 1),
    MAX_CANCELLATION_TIMEOUT_MS,
  );
  const activeDispatches = new Map<string, AbortController>();
  const agentCard = createCoreAgentCard({
    agentId: 'teams-core',
    name: 'Teams Core Agent',
    description: 'Bounded authenticated Teams task execution with polling.',
    version: options.appVersion,
    endpoint: `${origin}/a2a`,
  });
  const v026AgentCard = createA2AV026AgentCard({
    name: 'Teams Core Agent',
    description: 'Bounded authenticated Teams task execution with JSON-RPC 2.0.',
    url: `${origin}/a2a/v026`,
    version: options.appVersion,
    securitySchemes: {
      teamsOAuth: {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
            tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
            scopes: { [scope]: 'Delegated Teams user access (access_as_user).' },
          },
        },
      },
    },
    security: [{ teamsOAuth: [scope] }],
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain'],
    skills: [{
      id: 'teams-core-tasks',
      name: 'Teams Core tasks',
      description: 'Bounded authenticated task execution with polling.',
      tags: ['teams', 'tasks'],
    }],
  });
  const officialAgentCard = createCoreOfficialAgentCard({
    name: 'Teams Core Agent',
    description: 'Bounded authenticated Teams task execution with polling.',
    version: options.appVersion,
    endpoint: `${origin}/a2a/v1`,
    securitySchemes: {
      teamsOAuth: {
        oauth2SecurityScheme: {
          flows: {
            authorizationCode: {
              authorizationUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
              tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
              scopes: { [scope]: 'Delegated Teams user access (access_as_user).' },
            },
          },
        },
      },
    },
    securityRequirements: [{ teamsOAuth: [scope] }],
  });

  const v026Router = createA2AV026JsonRpcRouter({
    store: options.store,
    authenticate: options.authenticate,
    resolveScope: options.resolveScope,
    execution: options.v026Execution,
    mapArtifact: (artifact): A2AV026Artifact => {
      if (!artifact.content) throw new Error('A2A artifact content is not available.');
      return {
        artifactId: artifact.artifactId,
        name: artifact.name,
        parts: [{ kind: 'text', text: artifact.content.text }],
        metadata: {
          sha256: artifact.sha256,
          byteSize: artifact.byteSize,
          mediaType: artifact.mediaType,
        },
      };
    },
  });
  const v1Router = createA2AV1JsonRpcRouter({
    store: options.store,
    authenticate: options.authenticate,
    resolveScope: options.resolveScope,
    execution: options.v026Execution,
    mapArtifact: (artifact): A2AV026Artifact => {
      if (!artifact.content) throw new Error('A2A artifact content is not available.');
      return {
        artifactId: artifact.artifactId,
        name: artifact.name,
        parts: [{ kind: 'text', text: artifact.content.text }],
        metadata: {
          sha256: artifact.sha256,
          byteSize: artifact.byteSize,
          mediaType: artifact.mediaType,
        },
      };
    },
  });
  const legacyRouter = createA2ARouter({
    store: options.store,
    agentCard,
    authenticate: options.authenticate,
    resolveScope: options.resolveScope,
    onTaskSubmitted: options.legacyOnTaskSubmitted,
    onTaskCancel: options.legacyOnTaskCancel,
  });

  const cancelTrustedChild = async (input: A2ADispatchChildCancellationInput): Promise<void> => {
    const agent = agentRegistry.agents.get(input.agentId);
    if (!agent || agent.providerId !== input.providerId || !agent.cancelChild) {
      throw new Error(`A2A trusted cancellation provider is unavailable for ${input.agentId}/${input.providerId}.`);
    }
    await withCancellationDeadline(agent.cancelChild({
      ...input,
      scope: { ...input.scope },
    }), cancellationTimeoutMs);
  };

  const recoverTrustedChild = async (
    input: A2AProductionChildRecoveryInput,
  ): Promise<A2AOrchestratorChildExecutionResult | undefined> => {
    const agent = agentRegistry.agents.get(input.agentId);
    if (!agent || agent.providerId !== input.providerId || !agent.recoverChild) return undefined;
    return agent.recoverChild({ ...input, scope: { ...input.scope } });
  };
  options.store.setDispatchChildCancellationHandler(cancelTrustedChild);

  const cancelPersistedChildren = async (
    dispatch: A2ADispatchIntent,
  ): Promise<A2ADispatchIntent> => {
    let latest = dispatch;
    for (const child of dispatch.children) {
      const currentChild = latest.children.find((candidate) => candidate.childKey === child.childKey);
      if (!currentChild || currentChild.cancelAcknowledgedAt) continue;
      if (currentChild.status === 'canceled') {
        latest = await options.store.acknowledgeDispatchChildCancellation(
          dispatch.parentTaskId,
          dispatch.scope,
          currentChild.childKey,
        ) ?? latest;
        continue;
      }
      if (currentChild.status === 'completed' || currentChild.status === 'failed') {
        latest = await options.store.acknowledgeDispatchChildCancellation(
          dispatch.parentTaskId,
          dispatch.scope,
          currentChild.childKey,
        ) ?? latest;
        continue;
      }
      if (!currentChild.agentJobId) {
        await reportCancellationFailure(options.onDispatchCancellationFailure, {
          ...cancellationFailureInput(dispatch, currentChild),
          reason: 'missing-job',
        });
        continue;
      }
      const agent = agentRegistry.agents.get(currentChild.agentId);
      if (!agent || agent.providerId !== currentChild.providerId || !agent.cancelChild) {
        await reportCancellationFailure(options.onDispatchCancellationFailure, {
          ...cancellationFailureInput(dispatch, currentChild),
          reason: 'missing-provider',
        });
        continue;
      }
      try {
        await cancelTrustedChild({
          scope: { ...dispatch.scope },
          parentTaskId: dispatch.parentTaskId,
          childKey: currentChild.childKey,
          childIdempotencyKey: currentChild.childIdempotencyKey,
          agentId: currentChild.agentId,
          providerId: currentChild.providerId,
          agentJobId: currentChild.agentJobId,
          cancelRequestedAt: dispatch.cancelRequestedAt!,
        });
      } catch (error) {
        await reportCancellationFailure(options.onDispatchCancellationFailure, {
          ...cancellationFailureInput(dispatch, currentChild),
          reason: 'cancellation-failed',
          error: redactAndBoundText(error instanceof Error ? error.message : 'unknown cancellation failure', 500),
        });
        continue;
      }
      latest = await options.store.acknowledgeDispatchChildCancellation(
        dispatch.parentTaskId,
        dispatch.scope,
        currentChild.childKey,
      ) ?? latest;
    }
    return latest;
  };

  const cancelDispatch = async ({ task, authenticatedScope }: { task: A2ATask; authenticatedScope: A2AScope }) => {
    assertMatchingOwner(task.scope, authenticatedScope);
    const persisted = options.store.getDispatchIntent(task.id, task.scope);
    if (!persisted) return undefined;
    const currentTask = options.store.getTask(task.id, task.scope);
    if (!currentTask) return undefined;
    if (persisted.status === 'canceled') return currentTask;

    const requested = await options.store.requestDispatchCancellation(task.id, task.scope);
    if (!requested) return undefined;
    const controller = activeDispatches.get(dispatchKey(task));
    controller?.abort(new A2AContractError('InvalidTaskError', 'A2A parent task was canceled.'));
    const reconciled = await cancelPersistedChildren(requested);
    const allTerminal = reconciled.children.every((child) => (
      child.status === 'completed' || child.status === 'failed' || child.status === 'canceled'
    ));
    if (allTerminal) {
      const finalized = await options.store.finalizeDispatch({
        parentTaskId: task.id,
        scope: task.scope,
        status: 'canceled',
        childOutcomes: outcomesFromDispatch(reconciled),
        parentTransition: 'canceled',
      });
      return finalized?.task;
    }
    return options.store.getTask(task.id, task.scope) ?? currentTask;
  };

  const dispatchChildren = async (input: A2AProductionChildDispatch): Promise<A2AOrchestrationResult> => {
    assertMatchingScope(input.parentTask.scope, input.scope);
    const parent = options.store.getTask(input.parentTask.id, input.scope);
    if (!parent) throw new A2AContractError('InvalidTaskError', 'A2A parent task is not available for dispatch.');
    if (parent.status === 'completed' || parent.status === 'failed' || parent.status === 'canceled') {
      throw new A2AContractError('TerminalStateImmutableError', 'A2A parent task is already terminal.');
    }
    if (options.store.getDispatchIntent(parent.id, input.scope)) {
      throw new A2AContractError(
        'InvalidTaskError',
        'A2A parent task already has a durable child dispatch.',
      );
    }
    const key = dispatchKey(parent);
    if (activeDispatches.has(key)) throw new A2AContractError('InvalidTaskError', 'A2A parent task already has an active child dispatch.');
    const controller = new AbortController();
    activeDispatches.set(key, controller);
    const dispatchStartedAt = Date.now();
    options.telemetry?.record({
      kind: 'dispatch',
      phase: 'started',
      taskId: parent.id,
      dispatchId: parent.id,
      providerId: 'orchestrator',
      latencyMs: 0,
      result: 'accepted',
      correlationId: parent.id,
    });
    const selectedAgents = new Map<string, A2AProductionAgent>();
    try {
      const result = await orchestrator.run({
        scope: input.scope,
        parentTaskId: parent.id,
        requests: input.requests,
        deadlineMs: input.deadlineMs,
        parallelism: input.parallelism,
        depth: input.depth,
        fanOutIndex: input.fanOutIndex,
        signal: controller.signal,
        resolveAgentIdentity: (selection) => {
          const agentId = selection.requestedAgentId ?? agentRegistry.defaultAgentId;
          if (!agentId) {
            throw new A2AContractError(
              'UnsupportedOperationError',
              'A2A child request must select a registered agent from the trusted allowlist.',
            );
          }
          const agent = agentRegistry.agents.get(agentId);
          if (!agent) {
            throw new A2AContractError(
              'UnsupportedOperationError',
              'A2A child request does not select a registered agent in the trusted allowlist.',
            );
          }
          if (!agent.authorize) {
            throw new A2AContractError(
              'UnsupportedOperationError',
              'A2A independently registered agents must provide an authorization policy.',
            );
          }
          const authorizationInput = {
            agentId: agent.agentId,
            scope: { ...selection.scope },
            role: selection.role,
            ...(selection.capabilities ? { capabilities: selection.capabilities } : {}),
          };
          const authorized = agent.authorizationPolicy
            ? evaluateA2AAgentAuthorization(agent.authorizationPolicy, authorizationInput).allowed
            : agent.authorize(authorizationInput);
          if (!authorized) {
            throw new A2AContractError(
              'UnsupportedOperationError',
              'A2A child request is not authorized for the selected agent.',
            );
          }
          selectedAgents.set(selection.childKey, agent);
          return {
            agentId: agent.agentId,
            providerId: agent.providerId,
            ...(agent.executionIdentity === undefined ? {} : { executionIdentity: agent.executionIdentity }),
            ...(agent.executionBoundaryId === undefined ? {} : { executionBoundaryId: agent.executionBoundaryId }),
          };
        },
        onDispatchPrepared: async (prepared) => {
          await options.store.createOrGetDispatchIntent({
            parentTaskId: parent.id,
            scope: input.scope,
            requestFingerprint: fingerprintPreparedDispatch(input, prepared),
            deadlineAt: new Date(prepared.deadlineAtMs).toISOString(),
            children: prepared.children,
          });
        },
        executeChild: async (child) => {
          const agent = selectedAgents.get(child.childKey);
          if (!agent || agent.agentId !== child.agentId || agent.providerId !== child.providerId
            || agent.executionIdentity !== child.executionIdentity
            || agent.executionBoundaryId !== child.executionBoundaryId) {
            throw new A2AContractError('InvalidTaskError', 'A2A child agent selection is not available for execution.');
          }
          await options.store.markDispatchChildStarted(parent.id, input.scope, child.childKey);
          const bindChild = async (agentJobId: string): Promise<void> => {
            const bound = await options.store.bindDispatchChild(parent.id, input.scope, child.childKey, agentJobId);
            const persistedChild = bound?.children.find((candidate) => candidate.childKey === child.childKey);
            if (!bound?.cancelRequestedAt || persistedChild?.cancelAcknowledgedAt || !agent.cancelChild) return;
            await cancelTrustedChild({
              scope: { ...input.scope },
              parentTaskId: parent.id,
              childKey: child.childKey,
              childIdempotencyKey: child.childIdempotencyKey,
              agentId: agent.agentId,
              providerId: agent.providerId,
              ...(agent.executionIdentity === undefined ? {} : { executionIdentity: agent.executionIdentity }),
              ...(agent.executionBoundaryId === undefined ? {} : { executionBoundaryId: agent.executionBoundaryId }),
              agentJobId,
              cancelRequestedAt: bound.cancelRequestedAt,
            });
            await options.store.acknowledgeDispatchChildCancellation(parent.id, input.scope, child.childKey);
          };
          return agent.executeChild({
            ...child,
            agentId: agent.agentId,
            providerId: agent.providerId,
            bindChild,
          });
        },
        onChildSettled: async (child) => {
          const dispatch = await options.store.recordDispatchChildOutcome(parent.id, input.scope, {
            childKey: child.childKey,
            status: child.status,
            ...(child.taskId ? { agentJobId: child.taskId } : {}),
          });
          if (dispatch?.cancelRequestedAt && child.status === 'canceled') {
            await options.store.acknowledgeDispatchChildCancellation(parent.id, input.scope, child.childKey);
          }
        },
      });
      await persistFinalChildOutcomes(options.store, parent.id, input.scope, result);
      const dispatch = options.store.getDispatchIntent(parent.id, input.scope);
      if (!dispatch) throw new A2AContractError('InvalidTaskError', 'A2A durable dispatch intent is not available.');
      const completed = result.childResults.filter((child) => child.status === 'completed');
      const canceledByChildResults = result.canceledChildren === result.childResults.length;
      const canceled = Boolean(dispatch.cancelRequestedAt) || canceledByChildResults;
      const cancellationDispatch = canceledByChildResults && !dispatch.cancelRequestedAt
        ? await options.store.requestDispatchCancellation(parent.id, input.scope)
        : dispatch;
      if (canceled) {
        await acknowledgeTerminalCancellationChildren(options.store, cancellationDispatch ?? dispatch);
      }
      const latestDispatch = options.store.getDispatchIntent(parent.id, input.scope)
        ?? cancellationDispatch
        ?? dispatch;
      if (!canceled && completed.length === result.childResults.length) {
        await options.store.finalizeDispatch({
          parentTaskId: parent.id,
          scope: input.scope,
          status: 'completed',
          childOutcomes: outcomesForFinalization(latestDispatch, result),
          parentTransition: {
            status: 'completed',
            artifacts: completed.map((child) => artifactForChild(parent, input.scope, child.childKey, child.taskId!, child.result!)),
            error: undefined,
          },
        });
        options.telemetry?.record({
          kind: 'dispatch',
          phase: 'completed',
          taskId: parent.id,
          dispatchId: parent.id,
          providerId: 'orchestrator',
          latencyMs: Math.max(0, Date.now() - dispatchStartedAt),
          result: 'success',
          correlationId: parent.id,
        });
      } else if (canceled) {
        await options.store.finalizeDispatch({
          parentTaskId: parent.id,
          scope: input.scope,
          status: 'canceled',
          childOutcomes: outcomesForFinalization(latestDispatch, result),
          parentTransition: 'canceled',
        });
        options.telemetry?.record({
          kind: 'dispatch',
          phase: 'canceled',
          taskId: parent.id,
          dispatchId: parent.id,
          providerId: 'orchestrator',
          latencyMs: Math.max(0, Date.now() - dispatchStartedAt),
          result: 'canceled',
          correlationId: parent.id,
        });
      } else {
        await options.store.finalizeDispatch({
          parentTaskId: parent.id,
          scope: input.scope,
          status: 'failed',
          childOutcomes: outcomesForFinalization(latestDispatch, result),
          parentTransition: {
            status: 'failed',
            artifacts: [],
            error: 'One or more bounded A2A child executions did not complete.',
          },
        });
        options.telemetry?.record({
          kind: 'dispatch',
          phase: 'failed',
          taskId: parent.id,
          dispatchId: parent.id,
          providerId: 'orchestrator',
          latencyMs: Math.max(0, Date.now() - dispatchStartedAt),
          result: 'failure',
          correlationId: parent.id,
        });
      }
      await options.coreA2A.onDispatchAudit?.(result.audit);
      return result;
    } catch (error) {
      options.telemetry?.record({
        kind: 'dispatch',
        phase: 'failed',
        taskId: parent.id,
        dispatchId: parent.id,
        providerId: 'orchestrator',
        latencyMs: Math.max(0, Date.now() - dispatchStartedAt),
        result: 'error',
        correlationId: parent.id,
      });
      throw error;
    } finally {
      activeDispatches.delete(key);
    }
  };

  const orchestrationRouter = createA2AOrchestrationRouter({
    store: options.store,
    authenticate: options.authenticate,
    resolveScope: options.resolveScope,
    dispatchChildren,
  });

  return {
    agentCard,
    v026AgentCard,
    officialAgentCard,
    ...(options.telemetry ? { telemetry: options.telemetry } : {}),
    dispatchChildren,
    cancelDispatch,
    recoverChild: recoverTrustedChild,
    mount: (http) => {
      http.get('/.well-known/agent-card.json', (_request, response) => {
        const body = JSON.stringify(officialAgentCard);
        response
          .type('application/json')
          .set('Cache-Control', 'public, max-age=60')
          .set('ETag', `"${crypto.createHash('sha256').update(body, 'utf8').digest('hex')}"`)
          .status(200)
          .send(body);
      });
      http.get('/.well-known/agent.json', (_request, response) => {
        response.type('application/json').status(200).send(v026AgentCard);
      });
      // The versioned JSON-RPC mount must precede the broader legacy /a2a
      // router so malformed/unsupported v0.2.6 calls cannot be misparsed by
      // the older REST-compatible route.
      http.use('/a2a/v026', v026Router);
      http.use('/a2a/v1', v1Router);
      http.use('/a2a/orchestrate', orchestrationRouter);
      http.use('/a2a', legacyRouter);
    },
  };
}

function dispatchKey(task: Pick<A2ATask, 'id' | 'scope'>): string {
  return JSON.stringify([task.scope.tenantId, task.scope.requesterId, task.scope.conversationId, task.id]);
}

function fingerprintPreparedDispatch(
  input: A2AProductionChildDispatch,
  prepared: A2AOrchestratorPreparedDispatch,
): string {
  return crypto.createHash('sha256').update(JSON.stringify([
    prepared.parentTaskId,
    prepared.scope.tenantId,
    prepared.scope.requesterId,
    prepared.scope.conversationId,
    input.deadlineMs,
    input.parallelism,
    input.depth ?? 0,
    input.fanOutIndex ?? 0,
    prepared.children.map((child) => [
      child.childKey,
      child.childIdempotencyKey,
      child.role,
      child.agentId,
      child.providerId,
      child.requestSha256,
    ]),
  ]), 'utf8').digest('hex');
}

async function persistFinalChildOutcomes(
  store: A2AStore,
  parentTaskId: string,
  scope: A2AScope,
  result: A2AOrchestrationResult,
): Promise<void> {
  const seen = new Set<string>();
  for (const child of result.childResults) {
    if (seen.has(child.childKey)) continue;
    seen.add(child.childKey);
    await store.recordDispatchChildOutcome(parentTaskId, scope, {
      childKey: child.childKey,
      status: child.status,
      ...(child.taskId ? { agentJobId: child.taskId } : {}),
    });
  }
}

async function acknowledgeTerminalCancellationChildren(store: A2AStore, dispatch: A2ADispatchIntent): Promise<void> {
  for (const child of dispatch.children) {
    if (child.cancelAcknowledgedAt) continue;
    if (child.status === 'completed' || child.status === 'failed' || child.status === 'canceled') {
      await store.acknowledgeDispatchChildCancellation(dispatch.parentTaskId, dispatch.scope, child.childKey);
    }
  }
}

async function withCancellationDeadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`A2A child cancellation timed out after ${timeoutMs}ms.`)), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function outcomesForFinalization(
  dispatch: A2ADispatchIntent,
  result: A2AOrchestrationResult,
): A2ADispatchChildOutcome[] {
  return dispatch.children.map((child) => {
    if (child.status === 'completed' || child.status === 'failed' || child.status === 'canceled') {
      return {
        childKey: child.childKey,
        status: child.status,
        ...(child.agentJobId ? { agentJobId: child.agentJobId } : {}),
      };
    }
    const outcome = result.childResults.find((candidate) => candidate.childKey === child.childKey);
    if (!outcome) throw new A2AContractError('InvalidTaskError', 'A2A durable child outcome is not available.');
    return {
      childKey: child.childKey,
      status: outcome.status,
      ...(outcome.taskId ? { agentJobId: outcome.taskId } : {}),
    };
  });
}

function outcomesFromDispatch(dispatch: A2ADispatchIntent): A2ADispatchChildOutcome[] {
  return dispatch.children.map((child) => {
    if (child.status !== 'completed' && child.status !== 'failed' && child.status !== 'canceled') {
      throw new A2AContractError('InvalidTaskError', 'A2A durable dispatch contains a non-terminal child.');
    }
    return {
      childKey: child.childKey,
      status: child.status,
      ...(child.agentJobId ? { agentJobId: child.agentJobId } : {}),
    };
  });
}

function cancellationFailureInput(
  dispatch: A2ADispatchIntent,
  child: A2ADispatchIntent['children'][number],
): Omit<A2ADispatchCancellationFailure, 'reason' | 'error'> {
  return {
    scope: { ...dispatch.scope },
    parentTaskId: dispatch.parentTaskId,
    childKey: child.childKey,
    childIdempotencyKey: child.childIdempotencyKey,
    agentId: child.agentId,
    providerId: child.providerId,
    ...(child.executionIdentity === undefined ? {} : { executionIdentity: child.executionIdentity }),
    ...(child.executionBoundaryId === undefined ? {} : { executionBoundaryId: child.executionBoundaryId }),
    ...(child.agentJobId ? { agentJobId: child.agentJobId } : {}),
    ...(dispatch.cancelRequestedAt ? { cancelRequestedAt: dispatch.cancelRequestedAt } : {}),
  };
}

async function reportCancellationFailure(
  handler: A2ADispatchCancellationFailureHandler | undefined,
  failure: A2ADispatchCancellationFailure,
): Promise<void> {
  console.error('A2A live dispatch cancellation failed', JSON.stringify({
    parentTaskId: failure.parentTaskId,
    childKey: failure.childKey,
    childIdempotencyKey: failure.childIdempotencyKey,
    agentId: failure.agentId,
    providerId: failure.providerId,
    ...(failure.agentJobId ? { agentJobId: failure.agentJobId } : {}),
    reason: failure.reason,
    ...(failure.error ? { error: failure.error } : {}),
  }));
  try {
    await handler?.(failure);
  } catch (error) {
    console.error(
      'A2A live dispatch cancellation failure consumer failed',
      error instanceof Error ? redactAndBoundText(error.message, 500) : 'unknown error',
    );
  }
}

function assertMatchingScope(expected: A2AScope, actual: A2AScope): void {
  if (expected.tenantId !== actual.tenantId
    || expected.requesterId !== actual.requesterId
    || expected.conversationId !== actual.conversationId) {
    throw new A2AContractError('ScopeMismatchError', 'A2A child dispatch scope does not match its authenticated parent scope.');
  }
}

function assertMatchingOwner(taskScope: A2AScope, authenticatedScope: A2AScope): void {
  if (taskScope.tenantId !== authenticatedScope.tenantId || taskScope.requesterId !== authenticatedScope.requesterId) {
    throw new A2AContractError('ScopeMismatchError', 'A2A parent task does not belong to the authenticated requester.');
  }
}

function artifactForChild(
  parent: A2ATask,
  scope: A2AScope,
  childKey: string,
  childTaskId: string,
  result: string,
): A2ATask['artifacts'][number] {
  const sha256 = crypto.createHash('sha256').update(result, 'utf8').digest('hex');
  const childDigest = crypto.createHash('sha256').update(childKey, 'utf8').digest('hex');
  return {
    artifactId: `artifact-${childDigest.slice(0, 24)}-${sha256.slice(0, 24)}`,
    taskId: parent.id,
    sourceTaskId: childTaskId,
    sha256,
    byteSize: Buffer.byteLength(result, 'utf8'),
    mediaType: 'text/plain',
    name: `${childTaskId}.txt`,
    scope,
    content: { mediaType: 'text/plain', text: result },
    metadata: { childKey, childTaskId },
  };
}

function createA2AOrchestrationRouter(options: Readonly<{
  store: A2AStore;
  authenticate: RequestHandler;
  resolveScope: (request: Request) => A2AScope | undefined;
  dispatchChildren: (input: A2AProductionChildDispatch) => Promise<A2AOrchestrationResult>;
}>): express.Router {
  const router = express.Router();
  router.use(options.authenticate);
  router.use(express.json({ limit: '64kb', strict: true }));
  router.post('/', asyncHandler(async (request, response) => {
    const authenticatedScope = options.resolveScope(request);
    if (!authenticatedScope) throw new A2AOrchestrationUnauthorizedError();
    const input = validateOrchestrationRouteRequest(request.body);
    const parentTask = options.store.getTaskForOwner(input.parentTaskId, authenticatedScope);
    if (!parentTask) throw new A2AOrchestrationNotFoundError();
    const result = await options.dispatchChildren({
      parentTask,
      scope: parentTask.scope,
      requests: input.requests,
      deadlineMs: input.deadlineMs,
      parallelism: input.parallelism,
      ...(input.depth === undefined ? {} : { depth: input.depth }),
      ...(input.fanOutIndex === undefined ? {} : { fanOutIndex: input.fanOutIndex }),
    });
    response.status(200).json(serializeOrchestrationResult(result));
  }));
  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    sendOrchestrationError(response, error);
  });
  return router;
}

function validateOrchestrationRouteRequest(value: unknown): A2AOrchestrationRouteRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new A2AContractError('InvalidRequestError', 'A2A orchestration request must be a JSON object.');
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(['parentTaskId', 'requests', 'deadlineMs', 'parallelism', 'depth', 'fanOutIndex']);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new A2AContractError('InvalidRequestError', 'A2A orchestration request contains unsupported fields.');
  }
  if (typeof record.parentTaskId !== 'string' || !Array.isArray(record.requests)) {
    throw new A2AContractError('InvalidRequestError', 'A2A orchestration parentTaskId and requests are required.');
  }
  if (record.requests.length < 1 || record.requests.length > 16) {
    throw new A2AContractError('GraphLimitExceededError', 'A2A orchestration exceeds the maximum child count.');
  }
  if (!Number.isInteger(record.parallelism) || (record.parallelism as number) < 1 || (record.parallelism as number) > 8) {
    throw new A2AContractError('GraphLimitExceededError', 'parallelism is outside the allowed bounds.');
  }
  if (!Number.isInteger(record.deadlineMs) || (record.deadlineMs as number) < 1 || (record.deadlineMs as number) > 60_000) {
    throw new A2AContractError('DeadlineExceededError', 'deadlineMs is outside the allowed bounds.');
  }
  if (record.depth !== undefined && (!Number.isInteger(record.depth) || (record.depth as number) < 0 || (record.depth as number) > 8)) {
    throw new A2AContractError('GraphLimitExceededError', 'depth is outside the allowed bounds.');
  }
  if (record.fanOutIndex !== undefined && (!Number.isInteger(record.fanOutIndex) || (record.fanOutIndex as number) < 0 || (record.fanOutIndex as number) >= 16)) {
    throw new A2AContractError('GraphLimitExceededError', 'fanOutIndex is outside the allowed bounds.');
  }
  return {
    parentTaskId: record.parentTaskId,
    requests: record.requests as A2AOrchestratorChildRequest[],
    deadlineMs: record.deadlineMs as number,
    parallelism: record.parallelism as number,
    ...(record.depth === undefined ? {} : { depth: record.depth as number }),
    ...(record.fanOutIndex === undefined ? {} : { fanOutIndex: record.fanOutIndex as number }),
  };
}

function serializeOrchestrationResult(result: A2AOrchestrationResult): Record<string, unknown> {
  return {
    parentTaskId: result.parentTaskId,
    totalChildren: result.totalChildren,
    uniqueChildren: result.uniqueChildren,
    duplicateChildren: result.duplicateChildren,
    completedChildren: result.completedChildren,
    failedChildren: result.failedChildren,
    canceledChildren: result.canceledChildren,
    childResults: result.childResults.map((child) => ({
      childKey: child.childKey,
      childIdempotencyKey: child.childIdempotencyKey,
      agentId: child.agentId,
      providerId: child.providerId,
      ...(child.taskId === undefined ? {} : { taskId: child.taskId }),
      status: child.status,
      duplicated: child.duplicated,
    })),
  };
}

class A2AOrchestrationUnauthorizedError extends Error {
  constructor() {
    super('Authenticated Teams scope is required.');
    this.name = 'A2AOrchestrationUnauthorizedError';
  }
}

class A2AOrchestrationNotFoundError extends Error {
  constructor() {
    super('The requested A2A parent task was not found.');
    this.name = 'A2AOrchestrationNotFoundError';
  }
}

function sendOrchestrationError(response: Response, error: unknown): void {
  if (error instanceof A2AOrchestrationUnauthorizedError) {
    response.status(401).json({ error: { code: 'A2A_AUTH_REQUIRED', message: error.message, retryable: false } });
    return;
  }
  if (error instanceof A2AOrchestrationNotFoundError) {
    response.status(404).json({ error: { code: 'A2A_NOT_FOUND', message: error.message, retryable: false } });
    return;
  }
  if (error instanceof A2AContractError) {
    response.status(error.code === 'TerminalStateImmutableError' ? 409 : 400).json(error.toJSON());
    return;
  }
  if (isJsonBodyError(error)) {
    response.status(400).json({ error: { code: 'InvalidRequestError', message: 'Request body must be valid JSON.', retryable: false } });
    return;
  }
  if (isBodyTooLargeError(error)) {
    response.status(413).json({ error: { code: 'InvalidRequestError', message: 'Request body exceeds the allowed size.', retryable: false } });
    return;
  }
  response.status(500).json({ error: { code: 'InternalError', message: 'The A2A orchestration request could not be completed.', retryable: true } });
}

function isJsonBodyError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'type' in error && error.type === 'entity.parse.failed');
}

function isBodyTooLargeError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large');
}

function asyncHandler(handler: (request: Request, response: Response) => Promise<void>): RequestHandler {
  return (request, response, next) => {
    void handler(request, response).catch(next);
  };
}

export function mountA2AProductionRuntime(
  http: Pick<Application, 'get' | 'use'>,
  options: A2AProductionRuntimeOptions,
): A2AProductionRuntime {
  const runtime = createA2AProductionRuntime(options);
  runtime.mount(http);
  return runtime;
}
