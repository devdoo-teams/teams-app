import type { AgentJobScope } from './agent-job-store.js';
import type { AgentService } from './agent-service.js';
import type { ItemStore } from './item-store.js';
import type { WeatherResponse } from './weather-service.js';
import type { RunAgentInput } from '@ag-ui/core';
import type { GenUiEnvelopeV1 } from '../shared/genui.js';
import type { ResponseMode } from '../shared/response-mode.js';

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

export class ResponseEngineRouter {
  private readonly engines = new Map<ResponseMode, ResponseEngine>();

  constructor(engines: Iterable<ResponseEngine> = []) {
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

  run(input: ResponseEngineInput): Promise<ResponseEngineOutput> {
    return this.get(input.mode).run(input);
  }
}
