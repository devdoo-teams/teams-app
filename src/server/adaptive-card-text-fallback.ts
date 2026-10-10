import { redactSensitiveText } from './sensitive-text.js';

const fallbackMessage = '카드 메시지를 전달하지 못했습니다. 업무 허브 탭에서 작업 결과를 확인하세요.';
const maximumLength = 4_000;

/** Project only already visible card text; inputs, actions and hidden cards stay private. */
export function adaptiveCardTextFallback(activity: unknown): string {
  const record = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  const message = record(activity);
  const lines: string[] = [];
  let budget = maximumLength;
  const add = (value: unknown): void => {
    if (typeof value !== 'string' || budget <= 0) return;
    const text = redactSensitiveText(value).trim().slice(0, budget);
    if (!text) return;
    lines.push(text);
    budget -= text.length + 1;
  };
  const body = (value: unknown, depth = 0): void => {
    if (!Array.isArray(value) || depth > 4) return;
    for (const item of value.slice(0, 100)) {
      const element = record(item);
      if (!element || element.isVisible === false || budget <= 0) continue;
      if (element.type === 'TextBlock') add(element.text);
      if (element.type === 'FactSet' && Array.isArray(element.facts)) {
        for (const fact of element.facts.slice(0, 40)) {
          const field = record(fact);
          if (typeof field?.title === 'string' && typeof field.value === 'string') add(`${field.title}: ${field.value}`);
        }
      }
      if (element.type === 'Container' || element.type === 'Column') body(element.items, depth + 1);
      if (element.type === 'ColumnSet') body(element.columns, depth + 1);
    }
  };
  add(message?.text);
  if (Array.isArray(message?.attachments)) {
    for (const attachment of message.attachments.slice(0, 10)) {
      const card = record(attachment);
      if (card?.contentType === 'application/vnd.microsoft.card.adaptive') body(record(card.content)?.body);
    }
  }
  return lines.join('\n').slice(0, maximumLength) || fallbackMessage;
}
