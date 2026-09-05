import {
  Actions,
  Button,
  Field,
  Fields,
  Header,
  Message,
  Section,
  Context,
  renderToIR,
  type BotChildren,
  type ChannelNode,
  type ClickHandler,
} from '@copilotkit/channels-ui';
import {
  collectPlainText,
  renderAdaptiveCard,
  type AdaptiveCard,
} from '@copilotkit/channels-teams';

import {
  GENUI_SCHEMA_VERSION,
  GenUiEnvelopeV1Schema,
  isSafeGenUiUrl,
  type GenUiSectionType,
  type GenUiAction,
  type GenUiEnvelopeV1,
  type GenUiFact,
  type GenUiItem,
  type GenUiScalar,
  type GenUiSection,
} from '../shared/genui.js';
import {
  createGenUiSemanticSignature,
  type GenUiSemanticSignature,
} from './genui-teams.js';

export const CHANNELS_SHADOW_RENDERER = 'copilotkit-channels-shadow';
export const TEAMS_CARD_BUDGET_BYTES = 28 * 1024;

export interface ChannelsShadowDiagnostics {
  missingTitle: boolean;
  missingSummary: boolean;
  actionCount: number;
  withinTeamsBudget: boolean;
}

export interface ChannelsShadowResult {
  card: AdaptiveCard;
  plainText: string;
  payloadBytes: number;
  diagnostics: ChannelsShadowDiagnostics;
  semanticSignature: GenUiSemanticSignature;
}

interface ShadowActionValue {
  shadow: true;
  renderer: typeof CHANNELS_SHADOW_RENDERER;
  schemaVersion: typeof GENUI_SCHEMA_VERSION;
  action: GenUiAction['action'];
  entityId: string;
  correlationId: string;
  actionToken: string;
  id?: string;
  style?: GenUiAction['style'];
}

const KIND_LABELS: Record<GenUiEnvelopeV1['kind'], string> = {
  answer: '답변',
  'task-list': '업무 목록',
  'job-status': '작업 상태',
  approval: '승인 요청',
  result: '결과',
  error: '오류',
};

function scalarText(value: GenUiScalar | undefined): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'boolean') return value ? '예' : '아니요';
  return String(value);
}

function factText(fact: GenUiFact): string {
  return `${fact.label}: ${scalarText(fact.value)}${fact.unit ? ` ${fact.unit}` : ''}`;
}

function itemText(item: GenUiItem): string {
  const value = item.value === undefined ? '' : `: ${scalarText(item.value)}`;
  const status = item.status ? ` (${item.status})` : '';
  return `• ${item.label}${value}${status}`;
}

function textChildren(lines: Array<string | undefined>): BotChildren[] {
  return lines.filter((line): line is string => Boolean(line && line.length > 0));
}

function sectionWithHeading(
  section: GenUiSection,
  children: BotChildren[],
): ChannelNode[] {
  const heading = section.title ?? section.label;
  const sectionChildren: BotChildren[] = [
    ...(section.description ? [section.description] : []),
    ...children,
  ];
  return [
    ...(heading ? [Header({ children: heading })] : []),
    Section({ children: sectionChildren }),
  ];
}

function fieldsForFacts(facts: GenUiFact[]): ChannelNode {
  return Fields({
    children: facts.map((fact) => Field({
      label: fact.label,
      // The current Teams renderer reads Field text, while other providers can
      // use the semantic label prop. Keep both in the provider-neutral node.
      children: factText(fact),
    })),
  });
}

function renderSection(section: GenUiSection): ChannelNode[] {
  switch (section.type) {
    case 'text':
      return sectionWithHeading(section, textChildren([
        section.text,
        section.content,
        section.value === undefined ? undefined : scalarText(section.value),
      ]));
    case 'facts':
      return sectionWithHeading(section, [
        ...(section.value === undefined ? [] : [scalarText(section.value)]),
        ...(section.facts && section.facts.length > 0 ? [fieldsForFacts(section.facts)] : []),
      ]);
    case 'stats':
      return sectionWithHeading(section, [fieldsForFacts(section.stats)]);
    case 'list':
      return sectionWithHeading(section, [section.items.length > 0
        ? section.items.map(itemText).join('\n')
        : '표시할 항목이 없습니다.']);
    case 'progress':
      return sectionWithHeading(section, [`진행률: ${section.progress}%`]);
    case 'status':
      return sectionWithHeading(section, textChildren([
        `상태: ${section.status}`,
        section.description,
      ]));
  }
}

function openTabUrl(
  envelope: GenUiEnvelopeV1,
  action: GenUiAction,
  index: number,
): string | undefined {
  if (action.action !== 'open-tab') return undefined;

  const metadata = envelope.metadata;
  const keys = [
    action.id ? `openTabUrl.${action.id}` : undefined,
    `openTabUrl.${index}`,
    'openTabUrl',
  ].filter((key): key is string => Boolean(key));

  for (const key of keys) {
    const candidate = metadata[key];
    if (typeof candidate === 'string' && isSafeGenUiUrl(candidate)) return candidate;
  }
  return undefined;
}

function shadowActionValue(action: GenUiAction): ShadowActionValue {
  return {
    shadow: true,
    renderer: CHANNELS_SHADOW_RENDERER,
    schemaVersion: GENUI_SCHEMA_VERSION,
    ...(action.id ? { id: action.id } : {}),
    action: action.action,
    entityId: action.entityId,
    correlationId: action.correlationId,
    actionToken: action.actionToken,
    style: action.style,
  };
}

function shadowButton(action: GenUiAction, index: number, envelope: GenUiEnvelopeV1): ChannelNode {
  const value = shadowActionValue(action);
  const onClick = { id: `${CHANNELS_SHADOW_RENDERER}:${index}:${action.action}` } as unknown as ClickHandler<ShadowActionValue>;
  const url = openTabUrl(envelope, action, index);

  return Button({
    children: action.label,
    value,
    onClick,
    ...(url ? { url } : {}),
    ...(action.style === 'positive' ? { style: 'primary' as const } : {}),
    ...(action.style === 'destructive' ? { style: 'danger' as const } : {}),
  });
}

function promptAction(prompt: string): Record<string, unknown> {
  return {
    type: 'Action.ShowCard',
    title: '프롬프트 보기',
    card: {
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.2',
      msteams: { width: 'Full' },
      body: [{
        type: 'TextBlock',
        text: prompt,
        wrap: true,
        spacing: 'Small',
        isSubtle: true,
      }],
    },
  };
}

function citationSection(envelope: GenUiEnvelopeV1): ChannelNode | undefined {
  if (!envelope.aiGenerated || envelope.citations.length === 0) return undefined;
  return Section({
    children: [
      '출처',
      envelope.citations.map((citation) => [
        `${citation.title}: ${citation.url}`,
        ...(citation.snippet ? [citation.snippet] : []),
      ].join('\n')).join('\n'),
    ],
  });
}

/** Convert the shared envelope into CopilotKit's provider-neutral Channels IR. */
interface ChannelsIRRenderResult {
  ir: ChannelNode[];
  semanticSignature: GenUiSemanticSignature;
}

function envelopeToChannelsIRDiagnostic(input: GenUiEnvelopeV1): ChannelsIRRenderResult {
  const envelope = GenUiEnvelopeV1Schema.parse(input);
  const renderedSectionTypes: GenUiSectionType[] = [];
  const title = envelope.title?.trim() || `업무 허브 · ${KIND_LABELS[envelope.kind]}`;
  const renderedSections = envelope.sections.flatMap((section) => {
    const nodes = renderSection(section);
    if (nodes.length > 0) renderedSectionTypes.push(section.type);
    return nodes;
  });
  const citations = citationSection(envelope);
  const children: BotChildren[] = [
    Header({ children: title }),
    Context({ children: `상태: ${envelope.status} · ${CHANNELS_SHADOW_RENDERER} · 사용자에게 전송하지 않음` }),
    ...(envelope.summary?.trim() ? [Section({ children: envelope.summary })] : []),
    ...renderedSections,
    ...(citations ? [citations] : []),
    ...(envelope.actions.length > 0
      ? [Actions({ children: envelope.actions.map((action, index) => shadowButton(action, index, envelope)) })]
      : []),
  ];

  return {
    ir: renderToIR(Message({ children })),
    semanticSignature: createGenUiSemanticSignature(
      envelope.kind,
      envelope.status,
      renderedSectionTypes,
    ),
  };
}

export function envelopeToChannelsIR(input: GenUiEnvelopeV1): ChannelNode[] {
  return envelopeToChannelsIRDiagnostic(input).ir;
}

function cardBytes(card: AdaptiveCard): number {
  return Buffer.byteLength(JSON.stringify(card), 'utf8');
}

function cloneCard(card: AdaptiveCard): AdaptiveCard {
  return JSON.parse(JSON.stringify(card)) as AdaptiveCard;
}

function compactRenderableStrings(value: unknown, limit: number, key?: string, inActionData = false): void {
  if (Array.isArray(value)) {
    for (const item of value) compactRenderableStrings(item, limit, undefined, inActionData);
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [childKey, childValue] of Object.entries(value)) {
    if (childKey === 'data') {
      // The shadow action payload is intentionally opaque and must remain intact.
      continue;
    }
    if (typeof childValue === 'string' && !inActionData && ['text', 'title', 'value', 'altText'].includes(childKey)) {
      (value as Record<string, unknown>)[childKey] = childValue.length <= limit
        ? childValue
        : `${childValue.slice(0, Math.max(0, limit - 1))}…`;
      continue;
    }
    compactRenderableStrings(childValue, limit, childKey, inActionData || key === 'data');
  }
}

function fitTeamsBudget(card: AdaptiveCard): AdaptiveCard {
  if (cardBytes(card) <= TEAMS_CARD_BUDGET_BYTES) return card;

  // Channels already clamps per-element text and collections. This second,
  // whole-card pass handles envelopes containing many individually valid long
  // fields while leaving action data untouched for comparison fidelity.
  for (const limit of [8_000, 4_000, 2_000, 1_000, 500, 250, 120, 80, 40, 20, 8, 1]) {
    const candidate = cloneCard(card);
    compactRenderableStrings(candidate, limit);
    if (cardBytes(candidate) <= TEAMS_CARD_BUDGET_BYTES) return candidate;
  }

  // A pathological but schema-valid card can still contain many small elements.
  // Preserve the card shell, all available actions, and the first body elements
  // as a deterministic last-resort total-renderer fallback.
  const fallback = cloneCard(card);
  while (fallback.body.length > 1 && cardBytes(fallback) > TEAMS_CARD_BUDGET_BYTES) fallback.body.pop();
  return fallback;
}

/** Render a comparison-only Teams Adaptive Card shadow; it never sends activity. */
export function renderChannelsShadow(input: GenUiEnvelopeV1): ChannelsShadowResult {
  const envelope = GenUiEnvelopeV1Schema.parse(input);
  const irResult = envelopeToChannelsIRDiagnostic(envelope);
  const rawCard = renderAdaptiveCard(irResult.ir);
  // The native Teams renderer exposes the request prompt as an additional
  // Action.ShowCard. Keep the comparison card structurally aligned so shadow
  // diagnostics compare the mobile-visible action surface, not just the
  // provider-neutral execution actions.
  if (envelope.prompt) {
    rawCard.actions = [...(rawCard.actions ?? []), promptAction(envelope.prompt)];
  }
  const card = fitTeamsBudget(rawCard);
  const payloadBytes = cardBytes(card);

  return {
    card,
    plainText: collectPlainText(irResult.ir),
    payloadBytes,
    semanticSignature: irResult.semanticSignature,
    diagnostics: {
      missingTitle: !envelope.title?.trim(),
      missingSummary: !envelope.summary?.trim(),
      actionCount: card.actions?.length ?? 0,
      withinTeamsBudget: payloadBytes <= TEAMS_CARD_BUDGET_BYTES,
    },
  };
}
