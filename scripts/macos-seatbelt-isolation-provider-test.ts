import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';

import {
  AgentExecutionUnavailableError,
  isProviderOwnedLease,
  type AgentIsolationAcquireInput,
  type AgentIsolationSpawnOptions,
  type AgentIsolationSubject,
} from '../src/server/agent-execution-policy.js';
import { MacOSSeatbeltIsolationProvider } from '../src/server/macos-seatbelt-isolation-provider.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-macos-seatbelt-provider-'));
const sourceWorkspace = path.join(root, 'source');
const workspace = path.join(root, 'workspace');
const protectedRoot = path.join(root, 'protected');
const profilePath = path.join(root, 'read-only.sb');
const sandboxExecPath = path.join(root, 'sandbox-exec');
const missingProfilePath = path.join(root, 'missing.sb');
const invalidProfilePath = path.join(root, 'profile-directory');
const missingExecutablePath = path.join(root, 'missing-sandbox-exec');

type SpawnCall = {
  command: string;
  args: readonly string[];
  options: AgentIsolationSpawnOptions;
};

const spawnCalls: SpawnCall[] = [];
const fakeChild = {} as ChildProcess;
const fakeSpawn = (
  command: string,
  args: readonly string[],
  options: AgentIsolationSpawnOptions,
): ChildProcess => {
  spawnCalls.push({ command, args: [...args], options });
  return fakeChild;
};

const subject: AgentIsolationSubject = {
  tenantId: 'tenant-a',
  requesterId: 'requester-a',
  conversationId: 'conversation-a',
};

const makeInput = (overrides: Partial<AgentIsolationAcquireInput> = {}): AgentIsolationAcquireInput => ({
  subject,
  sourceWorkspace,
  workspace,
  protectedRoots: [protectedRoot],
  environmentOverrides: { HOME: path.join(workspace, '.isolated-home') },
  prompt: 'inspect only the projected workspace',
  ...overrides,
});

const makeProvider = (overrides: Partial<ConstructorParameters<typeof MacOSSeatbeltIsolationProvider>[0]> = {}) =>
  new MacOSSeatbeltIsolationProvider({
    profilePath,
    sandboxExecPath,
    platform: 'darwin',
    spawn: fakeSpawn,
    ...overrides,
  });

const unavailable = (error: unknown): boolean =>
  error instanceof AgentExecutionUnavailableError && error.code === 'UNAVAILABLE';

try {
  await fs.mkdir(sourceWorkspace, { recursive: true, mode: 0o700 });
  await fs.mkdir(workspace, { recursive: true, mode: 0o700 });
  await fs.mkdir(protectedRoot, { recursive: true, mode: 0o700 });
  await fs.mkdir(invalidProfilePath, { recursive: true, mode: 0o700 });
  await fs.writeFile(profilePath, '(version 1)\n(deny default)\n', { mode: 0o600 });
  await fs.writeFile(sandboxExecPath, 'test-only executable placeholder\n', { mode: 0o700 });

  const provider = makeProvider();
  const lease = await provider.acquire(makeInput());
  assert.equal(isProviderOwnedLease(provider, lease), true, 'the provider owns the lease it returns');
  assert.equal(lease.providerId, 'macos-seatbelt');
  assert.equal(lease.workspace, workspace);
  assert.equal(spawnCalls.length, 0, 'acquire only preflights and does not launch a process');

  lease.bindJob('job-1');
  const spawnOptions: AgentIsolationSpawnOptions = {
    cwd: workspace,
    env: { HOME: path.join(workspace, '.isolated-home') },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  const boundSubject = { ...subject, jobId: 'job-1' };
  await lease.spawn(boundSubject, 'codex', ['--json', '--sandbox', 'read-only'], spawnOptions);
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0]?.command, sandboxExecPath, 'Seatbelt is invoked through its absolute executable path');
  assert.deepEqual(
    spawnCalls[0]?.args,
    ['-f', profilePath, 'codex', '--json', '--sandbox', 'read-only'],
    'the profile flag precedes the original command and arguments',
  );
  assert.deepEqual(spawnCalls[0]?.options, spawnOptions, 'the lease preserves the runner spawn options');

  await assert.rejects(
    () => lease.spawn({ ...boundSubject, jobId: 'job-2' }, 'codex', ['--json'], spawnOptions),
    unavailable,
    'a lease cannot be used by a different job',
  );
  await assert.rejects(
    () => lease.spawn(boundSubject, 'codex', ['--path', protectedRoot], spawnOptions),
    unavailable,
    'protected roots in command arguments are rejected before spawn',
  );
  assert.equal(spawnCalls.length, 1, 'rejected lease calls never reach the injected spawn');

  await assert.rejects(
    () => makeProvider().acquire(makeInput({ workspace: protectedRoot })),
    unavailable,
    'the provider rejects a workspace that is itself protected',
  );
  await assert.rejects(
    () => makeProvider().acquire(makeInput({ subject: { ...subject, tenantId: '' } })),
    unavailable,
    'the provider rejects an incomplete subject',
  );
  await assert.rejects(
    () => makeProvider().acquire(makeInput({ workspace: 'relative-workspace' })),
    unavailable,
    'the provider rejects a non-absolute workspace',
  );

  await assert.rejects(
    () => makeProvider({ platform: 'linux' }).acquire(makeInput()),
    unavailable,
    'the provider is disabled outside macOS',
  );
  await assert.rejects(
    () => makeProvider({ profilePath: missingProfilePath }).acquire(makeInput()),
    unavailable,
    'a missing sandbox profile fails closed',
  );
  await assert.rejects(
    () => makeProvider({ profilePath: invalidProfilePath }).acquire(makeInput()),
    unavailable,
    'a directory is not accepted as a sandbox profile',
  );
  await assert.rejects(
    () => makeProvider({ sandboxExecPath: missingExecutablePath }).acquire(makeInput()),
    unavailable,
    'an unavailable sandbox-exec executable fails closed',
  );
  assert.equal(spawnCalls.length, 1, 'all fail-closed preflight cases avoid process launch');

  assert.throws(
    () => new MacOSSeatbeltIsolationProvider({ profilePath: 'relative.sb', sandboxExecPath, platform: 'darwin', spawn: fakeSpawn }),
    /absolute.*profile|profile.*absolute/i,
    'relative profile paths are rejected at construction',
  );
  assert.throws(
    () => new MacOSSeatbeltIsolationProvider({ profilePath, sandboxExecPath, platform: 'darwin' } as ConstructorParameters<typeof MacOSSeatbeltIsolationProvider>[0]),
    /spawn/i,
    'an injected spawn function is required',
  );
  assert.throws(
    () => new MacOSSeatbeltIsolationProvider({ profilePath: '', sandboxExecPath, platform: 'darwin', spawn: fakeSpawn }),
    /profile/i,
    'an omitted sandbox profile is disabled by default',
  );

  console.log('PASS: macOS Seatbelt provider validates subjects/workspaces, returns bound provider leases, wraps spawn with sandbox-exec -f, and fails closed');
} finally {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}
