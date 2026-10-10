export type AdaptiveCard = {
  type: 'AdaptiveCard';
  $schema: string;
  version: string;
  body: Record<string, unknown>[];
  actions?: Record<string, unknown>[];
};

export function collectPlainText(value: unknown): string;
export function renderAdaptiveCard(value: unknown): AdaptiveCard;
