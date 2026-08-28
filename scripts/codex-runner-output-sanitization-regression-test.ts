import assert from 'node:assert/strict';
import { spawn as spawnChild } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  AgentIsolationProvider,
  type AgentIsolationAcquireInput,
} from '../src/server/agent-execution-policy.js';
import { CodexRunner, type CodexRunEvent } from '../src/server/codex-runner.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-codex-output-sanitization-'));
const workspace = path.join(root, 'workspace');
const fakeCodexPath = path.join(root, 'fake-codex.mjs');
const isolatedHome = path.join(root, 'isolated-home');
const protectedRoot = path.join(root, 'protected');
const threadId = '019fd700-51cd-7862-a4ef-74ccae0f2b4e';

const canaries = [
  'nested-opaque-canary-72ef57c8',
  'url-command-canary-26ec8ef2',
  'bearer-message-canary-63cbdca1',
  'result-token-canary-f53c4d69',
  'result-url-canary-339e41a0',
  'stderr-url-canary-8ac09fc0',
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcm9ncmVzcyJ9.signaturecanary',
] as const;

class TestIsolationProvider extends AgentIsolationProvider {
  constructor() {
    super('output-sanitization-test-provider');
  }

  async acquire(input: AgentIsolationAcquireInput) {
    await this.validateRequest(input);
    return this.issueLease({
      subject: input.subject,
      workspace: input.workspace,
      protectedRoots: input.protectedRoots,
      environmentOverrides: input.environmentOverrides,
      spawn: (command, args, options) => spawnChild(command, [...args], options as never),
    });
  }
}

const fakeSource = `
const caseName = process.argv.at(-1)?.match(/CASE:([a-z0-9-]+)/i)?.[1] ?? 'success';
const emit = (event) => console.log(JSON.stringify(event));
if (caseName === 'stderr') {
  console.error('request failed: https://service.test/callback?access_token=stderr-url-canary-8ac09fc0');
  console.error('raw jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcm9ncmVzcyJ9.signaturecanary');
  process.exit(9);
}
emit({
  type: 'thread.started',
  thread_id: ${JSON.stringify(threadId)},
  nested: { stderr: 'nested-opaque-canary-72ef57c8' },
});
emit({ type: 'turn.started', unknown: ['nested-opaque-canary-72ef57c8'] });
emit({
  type: 'item.started',
  item: {
    type: 'command_execution',
    command: 'curl https://service.test/run?access_token=url-command-canary-26ec8ef2',
    message: 'Authorization: Bearer bearer-message-canary-63cbdca1',
    nested: { token: 'nested-opaque-canary-72ef57c8' },
  },
  stderr: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcm9ncmVzcyJ9.signaturecanary',
});
emit({
  type: 'item.completed',
  item: {
    type: 'agent_message',
    text: 'SAFE_RESULT access_token=result-token-canary-f53c4d69 https://service.test/result?token=result-url-canary-339e41a0 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcm9ncmVzcyJ9.signaturecanary',
    nested: [{ stderr: 'nested-opaque-canary-72ef57c8' }],
  },
  unknown: { deeply: { secret: 'nested-opaque-canary-72ef57c8' } },
});
emit({ type: 'turn.completed', unknown: 'nested-opaque-canary-72ef57c8' });
`;

const provider = new TestIsolationProvider();
const runner = new CodexRunner({ processControllerOptions: { graceMs: 20, cleanupWaitMs: 200 } });

function assertNoCanary(value: unknown, sink: string): void {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const canary of canaries) {
    assert.equal(serialized.includes(canary), false, `${sink} received credential canary`);
  }
}

function assertKeys(value: object, expected: readonly string[], sink: string): void {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${sink} must use the closed event schema`);
}

async function runCase(caseName: string, onEvent?: (event: CodexRunEvent) => void) {
  const jobId = `output-sanitization-${caseName}`;
  const prompt = `CASE:${caseName}`;
  const subject = {
    tenantId: 'security-tenant',
    requesterId: 'security-requester',
    conversationId: 'security-conversation',
    jobId,
  };
  const lease = await provider.acquire({
    subject,
    sourceWorkspace: workspace,
    workspace,
    protectedRoots: [protectedRoot],
    environmentOverrides: {
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
      CODEX_HOME: path.join(isolatedHome, '.codex'),
    },
    prompt,
  });
  return runner.run({
    jobId,
    prompt,
    workspace,
    mode: 'read-only',
    isolationLease: lease,
    subject,
    timeoutMs: 1_000,
    environmentOverrides: {
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
      CODEX_HOME: path.join(isolatedHome, '.codex'),
    },
    onEvent,
  });
}

const previousEnvironment = {
  CODEX_BIN: process.env.CODEX_BIN,
  CODEX_SCRIPT: process.env.CODEX_SCRIPT,
  PATH: process.env.PATH,
};

try {
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(path.join(isolatedHome, '.codex'), { recursive: true });
  await fs.mkdir(protectedRoot, { recursive: true });
  await fs.writeFile(fakeCodexPath, fakeSource, { mode: 0o700 });
  process.env.CODEX_BIN = process.execPath;
  process.env.CODEX_SCRIPT = fakeCodexPath;
  process.env.PATH = '/usr/bin:/bin';

  const callbackEvents: CodexRunEvent[] = [];
  const progressInputs: string[] = [];
  const persistedJobInputs: string[] = [];
  const result = await runCase('success', (event) => {
    callbackEvents.push(event);
    const serialized = JSON.stringify(event);
    progressInputs.push(serialized);
    persistedJobInputs.push(serialized);
  });

  assert.equal(result.finalMessage.startsWith('SAFE_RESULT'), true, 'ordinary result text must survive');
  assert.match(result.finalMessage, /REDACTED/u, 'credential-shaped result text must be redacted');
  assertNoCanary(result.finalMessage, 'final result');
  assertNoCanary(callbackEvents, 'event callback');
  assertNoCanary(progressInputs, 'progress input');
  assertNoCanary(persistedJobInputs, 'persisted job input');

  assert.equal(callbackEvents.length, 5);
  assertKeys(callbackEvents[0]!, ['type', 'thread_id'], 'thread.started');
  assertKeys(callbackEvents[1]!, ['type'], 'turn.started');
  assertKeys(callbackEvents[2]!, ['type', 'item'], 'item.started');
  assertKeys(callbackEvents[2]!.item!, ['type', 'command', 'message'], 'item.started.item');
  assertKeys(callbackEvents[3]!, ['type', 'item'], 'item.completed');
  assertKeys(callbackEvents[3]!.item!, ['type', 'text'], 'item.completed.item');
  assertKeys(callbackEvents[4]!, ['type'], 'turn.completed');

  let stderrError: Error | undefined;
  try {
    await runCase('stderr');
  } catch (error) {
    stderrError = error instanceof Error ? error : new Error(String(error));
  }
  assert.ok(stderrError, 'nonzero stderr case must fail');
  assertNoCanary(stderrError.message, 'stderr diagnostic');
  assert.match(stderrError.message, /REDACTED|redacted/u, 'stderr credentials must be replaced');

  console.log('PASS: CodexRunner exposes only closed-schema, recursively redacted JSONL events and diagnostics');
} finally {
  if (previousEnvironment.CODEX_BIN === undefined) delete process.env.CODEX_BIN;
  else process.env.CODEX_BIN = previousEnvironment.CODEX_BIN;
  if (previousEnvironment.CODEX_SCRIPT === undefined) delete process.env.CODEX_SCRIPT;
  else process.env.CODEX_SCRIPT = previousEnvironment.CODEX_SCRIPT;
  if (previousEnvironment.PATH === undefined) delete process.env.PATH;
  else process.env.PATH = previousEnvironment.PATH;
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}
