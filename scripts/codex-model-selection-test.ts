import assert from 'node:assert/strict';

import {
  assertCoreCodexModelSelection,
  loadCodexModelCatalog,
  parseCodexModelCatalogPayload,
} from '../src/server/codex-model-catalog.js';
import { buildCodexExecArguments } from '../src/server/codex-runner.js';
import { canonicalRequestHash } from '../src/server/core-orchestration-service.js';

const observedAt = '2026-09-05T04:00:00.000Z';
const catalog = parseCodexModelCatalogPayload([
  {
    slug: 'hidden-model',
    display_name: 'Hidden',
    visibility: 'hide',
    default_reasoning_level: 'high',
    supported_reasoning_levels: [{ effort: 'high', description: 'hidden' }],
  },
  {
    slug: 'gpt-5.6-sol',
    display_name: 'GPT-5.6-Sol',
    visibility: 'list',
    default_reasoning_level: 'low',
    supported_reasoning_levels: [
      { effort: 'low', description: 'fast' },
      { effort: 'high', description: 'deep' },
      { effort: 'ultra', description: 'delegated' },
    ],
  },
  {
    slug: 'gpt-5.5',
    display_name: 'GPT-5.5',
    visibility: 'list',
    default_reasoning_level: 'medium',
    supported_reasoning_levels: [
      { effort: 'low', description: 'fast' },
      { effort: 'medium', description: 'balanced' },
      { effort: 'xhigh', description: 'deep' },
    ],
  },
], observedAt);

const currentCliCatalog = parseCodexModelCatalogPayload({
  models: [
    {
      slug: 'gpt-5.6-sol',
      display_name: 'GPT-5.6-Sol',
      visibility: 'list',
      default_reasoning_level: 'low',
      supported_reasoning_levels: [
        { effort: 'low', description: 'fast' },
        { effort: 'high', description: 'deep' },
      ],
    },
  ],
}, observedAt);
assert.equal(
  currentCliCatalog.models[0]?.id,
  'gpt-5.6-sol',
  'the installed CLI object envelope is accepted without weakening model validation',
);

assert.equal(catalog.source, 'codex-debug-models');
assert.equal(catalog.observedAt, observedAt);
assert.match(catalog.revision, /^[a-f0-9]{64}$/u);
assert.deepEqual(catalog.models, [
  {
    id: 'gpt-5.6-sol',
    label: 'GPT-5.6-Sol',
    defaultReasoningEffort: 'low',
    reasoningEfforts: ['low', 'high', 'ultra'],
  },
  {
    id: 'gpt-5.5',
    label: 'GPT-5.5',
    defaultReasoningEffort: 'medium',
    reasoningEfforts: ['low', 'medium', 'xhigh'],
  },
], 'only visible installed CLI models and their measured reasoning levels are exposed');

const selection = assertCoreCodexModelSelection(catalog, {
  model: 'gpt-5.6-sol',
  reasoningEffort: 'ultra',
  catalogRevision: catalog.revision,
});
assert.deepEqual(selection, {
  model: 'gpt-5.6-sol',
  reasoningEffort: 'ultra',
  catalogRevision: catalog.revision,
});

for (const invalid of [
  { ...selection, catalogRevision: '0'.repeat(64) },
  { ...selection, model: 'hidden-model' },
  { ...selection, reasoningEffort: 'minimal' },
  { ...selection, model: '--dangerous' },
]) {
  assert.throws(
    () => assertCoreCodexModelSelection(catalog, invalid as never),
    /catalog|model|reasoning/i,
  );
}

assert.throws(
  () => parseCodexModelCatalogPayload([{
    slug: 'broken-visible-model',
    display_name: 'Broken',
    visibility: 'list',
    default_reasoning_level: 'medium',
    supported_reasoning_levels: [{ effort: 'invented' }],
  }], observedAt),
  /reasoning/i,
  'a malformed visible model fails the whole catalog closed',
);

const args = buildCodexExecArguments({
  prefixArgs: [],
  mode: 'workspace-write',
  workspace: '/srv/teams-app',
  enrichedPrompt: 'USER REQUEST:\nrun tests',
  selection,
});
assert.deepEqual(args.slice(0, 10), [
  'exec',
  '--json',
  '--sandbox',
  'workspace-write',
  '--cd',
  '/srv/teams-app',
  '--model',
  'gpt-5.6-sol',
  '--config',
  'model_reasoning_effort="ultra"',
]);
assert.deepEqual(args.slice(-2), ['--', 'USER REQUEST:\nrun tests']);
assert.throws(() => buildCodexExecArguments({
  prefixArgs: [],
  mode: 'workspace-write',
  workspace: '/srv/teams-app',
  enrichedPrompt: 'run tests',
  selection: { ...selection, model: 'gpt-5.6-sol --dangerous' },
}), /model/i, 'argv construction independently rejects injected model text');

let catalogCommand: Readonly<{
  executable: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}> | undefined;
const loadedCatalog = await loadCodexModelCatalog({
  executable: '/opt/teams/codex',
  codexHome: '/var/lib/teams-codex-worker',
  observedAt: () => observedAt,
  execute: async (command) => {
    catalogCommand = command;
    return { stdout: JSON.stringify([
      {
        slug: 'gpt-5.6-sol',
        display_name: 'GPT-5.6-Sol',
        visibility: 'list',
        default_reasoning_level: 'low',
        supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }],
      },
    ]) };
  },
});
assert.equal(loadedCatalog.models[0]?.id, 'gpt-5.6-sol');
assert.deepEqual(catalogCommand?.args, ['debug', 'models']);
assert.equal(catalogCommand?.executable, '/opt/teams/codex');
assert.equal(catalogCommand?.env.CODEX_HOME, '/var/lib/teams-codex-worker');
assert.equal(catalogCommand?.env.UNRELATED_CREDENTIAL, undefined);
assert.equal(catalogCommand?.timeoutMs, 15_000);

await assert.rejects(
  loadCodexModelCatalog({
    executable: 'codex',
    codexHome: '/var/lib/teams-codex-worker',
    execute: async () => ({ stdout: '[]' }),
  }),
  /absolute/i,
  'the observed catalog is bound to an explicit absolute worker executable',
);

const baseHash = canonicalRequestHash({
  prompt: 'inspect repository',
  provider: 'codex',
  mode: 'read-only',
});
const selectedHash = canonicalRequestHash({
  prompt: 'inspect repository',
  provider: 'codex',
  mode: 'read-only',
  ...selection,
});
assert.notEqual(baseHash, selectedHash, 'selection identity participates in idempotency');
assert.notEqual(selectedHash, canonicalRequestHash({
  prompt: 'inspect repository',
  provider: 'codex',
  mode: 'read-only',
  ...selection,
  reasoningEffort: 'high',
}), 'reasoning changes cannot replay the same idempotent submission');

console.log('codex-model-selection-test: PASS');
