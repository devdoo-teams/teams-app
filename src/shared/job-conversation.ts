import type { CoreOrchestrationJobStatus, CoreAgentToolUsage, CorePendingOperation } from './core-orchestration.js';
import type { ReceiptFact } from './receipt-presentation.js';

export type VisibleJobTurn = Readonly<{
  pendingOperation?: CorePendingOperation;
  receiptFacts?: readonly ReceiptFact[];
  jobId: string;
  request: string;
  response?: string;
  error?: string;
  status: CoreOrchestrationJobStatus;
  progress: readonly string[];
  tools: readonly CoreAgentToolUsage[];
  createdAt: string;
  truncated: boolean;
}>;
export type VisibleJobConversation = Readonly<{
  selectedJobId: string;
  turns: readonly VisibleJobTurn[];
  complete: boolean;
  unavailableReason?: 'previous-turn-unavailable' | 'invalid-chain' | 'turn-limit';
}>;
