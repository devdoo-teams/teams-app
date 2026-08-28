import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
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
  const codexExecutableSha256 = crypto.createHash('sha256').update(await fs.readFile(codexExecutable)).digest('hex');

  const acquireInput = (executable = codexExecutable) => ({
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
    executable,
  });

  for (const [expectedClassification, failure] of [
    ['command-not-found', Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' })],
    ['malformed-profile', new Error('invalid permission profile syntax')],
    ['timeout', Object.assign(new Error('permission preflight timed out'), { code: 'ETIMEDOUT', killed: true })],
    ['unknown-infrastructure', Object.assign(new Error('permission preflight I/O failure'), { code: 'EIO' })],
  ] as const) {
    const failingProvider = new CodexPermissionProfileIsolationProvider({
      codexExecutable,
      codexExecutableSha256,
      codexHome: serviceCodexHome,
      platform: 'darwin',
      preflight: async () => { throw failure; },
      spawn: () => fakeChild,
      executableTrustVerifier: () => undefined,
    });
    await assert.rejects(
      () => failingProvider.acquire(acquireInput()),
      (error: unknown) => error instanceof AgentExecutionUnavailableError
        && error.reason === 'trusted-isolation-required'
        && (error as Error & { classification?: unknown }).classification === expectedClassification,
      `${expectedClassification} preflight failures retain a stable fail-closed classification`,
    );
  }

  await fs.writeFile(path.join(projectedWorkspace, 'workspace-canary.txt'), 'workspace fixture\n', { mode: 0o600 });

  for (const [label, failure] of [
    ['missing-canary', 'cat: /missing-service-canary: No such file or directory'],
    ['harness-failure', 'permission harness failure'],
  ] as const) {
    const executable = path.join(root, `codex-${label}`);
    await writePreflightFixture(executable, failure);
    const executableSha256 = crypto.createHash('sha256').update(await fs.readFile(executable)).digest('hex');
    const failingProvider = new CodexPermissionProfileIsolationProvider({
      codexExecutable: executable,
      codexExecutableSha256: executableSha256,
      codexHome: serviceCodexHome,
      platform: 'darwin',
      spawn: () => fakeChild,
      executableTrustVerifier: () => undefined,
    });
    await assert.rejects(
      () => failingProvider.acquire(acquireInput(executable)),
      (error: unknown) => error instanceof AgentExecutionUnavailableError
        && error.reason === 'trusted-isolation-required'
        && (error as Error & { classification?: unknown }).classification === 'unknown-infrastructure',
      `numeric nonzero ${label} output must not satisfy the native denial contract`,
    );
  }

  const denialExecutable = path.join(root, 'codex-explicit-denial');
  await writePreflightFixture(denialExecutable, 'sandbox: /bin/cat: Operation not permitted');
  const denialExecutableSha256 = crypto.createHash('sha256').update(await fs.readFile(denialExecutable)).digest('hex');
  const denialProvider = new CodexPermissionProfileIsolationProvider({
    codexExecutable: denialExecutable,
    codexExecutableSha256: denialExecutableSha256,
    codexHome: serviceCodexHome,
    platform: 'darwin',
    spawn: () => fakeChild,
    executableTrustVerifier: () => undefined,
  });
  const denialLease = await denialProvider.acquire(acquireInput(denialExecutable));
  await denialLease.dispose();

  const malformedExecutable = path.join(root, 'codex-malformed-profile');
  await fs.writeFile(malformedExecutable, [
    '#!/bin/sh',
    'case "$1" in',
    '  --version) echo "codex-cli 0.148.0" ;;',
    '  mcp) echo "[]" ;;',
    '  plugin) echo \'{"installed":[],"available":[]}\' ;;',
    '  sandbox)',
    '    case "$*" in',
    '      *workspace-read-canary*) exit 0 ;;',
    '      *service-read-denied-canary*) echo "invalid permission profile" >&2; exit 1 ;;',
    '      *) exit 1 ;;',
    '    esac',
    '    ;;',
    '  exec) echo \'{"type":"item.completed","item":{"type":"agent_message","text":"TEAMS_CODEX_AUTH_PREFLIGHT_OK"}}\' ;;',
    '  *) exit 1 ;;',
    'esac',
  ].join('\n'), { mode: 0o700 });
  const malformedExecutableSha256 = crypto.createHash('sha256').update(await fs.readFile(malformedExecutable)).digest('hex');
  const malformedProvider = new CodexPermissionProfileIsolationProvider({
    codexExecutable: malformedExecutable,
    codexExecutableSha256: malformedExecutableSha256,
    codexHome: serviceCodexHome,
    platform: 'darwin',
    spawn: () => fakeChild,
    executableTrustVerifier: () => undefined,
  });
  await assert.rejects(
    () => malformedProvider.acquire(acquireInput(malformedExecutable)),
    (error: unknown) => error instanceof AgentExecutionUnavailableError
      && error.reason === 'trusted-isolation-required'
      && (error as Error & { classification?: unknown }).classification === 'malformed-profile',
    'a malformed permission profile must not be accepted as a genuine sandbox denial',
  );

  const provider = new CodexPermissionProfileIsolationProvider({
    codexExecutable,
    codexExecutableSha256,
    codexHome: serviceCodexHome,
    platform: 'darwin',
    preflight: async () => { preflightCalls += 1; },
    spawn: (command, args, options) => {
      spawnCalls.push({ command, args: [...args], options });
      return fakeChild;
    },
    executableTrustVerifier: () => undefined,
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
  assert.equal(lease.environmentOverrides.HOME, await fs.realpath(isolatedHome), 'generated commands retain the canonical disposable home');
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
    lease.workspace,
    '--',
    'inspect only the projected workspace',
  ];
  const spawnOptions: AgentIsolationSpawnOptions = {
    cwd: lease.workspace,
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
  const promptSeparator = args.indexOf('--');
  const overriddenProfileArgs = [
    ...args.slice(0, promptSeparator),
    '-c',
    'default_permissions=":danger-full-access"',
    ...args.slice(promptSeparator),
  ];
  await assert.rejects(
    () => lease.spawn(scope, codexExecutable, overriddenProfileArgs, spawnOptions),
    (error: unknown) => error instanceof AgentExecutionUnavailableError
      && error.reason === 'provider-rejected-request',
    'a later config override must not widen the pinned permission profile',
  );
  await assert.rejects(
    () => lease.spawn(scope, codexExecutable, ['unexpected-prefix', ...args], spawnOptions),
    (error: unknown) => error instanceof AgentExecutionUnavailableError
      && error.reason === 'provider-rejected-request',
    'CODEX_SCRIPT-style executable prefixes must be rejected',
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
    codexExecutableSha256,
    codexHome: serviceCodexHome,
    platform: 'darwin',
    preflight: async () => undefined,
    spawn: () => fakeChild,
    executableTrustVerifier: () => undefined,
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

async function writePreflightFixture(executable: string, sandboxFailure: string): Promise<void> {
  const source = [
    `#!${process.execPath}`,
    'const args = process.argv.slice(2);',
    'if (args[0] === "--version") { console.log("codex-cli 0.148.0"); process.exit(0); }',
    'if (args[0] === "mcp") { console.log("[]"); process.exit(0); }',
    'if (args[0] === "plugin") { console.log(JSON.stringify({ installed: [], available: [] })); process.exit(0); }',
    'if (args[0] === "sandbox") {',
    '  if (args.includes("workspace-read-canary")) process.exit(0);',
    `  console.error(${JSON.stringify(sandboxFailure)});`,
    '  process.exit(1);',
    '}',
    'if (args[0] === "exec") { console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "TEAMS_CODEX_AUTH_PREFLIGHT_OK" } })); process.exit(0); }',
    'process.exit(1);',
    '',
  ].join('\n');
  await fs.writeFile(executable, source, { mode: 0o700 });
}
