import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const { ExecutionPresentationStore } = await import('../src/server/execution-presentation-store.js').catch(error => {
  assert.fail(`The owner-scoped execution display preference store is missing: ${error.message}`);
});
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'execution-presentation-store-test-'));
const scope = { tenantId: 'synthetic-tenant-a', requesterId: 'synthetic-user-a' };
const otherUser = { ...scope, requesterId: 'synthetic-user-b' };
const otherTenant = { ...scope, tenantId: 'synthetic-tenant-b' };
const file = path.join(root, 'preferences.json');

try {
  const store = new ExecutionPresentationStore(file);
  await store.initialize();
  assert.equal(await store.get(scope), 'summary');
  await store.set(scope, 'rich');
  assert.equal(await store.get(scope), 'rich');
  assert.equal(await store.get(otherUser), 'summary');
  assert.equal(await store.get(otherTenant), 'summary');
  assert.equal(await new ExecutionPresentationStore(file).get(scope), 'rich', 'selection survives restart');
  const persisted = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(Object.keys(persisted[0]).sort(), ['mode', 'requesterId', 'tenantId', 'updatedAt']);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  await store.set(scope, 'text');
  assert.equal(await new ExecutionPresentationStore(file, { defaultMode: 'rich' }).get(scope), 'text');
  assert.equal(await new ExecutionPresentationStore(file, { defaultMode: 'rich' }).get(otherUser), 'rich');
  await assert.rejects(() => store.set(scope, 'openai' as any), /presentation|display|mode/i);
  await assert.rejects(() => store.get({ ...scope, tenantId: ' ' }), /scope/i);
  await assert.rejects(() => store.get({ ...scope, requesterId: 'user\u0000other' }), /scope/i);
  await assert.rejects(() => store.set({ ...scope, requesterId: 'u'.repeat(257) }, 'text'), /scope/i);
  await assert.rejects(() => store.get({ ...scope, provider: 'openai' } as any), /scope/i);
  assert.throws(() => new ExecutionPresentationStore(file, { defaultMode: 'openai' as any }), /mode/i);
  assert.throws(() => new ExecutionPresentationStore(file, { maxEntries: 0 }), /capacity|entries/i);

  const bounded = new ExecutionPresentationStore(path.join(root, 'bounded.json'), { maxEntries: 2 });
  await Promise.all([bounded.set(scope, 'text'), bounded.set(otherUser, 'rich')]);
  await assert.rejects(() => bounded.set(otherTenant, 'summary'), /capacity|entries/i);
  assert.equal(await bounded.get(scope), 'text');
  await bounded.set(scope, 'summary');
  assert.equal(await new ExecutionPresentationStore(path.join(root, 'bounded.json'), { maxEntries: 2 }).get(scope), 'summary');

  const original = await fs.readFile(file, 'utf8');
  await fs.rename(file, path.join(root, 'retained.json'));
  await fs.mkdir(file);
  await assert.rejects(() => store.set(scope, 'rich'), /regular file/);
  assert.equal(await store.get(scope), 'text', 'failed atomic persistence cannot publish the new in-memory choice');
  await fs.rmdir(file);
  await fs.writeFile(file, original);
  await store.set(scope, 'summary');
  assert.equal(await new ExecutionPresentationStore(file).get(scope), 'summary', 'the operation queue recovers after failure');

  for (const [name, contents] of [
    ['duplicate', [{ ...scope, mode: 'text', updatedAt: '2026-10-09T09:00:00.000Z' }, { ...scope, mode: 'rich', updatedAt: '2026-10-09T09:00:00.000Z' }]],
    ['provider-mode', [{ ...scope, mode: 'openai', updatedAt: '2026-10-09T09:00:00.000Z' }]],
    ['extra-field', [{ ...scope, mode: 'text', updatedAt: '2026-10-09T09:00:00.000Z', authToken: 'synthetic-only' }]],
    ['invalid-date', [{ ...scope, mode: 'rich', updatedAt: 'yesterday' }]],
    ['oversize', Array.from({ length: 3 }, (_, index) => ({ ...scope, requesterId: `user-${index}`, mode: 'text', updatedAt: '2026-10-09T09:00:00.000Z' }))],
  ] as const) {
    const invalid = path.join(root, `${name}.json`);
    const bytes = JSON.stringify(contents);
    await fs.writeFile(invalid, bytes);
    await assert.rejects(() => new ExecutionPresentationStore(invalid, { maxEntries: 2 }).get(scope), /Invalid.*presentation.*store/i);
    assert.equal(await fs.readFile(invalid, 'utf8'), bytes, 'invalid persisted state is not repaired or overwritten');
  }
  const malformed = path.join(root, 'malformed.json');
  await fs.writeFile(malformed, '{');
  await assert.rejects(() => new ExecutionPresentationStore(malformed).initialize(), /Invalid.*presentation.*store/i);
  const linked = path.join(root, 'symlink.json');
  await fs.symlink(file, linked);
  await assert.rejects(() => new ExecutionPresentationStore(linked).get(scope), /symlink/i);
  console.log('PASS: tenant/requester display preferences persist atomically, isolate users, bound capacity and fail closed without provider changes');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
