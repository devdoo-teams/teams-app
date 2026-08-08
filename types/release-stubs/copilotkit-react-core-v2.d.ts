import type { ComponentType, ReactNode } from 'react';

export type RenderToolProps<T = Record<string, unknown>> = {
  status: 'inProgress' | 'executing' | 'complete';
  parameters: any;
  result?: string;
};

export const CopilotKit: ComponentType<{
  children?: ReactNode;
  onError?: (event: { error: unknown }) => void;
  [key: string]: unknown;
}>;
export const CopilotChat: ComponentType<Record<string, unknown>>;
export function useCopilotChatConfiguration(): { threadId?: string } | null;
export function useAgentContext(options: { description: string; value: unknown }): void;
export function useRenderTool(config: {
  name: string;
  parameters: unknown;
  render: (props: any) => ReactNode;
}, dependencies?: unknown[]): void;
