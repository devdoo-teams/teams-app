import { randomUUID } from 'node:crypto';

import { AbstractAgent } from '@ag-ui/client';
import {
  EventType,
  type AgentCapabilities,
  type BaseEvent,
  type RunAgentInput,
} from '@ag-ui/core';
import { Observable, type Subscriber } from 'rxjs';

import { AgentService } from './agent-service.js';
import type { AgentJobScope } from './agent-job-store.js';
import { ItemStore } from './item-store.js';
import { DeterministicResponseEngine } from './response-engine-deterministic.js';
import { OpenAIResponseEngine } from './response-engine-openai.js';
import {
  ResponseEngineRouter,
  type ApprovalEnvelopeFactory,
  type ResponseToolEvent,
} from './response-engine.js';

const AGENT_ID = 'default';

type CopilotIdentity = Pick<AgentJobScope, 'requesterId' | 'tenantId'>;

function getMessageText(input: RunAgentInput): string {
  for (let index = input.messages.length - 1; index >= 0; index -= 1) {
    const message = input.messages[index];
    if (message.role !== 'user') continue;
    if (typeof message.content === 'string') return message.content.trim();
    return message.content
      .filter((part: any) => part.type === 'text')
      .map((part: any) => part.text)
      .join('\n')
      .trim();
  }

  return '';
}

export class TeamsCodexAgent extends AbstractAgent {
  private readonly responseEngineRouter = new ResponseEngineRouter([
    new DeterministicResponseEngine(),
    new OpenAIResponseEngine(),
  ]);

  constructor(
    private readonly itemStore: ItemStore,
    private readonly agentService: AgentService,
    private readonly identity: CopilotIdentity,
    private readonly approvalEnvelope?: ApprovalEnvelopeFactory,
  ) {
    super({
      agentId: AGENT_ID,
      description: 'Teams 업무 허브의 업무·Codex 작업 에이전트',
    });
  }

  override clone(): TeamsCodexAgent {
    return new TeamsCodexAgent(this.itemStore, this.agentService, this.identity, this.approvalEnvelope);
  }

  override async getCapabilities(): Promise<AgentCapabilities> {
    return {
      identity: {
        name: 'Teams 업무 허브',
        type: 'teams-codex-agent',
        description: this.description,
        version: '1.0.0',
        provider: 'Teams SDK MVP',
      },
      transport: { streaming: true },
      execution: { codeExecution: true },
      tools: {
        supported: true,
        items: [
          {
            name: 'showTaskCard',
            description: '업무 목록을 Teams 업무 허브 카드로 표시합니다.',
            parameters: { type: 'object' },
          },
          {
            name: 'workspaceApproval',
            description: '파일 변경 작업 전에 사용자 승인을 요청합니다.',
            parameters: { type: 'object' },
          },
        ],
      },
      humanInTheLoop: { supported: true, approvals: true },
    };
  }

  override run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      let activeJobId: string | undefined;
      const scope = this.scopeForInput(input);
      let cancelled = false;

      const execute = async (): Promise<void> => {
        const threadId = input.threadId;
        const runId = input.runId;

        subscriber.next({
          type: EventType.RUN_STARTED,
          threadId,
          runId,
          input,
        } as BaseEvent);

        try {
          const result = await this.handleRequest(input, subscriber, (jobId) => {
            activeJobId = jobId;
          }, () => cancelled);

          if (cancelled) return;

          subscriber.next({
            type: EventType.RUN_FINISHED,
            threadId,
            runId,
            outcome: { type: 'success' },
            result,
          } as BaseEvent);
          subscriber.complete();
        } catch (error) {
          if (cancelled) return;

          const message = error instanceof Error ? error.message : 'CopilotKit 에이전트 실행에 실패했습니다.';
          subscriber.next({
            type: EventType.RUN_ERROR,
            message,
          } as BaseEvent);
          subscriber.error(error);
        }
      };

      void execute();

      return () => {
        cancelled = true;
        if (activeJobId) void this.agentService.cancel(activeJobId, scope);
      };
    });
  }

  private async handleRequest(
    input: RunAgentInput,
    subscriber: Subscriber<BaseEvent>,
    setActiveJobId: (id: string) => void,
    isCancelled: () => boolean,
  ): Promise<string> {
    const mode = process.env.COPILOTKIT_DETERMINISTIC_MODE === 'true' ? 'deterministic' : 'openai';
    const output = await this.responseEngineRouter.run({
      mode,
      prompt: getMessageText(input),
      request: input,
      scope: this.scopeForInput(input),
      itemStore: this.itemStore,
      agentService: this.agentService,
      onText: (text) => this.emitText(subscriber, text),
      onTool: (tool) => this.emitTool(subscriber, tool),
      setActiveJobId,
      isCancelled,
      approvalEnvelope: this.approvalEnvelope,
    });
    return output.text;
  }

  private async handleDeterministicRequest(
    input: RunAgentInput,
    subscriber: Subscriber<BaseEvent>,
    setActiveJobId: (id: string) => void,
    isCancelled: () => boolean,
  ): Promise<string> {
    const output = await this.responseEngineRouter.run({
      mode: 'deterministic',
      prompt: getMessageText(input),
      request: input,
      scope: this.scopeForInput(input),
      itemStore: this.itemStore,
      agentService: this.agentService,
      onText: (text) => this.emitText(subscriber, text),
      onTool: (tool) => this.emitTool(subscriber, tool),
      setActiveJobId,
      isCancelled,
      approvalEnvelope: this.approvalEnvelope,
    });
    return output.text;
  }

  private scopeForInput(input: RunAgentInput): AgentJobScope {
    if (!this.identity.requesterId || !this.identity.tenantId || !input.threadId) {
      throw new Error('validated Copilot identity and thread are required');
    }
    return {
      requesterId: this.identity.requesterId,
      conversationId: input.threadId,
      tenantId: this.identity.tenantId,
    };
  }

  private emitTool(
    subscriber: Subscriber<BaseEvent>,
    tool: ResponseToolEvent,
  ): void {
    const toolCallId = `tool-${randomUUID()}`;
    const messageId = `tool-message-${randomUUID()}`;
    subscriber.next({
      type: EventType.TOOL_CALL_START,
      toolCallId,
      toolCallName: tool.name,
    } as BaseEvent);
    subscriber.next({
      type: EventType.TOOL_CALL_ARGS,
      toolCallId,
      delta: JSON.stringify(tool.args),
    } as BaseEvent);
    subscriber.next({
      type: EventType.TOOL_CALL_END,
      toolCallId,
    } as BaseEvent);
    subscriber.next({
      type: EventType.TOOL_CALL_RESULT,
      messageId,
      toolCallId,
      role: 'tool',
      content: tool.result,
    } as BaseEvent);
  }

  private emitText(subscriber: Subscriber<BaseEvent>, text: string): void {
    const messageId = `message-${randomUUID()}`;
    subscriber.next({
      type: EventType.TEXT_MESSAGE_START,
      messageId,
      role: 'assistant',
    } as BaseEvent);
    subscriber.next({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId,
      delta: text,
    } as BaseEvent);
    subscriber.next({
      type: EventType.TEXT_MESSAGE_END,
      messageId,
    } as BaseEvent);
  }
}
