import { spawnSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { resolveRuntimeDistRoot } from './runtime-dist.mjs';
import { parseServerBuildMarker } from './server-build-marker.mjs';

function hasDatalessSource() {
  const candidates = [
    'package.json',
    'package-lock.json',
    'appPackage/manifest.json',
    'src/client/App.tsx',
    'src/client/main.tsx',
    'src/server/index.ts',
    'scripts/core-source-check.mjs',
  ];
  return candidates.some((relativePath) => {
    try {
      const metadata = fs.statSync(path.join(process.cwd(), relativePath));
      return Number.isInteger(metadata.blocks) && metadata.blocks === 0 && metadata.size > 0;
    } catch {
      return false;
    }
  });
}

function hasReusableServerBundle() {
  const serverRoot = path.join(resolveRuntimeDistRoot(process.cwd()), 'server');
  try {
    const entry = fs.statSync(path.join(serverRoot, 'index.js'));
    const marker = parseServerBuildMarker(fs.readFileSync(path.join(serverRoot, '.teams-server-build-commit'), 'utf8'));
    const currentCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).trim();
    return Boolean(
      marker?.commit === currentCommit
      && marker.mode === 'core'
      && marker.worktree === 'clean'
      && entry.size > 0
      && (!Number.isInteger(entry.blocks) || entry.blocks > 0),
    );
  } catch {
    return false;
  }
}

// The default project test command is intentionally API-free. Optional
// provider tests are explicit opt-in commands and must never make the Teams
// Core release path wait for a key, model endpoint, MCP host, or CopilotKit.
const tests = [
  'test:typecheck-boundary',
  'test:core-boundary',
  'typecheck:core',
  'check',
  'test:core-bundle-boundary',
  'test:deployment-env',
  'test:manifest',
  'test:tab-route-order',
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
const childEnv = { ...process.env };
if (
  childEnv.TEAMS_FILEPROVIDER_SERVER_REUSE !== '1'
  && (hasDatalessSource() || resolveRuntimeDistRoot(process.cwd()) !== path.join(process.cwd(), 'dist'))
  && hasReusableServerBundle()
) {
  // Keep the default API-free suite runnable when macOS FileProvider exposes
  // source placeholders. Core checks and child build/startup tests can use
  // Git-backed source materialization and the verified server bundle instead
  // of entering the known Node 24/esbuild placeholder hang.
  childEnv.TEAMS_FILEPROVIDER_SERVER_REUSE = '1';
}

for (const script of tests) {
  const result = spawnSync(npm, ['run', script], {
    cwd: process.cwd(),
    env: childEnv,
    stdio: 'inherit',
    timeout: Number(process.env.TEAMS_TEST_TIMEOUT_MS ?? 120_000),
    killSignal: 'SIGTERM',
  });

  if (result.error || result.status !== 0) {
    if (result.error?.code === 'ETIMEDOUT') {
      throw new Error(`API-free test timed out after ${process.env.TEAMS_TEST_TIMEOUT_MS ?? 120000}ms: npm run ${script}`);
    }
    throw result.error ?? new Error(`API-free test failed: npm run ${script} (exit ${result.status})`);
  }
}

console.log('PASS: default test suite completed without OpenAI, local-model, MCP, or CopilotKit provider paths');
