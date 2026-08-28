import crypto from 'node:crypto';

import express, { type NextFunction, type Request, type Response } from 'express';

import {
  A2AContractError,
  serializeAgentCard,
  validateCursor,
  validateIdempotencyKey,
  validatePageLimit,
  validateSendRequest,
  type A2AAgentCard,
  type A2AScope,
  type A2ASendRequest,
  type A2ATask,
} from './a2a-contract.js';
import { deriveA2AHttpScope } from './a2a-http-scope.js';
import {
  A2AStore,
  A2AStoreConflictError,
} from './a2a-store.js';

export type A2ARouteOptions = {
  store: A2AStore;
  agentCard: A2AAgentCard;
  authenticate?: express.RequestHandler;
  resolveScope: (request: Request) => A2AScope | undefined;
  onTaskSubmitted?: (input: {
    task: A2ATask;
    request: A2ASendRequest;
    scope: A2AScope;
  }) => Promise<void> | void;
  onTaskCancel?: (input: {
    task: A2ATask;
    authenticatedScope: A2AScope;
  }) => Promise<A2ATask | undefined> | A2ATask | undefined;
};

class A2AUnauthorizedError extends Error {
  readonly code = 'A2A_AUTH_REQUIRED' as const;

  constructor() {
    super('Authenticated Teams scope is required.');
    this.name = 'A2AUnauthorizedError';
  }
}

class A2ANotFoundError extends Error {
  readonly code = 'A2A_NOT_FOUND' as const;

  constructor() {
    super('The requested A2A task was not found.');
    this.name = 'A2ANotFoundError';
  }
}

export function createA2ARouter(options: A2ARouteOptions): express.Router {
  const router = express.Router();

  router.get('/.well-known/agent-card.json', (_request, response) => {
    response.type('application/json').status(200).send(serializeAgentCard(options.agentCard));
  });

  if (options.authenticate) router.use(options.authenticate);
  router.use(express.json({ limit: '64kb', strict: true }));

  router.post(/^\/message:send$/, asyncHandler(async (request, response) => {
    const authenticatedScope = requireScope(options, request);
    const idempotencyKey = validateIdempotencyKey(request.body?.idempotencyKey);
    const scope = deriveA2AHttpScope(authenticatedScope, idempotencyKey);
    assertConversationHeaderMatchesScope(request, scope);
    const sendRequest = validateSendRequest(request.body, scope);
    if (sendRequest.message.role !== 'user') {
      throw new A2AContractError('InvalidRequestError', 'Core send requests must use the user message role.');
    }

    const fingerprint = hashCanonical({
      message: sendRequest.message,
      inputMode: sendRequest.inputMode,
      outputMode: sendRequest.outputMode,
      deadline: sendRequest.deadline,
      depth: sendRequest.depth,
      fanOutIndex: sendRequest.fanOutIndex,
    });
    const result = await options.store.createOrGetTaskResult({
      scope,
      contextId: sendRequest.message.contextId ?? `context-${sendRequest.message.messageId}`,
      message: sendRequest.message,
      idempotencyKey: sendRequest.idempotencyKey,
      fingerprint,
    });
    if (result.created) await options.onTaskSubmitted?.({ task: result.task, request: sendRequest, scope });
    response.status(202).json(result.task);
  }));

  router.get('/tasks', asyncHandler(async (request, response) => {
    const scope = requireScope(options, request);
    const limit = queryNumber(request, 'limit');
    const cursor = queryText(request, 'cursor');
    const result = options.store.listTasksForOwner(
      scope,
      limit === undefined ? undefined : validatePageLimit(limit),
      cursor === undefined ? undefined : validateCursor(cursor),
    );
    response.status(200).json(result);
  }));

  router.get('/tasks/:id', asyncHandler(async (request, response) => {
    const scope = requireScope(options, request);
    const taskId = request.params.id;
    if (typeof taskId !== 'string') throw new A2AContractError('InvalidRequestError', 'task id must be a single value.');
    const task = options.store.getTaskForOwner(taskId, scope);
    if (!task) throw new A2ANotFoundError();
    response.status(200).json(task);
  }));

  router.post(/^\/tasks\/([^/]+):cancel$/, asyncHandler(async (request, response) => {
    const authenticatedScope = requireScope(options, request);
    const taskId = request.params[0];
    const task = options.store.getTaskForOwner(taskId, authenticatedScope);
    if (!task) throw new A2ANotFoundError();
    const cancelled = options.onTaskCancel
      ? await options.onTaskCancel({ task, authenticatedScope })
      : await options.store.cancelTask(task.id, task.scope);
    response.status(200).json(cancelled ?? options.store.getTaskForOwner(task.id, authenticatedScope) ?? task);
  }));

  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    sendA2AError(response, error);
  });
  return router;
}

function requireScope(options: A2ARouteOptions, request: Request): A2AScope {
  const scope = options.resolveScope(request);
  if (!scope) throw new A2AUnauthorizedError();
  return scope;
}

function queryText(request: Request, name: string): string | undefined {
  const value = request.query[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new A2AContractError('InvalidRequestError', `${name} must be a single value.`);
  return value;
}

function assertConversationHeaderMatchesScope(request: Request, scope: A2AScope): void {
  const header = request.headers['x-conversation-id'];
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string' || !value.trim()) return;
  if (value.trim() !== scope.conversationId) {
    throw new A2AContractError('ScopeMismatchError', 'scope.conversationId does not match authenticated server scope.');
  }
}

function queryNumber(request: Request, name: string): number | undefined {
  const value = queryText(request, name);
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new A2AContractError('InvalidRequestError', `${name} must be a positive integer.`);
  return Number(value);
}

function sendA2AError(response: Response, error: unknown): void {
  if (error instanceof A2AUnauthorizedError) {
    response.status(401).json({ error: { name: error.name, code: error.code, message: error.message, retryable: false } });
    return;
  }
  if (error instanceof A2ANotFoundError) {
    response.status(404).json({ error: { name: error.name, code: error.code, message: error.message, retryable: false } });
    return;
  }
  if (error instanceof A2AStoreConflictError) {
    response.status(409).json({
      error: {
        name: error.name,
        code: error.code,
        message: 'The idempotency key is already bound to a different request.',
        retryable: false,
      },
    });
    return;
  }
  if (error instanceof A2AContractError) {
    const status = error.code === 'UnsupportedOperationError'
      || error.code === 'PushNotificationNotSupportedError'
      || error.code === 'ExtensionSupportRequiredError'
      ? 501
      : error.code === 'TerminalStateImmutableError' ? 409 : 400;
    response.status(status).json(error.toJSON());
    return;
  }
  if (isJsonParseError(error)) {
    response.status(400).json({
      error: {
        name: 'InvalidRequestError',
        code: 'InvalidRequestError',
        message: 'Request body must be valid JSON.',
        retryable: false,
      },
    });
    return;
  }
  response.status(500).json({
    error: {
      name: 'InternalError',
      code: 'InternalError',
      message: 'The A2A request could not be completed.',
      retryable: true,
    },
  });
}

function isJsonParseError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'type' in error && error.type === 'entity.parse.failed');
}

function asyncHandler(handler: (request: Request, response: Response) => Promise<void>): express.RequestHandler {
  return (request, response, next) => {
    void handler(request, response).catch(next);
  };
}

function hashCanonical(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value)), 'utf8').digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
  }
  return value;
}
