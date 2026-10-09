import type { ComponentType, HTMLAttributes, ReactElement, ReactNode } from 'react';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { AbstractAgent } from './ag-ui-client.js';

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
type AssistantMessageProps = {
  markdownRenderer?: HiddenCompatibleSlot; toolbar?: HiddenCompatibleSlot;
};
type MessageViewProps = {
  assistantMessage?: Slot<AssistantMessageProps>;
  userMessage?: HiddenCompatibleSlot; reasoningMessage?: HiddenCompatibleSlot;
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
