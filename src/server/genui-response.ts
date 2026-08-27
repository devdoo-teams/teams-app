import { randomUUID } from 'node:crypto';

import type { AgentJob } from './agent-job-store.js';
import type { AgentNotification } from './agent-service.js';
import type { GenUiActionStore } from './genui-action-store.js';
import type { Item } from './item-store.js';
import type { WeatherResponse } from './weather-service.js';
import { redactSensitiveText } from './sensitive-text.js';
import { normalizeCliCapability, type CliCapability } from './codex-capability.js';
import {
  GENUI_SCHEMA_VERSION,
  GENUI_COMMANDS,
  GenUiEnvelopeV1Schema,
  type GenUiAction,
  type GenUiEnvelopeV1,
  type GenUiImage,
  type GenUiState,
  isSafeGenUiUrl,
} from '../shared/genui.js';

export type GenUiNotification = AgentNotification;

export type GenUiJobAction = 'approve' | 'cancel';

export type GenUiResponseFactoryOptions = {
  openTabUrl?: string;
  agentLabel?: string;
};

export type GenUiA2AProviderFact = Readonly<{
  provider: string;
  agentId: string;
  providerId: string;
}>;

export type GenUiStatusFacts = {
  teamsSdk: boolean;
  environment: 'production' | 'local';
  authMode: string;
  storage: string;
  deterministic: boolean;
  agentProvider?: 'codex' | 'copilot';
  codex: CliCapability;
  ghcp: CliCapability;
  a2aProviders?: readonly GenUiA2AProviderFact[];
};

const JOB_STATUSES = ['queued', 'awaiting_approval', 'running', 'completed', 'failed', 'cancelled'] as const;
type SafeJobStatus = (typeof JOB_STATUSES)[number];

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function fieldOf(job: AgentJob, name: string): unknown {
  return recordOf(job)[name];
}

function normalizedText(value: unknown, fallback = ''): string {
  const raw = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
  const normalized = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '�').trim();
  return normalized || fallback;
}

function boundedText(value: unknown, maxLength: number, fallback = ''): string {
  const normalized = normalizedText(value, fallback);
  if (!normalized) return fallback;
  if (normalized.length <= maxLength) return normalized;
  const suffix = '…';
  return `${normalized.slice(0, Math.max(1, maxLength - suffix.length))}${suffix}`;
}

function displayText(value: unknown, maxLength: number, fallback = ''): string {
  const normalized = normalizedText(value);
  const safeFallback = redactSensitiveText(fallback);
  if (!normalized) return safeFallback;
  return boundedText(redactSensitiveText(normalized), maxLength, safeFallback);
}

function identifierText(value: unknown, maxLength: number, fallback = ''): string {
  return boundedText(value, maxLength, fallback);
}

function safeJobId(job: AgentJob): string {
  return identifierText(fieldOf(job, 'id'), 200, 'unknown-job');
}

function safeItemId(item: Item): string {
  const value = item && typeof item.id === 'number' && Number.isSafeInteger(item.id)
    ? String(item.id)
    : identifierText(item?.id, 120, 'unknown-item');
  return value || 'unknown-item';
}

function safeJobPrompt(job: AgentJob): string {
  return displayText(fieldOf(job, 'prompt'), 2_000, '(작업 설명 없음)');
}

function safeJobListLabel(job: AgentJob): string {
  const jobId = safeJobId(job);
  const separator = ' · ';
  const promptLength = Math.max(1, 400 - jobId.length - separator.length);
  const prompt = displayText(fieldOf(job, 'prompt'), promptLength, '(작업 설명 없음)');
  return `${jobId}${separator}${prompt}`;
}

function safeJobStatus(job: AgentJob): SafeJobStatus | 'unknown' {
  const value = fieldOf(job, 'status');
  return typeof value === 'string' && JOB_STATUSES.includes(value as SafeJobStatus) ? value as SafeJobStatus : 'unknown';
}

function safeJobMode(job: AgentJob): string {
  const mode = fieldOf(job, 'mode');
  return mode === 'workspace-write' || mode === 'read-only' ? mode : 'unknown';
}

function safeJobProgress(job: AgentJob): string[] {
  const progress = fieldOf(job, 'progress');
  if (!Array.isArray(progress)) return [];
  return progress
    .filter((message): message is string => typeof message === 'string')
    .slice(-8)
    .map((message) => displayText(message, 400, '진행 기록 없음'));
}

function safeJobResult(job: AgentJob): string {
  return displayText(fieldOf(job, 'result'), 3_800);
}

function safeJobError(job: AgentJob): string {
  return displayText(fieldOf(job, 'error'), 1_900);
}

function jobFallback(job: AgentJob, agentLabel = 'Codex'): string {
  const lines = [
    `작업 ID: ${safeJobId(job)}`,
    `상태: ${safeJobStatus(job)}`,
    `권한: ${safeJobMode(job)}`,
  ];

  const threadId = identifierText(fieldOf(job, 'threadId'), 200);
  const commitHash = identifierText(fieldOf(job, 'commitHash'), 200);
  const commitMessage = displayText(fieldOf(job, 'commitMessage'), 1_000);
  const progress = safeJobProgress(job);
  const error = safeJobError(job);
  const result = safeJobResult(job);
  if (threadId) lines.push(`${agentLabel} thread: ${threadId}`);
  if (commitHash) lines.push(`Git commit: ${commitHash}`);
  if (commitMessage && !commitHash) lines.push(`Git: ${commitMessage}`);
  if (progress.length > 0) lines.push(`최근 진행: ${progress.at(-1)}`);
  if (error) lines.push(`오류: ${error}`);
  if (result) lines.push(`결과:\n${result}`);
  return compactNotification(lines.join('\n'), 4_000);
}

const APPROVAL_SCOPE_MAX_LENGTH = 512;

function approvalScopeField(job: AgentJob, name: 'conversationId' | 'requesterId' | 'tenantId'): string | undefined {
  const value = fieldOf(job, name);
  if (typeof value !== 'string' || value.length === 0 || value.length > APPROVAL_SCOPE_MAX_LENGTH) return undefined;
  if (value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
  return value;
}

function validApprovalScope(job: AgentJob): {
  conversationId: string;
  requesterId: string;
  tenantId: string;
} | undefined {
  const conversationId = approvalScopeField(job, 'conversationId');
  const requesterId = approvalScopeField(job, 'requesterId');
  const tenantId = approvalScopeField(job, 'tenantId');
  if (!conversationId || !requesterId || !tenantId) return undefined;
  return { conversationId, requesterId, tenantId };
}

const IDENTITY_KEYS = new Set([
  'id',
  'entityid',
  'correlationid',
  'jobid',
  'itemid',
  'threadid',
  'parentjobid',
  'commithash',
  'actiontoken',
]);

function preservesIdentity(key: string): boolean {
  const normalized = key.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  return IDENTITY_KEYS.has(normalized) || normalized.endsWith('id');
}

function redactSharedValue(value: unknown, key = ''): unknown {
  if (typeof value === 'string') return preservesIdentity(key) ? value : redactSensitiveText(value);
  if (Array.isArray(value)) return value.map((entry) => redactSharedValue(entry, key));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
    entryKey,
    redactSharedValue(entryValue, entryKey),
  ]));
}

function redactSharedSections(sections: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return redactSharedValue(sections) as Array<Record<string, unknown>>;
}

function stateForJob(job: AgentJob): GenUiState {
  const status = safeJobStatus(job);
  if (status === 'awaiting_approval') return 'approval';
  if (status === 'completed') return safeJobResult(job) ? 'complete' : 'error';
  if (status === 'failed') return 'error';
  if (status === 'queued' || status === 'running') return 'loading';
  return 'ready';
}

function capabilityDescription(capability: CliCapability): string {
  const dimensions = `실행 파일=${capability.executable} · bounded probe=${capability.probe} · 인증=${capability.authentication} · policy/license/entitlement=${capability.entitlement}`;
  if (capability.state === 'available') return `실행 파일과 bounded capability probe가 확인되었습니다. ${dimensions}`;
  if (capability.state === 'unavailable' && capability.executable === 'absent') {
    return `실행 파일을 찾지 못했습니다. 실행하지 않습니다. ${dimensions}`;
  }
  if (capability.state === 'unavailable' && capability.authentication === 'not-authenticated') {
    return `실행 파일은 있지만 인증이 확인되지 않았습니다. 실행하지 않습니다. ${dimensions}`;
  }
  if (capability.state === 'unavailable') return `현재 사용할 수 없습니다. 실행하지 않습니다. ${dimensions}`;
  return `실행 파일 또는 bounded capability probe를 확인하지 못했습니다. 실행하지 않습니다. ${dimensions}`;
}

function capabilityFacts(label: string, capability: CliCapability): Array<{ label: string; value: string; description?: string }> {
  return [
    { label: `${label} CLI`, value: capability.state, description: capabilityDescription(capability) },
    { label: `${label} executable`, value: capability.executable },
    { label: `${label} bounded capability probe`, value: capability.probe },
    { label: `${label} authentication`, value: capability.authentication },
    { label: `${label} policy/license/entitlement`, value: capability.entitlement },
  ];
}

function a2aProviderFacts(providers: readonly GenUiA2AProviderFact[] | undefined): Array<{ label: string; value: string }> {
  const seen = new Set<string>();
  return (providers ?? []).slice(0, 8).flatMap((provider) => {
    const providerName = displayText(provider.provider, 64, 'unknown');
    const agentId = displayText(provider.agentId, 120, 'unknown-agent');
    const providerId = displayText(provider.providerId, 120, 'unknown-provider');
    const key = `${providerName}\u0000${agentId}\u0000${providerId}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ label: `A2A worker (${providerName})`, value: `${agentId} · ${providerId}` }];
  });
}

export class GenUiResponseFactory {
  private readonly openTabUrl?: string;
  private readonly agentLabel: string;

  constructor(
    private readonly actionStore: GenUiActionStore,
    options: GenUiResponseFactoryOptions = {},
  ) {
    const candidate = options.openTabUrl?.trim();
    this.openTabUrl = candidate && isSafeGenUiUrl(candidate) ? candidate : undefined;
    this.agentLabel = options.agentLabel?.trim() || 'Codex';
  }

  private tabActions(): GenUiAction[] {
    if (!this.openTabUrl) return [];
    return [{
      id: 'open-tab',
      action: 'open-tab',
      label: '업무 허브 탭 열기',
      entityId: 'home',
      correlationId: 'home-tab',
      actionToken: randomUUID(),
      style: 'default',
    }];
  }

  private commandActions(): GenUiAction[] {
    // Teams recommends no more than six primary card actions. Every card
    // also receives the default tab link, so keep five command buttons here;
    // collaboration remains available as a text command.
    const cardCommands = GENUI_COMMANDS.filter((command) => command !== 'collaboration');
    const labels: Record<(typeof GENUI_COMMANDS)[number], string> = {
      help: '도움말',
      weather: '날씨',
      status: '상태',
      list: '업무 목록',
      work: '탭 업무',
      collaboration: '알림 digest',
    };
    return cardCommands.map((command) => ({
      id: `command-${command}`,
      action: 'command' as const,
      label: labels[command],
      entityId: command,
      correlationId: 'command-palette',
      actionToken: randomUUID(),
      style: 'default' as const,
    }));
  }

  private create(input: {
    kind: GenUiEnvelopeV1['kind'];
    id: string;
    correlationId?: string;
    status?: GenUiState;
    title: string;
    summary?: string;
    prompt?: string;
    sections: Array<Record<string, unknown>>;
    images?: GenUiImage[];
    fallbackText: string;
    actions?: GenUiAction[];
    includeTabAction?: boolean;
    metadata?: Record<string, string | number | boolean | null>;
  }): GenUiEnvelopeV1 {
    const { includeTabAction = true, ...envelopeInput } = input;
    return GenUiEnvelopeV1Schema.parse({
      schemaVersion: GENUI_SCHEMA_VERSION,
      correlationId: randomUUID(),
      aiGenerated: false,
      citations: [],
      ...envelopeInput,
      id: identifierText(envelopeInput.id, 200, 'genui-response'),
      title: displayText(envelopeInput.title, 240),
      summary: envelopeInput.summary === undefined ? undefined : displayText(envelopeInput.summary, 2_000),
      prompt: envelopeInput.prompt === undefined ? undefined : displayText(envelopeInput.prompt, 2_000),
      sections: redactSharedSections(envelopeInput.sections),
      fallbackText: displayText(envelopeInput.fallbackText, 4_000, '요청 결과를 확인하세요.'),
      actions: [
        ...(envelopeInput.actions ?? []),
        ...(includeTabAction ? this.tabActions() : []),
      ],
      metadata: redactSharedValue({
        ...(envelopeInput.metadata ?? {}),
        ...(this.openTabUrl ? { openTabUrl: this.openTabUrl } : {}),
      }) as Record<string, string | number | boolean | null>,
    });
  }

  answer(text: string, id = `answer-${randomUUID()}`): GenUiEnvelopeV1 {
    const safeText = displayText(text, 2_000, '요청 결과를 확인하세요.');
    return this.create({
      kind: 'answer',
      id,
      title: '업무 허브',
      summary: safeText,
      sections: [{ type: 'text', text: safeText }],
      fallbackText: safeText,
      includeTabAction: true,
      metadata: { source: 'teams-bot', deterministic: true },
    });
  }

  help(): GenUiEnvelopeV1 {
    const text = '사용 가능한 명령: help, carousel, weather [위도 경도], status, list, work, collaboration, run <작업>, continue <작업 ID> <추가 요청>, write <작업>, approve <작업 ID>, commit <작업 ID> [메시지], cancel <작업 ID>';
    return this.create({
      kind: 'answer',
      id: 'help',
      title: '업무 허브 명령 안내',
      summary: 'Teams 모바일에서 사용할 수 있는 명령입니다.',
      sections: [{ type: 'text', title: '명령', text }],
      fallbackText: text,
      actions: this.commandActions(),
      includeTabAction: true,
      metadata: { source: 'teams-bot', deterministic: true },
    });
  }

  carousel(): GenUiEnvelopeV1[] {
    const cards = [
      {
        id: 'carousel-overview',
        title: '카드 갤러리 · 요약',
        summary: 'Teams 메시지에서 여러 카드를 좌우로 넘겨 봅니다.',
        images: [{ url: 'https://adaptivecards.io/content/cats/1.png', altText: '카드 갤러리 첫 번째 샘플 이미지' }],
        sections: [{ type: 'text', title: '메시지 캐러셀', text: '각 카드는 독립적인 Adaptive Card이며 Teams 모바일에서 좌우로 이동할 수 있습니다.' }],
        fallbackText: '카드 갤러리 요약',
      },
      {
        id: 'carousel-image-set',
        title: '카드 내부 · ImageSet',
        summary: '한 카드 안에 여러 이미지를 묶어 표시합니다.',
        images: [
          { url: 'https://adaptivecards.io/content/cats/2.png', altText: '카드 내부 두 번째 샘플 이미지' },
          { url: 'https://adaptivecards.io/content/cats/3.png', altText: '카드 내부 세 번째 샘플 이미지' },
        ],
        sections: [{ type: 'text', title: '인라인 이미지', text: 'ImageSet은 카드 내부의 이미지 모음이며, 메시지 캐러셀과 별개입니다.' }],
        fallbackText: '카드 내부 이미지 모음',
      },
      {
        id: 'carousel-actions',
        title: '카드 갤러리 · 다음 단계',
        summary: '모든 응답 카드에는 업무 허브 탭 링크가 기본 제공됩니다.',
        images: [{ url: 'https://adaptivecards.io/content/airplane.png', altText: '카드 갤러리 다음 단계 샘플 이미지' }],
        sections: [{ type: 'list', title: '검증 포인트', items: [
          { label: '카드 좌우 이동', value: 'Teams 메시지 carousel' },
          { label: '카드 내부 이미지', value: 'Adaptive Card ImageSet' },
          { label: '탭 연결', value: '업무 허브 탭 열기' },
        ] }],
        fallbackText: '카드 갤러리 검증 포인트',
      },
    ];

    return cards.map((card) => this.create({
      kind: 'answer',
      ...card,
      includeTabAction: true,
      metadata: { source: 'teams-bot', deterministic: true, carousel: true },
    }));
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
      includeTabAction: true,
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
      includeTabAction: true,
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
      includeTabAction: true,
      metadata: { source: weather.source, deterministic: true },
    });
  }

  status(input: GenUiStatusFacts): GenUiEnvelopeV1 {
    const codex = normalizeCliCapability(input.codex);
    const ghcp = normalizeCliCapability(input.ghcp);
    const facts = [
      { label: 'Teams SDK', value: input.teamsSdk ? 'enabled' : 'disabled' },
      { label: '환경', value: input.environment },
      { label: '인증 모드', value: displayText(input.authMode, 120, 'unknown') },
      { label: '저장소', value: displayText(input.storage, 120, 'unknown') },
      { label: '응답 모드', value: input.deterministic ? 'deterministic' : 'unknown' },
      { label: '활성 agent provider', value: input.agentProvider ?? 'codex' },
      ...a2aProviderFacts(input.a2aProviders),
      ...capabilityFacts('Codex', codex),
      ...capabilityFacts('GHCP', ghcp),
    ];
    const text = facts.map((fact) => `${fact.label}: ${fact.value}`).join('\n');
    return this.create({
      kind: 'job-status',
      id: 'workspace-status',
      title: '업무 허브 상태',
      summary: '결정형 Teams 런타임 상태',
      sections: [{ type: 'facts', title: '런타임 사실', facts }],
      fallbackText: text,
      includeTabAction: true,
      metadata: { source: 'teams-bot', deterministic: true },
    });
  }

  list(items: Item[], jobs: AgentJob[]): GenUiEnvelopeV1 {
    const openItems = (Array.isArray(items) ? items : []).filter((item) => item?.status === 'open').slice(0, 8);
    const recentJobs = (Array.isArray(jobs) ? jobs : []).filter(Boolean).slice(0, 5);
    const itemText = openItems.length === 0 ? '진행 중인 업무가 없습니다.' : `진행 중인 업무:\n${openItems.map((item) => `- ${displayText(item.title, 400, '(제목 없음)')}`).join('\n')}`;
    const jobText = recentJobs.length === 0 ? '에이전트 작업이 없습니다.' : `최근 에이전트 작업:\n${recentJobs.map((job) => `- ${safeJobId(job)}: ${safeJobStatus(job)}`).join('\n')}`;
    return this.create({
      kind: 'task-list',
      id: 'workspace-list',
      title: '업무 목록',
      summary: `${openItems.length}개 업무 · ${recentJobs.length}개 최근 ${this.agentLabel} 작업`,
      sections: [
        { type: 'list', title: '진행 중인 업무', items: openItems.map((item) => ({ id: safeItemId(item), label: displayText(item.title, 400, '(제목 없음)'), status: 'open' })) },
        { type: 'list', title: `최근 ${this.agentLabel} 작업`, items: recentJobs.map((job) => ({ id: safeJobId(job), label: safeJobListLabel(job), status: safeJobStatus(job) })) },
      ],
      fallbackText: `${itemText}\n\n${jobText}`,
      includeTabAction: true,
      metadata: { source: 'teams-bot', deterministic: true },
    });
  }

  async jobStatus(job: AgentJob | undefined): Promise<GenUiEnvelopeV1> {
    if (!job) return this.error('작업을 찾을 수 없습니다.');
    const jobId = safeJobId(job);
    const jobStatus = safeJobStatus(job);
    const progress = safeJobProgress(job);
    const error = safeJobError(job);
    const result = safeJobResult(job);
    const text = `작업 ${jobId}: ${jobStatus}`;
    const actions: GenUiAction[] = [];
    if (jobStatus === 'failed') {
      const scope = validApprovalScope(job);
      if (scope) {
        const correlationId = randomUUID();
        const actionToken = await this.actionStore.issue({
          action: 'retry',
          entityId: jobId,
          correlationId,
          ...scope,
        });
        actions.push({
          action: 'retry',
          label: '다시 시도',
          entityId: jobId,
          correlationId,
          actionToken,
          style: 'default',
        });
      }
    }
    return this.create({
      kind: 'job-status',
      id: jobId,
      status: stateForJob(job),
      title: `${this.agentLabel} 작업 상태`,
      summary: text,
      prompt: safeJobPrompt(job),
      sections: [
        { type: 'status', status: jobStatus, description: [error, result, progress.at(-1)].filter(Boolean).join('\n').slice(0, 2_000) },
        { type: 'list', title: '최근 진행 기록', items: progress.map((message, index) => ({ id: `${jobId}-${index}`.slice(0, 120), label: message })) },
      ],
      fallbackText: jobFallback(job, this.agentLabel),
      actions,
      metadata: { source: 'teams-bot', deterministic: true },
    });
  }

  async approval(job: AgentJob): Promise<GenUiEnvelopeV1> {
    const jobId = safeJobId(job);
    const prompt = safeJobPrompt(job);
    const scope = validApprovalScope(job);
    if (!scope) {
      // Do not include the corrupt scope or prompt in this card.  In
      // particular, this path must return before the first grant is issued.
      return this.error('쓰기 작업 승인을 생성할 수 없습니다. 승인 범위가 유효하지 않습니다.', 'approval-scope-invalid');
    }
    const correlationId = randomUUID();
    const common = {
      entityId: jobId,
      correlationId,
      conversationId: scope.conversationId,
      requesterId: scope.requesterId,
      tenantId: scope.tenantId,
    };
    const approveToken = await this.actionStore.issue({ ...common, action: 'approve' });
    const cancelToken = await this.actionStore.issue({ ...common, action: 'cancel' });
    const actions: GenUiAction[] = [
      { action: 'approve', label: '승인', entityId: jobId, correlationId, actionToken: approveToken, style: 'positive' },
      { action: 'cancel', label: '취소', entityId: jobId, correlationId, actionToken: cancelToken, style: 'destructive' },
    ];
    const text = `쓰기 작업 ${jobId}이 승인 대기 중입니다. 승인하면 ${this.agentLabel}가 작업을 실행합니다.`;
    return GenUiEnvelopeV1Schema.parse({
      ...this.create({
        kind: 'approval',
        id: jobId,
        status: 'approval',
        title: '쓰기 작업 승인 필요',
        summary: text,
        prompt,
        sections: [{ type: 'status', title: '승인 경계', status: 'awaiting_approval', description: prompt }],
        fallbackText: `${text}\napprove ${jobId} 또는 cancel ${jobId}`,
        actions,
        metadata: { source: 'teams-bot', deterministic: true },
      }),
      correlationId,
    });
  }

  approvalAccepted(job: AgentJob): GenUiEnvelopeV1 {
    const jobId = safeJobId(job);
    const jobStatus = safeJobStatus(job);
    const text = `작업 ${jobId} 승인을 처리했습니다.\nstatus ${jobId}`;
    return this.create({
      kind: 'job-status',
      id: jobId,
      status: stateForJob(job),
      title: '쓰기 작업 승인 처리',
      summary: text,
      prompt: safeJobPrompt(job),
      sections: [{ type: 'status', title: '승인 결과', status: jobStatus, description: safeJobPrompt(job) }],
      fallbackText: text,
      metadata: { source: 'teams-bot', deterministic: true },
    });
  }

  cancelled(job: AgentJob): GenUiEnvelopeV1 {
    const jobId = safeJobId(job);
    const jobStatus = safeJobStatus(job);
    const text = `작업 ${jobId} 취소를 처리했습니다.\n상태: ${jobStatus}`;
    return this.create({
      kind: 'result',
      id: jobId,
      status: jobStatus === 'cancelled' ? 'complete' : stateForJob(job),
      title: '작업 취소 결과',
      summary: text,
      prompt: safeJobPrompt(job),
      sections: [{ type: 'status', title: '취소 결과', status: jobStatus, description: safeJobPrompt(job) }],
      fallbackText: text,
      metadata: { source: 'teams-bot', deterministic: true },
    });
  }

  continued(job: AgentJob): GenUiEnvelopeV1 {
    const jobId = safeJobId(job);
    const text = `작업 ${jobId}이 이전 ${this.agentLabel} thread에서 이어집니다.\nstatus ${jobId}`;
    return this.create({
      kind: 'job-status',
      id: jobId,
      status: 'loading',
      title: `${this.agentLabel} 대화 이어서 실행`,
      summary: text,
      prompt: safeJobPrompt(job),
      sections: [{ type: 'status', title: '재개 결과', status: safeJobStatus(job), description: safeJobPrompt(job) }],
      fallbackText: text,
      metadata: { source: 'teams-bot', deterministic: true },
    });
  }

  naturalLanguageStarted(job: AgentJob): GenUiEnvelopeV1 {
    const jobId = safeJobId(job);
    const text = `자연어 작업 ${jobId}을 읽기 전용으로 시작했습니다.\nstatus ${jobId}`;
    return this.create({
      kind: 'job-status',
      id: jobId,
      status: 'loading',
      title: `자연어 ${this.agentLabel} 작업 시작`,
      summary: text,
      prompt: safeJobPrompt(job),
      sections: [{ type: 'status', title: '작업 요청', status: safeJobStatus(job), description: safeJobPrompt(job) }],
      fallbackText: text,
      metadata: { source: 'teams-bot', deterministic: true },
    });
  }

  commitResult(job: AgentJob | undefined, missing = false): GenUiEnvelopeV1 {
    if (!job) return this.error('커밋할 작업을 찾을 수 없습니다.');
    const jobId = safeJobId(job);
    const jobStatus = safeJobStatus(job);
    const commitHash = typeof job.commitHash === 'string' ? job.commitHash.trim() : '';
    const committed = !missing && commitHash.length > 0;
    const text = missing
      ? `작업 ${jobId}은 아직 커밋할 수 없습니다. 현재 상태: ${jobStatus}`
      : displayText(fieldOf(job, 'commitMessage'), 1_900, '커밋할 변경이 없습니다.');
    return this.create({
      kind: committed ? 'result' : 'error',
      id: jobId,
      status: committed ? 'complete' : 'error',
      title: missing ? '커밋 대기 중' : committed ? '커밋 결과' : '커밋 실패',
      summary: text,
      prompt: safeJobPrompt(job),
      sections: [{ type: 'status', title: 'Git 결과', status: jobStatus, description: text }],
      fallbackText: text,
      metadata: { source: 'teams-bot', deterministic: true },
    });
  }

  actionAccepted(action: GenUiJobAction, job: AgentJob): GenUiEnvelopeV1 {
    return action === 'approve' ? this.approvalAccepted(job) : this.cancelled(job);
  }

  started(job: AgentJob): GenUiEnvelopeV1 {
    const jobId = safeJobId(job);
    const text = `${safeJobMode(job) === 'workspace-write' ? '쓰기' : '읽기 전용'} ${this.agentLabel} 작업 ${jobId}을 시작했습니다. status ${jobId}로 진행 상태를 확인할 수 있습니다.`;
    return this.create({
      kind: 'job-status', id: jobId, status: 'loading', title: `${this.agentLabel} 작업 시작`, summary: text,
      prompt: safeJobPrompt(job),
      sections: [{ type: 'status', status: safeJobStatus(job), description: safeJobPrompt(job) }], fallbackText: text,
      metadata: { source: 'teams-bot', deterministic: true },
    });
  }

  notification(notification: GenUiNotification): GenUiEnvelopeV1 {
    const kind = notification.kind === 'progress'
      ? 'job-status'
      : notification.kind === 'cancelled'
        ? 'result'
        : notification.kind;
    const status: GenUiState = notification.kind === 'progress'
      ? 'loading'
      : notification.kind === 'error'
        ? 'error'
        : 'complete';
    const jobId = safeJobId(notification.job);
    const message = displayText(notification.message, 4_000, '작업 상태가 업데이트되었습니다.');
    const summary = compactNotification(message, 1_900);
    const fallbackText = compactNotification(message, 4_000);
    const sectionStatus = notification.phase === 'blocked'
      ? 'blocked'
      : notification.phase === 'cancelled'
        ? 'cancelled'
        : safeJobStatus(notification.job);
    const title = notification.kind === 'progress'
      ? `${this.agentLabel} 작업 진행`
      : notification.kind === 'cancelled'
        ? `${this.agentLabel} 작업 취소`
        : notification.kind === 'error'
          ? notification.phase === 'blocked' ? `${this.agentLabel} 작업 차단` : `${this.agentLabel} 작업 오류`
          : notification.phase === 'commit' ? 'Git 커밋 결과' : `${this.agentLabel} 작업 완료`;
    return this.create({
      kind,
      id: jobId,
      status,
      title,
      summary,
      sections: [{ type: 'status', title: '작업 상태', status: sectionStatus, description: summary }],
      fallbackText,
      prompt: safeJobPrompt(notification.job),
      metadata: { source: 'agent-service', event: displayText(notification.phase, 64, 'unknown'), deterministic: true },
    });
  }

  actionError(message: string, id = 'genui-action-error'): GenUiEnvelopeV1 {
    return this.error(message, id);
  }

  error(message: string, id = 'error'): GenUiEnvelopeV1 {
    const safeMessage = displayText(message, 1_900, '요청을 처리하지 못했습니다.');
    return this.create({
      kind: 'error', id, status: 'error', title: '업무 허브 오류', summary: safeMessage,
      sections: [{ type: 'status', status: 'error', description: safeMessage }], fallbackText: safeMessage,
      metadata: { source: 'teams-bot', deterministic: true },
    });
  }
}

function compactNotification(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const suffix = '\n\n(알림이 길어 일부 생략되었습니다.)';
  return `${value.slice(0, Math.max(1, maxLength - suffix.length))}${suffix}`;
}
