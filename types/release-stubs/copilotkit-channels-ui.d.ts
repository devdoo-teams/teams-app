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
