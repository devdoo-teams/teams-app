export type RunAgentMessage = {
  id?: string;
  role: string;
  content: string | Array<{ type: string; text?: string }>;
};

export type RunAgentInput = {
  threadId: string;
  runId: string;
  messages: RunAgentMessage[];
  context: Array<{ description: string; value: string }>;
  state?: Record<string, unknown>;
  tools?: unknown[];
  forwardedProps?: Record<string, unknown>;
  [key: string]: unknown;
};

export type BaseEvent = Record<string, unknown>;
export type AgentCapabilities = Record<string, unknown>;

export const EventType: {
  RUN_STARTED: string;
  RUN_FINISHED: string;
  RUN_ERROR: string;
  TOOL_CALL_START: string;
  TOOL_CALL_ARGS: string;
  TOOL_CALL_END: string;
  TOOL_CALL_RESULT: string;
  TEXT_MESSAGE_START: string;
  TEXT_MESSAGE_CONTENT: string;
  TEXT_MESSAGE_END: string;
};
