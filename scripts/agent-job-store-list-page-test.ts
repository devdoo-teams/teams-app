import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AgentJobStore, type AgentJobScope } from '../src/server/agent-job-store.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-job-list-page-'));
try {
  const store = new AgentJobStore(path.join(root, 'jobs.json'));
  await store.initialize();
  const owner: AgentJobScope = { tenantId: 'tenant-a', requesterId: 'requester-a', conversationId: 'chat-a' };
  const other: AgentJobScope = { tenantId: 'tenant-b', requesterId: 'requester-b', conversationId: 'chat-b' };
  async function create(prompt: string, scope = owner) {
    return store.create({ prompt, provider: 'codex', mode: 'read-only', scope });
  }

  const first = await create('needle: first');
  const second = await create('ordinary second');
  const third = await create('needle: third');
  const fourth = await create('ordinary fourth');
  await store.update(second.id, owner, { status: 'failed', finishedAt: new Date().toISOString() });
  await create('needle belongs to another principal', other);

  const listPageForPrincipal = (store as unknown as {
    listPageForPrincipal?: (principal: Pick<AgentJobScope, 'tenantId' | 'requesterId'>, query: Record<string, unknown>) => {
      jobs: Array<{ id: string; prompt: string }>;
      nextCursor?: string;
      hasMore: boolean;
    };
  }).listPageForPrincipal;
  assert.equal(typeof listPageForPrincipal, 'function', 'job store exposes principal-scoped server pagination');
  const principal = { tenantId: owner.tenantId, requesterId: owner.requesterId };
  const page1 = listPageForPrincipal!.call(store, principal, { limit: 2 });
  assert.deepEqual(page1.jobs.map(job => job.id), [fourth.id, third.id]);
  assert.equal(page1.hasMore, true);
  assert.ok(page1.nextCursor);

  // A new job at the head must not shift the stable cursor into a duplicate or skipped old item.
  const newest = await create('new while paging');
  const page2 = listPageForPrincipal!.call(store, principal, { limit: 2, cursor: page1.nextCursor });
  assert.deepEqual(page2.jobs.map(job => job.id), [second.id, first.id]);
  assert.equal(page2.jobs.some(job => job.id === newest.id), false);
  assert.equal(page2.hasMore, false);
  assert.equal(page2.nextCursor, undefined);

  const search = listPageForPrincipal!.call(store, principal, { limit: 10, search: 'NEEDLE' });
  assert.deepEqual(search.jobs.map(job => job.id), [third.id, first.id], 'search is case insensitive and remains principal scoped');
  const failed = listPageForPrincipal!.call(store, principal, { limit: 10, status: 'failed' });
  assert.deepEqual(failed.jobs.map(job => job.id), [second.id], 'status filter is evaluated against durable state');
  const pinned = listPageForPrincipal!.call(store, principal, { limit: 10, jobIds: [first.id, newest.id, 'not-owned'] });
  assert.deepEqual(new Set(pinned.jobs.map(job => job.id)), new Set([first.id, newest.id]), 'requested IDs never bypass principal scope');
  assert.throws(() => listPageForPrincipal!.call(store, principal, { limit: 2, cursor: 'tampered cursor' }), /cursor/u);
  assert.throws(() => listPageForPrincipal!.call(store, principal, { limit: 2, status: 'running-now' }), /status/u);
  console.log('PASS: principal-scoped job pages filter safely and keep stable cursors during new submissions');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
