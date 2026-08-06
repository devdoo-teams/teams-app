import { randomUUID } from 'node:crypto';

import type { AgentJob } from './agent-job-store.js';
import {
  DEMO_COORDINATES,
  formatWeatherMessage,
  getWeather,
  type WeatherResponse,
} from './weather-service.js';
import {
  GENUI_SCHEMA_VERSION,
  GenUiEnvelopeV1Schema,
  type GenUiEnvelopeV1,
} from '../shared/genui.js';
import type {
  ResponseEngine,
  ResponseEngineInput,
  ResponseEngineOutput,
  ResponseToolEvent,
} from './response-engine.js';

type TaskToolArgs = {
  items: Array<{ id: number; title: string; status: 'open' | 'done' }>;
  total: number;
  open: number;
  done: number;
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

type ApprovalToolArgs = {
  jobId: string;
  prompt: string;
  action: 'approve' | 'cancel';
};

function contextValue(input: ResponseEngineInput, keyword: string): unknown {
  const context = input.request.context.find((entry) => entry.description.toLowerCase().includes(keyword));
  if (!context) return undefined;
  try {
    return JSON.parse(context.value) as unknown;
  } catch {
    return undefined;
  }
}

function isWeather(value: unknown): value is WeatherResponse {
  const weather = value as WeatherResponse | undefined;
  return Boolean(
    weather?.location?.name
      && Number.isFinite(weather.location.latitude)
      && Number.isFinite(weather.location.longitude)
      && weather.current,
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
    source: weather.source === 'demo' ? '데모' : 'Open-Meteo',
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

function formatJobs(input: ResponseEngineInput): string {
  const jobs = input.agentService.list(input.scope, 5);
  if (jobs.length === 0) return 'Codex 작업이 없습니다.';
  return jobs.map((job) => `- ${job.id}: ${job.status}`).join('\n');
}

function envelope(input: {
  kind: GenUiEnvelopeV1['kind'];
  id: string;
  title: string;
  text: string;
  status?: GenUiEnvelopeV1['status'];
  sections?: GenUiEnvelopeV1['sections'];
}): GenUiEnvelopeV1 {
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
    aiGenerated: false,
    fallbackText: input.text,
    metadata: { source: 'copilotkit', deterministic: true },
  });
}

function jobEnvelope(job: AgentJob, text: string, status: GenUiEnvelopeV1['status'] = 'complete'): GenUiEnvelopeV1 {
  return envelope({
    kind: 'job-status',
    id: job.id,
    title: 'Codex 작업 상태',
    text,
    status,
    sections: [{
      type: 'status',
      title: '작업 상태',
      status: job.status,
      description: [job.error, job.result, job.progress.at(-1)].filter(Boolean).join('\n'),
    }],
  });
}

export class DeterministicResponseEngine implements ResponseEngine {
  readonly mode = 'deterministic' as const;

  async run(input: ResponseEngineInput): Promise<ResponseEngineOutput> {
    const prompt = input.prompt.trim();
    const toolCalls: ResponseToolEvent[] = [];
    const emitTool = (tool: ResponseToolEvent): void => {
      toolCalls.push(tool);
      input.onTool?.(tool);
    };
    const cancelled = (): boolean => input.isCancelled?.() === true;

    if (!prompt) {
      const text = '요청 내용을 입력해 주세요.';
      return { text, envelope: envelope({ kind: 'answer', id: 'empty-request', title: '업무 허브', text }), toolCalls };
    }

    const normalized = prompt.toLowerCase();
    if (/^(help|도움|사용법|명령)/i.test(normalized)) {
      const text = 'CopilotKit 데모 명령\n\n- 현재 업무 목록 보여줘\n- 현재 위치 날씨 보여줘\n- Codex 작업 상태 알려줘\n- 저장소를 분석해줘\n- write로 파일 변경 작업을 요청하면 승인 카드가 표시됩니다.';
      return { text, envelope: envelope({ kind: 'answer', id: 'help', title: '업무 허브 명령 안내', text }), toolCalls };
    }

    if (/(업무|할 일|task).*(목록|리스트|보여|확인)|^(list|업무 목록)$/i.test(normalized)) {
      const tasks = compactTasks(input);
      const text = formatTasks(tasks);
      emitTool({ name: 'showTaskCard', args: tasks as unknown as Record<string, unknown>, result: text });
      return {
        text,
        envelope: envelope({
          kind: 'task-list', id: 'workspace-list', title: '업무 목록', text,
          sections: [{ type: 'list', title: '업무', items: tasks.items.map((item) => ({ id: item.id, label: item.title, status: item.status })) }],
        }),
        toolCalls,
      };
    }

    if (/(날씨|weather)/i.test(normalized)) {
      const contextWeather = contextValue(input, '날씨');
      const weather = isWeather(contextWeather)
        ? contextWeather
        : await getWeather(DEMO_COORDINATES.latitude, DEMO_COORDINATES.longitude, { demo: true });
      const text = `${formatWeatherMessage(weather, weather.source === 'demo')}\n\n탭의 “내 위치 사용” 버튼을 누르면 Teams 모바일 위치 권한으로 실시간 위치를 갱신할 수 있습니다.`;
      emitTool({ name: 'showWeatherCard', args: compactWeather(weather) as unknown as Record<string, unknown>, result: text, weather });
      return {
        text,
        envelope: envelope({
          kind: 'weather', id: `weather-${weather.location.latitude}-${weather.location.longitude}`, title: '현재 위치 날씨', text,
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
        }),
        toolCalls,
      };
    }

    if (/^(status|상태|진행 상태)/i.test(normalized)) {
      const text = `활성 Codex 작업 ${input.agentService.countActive(input.scope)}개\n\n${formatJobs(input)}`;
      return {
        text,
        envelope: envelope({ kind: 'job-status', id: 'workspace-status', title: '업무 허브 상태', text, sections: [{ type: 'status', status: 'ready', description: text }] }),
        toolCalls,
      };
    }

    if (/^(write|파일|수정|변경|작성|생성)/i.test(normalized)) {
      const requestedPrompt = prompt.replace(/^(write|파일(?:을|이)?\s*(?:변경|수정)?|수정|변경|작성|생성)\s*/i, '').trim() || '요청한 변경 작업';
      const job = await input.agentService.submit({ prompt: requestedPrompt, mode: 'workspace-write', scope: input.scope, notify: false });
      const args: ApprovalToolArgs = { jobId: job.id, prompt: requestedPrompt, action: 'approve' };
      const text = `쓰기 작업 ${job.id}이 승인 대기 중입니다.\n\nTeams Bot에서 “approve ${job.id}”를 보내거나 아래 승인 흐름을 사용하세요.`;
      emitTool({ name: 'workspaceApproval', args, result: `승인 대기 중인 작업 ${job.id}` });
      return {
        text,
        envelope: envelope({ kind: 'approval', id: job.id, title: '쓰기 작업 승인 필요', text, status: 'approval', sections: [{ type: 'status', title: '승인 경계', status: 'awaiting_approval', description: requestedPrompt }] }),
        toolCalls,
      };
    }

    const previous = input.agentService.latestCompletedForConversation(input.scope);
    const onProgress = async (message: string): Promise<void> => {
      if (!cancelled()) input.onText?.(`⏳ ${message}`);
    };
    const job = previous
      ? await input.agentService.continue(previous.id, prompt, input.scope, { notify: false, onProgress })
      : await input.agentService.submit({ prompt, mode: 'read-only', scope: input.scope, notify: false, onProgress });
    if (!job) throw new Error('Codex 작업을 생성하지 못했습니다.');
    input.setActiveJobId?.(job.id);
    const completed = await input.agentService.waitForTerminal(job.id, input.scope);
    const text = completed.status === 'completed'
      ? completed.result || `작업 ${completed.id}이 완료되었습니다.`
      : `작업 ${completed.id}이 ${completed.status} 상태입니다.\n\n${completed.error || completed.progress.at(-1) || '추가 확인이 필요합니다.'}`;
    return { text, envelope: jobEnvelope(completed, text), toolCalls };
  }
}
