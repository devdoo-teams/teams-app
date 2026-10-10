import { isDeepStrictEqual } from 'node:util';
import { createNativeNode, type ChannelNode } from '@copilotkit/channels-ui';
import { renderTeamsNativeCard } from '@copilotkit/channels-teams/render';
import { isSafeGenUiUrl } from '../shared/genui.js';

type RecordValue = Record<string, unknown>;
export type ChannelsCoreCard = Readonly<{
  type: 'AdaptiveCard'; version: string; $schema?: string;
  body: readonly RecordValue[]; actions?: readonly RecordValue[];
  [key: string]: unknown;
}>;
export type ChannelsCoreIdentity = Readonly<{ jobId: string; requestId?: string; approvalId?: string }>;
export type ChannelsCoreScope = Readonly<{ tenantId: string; requesterId: string; conversationId: string }>;
/** Caller-provided display allowlist, after existing owner-scoped lookup. This never grants execution. */
export type ChannelsCoreActionGrant = Readonly<{
  scope: ChannelsCoreScope; identity: ChannelsCoreIdentity; data: Readonly<RecordValue>;
}>;
export type ChannelsNativeCardInput = Readonly<{
  card: ChannelsCoreCard; kind: 'approval' | 'result' | 'error';
  identity: ChannelsCoreIdentity; scope: ChannelsCoreScope;
  actionGrants: readonly ChannelsCoreActionGrant[];
}>;
export type ChannelsNativeCardResult = Readonly<{
  card: ChannelsCoreCard; plainText: string; payloadBytes: number; identity: ChannelsCoreIdentity;
  status: 'faithful' | 'fallback' | 'blocked';
  contract: typeof CHANNELS_NATIVE_RENDERER_CONTRACT;
  diagnostics: Readonly<{
    unsupportedElements: number; excludedActions: number; inputContractMismatch: boolean;
    actionPayloadsPreserved: boolean; withinTeamsBudget: boolean;
    reason?: 'CONTRACT_DRIFT_BLOCKED' | 'CARD_BUDGET_BLOCKED';
  }>;
}>;

/** Installed 0.7.3 exports were checked against the current primary source; no adapter/runtime is constructed.
 * https://github.com/CopilotKit/CopilotKit/blob/main/packages/channels-teams/src/render/index.ts
 * https://github.com/CopilotKit/CopilotKit/blob/main/packages/channels-teams/src/native-codec.ts
 * https://learn.microsoft.com/en-us/microsoftteams/platform/task-modules-and-cards/cards/cards-reference#support-for-adaptive-cards
 */
export const CHANNELS_NATIVE_RENDERER_CONTRACT = Object.freeze({
  packageVersion: '0.7.3', license: 'MIT', renderer: 'renderTeamsNativeCard',
  crossPlatformVersion: '1.5', deliveredVersion: '1.6', callbackRegistryUsed: false,
} as const);
const BUDGET = 28 * 1024;
const COMMON = ['id', 'spacing', 'separator', 'isVisible', 'height'] as const;
const ACTION_COMMON = ['id', 'title', 'associatedInputs', 'tooltip', 'mode'] as const;
const PROTOCOL_KEYS = new Set(['ckActionId', 'value', 'shadow', 'renderer', 'onClick', 'onSubmit', 'onSelect']);
const record = (value: unknown): value is RecordValue => !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0
  && value.length <= 512 && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const block = (text: string): RecordValue => ({ type: 'TextBlock', text, wrap: true });

function cloneJson<T>(value: T): T {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(cloneJson) as T;
  if (record(value) && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneJson(entry)])) as T;
  }
  throw new Error('CHANNELS_CORE_CONTRACT_INVALID');
}
function pick(value: RecordValue, keys: readonly string[]): RecordValue {
  return Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, cloneJson(value[key])]));
}
/** Display text only: never traverse action data, authentication, or callback values. */
function displayText(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(displayText);
  if (!record(value)) return [];
  const type = value.type;
  if (type === 'FactSet') return Array.isArray(value.facts)
    ? value.facts.filter(record).map(fact => `${String(fact.title ?? '')}: ${String(fact.value ?? '')}`) : [];
  if (typeof type === 'string' && type.startsWith('Chart.')) return [
    ...(typeof value.title === 'string' ? [value.title] : []),
    ...(Array.isArray(value.data) ? value.data.filter(record).flatMap(point =>
      Array.isArray(point.values) ? point.values.filter(record).map(entry => `${String(entry.x ?? entry.label ?? '')}: ${String(entry.y ?? entry.value ?? '')}`)
        : [`${String(point.x ?? point.label ?? point.legend ?? '')}: ${String(point.y ?? point.value ?? '')}`]) : []),
  ];
  return [
    ...['text', 'altText', 'label'].flatMap(key => typeof value[key] === 'string' ? [value[key] as string] : []),
    ...['body', 'items', 'columns', 'rows', 'cells', 'inlines'].flatMap(key => displayText(value[key])),
  ];
}
function plainText(card: ChannelsCoreCard): string {
  return [...displayText(card.body), ...(card.actions ?? []).flatMap(action =>
    action.type === 'Action.OpenUrl' && typeof action.url === 'string' && isSafeGenUiUrl(action.url)
      ? [`${String(action.title ?? '')}: ${action.url}`] : [])].join('\n');
}
function nativeNode(value: RecordValue): ChannelNode {
  const { type, ...props } = value;
  if (typeof type !== 'string') throw new Error('CHANNELS_CORE_CONTRACT_INVALID');
  const kind = type.startsWith('Action.') ? 'action' : type.startsWith('Input.') ? 'input' : 'element';
  const nativeType = type.startsWith('Action.') ? type.slice(7) : type.startsWith('Input.') ? type.slice(6) : type;
  // Explicit data and field IDs, with no handlers: native codec cannot inject ckActionId or rename inputs.
  return createNativeNode('teams', kind, nativeType, props);
}

/**
 * Pure renderer-only comparison for existing canonical Core cards. The caller
 * owns transport, authenticated scope, grant expiry/consumption, and durable
 * approvals. Do not derive grants from an untrusted card or use these results
 * to authorize a submit. Enable only through an explicit renderer feature flag.
 */
export function renderChannelsNativeCard(input: ChannelsNativeCardInput): ChannelsNativeCardResult {
  if (!input || !['approval', 'result', 'error'].includes(input.kind) || !record(input.scope)
    || Object.keys(input.scope).length !== 3
    || !['tenantId', 'requesterId', 'conversationId'].every(key => identifier(input.scope[key as keyof ChannelsCoreScope]))
    || !record(input.identity) || !identifier(input.identity.jobId)
    || Object.entries(input.identity).some(([key, value]) => !['jobId', 'requestId', 'approvalId'].includes(key) || !identifier(value))
    || !record(input.card) || input.card.type !== 'AdaptiveCard' || !Array.isArray(input.card.body)
    || !Array.isArray(input.actionGrants)) throw new Error('CHANNELS_CORE_CONTRACT_INVALID');

  let unsupportedElements = 0; let excludedActions = 0; let versionDrift = input.card.version !== '1.6';
  const inputIds = new Set<string>(); const payloadKeys = new Set(['action', 'schemaVersion', 'jobId', 'requestId', 'approvalId']);
  let inputContractMismatch = false;
  function inspect(value: unknown): void {
    if (Array.isArray(value)) { value.forEach(inspect); return; }
    if (!record(value)) return;
    if (typeof value.type === 'string' && value.type.startsWith('Input.')) {
      if (!identifier(value.id) || inputIds.has(value.id)) inputContractMismatch = true;
      else inputIds.add(value.id);
    }
    if (value.type === 'Action.Submit' && record(value.data)) Object.keys(value.data).forEach(key => payloadKeys.add(key));
    for (const key of ['body', 'actions', 'items', 'columns', 'rows', 'cells', 'card', 'fallback']) inspect(value[key]);
  }
  inspect(input.card);
  if ([...inputIds].some(id => payloadKeys.has(id) || PROTOCOL_KEYS.has(id))) inputContractMismatch = true;

  function allowed(data: unknown): data is RecordValue {
    if (inputContractMismatch || !record(data) || data.schemaVersion !== '1'
      || typeof data.action !== 'string' || !/^orchestration\.[a-z][a-z-]*$/u.test(data.action)
      || data.jobId !== input.identity.jobId || Object.keys(data).some(key => PROTOCOL_KEYS.has(key))) return false;
    for (const key of ['requestId', 'approvalId'] as const) {
      if (data[key] !== undefined && data[key] !== input.identity[key]) return false;
    }
    return input.actionGrants.some(grant => record(grant) && isDeepStrictEqual(grant.scope, input.scope)
      && isDeepStrictEqual(grant.identity, input.identity) && isDeepStrictEqual(grant.data, data));
  }
  function actions(values: unknown): RecordValue[] {
    if (!Array.isArray(values)) return [];
    return values.filter(record).flatMap<RecordValue>(action => {
      const common = pick(action, ACTION_COMMON);
      if (action.type === 'Action.Submit' && allowed(action.data)) {
        return [{ type: 'Action.Submit', ...common, data: cloneJson(action.data) }];
      }
      if (action.type === 'Action.OpenUrl' && typeof action.url === 'string' && isSafeGenUiUrl(action.url)) {
        return [{ type: 'Action.OpenUrl', ...common, url: action.url }];
      }
      if (action.type === 'Action.ShowCard' && record(action.card) && Array.isArray(action.card.body)) {
        if (action.card.version !== '1.6') versionDrift = true;
        return [{ type: 'Action.ShowCard', ...common, card: sanitizeCard(action.card as ChannelsCoreCard) }];
      }
      if (action.type === 'Action.Execute' && record(action.fallback) && action.fallback.type === 'Action.Submit') {
        unsupportedElements += 1;
        return actions([action.fallback]);
      }
      excludedActions += 1;
      return [];
    });
  }
  function elements(values: readonly RecordValue[], extraActions: RecordValue[]): RecordValue[] {
    return values.filter(record).flatMap<RecordValue>(element => {
      const common = pick(element, COMMON);
      if (element.type === 'TextBlock' && typeof element.text === 'string') return [{ type: 'TextBlock', ...common,
        ...pick(element, ['text', 'wrap', 'size', 'weight', 'color', 'isSubtle', 'maxLines', 'horizontalAlignment']) }];
      if (element.type === 'FactSet' && Array.isArray(element.facts) && element.facts.every(fact =>
        record(fact) && typeof fact.title === 'string' && typeof fact.value === 'string')) {
        return [{ type: 'FactSet', ...common, facts: element.facts.map(fact => pick(fact as RecordValue, ['title', 'value'])) }];
      }
      if (!inputContractMismatch && element.type === 'Input.Text' && identifier(element.id)) return [{ type: 'Input.Text', ...common,
        ...pick(element, ['id', 'label', 'placeholder', 'isMultiline', 'maxLength', 'value', 'isRequired', 'errorMessage', 'style']) }];
      if (!inputContractMismatch && element.type === 'Input.ChoiceSet' && identifier(element.id)
        && Array.isArray(element.choices) && element.choices.every(choice => record(choice)
          && typeof choice.title === 'string' && typeof choice.value === 'string')) return [{ type: 'Input.ChoiceSet', ...common,
        ...pick(element, ['id', 'label', 'placeholder', 'isMultiSelect', 'value', 'isRequired', 'errorMessage', 'style', 'wrap']),
        choices: element.choices.map(choice => pick(choice as RecordValue, ['title', 'value'])) }];
      unsupportedElements += 1;
      if (element.type === 'ActionSet') { extraActions.push(...actions(element.actions)); return []; }
      if (element.type === 'Container' && Array.isArray(element.items)) return elements(element.items as RecordValue[], extraActions);
      const text = displayText(element).join('\n') || '이 요소는 지원되지 않습니다. 업무 허브에서 상세를 확인하세요.';
      return [block(text)];
    });
  }
  function sanitizeCard(card: ChannelsCoreCard): ChannelsCoreCard {
    const extraActions: RecordValue[] = [];
    const body = elements(card.body, extraActions);
    const cardActions = [...extraActions, ...actions(card.actions)];
    return { type: 'AdaptiveCard', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', version: '1.6',
      ...pick(card as RecordValue, ['msteams', 'speak', 'fallbackText', 'lang']), body,
      ...(cardActions.length ? { actions: cardActions } : {}) };
  }
  const safe = sanitizeCard(input.card);
  let card: ChannelsCoreCard = renderTeamsNativeCard([createNativeNode('teams', 'root', 'AdaptiveCard', {
    version: '1.6', ...pick(safe as RecordValue, ['msteams', 'speak', 'fallbackText', 'lang']),
    children: [...safe.body, ...(safe.actions ?? [])].map(nativeNode),
  })]) as unknown as ChannelsCoreCard;
  const oversize = bytes(card) > BUDGET;
  const reason = versionDrift ? 'CONTRACT_DRIFT_BLOCKED' : oversize ? 'CARD_BUDGET_BLOCKED' : undefined;
  if (reason) {
    // Never truncate opaque grants. A blocked comparison emits display text only.
    card = { type: 'AdaptiveCard', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', version: '1.6',
      body: [block(`${displayText(safe.body).join('\n').slice(0, 4_000)}\n카드 실행을 확인할 수 없습니다. 업무 허브에서 작업을 다시 여세요.`)],
      ...(safe.actions?.some(action => action.type === 'Action.OpenUrl')
        ? { actions: safe.actions.filter(action => action.type === 'Action.OpenUrl') } : {}),
    };
    if (bytes(card) > BUDGET) card = { ...card, actions: [] };
  }
  return { card, plainText: plainText(card), payloadBytes: bytes(card), identity: { ...input.identity },
    contract: CHANNELS_NATIVE_RENDERER_CONTRACT,
    status: reason ? 'blocked' : isDeepStrictEqual(card, input.card) ? 'faithful' : 'fallback',
    diagnostics: { unsupportedElements, excludedActions, inputContractMismatch,
      actionPayloadsPreserved: !reason && excludedActions === 0 && !inputContractMismatch,
      withinTeamsBudget: bytes(card) <= BUDGET, ...(reason ? { reason } : {}) },
  };
}
