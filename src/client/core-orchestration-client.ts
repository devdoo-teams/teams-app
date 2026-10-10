import { apiFetch, type ApiOperationRequest } from './auth.js';
import type {
  CoreOrchestrationJob,
  CoreCodexModelCatalog,
  CoreProviderFact,
  CoreProvideInputResult,
  CoreSubmitRequest,
  CoreSubmitResult,
  CoreApprovalRequest,
} from '../shared/core-orchestration.js';
import type { VisibleJobConversation } from '../shared/job-conversation.js';
import { loadJobConversation } from './job-conversation.js';

export type CoreOrchestrationJobList = {
  pendingJobs?: CoreOrchestrationJob[] | null;
  pendingHasMore?: boolean;
  jobs: CoreOrchestrationJob[];
  providers: CoreProviderFact[];
  modelCatalog?: CoreCodexModelCatalog;
};

export type CoreOrchestrationJobResult = {
  job: CoreOrchestrationJob;
};
export type CoreApprovalIdentity = Pick<CoreApprovalRequest, 'approvalId' | 'revision'>;
export type CoreApprovalDecisionResult = CoreOrchestrationJobResult & { replayed: boolean };

export function isCoreApprovalIdentity(value: unknown): value is CoreApprovalIdentity {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const identity = value as Partial<CoreApprovalIdentity>;
  return Object.keys(identity).every(key => ['approvalId', 'revision'].includes(key))
    && typeof identity.approvalId === 'string' && /^approval-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(identity.approvalId)
    && typeof identity.revision === 'string' && /^[a-f0-9]{64}$/u.test(identity.revision);
}

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
  getJobConversation?: (jobId: string, signal?: AbortSignal) => Promise<{ job: CoreOrchestrationJob; conversation: VisibleJobConversation }>;
  continueJob: (jobId: string, prompt: string, signal?: AbortSignal) => Promise<CoreOrchestrationJobResult>;
  submitJob: (input: CoreSubmitRequest, signal?: AbortSignal) => Promise<CoreSubmitResult>;
  cancelJob: (jobId: string, signal?: AbortSignal) => Promise<CoreOrchestrationJobResult>;
  approveJob: (jobId: string, signal?: AbortSignal) => Promise<CoreOrchestrationJobResult>;
  decideApproval?: (jobId: string, identity: CoreApprovalIdentity, decision: 'accept' | 'deny', signal?: AbortSignal) => Promise<CoreApprovalDecisionResult>;
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
  const getJob = async (jobId: string, signal?: AbortSignal) => {
    const response = await expectResponse<CoreOrchestrationJobResult>(request, jobPath(jobId), { signal });
    return response.job;
  };
  return {
    listJobs(signal) {
      return expectResponse<CoreOrchestrationJobList>(request, `${CORE_ORCHESTRATION_API_BASE_PATH}/jobs`, { signal });
    },
    getJob,
    getJobConversation(jobId, signal) { return loadJobConversation(jobId, getJob, signal); },
    continueJob(jobId, prompt, signal) {
      return expectResponse<CoreOrchestrationJobResult>(
        request,
        jobPath(jobId, 'continue'),
        jsonPost({ prompt }, signal),
      );
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
          ...(input.notify !== undefined ? { notify: input.notify } : {}),
          ...(input.model ? {
            model: input.model,
            reasoningEffort: input.reasoningEffort,
            catalogRevision: input.catalogRevision,
          } : {}),
        }, signal),
      );
    },
    cancelJob(jobId, signal) {
      return expectResponse<CoreOrchestrationJobResult>(request, jobPath(jobId, 'cancel'), jsonPost({}, signal));
    },
    approveJob() {
      return Promise.reject(new CoreOrchestrationClientError('서버에서 확인한 승인 ID와 revision이 필요합니다. 작업을 다시 조회하세요.', {
        code: 'ApprovalIdentityRequired', status: 400, retryable: false,
      }));
    },
    decideApproval(jobId, identity, decision, signal) {
      if (!isCoreApprovalIdentity(identity) || !['accept', 'deny'].includes(decision)) {
        return Promise.reject(new CoreOrchestrationClientError('서버에서 확인한 승인 ID와 revision이 필요합니다. 작업을 다시 조회하세요.', {
          code: 'ApprovalIdentityRequired', status: 400, retryable: false,
        }));
      }
      return expectResponse<CoreApprovalDecisionResult>(request, jobPath(jobId, decision === 'accept' ? 'approve' : 'deny'),
        jsonPost({ approvalId: identity.approvalId, revision: identity.revision }, signal));
    },
    provideInput(jobId, input, signal) {
      return expectProvideInputResponse(request, jobPath(jobId, 'input'), jsonPost({ input }, signal));
    },
    retryJob(jobId, signal) {
      return expectResponse<CoreOrchestrationJobResult>(request, jobPath(jobId, 'retry'), jsonPost({}, signal));
    },
  };
}
