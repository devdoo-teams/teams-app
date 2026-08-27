import assert from 'node:assert/strict';
import { spawn as spawnChild } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  AgentExecutionUnavailableError,
  AgentIsolationProvider,
  type AgentIsolationAcquireInput,
} from '../src/server/agent-execution-policy.js';
import { CODEX_READ_ONLY_PERMISSION_ARGS } from '../src/server/codex-permission-profile-isolation-provider.js';
import { CodexRunner, type CodexRunEvent } from '../src/server/codex-runner.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-codex-runner-security-'));
const projectionRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-codex-projection-'));
const fakeCodexPath = path.join(projectionRoot, 'fake-codex.mjs');
const homePath = path.join(root, 'home');
const threadId = '019fd700-51cd-7862-a4ef-74ccae0f2b4e';

class TestIsolationProvider extends AgentIsolationProvider {
  constructor() {
    super('runner-test-provider');
  }

  async acquire(input: AgentIsolationAcquireInput) {
    await this.validateRequest(input);
    return this.issueLease({
      subject: input.subject,
      workspace: input.workspace,
      protectedRoots: input.protectedRoots,
      environmentOverrides: input.environmentOverrides,
      spawn: (command, args, options) => {
        assert.equal(args.includes('--sandbox'), false, 'CodexRunner must not select the legacy sandbox path');
        for (const required of CODEX_READ_ONLY_PERMISSION_ARGS) {
          assert.ok(args.includes(required), `CodexRunner omitted native permission argument: ${required}`);
        }
        return spawnChild(command, [...args], options as any);
      },
    });
  }
}

const provider = new TestIsolationProvider();
const fakeSource = `
const caseName = process.argv.at(-1)?.match(/CASE:([a-z0-9-]+)/i)?.[1] ?? 'success';
const threadId = ${JSON.stringify(threadId)};
const prefix = () => {
  console.log(JSON.stringify({ type: 'thread.started', thread_id: threadId }));
  console.log(JSON.stringify({ type: 'turn.started' }));
};
const message = (text) => console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }));
const completed = () => console.log(JSON.stringify({ type: 'turn.completed' }));
if (caseName === 'malformed') {
  process.stdout.write('not-json\\n');
} else if (caseName === 'non-object') {
  process.stdout.write('[]\\n');
} else if (caseName === 'missing-terminal') {
  prefix();
} else if (caseName === 'message-then-failure') {
  prefix(); message('before failure'); console.log(JSON.stringify({ type: 'turn.failed', error: { message: 'synthetic failure' } }));
} else if (caseName === 'message-then-error') {
  prefix(); message('before error'); console.log(JSON.stringify({ type: 'error', error: { message: 'synthetic error' } }));
} else if (caseName === 'terminal-before-message') {
  prefix(); completed();
} else if (caseName === 'duplicate-terminal') {
  prefix(); message('one'); completed(); completed();
} else if (caseName === 'conflicting-terminal') {
  prefix(); message('one'); completed(); console.log(JSON.stringify({ type: 'turn.failed' }));
} else if (caseName === 'post-terminal-item') {
  prefix(); message('one'); completed(); console.log(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution' } }));
} else if (caseName === 'duplicate-message') {
  prefix(); message('one'); message('two'); completed();
} else if (caseName === 'nonzero') {
  prefix(); message('one'); completed(); process.exit(7);
} else if (caseName === 'signal') {
  prefix(); message('one'); completed(); process.kill(process.pid, 'SIGTERM');
} else if (caseName === 'timeout') {
  prefix();
  await new Promise(() => setInterval(() => {}, 1_000));
} else if (caseName === 'secret-result') {
  prefix(); message('access_token=codex-runner-secret-fixture'); completed();
} else {
  prefix(); message('SECURITY_FAKE_OK'); completed();
}
`;

const baseEnvironment: Record<string, string> = {
  CODEX_BIN: process.execPath,
  CODEX_SCRIPT: fakeCodexPath,
  CODEX_TIMEOUT_MS: '1000',
  PATH: '/usr/bin:/bin',
  HOME: homePath,
  CLIENT_SECRET: 'secret-canary',
  OPENAI_API_KEY: 'secret-canary',
};

async function withEnvironment<T>(values: Record<string, string | undefined>, operation: () => Promise<T>): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await operation();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runCase(caseName: string, onEvent?: (event: CodexRunEvent) => Promise<void> | void, timeoutMs?: number): Promise<{ finalMessage: string; eventCount: number }> {
  const jobId = `job-${caseName}`;
  const prompt = `strict protocol CASE:${caseName}`;
  const subject = {
    tenantId: 'security-tenant',
    requesterId: 'security-requester',
    conversationId: 'security-conversation',
    jobId,
  };
  const isolationLease = await provider.acquire({
    subject,
    sourceWorkspace: root,
    workspace: projectionRoot,
    protectedRoots: [root, homePath],
    environmentOverrides: {
      HOME: path.join(projectionRoot, '.isolated-home'),
      USERPROFILE: path.join(projectionRoot, '.isolated-home'),
      CODEX_HOME: path.join(projectionRoot, '.isolated-home', '.codex'),
    },
    prompt,
  });
  const runner = new CodexRunner({ processControllerOptions: { graceMs: 20, cleanupWaitMs: 200 } });
  return withEnvironment({
    ...baseEnvironment,
    ...(timeoutMs ? { CODEX_TIMEOUT_MS: String(timeoutMs) } : {}),
  }, () => runner.run({
    jobId,
    prompt,
    workspace: projectionRoot,
    mode: 'read-only',
    isolationLease,
    subject,
    environmentOverrides: {
      HOME: path.join(projectionRoot, '.isolated-home'),
      USERPROFILE: path.join(projectionRoot, '.isolated-home'),
      CODEX_HOME: path.join(projectionRoot, '.isolated-home', '.codex'),
    },
    onEvent,
  }));
}

const negativeCases: Array<[string, RegExp, number?]> = [
  ['malformed', /malformed|protocol/i],
  ['non-object', /object|protocol/i],
  ['missing-terminal', /final|terminal|protocol/i],
  ['message-then-failure', /terminal|failure|protocol/i],
  ['message-then-error', /terminal|error|protocol/i],
  ['terminal-before-message', /agent.message|terminal|protocol/i],
  ['duplicate-terminal', /terminal|protocol/i],
  ['conflicting-terminal', /terminal|protocol/i],
  ['post-terminal-item', /terminal|protocol/i],
  ['nonzero', /exited|code|signal|protocol/i],
  ['signal', /signal|protocol|terminated/i],
  ['timeout', /시간 제한|timeout/i, 100],
];

try {
  await fs.mkdir(path.join(projectionRoot, '.isolated-home', '.codex'), { recursive: true });
  await fs.mkdir(homePath, { recursive: true });
  await fs.writeFile(fakeCodexPath, fakeSource, { mode: 0o700 });

  const events: string[] = [];
  const result = await runCase('success', (event) => { events.push(event.type ?? ''); });
  assert.equal(result.finalMessage, 'SECURITY_FAKE_OK');
  assert.deepEqual(events, ['thread.started', 'turn.started', 'item.completed', 'turn.completed'], 'callbacks preserve FSM order');
  assert.equal(result.eventCount, 4);

  const redactedResult = await runCase('secret-result');
  assert.equal(redactedResult.finalMessage.includes('codex-runner-secret-fixture'), false, 'credential-shaped success output must not enter durable result sinks');
  assert.match(redactedResult.finalMessage, /REDACTED/u);

  for (const [caseName, expected, timeoutMs] of negativeCases) {
    await assert.rejects(() => runCase(caseName, undefined, timeoutMs), expected, `${caseName} must be rejected`);
  }

  const progressResult = await runCase('duplicate-message');
  assert.equal(progressResult.finalMessage, 'two', 'the final non-empty agent_message is the terminal result');
  assert.equal(progressResult.eventCount, 5);

  let spawnCount = 0;
  const cwdOnlyRunner = new CodexRunner({ spawn: () => { spawnCount += 1; throw new Error('spawn must not be reached'); } });
  await assert.rejects(
    () => withEnvironment(baseEnvironment, () => cwdOnlyRunner.run({
      jobId: 'cwd-only',
      prompt: 'cwd-only boundary',
      workspace: projectionRoot,
      mode: 'read-only',
    })),
    (error: unknown) => error instanceof AgentExecutionUnavailableError && error.code === 'UNAVAILABLE',
  );
  assert.equal(spawnCount, 0, 'cwd/assert-only isolation has spawn=0');

  await assert.rejects(
    () => provider.validateRequest({
      subject: { tenantId: 'security-tenant', requesterId: 'security-requester', conversationId: 'security-conversation' },
      sourceWorkspace: root,
      prompt: `inspect ${root}/secret.txt and ${os.homedir()}/token`,
    }),
    (error: unknown) => error instanceof AgentExecutionUnavailableError && error.code === 'UNAVAILABLE',
  );

  console.log('PASS: CodexRunner enforces provider-owned leases, final agent_message JSONL FSM, nonzero/signal rejection, callback ordering, and cwd-only fail-closed launch');
} finally {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  await fs.rm(projectionRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}
