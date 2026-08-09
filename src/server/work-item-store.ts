import { atomicWriteJson, readAtomicJsonStore } from './atomic-file.js';
import {
  buildWorkItemDeepLink,
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_STATUSES,
  type WorkItem,
  type WorkItemComment,
  type WorkItemMutationOperation,
  type WorkItemScope,
  WorkItemIdempotencyConflictError,
} from '../shared/work-item.js';

export { WorkItemIdempotencyConflictError } from '../shared/work-item.js';

export const WORK_ITEM_STORE_VERSION = 1 as const;
export const MAX_WORK_ITEM_SCOPE_VALUE_LENGTH = 256;
export const MAX_WORK_ITEM_ID_LENGTH = 200;
export const MAX_WORK_ITEM_TITLE_LENGTH = 400;
export const MAX_WORK_ITEM_DESCRIPTION_LENGTH = 4_000;
export const MAX_WORK_ITEM_LABEL_LENGTH = 80;
export const MAX_WORK_ITEM_LABELS = 40;
export const MAX_WORK_ITEM_COMMENTS = 200;
export const MAX_WORK_ITEM_COMMENT_LENGTH = 2_000;
export const MAX_WORK_ITEM_MUTATION_KEY_LENGTH = 200;

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

export type WorkItemMutationRecord = WorkItemScope & {
  mutationKey: string;
  operation: WorkItemMutationOperation;
  fingerprint: string;
  result: WorkItem;
  createdAt: string;
};

export type WorkItemMutationContext = {
  /** Return an item only when the actor is the creator, assignee, or watcher. */
  get(itemId: string): WorkItem | undefined;
  /** Return an item in the same tenant/conversation, for the follow operation. */
  getInConversation(itemId: string): WorkItem | undefined;
  insert(item: WorkItem): WorkItem;
  update(itemId: string, updater: (item: WorkItem) => void): WorkItem | undefined;
  updateInConversation(itemId: string, updater: (item: WorkItem) => void): WorkItem | undefined;
};

type PersistedStore = {
  version: typeof WORK_ITEM_STORE_VERSION;
  items: WorkItem[];
  mutations: WorkItemMutationRecord[];
};

export class WorkItemStore {
  private items: WorkItem[] = [];
  private mutations: WorkItemMutationRecord[] = [];
  private nextActivitySequence = 0;
  private writeQueue: Promise<void> = Promise.resolve();
  private mutationQueue: Promise<void> = Promise.resolve();
  private initialized = false;

  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    try {
      const raw = await readAtomicJsonStore(this.filePath);
      const loaded = loadStore(JSON.parse(raw) as unknown, this.filePath);
      this.items = loaded.items;
      this.mutations = loaded.mutations;
      this.nextActivitySequence = this.items.reduce(
        (max, item) => Math.max(max, item.activitySequence ?? 0),
        0,
      );
      this.initialized = true;
    } catch (error) {
      if (!isFileNotFound(error)) throw error;
      this.items = [];
      this.mutations = [];
      this.nextActivitySequence = 0;
      this.initialized = true;
      await this.persist();
    }
  }

  get(scope: WorkItemScope, itemId: string): WorkItem | undefined {
    this.assertInitialized();
    const item = this.items.find((candidate) =>
      candidate.id === itemId && sameConversation(candidate, scope) && isVisibleTo(candidate, scope.requesterId),
    );
    return item ? clone(item) : undefined;
  }

  list(scope: WorkItemScope): WorkItem[] {
    this.assertInitialized();
    return this.items
      .filter((item) => sameConversation(item, scope) && isVisibleTo(item, scope.requesterId))
      .map(clone);
  }

  async runMutation(
    scope: WorkItemScope,
    mutationKey: string,
    operation: WorkItemMutationOperation,
    fingerprint: string,
    action: (context: WorkItemMutationContext) => WorkItem,
    replayCheck: (context: WorkItemMutationContext) => void,
  ): Promise<WorkItem> {
    this.assertInitialized();
    assertMutationKey(mutationKey);
    if (!fingerprint) throw new Error('work-item mutation fingerprint is required');

    const next = this.mutationQueue.then(async () => {
      const previous = this.findMutation(scope, mutationKey);
      if (previous) {
        if (previous.operation !== operation || previous.fingerprint !== fingerprint) {
          throw new WorkItemIdempotencyConflictError(mutationKey);
        }
        replayCheck(this.createMutationContext(scope));
        return clone(previous.result);
      }

      const previousItems = clone(this.items);
      const previousMutations = clone(this.mutations);

      try {
        const result = action(this.createMutationContext(scope));
        validateWorkItem(result, 'mutation result');
        this.mutations.unshift({
          tenantId: scope.tenantId,
          requesterId: scope.requesterId,
          conversationId: scope.conversationId,
          mutationKey,
          operation,
          fingerprint,
          result: clone(result),
          createdAt: new Date().toISOString(),
        });
        await this.persist();
        return clone(result);
      } catch (error) {
        this.items = previousItems;
        this.mutations = previousMutations;
        throw error;
      }
    });

    this.mutationQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  private createMutationContext(scope: WorkItemScope): WorkItemMutationContext {
    return {
      get: (itemId) => this.getFromMemory(scope, itemId, true),
      getInConversation: (itemId) => this.getFromMemory(scope, itemId, false),
      insert: (item) => {
        validateWorkItem(item, 'new work item');
        if (
          item.tenantId !== scope.tenantId ||
          item.conversationId !== scope.conversationId ||
          item.createdBy !== scope.requesterId
        ) {
          throw new Error('work item ownership scope does not match the mutation scope');
        }
        if (this.items.some((candidate) => candidate.id === item.id)) {
          throw new Error(`work item id already exists: ${item.id}`);
        }
        const stored = clone(item);
        stored.activitySequence = ++this.nextActivitySequence;
        this.items.unshift(stored);
        return clone(stored);
      },
      update: (itemId, updater) => {
        return this.updateFromMemory(scope, itemId, updater, true);
      },
      updateInConversation: (itemId, updater) => {
        return this.updateFromMemory(scope, itemId, updater, false);
      },
    };
  }

  private getFromMemory(scope: WorkItemScope, itemId: string, requireParticipant: boolean): WorkItem | undefined {
    const item = this.items.find((candidate) =>
      candidate.id === itemId &&
      sameConversation(candidate, scope) &&
      (!requireParticipant || isVisibleTo(candidate, scope.requesterId)),
    );
    return item ? clone(item) : undefined;
  }

  private updateFromMemory(
    scope: WorkItemScope,
    itemId: string,
    updater: (item: WorkItem) => void,
    requireParticipant: boolean,
  ): WorkItem | undefined {
    const index = this.items.findIndex((candidate) =>
      candidate.id === itemId &&
      sameConversation(candidate, scope) &&
      (!requireParticipant || isVisibleTo(candidate, scope.requesterId)),
    );
    if (index === -1) return undefined;

    const original = this.items[index];
    const updated = clone(original);
    updater(updated);
    updated.activitySequence = ++this.nextActivitySequence;
    validateWorkItem(updated, 'updated work item');
    if (
      updated.id !== original.id ||
      updated.tenantId !== original.tenantId ||
      updated.conversationId !== original.conversationId ||
      updated.createdBy !== original.createdBy ||
      updated.deepLink.href !== original.deepLink.href ||
      updated.deepLink.path !== original.deepLink.path
    ) {
      throw new Error('work item identity and deep-link ownership fields are immutable');
    }
    this.items[index] = updated;
    return clone(updated);
  }

  private findMutation(scope: WorkItemScope, mutationKey: string): WorkItemMutationRecord | undefined {
    return this.mutations.find((mutation) =>
      mutation.mutationKey === mutationKey && sameScope(mutation, scope),
    );
  }

  private async persist(): Promise<void> {
    const nextWrite = this.writeQueue.then(() => atomicWriteJson(this.filePath, {
      version: WORK_ITEM_STORE_VERSION,
      items: this.items,
      mutations: this.mutations,
    } satisfies PersistedStore));
    this.writeQueue = nextWrite.catch(() => undefined);
    await nextWrite;
  }

  private assertInitialized(): void {
    if (!this.initialized) throw new Error('WorkItemStore.initialize() must complete before use');
  }
}

function loadStore(value: unknown, filePath: string): PersistedStore {
  if (!isRecord(value) || value.version !== WORK_ITEM_STORE_VERSION) {
    throw invalidStore(filePath, 'version must be 1');
  }
  if (!Array.isArray(value.items)) throw invalidStore(filePath, 'items must be an array');
  if (!Array.isArray(value.mutations)) throw invalidStore(filePath, 'mutations must be an array');

  const itemIds = new Set<string>();
  const items = value.items.map((item, index) => {
    if (!isRecord(item)) throw invalidStore(filePath, `items[${index}] must be an object`);
    const parsed = item as unknown as WorkItem;
    validateWorkItem(parsed, `items[${index}]`);
    if (itemIds.has(parsed.id)) throw invalidStore(filePath, `items[${index}].id must be unique`);
    itemIds.add(parsed.id);
    return clone(parsed);
  });

  const mutationKeys = new Set<string>();
  const mutations = value.mutations.map((mutation, index) => {
    if (!isRecord(mutation)) throw invalidStore(filePath, `mutations[${index}] must be an object`);
    const parsed = mutation as unknown as WorkItemMutationRecord;
    validateMutation(parsed, filePath, index);
    const key = mutationScopeKey(parsed, parsed.mutationKey);
    if (mutationKeys.has(key)) throw invalidStore(filePath, `mutations[${index}] must have a unique scoped key`);
    mutationKeys.add(key);
    return clone(parsed);
  });

  return { version: WORK_ITEM_STORE_VERSION, items, mutations };
}

function validateMutation(mutation: WorkItemMutationRecord, filePath: string, index: number): void {
  try {
    assertScope(mutation, `mutations[${index}]`);
    assertText(mutation.mutationKey, 'mutationKey', MAX_WORK_ITEM_MUTATION_KEY_LENGTH, true);
    if (!['create', 'edit', 'transition', 'assign', 'comment', 'watch', 'unwatch'].includes(mutation.operation)) {
      throw new Error('operation is invalid');
    }
    assertText(mutation.fingerprint, 'fingerprint', 20_000, true);
    validateWorkItem(mutation.result, `mutations[${index}].result`);
    if (
      mutation.result.tenantId !== mutation.tenantId ||
      mutation.result.conversationId !== mutation.conversationId
    ) {
      throw new Error('result must remain in the mutation tenant and conversation scope');
    }
    assertTimestamp(mutation.createdAt, 'createdAt');
  } catch (error) {
    throw invalidStore(filePath, `mutations[${index}] ${errorMessage(error)}`);
  }
}

function validateWorkItem(item: WorkItem, label: string): void {
  if (!isRecord(item)) throw new Error(`${label} must be an object`);
  assertText(item.id, `${label}.id`, MAX_WORK_ITEM_ID_LENGTH, true);
  assertScope({
    tenantId: item.tenantId,
    requesterId: item.createdBy,
    conversationId: item.conversationId,
  }, label);
  assertText(item.title, `${label}.title`, MAX_WORK_ITEM_TITLE_LENGTH, true);
  assertText(item.description, `${label}.description`, MAX_WORK_ITEM_DESCRIPTION_LENGTH, false);
  if (!(WORK_ITEM_STATUSES as readonly string[]).includes(item.status)) {
    throw new Error(`${label}.status is invalid`);
  }
  if (!(WORK_ITEM_PRIORITIES as readonly string[]).includes(item.priority)) {
    throw new Error(`${label}.priority is invalid`);
  }
  if (item.assigneeId !== undefined) {
    assertText(item.assigneeId, `${label}.assigneeId`, MAX_WORK_ITEM_SCOPE_VALUE_LENGTH, true);
  }
  if (!Array.isArray(item.watcherIds)) throw new Error(`${label}.watcherIds must be an array`);
  assertUniqueTextArray(item.watcherIds, `${label}.watcherIds`, MAX_WORK_ITEM_SCOPE_VALUE_LENGTH, MAX_WORK_ITEM_SCOPE_VALUE_LENGTH);
  if (!Array.isArray(item.labels)) throw new Error(`${label}.labels must be an array`);
  assertUniqueTextArray(item.labels, `${label}.labels`, MAX_WORK_ITEM_LABEL_LENGTH, MAX_WORK_ITEM_LABELS);
  if (item.dueDate !== undefined) assertDate(item.dueDate, `${label}.dueDate`);
  if (!Array.isArray(item.comments) || item.comments.length > MAX_WORK_ITEM_COMMENTS) {
    throw new Error(`${label}.comments must be an array with at most ${MAX_WORK_ITEM_COMMENTS} entries`);
  }
  const commentIds = new Set<string>();
  for (const [index, comment] of item.comments.entries()) {
    validateComment(comment, `${label}.comments[${index}]`);
    if (commentIds.has(comment.id)) throw new Error(`${label}.comments must have unique ids`);
    commentIds.add(comment.id);
  }
  if (!isRecord(item.deepLink)) throw new Error(`${label}.deepLink must be an object`);
  const expectedLink = buildWorkItemDeepLink(item.id);
  if (
    item.deepLink.kind !== expectedLink.kind ||
    item.deepLink.itemId !== expectedLink.itemId ||
    item.deepLink.path !== expectedLink.path ||
    item.deepLink.href !== expectedLink.href
  ) {
    throw new Error(`${label}.deepLink is not stable for the item id`);
  }
  if (item.codexJobLink !== undefined) {
    if (!isRecord(item.codexJobLink)) throw new Error(`${label}.codexJobLink must be an object`);
    assertText(item.codexJobLink.jobId, `${label}.codexJobLink.jobId`, MAX_WORK_ITEM_ID_LENGTH, true);
    if (!['created-from', 'supports', 'blocked-by'].includes(item.codexJobLink.relation)) {
      throw new Error(`${label}.codexJobLink.relation is invalid`);
    }
  }
  assertTimestamp(item.createdAt, `${label}.createdAt`);
  assertTimestamp(item.updatedAt, `${label}.updatedAt`);
  if (item.activitySequence !== undefined) {
    if (!Number.isSafeInteger(item.activitySequence) || item.activitySequence < 1) {
      throw new Error(`${label}.activitySequence must be a positive safe integer`);
    }
  }
}

function validateComment(comment: WorkItemComment, label: string): void {
  if (!isRecord(comment)) throw new Error(`${label} must be an object`);
  assertText(comment.id, `${label}.id`, MAX_WORK_ITEM_ID_LENGTH, true);
  assertText(comment.authorId, `${label}.authorId`, MAX_WORK_ITEM_SCOPE_VALUE_LENGTH, true);
  assertText(comment.body, `${label}.body`, MAX_WORK_ITEM_COMMENT_LENGTH, true);
  assertTimestamp(comment.createdAt, `${label}.createdAt`);
}

function assertScope(scope: WorkItemScope, label: string): void {
  assertText(scope.tenantId, `${label}.tenantId`, MAX_WORK_ITEM_SCOPE_VALUE_LENGTH, true);
  assertText(scope.requesterId, `${label}.requesterId`, MAX_WORK_ITEM_SCOPE_VALUE_LENGTH, true);
  assertText(scope.conversationId, `${label}.conversationId`, MAX_WORK_ITEM_SCOPE_VALUE_LENGTH, true);
}

function assertMutationKey(value: string): void {
  assertText(value, 'mutationKey', MAX_WORK_ITEM_MUTATION_KEY_LENGTH, true);
}

function assertText(value: unknown, label: string, maxLength: number, required: boolean): asserts value is string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  if (required && !value.trim()) throw new Error(`${label} is required`);
  if (value.length > maxLength) throw new Error(`${label} must be ${maxLength} characters or fewer`);
  if (CONTROL_CHARACTERS.test(value)) throw new Error(`${label} contains unsupported control characters`);
}

function assertUniqueTextArray(values: unknown[], label: string, maxEntryLength: number, maxEntries: number): asserts values is string[] {
  if (values.length > maxEntries) throw new Error(`${label} has too many entries`);
  const normalized = new Set<string>();
  for (const value of values) {
    assertText(value, label, maxEntryLength, true);
    if (normalized.has(value)) throw new Error(`${label} must not contain duplicates`);
    normalized.add(value);
  }
}

function assertDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must use YYYY-MM-DD`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a valid calendar date`);
  }
}

function assertTimestamp(value: unknown, label: string): void {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
}

function sameScope(left: WorkItemScope, right: WorkItemScope): boolean {
  return left.tenantId === right.tenantId &&
    left.requesterId === right.requesterId &&
    left.conversationId === right.conversationId;
}

function sameConversation(item: Pick<WorkItem, 'tenantId' | 'conversationId'>, scope: WorkItemScope): boolean {
  return item.tenantId === scope.tenantId && item.conversationId === scope.conversationId;
}

function isVisibleTo(item: WorkItem, requesterId: string): boolean {
  return item.createdBy === requesterId ||
    item.assigneeId === requesterId ||
    item.watcherIds.includes(requesterId);
}

function mutationScopeKey(scope: WorkItemScope, mutationKey: string): string {
  return `${scope.tenantId}\u0000${scope.requesterId}\u0000${scope.conversationId}\u0000${mutationKey}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function invalidStore(filePath: string, message: string): Error {
  return new Error(`Invalid work item store format: ${filePath}: ${message}`);
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
