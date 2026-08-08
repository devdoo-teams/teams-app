import {
  ResponseModeSchema,
  responseModeLabel,
  type ResponseMode,
  type ResponseModeAvailability,
} from '../shared/response-mode.js';
import type { AdaptiveCardAction, TeamsAdaptiveCard, TeamsMessageActivity } from './genui-teams.js';

export const RESPONSE_MODE_ACTION = 'response-mode.select' as const;

export type PublicResponseModeAvailability = ResponseModeAvailability & {
  model?: string;
};

export type ResponseModeCardAction = {
  action: typeof RESPONSE_MODE_ACTION;
  mode: ResponseMode;
};

function textBlock(text: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'TextBlock',
    text,
    wrap: true,
    spacing: 'Small',
    ...extra,
  };
}

function availabilityText(entry: PublicResponseModeAvailability, current: ResponseMode): string {
  const state = entry.configured ? '사용 가능' : '서버 설정 필요';
  const selected = entry.mode === current ? ' · 현재 선택' : '';
  const model = entry.model ? ` · ${entry.model}` : '';
  return `${entry.label}: ${state}${model}${selected}`;
}

export function createResponseModeCard(
  current: ResponseMode,
  availability: readonly PublicResponseModeAvailability[],
  notice?: string,
): TeamsAdaptiveCard {
  const actions: AdaptiveCardAction[] = availability.map((entry) => ({
    type: 'Action.Submit',
    title: `${entry.label}${entry.mode === current ? ' · 현재' : ''}`,
    data: { action: RESPONSE_MODE_ACTION, mode: entry.mode },
    isEnabled: entry.configured,
  }));

  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.5',
    msteams: { width: 'Full' },
    speak: `응답 모드: ${responseModeLabel(current)}`,
    body: [
      textBlock('응답 모드', { size: 'Large', weight: 'Bolder', color: 'Accent' }),
      textBlock(notice ?? `현재 선택: ${responseModeLabel(current)}`),
      textBlock('Teams 모바일에서 사용할 응답 방식을 선택하세요. 결정형은 별도 서버 설정 없이 사용할 수 있습니다.', { isSubtle: true }),
      {
        type: 'FactSet',
        facts: availability.map((entry) => ({
          title: entry.label,
          value: availabilityText(entry, current),
        })),
      },
    ],
    actions,
  };
}

export function createResponseModeCardActivity(
  current: ResponseMode,
  availability: readonly PublicResponseModeAvailability[],
  notice?: string,
): TeamsMessageActivity {
  const card = createResponseModeCard(current, availability, notice);
  return {
    type: 'message',
    text: notice ?? `현재 응답 모드: ${responseModeLabel(current)}`,
    attachmentLayout: 'list',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: card,
    }],
  };
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/** Return true only for the mode action namespace; invalid modes are handled as safe errors. */
export function isResponseModeCardAction(value: unknown): boolean {
  return recordOf(value)?.action === RESPONSE_MODE_ACTION;
}

export function parseResponseModeCardAction(value: unknown): ResponseModeCardAction | undefined {
  const record = recordOf(value);
  if (record?.action !== RESPONSE_MODE_ACTION) return undefined;
  const parsedMode = ResponseModeSchema.safeParse(record.mode);
  if (!parsedMode.success) return undefined;
  return { action: RESPONSE_MODE_ACTION, mode: parsedMode.data };
}
