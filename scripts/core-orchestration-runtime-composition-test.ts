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
await verifyMeasuredCodexModelSelectionRoundTrip();

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

async function verifyMeasuredCodexModelSelectionRoundTrip(): Promise<void> {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'mp290-codex-selection-'));
  try {
    const executable = path.join(fixtureRoot, 'codex-fixture');
    const codexHome = path.join(fixtureRoot, 'codex-home');
    const argvLog = path.join(fixtureRoot, 'argv.json');
    await fs.mkdir(codexHome, { mode: 0o700 });
    await fs.writeFile(executable, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'login' && args[1] === 'status') {
  console.log('Logged in using ChatGPT');
  process.exit(0);
}
if (args[0] === 'debug' && args[1] === 'models') {
  console.log(JSON.stringify({ models: [{
    slug: 'gpt-5.6-sol',
    display_name: 'GPT-5.6-Sol',
    visibility: 'list',
    default_reasoning_level: 'low',
    supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }],
  }] }));
  process.exit(0);
}
if (args[0] === 'exec') {
  fs.writeFileSync(${JSON.stringify(argvLog)}, JSON.stringify(args));
  console.log(JSON.stringify({ type: 'thread.started', thread_id: '11111111-1111-4111-8111-111111111111' }));
  console.log(JSON.stringify({ type: 'turn.started' }));
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '선택된 Codex 모델 실행 완료' } }));
  console.log(JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: 120, cached_input_tokens: 20, output_tokens: 30, reasoning_output_tokens: 10 },
  }));
  process.exit(0);
}
console.error('unsupported Codex fixture command');
process.exit(2);
`, { mode: 0o700 });

    await withRuntime({
      provider: 'codex',
      measuredCodexRuntime: true,
      extraEnv: {
        CODEX_BIN: executable,
        AGENT_CODEX_HOME: codexHome,
        TEAMS_TEST_PROCESS_ISOLATION: 'true',
      },
    }, async (origin) => {
      const baseUrl = new URL(origin).origin;
      const modelResponse = await teamsPost(baseUrl, teamsActivity('agent choose 저장소를 점검해줘', 'choose'));
      const modelCard = teamsCard(modelResponse.body, 'Codex 모델 선택');
      const modelInput = modelCard.body?.find((item: any) => item.type === 'Input.ChoiceSet' && item.id === 'model');
      assert.deepEqual(modelInput?.choices, [{ title: 'GPT-5.6-Sol', value: 'gpt-5.6-sol' }]);
      const modelAction = modelCard.actions?.find((action: any) => action.data?.action === 'orchestration.select-model');
      assert.ok(modelAction?.data, 'model card must include the server-bound catalog revision');

      const reasoningResponse = await teamsPost(baseUrl, teamsActivity('', 'select-model', {
        ...modelAction.data,
        model: 'gpt-5.6-sol',
      }));
      const reasoningCard = teamsCard(reasoningResponse.body, 'Codex 추론 수준 선택');
      const reasoningInput = reasoningCard.body?.find((item: any) => item.type === 'Input.ChoiceSet' && item.id === 'reasoningEffort');
      assert.deepEqual(reasoningInput?.choices, [
        { title: 'low', value: 'low' },
        { title: 'high', value: 'high' },
      ]);
      const submitAction = reasoningCard.actions?.find((action: any) => action.data?.action === 'orchestration.submit-selected');
      assert.ok(submitAction?.data, 'reasoning card must preserve the same immutable model selection identity');

      const submitted = await teamsPost(baseUrl, teamsActivity('', 'submit-selected', {
        ...submitAction.data,
        reasoningEffort: 'high',
      }));
      const submittedCard = teamsCard(submitted.body, 'gpt-5.6-sol');
      const jobId = cardFact(submittedCard, '작업 ID');
      assert.equal(cardFact(submittedCard, '추론 수준'), 'high');

      const completedCard = await waitForCompletedTeamsJob(baseUrl, jobId);
      assert.equal(cardFact(completedCard, '상태'), 'completed');
      assert.equal(cardFact(completedCard, '사용 토큰'), '150 (입력 120 / 출력 30)');
      assert.equal(cardFact(completedCard, '추론 출력'), '10');
      assert.equal(cardFact(completedCard, '계정 잔여량'), 'Codex CLI에서 제공되지 않음');

      const argv = JSON.parse(await fs.readFile(argvLog, 'utf8')) as string[];
      assert.deepEqual(argv.slice(argv.indexOf('--model'), argv.indexOf('--model') + 2), ['--model', 'gpt-5.6-sol']);
      assert.deepEqual(argv.slice(argv.indexOf('--config'), argv.indexOf('--config') + 2), [
        '--config',
        'model_reasoning_effort="high"',
      ]);
    });
  } finally {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function withRuntime(
  options: {
    provider: 'codex' | 'copilot';
    measuredInputRuntime?: boolean;
    measuredCodexRuntime?: boolean;
    extraEnv?: NodeJS.ProcessEnv;
  },
  verify: (origin: string) => Promise<void>,
): Promise<void> {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), `mp259-${options.provider}-runtime-`));
  await fs.chmod(runtimeRoot, 0o700);
  await fs.mkdir(path.join(runtimeRoot, 'workspace'), { mode: 0o700 });
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
  if (options.measuredCodexRuntime) {
    const marker = 'const AZURE_CORE_SUBMISSION_FACT_MAX_AGE_MS = 30_000;';
    assert.ok(source.includes(marker), 'Codex runtime fixture insertion point must remain stable');
    source = source.replace(marker, `
if (coreProviderCapabilities) {
  Object.assign(coreProviderCapabilities, {
    codex: {
      state: 'available', executable: 'present', probe: 'passed',
      authentication: 'authenticated', login: 'authenticated',
      entitlement: 'allowed', reason: 'verified',
    },
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
    try {
      await verify(origin);
    } catch (error) {
      const message = error instanceof Error ? error.stack ?? error.message : String(error);
      throw new Error(`${message}\n\nSERVER OUTPUT:\n${output.slice(-4_000)}`);
    }
  } finally {
    if (child) await stop(child);
    await fs.rm(runtimeRoot, { recursive: true, force: true });
  }
}

function teamsActivity(text: string, id: string, value?: unknown): Record<string, unknown> {
  return {
    type: 'message',
    id: `mp290-${id}`,
    timestamp: new Date().toISOString(),
    serviceUrl: 'http://localhost',
    channelId: 'msteams',
    from: { id: 'local-user', aadObjectId: 'local-user' },
    conversation: { id: 'mp290-conversation', conversationType: 'personal', tenantId: 'local-tenant' },
    channelData: { tenant: { id: 'local-tenant' } },
    recipient: { id: 'bot' },
    text,
    ...(value === undefined ? {} : { value }),
  };
}

async function teamsPost(baseUrl: string, body: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}/api/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-teams-local-access-token': token,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

function teamsCard(body: any, expected: string): Record<string, any> {
  const message = body?.activities?.[0];
  assert.ok(message && !Object.hasOwn(message, 'text'), 'Core Teams response must be attachment-only');
  const card = message.attachments?.[0]?.content;
  assert.equal(card?.type, 'AdaptiveCard');
  assert.equal(card?.version, '1.6', 'canonical Microsoft Teams documentation supports mobile through 1.6');
  assert.match(JSON.stringify(card), new RegExp(expected, 'u'));
  return card;
}

function cardFact(card: Record<string, any>, title: string): string {
  const value = card.body
    ?.filter((item: any) => item.type === 'FactSet')
    .flatMap((item: any) => item.facts ?? [])
    .find((fact: any) => fact.title === title)?.value;
  assert.equal(typeof value, 'string', `card fact ${title} must be present`);
  return value;
}

async function waitForCompletedTeamsJob(baseUrl: string, jobId: string): Promise<Record<string, any>> {
  const deadline = Date.now() + 5_000;
  let lastCard: Record<string, any> | undefined;
  while (Date.now() < deadline) {
    const response = await teamsPost(baseUrl, teamsActivity(`agent status ${jobId}`, `status-${Date.now()}`));
    lastCard = teamsCard(response.body, jobId);
    if (cardFact(lastCard, '상태') === 'completed') return lastCard;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`selected Codex job did not complete: ${JSON.stringify(lastCard)}`);
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
