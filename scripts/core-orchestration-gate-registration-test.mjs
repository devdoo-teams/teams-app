import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createCoreTestInvocations } from './core-test-runner.mjs';

const sourceCwd = process.cwd();
const runtimeCwd = path.join(sourceCwd, '.core-runtime-root');
const invocations = createCoreTestInvocations({
  rootCwd: runtimeCwd,
  sourceCwd,
  sourceCommit: '0123456789abcdef0123456789abcdef01234567',
});

const task4Tests = [
  'scripts/core-orchestration-service-test.ts',
  'scripts/core-orchestration-route-test.ts',
  'scripts/client-orchestration-panel-test.tsx',
  'scripts/client-app-orchestration-integration-test.tsx',
  'scripts/core-orchestration-index-mount-test.ts',
  'scripts/core-orchestration-chat-card-test.ts',
  'scripts/core-orchestration-teams-chat-wiring-test.ts',
  'scripts/core-orchestration-teams-chat-runtime-test.ts',
  'scripts/core-orchestration-confirmation-chat-runtime-test.ts',
  'scripts/core-orchestration-confirmation-idempotency-test.tsx',
  'scripts/core-orchestration-runtime-composition-test.ts',
  'scripts/codex-model-selection-test.ts',
  'scripts/codex-worker-catalog-port-test.ts',
];

for (const script of task4Tests) {
  assert.equal(
    fs.existsSync(path.join(sourceCwd, script)),
    true,
    `Required MP-262 test file must exist: ${script}`,
  );
  const matches = invocations.filter(({ args }) => args.at(-1) === script);
  const expectedKind =
    script === 'scripts/core-orchestration-teams-chat-runtime-test.ts' ||
    script === 'scripts/core-orchestration-confirmation-chat-runtime-test.ts'
      ? 'runtime'
      : 'source';
  const expectedCwd = expectedKind === 'runtime' ? runtimeCwd : sourceCwd;
  assert.equal(
    matches.length,
    1,
    `Core gate must execute ${script} exactly once; removing its registration must fail MP-262`,
  );
  assert.equal(matches[0].kind, expectedKind, `${script} must run as a ${expectedKind} test`);
  assert.equal(matches[0].cwd, expectedCwd, `${script} must execute from its required Core test workspace`);
}

console.log('core-orchestration-gate-registration-test: PASS');
