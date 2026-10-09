import { randomUUID } from 'node:crypto';
import { AbstractAgent } from '@ag-ui/client';
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/core';
import { Observable } from 'rxjs';
import { z } from 'zod';
import type { CoreOrchestrationJob } from '../shared/core-orchestration.js';
import {
  createExecutionPresentation, ExecutionPresentationJobIdSchema,
  EXECUTION_PRESENTATION_AGENT_ID, EXECUTION_PRESENTATION_TOOL_NAME,
} from '../shared/execution-presentation.js';
export { EXECUTION_PRESENTATION_AGENT_ID, EXECUTION_PRESENTATION_TOOL_NAME } from '../shared/execution-presentation.js';
export type CopilotJobProjectionAgentOptions = Readonly<{
  /** Bind the authenticated owner in the server factory, never in AG-UI input.
   * Return only the requested current job after the existing owner check.
   */
  getJob: (jobId: string) => CoreOrchestrationJob | undefined | Promise<CoreOrchestrationJob | undefined>;
}>;
const requestSchema = z.object({ jobId: ExecutionPresentationJobIdSchema }).strict();

/** An actual AG-UI agent that presents saved execution data; it never executes
 * a model, starts a job or exposes an approval/cancel/retry capability.
 */
export class CopilotJobProjectionAgent extends AbstractAgent {
  private options: CopilotJobProjectionAgentOptions;

  constructor(options: CopilotJobProjectionAgentOptions) {
    super({ agentId: EXECUTION_PRESENTATION_AGENT_ID, description: '인증된 기존 에이전트 작업의 읽기 전용 표시' });
    if (!options || typeof options.getJob !== 'function') throw new TypeError('An authenticated getJob getter is required');
    this.options = Object.freeze({ getJob: options.getJob });
  }

  override clone(): CopilotJobProjectionAgent {
    const copy = super.clone() as CopilotJobProjectionAgent;
    copy.options = this.options;
    return copy;
  }

  override run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>(subscriber => {
      let detached = false;
      const emit = (event: BaseEvent): void => { if (!detached && !subscriber.closed) subscriber.next(event); };
      const fail = (code: string): void => {
        emit({ type: EventType.RUN_ERROR, code, message: '작업 표시 정보를 확인하지 못했습니다.' } as BaseEvent);
        subscriber.complete();
      };
      emit({ type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId } as BaseEvent);
      const request = requestSchema.safeParse(input.forwardedProps);
      if (!request.success) {
        fail('INVALID_EXECUTION_PRESENTATION_REQUEST');
        return;
      }
      void (async () => {
        try {
          const job = await this.options.getJob(request.data.jobId);
          if (detached || subscriber.closed) return;
          if (!job || job.id !== request.data.jobId) {
            fail('EXECUTION_PRESENTATION_NOT_FOUND');
            return;
          }
          const presentation = createExecutionPresentation(job);
          const messageId = `presentation-${randomUUID()}`;
          const toolCallId = `presentation-tool-${randomUUID()}`;
          emit({ type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' } as BaseEvent);
          emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: presentation.text } as BaseEvent);
          emit({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);
          // This named display event renders the existing evidence. It is not
          // a claim that the CLI executed another tool or that an LLM chose it.
          emit({ type: EventType.TOOL_CALL_START, toolCallId, toolCallName: EXECUTION_PRESENTATION_TOOL_NAME } as BaseEvent);
          emit({ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: JSON.stringify({ presentation }) } as BaseEvent);
          emit({ type: EventType.TOOL_CALL_END, toolCallId } as BaseEvent);
          emit({ type: EventType.TOOL_CALL_RESULT, messageId: `presentation-result-${randomUUID()}`, toolCallId,
            role: 'tool', content: JSON.stringify(presentation) } as BaseEvent);
          emit({ type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId } as BaseEvent);
          subscriber.complete();
        } catch {
          // Never forward backend error text or foreign job details into UI.
          fail('EXECUTION_PRESENTATION_LOOKUP_FAILED');
        }
      })();
      return () => { detached = true; };
    });
  }
}
