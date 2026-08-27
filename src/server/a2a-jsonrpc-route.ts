import crypto from 'node:crypto';

import express, { type NextFunction, type Request, type Response } from 'express';

import {
  A2AContractError,
  validateCursor,
  validatePageLimit,
  validateSendRequest,
  type A2AArtifactRef,
  type A2AJsonData,
  type A2AScope,
  type A2ASendRequest,
  type A2ATask,
} from './a2a-contract.js';
import { deriveA2AHttpScope } from './a2a-http-scope.js';
import { A2AStore, A2AStoreConflictError } from './a2a-store.js';

export type A2AV026AgentCardInput = {
  name: string;
  description: string;
  url: string;
  version: string;
  securitySchemes: Record<string, Record<string, unknown>>;
  security: Array<Record<string, string[]>>;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
  }>;
};

export type A2AV026Artifact = {
  artifactId: string;
  parts: Array<Record<string, unknown>>;
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  extensions?: string[];
};

export type A2AV026JsonRpcExecutionHooks = {
  submit: (input: {
    task: A2ATask;
    request: A2ASendRequest;
    scope: A2AScope;
  }) => Promise<void> | void;
  cancel: (input: {
    task: A2ATask;
    authenticatedScope: A2AScope;
  }) => Promise<A2ATask | undefined> | A2ATask | undefined;
};

export type A2AExistingExecutionAdapter = ((input: {
  task: A2ATask;
  request: A2ASendRequest;
  scope: A2AScope;
}) => Promise<void>) & {
  cancel: (input: { taskId: string; scope: A2AScope }) => Promise<A2ATask | undefined>;
};

export type A2AV026JsonRpcRouteOptions = {
  store: A2AStore;
  authenticate: express.RequestHandler;
  resolveScope: (request: Request) => A2AScope | undefined;
  execution: A2AV026JsonRpcExecutionHooks;
  mapArtifact?: (artifact: A2AArtifactRef, task: A2ATask) => Promise<A2AV026Artifact> | A2AV026Artifact;
};

export function adaptA2AV026Execution(execution: A2AExistingExecutionAdapter): A2AV026JsonRpcExecutionHooks {
  return {
    submit: (input) => execution(input),
    cancel: ({ task }) => execution.cancel({ taskId: task.id, scope: task.scope }),
  };
}

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  notification: boolean;
  method: string;
  params?: Record<string, unknown>;
};

class JsonRpcFault extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly httpStatus = 200,
  ) {
    super(message);
    this.name = 'JsonRpcFault';
  }
}

export function createA2AV026AgentCard(input: A2AV026AgentCardInput): Record<string, unknown> {
  let endpoint: URL;
  try {
    endpoint = new URL(input.url);
  } catch {
    throw new Error('Agent Card url must be an absolute HTTPS URL.');
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
    throw new Error('Agent Card url must be an absolute HTTPS URL.');
  }
  const securitySchemeNames = Object.keys(input.securitySchemes);
  if (securitySchemeNames.length === 0 || securitySchemeNames.length > 16 || input.security.length === 0 || input.security.length > 16) {
    throw new Error('Agent Card security declarations must be caller-provided and bounded.');
  }
  for (const requirement of input.security) {
    const names = Object.keys(requirement);
    if (names.length === 0 || names.some((name) => !securitySchemeNames.includes(name))) {
      throw new Error('Agent Card security requirements must reference declared security schemes.');
    }
  }
  if (input.skills.length === 0 || input.skills.length > 32) throw new Error('Agent Card skills must be a bounded non-empty array.');
  const securitySchemes = cloneBoundedJson(input.securitySchemes, 'securitySchemes');
  const security = input.security.map((requirement) => Object.fromEntries(
    Object.entries(requirement).map(([name, scopes]) => [
      boundedIdentifier(name, 'security scheme'),
      boundedStringArray(scopes, 'security scopes', 32, true),
    ]),
  ));
  return {
    protocolVersion: '0.2.6',
    name: boundedString(input.name, 'name', 200),
    description: boundedString(input.description, 'description', 1_000),
    url: endpoint.toString(),
    preferredTransport: 'JSONRPC',
    version: boundedString(input.version, 'version', 120),
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    securitySchemes,
    security,
    defaultInputModes: boundedStringArray(input.defaultInputModes, 'defaultInputModes', 16),
    defaultOutputModes: boundedStringArray(input.defaultOutputModes, 'defaultOutputModes', 16),
    skills: input.skills.map((skill) => ({
      id: boundedIdentifier(skill.id, 'skill.id'),
      name: boundedString(skill.name, 'skill.name', 200),
      description: boundedString(skill.description, 'skill.description', 1_000),
      tags: boundedStringArray(skill.tags, 'skill.tags', 32),
    })),
  };
}

export function createA2AV026JsonRpcRouter(options: A2AV026JsonRpcRouteOptions): express.Router {
  if (typeof options.authenticate !== 'function') {
    throw new Error('A2A JSON-RPC authenticate hook is required.');
  }
  const router = express.Router();
  router.use(options.authenticate);
  router.use((request, response, next) => {
    if (!request.is('application/json')) {
      sendJsonRpcError(response, null, -32600, 'Invalid JSON-RPC Request', 415);
      return;
    }
    next();
  });
  router.use(express.json({ limit: '64kb', strict: false, type: 'application/json' }));
  router.post('/', asyncHandler(async (request, response) => {
    let responseId: JsonRpcId = null;
    let notification = false;
    try {
      const rpc = validateJsonRpcRequest(request.body);
      responseId = rpc.id;
      notification = rpc.notification;
      const authenticatedScope = options.resolveScope(request);
      if (!authenticatedScope) throw new JsonRpcFault(-32603, 'Internal server error');

      if (rpc.method === 'tasks/get') {
        const params = requireRecord(rpc.params, 'params');
        assertExactKeys(params, ['id', 'historyLength'], 'params');
        validateUnsupportedHistoryLength(params.historyLength);
        const task = options.store.getTaskForOwner(requireOpaqueId(params.id, 'params.id'), authenticatedScope);
        if (!task) throw new JsonRpcFault(-32001, 'Task not found');
        sendJsonRpcResult(response, rpc, await mapTask(task, options));
        return;
      }

      if (rpc.method === 'tasks/cancel') {
        const params = requireRecord(rpc.params, 'params');
        assertExactKeys(params, ['id', 'metadata'], 'params');
        assertUnsupportedMetadata(params.metadata, 'params.metadata');
        const task = options.store.getTaskForOwner(requireOpaqueId(params.id, 'params.id'), authenticatedScope);
        if (!task) throw new JsonRpcFault(-32001, 'Task not found');
        if (task.status === 'completed' || task.status === 'failed' || task.status === 'rejected') {
          throw new JsonRpcFault(-32002, 'Task cannot be canceled');
        }
        if (task.status === 'canceled') {
          sendJsonRpcResult(response, rpc, await mapTask(task, options));
          return;
        }
        const cancelled = await options.execution.cancel({ task, authenticatedScope });
        const current = cancelled ?? options.store.getTaskForOwner(task.id, authenticatedScope);
        if (!current || current.status !== 'canceled') throw new JsonRpcFault(-32002, 'Task cannot be canceled');
        sendJsonRpcResult(response, rpc, await mapTask(current, options));
        return;
      }

      if (rpc.method !== 'message/send') throw new JsonRpcFault(-32601, 'Method not found');
      const params = requireRecord(rpc.params, 'params');
      assertExactKeys(params, ['message', 'configuration', 'metadata'], 'params');
      const graph = mapMessageSendMetadata(params.metadata);
      const configuration = validateMessageConfiguration(params.configuration);
      const message = requireRecord(params.message, 'params.message');
      assertExactKeys(message, [
        'kind', 'messageId', 'role', 'parts', 'contextId', 'taskId',
        'metadata', 'extensions', 'referenceTaskIds',
      ], 'params.message');
      if (message.kind !== 'message') throw new A2AContractError('InvalidRequestError', 'message.kind must be message.');
      if (message.role !== 'user') throw new A2AContractError('InvalidRequestError', 'message.role must be user.');
      if (hasNonEmptyArray(message.extensions) || hasNonEmptyArray(message.referenceTaskIds)) {
        throw new A2AContractError('UnsupportedOperationError', 'Message extensions are not supported.');
      }
      assertOptionalEmptyArray(message.extensions, 'message.extensions');
      assertOptionalEmptyArray(message.referenceTaskIds, 'message.referenceTaskIds');
      const messageId = requireOpaqueId(message.messageId, 'message.messageId');
      const requestedTaskId = message.taskId === undefined
        ? undefined
        : requireOpaqueId(message.taskId, 'params.message.taskId');
      const continuationTask = requestedTaskId === undefined
        ? undefined
        : options.store.getTaskForOwner(requestedTaskId, authenticatedScope);
      if (requestedTaskId !== undefined && !continuationTask) {
        throw new JsonRpcFault(-32001, 'Task not found');
      }
      if (continuationTask && (
        continuationTask.status === 'completed'
        || continuationTask.status === 'failed'
        || continuationTask.status === 'canceled'
        || continuationTask.status === 'rejected'
      )) {
        throw new JsonRpcFault(-32002, 'Task cannot be restarted');
      }
      if (continuationTask && message.contextId !== undefined && message.contextId !== continuationTask.contextId) {
        throw new A2AContractError('InvalidRequestError', 'message.contextId must match the existing task contextId.');
      }
      const mapped = mapMessageParts(message.parts);
      const idempotencyKey = `v026-${sha256(messageId).slice(0, 64)}`;
      const scope = continuationTask?.scope ?? deriveA2AHttpScope(authenticatedScope, idempotencyKey);
      const sendRequest = validateSendRequest({
        idempotencyKey,
        inputMode: mapped.inputMode,
        outputMode: configuration.outputMode,
        ...graph,
        message: {
          messageId,
          role: 'user',
          parts: mapped.parts,
          ...(continuationTask
            ? { contextId: continuationTask.contextId, taskId: continuationTask.id }
            : message.contextId === undefined ? {} : { contextId: message.contextId }),
          ...(message.metadata === undefined ? {} : { metadata: message.metadata }),
        },
      }, scope);
      if (continuationTask) {
        await options.execution.submit({ task: continuationTask, request: sendRequest, scope });
        const current = options.store.getTaskForOwner(continuationTask.id, authenticatedScope) ?? continuationTask;
        sendJsonRpcResult(response, rpc, await mapTask(current, options));
        return;
      }
      const contextId = sendRequest.message.contextId ?? `context-v026-${sha256(messageId).slice(0, 32)}`;
      const result = await options.store.createOrGetTaskResult({
        scope,
        contextId,
        message: sendRequest.message,
        idempotencyKey,
        fingerprint: sha256(JSON.stringify(canonicalize(sendRequest))),
      });
      if (result.created) await options.execution.submit({ task: result.task, request: sendRequest, scope });
      sendJsonRpcResult(response, rpc, await mapTask(result.task, options));
    } catch (error) {
      if (!response.headersSent) {
        if (notification) response.status(204).end();
        else sendMappedJsonRpcError(response, responseId, error);
      }
    }
  }));
  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (isJsonParseError(error)) {
      sendJsonRpcError(response, null, -32700, 'Invalid JSON payload', 400);
      return;
    }
    if (isBodyTooLargeError(error)) {
      sendJsonRpcError(response, null, -32600, 'Invalid JSON-RPC Request', 413);
      return;
    }
    sendMappedJsonRpcError(response, null, error);
  });
  return router;
}

/**
 * Current A2A JSON-RPC binding. The v0.2.6 adapter above is intentionally kept
 * unchanged for existing clients; this route speaks the current PascalCase
 * method names and the current Agent Card data model.
 */
export function createA2AV1JsonRpcRouter(options: A2AV026JsonRpcRouteOptions): express.Router {
  if (typeof options.authenticate !== 'function') {
    throw new Error('A2A JSON-RPC authenticate hook is required.');
  }
  const router = express.Router();
  router.use(options.authenticate);
  router.use((request, response, next) => {
    if (!request.is('application/json')) {
      sendJsonRpcError(response, null, -32600, 'Request payload validation error', 415);
      return;
    }
    next();
  });
  router.use(express.json({ limit: '64kb', strict: false, type: 'application/json' }));
  router.post('/', asyncHandler(async (request, response) => {
    let responseId: JsonRpcId = null;
    let notification = false;
    try {
      const rpc = validateJsonRpcRequest(request.body);
      responseId = rpc.id;
      notification = rpc.notification;
      if (request.header('a2a-version') !== '1.0') {
        throw new JsonRpcFault(-32007, 'A2A protocol version 1.0 is required.');
      }
      const authenticatedScope = options.resolveScope(request);
      if (!authenticatedScope) throw new JsonRpcFault(-32603, 'Internal error');

      if (rpc.method === 'SendMessage') {
        const normalized = normalizeA2AV1SendParams(rpc.params);
        const idempotencyKey = `v1-${sha256(normalized.message.messageId).slice(0, 64)}`;
        const requestedTaskId = normalized.message.taskId;
        const continuationTask = requestedTaskId === undefined
          ? undefined
          : options.store.getTaskForOwner(requestedTaskId, authenticatedScope);
        if (requestedTaskId !== undefined && !continuationTask) {
          throw new JsonRpcFault(-32001, 'Task not found');
        }
        if (continuationTask && (
          continuationTask.status === 'completed'
          || continuationTask.status === 'failed'
          || continuationTask.status === 'canceled'
          || continuationTask.status === 'rejected'
        )) {
          throw new JsonRpcFault(-32002, 'Task cannot be restarted');
        }
        if (continuationTask && normalized.message.contextId !== undefined && normalized.message.contextId !== continuationTask.contextId) {
          throw new A2AContractError('InvalidRequestError', 'message.contextId must match the existing task contextId.');
        }
        const scope = continuationTask?.scope ?? deriveA2AHttpScope(authenticatedScope, idempotencyKey);
        const sendRequest = validateSendRequest({
          idempotencyKey,
          inputMode: normalized.inputMode,
          outputMode: normalized.outputMode,
          message: normalized.message,
        }, scope);
        if (continuationTask) {
          await options.execution.submit({ task: continuationTask, request: sendRequest, scope });
          const current = options.store.getTaskForOwner(continuationTask.id, authenticatedScope) ?? continuationTask;
          sendJsonRpcResult(response, rpc, { task: mapA2AV1Task(current) });
          return;
        }
        const contextId = sendRequest.message.contextId ?? `context-v1-${sha256(normalized.message.messageId).slice(0, 32)}`;
        const result = await options.store.createOrGetTaskResult({
          scope,
          contextId,
          message: sendRequest.message,
          idempotencyKey,
          fingerprint: sha256(JSON.stringify(canonicalize(sendRequest))),
        });
        if (result.created) await options.execution.submit({ task: result.task, request: sendRequest, scope });
        sendJsonRpcResult(response, rpc, { task: mapA2AV1Task(result.task) });
        return;
      }

      if (rpc.method === 'GetTask') {
        const params = requireRecord(rpc.params, 'params');
        assertExactKeys(params, ['tenant', 'id', 'historyLength'], 'params');
        assertUnsupportedTenant(params.tenant);
        validateUnsupportedHistoryLength(params.historyLength);
        const task = options.store.getTaskForOwner(requireOpaqueId(params.id, 'params.id'), authenticatedScope);
        if (!task) throw new JsonRpcFault(-32001, 'Task not found');
        sendJsonRpcResult(response, rpc, mapA2AV1Task(task));
        return;
      }

      if (rpc.method === 'ListTasks') {
        const params = rpc.params === undefined ? {} : requireRecord(rpc.params, 'params');
        assertExactKeys(params, [
          'tenant', 'contextId', 'status', 'pageSize', 'pageToken', 'historyLength',
          'includeArtifacts',
        ], 'params');
        assertUnsupportedTenant(params.tenant);
        validateUnsupportedHistoryLength(params.historyLength);
        const includeArtifacts = params.includeArtifacts === undefined
          ? false
          : requireBoolean(params.includeArtifacts, 'params.includeArtifacts');
        const pageSize = params.pageSize === undefined ? 20 : validatePageLimit(params.pageSize);
        const pageToken = params.pageToken === undefined ? undefined : validateCursor(params.pageToken);
        const contextId = params.contextId === undefined ? undefined : requireOpaqueId(params.contextId, 'params.contextId');
        const status = params.status === undefined ? undefined : mapA2AV1TaskState(params.status);
        const listed = options.store.listTasksForOwner(authenticatedScope, pageSize, pageToken, { contextId, status });
        sendJsonRpcResult(response, rpc, {
          tasks: listed.tasks.map((task) => mapA2AV1Task(task, includeArtifacts)),
          pageSize,
          nextPageToken: listed.nextCursor ?? '',
          totalSize: listed.totalSize,
        });
        return;
      }

      if (rpc.method === 'CancelTask') {
        const params = requireRecord(rpc.params, 'params');
        assertExactKeys(params, ['tenant', 'id'], 'params');
        assertUnsupportedTenant(params.tenant);
        const task = options.store.getTaskForOwner(requireOpaqueId(params.id, 'params.id'), authenticatedScope);
        if (!task) throw new JsonRpcFault(-32001, 'Task not found');
        if (task.status === 'completed' || task.status === 'failed' || task.status === 'rejected') {
          throw new JsonRpcFault(-32002, 'Task cannot be canceled');
        }
        if (task.status === 'canceled') {
          sendJsonRpcResult(response, rpc, mapA2AV1Task(task));
          return;
        }
        const cancelled = await options.execution.cancel({ task, authenticatedScope });
        const current = cancelled ?? options.store.getTaskForOwner(task.id, authenticatedScope);
        if (!current || current.status !== 'canceled') throw new JsonRpcFault(-32002, 'Task cannot be canceled');
        sendJsonRpcResult(response, rpc, mapA2AV1Task(current));
        return;
      }

      throw new JsonRpcFault(-32601, 'Method not found');
    } catch (error) {
      if (!response.headersSent) {
        if (notification) response.status(204).end();
        else sendA2AV1JsonRpcError(response, responseId, error);
      }
    }
  }));
  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (isJsonParseError(error)) {
      sendJsonRpcError(response, null, -32700, 'Invalid JSON payload', 400);
      return;
    }
    if (isBodyTooLargeError(error)) {
      sendJsonRpcError(response, null, -32600, 'Request payload validation error', 413);
      return;
    }
    sendA2AV1JsonRpcError(response, null, error);
  });
  return router;
}

function normalizeA2AV1SendParams(value: unknown): {
  message: A2ASendRequest['message'];
  inputMode: 'text/plain' | 'application/json';
  outputMode: 'text/plain';
} {
  const params = requireRecord(value, 'params');
  assertExactKeys(params, ['tenant', 'message', 'configuration', 'metadata'], 'params');
  assertUnsupportedTenant(params.tenant);
  if (params.metadata !== undefined) cloneBoundedJson(params.metadata, 'params.metadata');
  const message = requireRecord(params.message, 'params.message');
  assertExactKeys(message, [
    'messageId', 'role', 'parts', 'contextId', 'taskId', 'metadata', 'referenceTaskIds', 'extensions',
  ], 'params.message');
  if (message.role !== 'ROLE_USER') throw new A2AContractError('InvalidRequestError', 'message.role must be ROLE_USER.');
  if (hasNonEmptyArray(message.extensions) || hasNonEmptyArray(message.referenceTaskIds)) {
    throw new A2AContractError('UnsupportedOperationError', 'Message extensions and referenceTaskIds are not supported.');
  }
  assertOptionalEmptyArray(message.extensions, 'message.extensions');
  assertOptionalEmptyArray(message.referenceTaskIds, 'message.referenceTaskIds');
  const mappedParts = mapA2AV1Parts(message.parts);
  const configuration = validateA2AV1Configuration(params.configuration);
  return {
    message: {
      messageId: requireOpaqueId(message.messageId, 'params.message.messageId'),
      role: 'user',
      parts: mappedParts.parts,
      ...(message.contextId === undefined ? {} : { contextId: requireOpaqueId(message.contextId, 'params.message.contextId') }),
      ...(message.taskId === undefined ? {} : { taskId: requireOpaqueId(message.taskId, 'params.message.taskId') }),
      ...(message.metadata === undefined ? {} : { metadata: message.metadata as Record<string, unknown> }),
    },
    inputMode: mappedParts.inputMode,
    outputMode: configuration.outputMode,
  };
}

function mapA2AV1Parts(value: unknown): {
  parts: Array<{ text: string; metadata?: Record<string, unknown> } | { data: A2AJsonData; mediaType: 'application/json'; metadata?: Record<string, unknown> }>;
  inputMode: 'text/plain' | 'application/json';
} {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) {
    throw new A2AContractError('InvalidRequestError', 'params.message.parts must be a bounded non-empty array.');
  }
  const kinds = new Set<string>();
  const parts = value.map((entry) => {
    const part = requireRecord(entry, 'params.message.part');
    assertExactKeys(part, ['text', 'raw', 'url', 'data', 'metadata', 'filename', 'mediaType'], 'params.message.part');
    const hasText = Object.prototype.hasOwnProperty.call(part, 'text');
    const hasData = Object.prototype.hasOwnProperty.call(part, 'data');
    if (hasText === hasData) throw new A2AContractError('InvalidPartError', 'A Part must contain exactly one supported payload.');
    if (part.raw !== undefined || part.url !== undefined) {
      throw new A2AContractError('ContentTypeNotSupportedError', 'Core accepts text and structured JSON Parts only.');
    }
    const metadata = part.metadata === undefined ? undefined : cloneBoundedJson(requireRecord(part.metadata, 'params.message.part.metadata'), 'params.message.part.metadata');
    if (hasText) {
      if (part.mediaType !== undefined && part.mediaType !== 'text/plain') {
        throw new A2AContractError('ContentTypeNotSupportedError', 'Only text/plain Parts are supported.');
      }
      kinds.add('text');
      return { text: part.text as string, ...(metadata ? { metadata } : {}) };
    }
    if (part.mediaType !== 'application/json') {
      throw new A2AContractError('ContentTypeNotSupportedError', 'Structured Parts require application/json.');
    }
    if (part.data === undefined || ['function', 'symbol', 'bigint'].includes(typeof part.data)) {
      throw new A2AContractError('InvalidPartError', 'Structured Part data must be a JSON value.');
    }
    kinds.add('data');
    return { data: part.data as A2AJsonData, mediaType: 'application/json' as const, ...(metadata ? { metadata } : {}) };
  });
  if (kinds.size !== 1) throw new A2AContractError('UnsupportedOperationError', 'Mixed input modes are not supported.');
  return { parts, inputMode: kinds.has('data') ? 'application/json' : 'text/plain' };
}

function validateA2AV1Configuration(value: unknown): { outputMode: 'text/plain' } {
  if (value === undefined) return { outputMode: 'text/plain' };
  const configuration = requireRecord(value, 'params.configuration');
  assertExactKeys(configuration, ['acceptedOutputModes', 'historyLength', 'taskPushNotificationConfig'], 'params.configuration');
  if (configuration.taskPushNotificationConfig !== undefined) {
    throw new A2AContractError('PushNotificationNotSupportedError', 'Push notifications are not supported.');
  }
  validateUnsupportedHistoryLength(configuration.historyLength);
  const modes = configuration.acceptedOutputModes;
  if (modes === undefined) return { outputMode: 'text/plain' };
  if (!Array.isArray(modes) || modes.length !== 1 || modes[0] !== 'text/plain') {
    throw new A2AContractError('ContentTypeNotSupportedError', 'Only text/plain output is supported.');
  }
  return { outputMode: 'text/plain' };
}

function assertUnsupportedTenant(value: unknown): void {
  if (value !== undefined && value !== '') {
    throw new A2AContractError('UnsupportedOperationError', 'Tenant routing is not configured for this interface.');
  }
}

function mapA2AV1TaskState(value: unknown): A2ATask['status'] {
  const mapping: Record<string, A2ATask['status']> = {
    TASK_STATE_SUBMITTED: 'submitted',
    TASK_STATE_WORKING: 'working',
    TASK_STATE_INPUT_REQUIRED: 'input-required',
    TASK_STATE_AUTH_REQUIRED: 'auth-required',
    TASK_STATE_COMPLETED: 'completed',
    TASK_STATE_FAILED: 'failed',
    TASK_STATE_CANCELED: 'canceled',
    TASK_STATE_REJECTED: 'rejected',
  };
  if (typeof value !== 'string' || !mapping[value]) {
    throw new A2AContractError('InvalidRequestError', 'params.status is invalid.');
  }
  return mapping[value];
}

function mapA2AV1Task(task: A2ATask, includeArtifacts = true): Record<string, unknown> {
  return {
    id: task.id,
    contextId: task.contextId,
    status: {
      state: `TASK_STATE_${task.status.replace('-', '_').toUpperCase()}`,
      ...(task.error === undefined ? {} : {
        message: {
          role: 'ROLE_AGENT',
          parts: [{ text: task.error, mediaType: 'text/plain' }],
        },
      }),
    },
    ...(!includeArtifacts || task.artifacts.length === 0 ? {} : {
      artifacts: task.artifacts.map((artifact) => ({
        artifactId: artifact.artifactId,
        name: artifact.name,
        parts: [artifact.content
          ? { text: artifact.content.text, mediaType: artifact.content.mediaType }
          : { data: { sha256: artifact.sha256, byteSize: artifact.byteSize, mediaType: artifact.mediaType }, mediaType: 'application/json' }],
        ...(artifact.metadata === undefined ? {} : { metadata: artifact.metadata }),
      })),
    }),
  };
}

function sendA2AV1JsonRpcError(response: Response, id: JsonRpcId, error: unknown): void {
  if (error instanceof JsonRpcFault) {
    sendJsonRpcError(response, error.code === -32600 ? null : id, error.code, error.message, error.httpStatus);
    return;
  }
  if (error instanceof A2AContractError) {
    if (error.code === 'ContentTypeNotSupportedError') {
      sendJsonRpcError(response, id, -32005, 'Incompatible content types');
      return;
    }
    if (error.code === 'UnsupportedOperationError' || error.code === 'ExtensionSupportRequiredError') {
      sendJsonRpcError(response, id, -32004, 'This operation is not supported');
      return;
    }
    if (error.code === 'PushNotificationNotSupportedError') {
      sendJsonRpcError(response, id, -32003, 'Push Notification is not supported');
      return;
    }
    sendJsonRpcError(response, id, -32602, 'Invalid parameters');
    return;
  }
  if (error instanceof A2AStoreConflictError) {
    sendJsonRpcError(response, id, -32602, 'Invalid parameters');
    return;
  }
  sendJsonRpcError(response, id, -32603, 'Internal error');
}

function validateJsonRpcRequest(value: unknown): JsonRpcRequest {
  try {
    const request = requireRecord(value, 'request');
    assertExactKeys(request, ['jsonrpc', 'id', 'method', 'params'], 'request');
    if (request.jsonrpc !== '2.0') throw new Error('invalid jsonrpc');
    const notification = !Object.prototype.hasOwnProperty.call(request, 'id');
    const id = notification ? null : validateJsonRpcId(request.id);
    if (typeof request.method !== 'string' || !request.method || request.method.length > 100) {
      throw new Error('invalid method');
    }
    return {
      jsonrpc: '2.0',
      id,
      notification,
      method: request.method,
      ...(request.params === undefined ? {} : { params: requireRecord(request.params, 'params') }),
    };
  } catch {
    throw new JsonRpcFault(-32600, 'Invalid JSON-RPC Request', 400);
  }
}

function validateJsonRpcId(value: unknown): JsonRpcId {
  if (value === null) return null;
  if (typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f-\u009f]/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  throw new A2AContractError('InvalidRequestError', 'id is invalid.');
}

function mapMessageParts(value: unknown): {
  parts: Array<Record<string, unknown>>;
  inputMode: 'text/plain' | 'application/json';
} {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) {
    throw new A2AContractError('InvalidRequestError', 'message.parts must be a bounded non-empty array.');
  }
  const kinds = new Set<string>();
  const parts = value.map((entry) => {
    const part = requireRecord(entry, 'message.part');
    if (part.kind === 'text') {
      kinds.add('text');
      assertExactKeys(part, ['kind', 'text', 'metadata'], 'message.part');
      return { text: part.text, ...(part.metadata === undefined ? {} : { metadata: part.metadata }) };
    }
    if (part.kind === 'data') {
      kinds.add('data');
      assertExactKeys(part, ['kind', 'data', 'metadata'], 'message.part');
      return { data: requireRecord(part.data, 'message.part.data'), mediaType: 'application/json', ...(part.metadata === undefined ? {} : { metadata: part.metadata }) };
    }
    if (part.kind === 'file') {
      throw new A2AContractError('ContentTypeNotSupportedError', 'Only text and data parts are supported.');
    }
    throw new A2AContractError('ContentTypeNotSupportedError', 'Only text and data parts are supported.');
  });
  if (kinds.size !== 1) throw new A2AContractError('UnsupportedOperationError', 'Mixed input modes are not supported.');
  return { parts, inputMode: kinds.has('data') ? 'application/json' : 'text/plain' };
}

function validateMessageConfiguration(value: unknown): { outputMode: 'text/plain' | 'application/json' } {
  if (value === undefined) return { outputMode: 'text/plain' };
  const configuration = requireRecord(value, 'params.configuration');
  assertExactKeys(configuration, ['acceptedOutputModes', 'historyLength', 'pushNotificationConfig', 'blocking'], 'params.configuration');
  if (configuration.pushNotificationConfig !== undefined) {
    throw new A2AContractError('PushNotificationNotSupportedError', 'Push notifications are not supported.');
  }
  if (configuration.blocking !== undefined && typeof configuration.blocking !== 'boolean') {
    throw new A2AContractError('InvalidRequestError', 'configuration.blocking must be boolean.');
  }
  if (configuration.blocking === true) throw new A2AContractError('UnsupportedOperationError', 'Blocking is not supported.');
  validateUnsupportedHistoryLength(configuration.historyLength);
  const modes = configuration.acceptedOutputModes;
  if (modes === undefined) return { outputMode: 'text/plain' };
  if (!Array.isArray(modes) || modes.length !== 1 || typeof modes[0] !== 'string') {
    throw new A2AContractError('UnsupportedOperationError', 'Exactly one accepted output mode is supported.');
  }
  if (modes[0] !== 'text/plain') {
    throw new A2AContractError('ContentTypeNotSupportedError', 'The accepted output mode is not supported.');
  }
  return { outputMode: modes[0] };
}

function assertUnsupportedMetadata(value: unknown, field: string): void {
  if (value === undefined) return;
  const metadata = requireRecord(value, field);
  if (Object.keys(metadata).length > 0) {
    throw new A2AContractError('UnsupportedOperationError', `${field} cannot be represented by the Core request model.`);
  }
}

function mapMessageSendMetadata(value: unknown): { depth: number; fanOutIndex: number } {
  if (value === undefined) return { depth: 0, fanOutIndex: 0 };
  const metadata = requireRecord(value, 'params.metadata');
  const keys = Object.keys(metadata);
  if (keys.length === 0 || keys.every((key) => key === 'depth' || key === 'fanOutIndex')) {
    return mapGraphMetadata(metadata);
  }
  // MessageSendParams.metadata is protocol extension data. Bound it independently
  // and never let a mixed protocol map change the internal graph budget.
  cloneBoundedJson(metadata, 'params.metadata');
  return { depth: 0, fanOutIndex: 0 };
}

function mapGraphMetadata(value: unknown): { depth: number; fanOutIndex: number } {
  if (value === undefined) return { depth: 0, fanOutIndex: 0 };
  const metadata = requireRecord(value, 'params.metadata');
  assertExactKeys(metadata, ['depth', 'fanOutIndex'], 'params.metadata');
  return {
    depth: metadata.depth ?? 0,
    fanOutIndex: metadata.fanOutIndex ?? 0,
  } as { depth: number; fanOutIndex: number };
}

function validateUnsupportedHistoryLength(value: unknown): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 100) {
    throw new A2AContractError('InvalidRequestError', 'historyLength must be a bounded non-negative integer.');
  }
  if (value !== 0) throw new A2AContractError('UnsupportedOperationError', 'History retrieval is not supported.');
}

function hasNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function assertOptionalEmptyArray(value: unknown, field: string): void {
  if (value !== undefined && (!Array.isArray(value) || value.length !== 0)) {
    throw new A2AContractError('InvalidRequestError', `${field} must be an empty array when supplied.`);
  }
}

async function mapTask(task: A2ATask, options: A2AV026JsonRpcRouteOptions): Promise<Record<string, unknown>> {
  const artifacts = await Promise.all(task.artifacts.map(async (artifact) => {
    if (!options.mapArtifact) throw new A2AContractError('InvalidTaskError', 'Artifact content adapter is required.');
    return validateMappedArtifact(await options.mapArtifact(artifact, task), artifact);
  }));
  return {
    id: task.id,
    contextId: task.contextId,
    status: { state: task.status },
    ...(artifacts.length === 0 ? {} : { artifacts }),
    kind: 'task',
  };
}

function validateMappedArtifact(value: unknown, source: A2AArtifactRef): A2AV026Artifact {
  const artifact = requireRecord(value, 'mapped artifact');
  assertExactKeys(artifact, ['artifactId', 'parts', 'name', 'description', 'metadata', 'extensions'], 'mapped artifact');
  const artifactId = requireOpaqueId(artifact.artifactId, 'mapped artifact.artifactId');
  if (artifactId !== source.artifactId) {
    throw new A2AContractError('InvalidTaskError', 'Mapped artifact identity must match the stored artifact reference.');
  }
  if (artifact.extensions !== undefined && (!Array.isArray(artifact.extensions) || artifact.extensions.length !== 0)) {
    throw new A2AContractError('InvalidTaskError', 'Mapped artifact extensions are not supported.');
  }
  if (!Array.isArray(artifact.parts) || artifact.parts.length === 0 || artifact.parts.length > 16) {
    throw new A2AContractError('InvalidTaskError', 'Mapped artifact parts must be a bounded non-empty array.');
  }
  const parts = artifact.parts.map((entry) => validateMappedArtifactPart(entry));
  return {
    artifactId,
    parts,
    ...(artifact.name === undefined ? {} : { name: mappedArtifactText(artifact.name, 'mapped artifact.name', 256) }),
    ...(artifact.description === undefined ? {} : { description: mappedArtifactText(artifact.description, 'mapped artifact.description', 1_000) }),
    ...(artifact.metadata === undefined ? {} : { metadata: mappedArtifactMetadata(artifact.metadata) }),
  };
}

function validateMappedArtifactPart(value: unknown): Record<string, unknown> {
  const part = requireRecord(value, 'mapped artifact part');
  if (part.kind === 'text') {
    assertExactKeys(part, ['kind', 'text', 'metadata'], 'mapped artifact part');
    return {
      kind: 'text',
      text: mappedArtifactText(part.text, 'mapped artifact part.text', 16_000),
      ...(part.metadata === undefined ? {} : { metadata: mappedArtifactMetadata(part.metadata) }),
    };
  }
  if (part.kind === 'data') {
    assertExactKeys(part, ['kind', 'data', 'metadata'], 'mapped artifact part');
    return {
      kind: 'data',
      data: cloneBoundedJson(requireRecord(part.data, 'mapped artifact part.data'), 'mapped artifact part.data'),
      ...(part.metadata === undefined ? {} : { metadata: mappedArtifactMetadata(part.metadata) }),
    };
  }
  throw new A2AContractError('InvalidTaskError', 'Mapped artifact part kind is not supported.');
}

function mappedArtifactText(value: unknown, field: string, maxLength: number): string {
  try {
    return boundedString(value, field, maxLength);
  } catch {
    throw new A2AContractError('InvalidTaskError', `${field} is outside the allowed bounds.`);
  }
}

function mappedArtifactMetadata(value: unknown): Record<string, unknown> {
  try {
    return cloneBoundedJson(requireRecord(value, 'mapped artifact metadata'), 'mapped artifact metadata');
  } catch {
    throw new A2AContractError('InvalidTaskError', 'Mapped artifact metadata is invalid.');
  }
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new A2AContractError('InvalidRequestError', `${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new A2AContractError('InvalidRequestError', `${field} must be boolean.`);
  return value;
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new A2AContractError('InvalidRequestError', `${field}.${key} is not supported.`);
  }
}

function requireOpaqueId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) {
    throw new A2AContractError('InvalidRequestError', `${field} is invalid.`);
  }
  return value;
}

function boundedIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) {
    throw new Error(`${field} must be a bounded identifier.`);
  }
  return value;
}

function boundedString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || /[\u0000-\u001f\u007f-\u009f]/.test(value)) {
    throw new Error(`${field} must be a bounded non-empty string.`);
  }
  return value;
}

function boundedStringArray(value: unknown, field: string, maxItems: number, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > maxItems) {
    throw new Error(`${field} must be a bounded non-empty array.`);
  }
  return value.map((entry) => boundedString(entry, field, 200));
}

function cloneBoundedJson<T>(value: T, field: string): T {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(`${field} must be JSON serializable.`);
  }
  if (!serialized || Buffer.byteLength(serialized, 'utf8') > 16_000) {
    throw new Error(`${field} exceeds the JSON size limit.`);
  }
  return JSON.parse(serialized) as T;
}

function sendMappedJsonRpcError(response: Response, id: JsonRpcId, error: unknown): void {
  if (error instanceof JsonRpcFault) {
    sendJsonRpcError(response, error.code === -32600 ? null : id, error.code, error.message, error.httpStatus);
    return;
  }
  if (error instanceof A2AContractError) {
    if (error.code === 'ContentTypeNotSupportedError') {
      sendJsonRpcError(response, id, -32005, 'Incompatible content types');
      return;
    }
    if (error.code === 'UnsupportedOperationError' || error.code === 'ExtensionSupportRequiredError') {
      sendJsonRpcError(response, id, -32004, 'This operation is not supported');
      return;
    }
    if (error.code === 'PushNotificationNotSupportedError') {
      sendJsonRpcError(response, id, -32003, 'Push Notification is not supported');
      return;
    }
    if (error.code === 'InvalidTaskError' || error.code === 'InvalidArtifactRefError') {
      sendJsonRpcError(response, id, -32006, 'Invalid agent response type');
      return;
    }
    sendJsonRpcError(response, id, -32602, 'Invalid method parameters');
    return;
  }
  if (error instanceof A2AStoreConflictError) {
    sendJsonRpcError(response, id, -32602, 'Invalid method parameters');
    return;
  }
  sendJsonRpcError(response, id, -32603, 'Internal server error');
}

function sendJsonRpcResult(response: Response, request: JsonRpcRequest, result: unknown): void {
  if (request.notification) {
    response.status(204).end();
    return;
  }
  response.status(200).json({ jsonrpc: '2.0', id: request.id, result });
}

function sendJsonRpcError(response: Response, id: JsonRpcId, code: number, message: string, status = 200): void {
  response.status(status).json({ jsonrpc: '2.0', id, error: { code, message } });
}

function isJsonParseError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'type' in error && error.type === 'entity.parse.failed');
}

function isBodyTooLargeError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large');
}

function asyncHandler(handler: (request: Request, response: Response) => Promise<void>): express.RequestHandler {
  return (request, response, next) => { void handler(request, response).catch(next); };
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
  }
  return value;
}
