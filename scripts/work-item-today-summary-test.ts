import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { WorkItemService } from '../src/server/work-item-service.js';
import { WorkItemStore } from '../src/server/work-item-store.js';

const directory = await mkdtemp(path.join(os.tmpdir(), 'teams-work-today-summary-'));
const service = new WorkItemService(
  new WorkItemStore(path.join(directory, 'work-items.json')),
  { clock: () => new Date('2026-08-10T09:00:00.000Z') },
);
const scope = { tenantId: 'tenant-a', requesterId: 'user-a', conversationId: 'personal-tab' };

try {
  await service.initialize();
  const serviceRecord = service as unknown as Record<string, unknown>;
  assert.equal(
    typeof serviceRecord.assignedSummary,
    'function',
    'the service exposes uncapped assigned and due-date aggregates for Today',
  );

  const dueDates = ['2026-08-09', '2026-08-10', '2026-08-11', undefined, '2026-08-08', '2026-08-10'];
  const created = [];
  for (const [index, dueDate] of dueDates.entries()) {
    created.push(await service.create(scope, {
      mutationKey: `create-${index}`,
      title: `업무 ${index}`,
      priority: 'medium',
      labels: [],
      ...(dueDate ? { dueDate } : {}),
    }));
  }
  for (const [index, item] of created.entries()) {
    await service.assign(scope, {
      itemId: item.id,
      assigneeId: scope.requesterId,
      mutationKey: `assign-${index}`,
    });
  }
  await service.transition(scope, {
    itemId: created[4]!.id,
    status: 'done',
    mutationKey: 'finish-overdue-item',
  });

  if (typeof serviceRecord.assignedSummary === 'function') {
    const assignedSummary = serviceRecord.assignedSummary as (scope: typeof scope, today: string) => unknown;
    assert.deepEqual(assignedSummary.call(service, scope, '2026-08-10'), {
      assigned: 6,
      dueToday: 2,
      overdue: 1,
    }, 'completed items stay assigned but do not count as overdue');
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('Work-item Today summary tests passed');
