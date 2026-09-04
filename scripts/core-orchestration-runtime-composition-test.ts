import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { build } from 'esbuild';

const root = process.cwd();
const token = 'mp259-runtime-token-0123456789abcdef';

await verifyUnknownRuntimeFailsClosed();
await verifyMeasuredRuntimeComposesCapabilitiesAndInputResume();

console.log('core-orchestration-runtime-composition-test: PASS');

async function verifyUnknownRuntimeFailsClosed(): Promise<void> {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mp285-codex-login-status-'));
  try {
    const loginStatusFixture = path.join(fixtureRoot, 'codex-login-status.mjs');
    await fs.writeFile(loginStatusFixture, `
const args = process.argv.slice(2);
if (args.length === 2 && args[0] === 'login' && args[1] === 'status') {
  console.log('Logged in using ChatGPT');
  process.exit(0);
}
console.error('unsupported Codex fixture command');
process.exit(2);
`);

    await withRuntime({
      provider: 'codex',
      extraEnv: {
        CODEX_BIN: process.execPath,
        CODEX_SCRIPT: loginStatusFixture,
      },
    }, async (origin) => {
      const response = await api(origin, '/providers');
      assert.equal(response.status, 200);
      const fact = response.body.providers.find((candidate: any) => candidate.provider === 'codex');
      assert.equal(fact.availability, 'unknown', 'login status alone is not execution readiness');
      assert.deepEqual(
        fact.capabilities,
        [],
        'a configured runner with unknown execution readiness must not advertise operations',
      );

      const before = await api(origin, '/jobs');
      assert.equal(before.status, 200);
      const rejectedDefault = await api(origin, '/jobs', {
        method: 'POST',
        body: {
          idempotencyKey: 'unknown-runtime-default-submit',
          prompt: 'unknown default provider must not run',
          mode: 'read-only',
        },
      });
      assert.equal(rejectedDefault.status, 503);
      assert.equal(
        rejectedDefault.body.error.code,
        'CORE_ORCHESTRATION_PROVIDER_UNAVAILABLE',
        'default provider submission uses the same measured readiness gate',
      );

      const rejectedSelected = await api(origin, '/jobs', {
        method: 'POST',
        body: {
          idempotencyKey: 'unknown-runtime-selected-submit',
          prompt: 'unregistered provider must not run',
          provider: 'copilot',
          mode: 'read-only',
        },
      });
      assert.equal(rejectedSelected.status, 503);
      assert.equal(rejectedSelected.body.error.code, 'CORE_ORCHESTRATION_PROVIDER_UNAVAILABLE');

      const after = await api(origin, '/jobs');
      assert.equal(after.status, 200);
      assert.equal(after.body.jobs.length, before.body.jobs.length, 'provider rejection creates no durable job');
    });
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function verifyMeasuredRuntimeComposesCapabilitiesAndInputResume(): Promise<void> {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mp259-measured-provider-'));
  try {
    const executable = path.join(fixtureRoot, 'copilot-fixture');
    await fs.writeFile(executable, `#!/bin/sh
if [ "$1" = "--help" ]; then
  printf '%s\\n' 'GitHub Copilot CLI help'
  exit 0
fi
printf '%s\\n' \
  '{"type":"session.start","data":{"sessionId":"019fd700-51cd-7862-a4ef-74ccae0f2b4e"}}' \
  '{"type":"assistant.turn_start","data":{"turnId":"turn-1"}}' \
  '{"type":"assistant.message","data":{"content":"GHCP_CAPABILITY_OK"}}' \
  '{"type":"assistant.turn_end","data":{"turnId":"turn-1"}}'
`, { mode: 0o700 });

    await withRuntime({
      provider: 'copilot',
      measuredInputRuntime: true,
      extraEnv: {
        GHCP_BIN: executable,
        TEAMS_GHCP_CAPABILITY_PROBE: 'true',
      },
    }, async (origin) => {
      const providerResponse = await api(origin, '/providers');
      assert.equal(providerResponse.status, 200);
      const fact = providerResponse.body.providers.find((candidate: any) => candidate.provider === 'copilot');
      assert.equal(fact.availability, 'available');
      assert.deepEqual(
        fact.capabilities,
        ['approve', 'cancel', 'input', 'retry', 'submit'],
        'only methods exposed by the measured provider/runtime composition are advertised',
      );

      const created = await api(origin, '/jobs', {
        method: 'POST',
        body: {
          idempotencyKey: 'mp259-supported-input',
          prompt: 'Wait for measured input',
          provider: 'copilot',
          mode: 'workspace-write',
        },
      });
      assert.equal(created.status, 201);
      assert.equal(created.body.job.status, 'awaiting_approval');

      const resumed = await api(origin, `/jobs/${created.body.job.id}/input`, {
        method: 'POST',
        body: { input: { answer: 'continue safely' } },
      });
      assert.equal(resumed.status, 200);
      assert.equal(resumed.body.status, 'accepted');
      assert.equal(resumed.body.job.id, created.body.job.id, 'input resume preserves durable job identity');
    });
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function withRuntime(
  options: { provider: 'codex' | 'copilot'; measuredInputRuntime?: boolean; extraEnv?: NodeJS.ProcessEnv },
  verify: (origin: string) => Promise<void>,
): Promise<void> {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), `mp259-${options.provider}-runtime-`));
  await fs.chmod(runtimeRoot, 0o700);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}/api/core-orchestration`;
  const sourcePath = path.join(root, 'src/server/index.ts');
  let source = await fs.readFile(sourcePath, 'utf8');
  if (options.measuredInputRuntime) {
    const marker = 'const coreProviderCapabilities = !azureQueueDispatch';
    assert.ok(source.includes(marker), 'runtime fixture insertion point must remain stable');
    source = source.replace(marker, `
for (const runtime of Object.values(providerRunners)) {
  Object.assign(runtime, {
    observeInputResume(job) {
      return {
        supported: true,
        awaitingInput: job.status === 'awaiting_approval',
        source: 'runtime-observation',
        observedAt: new Date().toISOString(),
        ...(job.status === 'awaiting_approval' ? {} : { reason: 'job-not-awaiting-input' }),
      };
    },
    async resumeInput(job) { return job; },
  });
}
${marker}`);
  }
  const bundlePath = path.join(runtimeRoot, 'index.mjs');
  await build({
    stdin: {
      contents: source,
      loader: 'ts',
      resolveDir: path.dirname(sourcePath),
      sourcefile: sourcePath,
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: bundlePath,
    splitting: false,
    legalComments: 'none',
    sourcemap: false,
    minifySyntax: true,
    banner: {
      js: "import { createRequire as __teamsCreateRequire } from 'node:module'; const require = __teamsCreateRequire(import.meta.url);",
    },
    define: { 'process.env.TEAMS_CORE_BUILD': '"true"' },
    external: [
      '@copilotkit/*', '@modelcontextprotocol/*', './mcp-genui.js',
      './mcp-provider-tools.js', './copilot-agent.js', './copilot-channels-shadow.js',
    ],
    logLevel: 'silent',
  });
  const nodeArgs = [bundlePath];
  let child: ChildProcess | undefined;
  let output = '';
  try {
    child = spawn(process.execPath, nodeArgs, {
      cwd: root,
      env: {
        ...process.env,
        ...options.extraEnv,
        NODE_ENV: 'test',
        PORT: String(port),
        TEAMS_AGENT_CLI_PROVIDER: options.provider,
        TEAMS_USE_SDK: 'false',
        TEAMS_SKIP_AUTH: 'true',
        TEAMS_SKIP_OUTBOUND: 'true',
        TEAMS_LOCAL_DEV: 'true',
        TEAMS_LOCAL_ACCESS_TOKEN: token,
        BOT_CLIENT_ID: '00000000-0000-4000-8000-000000000001',
        CLIENT_ID: '00000000-0000-4000-8000-000000000002',
        CLIENT_SECRET: 'fixture-only-secret',
        TENANT_ID: '00000000-0000-4000-8000-000000000003',
        ITEM_STORE_PATH: path.join(runtimeRoot, 'items.json'),
        WORK_ITEM_STORE_PATH: path.join(runtimeRoot, 'work-items.json'),
        COLLABORATION_STORE_PATH: path.join(runtimeRoot, 'collaboration.json'),
        AGENT_JOB_STORE_PATH: path.join(runtimeRoot, 'agent-jobs.json'),
        A2A_STORE_PATH: path.join(runtimeRoot, 'a2a.json'),
        A2A_OUTBOUND_STORE_PATH: path.join(runtimeRoot, 'a2a-outbound.json'),
        AGENT_ADMISSION_JOURNAL_PATH: path.join(runtimeRoot, 'admission.json'),
        GENUI_ACTION_STORE_PATH: path.join(runtimeRoot, 'genui-actions.json'),
        RESPONSE_MODE_STORE_PATH: path.join(runtimeRoot, 'response-modes.json'),
        AGENT_WORKSPACE: path.join(runtimeRoot, 'workspace'),
        TEAMS_OPERATOR_REQUESTER_ALLOWLIST: 'local-tenant/local-user',
        MCP_PUBLIC_ENABLED: '',
        TEAMS_OPTIONAL_RUNTIME: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { output += chunk.toString(); });
    await waitForHealth(`http://127.0.0.1:${port}`, child, () => output);
    await verify(origin);
  } finally {
    if (child) await stop(child);
    await fs.rm(runtimeRoot, { recursive: true, force: true });
  }
}

async function api(
  origin: string,
  pathname: string,
  options: { method?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${origin}${pathname}`, {
    method: options.method,
    headers: {
      'x-teams-local-access-token': token,
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', (error?: Error) => error ? reject(error) : resolve()));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function waitForHealth(origin: string, child: ChildProcess, output: () => string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) assert.fail(`server exited early: ${output().slice(-2_000)}`);
    try {
      const response = await fetch(`${origin}/api/health`, {
        headers: { 'x-teams-local-access-token': token },
      });
      if (response.ok) return;
    } catch { /* startup */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`server health timeout: ${output().slice(-2_000)}`);
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2_000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}
