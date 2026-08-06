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
import { ItemStore } from './item-store.js';
import { DEMO_COORDINATES, formatWeatherMessage, getWeather, type WeatherResponse } from './weather-service.js';

const AGENT_ID = 'default';

type WeatherToolArgs = {
  location: string;
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windSpeed: number;
  precipitation: number;
  condition: string;
  source: string;
};

type TaskToolArgs = {
  items: Array<{ id: number; title: string; status: 'open' | 'done' }>;
  total: number;
  open: number;
  done: number;
};

type ApprovalToolArgs = {
  jobId: string;
  prompt: string;
  action: 'approve' | 'cancel';
};

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

function parseContextValue(input: RunAgentInput, keyword: string): any | undefined {
  const context = input.context.find((entry) => entry.description.toLowerCase().includes(keyword));
  if (!context) return undefined;

  try {
    return JSON.parse(context.value);
  } catch {
    return undefined;
  }
}

function compactWeather(weather: WeatherResponse): WeatherToolArgs {
  return {
    location: weather.location.name,
    temperature: weather.current.temperature,
    apparentTemperature: weather.current.apparentTemperature,
    humidity: weather.current.humidity,
    windSpeed: weather.current.windSpeed,
    precipitation: weather.current.precipitation,
    condition: weather.current.condition,
    source: weather.source === 'demo' ? '데모' : 'Open-Meteo',
  };
}

function compactTasks(itemStore: ItemStore): TaskToolArgs {
  const items = itemStore.list();
  const summary = itemStore.summary();
  return { items, ...summary };
}

function formatTasks(tasks: TaskToolArgs): string {
  const openItems = tasks.items.filter((item) => item.status === 'open');
  const body = openItems.length === 0
    ? '진행 중인 업무가 없습니다.'
    : openItems.slice(0, 8).map((item) => `- ${item.title}`).join('\n');

  return `현재 업무 ${tasks.total}개 · 진행 중 ${tasks.open}개 · 완료 ${tasks.done}개\n\n${body}`;
}

function formatJobs(agentService: AgentService): string {
  const jobs = agentService.list(5);
  if (jobs.length === 0) return 'Codex 작업이 없습니다.';
  return jobs.map((job) => `- ${job.id}: ${job.status}`).join('\n');
}

export class TeamsCodexAgent extends AbstractAgent {
  constructor(
    private readonly itemStore: ItemStore,
    private readonly agentService: AgentService,
  ) {
    super({
      agentId: AGENT_ID,
      description: 'Teams 업무 허브의 업무·날씨·Codex 작업 에이전트',
    });
  }

  override clone(): TeamsCodexAgent {
    return new TeamsCodexAgent(this.itemStore, this.agentService);
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
            name: 'showWeatherCard',
            description: '현재 날씨를 Teams 업무 허브 카드로 표시합니다.',
            parameters: { type: 'object' },
          },
          {
            name: 'showTaskCard',
            description: '업무 목록을 Teams 업무 허브 카드로 표시합니다.',
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
        if (activeJobId) void this.agentService.cancel(activeJobId);
      };
    });
  }

  private async handleRequest(
    input: RunAgentInput,
    subscriber: Subscriber<BaseEvent>,
    setActiveJobId: (id: string) => void,
    isCancelled: () => boolean,
  ): Promise<string> {
    const prompt = getMessageText(input);
    const normalized = prompt.toLowerCase();
    const threadId = input.threadId;
    const requesterId = typeof input.forwardedProps?.userId === 'string'
      ? input.forwardedProps.userId
      : 'copilotkit-user';

    if (!prompt) return '요청 내용을 입력해 주세요.';

    if (/^(help|도움|사용법|명령)/i.test(normalized)) {
      return 'CopilotKit 데모 명령\n\n- 현재 업무 목록 보여줘\n- 현재 위치 날씨 보여줘\n- Codex 작업 상태 알려줘\n- 저장소를 분석해줘\n- write로 파일 변경 작업을 요청하면 승인 카드가 표시됩니다.';
    }

    if (/(업무|할 일|task).*(목록|리스트|보여|확인)|^(list|업무 목록)$/i.test(normalized)) {
      const tasks = compactTasks(this.itemStore);
      this.emitTool(subscriber, 'showTaskCard', tasks, formatTasks(tasks));
      return formatTasks(tasks);
    }

    if (/(날씨|weather)/i.test(normalized)) {
      const contextWeather = parseContextValue(input, '날씨');
      const weather = contextWeather?.location && contextWeather?.current
        ? contextWeather as WeatherResponse
        : await getWeather(DEMO_COORDINATES.latitude, DEMO_COORDINATES.longitude, { demo: true });
      const toolArgs = compactWeather(weather);
      this.emitTool(subscriber, 'showWeatherCard', toolArgs, formatWeatherMessage(weather, weather.source === 'demo'));
      return `${formatWeatherMessage(weather, weather.source === 'demo')}\n\n탭의 “내 위치 사용” 버튼을 누르면 Teams 모바일 위치 권한으로 실시간 위치를 갱신할 수 있습니다.`;
    }

    if (/^(status|상태|진행 상태)/i.test(normalized)) {
      return `활성 Codex 작업 ${this.agentService.countActive()}개\n\n${formatJobs(this.agentService)}`;
    }

    if (/^(write|파일|수정|변경|작성|생성)/i.test(normalized)) {
      const requestedPrompt = prompt.replace(/^(write|파일(?:을|이)?\s*(?:변경|수정)?|수정|변경|작성|생성)\s*/i, '').trim() || '요청한 변경 작업';
      const job = await this.agentService.submit({
        prompt: requestedPrompt,
        mode: 'workspace-write',
        conversationId: threadId,
        requesterId,
        notify: false,
      });
      const approval: ApprovalToolArgs = { jobId: job.id, prompt: requestedPrompt, action: 'approve' };
      this.emitTool(subscriber, 'workspaceApproval', approval, `승인 대기 중인 작업 ${job.id}`);
      return `쓰기 작업 ${job.id}이 승인 대기 중입니다.\n\nTeams Bot에서 “approve ${job.id}”를 보내거나 아래 승인 흐름을 사용하세요.`;
    }

    const previous = this.agentService.latestCompletedForConversation(threadId);
    const onProgress = async (message: string): Promise<void> => {
      if (!isCancelled()) this.emitText(subscriber, `⏳ ${message}`);
    };
    const job = previous
      ? await this.agentService.continue(previous.id, prompt, { notify: false, onProgress })
      : await this.agentService.submit({
        prompt,
        mode: 'read-only',
        conversationId: threadId,
        requesterId,
        notify: false,
        onProgress,
      });

    if (!job) throw new Error('Codex 작업을 생성하지 못했습니다.');
    setActiveJobId(job.id);
    const completed = await this.agentService.waitForTerminal(job.id);

    if (completed.status === 'completed') {
      return completed.result || `작업 ${completed.id}이 완료되었습니다.`;
    }

    return `작업 ${completed.id}이 ${completed.status} 상태입니다.\n\n${completed.error || completed.progress.at(-1) || '추가 확인이 필요합니다.'}`;
  }

  private emitTool(
    subscriber: Subscriber<BaseEvent>,
    name: string,
    args: WeatherToolArgs | TaskToolArgs | ApprovalToolArgs,
    result: string,
  ): void {
    const toolCallId = `tool-${randomUUID()}`;
    const messageId = `tool-message-${randomUUID()}`;
    subscriber.next({
      type: EventType.TOOL_CALL_START,
      toolCallId,
      toolCallName: name,
    } as BaseEvent);
    subscriber.next({
      type: EventType.TOOL_CALL_ARGS,
      toolCallId,
      delta: JSON.stringify(args),
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
      content: result,
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
