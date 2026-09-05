import {
  CliAgentRunner,
  type CliAgentLifecycleEvent,
  type CliAgentProvider,
  type CliAgentRunOptions,
  type CliAgentRunResult,
} from './cli-agent-runner.js';
import {
  CodexRunner,
  type CodexRunEvent,
  type CodexRunResult,
} from './codex-runner.js';
import { isAgentTokenUsage } from './agent-token-usage.js';

type CliAgentRunnerContract = Readonly<{
  run: (options: CliAgentRunOptions) => Promise<CliAgentRunResult>;
  cancel: (jobId: string) => boolean;
  close: () => void;
}>;

export type ProviderNeutralAgentRunnerOptions = Readonly<{
  provider?: CliAgentProvider;
  runner?: CliAgentRunnerContract;
}>;

type AgentServiceRunOptions = Parameters<CodexRunner['run']>[0];

function assertProvider(value: unknown): asserts value is CliAgentProvider {
  if (value !== 'codex' && value !== 'copilot') {
    throw new Error(`Unsupported agent provider: ${String(value)}`);
  }
}

function toCodexRunEvent(event: CliAgentLifecycleEvent, provider: CliAgentProvider): CodexRunEvent {
  if (event.provider !== provider) {
    throw new Error(`Agent lifecycle provider mismatch: expected ${provider}, received ${String(event.provider)}.`);
  }
  switch (event.type) {
    case 'session.started':
      return { type: 'thread.started', thread_id: event.sessionId };
    case 'turn.started':
      return { type: 'turn.started' };
    case 'tool.started':
      return { type: 'item.started', item: { type: 'command_execution' } };
    case 'agent.message':
      return { type: 'item.completed', item: { type: 'agent_message', text: event.message } };
    case 'turn.completed':
      return {
        type: 'turn.completed',
        ...(isAgentTokenUsage(event.tokenUsage) ? { tokenUsage: { ...event.tokenUsage } } : {}),
      };
  }
}

export class ProviderNeutralAgentRunner extends CodexRunner {
  private readonly provider: CliAgentProvider;
  private readonly runner: CliAgentRunnerContract;

  constructor(options: ProviderNeutralAgentRunnerOptions = {}) {
    super();
    const provider = options.provider ?? 'codex';
    assertProvider(provider);
    this.provider = provider;
    this.runner = options.runner ?? new CliAgentRunner();
  }

  override async run(options: AgentServiceRunOptions): Promise<CodexRunResult> {
    const { threadId, onEvent, ...sharedOptions } = options;
    const result = await this.runner.run({
      ...sharedOptions,
      provider: this.provider,
      sessionId: threadId,
      onEvent: onEvent
        ? async (event) => onEvent(toCodexRunEvent(event, this.provider))
        : undefined,
    });
    if (result.provider !== this.provider) {
      throw new Error(`Agent runner provider mismatch: expected ${this.provider}, received ${String(result.provider)}.`);
    }
    if (!result.finalResult.trim()) {
      throw new Error(`${this.provider} agent runner did not return a non-empty final result.`);
    }
    return {
      threadId: result.sessionId ?? threadId,
      finalMessage: result.finalResult,
      eventCount: result.eventCount,
      ...(isAgentTokenUsage(result.tokenUsage) ? { tokenUsage: { ...result.tokenUsage } } : {}),
    };
  }

  override cancel(jobId: string): boolean {
    return this.runner.cancel(jobId);
  }

  override close(): void {
    this.runner.close();
  }
}
