import { randomUUID } from 'node:crypto';

import {
  GENUI_SCHEMA_VERSION,
  GenUiEnvelopeV1Schema,
  type GenUiEnvelopeV1,
} from '../shared/genui.js';
import type { WeatherResponse } from './weather-service.js';
import { formatWeatherMessage } from './weather-service.js';
import { redactSensitiveText, redactSensitiveValue } from './sensitive-text.js';
import { parseLocalModelBaseUrl } from './local-model-url.js';
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

const DEFAULT_MODEL = 'local-model';
const MAX_CONVERSATION_MESSAGES = 10;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_SYSTEM_CONTEXT_LENGTH = 2_000;
const MAX_TOOL_ARGUMENTS_LENGTH = 4_000;
const MAX_TOOL_CALLS = 3;
const MAX_MODEL_LENGTH = 120;
const MAX_API_KEY_LENGTH = 512;
const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 10;
const MAX_TIMEOUT_MS = 30_000;

type LocalCompatibleResponseEngineOptions = {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

type LocalConfig = {
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

class LocalProviderError extends Error {
  constructor(readonly code: 'configuration' | 'invalid-url' | 'timeout' | 'network' | 'http' | 'response' | 'tool' | 'location' | 'cancelled') {
    super(code);
    this.name = 'LocalProviderError';
  }
}

function boundedText(value: unknown, maxLength = MAX_MESSAGE_LENGTH): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function safeProviderText(value: string, maxLength = MAX_MESSAGE_LENGTH): string {
  return redactSensitiveText(value).slice(0, maxLength);
}

function safeProviderValue(value: unknown): unknown {
  return redactSensitiveValue(value);
}

function boundedModel(value: unknown): string {
  const model = boundedText(value, MAX_MODEL_LENGTH);
  return model && !/[\u0000-\u001f\u007f]/.test(model) ? model : '';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
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
  const items = input.itemStore.list().slice(0, 24);
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
  const safeText = safeProviderText(input.text);
  const metadata: Record<string, string | boolean> = {
    source: 'local-compatible',
    provider: 'local-compatible',
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
    summary: safeText.slice(0, 2_000),
    sections: input.sections
      ? safeProviderValue(input.sections)
      : [{ type: 'text', text: safeText }],
    actions: [],
    citations: [],
    aiGenerated: input.aiGenerated,
    fallbackText: safeText,
    metadata: safeProviderValue(metadata) as Record<string, string | boolean>,
  });
}

function errorOutput(text: string, code: string): ResponseEngineOutput {
  return {
    text,
    envelope: responseEnvelope({
      kind: 'error',
      id: `local-error-${code}`,
      title: '로컬 GenAI 응답을 처리하지 못했습니다',
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
      id: 'local-cancelled',
      title: '요청 취소',
      text,
      aiGenerated: false,
    }),
    toolCalls: [],
  };
}

function providerErrorOutput(error: unknown): ResponseEngineOutput {
  if (error instanceof LocalProviderError) {
    if (error.code === 'cancelled') return cancelledOutput();
    if (error.code === 'configuration') {
      return errorOutput('로컬 GenAI가 설정되지 않았습니다. 서버에 LOCAL_MODEL_BASE_URL을 설정하거나 다른 응답 모드로 전환하세요.', 'local-not-configured');
    }
    if (error.code === 'invalid-url') {
      return errorOutput('로컬 GenAI 서버 주소 설정이 올바르지 않습니다. http 또는 https 주소를 서버 환경변수로 설정하세요.', 'local-invalid-url');
    }
    if (error.code === 'timeout') return errorOutput('로컬 GenAI 응답 시간이 초과되었습니다. 잠시 후 다시 시도하세요.', 'local-timeout');
    if (error.code === 'tool') return errorOutput('로컬 GenAI가 유효하지 않은 도구 요청을 반환했습니다. 요청을 다시 시도하세요.', 'local-invalid-tool');
    if (error.code === 'location') return errorOutput('현재 위치 날씨 컨텍스트가 없습니다. 탭의 “내 위치 사용” 버튼을 눌러 위치 권한을 허용한 뒤 다시 시도하세요.', 'local-location-required');
    if (error.code === 'http') return errorOutput('로컬 GenAI 제공자에 연결할 수 없습니다. 서버 설정과 제공자 상태를 확인하세요.', 'local-provider-http');
    if (error.code === 'response') return errorOutput('로컬 GenAI 제공자의 응답 형식을 확인할 수 없습니다. 잠시 후 다시 시도하세요.', 'local-invalid-response');
    return errorOutput('로컬 GenAI 제공자 요청에 실패했습니다. 잠시 후 다시 시도하세요.', 'local-provider-error');
  }
  return errorOutput('로컬 GenAI 요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.', 'local-request-error');
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

function parseToolCall(value: unknown): OpenAIToolCall {
  if (!isRecord(value)) throw new LocalProviderError('tool');
  const id = boundedText(value.id, 200);
  const functionValue = value.function;
  if (!id || value.type !== 'function' || !isRecord(functionValue)) throw new LocalProviderError('tool');
  const name = boundedText(functionValue.name, 80);
  const args = typeof functionValue.arguments === 'string' ? functionValue.arguments : '';
  if (!name || !args || args.length > MAX_TOOL_ARGUMENTS_LENGTH) throw new LocalProviderError('tool');
  return { id, type: 'function', function: { name, arguments: args } };
}

function parseAssistant(payload: OpenAIChatResponse): ParsedAssistant {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) throw new LocalProviderError('response');
  const choice = payload.choices[0];
  if (!choice || !isRecord(choice) || !isRecord(choice.message)) throw new LocalProviderError('response');
  const rawToolCalls = choice.message.tool_calls;
  if (rawToolCalls !== undefined && !Array.isArray(rawToolCalls)) throw new LocalProviderError('tool');
  const toolCalls = (rawToolCalls ?? []).map(parseToolCall);
  if (toolCalls.length > MAX_TOOL_CALLS) throw new LocalProviderError('tool');
  return { content: boundedText(choice.message.content), toolCalls };
}

function parseArguments(toolCall: OpenAIToolCall): Record<string, unknown> {
  if (!['showWeatherCard', 'showTaskCard', 'workspaceApproval'].includes(toolCall.function.name)) {
    throw new LocalProviderError('tool');
  }
  let value: unknown;
  try {
    value = JSON.parse(toolCall.function.arguments);
  } catch {
    throw new LocalProviderError('tool');
  }
  if (!isRecord(value)) throw new LocalProviderError('tool');
  if (toolCall.function.name === 'showWeatherCard' || toolCall.function.name === 'showTaskCard') {
    if (Object.keys(value).length > 0) throw new LocalProviderError('tool');
    return {};
  }
  if (Object.keys(value).some((key) => key !== 'prompt')) throw new LocalProviderError('tool');
  const prompt = boundedText(value.prompt, 2_000);
  if (!prompt || /[\u0000-\u001f\u007f]/.test(prompt)) throw new LocalProviderError('tool');
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
    '너는 Teams 업무 허브의 로컬 GenAI 업무 도우미다.',
    '짧고 자연스러운 한국어로 답하고, 업무 목록·날씨·파일 변경 요청에는 제공된 도구를 사용한다.',
    '날씨 도구는 현재 위치 컨텍스트가 있을 때만 사용한다. 위치 컨텍스트가 없으면 좌표를 추측하지 말고 탭의 “내 위치 사용”을 안내한다.',
    '파일 변경은 반드시 workspaceApproval 도구를 사용해 승인 카드를 먼저 보여준다.',
    `현재 위치 날씨 컨텍스트: ${locationSystemContext(input)}`,
  ].join('\n');
  return [{ role: 'system', content: system.slice(0, MAX_MESSAGE_LENGTH) }, ...getMessageHistory(input)];
}

export class LocalCompatibleResponseEngine implements ResponseEngine {
  readonly mode = 'local' as const;

  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: LocalCompatibleResponseEngineOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async run(input: ResponseEngineInput): Promise<ResponseEngineOutput> {
    if (input.isCancelled?.()) return cancelledOutput();

    try {
      const config = this.readConfig();
      let messages = buildMessages(input);
      let toolEvents: ResponseToolEvent[] = [];
      let approvalEnvelope: GenUiEnvelopeV1 | undefined;
      let toolChoice: { type: 'function'; function: { name: string } } | 'auto' = forcedToolChoice(input.prompt);

      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (input.isCancelled?.()) return cancelledOutput();
        const completion = await this.requestCompletion(config, messages, toolChoice, input);
        const assistant = parseAssistant(completion);

        if (assistant.toolCalls.length === 0) {
          const text = safeProviderText(assistant.content || toolEvents.at(-1)?.result || '');
          if (!text) throw new LocalProviderError('response');
          input.onText?.(text);
          const envelope = approvalEnvelope ?? (toolEvents[0]
            ? toolEnvelope(toolEvents[0], text, config.model)
            : responseEnvelope({ kind: 'answer', id: 'local-answer', title: '업무 허브 답변', text, aiGenerated: true, model: config.model }));
          return { text, envelope, toolCalls: toolEvents };
        }

        if (attempt > 0) throw new LocalProviderError('tool');
        const validatedToolCalls = assistant.toolCalls.map((toolCall) => {
          const args = parseArguments(toolCall);
          if (toolCall.function.name === 'showWeatherCard' && !isLiveWeather(contextValue(input, '날씨'))) {
            throw new LocalProviderError('location');
          }
          return { toolCall, args };
        });
        messages = [
          ...messages,
          { role: 'assistant', content: assistant.content || null, tool_calls: assistant.toolCalls },
        ];
        for (const { toolCall, args } of validatedToolCalls) {
          if (input.isCancelled?.()) return cancelledOutput();
          const executed = await this.executeTool(toolCall, input, args);
          const event = executed.event;
          toolEvents = [...toolEvents, event];
          approvalEnvelope = executed.approvalEnvelope ?? approvalEnvelope;
          input.onTool?.(event);
          messages.push({ role: 'tool', tool_call_id: toolCall.id, content: event.result.slice(0, MAX_MESSAGE_LENGTH) });
        }
        toolChoice = 'auto';
      }
    } catch (error) {
      return providerErrorOutput(error);
    }

    return errorOutput('로컬 GenAI 요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.', 'local-request-error');
  }

  private readConfig(): LocalConfig {
    const rawBaseUrl = (process.env.LOCAL_MODEL_BASE_URL ?? '').trim();
    if (!rawBaseUrl) throw new LocalProviderError('configuration');

    const baseUrl = parseLocalModelBaseUrl(rawBaseUrl);
    if (!baseUrl) throw new LocalProviderError('invalid-url');

    const model = boundedModel(process.env.LOCAL_MODEL_NAME || DEFAULT_MODEL);
    if (!model) throw new LocalProviderError('configuration');
    const apiKey = (process.env.LOCAL_MODEL_API_KEY ?? '').trim();
    if (apiKey.length > MAX_API_KEY_LENGTH || /[\u0000-\u001f\u007f]/.test(apiKey)) {
      throw new LocalProviderError('configuration');
    }
    const configuredTimeout = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeoutMs = Number.isFinite(configuredTimeout)
      ? Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.round(configuredTimeout)))
      : DEFAULT_TIMEOUT_MS;
    return { apiKey, baseUrl: baseUrl.toString().replace(/\/$/, ''), model, timeoutMs };
  }

  private async requestCompletion(
    config: LocalConfig,
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
          'content-type': 'application/json',
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          messages: this.boundMessages(messages),
          tools: LLM_TOOLS,
          tool_choice: toolChoice,
          parallel_tool_calls: false,
          max_tokens: 900,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new LocalProviderError('http');
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new LocalProviderError('response');
      }
      if (!isRecord(payload)) throw new LocalProviderError('response');
      return payload as OpenAIChatResponse;
    } catch (error) {
      if (input.isCancelled?.()) throw new LocalProviderError('cancelled');
      if (error instanceof LocalProviderError) throw error;
      if (controller.signal.aborted) throw new LocalProviderError('timeout');
      throw new LocalProviderError('network');
    } finally {
      clearTimeout(timeout);
      clearInterval(cancellationPoll);
    }
  }

  private boundMessages(messages: OpenAIMessage[]): OpenAIMessage[] {
    const system = messages.find((message) => message.role === 'system');
    const rest = messages.filter((message) => message !== system).slice(-MAX_CONVERSATION_MESSAGES);
    const bounded = [...(system ? [system] : []), ...rest].map((message) => ({
      ...message,
      content: message.content === null ? null : boundedText(message.content),
      tool_calls: message.tool_calls?.slice(0, MAX_TOOL_CALLS).map((toolCall) => ({
        ...toolCall,
        id: boundedText(toolCall.id, 200),
        function: { ...toolCall.function, name: boundedText(toolCall.function.name, 80), arguments: toolCall.function.arguments.slice(0, MAX_TOOL_ARGUMENTS_LENGTH) },
      })),
    }));
    return bounded;
  }

  private async executeTool(
    toolCall: OpenAIToolCall,
    input: ResponseEngineInput,
    args: Record<string, unknown>,
  ): Promise<{ event: ResponseToolEvent; approvalEnvelope?: GenUiEnvelopeV1 }> {
    if (toolCall.function.name === 'showWeatherCard') {
      const contextWeather = contextValue(input, '날씨');
      if (!isLiveWeather(contextWeather)) throw new LocalProviderError('location');
      const weather = contextWeather;
      return {
        event: {
          name: 'showWeatherCard',
          args: safeProviderValue(compactWeather(weather)) as Record<string, unknown>,
          result: safeProviderText(formatWeatherMessage(weather, false)),
          weather,
        },
      };
    }
    if (toolCall.function.name === 'showTaskCard') {
      const tasks = compactTasks(input);
      return {
        event: {
          name: 'showTaskCard',
          args: safeProviderValue(tasks) as Record<string, unknown>,
          result: safeProviderText(formatTasks(tasks)),
        },
      };
    }

    const prompt = safeProviderText(boundedText(args.prompt, 2_000), 2_000);
    const job = await input.agentService.submit({
      prompt,
      mode: 'workspace-write',
      scope: input.scope,
      notify: false,
    });
    input.setActiveJobId?.(job.id);
    const approval: ApprovalToolArgs = { jobId: job.id, prompt, action: 'approve' };
    return {
      event: {
        name: 'workspaceApproval',
        args: safeProviderValue(approval) as Record<string, unknown>,
        result: safeProviderText(`승인 대기 중인 작업 ${job.id}`),
      },
      approvalEnvelope: input.approvalEnvelope ? await input.approvalEnvelope(job) : undefined,
    };
  }
}
