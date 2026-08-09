import crypto from 'node:crypto';

import {
  buildWorkItemDeepLink,
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_STATUSES,
  type WorkItem,
  type WorkItemAssignInput,
  type WorkItemCalendarQuery,
  type WorkItemCommentInput,
  type WorkItemCreateInput,
  type WorkItemEditInput,
  type WorkItemEditPatch,
  type WorkItemMutationOperation,
  type WorkItemPriority,
  type WorkItemQuery,
  type WorkItemScope,
  type WorkItemStatus,
  type WorkItemTransitionInput,
  type WorkItemWatchInput,
  WorkItemIdempotencyConflictError,
} from '../shared/work-item.js';
import {
  MAX_WORK_ITEM_COMMENT_LENGTH,
  MAX_WORK_ITEM_DESCRIPTION_LENGTH,
  MAX_WORK_ITEM_LABEL_LENGTH,
  MAX_WORK_ITEM_LABELS,
  MAX_WORK_ITEM_SCOPE_VALUE_LENGTH,
  MAX_WORK_ITEM_TITLE_LENGTH,
  WorkItemStore,
} from './work-item-store.js';

export { WorkItemIdempotencyConflictError } from '../shared/work-item.js';

const MAX_QUERY_LIMIT = 100;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;

export class WorkItemValidationError extends Error {
  readonly code = 'WORK_ITEM_INVALID' as const;

  constructor(message: string) {
    super(message);
    this.name = 'WorkItemValidationError';
  }
}

export class WorkItemNotFoundError extends Error {
  readonly code = 'WORK_ITEM_NOT_FOUND' as const;

  constructor(readonly itemId: string) {
    super(`Work item ${itemId} was not found in the current tenant and conversation scope.`);
    this.name = 'WorkItemNotFoundError';
  }
}

export class WorkItemForbiddenError extends Error {
  readonly code = 'WORK_ITEM_FORBIDDEN' as const;

  constructor(readonly itemId: string) {
    super(`The current user is not allowed to manage work item ${itemId}.`);
    this.name = 'WorkItemForbiddenError';
  }
}

export type WorkItemServiceOptions = {
  clock?: () => Date;
};

export class WorkItemService {
  private readonly clock: () => Date;

  constructor(
    private readonly store: WorkItemStore,
    options: WorkItemServiceOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  get(scope: WorkItemScope, itemId: string): WorkItem | undefined {
    const normalizedScope = normalizeScope(scope);
    return this.store.get(normalizedScope, normalizeId(itemId));
  }

  search(scope: WorkItemScope, query: WorkItemQuery = {}): WorkItem[] {
    const normalizedScope = normalizeScope(scope);
    const normalizedQuery = normalizeQuery(query);
    const items = this.store.list(normalizedScope).filter((item) => matchesQuery(item, normalizedQuery));
    return sortByUpdated(items).slice(0, normalizedQuery.limit);
  }

  recent(scope: WorkItemScope, limit = MAX_QUERY_LIMIT): WorkItem[] {
    const normalizedScope = normalizeScope(scope);
    return sortByUpdated(this.store.list(normalizedScope)).slice(0, normalizeLimit(limit));
  }

  assigned(scope: WorkItemScope, limit = MAX_QUERY_LIMIT): WorkItem[] {
    const normalizedScope = normalizeScope(scope);
    return this.search(normalizedScope, {
      assigneeId: normalizedScope.requesterId,
      limit,
    });
  }

  calendar(scope: WorkItemScope, query: WorkItemCalendarQuery = {}): WorkItem[] {
    const normalizedScope = normalizeScope(scope);
    const from = query.from === undefined ? undefined : normalizeDate(query.from, 'calendar.from');
    const to = query.to === undefined ? undefined : normalizeDate(query.to, 'calendar.to');
    if (from && to && from > to) {
      throw new WorkItemValidationError('calendar.from must be on or before calendar.to');
    }

    const items = this.store.list(normalizedScope)
      .filter((item) => item.dueDate !== undefined)
      .filter((item) => !from || item.dueDate! >= from)
      .filter((item) => !to || item.dueDate! <= to)
      .sort((left, right) =>
        left.dueDate!.localeCompare(right.dueDate!) || compareUpdated(left, right),
      );
    return items.slice(0, normalizeLimit(query.limit ?? MAX_QUERY_LIMIT));
  }

  async create(scope: WorkItemScope, input: WorkItemCreateInput): Promise<WorkItem> {
    const normalizedScope = normalizeScope(scope);
    const normalized = normalizeCreateInput(input);
    const itemId = createId('wi');
    const timestamp = this.timestamp();
    const item: WorkItem = {
      id: itemId,
      tenantId: normalizedScope.tenantId,
      conversationId: normalizedScope.conversationId,
      createdBy: normalizedScope.requesterId,
      title: normalized.title,
      description: normalized.description,
      status: normalized.status,
      priority: normalized.priority,
      ...(normalized.dueDate ? { dueDate: normalized.dueDate } : {}),
      watcherIds: [],
      labels: normalized.labels,
      comments: [],
      deepLink: buildWorkItemDeepLink(itemId),
      ...(normalized.codexJobId
        ? {
          codexJobLink: {
            jobId: normalized.codexJobId,
            relation: normalized.codexJobRelation,
          },
        }
        : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    return this.runMutation(
      normalizedScope,
      'create',
      normalized.mutationKey,
      {
        title: normalized.title,
        description: normalized.description,
        status: normalized.status,
        priority: normalized.priority,
        labels: normalized.labels,
        dueDate: normalized.dueDate,
        codexJobId: normalized.codexJobId,
        codexJobRelation: normalized.codexJobRelation,
      },
      (context) => context.insert(item),
    );
  }

  async edit(scope: WorkItemScope, input: WorkItemEditInput): Promise<WorkItem> {
    const normalizedScope = normalizeScope(scope);
    const normalized = normalizeEditInput(input);
    return this.runMutation(
      normalizedScope,
      'edit',
      normalized.mutationKey,
      { itemId: normalized.itemId, patch: normalized.patch },
      (context) => {
        const current = requireVisibleItem(context, normalized.itemId);
        assertCanManage(current, normalizedScope.requesterId);
        const updated = context.update(normalized.itemId, (item) => {
          applyEditPatch(item, normalized.patch);
          item.updatedAt = this.timestamp();
        });
        if (!updated) throw new WorkItemNotFoundError(normalized.itemId);
        return updated;
      },
    );
  }

  async transition(scope: WorkItemScope, input: WorkItemTransitionInput): Promise<WorkItem> {
    const normalizedScope = normalizeScope(scope);
    const normalized = normalizeTransitionInput(input);
    return this.runMutation(
      normalizedScope,
      'transition',
      normalized.mutationKey,
      { itemId: normalized.itemId, status: normalized.status },
      (context) => {
        const current = requireVisibleItem(context, normalized.itemId);
        assertCanManage(current, normalizedScope.requesterId);
        const updated = context.update(normalized.itemId, (item) => {
          item.status = normalized.status;
          item.updatedAt = this.timestamp();
        });
        if (!updated) throw new WorkItemNotFoundError(normalized.itemId);
        return updated;
      },
    );
  }

  async assign(scope: WorkItemScope, input: WorkItemAssignInput): Promise<WorkItem> {
    const normalizedScope = normalizeScope(scope);
    const normalized = normalizeAssignInput(input);
    return this.runMutation(
      normalizedScope,
      'assign',
      normalized.mutationKey,
      { itemId: normalized.itemId, assigneeId: normalized.assigneeId },
      (context) => {
        const current = requireVisibleItem(context, normalized.itemId);
        assertCanManage(current, normalizedScope.requesterId);
        const updated = context.update(normalized.itemId, (item) => {
          if (normalized.assigneeId) item.assigneeId = normalized.assigneeId;
          else delete item.assigneeId;
          item.updatedAt = this.timestamp();
        });
        if (!updated) throw new WorkItemNotFoundError(normalized.itemId);
        return updated;
      },
    );
  }

  async comment(scope: WorkItemScope, input: WorkItemCommentInput): Promise<WorkItem> {
    const normalizedScope = normalizeScope(scope);
    const normalized = normalizeCommentInput(input);
    const commentId = createId('comment');
    const timestamp = this.timestamp();
    return this.runMutation(
      normalizedScope,
      'comment',
      normalized.mutationKey,
      { itemId: normalized.itemId, body: normalized.body },
      (context) => {
        requireVisibleItem(context, normalized.itemId);
        const updated = context.update(normalized.itemId, (item) => {
          item.comments.push({
            id: commentId,
            authorId: normalizedScope.requesterId,
            body: normalized.body,
            createdAt: timestamp,
          });
          item.updatedAt = timestamp;
        });
        if (!updated) throw new WorkItemNotFoundError(normalized.itemId);
        return updated;
      },
    );
  }

  async watch(scope: WorkItemScope, input: WorkItemWatchInput): Promise<WorkItem> {
    const normalizedScope = normalizeScope(scope);
    const normalized = normalizeWatchInput(input);
    return this.runMutation(
      normalizedScope,
      'watch',
      normalized.mutationKey,
      { itemId: normalized.itemId },
      (context) => {
        const current = context.getInConversation(normalized.itemId);
        if (!current) throw new WorkItemNotFoundError(normalized.itemId);
        if (current.watcherIds.includes(normalizedScope.requesterId)) return current;

        const updated = context.updateInConversation(normalized.itemId, (item) => {
          item.watcherIds.push(normalizedScope.requesterId);
          item.updatedAt = this.timestamp();
        });
        if (!updated) throw new WorkItemNotFoundError(normalized.itemId);
        return updated;
      },
    );
  }

  async unwatch(scope: WorkItemScope, input: WorkItemWatchInput): Promise<WorkItem> {
    const normalizedScope = normalizeScope(scope);
    const normalized = normalizeWatchInput(input);
    return this.runMutation(
      normalizedScope,
      'unwatch',
      normalized.mutationKey,
      { itemId: normalized.itemId },
      (context) => {
        const current = requireVisibleItem(context, normalized.itemId);
        if (!current.watcherIds.includes(normalizedScope.requesterId)) return current;

        const updated = context.update(normalized.itemId, (item) => {
          item.watcherIds = item.watcherIds.filter((id) => id !== normalizedScope.requesterId);
          item.updatedAt = this.timestamp();
        });
        if (!updated) throw new WorkItemNotFoundError(normalized.itemId);
        return updated;
      },
    );
  }

  private async runMutation(
    scope: WorkItemScope,
    operation: WorkItemMutationOperation,
    mutationKey: string,
    payload: unknown,
    action: Parameters<WorkItemStore['runMutation']>[4],
  ): Promise<WorkItem> {
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
      throw new WorkItemValidationError('work-item clock must return a valid Date');
    }
    return date.toISOString();
  }
}

type NormalizedCreateInput = {
  mutationKey: string;
  title: string;
  description: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  labels: string[];
  dueDate?: string;
  codexJobId?: string;
  codexJobRelation: NonNullable<WorkItemCreateInput['codexJobRelation']>;
};

type NormalizedEditInput = {
  itemId: string;
  mutationKey: string;
  patch: WorkItemEditPatch;
};

type NormalizedQuery = {
  text?: string;
  statuses?: WorkItemStatus[];
  assigneeId?: string | null;
  watcherId?: string;
  labels?: string[];
  dueDateFrom?: string;
  dueDateTo?: string;
  limit: number;
};

function normalizeScope(scope: WorkItemScope): WorkItemScope {
  if (!scope || typeof scope !== 'object') throw new WorkItemValidationError('work-item scope is required');
  return {
    tenantId: normalizeText(scope.tenantId, 'tenantId', MAX_WORK_ITEM_SCOPE_VALUE_LENGTH),
    requesterId: normalizeText(scope.requesterId, 'requesterId', MAX_WORK_ITEM_SCOPE_VALUE_LENGTH),
    conversationId: normalizeText(scope.conversationId, 'conversationId', MAX_WORK_ITEM_SCOPE_VALUE_LENGTH),
  };
}

function normalizeCreateInput(input: WorkItemCreateInput): NormalizedCreateInput {
  if (!input || typeof input !== 'object') throw new WorkItemValidationError('work-item create input is required');
  const status = normalizeStatus(input.status ?? 'todo', 'status');
  const priority = normalizePriority(input.priority ?? 'medium');
  return {
    mutationKey: normalizeMutationKey(input.mutationKey),
    title: normalizeText(input.title, 'title', MAX_WORK_ITEM_TITLE_LENGTH),
    description: normalizeOptionalText(input.description ?? '', 'description', MAX_WORK_ITEM_DESCRIPTION_LENGTH),
    status,
    priority,
    labels: normalizeLabels(input.labels ?? []),
    ...(input.dueDate !== undefined ? { dueDate: normalizeDate(input.dueDate, 'dueDate') } : {}),
    ...(input.codexJobId !== undefined ? { codexJobId: normalizeText(input.codexJobId, 'codexJobId', MAX_WORK_ITEM_SCOPE_VALUE_LENGTH) } : {}),
    codexJobRelation: normalizeCodexJobRelation(input.codexJobRelation ?? 'supports'),
  };
}

function normalizeEditInput(input: WorkItemEditInput): NormalizedEditInput {
  if (!input || typeof input !== 'object') throw new WorkItemValidationError('work-item edit input is required');
  if (!input.patch || typeof input.patch !== 'object') throw new WorkItemValidationError('edit.patch is required');
  const patch = input.patch as WorkItemEditPatch & Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
    throw new WorkItemValidationError('status changes must use transition');
  }
  const normalizedPatch: WorkItemEditPatch = {};
  let fieldCount = 0;
  if (Object.prototype.hasOwnProperty.call(patch, 'title')) {
    normalizedPatch.title = normalizeText(patch.title, 'patch.title', MAX_WORK_ITEM_TITLE_LENGTH);
    fieldCount += 1;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'description')) {
    normalizedPatch.description = patch.description === null
      ? null
      : normalizeOptionalText(patch.description, 'patch.description', MAX_WORK_ITEM_DESCRIPTION_LENGTH);
    fieldCount += 1;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'priority')) {
    normalizedPatch.priority = normalizePriority(patch.priority);
    fieldCount += 1;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'labels')) {
    if (!Array.isArray(patch.labels)) throw new WorkItemValidationError('patch.labels must be an array');
    normalizedPatch.labels = normalizeLabels(patch.labels);
    fieldCount += 1;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'dueDate')) {
    normalizedPatch.dueDate = patch.dueDate === null ? null : normalizeDate(patch.dueDate, 'patch.dueDate');
    fieldCount += 1;
  }
  if (fieldCount === 0) throw new WorkItemValidationError('edit.patch must include an editable field');
  return {
    itemId: normalizeId(input.itemId),
    mutationKey: normalizeMutationKey(input.mutationKey),
    patch: normalizedPatch,
  };
}

function normalizeTransitionInput(input: WorkItemTransitionInput): WorkItemTransitionInput {
  if (!input || typeof input !== 'object') throw new WorkItemValidationError('transition input is required');
  return {
    itemId: normalizeId(input.itemId),
    status: normalizeStatus(input.status, 'status'),
    mutationKey: normalizeMutationKey(input.mutationKey),
  };
}

function normalizeAssignInput(input: WorkItemAssignInput): WorkItemAssignInput {
  if (!input || typeof input !== 'object') throw new WorkItemValidationError('assign input is required');
  return {
    itemId: normalizeId(input.itemId),
    assigneeId: input.assigneeId === null
      ? null
      : normalizeText(input.assigneeId, 'assigneeId', MAX_WORK_ITEM_SCOPE_VALUE_LENGTH),
    mutationKey: normalizeMutationKey(input.mutationKey),
  };
}

function normalizeCommentInput(input: WorkItemCommentInput): WorkItemCommentInput {
  if (!input || typeof input !== 'object') throw new WorkItemValidationError('comment input is required');
  return {
    itemId: normalizeId(input.itemId),
    body: normalizeText(input.body, 'body', MAX_WORK_ITEM_COMMENT_LENGTH),
    mutationKey: normalizeMutationKey(input.mutationKey),
  };
}

function normalizeWatchInput(input: WorkItemWatchInput): WorkItemWatchInput {
  if (!input || typeof input !== 'object') throw new WorkItemValidationError('watch input is required');
  return {
    itemId: normalizeId(input.itemId),
    mutationKey: normalizeMutationKey(input.mutationKey),
  };
}

function normalizeQuery(query: WorkItemQuery): NormalizedQuery {
  if (!query || typeof query !== 'object') throw new WorkItemValidationError('work-item query must be an object');
  const statuses = query.status === undefined
    ? undefined
    : (Array.isArray(query.status) ? query.status : [query.status]).map((status) => normalizeStatus(status, 'query.status'));
  const labels = query.labels === undefined ? undefined : normalizeLabels(query.labels);
  const dueDateFrom = query.dueDateFrom === undefined ? undefined : normalizeDate(query.dueDateFrom, 'query.dueDateFrom');
  const dueDateTo = query.dueDateTo === undefined ? undefined : normalizeDate(query.dueDateTo, 'query.dueDateTo');
  if (dueDateFrom && dueDateTo && dueDateFrom > dueDateTo) {
    throw new WorkItemValidationError('query.dueDateFrom must be on or before query.dueDateTo');
  }
  return {
    ...(query.text !== undefined ? { text: normalizeOptionalText(query.text, 'query.text', MAX_WORK_ITEM_TITLE_LENGTH) } : {}),
    ...(statuses ? { statuses } : {}),
    ...(query.assigneeId !== undefined
      ? { assigneeId: query.assigneeId === null ? null : normalizeText(query.assigneeId, 'query.assigneeId', MAX_WORK_ITEM_SCOPE_VALUE_LENGTH) }
      : {}),
    ...(query.watcherId !== undefined ? { watcherId: normalizeText(query.watcherId, 'query.watcherId', MAX_WORK_ITEM_SCOPE_VALUE_LENGTH) } : {}),
    ...(labels ? { labels } : {}),
    ...(dueDateFrom ? { dueDateFrom } : {}),
    ...(dueDateTo ? { dueDateTo } : {}),
    limit: normalizeLimit(query.limit ?? MAX_QUERY_LIMIT),
  };
}

function applyEditPatch(item: WorkItem, patch: WorkItemEditPatch): void {
  if (patch.title !== undefined) item.title = patch.title;
  if (patch.description !== undefined) item.description = patch.description ?? '';
  if (patch.priority !== undefined) item.priority = patch.priority;
  if (patch.labels !== undefined) item.labels = [...patch.labels];
  if (patch.dueDate !== undefined) {
    if (patch.dueDate === null) delete item.dueDate;
    else item.dueDate = patch.dueDate;
  }
}

function requireVisibleItem(
  context: Parameters<WorkItemStore['runMutation']>[4] extends (context: infer Context) => WorkItem ? Context : never,
  itemId: string,
): WorkItem {
  const item = context.get(itemId);
  if (!item) throw new WorkItemNotFoundError(itemId);
  return item;
}

function assertCanManage(item: WorkItem, requesterId: string): void {
  if (item.createdBy !== requesterId && item.assigneeId !== requesterId) {
    throw new WorkItemForbiddenError(item.id);
  }
}

function matchesQuery(item: WorkItem, query: NormalizedQuery): boolean {
  if (query.text) {
    const haystack = [
      item.title,
      item.description,
      ...item.labels,
      ...item.comments.map((comment) => comment.body),
    ].join('\n').toLocaleLowerCase();
    if (!haystack.includes(query.text.toLocaleLowerCase())) return false;
  }
  if (query.statuses && !query.statuses.includes(item.status)) return false;
  if (query.assigneeId !== undefined) {
    const actual = item.assigneeId ?? null;
    if (actual !== query.assigneeId) return false;
  }
  if (query.watcherId && !item.watcherIds.includes(query.watcherId)) return false;
  if (query.labels && !query.labels.every((label) => item.labels.includes(label))) return false;
  if (query.dueDateFrom && (!item.dueDate || item.dueDate < query.dueDateFrom)) return false;
  if (query.dueDateTo && (!item.dueDate || item.dueDate > query.dueDateTo)) return false;
  return true;
}

function sortByUpdated(items: WorkItem[]): WorkItem[] {
  return items.sort(compareUpdated);
}

function compareUpdated(left: WorkItem, right: WorkItem): number {
  return right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id);
}

function normalizeText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new WorkItemValidationError(`${label} must be a string`);
  const normalized = value.trim();
  if (!normalized) throw new WorkItemValidationError(`${label} is required`);
  if (normalized.length > maxLength) {
    throw new WorkItemValidationError(`${label} must be ${maxLength} characters or fewer`);
  }
  if (CONTROL_CHARACTERS.test(normalized)) {
    throw new WorkItemValidationError(`${label} contains unsupported control characters`);
  }
  return normalized;
}

function normalizeOptionalText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new WorkItemValidationError(`${label} must be a string`);
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new WorkItemValidationError(`${label} must be ${maxLength} characters or fewer`);
  }
  if (CONTROL_CHARACTERS.test(normalized)) {
    throw new WorkItemValidationError(`${label} contains unsupported control characters`);
  }
  return normalized;
}

function normalizeMutationKey(value: unknown): string {
  return normalizeText(value, 'mutationKey', 200);
}

function normalizeId(value: unknown): string {
  return normalizeText(value, 'itemId', 200);
}

function normalizeLabels(values: readonly string[]): string[] {
  if (!Array.isArray(values)) throw new WorkItemValidationError('labels must be an array');
  if (values.length > MAX_WORK_ITEM_LABELS) {
    throw new WorkItemValidationError(`labels must contain ${MAX_WORK_ITEM_LABELS} entries or fewer`);
  }
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const label = normalizeText(value, 'label', MAX_WORK_ITEM_LABEL_LENGTH);
    if (seen.has(label)) throw new WorkItemValidationError('labels must not contain duplicates');
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

function normalizeStatus(value: unknown, label: string): WorkItemStatus {
  if (!(WORK_ITEM_STATUSES as readonly unknown[]).includes(value)) {
    throw new WorkItemValidationError(`${label} is not a supported work-item status`);
  }
  return value as WorkItemStatus;
}

function normalizePriority(value: unknown): WorkItemPriority {
  if (!(WORK_ITEM_PRIORITIES as readonly unknown[]).includes(value)) {
    throw new WorkItemValidationError('priority is not a supported work-item priority');
  }
  return value as WorkItemPriority;
}

function normalizeCodexJobRelation(value: unknown): NonNullable<WorkItemCreateInput['codexJobRelation']> {
  if (!['created-from', 'supports', 'blocked-by'].includes(value as string)) {
    throw new WorkItemValidationError('codexJobRelation is not supported');
  }
  return value as NonNullable<WorkItemCreateInput['codexJobRelation']>;
}

function normalizeDate(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new WorkItemValidationError(`${label} must use YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new WorkItemValidationError(`${label} must be a valid calendar date`);
  }
  return value;
}

function normalizeLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MAX_QUERY_LIMIT) {
    throw new WorkItemValidationError(`limit must be an integer between 1 and ${MAX_QUERY_LIMIT}`);
  }
  return value;
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
