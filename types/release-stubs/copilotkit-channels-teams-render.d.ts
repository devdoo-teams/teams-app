// Renderer-only public subpath, checked against installed @copilotkit/channels-teams 0.7.3.
// https://github.com/CopilotKit/CopilotKit/blob/main/packages/channels-teams/src/render/index.ts
import type { ChannelNode } from '@copilotkit/channels-ui';
import type { AdaptiveCard } from '@copilotkit/channels-teams';

export const ADAPTIVE_CARD_CONTENT_TYPE: 'application/vnd.microsoft.card.adaptive';
export function renderAdaptiveCard(ir: ChannelNode[]): AdaptiveCard;
export function isPlainText(ir: ChannelNode[]): boolean;
export function collectPlainText(ir: ChannelNode[]): string;
export function renderTeamsNativeCard(ir: ChannelNode[]): AdaptiveCard;
export function containsTeamsNative(ir: readonly ChannelNode[]): boolean;
