export type BotChildren = unknown;
export type ChannelNode = Record<string, unknown>;
export type ClickHandler<T = unknown> = (value: T) => void;

export const Actions: (props: Record<string, unknown>) => ChannelNode;
export const Button: (props: Record<string, unknown>) => ChannelNode;
export const Field: (props: Record<string, unknown>) => ChannelNode;
export const Fields: (props: Record<string, unknown>) => ChannelNode;
export const Header: (props: Record<string, unknown>) => ChannelNode;
export const Message: (props: Record<string, unknown>) => ChannelNode;
export const Section: (props: Record<string, unknown>) => ChannelNode;
export const Context: (props: Record<string, unknown>) => ChannelNode;
export function renderToIR(value: unknown): ChannelNode[];

export type NativeProvider = 'slack' | 'teams';
export type NativeNodeKind = 'root' | 'block' | 'element' | 'object' | 'action' | 'input'
  | 'chart' | 'layout' | 'preview' | 'raw';
export const NATIVE_NODE: unique symbol;
export interface NativeChannelNode extends ChannelNode {
  type: typeof NATIVE_NODE;
  props: Record<string, unknown> & { provider: NativeProvider; nativeKind: NativeNodeKind; nativeType: string };
}
export function createNativeNode(provider: NativeProvider, nativeKind: NativeNodeKind,
  nativeType: string, props: Record<string, unknown>): NativeChannelNode;
