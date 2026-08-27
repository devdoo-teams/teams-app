import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  AgentExecutionUnavailableError,
  type AgentIsolationSpawnOptions,
} from '../src/server/agent-execution-policy.js';
import { CODEX_READ_ONLY_PERMISSION_ARGS } from '../src/server/codex-permission-profile-isolation-provider.js';
import { createProductionAgentExecutionPolicy } from '../src/server/production-agent-isolation.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-production-agent-isolation-'));
const sourceWorkspace = path.join(root, 'source');
const serviceCodexHome = path.join(root, 'service-codex-home');
const codexExecutable = path.join(root, 'codex');
const scope = {
  tenantId: 'tenant-a',
  requesterId: 'requester-a',
  conversationId: 'conversation-a',
};
const spawnCalls: Array<{
  command: string;
  args: readonly string[];
  options: AgentIsolationSpawnOptions;
}> = [];
const fakeChild = {} as ChildProcess;
let preflightCalls = 0;

const fakeSpawn = (
  command: string,
  args: readonly string[],
  options: AgentIsolationSpawnOptions,
): ChildProcess => {
  spawnCalls.push({ command, args: [...args], options });
  return fakeChild;
};

const unavailableDecision = {
  allowed: false as const,
  reason: 'isolation-unavailable' as const,
};

try {
  const productionIndex = await fs.readFile(path.resolve(process.cwd(), 'src/server/index.ts'), 'utf8');
  const productionIsolation = await fs.readFile(
    path.resolve(process.cwd(), 'src/server/production-agent-isolation.ts'),
    'utf8',
  );
  assert.match(productionIndex, /createProductionAgentExecutionPolicy\(/u);
  assert.match(productionIndex, /executionPolicy:\s*agentExecutionPolicy/u);
  assert.match(productionIndex, /AGENT_CODEX_HOME/u, 'production must select one service CODEX_HOME outside the projection');
  assert.match(productionIndex, /CODEX_BIN_SHA256/u, 'production must pin the signed Codex executable digest');
  assert.match(
    productionIndex,
    /safeLocal\s*\n\s*&& process\.env\.NODE_ENV === 'test'\s*\n\s*&& process\.env\.TEAMS_TEST_PROCESS_ISOLATION === 'true'/u,
    'unsafe process isolation must require loopback safe-local mode, NODE_ENV=test, and an explicit fixture flag',
  );
  assert.doesNotMatch(
    productionIsolation,
    /allowUnsafeTestProcessProvider|UnsafeTestProcessIsolationProvider/u,
    'the general production policy factory must not expose the unsafe test process provider',
  );
  assert.doesNotMatch(productionIndex, /AGENT_CODEX_AUTH_FILE/u, 'production must not copy raw auth files into jobs');

  await fs.mkdir(path.join(sourceWorkspace, 'src'), { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(sourceWorkspace, 'package.json'), '{"private":true}\n', { mode: 0o600 });
  await fs.writeFile(path.join(sourceWorkspace, 'src', 'readme.txt'), 'read-only fixture\n', { mode: 0o600 });
  await fs.mkdir(serviceCodexHome, { mode: 0o700 });
  await fs.writeFile(path.join(serviceCodexHome, 'auth.json'), '{"fixture":"service-auth"}\n', { mode: 0o600 });
  await fs.writeFile(codexExecutable, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const codexExecutableSha256 = crypto.createHash('sha256').update(await fs.readFile(codexExecutable)).digest('hex');

  const missingConfiguration = createProductionAgentExecutionPolicy({
    sourceWorkspace,
    isProduction: true,
    canReadScope: () => true,
  });
  assert.deepEqual(missingConfiguration.authorize(scope, 'read-only'), unavailableDecision);
  await assert.rejects(
    () => missingConfiguration.prepareWorkspace('read-only', scope, 'inspect only'),
    (error: unknown) => error instanceof AgentExecutionUnavailableError && error.code === 'UNAVAILABLE',
  );

  const nonDarwin = createProductionAgentExecutionPolicy({
    sourceWorkspace,
    isProduction: true,
    platform: 'linux',
    codexHome: serviceCodexHome,
    codexExecutable,
    codexExecutableSha256,
    nativePreflight: async () => undefined,
    canReadScope: () => true,
  });
  assert.deepEqual(nonDarwin.authorize(scope, 'read-only'), unavailableDecision);

  const localConfiguration = createProductionAgentExecutionPolicy({
    sourceWorkspace,
    isProduction: false,
    platform: 'darwin',
    codexHome: serviceCodexHome,
    codexExecutable,
    codexExecutableSha256,
    nativePreflight: async () => undefined,
    canReadScope: () => true,
  });
  assert.deepEqual(localConfiguration.authorize(scope, 'read-only'), unavailableDecision);

  const legacyLocalConfiguration = createProductionAgentExecutionPolicy({
    sourceWorkspace,
    isProduction: false,
    platform: 'darwin',
    allowLegacySeatbeltTestProvider: true,
    profilePath: codexExecutable,
    sandboxExecPath: codexExecutable,
    canReadScope: () => true,
    spawn: fakeSpawn,
  });
  assert.deepEqual(legacyLocalConfiguration.authorize(scope, 'read-only'), { allowed: true });

  const productionCannotEnableLegacyProvider = createProductionAgentExecutionPolicy({
    sourceWorkspace,
    isProduction: true,
    platform: 'darwin',
    allowLegacySeatbeltTestProvider: true,
    profilePath: codexExecutable,
    sandboxExecPath: codexExecutable,
    canReadScope: () => true,
    spawn: fakeSpawn,
  });
  assert.deepEqual(productionCannotEnableLegacyProvider.authorize(scope, 'read-only'), unavailableDecision);

  assert.throws(
    () => createProductionAgentExecutionPolicy({
      sourceWorkspace,
      isProduction: true,
      platform: 'darwin',
      codexHome: 'relative-codex-home',
      codexExecutable,
      codexExecutableSha256,
      canReadScope: () => true,
    }),
    /absolute/i,
  );

  const configured = createProductionAgentExecutionPolicy({
    sourceWorkspace,
    isProduction: true,
    platform: 'darwin',
    codexHome: serviceCodexHome,
    codexExecutable,
    codexExecutableSha256,
    nativePreflight: async () => { preflightCalls += 1; },
    canReadScope: () => true,
    canMutateScope: () => false,
    spawn: fakeSpawn,
    nativeExecutableTrustVerifier: () => undefined,
  });
  assert.deepEqual(configured.authorize(scope, 'read-only'), { allowed: true });
  assert.deepEqual(configured.authorize(scope, 'workspace-write'), { allowed: false, reason: 'write-forbidden' });

  const prepared = await configured.prepareWorkspace('read-only', scope, 'inspect only the projected workspace');
  try {
    assert.equal(prepared.projected, true);
    assert.equal(prepared.isolationLease?.providerId, 'codex-permission-profile');
    assert.equal(prepared.environmentOverrides?.CODEX_HOME, await fs.realpath(serviceCodexHome));
    assert.equal(preflightCalls, 1);
    await assert.rejects(
      () => fs.access(path.join(prepared.workspace, '.isolated-home', '.codex', 'auth.json')),
      'the projection must not contain a raw auth copy',
    );

    prepared.isolationLease?.bindJob('job-1');
    const args = [
      'exec', '--json', ...CODEX_READ_ONLY_PERMISSION_ARGS,
      '--cd', prepared.workspace, '--', 'inspect only the projected workspace',
    ];
    await prepared.isolationLease?.spawn(
      { ...scope, jobId: 'job-1' },
      codexExecutable,
      args,
      {
        cwd: prepared.workspace,
        env: prepared.environmentOverrides ?? {},
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0]?.command, await fs.realpath(codexExecutable));
    assert.deepEqual(spawnCalls[0]?.args, args);
  } finally {
    await prepared.dispose();
  }

  console.log('PASS: production AgentExecutionPolicy uses native Codex permission profiles without credential copies');
} finally {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}
