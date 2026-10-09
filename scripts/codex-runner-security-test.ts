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
import { CodexRunner, type CodexRunEvent, type CodexRunResult } from '../src/server/codex-runner.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-codex-runner-security-'));
const projectionRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-codex-projection-'));
const fakeCodexPath = path.join(projectionRoot, 'fake-codex.mjs');
const homePath = path.join(root, 'home');
const threadId = '019fd700-51cd-7862-a4ef-74ccae0f2b4e';
const attachmentGrandchildPidPath = path.join(root, 'attachment-grandchild.pid');

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
const fakeSource = `#!${process.execPath}
const caseName = process.argv.at(-1)?.match(/CASE:([a-z0-9-]+)/i)?.[1] ?? 'success';
const threadId = ${JSON.stringify(threadId)};
const thread = () => console.log(JSON.stringify({ type: 'thread.started', thread_id: threadId }));
const prefix = () => {
  thread();
  console.log(JSON.stringify({ type: 'turn.started' }));
};
const message = (text) => console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text } }));
const errorItem = (message, extra = {}) => console.log(JSON.stringify({
  type: 'item.completed',
  item: { type: 'error', message },
  ...extra,
}));
const completed = () => console.log(JSON.stringify({ type: 'turn.completed' }));
const todo = (type, id = 'plan-1', extra = {}) => console.log(JSON.stringify({
  type,
  item: { id, type: 'todo_list', items: [{ text: 'Synthetic inspection', completed: type !== 'item.started' }], ...extra },
}));
if (caseName === 'command-terminal') {
  prefix();
  const item = {id:'item_1',type:'command_execution',command:'cat synthetic.txt',status:'in_progress',aggregated_output:'',exit_code:null};
  console.log(JSON.stringify({type:'item.started',item}));
  console.log(JSON.stringify({type:'item.completed',item:{...item,status:'failed',exit_code:17,aggregated_output:'values17,25 sum42 password=secret-fixture /Users/synthetic/private.txt'}}));
  message('MODEL_CLAIM exit_code=0'); completed();
} else if (caseName === 'todo-updates') {
  prefix();
  todo('item.started');
  todo('item.updated', 'plan-1', { text: 'PARTIAL_MUST_NOT_BECOME_RESULT' });
  todo('item.updated', 'plan-1', { text: 'PARTIAL_MUST_NOT_BECOME_RESULT' });
  message('FINAL_AFTER_TODO_UPDATES');
  todo('item.completed');
  console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 12, cached_input_tokens: 3, output_tokens: 4, reasoning_output_tokens: 1 } }));
} else if (caseName === 'todo-updates-between-messages') {
  prefix(); todo('item.started'); message('EARLY_PROGRESS');
  todo('item.updated'); message('FINAL_AFTER_PROGRESS'); todo('item.completed'); completed();
} else if (caseName === 'todo-only-update') {
  prefix(); todo('item.started'); todo('item.updated', 'plan-1', { text: 'NOT_A_FINAL_MESSAGE' }); todo('item.completed'); completed();
} else if (caseName === 'todo-update-before-turn') {
  thread(); todo('item.updated');
} else if (caseName === 'todo-update-before-start') {
  prefix(); todo('item.updated');
} else if (caseName === 'todo-update-wrong-id') {
  prefix(); todo('item.started'); todo('item.updated', 'different-plan');
} else if (caseName === 'todo-update-after-completed') {
  prefix(); todo('item.started'); todo('item.completed'); todo('item.updated');
} else if (caseName === 'todo-update-invalid-payload') {
  prefix(); todo('item.started'); todo('item.updated', 'plan-1', { items: [{ text: 'Synthetic inspection', completed: 'true' }] });
} else if (caseName === 'todo-update-missing-id') {
  prefix(); todo('item.started'); todo('item.updated', undefined, { id: undefined });
} else if (caseName === 'todo-complete-before-start') {
  prefix(); todo('item.completed');
} else if (caseName === 'todo-repeat-start') {
  prefix(); todo('item.started'); todo('item.started');
} else if (caseName === 'todo-repeat-completion') {
  prefix(); todo('item.started'); todo('item.completed'); todo('item.completed');
} else if (caseName === 'todo-open-at-terminal') {
  prefix(); todo('item.started'); message('one'); completed();
} else if (caseName === 'todo-reopen-same-id' || caseName === 'todo-reopen-new-id') {
  const nextId = caseName === 'todo-reopen-same-id' ? 'plan-1' : 'plan-2';
  prefix(); todo('item.started'); todo('item.completed'); todo('item.started', nextId);
  message('PLAN_MUST_NOT_REOPEN'); todo('item.completed', nextId); completed();
} else if (caseName === 'todo-empty') {
  prefix(); todo('item.started', 'plan-1', { items: [] });
  message('EMPTY_PLAN_FINAL'); todo('item.completed', 'plan-1', { items: [] }); completed();
} else if (caseName === 'updated-agent-message') {
  prefix(); console.log(JSON.stringify({ type: 'item.updated', item: { id: 'message-1', type: 'agent_message', text: 'PARTIAL_MESSAGE' } }));
} else if (caseName === 'updated-error') {
  prefix(); console.log(JSON.stringify({ type: 'item.updated', item: { id: 'error-1', type: 'error', message: 'partial error cannot bypass failure handling' } }));
} else if (caseName === 'unknown-event') {
  prefix(); console.log(JSON.stringify({ type: 'item.invented', item: { type: 'todo_list' } }));
} else if (caseName === 'post-terminal-update') {
  prefix(); todo('item.started'); message('one'); todo('item.completed'); completed(); todo('item.updated');
} else if (caseName === 'todo-then-failure') {
  prefix(); todo('item.started'); todo('item.updated'); message('before failure');
  console.log(JSON.stringify({ type: 'turn.failed', error: { message: 'synthetic failure after update' } }));
} else if (caseName === 'malformed') {
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
} else if (caseName === 'pre-thread-item-error') {
  errorItem('must not precede thread.started');
} else if (caseName === 'active-turn-item-error') {
  prefix();
  errorItem('must not be tolerated inside an active turn');
} else if (caseName === 'pre-turn-top-level-error') {
  thread();
  errorItem('must not hide a terminal top-level error', { error: { message: 'terminal' } });
} else if (caseName === 'excessive-pre-turn-errors') {
  thread();
  for (let index = 0; index < 2; index += 1) errorItem('bounded optional-provider diagnostic ' + index);
} else if (caseName === 'recoverable-pre-turn-error') {
  thread();
  errorItem('optional MCP bootstrap failed; Codex continued without it');
  console.log(JSON.stringify({ type: 'turn.started' }));
  message('RECOVERED_AFTER_OPTIONAL_MCP_ERROR');
  console.log(JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: 12, cached_input_tokens: 3, output_tokens: 4, reasoning_output_tokens: 1 },
  }));
} else if (caseName === 'malformed-usage') {
  prefix();
  message('COMPLETED_WITH_UNAVAILABLE_USAGE');
  console.log(JSON.stringify({
    type: 'turn.completed',
    usage: { input_tokens: -1, cached_input_tokens: 3, output_tokens: 4, reasoning_output_tokens: 1 },
  }));
} else {
  prefix(); message('SECURITY_FAKE_OK'); completed();
}
`;

const attachmentTreeSource = `
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const grandchild = spawn(process.execPath, [
  '-e',
  "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
], { stdio: 'ignore' });
fs.writeFileSync(${JSON.stringify(attachmentGrandchildPidPath)}, String(grandchild.pid));
setInterval(() => {}, 1000);
`;

const baseEnvironment: Record<string, string | undefined> = {
  CODEX_BIN: fakeCodexPath,
  CODEX_SCRIPT: undefined,
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

async function runCase(caseName: string, onEvent?: (event: CodexRunEvent) => Promise<void> | void, timeoutMs?: number): Promise<CodexRunResult> {
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

async function childClosedWithin(child: ReturnType<typeof spawnChild>, timeoutMs = 500): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (closed: boolean): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      child.removeListener('close', onClose);
      child.removeListener('error', onError);
      resolve(closed);
    };
    const onClose = (): void => finish(true);
    const onError = (): void => finish(true);
    child.once('close', onClose);
    child.once('error', onError);
    timer = setTimeout(() => finish(false), timeoutMs);
  });
}

async function waitForPidFile(filePath: string, timeoutMs = 1_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const pid = Number((await fs.readFile(filePath, 'utf8')).trim());
      if (Number.isSafeInteger(pid) && pid > 0) return pid;
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`attachment fixture did not publish a grandchild PID within ${timeoutMs}ms`);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EPERM');
  }
}

async function processExitedWithin(pid: number, timeoutMs = 1_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return !isProcessAlive(pid);
}

function killProcess(pid: number | undefined): void {
  if (!pid || !isProcessAlive(pid)) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // The process may exit between the liveness check and cleanup.
  }
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
  ['pre-thread-item-error', /terminal|failure|protocol/i],
  ['active-turn-item-error', /terminal|failure|protocol/i],
  ['pre-turn-top-level-error', /terminal|failure|protocol/i],
  ['excessive-pre-turn-errors', /terminal|failure|protocol/i],
  ['todo-only-update', /agent.message|terminal|protocol/i],
  ['todo-update-before-turn', /ordering|protocol/i],
  ['todo-update-before-start', /todo|ordering|protocol/i],
  ['todo-update-wrong-id', /todo|ordering|protocol/i],
  ['todo-update-after-completed', /todo|ordering|protocol/i],
  ['todo-update-invalid-payload', /todo|invalid|protocol/i],
  ['todo-update-missing-id', /todo|invalid|protocol/i],
  ['todo-complete-before-start', /todo|ordering|protocol/i],
  ['todo-repeat-start', /todo|ordering|protocol/i],
  ['todo-repeat-completion', /todo|ordering|protocol/i],
  ['todo-open-at-terminal', /todo|terminal|protocol/i],
  ['todo-reopen-same-id', /todo|ordering|protocol/i],
  ['todo-reopen-new-id', /todo|ordering|protocol/i],
  ['updated-agent-message', /updated|protocol/i],
  ['updated-error', /updated|protocol/i],
  ['unknown-event', /unsupported JSONL event/i],
  ['post-terminal-update', /after turn.completed/i],
  ['todo-then-failure', /terminal|failure|protocol/i],
];

let attachmentChild: ReturnType<typeof spawnChild> | undefined;
let attachmentGrandchildPid: number | undefined;

try {
  await fs.mkdir(path.join(projectionRoot, '.isolated-home', '.codex'), { recursive: true });
  await fs.mkdir(homePath, { recursive: true });
  await fs.writeFile(fakeCodexPath, fakeSource, { mode: 0o700 });

  const events: string[] = [];
  const result = await runCase('success', (event) => { events.push(event.type ?? ''); });
  assert.equal(result.finalMessage, 'SECURITY_FAKE_OK');
  assert.equal(result.executionReceipt?.platform, process.platform, 'receipt observes the real process host');
  assert.equal(result.executionReceipt?.source, 'worker-observation');
  assert.equal(result.executionReceipt?.model, undefined, 'requested model is not observed model evidence');
  assert.equal(result.executionReceipt?.reasoningEffort, undefined, 'requested reasoning is not observed effort evidence');
  assert.deepEqual(events, ['thread.started', 'turn.started', 'item.completed', 'turn.completed'], 'callbacks preserve FSM order');
  assert.equal(result.eventCount, 4);

  const commandEvents:CodexRunEvent[]=[];
  const commandResult=await runCase('command-terminal',event=>{commandEvents.push(event);});
  const commandEnd:any=commandEvents.find(e=>e.type==='item.completed'&&e.item?.type==='command_execution')?.item;
  assert.equal(commandEnd?.exit_code,17,'runner callback retains actual structured exit rather than model-written zero');
  assert.equal(commandEnd?.id,'item_1');assert.equal(commandEnd?.status,'failed');
  assert.match(commandEnd.aggregated_output,/values17,25 sum42/);
  assert.doesNotMatch(commandEnd.aggregated_output,/secret-fixture|Users\/synthetic|private\.txt/,'callback output is already masked');
  assert.equal(commandResult.finalMessage,'MODEL_CLAIM exit_code=0');

  const todoEvents: CodexRunEvent[] = [];
  const todoResult = await runCase('todo-updates', (event) => { todoEvents.push(event); });
  assert.equal(todoResult.finalMessage, 'FINAL_AFTER_TODO_UPDATES', 'partial todo updates never become the final answer');
  assert.deepEqual(todoEvents.map((event) => event.type), [
    'thread.started', 'turn.started', 'item.started', 'item.updated', 'item.completed', 'item.completed', 'turn.completed',
  ], 'duplicate partial updates do not enqueue a second callback or synthesize another final message');
  assert.equal(todoEvents.filter((event) => event.type === 'item.completed' && event.item?.type === 'agent_message').length, 1);
  assert.equal(todoEvents.filter((event) => event.type === 'turn.completed').length, 1);
  assert.equal(todoResult.eventCount, 8);
  assert.deepEqual(todoResult.tokenUsage, {
    source: 'codex.exec.jsonl.turn.completed.usage', inputTokens: 12, cachedInputTokens: 3, outputTokens: 4, reasoningOutputTokens: 1,
  }, 'only terminal usage contributes to the final run result');
  const todoProgressResult = await runCase('todo-updates-between-messages');
  assert.equal(todoProgressResult.finalMessage, 'FINAL_AFTER_PROGRESS', 'a plan update after a progress message does not replace the later final answer');
  assert.equal((await runCase('todo-empty')).finalMessage, 'EMPTY_PLAN_FINAL', 'an empty official plan is valid and still needs a final agent message');

  const redactedResult = await runCase('secret-result');
  assert.equal(redactedResult.finalMessage.includes('codex-runner-secret-fixture'), false, 'credential-shaped success output must not enter durable result sinks');
  assert.match(redactedResult.finalMessage, /REDACTED/u);

  const recoveredEvents: string[] = [];
  const recovered = await runCase('recoverable-pre-turn-error', (event) => {
    recoveredEvents.push(`${event.type}:${event.item?.type ?? ''}`);
  });
  assert.equal(recovered.finalMessage, 'RECOVERED_AFTER_OPTIONAL_MCP_ERROR');
  assert.equal(recovered.eventCount, 5);
  assert.deepEqual(recovered.tokenUsage, {
    source: 'codex.exec.jsonl.turn.completed.usage',
    inputTokens: 12,
    cachedInputTokens: 3,
    outputTokens: 4,
    reasoningOutputTokens: 1,
  }, 'documented turn.completed usage is normalized into the bounded run result');
  assert.deepEqual(recoveredEvents, [
    'thread.started:',
    'item.completed:error',
    'turn.started:',
    'item.completed:agent_message',
    'turn.completed:',
  ], 'a bounded pre-turn optional-provider diagnostic remains observable without replacing the terminal result');

  const malformedUsage = await runCase('malformed-usage');
  assert.equal(malformedUsage.finalMessage, 'COMPLETED_WITH_UNAVAILABLE_USAGE');
  assert.equal(malformedUsage.tokenUsage, undefined, 'malformed token counters never become trusted usage or fail a valid result');

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

  const attachmentFailureRunner = new CodexRunner({
    platform: 'linux',
    processControllerOptions: { graceMs: 20, cleanupWaitMs: 200, retryDelayMs: 10, maxAttempts: 20 },
    processControllerProvider: {
      preflight: () => undefined,
      attach: async () => {
        attachmentGrandchildPid = await waitForPidFile(attachmentGrandchildPidPath);
        throw new Error('controller attachment failed');
      },
    },
    spawn: (_command, _args, options) => {
      attachmentChild = spawnChild(process.execPath, ['-e', attachmentTreeSource], options as any);
      return attachmentChild;
    },
  });
  await assert.rejects(
    () => attachmentFailureRunner.run({
      jobId: 'controller-attachment-failure',
      prompt: 'attachment must fail closed',
      workspace: projectionRoot,
      mode: 'workspace-write',
    }),
    /controller attachment failed/iu,
    'controller attachment errors are returned after cleanup begins',
  );
  assert.ok(attachmentChild, 'the attachment regression must spawn a child');
  assert.equal(await childClosedWithin(attachmentChild), true, 'a child is reaped when controller attachment throws');
  assert.ok(attachmentGrandchildPid, 'the attachment regression must spawn a real grandchild');
  assert.equal(
    await processExitedWithin(attachmentGrandchildPid),
    true,
    'process-tree cleanup reaps a grandchild after controller attachment fails',
  );

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
  if (attachmentChild && attachmentChild.exitCode === null && attachmentChild.signalCode === null) {
    attachmentChild.kill('SIGKILL');
    await childClosedWithin(attachmentChild);
  }
  killProcess(attachmentGrandchildPid);
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  await fs.rm(projectionRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}
