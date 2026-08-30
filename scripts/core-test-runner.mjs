import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { isFullCommitOid } from './fileprovider-git-clean.mjs';
import { resolveCoreTestWorkspace } from './core-test-workspace.mjs';

const moduleRunner = 'scripts/run-module-test.mjs';
const coreBuildSteps = [
  ['scripts/build-client.mjs', '--core'],
  ['scripts/build-server.mjs', '--core'],
];
const plainTests = [
  'scripts/core-test-runner-test.mjs',
  'scripts/core-test-workspace-test.mjs',
  'scripts/core-optional-boundary-test.mjs',
  'scripts/server-build-mode-test.mjs',
  'scripts/core-source-check-test.mjs',
  'scripts/fileprovider-git-clean-test.mjs',
  'scripts/fileprovider-runtime-deps-test.mjs',
  'scripts/typecheck-boundary-test.mjs',
  'scripts/deployment-env-test.mjs',
  'scripts/codex-a2a-isolation-validation-test.mjs',
  'scripts/a2a-auth-bootstrap-test.mjs',
  'scripts/validate-manifest-test.mjs',
  'scripts/release-loop-untracked-preservation-test.mjs',
  'scripts/release-loop-test.mjs',
  'scripts/release-prepare-test.mjs',
  'scripts/release-identity-consistency-test.mjs',
  'scripts/release-update-test.mjs',
  'scripts/package-app-determinism-test.mjs',
  'scripts/package-app-atomic-test.mjs',
  'scripts/release-gate-timeout-test.mjs',
  'scripts/core-runtime-smoke.mjs',
  'scripts/runtime-dist-test.mjs',
  'scripts/core-bundle-boundary-test.mjs',
  'scripts/client-build-jsx-runtime-test.mjs',
];
const runtimeTests = [
  'scripts/teams-core-chat-regression-test.ts',
  'scripts/response-mode-api-test.ts',
  'scripts/teams-a2a-chat-regression-test.ts',
  'scripts/teams-a2a-outbound-restart-regression-test.ts',
  'scripts/a2a-remote-startup-isolation-test.mjs',
  'scripts/a2a-index-integration-test.mjs',
];
const tsTests = [
  'scripts/status-card-test.ts',
  'scripts/genui-contract-test.ts',
  'scripts/teams-tab-link-test.ts',
  'scripts/deterministic-response-engine-test.ts',
  'scripts/codex-runner-security-test.ts',
  'scripts/codex-code-mode-host-regression-test.ts',
  'scripts/cli-agent-runner-test.ts',
  'scripts/ghcp-cli-adapter-test.ts',
  'scripts/provider-neutral-agent-runner-test.ts',
  'scripts/production-agent-isolation-test.ts',
  'scripts/agent-execution-readiness-test.ts',
  'scripts/codex-native-permission-isolation-test.ts',
  'scripts/agent-job-store-hardening-test.ts',
  'scripts/agent-event-store-test.ts',
  'scripts/agent-service-event-audit-test.ts',
  'scripts/agent-admission-control-test.ts',
  'scripts/agent-process-controller-security-test.ts',
  'scripts/agent-service-transition-test.ts',
  'scripts/agent-service-notify-false-regression-test.ts',
  'scripts/agent-service-workspace-lock-test.ts',
  'scripts/genui-action-store-test.ts',
  'scripts/item-store-hardening-test.ts',
  'scripts/item-store-ownership-test.ts',
  'scripts/client-item-mutation-test.ts',
  'scripts/client-auth-expired-test.ts',
  'scripts/client-work-item-load-test.ts',
  'scripts/client-work-item-render-test.ts',
  'scripts/client-auth-test.ts',
  'scripts/client-bootstrap-test.ts',
  'scripts/client-refresh-recovery-test.ts',
  'scripts/client-genui-adapter-test.ts',
  'scripts/client-response-mode-test.ts',
  'scripts/client-collaboration-panel-test.ts',
  'scripts/client-hub-navigation-test.ts',
  'scripts/client-today-summary-test.ts',
  'scripts/client-health-test.ts',
  'scripts/work-item-today-summary-test.ts',
  'scripts/client-deep-link-test.ts',
  'scripts/client-location-test.ts',
  'scripts/weather-service-test.ts',
  'scripts/a2a-core-contract-test.ts',
  'scripts/a2a-official-contract-audit-test.ts',
  'scripts/a2a-role-catalog-test.ts',
  'scripts/a2a-orchestrator-test.ts',
  'scripts/a2a-independent-agent-identity-test.ts',
  'scripts/a2a-durable-dispatch-test.ts',
  'scripts/a2a-observability-test.ts',
  'scripts/a2a-jsonrpc-route-test.ts',
  'scripts/a2a-v1-list-tasks-test.ts',
  'scripts/a2a-store-test.ts',
  'scripts/a2a-route-test.ts',
  'scripts/a2a-execution-test.ts',
  'scripts/a2a-parent-lifecycle-test.ts',
  'scripts/a2a-admission-restart-test.ts',
  'scripts/a2a-deadline-cancellation-test.ts',
  'scripts/a2a-submission-durability-test.ts',
  'scripts/a2a-agent-authorization-policy-test.ts',
  'scripts/a2a-remote-client-test.ts',
  'scripts/a2a-remote-agent-adapter-test.ts',
  'scripts/a2a-remote-roster-test.ts',
  'scripts/a2a-collaboration-plan-test.ts',
  'scripts/a2a-production-collaboration-test.ts',
  'scripts/teams-a2a-outbound-store-test.ts',
  'scripts/a2a-health-provider-roster-test.ts',
  'scripts/a2a-telemetry-test.ts',
  'scripts/a2a-orchestration-identity-test.ts',
  'scripts/a2a-cancel-idempotency-test.ts',
  'scripts/a2a-task-state-interoperability-test.ts',
  'scripts/a2a-streaming-unsupported-test.ts',
  'scripts/a2a-send-state-response-test.ts',
  'scripts/a2a-execution-gate-test.ts',
  'scripts/a2a-execution-readiness-test.ts',
  'scripts/a2a-codex-execution-profiles-test.ts',
  'scripts/a2a-multi-agent-dispatch-test.ts',
  'scripts/rest-scope-security-test.mjs',
  'scripts/security-headers-test.ts',
];

const DEFAULT_PER_TEST_TIMEOUT_MS = 60_000;
const DEFAULT_BUILD_TIMEOUT_MS = 300_000;
const DEFAULT_TERMINATION_GRACE_MS = 500;
const DEFAULT_REAP_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BUFFER = 2 * 1024 * 1024;
const WINDOWS_TASKKILL_TIMEOUT_MS = 5_000;

export function createProcessTreeTerminator({
  platform = process.platform,
  runWindowsTaskkill = execFileSync,
  killProcessGroup = process.kill.bind(process),
} = {}) {
  return (child, { force = false } = {}) => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return false;
    if (platform === 'win32') {
      const args = ['/PID', String(child.pid), '/T'];
      if (force) args.push('/F');
      try {
        runWindowsTaskkill('taskkill.exe', args, {
          encoding: 'utf8',
          stdio: 'ignore',
          timeout: WINDOWS_TASKKILL_TIMEOUT_MS,
          windowsHide: true,
        });
        return true;
      } catch (error) {
        if (child.exitCode !== null || child.signalCode !== null) return false;
        throw error;
      }
    }

    try {
      killProcessGroup(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
      return true;
    } catch (error) {
      if (error?.code === 'ESRCH') return false;
      try {
        return child.kill(force ? 'SIGKILL' : 'SIGTERM');
      } catch (fallbackError) {
        if (fallbackError?.code === 'ESRCH') return false;
        throw fallbackError;
      }
    }
  };
}

function commandLabel(command, args) {
  return `${command} ${args.join(' ')}`.trim();
}

export async function runProcessWithTimeout(
  command,
  args = [],
  {
    cwd = process.cwd(),
    env = process.env,
    timeoutMs = DEFAULT_PER_TEST_TIMEOUT_MS,
    terminationGraceMs = DEFAULT_TERMINATION_GRACE_MS,
    reapTimeoutMs = DEFAULT_REAP_TIMEOUT_MS,
    maxBuffer = DEFAULT_MAX_BUFFER,
    platform = process.platform,
    spawnProcess = spawn,
    terminateTree = createProcessTreeTerminator({ platform }),
  } = {},
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs must be positive');
  if (!Number.isFinite(terminationGraceMs) || terminationGraceMs < 0) {
    throw new Error('terminationGraceMs must be non-negative');
  }
  if (!Number.isFinite(reapTimeoutMs) || reapTimeoutMs <= 0) throw new Error('reapTimeoutMs must be positive');
  if (!Number.isFinite(maxBuffer) || maxBuffer <= 0) throw new Error('maxBuffer must be positive');

  return await new Promise((resolve, reject) => {
    const spawnOptions = {
      cwd,
      env,
      detached: platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    };
    if (platform === 'win32') spawnOptions.windowsHide = true;
    const child = spawnProcess(command, args, spawnOptions);
    const stdoutChunks = [];
    const stderrChunks = [];
    let bufferedBytes = 0;
    let timeoutTimer;
    let graceTimer;
    let reapTimer;
    let settled = false;
    let closeSeen = false;
    let terminationReason = null;
    const termination = {
      sentTerm: false,
      sentKill: false,
      reaped: false,
    };

    const clearTimers = () => {
      clearTimeout(timeoutTimer);
      clearTimeout(graceTimer);
      clearTimeout(reapTimer);
    };

    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      reject(error);
    };

    const beginTermination = (reason) => {
      if (terminationReason || closeSeen) return;
      terminationReason = reason;
      termination.sentTerm = terminateTree(child, { force: false });
      graceTimer = setTimeout(() => {
        if (closeSeen) return;
        termination.sentKill = terminateTree(child, { force: true });
        reapTimer = setTimeout(() => {
          if (closeSeen) return;
          const error = new Error(
            `core test process did not reap after SIGKILL within ${reapTimeoutMs}ms: ${commandLabel(command, args)}`,
          );
          error.code = 'EPROCESSREAPTIMEOUT';
          error.termination = { ...termination };
          finishReject(error);
        }, reapTimeoutMs);
      }, terminationGraceMs);
    };

    const capture = (chunks, chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bufferedBytes += buffer.length;
      if (bufferedBytes > maxBuffer) {
        beginTermination('buffer-overflow');
        return;
      }
      chunks.push(buffer);
    };

    child.stdout?.on('data', (chunk) => capture(stdoutChunks, chunk));
    child.stderr?.on('data', (chunk) => capture(stderrChunks, chunk));

    child.once('error', (error) => {
      finishReject(error);
    });

    child.once('close', (status, signal) => {
      closeSeen = true;
      termination.reaped = true;
      clearTimers();
      if (settled) return;

      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      if (terminationReason === 'timeout') {
        const error = new Error(`core test timed out after ${timeoutMs}ms: ${commandLabel(command, args)}`);
        error.code = 'ETIMEDOUT';
        error.stdout = stdout;
        error.stderr = stderr;
        error.termination = { ...termination };
        finishReject(error);
        return;
      }
      if (terminationReason === 'buffer-overflow') {
        const error = new Error(`core test output exceeded ${maxBuffer} bytes: ${commandLabel(command, args)}`);
        error.code = 'ENOBUFS';
        error.stdout = stdout;
        error.stderr = stderr;
        error.termination = { ...termination };
        finishReject(error);
        return;
      }
      if (status !== 0) {
        const error = new Error(
          `core test failed: ${commandLabel(command, args)} (exit ${status ?? 'null'}, signal ${signal ?? 'none'})`,
        );
        error.code = 'ETESTFAILED';
        error.status = status;
        error.signal = signal;
        error.stdout = stdout;
        error.stderr = stderr;
        finishReject(error);
        return;
      }

      settled = true;
      resolve({ status, signal, stdout, stderr, termination: { ...termination } });
    });

    timeoutTimer = setTimeout(() => beginTermination('timeout'), timeoutMs);
  });
}

async function run(
  command,
  args,
  cwd = process.cwd(),
  env = process.env,
  timeoutMs = DEFAULT_PER_TEST_TIMEOUT_MS,
) {
  try {
    const result = await runProcessWithTimeout(command, args, { cwd, env, timeoutMs });
    const output = `${result.stdout}${result.stderr}`.trim();
    if (output) process.stdout.write(`${output}\n`);
  } catch (error) {
    const output = `${error?.stdout ?? ''}${error?.stderr ?? ''}`.trim();
    if (output) process.stdout.write(`${output}\n`);
    throw error;
  }
}

export function createCoreTestInvocations({
  rootCwd = process.cwd(),
  sourceCwd,
  sourceCommit,
  env = process.env,
} = {}) {
  if (!sourceCwd) throw new Error('sourceCwd is required for pinned Core TypeScript tests');
  if (!isFullCommitOid(sourceCommit)) {
    throw new Error('sourceCommit must be one full immutable Git OID for every Core child test');
  }
  const childEnv = { ...env, TEAMS_SOURCE_COMMIT: sourceCommit };
  return [
    ...coreBuildSteps.map(([script, ...args]) => ({
      kind: 'build',
      command: process.execPath,
      args: [script, ...args],
      cwd: rootCwd,
      env: childEnv,
      timeoutMs: DEFAULT_BUILD_TIMEOUT_MS,
    })),
    ...plainTests.map((script) => ({
      kind: 'contract',
      command: process.execPath,
      args: [moduleRunner, script],
      cwd: rootCwd,
      env: childEnv,
    })),
    ...runtimeTests.map((script) => ({
      kind: 'runtime',
      command: process.execPath,
      args: ['--import', 'tsx/esm', moduleRunner, script],
      cwd: rootCwd,
      env: childEnv,
    })),
    ...tsTests.map((script) => ({
      kind: 'source',
      command: process.execPath,
      args: ['--import', 'tsx/esm', moduleRunner, script],
      cwd: sourceCwd,
      env: childEnv,
    })),
  ];
}

export async function runCoreTestSuite() {
  const testWorkspace = resolveCoreTestWorkspace();
  console.log(
    `Core TypeScript test source: ${testWorkspace.sourceMode}` +
      (testWorkspace.commitOid ? ` @ ${testWorkspace.commitOid}` : '') +
      (testWorkspace.datalessTrackedFiles.length > 0
        ? ` (${testWorkspace.datalessTrackedFiles.length} dataless tracked inputs)`
        : ''),
  );
  try {
    const invocations = createCoreTestInvocations({
      rootCwd: process.cwd(),
      sourceCwd: testWorkspace.cwd,
      sourceCommit: testWorkspace.commitOid,
    });
    for (const invocation of invocations) {
      await run(
        invocation.command,
        invocation.args,
        invocation.cwd,
        invocation.env,
        invocation.timeoutMs,
      );
    }
  } finally {
    testWorkspace.cleanup();
  }

  console.log('PASS: bounded Teams core test suite completed without optional API/MCP paths');
}

const isMain = Boolean(
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href,
);
if (isMain) await runCoreTestSuite();
