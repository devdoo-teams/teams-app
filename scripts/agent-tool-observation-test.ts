import assert from 'node:assert/strict';

import {
  observeCodexToolUsage,
  mergeObservedToolUsage,
} from '../src/server/agent-tool-observation.js';

const observedAt = '2026-09-05T01:02:03.000Z';

assert.deepEqual(
  observeCodexToolUsage({
    type: 'item.started',
    item: { type: 'command_execution', command: '/bin/zsh -lc pwd' },
  }, observedAt),
  [{ category: 'cli', name: 'pwd', observedAt }],
  'the installed Codex JSONL command shape records only the safe executable name',
);

const commandWithProvenanceLookingPaths = observeCodexToolUsage({
  type: 'item.started',
  item: {
    type: 'command_execution',
    command: '/bin/zsh -lc "sed -n 1,200p /Users/example/.codex/plugins/cache/openai-curated-remote/superpowers/6.3.0/skills/systematic-debugging/SKILL.md --token=secret-value"',
  },
}, observedAt);
assert.deepEqual(commandWithProvenanceLookingPaths, [
  { category: 'cli', name: 'sed', observedAt },
], 'command paths are not inferred to prove skill or plugin provenance');
assert.doesNotMatch(JSON.stringify(commandWithProvenanceLookingPaths), /secret-value|--token|Users\/example|systematic-debugging|superpowers/u);

assert.deepEqual(
  observeCodexToolUsage({
    type: 'item.started',
    item: { type: 'mcp_tool_call', server: 'jira', name: 'search_issues' },
  }, observedAt),
  [{ category: 'mcp', name: 'jira/search_issues', observedAt }],
  'an explicitly named MCP event can be recorded without arguments or results',
);

assert.deepEqual(
  observeCodexToolUsage({
    type: 'item.started',
    item: { type: 'tool_call', name: 'grep' },
  }, observedAt),
  [{ category: 'builtin', name: 'grep', observedAt }],
  'an explicitly reported provider tool name is preserved without its arguments',
);

assert.deepEqual(
  observeCodexToolUsage({
    type: 'item.started',
    item: { type: 'command_execution', command: '/bin/zsh -lc "TOKEN=secret-value"' },
  }, observedAt),
  [],
  'environment assignments and secrets are not promoted into tool names',
);

const merged = mergeObservedToolUsage(
  [{ category: 'cli', name: 'pwd', observedAt: '2026-09-05T01:00:00.000Z' }],
  [
    { category: 'cli', name: 'pwd', observedAt },
    { category: 'skill', name: 'systematic-debugging', observedAt },
  ],
);
assert.deepEqual(merged, [
  { category: 'cli', name: 'pwd', observedAt: '2026-09-05T01:00:00.000Z' },
  { category: 'skill', name: 'systematic-debugging', observedAt },
]);

assert.deepEqual(
  mergeObservedToolUsage([], [{
    category: 'not-a-provider-category' as never,
    name: 'unsafe',
    observedAt,
  }]),
  [],
  'unknown tool categories fail closed instead of entering durable state',
);

console.log('agent-tool-observation-test: PASS');
