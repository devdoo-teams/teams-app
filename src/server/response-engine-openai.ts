import { randomUUID } from 'node:crypto';

import {
  GENUI_SCHEMA_VERSION,
  GenUiEnvelopeV1Schema,
  type GenUiEnvelopeV1,
} from '../shared/genui.js';
import type { RunAgentInput } from '@ag-ui/core';

import type { AgentJobScope } from './agent-job-store.js';
import {
  LLM_TOOLS,
  type OpenAIChatResponse,
  type OpenAIMessage,
  type OpenAIToolCall,
  type ResponseEngine,
  type ResponseEngineInput,
  type ResponseEngineOutput,
  type ResponseToolEvent,
} from './response-engine.js';
import { formatWeatherMessage, type WeatherResponse } from './weather-service.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const MAX_CONVERSATION_MESSAGES = 11;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_SYSTEM_CONTEXT_LENGTH = 2_000;
const MAX_TOOL_ARGUMENTS_LENGTH = 4_000;
const MAX_TOOL_CALLS = 3;
const MAX_MODEL_LENGTH = 120;
const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 10;
const MAX_TIMEOUT_MS = 30_000;

type OpenAIResponseEngineOptions = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

type OpenAIConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
};

type ParsedAssistant = {
  content: string;
  toolCalls: OpenAIToolCall[];
};

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

class OpenAIProviderError extends Error {
  constructor(readonly code: 'configuration' | 'timeout' | 'network' | 'http' | 'response' | 'tool' | 'location' | 'cancelled') {
    super(code);
    this.name = 'OpenAIProviderError';
  }
}

function boundedText(value: unknown, maxLength = MAX_MESSAGE_LENGTH): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function textContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const record = part as Record<string, unknown>;
      return typeof record.text === 'string'
        ? record.text
        : typeof record.content === 'string'
          ? record.content
          : '';
    })
    .filter(Boolean)
    .join('\n');
}

function contextValue(input: ResponseEngineInput, keyword: string): unknown {
  const context = input.request.context.find((entry) => entry.description.toLowerCase().includes(keyword));
  if (!context) return undefined;
  try {
    return JSON.parse(context.value) as unknown;
  } catch {
    return undefined;
  }
}

function isLiveWeather(value: unknown): value is WeatherResponse {
  const weather = value as WeatherResponse | undefined;
  return Boolean(
    weather?.source === 'open-meteo'
      && weather.location?.name
      && Number.isFinite(weather.location.latitude)
      && Number.isFinite(weather.location.longitude)
      && weather.current
      && Number.isFinite(weather.current.temperature)
      && Number.isFinite(weather.current.apparentTemperature)
      && Number.isFinite(weather.current.humidity)
      && Number.isFinite(weather.current.windSpeed)
      && Number.isFinite(weather.current.precipitation),
  );
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
    source: 'Open-Meteo',
  };
}

function compactTasks(input: ResponseEngineInput): TaskToolArgs {
  const items = input.itemStore.list();
  return { items, ...input.itemStore.summary() };
}

function formatTasks(tasks: TaskToolArgs): string {
  const openItems = tasks.items.filter((item) => item.status === 'open');
  const body = openItems.length === 0
    ? '진행 중인 업무가 없습니다.'
    : openItems.slice(0, 8).map((item) => `- ${item.title}`).join('\n');
  return `현재 업무 ${tasks.total}개 · 진행 중 ${tasks.open}개 · 완료 ${tasks.done}개\n\n${body}`;
}

function responseEnvelope(input: {
  kind: GenUiEnvelopeV1['kind'];
  id: string;
  title: string;
  text: string;
  aiGenerated: boolean;
  model?: string;
  status?: GenUiEnvelopeV1['status'];
  sections?: GenUiEnvelopeV1['sections'];
  errorCode?: string;
}): GenUiEnvelopeV1 {
  const metadata: Record<string, string | boolean> = {
    source: 'openai',
    provider: 'openai',
    aiGenerated: input.aiGenerated,
  };
  if (input.model) metadata.model = input.model.slice(0, MAX_MODEL_LENGTH);
  if (input.errorCode) metadata.errorCode = input.errorCode;

  return GenUiEnvelopeV1Schema.parse({
    schemaVersion: GENUI_SCHEMA_VERSION,
    kind: input.kind,
    status: input.status ?? 'ready',
    id: input.id,
    correlationId: randomUUID(),
    title: input.title,
    summary: input.text.slice(0, 2_000),
    sections: input.sections ?? [{ type: 'text', text: input.text }],
    actions: [],
    citations: [],
    aiGenerated: input.aiGenerated,
    fallbackText: input.text,
    metadata,
  });
}

function errorOutput(text: string, code: string): ResponseEngineOutput {
  return {
    text,
    envelope: responseEnvelope({
      kind: 'error',
      id: `openai-error-${code}`,
      title: 'GenAI 응답을 처리하지 못했습니다',
      text,
      aiGenerated: false,
      status: 'error',
      errorCode: code,
    }),
    toolCalls: [],
  };
}

function cancelledOutput(): ResponseEngineOutput {
  const text = '요청이 취소되었습니다.';
  return {
    text,
    envelope: responseEnvelope({
      kind: 'answer',
      id: 'openai-cancelled',
      title: '요청 취소',
      text,
      aiGenerated: false,
    }),
    toolCalls: [],
  };
}

function providerErrorOutput(error: unknown): ResponseEngineOutput {
  if (error instanceof OpenAIProviderError) {
    if (error.code === 'cancelled') return cancelledOutput();
    if (error.code === 'configuration') {
      return errorOutput('OpenAI GenAI가 설정되지 않았습니다. 서버에 OPENAI_API_KEY를 설정하거나 결정형 모드로 전환하세요.', 'openai-not-configured');
    }
    if (error.code === 'timeout') return errorOutput('GenAI 응답 시간이 초과되었습니다. 잠시 후 다시 시도하세요.', 'openai-timeout');
    if (error.code === 'tool') return errorOutput('GenAI가 유효하지 않은 도구 요청을 반환했습니다. 요청을 다시 시도하세요.', 'openai-invalid-tool');
    if (error.code === 'location') return errorOutput('현재 위치 날씨 컨텍스트가 없습니다. 탭의 “내 위치 사용” 버튼을 눌러 위치 권한을 허용한 뒤 다시 시도하세요.', 'openai-location-required');
    if (error.code === 'http') return errorOutput('GenAI 제공자에 연결할 수 없습니다. 서버 설정과 제공자 상태를 확인하세요.', 'openai-provider-http');
    if (error.code === 'response') return errorOutput('GenAI 제공자의 응답 형식을 확인할 수 없습니다. 잠시 후 다시 시도하세요.', 'openai-invalid-response');
    return errorOutput('GenAI 제공자 요청에 실패했습니다. 잠시 후 다시 시도하세요.', 'openai-provider-error');
  }
  return errorOutput('GenAI 요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.', 'openai-request-error');
}

function getMessageHistory(input: ResponseEngineInput): OpenAIMessage[] {
  const messages = input.request.messages
    .map((message): OpenAIMessage | null => {
      if (message.role !== 'user' && message.role !== 'assistant') return null;
      const content = boundedText(textContent(message.content));
      return content ? { role: message.role, content } : null;
    })
    .filter((message): message is OpenAIMessage => message !== null)
    .slice(-MAX_CONVERSATION_MESSAGES);

  if (messages.length > 0) return messages;
  return [{ role: 'user', content: boundedText(input.prompt) }];
}

function locationSystemContext(input: ResponseEngineInput): string {
  const weather = contextValue(input, '날씨');
  if (!isLiveWeather(weather)) return '없음';
  return JSON.stringify(weather).slice(0, MAX_SYSTEM_CONTEXT_LENGTH);
}

function forcedToolChoice(prompt: string): { type: 'function'; function: { name: string } } | 'auto' {
  if (/(날씨|weather)/i.test(prompt)) return { type: 'function', function: { name: 'showWeatherCard' } };
  if (/(업무|할 일|task).*(목록|리스트|보여|확인)|^(list|업무 목록)$/i.test(prompt)) {
    return { type: 'function', function: { name: 'showTaskCard' } };
  }
  if (/^(write|파일|수정|변경|작성|생성)/i.test(prompt)) {
    return { type: 'function', function: { name: 'workspaceApproval' } };
  }
  return 'auto';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseToolCall(value: unknown): OpenAIToolCall {
  if (!isRecord(value)) throw new OpenAIProviderError('tool');
  const id = boundedText(value.id, 200);
  const type = value.type;
  const functionValue = value.function;
  if (!id || type !== 'function' || !isRecord(functionValue)) throw new OpenAIProviderError('tool');
  const name = boundedText(functionValue.name, 80);
  const args = typeof functionValue.arguments === 'string' ? functionValue.arguments : '';
  if (!name || !args || args.length > MAX_TOOL_ARGUMENTS_LENGTH) throw new OpenAIProviderError('tool');
  return { id, type: 'function', function: { name, arguments: args } };
}

function parseAssistant(payload: OpenAIChatResponse): ParsedAssistant {
  const choice = payload.choices?.[0];
  if (!choice?.message || !isRecord(choice.message)) throw new OpenAIProviderError('response');
  const rawToolCalls = choice.message.tool_calls;
  if (rawToolCalls !== undefined && !Array.isArray(rawToolCalls)) throw new OpenAIProviderError('tool');
  const toolCalls = (rawToolCalls ?? []).map(parseToolCall);
  if (toolCalls.length > MAX_TOOL_CALLS) throw new OpenAIProviderError('tool');
  return { content: boundedText(choice.message.content), toolCalls };
}

function parseArguments(toolCall: OpenAIToolCall): Record<string, unknown> {
  if (!['showWeatherCard', 'showTaskCard', 'workspaceApproval'].includes(toolCall.function.name)) {
    throw new OpenAIProviderError('tool');
  }
  let value: unknown;
  try {
    value = JSON.parse(toolCall.function.arguments);
  } catch {
    throw new OpenAIProviderError('tool');
  }
  if (!isRecord(value)) throw new OpenAIProviderError('tool');
  if (toolCall.function.name === 'showWeatherCard' || toolCall.function.name === 'showTaskCard') {
    if (Object.keys(value).length > 0) throw new OpenAIProviderError('tool');
    return {};
  }
  if (Object.keys(value).some((key) => key !== 'prompt')) throw new OpenAIProviderError('tool');
  const prompt = boundedText(value.prompt, 2_000);
  if (!prompt || /[\u0000-\u001f\u007f]/.test(prompt)) throw new OpenAIProviderError('tool');
  return { prompt };
}

function toolEnvelope(tool: ResponseToolEvent, text: string, model: string): GenUiEnvelopeV1 {
  if (tool.name === 'showWeatherCard' && tool.weather) {
    const weather = tool.weather;
    return responseEnvelope({
      kind: 'weather',
      id: `weather-${weather.location.latitude}-${weather.location.longitude}`,
      title: '현재 위치 날씨',
      text,
      aiGenerated: true,
      model,
      sections: [{
        type: 'weather',
        location: weather.location.name,
        latitude: weather.location.latitude,
        longitude: weather.location.longitude,
        timezone: weather.location.timezone,
        temperature: weather.current.temperature,
        apparentTemperature: weather.current.apparentTemperature,
        humidity: weather.current.humidity,
        windSpeed: weather.current.windSpeed,
        precipitation: weather.current.precipitation,
        condition: weather.current.condition,
        icon: weather.current.icon,
        source: weather.source,
        observedAt: weather.current.time,
      }],
    });
  }
  if (tool.name === 'showTaskCard') {
    const tasks = tool.args as unknown as TaskToolArgs;
    return responseEnvelope({
      kind: 'task-list',
      id: 'workspace-list',
      title: '업무 목록',
      text,
      aiGenerated: true,
      model,
      sections: [{
        type: 'list',
        title: '업무',
        items: tasks.items.map((item) => ({ id: item.id, label: item.title, status: item.status })),
      }],
    });
  }
  const approval = tool.args as unknown as ApprovalToolArgs;
  return responseEnvelope({
    kind: 'approval',
    id: approval.jobId,
    title: '쓰기 작업 승인 필요',
    text,
    aiGenerated: true,
    model,
    status: 'approval',
    sections: [{ type: 'status', title: '승인 경계', status: 'awaiting_approval', description: approval.prompt }],
  });
}

function buildMessages(input: ResponseEngineInput): OpenAIMessage[] {
  const system = [
    '너는 Teams 업무 허브의 GenAI 업무 도우미다.',
    '짧고 자연스러운 한국어로 답하고, 업무 목록·날씨·파일 변경 요청에는 제공된 도구를 사용한다.',
    '날씨 도구는 현재 위치 컨텍스트가 있을 때만 사용한다. 위치 컨텍스트가 없으면 좌표를 추측하지 말고 탭의 “내 위치 사용”을 안내한다.',
    '파일 변경은 반드시 workspaceApproval 도구를 사용해 승인 카드를 먼저 보여준다.',
    `현재 위치 날씨 컨텍스트: ${locationSystemContext(input)}`,
  ].join('\n');
  return [{ role: 'system', content: system.slice(0, MAX_MESSAGE_LENGTH) }, ...getMessageHistory(input)];
}

export class OpenAIResponseEngine implements ResponseEngine {
  readonly mode = 'openai' as const;

  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAIResponseEngineOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async run(input: ResponseEngineInput): Promise<ResponseEngineOutput> {
    if (input.isCancelled?.()) return cancelledOutput();

    try {
      const config = this.readConfig();
      if (!config.apiKey) return providerErrorOutput(new OpenAIProviderError('configuration'));
      let messages = buildMessages(input);
      let toolEvents: ResponseToolEvent[] = [];
      let toolChoice: { type: 'function'; function: { name: string } } | 'auto' = forcedToolChoice(input.prompt);

      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (input.isCancelled?.()) return cancelledOutput();
        const completion = await this.requestCompletion(config, messages, toolChoice, input);
        const assistant = parseAssistant(completion);

        if (assistant.toolCalls.length === 0) {
          const text = assistant.content || toolEvents.at(-1)?.result;
          if (!text) throw new OpenAIProviderError('response');
          input.onText?.(text);
          const envelope = toolEvents[0]
            ? toolEnvelope(toolEvents[0], text, config.model)
            : responseEnvelope({ kind: 'answer', id: 'openai-answer', title: '업무 허브 답변', text, aiGenerated: true, model: config.model });
          return { text, envelope, toolCalls: toolEvents };
        }

        if (attempt > 0) throw new OpenAIProviderError('tool');
        const validatedToolCalls = assistant.toolCalls.map((toolCall) => {
          const args = parseArguments(toolCall);
          if (toolCall.function.name === 'showWeatherCard' && !isLiveWeather(contextValue(input, '날씨'))) {
            throw new OpenAIProviderError('location');
          }
          return { toolCall, args };
        });
        messages = [
          ...messages,
          { role: 'assistant', content: assistant.content || null, tool_calls: assistant.toolCalls },
        ];
        for (const { toolCall, args } of validatedToolCalls) {
          const event = await this.executeTool(toolCall, input, args);
          toolEvents = [...toolEvents, event];
          input.onTool?.(event);
          messages.push({ role: 'tool', tool_call_id: toolCall.id, content: event.result });
        }
        toolChoice = 'auto';
      }
    } catch (error) {
      return providerErrorOutput(error);
    }

    return errorOutput('GenAI 요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.', 'openai-request-error');
  }

  private readConfig(): OpenAIConfig {
    const apiKey = (this.options.apiKey ?? process.env.OPENAI_API_KEY ?? '').trim();
    const rawBaseUrl = (this.options.baseUrl ?? process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL).trim().replace(/\/$/, '');
    const model = boundedText(this.options.model ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL, MAX_MODEL_LENGTH);
    let baseUrl: URL;
    try {
      baseUrl = new URL(rawBaseUrl);
    } catch {
      throw new OpenAIProviderError('configuration');
    }
    if (!['http:', 'https:'].includes(baseUrl.protocol) || !model) throw new OpenAIProviderError('configuration');
    const configuredTimeout = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeoutMs = Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.round(configuredTimeout)));
    return { apiKey, baseUrl: rawBaseUrl, model, timeoutMs };
  }

  private async requestCompletion(
    config: OpenAIConfig,
    messages: OpenAIMessage[],
    toolChoice: { type: 'function'; function: { name: string } } | 'auto',
    input: ResponseEngineInput,
  ): Promise<OpenAIChatResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    const cancellationPoll = setInterval(() => {
      if (input.isCancelled?.()) controller.abort();
    }, 25);
    try {
      const response = await this.fetchImpl(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          messages: messages[0]?.role === 'system'
            ? [messages[0], ...messages.slice(1).slice(-MAX_CONVERSATION_MESSAGES)]
            : messages.slice(-MAX_CONVERSATION_MESSAGES),
          tools: LLM_TOOLS,
          tool_choice: toolChoice,
          parallel_tool_calls: false,
          max_tokens: 900,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new OpenAIProviderError('http');
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new OpenAIProviderError('response');
      }
      if (!isRecord(payload)) throw new OpenAIProviderError('response');
      return payload as OpenAIChatResponse;
    } catch (error) {
      if (input.isCancelled?.()) throw new OpenAIProviderError('cancelled');
      if (error instanceof OpenAIProviderError) throw error;
      if (controller.signal.aborted) throw new OpenAIProviderError('timeout');
      throw new OpenAIProviderError('network');
    } finally {
      clearTimeout(timeout);
      clearInterval(cancellationPoll);
    }
  }

  private async executeTool(
    toolCall: OpenAIToolCall,
    input: ResponseEngineInput,
    args: Record<string, unknown>,
  ): Promise<ResponseToolEvent> {
    if (toolCall.function.name === 'showWeatherCard') {
      const contextWeather = contextValue(input, '날씨');
      if (!isLiveWeather(contextWeather)) throw new OpenAIProviderError('location');
      const weather = contextWeather;
      return {
        name: 'showWeatherCard',
        args: compactWeather(weather) as unknown as Record<string, unknown>,
        result: formatWeatherMessage(weather, false),
        weather,
      };
    }
    if (toolCall.function.name === 'showTaskCard') {
      const tasks = compactTasks(input);
      return {
        name: 'showTaskCard',
        args: tasks as unknown as Record<string, unknown>,
        result: formatTasks(tasks),
      };
    }

    const prompt = boundedText(args.prompt, 2_000);
    const job = await input.agentService.submit({
      prompt,
      mode: 'workspace-write',
      scope: input.scope,
      notify: false,
    });
    input.setActiveJobId?.(job.id);
    const approval: ApprovalToolArgs = { jobId: job.id, prompt, action: 'approve' };
    return {
      name: 'workspaceApproval',
      args: approval as unknown as Record<string, unknown>,
      result: `승인 대기 중인 작업 ${job.id}`,
    };
  }
}
