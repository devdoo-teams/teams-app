import { spawnSync } from 'node:child_process';

// The default project test command is intentionally API-free. Optional
// provider tests are explicit opt-in commands and must never make the Teams
// Core release path wait for a key, model endpoint, MCP host, or CopilotKit.
const tests = [
  'test:typecheck-boundary',
  'test:core-boundary',
  'typecheck',
  'check',
  'test:deployment-env',
  'test:manifest',
  'test:package-determinism',
  'test:build-client-atomic',
  'test:release-gate',
  'test:release-loop',
  'build',
  'test:troubleshooting',
  'test:atomic-stores',
  'test:agent-job-hardening',
  'test:agent-authorization',
  'test:codex-runner-security',
  'test:genui-action-hardening',
  'test:genui-redaction',
  'test:genui-actions',
  'test:item-store-hardening',
  'test:item-store-ownership',
  'test:process-lease-hardening',
  'test:agent-transitions',
  'test:work-item-parity',
  'test:collaboration-parity',
  'test:genui-contract',
  'test:teams-tab-link',
  'test:channels-shadow',
  'test:response-mode-store',
  'test:deterministic-engine',
  'test:response-mode-api',
  'test:client-auth',
  'test:user-auth-hardening',
  'test:auth-startup-gate',
  'test:operator-allowlist',
  'test:client-location',
  'test:client-bootstrap',
  'test:client-refresh-recovery',
  'test:client-genui-adapter',
  'test:client-response-mode',
  'test:local-auth',
  'test:weather-service',
];

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const script of tests) {
  const result = spawnSync(npm, ['run', script], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`API-free test failed: npm run ${script} (exit ${result.status})`);
  }
}

console.log('PASS: default test suite completed without OpenAI, local-model, MCP, or CopilotKit provider paths');
