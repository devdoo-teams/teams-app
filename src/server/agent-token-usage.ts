import type { CoreAgentTokenUsage } from '../shared/core-orchestration.js';

export const CODEX_TOKEN_USAGE_SOURCE = 'codex.exec.jsonl.turn.completed.usage' as const;

export type AgentTokenUsage = CoreAgentTokenUsage;

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

/**
 * Parse the documented `codex exec --json` terminal usage record. A malformed
 * or partial record is unavailable telemetry, not a reason to discard an
 * otherwise valid terminal agent result.
 */
export function parseCodexTokenUsage(value: unknown): AgentTokenUsage | undefined {
  if (!isRecord(value)) return undefined;
  const inputTokens = value.input_tokens;
  const cachedInputTokens = value.cached_input_tokens;
  const outputTokens = value.output_tokens;
  const reasoningOutputTokens = value.reasoning_output_tokens;
  const cacheWriteInputTokens = value.cache_write_input_tokens;
  if (
    !isTokenCount(inputTokens)
    || !isTokenCount(cachedInputTokens)
    || !isTokenCount(outputTokens)
    || !isTokenCount(reasoningOutputTokens)
    || (cacheWriteInputTokens !== undefined && !isTokenCount(cacheWriteInputTokens))
  ) return undefined;

  return {
    source: CODEX_TOKEN_USAGE_SOURCE,
    inputTokens,
    cachedInputTokens,
    ...(cacheWriteInputTokens !== undefined ? { cacheWriteInputTokens } : {}),
    outputTokens,
    reasoningOutputTokens,
  };
}

export function isAgentTokenUsage(value: unknown): value is AgentTokenUsage {
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((key) => !CANONICAL_TOKEN_USAGE_KEYS.has(key))) return false;
  return value.source === CODEX_TOKEN_USAGE_SOURCE
    && isTokenCount(value.inputTokens)
    && isTokenCount(value.cachedInputTokens)
    && (value.cacheWriteInputTokens === undefined || isTokenCount(value.cacheWriteInputTokens))
    && isTokenCount(value.outputTokens)
    && isTokenCount(value.reasoningOutputTokens);
}
