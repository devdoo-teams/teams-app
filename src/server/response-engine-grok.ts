import { randomUUID } from 'node:crypto';

import {
  GENUI_SCHEMA_VERSION,
  GenUiEnvelopeV1Schema,
  type GenUiEnvelopeV1,
} from '../shared/genui.js';
import type { AgentJob } from './agent-job-store.js';
import { redactSensitiveText, redactSensitiveValue } from './sensitive-text.js';
import {
  LLM_TOOLS,
  type ResponseEngine,
  type ResponseEngineInput,
  type ResponseEngineOutput,
  type ResponseToolEvent,
} from './response-engine.js';
import { formatWeatherMessage, type WeatherResponse } from './weather-service.js';

const DEFAULT_BASE_URL = 'https://api.x.ai/v1';
const XAI_PRODUCTION_HOST = 'api.x.ai';
const XAI_PRODUCTION_PATH = '/v1';
const LOOPBACK_TEST_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const DEFAULT_MODEL = 'grok-4.6';
const MAX_CONVERSATION_MESSAGES = 10;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_SYSTEM_CONTEXT_LENGTH = 2_000;
const MAX_TOOL_ARGUMENTS_LENGTH = 4_000;
const MAX_TOOL_CALLS = 3;
const MAX_TOOL_ROUNDS = 3;
const MAX_MODEL_LENGTH = 120;
const MAX_API_KEY_LENGTH = 512;
const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 10;
const MAX_TIMEOUT_MS = 30_000;
const MAX_HTTP_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [100, 200] as const;

type GrokResponseEngineOptions = {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleepImpl?: (delayMs: number) => Promise<void>;
};

type GrokConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
};

type GrokInputItem = {
  role: 'user' | 'assistant';
  content: string;
};

type GrokFunctionCallOutput = {
  type: 'function_call_output';
  call_id: string;
  output: string;
};

type GrokRequestItem = GrokInputItem | GrokFunctionCallOutput;

type GrokToolCall = {
  id: string;
  callId: string;
  name: string;
  arguments: string;
};

type ParsedGrokResponse = {
  id: string;
  content: string;
  toolCalls: GrokToolCall[];
};

type GrokToolChoice = 'auto' | 'required' | 'none' | { type: 'function'; function: { name: string } };

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

class GrokProviderError extends Error {
  constructor(readonly code: 'configuration' | 'invalid-url' | 'timeout' | 'network' | 'response' | 'tool' | 'tool-round-limit' | 'duplicate-tool-call' | 'location' | 'cancelled' | 'http-401' | 'http-403' | 'http-404' | 'http-422' | 'http-429' | 'http-5xx' | 'http-4xx' | 'http-other') {
    super(code);
    this.name = 'GrokProviderError';
  }
}

function boundedText(value: unknown, maxLength = MAX_MESSAGE_LENGTH): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function safeProviderText(value: string, maxLength = MAX_MESSAGE_LENGTH, secret?: string): string {
  const withoutSecret = secret && secret.length >= 8
    ? value.split(secret).join('[REDACTED]')
    : value;
  return redactSensitiveText(withoutSecret).slice(0, maxLength);
}

function safeProviderValue(value: unknown): unknown {
  return redactSensitiveValue(value);
}

function httpErrorCode(status: number): 'http-401' | 'http-403' | 'http-404' | 'http-422' | 'http-429' | 'http-5xx' | 'http-4xx' | 'http-other' {
  if (status === 401) return 'http-401';
  if (status === 403) return 'http-403';
  if (status === 404) return 'http-404';
  if (status === 422) return 'http-422';
  if (status === 429) return 'http-429';
  if (status >= 500 && status <= 599) return 'http-5xx';
  if (status >= 400 && status <= 499) return 'http-4xx';
  return 'http-other';
}

function isRetryableHttpCode(code: GrokProviderError['code']): boolean {
  return code === 'http-429' || code === 'http-5xx';
}

function isTransientNetworkError(error: unknown): boolean {
  return error instanceof TypeError;
}

function boundedModel(value: unknown): string {
  const model = boundedText(value, MAX_MODEL_LENGTH);
  return model && !/[\u0000-\u001f\u007f]/.test(model) ? model : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function textContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (!isRecord(part)) return '';
      return typeof part.text === 'string'
        ? part.text
        : typeof part.content === 'string'
          ? part.content
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
  secret?: string;
}): GenUiEnvelopeV1 {
  const safeText = safeProviderText(input.text, MAX_MESSAGE_LENGTH, input.secret);
  const metadata: Record<string, string | boolean> = {
    source: 'xai',
    provider: 'grok',
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
      id: `grok-error-${code}`,
      title: 'Grok 응답을 처리하지 못했습니다',
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
      id: 'grok-cancelled',
      title: '요청 취소',
      text,
      aiGenerated: false,
    }),
    toolCalls: [],
  };
}

function providerErrorOutput(error: unknown): ResponseEngineOutput {
  if (error instanceof GrokProviderError) {
    if (error.code === 'cancelled') return cancelledOutput();
    if (error.code === 'configuration') {
      return errorOutput('Grok이 설정되지 않았습니다. 서버에 XAI_API_KEY를 설정하거나 결정형 모드로 전환하세요.', 'grok-not-configured');
    }
    if (error.code === 'invalid-url') {
      return errorOutput('Grok 제공자 주소 설정이 올바르지 않습니다. 운영 환경에서는 https://api.x.ai/v1만 사용할 수 있습니다.', 'grok-invalid-url');
    }
    if (error.code === 'timeout') return errorOutput('Grok 응답 시간이 초과되었습니다. 잠시 후 다시 시도하세요.', 'grok-timeout');
    if (error.code === 'tool') return errorOutput('Grok이 유효하지 않은 도구 요청을 반환했습니다. 요청을 다시 시도하세요.', 'grok-invalid-tool');
    if (error.code === 'tool-round-limit') return errorOutput('Grok 도구 처리 라운드가 제한을 초과했습니다. 요청을 다시 시도하세요.', 'grok-tool-round-limit');
    if (error.code === 'duplicate-tool-call') return errorOutput('Grok이 동일한 도구 요청을 반복했습니다. 요청을 다시 시도하세요.', 'grok-duplicate-tool-call');
    if (error.code === 'location') return errorOutput('현재 위치 날씨 컨텍스트가 없습니다. 탭의 “내 위치 사용” 버튼을 눌러 위치 권한을 허용한 뒤 다시 시도하세요.', 'grok-location-required');
    if (error.code === 'http-401') return errorOutput('Grok 인증이 거부되었습니다. 서버의 XAI_API_KEY를 확인하세요.', 'grok-http-401');
    if (error.code === 'http-403') return errorOutput('Grok 사용 권한이 없습니다. xAI 팀 또는 API 키 권한을 확인하세요.', 'grok-http-403');
    if (error.code === 'http-404') return errorOutput('Grok 모델 또는 API 주소를 찾을 수 없습니다. 서버 설정을 확인하세요.', 'grok-http-404');
    if (error.code === 'http-422') return errorOutput('Grok 요청 형식이 올바르지 않습니다. 요청 설정을 확인하세요.', 'grok-http-422');
    if (error.code === 'http-429') return errorOutput('Grok 요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.', 'grok-http-429');
    if (error.code === 'http-5xx') return errorOutput('Grok 서비스에 일시적인 장애가 있습니다. 잠시 후 다시 시도하세요.', 'grok-http-5xx');
    if (error.code === 'http-4xx') return errorOutput('Grok 요청이 거부되었습니다. 서버 설정과 요청을 확인하세요.', 'grok-http-4xx');
    if (error.code === 'http-other') return errorOutput('Grok 제공자 요청이 실패했습니다. 잠시 후 다시 시도하세요.', 'grok-http-other');
    if (error.code === 'response') return errorOutput('Grok 제공자의 응답 형식을 확인할 수 없습니다. 잠시 후 다시 시도하세요.', 'grok-invalid-response');
    return errorOutput('Grok 제공자 요청에 실패했습니다. 잠시 후 다시 시도하세요.', 'grok-provider-error');
  }
  return errorOutput('Grok 요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.', 'grok-request-error');
}

function getMessageHistory(input: ResponseEngineInput): GrokInputItem[] {
  const messages = input.request.messages
    .map((message): GrokInputItem | null => {
      if (message.role !== 'user' && message.role !== 'assistant') return null;
      const content = boundedText(textContent(message.content));
      return content ? { role: message.role, content } : null;
    })
    .filter((message): message is GrokInputItem => message !== null)
    .slice(-MAX_CONVERSATION_MESSAGES);

  if (messages.length > 0) return messages;
  return [{ role: 'user', content: boundedText(input.prompt) }];
}

function locationSystemContext(input: ResponseEngineInput): string {
  const weather = contextValue(input, '날씨');
  if (!isLiveWeather(weather)) return '없음';
  return JSON.stringify(weather).slice(0, MAX_SYSTEM_CONTEXT_LENGTH);
}

function buildInstructions(input: ResponseEngineInput): string {
  return [
    '너는 Teams 업무 허브의 Grok 업무 도우미다.',
    '짧고 자연스러운 한국어로 답하고, 업무 목록·날씨·파일 변경 요청에는 제공된 도구를 사용한다.',
    '날씨 도구는 현재 위치 컨텍스트가 있을 때만 사용한다. 위치 컨텍스트가 없으면 좌표를 추측하지 말고 탭의 “내 위치 사용”을 안내한다.',
    '파일 변경은 반드시 workspaceApproval 도구를 사용해 승인 카드를 먼저 보여준다.',
    `현재 위치 날씨 컨텍스트: ${locationSystemContext(input)}`,
  ].join('\n').slice(0, MAX_MESSAGE_LENGTH);
}

function forcedToolChoice(prompt: string): GrokToolChoice {
  if (/(날씨|weather)/i.test(prompt)) return { type: 'function', function: { name: 'showWeatherCard' } };
  if (/(업무|할 일|task).*(목록|리스트|보여|확인)|^(list|업무 목록)$/i.test(prompt)) {
    return { type: 'function', function: { name: 'showTaskCard' } };
  }
  if (/^(write|파일|수정|변경|작성|생성)/i.test(prompt)) {
    return { type: 'function', function: { name: 'workspaceApproval' } };
  }
  return 'auto';
}

function grokTools(): Array<Record<string, unknown>> {
  return LLM_TOOLS.map((tool) => ({
    type: 'function',
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }));
}

function parseToolCall(value: unknown): GrokToolCall {
  if (!isRecord(value) || value.type !== 'function_call') throw new GrokProviderError('tool');
  if (value.role !== undefined && value.role !== 'assistant') throw new GrokProviderError('response');
  if (value.status !== undefined && value.status !== 'completed') throw new GrokProviderError('response');
  const callId = boundedText(value.call_id, 200);
  const id = boundedText(value.id, 200) || callId;
  const name = boundedText(value.name, 80);
  const args = typeof value.arguments === 'string' ? value.arguments : '';
  if (!id || !callId || !name || !args || args.length > MAX_TOOL_ARGUMENTS_LENGTH) {
    throw new GrokProviderError('tool');
  }
  return { id, callId, name, arguments: args };
}

function parseAssistant(payload: unknown): ParsedGrokResponse {
  if (!isRecord(payload) || !Array.isArray(payload.output)) throw new GrokProviderError('response');
  if (payload.status !== 'completed') throw new GrokProviderError('response');
  if (payload.error !== undefined && payload.error !== null) throw new GrokProviderError('response');
  if (payload.incomplete_details !== undefined && payload.incomplete_details !== null) {
    throw new GrokProviderError('response');
  }
  if (payload.object !== undefined && payload.object !== 'response') throw new GrokProviderError('response');
  const id = boundedText(payload.id, 200);
  if (!id) throw new GrokProviderError('response');

  const content: string[] = [];
  const toolCalls: GrokToolCall[] = [];
  for (const item of payload.output) {
    if (!isRecord(item)) throw new GrokProviderError('response');
    if (item.type === 'function_call') {
      toolCalls.push(parseToolCall(item));
      continue;
    }
    if (item.type === 'reasoning') {
      if (item.status !== undefined && item.status !== 'completed') throw new GrokProviderError('response');
      continue;
    }
    if (
      item.type !== 'message'
      || item.role !== 'assistant'
      || (item.status !== undefined && item.status !== 'completed')
    ) {
      throw new GrokProviderError('response');
    }
    if (!Array.isArray(item.content)) throw new GrokProviderError('response');
    for (const part of item.content) {
      if (!isRecord(part) || part.type !== 'output_text' || typeof part.text !== 'string') {
        throw new GrokProviderError('response');
      }
      content.push(part.text);
    }
  }
  if (toolCalls.length > MAX_TOOL_CALLS) throw new GrokProviderError('tool');
  return { id, content: boundedText(content.join('\n')), toolCalls };
}

function parseArguments(toolCall: GrokToolCall): Record<string, unknown> {
  if (!['showWeatherCard', 'showTaskCard', 'workspaceApproval'].includes(toolCall.name)) {
    throw new GrokProviderError('tool');
  }
  let value: unknown;
  try {
    value = JSON.parse(toolCall.arguments);
  } catch {
    throw new GrokProviderError('tool');
  }
  if (!isRecord(value)) throw new GrokProviderError('tool');
  if (toolCall.name === 'showWeatherCard' || toolCall.name === 'showTaskCard') {
    if (Object.keys(value).length > 0) throw new GrokProviderError('tool');
    return {};
  }
  if (Object.keys(value).some((key) => key !== 'prompt')) throw new GrokProviderError('tool');
  const prompt = boundedText(value.prompt, 2_000);
  if (!prompt || /[\u0000-\u001f\u007f]/.test(prompt)) throw new GrokProviderError('tool');
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

export class GrokResponseEngine implements ResponseEngine {
  readonly mode = 'grok' as const;

  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (delayMs: number) => Promise<void>;

  constructor(private readonly options: GrokResponseEngineOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleepImpl = options.sleepImpl ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  }

  async run(input: ResponseEngineInput): Promise<ResponseEngineOutput> {
    if (input.isCancelled?.()) return cancelledOutput();

    try {
      const config = this.readConfig();
      let responseInput: GrokRequestItem[] = getMessageHistory(input);
      let previousResponseId: string | undefined;
      let toolEvents: ResponseToolEvent[] = [];
      let approvalEnvelope: GenUiEnvelopeV1 | undefined;
      let toolChoice: GrokToolChoice = forcedToolChoice(input.prompt);
      let toolRound = 0;
      const executedCallIds = new Set<string>();

      while (true) {
        if (input.isCancelled?.()) return cancelledOutput();
        const completion = await this.requestResponse(config, input, responseInput, previousResponseId, toolChoice);
        const assistant = parseAssistant(completion);

        if (assistant.toolCalls.length === 0) {
          const text = safeProviderText(assistant.content || toolEvents.at(-1)?.result || '', MAX_MESSAGE_LENGTH, config.apiKey);
          if (!text) throw new GrokProviderError('response');
          input.onText?.(text);
          const envelope = approvalEnvelope ?? (toolEvents[0]
            ? toolEnvelope(toolEvents[0], text, config.model)
            : responseEnvelope({ kind: 'answer', id: 'grok-answer', title: '업무 허브 답변', text, aiGenerated: true, model: config.model, secret: config.apiKey }));
          return { text, envelope, toolCalls: toolEvents };
        }

        if (toolRound >= MAX_TOOL_ROUNDS) throw new GrokProviderError('tool-round-limit');

        // Validate the complete tool batch before executing any call. This is
        // the mutation boundary that prevents an unknown call from allowing a
        // preceding workspaceApproval call to partially change server state.
        const batchCallIds = new Set<string>();
        const validatedToolCalls = assistant.toolCalls.map((toolCall) => {
          if (batchCallIds.has(toolCall.callId) || executedCallIds.has(toolCall.callId)) {
            throw new GrokProviderError('duplicate-tool-call');
          }
          batchCallIds.add(toolCall.callId);
          const args = parseArguments(toolCall);
          if (toolCall.name === 'showWeatherCard' && !isLiveWeather(contextValue(input, '날씨'))) {
            throw new GrokProviderError('location');
          }
          return { toolCall, args };
        });

        const toolOutputs: GrokFunctionCallOutput[] = [];
        for (const { toolCall, args } of validatedToolCalls) {
          if (input.isCancelled?.()) return cancelledOutput();
          const executed = await this.executeTool(toolCall, input, args);
          const event = executed.event;
          toolEvents = [...toolEvents, event];
          executedCallIds.add(toolCall.callId);
          approvalEnvelope = executed.approvalEnvelope ?? approvalEnvelope;
          input.onTool?.(event);
          toolOutputs.push({
            type: 'function_call_output',
            call_id: toolCall.callId,
            output: event.result.slice(0, MAX_MESSAGE_LENGTH),
          });
        }

        previousResponseId = assistant.id;
        responseInput = toolOutputs;
        toolChoice = 'auto';
        toolRound += 1;
      }
    } catch (error) {
      return providerErrorOutput(error);
    }

    return errorOutput('Grok 요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.', 'grok-request-error');
  }

  private readConfig(): GrokConfig {
    const configuredApiKey = (this.options.apiKey ?? process.env.XAI_API_KEY ?? '').trim();
    const rawBaseUrl = (this.options.baseUrl ?? process.env.XAI_BASE_URL ?? DEFAULT_BASE_URL).trim().replace(/\/$/, '');
    let baseUrl: URL;
    try {
      baseUrl = new URL(rawBaseUrl);
    } catch {
      throw new GrokProviderError('invalid-url');
    }
    const productionBaseUrl = baseUrl.protocol === 'https:'
      && baseUrl.hostname === XAI_PRODUCTION_HOST
      && baseUrl.pathname === XAI_PRODUCTION_PATH
      && !baseUrl.port
      && !baseUrl.username
      && !baseUrl.password
      && !baseUrl.search
      && !baseUrl.hash;
    const loopbackTestBaseUrl = baseUrl.protocol === 'http:'
      && LOOPBACK_TEST_HOSTS.has(baseUrl.hostname)
      && baseUrl.pathname === XAI_PRODUCTION_PATH
      && !baseUrl.username
      && !baseUrl.password
      && !baseUrl.search
      && !baseUrl.hash
      && process.env.NODE_ENV === 'test'
      && process.env.XAI_ALLOW_LOOPBACK_TEST === 'true'
      && process.env.TEAMS_LOCAL_DEV === 'true'
      && process.env.TEAMS_SKIP_AUTH === 'true';
    if (!productionBaseUrl && !loopbackTestBaseUrl) {
      throw new GrokProviderError('invalid-url');
    }

    // A loopback fixture must never receive the configured production key.
    // Its explicit test-only key is kept separate from XAI_API_KEY and is the
    // only credential permitted on the mock request path.
    const apiKey = loopbackTestBaseUrl
      ? (process.env.XAI_LOOPBACK_TEST_KEY ?? '').trim()
      : configuredApiKey;
    if (!apiKey || apiKey.length > MAX_API_KEY_LENGTH || /[\u0000-\u001f\u007f]/.test(apiKey)) {
      throw new GrokProviderError('configuration');
    }

    const model = boundedModel(this.options.model ?? process.env.XAI_MODEL ?? DEFAULT_MODEL);
    if (!model) throw new GrokProviderError('configuration');
    const configuredTimeout = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeoutMs = Number.isFinite(configuredTimeout)
      ? Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.round(configuredTimeout)))
      : DEFAULT_TIMEOUT_MS;
    return { apiKey, baseUrl: rawBaseUrl, model, timeoutMs };
  }

  private async requestResponse(
    config: GrokConfig,
    input: ResponseEngineInput,
    responseInput: GrokRequestItem[],
    previousResponseId: string | undefined,
    toolChoice: GrokToolChoice,
  ): Promise<unknown> {
    const body: Record<string, unknown> = {
      model: config.model,
      input: this.boundInput(responseInput),
      tools: grokTools(),
      tool_choice: toolChoice,
      parallel_tool_calls: false,
      max_output_tokens: 900,
    };
    if (previousResponseId) body.previous_response_id = previousResponseId;
    else body.instructions = buildInstructions(input);

    let lastRetryableError = new GrokProviderError('network');
    for (let attempt = 0; attempt < MAX_HTTP_ATTEMPTS; attempt += 1) {
      if (input.isCancelled?.()) throw new GrokProviderError('cancelled');

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      const cancellationPoll = setInterval(() => {
        if (input.isCancelled?.()) controller.abort();
      }, 25);
      try {
        const response = await this.fetchImpl(`${config.baseUrl}/responses`, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${config.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok) throw new GrokProviderError(httpErrorCode(response.status));
        try {
          return await response.json();
        } catch {
          throw new GrokProviderError('response');
        }
      } catch (error) {
        if (input.isCancelled?.()) throw new GrokProviderError('cancelled');
        if (error instanceof GrokProviderError) {
          if (!isRetryableHttpCode(error.code) || attempt === MAX_HTTP_ATTEMPTS - 1) throw error;
          lastRetryableError = error;
        } else if (controller.signal.aborted) {
          throw new GrokProviderError('timeout');
        } else if (!isTransientNetworkError(error)) {
          throw new GrokProviderError('network');
        } else {
          const networkError = new GrokProviderError('network');
          if (attempt === MAX_HTTP_ATTEMPTS - 1) throw networkError;
          lastRetryableError = networkError;
        }
      } finally {
        clearTimeout(timeout);
        clearInterval(cancellationPoll);
      }

      if (input.isCancelled?.()) throw new GrokProviderError('cancelled');
      await this.sleepImpl(RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS.at(-1)!);
      if (input.isCancelled?.()) throw new GrokProviderError('cancelled');
    }
    throw lastRetryableError;
  }

  private boundInput(items: GrokRequestItem[]): GrokRequestItem[] {
    return items.slice(-MAX_CONVERSATION_MESSAGES).map((item) => {
      if ('type' in item) {
        return {
          type: 'function_call_output',
          call_id: boundedText(item.call_id, 200),
          output: boundedText(item.output),
        };
      }
      return {
        role: item.role,
        content: boundedText(item.content),
      };
    });
  }

  private async executeTool(
    toolCall: GrokToolCall,
    input: ResponseEngineInput,
    args: Record<string, unknown>,
  ): Promise<{ event: ResponseToolEvent; approvalEnvelope?: GenUiEnvelopeV1 }> {
    if (toolCall.name === 'showWeatherCard') {
      const contextWeather = contextValue(input, '날씨');
      if (!isLiveWeather(contextWeather)) throw new GrokProviderError('location');
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
    if (toolCall.name === 'showTaskCard') {
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

export type { GrokResponseEngineOptions };
