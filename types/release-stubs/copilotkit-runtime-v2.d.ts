import type { Observable } from 'rxjs';
import type { AbstractAgent } from './ag-ui-client.js';
import type { BaseEvent, RunAgentInput } from './ag-ui-core.js';
export type AgentRunnerRunRequest = { threadId: string; agent: AbstractAgent; input: RunAgentInput };
export abstract class AgentRunner {
  abstract run(request: AgentRunnerRunRequest): Observable<BaseEvent>;
  abstract connect(request: { threadId: string }): Observable<BaseEvent>;
  abstract isRunning(request: { threadId: string }): Promise<boolean>;
  abstract stop(request: { threadId: string; runId?: string }): Promise<boolean | undefined>;
}
export class CopilotRuntime {
  constructor(options?: {
    agents?: (context: { request: { headers: Headers } }) => Record<string, unknown>;
    [key: string]: unknown;
  });
}
