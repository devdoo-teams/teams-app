import type { AgentJob } from './agent-job-store.js';
import type { CoreExecutionReceipt } from '../shared/core-orchestration.js';
import type { CoreAgentToolUsage, CoreAgentTokenUsage } from '../shared/core-orchestration.js';

export type AgentExecutionObservation = Readonly<{
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'quarantined';
  result?: string;
  providerExecutionId?: string;
  error?: string;
  tools?: readonly CoreAgentToolUsage[];
  tokenUsage?: CoreAgentTokenUsage;
  executionReceipt?: CoreExecutionReceipt;
  cliInvocationReceipt?: import('../shared/core-orchestration.js').CoreCliInvocationReceipt;
}>;

/**
 * Durable execution boundary used by runtimes that submit work to an external
 * worker. Implementations must not execute a CLI in the HTTP server process.
 */
export interface AgentExecutionDispatcher {
  readonly kind: 'azure-queue';
  dispatch(job: AgentJob): Promise<void>;
  observe(job: AgentJob): Promise<AgentExecutionObservation | undefined>;
  cancel(job: AgentJob, reason: string): Promise<void>;
  close?(): Promise<void> | void;
}
