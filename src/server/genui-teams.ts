import {
  GENUI_ACTION_PAYLOAD_KEYS,
  GENUI_SCHEMA_VERSION,
  GenUiEnvelopeV1Schema,
  type GenUiAction,
  type GenUiEnvelopeV1,
  type GenUiScalar,
  type GenUiSection,
} from '../shared/genui.js';

export type AdaptiveCardElement = Record<string, unknown>;
export type AdaptiveCardAction = Record<string, unknown>;

export interface TeamsAdaptiveCard {
  type: 'AdaptiveCard';
  $schema: 'http://adaptivecards.io/schemas/adaptive-card.json';
  version: '1.5';
  body: AdaptiveCardElement[];
  actions?: AdaptiveCardAction[];
  msteams: { width: 'Full' };
}

export interface TeamsAdaptiveCardAttachment {
  contentType: 'application/vnd.microsoft.card.adaptive';
  content: TeamsAdaptiveCard;
}

export interface TeamsMessageActivity {
  type: 'message';
  text?: string;
  attachments?: TeamsAdaptiveCardAttachment[];
  attachmentLayout?: 'list';
}

function scalarText(value: GenUiScalar): string {
  if (value === null) return '—';
  if (typeof value === 'boolean') return value ? '예' : '아니요';
  return String(value);
}

function sectionElements(section: GenUiSection): AdaptiveCardElement[] {
  const elements: AdaptiveCardElement[] = [];

  if (section.label) {
    elements.push({
      type: 'TextBlock',
      text: section.label,
      weight: 'Bolder',
      color: 'Accent',
      wrap: true,
      spacing: 'Small',
    });
  }

  if (section.value !== undefined) {
    elements.push({
      type: 'TextBlock',
      text: scalarText(section.value),
      wrap: true,
      spacing: 'Small',
    });
  }

  if (section.description) {
    elements.push({
      type: 'TextBlock',
      text: section.description,
      wrap: true,
      isSubtle: true,
      spacing: 'Small',
    });
  }

  if (section.status) {
    elements.push({
      type: 'TextBlock',
      text: `상태: ${section.status}`,
      wrap: true,
      color: 'Default',
      spacing: 'Small',
    });
  }

  if (section.progress !== undefined) {
    elements.push({
      type: 'TextBlock',
      text: `진행률: ${Math.round(section.progress * 100)}%`,
      wrap: true,
      color: 'Accent',
      spacing: 'Small',
    });
  }

  if (section.items) {
    for (const item of section.items) {
      const value = item.value === undefined ? '' : `: ${scalarText(item.value)}`;
      const status = item.status ? ` (${item.status})` : '';
      elements.push({
        type: 'TextBlock',
        text: `• ${item.label}${value}${status}`,
        wrap: true,
        spacing: 'Small',
      });
    }
  }

  return elements;
}

function renderSection(section: GenUiSection): AdaptiveCardElement {
  return {
    type: 'Container',
    spacing: 'Medium',
    separator: true,
    items: sectionElements(section),
  };
}

function actionPayload(action: GenUiAction): Record<(typeof GENUI_ACTION_PAYLOAD_KEYS)[number], string> {
  return {
    schemaVersion: GENUI_SCHEMA_VERSION,
    action: action.action,
    entityId: action.entityId,
    correlationId: action.correlationId,
    actionToken: action.actionToken,
  };
}

function renderAction(action: GenUiAction): AdaptiveCardAction {
  const payload = actionPayload(action);
  return {
    type: 'Action.Execute',
    id: action.id,
    title: action.label,
    verb: `genui.${action.action}`,
    data: payload,
    style: action.style,
    fallback: {
      type: 'Action.Submit',
      title: action.label,
      data: payload,
      style: action.style,
    },
  };
}

function citationText(title: string, url: string): string {
  const safeTitle = title.replace(/[\[\]]/g, '');
  return `[${safeTitle}](${url})`;
}

export function renderGenUiCard(input: GenUiEnvelopeV1): TeamsAdaptiveCard {
  const envelope = GenUiEnvelopeV1Schema.parse(input);
  const body: AdaptiveCardElement[] = [];

  if (envelope.title) {
    body.push({
      type: 'TextBlock',
      text: envelope.title,
      size: 'Large',
      weight: 'Bolder',
      color: 'Accent',
      wrap: true,
      maxLines: 4,
    });
  }

  if (envelope.summary) {
    body.push({
      type: 'TextBlock',
      text: envelope.summary,
      wrap: true,
      color: 'Default',
      spacing: 'Small',
    });
  }

  if (envelope.aiGenerated) {
    body.push({
      type: 'TextBlock',
      text: 'AI 생성 콘텐츠',
      isSubtle: true,
      color: 'Accent',
      wrap: true,
      spacing: 'Small',
    });
  }

  body.push(...envelope.sections.map(renderSection));

  if (envelope.aiGenerated && envelope.citations.length > 0) {
    body.push({
      type: 'TextBlock',
      text: '출처',
      weight: 'Bolder',
      color: 'Accent',
      wrap: true,
      spacing: 'Medium',
      separator: true,
    });
    for (const citation of envelope.citations) {
      body.push({
        type: 'TextBlock',
        text: citationText(citation.title, citation.url),
        wrap: true,
        isSubtle: true,
        spacing: 'Small',
      });
      if (citation.snippet) {
        body.push({
          type: 'TextBlock',
          text: citation.snippet,
          wrap: true,
          isSubtle: true,
          spacing: 'None',
          maxLines: 3,
        });
      }
    }
  }

  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.5',
    msteams: { width: 'Full' },
    body,
    actions: envelope.actions.map(renderAction),
  };
}

export function createAdaptiveCardAttachment(input: GenUiEnvelopeV1): TeamsAdaptiveCardAttachment {
  return {
    contentType: 'application/vnd.microsoft.card.adaptive',
    content: renderGenUiCard(input),
  };
}

export function genUiTextFallback(input: GenUiEnvelopeV1): string {
  const envelope = GenUiEnvelopeV1Schema.parse(input);
  if (envelope.fallbackText) return envelope.fallbackText;

  const lines: string[] = [];
  if (envelope.title) lines.push(envelope.title);
  if (envelope.summary) lines.push(envelope.summary);
  for (const section of envelope.sections) {
    const label = section.label ? `${section.label}: ` : '';
    if (section.value !== undefined) lines.push(`${label}${scalarText(section.value)}`);
    if (section.description) lines.push(section.description);
    if (section.status) lines.push(`${label}상태: ${section.status}`);
    if (section.items) {
      lines.push(...section.items.map((item) => {
        const value = item.value === undefined ? '' : `: ${scalarText(item.value)}`;
        return `- ${item.label}${value}`;
      }));
    }
  }
  if (envelope.aiGenerated && envelope.citations.length > 0) {
    lines.push('출처:');
    lines.push(...envelope.citations.map((citation) => `${citation.title}: ${citation.url}`));
  }

  return lines.join('\n') || '요청 결과를 카드로 확인하세요.';
}

export function createAdaptiveCardActivity(input: GenUiEnvelopeV1): TeamsMessageActivity {
  return {
    type: 'message',
    text: genUiTextFallback(input),
    attachmentLayout: 'list',
    attachments: [createAdaptiveCardAttachment(input)],
  };
}

export function createTextFallbackActivity(input: GenUiEnvelopeV1): TeamsMessageActivity {
  return {
    type: 'message',
    text: genUiTextFallback(input),
  };
}
