import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

const runnerUrl = new URL('./core-test-runner.mjs', import.meta.url);
const { createCoreTestInvocations, createProcessTreeTerminator, runProcessWithTimeout } = await import(runnerUrl.href);
const SOURCE_COMMIT = '0123456789abcdef0123456789abcdef01234567';
const HOSTILE_PARENT_ENV = {
  PATH: '/fixture/bin',
  HOME: '/fixture/home',
  TMPDIR: '/fixture/tmp',
  LANG: 'ko_KR.UTF-8',
  LC_CREDENTIAL: 'host-locale-shaped-secret',
  CI: 'true',
  TEAMS_TEST_TIMEOUT_MS: '5000',
  TEAMS_FILEPROVIDER_SERVER_REUSE: '1',
  BICEP_BIN: '/host/bin/bicep',
  CODEX_HOME: '/host/codex-home',
  CODEX_BIN: '/host/bin/codex',
  CODEX_BIN_SHA256: 'host-codex-digest',
  CODEX_API_KEY: 'host-codex-secret',
  GHCP_BIN: '/host/bin/copilot',
  GHCP_SCRIPT: '/host/ghcp-fixture.mjs',
  GH_TOKEN: 'host-gh-secret',
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
  OPENAI_API_KEY: 'host-openai-secret',
};

async function assertProcessReaped(pid, label, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === 'ESRCH') return;
      throw error;
    }
    if (Date.now() >= deadline) {
      assert.fail(`reaped ${label} process still exists after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

{
  const invocations = createCoreTestInvocations({
    rootCwd: '/repo',
    sourceCwd: '/tmp/pinned-source',
    sourceCommit: SOURCE_COMMIT,
    env: HOSTILE_PARENT_ENV,
  });
  assert.ok(invocations.length > 2);
  const clientBuild = invocations.find(({ args }) => args.includes('scripts/build-client.mjs'));
  const serverBuild = invocations.find(({ args }) => args.includes('scripts/build-server.mjs'));
  const runtimeSmoke = invocations.find(({ args }) => args.includes('scripts/core-runtime-smoke.mjs'));
  const fileProviderRuntimeDependencies = invocations.find(({ args }) => (
    args.includes('scripts/fileprovider-runtime-deps-test.mjs')
  ));
  const workspaceContract = invocations.find(({ args }) => args.includes('scripts/core-test-workspace-test.mjs'));
  const runtimeContract = invocations.find(({ args }) => args.includes('scripts/teams-core-chat-regression-test.ts'));
  const responseModeContract = invocations.find(({ args }) => args.includes('scripts/response-mode-api-test.ts'));
  const a2aRuntimeContract = invocations.find(({ args }) => args.includes('scripts/teams-a2a-chat-regression-test.ts'));
  const a2aIndexRuntimeContract = invocations.find(({ args }) => args.includes('scripts/a2a-index-integration-test.mjs'));
  const outboundStoreContract = invocations.find(({ args }) => args.includes('scripts/teams-a2a-outbound-store-test.ts'));
  const sourceContract = invocations.find(({ args }) => args.includes('scripts/client-item-mutation-test.ts'));
  const renderContract = invocations.find(({ args }) => args.includes('scripts/client-work-item-render-test.ts'));
  assert.equal(clientBuild.kind, 'build', 'Core tests must build the client from the pinned release source');
  assert.deepEqual(clientBuild.args, ['scripts/build-client.mjs', '--core']);
  assert.equal(serverBuild.kind, 'build', 'Core tests must build the server from the pinned release source');
  assert.deepEqual(serverBuild.args, ['scripts/build-server.mjs', '--core']);
  assert.ok(
    invocations.indexOf(clientBuild) < invocations.indexOf(serverBuild) &&
      invocations.indexOf(serverBuild) < invocations.indexOf(runtimeSmoke),
    'Core client/server builds must complete before the runtime smoke starts',
  );
  assert.equal(clientBuild.timeoutMs, 300_000, 'Core builds use the bounded release build budget');
  assert.equal(serverBuild.timeoutMs, 300_000, 'Core builds use the bounded release build budget');
  assert.ok(
    fileProviderRuntimeDependencies,
    'the default Core gate must include the FileProvider runtime dependency lifecycle contract',
  );
  assert.equal(
    fileProviderRuntimeDependencies.kind,
    'contract',
    'the default Core gate must execute the FileProvider runtime dependency lifecycle contract',
  );
  assert.equal(
    fileProviderRuntimeDependencies.cwd,
    '/repo',
    'the FileProvider runtime dependency contract executes against the orchestrator root',
  );
  assert.equal(workspaceContract.cwd, '/repo', 'plain runner contract tests execute against the orchestrator root');
  assert.equal(runtimeContract.kind, 'runtime', 'compiled runtime tests have an explicit invocation kind');
  assert.equal(runtimeContract.cwd, '/repo', 'compiled runtime tests execute beside the commit-bound dist output');
  assert.equal(responseModeContract.kind, 'runtime', 'response-mode routing must be part of the Core runtime gate');
  assert.equal(responseModeContract.cwd, '/repo', 'response-mode routing executes beside the commit-bound dist output');
  assert.equal(a2aRuntimeContract.kind, 'runtime', 'Teams A2A chat regression must execute against the compiled release bundle');
  assert.equal(a2aRuntimeContract.cwd, '/repo', 'Teams A2A chat regression executes beside the commit-bound dist output');
  assert.equal(a2aIndexRuntimeContract.kind, 'runtime', 'A2A index integration must execute against the compiled release bundle');
  assert.equal(a2aIndexRuntimeContract.cwd, '/repo', 'A2A index integration executes beside the commit-bound dist output');
  assert.equal(outboundStoreContract.cwd, '/tmp/pinned-source', 'Teams A2A outbound store test executes the pinned source tree');
  assert.equal(sourceContract.cwd, '/tmp/pinned-source', 'TypeScript behavior tests execute the pinned source tree');
  assert.equal(renderContract.cwd, '/tmp/pinned-source', 'client render tests execute the pinned source tree');
  assert.equal(
    invocations.filter(({ kind }) => kind === 'source').every(({ cwd }) => cwd === '/tmp/pinned-source'),
    true,
  );
  const expectedChildEnv = {
    PATH: HOSTILE_PARENT_ENV.PATH,
    HOME: HOSTILE_PARENT_ENV.HOME,
    TMPDIR: HOSTILE_PARENT_ENV.TMPDIR,
    LANG: HOSTILE_PARENT_ENV.LANG,
    CI: HOSTILE_PARENT_ENV.CI,
    TEAMS_TEST_TIMEOUT_MS: HOSTILE_PARENT_ENV.TEAMS_TEST_TIMEOUT_MS,
    TEAMS_FILEPROVIDER_SERVER_REUSE: HOSTILE_PARENT_ENV.TEAMS_FILEPROVIDER_SERVER_REUSE,
    TEAMS_SOURCE_COMMIT: SOURCE_COMMIT,
  };
  assert.equal(invocations.every(({ env }) => env.TEAMS_SOURCE_COMMIT === SOURCE_COMMIT), true);
  assert.equal(
    invocations.every(({ env }) => Object.keys(env).every((key) => key in expectedChildEnv)),
    true,
    'Core child tests must not inherit provider, cloud, storage, dispatch, or credential configuration',
  );
  for (const { env } of invocations) {
    assert.deepEqual(
      env,
      expectedChildEnv,
      'every Core child test must receive only standard runtime and explicit harness controls',
    );
  }
}

{
  const calls = [];
  const terminate = createProcessTreeTerminator({
    platform: 'win32',
    runWindowsTaskkill(command, args, options) {
      calls.push({ command, args, options });
      return '';
    },
  });
  const child = {
    pid: 4242,
    exitCode: null,
    signalCode: null,
    kill() {
      throw new Error('Windows descendant termination must use taskkill /T, not child.kill');
    },
  };
  assert.equal(terminate(child, { force: false }), true);
  assert.equal(terminate(child, { force: true }), true);
  assert.deepEqual(calls.map(({ command, args }) => ({ command, args })), [
    { command: 'taskkill.exe', args: ['/PID', '4242', '/T'] },
    { command: 'taskkill.exe', args: ['/PID', '4242', '/T', '/F'] },
  ]);
  for (const { options } of calls) {
    assert.equal(options.windowsHide, true);
    assert.ok(Number.isInteger(options.timeout) && options.timeout > 0 && options.timeout <= 5_000);
  }
}

{
  const spawnCalls = [];
  const taskkillCalls = [];
  const child = new EventEmitter();
  child.pid = 4343;
  child.exitCode = null;
  child.signalCode = null;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {
    throw new Error('Windows descendant termination must use taskkill /T, not child.kill');
  };
  const windowsTerminator = createProcessTreeTerminator({
    platform: 'win32',
    runWindowsTaskkill(command, args, options) {
      taskkillCalls.push({ command, args, options });
      if (args.includes('/F')) {
        child.exitCode = 1;
        child.signalCode = 'SIGKILL';
        queueMicrotask(() => child.emit('close', 1, 'SIGKILL'));
      }
      return '';
    },
  });

  await assert.rejects(
    runProcessWithTimeout('fake-node', ['--child'], {
      platform: 'win32',
      spawnProcess(command, args, options) {
        spawnCalls.push({ command, args, options });
        return child;
      },
      terminateTree: windowsTerminator,
      timeoutMs: 10,
      terminationGraceMs: 0,
      reapTimeoutMs: 100,
    }),
    (error) => {
      assert.equal(error?.code, 'ETIMEDOUT');
      assert.equal(error?.termination?.sentTerm, true);
      assert.equal(error?.termination?.sentKill, true);
      assert.equal(error?.termination?.reaped, true);
      return true;
    },
  );
  assert.deepEqual(spawnCalls, [
    {
      command: 'fake-node',
      args: ['--child'],
      options: {
        cwd: process.cwd(),
        env: process.env,
        detached: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    },
  ]);
  assert.deepEqual(
    taskkillCalls.map(({ command, args }) => ({ command, args })),
    [
      { command: 'taskkill.exe', args: ['/PID', '4343', '/T'] },
      { command: 'taskkill.exe', args: ['/PID', '4343', '/T', '/F'] },
    ],
  );
}

let reportedProcessGroup;
const startedAt = Date.now();
await assert.rejects(
  runProcessWithTimeout(
    process.execPath,
    [
      '-e',
      `
        const { spawn } = require('node:child_process');
        process.on('SIGTERM', () => {});
        const grandchild = spawn(process.execPath, [
          '-e',
          "process.on('SIGTERM', () => {}); process.stdout.write(String(process.pid) + '\\\\n'); setInterval(() => {}, 1000);",
        ], { stdio: ['ignore', 'pipe', 'ignore'] });
        grandchild.stdout.once('data', (chunk) => {
          process.stdout.write(JSON.stringify({ child: process.pid, grandchild: Number(chunk.toString().trim()) }) + '\\n');
        });
        setInterval(() => {}, 1000);
      `,
    ],
    {
      cwd: process.cwd(),
      timeoutMs: 500,
      terminationGraceMs: 75,
      reapTimeoutMs: 2_000,
    },
  ),
  (error) => {
    assert.equal(error?.code, 'ETIMEDOUT');
    assert.equal(error?.termination?.sentTerm, true);
    assert.equal(error?.termination?.sentKill, true);
    assert.equal(error?.termination?.reaped, true);
    reportedProcessGroup = JSON.parse(error.stdout.trim());
    return true;
  },
);

assert.ok(reportedProcessGroup.child > 0);
assert.ok(reportedProcessGroup.grandchild > 0);
assert.ok(Date.now() - startedAt < 5_000, 'SIGTERM-resistant child must be killed and reaped within the hard bound');
for (const [label, pid] of Object.entries(reportedProcessGroup)) {
  await assertProcessReaped(pid, label);
}

console.log(
  'PASS: Core test runner models Windows taskkill tree termination and reaps a resistant POSIX descendant process group',
);
