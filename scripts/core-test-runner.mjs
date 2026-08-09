import { spawnSync } from 'node:child_process';

const moduleRunner = 'scripts/run-module-test.mjs';
const plainTests = [
  'scripts/core-optional-boundary-test.mjs',
  'scripts/typecheck-boundary-test.mjs',
  'scripts/deployment-env-test.mjs',
  'scripts/validate-manifest-test.mjs',
  'scripts/package-app-determinism-test.mjs',
];
const tsTests = [
  'scripts/status-card-test.ts',
  'scripts/genui-contract-test.ts',
  'scripts/teams-tab-link-test.ts',
  'scripts/deterministic-response-engine-test.ts',
];

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (output) process.stdout.write(`${output}\n`);
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`core test failed: ${command} ${args.join(' ')} (exit ${result.status})`);
  }
}

for (const script of plainTests) run(process.execPath, [moduleRunner, script]);
for (const script of tsTests) run(process.execPath, ['--import', 'tsx/esm', moduleRunner, script]);

console.log('PASS: bounded Teams core test suite completed without optional API/MCP paths');
