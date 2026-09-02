import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';

import { AgentCapacityError } from './agent-admission-controller.js';
import { AgentExecutionUnavailableError } from './agent-execution-policy.js';
import {
  AgentJobConflictError,
  AgentMutationAuthorizationError,
  AgentProviderUnavailableError,
} from './agent-service.js';
import {
  createServerDerivedCoreScope,
  type CoreOrchestrationService,
  type ServerDerivedCoreScope,
} from './core-orchestration-service.js';
import type { AgentJobScope } from './agent-job-store.js';
import {
  CoreOrchestrationIdempotencyConflictError,
  CoreOrchestrationValidationError,
  type CoreJobRequest,
  type CoreListRequest,
  type CoreOrchestrationJob,
  type CoreProvideInputRequest,
  type CoreSubmitRequest,
} from '../shared/core-orchestration.js';

export type CoreOrchestrationRouteService = Pick<CoreOrchestrationService,
  | 'submit'
  | 'get'
  | 'list'
  | 'cancel'
  | 'approve'
  | 'retry'
  | 'provideInput'
  | 'listProviderFacts'
>;

export type CoreOrchestrationRouteOptions = Readonly<{
  service: CoreOrchestrationRouteService;
  authenticate: RequestHandler;
  /** Resolves identity only from server-validated request state, never request body/query values. */
  resolveAuthenticatedScope: (request: Request, response: Response) => AgentJobScope | undefined;
}>;

export const CORE_ORCHESTRATION_API_BASE_PATH = '/api/core-orchestration' as const;

export function mountCoreOrchestrationRoutes(
  app: Pick<express.Application, 'use'>,
  options: CoreOrchestrationRouteOptions,
): void {
  app.use(CORE_ORCHESTRATION_API_BASE_PATH, createCoreOrchestrationRouter(options));
}

class CoreOrchestrationUnauthorizedError extends Error {
  readonly code = 'CORE_ORCHESTRATION_AUTH_REQUIRED' as const;

  constructor() {
    super('Authenticated Teams scope is required.');
    this.name = 'CoreOrchestrationUnauthorizedError';
  }
}

class CoreOrchestrationNotFoundError extends Error {
  readonly code = 'CORE_ORCHESTRATION_NOT_FOUND' as const;

  constructor() {
    super('The requested orchestration job was not found.');
    this.name = 'CoreOrchestrationNotFoundError';
  }
}

export function createCoreOrchestrationRouter(options: CoreOrchestrationRouteOptions): express.Router {
  const router = express.Router();

  router.use(options.authenticate);
  router.use(express.json({ limit: '64kb', strict: true }));

  router.post('/jobs', asyncHandler(async (request, response) => {
    const result = await options.service.submit(scopeFor(options, request, response), submitRequest(request.body));
    response.set('Cache-Control', 'no-store').status(result.replayed ? 200 : 201).json(result);
  }));

  router.get('/jobs', asyncHandler(async (request, response) => {
    const jobs = options.service.list(scopeFor(options, request, response), listRequest(request));
    response.set('Cache-Control', 'no-store').status(200).json({
      jobs,
      providers: options.service.listProviderFacts(),
    });
  }));

  router.get('/jobs/:jobId', asyncHandler(async (request, response) => {
    assertNoQuery(request);
    const job = options.service.get(scopeFor(options, request, response), jobRequest(request));
    response.set('Cache-Control', 'no-store').status(200).json({ job: requireJob(job) });
  }));

  for (const action of ['cancel', 'approve', 'retry'] as const) {
    router.post(`/jobs/:jobId/${action}`, asyncHandler(async (request, response) => {
      emptyBody(request.body);
      assertNoQuery(request);
      const scope = scopeFor(options, request, response);
      const input = jobRequest(request);
      const job = await options.service[action](scope, input);
      response.set('Cache-Control', 'no-store').status(200).json({ job: requireJob(job) });
    }));
  }

  router.post('/jobs/:jobId/input', asyncHandler(async (request, response) => {
    assertNoQuery(request);
    const result = await options.service.provideInput(
      scopeFor(options, request, response),
      provideInputRequest(request, request.body),
    );
    if (!result) throw new CoreOrchestrationNotFoundError();
    response.set('Cache-Control', 'no-store').status(result.status === 'unsupported' ? 501 : 200).json(result);
  }));

  router.get('/providers', asyncHandler(async (request, response) => {
    assertNoQuery(request);
    // Scope resolution ensures this measured provider surface is authenticated too.
    scopeFor(options, request, response);
    response.set('Cache-Control', 'no-store').status(200).json({ providers: options.service.listProviderFacts() });
  }));

  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    sendError(response, error);
  });
  return router;
}

function scopeFor(
  options: CoreOrchestrationRouteOptions,
  request: Request,
  response: Response,
): ServerDerivedCoreScope {
  const scope = options.resolveAuthenticatedScope(request, response);
  if (!scope) throw new CoreOrchestrationUnauthorizedError();
  return createServerDerivedCoreScope(scope);
}

function submitRequest(value: unknown): CoreSubmitRequest {
  const body = strictObject(value, ['idempotencyKey', 'prompt', 'provider', 'mode']);
  if (typeof body.idempotencyKey !== 'string'
    || typeof body.prompt !== 'string'
    || (body.provider !== undefined && body.provider !== 'codex' && body.provider !== 'copilot')
    || (body.mode !== 'read-only' && body.mode !== 'workspace-write')) {
    throw invalidRequest();
  }
  return {
    idempotencyKey: body.idempotencyKey,
    prompt: body.prompt,
    ...(body.provider ? { provider: body.provider } : {}),
    mode: body.mode,
  };
}

function listRequest(request: Request): CoreListRequest {
  const query = strictObject(request.query, ['limit']);
  if (query.limit === undefined) return {};
  if (typeof query.limit !== 'string' || !/^[1-9]\d{0,2}$/u.test(query.limit)) throw invalidRequest();
  return { limit: Number(query.limit) };
}

function jobRequest(request: Request): CoreJobRequest {
  return { jobId: singleParam(request.params.jobId) };
}

function provideInputRequest(request: Request, value: unknown): CoreProvideInputRequest {
  const body = strictObject(value, ['input']);
  if (!Object.prototype.hasOwnProperty.call(body, 'input')) throw invalidRequest();
  return { jobId: singleParam(request.params.jobId), input: body.input };
}

function emptyBody(value: unknown): void {
  strictObject(value ?? {}, []);
}

function strictObject(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidRequest();
  const keys = Object.keys(value);
  if (keys.some((key) => !allowedKeys.includes(key))) throw invalidRequest();
  return value as Record<string, unknown>;
}

function singleParam(value: string | string[] | undefined): string {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) throw invalidRequest();
  return value.trim();
}

function assertNoQuery(request: Request): void {
  strictObject(request.query, []);
}

function requireJob(job: CoreOrchestrationJob | undefined): CoreOrchestrationJob {
  if (!job) throw new CoreOrchestrationNotFoundError();
  return job;
}

function invalidRequest(): CoreOrchestrationValidationError {
  return new CoreOrchestrationValidationError('Request does not match the Core orchestration schema.');
}

function sendError(response: Response, error: unknown): void {
  if (error instanceof CoreOrchestrationUnauthorizedError) {
    sendPublicError(response, 401, error.code, false);
    return;
  }
  if (error instanceof CoreOrchestrationNotFoundError) {
    sendPublicError(response, 404, error.code, false);
    return;
  }
  if (error instanceof CoreOrchestrationValidationError || isJsonParseError(error)) {
    sendPublicError(response, 400, 'CORE_ORCHESTRATION_INVALID_REQUEST', false);
    return;
  }
  if (error instanceof CoreOrchestrationIdempotencyConflictError) {
    sendPublicError(response, 409, error.code, false);
    return;
  }
  if (error instanceof AgentJobConflictError) {
    sendPublicError(response, 409, error.code, false);
    return;
  }
  if (error instanceof AgentMutationAuthorizationError) {
    sendPublicError(response, 403, error.code, false);
    return;
  }
  if (error instanceof AgentProviderUnavailableError) {
    sendPublicError(response, 503, error.code, true);
    return;
  }
  if (error instanceof AgentExecutionUnavailableError) {
    sendPublicError(response, 503, 'AGENT_EXECUTION_UNAVAILABLE', true);
    return;
  }
  if (error instanceof AgentCapacityError) {
    response.set('Cache-Control', 'no-store').status(429).json({ error: error.toPublic() });
    return;
  }
  sendPublicError(response, 500, 'CORE_ORCHESTRATION_INTERNAL_ERROR', true);
}

function sendPublicError(response: Response, status: number, code: string, retryable: boolean): void {
  response.set('Cache-Control', 'no-store').status(status).json({ error: { code, retryable } });
}

function isJsonParseError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'type' in error && error.type === 'entity.parse.failed');
}

function asyncHandler(
  handler: (request: Request, response: Response) => Promise<void>,
): RequestHandler {
  return (request, response, next) => {
    void handler(request, response).catch(next);
  };
}
