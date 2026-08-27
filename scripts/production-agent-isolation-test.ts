import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';

import {
  AgentExecutionUnavailableError,
  type AgentIsolationSpawnOptions,
} from '../src/server/agent-execution-policy.js';
import { createProductionAgentExecutionPolicy } from '../src/server/production-agent-isolation.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-production-agent-isolation-'));
const sourceWorkspace = path.join(root, 'source');
const profilePath = path.join(root, 'read-only.sb');
const sandboxExecPath = path.join(root, 'sandbox-exec');
const codexAuthFile = path.join(root, 'codex-auth.json');
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
  const productionIndex = await fs.readFile(
    path.resolve(process.cwd(), 'src/server/index.ts'),
    'utf8',
  );
  assert.match(
    productionIndex,
    /createProductionAgentExecutionPolicy\(/u,
    'production composition must build the explicit execution policy',
  );
  assert.match(
    productionIndex,
    /executionPolicy:\s*agentExecutionPolicy/u,
    'production AgentService must receive the explicit execution policy',
  );
  assert.match(
    productionIndex,
    /AGENT_ISOLATION_PROFILE/u,
    'production composition must use an explicit isolation profile configuration',
  );
  assert.match(
    productionIndex,
    /AGENT_CODEX_AUTH_FILE/u,
    'production composition must use an explicit Codex credential source instead of the user home at runtime',
  );

  await fs.mkdir(sourceWorkspace, { recursive: true, mode: 0o700 });
  await fs.mkdir(path.join(sourceWorkspace, 'src'), { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(sourceWorkspace, 'package.json'), '{"private":true}\n', { mode: 0o600 });
  await fs.writeFile(path.join(sourceWorkspace, 'src', 'readme.txt'), 'read-only fixture\n', { mode: 0o600 });
  await fs.writeFile(profilePath, '(version 1)\n(deny default)\n', { mode: 0o600 });
  await fs.writeFile(sandboxExecPath, 'test-only executable placeholder\n', { mode: 0o700 });
  await fs.writeFile(codexAuthFile, '{"auth_mode":"test-fixture"}\n', { mode: 0o600 });

  const missingConfiguration = createProductionAgentExecutionPolicy({
    sourceWorkspace,
    isProduction: true,
    canReadScope: () => true,
  });
  assert.deepEqual(
    missingConfiguration.authorize(scope, 'read-only'),
    unavailableDecision,
    'production remains fail-closed when no explicit Seatbelt profile is configured',
  );
  await assert.rejects(
    () => missingConfiguration.prepareWorkspace('read-only', scope, 'inspect only'),
    (error: unknown) => error instanceof AgentExecutionUnavailableError && error.code === 'UNAVAILABLE',
    'missing production isolation configuration must not create a read-only workspace',
  );

  const nonDarwin = createProductionAgentExecutionPolicy({
    sourceWorkspace,
    isProduction: true,
    platform: 'linux',
    profilePath,
    sandboxExecPath,
    canReadScope: () => true,
  });
  assert.deepEqual(
    nonDarwin.authorize(scope, 'read-only'),
    unavailableDecision,
    'production does not enable the macOS provider on another platform',
  );

  const localConfiguration = createProductionAgentExecutionPolicy({
    sourceWorkspace,
    isProduction: false,
    platform: 'darwin',
    profilePath,
    sandboxExecPath,
    canReadScope: () => true,
  });
  assert.deepEqual(
    localConfiguration.authorize(scope, 'read-only'),
    unavailableDecision,
    'local composition does not silently enable the production isolation boundary',
  );

  assert.throws(
    () => createProductionAgentExecutionPolicy({
      sourceWorkspace,
      isProduction: true,
      platform: 'darwin',
      profilePath: 'relative-read-only.sb',
      canReadScope: () => true,
    }),
    /absolute.*profile|profile.*absolute/i,
    'production rejects a guessed or relative isolation profile path',
  );

  const configured = createProductionAgentExecutionPolicy({
    sourceWorkspace,
    isProduction: true,
    platform: 'darwin',
    profilePath,
    sandboxExecPath,
    codexAuthFile,
    canReadScope: () => true,
    canMutateScope: () => false,
    spawn: fakeSpawn,
  });
  assert.deepEqual(
    configured.authorize(scope, 'read-only'),
    { allowed: true },
    'an explicit trusted macOS profile enables the read-only policy decision',
  );
  assert.deepEqual(
    configured.authorize(scope, 'workspace-write'),
    { allowed: false, reason: 'write-forbidden' },
    'read-only isolation wiring does not broaden the write authorization boundary',
  );

  const prepared = await configured.prepareWorkspace('read-only', scope, 'inspect only the projected workspace');
  try {
    assert.equal(prepared.projected, true);
    assert.equal(prepared.isolationLease?.providerId, 'macos-seatbelt');
    const stagedAuthFile = path.join(prepared.environmentOverrides?.CODEX_HOME ?? '', 'auth.json');
    assert.equal(
      await fs.readFile(stagedAuthFile, 'utf8'),
      '{"auth_mode":"test-fixture"}\n',
      'the explicit Codex auth file is copied into the disposable isolated CODEX_HOME',
    );
    const stagedAuthStat = await fs.stat(stagedAuthFile);
    assert.equal(stagedAuthStat.mode & 0o777, 0o600, 'the staged auth file is owner-only');
    prepared.isolationLease?.bindJob('job-1');
    await prepared.isolationLease?.spawn(
      { ...scope, jobId: 'job-1' },
      'codex',
      ['--json', '--sandbox', 'read-only'],
      {
        cwd: prepared.workspace,
        env: prepared.environmentOverrides ?? {},
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0]?.command, sandboxExecPath);
    assert.deepEqual(
      spawnCalls[0]?.args,
      ['-f', profilePath, 'codex', '--json', '--sandbox', 'read-only'],
      'production read-only children launch only through the configured Seatbelt profile',
    );
  } finally {
    await prepared.dispose();
  }

  console.log('PASS: production AgentExecutionPolicy wiring is explicit, macOS-only, read-only, and fail-closed');
} finally {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}
