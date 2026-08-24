import assert from 'node:assert/strict';
import { spawn as spawnProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  CliAgentRunner,
  type CliAgentLifecycleEvent,
} from '../src/server/cli-agent-runner.js';
import { probeGitHubCopilotCliCapability } from '../src/server/ghcp-cli-adapter.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-cli-agent-runner-'));
const fakeCliPath = path.join(root, 'fake-cli.mjs');
const argvPath = path.join(root, 'argv.json');
const environmentProbePath = path.join(root, 'environment-probe.json');
const sessionId = '019fd700-51cd-7862-a4ef-74ccae0f2b4e';
const approvedTokenValues = {
  COPILOT_GITHUB_TOKEN: 'copilot-cli-token-for-test',
  GH_TOKEN: 'gh-token-for-test',
  GITHUB_TOKEN: 'github-token-for-test',
} as const;
const unrelatedSecretValues = {
  UNRELATED_SECRET_TOKEN: 'unrelated-secret-token-for-test',
  OPENAI_API_KEY: 'unrelated-openai-key-for-test',
  AWS_SECRET_ACCESS_KEY: 'unrelated-aws-secret-for-test',
} as const;

const fakeCliSource = `
import fs from 'node:fs/promises';
await fs.writeFile(${JSON.stringify(argvPath)}, JSON.stringify(process.argv.slice(2)), 'utf8');
const approvedTokenValues = ${JSON.stringify(approvedTokenValues)};
const approvedTokenKeys = Object.keys(approvedTokenValues);
const unrelatedSecretKeys = ${JSON.stringify(Object.keys(unrelatedSecretValues))};
await fs.writeFile(${JSON.stringify(environmentProbePath)}, JSON.stringify({
  ci: process.env.CI,
  pathPresent: typeof process.env.PATH === 'string' || typeof process.env.Path === 'string',
  approvedTokenKeys: Object.keys(process.env).filter((key) => approvedTokenKeys.includes(key)).sort(),
  approvedTokenMatches: Object.fromEntries(approvedTokenKeys.map((key) => [key, process.env[key] === approvedTokenValues[key]])),
  unrelatedSecretKeys: unrelatedSecretKeys.filter((key) => Object.hasOwn(process.env, key)),
}), 'utf8');
const promptIndex = process.argv.indexOf('--prompt');
const prompt = promptIndex >= 0 ? process.argv[promptIndex + 1] ?? '' : process.argv.at(-1) ?? '';
if (prompt.includes('CASE:redaction')) {
  console.error('Authorization: Bearer secret-token\\nUse this one-time code ABCD-EFGH\\n${root}');
  process.exit(7);
}
if (prompt.includes('CASE:auth-stderr')) {
  console.error('Authentication required for GitHub Copilot CLI\\nPlease run copilot login\\nAuthorization: Bearer secret-token\\n${root}');
  process.exit(7);
}
const emit = (event) => {
  const serialized = JSON.stringify(event);
  if (Object.values(approvedTokenValues).some((value) => serialized.includes(value))) {
    throw new Error('fake CLI attempted to print a token value');
  }
  console.log(serialized);
};
if (process.argv.includes('exec')) {
  emit({ type: 'thread.started', thread_id: ${JSON.stringify(sessionId)} });
  emit({ type: 'turn.started' });
  if (prompt.includes('CASE:empty')) {
    emit({ type: 'item.completed', item: { type: 'agent_message', text: '   ' } });
    emit({ type: 'turn.completed' });
  } else if (prompt.includes('CASE:slow')) {
    await new Promise(() => setInterval(() => {}, 1_000));
  } else {
    if (prompt.includes('CASE:progress')) {
      emit({ type: 'item.completed', item: { type: 'agent_message', text: 'CODEX_PROGRESS' } });
    }
    emit({ type: 'item.completed', item: { type: 'agent_message', text: 'CODEX_FINAL' } });
    emit({ type: 'turn.completed' });
  }
} else {
  emit({ type: 'session.start', data: { sessionId: ${JSON.stringify(sessionId)} } });
  emit({ type: 'assistant.turn_start', data: { turnId: 'turn-1' } });
  if (prompt.includes('CASE:auth-session-error')) {
    emit({
      type: 'session.error',
      data: {
        message: 'Login required for GitHub Copilot CLI. Authorization: Bearer secret-token ${root}',
        error: {
          code: 'login_required',
          type: 'auth_required',
        },
      },
    });
  } else
  if (prompt.includes('CASE:empty')) {
    emit({ type: 'assistant.message', data: { messageId: 'message-1', content: '   ' } });
    emit({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } });
  } else if (prompt.includes('CASE:slow')) {
    await new Promise(() => setInterval(() => {}, 1_000));
  } else {
    if (prompt.includes('CASE:progress')) {
      emit({ type: 'assistant.message', data: { messageId: 'progress-1', content: 'COPILOT_PROGRESS' } });
    }
    emit({ type: 'assistant.message', data: { messageId: 'message-1', content: 'COPILOT_FINAL' } });
    emit({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } });
    emit({ type: 'session.shutdown', data: { shutdownType: 'prompt-mode-complete' } });
  }
}
`;

try {
  await fs.writeFile(fakeCliPath, fakeCliSource, { mode: 0o700 });

  let unsupportedSpawnCount = 0;
  const selectionRunner = new CliAgentRunner({
    spawn: () => {
      unsupportedSpawnCount += 1;
      throw new Error('unsupported provider must not reach spawn');
    },
  });
  await assert.rejects(
    () => selectionRunner.run({
      provider: 'unknown' as never,
      jobId: 'unknown-provider',
      prompt: 'must not run',
      workspace: root,
      mode: 'workspace-write',
    }),
    /unsupported.*provider/iu,
  );
  assert.equal(unsupportedSpawnCount, 0, 'provider selection fails closed before process launch');

  const events: CliAgentLifecycleEvent[] = [];
  const runner = new CliAgentRunner({
    commands: {
      codex: { executable: process.execPath, prefixArgs: [fakeCliPath] },
      copilot: { executable: process.execPath, prefixArgs: [fakeCliPath] },
    },
    processControllerOptions: { graceMs: 20, cleanupWaitMs: 200 },
  });

  const result = await runner.run({
    provider: 'copilot',
    jobId: 'copilot-success',
    prompt: 'inspect the repository',
    workspace: root,
    mode: 'workspace-write',
    timeoutMs: 1_000,
    onEvent: (event) => { events.push(event); },
  });

  assert.deepEqual(result, {
    provider: 'copilot',
    sessionId,
    finalResult: 'COPILOT_FINAL',
    eventCount: 5,
  });
  assert.deepEqual(events.map((event) => event.type), [
    'session.started',
    'turn.started',
    'agent.message',
    'turn.completed',
  ]);

  const args = JSON.parse(await fs.readFile(argvPath, 'utf8')) as string[];
  assert.deepEqual(args.slice(0, 4), [
    '--prompt',
    'inspect the repository',
    '--output-format',
    'json',
  ], 'official Copilot automation uses --prompt with JSONL output');
  assert.equal(args.includes('login'), false, 'execution and health paths never automate copilot login');
  assert.equal(args.includes('--allow-all-tools'), false, 'Copilot execution never bypasses tool permissions');
  assert.ok(args.includes('--allow-tool=read,write'), 'workspace-write Copilot execution uses the bounded default tool set');
  assert.ok(
    args.includes('--secret-env-vars=COPILOT_GITHUB_TOKEN,GH_TOKEN,GITHUB_TOKEN'),
    'Copilot execution marks the explicitly forwarded authentication variables as secret at the child boundary',
  );

  const identityRoot = path.join(root, 'ghcp-identity');
  const firstExecutableDirectory = path.join(identityRoot, 'first');
  const secondExecutableDirectory = path.join(identityRoot, 'second');
  const firstExecutable = path.join(firstExecutableDirectory, 'copilot');
  const secondExecutable = path.join(secondExecutableDirectory, 'copilot');
  await fs.mkdir(firstExecutableDirectory, { recursive: true });
  await fs.mkdir(secondExecutableDirectory, { recursive: true });
  await fs.writeFile(firstExecutable, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  await fs.writeFile(secondExecutable, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const previousIdentityBin = process.env.GHCP_BIN;
  const previousIdentityScript = process.env.GHCP_SCRIPT;
  const previousIdentityPath = process.env.PATH;
  let identityExecutionCommand: string | undefined;
  try {
    process.env.GHCP_BIN = 'copilot';
    delete process.env.GHCP_SCRIPT;
    process.env.PATH = `${firstExecutableDirectory}${path.delimiter}${previousIdentityPath ?? ''}`;
    const health = await probeGitHubCopilotCliCapability({
      executable: 'copilot',
      runProcess: async (_command, commandArgs) => ({
        outcome: 'success',
        elapsedMs: 1,
        stdout: commandArgs.includes('--help')
          ? 'GitHub Copilot CLI help'
          : [
            JSON.stringify({ type: 'session.start', data: { sessionId } }),
            JSON.stringify({ type: 'assistant.turn_start', data: { turnId: 'turn-1' } }),
            JSON.stringify({ type: 'assistant.message', data: { content: 'GHCP_CAPABILITY_OK' } }),
            JSON.stringify({ type: 'assistant.turn_end', data: { turnId: 'turn-1' } }),
          ].join('\n'),
      }),
    });
    assert.equal(health.resolvedCommand, firstExecutable, 'health records the immutable resolved executable identity');

    process.env.PATH = `${secondExecutableDirectory}${path.delimiter}${previousIdentityPath ?? ''}`;
    const identityRunner = new CliAgentRunner({
      spawn: (executable, commandArgs, options) => {
        identityExecutionCommand = executable;
        return spawnProcess(process.execPath, [fakeCliPath, ...commandArgs], options as any);
      },
      processControllerOptions: { graceMs: 20, cleanupWaitMs: 200 },
    });
    await identityRunner.run({
      provider: 'copilot',
      jobId: 'copilot-resolved-identity',
      prompt: 'prove one resolved executable identity',
      workspace: root,
      mode: 'workspace-write',
      timeoutMs: 1_000,
    });
    assert.equal(
      identityExecutionCommand,
      health.resolvedCommand,
      'execution must use the same immutable resolved executable identity as health after PATH changes',
    );
  } finally {
    if (previousIdentityBin === undefined) delete process.env.GHCP_BIN;
    else process.env.GHCP_BIN = previousIdentityBin;
    if (previousIdentityScript === undefined) delete process.env.GHCP_SCRIPT;
    else process.env.GHCP_SCRIPT = previousIdentityScript;
    if (previousIdentityPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousIdentityPath;
  }

  const previousGhcpBin = process.env.GHCP_BIN;
  const previousGhcpScript = process.env.GHCP_SCRIPT;
  const previousApprovedTokenValues = Object.fromEntries(
    Object.keys(approvedTokenValues).map((key) => [key, process.env[key]]),
  ) as Record<keyof typeof approvedTokenValues, string | undefined>;
  const previousUnrelatedSecretValues = Object.fromEntries(
    Object.keys(unrelatedSecretValues).map((key) => [key, process.env[key]]),
  ) as Record<keyof typeof unrelatedSecretValues, string | undefined>;
  let requestedCommand: { executable: string; args: string[] } | undefined;
  try {
    process.env.GHCP_BIN = '/opt/copilot';
    process.env.GHCP_SCRIPT = 'node';
    for (const [key, value] of Object.entries(approvedTokenValues)) process.env[key] = value;
    for (const [key, value] of Object.entries(unrelatedSecretValues)) process.env[key] = value;
    const environmentRunner = new CliAgentRunner({
      resolveGhcpExecutable: async (command) => ({ state: 'resolved', command }),
      spawn: (executable, commandArgs, options) => {
        requestedCommand = { executable, args: [...commandArgs] };
        return spawnProcess(process.execPath, [fakeCliPath, ...commandArgs.slice(1)], options as any);
      },
      processControllerOptions: { graceMs: 20, cleanupWaitMs: 200 },
    });
    await environmentRunner.run({
      provider: 'copilot',
      jobId: 'copilot-environment-command',
      prompt: 'inspect with the configured GHCP command',
      workspace: root,
      mode: 'workspace-write',
      timeoutMs: 1_000,
    });
    assert.deepEqual(JSON.parse(await fs.readFile(environmentProbePath, 'utf8')), {
      ci: '1',
      pathPresent: true,
      approvedTokenKeys: Object.keys(approvedTokenValues),
      approvedTokenMatches: Object.fromEntries(Object.keys(approvedTokenValues).map((key) => [key, true])),
      unrelatedSecretKeys: [],
    }, 'Copilot receives only the explicitly approved token keys and preserves CI/PATH');
    assert.deepEqual(requestedCommand, {
      executable: '/opt/copilot',
      args: [
        'node',
        '--prompt',
        'inspect with the configured GHCP command',
        '--output-format',
        'json',
        '--stream',
        'off',
        '--no-color',
        '--no-auto-update',
        '--no-ask-user',
        '--allow-tool=read,write',
        '--secret-env-vars=COPILOT_GITHUB_TOKEN,GH_TOKEN,GITHUB_TOKEN',
      ],
    }, 'GHCP_BIN and GHCP_SCRIPT must prefix the official Copilot execution args');
  } finally {
    if (previousGhcpBin === undefined) delete process.env.GHCP_BIN;
    else process.env.GHCP_BIN = previousGhcpBin;
    if (previousGhcpScript === undefined) delete process.env.GHCP_SCRIPT;
    else process.env.GHCP_SCRIPT = previousGhcpScript;
    for (const [key, value] of Object.entries(previousApprovedTokenValues)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    for (const [key, value] of Object.entries(previousUnrelatedSecretValues)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  const codexEvents: CliAgentLifecycleEvent[] = [];
  const codexResult = await runner.run({
    provider: 'codex',
    jobId: 'codex-success',
    prompt: 'inspect the repository with Codex',
    workspace: root,
    mode: 'workspace-write',
    timeoutMs: 1_000,
    onEvent: (event) => { codexEvents.push(event); },
  });
  assert.deepEqual(codexResult, {
    provider: 'codex',
    sessionId,
    finalResult: 'CODEX_FINAL',
    eventCount: 4,
  });
  assert.deepEqual(codexEvents.map((event) => event.type), [
    'session.started',
    'turn.started',
    'agent.message',
    'turn.completed',
  ]);
  const codexArgs = JSON.parse(await fs.readFile(argvPath, 'utf8')) as string[];
  assert.deepEqual(codexArgs.slice(0, 4), ['exec', '--json', '--sandbox', 'workspace-write']);

  const codexProgressResult = await runner.run({
    provider: 'codex',
    jobId: 'codex-progress',
    prompt: 'CASE:progress',
    workspace: root,
    mode: 'workspace-write',
    timeoutMs: 1_000,
  });
  assert.equal(codexProgressResult.finalResult, 'CODEX_FINAL', 'the final non-empty agent_message is the result');

  for (const provider of ['codex', 'copilot'] as const) {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      () => runner.run({
        provider,
        jobId: `${provider}-pre-cancelled`,
        prompt: 'must not complete after caller cancellation',
        workspace: root,
        mode: 'workspace-write',
        timeoutMs: 1_000,
        signal: controller.signal,
      }),
      /cancel|취소/iu,
      `${provider} honors an already-aborted caller signal`,
    );
  }

  for (const provider of ['codex', 'copilot'] as const) {
    await assert.rejects(
      () => runner.run({
        provider,
        jobId: `${provider}-empty`,
        prompt: 'CASE:empty',
        workspace: root,
        mode: 'workspace-write',
        timeoutMs: 1_000,
      }),
      /non-empty|agent.message|final/iu,
      `${provider} rejects an empty terminal result`,
    );

    const timeoutStartedAt = Date.now();
    await assert.rejects(
      () => runner.run({
        provider,
        jobId: `${provider}-timeout`,
        prompt: 'CASE:slow',
        workspace: root,
        mode: 'workspace-write',
        timeoutMs: 100,
      }),
      /time limit|시간 제한/iu,
      `${provider} execution is bounded`,
    );
    assert.ok(Date.now() - timeoutStartedAt < 2_000, `${provider} timeout settles promptly`);

    const activeController = new AbortController();
    await assert.rejects(
      () => runner.run({
        provider,
        jobId: `${provider}-active-cancel`,
        prompt: 'CASE:slow',
        workspace: root,
        mode: 'workspace-write',
        timeoutMs: 1_000,
        signal: activeController.signal,
        onEvent: (event) => {
          if (event.type === 'session.started') activeController.abort();
        },
      }),
      /cancel|취소/iu,
      `${provider} cancels an active process tree`,
    );
    assert.equal(runner.cancel(`${provider}-active-cancel`), false, 'cancelled jobs are removed from the active map');
  }

  await assert.rejects(
    () => runner.run({
      provider: 'copilot',
      jobId: 'copilot-redaction',
      prompt: 'CASE:redaction',
      workspace: root,
      mode: 'workspace-write',
      timeoutMs: 1_000,
    }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /<redacted>/u);
      assert.doesNotMatch(message, /secret-token|ABCD-EFGH/u);
      assert.doesNotMatch(message, new RegExp(root.replace(/[.*+?^\${}()|[\]\\]/gu, '\\$&'), 'u'));
      return true;
    },
  );

  await assert.rejects(
    () => runner.run({
      provider: 'codex',
      jobId: 'codex-redaction',
      prompt: 'CASE:redaction',
      workspace: root,
      mode: 'workspace-write',
      timeoutMs: 1_000,
    }),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /<redacted>/u);
      assert.doesNotMatch(message, /secret-token|ABCD-EFGH/u);
      assert.doesNotMatch(message, new RegExp(root.replace(/[.*+?^\${}()|[\]\\]/gu, '\\$&'), 'u'));
      return true;
    },
  );

  for (const [jobId, prompt] of [
    ['copilot-auth-stderr', 'CASE:auth-stderr'],
    ['copilot-auth-session-error', 'CASE:auth-session-error'],
  ] as const) {
    await assert.rejects(
      () => runner.run({
        provider: 'copilot',
        jobId,
        prompt,
        workspace: root,
        mode: 'workspace-write',
        timeoutMs: 1_000,
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, 'CopilotCliAuthRequiredError');
        assert.equal((error as Error & { code?: unknown }).code, 'COPILOT_AUTH_REQUIRED');
        assert.equal((error as Error & { type?: unknown }).type, 'auth-required');
        assert.match(error.message, /<redacted>/u);
        assert.doesNotMatch(error.message, /secret-token/u);
        assert.doesNotMatch(error.message, new RegExp(root.replace(/[.*+?^\${}()|[\]\\]/gu, '\\$&'), 'u'));
        return true;
      },
      `${jobId} is classified as stable auth-required instead of a generic provider failure`,
    );
    assert.equal(runner.cancel(jobId), false, `${jobId} is cleaned up after auth-required failure`);
  }

  console.log('PASS: provider-neutral CLI runner selects independent Codex and official Copilot JSONL adapters');
} finally {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}
