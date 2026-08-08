import type { Observable } from 'rxjs';
import type { AgentCapabilities, BaseEvent, RunAgentInput } from './ag-ui-core.js';

export abstract class AbstractAgent {
  protected constructor(options?: { agentId?: string; description?: string });
  readonly description: string;
  abstract clone(): AbstractAgent;
  abstract getCapabilities(): Promise<AgentCapabilities>;
  abstract run(input: RunAgentInput): Observable<BaseEvent>;
}
