import { apiFetch, type ApiOperationRequest } from './auth.js';
import type {
  CoreOrchestrationJob,
  CoreProviderFact,
  CoreProvideInputResult,
  CoreSubmitRequest,
  CoreSubmitResult,
} from '../shared/core-orchestration.js';

export type CoreOrchestrationJobList = {
  jobs: CoreOrchestrationJob[];
  providers: CoreProviderFact[];
};

export type CoreOrchestrationJobResult = {
  job: CoreOrchestrationJob;
};

export const CORE_ORCHESTRATION_API_BASE_PATH = '/api/core-orchestration' as const;

type ErrorEnvelope = {
  error?: string | {
    code?: string;
    message?: string;
    retryable?: boolean;
  };
};

export class CoreOrchestrationClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;

  constructor(message: string, options: { code: string; status: number; retryable: boolean }) {
    super(message);
    this.name = 'CoreOrchestrationClientError';
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable;
  }
}

export type CoreOrchestrationClient = {
  listJobs: (signal?: AbortSignal) => Promise<CoreOrchestrationJobList>;
  getJob: (jobId: string, signal?: AbortSignal) => Promise<CoreOrchestrationJob>;
  submitJob: (input: CoreSubmitRequest, signal?: AbortSignal) => Promise<CoreSubmitResult>;
  cancelJob: (jobId: string, signal?: AbortSignal) => Promise<CoreOrchestrationJobResult>;
  approveJob: (jobId: string, signal?: AbortSignal) => Promise<CoreOrchestrationJobResult>;
  provideInput: (jobId: string, input: unknown, signal?: AbortSignal) => Promise<CoreProvideInputResult>;
  retryJob: (jobId: string, signal?: AbortSignal) => Promise<CoreOrchestrationJobResult>;
};

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function errorFromResponse(response: Response, body: unknown): CoreOrchestrationClientError {
  const envelope = body && typeof body === 'object' ? body as ErrorEnvelope : {};
  const structured = envelope.error && typeof envelope.error === 'object' ? envelope.error : undefined;
  const message = structured?.message
    ?? (typeof envelope.error === 'string' ? envelope.error : undefined)
    ?? '오케스트레이션 요청을 처리하지 못했습니다.';
  return new CoreOrchestrationClientError(message, {
    code: structured?.code ?? 'OrchestrationRequestFailed',
    status: response.status,
    retryable: structured?.retryable ?? response.status >= 500,
  });
}

async function expectResponse<T>(request: ApiOperationRequest, path: string, init: RequestInit = {}): Promise<T> {
  const response = await request(path, init);
  const body = await readJson(response);
  if (!response.ok) throw errorFromResponse(response, body);
  return body as T;
}

async function expectProvideInputResponse(
  request: ApiOperationRequest,
  path: string,
  init: RequestInit,
): Promise<CoreProvideInputResult> {
  const response = await request(path, init);
  const body = await readJson(response);
  if (response.ok || (response.status === 501 && isUnsupportedInputResult(body))) {
    return body as CoreProvideInputResult;
  }
  throw errorFromResponse(response, body);
}

function isUnsupportedInputResult(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && (value as { status?: unknown }).status === 'unsupported');
}

function jsonPost(body: Record<string, unknown>, signal?: AbortSignal): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  };
}

function jobPath(jobId: string, action = ''): string {
  const base = `${CORE_ORCHESTRATION_API_BASE_PATH}/jobs/${encodeURIComponent(jobId)}`;
  return action ? `${base}/${action}` : base;
}

export function createCoreOrchestrationClient(
  request: ApiOperationRequest = apiFetch,
): CoreOrchestrationClient {
  return {
    listJobs(signal) {
      return expectResponse<CoreOrchestrationJobList>(request, `${CORE_ORCHESTRATION_API_BASE_PATH}/jobs`, { signal });
    },
    async getJob(jobId, signal) {
      const response = await expectResponse<CoreOrchestrationJobResult>(request, jobPath(jobId), { signal });
      return response.job;
    },
    submitJob(input, signal) {
      return expectResponse<CoreSubmitResult>(
        request,
        `${CORE_ORCHESTRATION_API_BASE_PATH}/jobs`,
        jsonPost({
          idempotencyKey: input.idempotencyKey,
          prompt: input.prompt,
          ...(input.provider ? { provider: input.provider } : {}),
          mode: input.mode,
        }, signal),
      );
    },
    cancelJob(jobId, signal) {
      return expectResponse<CoreOrchestrationJobResult>(request, jobPath(jobId, 'cancel'), jsonPost({}, signal));
    },
    approveJob(jobId, signal) {
      return expectResponse<CoreOrchestrationJobResult>(request, jobPath(jobId, 'approve'), jsonPost({}, signal));
    },
    provideInput(jobId, input, signal) {
      return expectProvideInputResponse(request, jobPath(jobId, 'input'), jsonPost({ input }, signal));
    },
    retryJob(jobId, signal) {
      return expectResponse<CoreOrchestrationJobResult>(request, jobPath(jobId, 'retry'), jsonPost({}, signal));
    },
  };
}
