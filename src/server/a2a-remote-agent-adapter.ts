import type { A2AScope } from './a2a-contract.js';
import type { A2AAgentAuthorizationPolicy } from './a2a-agent-authorization.js';
import type {
  A2AOrchestratorChildExecutionInput,
  A2AOrchestratorChildExecutionResult,
} from './a2a-orchestrator.js';
import type { A2AProductionChildCancellationInput } from './a2a-production-runtime.js';
import type { A2ATelemetryCollector } from './a2a-telemetry.js';
import {
  A2ARemoteClientError,
  createA2ARemoteClient,
  type A2ARemoteClient,
  type A2ARemoteClientErrorCode,
  type A2ARemoteFetch,
  type A2ARemoteMessage,
  type A2ARemoteTask,
} from './a2a-remote-client.js';

const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_MAX_POLLS = 240;
const MAX_POLL_INTERVAL_MS = 5_000;

type RemoteAgentAuthorizationInput = Readonly<{
  scope: A2AScope;
  role: string;
  capabilities?: readonly string[];
}>;

export type A2ARemoteAgentAdapterOptions = Readonly<{
  agentId: string;
  providerId: string;
  kind?: string;
  executionIdentity?: string;
  executionBoundaryId?: string;
  roles?: readonly string[];
  capabilities?: readonly string[];
  client: A2ARemoteClient;
  authorizationPolicy: A2AAgentAuthorizationPolicy;
  authorize?: (input: RemoteAgentAuthorizationInput) => boolean;
  pollIntervalMs?: number;
  maxPolls?: number;
  telemetry?: A2ATelemetryCollector;
}>;

export type A2AConfiguredRemoteAgentOptions = Readonly<
  Omit<A2ARemoteAgentAdapterOptions, 'client'> & {
    endpoint: string;
    bearerToken: string;
    fetch?: A2ARemoteFetch;
    requestTimeoutMs?: number;
  }
>;

export type A2ARemoteAgentRecoveryInput = Readonly<{
  scope: A2AScope;
  parentTaskId: string;
  childKey: string;
  childIdempotencyKey?: string;
  agentId: string;
  providerId: string;
  agentJobId: string;
  deadlineAtMs: number;
  signal: AbortSignal;
}>;

export type A2ARemoteProductionAgent = Readonly<{
  agentId: string;
  providerId: string;
  kind?: string;
  executionIdentity?: string;
  executionBoundaryId?: string;
  roles?: readonly string[];
  capabilities?: readonly string[];
  authorize: (input: RemoteAgentAuthorizationInput) => boolean;
  authorizationPolicy: A2AAgentAuthorizationPolicy;
  executeChild: (input: A2AOrchestratorChildExecutionInput & {
    bindChild: (agentJobId: string) => Promise<void>;
  }) => Promise<A2AOrchestratorChildExecutionResult>;
  cancelChild: (input: A2AProductionChildCancellationInput) => Promise<void>;
  recoverChild: (input: A2ARemoteAgentRecoveryInput) => Promise<A2AOrchestratorChildExecutionResult>;
}>;

export type A2AConfiguredRemoteAgentFailure = Readonly<{
  agentId: string;
  providerId: string;
  kind?: string;
  code: A2ARemoteClientErrorCode | 'CONFIGURATION_ERROR';
}>;

export type A2AConfiguredRemoteAgentBatchResult = Readonly<{
  agents: readonly A2ARemoteProductionAgent[];
  failures: readonly A2AConfiguredRemoteAgentFailure[];
}>;

function boundedPoll(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 1) throw new TypeError('A2A remote polling value must be positive.');
  return Math.min(Math.trunc(value), max);
}

function taskId(task: A2ARemoteTask): string {
  const id = task.id;
  if (typeof id !== 'string' || id.length === 0 || id.length > 200) throw new Error('Remote A2A task did not return a valid task ID.');
  return id;
}

function isDirectMessage(value: A2ARemoteTask | A2ARemoteMessage): value is A2ARemoteMessage {
  return 'messageId' in value && typeof value.messageId === 'string' && Array.isArray(value.parts);
}

function directMessageResult(
  message: A2ARemoteMessage,
  fallbackTaskId: string,
): A2AOrchestratorChildExecutionResult {
  const result = message.parts.map((part) => part.text).join('\n').trim();
  if (!result) throw new Error('Remote A2A direct response did not contain text.');
  return {
    taskId: message.taskId ?? fallbackTaskId,
    status: 'completed',
    result,
  };
}

type RemoteTaskState = 'working' | 'completed' | 'failed' | 'canceled' | 'input-required' | 'auth-required';

function taskState(task: A2ARemoteTask): RemoteTaskState {
  const status = task.status;
  const raw = status && typeof status === 'object' ? (status as { state?: unknown }).state : undefined;
  const normalized = String(raw ?? '')
    .toLowerCase()
    .replace(/^task_state_/, '')
    .replace(/_/g, '-');
  if (normalized === 'completed') return 'completed';
  if (normalized === 'failed' || normalized === 'rejected') return 'failed';
  if (normalized === 'canceled' || normalized === 'cancelled') return 'canceled';
  if (normalized === 'input-required') return 'input-required';
  if (normalized === 'auth-required') return 'auth-required';
  return 'working';
}

function isInterruptedState(state: RemoteTaskState): state is 'input-required' | 'auth-required' {
  return state === 'input-required' || state === 'auth-required';
}

function taskText(task: A2ARemoteTask): string | undefined {
  const artifacts = Array.isArray(task.artifacts) ? task.artifacts : [];
  const text = artifacts.flatMap((artifact) => {
    if (!artifact || typeof artifact !== 'object') return [];
    const parts = (artifact as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) return [];
    return parts.flatMap((part) => {
      if (!part || typeof part !== 'object' || typeof (part as { text?: unknown }).text !== 'string') return [];
      return [(part as { text: string }).text];
    });
  }).join('\n').trim();
  return text || undefined;
}

function taskError(task: A2ARemoteTask): string | undefined {
  const status = task.status;
  if (!status || typeof status !== 'object') return undefined;
  const message = (status as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message.slice(0, 4_000) : undefined;
}

async function waitForSignal(signal: AbortSignal, delayMs: number): Promise<void> {
  if (signal.aborted) throw signal.reason ?? new Error('A2A remote child was canceled.');
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout;
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason ?? new Error('A2A remote child was canceled.'));
    };
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function recordTelemetry(
  collector: A2ATelemetryCollector | undefined,
  input: Readonly<{ childIdempotencyKey?: string; agentJobId?: string; providerId: string }>,
  phase: 'started' | 'completed' | 'failed' | 'canceled',
  result: string,
): void {
  collector?.record({
    kind: 'task',
    phase,
    providerId: input.providerId,
    latencyMs: 0,
    result,
    correlationId: input.childIdempotencyKey ?? input.agentJobId ?? 'remote-task',
  });
}

function terminalResult(task: A2ARemoteTask, remoteTaskId: string): A2AOrchestratorChildExecutionResult | undefined {
  const state = taskState(task);
  if (state === 'completed') {
    return { taskId: remoteTaskId, status: 'completed', result: taskText(task) ?? 'Remote A2A task completed.' };
  }
  if (state === 'failed') {
    return { taskId: remoteTaskId, status: 'failed', error: taskError(task) ?? 'Remote A2A task failed.' };
  }
  if (state === 'canceled') return { taskId: remoteTaskId, status: 'canceled' };
  if (state === 'input-required') {
    return {
      taskId: remoteTaskId,
      status: 'failed',
      error: 'Remote A2A task requires additional input (TASK_STATE_INPUT_REQUIRED).',
    };
  }
  if (state === 'auth-required') {
    return {
      taskId: remoteTaskId,
      status: 'failed',
      error: 'Remote A2A task requires authentication (TASK_STATE_AUTH_REQUIRED).',
    };
  }
  return undefined;
}

async function cancelAndReturn(
  client: A2ARemoteClient,
  remoteTaskId: string,
  error: string,
): Promise<A2AOrchestratorChildExecutionResult> {
  await client.cancelTask(remoteTaskId).catch(() => undefined);
  return { taskId: remoteTaskId, status: 'canceled', error };
}

async function pollRemoteTask(
  client: A2ARemoteClient,
  initialTask: A2ARemoteTask,
  remoteTaskId: string,
  input: Readonly<{ deadlineAtMs: number; signal: AbortSignal }>,
  pollIntervalMs: number,
  maxPolls: number,
): Promise<A2AOrchestratorChildExecutionResult> {
  let task = initialTask;
  for (let poll = 0; poll <= maxPolls; poll += 1) {
    const terminal = terminalResult(task, remoteTaskId);
    if (terminal) return terminal;

    const remainingMs = input.deadlineAtMs - Date.now();
    if (!Number.isFinite(input.deadlineAtMs) || remainingMs <= 0) {
      return cancelAndReturn(client, remoteTaskId, 'Remote A2A task deadline exceeded.');
    }
    try {
      await waitForSignal(input.signal, Math.min(pollIntervalMs, remainingMs));
    } catch {
      return cancelAndReturn(client, remoteTaskId, 'Remote A2A task canceled.');
    }
    if (Date.now() >= input.deadlineAtMs) {
      return cancelAndReturn(client, remoteTaskId, 'Remote A2A task deadline exceeded.');
    }
    try {
      task = await client.getTask(remoteTaskId, { signal: input.signal });
    } catch (error) {
      if (!input.signal.aborted) throw error;
      return cancelAndReturn(client, remoteTaskId, 'Remote A2A task canceled.');
    }
  }
  return cancelAndReturn(client, remoteTaskId, 'Remote A2A task polling deadline exceeded.');
}

export function createA2ARemoteAgent(options: A2ARemoteAgentAdapterOptions): A2ARemoteProductionAgent {
  const pollIntervalMs = boundedPoll(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, MAX_POLL_INTERVAL_MS);
  const maxPolls = boundedPoll(options.maxPolls, DEFAULT_MAX_POLLS, DEFAULT_MAX_POLLS);
  const authorize = options.authorize ?? (() => false);

  return {
    agentId: options.agentId,
    providerId: options.providerId,
    ...(options.kind === undefined ? {} : { kind: options.kind }),
    ...(options.executionIdentity === undefined ? {} : { executionIdentity: options.executionIdentity }),
    ...(options.executionBoundaryId === undefined ? {} : { executionBoundaryId: options.executionBoundaryId }),
    ...(options.roles === undefined ? {} : { roles: Object.freeze([...options.roles]) }),
    ...(options.capabilities === undefined ? {} : { capabilities: Object.freeze([...options.capabilities]) }),
    authorize,
    authorizationPolicy: options.authorizationPolicy,
    async executeChild(input) {
      recordTelemetry(options.telemetry, input, 'started', 'accepted');
      let response: A2ARemoteTask | A2ARemoteMessage;
      try {
        response = await options.client.sendMessage({
          messageId: input.childIdempotencyKey,
          contextId: input.parentTaskId,
          parts: [{ text: input.prompt, mediaType: 'text/plain' }],
        }, { signal: input.signal });
      } catch (error) {
        if (input.signal.aborted) {
          recordTelemetry(options.telemetry, input, 'canceled', 'canceled');
          return {
            taskId: input.childIdempotencyKey,
            status: 'canceled',
            error: 'Remote A2A task canceled.',
          };
        }
        recordTelemetry(options.telemetry, input, 'failed', 'failure');
        throw error;
      }
      if (isDirectMessage(response)) {
        const result = directMessageResult(response, input.childIdempotencyKey);
        try {
          await input.bindChild(result.taskId);
        } catch (error) {
          recordTelemetry(options.telemetry, input, 'failed', 'failure');
          throw error;
        }
        recordTelemetry(options.telemetry, input, 'completed', 'success');
        return result;
      }
      const task = response;
      const remoteTaskId = taskId(task);
      const initialState = taskState(task);
      try {
        await input.bindChild(remoteTaskId);
      } catch (error) {
        if (!isInterruptedState(initialState)) {
          await options.client.cancelTask(remoteTaskId).catch(() => undefined);
        }
        recordTelemetry(options.telemetry, input, 'failed', 'failure');
        throw error;
      }

      try {
        const result = await pollRemoteTask(
          options.client,
          task,
          remoteTaskId,
          input,
          pollIntervalMs,
          maxPolls,
        );
        recordTelemetry(
          options.telemetry,
          input,
          result.status === 'completed' ? 'completed' : result.status === 'canceled' ? 'canceled' : 'failed',
          result.status === 'completed' ? 'success' : result.status === 'canceled' ? 'canceled' : 'failure',
        );
        return result;
      } catch (error) {
        await options.client.cancelTask(remoteTaskId).catch(() => undefined);
        recordTelemetry(options.telemetry, input, 'failed', 'failure');
        throw error;
      }
    },
    async recoverChild(input) {
      recordTelemetry(options.telemetry, input, 'started', 'accepted');
      try {
        const task = await options.client.getTask(input.agentJobId, { signal: input.signal });
        const returnedTaskId = taskId(task);
        if (returnedTaskId !== input.agentJobId) {
          throw new Error('Remote A2A task recovery returned a different task identity.');
        }
        const result = await pollRemoteTask(
          options.client,
          task,
          returnedTaskId,
          input,
          pollIntervalMs,
          maxPolls,
        );
        recordTelemetry(
          options.telemetry,
          input,
          result.status === 'completed' ? 'completed' : result.status === 'canceled' ? 'canceled' : 'failed',
          result.status === 'completed' ? 'success' : result.status === 'canceled' ? 'canceled' : 'failure',
        );
        return result;
      } catch (error) {
        recordTelemetry(options.telemetry, input, 'failed', 'failure');
        throw error;
      }
    },
    async cancelChild(input) {
      await options.client.cancelTask(input.agentJobId);
    },
  };
}

export async function createConfiguredA2ARemoteAgent(
  options: A2AConfiguredRemoteAgentOptions,
): Promise<A2ARemoteProductionAgent> {
  const bearerToken = options.bearerToken.trim();
  if (!bearerToken || bearerToken.length > 4_096 || /[\r\n]/.test(bearerToken)) {
    throw new TypeError('A2A configured bearer token is invalid.');
  }
  const client = await createA2ARemoteClient(options.endpoint, {
    ...(options.fetch ? { fetch: options.fetch } : {}),
    bearerTokenProvider: () => bearerToken,
    expectedIdentity: { agentId: options.agentId, providerId: options.providerId },
    ...(options.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: options.requestTimeoutMs }),
  });
  const {
    endpoint: _endpoint,
    bearerToken: _configuredToken,
    fetch: _fetch,
    requestTimeoutMs: _requestTimeoutMs,
    ...adapterOptions
  } = options;
  return createA2ARemoteAgent({ ...adapterOptions, client });
}

/**
 * Initialize configured peers independently. A single unavailable remote must
 * remain an observable startup diagnostic without preventing healthy peers from
 * entering the trusted registry.
 */
export async function createConfiguredA2ARemoteAgents(
  options: readonly A2AConfiguredRemoteAgentOptions[],
): Promise<A2AConfiguredRemoteAgentBatchResult> {
  const outcomes = await Promise.all(options.map(async (entry) => {
    try {
      return { agent: await createConfiguredA2ARemoteAgent(entry) } as const;
    } catch (error) {
      const failure: A2AConfiguredRemoteAgentFailure = {
        agentId: safeFailureLabel(entry.agentId),
        providerId: safeFailureLabel(entry.providerId),
        ...(entry.kind === undefined ? {} : { kind: safeFailureLabel(entry.kind) }),
        code: remoteInitializationErrorCode(error),
      };
      return { failure } as const;
    }
  }));

  const agents: A2ARemoteProductionAgent[] = [];
  const failures: A2AConfiguredRemoteAgentFailure[] = [];
  for (const outcome of outcomes) {
    if ('agent' in outcome && outcome.agent) {
      agents.push(outcome.agent);
    } else {
      failures.push(outcome.failure);
    }
  }
  return Object.freeze({
    agents: Object.freeze(agents),
    failures: Object.freeze(failures),
  });
}

function remoteInitializationErrorCode(error: unknown): A2ARemoteClientErrorCode | 'CONFIGURATION_ERROR' {
  return error instanceof A2ARemoteClientError ? error.code : 'CONFIGURATION_ERROR';
}

function safeFailureLabel(value: string): string {
  const normalized = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(normalized) ? normalized : '[invalid]';
}
