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
  'scripts/azure-codex-package-test.mjs',
  'scripts/azure-worker-runtime-package-test.mjs',
  'scripts/azure-release-input-test.mjs',
  'scripts/azure-github-handoff-test.mjs',
  'scripts/azure-approval-check-test.mjs',
  'scripts/azure-deployment-rbac-test.mjs',
  'scripts/azure-deployment-contract-test.mjs',
  'scripts/azure-deployment-parameters-test.mjs',
  'scripts/azure-what-if-receipt-test.mjs',
  'scripts/azure-canary-preflight-test.mjs',
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
const hostileParentEnv = {
  PATH: '/fixture/bin',
  HOME: '/fixture/home',
  TMPDIR: '/fixture/tmp',
  LANG: 'ko_KR.UTF-8',
  CI: 'true',
  TEAMS_TEST_TIMEOUT_MS: '5000',
  TEAMS_FILEPROVIDER_SERVER_REUSE: '1',
  BICEP_BIN: '/fixture/bin/bicep',
  CODEX_HOME: '/host/codex-home',
  CODEX_BIN: '/host/bin/codex',
  CODEX_BIN_SHA256: 'host-codex-digest',
  GHCP_BIN: '/host/bin/copilot',
  GITHUB_TOKEN: 'host-github-secret',
  A2A_STORE_PATH: '/host/data/a2a.json',
  A2A_OUTBOUND_STORE_PATH: '/host/data/a2a-outbound.json',
  TEAMS_A2A_AGENT_PROVIDERS: 'copilot',
  TEAMS_A2A_REMOTE_AGENT_BEARER_TOKEN: 'host-a2a-secret',
  TEAMS_AGENT_CLI_PROVIDER: 'copilot',
  TEAMS_AGENT_DISPATCH_MODE: 'azure-queue',
  TEAMS_OPTIONAL_RUNTIME: 'true',
  AZURE_CLIENT_ID: 'host-client-id',
  AZURE_CLIENT_SECRET: 'host-client-secret',
  AZURE_TENANT_ID: 'host-tenant-id',
  AZURE_SUBSCRIPTION_ID: 'host-subscription-id',
  AZURE_STORAGE_QUEUE_ENDPOINT: 'https://host.queue.core.windows.net/dispatch',
  AZURE_STORAGE_CONNECTION_STRING: 'host-storage-secret',
  AZURE_COSMOS_ENDPOINT: 'https://host.documents.azure.com/',
  AZURE_COSMOS_KEY: 'host-cosmos-secret',
};
const invocations = createAzureCoreTestInvocations({
  rootCwd: root,
  sourceCwd: root,
  sourceCommit,
  env: hostileParentEnv,
});
assert.equal(invocations.length, expectedScripts.length);
assert.ok(invocations.every(({ cwd, env }) => cwd === root && env.TEAMS_SOURCE_COMMIT === sourceCommit));
const expectedChildEnv = {
  PATH: hostileParentEnv.PATH,
  HOME: hostileParentEnv.HOME,
  TMPDIR: hostileParentEnv.TMPDIR,
  LANG: hostileParentEnv.LANG,
  CI: hostileParentEnv.CI,
  TEAMS_TEST_TIMEOUT_MS: hostileParentEnv.TEAMS_TEST_TIMEOUT_MS,
  TEAMS_FILEPROVIDER_SERVER_REUSE: hostileParentEnv.TEAMS_FILEPROVIDER_SERVER_REUSE,
  TEAMS_SOURCE_COMMIT: sourceCommit,
  BICEP_BIN: hostileParentEnv.BICEP_BIN,
};
for (const { env } of invocations) {
  assert.deepEqual(
    env,
    expectedChildEnv,
    'Azure Core children must receive BICEP_BIN but no ambient provider, storage, dispatch, or credential configuration',
  );
}
assert.ok(invocations.every(({ args }) => args.includes('scripts/run-module-test.mjs')));
assert.ok(invocations.filter(({ args }) => args.includes('--import')).every(({ args }) => args.includes('tsx/esm')));
assert.ok(invocations.filter(({ args }) => !args.includes('--import')).every(({ args }) => !args.includes('tsx/esm')));

console.log('azure-core-test-runner-test: PASS');
