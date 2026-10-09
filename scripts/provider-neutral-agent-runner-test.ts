import { strict as assert } from 'node:assert';

import type {
  CliAgentLifecycleEvent,
  CliAgentRunOptions,
  CliAgentRunResult,
} from '../src/server/cli-agent-runner.js';
import { CliAgentRunner } from '../src/server/cli-agent-runner.js';
import type { CodexRunEvent, CodexRunResult } from '../src/server/codex-runner.js';
import { ProviderNeutralAgentRunner } from '../src/server/provider-neutral-agent-runner.js';
import type { CoreExecutionReceipt } from '../src/shared/core-orchestration.js';

class FakeCliAgentRunner {
  runOptions: CliAgentRunOptions[] = [];
  cancelledJobIds: string[] = [];
  closeCalls = 0;
  loginCalls = 0;

  async run(options: CliAgentRunOptions): Promise<CliAgentRunResult> {
    this.runOptions.push(options);
    const tokenUsage = {
      source: 'codex.exec.jsonl.turn.completed.usage' as const,
      inputTokens: 21_460,
      cachedInputTokens: 21_248,
      outputTokens: 5,
      reasoningOutputTokens: 0,
    };
    const events: CliAgentLifecycleEvent[] = [
      { provider: options.provider, type: 'session.started', sessionId: '01922bb7-2085-7000-8000-000000000001' },
      { provider: options.provider, type: 'turn.started' },
      { provider: options.provider, type: 'tool.started' },
      { provider: options.provider, type: 'agent.message', message: 'provider-neutral result' },
      {
        provider: options.provider,
        type: 'turn.completed',
        ...(options.provider === 'codex' ? { tokenUsage } : {}),
      },
    ];
    for (const event of events) await options.onEvent?.(event);
    return {
      provider: options.provider,
      sessionId: '01922bb7-2085-7000-8000-000000000001',
      finalResult: 'provider-neutral result',
      eventCount: 5,
      ...(options.provider === 'codex' ? { tokenUsage } : {}),
    };
  }

  cancel(jobId: string): boolean {
    this.cancelledJobIds.push(jobId);
    return true;
  }

  close(): void {
    this.closeCalls += 1;
  }

  login(): void {
    this.loginCalls += 1;
  }
}

class BlankResultCliAgentRunner extends FakeCliAgentRunner {
  override async run(options: CliAgentRunOptions): Promise<CliAgentRunResult> {
    this.runOptions.push(options);
    return {
      provider: options.provider,
      sessionId: '01922bb7-2085-7000-8000-000000000002',
      finalResult: '   ',
      eventCount: 1,
    };
  }
}

class MismatchedProviderResultRunner extends FakeCliAgentRunner {
  override async run(options: CliAgentRunOptions): Promise<CliAgentRunResult> {
    this.runOptions.push(options);
    return {
      provider: options.provider === 'codex' ? 'copilot' : 'codex',
      sessionId: '01922bb7-2085-7000-8000-000000000003',
      finalResult: 'wrong provider result',
      eventCount: 1,
    };
  }
}

class MismatchedProviderEventRunner extends FakeCliAgentRunner {
  override async run(options: CliAgentRunOptions): Promise<CliAgentRunResult> {
    this.runOptions.push(options);
    await options.onEvent?.({
      provider: options.provider === 'codex' ? 'copilot' : 'codex',
      type: 'turn.started',
    });
    return {
      provider: options.provider,
      sessionId: '01922bb7-2085-7000-8000-000000000004',
      finalResult: 'unreachable result',
      eventCount: 1,
    };
  }
}

class SessionOmittingResultRunner extends FakeCliAgentRunner {
  override async run(options: CliAgentRunOptions): Promise<CliAgentRunResult> {
    this.runOptions.push(options);
    return {
      provider: options.provider,
      finalResult: 'continued result',
      eventCount: 2,
    };
  }
}

const fake = new FakeCliAgentRunner();
const runner = new ProviderNeutralAgentRunner({ runner: fake });
const events: CodexRunEvent[] = [];
const result = await runner.run({
  jobId: 'provider-neutral-default',
  prompt: 'run through the configured provider',
  workspace: '/tmp/provider-neutral-workspace',
  mode: 'workspace-write',
  threadId: '01922bb7-2085-7000-8000-000000000000',
  onEvent: (event) => { events.push(event); },
});

assert.equal(fake.runOptions[0]?.provider, 'codex');
assert.equal(fake.runOptions[0]?.sessionId, '01922bb7-2085-7000-8000-000000000000');
assert.deepEqual(events, [
  { type: 'thread.started', thread_id: '01922bb7-2085-7000-8000-000000000001' },
  { type: 'turn.started' },
  { type: 'item.started', item: { type: 'command_execution' } },
  { type: 'item.completed', item: { type: 'agent_message', text: 'provider-neutral result' } },
  {
    type: 'turn.completed',
    tokenUsage: {
      source: 'codex.exec.jsonl.turn.completed.usage',
      inputTokens: 21_460,
      cachedInputTokens: 21_248,
      outputTokens: 5,
      reasoningOutputTokens: 0,
    },
  },
]);
assert.deepEqual(result, {
  threadId: '01922bb7-2085-7000-8000-000000000001',
  finalMessage: 'provider-neutral result',
  eventCount: 5,
  tokenUsage: {
    source: 'codex.exec.jsonl.turn.completed.usage',
    inputTokens: 21_460,
    cachedInputTokens: 21_248,
    outputTokens: 5,
    reasoningOutputTokens: 0,
  },
});

assert.throws(
  () => new ProviderNeutralAgentRunner({
    provider: 'unsupported-provider' as 'codex',
    runner: new FakeCliAgentRunner(),
  }),
  /Unsupported agent provider: unsupported-provider/u,
);

await assert.rejects(
  () => new ProviderNeutralAgentRunner({ runner: new BlankResultCliAgentRunner() }).run({
    jobId: 'provider-neutral-empty-result',
    prompt: 'must return a real result',
    workspace: '/tmp/provider-neutral-workspace',
    mode: 'workspace-write',
  }),
  /non-empty final result/u,
);

await assert.rejects(
  () => new ProviderNeutralAgentRunner({ runner: new MismatchedProviderResultRunner() }).run({
    jobId: 'provider-neutral-provider-mismatch',
    prompt: 'reject a mismatched provider',
    workspace: '/tmp/provider-neutral-workspace',
    mode: 'workspace-write',
  }),
  /provider mismatch/u,
);

await assert.rejects(
  () => new ProviderNeutralAgentRunner({ runner: new MismatchedProviderEventRunner() }).run({
    jobId: 'provider-neutral-event-provider-mismatch',
    prompt: 'reject a mismatched lifecycle provider',
    workspace: '/tmp/provider-neutral-workspace',
    mode: 'workspace-write',
    onEvent: () => undefined,
  }),
  /lifecycle provider mismatch/u,
);

const existingThreadId = '01922bb7-2085-7000-8000-000000000005';
const continuedResult = await new ProviderNeutralAgentRunner({ runner: new SessionOmittingResultRunner() }).run({
  jobId: 'provider-neutral-session-preservation',
  prompt: 'continue the existing session',
  workspace: '/tmp/provider-neutral-workspace',
  mode: 'workspace-write',
  threadId: existingThreadId,
});
assert.equal(continuedResult.threadId, existingThreadId);

const copilotFake = new FakeCliAgentRunner();
const copilotRunner = new ProviderNeutralAgentRunner({ provider: 'copilot', runner: copilotFake });
const attemptedPerRunOverride = {
  jobId: 'provider-neutral-explicit-copilot',
  prompt: 'use only the constructor-selected provider',
  workspace: '/tmp/provider-neutral-workspace',
  mode: 'workspace-write' as const,
  provider: 'codex',
};
await copilotRunner.run(attemptedPerRunOverride);
assert.equal(copilotFake.runOptions[0]?.provider, 'copilot');
assert.equal(copilotFake.loginCalls, 0);
assert.equal(copilotRunner.cancel('provider-neutral-explicit-copilot'), true);
assert.deepEqual(copilotFake.cancelledJobIds, ['provider-neutral-explicit-copilot']);
copilotRunner.close();
assert.equal(copilotFake.closeCalls, 1);

// Isolated boundaries: no CLI spawn, auth read, model call or live job.
const receiptCli = new CliAgentRunner();
let injectedResult: CodexRunResult;
(receiptCli as unknown as { codexRunner: { run: () => Promise<CodexRunResult> } }).codexRunner.run =
  async () => injectedResult;
const receiptOptions = {
  jobId: 'receipt-adapter-fixture', prompt: 'synthetic fixture only',
  workspace: '/tmp/receipt-adapter-fixture', mode: 'read-only' as const,
  selection: { model: 'selected-model', reasoningEffort: 'low' as const, catalogRevision: 'a'.repeat(64) },
};
for (const platform of ['darwin', 'linux', 'win32'] as const) {
  const receipt: CoreExecutionReceipt = {
    source: 'worker-observation', observedAt: '2026-10-09T03:18:05.035Z', platform,
  };
  injectedResult = { finalMessage: 'synthetic result', eventCount: 0, executionReceipt: receipt };
  const cliResult = await receiptCli.run({ ...receiptOptions, provider: 'codex' });
  if (process.env.RECEIPT_ADAPTER_CASE !== 'neutral') assert.deepEqual((cliResult as CliAgentRunResult & { executionReceipt?: CoreExecutionReceipt }).executionReceipt,
    receipt, 'CLI adapter preserves original receipt source/time');
  const neutral = new ProviderNeutralAgentRunner({ runner: {
    run: async () => ({ provider: 'codex', finalResult: 'synthetic result', eventCount: 0, executionReceipt: receipt }),
    cancel: () => false, close: () => undefined,
  } });
  const neutralResult = await neutral.run(receiptOptions);
  assert.deepEqual(neutralResult.executionReceipt, receipt, 'neutral adapter independently preserves receipt');
  assert.notEqual(neutralResult.executionReceipt, receipt, 'receipt is a detached whitelist copy');
  assert.equal(neutralResult.executionReceipt?.model, undefined, 'requested model is not actual model evidence');
  assert.equal(neutralResult.executionReceipt?.reasoningEffort, undefined, 'requested effort is not observed effort');
  const throughBoth = await new ProviderNeutralAgentRunner({ runner: receiptCli }).run(receiptOptions);
  assert.deepEqual(throughBoth.executionReceipt, receipt, 'platform-only receipt survives both adapters');
}
for (const invalid of [
  null, { source: 'selected-config', observedAt: '2026-10-09T03:18:05.035Z', platform: 'darwin' },
  { source: 'worker-observation', observedAt: 'invalid', platform: 'darwin' },
  { source: 'worker-observation', observedAt: '2026-10-09T03:18:05.035Z', platform: 'unsupported' },
  { source: 'worker-observation', observedAt: '2026-10-09T03:18:05.035Z', platform: 'darwin', secret: 'synthetic-credential' },
  { source: 'worker-observation', observedAt: '2026-10-09T03:18:05.035Z', platform: 'darwin', model: 'x'.repeat(129) },
  { source: 'worker-observation', observedAt: '2026-10-09T03:18:05.035Z', platform: 'darwin', model: 'token=synthetic-credential' },
  { source: 'worker-observation', observedAt: '2026-10-09T03:18:05.035Z', platform: 'darwin', output: 'synthetic-credential'.repeat(4000) },
]) {
  injectedResult = { finalMessage: 'synthetic result', eventCount: 0, executionReceipt: invalid as CoreExecutionReceipt };
  const neutral = new ProviderNeutralAgentRunner({ runner: {
    run: async () => ({ provider: 'codex', finalResult: 'synthetic result', eventCount: 0, executionReceipt: invalid as CoreExecutionReceipt }),
    cancel: () => false, close: () => undefined,
  } });
  const safeError = (error: unknown): boolean => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /execution receipt is invalid/);
    assert.ok(error.message.length < 80);
    assert.doesNotMatch(error.message, /synthetic-credential|token=|selected-config|xxxx/);
    return true;
  };
  await assert.rejects(receiptCli.run({ ...receiptOptions, provider: 'codex' }), safeError);
  await assert.rejects(neutral.run(receiptOptions), safeError);
}
injectedResult = { finalMessage: 'legacy synthetic result', eventCount: 0 };
const noReceipt = await new ProviderNeutralAgentRunner({ runner: receiptCli }).run(receiptOptions);
assert.equal(noReceipt.executionReceipt, undefined, 'legacy result never gains a receipt from selection');
receiptCli.close();
console.log('PASS: provider-neutral adapter lifecycle and trusted receipt contract');
