import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  WorkItemForbiddenError,
  WorkItemIdempotencyConflictError,
  WorkItemNotFoundError,
  presentWorkItem,
  WorkItemService,
  WorkItemValidationError,
} from '../src/server/work-item-service.js';
import { WorkItemStore } from '../src/server/work-item-store.js';
import type { WorkItemScope } from '../src/shared/work-item.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-work-item-parity-'));
const filePath = path.join(root, 'work-items.json');

const scopeA: WorkItemScope = {
  tenantId: 'tenant-a',
  requesterId: 'user-a',
  conversationId: 'conversation-a',
};
const scopeB: WorkItemScope = {
  tenantId: 'tenant-a',
  requesterId: 'user-b',
  conversationId: 'conversation-a',
};
const otherTenantScope: WorkItemScope = {
  tenantId: 'tenant-b',
  requesterId: 'user-a',
  conversationId: 'conversation-a',
};
const otherConversationScope: WorkItemScope = {
  tenantId: 'tenant-a',
  requesterId: 'user-a',
  conversationId: 'conversation-b',
};

const membership = {
  isMember: (request: {
    tenantId: string;
    conversationId: string;
    requesterId: string;
    userId: string;
  }): boolean =>
    request.tenantId === 'tenant-a' &&
    request.conversationId === 'conversation-a' &&
    request.requesterId === 'user-a' &&
    request.userId === 'user-b',
};

try {
  const store = new WorkItemStore(filePath);
  const changes: Array<{ operation: string; mutationKey: string; itemId: string }> = [];
  const service = new WorkItemService(store, {
    membership,
    onChanged: (change) => {
      changes.push({ operation: change.operation, mutationKey: change.mutationKey, itemId: change.item.id });
    },
  });
  await service.initialize();

  const createInput = {
    mutationKey: 'create-parity-item',
    title: 'Ship Work Hub parity',
    description: 'Implement the generic work-item contract without an Atlassian dependency.',
    dueDate: '2026-08-12',
    priority: 'high' as const,
    labels: ['parity', 'teams'],
    codexJobId: 'task-codex-123',
  };

  const created = await service.create(scopeA, createInput);
  assert.equal(created.status, 'todo', 'new work items start in the generic todo state');
  assert.deepEqual(changes[0], { operation: 'create', mutationKey: 'create-parity-item', itemId: created.id }, 'durable mutations publish a change event for notifications');
  assert.equal(created.createdBy, scopeA.requesterId);
  assert.deepEqual(created.labels, ['parity', 'teams']);
  assert.deepEqual(created.codexJobLink, {
    jobId: 'task-codex-123',
    relation: 'supports',
  }, 'Codex linkage is metadata, not an embedded or executed AgentJob');
  assert.deepEqual(created.deepLink, {
    kind: 'work-item',
    itemId: created.id,
    path: `/tabs/home/?workItemId=${encodeURIComponent(created.id)}`,
    href: `/tabs/home/?workItemId=${encodeURIComponent(created.id)}`,
  }, 'deep-link metadata is stable and controller-ready');
  assert.equal(
    presentWorkItem(created, scopeA).assignedToRequester,
    false,
    'the presentation contract reports that an unassigned item is not assigned to the requester',
  );

  const duplicateCreate = await service.create(scopeA, createInput);
  assert.deepEqual(duplicateCreate, created, 'retrying create with the same mutation key returns the original item');
  assert.equal(changes.filter((change) => change.mutationKey === 'create-parity-item').length, 2, 'replayed mutations publish the same idempotent change key');
  assert.equal(service.search(scopeA).length, 1, 'an idempotent create does not duplicate the item');
  await assert.rejects(
    () => service.create(scopeA, { ...createInput, title: 'different payload' }),
    (error: unknown) => error instanceof WorkItemIdempotencyConflictError,
    'reusing a mutation key with a different payload is rejected',
  );

  assert.equal(service.get(otherTenantScope, created.id), undefined, 'tenant isolation hides the item');
  assert.equal(service.get(otherConversationScope, created.id), undefined, 'conversation isolation hides the item');
  await assert.rejects(
    () => service.edit(scopeB, {
      itemId: created.id,
      mutationKey: 'unauthorized-edit',
      patch: { title: 'stolen title' },
    }),
    (error: unknown) => error instanceof WorkItemNotFoundError,
    'an unrelated user cannot mutate an item by id');
  await assert.rejects(
    () => service.assign(scopeA, {
      itemId: created.id,
      assigneeId: 'user-c',
      mutationKey: 'assign-to-untrusted-user',
    }),
    (error: unknown) => error instanceof WorkItemForbiddenError,
    'assignment requires an explicitly allowed membership, not only a string user id',
  );

  const assigned = await service.assign(scopeA, {
    itemId: created.id,
    assigneeId: scopeB.requesterId,
    mutationKey: 'assign-to-user-b',
  });
  assert.equal(assigned.assigneeId, scopeB.requesterId);
  assert.equal(
    presentWorkItem(assigned, scopeB).assignedToRequester,
    true,
    'the presentation contract derives assigned-to-requester from the server scope',
  );
  assert.equal(
    presentWorkItem(assigned, scopeA).assignedToRequester,
    false,
    'the presentation contract does not treat another requester as assigned',
  );
  assert.deepEqual(service.assigned(scopeB).map((item) => item.id), [created.id]);
  assert.equal(service.get(scopeB, created.id)?.id, created.id, 'assignees gain scoped access');

  const edited = await service.edit(scopeA, {
    itemId: created.id,
    mutationKey: 'edit-parity-item',
    patch: {
      title: 'Ship Work Hub parity v2',
      description: 'Updated description',
      dueDate: '2026-08-13',
      labels: ['parity', 'release'],
    },
  });
  assert.equal(edited.title, 'Ship Work Hub parity v2');
  assert.equal(edited.description, 'Updated description');
  assert.equal(edited.dueDate, '2026-08-13');
  assert.deepEqual(edited.labels, ['parity', 'release']);
  assert.deepEqual(edited.deepLink, created.deepLink, 'editing does not change the deep link');

  const transitioned = await service.transition(scopeB, {
    itemId: created.id,
    status: 'in_progress',
    mutationKey: 'move-to-progress',
  });
  assert.equal(transitioned.status, 'in_progress', 'an assignee may transition status');

  const commented = await service.comment(scopeB, {
    itemId: created.id,
    body: 'I started the implementation.',
    mutationKey: 'comment-started',
  });
  assert.equal(commented.comments.length, 1);
  assert.equal(commented.comments[0]?.authorId, scopeB.requesterId);
  const duplicateComment = await service.comment(scopeB, {
    itemId: created.id,
    body: 'I started the implementation.',
    mutationKey: 'comment-started',
  });
  assert.deepEqual(duplicateComment, commented, 'retrying a comment does not append it twice');

  const watched = await service.watch(scopeB, {
    itemId: created.id,
    mutationKey: 'watch-parity-item',
  });
  assert.deepEqual(watched.watcherIds, [scopeB.requesterId]);
  const unwatched = await service.unwatch(scopeB, {
    itemId: created.id,
    mutationKey: 'unwatch-parity-item',
  });
  assert.deepEqual(unwatched.watcherIds, []);

  const unassigned = await service.assign(scopeA, {
    itemId: created.id,
    assigneeId: null,
    mutationKey: 'unassign-user-b',
  });
  await assert.rejects(
    () => service.transition(scopeB, {
      itemId: created.id,
      status: 'in_progress',
      mutationKey: 'move-to-progress',
    }),
    (error: unknown) => error instanceof WorkItemNotFoundError,
    'idempotent replay rechecks current visibility before returning a prior result',
  );

  const second = await service.create(scopeA, {
    mutationKey: 'create-second-item',
    title: 'Review release checklist',
    status: 'backlog',
    dueDate: '2026-08-20',
  });
  assert.deepEqual(
    service.search(scopeA, { text: 'release', status: 'backlog' }).map((item) => item.id),
    [second.id],
    'search text and status filters are scoped and composable',
  );
  assert.deepEqual(
    service.calendar(scopeA, { from: '2026-08-01', to: '2026-08-31' }).map((item) => item.id),
    [created.id, second.id],
    'calendar query returns inclusive due-date results in date order',
  );
  assert.equal(service.recent(scopeA, 1)[0]?.id, second.id, 'recent view is ordered by the latest mutation');

  await assert.rejects(
    () => service.delete(scopeB, {
      itemId: second.id,
      mutationKey: 'unauthorized-delete',
    }),
    (error: unknown) => error instanceof WorkItemNotFoundError,
    'a requester outside the visible scope cannot discover or delete an item by id',
  );
  const deleted = await service.delete(scopeA, {
    itemId: second.id,
    mutationKey: 'delete-second-item',
  });
  assert.equal(typeof deleted.deletedAt, 'string', 'delete records a durable soft-delete timestamp');
  assert.equal(service.get(scopeA, second.id), undefined, 'deleted items are absent from normal reads');
  assert.deepEqual(
    service.search(scopeA, { text: 'checklist' }).map((item) => item.id),
    [],
    'deleted items are absent from search and list views',
  );
  assert.deepEqual(
    await service.delete(scopeA, { itemId: second.id, mutationKey: 'delete-second-item' }),
    deleted,
    'retrying delete with the same mutation key returns the original soft-deleted item',
  );

  await assert.rejects(
    () => service.transition(scopeB, {
      itemId: second.id,
      status: 'done',
      mutationKey: 'unauthorized-transition',
    }),
    (error: unknown) => error instanceof WorkItemNotFoundError,
    'an assignee of another item cannot transition an unrelated item');
  await assert.rejects(
    () => service.create(scopeA, {
      mutationKey: 'invalid-date',
      title: 'Invalid date',
      dueDate: '2026-02-30',
    }),
    (error: unknown) => error instanceof WorkItemValidationError,
    'invalid calendar dates are rejected');
  await assert.rejects(
    () => service.create(scopeA, {
      mutationKey: 'invalid-title',
      title: '   ',
    }),
    (error: unknown) => error instanceof WorkItemValidationError,
    'blank titles are rejected');

  const restartedService = new WorkItemService(new WorkItemStore(filePath));
  await restartedService.initialize();
  const restored = restartedService.get(scopeA, created.id);
  assert.deepEqual(restored, unassigned, 'persisted work items survive a store restart');
  assert.equal(restartedService.get(scopeA, second.id), undefined, 'soft deletion survives a store restart');
  assert.deepEqual(
    await restartedService.create(scopeA, createInput),
    created,
    'persisted idempotency records replay the original create after restart',
  );

  const equalTimestampPath = path.join(root, 'equal-timestamp-items.json');
  const equalTimestampService = new WorkItemService(
    new WorkItemStore(equalTimestampPath),
    {
      clock: () => new Date('2026-08-09T12:00:00.000Z'),
      membership,
    },
  );
  await equalTimestampService.initialize();
  const equalTimestampItems = [];
  for (let index = 0; index < 8; index += 1) {
    equalTimestampItems.push(await equalTimestampService.create(scopeA, {
      mutationKey: `equal-timestamp-${index}`,
      title: `Equal timestamp ${index}`,
    }));
  }
  await equalTimestampService.edit(scopeA, {
    itemId: equalTimestampItems[0]!.id,
    mutationKey: 'equal-timestamp-revise-oldest',
    patch: { description: 'Revised last while timestamp remains equal.' },
  });
  assert.deepEqual(
    equalTimestampService.recent(scopeA).map((item) => item.title),
    [
      'Equal timestamp 0',
      'Equal timestamp 7',
      'Equal timestamp 6',
      'Equal timestamp 5',
      'Equal timestamp 4',
      'Equal timestamp 3',
      'Equal timestamp 2',
      'Equal timestamp 1',
    ],
    'recent ordering uses a persisted deterministic activity sequence when timestamps tie',
  );

  console.log('PASS: Work Hub parity domain covers scoped CRUD, transitions, collaboration, queries, deep links, Codex linkage, and persistent idempotency');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
