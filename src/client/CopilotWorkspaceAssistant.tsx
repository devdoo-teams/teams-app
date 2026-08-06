import {
  CopilotChat,
  useCopilotChatConfiguration,
  useAgentContext,
  useRenderTool,
} from '@copilotkit/react-core/v2';
import type { RenderToolProps } from '@copilotkit/react-core/v2/headless';
import { useState } from 'react';
import { z } from 'zod';

import { apiFetch } from './auth.js';

type WeatherContext = {
  source: 'open-meteo' | 'demo';
  location: {
    name: string;
    latitude: number;
    longitude: number;
    timezone: string;
  };
  current: {
    temperature: number;
    apparentTemperature: number;
    humidity: number;
    precipitation: number;
    windSpeed: number;
    condition: string;
    icon: string;
  };
};

type WorkspaceItem = {
  id: number;
  title: string;
  status: 'open' | 'done';
};

type WorkspaceHealth = {
  ok: boolean;
  bot: 'teams-sdk' | 'local-handler';
  userAuth: string;
  genAI: 'openai-configured' | 'not-configured' | 'deterministic-test';
};

const weatherToolSchema = z.object({
  location: z.string(),
  temperature: z.number(),
  apparentTemperature: z.number(),
  humidity: z.number(),
  windSpeed: z.number(),
  precipitation: z.number(),
  condition: z.string(),
  source: z.string(),
});

const taskToolSchema = z.object({
  items: z.array(z.object({
    id: z.number(),
    title: z.string(),
    status: z.enum(['open', 'done']),
  })),
  total: z.number(),
  open: z.number(),
  done: z.number(),
});

const approvalToolSchema = z.object({
  jobId: z.string(),
  prompt: z.string(),
  action: z.enum(['approve', 'cancel']),
});

type WeatherRenderProps = RenderToolProps<typeof weatherToolSchema>;
type TaskRenderProps = RenderToolProps<typeof taskToolSchema>;
type ApprovalRenderProps = RenderToolProps<typeof approvalToolSchema>;

function WeatherToolCard({ status, parameters, result }: WeatherRenderProps) {
  if (status === 'inProgress') {
    return <div className="copilot-tool-card copilot-tool-loading">날씨 카드를 준비하고 있습니다…</div>;
  }

  return (
    <div className="copilot-tool-card copilot-weather-card">
      <div className="copilot-tool-title">
        <span aria-hidden="true">☀️</span>
        <span>날씨 위젯</span>
        <small>{parameters.location}</small>
      </div>
      <div className="copilot-weather-summary">
        <strong>{parameters.temperature.toFixed(1)}°</strong>
        <span>{parameters.condition}</span>
      </div>
      <div className="copilot-weather-stats">
        <span>체감 {parameters.apparentTemperature.toFixed(1)}°C</span>
        <span>습도 {Math.round(parameters.humidity)}%</span>
        <span>바람 {parameters.windSpeed.toFixed(1)}km/h</span>
        <span>강수 {parameters.precipitation.toFixed(1)}mm</span>
      </div>
      {status === 'complete' && <small className="copilot-tool-result">{parameters.source} 데이터</small>}
      {status === 'executing' && <small className="copilot-tool-result">카드 렌더링 중…</small>}
      {result && status === 'complete' && <details className="copilot-tool-details"><summary>응답 보기</summary><pre>{result}</pre></details>}
    </div>
  );
}

function TaskToolCard({ status, parameters }: TaskRenderProps) {
  if (status === 'inProgress') {
    return <div className="copilot-tool-card copilot-tool-loading">업무 카드를 준비하고 있습니다…</div>;
  }

  return (
    <div className="copilot-tool-card copilot-task-card">
      <div className="copilot-tool-title">
        <span aria-hidden="true">✓</span>
        <span>업무 현황</span>
        <small>{parameters.open}개 진행 중</small>
      </div>
      <div className="copilot-task-summary">
        <strong>{parameters.total}</strong>
        <span>전체 업무</span>
        <strong>{parameters.done}</strong>
        <span>완료</span>
      </div>
      <ul>
        {parameters.items.filter((item) => item.status === 'open').slice(0, 5).map((item) => (
          <li key={item.id}>{item.title}</li>
        ))}
      </ul>
    </div>
  );
}

function ApprovalToolCard({ status, parameters }: ApprovalRenderProps) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const chatConfiguration = useCopilotChatConfiguration();

  async function resolve(action: 'approve' | 'cancel'): Promise<void> {
    const conversationId = chatConfiguration?.threadId;
    if (!conversationId) {
      setMessage('Copilot 대화 context가 없어 작업을 처리할 수 없습니다. 채팅을 다시 연 뒤 시도하세요.');
      return;
    }
    setBusy(true);
    setMessage('처리 중…');
    try {
      const response = await apiFetch(`/api/agent-jobs/${parameters.jobId}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ conversationId }),
        headers: { 'content-type': 'application/json' },
      });
      const body = (await response.json()) as { job?: { status?: string }; error?: string };
      if (!response.ok) throw new Error(body.error || '작업을 처리하지 못했습니다.');
      setMessage(`작업 상태: ${body.job?.status || action}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '작업을 처리하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  if (status === 'inProgress') {
    return <div className="copilot-tool-card copilot-tool-loading">승인 카드를 준비하고 있습니다…</div>;
  }

  return (
    <div className="copilot-tool-card copilot-approval-card">
      <div className="copilot-tool-title">
        <span aria-hidden="true">!</span>
        <span>쓰기 작업 승인</span>
        <small>{parameters.jobId}</small>
      </div>
      <p>{parameters.prompt}</p>
      <div className="copilot-approval-actions">
        <button className="primary" disabled={busy} onClick={() => void resolve('approve')} type="button">
          승인
        </button>
        <button className="secondary" disabled={busy} onClick={() => void resolve('cancel')} type="button">
          취소
        </button>
      </div>
      {message && <small className="copilot-tool-result">{message}</small>}
    </div>
  );
}

export function CopilotWorkspaceAssistant(props: {
  weather: WeatherContext | null;
  items: WorkspaceItem[];
  summary: { total: number; open: number; done: number };
  health: WorkspaceHealth | null;
}) {
  useAgentContext({
    description: '현재 Teams 업무 허브 날씨 위젯 상태',
    value: props.weather ?? { status: 'location-not-resolved' },
  });
  useAgentContext({
    description: '현재 Teams 업무 목록 요약',
    value: { items: props.items, summary: props.summary },
  });
  useAgentContext({
    description: '현재 Teams 런타임 상태',
    value: props.health ?? { status: 'checking' },
  });

  useRenderTool({
    name: 'showWeatherCard',
    parameters: weatherToolSchema,
    render: (renderProps) => <WeatherToolCard {...renderProps} />,
  }, []);
  useRenderTool({
    name: 'showTaskCard',
    parameters: taskToolSchema,
    render: (renderProps) => <TaskToolCard {...renderProps} />,
  }, []);
  useRenderTool({
    name: 'workspaceApproval',
    parameters: approvalToolSchema,
    render: (renderProps) => <ApprovalToolCard {...renderProps} />,
  }, []);

  return (
    <section className="copilot-panel" aria-label="CopilotKit 업무 도우미">
      <div className="copilot-panel-heading">
        <div>
          <p className="eyebrow">GENAI · COPILOTKIT · AG-UI</p>
          <h2>업무 도우미</h2>
          <p>모델이 선택한 도구 결과를 날씨·업무·승인 카드로 표시합니다.</p>
        </div>
        <span className="copilot-live-badge"><span aria-hidden="true" />{props.health?.genAI === 'openai-configured' ? 'GenAI 연결됨' : 'GenAI 설정 필요'}</span>
      </div>
      <CopilotChat
        agentId="default"
        labels={{
          chatInputPlaceholder: '업무나 날씨를 요청하세요…',
          modalHeaderTitle: 'Teams 업무 도우미',
          welcomeMessageText: '현재 업무, 위치 날씨, Codex 작업을 도와드릴게요.',
        }}
        className="copilot-chat"
      />
    </section>
  );
}
