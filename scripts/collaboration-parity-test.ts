import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  CollaborationForbiddenError,
  CollaborationIdempotencyConflictError,
  CollaborationNotFoundError,
  CollaborationService,
} from '../src/server/collaboration-service.js';
import { CollaborationStore } from '../src/server/collaboration-store.js';
import {
  buildCollaborationDeepLink,
  type CollaborationScope,
  type CollaborationTarget,
} from '../src/shared/collaboration.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-collaboration-parity-'));
const filePath = path.join(root, 'collaboration.json');

const scopeA: CollaborationScope = {
  tenantId: 'tenant-a',
  requesterId: 'user-a',
  conversationId: 'conversation-a',
};
const scopeB: CollaborationScope = {
  tenantId: 'tenant-a',
  requesterId: 'user-b',
  conversationId: 'conversation-a',
};
const otherTenantScope: CollaborationScope = {
  tenantId: 'tenant-b',
  requesterId: 'user-a',
  conversationId: 'conversation-a',
};
const otherConversationScope: CollaborationScope = {
  tenantId: 'tenant-a',
  requesterId: 'user-a',
  conversationId: 'conversation-b',
};

const project: CollaborationTarget = { type: 'project', id: 'project-atlassian' };
const goal: CollaborationTarget = { type: 'goal', id: 'goal-release' };
const topic: CollaborationTarget = { type: 'topic', id: 'topic-notifications' };
const workItem: CollaborationTarget = { type: 'work-item', id: 'work-item-123' };

const fixedNow = new Date('2026-08-12T15:00:00.000Z');
const clock = () => new Date(fixedNow);

try {
  const service = new CollaborationService(new CollaborationStore(filePath), { clock });
  await service.initialize();

  const projectFollowInput = {
    mutationKey: 'follow-project',
    target: project,
    delivery: 'personal' as const,
  };
  const followedProject = await service.follow(scopeA, projectFollowInput);
  assert.equal(followedProject.active, true, 'follow creates an active personal subscription');
  assert.deepEqual(
    followedProject.deepLink,
    buildCollaborationDeepLink(project),
    'subscription deep links are stable and controller-ready',
  );

  assert.deepEqual(
    await service.follow(scopeA, projectFollowInput),
    followedProject,
    'retrying follow with the same key replays the original subscription',
  );
  await assert.rejects(
    () => service.follow(scopeA, { ...projectFollowInput, target: { ...project, id: 'different-project' } }),
    (error: unknown) => error instanceof CollaborationIdempotencyConflictError,
    'reusing a follow key with a different target is rejected',
  );

  const channelFollow = await service.follow(scopeA, {
    mutationKey: 'follow-work-item-channel',
    target: workItem,
    delivery: 'channel',
    channelId: 'channel-engineering',
  });
  assert.equal(channelFollow.delivery, 'channel');
  assert.equal(channelFollow.channelId, 'channel-engineering');

  const followedGoal = await service.follow(scopeA, {
    mutationKey: 'follow-goal',
    target: goal,
    delivery: 'personal',
  });
  const followedTopic = await service.follow(scopeA, {
    mutationKey: 'follow-topic',
    target: topic,
    delivery: 'personal',
  });
  assert.deepEqual(
    service.listSubscriptions(scopeA).map((subscription) => subscription.target),
    [topic, goal, workItem, project],
    'project, goal, topic, and work-item following are all queryable in reverse mutation order',
  );
  assert.equal(service.listSubscriptions(otherTenantScope).length, 0, 'tenant scope hides subscriptions');
  assert.equal(service.listSubscriptions(otherConversationScope).length, 0, 'conversation scope hides subscriptions');
  assert.equal(service.listSubscriptions(scopeB).length, 0, 'subscriptions are owned by the requester');

  const unfollowedTopic = await service.unfollow(scopeA, {
    mutationKey: 'unfollow-topic',
    target: topic,
    delivery: 'personal',
  });
  assert.equal(unfollowedTopic.active, false, 'unfollow deactivates the subscription');
  assert.deepEqual(
    await service.unfollow(scopeA, {
      mutationKey: 'unfollow-topic',
      target: topic,
      delivery: 'personal',
    }),
    unfollowedTopic,
    'retrying unfollow replays the inactive result without duplicating state',
  );
  assert.equal(
    service.listSubscriptions(scopeA).some((subscription) => subscription.target.id === topic.id),
    false,
    'inactive subscriptions are omitted from the active list',
  );
  const refollowedTopic = await service.follow(scopeA, {
    mutationKey: 'refollow-topic',
    target: topic,
    delivery: 'personal',
  });
  assert.equal(refollowedTopic.id, followedTopic.id, 'refollow reactivates the stable subscription record');

  const binding = await service.bindChannel(scopeA, {
    mutationKey: 'bind-project-channel',
    target: project,
    channelId: 'channel-platform',
    metadata: {
      teamId: 'team-atlassian',
      channelName: 'platform',
      channelUrl: 'https://teams.example/channel-platform',
    },
  });
  assert.equal(binding.active, true, 'channel binding is active after bind');
  assert.deepEqual(binding.metadata, {
    teamId: 'team-atlassian',
    channelName: 'platform',
    channelUrl: 'https://teams.example/channel-platform',
  });
  assert.deepEqual(
    service.listChannelBindings(scopeB),
    [binding],
    'same-tenant conversation members can read shared channel binding metadata',
  );
  assert.equal(service.listChannelBindings(otherTenantScope).length, 0, 'tenant scope hides channel bindings');
  assert.equal(service.listChannelBindings(otherConversationScope).length, 0, 'conversation scope hides channel bindings');
  await assert.rejects(
    () => service.unbindChannel(scopeB, {
      mutationKey: 'unauthorized-unbind',
      target: project,
      channelId: 'channel-platform',
    }),
    (error: unknown) => error instanceof CollaborationForbiddenError,
    'a different requester cannot remove another requester-owned channel binding',
  );

  const unbound = await service.unbindChannel(scopeA, {
    mutationKey: 'unbind-project-channel',
    target: project,
    channelId: 'channel-platform',
  });
  assert.equal(unbound.active, false, 'unbind deactivates the channel binding');
  assert.equal(service.listChannelBindings(scopeA).length, 0, 'inactive channel bindings are omitted');
  await assert.rejects(
    () => service.unbindChannel(scopeA, {
      mutationKey: 'unbind-missing-channel',
      target: project,
      channelId: 'channel-platform',
    }),
    (error: unknown) => error instanceof CollaborationNotFoundError,
    'unbinding an already inactive binding gives explicit failure feedback',
  );

  const projectPreference = await service.setNotificationPreference(scopeA, {
    mutationKey: 'prefer-project-weekly-digest',
    target: project,
    delivery: 'personal',
    level: 'digest',
    digestPeriod: 'weekly',
  });
  assert.equal(projectPreference.level, 'digest');
  assert.equal(projectPreference.digestPeriod, 'weekly');
  assert.deepEqual(
    service.getNotificationPreference(scopeA, {
      target: project,
      delivery: 'personal',
    }),
    projectPreference,
    'notification preference is persisted and addressable by target/delivery',
  );
  assert.deepEqual(
    await service.setNotificationPreference(scopeA, {
      mutationKey: 'prefer-project-weekly-digest',
      target: project,
      delivery: 'personal',
      level: 'digest',
      digestPeriod: 'weekly',
    }),
    projectPreference,
    'retrying a preference mutation replays the original result',
  );
  await assert.rejects(
    () => service.setNotificationPreference(scopeA, {
      mutationKey: 'prefer-project-weekly-digest',
      target: project,
      delivery: 'personal',
      level: 'none',
    }),
    (error: unknown) => error instanceof CollaborationIdempotencyConflictError,
    'reusing a preference key with a different level is rejected',
  );

  await service.setNotificationPreference(scopeA, {
    mutationKey: 'prefer-goal-mentions',
    target: goal,
    delivery: 'personal',
    level: 'mentions',
  });
  await service.setNotificationPreference(scopeA, {
    mutationKey: 'prefer-topic-all',
    target: topic,
    delivery: 'personal',
    level: 'all',
  });
  await service.setNotificationPreference(scopeA, {
    mutationKey: 'prefer-work-item-none',
    target: workItem,
    delivery: 'channel',
    channelId: 'channel-engineering',
    level: 'none',
  });

  const projectUpdateOne = await service.recordUpdate(scopeA, {
    mutationKey: 'project-update-one',
    target: project,
    title: 'Project status changed',
    body: 'The parity work moved into implementation.',
    occurredAt: '2026-08-10T09:00:00.000Z',
  });
  const projectUpdateTwo = await service.recordUpdate(scopeA, {
    mutationKey: 'project-update-two',
    target: project,
    title: 'Project status changed',
    body: 'The focused controller contract is ready for review.',
    occurredAt: '2026-08-10T11:00:00.000Z',
  });
  const projectReminder = await service.recordReminder(scopeA, {
    mutationKey: 'project-reminder',
    target: project,
    title: 'Review the parity contract',
    body: 'Review the collaboration controller contract.',
    remindAt: '2026-08-11T10:00:00.000Z',
  });
  assert.equal(projectUpdateOne.kind, 'update');
  assert.equal(projectReminder.kind, 'reminder');
  assert.deepEqual(
    await service.recordUpdate(scopeA, {
      mutationKey: 'project-update-one',
      target: project,
      title: 'Project status changed',
      body: 'The parity work moved into implementation.',
      occurredAt: '2026-08-10T09:00:00.000Z',
    }),
    projectUpdateOne,
    'notification publication is idempotent by mutation key',
  );
  await assert.rejects(
    () => service.recordUpdate(scopeA, {
      mutationKey: 'project-update-one',
      target: project,
      title: 'Project status changed differently',
      body: 'The payload changed.',
      occurredAt: '2026-08-10T09:00:00.000Z',
    }),
    (error: unknown) => error instanceof CollaborationIdempotencyConflictError,
    'reusing a notification key with a different payload is rejected',
  );

  const goalMention = await service.recordUpdate(scopeA, {
    mutationKey: 'goal-mention',
    target: goal,
    title: 'Goal mention',
    body: 'User A was mentioned on the goal.',
    mentionUserIds: ['user-a'],
    occurredAt: '2026-08-10T12:00:00.000Z',
  });
  await service.recordUpdate(scopeA, {
    mutationKey: 'goal-unmentioned',
    target: goal,
    title: 'Goal update',
    body: 'A goal update without a mention.',
    occurredAt: '2026-08-10T13:00:00.000Z',
  });
  const topicUpdate = await service.recordUpdate(scopeA, {
    mutationKey: 'topic-update',
    target: topic,
    title: 'Topic update',
    body: 'All topic updates are immediate.',
    occurredAt: '2026-08-10T14:00:00.000Z',
  });
  const workItemUpdate = await service.recordUpdate(scopeA, {
    mutationKey: 'work-item-update',
    target: workItem,
    title: 'Work item update',
    body: 'This update is suppressed by the none preference.',
    channelId: 'channel-engineering',
    occurredAt: '2026-08-10T15:00:00.000Z',
  });

  const immediate = service.notifications(scopeA, {
    from: '2026-08-10T00:00:00.000Z',
    to: '2026-08-11T00:00:00.000Z',
  });
  assert.deepEqual(
    immediate.map((notification) => notification.id),
    [topicUpdate.id, goalMention.id],
    'all and mentions preferences control immediate proactive updates while digest/none stay out',
  );
  assert.equal(immediate.some((notification) => notification.id === workItemUpdate.id), false);

  const dailyDigest = service.digest(scopeA, {
    period: 'daily',
    at: '2026-08-10T23:00:00.000Z',
  });
  assert.equal(dailyDigest.totalCount, 2, 'daily digest includes only the two project events on that day');
  assert.deepEqual(
    dailyDigest.entries.map((entry) => ({ kind: entry.kind, count: entry.count })),
    [{ kind: 'update', count: 2 }],
    'daily digest aggregates repeated updates for a target into one entry',
  );
  assert.deepEqual(dailyDigest.entries[0]?.deepLink, buildCollaborationDeepLink(project));

  const weeklyDigest = service.digest(scopeA, {
    period: 'weekly',
    at: '2026-08-11T23:00:00.000Z',
  });
  assert.equal(weeklyDigest.totalCount, 3, 'weekly digest includes updates and reminders in the weekly window');
  assert.deepEqual(
    weeklyDigest.entries.map((entry) => ({ kind: entry.kind, count: entry.count })),
    [
      { kind: 'reminder', count: 1 },
      { kind: 'update', count: 2 },
    ],
    'weekly digest keeps proactive updates and reminders as separate aggregate groups',
  );

  const restartedService = new CollaborationService(new CollaborationStore(filePath), { clock });
  await restartedService.initialize();
  assert.deepEqual(
    restartedService.listSubscriptions(scopeA),
    service.listSubscriptions(scopeA),
    'subscriptions survive a store restart',
  );
  assert.deepEqual(
    restartedService.listNotificationPreferences(scopeA),
    service.listNotificationPreferences(scopeA),
    'notification preferences survive a store restart',
  );
  assert.deepEqual(
    restartedService.digest(scopeA, { period: 'weekly', at: '2026-08-11T23:00:00.000Z' }),
    weeklyDigest,
    'digest aggregation survives a store restart',
  );
  assert.deepEqual(
    await restartedService.follow(scopeA, projectFollowInput),
    followedProject,
    'persisted idempotency records replay the original follow after restart',
  );

  const scopeBFollow = await restartedService.follow(scopeB, {
    mutationKey: 'follow-project',
    target: project,
    delivery: 'personal',
  });
  assert.notEqual(scopeBFollow.id, followedProject.id, 'same mutation key is isolated by requester scope');
  assert.equal(restartedService.listSubscriptions(otherTenantScope).length, 0);
  assert.equal(restartedService.listSubscriptions(otherConversationScope).length, 0);

  console.log('PASS: collaboration parity covers scoped subscriptions, channel bindings, preferences, proactive notifications, digest aggregation, stable links, restart persistence, and idempotency');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
