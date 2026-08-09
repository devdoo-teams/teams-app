export const WORK_ITEM_TAB_PATH = '/tabs/home/' as const;

export const WORK_ITEM_STATUSES = [
  'backlog',
  'todo',
  'open',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
] as const;

export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

export const WORK_ITEM_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type WorkItemPriority = (typeof WORK_ITEM_PRIORITIES)[number];

export type WorkItemScope = {
  tenantId: string;
  requesterId: string;
  conversationId: string;
};

export type WorkItemDeepLink = {
  kind: 'work-item';
  itemId: string;
  path: string;
  href: string;
};

export type WorkItemCodexLink = {
  jobId: string;
  relation: 'created-from' | 'supports' | 'blocked-by';
};

export type WorkItemComment = {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
};

export type WorkItem = {
  id: string;
  tenantId: string;
  conversationId: string;
  createdBy: string;
  title: string;
  description: string;
  status: WorkItemStatus;
  priority: WorkItemPriority;
  assigneeId?: string;
  watcherIds: string[];
  labels: string[];
  dueDate?: string;
  comments: WorkItemComment[];
  deepLink: WorkItemDeepLink;
  codexJobLink?: WorkItemCodexLink;
  createdAt: string;
  updatedAt: string;
};

export type WorkItemCreateInput = {
  mutationKey: string;
  title: string;
  description?: string;
  status?: WorkItemStatus;
  priority?: WorkItemPriority;
  labels?: string[];
  dueDate?: string;
  codexJobId?: string;
  codexJobRelation?: WorkItemCodexLink['relation'];
};

export type WorkItemEditPatch = {
  title?: string;
  description?: string | null;
  status?: never;
  priority?: WorkItemPriority;
  labels?: string[];
  dueDate?: string | null;
};

export type WorkItemEditInput = {
  itemId: string;
  mutationKey: string;
  patch: WorkItemEditPatch;
};

export type WorkItemTransitionInput = {
  itemId: string;
  status: WorkItemStatus;
  mutationKey: string;
};

export type WorkItemAssignInput = {
  itemId: string;
  assigneeId: string | null;
  mutationKey: string;
};

export type WorkItemCommentInput = {
  itemId: string;
  body: string;
  mutationKey: string;
};

export type WorkItemWatchInput = {
  itemId: string;
  mutationKey: string;
};

export type WorkItemQuery = {
  text?: string;
  status?: WorkItemStatus | readonly WorkItemStatus[];
  assigneeId?: string | null;
  watcherId?: string;
  labels?: readonly string[];
  dueDateFrom?: string;
  dueDateTo?: string;
  limit?: number;
};

export type WorkItemCalendarQuery = {
  from?: string;
  to?: string;
  limit?: number;
};

export type WorkItemMutationOperation =
  | 'create'
  | 'edit'
  | 'transition'
  | 'assign'
  | 'comment'
  | 'watch'
  | 'unwatch';

export function buildWorkItemDeepLink(itemId: string): WorkItemDeepLink {
  const path = `${WORK_ITEM_TAB_PATH}?workItemId=${encodeURIComponent(itemId)}`;
  return {
    kind: 'work-item',
    itemId,
    path,
    href: path,
  };
}

export class WorkItemIdempotencyConflictError extends Error {
  readonly code = 'WORK_ITEM_IDEMPOTENCY_CONFLICT' as const;

  constructor(readonly mutationKey: string) {
    super(`Mutation key ${mutationKey} was already used with a different operation or payload.`);
    this.name = 'WorkItemIdempotencyConflictError';
  }
}
