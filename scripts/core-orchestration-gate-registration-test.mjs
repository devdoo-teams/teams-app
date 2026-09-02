import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createCoreTestInvocations } from './core-test-runner.mjs';

const sourceCwd = process.cwd();
const invocations = createCoreTestInvocations({
  rootCwd: sourceCwd,
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
  'scripts/core-orchestration-confirmation-idempotency-test.tsx',
  'scripts/core-orchestration-runtime-composition-test.ts',
];

for (const script of task4Tests) {
  assert.equal(
    fs.existsSync(path.join(sourceCwd, script)),
    true,
    `Required MP-262 test file must exist: ${script}`,
  );
  const matches = invocations.filter(({ args }) => args.at(-1) === script);
  assert.equal(
    matches.length,
    1,
    `Core gate must execute ${script} exactly once; removing its registration must fail MP-262`,
  );
  assert.equal(matches[0].kind, 'source', `${script} must run as a pinned-source test`);
  assert.equal(matches[0].cwd, sourceCwd, `${script} must execute from the pinned source checkout`);
}

console.log('core-orchestration-gate-registration-test: PASS');
