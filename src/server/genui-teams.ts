import {
  GENUI_ACTION_PAYLOAD_KEYS,
  GENUI_SCHEMA_VERSION,
  GenUiEnvelopeV1Schema,
  isSafeGenUiUrl,
  type GenUiAction,
  type GenUiEnvelopeV1,
  type GenUiFact,
  type GenUiItem,
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

function textBlock(text: string, extra: AdaptiveCardElement = {}): AdaptiveCardElement {
  return {
    type: 'TextBlock',
    text,
    wrap: true,
    spacing: 'Small',
    ...extra,
  };
}

function factSet(facts: GenUiFact[]): AdaptiveCardElement {
  return {
    type: 'FactSet',
    facts: facts.map((fact) => ({
      title: fact.label,
      value: `${scalarText(fact.value)}${fact.unit ? ` ${fact.unit}` : ''}`,
    })),
    spacing: 'Small',
  };
}

function itemElements(items: GenUiItem[]): AdaptiveCardElement[] {
  return items.map((item) => {
    const value = item.value === undefined ? '' : `: ${scalarText(item.value)}`;
    const status = item.status ? ` (${item.status})` : '';
    return textBlock(`• ${item.label}${value}${status}`, { spacing: 'Small' });
  });
}

function weatherIcon(icon: string | undefined): string {
  switch (icon) {
    case 'rain': return '🌧️';
    case 'cloud': return '☁️';
    case 'fog': return '🌫️';
    case 'snow': return '❄️';
    case 'storm': return '⛈️';
    default: return '☀️';
  }
}

function weatherElements(section: Extract<GenUiSection, { type: 'weather' }>): AdaptiveCardElement[] {
  const temperature = section.temperature === undefined ? undefined : `${section.temperature.toFixed(1)}°C`;
  const details: GenUiFact[] = [];
  if (section.apparentTemperature !== undefined) details.push({ label: '체감', value: section.apparentTemperature, unit: '°C' });
  if (section.humidity !== undefined) details.push({ label: '습도', value: section.humidity, unit: '%' });
  if (section.windSpeed !== undefined) details.push({ label: '바람', value: section.windSpeed, unit: 'km/h' });
  if (section.precipitation !== undefined) details.push({ label: '강수', value: section.precipitation, unit: 'mm' });

  return [
    {
      type: 'ColumnSet',
      columns: [
        { type: 'Column', width: 'auto', items: [textBlock(weatherIcon(section.icon), { size: 'ExtraLarge' })] },
        {
          type: 'Column',
          width: 'stretch',
          items: [
            ...(temperature ? [textBlock(temperature, { size: 'ExtraLarge', weight: 'Bolder', color: 'Accent' })] : []),
            ...(section.condition ? [textBlock(section.condition, { isSubtle: true })] : []),
          ],
        },
      ],
      spacing: 'Small',
    },
    ...(details.length > 0 ? [factSet(details)] : []),
    ...(section.location ? [textBlock(`${section.location}${section.source ? ` · ${section.source}` : ''}`, { isSubtle: true })] : []),
  ];
}

function sectionElements(section: GenUiSection): AdaptiveCardElement[] {
  switch (section.type) {
    case 'text':
      return [
        ...(section.text || section.content ? [textBlock(section.text ?? section.content ?? '')] : []),
        ...(section.value !== undefined ? [textBlock(scalarText(section.value))] : []),
      ];
    case 'facts':
      return [
        ...(section.value !== undefined ? [textBlock(scalarText(section.value))] : []),
        ...(section.facts && section.facts.length > 0 ? [factSet(section.facts)] : []),
      ];
    case 'stats':
      return [factSet(section.stats)];
    case 'weather':
      return weatherElements(section);
    case 'list':
      return section.items.length > 0 ? itemElements(section.items) : [textBlock('표시할 항목이 없습니다.', { isSubtle: true })];
    case 'progress':
      return [
        textBlock(`진행률: ${section.progress}%`, { color: 'Accent', weight: 'Bolder' }),
        {
          type: 'ColumnSet',
          columns: [
            { type: 'Column', width: Math.max(1, section.progress), items: [{ type: 'Container', minHeight: '8px', style: 'accent' }] },
            { type: 'Column', width: Math.max(1, 100 - section.progress), items: [{ type: 'Container', minHeight: '8px', style: 'default' }] },
          ],
          spacing: 'Small',
        },
      ];
    case 'status':
      return [
        textBlock(`상태: ${section.status}`, { color: 'Accent', weight: 'Bolder' }),
        ...(section.description ? [textBlock(section.description, { isSubtle: true })] : []),
      ];
  }
}

function renderSection(section: GenUiSection): AdaptiveCardElement {
  const heading = section.title ?? section.label;
  return {
    type: 'Container',
    spacing: 'Medium',
    separator: true,
    items: [
      ...(heading ? [textBlock(heading, { weight: 'Bolder', color: 'Accent' })] : []),
      ...(section.description && section.type !== 'status' ? [textBlock(section.description, { isSubtle: true })] : []),
      ...sectionElements(section),
    ],
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
    ...(action.id ? { id: action.id } : {}),
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

  if (envelope.title) body.push(textBlock(envelope.title, { size: 'Large', weight: 'Bolder', color: 'Accent', maxLines: 4 }));
  if (envelope.summary) body.push(textBlock(envelope.summary, { color: 'Default' }));
  if (envelope.aiGenerated) body.push(textBlock('AI 생성 콘텐츠', { isSubtle: true, color: 'Accent' }));

  body.push(...envelope.sections.map(renderSection));

  if (envelope.aiGenerated && envelope.citations.length > 0) {
    body.push(textBlock('출처', { weight: 'Bolder', color: 'Accent', spacing: 'Medium', separator: true }));
    for (const citation of envelope.citations) {
      if (!isSafeGenUiUrl(citation.url)) continue;
      body.push(textBlock(citationText(citation.title, citation.url), { isSubtle: true }));
      if (citation.snippet) body.push(textBlock(citation.snippet, { isSubtle: true, maxLines: 3, spacing: 'None' }));
    }
  }

  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.5',
    msteams: { width: 'Full' },
    body,
    ...(envelope.actions.length > 0 ? { actions: envelope.actions.map(renderAction) } : {}),
  };
}

function sectionText(section: GenUiSection): string[] {
  switch (section.type) {
    case 'text':
      return [section.text ?? section.content, section.value === undefined ? undefined : scalarText(section.value)].filter((value): value is string => Boolean(value));
    case 'facts':
      return [
        section.value === undefined ? undefined : scalarText(section.value),
        ...(section.facts ?? []).map((fact) => `${fact.label}: ${scalarText(fact.value)}${fact.unit ? ` ${fact.unit}` : ''}`),
      ].filter((value): value is string => Boolean(value));
    case 'stats':
      return section.stats.map((fact) => `${fact.label}: ${scalarText(fact.value)}${fact.unit ? ` ${fact.unit}` : ''}`);
    case 'weather':
      return [
        section.location,
        section.temperature === undefined ? undefined : `${section.temperature.toFixed(1)}°C${section.condition ? ` · ${section.condition}` : ''}`,
        section.apparentTemperature === undefined ? undefined : `체감 ${section.apparentTemperature.toFixed(1)}°C`,
        section.humidity === undefined ? undefined : `습도 ${Math.round(section.humidity)}%`,
        section.windSpeed === undefined ? undefined : `바람 ${section.windSpeed.toFixed(1)}km/h`,
      ].filter((value): value is string => Boolean(value));
    case 'list':
      return section.items.map((item) => `- ${item.label}${item.value === undefined ? '' : `: ${scalarText(item.value)}`}`);
    case 'progress':
      return [`진행률: ${section.progress}%`];
    case 'status':
      return [`상태: ${section.status}`, section.description].filter((value): value is string => Boolean(value));
  }
}

export function createAdaptiveCardAttachment(input: GenUiEnvelopeV1): TeamsAdaptiveCardAttachment {
  return {
    contentType: 'application/vnd.microsoft.card.adaptive',
    content: renderGenUiCard(input),
  };
}

export function genUiTextFallback(input: GenUiEnvelopeV1): string {
  const envelope = GenUiEnvelopeV1Schema.parse(input);
  const lines: string[] = [];
  if (envelope.title) lines.push(envelope.title);
  if (envelope.summary) lines.push(envelope.summary);
  lines.push(`상태: ${envelope.status}`);
  for (const section of envelope.sections) {
    const heading = section.title ?? section.label;
    if (heading) lines.push(heading);
    if (section.description && section.type !== 'status') lines.push(section.description);
    lines.push(...sectionText(section));
  }
  if (envelope.aiGenerated && envelope.citations.length > 0) {
    lines.push('출처:');
    lines.push(...envelope.citations.filter((citation) => isSafeGenUiUrl(citation.url)).map((citation) => `${citation.title}: ${citation.url}`));
  }
  return envelope.fallbackText ?? (lines.join('\n') || '요청 결과를 카드로 확인하세요.');
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
