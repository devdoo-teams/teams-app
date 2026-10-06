import type { GenUiEnvelopeV1 } from '../shared/genui.js';
import { createAdaptiveCardActivity } from './genui-teams.js';

export function upgradePersonalNotificationCard(activity: ReturnType<typeof createAdaptiveCardActivity>) {
  if (!activity.attachments?.length || activity.attachments.some((attachment) =>
    attachment.contentType !== "application/vnd.microsoft.card.adaptive" || attachment.content.type !== "AdaptiveCard")) {
    throw new Error("PERSONAL_NOTIFICATION_CARD_UNSUPPORTED");
  }
  const upgrade = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (node.type === 'AdaptiveCard') node.version = '1.6';
    if (typeof node.type === 'string' && node.type.startsWith('Action.')) {
      if (!['Action.Submit', 'Action.ShowCard', 'Action.OpenUrl'].includes(node.type)
        || node.style === 'positive' || node.style === 'destructive') throw new Error('PERSONAL_NOTIFICATION_CARD_UNSUPPORTED');
    }
    if (typeof node.type === 'string' && node.type.startsWith('Input.')
      && !['Input.Text', 'Input.ChoiceSet'].includes(node.type)) throw new Error('PERSONAL_NOTIFICATION_CARD_UNSUPPORTED');
    for (const child of Object.values(node)) upgrade(child);
  };
  upgrade(activity);
  return activity as unknown as Omit<typeof activity, 'attachments'> & {
    attachments: Array<Omit<typeof activity.attachments[number], 'content'> & {
      content: Omit<typeof activity.attachments[number]['content'], 'version'> & { version: '1.6' };
    }>;
  };
}

export function createPersonalNotificationCard(input: GenUiEnvelopeV1) {
  return upgradePersonalNotificationCard(createAdaptiveCardActivity(input));
}

export function sendPersonalNotificationCard<T>(
  sender: (text: string, envelope?: GenUiEnvelopeV1, activityOverride?: unknown) => Promise<T>,
  envelope: GenUiEnvelopeV1,
): Promise<T> {
  return sender(envelope.fallbackText ?? '요청 결과를 카드로 확인하세요.', undefined,
    createPersonalNotificationCard(envelope));
}
