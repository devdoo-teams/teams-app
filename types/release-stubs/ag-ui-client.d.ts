import type { Observable } from 'rxjs';
import type { AgentCapabilities, BaseEvent, RunAgentInput } from './ag-ui-core.js';

// Installed @ag-ui/client 0.0.57: dist/index.d.ts (AgentConfig, HttpAgent,
// AbstractAgent). Keep this focused public surface typed; no SDK internals.
export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
export type Message =
  | { id: string; role: 'assistant'; content?: string; toolCalls?: ToolCall[] }
  | { id: string; role: 'tool'; content: string; toolCallId: string }
  | { id: string; role: 'user' | 'system' | 'developer'; content: string | Array<{ type: string; text?: string }> }
  | { id: string; role: 'activity'; activityType: string; content: Record<string, unknown> }
  | { id: string; role: 'reasoning'; content: string };
export type AgentConfig = {
  agentId?: string; description?: string; threadId?: string;
  initialMessages?: Message[]; initialState?: Record<string, unknown>;
};
export type RunAgentParameters = Partial<Pick<RunAgentInput, 'runId' | 'tools' | 'context' | 'forwardedProps'>>;
export type RunAgentResult = { result: unknown; newMessages: Message[] };
export type HttpAgentFetchFn = (url: string, requestInit: RequestInit) => Promise<Response>;
export type HttpAgentConfig = AgentConfig & { url: string; headers?: Record<string, string>; fetch?: HttpAgentFetchFn };

export abstract class AbstractAgent {
  constructor(options?: AgentConfig);
  agentId?: string;
  description: string;
  threadId: string;
  messages: Message[];
  state: Record<string, unknown>;
  isRunning: boolean;
  clone(): AbstractAgent;
  getCapabilities?(): Promise<AgentCapabilities>;
  abstract run(input: RunAgentInput): Observable<BaseEvent>;
  runAgent(parameters?: RunAgentParameters): Promise<RunAgentResult>;
  abortRun(): void;
  setMessages(messages: Message[]): void;
  setState(state: Record<string, unknown>): void;
}

export class HttpAgent extends AbstractAgent {
  constructor(options: HttpAgentConfig);
  url: string;
  headers: Record<string, string>;
  fetch: HttpAgentFetchFn;
  abortController: AbortController;
  protected requestInit(input: RunAgentInput): RequestInit;
  run(input: RunAgentInput): Observable<BaseEvent>;
  runAgent(parameters?: RunAgentParameters & { abortController?: AbortController }): Promise<RunAgentResult>;
  abortRun(): void;
  clone(): HttpAgent;
}
