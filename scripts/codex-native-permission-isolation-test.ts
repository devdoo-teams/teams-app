import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  CODEX_READ_ONLY_PERMISSION_ARGS,
  CodexPermissionProfileIsolationProvider,
} from '../src/server/codex-permission-profile-isolation-provider.js';
import {
  AgentExecutionUnavailableError,
  type AgentIsolationSpawnOptions,
} from '../src/server/agent-execution-policy.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-codex-native-isolation-'));
const sourceWorkspace = path.join(root, 'source');
const projectedWorkspace = path.join(root, 'projection');
const isolatedHome = path.join(projectedWorkspace, '.isolated-home');
const isolatedCodexHome = path.join(isolatedHome, '.codex');
const serviceCodexHome = path.join(root, 'service-codex-home');
const codexExecutable = path.join(root, 'codex');
const scope = {
  tenantId: 'tenant-a',
  requesterId: 'requester-a',
  conversationId: 'conversation-a',
  jobId: 'job-a',
};
const fakeChild = {} as ChildProcess;
const spawnCalls: Array<{
  command: string;
  args: readonly string[];
  options: AgentIsolationSpawnOptions;
}> = [];
let preflightCalls = 0;

try {
  await fs.mkdir(sourceWorkspace, { recursive: true, mode: 0o700 });
  await fs.mkdir(isolatedCodexHome, { recursive: true, mode: 0o700 });
  await fs.mkdir(serviceCodexHome, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(serviceCodexHome, 'auth.json'), '{"fixture":"service-auth"}\n', { mode: 0o600 });
  await fs.writeFile(codexExecutable, '#!/bin/sh\nexit 0\n', { mode: 0o700 });

  const provider = new CodexPermissionProfileIsolationProvider({
    codexExecutable,
    codexHome: serviceCodexHome,
    platform: 'darwin',
    preflight: async () => { preflightCalls += 1; },
    spawn: (command, args, options) => {
      spawnCalls.push({ command, args: [...args], options });
      return fakeChild;
    },
  });

  const lease = await provider.acquire({
    subject: scope,
    sourceWorkspace,
    workspace: projectedWorkspace,
    protectedRoots: [sourceWorkspace, os.homedir()],
    environmentOverrides: {
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
      CODEX_HOME: isolatedCodexHome,
    },
    prompt: 'inspect only the projected workspace',
  });

  assert.equal(preflightCalls, 1, 'native permission-profile enforcement must pass preflight before a lease is issued');
  assert.equal(lease.providerId, 'codex-permission-profile');
  assert.equal(lease.environmentOverrides.HOME, isolatedHome, 'generated commands retain the disposable home');
  assert.equal(lease.environmentOverrides.CODEX_HOME, await fs.realpath(serviceCodexHome), 'only the trusted Codex parent receives the service auth home');
  await assert.rejects(
    () => fs.access(path.join(projectedWorkspace, '.isolated-home', '.codex', 'auth.json')),
    'raw Codex credentials must never be copied into the projected workspace',
  );

  const args = [
    'exec',
    '--json',
    ...CODEX_READ_ONLY_PERMISSION_ARGS,
    '--cd',
    projectedWorkspace,
    '--',
    'inspect only the projected workspace',
  ];
  const spawnOptions: AgentIsolationSpawnOptions = {
    cwd: projectedWorkspace,
    env: { ...lease.environmentOverrides },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  };

  lease.bindJob(scope.jobId);
  await lease.spawn(scope, codexExecutable, args, spawnOptions);
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0]?.command, await fs.realpath(codexExecutable), 'the signed/pinned Codex binary launches directly');
  assert.deepEqual(spawnCalls[0]?.args, args);
  assert.equal(spawnCalls[0]?.args.includes('--sandbox'), false, 'legacy --sandbox must never disable permission profiles');
  assert.ok(spawnCalls[0]?.args.includes('--ignore-user-config'), 'dangerous user config must not load into the service run');
  assert.ok(spawnCalls[0]?.args.includes('--ignore-rules'), 'user/project exec rules must not widen the service run');
  assert.ok(spawnCalls[0]?.args.includes('--strict-config'), 'unknown security configuration must fail closed');

  await assert.rejects(
    () => lease.spawn(scope, codexExecutable, [...args.slice(0, 2), '--sandbox', 'read-only', ...args.slice(2)], spawnOptions),
    (error: unknown) => error instanceof AgentExecutionUnavailableError
      && error.reason === 'provider-rejected-request',
    'a legacy sandbox argument must be rejected before process launch',
  );
  await assert.rejects(
    () => lease.spawn(scope, '/usr/bin/env', args, spawnOptions),
    (error: unknown) => error instanceof AgentExecutionUnavailableError
      && error.reason === 'provider-rejected-request',
    'the lease must not launch an unpinned executable',
  );
  await lease.dispose();

  const authPath = path.join(serviceCodexHome, 'auth.json');
  await fs.chmod(authPath, 0o644);
  const insecure = new CodexPermissionProfileIsolationProvider({
    codexExecutable,
    codexHome: serviceCodexHome,
    platform: 'darwin',
    preflight: async () => undefined,
    spawn: () => fakeChild,
  });
  await assert.rejects(
    () => insecure.acquire({
      subject: scope,
      sourceWorkspace,
      workspace: projectedWorkspace,
      protectedRoots: [sourceWorkspace, os.homedir()],
      environmentOverrides: { HOME: isolatedHome, USERPROFILE: isolatedHome, CODEX_HOME: isolatedCodexHome },
      prompt: 'inspect only',
    }),
    (error: unknown) => error instanceof AgentExecutionUnavailableError
      && error.reason === 'provider-rejected-request',
    'group/world-readable service credentials must fail closed',
  );

  console.log('PASS: native Codex permission-profile isolation keeps parent auth outside generated-command reach');
} finally {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}
