export type AdaptiveCard = {
  body: unknown[];
  actions?: unknown[];
  [key: string]: unknown;
};

export function collectPlainText(value: unknown): string;
export function renderAdaptiveCard(value: unknown): AdaptiveCard;
