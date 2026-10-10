import type { ComponentType, HTMLAttributes, ReactElement, ReactNode, TextareaHTMLAttributes, ButtonHTMLAttributes } from 'react';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { AbstractAgent, Message, ToolCall } from './ag-ui-client.js';

// Installed @copilotkit/react-core 1.66.2 public v2 declarations. Focused
// subset used by Teams; props and named schema output retain strict types.
export type RenderToolProps<S extends StandardSchemaV1> = {
  name: string; toolCallId: string;
} & (
  | { status: 'inProgress'; parameters: Partial<StandardSchemaV1.InferOutput<S>>; result: undefined }
  | { status: 'executing'; parameters: StandardSchemaV1.InferOutput<S>; result: undefined }
  | { status: 'complete'; parameters: StandardSchemaV1.InferOutput<S>; result: string }
);

type Slot<Props> = ComponentType<Props> | string | Partial<Props>;
type HiddenCompatibleSlot = Slot<HTMLAttributes<HTMLDivElement>>;
type AssistantMessageProps = HTMLAttributes<HTMLDivElement> & {
  message: Extract<Message, { role: 'assistant' }>; messages?: Message[]; isRunning?: boolean;
  markdownRenderer?: Slot<{content:string}>; toolbar?: HiddenCompatibleSlot;
};
type UserMessageProps = HTMLAttributes<HTMLDivElement> & {
  message: Message & { role: 'user' }; toolbar?: HiddenCompatibleSlot;
};
export const CopilotChatUserMessage: ComponentType<UserMessageProps>;
export const CopilotChatAssistantMessage: ComponentType<AssistantMessageProps>;
type MessageViewProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  assistantMessage?: Slot<AssistantMessageProps>;
  userMessage?: Slot<UserMessageProps>; reasoningMessage?: HiddenCompatibleSlot;
  children?: (props: { isRunning: boolean; messages: Message[]; messageElements: ReactElement[];
    interruptElement: ReactElement | null }) => ReactElement;
};
type SdkErrorEvent = { error: Error; code?: string; context?: Record<string, unknown> };
export type CopilotKitProps = {
  children: ReactNode; runtimeUrl?: string; agent?: string;
  headers?: Record<string, string> | (() => Record<string, string>);
  credentials?: RequestCredentials; properties?: Record<string, unknown>;
  useSingleEndpoint?: boolean; enableInspector?: boolean; showDevConsole?: boolean;
  onError?: (event: SdkErrorEvent) => void | Promise<void>;
};
export const CopilotKit: ComponentType<CopilotKitProps>;
export type CopilotChatProps = HTMLAttributes<HTMLDivElement> & {
  agentId?: string; threadId?: string;
  labels?: Partial<{ chatInputPlaceholder: string; modalHeaderTitle: string; welcomeMessageText: string }>;
  input?: HiddenCompatibleSlot; suggestionView?: HiddenCompatibleSlot;
  welcomeScreen?: boolean | Slot<{ input: ReactElement; suggestionView: ReactElement }>;
  messageView?: Slot<MessageViewProps>; autoScroll?: boolean | 'pin-to-bottom' | 'pin-to-send' | 'none';
  onError?: (event: SdkErrorEvent) => void | Promise<void>;
};
export const CopilotChat: ComponentType<CopilotChatProps>;
// Installed1.66.2 CopilotChatInput/CopilotChatView/ConfigurationProvider public
// slots. Keep controlled input callbacks separate from the agent run transport.
export type CopilotChatInputProps = Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> & {
  mode?: 'input' | 'transcribe' | 'processing'; isRunning?: boolean;
  onSubmitMessage?: (value: string) => void; onStop?: () => void;
  value?: string; onChange?: (value: string) => void;
  textArea?: Slot<TextareaHTMLAttributes<HTMLTextAreaElement>>;
  sendButton?: Slot<ButtonHTMLAttributes<HTMLButtonElement>>;
};
export const CopilotChatInput: ComponentType<CopilotChatInputProps>;
export type CopilotChatViewProps = HTMLAttributes<HTMLDivElement> & {
  messages?: Message[]; autoScroll?: boolean | 'pin-to-bottom' | 'pin-to-send' | 'none';
  isRunning?: boolean; welcomeScreen?: boolean;
  input?: Slot<CopilotChatInputProps>; messageView?: Slot<MessageViewProps>;
  scrollView?: HiddenCompatibleSlot;
  inputValue?: string; onInputChange?: (value: string) => void;
  onSubmitMessage?: (value: string) => void; onStop?: () => void;
};
export const CopilotChatView: ComponentType<CopilotChatViewProps>;
export const CopilotChatConfigurationProvider: ComponentType<{
  children: ReactNode; agentId?: string; threadId?: string; hasExplicitThreadId?: boolean;
}>;
export function useRenderToolCall(): (props: { toolCall: ToolCall; toolMessage?: Extract<Message, {role:'tool'}> }) => ReactElement | null;
export function useCopilotChatConfiguration(): { threadId?: string; agentId?: string } | null;
export function useAgentContext(options: { description: string; value: unknown }): void;
export function useRenderTool<S extends StandardSchemaV1>(config: {
  name: string; agentId?: string; parameters: S;
  render: (props: RenderToolProps<S>) => ReactElement;
}, dependencies?: ReadonlyArray<unknown>): void;
export function useRenderTool(config: {
  name: '*'; agentId?: string;
  render: (props: { name: string; parameters: unknown; status: 'inProgress' | 'executing' | 'complete'; result?: string }) => ReactElement;
}, dependencies?: ReadonlyArray<unknown>): void;

export type UseAgentProps = { throttleMs?: number } & (
  | { agentId?: string; threadId?: undefined; runtimeAgentId?: undefined }
  | { agentId: string; threadId: string; runtimeAgentId: string }
);
export function useAgent(options?: UseAgentProps): { agent: AbstractAgent; isReady: boolean };
