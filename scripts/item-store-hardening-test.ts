import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ItemStore, MAX_ITEM_TITLE_LENGTH } from '../src/server/item-store.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teams-item-store-hardening-'));
const storeDirectory = path.join(root, 'store');
await fs.mkdir(storeDirectory, { mode: 0o700 });

const invalidRecords: Array<[string, string]> = [
  ['negative id', '[{"id":-1,"title":"invalid","status":"open"}]'],
  ['zero id', '[{"id":0,"title":"invalid","status":"open"}]'],
  ['fractional id', '[{"id":1.5,"title":"invalid","status":"open"}]'],
  ['infinite id', '[{"id":1e309,"title":"invalid","status":"open"}]'],
  ['unsafe integer id', '[{"id":9007199254740992,"title":"invalid","status":"open"}]'],
  ['string id', '[{"id":"1","title":"invalid","status":"open"}]'],
  ['null id', '[{"id":null,"title":"invalid","status":"open"}]'],
  ['boolean id', '[{"id":true,"title":"invalid","status":"open"}]'],
  ['wrong status', '[{"id":1,"title":"invalid","status":"pending"}]'],
  ['missing status', '[{"id":1,"title":"invalid"}]'],
  ['non-string title', '[{"id":1,"title":42,"status":"open"}]'],
  ['missing title', '[{"id":1,"status":"open"}]'],
  ['duplicate ids', '[{"id":1,"title":"first","status":"open"},{"id":1,"title":"second","status":"done"}]'],
];

async function assertInvalidStore(label: string, raw: string): Promise<void> {
  const filePath = path.join(storeDirectory, `${label.replaceAll(' ', '-')}.json`);
  await fs.writeFile(filePath, raw, 'utf8');
  const before = await fs.readFile(filePath);
  const beforeStat = await fs.stat(filePath);

  await assert.rejects(
    () => new ItemStore(filePath).initialize(),
    /Invalid item store format/,
    `${label} must reject deterministically`,
  );

  assert.deepEqual(await fs.readFile(filePath), before, `${label} must not rewrite invalid data`);
  assert.equal((await fs.stat(filePath)).mtimeNs, beforeStat.mtimeNs, `${label} must not rewrite file metadata`);
}

try {
  for (const [label, raw] of invalidRecords) {
    await assertInvalidStore(label, raw);
  }

  const migrationPath = path.join(storeDirectory, 'legacy.json');
  const legacyLongTitle = `  legacy\u0000title${'x'.repeat(MAX_ITEM_TITLE_LENGTH + 20)}\u001f  `;
  await fs.writeFile(
    migrationPath,
    JSON.stringify([
      { id: 7, title: legacyLongTitle, status: 'done' },
      { id: 5, title: ' \u0000\t\u001f\r\n ', status: 'open' },
      { id: 3, title: '  preserved order  ', status: 'open' },
    ]),
    'utf8',
  );

  const migratedStore = new ItemStore(migrationPath);
  await migratedStore.initialize();
  const migratedItems = migratedStore.list();
  assert.deepEqual(
    migratedItems,
    [
      { id: 7, title: `legacytitle${'x'.repeat(MAX_ITEM_TITLE_LENGTH - 'legacytitle'.length)}`, status: 'done' },
      { id: 5, title: '(제목 없음)', status: 'open' },
      { id: 3, title: 'preserved order', status: 'open' },
    ],
    'legacy titles normalize while id/status/order are preserved',
  );

  const persistedMigration = await fs.readFile(migrationPath, 'utf8');
  assert.deepEqual(
    JSON.parse(persistedMigration),
    migratedItems.map((item) => ({ ...item, requesterId: '__legacy__', tenantId: '__legacy__' })),
    'normalized legacy data must be atomically persisted under the reserved migration owner',
  );
  assert.doesNotMatch(persistedMigration, /\\u0000|\\u001f|null|Infinity/, 'migrated data must not contain unsafe serialized values');

  const added = await migratedStore.add('new item');
  assert.equal(added.id, 8, 'next id must be largest existing id plus one');
  assert.equal(migratedStore.list()[0].id, 8, 'new item order remains newest first');

  const strictStore = new ItemStore(path.join(storeDirectory, 'strict.json'));
  await strictStore.initialize();
  await assert.rejects(() => strictStore.add('x'.repeat(MAX_ITEM_TITLE_LENGTH + 1)), /characters or fewer/);
  await assert.rejects(() => strictStore.add('bad\u0001title'), /unsupported control characters/);

  console.log('PASS: ItemStore rejects invalid records and migrates legacy titles with a non-empty fallback');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
