import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { isFullCommitOid } from './fileprovider-git-clean.mjs';
import { resolveCoreTestWorkspace } from './core-test-workspace.mjs';
import { runProcessWithTimeout } from './core-test-runner.mjs';
import { createChildTestEnvironment } from './child-test-environment.mjs';

const moduleRunner = 'scripts/run-module-test.mjs';
const DEFAULT_TEST_TIMEOUT_MS = 120_000;
const DEFAULT_BUILD_TIMEOUT_MS = 300_000;

/**
 * The Azure regression gate is deliberately explicit. Keep this list limited
 * to Azure platform contracts so optional provider tests cannot silently become
 * a Core dependency.
 */
export const AZURE_CORE_TESTS = Object.freeze([
  Object.freeze({ script: 'scripts/azure-platform-contract-test.mjs', timeoutMs: DEFAULT_TEST_TIMEOUT_MS }),
  Object.freeze({ script: 'scripts/azure-codex-package-test.mjs', timeoutMs: DEFAULT_TEST_TIMEOUT_MS }),
  Object.freeze({ script: 'scripts/azure-worker-runtime-package-test.mjs', timeoutMs: DEFAULT_TEST_TIMEOUT_MS }),
  Object.freeze({ script: 'scripts/azure-release-input-test.mjs', timeoutMs: DEFAULT_TEST_TIMEOUT_MS }),
  Object.freeze({ script: 'scripts/azure-github-handoff-test.mjs', timeoutMs: DEFAULT_TEST_TIMEOUT_MS }),
  Object.freeze({ script: 'scripts/azure-approval-check-test.mjs', timeoutMs: DEFAULT_TEST_TIMEOUT_MS }),
  Object.freeze({ script: 'scripts/azure-deployment-rbac-test.mjs', timeoutMs: DEFAULT_TEST_TIMEOUT_MS }),
  Object.freeze({ script: 'scripts/azure-deployment-contract-test.mjs', timeoutMs: DEFAULT_TEST_TIMEOUT_MS }),
  Object.freeze({ script: 'scripts/azure-canary-preflight-test.mjs', timeoutMs: DEFAULT_TEST_TIMEOUT_MS }),
  Object.freeze({ script: 'scripts/azure-release-identity-test.ts', timeoutMs: DEFAULT_TEST_TIMEOUT_MS }),
  Object.freeze({ script: 'scripts/azure-runtime-store-test.ts', timeoutMs: DEFAULT_TEST_TIMEOUT_MS }),
  Object.freeze({ script: 'scripts/azure-agent-dispatch-queue-test.ts', timeoutMs: DEFAULT_TEST_TIMEOUT_MS }),
  Object.freeze({ script: 'scripts/azure-agent-dispatch-sanitizer-boundary-test.ts', timeoutMs: DEFAULT_TEST_TIMEOUT_MS }),
  Object.freeze({ script: 'scripts/azure-agent-dispatch-sanitizer-adversarial-test.ts', timeoutMs: DEFAULT_TEST_TIMEOUT_MS }),
  Object.freeze({ script: 'scripts/azure-agent-job-ledger-composition-test.ts', timeoutMs: DEFAULT_TEST_TIMEOUT_MS }),
  Object.freeze({ script: 'scripts/azure-dispatch-health-test.ts', timeoutMs: DEFAULT_TEST_TIMEOUT_MS }),
  Object.freeze({ script: 'scripts/azure-dispatch-heartbeat-observation-test.ts', timeoutMs: DEFAULT_TEST_TIMEOUT_MS }),
  Object.freeze({ script: 'scripts/azure-worker-bootstrap-contract-test.mjs', timeoutMs: DEFAULT_TEST_TIMEOUT_MS }),
  Object.freeze({ script: 'scripts/azure-worker-build-contract-test.mjs', timeoutMs: DEFAULT_BUILD_TIMEOUT_MS }),
  Object.freeze({ script: 'scripts/azure-worker-contract-test.ts', timeoutMs: DEFAULT_TEST_TIMEOUT_MS }),
  Object.freeze({ script: 'scripts/azure-index-integration-test.ts', timeoutMs: DEFAULT_TEST_TIMEOUT_MS }),
]);

function assertSourceCommit(sourceCommit) {
  if (!isFullCommitOid(sourceCommit)) {
    throw new Error('Azure Core test source must be pinned to one full Git commit OID.');
  }
}

export function createAzureCoreTestInvocations({
  rootCwd = process.cwd(),
  sourceCwd,
  sourceCommit,
  env = process.env,
} = {}) {
  if (!sourceCwd) throw new Error('sourceCwd is required for pinned Azure Core tests');
  assertSourceCommit(sourceCommit);
  const childEnv = createChildTestEnvironment(env, {
    additionalPassThrough: ['BICEP_BIN'],
    overrides: { TEAMS_SOURCE_COMMIT: sourceCommit },
  });

  return AZURE_CORE_TESTS.map(({ script, timeoutMs }) => {
    if (!existsSync(path.resolve(sourceCwd, script))) {
      throw new Error(`Azure Core fixture is missing from the pinned source: ${script}`);
    }
    const isTypeScript = script.endsWith('.ts');
    return {
      kind: 'azure-contract',
      command: process.execPath,
      args: isTypeScript
        ? ['--import', 'tsx/esm', moduleRunner, script]
        : [moduleRunner, script],
      cwd: sourceCwd,
      rootCwd,
      env: childEnv,
      timeoutMs,
    };
  });
}

async function run(command, args, { cwd, env, timeoutMs }) {
  try {
    const result = await runProcessWithTimeout(command, args, {
      cwd,
      env,
      timeoutMs,
      spawnProcess: spawn,
    });
    const output = `${result.stdout}${result.stderr}`.trim();
    if (output) process.stdout.write(`${output}\n`);
  } catch (error) {
    const output = `${error?.stdout ?? ''}${error?.stderr ?? ''}`.trim();
    if (output) process.stdout.write(`${output}\n`);
    throw error;
  }
}

export async function runAzureCoreTestSuite() {
  const testWorkspace = resolveCoreTestWorkspace();
  console.log(
    `Azure Core regression source: ${testWorkspace.sourceMode}` +
      (testWorkspace.commitOid ? ` @ ${testWorkspace.commitOid}` : '') +
      (testWorkspace.datalessTrackedFiles.length > 0
        ? ` (${testWorkspace.datalessTrackedFiles.length} dataless tracked inputs)`
        : ''),
  );
  try {
    const invocations = createAzureCoreTestInvocations({
      rootCwd: process.cwd(),
      sourceCwd: testWorkspace.cwd,
      sourceCommit: testWorkspace.commitOid,
    });
    for (const [index, invocation] of invocations.entries()) {
      console.log(`Azure Core fixture ${index + 1}/${invocations.length}: ${invocation.args.at(-1)}`);
      await run(invocation.command, invocation.args, invocation);
    }
  } finally {
    testWorkspace.cleanup();
  }

  console.log('PASS: bounded Azure Core regression gate completed without optional provider paths');
}

const isMain = Boolean(
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href,
);
if (isMain) await runAzureCoreTestSuite();
