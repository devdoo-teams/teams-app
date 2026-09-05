import assert from 'node:assert/strict';

import {
  CODEX_TOKEN_USAGE_SOURCE,
  isAgentTokenUsage,
  parseCodexTokenUsage,
} from '../src/server/agent-token-usage.js';

const expected = {
  source: CODEX_TOKEN_USAGE_SOURCE,
  inputTokens: 24_763,
  cachedInputTokens: 24_448,
  outputTokens: 122,
  reasoningOutputTokens: 0,
};

assert.deepEqual(parseCodexTokenUsage({
  input_tokens: 24_763,
  cached_input_tokens: 24_448,
  output_tokens: 122,
  reasoning_output_tokens: 0,
}), expected, 'the four documented JSONL counters are normalized');

for (const invalid of [
  undefined,
  null,
  [],
  { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 },
  { input_tokens: -1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 },
  { input_tokens: 1.5, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 },
  { input_tokens: Number.MAX_SAFE_INTEGER + 1, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 },
]) {
  assert.equal(parseCodexTokenUsage(invalid), undefined, 'partial or unsafe JSONL usage is unavailable');
}

assert.equal(isAgentTokenUsage(expected), true, 'canonical token usage is accepted');
assert.equal(isAgentTokenUsage({ ...expected, unexpected: 1 }), false, 'persisted canonical usage rejects unknown fields');

console.log('PASS: Codex terminal token usage accepts only documented non-negative safe-integer counters');
