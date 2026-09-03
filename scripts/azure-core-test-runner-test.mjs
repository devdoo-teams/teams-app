import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  AZURE_CORE_TESTS,
  createAzureCoreTestInvocations,
} from './azure-core-test-runner.mjs';

const root = path.resolve(import.meta.dirname, '..');
const expectedScripts = [
  'scripts/azure-platform-contract-test.mjs',
  'scripts/azure-release-input-test.mjs',
  'scripts/azure-github-handoff-test.mjs',
  'scripts/azure-approval-check-test.mjs',
  'scripts/azure-deployment-contract-test.mjs',
  'scripts/azure-release-identity-test.ts',
  'scripts/azure-runtime-store-test.ts',
  'scripts/azure-agent-dispatch-queue-test.ts',
  'scripts/azure-agent-dispatch-sanitizer-boundary-test.ts',
  'scripts/azure-agent-dispatch-sanitizer-adversarial-test.ts',
  'scripts/azure-agent-job-ledger-composition-test.ts',
  'scripts/azure-dispatch-health-test.ts',
  'scripts/azure-dispatch-heartbeat-observation-test.ts',
  'scripts/azure-worker-bootstrap-contract-test.mjs',
  'scripts/azure-worker-build-contract-test.mjs',
  'scripts/azure-worker-contract-test.ts',
  'scripts/azure-index-integration-test.ts',
];

assert.deepEqual(
  AZURE_CORE_TESTS.map(({ script }) => script),
  expectedScripts,
  'Azure Core inventory must be explicit, stable, and include every Azure regression fixture',
);
assert.equal(new Set(AZURE_CORE_TESTS.map(({ script }) => script)).size, expectedScripts.length);
for (const script of expectedScripts) {
  assert.ok(fs.statSync(path.join(root, script)).isFile(), `Azure Core fixture must exist: ${script}`);
  assert.doesNotMatch(script, /grok|openai|copilot|mcp|optional/i, 'Azure Core must not absorb optional provider tests');
}

const sourceCommit = '0123456789abcdef0123456789abcdef01234567';
const invocations = createAzureCoreTestInvocations({
  rootCwd: root,
  sourceCwd: root,
  sourceCommit,
  env: { EXISTING: 'value' },
});
assert.equal(invocations.length, expectedScripts.length);
assert.ok(invocations.every(({ cwd, env }) => cwd === root && env.TEAMS_SOURCE_COMMIT === sourceCommit));
assert.ok(invocations.every(({ args }) => args.includes('scripts/run-module-test.mjs')));
assert.ok(invocations.filter(({ args }) => args.includes('--import')).every(({ args }) => args.includes('tsx/esm')));
assert.ok(invocations.filter(({ args }) => !args.includes('--import')).every(({ args }) => !args.includes('tsx/esm')));

console.log('azure-core-test-runner-test: PASS');
