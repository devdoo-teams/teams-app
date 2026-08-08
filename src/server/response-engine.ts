import type { AgentJobScope } from './agent-job-store.js';
import type { AgentService } from './agent-service.js';
import type { ItemStore } from './item-store.js';
import type { WeatherResponse } from './weather-service.js';
import type { RunAgentInput } from '@ag-ui/core';
import type { GenUiEnvelopeV1 } from '../shared/genui.js';
import type { ResponseMode } from '../shared/response-mode.js';

export type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
};

export type OpenAIToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type OpenAIChatResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
      tool_calls?: unknown;
    };
  }>;
};

/** The server-side tool contract shared with the existing OpenAI path. */
export const LLM_TOOLS = [
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

export type ResponseToolEvent = {
  name: 'showWeatherCard' | 'showTaskCard' | 'workspaceApproval';
  args: Record<string, unknown>;
  result: string;
  weather?: WeatherResponse;
};

export type ResponseEngineInput = {
  mode: ResponseMode;
  prompt: string;
  request: RunAgentInput;
  scope: AgentJobScope;
  itemStore: ItemStore;
  agentService: AgentService;
  onText?: (text: string) => void;
  onTool?: (tool: ResponseToolEvent) => void;
  setActiveJobId?: (id: string) => void;
  isCancelled?: () => boolean;
};

export type ResponseEngineOutput = {
  text: string;
  envelope: GenUiEnvelopeV1;
  toolCalls: ResponseToolEvent[];
};

export interface ResponseEngine {
  readonly mode: ResponseMode;
  run(input: ResponseEngineInput): Promise<ResponseEngineOutput>;
}

export type ResponseEngineModeResolver = (
  input: ResponseEngineInput,
) => ResponseMode | Promise<ResponseMode>;

let configuredModeResolver: ResponseEngineModeResolver | undefined;
const configuredEngines = new Map<ResponseMode, ResponseEngine>();

/**
 * Configure the server-owned defaults used by request-scoped Copilot agents.
 * The agent class is constructed by CopilotKit, so this small registry keeps
 * tenant-scoped mode selection out of client-controlled request fields while
 * allowing the server to register providers that are not part of the legacy
 * constructor call.
 */
export function configureResponseEngineRouter(options: {
  engines?: Iterable<ResponseEngine>;
  resolveMode?: ResponseEngineModeResolver;
}): void {
  configuredModeResolver = options.resolveMode;
  configuredEngines.clear();
  for (const engine of options.engines ?? []) configuredEngines.set(engine.mode, engine);
}

export class ResponseEngineRouter {
  private readonly engines = new Map<ResponseMode, ResponseEngine>();

  constructor(engines: Iterable<ResponseEngine> = []) {
    for (const engine of configuredEngines.values()) this.register(engine);
    for (const engine of engines) this.register(engine);
  }

  register(engine: ResponseEngine): this {
    this.engines.set(engine.mode, engine);
    return this;
  }

  get(mode: ResponseMode): ResponseEngine {
    const engine = this.engines.get(mode);
    if (!engine) throw new Error(`응답 엔진이 등록되지 않았습니다: ${mode}`);
    return engine;
  }

  async run(input: ResponseEngineInput): Promise<ResponseEngineOutput> {
    const mode = configuredModeResolver
      ? await configuredModeResolver(input)
      : input.mode;
    const selectedInput = mode === input.mode ? input : { ...input, mode };
    return this.get(mode).run(selectedInput);
  }
}
