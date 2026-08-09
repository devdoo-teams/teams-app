import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ItemStore } from '../src/server/item-store.js';

const LEGACY_OWNER = {
  tenantId: '__legacy__',
  requesterId: '__legacy__',
};

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-item-store-ownership-'));
const filePath = path.join(root, 'items.json');

const scopeA = { tenantId: 'tenant-a', requesterId: 'user-a' };
const scopeB = { tenantId: 'tenant-a', requesterId: 'user-b' };
const scopeC = { tenantId: 'tenant-b', requesterId: 'user-c' };

try {
  await fs.writeFile(
    filePath,
    JSON.stringify([
      { id: 9, title: 'legacy shared item', status: 'open' },
      { id: 7, title: 'legacy completed item', status: 'done' },
    ]),
    'utf8',
  );

  const store = new ItemStore(filePath);
  await store.initialize();

  const migrated = JSON.parse(await fs.readFile(filePath, 'utf8')) as Array<Record<string, unknown>>;
  assert.deepEqual(
    migrated.map((item) => ({ tenantId: item.tenantId, requesterId: item.requesterId, id: item.id })),
    [
      { ...LEGACY_OWNER, id: 9 },
      { ...LEGACY_OWNER, id: 7 },
    ],
    'legacy unowned items are deterministically quarantined under a reserved owner instead of being guessed onto a live user',
  );

  await store.runWithScope(scopeA, async () => {
    await store.ensureScope();
    const seeded = store.list();
    assert.equal(seeded.length, 2, 'first authenticated principal gets a private seeded task list');
    assert.equal(seeded.some((item) => item.title === 'legacy shared item'), false, 'legacy quarantined items stay out of live user reads');
  });

  const createdByA = await store.runWithScope(scopeA, async () => {
    await store.ensureScope();
    return store.add('scope A only');
  });

  await store.runWithScope(scopeB, async () => {
    await store.ensureScope();
    assert.equal(store.list().some((item) => item.title === 'scope A only'), false, 'other users cannot read another principal’s items');
    assert.equal(await store.update(createdByA.id, 'stolen update'), null, 'other users cannot update another principal’s item');
    assert.equal(await store.toggle(createdByA.id), null, 'other users cannot toggle another principal’s item');
    assert.equal(await store.remove(createdByA.id), null, 'other users cannot delete another principal’s item');
  });

  await Promise.all([
    store.runWithScope(scopeC, async () => store.ensureScope()),
    store.runWithScope(scopeC, async () => store.ensureScope()),
    store.runWithScope(scopeC, async () => store.ensureScope()),
  ]);

  await store.runWithScope(scopeC, async () => {
    const seeded = store.list();
    assert.equal(seeded.length, 2, 'concurrent first access does not duplicate per-user seed items');
    assert.deepEqual(seeded.map((item) => item.id), [1, 2], 'private seed ids remain deterministic inside a principal scope');
  });

  const malformedOwnerPath = path.join(root, 'malformed-owner.json');
  await fs.writeFile(
    malformedOwnerPath,
    JSON.stringify([{ id: 1, title: 'corrupt owner', status: 'open', requesterId: '', tenantId: '' }]),
    'utf8',
  );
  await assert.rejects(
    () => new ItemStore(malformedOwnerPath).initialize(),
    /requesterId|tenantId|owner/i,
    'present but malformed owner metadata is rejected instead of being migrated as legacy data',
  );

  const failingStorePath = path.join(root, 'failing-store', 'items.json');
  const failingStore = new ItemStore(failingStorePath);
  await failingStore.initialize();
  await fs.rm(failingStorePath);
  await fs.mkdir(failingStorePath);
  const failedScope = { tenantId: 'tenant-failure', requesterId: 'user-failure' };
  const unhandledRejections: unknown[] = [];
  const recordUnhandledRejection = (reason: unknown): void => { unhandledRejections.push(reason); };
  process.on('unhandledRejection', recordUnhandledRejection);
  try {
    await assert.rejects(
      () => failingStore.runWithScope(failedScope, async () => failingStore.ensureScope()),
      /regular file|directory|EISDIR/i,
      'a failed seed persistence rejects its caller',
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    assert.deepEqual(unhandledRejections, [], 'handled seed failures do not create a second unhandled rejection');
    assert.deepEqual(failingStore.list(failedScope), [], 'failed seed persistence rolls back in-memory owner data');
  } finally {
    process.removeListener('unhandledRejection', recordUnhandledRejection);
  }

  console.log('PASS: ItemStore isolates CRUD, validates owner metadata, and handles concurrent or failed per-principal seeding safely');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
