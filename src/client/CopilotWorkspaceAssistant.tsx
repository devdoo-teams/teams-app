import {
  CopilotKit,
  CopilotChat,
  useCopilotChatConfiguration,
  useAgentContext,
  useRenderTool,
} from '@copilotkit/react-core/v2';
import type { RenderToolProps } from '@copilotkit/react-core/v2/headless';
import { useState, type ReactNode } from 'react';
import { z } from 'zod';

import { apiFetch, getCachedAuthHeaders } from './auth.js';
import type { PublicResponseMode } from './ResponseModeSelector.js';
import { GenUiCard } from './genui/GenUiCard.js';
import './genui/genui.css';
import {
  createApprovalResultEnvelope,
  createApprovalToolEnvelope,
  createTaskToolEnvelope,
  createWeatherToolEnvelope,
  getGenAiBadgeLabel,
} from './genui/tool-adapters.js';
import {
  GENUI_SCHEMA_VERSION,
  GenUiEnvelopeV1Schema,
  type GenUiEnvelopeV1,
} from '../shared/genui.js';

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
  genAI: 'openai-configured' | 'grok-configured' | 'not-configured' | 'deterministic-test';
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

function createApprovalConflictEnvelope(jobId: string, prompt: string, message: string): GenUiEnvelopeV1 {
  const safeId = jobId.trim().slice(0, 120) || 'copilot-approval-conflict';
  const safePrompt = prompt.trim().slice(0, 2_000) || '쓰기 작업';
  const safeMessage = message.trim().slice(0, 1_900) || '작업 상태가 변경되어 요청을 처리하지 못했습니다.';
  const description = `${safeMessage}\n\n요청 작업: ${safePrompt}`.slice(0, 2_000);
  return GenUiEnvelopeV1Schema.parse({
    schemaVersion: GENUI_SCHEMA_VERSION,
    kind: 'error',
    status: 'error',
    id: `${safeId}-conflict`,
    correlationId: `${safeId}-conflict`,
    title: '작업 상태 충돌',
    summary: safeMessage,
    sections: [{
      type: 'status',
      title: '최신 작업 상태 확인 필요',
      status: 'conflict',
      tone: 'danger',
      description,
    }],
    actions: [],
    citations: [],
    aiGenerated: false,
    fallbackText: safeMessage,
    metadata: { source: 'copilotkit-approval', deterministic: true },
  });
}

function WeatherToolCard({ status, parameters, result }: WeatherRenderProps) {
  const envelope = createWeatherToolEnvelope(parameters, status, result);
  return <GenUiCard envelope={envelope} theme="auto" className="copilot-tool-genui-card" />;
}

function TaskToolCard({ status, parameters }: TaskRenderProps) {
  const envelope = createTaskToolEnvelope(parameters, status);
  return <GenUiCard envelope={envelope} theme="auto" className="copilot-tool-genui-card" />;
}

function ApprovalToolCard({ status, parameters }: ApprovalRenderProps) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [resolvedAction, setResolvedAction] = useState<'approve' | 'cancel' | null>(null);
  const [mutationError, setMutationError] = useState('');
  const chatConfiguration = useCopilotChatConfiguration();
  const jobId = parameters.jobId?.trim();
  const prompt = parameters.prompt?.trim();
  const envelope = mutationError && jobId && prompt
    ? createApprovalConflictEnvelope(jobId, prompt, mutationError)
    : resolvedAction && jobId && prompt
    ? createApprovalResultEnvelope({ jobId, prompt }, resolvedAction, message)
    : createApprovalToolEnvelope(parameters, status);

  async function resolve(action: 'approve' | 'cancel'): Promise<void> {
    const conversationId = chatConfiguration?.threadId;
    if (!conversationId) {
      setMessage('Copilot 대화 context가 없어 작업을 처리할 수 없습니다. 채팅을 다시 연 뒤 시도하세요.');
      return;
    }
    if (!jobId) {
      setMessage('승인 작업 ID가 없어 작업을 처리할 수 없습니다.');
      return;
    }
    setBusy(true);
    setResolvedAction(null);
    setMutationError('');
    setMessage('처리 중…');
    try {
      const response = await apiFetch(`/api/agent-jobs/${encodeURIComponent(jobId)}/${action}`, {
        method: 'POST',
        body: JSON.stringify({ conversationId }),
        headers: { 'content-type': 'application/json' },
      });
      const body = (await response.json()) as { job?: { status?: string }; error?: string };
      if (!response.ok) {
        const errorMessage = body.error || '작업을 처리하지 못했습니다.';
        setMutationError(errorMessage);
        setMessage(errorMessage);
        return;
      }
      setMessage(`작업 상태: ${body.job?.status || action}`);
      setResolvedAction(action);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '작업을 처리하지 못했습니다.';
      setMutationError(errorMessage);
      setMessage(errorMessage);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="copilot-tool-genui-card">
      <GenUiCard envelope={envelope} theme="auto" />
      {status === 'complete' && !resolvedAction && !mutationError && jobId && prompt && (
        <div className="genui-card__actions-wrap" aria-label="쓰기 작업 승인 작업">
          <div className="genui-card__actions">
            <button className="genui-card__action genui-card__action--primary" disabled={busy} onClick={() => void resolve('approve')} type="button">
              {busy ? '처리 중…' : '승인'}
            </button>
            <button className="genui-card__action genui-card__action--danger" disabled={busy} onClick={() => void resolve('cancel')} type="button">
              {busy ? '처리 중…' : '취소'}
            </button>
          </div>
          {message && <p className="copilot-tool-result" aria-live="polite">{message}</p>}
        </div>
      )}
      {message && resolvedAction && <p className="copilot-tool-result" aria-live="polite">{message}</p>}
    </div>
  );
}

export type CopilotWorkspaceAssistantProps = {
  weather: WeatherContext | null;
  items: WorkspaceItem[];
  summary: { total: number; open: number; done: number };
  health: WorkspaceHealth | null;
  responseMode: PublicResponseMode | null;
};

export function CopilotWorkspaceAssistant(props: CopilotWorkspaceAssistantProps) {
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
  useAgentContext({
    description: '현재 Teams 응답 모드(공개 메타데이터만 포함)',
    value: props.responseMode ?? { status: 'checking' },
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
        <div className="copilot-heading-badges">
          <span className="copilot-live-badge"><span aria-hidden="true" />{getGenAiBadgeLabel(props.health?.genAI)}</span>
          <span className="copilot-mode-badge">
            응답 모드 · {props.responseMode?.label ?? '확인 중'} · {props.responseMode?.configured ? '사용 가능' : '설정 필요'}
          </span>
        </div>
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

export function CopilotWorkspaceRuntime(props: CopilotWorkspaceAssistantProps & {
  children: ReactNode;
  teamsHostName: string;
}) {
  const { children, teamsHostName, ...assistantProps } = props;

  return (
    <CopilotKit
      agent="default"
      enableInspector={false}
      headers={getCachedAuthHeaders}
      onError={(event) => console.warn('CopilotKit runtime error', event.error)}
      properties={{
        surface: 'teams-tab',
        host: teamsHostName || 'browser',
        responseMode: props.responseMode?.mode ?? 'unknown',
        responseModeConfigured: props.responseMode?.configured ?? false,
      }}
      runtimeUrl="/api/copilotkit"
      useSingleEndpoint={false}
    >
      {children}
      <div className="shell copilot-shell">
        <CopilotWorkspaceAssistant {...assistantProps} />
      </div>
    </CopilotKit>
  );
}
