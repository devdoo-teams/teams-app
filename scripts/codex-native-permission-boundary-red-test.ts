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
  type AgentIsolationLease,
  type AgentIsolationSpawnOptions,
} from '../src/server/agent-execution-policy.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-codex-native-boundary-red-'));
const fakeChild = {} as ChildProcess;
const findings: string[] = [];

type Fixture = Readonly<{
  sourceWorkspace: string;
  projectedWorkspace: string;
  isolatedHome: string;
  serviceCodexHome: string;
  authPath: string;
  codexExecutable: string;
  codexExecutableSha256: string;
}>;

const scope = (suffix: string) => ({
  tenantId: 'tenant-security-red',
  requesterId: 'requester-security-red',
  conversationId: `conversation-${suffix}`,
  jobId: `job-${suffix}`,
});

try {
  await executableIdentityReplacementIsRejected();
  await argumentGrammarIsClosed();
  await trustedParentEnvironmentIsSealed();
  await canonicalPathsAndProtectedRootsAreEnforced();
  await authAndServiceHomeIdentityAreRevalidated();
  await defaultPreflightExercisesTheActualBoundary();

  if (findings.length > 0) {
    assert.fail([
      `SECURITY RED: f2352b1 accepted ${findings.length} unsafe native-boundary condition(s):`,
      ...findings.map((finding) => `- ${finding}`),
    ].join('\n'));
  }

  console.log('PASS: native Codex boundary rejects identity, argv, environment, path, and preflight bypasses');
} finally {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}

async function executableIdentityReplacementIsRejected(): Promise<void> {
  const fixture = await createFixture('executable-identity');
  const { provider, spawnCalls } = createProvider(fixture);
  const lease = await acquire(provider, fixture, scope('executable-identity'));
  const before = await fs.stat(fixture.codexExecutable);
  const replacement = `${fixture.codexExecutable}.replacement`;
  await fs.writeFile(replacement, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  await fs.rename(replacement, fixture.codexExecutable);
  const after = await fs.stat(fixture.codexExecutable);
  assert.notEqual(after.ino, before.ino, 'fixture must replace the executable inode after acquire');

  await recordUnexpectedAcceptance(
    'SEC-01 executable inode replacement after preflight/acquire',
    () => spawnLease(lease, scope('executable-identity'), fixture),
  );
  if (spawnCalls.length > 0) findings.push('SEC-01 replaced executable reached the process spawn boundary');
  await lease.dispose();
}

async function argumentGrammarIsClosed(): Promise<void> {
  const fixture = await createFixture('argv');
  const { provider } = createProvider(fixture);
  const subject = scope('argv');
  const lease = await acquire(provider, fixture, subject);
  const args = baseArgs(fixture.projectedWorkspace);
  const separator = args.indexOf('--');

  const bypasses: ReadonlyArray<readonly [string, readonly string[]]> = [
    [
      'SEC-02 --config= sandbox_mode override',
      [...args.slice(0, separator), '--config=sandbox_mode="danger-full-access"', ...args.slice(separator)],
    ],
    [
      'SEC-02 --sandbox= legacy sandbox override',
      [...args.slice(0, separator), '--sandbox=danger-full-access', ...args.slice(separator)],
    ],
    [
      'SEC-02 unknown option before prompt separator',
      [...args.slice(0, separator), '--unknown-provider-option', ...args.slice(separator)],
    ],
    [
      'SEC-02 output path option outside projected workspace',
      [...args.slice(0, separator), '--output-schema', path.join(root, 'outside-schema.json'), ...args.slice(separator)],
    ],
  ];

  for (const [label, candidateArgs] of bypasses) {
    await recordUnexpectedAcceptance(
      label,
      () => spawnLease(lease, subject, fixture, candidateArgs),
    );
  }
  await lease.dispose();
}

async function trustedParentEnvironmentIsSealed(): Promise<void> {
  const fixture = await createFixture('environment');
  const injected = {
    HOME: fixture.isolatedHome,
    USERPROFILE: fixture.isolatedHome,
    CODEX_HOME: path.join(fixture.isolatedHome, '.codex'),
    DYLD_INSERT_LIBRARIES: path.join(root, 'fixture-inject.dylib'),
    HTTPS_PROXY: 'http://127.0.0.1:9',
    SSL_CERT_FILE: path.join(root, 'fixture-ca.pem'),
    NODE_EXTRA_CA_CERTS: path.join(root, 'fixture-node-ca.pem'),
    TMPDIR: path.join(root, 'shared-tmp'),
  };
  const spawnCalls: Array<{ options: AgentIsolationSpawnOptions }> = [];
  const provider = new CodexPermissionProfileIsolationProvider({
    codexExecutable: fixture.codexExecutable,
    codexExecutableSha256: fixture.codexExecutableSha256,
    codexHome: fixture.serviceCodexHome,
    platform: 'darwin',
    preflight: async () => undefined,
    spawn: (_command, _args, options) => {
      spawnCalls.push({ options });
      return fakeChild;
    },
    executableTrustVerifier: () => undefined,
  });
  const subject = scope('environment');
  let lease: AgentIsolationLease;
  try {
    lease = await provider.acquire({
      subject,
      sourceWorkspace: fixture.sourceWorkspace,
      workspace: fixture.projectedWorkspace,
      protectedRoots: [fixture.sourceWorkspace, os.homedir()],
      environmentOverrides: injected,
      prompt: 'inspect only',
    });
  } catch (error) {
    if (error instanceof AgentExecutionUnavailableError
      && ['provider-rejected-request', 'trusted-isolation-required'].includes(error.reason)) return;
    throw error;
  }

  await recordUnexpectedAcceptance(
    'SEC-04 loader/proxy/CA/shared-TMP environment injection',
    () => spawnLease(lease, subject, fixture),
  );
  const launchedEnvironment = spawnCalls[0]?.options.env ?? {};
  for (const key of ['DYLD_INSERT_LIBRARIES', 'HTTPS_PROXY', 'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS', 'TMPDIR']) {
    if (launchedEnvironment[key] === injected[key as keyof typeof injected]) {
      findings.push(`SEC-04 untrusted ${key} survived into trusted Codex parent environment`);
    }
  }
  await lease.dispose();
}

async function canonicalPathsAndProtectedRootsAreEnforced(): Promise<void> {
  const fixture = await createFixture('paths');
  const provider = createProvider(fixture).provider;

  const realProtectedRoot = path.join(root, 'paths-real-protected');
  const protectedProjection = path.join(realProtectedRoot, 'projection');
  const protectedAlias = path.join(root, 'paths-protected-alias');
  await fs.mkdir(protectedProjection, { recursive: true, mode: 0o700 });
  await fs.symlink(realProtectedRoot, protectedAlias);
  let protectedLease: AgentIsolationLease | undefined;
  await recordUnexpectedAcceptance('SEC-07 symlinked protected root overlap', async () => {
    protectedLease = await provider.acquire({
      subject: scope('protected-root'),
      sourceWorkspace: fixture.sourceWorkspace,
      workspace: protectedProjection,
      protectedRoots: [protectedAlias],
      environmentOverrides: {
        HOME: fixture.isolatedHome,
        USERPROFILE: fixture.isolatedHome,
        CODEX_HOME: path.join(fixture.isolatedHome, '.codex'),
      },
      prompt: 'inspect only',
    });
  });
  await protectedLease?.dispose();

  const realAliasParent = path.join(root, 'paths-real-parent');
  const projectedUnderRealParent = path.join(realAliasParent, 'projection');
  const aliasParent = path.join(root, 'paths-parent-alias');
  await fs.mkdir(projectedUnderRealParent, { recursive: true, mode: 0o700 });
  await fs.symlink(realAliasParent, aliasParent);
  const projectedThroughAlias = path.join(aliasParent, 'projection');
  const aliasLease = await provider.acquire({
    subject: scope('canonical-workspace'),
    sourceWorkspace: fixture.sourceWorkspace,
    workspace: projectedThroughAlias,
    protectedRoots: [fixture.sourceWorkspace],
    environmentOverrides: {
      HOME: fixture.isolatedHome,
      USERPROFILE: fixture.isolatedHome,
      CODEX_HOME: path.join(fixture.isolatedHome, '.codex'),
    },
    prompt: 'inspect only',
  });
  const canonicalWorkspace = await fs.realpath(projectedThroughAlias);
  if (aliasLease.workspace !== canonicalWorkspace) {
    findings.push(`SEC-07 lease retained noncanonical workspace ${aliasLease.workspace}`);
  }
  await aliasLease.dispose();
}

async function authAndServiceHomeIdentityAreRevalidated(): Promise<void> {
  const fixture = await createFixture('auth-identity');
  const provider = createProvider(fixture).provider;
  const subject = scope('auth-identity');
  const lease = await acquire(provider, fixture, subject);

  const beforeAuth = await fs.stat(fixture.authPath);
  const replacementAuth = `${fixture.authPath}.replacement`;
  await fs.writeFile(replacementAuth, '{"fixture":"replacement-auth"}\n', { mode: 0o600 });
  await fs.rename(replacementAuth, fixture.authPath);
  const afterAuth = await fs.stat(fixture.authPath);
  assert.notEqual(afterAuth.ino, beforeAuth.ino, 'fixture must replace auth.json inode after acquire');
  await recordUnexpectedAcceptance(
    'SEC-07 auth.json identity replacement after acquire',
    () => spawnLease(lease, subject, fixture),
  );

  const movedHome = `${fixture.serviceCodexHome}.moved`;
  await fs.rename(fixture.serviceCodexHome, movedHome);
  await fs.mkdir(fixture.serviceCodexHome, { mode: 0o700 });
  await fs.writeFile(fixture.authPath, '{"fixture":"replacement-home-auth"}\n', { mode: 0o600 });
  await recordUnexpectedAcceptance(
    'SEC-07 service CODEX_HOME directory identity replacement after acquire',
    () => spawnLease(lease, subject, fixture),
  );
  await lease.dispose();
}

async function defaultPreflightExercisesTheActualBoundary(): Promise<void> {
  const fixture = await createFixture('actual-preflight');
  const invocationLog = path.join(root, 'actual-preflight-invocations.jsonl');
  const workspaceCanary = path.join(fixture.projectedWorkspace, 'workspace-canary.txt');
  const serviceCanary = path.join(fixture.serviceCodexHome, 'service-secret-canary.txt');
  await fs.writeFile(workspaceCanary, 'workspace fixture\n', { mode: 0o600 });
  await fs.writeFile(serviceCanary, 'service fixture\n', { mode: 0o600 });
  await writeLoggingCodexExecutable(fixture.codexExecutable, invocationLog);
  const codexExecutableSha256 = await sha256(fixture.codexExecutable);

  const provider = new CodexPermissionProfileIsolationProvider({
    codexExecutable: fixture.codexExecutable,
    codexExecutableSha256,
    codexHome: fixture.serviceCodexHome,
    platform: 'darwin',
    spawn: () => fakeChild,
    executableTrustVerifier: () => undefined,
  });
  const lease = await acquire(provider, fixture, scope('actual-preflight'));
  await lease.dispose();

  const invocations = (await fs.readFile(invocationLog, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { args: string[]; codexHome: string | null; cwd: string });
  const serialized = JSON.stringify(invocations);
  if (!invocations.some((entry) => entry.args[0] === 'exec')) {
    findings.push('SEC-03 default preflight never exercised the actual codex exec boundary');
  }
  const canonicalServiceHome = await fs.realpath(fixture.serviceCodexHome);
  if (!invocations.some((entry) => entry.codexHome === canonicalServiceHome)) {
    findings.push('SEC-03 default preflight never used the actual service CODEX_HOME/auth boundary');
  }
  if (!serialized.includes(workspaceCanary)) {
    findings.push('SEC-03 default preflight did not prove actual workspace-canary read access');
  }
  if (!serialized.includes(serviceCanary)) {
    findings.push('SEC-03 default preflight did not prove service-home canary denial');
  }
  if (!serialized.includes('write-denied-canary')) {
    findings.push('SEC-03 default preflight did not prove workspace write denial');
  }
  if (!serialized.includes('network-denied-canary')) {
    findings.push('SEC-03 default preflight did not prove generated-command network denial');
  }
}

async function createFixture(name: string): Promise<Fixture> {
  const fixtureRoot = path.join(root, name);
  const sourceWorkspace = path.join(fixtureRoot, 'source');
  const projectedWorkspace = path.join(fixtureRoot, 'projection');
  const isolatedHome = path.join(fixtureRoot, 'isolated-home');
  const serviceCodexHome = path.join(fixtureRoot, 'service-codex-home');
  const authPath = path.join(serviceCodexHome, 'auth.json');
  const codexExecutable = path.join(fixtureRoot, 'codex');
  await fs.mkdir(sourceWorkspace, { recursive: true, mode: 0o700 });
  await fs.mkdir(projectedWorkspace, { recursive: true, mode: 0o700 });
  await fs.mkdir(isolatedHome, { recursive: true, mode: 0o700 });
  await fs.mkdir(serviceCodexHome, { recursive: true, mode: 0o700 });
  await fs.writeFile(authPath, '{"fixture":"service-auth"}\n', { mode: 0o600 });
  await fs.writeFile(codexExecutable, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const codexExecutableSha256 = await sha256(codexExecutable);
  return { sourceWorkspace, projectedWorkspace, isolatedHome, serviceCodexHome, authPath, codexExecutable, codexExecutableSha256 };
}

function createProvider(fixture: Fixture): {
  provider: CodexPermissionProfileIsolationProvider;
  spawnCalls: Array<{ command: string; args: readonly string[]; options: AgentIsolationSpawnOptions }>;
} {
  const spawnCalls: Array<{ command: string; args: readonly string[]; options: AgentIsolationSpawnOptions }> = [];
  const provider = new CodexPermissionProfileIsolationProvider({
    codexExecutable: fixture.codexExecutable,
    codexExecutableSha256: fixture.codexExecutableSha256,
    codexHome: fixture.serviceCodexHome,
    platform: 'darwin',
    preflight: async () => undefined,
    spawn: (command, args, options) => {
      spawnCalls.push({ command, args: [...args], options });
      return fakeChild;
    },
    executableTrustVerifier: () => undefined,
  });
  return { provider, spawnCalls };
}

async function acquire(
  provider: CodexPermissionProfileIsolationProvider,
  fixture: Fixture,
  subject: ReturnType<typeof scope>,
): Promise<AgentIsolationLease> {
  return provider.acquire({
    subject,
    sourceWorkspace: fixture.sourceWorkspace,
    workspace: fixture.projectedWorkspace,
    protectedRoots: [fixture.sourceWorkspace, os.homedir()],
    environmentOverrides: {
      HOME: fixture.isolatedHome,
      USERPROFILE: fixture.isolatedHome,
      CODEX_HOME: path.join(fixture.isolatedHome, '.codex'),
    },
    prompt: 'inspect only',
  });
}

function baseArgs(workspace: string): string[] {
  return [
    'exec',
    '--json',
    ...CODEX_READ_ONLY_PERMISSION_ARGS,
    '--cd',
    workspace,
    '--',
    'inspect only',
  ];
}

async function spawnLease(
  lease: AgentIsolationLease,
  subject: ReturnType<typeof scope>,
  fixture: Fixture,
  args: readonly string[] = baseArgs(lease.workspace),
): Promise<ChildProcess> {
  return lease.spawn(subject, fixture.codexExecutable, args, {
    cwd: lease.workspace,
    env: { ...lease.environmentOverrides },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function recordUnexpectedAcceptance(label: string, action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
    findings.push(label);
  } catch (error) {
    if (!(error instanceof AgentExecutionUnavailableError)
      || !['provider-rejected-request', 'trusted-isolation-required'].includes(error.reason)) {
      throw error;
    }
  }
}

async function writeLoggingCodexExecutable(executable: string, invocationLog: string): Promise<void> {
  const source = [
    `#!${process.execPath}`,
    "const fs = require('node:fs');",
    `const log = ${JSON.stringify(invocationLog)};`,
    'const args = process.argv.slice(2);',
    'fs.appendFileSync(log, JSON.stringify({ args, codexHome: process.env.CODEX_HOME ?? null, cwd: process.cwd() }) + "\\n");',
    'if (args[0] === "--version") { console.log("codex-cli 0.148.0"); process.exit(0); }',
    'if (args[0] === "mcp") { console.log("[]"); process.exit(0); }',
    'if (args[0] === "plugin") { console.log(JSON.stringify({ installed: [], available: [] })); process.exit(0); }',
    'if (args[0] === "sandbox") { process.exit(args.some((value) => value.includes("denied-canary") || value.includes("service-secret-canary")) ? 1 : 0); }',
    'if (args[0] === "exec") { console.log(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "TEAMS_CODEX_AUTH_PREFLIGHT_OK" } })); process.exit(0); }',
    'process.exit(0);',
    '',
  ].join('\n');
  await fs.writeFile(executable, source, { mode: 0o700 });
}

async function sha256(file: string): Promise<string> {
  return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
}
