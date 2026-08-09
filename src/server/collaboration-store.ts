import { atomicWriteJson, readAtomicJsonStore } from './atomic-file.js';
import {
  buildCollaborationDeepLink,
  COLLABORATION_DELIVERIES,
  COLLABORATION_NOTIFICATION_KINDS,
  COLLABORATION_TARGET_TYPES,
  CollaborationIdempotencyConflictError,
  DIGEST_PERIODS,
  NOTIFICATION_LEVELS,
  type ChannelBinding,
  type CollaborationMutationOperation,
  type CollaborationNotification,
  type CollaborationScope,
  type CollaborationSubscription,
  type CollaborationTarget,
  type NotificationPreference,
} from '../shared/collaboration.js';

export { CollaborationIdempotencyConflictError } from '../shared/collaboration.js';

export const COLLABORATION_STORE_VERSION = 1 as const;
export const MAX_COLLABORATION_SCOPE_VALUE_LENGTH = 256;
export const MAX_COLLABORATION_ID_LENGTH = 200;
export const MAX_COLLABORATION_TITLE_LENGTH = 400;
export const MAX_COLLABORATION_BODY_LENGTH = 4_000;
export const MAX_COLLABORATION_METADATA_ENTRIES = 40;
export const MAX_COLLABORATION_METADATA_KEY_LENGTH = 120;
export const MAX_COLLABORATION_METADATA_VALUE_LENGTH = 1_000;
export const MAX_COLLABORATION_MENTION_IDS = 100;
export const MAX_COLLABORATION_NOTIFICATIONS = 5_000;
export const MAX_COLLABORATION_MUTATION_KEY_LENGTH = 200;

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

export type CollaborationMutationRecord = CollaborationScope & {
  mutationKey: string;
  operation: CollaborationMutationOperation;
  fingerprint: string;
  result: Record<string, unknown>;
  createdAt: string;
};

export type CollaborationMutationContext = {
  subscriptions: CollaborationSubscription[];
  channelBindings: ChannelBinding[];
  notificationPreferences: NotificationPreference[];
  notifications: CollaborationNotification[];
};

type PersistedStore = CollaborationMutationContext & {
  version: typeof COLLABORATION_STORE_VERSION;
  mutations: CollaborationMutationRecord[];
};

export class CollaborationStore {
  private subscriptions: CollaborationSubscription[] = [];
  private channelBindings: ChannelBinding[] = [];
  private notificationPreferences: NotificationPreference[] = [];
  private notifications: CollaborationNotification[] = [];
  private mutations: CollaborationMutationRecord[] = [];
  private writeQueue: Promise<void> = Promise.resolve();
  private mutationQueue: Promise<void> = Promise.resolve();
  private initialized = false;

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    try {
      const raw = await readAtomicJsonStore(this.filePath);
      const loaded = loadStore(JSON.parse(raw) as unknown, this.filePath);
      this.subscriptions = loaded.subscriptions;
      this.channelBindings = loaded.channelBindings;
      this.notificationPreferences = loaded.notificationPreferences;
      this.notifications = loaded.notifications;
      this.mutations = loaded.mutations;
      this.initialized = true;
    } catch (error) {
      if (!isFileNotFound(error)) throw error;
      this.subscriptions = [];
      this.channelBindings = [];
      this.notificationPreferences = [];
      this.notifications = [];
      this.mutations = [];
      this.initialized = true;
      await this.persist();
    }
  }

  listSubscriptions(scope: CollaborationScope): CollaborationSubscription[] {
    this.assertInitialized();
    return this.subscriptions
      .filter((subscription) =>
        subscription.active &&
        subscription.tenantId === scope.tenantId &&
        subscription.conversationId === scope.conversationId &&
        subscription.requesterId === scope.requesterId,
      )
      .map(clone);
  }

  findSubscription(
    scope: CollaborationScope,
    target: CollaborationTarget,
    delivery: CollaborationSubscription['delivery'],
    channelId?: string,
  ): CollaborationSubscription | undefined {
    this.assertInitialized();
    const subscription = this.subscriptions.find((candidate) =>
      candidate.tenantId === scope.tenantId &&
      candidate.conversationId === scope.conversationId &&
      candidate.requesterId === scope.requesterId &&
      sameTarget(candidate.target, target) &&
      candidate.delivery === delivery &&
      candidate.channelId === channelId,
    );
    return subscription ? clone(subscription) : undefined;
  }

  listChannelBindings(scope: CollaborationScope): ChannelBinding[] {
    this.assertInitialized();
    return this.channelBindings
      .filter((binding) =>
        binding.active &&
        binding.tenantId === scope.tenantId &&
        binding.conversationId === scope.conversationId,
      )
      .map(clone);
  }

  findChannelBinding(
    scope: CollaborationScope,
    target: CollaborationTarget,
    channelId: string,
  ): ChannelBinding | undefined {
    this.assertInitialized();
    const binding = this.channelBindings.find((candidate) =>
      candidate.tenantId === scope.tenantId &&
      candidate.conversationId === scope.conversationId &&
      sameTarget(candidate.target, target) &&
      candidate.channelId === channelId,
    );
    return binding ? clone(binding) : undefined;
  }

  listNotificationPreferences(scope: CollaborationScope): NotificationPreference[] {
    this.assertInitialized();
    return this.notificationPreferences
      .filter((preference) =>
        preference.tenantId === scope.tenantId &&
        preference.conversationId === scope.conversationId &&
        preference.requesterId === scope.requesterId,
      )
      .map(clone);
  }

  findNotificationPreference(
    scope: CollaborationScope,
    target: CollaborationTarget,
    delivery: NotificationPreference['delivery'],
    channelId?: string,
  ): NotificationPreference | undefined {
    this.assertInitialized();
    const preference = this.notificationPreferences.find((candidate) =>
      candidate.tenantId === scope.tenantId &&
      candidate.conversationId === scope.conversationId &&
      candidate.requesterId === scope.requesterId &&
      sameTarget(candidate.target, target) &&
      candidate.delivery === delivery &&
      candidate.channelId === channelId,
    );
    return preference ? clone(preference) : undefined;
  }

  listNotifications(scope: CollaborationScope): CollaborationNotification[] {
    this.assertInitialized();
    return this.notifications
      .filter((notification) =>
        notification.tenantId === scope.tenantId &&
        notification.conversationId === scope.conversationId,
      )
      .map(clone);
  }

  async runMutation<T extends Record<string, unknown>>(
    scope: CollaborationScope,
    mutationKey: string,
    operation: CollaborationMutationOperation,
    fingerprint: string,
    action: (context: CollaborationMutationContext) => T,
  ): Promise<T> {
    this.assertInitialized();
    assertMutationKey(mutationKey);
    if (!fingerprint) throw new Error('collaboration mutation fingerprint is required');

    const next = this.mutationQueue.then(async () => {
      const previous = this.findMutation(scope, mutationKey);
      if (previous) {
        if (previous.operation !== operation || previous.fingerprint !== fingerprint) {
          throw new CollaborationIdempotencyConflictError(mutationKey);
        }
        return clone(previous.result) as T;
      }

      const previousState = this.snapshotState();
      try {
        const result = action(this.context());
        if (!isRecord(result)) throw new Error('collaboration mutation result must be an object');
        const mutation: CollaborationMutationRecord = {
          tenantId: scope.tenantId,
          requesterId: scope.requesterId,
          conversationId: scope.conversationId,
          mutationKey,
          operation,
          fingerprint,
          result: clone(result),
          createdAt: new Date().toISOString(),
        };
        this.mutations.unshift(mutation);
        validateStore({ ...this.context(), mutations: this.mutations }, this.filePath);
        await this.persist();
        return clone(result) as T;
      } catch (error) {
        this.restoreState(previousState);
        throw error;
      }
    });

    this.mutationQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  private context(): CollaborationMutationContext {
    return {
      subscriptions: this.subscriptions,
      channelBindings: this.channelBindings,
      notificationPreferences: this.notificationPreferences,
      notifications: this.notifications,
    };
  }

  private snapshotState(): CollaborationMutationContext & { mutations: CollaborationMutationRecord[] } {
    return {
      subscriptions: clone(this.subscriptions),
      channelBindings: clone(this.channelBindings),
      notificationPreferences: clone(this.notificationPreferences),
      notifications: clone(this.notifications),
      mutations: clone(this.mutations),
    };
  }

  private restoreState(snapshot: CollaborationMutationContext & { mutations: CollaborationMutationRecord[] }): void {
    this.subscriptions = snapshot.subscriptions;
    this.channelBindings = snapshot.channelBindings;
    this.notificationPreferences = snapshot.notificationPreferences;
    this.notifications = snapshot.notifications;
    this.mutations = snapshot.mutations;
  }

  private findMutation(scope: CollaborationScope, mutationKey: string): CollaborationMutationRecord | undefined {
    return this.mutations.find((mutation) =>
      mutation.mutationKey === mutationKey && sameScope(mutation, scope),
    );
  }

  private async persist(): Promise<void> {
    const snapshot: PersistedStore = {
      version: COLLABORATION_STORE_VERSION,
      subscriptions: clone(this.subscriptions),
      channelBindings: clone(this.channelBindings),
      notificationPreferences: clone(this.notificationPreferences),
      notifications: clone(this.notifications),
      mutations: clone(this.mutations),
    };
    const nextWrite = this.writeQueue.then(() => atomicWriteJson(this.filePath, snapshot));
    this.writeQueue = nextWrite.catch(() => undefined);
    await nextWrite;
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('CollaborationStore.initialize() must complete before use');
  }
}

function loadStore(value: unknown, filePath: string): PersistedStore {
  if (!isRecord(value) || value.version !== COLLABORATION_STORE_VERSION) {
    throw invalidStore(filePath, 'version must be 1');
  }
  if (!Array.isArray(value.subscriptions)) throw invalidStore(filePath, 'subscriptions must be an array');
  if (!Array.isArray(value.channelBindings)) throw invalidStore(filePath, 'channelBindings must be an array');
  if (!Array.isArray(value.notificationPreferences)) {
    throw invalidStore(filePath, 'notificationPreferences must be an array');
  }
  if (!Array.isArray(value.notifications)) throw invalidStore(filePath, 'notifications must be an array');
  if (!Array.isArray(value.mutations)) throw invalidStore(filePath, 'mutations must be an array');

  const subscriptions = value.subscriptions.map((record, index) => {
    const parsed = record as CollaborationSubscription;
    validateSubscription(parsed, `subscriptions[${index}]`);
    return clone(parsed);
  });
  const channelBindings = value.channelBindings.map((record, index) => {
    const parsed = record as ChannelBinding;
    validateChannelBinding(parsed, `channelBindings[${index}]`);
    return clone(parsed);
  });
  const notificationPreferences = value.notificationPreferences.map((record, index) => {
    const parsed = record as NotificationPreference;
    validateNotificationPreference(parsed, `notificationPreferences[${index}]`);
    return clone(parsed);
  });
  const notifications = value.notifications.map((record, index) => {
    const parsed = record as CollaborationNotification;
    validateNotification(parsed, `notifications[${index}]`);
    return clone(parsed);
  });
  const mutations = value.mutations.map((record, index) => {
    const parsed = record as CollaborationMutationRecord;
    validateMutation(parsed, `mutations[${index}]`);
    return clone(parsed);
  });

  validateStore({
    subscriptions,
    channelBindings,
    notificationPreferences,
    notifications,
    mutations,
  }, filePath);
  return {
    version: COLLABORATION_STORE_VERSION,
    subscriptions,
    channelBindings,
    notificationPreferences,
    notifications,
    mutations,
  };
}

function validateStore(
  state: CollaborationMutationContext & { mutations: CollaborationMutationRecord[] },
  filePath: string,
): void {
  try {
    const subscriptionIds = new Set<string>();
    const subscriptionKeys = new Set<string>();
    for (const subscription of state.subscriptions) {
      validateSubscription(subscription, 'subscription');
      if (subscriptionIds.has(subscription.id)) throw new Error('subscription ids must be unique');
      subscriptionIds.add(subscription.id);
      const key = subscriptionKey(subscription);
      if (subscriptionKeys.has(key)) throw new Error('subscription identities must be unique');
      subscriptionKeys.add(key);
    }

    const bindingIds = new Set<string>();
    const bindingKeys = new Set<string>();
    for (const binding of state.channelBindings) {
      validateChannelBinding(binding, 'channel binding');
      if (bindingIds.has(binding.id)) throw new Error('channel binding ids must be unique');
      bindingIds.add(binding.id);
      const key = channelBindingKey(binding);
      if (bindingKeys.has(key)) throw new Error('channel binding identities must be unique');
      bindingKeys.add(key);
    }

    const preferenceIds = new Set<string>();
    const preferenceKeys = new Set<string>();
    for (const preference of state.notificationPreferences) {
      validateNotificationPreference(preference, 'notification preference');
      if (preferenceIds.has(preference.id)) throw new Error('notification preference ids must be unique');
      preferenceIds.add(preference.id);
      const key = preferenceKey(preference);
      if (preferenceKeys.has(key)) throw new Error('notification preference identities must be unique');
      preferenceKeys.add(key);
    }

    const notificationIds = new Set<string>();
    for (const notification of state.notifications) {
      validateNotification(notification, 'notification');
      if (notificationIds.has(notification.id)) throw new Error('notification ids must be unique');
      notificationIds.add(notification.id);
    }

    const mutationKeys = new Set<string>();
    for (const mutation of state.mutations) {
      validateMutation(mutation, 'mutation');
      const key = mutationScopeKey(mutation, mutation.mutationKey);
      if (mutationKeys.has(key)) throw new Error('mutation keys must be unique within their scope');
      mutationKeys.add(key);
      assertMutationResultScope(mutation);
    }
  } catch (error) {
    throw invalidStore(filePath, errorMessage(error));
  }
}

function validateSubscription(value: CollaborationSubscription, label: string): void {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  assertText(value.id, `${label}.id`, MAX_COLLABORATION_ID_LENGTH, true);
  assertScope(value, label);
  assertTarget(value.target, `${label}.target`);
  assertDelivery(value.delivery, value.channelId, label);
  if (typeof value.active !== 'boolean') throw new Error(`${label}.active must be boolean`);
  assertDeepLink(value.target, value.deepLink, `${label}.deepLink`);
  assertTimestamp(value.createdAt, `${label}.createdAt`);
  assertTimestamp(value.updatedAt, `${label}.updatedAt`);
}

function validateChannelBinding(value: ChannelBinding, label: string): void {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  assertText(value.id, `${label}.id`, MAX_COLLABORATION_ID_LENGTH, true);
  assertText(value.tenantId, `${label}.tenantId`, MAX_COLLABORATION_SCOPE_VALUE_LENGTH, true);
  assertText(value.conversationId, `${label}.conversationId`, MAX_COLLABORATION_SCOPE_VALUE_LENGTH, true);
  assertTarget(value.target, `${label}.target`);
  assertText(value.channelId, `${label}.channelId`, MAX_COLLABORATION_SCOPE_VALUE_LENGTH, true);
  assertMetadata(value.metadata, `${label}.metadata`);
  assertText(value.boundBy, `${label}.boundBy`, MAX_COLLABORATION_SCOPE_VALUE_LENGTH, true);
  if (typeof value.active !== 'boolean') throw new Error(`${label}.active must be boolean`);
  assertDeepLink(value.target, value.deepLink, `${label}.deepLink`);
  assertTimestamp(value.createdAt, `${label}.createdAt`);
  assertTimestamp(value.updatedAt, `${label}.updatedAt`);
}

function validateNotificationPreference(value: NotificationPreference, label: string): void {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  assertText(value.id, `${label}.id`, MAX_COLLABORATION_ID_LENGTH, true);
  assertScope(value, label);
  assertTarget(value.target, `${label}.target`);
  assertDelivery(value.delivery, value.channelId, label);
  if (!(NOTIFICATION_LEVELS as readonly unknown[]).includes(value.level)) {
    throw new Error(`${label}.level is invalid`);
  }
  if (value.digestPeriod !== undefined && !(DIGEST_PERIODS as readonly unknown[]).includes(value.digestPeriod)) {
    throw new Error(`${label}.digestPeriod is invalid`);
  }
  if (value.level === 'digest' && value.digestPeriod === undefined) {
    throw new Error(`${label}.digestPeriod is required for digest preferences`);
  }
  if (value.level !== 'digest' && value.digestPeriod !== undefined) {
    throw new Error(`${label}.digestPeriod is only valid for digest preferences`);
  }
  assertTimestamp(value.updatedAt, `${label}.updatedAt`);
}

function validateNotification(value: CollaborationNotification, label: string): void {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  assertText(value.id, `${label}.id`, MAX_COLLABORATION_ID_LENGTH, true);
  assertText(value.tenantId, `${label}.tenantId`, MAX_COLLABORATION_SCOPE_VALUE_LENGTH, true);
  assertText(value.conversationId, `${label}.conversationId`, MAX_COLLABORATION_SCOPE_VALUE_LENGTH, true);
  assertText(value.createdBy, `${label}.createdBy`, MAX_COLLABORATION_SCOPE_VALUE_LENGTH, true);
  assertTarget(value.target, `${label}.target`);
  if (!(COLLABORATION_NOTIFICATION_KINDS as readonly unknown[]).includes(value.kind)) {
    throw new Error(`${label}.kind is invalid`);
  }
  assertText(value.title, `${label}.title`, MAX_COLLABORATION_TITLE_LENGTH, true);
  assertText(value.body, `${label}.body`, MAX_COLLABORATION_BODY_LENGTH, false);
  assertUniqueTextArray(
    value.mentionUserIds,
    `${label}.mentionUserIds`,
    MAX_COLLABORATION_SCOPE_VALUE_LENGTH,
    MAX_COLLABORATION_MENTION_IDS,
  );
  if (value.channelId !== undefined) {
    assertText(value.channelId, `${label}.channelId`, MAX_COLLABORATION_SCOPE_VALUE_LENGTH, true);
  }
  assertTimestamp(value.occurredAt, `${label}.occurredAt`);
  if (value.remindAt !== undefined) assertTimestamp(value.remindAt, `${label}.remindAt`);
  if (value.kind === 'reminder' && value.remindAt === undefined) {
    throw new Error(`${label}.remindAt is required for reminders`);
  }
  assertDeepLink(value.target, value.deepLink, `${label}.deepLink`);
  assertTimestamp(value.createdAt, `${label}.createdAt`);
}

function validateMutation(value: CollaborationMutationRecord, label: string): void {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  assertScope(value, label);
  assertText(value.mutationKey, `${label}.mutationKey`, MAX_COLLABORATION_MUTATION_KEY_LENGTH, true);
  if (![
    'follow',
    'unfollow',
    'bind-channel',
    'unbind-channel',
    'set-notification-preference',
    'record-update',
    'record-reminder',
  ].includes(value.operation)) {
    throw new Error(`${label}.operation is invalid`);
  }
  assertText(value.fingerprint, `${label}.fingerprint`, 20_000, true);
  if (!isRecord(value.result)) throw new Error(`${label}.result must be an object`);
  assertTimestamp(value.createdAt, `${label}.createdAt`);
}

function assertMutationResultScope(mutation: CollaborationMutationRecord): void {
  const result = mutation.result;
  if ('tenantId' in result && result.tenantId !== mutation.tenantId) {
    throw new Error('mutation result must remain in the mutation tenant scope');
  }
  if ('conversationId' in result && result.conversationId !== mutation.conversationId) {
    throw new Error('mutation result must remain in the mutation conversation scope');
  }
  if ('requesterId' in result && result.requesterId !== mutation.requesterId) {
    throw new Error('mutation result must remain in the mutation requester scope');
  }
  if ('createdBy' in result && result.createdBy !== mutation.requesterId) {
    throw new Error('notification mutation result must remain owned by the requester');
  }
}

function assertScope(value: CollaborationScope, label: string): void {
  assertText(value.tenantId, `${label}.tenantId`, MAX_COLLABORATION_SCOPE_VALUE_LENGTH, true);
  assertText(value.requesterId, `${label}.requesterId`, MAX_COLLABORATION_SCOPE_VALUE_LENGTH, true);
  assertText(value.conversationId, `${label}.conversationId`, MAX_COLLABORATION_SCOPE_VALUE_LENGTH, true);
}

function assertTarget(value: CollaborationTarget, label: string): void {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  if (!(COLLABORATION_TARGET_TYPES as readonly unknown[]).includes(value.type)) {
    throw new Error(`${label}.type is invalid`);
  }
  assertText(value.id, `${label}.id`, MAX_COLLABORATION_ID_LENGTH, true);
}

function assertDelivery(
  delivery: CollaborationSubscription['delivery'],
  channelId: string | undefined,
  label: string,
): void {
  if (!(COLLABORATION_DELIVERIES as readonly unknown[]).includes(delivery)) {
    throw new Error(`${label}.delivery is invalid`);
  }
  if (delivery === 'channel' && channelId === undefined) {
    throw new Error(`${label}.channelId is required for channel delivery`);
  }
  if (delivery === 'personal' && channelId !== undefined) {
    throw new Error(`${label}.channelId is only valid for channel delivery`);
  }
  if (channelId !== undefined) {
    assertText(channelId, `${label}.channelId`, MAX_COLLABORATION_SCOPE_VALUE_LENGTH, true);
  }
}

function assertDeepLink(
  target: CollaborationTarget,
  value: CollaborationSubscription['deepLink'],
  label: string,
): void {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const expected = buildCollaborationDeepLink(target);
  if (
    value.kind !== expected.kind ||
    value.targetType !== expected.targetType ||
    value.targetId !== expected.targetId ||
    value.path !== expected.path ||
    value.href !== expected.href
  ) {
    throw new Error(`${label} is not stable for the target`);
  }
}

function assertMetadata(value: unknown, label: string): asserts value is Record<string, string> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const keys = Object.keys(value);
  if (keys.length > MAX_COLLABORATION_METADATA_ENTRIES) {
    throw new Error(`${label} has too many entries`);
  }
  for (const key of keys) {
    assertText(key, `${label} key`, MAX_COLLABORATION_METADATA_KEY_LENGTH, true);
    assertText(value[key], `${label}.${key}`, MAX_COLLABORATION_METADATA_VALUE_LENGTH, false);
  }
}

function assertUniqueTextArray(
  values: unknown,
  label: string,
  maxEntryLength: number,
  maxEntries: number,
): asserts values is string[] {
  if (!Array.isArray(values)) throw new Error(`${label} must be an array`);
  if (values.length > maxEntries) throw new Error(`${label} has too many entries`);
  const seen = new Set<string>();
  for (const value of values) {
    assertText(value, label, maxEntryLength, true);
    if (seen.has(value)) throw new Error(`${label} must not contain duplicates`);
    seen.add(value);
  }
}

function assertMutationKey(value: string): void {
  assertText(value, 'mutationKey', MAX_COLLABORATION_MUTATION_KEY_LENGTH, true);
}

function assertText(value: unknown, label: string, maxLength: number, required: boolean): asserts value is string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  if (required && !value.trim()) throw new Error(`${label} is required`);
  if (value.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer`);
  if (CONTROL_CHARACTERS.test(value)) throw new Error(`${label} contains unsupported control characters`);
}

function assertTimestamp(value: unknown, label: string): void {
  if (typeof value !== 'string' || value.length > 40) throw new Error(`${label} must be a canonical ISO timestamp`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
}

function sameScope(left: CollaborationScope, right: CollaborationScope): boolean {
  return left.tenantId === right.tenantId &&
    left.requesterId === right.requesterId &&
    left.conversationId === right.conversationId;
}

function sameTarget(left: CollaborationTarget, right: CollaborationTarget): boolean {
  return left.type === right.type && left.id === right.id;
}

function subscriptionKey(subscription: CollaborationSubscription): string {
  return `${subscription.tenantId}\u0000${subscription.conversationId}\u0000${subscription.requesterId}\u0000${targetKey(subscription.target)}\u0000${subscription.delivery}\u0000${subscription.channelId ?? ''}`;
}

function channelBindingKey(binding: ChannelBinding): string {
  return `${binding.tenantId}\u0000${binding.conversationId}\u0000${targetKey(binding.target)}\u0000${binding.channelId}`;
}

function preferenceKey(preference: NotificationPreference): string {
  return `${preference.tenantId}\u0000${preference.conversationId}\u0000${preference.requesterId}\u0000${targetKey(preference.target)}\u0000${preference.delivery}\u0000${preference.channelId ?? ''}`;
}

function targetKey(target: CollaborationTarget): string {
  return `${target.type}\u0000${target.id}`;
}

function mutationScopeKey(scope: CollaborationScope, mutationKey: string): string {
  return `${scope.tenantId}\u0000${scope.requesterId}\u0000${scope.conversationId}\u0000${mutationKey}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function invalidStore(filePath: string, message: string): Error {
  return new Error(`Invalid collaboration store format: ${filePath}: ${message}`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}
