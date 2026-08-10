import { spawnSync } from 'node:child_process';

const moduleRunner = 'scripts/run-module-test.mjs';
const plainTests = [
  'scripts/core-optional-boundary-test.mjs',
  'scripts/server-build-mode-test.mjs',
  'scripts/typecheck-boundary-test.mjs',
  'scripts/deployment-env-test.mjs',
  'scripts/validate-manifest-test.mjs',
  'scripts/package-app-determinism-test.mjs',
  'scripts/core-runtime-smoke.mjs',
  'scripts/runtime-dist-test.mjs',
  'scripts/core-bundle-boundary-test.mjs',
];
const tsTests = [
  'scripts/status-card-test.ts',
  'scripts/genui-contract-test.ts',
  'scripts/teams-tab-link-test.ts',
  'scripts/deterministic-response-engine-test.ts',
  'scripts/codex-runner-security-test.ts',
  'scripts/agent-job-store-hardening-test.ts',
  'scripts/agent-service-workspace-lock-test.ts',
  'scripts/genui-action-store-test.ts',
  'scripts/item-store-hardening-test.ts',
  'scripts/item-store-ownership-test.ts',
  'scripts/client-item-mutation-test.ts',
];
const perTestTimeoutMs = 60_000;

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    timeout: perTestTimeoutMs,
    killSignal: 'SIGTERM',
    maxBuffer: 2 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (output) process.stdout.write(`${output}\n`);
  if (result.error || result.status !== 0) {
    if (result.error?.code === 'ETIMEDOUT') {
      throw new Error(`core test timed out after ${perTestTimeoutMs}ms: ${command} ${args.join(' ')}`);
    }
    throw result.error ?? new Error(`core test failed: ${command} ${args.join(' ')} (exit ${result.status})`);
  }
}

for (const script of plainTests) run(process.execPath, [moduleRunner, script]);
for (const script of tsTests) run(process.execPath, ['--import', 'tsx/esm', moduleRunner, script]);

console.log('PASS: bounded Teams core test suite completed without optional API/MCP paths');
