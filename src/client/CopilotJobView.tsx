import { CopilotKit, CopilotChat, useAgent, useRenderTool } from '@copilotkit/react-core/v2';
import { HttpAgent } from '@ag-ui/client';
import { useEffect, useState, type ReactElement } from 'react';
import { z } from 'zod';
import { apiFetch, getCachedAuthHeaders, isApiAuthError, type ApiOperationRequest } from './auth.js';
import { ExecutionPresentationCard } from './ExecutionPresentationCard.js';
import {
  createExecutionPresentation,
  EXECUTION_PRESENTATION_AGENT_ID,
  EXECUTION_PRESENTATION_TOOL_NAME,
  ExecutionPresentationJobIdSchema,
  ExecutionPresentationSchema,
  type ExecutionPresentation,
} from '../shared/execution-presentation.js';
import type { CoreOrchestrationJob } from '../shared/core-orchestration.js';

export const COPILOT_PROJECTION_RUNTIME_PATH = '/api/copilot-ui';
export const COPILOT_PROJECTION_AGENT_ID = EXECUTION_PRESENTATION_AGENT_ID;
export const COPILOT_PROJECTION_TOOL_NAME = EXECUTION_PRESENTATION_TOOL_NAME;
const toolParametersSchema = z.object({ presentation: ExecutionPresentationSchema }).strict();
const runInputSchema = z.object({
  threadId: z.string().min(1).max(200), runId: z.string().min(1).max(200),
  messages: z.array(z.unknown()).length(0), state: z.object({}).strict(),
  tools: z.array(z.unknown()).length(0), context: z.array(z.unknown()).length(0),
  forwardedProps: z.object({ jobId: ExecutionPresentationJobIdSchema }).strict(),
}).strict();
const unavailableMessage = '풍부한 보기를 불러오지 못했습니다. 표시 새로고침으로 다시 시도하세요.';

class ProjectionViewError extends Error {
  constructor(readonly kind: 'forbidden' | 'auth-expired' | 'blocked' | 'unavailable') {
    super(kind === 'forbidden' ? '현재 계정에는 이 작업을 볼 권한이 없습니다.'
      : kind === 'auth-expired' ? 'Teams 인증이 만료되었습니다. 다시 인증해 계속하세요.'
      : kind === 'blocked' ? '읽기 전용 표시 요청의 범위를 확인하지 못했습니다.' : unavailableMessage);
    this.name = 'ProjectionViewError';
  }
}

function requireSuccessfulResponse(response: Response): void {
  if (!response.ok) throw new ProjectionViewError(response.status === 401 ? 'auth-expired'
    : response.status === 403 ? 'forbidden' : 'unavailable');
}

/** The installed SDK's public HttpAgent.fetch contract allows this adapter.
 * Only the read-only run endpoint receives an operation-scoped Teams SSO lease;
 * discovery is harmless metadata owned by the server. No global fetch or token
 * cache is changed. https://docs.ag-ui.com/sdk/js/client/http-agent
 */
export function createCopilotProjectionRequest({ jobId, origin, request = apiFetch }: {
  jobId: string; origin: string; request?: ApiOperationRequest;
}): (url: string, init: RequestInit) => Promise<Response> {
  ExecutionPresentationJobIdSchema.parse(jobId);
  const base = new URL(origin);
  if (base.origin !== origin || base.username || base.password) throw new ProjectionViewError('blocked');
  return async (url, init) => {
    let input: z.infer<typeof runInputSchema>;
    try {
      const target = new URL(url, base);
      if (target.origin !== origin || target.username || target.password || target.search || target.hash
        || target.pathname !== `${COPILOT_PROJECTION_RUNTIME_PATH}/agent/${COPILOT_PROJECTION_AGENT_ID}/run`
        || init.method !== 'POST' || typeof init.body !== 'string' || init.body.length > 4_096) {
        throw new ProjectionViewError('blocked');
      }
      input = runInputSchema.parse(JSON.parse(init.body));
      if (input.forwardedProps.jobId !== jobId) throw new ProjectionViewError('blocked');
    } catch {
      throw new ProjectionViewError('blocked');
    }
    try {
      const response = await request(url, { ...init, credentials: 'same-origin', redirect: 'error' });
      requireSuccessfulResponse(response);
      return response;
    } catch (error) {
      if (error instanceof ProjectionViewError || isApiAuthError(error)) throw error;
      if (init.signal?.aborted) throw new DOMException('표시 요청이 종료되었습니다.', 'AbortError');
      throw new ProjectionViewError('unavailable');
    }
  };
}

function completedProjection(agent: HttpAgent, jobId: string): ExecutionPresentation {
  for (const message of agent.messages) {
    if (message.role !== 'assistant') continue;
    for (const call of message.toolCalls ?? []) {
      if (call.function.name !== COPILOT_PROJECTION_TOOL_NAME) continue;
      const args = toolParametersSchema.safeParse(JSON.parse(call.function.arguments));
      const result = agent.messages.find(row => row.role === 'tool' && row.toolCallId === call.id);
      if (!args.success || args.data.presentation.jobId !== jobId || result?.role !== 'tool') continue;
      const parsedResult = ExecutionPresentationSchema.safeParse(JSON.parse(result.content));
      if (parsedResult.success && JSON.stringify(parsedResult.data) === JSON.stringify(args.data.presentation)) {
        return parsedResult.data;
      }
    }
  }
  throw new ProjectionViewError('unavailable');
}

type ProjectionRefreshResult = {
  status: 'succeeded' | 'failed' | 'busy' | 'disposed';
  presentation?: ExecutionPresentation;
  message?: string;
};
export type CopilotProjectionController = {
  refresh: () => Promise<ProjectionRefreshResult>;
  dispose: () => void;
};

/** One click updates a display. It never submits, continues, approves or cancels a CLI job. */
export function createCopilotProjectionController({ agent, jobId, origin, request = apiFetch, timeoutMs = 30_000 }: {
  agent: HttpAgent; jobId: string; origin: string; request?: ApiOperationRequest; timeoutMs?: number;
}): CopilotProjectionController {
  if (!(agent instanceof HttpAgent) || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new ProjectionViewError('blocked');
  const previousFetch = agent.fetch;
  const guardedFetch = createCopilotProjectionRequest({ jobId, origin, request });
  agent.fetch = guardedFetch;
  let disposed = false;
  let busy = false;
  let activeAbort: AbortController | undefined;
  const refresh = async (): Promise<ProjectionRefreshResult> => {
    if (disposed) return { status: 'disposed' };
    if (busy || agent.isRunning) return { status: 'busy' };
    busy = true;
    const abort = new AbortController();
    activeAbort = abort;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const assertCurrent = (): void => {
      if (disposed || abort.signal.aborted) throw new ProjectionViewError('unavailable');
    };
    const run = async (): Promise<ExecutionPresentation> => {
      const response = await request(`/api/core-orchestration/jobs/${encodeURIComponent(jobId)}`, {
        method: 'GET', signal: abort.signal, credentials: 'same-origin', redirect: 'error',
      });
      assertCurrent();
      requireSuccessfulResponse(response);
      const envelope = await response.json() as { job?: CoreOrchestrationJob };
      assertCurrent();
      if (envelope.job?.id !== jobId) throw new ProjectionViewError('forbidden');
      createExecutionPresentation(envelope.job);
      // Each SDK run starts with an empty view transcript. Old jobs, prompts,
      // UI context and caller identities are never forwarded to the runtime.
      agent.setMessages([]);
      agent.setState({});
      await agent.runAgent({ forwardedProps: { jobId }, tools: [], context: [] });
      assertCurrent();
      return completedProjection(agent, jobId);
    };
    try {
      const presentation = await Promise.race([run(), new Promise<never>((_, reject) => {
        timer = globalThis.setTimeout(() => {
          abort.abort();
          // The runtime proxy override sends /stop via global fetch. The
          // public base HTTP implementation only aborts this display stream.
          HttpAgent.prototype.abortRun.call(agent);
          reject(new ProjectionViewError('unavailable'));
        }, timeoutMs);
      })]);
      return { status: 'succeeded', presentation };
    } catch (error) {
      if (disposed) return { status: 'disposed' };
      return { status: 'failed', message: error instanceof ProjectionViewError || isApiAuthError(error)
        ? error.message : unavailableMessage };
    } finally {
      if (timer !== undefined) globalThis.clearTimeout(timer);
      activeAbort = undefined;
      busy = false;
    }
  };
  return { refresh, dispose: () => {
    if (disposed) return;
    disposed = true;
    activeAbort?.abort();
    if (busy) HttpAgent.prototype.abortRun.call(agent);
    if (agent.fetch === guardedFetch) agent.fetch = previousFetch;
  } };
}

export function renderExecutionPresentationTool(props: {
  status: 'inProgress' | 'executing' | 'complete'; parameters: unknown; result?: string;
}, jobId: string): ReactElement {
  if (props.status !== 'complete') return <p role="status" aria-live="polite">작업 표시를 불러오고 있습니다.</p>;
  try {
    const parsed = toolParametersSchema.safeParse(props.parameters);
    if (!parsed.success || parsed.data.presentation.jobId !== jobId || typeof props.result !== 'string' || props.result.length > 512_000) {
      throw new ProjectionViewError('blocked');
    }
    const result = ExecutionPresentationSchema.safeParse(JSON.parse(props.result));
    if (!result.success || JSON.stringify(result.data) !== JSON.stringify(parsed.data.presentation)) throw new ProjectionViewError('blocked');
    return <ExecutionPresentationCard presentation={result.data} />;
  } catch {
    return <p role="alert">현재 작업의 표시 데이터를 확인하지 못했습니다. 표시 새로고침으로 다시 시도하세요.</p>;
  }
}

const HiddenSdkSlot = () => null;
const projectionMessageView = {
  assistantMessage: { markdownRenderer: HiddenSdkSlot, toolbar: HiddenSdkSlot },
  userMessage: HiddenSdkSlot, reasoningMessage: HiddenSdkSlot,
};

function ConnectedProjectionView({ jobId }: { jobId: string }): ReactElement {
  const { agent, isReady } = useAgent({ agentId: COPILOT_PROJECTION_AGENT_ID });
  const [controller, setController] = useState<CopilotProjectionController | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  useRenderTool({ name: COPILOT_PROJECTION_TOOL_NAME, agentId: COPILOT_PROJECTION_AGENT_ID,
    parameters: toolParametersSchema, render: props => renderExecutionPresentationTool(props, jobId) }, [jobId]);
  useRenderTool({ name: '*', agentId: COPILOT_PROJECTION_AGENT_ID, render: () => <></> }, []);
  useEffect(() => {
    if (!isReady || !(agent instanceof HttpAgent)) return;
    const next = createCopilotProjectionController({ agent, jobId, origin: window.location.origin });
    setController(next);
    return () => { next.dispose(); };
  }, [agent, isReady, jobId]);
  const unsupported = isReady && !(agent instanceof HttpAgent);
  async function refresh(): Promise<void> {
    if (!controller || busy) return;
    setBusy(true);
    setMessage('');
    const result = await controller.refresh();
    if (result.status === 'succeeded') setLoaded(true);
    if (result.status === 'failed') setMessage(result.message ?? unavailableMessage);
    setBusy(false);
  }
  return (
    <section aria-label="CopilotKit 작업 보기" aria-busy={busy} className="copilot-projection-view">
      <p>선택한 작업의 결과와 실행 영수증을 표시합니다.</p>
      {!isReady ? <p role="status">풍부한 보기를 연결하고 있습니다.</p> : null}
      {unsupported ? <p role="alert">현재 SDK 전송 방식은 읽기 전용 표시를 지원하지 않습니다.</p> : null}
      {message ? <p role="alert">{message}</p> : null}
      <button type="button" disabled={!controller || unsupported || busy} onClick={() => { void refresh(); }}>
        {busy ? '불러오는 중…' : loaded ? '표시 새로고침' : '보기 불러오기'}
      </button>
      {/* CopilotChat initializes its unscoped thread on mount. Mount it before
          the first explicit display run so that initialization cannot clear a
          newly received result. Visibility changes preserve the same instance. */}
      {isReady ? <div hidden={!loaded} className="copilot-projection-transcript">
        <CopilotChat agentId={COPILOT_PROJECTION_AGENT_ID} input={HiddenSdkSlot}
          suggestionView={HiddenSdkSlot} welcomeScreen={false} messageView={projectionMessageView}
          autoScroll="none" onError={() => setMessage(unavailableMessage)} />
      </div> : null}
    </section>
  );
}

/** Import this file only from the explicit optional entry. Core uses the pure card. */
export function CopilotJobView({ jobId }: { jobId: string }): ReactElement {
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [connectionError, setConnectionError] = useState('');
  if (!ExecutionPresentationJobIdSchema.safeParse(jobId).success) return <p role="alert">작업 ID를 확인하지 못했습니다.</p>;
  return (
    <div className="copilot-job-shell">
      {connectionError ? <section role="alert"><p>{connectionError}</p>
        <button type="button" onClick={() => { setConnectionError(''); setConnectionAttempt(attempt => attempt + 1); }}>연결 다시 시도</button>
      </section> : null}
      <CopilotKit key={`${jobId}-${connectionAttempt}`} runtimeUrl={COPILOT_PROJECTION_RUNTIME_PATH}
        agent={COPILOT_PROJECTION_AGENT_ID} headers={getCachedAuthHeaders} credentials="same-origin"
        useSingleEndpoint={false} showDevConsole={false} enableInspector={false}
        onError={() => setConnectionError(unavailableMessage)}>
        <ConnectedProjectionView jobId={jobId} />
      </CopilotKit>
    </div>
  );
}
