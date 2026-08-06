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

type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
};

type OpenAIToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

type OpenAIChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: OpenAIToolCall[];
    };
  }>;
  error?: { message?: string };
};

const LLM_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'showWeatherCard',
      description: '현재 위치의 실시간 날씨를 Teams 카드로 표시합니다. 현재 위치 컨텍스트가 없으면 사용자에게 위치 권한을 요청해야 합니다.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'showTaskCard',
      description: '현재 업무 목록과 요약을 Teams 카드로 표시합니다.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspaceApproval',
      description: '파일 변경 작업을 시작하기 전에 사용자 승인을 요청합니다.',
      parameters: {
        type: 'object',
        properties: { prompt: { type: 'string', description: '승인을 받을 변경 작업 설명' } },
        required: ['prompt'],
        additionalProperties: false,
      },
    },
  },
] as const;

function textContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part: any) => typeof part?.text === 'string' ? part.text : typeof part?.content === 'string' ? part.content : '')
    .filter(Boolean)
    .join('\n');
}

function getOpenAIConversation(input: RunAgentInput): OpenAIMessage[] {
  return input.messages
    .map((message: any): OpenAIMessage | null => {
      if (message.role !== 'user' && message.role !== 'assistant') return null;
      return { role: message.role, content: textContent(message.content) };
    })
    .filter((message): message is OpenAIMessage => message !== null && Boolean(message.content))
    .slice(-12);
}

function isLiveWeather(value: any): value is WeatherResponse {
  return value?.source === 'open-meteo'
    && Number.isFinite(value.location?.latitude)
    && Number.isFinite(value.location?.longitude)
    && value.location?.name
    && value.current;
}

function forcedToolChoice(prompt: string): { type: 'function'; function: { name: string } } | 'auto' {
  if (/(날씨|weather)/i.test(prompt)) {
    return { type: 'function', function: { name: 'showWeatherCard' } };
  }
  if (/(업무|할 일|task).*(목록|리스트|보여|확인)|^(list|업무 목록)$/i.test(prompt)) {
    return { type: 'function', function: { name: 'showTaskCard' } };
  }
  if (/^(write|파일|수정|변경|작성|생성)/i.test(prompt)) {
    return { type: 'function', function: { name: 'workspaceApproval' } };
  }
  return 'auto';
}

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
    if (process.env.COPILOTKIT_DETERMINISTIC_MODE === 'true') {
      return this.handleDeterministicRequest(input, subscriber, setActiveJobId, isCancelled);
    }

    return this.handleLlmRequest(input, subscriber, setActiveJobId, isCancelled);
  }

  private async handleLlmRequest(
    input: RunAgentInput,
    subscriber: Subscriber<BaseEvent>,
    setActiveJobId: (id: string) => void,
    isCancelled: () => boolean,
  ): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('GenAI가 설정되지 않았습니다. OPENAI_API_KEY와 OPENAI_MODEL을 설정한 뒤 다시 시도하세요.');
    }

    const prompt = getMessageText(input);
    if (!prompt) return '요청 내용을 입력해 주세요.';

    const weatherContext = parseContextValue(input, '날씨');
    const system = [
      '너는 Teams 업무 허브의 GenAI 업무 도우미다.',
      '짧고 자연스러운 한국어로 답하고, 업무 목록·날씨·파일 변경 요청에는 제공된 도구를 사용한다.',
      '날씨 도구는 현재 위치 컨텍스트가 있을 때만 사용한다. 위치 컨텍스트가 없으면 서울이나 다른 좌표를 추측하지 말고 탭의 “내 위치 사용”을 안내한다.',
      '파일 변경은 반드시 workspaceApproval 도구를 사용해 승인 카드를 먼저 보여준다.',
      `현재 위치 날씨 컨텍스트: ${isLiveWeather(weatherContext) ? JSON.stringify(weatherContext) : '없음'}`,
    ].join('\n');

    const messages: OpenAIMessage[] = [
      { role: 'system', content: system },
      ...getOpenAIConversation(input),
    ];
    let toolChoice: { type: 'function'; function: { name: string } } | 'auto' = forcedToolChoice(prompt);
    const requesterId = typeof input.forwardedProps?.userId === 'string'
      ? input.forwardedProps.userId
      : 'copilotkit-user';

    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (isCancelled()) return '';

      const completion = await this.requestChatCompletion(apiKey, messages, toolChoice);
      const assistant = completion.choices?.[0]?.message;
      if (!assistant) throw new Error('GenAI 응답에 메시지가 없습니다.');

      const toolCalls = assistant.tool_calls ?? [];
      messages.push({
        role: 'assistant',
        content: assistant.content ?? null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });

      if (toolCalls.length === 0) {
        const answer = assistant.content?.trim() || '요청을 처리했습니다.';
        this.emitText(subscriber, answer);
        return answer;
      }

      for (const toolCall of toolCalls) {
        let args: any = {};
        try {
          args = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          args = {};
        }

        const result = await this.executeLlmTool(
          toolCall.function.name,
          args,
          input,
          subscriber,
          setActiveJobId,
          requesterId,
        );
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result });
      }

      toolChoice = 'auto';
    }

    throw new Error('GenAI 도구 실행이 너무 많이 반복되었습니다. 요청을 조금 더 구체적으로 입력하세요.');
  }

  private async requestChatCompletion(
    apiKey: string,
    messages: OpenAIMessage[],
    toolChoice: { type: 'function'; function: { name: string } } | 'auto',
  ): Promise<OpenAIChatResponse> {
    const baseUrl = (process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '');
    const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        tools: LLM_TOOLS,
        tool_choice: toolChoice,
        parallel_tool_calls: false,
        max_tokens: 900,
      }),
    });

    const payload = await response.json() as OpenAIChatResponse;
    if (!response.ok) {
      throw new Error(`GenAI 제공자 오류 (${response.status}): ${payload.error?.message || '응답을 처리하지 못했습니다.'}`);
    }
    return payload;
  }

  private async executeLlmTool(
    name: string,
    args: any,
    input: RunAgentInput,
    subscriber: Subscriber<BaseEvent>,
    setActiveJobId: (id: string) => void,
    requesterId: string,
  ): Promise<string> {
    if (name === 'showWeatherCard') {
      const contextWeather = parseContextValue(input, '날씨');
      if (!isLiveWeather(contextWeather)) {
        return '현재 위치 날씨 컨텍스트가 없습니다. 사용자에게 탭의 “내 위치 사용” 버튼을 눌러 위치 권한을 허용하라고 안내하세요.';
      }

      const weather = contextWeather as WeatherResponse;
      const toolArgs = compactWeather(weather);
      const result = formatWeatherMessage(weather, false);
      this.emitTool(subscriber, 'showWeatherCard', toolArgs, result);
      return result;
    }

    if (name === 'showTaskCard') {
      const tasks = compactTasks(this.itemStore);
      const result = formatTasks(tasks);
      this.emitTool(subscriber, 'showTaskCard', tasks, result);
      return result;
    }

    if (name === 'workspaceApproval') {
      const requestedPrompt = typeof args?.prompt === 'string' && args.prompt.trim()
        ? args.prompt.trim()
        : '요청한 파일 변경 작업';
      const job = await this.agentService.submit({
        prompt: requestedPrompt,
        mode: 'workspace-write',
        conversationId: input.threadId,
        requesterId,
        notify: false,
      });
      setActiveJobId(job.id);
      const approval: ApprovalToolArgs = { jobId: job.id, prompt: requestedPrompt, action: 'approve' };
      const result = `승인 대기 중인 작업 ${job.id}`;
      this.emitTool(subscriber, 'workspaceApproval', approval, result);
      return result;
    }

    return `지원하지 않는 도구입니다: ${name}`;
  }

  private async handleDeterministicRequest(
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
