import crypto from 'node:crypto';

import {
  COLLABORATION_DELIVERIES,
  COLLABORATION_TARGET_TYPES,
  CollaborationIdempotencyConflictError,
  DIGEST_PERIODS,
  NOTIFICATION_LEVELS,
  buildCollaborationDeepLink,
  type ChannelBinding,
  type ChannelBindingInput,
  type ChannelBindingQuery,
  type ChannelUnbindingInput,
  type CollaborationDigest,
  type CollaborationDigestEntry,
  type CollaborationDigestQuery,
  type CollaborationDelivery,
  type CollaborationFollowInput,
  type CollaborationNotification,
  type CollaborationNotificationQuery,
  type CollaborationReminderInput,
  type CollaborationScope,
  type CollaborationSubscription,
  type CollaborationSubscriptionQuery,
  type CollaborationTarget,
  type CollaborationUpdateInput,
  type DigestPeriod,
  type NotificationLevel,
  type NotificationPreference,
  type NotificationPreferenceInput,
  type NotificationPreferenceQuery,
} from '../shared/collaboration.js';
import {
  MAX_COLLABORATION_BODY_LENGTH,
  MAX_COLLABORATION_ID_LENGTH,
  MAX_COLLABORATION_METADATA_ENTRIES,
  MAX_COLLABORATION_METADATA_KEY_LENGTH,
  MAX_COLLABORATION_METADATA_VALUE_LENGTH,
  MAX_COLLABORATION_MENTION_IDS,
  MAX_COLLABORATION_NOTIFICATIONS,
  MAX_COLLABORATION_SCOPE_VALUE_LENGTH,
  MAX_COLLABORATION_TITLE_LENGTH,
  CollaborationStore,
  type CollaborationMutationContext,
} from './collaboration-store.js';

export { CollaborationIdempotencyConflictError } from '../shared/collaboration.js';

const MAX_QUERY_LIMIT = 100;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

export class CollaborationValidationError extends Error {
  readonly code = 'COLLABORATION_INVALID' as const;

  constructor(message: string) {
    super(message);
    this.name = 'CollaborationValidationError';
  }
}

export class CollaborationNotFoundError extends Error {
  readonly code = 'COLLABORATION_NOT_FOUND' as const;

  constructor(readonly resource: string) {
    super(`Collaboration resource ${resource} was not found in the current tenant and conversation scope.`);
    this.name = 'CollaborationNotFoundError';
  }
}

export class CollaborationForbiddenError extends Error {
  readonly code = 'COLLABORATION_FORBIDDEN' as const;

  constructor(readonly resource: string) {
    super(`The current user is not allowed to manage collaboration resource ${resource}.`);
    this.name = 'CollaborationForbiddenError';
  }
}

export type CollaborationServiceOptions = {
  clock?: () => Date;
};

export class CollaborationService {
  private readonly clock: () => Date;

  constructor(
    private readonly store: CollaborationStore,
    options: CollaborationServiceOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  listSubscriptions(scope: CollaborationScope): CollaborationSubscription[] {
    return this.store.listSubscriptions(normalizeScope(scope));
  }

  getSubscription(
    scope: CollaborationScope,
    query: CollaborationSubscriptionQuery,
  ): CollaborationSubscription | undefined {
    const normalizedScope = normalizeScope(scope);
    const identity = normalizeSubscriptionQuery(query, 'subscription');
    return this.store.findSubscription(
      normalizedScope,
      identity.target,
      identity.delivery,
      identity.channelId,
    );
  }

  async follow(scope: CollaborationScope, input: CollaborationFollowInput): Promise<CollaborationSubscription> {
    const normalizedScope = normalizeScope(scope);
    const normalized = normalizeFollowInput(input);
    const timestamp = this.timestamp();
    return this.runMutation(
      normalizedScope,
      'follow',
      normalized.mutationKey,
      {
        target: normalized.target,
        delivery: normalized.delivery,
        channelId: normalized.channelId,
      },
      (context) => {
        const index = context.subscriptions.findIndex((subscription) =>
          sameSubscriptionIdentity(subscription, normalizedScope, normalized.target, normalized.delivery, normalized.channelId),
        );
        if (index !== -1) {
          const current = context.subscriptions[index]!;
          if (current.active) return clone(current);
          const reactivated: CollaborationSubscription = {
            ...clone(current),
            active: true,
            updatedAt: timestamp,
          };
          context.subscriptions[index] = reactivated;
          return clone(reactivated);
        }

        const subscription: CollaborationSubscription = {
          id: createId('subscription'),
          tenantId: normalizedScope.tenantId,
          conversationId: normalizedScope.conversationId,
          requesterId: normalizedScope.requesterId,
          target: normalized.target,
          delivery: normalized.delivery,
          ...(normalized.channelId ? { channelId: normalized.channelId } : {}),
          active: true,
          deepLink: buildCollaborationDeepLink(normalized.target),
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        context.subscriptions.unshift(subscription);
        return clone(subscription);
      },
    );
  }

  async subscribe(scope: CollaborationScope, input: CollaborationFollowInput): Promise<CollaborationSubscription> {
    return this.follow(scope, input);
  }

  async unfollow(scope: CollaborationScope, input: CollaborationFollowInput): Promise<CollaborationSubscription> {
    const normalizedScope = normalizeScope(scope);
    const normalized = normalizeFollowInput(input);
    const timestamp = this.timestamp();
    return this.runMutation(
      normalizedScope,
      'unfollow',
      normalized.mutationKey,
      {
        target: normalized.target,
        delivery: normalized.delivery,
        channelId: normalized.channelId,
      },
      (context) => {
        const index = context.subscriptions.findIndex((subscription) =>
          sameSubscriptionIdentity(subscription, normalizedScope, normalized.target, normalized.delivery, normalized.channelId),
        );
        if (index === -1) throw new CollaborationNotFoundError(resourceName(normalized.target));
        const current = context.subscriptions[index]!;
        if (!current.active) return clone(current);
        const deactivated: CollaborationSubscription = {
          ...clone(current),
          active: false,
          updatedAt: timestamp,
        };
        context.subscriptions[index] = deactivated;
        return clone(deactivated);
      },
    );
  }

  async unsubscribe(scope: CollaborationScope, input: CollaborationFollowInput): Promise<CollaborationSubscription> {
    return this.unfollow(scope, input);
  }

  listChannelBindings(scope: CollaborationScope): ChannelBinding[] {
    return this.store.listChannelBindings(normalizeScope(scope));
  }

  getChannelBinding(scope: CollaborationScope, query: ChannelBindingQuery): ChannelBinding | undefined {
    const normalizedScope = normalizeScope(scope);
    const normalized = normalizeChannelBindingQuery(query);
    return this.store.findChannelBinding(normalizedScope, normalized.target, normalized.channelId);
  }

  async bindChannel(scope: CollaborationScope, input: ChannelBindingInput): Promise<ChannelBinding> {
    const normalizedScope = normalizeScope(scope);
    const normalized = normalizeChannelBindingInput(input);
    const timestamp = this.timestamp();
    return this.runMutation(
      normalizedScope,
      'bind-channel',
      normalized.mutationKey,
      {
        target: normalized.target,
        channelId: normalized.channelId,
        metadata: normalized.metadata,
      },
      (context) => {
        const index = context.channelBindings.findIndex((binding) =>
          binding.tenantId === normalizedScope.tenantId &&
          binding.conversationId === normalizedScope.conversationId &&
          sameTarget(binding.target, normalized.target) &&
          binding.channelId === normalized.channelId,
        );
        if (index !== -1) {
          const current = context.channelBindings[index]!;
          if (current.boundBy !== normalizedScope.requesterId) {
            throw new CollaborationForbiddenError(resourceName(normalized.target));
          }
          if (current.active && stableStringify(current.metadata) === stableStringify(normalized.metadata)) {
            return clone(current);
          }
          const rebound: ChannelBinding = {
            ...clone(current),
            metadata: normalized.metadata,
            active: true,
            updatedAt: timestamp,
          };
          context.channelBindings[index] = rebound;
          return clone(rebound);
        }

        const binding: ChannelBinding = {
          id: createId('channel-binding'),
          tenantId: normalizedScope.tenantId,
          conversationId: normalizedScope.conversationId,
          target: normalized.target,
          channelId: normalized.channelId,
          metadata: normalized.metadata,
          boundBy: normalizedScope.requesterId,
          active: true,
          deepLink: buildCollaborationDeepLink(normalized.target),
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        context.channelBindings.unshift(binding);
        return clone(binding);
      },
    );
  }

  async unbindChannel(scope: CollaborationScope, input: ChannelUnbindingInput): Promise<ChannelBinding> {
    const normalizedScope = normalizeScope(scope);
    const normalized = normalizeChannelUnbindingInput(input);
    const timestamp = this.timestamp();
    return this.runMutation(
      normalizedScope,
      'unbind-channel',
      normalized.mutationKey,
      {
        target: normalized.target,
        channelId: normalized.channelId,
      },
      (context) => {
        const index = context.channelBindings.findIndex((binding) =>
          binding.tenantId === normalizedScope.tenantId &&
          binding.conversationId === normalizedScope.conversationId &&
          sameTarget(binding.target, normalized.target) &&
          binding.channelId === normalized.channelId,
        );
        if (index === -1 || !context.channelBindings[index]!.active) {
          throw new CollaborationNotFoundError(resourceName(normalized.target));
        }
        const current = context.channelBindings[index]!;
        if (current.boundBy !== normalizedScope.requesterId) {
          throw new CollaborationForbiddenError(resourceName(normalized.target));
        }
        const unbound: ChannelBinding = {
          ...clone(current),
          active: false,
          updatedAt: timestamp,
        };
        context.channelBindings[index] = unbound;
        return clone(unbound);
      },
    );
  }

  listNotificationPreferences(scope: CollaborationScope): NotificationPreference[] {
    return this.store.listNotificationPreferences(normalizeScope(scope));
  }

  getNotificationPreference(
    scope: CollaborationScope,
    query: NotificationPreferenceQuery,
  ): NotificationPreference | undefined {
    const normalizedScope = normalizeScope(scope);
    const identity = normalizeSubscriptionQuery(query, 'notification preference');
    return this.store.findNotificationPreference(
      normalizedScope,
      identity.target,
      identity.delivery,
      identity.channelId,
    );
  }

  async setNotificationPreference(
    scope: CollaborationScope,
    input: NotificationPreferenceInput,
  ): Promise<NotificationPreference> {
    const normalizedScope = normalizeScope(scope);
    const normalized = normalizeNotificationPreferenceInput(input);
    const timestamp = this.timestamp();
    return this.runMutation(
      normalizedScope,
      'set-notification-preference',
      normalized.mutationKey,
      {
        target: normalized.target,
        delivery: normalized.delivery,
        channelId: normalized.channelId,
        level: normalized.level,
        digestPeriod: normalized.digestPeriod,
      },
      (context) => {
        const index = context.notificationPreferences.findIndex((preference) =>
          samePreferenceIdentity(
            preference,
            normalizedScope,
            normalized.target,
            normalized.delivery,
            normalized.channelId,
          ),
        );
        if (index !== -1) {
          const current = context.notificationPreferences[index]!;
          if (current.level === normalized.level && current.digestPeriod === normalized.digestPeriod) {
            return clone(current);
          }
          const updated = clone(current);
          updated.level = normalized.level;
          if (normalized.digestPeriod) updated.digestPeriod = normalized.digestPeriod;
          else delete updated.digestPeriod;
          updated.updatedAt = timestamp;
          context.notificationPreferences[index] = updated;
          return clone(updated);
        }

        const preference: NotificationPreference = {
          id: createId('notification-preference'),
          tenantId: normalizedScope.tenantId,
          conversationId: normalizedScope.conversationId,
          requesterId: normalizedScope.requesterId,
          target: normalized.target,
          delivery: normalized.delivery,
          ...(normalized.channelId ? { channelId: normalized.channelId } : {}),
          level: normalized.level,
          ...(normalized.digestPeriod ? { digestPeriod: normalized.digestPeriod } : {}),
          updatedAt: timestamp,
        };
        context.notificationPreferences.unshift(preference);
        return clone(preference);
      },
    );
  }

  async recordUpdate(scope: CollaborationScope, input: CollaborationUpdateInput): Promise<CollaborationNotification> {
    const normalizedScope = normalizeScope(scope);
    const normalized = normalizeUpdateInput(input, this.timestamp());
    const createdAt = this.timestamp();
    return this.runMutation(
      normalizedScope,
      'record-update',
      normalized.mutationKey,
      {
        target: normalized.target,
        title: normalized.title,
        body: normalized.body,
        mentionUserIds: normalized.mentionUserIds,
        channelId: normalized.channelId,
        occurredAt: normalized.occurredAt,
      },
      (context) => {
        const notification: CollaborationNotification = {
          id: createId('notification'),
          tenantId: normalizedScope.tenantId,
          conversationId: normalizedScope.conversationId,
          createdBy: normalizedScope.requesterId,
          target: normalized.target,
          kind: 'update',
          title: normalized.title,
          body: normalized.body,
          mentionUserIds: normalized.mentionUserIds,
          ...(normalized.channelId ? { channelId: normalized.channelId } : {}),
          occurredAt: normalized.occurredAt,
          deepLink: buildCollaborationDeepLink(normalized.target),
          createdAt,
        };
        context.notifications.unshift(notification);
        trimNotifications(context.notifications);
        return clone(notification);
      },
    );
  }

  async recordReminder(scope: CollaborationScope, input: CollaborationReminderInput): Promise<CollaborationNotification> {
    const normalizedScope = normalizeScope(scope);
    const normalized = normalizeReminderInput(input, this.timestamp());
    const createdAt = this.timestamp();
    return this.runMutation(
      normalizedScope,
      'record-reminder',
      normalized.mutationKey,
      {
        target: normalized.target,
        title: normalized.title,
        body: normalized.body,
        mentionUserIds: normalized.mentionUserIds,
        channelId: normalized.channelId,
        remindAt: normalized.remindAt,
      },
      (context) => {
        const notification: CollaborationNotification = {
          id: createId('notification'),
          tenantId: normalizedScope.tenantId,
          conversationId: normalizedScope.conversationId,
          createdBy: normalizedScope.requesterId,
          target: normalized.target,
          kind: 'reminder',
          title: normalized.title,
          body: normalized.body,
          mentionUserIds: normalized.mentionUserIds,
          ...(normalized.channelId ? { channelId: normalized.channelId } : {}),
          occurredAt: normalized.remindAt,
          remindAt: normalized.remindAt,
          deepLink: buildCollaborationDeepLink(normalized.target),
          createdAt,
        };
        context.notifications.unshift(notification);
        trimNotifications(context.notifications);
        return clone(notification);
      },
    );
  }

  notifications(
    scope: CollaborationScope,
    query: CollaborationNotificationQuery = {},
  ): CollaborationNotification[] {
    const normalizedScope = normalizeScope(scope);
    const normalizedQuery = normalizeNotificationQuery(query);
    const subscriptions = this.store.listSubscriptions(normalizedScope);
    const events = this.store.listNotifications(normalizedScope)
      .filter((notification) => !normalizedQuery.from || notification.occurredAt >= normalizedQuery.from)
      .filter((notification) => !normalizedQuery.to || notification.occurredAt < normalizedQuery.to)
      .filter((notification) => isImmediateForRequester(notification, normalizedScope.requesterId, subscriptions, this.store, normalizedScope));

    return sortNotifications(events).slice(0, normalizedQuery.limit);
  }

  getNotifications(
    scope: CollaborationScope,
    query: CollaborationNotificationQuery = {},
  ): CollaborationNotification[] {
    return this.notifications(scope, query);
  }

  digest(scope: CollaborationScope, query: CollaborationDigestQuery): CollaborationDigest {
    const normalizedScope = normalizeScope(scope);
    const normalizedQuery = normalizeDigestQuery(query, this.timestamp());
    const subscriptions = this.store.listSubscriptions(normalizedScope);
    const events = this.store.listNotifications(normalizedScope)
      .filter((notification) => notification.occurredAt >= normalizedQuery.from)
      .filter((notification) => notification.occurredAt < normalizedQuery.to)
      .filter((notification) => isDigestForRequester(notification, subscriptions, this.store, normalizedScope));

    const groups = new Map<string, CollaborationNotification[]>();
    for (const event of events) {
      const key = `${event.target.type}\u0000${event.target.id}\u0000${event.kind}`;
      const group = groups.get(key) ?? [];
      group.push(event);
      groups.set(key, group);
    }

    const entries: CollaborationDigestEntry[] = [...groups.values()]
      .map((group) => {
        const ordered = [...group].sort(compareNotificationAscending);
        const first = ordered[0]!;
        const latest = ordered.at(-1)!;
        return {
          target: clone(latest.target),
          kind: latest.kind,
          title: latest.title,
          body: latest.body,
          count: ordered.length,
          eventIds: ordered.map((event) => event.id),
          firstOccurredAt: first.occurredAt,
          lastOccurredAt: latest.occurredAt,
          deepLink: buildCollaborationDeepLink(latest.target),
        } satisfies CollaborationDigestEntry;
      })
      .sort((left, right) =>
        right.lastOccurredAt.localeCompare(left.lastOccurredAt) ||
        right.kind.localeCompare(left.kind) ||
        resourceName(right.target).localeCompare(resourceName(left.target)),
      );

    return {
      period: normalizedQuery.period,
      from: normalizedQuery.from,
      to: normalizedQuery.to,
      totalCount: events.length,
      entries,
    };
  }

  dailyDigest(scope: CollaborationScope, at?: string): CollaborationDigest {
    return this.digest(scope, { period: 'daily', ...(at ? { at } : {}) });
  }

  weeklyDigest(scope: CollaborationScope, at?: string): CollaborationDigest {
    return this.digest(scope, { period: 'weekly', ...(at ? { at } : {}) });
  }

  monthlyDigest(scope: CollaborationScope, at?: string): CollaborationDigest {
    return this.digest(scope, { period: 'monthly', ...(at ? { at } : {}) });
  }

  private async runMutation<T extends Record<string, unknown>>(
    scope: CollaborationScope,
    operation: Parameters<CollaborationStore['runMutation']>[2],
    mutationKey: string,
    payload: unknown,
    action: (context: CollaborationMutationContext) => T,
  ): Promise<T> {
    return this.store.runMutation(
      scope,
      mutationKey,
      operation,
      stableStringify({ operation, payload }),
      action,
    );
  }

  private timestamp(): string {
    const date = this.clock();
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new CollaborationValidationError('collaboration clock must return a valid Date');
    }
    return date.toISOString();
  }
}

type NormalizedSubscriptionIdentity = {
  target: CollaborationTarget;
  delivery: CollaborationDelivery;
  channelId?: string;
};

type NormalizedFollowInput = NormalizedSubscriptionIdentity & {
  mutationKey: string;
};

type NormalizedChannelBindingInput = {
  mutationKey: string;
  target: CollaborationTarget;
  channelId: string;
  metadata: Record<string, string>;
};

type NormalizedNotificationPreferenceInput = NormalizedSubscriptionIdentity & {
  mutationKey: string;
  level: NotificationLevel;
  digestPeriod?: DigestPeriod;
};

type NormalizedUpdateInput = {
  mutationKey: string;
  target: CollaborationTarget;
  title: string;
  body: string;
  mentionUserIds: string[];
  channelId?: string;
  occurredAt: string;
};

type NormalizedReminderInput = Omit<NormalizedUpdateInput, 'occurredAt'> & {
  remindAt: string;
};

type NormalizedNotificationQuery = {
  from?: string;
  to?: string;
  limit: number;
};

type NormalizedDigestQuery = {
  period: DigestPeriod;
  from: string;
  to: string;
};

function normalizeScope(scope: CollaborationScope): CollaborationScope {
  if (!scope || typeof scope !== 'object') throw new CollaborationValidationError('collaboration scope is required');
  return {
    tenantId: normalizeText(scope.tenantId, 'tenantId', MAX_COLLABORATION_SCOPE_VALUE_LENGTH),
    requesterId: normalizeText(scope.requesterId, 'requesterId', MAX_COLLABORATION_SCOPE_VALUE_LENGTH),
    conversationId: normalizeText(scope.conversationId, 'conversationId', MAX_COLLABORATION_SCOPE_VALUE_LENGTH),
  };
}

function normalizeFollowInput(input: CollaborationFollowInput): NormalizedFollowInput {
  if (!input || typeof input !== 'object') throw new CollaborationValidationError('follow input is required');
  const identity = normalizeSubscriptionIdentity(input, 'follow');
  return {
    mutationKey: normalizeMutationKey(input.mutationKey),
    ...identity,
  };
}

function normalizeSubscriptionQuery(
  input: CollaborationSubscriptionQuery,
  label: string,
): NormalizedSubscriptionIdentity {
  if (!input || typeof input !== 'object') throw new CollaborationValidationError(`${label} query is required`);
  return normalizeSubscriptionIdentity(input, label);
}

function normalizeSubscriptionIdentity(
  input: CollaborationSubscriptionQuery,
  label: string,
): NormalizedSubscriptionIdentity {
  const target = normalizeTarget(input.target, `${label}.target`);
  const delivery = normalizeDelivery(input.delivery, input.channelId, label);
  return {
    target,
    delivery: delivery.delivery,
    ...(delivery.channelId ? { channelId: delivery.channelId } : {}),
  };
}

function normalizeChannelBindingInput(input: ChannelBindingInput): NormalizedChannelBindingInput {
  if (!input || typeof input !== 'object') throw new CollaborationValidationError('channel binding input is required');
  const target = normalizeTarget(input.target, 'bind.target');
  const channelId = normalizeText(input.channelId, 'channelId', MAX_COLLABORATION_SCOPE_VALUE_LENGTH);
  return {
    mutationKey: normalizeMutationKey(input.mutationKey),
    target,
    channelId,
    metadata: normalizeMetadata(input.metadata),
  };
}

function normalizeChannelUnbindingInput(input: ChannelUnbindingInput): ChannelBindingQuery & { mutationKey: string } {
  if (!input || typeof input !== 'object') throw new CollaborationValidationError('channel unbinding input is required');
  return {
    mutationKey: normalizeMutationKey(input.mutationKey),
    target: normalizeTarget(input.target, 'unbind.target'),
    channelId: normalizeText(input.channelId, 'channelId', MAX_COLLABORATION_SCOPE_VALUE_LENGTH),
  };
}

function normalizeChannelBindingQuery(input: ChannelBindingQuery): ChannelBindingQuery {
  if (!input || typeof input !== 'object') throw new CollaborationValidationError('channel binding query is required');
  return {
    target: normalizeTarget(input.target, 'channel binding.target'),
    channelId: normalizeText(input.channelId, 'channelId', MAX_COLLABORATION_SCOPE_VALUE_LENGTH),
  };
}

function normalizeNotificationPreferenceInput(input: NotificationPreferenceInput): NormalizedNotificationPreferenceInput {
  if (!input || typeof input !== 'object') {
    throw new CollaborationValidationError('notification preference input is required');
  }
  const identity = normalizeSubscriptionIdentity(input, 'notification preference');
  const level = normalizeEnum(input.level, NOTIFICATION_LEVELS, 'level');
  if (level === 'digest') {
    return {
      mutationKey: normalizeMutationKey(input.mutationKey),
      ...identity,
      level,
      digestPeriod: normalizeEnum(input.digestPeriod ?? 'weekly', DIGEST_PERIODS, 'digestPeriod'),
    };
  }
  if (input.digestPeriod !== undefined) {
    throw new CollaborationValidationError('digestPeriod is only valid for digest preferences');
  }
  return {
    mutationKey: normalizeMutationKey(input.mutationKey),
    ...identity,
    level,
  };
}

function normalizeUpdateInput(input: CollaborationUpdateInput, defaultOccurredAt: string): NormalizedUpdateInput {
  if (!input || typeof input !== 'object') throw new CollaborationValidationError('update input is required');
  return {
    mutationKey: normalizeMutationKey(input.mutationKey),
    target: normalizeTarget(input.target, 'update.target'),
    title: normalizeText(input.title, 'title', MAX_COLLABORATION_TITLE_LENGTH),
    body: normalizeOptionalText(input.body ?? '', 'body', MAX_COLLABORATION_BODY_LENGTH),
    mentionUserIds: normalizeIds(input.mentionUserIds ?? [], 'mentionUserIds', MAX_COLLABORATION_MENTION_IDS),
    ...(input.channelId !== undefined
      ? { channelId: normalizeText(input.channelId, 'channelId', MAX_COLLABORATION_SCOPE_VALUE_LENGTH) }
      : {}),
    occurredAt: input.occurredAt === undefined
      ? defaultOccurredAt
      : normalizeTimestamp(input.occurredAt, 'occurredAt'),
  };
}

function normalizeReminderInput(input: CollaborationReminderInput, defaultRemindAt: string): NormalizedReminderInput {
  if (!input || typeof input !== 'object') throw new CollaborationValidationError('reminder input is required');
  const remindAt = input.remindAt === undefined
    ? defaultRemindAt
    : normalizeTimestamp(input.remindAt, 'remindAt');
  return {
    mutationKey: normalizeMutationKey(input.mutationKey),
    target: normalizeTarget(input.target, 'reminder.target'),
    title: normalizeText(input.title, 'title', MAX_COLLABORATION_TITLE_LENGTH),
    body: normalizeOptionalText(input.body ?? '', 'body', MAX_COLLABORATION_BODY_LENGTH),
    mentionUserIds: normalizeIds(input.mentionUserIds ?? [], 'mentionUserIds', MAX_COLLABORATION_MENTION_IDS),
    ...(input.channelId !== undefined
      ? { channelId: normalizeText(input.channelId, 'channelId', MAX_COLLABORATION_SCOPE_VALUE_LENGTH) }
      : {}),
    remindAt,
  };
}

function normalizeNotificationQuery(query: CollaborationNotificationQuery): NormalizedNotificationQuery {
  if (!query || typeof query !== 'object') throw new CollaborationValidationError('notification query must be an object');
  const from = query.from === undefined ? undefined : normalizeTimestamp(query.from, 'notifications.from');
  const to = query.to === undefined ? undefined : normalizeTimestamp(query.to, 'notifications.to');
  if (from && to && from >= to) throw new CollaborationValidationError('notifications.from must be before notifications.to');
  return {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    limit: normalizeLimit(query.limit ?? MAX_QUERY_LIMIT),
  };
}

function normalizeDigestQuery(query: CollaborationDigestQuery, defaultAt: string): NormalizedDigestQuery {
  if (!query || typeof query !== 'object') throw new CollaborationValidationError('digest query is required');
  const period = normalizeEnum(query.period, DIGEST_PERIODS, 'period');
  const at = query.at === undefined ? defaultAt : normalizeTimestamp(query.at, 'digest.at');
  const anchor = new Date(at);
  const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()));
  if (period === 'weekly') {
    const mondayOffset = (start.getUTCDay() + 6) % 7;
    start.setUTCDate(start.getUTCDate() - mondayOffset);
  } else if (period === 'monthly') {
    start.setUTCDate(1);
  }
  const end = new Date(start);
  if (period === 'daily') end.setUTCDate(end.getUTCDate() + 1);
  if (period === 'weekly') end.setUTCDate(end.getUTCDate() + 7);
  if (period === 'monthly') end.setUTCMonth(end.getUTCMonth() + 1);
  return {
    period,
    from: start.toISOString(),
    to: end.toISOString(),
  };
}

function normalizeTarget(value: unknown, label: string): CollaborationTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CollaborationValidationError(`${label} must be an object`);
  }
  const candidate = value as Partial<CollaborationTarget>;
  return {
    type: normalizeEnum(candidate.type, COLLABORATION_TARGET_TYPES, `${label}.type`),
    id: normalizeText(candidate.id, `${label}.id`, MAX_COLLABORATION_ID_LENGTH),
  };
}

function normalizeDelivery(
  value: CollaborationDelivery | undefined,
  channelId: string | undefined,
  label: string,
): { delivery: CollaborationDelivery; channelId?: string } {
  const delivery = normalizeEnum(value ?? 'personal', COLLABORATION_DELIVERIES, `${label}.delivery`);
  if (delivery === 'channel') {
    return {
      delivery,
      channelId: normalizeText(channelId, `${label}.channelId`, MAX_COLLABORATION_SCOPE_VALUE_LENGTH),
    };
  }
  if (channelId !== undefined) {
    throw new CollaborationValidationError(`${label}.channelId is only valid for channel delivery`);
  }
  return { delivery };
}

function normalizeMetadata(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CollaborationValidationError('metadata must be an object');
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_COLLABORATION_METADATA_ENTRIES) {
    throw new CollaborationValidationError(`metadata must contain ${MAX_COLLABORATION_METADATA_ENTRIES} entries or fewer`);
  }
  const metadata: Record<string, string> = {};
  for (const [key, entry] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    const normalizedKey = normalizeText(key, 'metadata key', MAX_COLLABORATION_METADATA_KEY_LENGTH);
    metadata[normalizedKey] = normalizeOptionalText(
      entry,
      `metadata.${normalizedKey}`,
      MAX_COLLABORATION_METADATA_VALUE_LENGTH,
    );
  }
  return metadata;
}

function normalizeIds(value: unknown, label: string, maxEntries: number): string[] {
  if (!Array.isArray(value)) throw new CollaborationValidationError(`${label} must be an array`);
  if (value.length > maxEntries) throw new CollaborationValidationError(`${label} has too many entries`);
  const ids = value.map((entry) => normalizeText(entry, label, MAX_COLLABORATION_SCOPE_VALUE_LENGTH));
  if (new Set(ids).size !== ids.length) throw new CollaborationValidationError(`${label} must not contain duplicates`);
  return ids.sort((left, right) => left.localeCompare(right));
}

function normalizeMutationKey(value: unknown): string {
  return normalizeText(value, 'mutationKey', 200);
}

function normalizeText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new CollaborationValidationError(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw new CollaborationValidationError(`${label} is required`);
  if (normalized.length > maxLength) {
    throw new CollaborationValidationError(`${label} must be ${maxLength} characters or fewer`);
  }
  if (CONTROL_CHARACTERS.test(normalized)) {
    throw new CollaborationValidationError(`${label} contains unsupported control characters`);
  }
  return normalized;
}

function normalizeOptionalText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new CollaborationValidationError(`${label} must be a string`);
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new CollaborationValidationError(`${label} must be ${maxLength} characters or fewer`);
  }
  if (CONTROL_CHARACTERS.test(normalized)) {
    throw new CollaborationValidationError(`${label} contains unsupported control characters`);
  }
  return normalized;
}

function normalizeTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 40) {
    throw new CollaborationValidationError(`${label} must be a canonical ISO timestamp`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new CollaborationValidationError(`${label} must be a canonical ISO timestamp`);
  }
  return value;
}

function normalizeEnum<T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  if (!(allowed as readonly unknown[]).includes(value)) {
    throw new CollaborationValidationError(`${label} is not supported`);
  }
  return value as T[number];
}

function normalizeLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MAX_QUERY_LIMIT) {
    throw new CollaborationValidationError(`limit must be an integer between 1 and ${MAX_QUERY_LIMIT}`);
  }
  return value;
}

function sameSubscriptionIdentity(
  subscription: CollaborationSubscription,
  scope: CollaborationScope,
  target: CollaborationTarget,
  delivery: CollaborationDelivery,
  channelId?: string,
): boolean {
  return subscription.tenantId === scope.tenantId &&
    subscription.conversationId === scope.conversationId &&
    subscription.requesterId === scope.requesterId &&
    sameTarget(subscription.target, target) &&
    subscription.delivery === delivery &&
    subscription.channelId === channelId;
}

function samePreferenceIdentity(
  preference: NotificationPreference,
  scope: CollaborationScope,
  target: CollaborationTarget,
  delivery: CollaborationDelivery,
  channelId?: string,
): boolean {
  return preference.tenantId === scope.tenantId &&
    preference.conversationId === scope.conversationId &&
    preference.requesterId === scope.requesterId &&
    sameTarget(preference.target, target) &&
    preference.delivery === delivery &&
    preference.channelId === channelId;
}

function isImmediateForRequester(
  notification: CollaborationNotification,
  requesterId: string,
  subscriptions: CollaborationSubscription[],
  store: CollaborationStore,
  scope: CollaborationScope,
): boolean {
  return subscriptions.some((subscription) => {
    if (!sameTarget(subscription.target, notification.target)) return false;
    if (subscription.delivery === 'channel' && subscription.channelId !== notification.channelId) return false;
    const preference = store.findNotificationPreference(
      scope,
      subscription.target,
      subscription.delivery,
      subscription.channelId,
    );
    const level = preference?.level ?? 'all';
    return level === 'all' || (level === 'mentions' && notification.mentionUserIds.includes(requesterId));
  });
}

function isDigestForRequester(
  notification: CollaborationNotification,
  subscriptions: CollaborationSubscription[],
  store: CollaborationStore,
  scope: CollaborationScope,
): boolean {
  return subscriptions.some((subscription) => {
    if (!sameTarget(subscription.target, notification.target)) return false;
    if (subscription.delivery === 'channel' && subscription.channelId !== notification.channelId) return false;
    const preference = store.findNotificationPreference(
      scope,
      subscription.target,
      subscription.delivery,
      subscription.channelId,
    );
    return preference?.level === 'digest';
  });
}

function sortNotifications(notifications: CollaborationNotification[]): CollaborationNotification[] {
  return notifications
    .sort((left, right) =>
      right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id),
    )
    .map(clone);
}

function compareNotificationAscending(left: CollaborationNotification, right: CollaborationNotification): number {
  return left.occurredAt.localeCompare(right.occurredAt) || left.id.localeCompare(right.id);
}

function trimNotifications(notifications: CollaborationNotification[]): void {
  if (notifications.length > MAX_COLLABORATION_NOTIFICATIONS) {
    notifications.splice(MAX_COLLABORATION_NOTIFICATIONS);
  }
}

function resourceName(target: CollaborationTarget): string {
  return `${target.type}:${target.id}`;
}

function sameTarget(left: CollaborationTarget, right: CollaborationTarget): boolean {
  return left.type === right.type && left.id === right.id;
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 12)}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
