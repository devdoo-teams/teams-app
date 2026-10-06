import type { CoreAgentTokenUsage } from './core-orchestration.js';
type TokenUsageRecord = Record<string, unknown>;
const CANONICAL_TOKEN_USAGE_KEYS = new Set([
  'source',
  'inputTokens',
  'cachedInputTokens',
  'cacheWriteInputTokens',
  'outputTokens',
  'reasoningOutputTokens',
]);

function isRecord(value: unknown): value is TokenUsageRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isAgentTokenUsage(value: unknown): value is CoreAgentTokenUsage {
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((key) => !CANONICAL_TOKEN_USAGE_KEYS.has(key))) return false;
  return value.source === 'codex.exec.jsonl.turn.completed.usage'
    && isTokenCount(value.inputTokens)
    && isTokenCount(value.cachedInputTokens)
    && (value.cacheWriteInputTokens === undefined || isTokenCount(value.cacheWriteInputTokens))
    && isTokenCount(value.outputTokens)
    && isTokenCount(value.reasoningOutputTokens);
}
