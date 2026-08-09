export const COLLABORATION_TAB_PATH = '/tabs/home/' as const;

export const COLLABORATION_TARGET_TYPES = [
  'project',
  'goal',
  'topic',
  'work-item',
] as const;

export type CollaborationTargetType = (typeof COLLABORATION_TARGET_TYPES)[number];

export const COLLABORATION_DELIVERIES = ['personal', 'channel'] as const;
export type CollaborationDelivery = (typeof COLLABORATION_DELIVERIES)[number];

export const NOTIFICATION_LEVELS = ['all', 'mentions', 'digest', 'none'] as const;
export type NotificationLevel = (typeof NOTIFICATION_LEVELS)[number];

export const DIGEST_PERIODS = ['daily', 'weekly', 'monthly'] as const;
export type DigestPeriod = (typeof DIGEST_PERIODS)[number];

export const COLLABORATION_NOTIFICATION_KINDS = ['update', 'reminder'] as const;
export type CollaborationNotificationKind = (typeof COLLABORATION_NOTIFICATION_KINDS)[number];

export type CollaborationScope = {
  tenantId: string;
  requesterId: string;
  conversationId: string;
};

export type CollaborationTarget = {
  type: CollaborationTargetType;
  id: string;
};

export type CollaborationDeepLink = {
  kind: 'collaboration';
  targetType: CollaborationTargetType;
  targetId: string;
  path: string;
  href: string;
};

export type CollaborationSubscription = {
  id: string;
  tenantId: string;
  conversationId: string;
  requesterId: string;
  target: CollaborationTarget;
  delivery: CollaborationDelivery;
  channelId?: string;
  active: boolean;
  deepLink: CollaborationDeepLink;
  createdAt: string;
  updatedAt: string;
};

export type ChannelBinding = {
  id: string;
  tenantId: string;
  conversationId: string;
  target: CollaborationTarget;
  channelId: string;
  metadata: Record<string, string>;
  boundBy: string;
  active: boolean;
  deepLink: CollaborationDeepLink;
  createdAt: string;
  updatedAt: string;
};

export type NotificationPreference = {
  id: string;
  tenantId: string;
  conversationId: string;
  requesterId: string;
  target: CollaborationTarget;
  delivery: CollaborationDelivery;
  channelId?: string;
  level: NotificationLevel;
  digestPeriod?: DigestPeriod;
  updatedAt: string;
};

export type CollaborationNotification = {
  id: string;
  tenantId: string;
  conversationId: string;
  createdBy: string;
  target: CollaborationTarget;
  kind: CollaborationNotificationKind;
  title: string;
  body: string;
  mentionUserIds: string[];
  channelId?: string;
  occurredAt: string;
  remindAt?: string;
  deepLink: CollaborationDeepLink;
  createdAt: string;
};

export type CollaborationFollowInput = {
  mutationKey: string;
  target: CollaborationTarget;
  delivery?: CollaborationDelivery;
  channelId?: string;
};

export type CollaborationUnfollowInput = Omit<CollaborationFollowInput, 'mutationKey'> & {
  mutationKey: string;
};

export type ChannelBindingInput = {
  mutationKey: string;
  target: CollaborationTarget;
  channelId: string;
  metadata?: Record<string, string>;
};

export type ChannelUnbindingInput = Omit<ChannelBindingInput, 'metadata'>;

export type NotificationPreferenceInput = {
  mutationKey: string;
  target: CollaborationTarget;
  delivery?: CollaborationDelivery;
  channelId?: string;
  level: NotificationLevel;
  digestPeriod?: DigestPeriod;
};

export type CollaborationUpdateInput = {
  mutationKey: string;
  target: CollaborationTarget;
  title: string;
  body?: string;
  mentionUserIds?: string[];
  channelId?: string;
  occurredAt?: string;
};

export type CollaborationReminderInput = Omit<CollaborationUpdateInput, 'occurredAt'> & {
  remindAt?: string;
};

export type CollaborationSubscriptionQuery = {
  target: CollaborationTarget;
  delivery?: CollaborationDelivery;
  channelId?: string;
};

export type ChannelBindingQuery = {
  target: CollaborationTarget;
  channelId: string;
};

export type NotificationPreferenceQuery = CollaborationSubscriptionQuery;

export type CollaborationNotificationQuery = {
  from?: string;
  to?: string;
  limit?: number;
};

export type CollaborationDigestQuery = {
  period: DigestPeriod;
  at?: string;
};

export type CollaborationDigestEntry = {
  target: CollaborationTarget;
  kind: CollaborationNotificationKind;
  title: string;
  body: string;
  count: number;
  eventIds: string[];
  firstOccurredAt: string;
  lastOccurredAt: string;
  deepLink: CollaborationDeepLink;
};

export type CollaborationDigest = {
  period: DigestPeriod;
  from: string;
  to: string;
  totalCount: number;
  entries: CollaborationDigestEntry[];
};

export type CollaborationMutationOperation =
  | 'follow'
  | 'unfollow'
  | 'bind-channel'
  | 'unbind-channel'
  | 'set-notification-preference'
  | 'record-update'
  | 'record-reminder';

export function buildCollaborationDeepLink(target: CollaborationTarget): CollaborationDeepLink {
  const path = `${COLLABORATION_TAB_PATH}?collaborationType=${encodeURIComponent(target.type)}&collaborationId=${encodeURIComponent(target.id)}`;
  return {
    kind: 'collaboration',
    targetType: target.type,
    targetId: target.id,
    path,
    href: path,
  };
}

export class CollaborationIdempotencyConflictError extends Error {
  readonly code = 'COLLABORATION_IDEMPOTENCY_CONFLICT' as const;

  constructor(readonly mutationKey: string) {
    super(`Mutation key ${mutationKey} was already used with a different operation or payload.`);
    this.name = 'CollaborationIdempotencyConflictError';
  }
}
