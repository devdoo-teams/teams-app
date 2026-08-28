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
import {
  CODEX_EXTERNAL_TOOL_SURFACE_POLICY,
  CODEX_READ_ONLY_PERMISSION_ARGS,
} from '../src/server/codex-permission-profile-isolation-provider.js';
import { createProductionAgentExecutionPolicy } from '../src/server/production-agent-isolation.js';

type EffectiveToolInventory = Readonly<{
  apps: readonly string[];
  browserTools: readonly string[];
  computerUseTools: readonly string[];
  hooks: readonly string[];
  imageTools: readonly string[];
  mcpServers: readonly string[];
  multiAgentTools: readonly string[];
  plugins: readonly string[];
  skillTools: readonly string[];
  webTools: readonly string[];
}>;

type ToolSurfacePolicy = Readonly<{
  apps: false;
  connectors: false;
  browser: false;
  inAppBrowser: false;
  computerUse: false;
  plugins: false;
  mcp: false;
  mcpElicitations: false;
  multiAgent: false;
  webSearch: false;
  imageTools: false;
  hooks: false;
  skillInstall: false;
  skillSearch: false;
  requireEmptyMcpInventory: true;
  requireEmptyPluginInventory: true;
}>;

const expectedToolSurfacePolicy: ToolSurfacePolicy = Object.freeze({
  apps: false,
  connectors: false,
  browser: false,
  inAppBrowser: false,
  computerUse: false,
  plugins: false,
  mcp: false,
  mcpElicitations: false,
  multiAgent: false,
  webSearch: false,
  imageTools: false,
  hooks: false,
  skillInstall: false,
  skillSearch: false,
  requireEmptyMcpInventory: true,
  requireEmptyPluginInventory: true,
});

const requiredDisabledFeatures = Object.freeze([
  'apps',
  'auth_elicitation',
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'code_mode_host',
  'computer_use',
  'goals',
  'hooks',
  'image_generation',
  'in_app_browser',
  'in_app_updates',
  'multi_agent',
  'plugin_sharing',
  'plugins',
  'remote_plugin',
  'skill_mcp_dependency_install',
  'skill_search',
  'tool_call_mcp_elicitation',
  'tool_suggest',
  'view_image',
] as const);

const emptyInventory: EffectiveToolInventory = Object.freeze({
  apps: Object.freeze([]),
  browserTools: Object.freeze([]),
  computerUseTools: Object.freeze([]),
  hooks: Object.freeze([]),
  imageTools: Object.freeze([]),
  mcpServers: Object.freeze([]),
  multiAgentTools: Object.freeze([]),
  plugins: Object.freeze([]),
  skillTools: Object.freeze([]),
  webTools: Object.freeze([]),
});

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-codex-tool-surface-red-'));
const sourceWorkspace = path.join(root, 'source');
const serviceCodexHome = path.join(root, 'service-codex-home');
const codexExecutable = path.join(root, 'codex');
const scope = {
  tenantId: 'tenant-sec-05',
  requesterId: 'requester-sec-05',
  conversationId: 'conversation-sec-05',
};
const fakeChild = {} as ChildProcess;
const findings: string[] = [];
let codexExecutableSha256 = '';

try {
  await fs.mkdir(path.join(sourceWorkspace, 'src'), { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(sourceWorkspace, 'package.json'), '{"private":true}\n', { mode: 0o600 });
  await fs.writeFile(path.join(sourceWorkspace, 'src', 'fixture.txt'), 'SEC-05 fixture\n', { mode: 0o600 });
  await fs.mkdir(serviceCodexHome, { mode: 0o700 });
  // Fixture credentials only. The test never reads this file after creating it.
  await fs.writeFile(path.join(serviceCodexHome, 'auth.json'), '{"fixture":"not-a-real-credential"}\n', { mode: 0o600 });
  await fs.writeFile(codexExecutable, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  codexExecutableSha256 = await sha256(codexExecutable);

  await productionLaunchPinsEveryToolSurface();
  await nonEmptyEffectiveInventoryFailsClosed();

  if (findings.length > 0) {
    console.error(`SEC-05 RED: production native Codex tool boundary has ${findings.length} open condition(s):`);
    for (const finding of findings) console.error(`- ${finding}`);
    process.exitCode = 1;
  } else {
    console.log('PASS: production native Codex launch disables every external tool surface and rejects non-empty inventories');
  }
} finally {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}

async function productionLaunchPinsEveryToolSurface(): Promise<void> {
  let observedPreflightInput: Record<string, unknown> | undefined;
  const spawnCalls: Array<{
    command: string;
    args: readonly string[];
    options: AgentIsolationSpawnOptions;
  }> = [];

  const policy = createProductionAgentExecutionPolicy({
    sourceWorkspace,
    isProduction: true,
    platform: 'darwin',
    codexHome: serviceCodexHome,
    codexExecutable,
    codexExecutableSha256,
    canReadScope: () => true,
    canMutateScope: () => false,
    nativePreflight: async (input) => {
      observedPreflightInput = input as unknown as Record<string, unknown>;
      return { effectiveToolInventory: emptyInventory } as never;
    },
    spawn: (command, args, options) => {
      spawnCalls.push({ command, args: [...args], options });
      return fakeChild;
    },
    nativeExecutableTrustVerifier: () => undefined,
  });

  const prepared = await policy.prepareWorkspace('read-only', scope, 'inspect only');
  try {
    const lease = prepared.isolationLease;
    assert.ok(lease, 'production read-only execution must issue a native isolation lease');
    lease.bindJob('job-sec-05-launch');
    const args = [
      'exec',
      '--json',
      ...CODEX_READ_ONLY_PERMISSION_ARGS,
      '--cd',
      prepared.workspace,
      '--',
      'inspect only',
    ];
    await lease.spawn(
      { ...scope, jobId: 'job-sec-05-launch' },
      codexExecutable,
      args,
      {
        cwd: prepared.workspace,
        env: prepared.environmentOverrides ?? {},
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    const launchedArgs = spawnCalls[0]?.args ?? [];
    const configValues = launchedArgs.flatMap((value, index) => value === '-c' ? [launchedArgs[index + 1] ?? ''] : []);
    const disabledFeatures = launchedArgs.flatMap((value, index) => value === '--disable' ? [launchedArgs[index + 1] ?? ''] : []);
    for (const value of requiredDisabledFeatures) {
      if (!disabledFeatures.includes(value)) findings.push(`launch omitted explicit disabled feature ${value}`);
    }
    if (!configValues.includes('approval_policy="never"')) {
      findings.push('launch did not auto-reject MCP/tool/skill approval or elicitation prompts');
    }
    if (!configValues.includes('web_search="disabled"')) {
      findings.push('launch did not disable the hosted web-search mode');
    }

    const observedPolicy = observedPreflightInput?.toolSurfacePolicy as Partial<ToolSurfacePolicy> | undefined;
    for (const [surface, expected] of Object.entries(expectedToolSurfacePolicy)) {
      if (observedPolicy?.[surface as keyof ToolSurfacePolicy] !== expected) {
        findings.push(`preflight did not pin tool-surface policy ${surface}=${String(expected)}`);
      }
    }
  } finally {
    await prepared.dispose();
  }
}

async function nonEmptyEffectiveInventoryFailsClosed(): Promise<void> {
  await writeInventoryCodexExecutable();
  codexExecutableSha256 = await sha256(codexExecutable);
  const policy = createProductionAgentExecutionPolicy({
    sourceWorkspace,
    isProduction: true,
    platform: 'darwin',
    codexHome: serviceCodexHome,
    codexExecutable,
    codexExecutableSha256,
    canReadScope: () => true,
    canMutateScope: () => false,
    spawn: () => fakeChild,
    nativeExecutableTrustVerifier: () => undefined,
  });

  let prepared: Awaited<ReturnType<typeof policy.prepareWorkspace>> | undefined;
  try {
    prepared = await policy.prepareWorkspace('read-only', scope, 'inspect only');
    findings.push('preflight accepted effective MCP inventory [fixture-untrusted-mcp] and plugin inventory [fixture-untrusted-plugin]');
  } catch (error) {
    if (!(error instanceof AgentExecutionUnavailableError)
      || !['provider-rejected-request', 'trusted-isolation-required'].includes(error.reason)) {
      throw error;
    }
  } finally {
    await prepared?.dispose();
  }
}

async function writeInventoryCodexExecutable(): Promise<void> {
  const source = [
    `#!${process.execPath}`,
    "const args = process.argv.slice(2);",
    'if (args[0] === "--version") { console.log("codex-cli 0.148.0"); process.exit(0); }',
    'if (args[0] === "mcp") { console.log(JSON.stringify([{ name: "fixture-untrusted-mcp" }])); process.exit(0); }',
    'if (args[0] === "plugin") { console.log(JSON.stringify({ installed: [{ name: "fixture-untrusted-plugin" }], available: [] })); process.exit(0); }',
    'process.exit(0);',
    '',
  ].join('\n');
  await fs.writeFile(codexExecutable, source, { mode: 0o700 });
}

async function sha256(file: string): Promise<string> {
  return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

assert.deepEqual(CODEX_EXTERNAL_TOOL_SURFACE_POLICY, expectedToolSurfacePolicy);
