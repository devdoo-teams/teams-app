import { randomUUID } from 'node:crypto';

import type { AgentJob } from './agent-job-store.js';
import type { GenUiActionStore } from './genui-action-store.js';
import type { Item } from './item-store.js';
import type { WeatherResponse } from './weather-service.js';
import {
  GENUI_SCHEMA_VERSION,
  GenUiEnvelopeV1Schema,
  type GenUiAction,
  type GenUiEnvelopeV1,
  type GenUiState,
} from '../shared/genui.js';

export type GenUiNotification = {
  kind: 'job-status' | 'result' | 'error';
  jobId: string;
  status?: string;
  message: string;
};

export type GenUiJobAction = 'approve' | 'cancel';

function jobFallback(job: AgentJob): string {
  const lines = [
    `작업 ID: ${job.id}`,
    `상태: ${job.status}`,
    `권한: ${job.mode}`,
  ];

  if (job.threadId) lines.push(`Codex thread: ${job.threadId}`);
  if (job.commitHash) lines.push(`Git commit: ${job.commitHash}`);
  if (job.commitMessage && !job.commitHash) lines.push(`Git: ${job.commitMessage}`);
  if (job.progress.length > 0) lines.push(`최근 진행: ${job.progress[job.progress.length - 1]}`);
  if (job.error) lines.push(`오류: ${job.error}`);
  if (job.result) lines.push(`결과:\n${job.result.slice(0, 5000)}`);
  return lines.join('\n');
}

function stateForJob(job: AgentJob): GenUiState {
  if (job.status === 'awaiting_approval') return 'approval';
  if (job.status === 'completed') return 'complete';
  if (job.status === 'failed') return 'error';
  if (job.status === 'queued' || job.status === 'running') return 'loading';
  return 'ready';
}

export class GenUiResponseFactory {
  constructor(private readonly actionStore: GenUiActionStore) {}

  private create(input: {
    kind: GenUiEnvelopeV1['kind'];
    id: string;
    correlationId?: string;
    status?: GenUiState;
    title: string;
    summary?: string;
    sections: Array<Record<string, unknown>>;
    fallbackText: string;
    actions?: GenUiAction[];
    metadata?: Record<string, string | number | boolean | null>;
  }): GenUiEnvelopeV1 {
    return GenUiEnvelopeV1Schema.parse({
      schemaVersion: GENUI_SCHEMA_VERSION,
      correlationId: randomUUID(),
      aiGenerated: false,
      actions: [],
      citations: [],
      ...input,
    });
  }

  answer(text: string, id = `answer-${randomUUID()}`): GenUiEnvelopeV1 {
    return this.create({
      kind: 'answer',
      id,
      title: '업무 허브',
      summary: text,
      sections: [{ type: 'text', text }],
      fallbackText: text,
      metadata: { source: 'teams-bot', deterministic: true },
    });
  }

  help(): GenUiEnvelopeV1 {
    const text = '사용 가능한 명령: help, weather [위도 경도], status, list, run <작업>, continue <작업 ID> <추가 요청>, write <작업>, approve <작업 ID>, commit <작업 ID> [메시지], cancel <작업 ID>';
    return this.create({
      kind: 'answer',
      id: 'help',
      title: '업무 허브 명령 안내',
      summary: 'Teams 모바일에서 사용할 수 있는 명령입니다.',
      sections: [{ type: 'text', title: '명령', text }],
      fallbackText: text,
      metadata: { source: 'teams-bot', deterministic: true },
    });
  }

  install(scopeHint: string): GenUiEnvelopeV1 {
    const text = `업무 허브가 ${scopeHint}에 추가되었습니다. 탭에서 업무와 현재 위치 날씨를 확인하고, help·날씨·status·list 명령으로 기능을 사용할 수 있습니다.`;
    return this.create({
      kind: 'answer',
      id: 'installation',
      title: '업무 허브 설치 완료',
      summary: text,
      sections: [{ type: 'text', title: '시작하기', text }],
      fallbackText: text,
      metadata: { source: 'teams-bot', deterministic: true },
    });
  }

  weatherUnavailable(): GenUiEnvelopeV1 {
    const text = 'Bot 대화에는 현재 기기 위치가 자동으로 전달되지 않습니다. Teams 탭에서 “내 위치 사용”을 누르거나, weather 37.5665 126.978처럼 좌표를 함께 입력하세요.';
    return this.create({
      kind: 'answer',
      id: 'weather-location-required',
      title: '현재 위치 날씨',
      summary: '날씨를 조회하려면 위치 또는 좌표가 필요합니다.',
      sections: [{ type: 'text', title: '위치 입력 안내', text }],
      fallbackText: text,
      metadata: { source: 'teams-bot', deterministic: true },
    });
  }

  invalidCoordinates(): GenUiEnvelopeV1 {
    const text = '위도는 -90~90, 경도는 -180~180 범위로 입력하세요. 예: weather 37.5665 126.978';
    return this.error(text, 'weather-invalid-coordinates');
  }

  weather(weather: WeatherResponse, hint?: string): GenUiEnvelopeV1 {
    const { current, location } = weather;
    const text = [
      `날씨 위젯 · ${location.name}`,
      `${current.condition} · ${current.temperature.toFixed(1)}°C (체감 ${current.apparentTemperature.toFixed(1)}°C)`,
      `습도 ${Math.round(current.humidity)}% · 바람 ${current.windSpeed.toFixed(1)}km/h · 강수 ${current.precipitation.toFixed(1)}mm`,
      `좌표 ${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)} · ${location.timezone}`,
      `데이터: ${weather.source === 'demo' ? '데모' : 'Open-Meteo'}`,
      hint,
    ].filter(Boolean).join('\n');
    return this.create({
      kind: 'weather',
      id: `weather-${location.latitude.toFixed(4)}-${location.longitude.toFixed(4)}`,
      title: '현재 위치 날씨',
      summary: `${location.name} · ${current.temperature.toFixed(1)}°C · ${current.condition}`,
      sections: [{
        type: 'weather',
        location: location.name,
        latitude: location.latitude,
        longitude: location.longitude,
        timezone: location.timezone,
        temperature: current.temperature,
        apparentTemperature: current.apparentTemperature,
        humidity: current.humidity,
        windSpeed: current.windSpeed,
        precipitation: current.precipitation,
        condition: current.condition,
        icon: current.icon,
        source: weather.source,
        observedAt: current.time,
      }],
      fallbackText: text,
      metadata: { source: weather.source, deterministic: true },
    });
  }

  status(openCount: number, activeCount: number): GenUiEnvelopeV1 {
    const text = `현재 진행 중인 업무는 ${openCount}개이며, 에이전트 활성 작업은 ${activeCount}개입니다.`;
    return this.create({
      kind: 'job-status',
      id: 'workspace-status',
      title: '업무 허브 상태',
      summary: text,
      sections: [{ type: 'stats', title: '현재 상태', stats: [
        { label: '진행 중 업무', value: openCount },
        { label: '활성 Codex 작업', value: activeCount },
      ] }],
      fallbackText: text,
      metadata: { source: 'teams-bot', deterministic: true },
    });
  }

  list(items: Item[], jobs: AgentJob[]): GenUiEnvelopeV1 {
    const openItems = items.filter((item) => item.status === 'open').slice(0, 8);
    const itemText = openItems.length === 0 ? '진행 중인 업무가 없습니다.' : `진행 중인 업무:\n${openItems.map((item) => `- ${item.title}`).join('\n')}`;
    const jobText = jobs.length === 0 ? '에이전트 작업이 없습니다.' : `최근 에이전트 작업:\n${jobs.map((job) => `- ${job.id}: ${job.status}`).join('\n')}`;
    return this.create({
      kind: 'task-list',
      id: 'workspace-list',
      title: '업무 목록',
      summary: `${openItems.length}개 업무 · ${jobs.length}개 최근 Codex 작업`,
      sections: [
        { type: 'list', title: '진행 중인 업무', items: openItems.map((item) => ({ id: String(item.id), label: item.title, status: item.status })) },
        { type: 'list', title: '최근 Codex 작업', items: jobs.map((job) => ({ id: job.id, label: job.prompt, status: job.status })) },
      ],
      fallbackText: `${itemText}\n\n${jobText}`,
      metadata: { source: 'teams-bot', deterministic: true },
    });
  }

  jobStatus(job: AgentJob | undefined): GenUiEnvelopeV1 {
    if (!job) return this.error('작업을 찾을 수 없습니다.');
    const text = `작업 ${job.id}: ${job.status}`;
    return this.create({
      kind: 'job-status',
      id: job.id,
      status: stateForJob(job),
      title: 'Codex 작업 상태',
      summary: text,
      sections: [
        { type: 'status', status: job.status, description: [job.error, job.result, job.progress.at(-1)].filter(Boolean).join('\n') },
        { type: 'list', title: '최근 진행 기록', items: job.progress.slice(-8).map((message, index) => ({ id: `${job.id}-${index}`, label: message })) },
      ],
      fallbackText: jobFallback(job),
      metadata: { source: 'teams-bot', deterministic: true },
    });
  }

  async approval(job: AgentJob): Promise<GenUiEnvelopeV1> {
    const correlationId = randomUUID();
    const common = { entityId: job.id, correlationId, conversationId: job.conversationId, requesterId: job.requesterId };
    const approveToken = await this.actionStore.issue({ ...common, action: 'approve' });
    const cancelToken = await this.actionStore.issue({ ...common, action: 'cancel' });
    const actions: GenUiAction[] = [
      { action: 'approve', label: '승인', entityId: job.id, correlationId, actionToken: approveToken, style: 'positive' },
      { action: 'cancel', label: '취소', entityId: job.id, correlationId, actionToken: cancelToken, style: 'destructive' },
    ];
    const text = `쓰기 작업 ${job.id}이 승인 대기 중입니다. 승인하면 Codex가 작업을 실행합니다.`;
    return GenUiEnvelopeV1Schema.parse({
      ...this.create({
        kind: 'approval',
        id: job.id,
        status: 'approval',
        title: '쓰기 작업 승인 필요',
        summary: text,
        sections: [{ type: 'status', title: '승인 경계', status: 'awaiting_approval', description: job.prompt }],
        fallbackText: `${text}\napprove ${job.id} 또는 cancel ${job.id}`,
        actions,
        metadata: { source: 'teams-bot', deterministic: true },
      }),
      correlationId,
    });
  }

  approvalAccepted(job: AgentJob): GenUiEnvelopeV1 {
    const text = `작업 ${job.id} 승인을 처리했습니다.\nstatus ${job.id}`;
    return this.create({
      kind: 'job-status',
      id: job.id,
      status: stateForJob(job),
      title: '쓰기 작업 승인 처리',
      summary: text,
      sections: [{ type: 'status', title: '승인 결과', status: job.status, description: job.prompt }],
      fallbackText: text,
      metadata: { source: 'teams-bot', deterministic: true },
    });
  }

  cancelled(job: AgentJob): GenUiEnvelopeV1 {
    const text = `작업 ${job.id} 취소를 처리했습니다.\n상태: ${job.status}`;
    return this.create({
      kind: 'result',
      id: job.id,
      status: job.status === 'cancelled' ? 'complete' : stateForJob(job),
      title: '작업 취소 결과',
      summary: text,
      sections: [{ type: 'status', title: '취소 결과', status: job.status, description: job.prompt }],
      fallbackText: text,
      metadata: { source: 'teams-bot', deterministic: true },
    });
  }

  continued(job: AgentJob): GenUiEnvelopeV1 {
    const text = `작업 ${job.id}이 이전 Codex thread에서 이어집니다.\nstatus ${job.id}`;
    return this.create({
      kind: 'job-status',
      id: job.id,
      status: 'loading',
      title: 'Codex 대화 이어서 실행',
      summary: text,
      sections: [{ type: 'status', title: '재개 결과', status: job.status, description: job.prompt }],
      fallbackText: text,
      metadata: { source: 'teams-bot', deterministic: true },
    });
  }

  naturalLanguageStarted(job: AgentJob): GenUiEnvelopeV1 {
    const text = `자연어 작업 ${job.id}을 읽기 전용으로 시작했습니다.\nstatus ${job.id}`;
    return this.create({
      kind: 'job-status',
      id: job.id,
      status: 'loading',
      title: '자연어 Codex 작업 시작',
      summary: text,
      sections: [{ type: 'status', title: '작업 요청', status: job.status, description: job.prompt }],
      fallbackText: text,
      metadata: { source: 'teams-bot', deterministic: true },
    });
  }

  commitResult(job: AgentJob | undefined, missing = false): GenUiEnvelopeV1 {
    if (!job) return this.error('커밋할 작업을 찾을 수 없습니다.');
    const text = missing
      ? `작업 ${job.id}은 아직 커밋할 수 없습니다. 현재 상태: ${job.status}`
      : job.commitMessage || '커밋할 변경이 없습니다.';
    return this.create({
      kind: missing ? 'error' : 'result',
      id: job.id,
      status: missing ? 'error' : 'complete',
      title: missing ? '커밋 대기 중' : '커밋 결과',
      summary: text,
      sections: [{ type: 'status', title: 'Git 결과', status: job.status, description: text }],
      fallbackText: text,
      metadata: { source: 'teams-bot', deterministic: true },
    });
  }

  actionAccepted(action: GenUiJobAction, job: AgentJob): GenUiEnvelopeV1 {
    return action === 'approve' ? this.approvalAccepted(job) : this.cancelled(job);
  }

  started(job: AgentJob): GenUiEnvelopeV1 {
    const text = `${job.mode === 'workspace-write' ? '쓰기' : '읽기 전용'} Codex 작업 ${job.id}을 시작했습니다. status ${job.id}로 진행 상태를 확인할 수 있습니다.`;
    return this.create({
      kind: 'job-status', id: job.id, status: 'loading', title: 'Codex 작업 시작', summary: text,
      sections: [{ type: 'status', status: job.status, description: job.prompt }], fallbackText: text,
      metadata: { source: 'teams-bot', deterministic: true },
    });
  }

  notification(notification: GenUiNotification, job?: AgentJob): GenUiEnvelopeV1 {
    const current = job?.status ?? notification.status ?? (notification.kind === 'error' ? 'failed' : 'running');
    const kind = notification.kind;
    const status: GenUiState = kind === 'result' ? 'complete' : kind === 'error' ? 'error' : 'loading';
    return this.create({
      kind, id: notification.jobId, status, title: kind === 'result' ? 'Codex 작업 완료' : kind === 'error' ? 'Codex 작업 오류' : 'Codex 작업 진행',
      summary: notification.message, sections: [{ type: 'status', status: current, description: notification.message }],
      fallbackText: notification.message, metadata: { source: 'agent-service', deterministic: true },
    });
  }

  actionError(message: string, id = 'genui-action-error'): GenUiEnvelopeV1 {
    return this.error(message, id);
  }

  error(message: string, id = 'error'): GenUiEnvelopeV1 {
    return this.create({
      kind: 'error', id, status: 'error', title: '업무 허브 오류', summary: message,
      sections: [{ type: 'status', status: 'error', description: message }], fallbackText: message,
      metadata: { source: 'teams-bot', deterministic: true },
    });
  }
}
